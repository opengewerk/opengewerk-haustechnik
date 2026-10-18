import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type AssetValue,
  type Catalogue,
  catalogueOf,
  type FormField,
  forms,
  type IsoDate,
  type MeasurementField,
  proposedKinds,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Raumluft und Kälte as the repository holds it under pakete/, read
// the way the build reads it (opengewerk-haustechnik#351, sections 5 and 8 of
// the concept). What is expected below is checked against the official texts
// as they stood on 18 October 2026: § 4 Abs. 3 ArbStättV; §§ 74 to 78 of the
// Gebäudeenergiegesetz, since 29 July 2026 Gebäudemodernisierungsgesetz, and
// § 76 as Art. 2 of the law of 23 July 2026 (BGBl. 2026 I Nr. 226) has it from
// 1 January 2027; Art. 5 to 7 of Regulation (EU) 2024/573 on EUR-Lex; § 3, § 4,
// § 14 and Anlage 1 of the 42. BImSchV. Whoever changes one in the package
// changes it here, against the same text.
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

const air = catalogue()

/** The duty kinds of the package the catalogue proposes for an asset of a kind with these values, on a day. */
function proposed(
  kind: string,
  values: Readonly<Record<string, AssetValue>>,
  on: IsoDate = '2026-10-18',
): readonly string[] {
  return proposedKinds(
    air,
    { assetKind: `raumluft.${kind}`, values, buildingKinds: ['office'], federalState: 'DE-BW' },
    on,
    new Set(),
  )
    .map((entry) => entry.key.replace('raumluft.', ''))
    .filter((key) => key !== 'ventilation_maintenance' && key !== 'ventilation_hygiene_inspection')
}

/** The interval a duty kind of the package names on a day, as value and unit. */
function interval(key: string, on: IsoDate): string | null {
  const kind = air.dutyKind(`raumluft.${key}`, on)
  const rule = kind ? air.interval(kind.definition, on) : null

  return rule === null ? null : `${String(rule.record.value)} ${rule.record.unit}`
}

/** A refrigerating plant with nothing but gases of Annex I, without a seal and without detection. */
const plain = { charge_unsaturated: 0, hermetically_sealed: false, leak_detection: false }

function fieldsOf(fields: readonly FormField[]): readonly FormField[] {
  return fields.flatMap((field) => (field.kind === 'group' ? fieldsOf(field.fields) : [field]))
}

describe('the package Raumluft und Kälte', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(air.packages.find((entry) => entry.name === 'raumluft')?.title).toBe(
      'Raumluft und Kälte',
    )
  })

  /** Acceptance of #351: for an inspection in 2027 the rule of 2027 applies. */
  it('inspects an air conditioner above 70 kW every ten years until 2026 and every five years from 2027', () => {
    expect(interval('ac_energy_inspection_large', '2026-12-31')).toBe('10 years')
    expect(interval('ac_energy_inspection_large', '2027-01-01')).toBe('5 years')
    expect(interval('ac_energy_inspection_large', '2027-06-15')).toBe('5 years')
    // Up to 70 kW the ten years stay.
    expect(interval('ac_energy_inspection', '2027-06-15')).toBe('10 years')
    // The kind itself says so with a version of its own from that day.
    expect(air.dutyKind('raumluft.ac_energy_inspection_large', '2027-01-01')?.version).toBe(2)
    expect(
      air.dutyKind('raumluft.ac_energy_inspection_large', '2027-01-01')?.definition.source,
    ).toBe('§ 74 Abs. 1, § 75 Abs. 3 und 5, § 76 Abs. 1 Satz 2 und 3, Abs. 2 Satz 2 GModG')
  })

  it('inspects an air conditioner from more than 12 kW, and by its size', () => {
    const at = (kilowatts: number) =>
      proposed('air_conditioning_system', { ...plain, charge_co2e: 0, cooling_capacity: kilowatts })

    expect(at(12)).toEqual([])
    expect(at(13)).toEqual(['ac_energy_inspection'])
    expect(at(70)).toEqual(['ac_energy_inspection'])
    expect(at(71)).toEqual(['ac_energy_inspection_large'])
  })

  it('inspects a ventilation system above 70 kW from 2027 on, and none before', () => {
    expect(proposed('ventilation_system', { rated_output: 100 }, '2026-12-31')).toEqual([])
    expect(proposed('ventilation_system', { rated_output: 100 }, '2027-01-01')).toEqual([
      'ventilation_energy_inspection',
    ])
    expect(proposed('ventilation_system', { rated_output: 70 }, '2027-01-01')).toEqual([])
    expect(interval('ventilation_energy_inspection', '2027-01-01')).toBe('5 years')
  })

  it('checks a plant for leaks by its charge in CO2 equivalent, every 12, 6 or 3 months', () => {
    const at = (kilograms: number, more: object = {}) =>
      proposed('refrigeration_system', { ...plain, charge_co2e: kilograms, ...more })

    expect(at(4999)).toEqual([])
    expect(at(5000)).toEqual(['leak_check_annex1_band_a'])
    expect(at(49_999)).toEqual(['leak_check_annex1_band_a'])
    expect(at(50_000)).toEqual(['leak_check_annex1_band_b'])
    expect(at(500_000)).toEqual(['leak_check_annex1_band_c'])
    expect(
      ['band_a', 'band_b', 'band_c'].map((band) =>
        interval(`leak_check_annex1_${band}`, '2026-10-18'),
      ),
    ).toEqual(['12 months', '6 months', '3 months'])
  })

  it('doubles the interval with a leak detection system, and has the system itself checked every year', () => {
    expect(
      proposed('refrigeration_system', { ...plain, charge_co2e: 600_000, leak_detection: true }),
    ).toEqual(['leak_check_annex1_band_c_detection', 'leak_detection_system_check'])
    expect(
      ['band_a', 'band_b', 'band_c'].map((band) =>
        interval(`leak_check_annex1_${band}_detection`, '2026-10-18'),
      ),
    ).toEqual(['24 months', '12 months', '6 months'])
    expect(interval('leak_detection_system_check', '2026-10-18')).toBe('12 months')
  })

  it('spares a hermetically sealed plant below 10 tonnes or below 2 kilograms', () => {
    const sealed = { ...plain, hermetically_sealed: true }

    expect(
      proposed('air_conditioning_system', { ...sealed, cooling_capacity: 5, charge_co2e: 9999 }),
    ).toEqual([])
    expect(
      proposed('air_conditioning_system', { ...sealed, cooling_capacity: 5, charge_co2e: 10_000 }),
    ).toEqual(['leak_check_annex1_band_a_sealed'])
    expect(
      proposed('refrigeration_system', { ...sealed, charge_co2e: 0, charge_unsaturated: 1 }),
    ).toEqual([])
    expect(
      proposed('refrigeration_system', { ...sealed, charge_co2e: 0, charge_unsaturated: 2 }),
    ).toEqual(['leak_check_annex2_band_a_sealed'])
  })

  it('checks unsaturated refrigerants for leaks by their mass, from 1, 10 and 100 kilograms', () => {
    const at = (kilograms: number) =>
      proposed('refrigeration_system', { ...plain, charge_co2e: 0, charge_unsaturated: kilograms })

    expect([at(0), at(1), at(10), at(100)]).toEqual([
      [],
      ['leak_check_annex2_band_a'],
      ['leak_check_annex2_band_b'],
      ['leak_check_annex2_band_c'],
    ])
  })

  it('has every leak check done by a certified person, with its records kept five years', () => {
    const leakChecks = air
      .dutyKinds(options.today)
      .filter((entry) => entry.key.startsWith('raumluft.leak_check_'))
    expect(leakChecks).toHaveLength(16)

    for (const { key, definition } of leakChecks) {
      const retention = air.retention(definition, options.today)

      expect([definition.task, definition.evidence.form, definition.source], key).toEqual([
        'inspection',
        'raumluft.leak_check',
        expect.stringMatching(/^Art\. 5 Abs\. 1 und Abs\. 6 Buchst\. [abc] VO \(EU\) 2024\/573$/u),
      ])
      expect(
        retention?.kind === 'years'
          ? [retention.rule.record.value, retention.rule.record.source]
          : null,
        key,
      ).toEqual([5, 'Art. 7 Abs. 2 VO (EU) 2024/573'])
      expect(air.qualificationFor(key)?.qualification.key, key).toBe(
        'raumluft.fgas_certified_person',
      )
    }
  })

  it('has an evaporative cooling system checked inside every two weeks, by a laboratory every three months and by an expert every five years', () => {
    expect(proposed('evaporative_cooling_system', {})).toEqual([
      'cooling_expert_inspection',
      'cooling_water_first_lab_test',
      'cooling_water_internal_check',
      'cooling_water_lab_test',
    ])
    expect(
      ['cooling_water_internal_check', 'cooling_water_lab_test', 'cooling_expert_inspection'].map(
        (key) => [
          interval(key, '2026-10-18'),
          air.dutyKind(`raumluft.${key}`, '2026-10-18')?.definition.qualification.level,
        ],
      ),
    ).toEqual([
      ['14 days', 'instructed_person'],
      ['3 months', 'accredited_laboratory'],
      ['5 years', 'certified_expert'],
    ])
  })

  it('has the water of an evaporative cooling system tested once within four weeks after its commissioning (#439)', () => {
    const kind = air.dutyKind('raumluft.cooling_water_first_lab_test', '2026-10-18')

    expect(kind && air.onceDue(kind, '2026-11-02')).toBe('2026-11-30')
    expect([
      kind?.definition.counting,
      kind?.definition.source,
      kind?.definition.qualification.level,
    ]).toEqual(['once', '§ 3 Abs. 7 Satz 1 der 42. BImSchV', 'accredited_laboratory'])
  })

  it('judges a Legionella count above the test value 1 as outside, and the value itself as inside', () => {
    const form = air.form('raumluft.cooling_water_findings', options.today)
    const legionella = fieldsOf(
      form?.definition.sections.flatMap((section) => section.fields) ?? [],
    ).find((field): field is MeasurementField => field.key === 'legionella')

    if (!legionella) {
      throw new Error('Das Formular hat kein Feld für Legionellen.')
    }

    const context = { rules: air.ruleSet, on: options.today }

    expect(forms.limitVerdict(legionella, 100_000, context)).toMatchObject({
      within: true,
      limitMilli: 100_000,
      source: 'Anlage 1 der 42. BImSchV, Prüfwert 1 für Verdunstungskühlanlagen',
    })
    expect(forms.limitVerdict(legionella, 101_000, context).within).toBe(false)
  })
})
