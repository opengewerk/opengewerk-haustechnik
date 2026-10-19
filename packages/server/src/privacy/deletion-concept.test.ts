import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type DeletionRuleKey,
  defaultDeletionFacts,
  deletionRules,
  describeDeletion,
  processingActivities,
} from '@opengewerk/haustechnik-domain'
import * as foundationSchema from '@opengewerk/platform-server/schema'
import { is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import * as ownSchema from '../database/schema/index.js'
import { processingTemplate } from '../processing-description/template.js'

/**
 * The deletion concept names every deletion the application knows (#358,
 * acceptance 2): every place in the server of the Haustechnik and of the
 * foundation that deletes a row of the database, and every function of a
 * migration that does, is given here to a rule of the concept or named as a
 * removal by hand, with why. A place added without that turns this test red,
 * and so does a place named here that is gone.
 */

const root = fileURLToPath(new URL('../../../../', import.meta.url))

/** Why a place deletes: a rule of the concept, or a removal by hand that is no period. */
type Why = DeletionRuleKey | { readonly byHand: string }

/**
 * Every place that deletes rows, as `<file from the root>#<table>`. The file
 * of a place in the foundation starts with `upstream/opengewerk/`.
 */
const places: Readonly<Record<string, readonly Why[]>> = {
  'packages/server/src/api/contracts.controller.ts#contractItems': [
    { byHand: 'Positionen eines Vertrags, die wer Verträge führt herausnimmt' },
  ],
  'packages/server/src/api/defects.controller.ts#defectClassTerms': [
    { byHand: 'Begriffe einer Mängelklasse, wenn sie neu gefasst wird' },
  ],
  'packages/server/src/api/delegations.controller.ts#dutyDelegationAreas': [
    { byHand: 'die Bereiche einer Pflichtenübertragung, solange sie ein Entwurf ist' },
  ],
  'packages/server/src/api/delegations.controller.ts#dutyDelegations': [
    { byHand: 'ein Entwurf einer Pflichtenübertragung, den noch niemand unterschrieben hat' },
  ],
  'packages/server/src/api/roles.controller.ts#tenantRoles': [{ byHand: 'eine eigene Rolle' }],
  'packages/server/src/areas/areas.ts#areas': [{ byHand: 'ein Bereich' }],
  'packages/server/src/areas/areas.ts#memberAllAreas': [{ byHand: 'die Bereiche einer Person' }],
  'packages/server/src/areas/areas.ts#memberAreas': [{ byHand: 'die Bereiche einer Person' }],
  'packages/server/src/areas/substitutions.ts#substitutions': ['substitution'],
  'packages/server/src/limits/limits.ts#memberLimitProperties': [
    { byHand: 'die Beschränkungen eines Prüfers' },
  ],
  'packages/server/src/limits/limits.ts#memberLimitAssetKinds': [
    { byHand: 'die Beschränkungen eines Prüfers' },
  ],
  'packages/server/src/notifications/outside-answers.ts#faultReportContacts': ['outside-answer'],
  'packages/server/src/notifications/push.ts#pushSubscriptions': ['access-data'],
  'upstream/opengewerk/packages/platform/server/src/authentication/administration.ts#authSessions':
    ['sessions', 'access-data'],
  'upstream/opengewerk/packages/platform/server/src/authentication/administration.ts#authVerifications':
    ['password-link', 'access-data'],
  'upstream/opengewerk/packages/platform/server/src/authentication/administration.ts#authPasskeys':
    ['access-data'],
  'upstream/opengewerk/packages/platform/server/src/authentication/administration.ts#authTwoFactors':
    ['access-data'],
  'upstream/opengewerk/packages/platform/server/src/authentication/administration.ts#authAccounts':
    ['access-data'],
  'upstream/opengewerk/packages/platform/server/src/authentication/authentication.controller.ts#authSessions':
    ['sessions'],
  'upstream/opengewerk/packages/platform/server/src/authentication/authentication.ts#authPasskeys':
    [{ byHand: 'ein neuer Passkey, der sich nicht festhalten ließ' }],
  'upstream/opengewerk/packages/platform/server/src/authentication/passkeys.ts#authPasskeys': [
    { byHand: 'ein Passkey, den seine Person löscht' },
  ],
  'upstream/opengewerk/packages/platform/server/src/authentication/staff.ts#authSessions': [
    'sessions',
  ],
  'upstream/opengewerk/packages/platform/server/src/instance/operators.ts#instanceOperators': [
    { byHand: 'ein Konto der Verwaltung der Instanz' },
  ],
  'upstream/opengewerk/packages/platform/server/src/mail/server-settings.ts#mailSettings': [
    { byHand: 'der Mailserver eines Betreibers' },
  ],
  'upstream/opengewerk/packages/platform/server/src/push/outbox.ts#pushSubscriptions': [
    'push-subscription',
  ],
  'upstream/opengewerk/packages/platform/server/src/push/push.controller.ts#pushSubscriptions': [
    'push-subscription',
  ],
  'upstream/opengewerk/packages/platform/server/src/push/push.controller.ts#pushOptOuts': [
    { byHand: 'eine Art von Push, die eine Person wieder einschaltet' },
  ],
  'upstream/opengewerk/packages/platform/server/src/secrets/store.ts#secrets': [
    { byHand: 'ein versiegelter Wert, den eine Einstellung ersetzt' },
  ],
}

/** The tables the functions of the migrations delete from, by their name in the database. */
const inMigrations: Readonly<Record<string, DeletionRuleKey>> = {
  prints: 'evidence',
  evidence_signed_prints: 'evidence',
  service_report_records: 'emptied-activity',
  service_reports: 'emptied-activity',
  round_records: 'emptied-activity',
  activity_answers: 'emptied-activity',
  activity_signatures: 'emptied-activity',
  work_order_decisions: 'emptied-activity',
  work_order_participants: 'emptied-activity',
  work_order_notes: 'emptied-activity',
  work_order_materials: 'emptied-activity',
  briefings: 'emptied-activity',
  work_permits: 'emptied-activity',
}

/** Rules that delete nothing in the database of the instance: on a device, and the backups. */
const outsideTheDatabase: readonly DeletionRuleKey[] = ['device-store', 'backups']

/** The tables of both schemas by the names they are exported under, as a `.delete()` names them. */
const tables = new Set(
  Object.entries({ ...foundationSchema, ...ownSchema })
    .filter(([, value]) => is(value, PgTable))
    .map(([name]) => name),
)

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

function codeOf(path: string): string {
  // A comment that speaks of deleting deletes nothing, in a script or in SQL.
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/--.*$/gm, '')
}

/** Every `.delete(<table>)` of drizzle in the source of a server, test files and the preview aside. */
function placesIn(directory: string): string[] {
  const found = new Set<string>()

  for (const path of filesUnder(join(root, directory))) {
    const name = relative(root, path).split(sep).join('/')

    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.includes('/preview/')) {
      continue
    }

    for (const match of codeOf(path).matchAll(/\.delete\(\s*([a-z][A-Za-z]+)\s*\)/g)) {
      const table = match[1] ?? ''

      // A Map or a Set deletes a key, not a row: its argument is no table of a schema.
      if (tables.has(table)) {
        found.add(`${name}#${table}`)
      }
    }
  }

  return [...found]
}

const known = [
  ...placesIn('packages/server/src'),
  ...placesIn('upstream/opengewerk/packages/platform/server/src'),
]

describe('the deletion concept', () => {
  it('knows every place in the server and the foundation that deletes rows, and no place that is gone', () => {
    expect(known.sort()).toEqual(Object.keys(places).sort())
  })

  it('knows every table a migration deletes from', () => {
    const deleted = new Set<string>()

    for (const path of filesUnder(join(root, 'packages/server/migrations'))) {
      if (!path.endsWith('.sql') || path.includes(`${sep}down${sep}`)) {
        continue
      }

      for (const match of codeOf(path).matchAll(/DELETE FROM (?:public\.)?"?([a-z_]+)"?/gi)) {
        deleted.add(match[1] ?? '')
      }
    }

    expect([...deleted].sort()).toEqual(Object.keys(inMigrations).sort())
  })

  it('names every rule a place or a migration deletes by, and has no rule that deletes nothing', () => {
    const rules = deletionRules(defaultDeletionFacts).map((rule) => rule.key)
    const used = new Set<DeletionRuleKey>([
      ...Object.values(places).flatMap((whys) => whys.filter((why) => typeof why === 'string')),
      ...Object.values(inMigrations),
      ...outsideTheDatabase,
    ])

    expect([...used].sort()).toEqual([...rules].sort())
  })

  it('cites for every rule only proofs annex A of the description has', () => {
    const annex = new Set(
      [...processingTemplate().matchAll(/^\| (B\d+) \|/gm)].map((match) => match[1] ?? ''),
    )

    for (const rule of deletionRules(defaultDeletionFacts)) {
      for (const proof of rule.proofs) {
        expect(annex.has(proof), `${rule.key} cites ${proof}`).toBe(true)
      }
    }
  })

  it('is pointed at by the record only with rules it has', () => {
    const rules = new Set(deletionRules(defaultDeletionFacts).map((rule) => rule.key))

    for (const activity of processingActivities) {
      for (const key of activity.deletion) {
        expect(rules.has(key), `${activity.key} points at ${key}`).toBe(true)
      }
    }
  })

  it('numbers its rules in the made document and names each one', () => {
    const made = describeDeletion({
      operator: 'Probe Nord',
      at: '19.10.2026 um 09:30',
      holdsFor: '0.2.0',
      facts: {
        ...defaultDeletionFacts,
        minimumYears: 3,
        removalDays: 45,
        backupGenerations: '21 | \\ <b>',
      },
    })

    for (const [index] of deletionRules(defaultDeletionFacts).entries()) {
      expect(made).toContain(`| L${String(index + 1)} |`)
    }

    expect(made).toContain('frühestens nach 3 Jahren')
    expect(made).toContain('45 Tage nach dem letzten Tag')
    // What whoever runs the instance wrote stays text, a bar and a backslash included.
    expect(made).toContain('wenn 21 \\| \\\\ \\<b\\> Generationen erreicht sind')
  })
})
