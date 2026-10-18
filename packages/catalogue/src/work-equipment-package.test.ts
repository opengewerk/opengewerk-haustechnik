import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  acceptanceTally,
  type AssetValue,
  type Catalogue,
  catalogueOf,
  dutyIntervalProblem,
  intervalOfRule,
  type IsoDate,
  proposedKinds,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Förderanlagen und Arbeitsmittel as the repository holds it under
// pakete/, read the way the build reads it (opengewerk-haustechnik#353,
// sections 5 and 8 of the concept). What is expected below is checked against
// the texts as they stood on 18 October 2026: § 14, § 16, § 17 and Anhang 1
// Nr. 4 and Anhang 2 Abschnitte 2 and 4 of the BetrSichV; ASR A1.7 Nr. 10.2;
// TRBS 1201 Anhang 4 Nr. 14; DGUV Information 208-016, Abschnitt 6. What a
// Technische Regel or a DGUV-Information names as an interval is a guide, and
// a private standard names none (decided on 18 October 2026). Whoever changes
// one in the package changes it here, against the same text.
const shipped = readPackageFiles(fileURLToPath(new URL('../../../pakete/', import.meta.url)))

const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const options = {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
}

function catalogue(): Catalogue {
  const { bundle, problems } = loadCatalogue(shipped, options)

  if (!bundle) {
    throw new Error(`Die Pakete laden nicht: ${problems.join(' ')}`)
  }

  return catalogueOf(bundle)
}

const equipment = catalogue()
const today: IsoDate = '2026-10-18'

/** The duty kinds the catalogue proposes for an asset of a kind of the package, sorted. */
function proposed(kind: string, values: Readonly<Record<string, AssetValue>> = {}): string[] {
  return proposedKinds(
    equipment,
    {
      assetKind: `arbeitsmittel.${kind}`,
      values,
      buildingKinds: ['office'],
      federalState: 'DE-BW',
    },
    today,
    new Set(),
  )
    .map((entry) => entry.key.replace('arbeitsmittel.', ''))
    .sort()
}

/** The kind of interval of a duty kind, and its value and unit. */
function interval(key: string): string {
  const kind = equipment.dutyKind(`arbeitsmittel.${key}`, today)

  if (!kind) {
    throw new Error(`Die Pflichtart ${key} fehlt.`)
  }

  const rule = equipment.interval(kind.definition, today)

  return `${kind.definition.interval.kind} ${rule === null ? 'none' : `${String(rule.record.value)} ${rule.record.unit}`}`
}

/** A pressure vessel with all its characteristics, so that only the ones a test sets decide. */
const vessel = {
  testing_body: 'approved_body',
  heated: true,
  simple_vessel: false,
  strength_test_extended: false,
}

describe('the package Förderanlagen und Arbeitsmittel', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(equipment.packages.find((entry) => entry.name === 'arbeitsmittel')?.title).toBe(
      'Förderanlagen und Arbeitsmittel',
    )
  })

  it('has an elevator tested every two years at most, between them in the middle, by an approved body, and maintained', () => {
    expect(proposed('elevator')).toEqual([
      'elevator_intermediate_test',
      'elevator_main_test',
      'elevator_maintenance',
    ])
    expect(interval('elevator_main_test')).toBe('maximum 2 years')
    expect(interval('elevator_intermediate_test')).toBe('maximum 2 years')
    expect(interval('elevator_maintenance')).toBe('none none')

    // Both count by § 14 Abs. 5 BetrSichV, which Anhang 2 Abschnitt 2 Nr. 4.3 names for the intermediate test as well.
    for (const key of ['elevator_main_test', 'elevator_intermediate_test']) {
      expect(equipment.dutyKind(`arbeitsmittel.${key}`, today)?.definition).toMatchObject({
        counting: 'betrsichv',
        qualification: { level: 'approved_body' },
        retention: { kind: 'while_in_use' },
      })
    }
  })

  it('has the tests of a pressure vessel by who tests it, the external test only for a heated vessel that is not a simple one', () => {
    expect(proposed('pressure_vessel', vessel)).toEqual([
      'pressure_vessel_external_test',
      'pressure_vessel_internal_test',
      'pressure_vessel_strength_test',
    ])
    expect(proposed('pressure_vessel', { ...vessel, heated: false })).toEqual([
      'pressure_vessel_internal_test',
      'pressure_vessel_strength_test',
    ])
    expect(proposed('pressure_vessel', { ...vessel, simple_vessel: true })).toEqual([
      'pressure_vessel_internal_test',
      'pressure_vessel_strength_test',
    ])
    expect(proposed('pressure_vessel', { ...vessel, testing_body: 'competent_person' })).toEqual([
      'pressure_vessel_external_test_competent_person',
      'pressure_vessel_internal_test_competent_person',
      'pressure_vessel_strength_test_competent_person',
    ])
    expect(
      proposed('pressure_vessel', {
        ...vessel,
        testing_body: 'competent_person',
        strength_test_extended: true,
      }),
    ).toEqual([
      'pressure_vessel_external_test_competent_person',
      'pressure_vessel_internal_test_competent_person',
      'pressure_vessel_strength_test_competent_person_extended',
    ])
    // Nobody said who tests it: every test is proposed, and the ones that do not apply are dismissed.
    expect(proposed('pressure_vessel', { heated: true, simple_vessel: false })).toHaveLength(7)
  })

  it('has the maximum intervals of Tabelle 1 for an approved body and ten or fifteen years for a competent person', () => {
    expect(interval('pressure_vessel_external_test')).toBe('maximum 2 years')
    expect(interval('pressure_vessel_internal_test')).toBe('maximum 5 years')
    expect(interval('pressure_vessel_strength_test')).toBe('maximum 10 years')
    expect(interval('pressure_vessel_external_test_competent_person')).toBe('maximum 10 years')
    expect(interval('pressure_vessel_internal_test_competent_person')).toBe('maximum 10 years')
    expect(interval('pressure_vessel_strength_test_competent_person')).toBe('maximum 10 years')
    expect(interval('pressure_vessel_strength_test_competent_person_extended')).toBe(
      'maximum 15 years',
    )
  })

  it('lets an interval with a maximum only be shortened', () => {
    for (const key of ['elevator_main_test', 'pressure_vessel_internal_test']) {
      const kind = equipment.dutyKind(`arbeitsmittel.${key}`, today)
      const rule = kind ? equipment.interval(kind.definition, today) : null
      const maximum = rule === null ? null : intervalOfRule(rule.record)
      const months = maximum !== null && 'months' in maximum ? maximum.months : 0

      expect(months).toBeGreaterThan(0)
      expect(dutyIntervalProblem({ intervalMonths: months }, 'betrsichv', maximum)).toBeNull()
      expect(dutyIntervalProblem({ intervalMonths: months - 1 }, 'betrsichv', maximum)).toBeNull()
      expect(
        dutyIntervalProblem({ intervalMonths: months + 1 }, 'betrsichv', maximum),
      ).not.toBeNull()
    }
  })

  it('has doors and gates, ladders and shelving checked about once a year, by the guide of a rule', () => {
    expect(proposed('powered_door')).toEqual(['powered_door_check'])
    expect(proposed('ladder')).toEqual(['ladder_check'])
    expect(proposed('shelving')).toEqual(['shelving_check'])
    expect(interval('powered_door_check')).toBe('guide 1 years')
    expect(interval('ladder_check')).toBe('guide 1 years')
    expect(interval('shelving_check')).toBe('guide 1 years')

    for (const key of ['powered_door_check', 'ladder_check', 'shelving_check']) {
      expect(equipment.dutyKind(`arbeitsmittel.${key}`, today)?.definition).toMatchObject({
        origin: 'insurer_and_committee_rules',
        bindingness: 'technical_rule',
        counting: 'from_due',
      })
    }
  })

  it('takes no interval from a private standard', () => {
    const rules = equipment
      .contents(today)
      .find((entry) => entry.name === 'arbeitsmittel')
      ?.rules.map((rule) => rule.record.origin)

    expect(rules).not.toContain('private_standard')
  })

  it('marks every entry until somebody with expertise has accepted it', () => {
    const contents = equipment.contents(today).find((entry) => entry.name === 'arbeitsmittel')

    expect(contents && acceptanceTally(contents)).toEqual({ accepted: 0, entries: 30 })
  })
})
