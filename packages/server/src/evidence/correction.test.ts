import { randomUUID } from 'node:crypto'

import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type DutyId,
  type EvidenceId,
  type IsoDate,
  readEvidenceState,
  type StoredEvidenceState,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { dutySource } from '../deadlines/sources.js'
import { evidenceIntact } from './fingerprint.js'
import { voidEvidence, type VoidingToTake } from './voiding.js'
import { type EvidenceToWrite, EvidenceRefusal, writeEvidence } from './write.js'

/**
 * Correcting an evidence and declaring one invalid (ADR 0004, points 14 and
 * 15): a correction is a new evidence of the same duty that names the one it
 * replaces in its state, a declaration of invalidity a row of its own, and
 * both leave every evidence as it was and readable. The due day of the duty
 * counts from the evidence that stands.
 */

const tenant = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const at = new Date('2026-10-03T08:00:00.000Z')
const catalogue = catalogueOf(probeCatalogueBundle)

let admin: Pool
let database: Database
let area = ''

/** A duty of the operator's own at a new property: once a year, from the day it was done. */
async function ownDuty(): Promise<DutyId> {
  const property = randomUUID()

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenant, area],
  )

  const { rows } = await admin.query<{ id: DutyId }>(
    `insert into duties (tenant_id, property_id, area_id, label, basis, source_note, counting,
                         interval_months, confirmed_by)
     values ($1, $2, $3, 'Zufahrt freihalten', 'authority', 'Brandschutzkonzept',
             'from_performance', 12, $4)
     returning id`,
    [tenant, property, area, lead],
  )

  return rows[0]?.id as DutyId
}

/** The report of an examiner from outside on a duty, done on a day. */
function report(
  duty: DutyId,
  performedOn: IsoDate,
  replaces: EvidenceToWrite['replaces'] = null,
): EvidenceToWrite {
  return {
    dutyId: duty,
    activityId: null,
    origin: 'report',
    performedOn,
    result: 'without_defects',
    resultReason: null,
    performedBy: null,
    examiner: { name: 'Erika Muster', organisation: 'Prüfstelle Süd' },
    signatures: [],
    files: [],
    replaces,
  }
}

function write(input: EvidenceToWrite) {
  return database.forTenant({ tenantId: tenant, userId: lead }, (tx) =>
    writeEvidence(
      tx,
      { tenantId: tenant, writtenBy: lead, at, catalogue, nameOf: () => 'Hanna Probe' },
      input,
    ),
  )
}

function voiding(input: VoidingToTake) {
  return database.forTenant({ tenantId: tenant, userId: lead }, (tx) =>
    voidEvidence(tx, { tenantId: tenant, writtenBy: lead, at }, input),
  )
}

/** The sentence a correction or a declaration was refused with, or that it went through. */
async function refusalOf(pending: Promise<unknown>): Promise<string> {
  try {
    await pending

    return 'taken'
  } catch (error) {
    return error instanceof EvidenceRefusal ? error.message : `other: ${String(error)}`
  }
}

/** The row of an evidence as the database holds it. */
async function rowOf(id: EvidenceId) {
  const { rows } = await admin.query<{
    number: string
    state: StoredEvidenceState
    fingerprint: string
    replaces_evidence_id: string | null
    replacement_reason: string | null
  }>(
    `select number, state, fingerprint, replaces_evidence_id, replacement_reason
       from evidence where id = $1`,
    [id],
  )

  return rows[0]
}

async function countOf(table: string): Promise<number> {
  const { rows } = await admin.query<{ count: number }>(
    `select count(*)::int as count from ${table} where tenant_id = $1`,
    [tenant],
  )

  return rows[0]?.count ?? 0
}

/** The day the source of the deadlines names for a duty, or null for none. */
async function dueOn(duty: DutyId): Promise<string | null> {
  const expected = await database.forTenant({ tenantId: tenant, userId: lead }, (tx) =>
    dutySource({ catalogue, today: () => '2026-10-03' })(tx),
  )

  return expected.find((deadline) => deadline.sourceId === duty)?.namedDueOn ?? null
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])
  await admin.query(
    `insert into auth_users (id, name, email) values ($1, 'Hanna Probe', 'lead@beispiel.example')`,
    [lead],
  )
  // The first membership gives the operator its first area, and the Leitung every area.
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{management}')`,
    [tenant, lead],
  )

  const { rows } = await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [
    tenant,
  ])

  area = rows[0]?.id ?? ''
  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a correction', () => {
  it('names the evidence it replaces in its state, and both stay readable', async () => {
    const duty = await ownDuty()
    const first = await write(report(duty, '2026-09-01'))
    const before = await rowOf(first.id)
    const correction = await write(
      report(duty, '2026-09-02', {
        evidenceId: first.id,
        reason: ' Der Prüfbericht nennt den 2. September. ',
      }),
    )

    expect(correction.state.version).toBe(3)
    expect(correction.state.replaces).toEqual({
      number: first.number,
      reason: 'Der Prüfbericht nennt den 2. September.',
    })

    const replaced = await rowOf(first.id)
    const replacing = await rowOf(correction.id)

    // The evidence it replaces is what it was, to the byte.
    expect(replaced).toEqual(before)
    expect(readEvidenceState(replaced?.state).replaces).toBeNull()
    expect(readEvidenceState(replaced?.state).performedOn).toBe('2026-09-01')
    expect(replacing?.replaces_evidence_id).toBe(first.id)
    expect(replacing?.replacement_reason).toBe('Der Prüfbericht nennt den 2. September.')
    expect(readEvidenceState(replacing?.state).performedOn).toBe('2026-09-02')
    expect([replaced, replacing].every((row) => row !== undefined && evidenceIntact(row))).toBe(
      true,
    )
  })

  it('is refused without a reason, for another duty, twice, or for an invalid evidence, and leaves nothing behind', async () => {
    const duty = await ownDuty()
    const other = await ownDuty()
    const first = await write(report(duty, '2026-09-01'))
    const elsewhere = await write(report(other, '2026-09-01'))
    const voided = await write(report(duty, '2026-09-05'))
    const correction = await write(
      report(duty, '2026-09-02', { evidenceId: first.id, reason: 'Falscher Tag.' }),
    )

    await voiding({ evidenceId: voided.id, reason: 'Der Bericht gehört zu einer anderen Zufahrt.' })

    const evidenceBefore = await countOf('evidence')
    const correct = (evidenceId: EvidenceId, reason = 'Falscher Tag.') =>
      refusalOf(write(report(duty, '2026-09-03', { evidenceId, reason })))

    expect(await correct(first.id, '  ')).toBe('Eine Berichtigung nennt ihren Grund.')
    expect(await correct(randomUUID() as EvidenceId)).toBe(
      'Den Nachweis, der berichtigt werden soll, gibt es nicht.',
    )
    expect(await correct(elsewhere.id)).toBe(
      'Eine Berichtigung gilt für die Pflicht des Nachweises, den sie ersetzt.',
    )
    expect(await correct(first.id)).toBe(
      `Dieser Nachweis ist schon berichtigt, mit ${correction.number}; berichtigt wird dann die Berichtigung.`,
    )
    expect(await correct(voided.id)).toBe(
      'Ein für ungültig erklärter Nachweis wird nicht berichtigt.',
    )
    expect(await countOf('evidence')).toBe(evidenceBefore)

    // The correction of the correction goes through, with the next number.
    const second = await write(
      report(duty, '2026-09-03', { evidenceId: correction.id, reason: 'Doch der 3. September.' }),
    )

    expect(second.state.replaces?.number).toBe(correction.number)
    expect(Number(second.number.slice(-5))).toBe(Number(correction.number.slice(-5)) + 1)
  })
})

describe('a declaration of invalidity', () => {
  it('stands once for an evidence, with the reason, and the evidence stays as it was', async () => {
    const duty = await ownDuty()
    const written = await write(report(duty, '2026-09-01'))
    const before = await rowOf(written.id)
    const taken = await voiding({
      evidenceId: written.id,
      reason: ' Der Rundgang wurde nicht gegangen. ',
    })

    expect(taken.number).toBe(written.number)

    const { rows } = await admin.query<{ reason: string; voided_by: string; voided_at: Date }>(
      'select reason, voided_by, voided_at from evidence_voidings where id = $1',
      [taken.id],
    )

    expect(rows).toEqual([
      { reason: 'Der Rundgang wurde nicht gegangen.', voided_by: lead, voided_at: at },
    ])
    expect(await rowOf(written.id)).toEqual(before)
    expect(await refusalOf(voiding({ evidenceId: written.id, reason: 'Noch einmal.' }))).toBe(
      'Dieser Nachweis ist schon für ungültig erklärt.',
    )
  })

  it('is refused without a reason, for no evidence, and for one a correction replaced', async () => {
    const duty = await ownDuty()
    const first = await write(report(duty, '2026-09-01'))
    const correction = await write(
      report(duty, '2026-09-02', { evidenceId: first.id, reason: 'Falscher Tag.' }),
    )
    const before = await countOf('evidence_voidings')

    expect(await refusalOf(voiding({ evidenceId: correction.id, reason: '' }))).toBe(
      'Eine Ungültigerklärung nennt ihren Grund.',
    )
    expect(
      await refusalOf(voiding({ evidenceId: randomUUID() as EvidenceId, reason: 'Falsch.' })),
    ).toBe('Diesen Nachweis gibt es nicht.')
    expect(await refusalOf(voiding({ evidenceId: first.id, reason: 'Falsch.' }))).toBe(
      `Dieser Nachweis ist mit ${correction.number} berichtigt; für ungültig erklärt wird dann die Berichtigung.`,
    )
    expect(await countOf('evidence_voidings')).toBe(before)
  })
})

describe('the due day of a duty', () => {
  it('counts from the evidence that stands, neither replaced nor invalid', async () => {
    const duty = await ownDuty()
    const first = await write(report(duty, '2025-10-01'))

    expect(await dueOn(duty)).toBe('2026-10-01')

    const later = await write(report(duty, '2026-03-01'))

    expect(await dueOn(duty)).toBe('2027-03-01')

    // The later one declared invalid: the duty counts from the first again.
    await voiding({ evidenceId: later.id, reason: 'Der Bericht gehört zu einer anderen Zufahrt.' })

    expect(await dueOn(duty)).toBe('2026-10-01')

    // The first corrected: the duty counts from the correction.
    const correction = await write(
      report(duty, '2025-11-01', { evidenceId: first.id, reason: 'Falscher Tag.' }),
    )

    expect(await dueOn(duty)).toBe('2026-11-01')

    // And with the correction declared invalid nothing stands: the duty has no
    // appointment, as one that was never recorded.
    await voiding({ evidenceId: correction.id, reason: 'Der Bericht ist nicht echt.' })

    expect(await dueOn(duty)).toBeNull()
  })
})
