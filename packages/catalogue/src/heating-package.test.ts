import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type AssetValue,
  type Catalogue,
  catalogueOf,
  type IsoDate,
  proposedKinds,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Heizung as the repository holds it under pakete/, read the way
// the build reads it (opengewerk-haustechnik#352, sections 5 and 8 of the
// concept). What is expected below is checked against the official texts as
// they stood on 18 October 2026: § 60 and § 60a of the Gebäudeenergiegesetz,
// since 29 July 2026 Gebäudemodernisierungsgesetz, and § 60a as Art. 2 of the
// law of 23 July 2026 (BGBl. 2026 I Nr. 226) has it from 1 January 2027; § 15
// of the 1. BImSchV; § 1 and § 14 SchfHwG; § 46 AwSV with Anlage 5 and 6;
// § 13 NDAV. Whoever changes one in the package changes it here, against the
// same text.
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

const heating = catalogue()

/** The duty kinds the catalogue proposes for an asset of a kind of the package, on a day, with their package. */
function proposed(
  kind: string,
  values: Readonly<Record<string, AssetValue>>,
  on: IsoDate = '2026-10-18',
): readonly string[] {
  return proposedKinds(
    heating,
    { assetKind: `heizung.${kind}`, values, buildingKinds: ['office'], federalState: 'DE-BW' },
    on,
    new Set(),
  ).map((entry) => entry.key)
}

/** The interval a duty kind names on a day, as value and unit. */
function interval(key: string, on: IsoDate): string | null {
  const kind = heating.dutyKind(key, on)
  const rule = kind ? heating.interval(kind.definition, on) : null

  return rule === null ? null : `${String(rule.record.value)} ${rule.record.unit}`
}

/** A heat pump the check binds: heating over water, six units, from 2024, nothing that spares it, and no F-gas to check. */
const bound = {
  heat_pump_type: 'water',
  six_or_more_units: true,
  commissioned_after_2023: true,
  remote_monitoring: false,
  maintenance_contract: false,
  charge_co2e: 0,
  charge_unsaturated: 0,
  hermetically_sealed: false,
  leak_detection: false,
}
/** A boiler with all its characteristics, so that only the ones a test sets decide. */
const boiler = {
  fuel: 'oil',
  rated_heat_output: 20,
  condensing: false,
  older_than_twelve_years: false,
  self_calibrating: false,
}

describe('the package Heizung', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(heating.packages.find((entry) => entry.name === 'heizung')?.title).toBe('Heizung')
  })

  /** Acceptance of #352: for a check in 2027 the rule of 2027 applies. */
  it('has a heat pump checked every five years, by the version of 2027 from its first day', () => {
    const check = (on: IsoDate, values: object = {}) =>
      proposed('heat_pump', { ...bound, ...values }, on).filter((key) =>
        key.endsWith('heat_pump_check'),
      )

    expect(check('2026-12-31')).toEqual(['heizung.heat_pump_check'])
    expect(heating.dutyKind('heizung.heat_pump_check', '2026-12-31')?.version).toBe(1)
    expect(heating.dutyKind('heizung.heat_pump_check', '2027-01-01')?.version).toBe(2)
    expect(heating.rule('heizung.heat_pump_check_interval', '2027-01-01')?.record.source).toBe(
      '§ 60a Abs. 1 Satz 3 GModG',
    )
    expect([
      interval('heizung.heat_pump_check', '2026-12-31'),
      interval('heizung.heat_pump_check', '2027-01-01'),
    ]).toEqual(['5 years', '5 years'])
    // From 2027 a contract of maintenance spares it, and an air-to-air heat pump is checked as well.
    expect(check('2026-12-31', { maintenance_contract: true })).toEqual(['heizung.heat_pump_check'])
    expect(check('2027-01-01', { maintenance_contract: true })).toEqual([])
    expect(check('2026-12-31', { heat_pump_type: 'air_to_air' })).toEqual([])
    expect(check('2027-01-01', { heat_pump_type: 'air_to_air' })).toEqual([
      'heizung.heat_pump_check',
    ])
    // Not with remote monitoring, not below six units, not before 2024, and never one for hot water alone.
    expect(check('2026-10-18', { remote_monitoring: true })).toEqual([])
    expect(check('2026-10-18', { six_or_more_units: false })).toEqual([])
    expect(check('2026-10-18', { commissioned_after_2023: false })).toEqual([])
    expect(check('2027-01-01', { heat_pump_type: 'hot_water_only' })).toEqual([])
  })

  it('keeps the record of a heat pump check ten years', () => {
    const kind = heating.dutyKind('heizung.heat_pump_check', '2026-10-18')
    const retention = kind ? heating.retention(kind.definition, '2026-10-18') : null

    expect(retention?.kind === 'years' ? retention.rule.record.value : null).toBe(10)
  })

  it('checks a heat pump for leaks with the leak checks of the package Raumluft und Kälte', () => {
    expect(
      proposed('heat_pump', { ...bound, remote_monitoring: true, charge_co2e: 8000 }).filter(
        (key) => key.startsWith('raumluft.'),
      ),
    ).toEqual(['raumluft.leak_check_annex1_band_a'])
    expect(heating.dutyKind('raumluft.leak_check_annex1_band_a', '2026-10-18')?.version).toBe(2)
  })

  it('has a boiler for oil or gas measured every third, second or fifth calendar year, and a condensing gas boiler not', () => {
    const measured = (values: object) =>
      proposed('boiler', { ...boiler, ...values })
        .filter((key) => key.includes('flue_gas_measurement'))
        .map((key) => [key.replace('heizung.', ''), interval(key, '2026-10-18')])

    expect(measured({})).toEqual([['flue_gas_measurement_oil', '3 years']])
    expect(measured({ older_than_twelve_years: true })).toEqual([
      ['flue_gas_measurement_oil_older', '2 years'],
    ])
    expect(measured({ self_calibrating: true })).toEqual([
      ['flue_gas_measurement_oil_self_calibrating', '5 years'],
    ])
    expect(measured({ fuel: 'gas' })).toEqual([['flue_gas_measurement_gas', '3 years']])
    expect(measured({ fuel: 'gas', condensing: true })).toEqual([])
    expect(measured({ fuel: 'oil', condensing: true })).toEqual([
      ['flue_gas_measurement_oil', '3 years'],
    ])
    expect(measured({ rated_heat_output: 3 })).toEqual([])
    expect(measured({ fuel: 'solid' })).toEqual([['flue_gas_measurement_solid', '2 years']])
  })

  it('has a flue swept by the dates of its notice, and its fireplaces inspected about every five years', () => {
    expect(proposed('flue_system', {})).toEqual([
      'heizung.chimney_sweeping',
      'heizung.fireplace_inspection',
    ])
    expect(heating.dutyKind('heizung.chimney_sweeping', '2026-10-18')?.definition.interval).toEqual(
      {
        kind: 'none',
      },
    )
    expect(
      heating.dutyKind('heizung.fireplace_inspection', '2026-10-18')?.definition.interval.kind,
    ).toBe('guide')
    expect(interval('heizung.fireplace_inspection', '2026-10-18')).toBe('5 years')
  })

  it('has heating oil stored by its hazard level, above or under ground and in a protected area inspected by experts', () => {
    const inspected = (values: object) =>
      proposed('oil_storage', {
        hazard_level: 'b',
        underground: false,
        protection_area: false,
        ...values,
      })
        .filter((key) => key.includes('oil_storage_inspection'))
        .map((key) => [key.replace('heizung.', ''), interval(key, '2026-10-18')])

    expect(inspected({})).toEqual([])
    expect(inspected({ hazard_level: 'c' })).toEqual([['oil_storage_inspection', '5 years']])
    expect(inspected({ protection_area: true })).toEqual([
      ['oil_storage_inspection_protected', '5 years'],
    ])
    expect(inspected({ hazard_level: 'a', protection_area: true })).toEqual([])
    expect(inspected({ hazard_level: 'a', underground: true })).toEqual([
      ['oil_storage_inspection_underground', '5 years'],
    ])
    expect(inspected({ hazard_level: 'a', underground: true, protection_area: true })).toEqual([
      ['oil_storage_inspection_underground_protected', '30 months'],
    ])
    expect(
      heating.dutyKind('heizung.oil_storage_inspection', '2026-10-18')?.definition.qualification
        .level,
    ).toBe('certified_expert')
  })

  it('has a boiler in a building of six units checked and optimised once, by 30.09.2027 or within a year after 15 years (#439)', () => {
    const checks = (values: object) =>
      proposed('boiler', { ...boiler, ...values }).filter((key) => key.includes('heating_check'))
    const six = { six_or_more_units: true, building_automation: false }

    expect(checks({ ...six, installed_before_october_2009: true })).toEqual([
      'heizung.heating_check_before_2009',
    ])
    expect(checks({ ...six, installed_before_october_2009: false })).toEqual([
      'heizung.heating_check',
    ])
    expect(
      checks({ ...six, six_or_more_units: false, installed_before_october_2009: true }),
    ).toEqual([])
    expect(
      checks({ ...six, building_automation: true, installed_before_october_2009: true }),
    ).toEqual([])

    const before = heating.dutyKind('heizung.heating_check_before_2009', '2026-10-18')
    const after = heating.dutyKind('heizung.heating_check', '2026-10-18')

    expect(before && heating.onceDue(before, null)).toBe('2027-09-30')
    // Installed on 01.03.2012, before the duty came: within a year after 15 years, with its own rule.
    expect(after && heating.onceDue(after, '2012-03-01')).toBe('2028-03-01')
    expect([before?.definition.source, after?.definition.source]).toEqual([
      '§ 60b Abs. 1 Satz 2 GModG',
      '§ 60b Abs. 1 Satz 1 GModG',
    ])
    expect([before?.definition.counting, after?.definition.qualification.level]).toEqual([
      'once',
      'skilled_person',
    ])
  })

  it('has a boiler built or changed since 22.03.2010 measured once within four weeks after its commissioning (#439)', () => {
    const first = (values: object) =>
      proposed('boiler', { ...boiler, ...values }).filter((key) =>
        key.includes('first_measurement'),
      )

    expect(first({ built_since_march_2010: true })).toEqual(['heizung.flue_gas_first_measurement'])
    expect(first({ built_since_march_2010: false })).toEqual([])

    const kind = heating.dutyKind('heizung.flue_gas_first_measurement', '2026-10-18')

    expect(kind && heating.onceDue(kind, '2026-11-02')).toBe('2026-11-30')
    expect(kind?.definition.source).toBe('§ 14 Abs. 2 und 3 der 1. BImSchV')
  })

  it('has heating oil stored since 1994 that the state did not have inspected before 2017 inspected once by 01.08.2027 (#439)', () => {
    const stored = {
      hazard_level: 'c',
      underground: false,
      protection_area: false,
      first_inspection_by_august_2027: true,
    }

    expect(proposed('oil_storage', stored)).toContain('heizung.oil_storage_first_inspection')
    expect(
      proposed('oil_storage', { ...stored, first_inspection_by_august_2027: false }),
    ).not.toContain('heizung.oil_storage_first_inspection')

    const kind = heating.dutyKind('heizung.oil_storage_first_inspection', '2026-10-18')

    expect(kind && heating.onceDue(kind, null)).toBe('2027-08-01')
    expect([kind?.definition.source, kind?.definition.qualification.level]).toEqual([
      '§ 70 Abs. 2 Nr. 5 AwSV',
      'certified_expert',
    ])
  })

  it('keeps a gas installation by the NDAV, and names the TRGI without an interval', () => {
    const duties = proposed('gas_installation', {}).map((key) => {
      const definition = heating.dutyKind(key, '2026-10-18')?.definition

      return [key.replace('heizung.', ''), definition?.origin, definition?.interval.kind]
    })

    expect(duties).toEqual([
      ['gas_installation_maintenance', 'state_law', 'none'],
      ['gas_installation_serviceability_test', 'private_standard', 'none'],
      ['gas_installation_visual_check', 'private_standard', 'none'],
    ])
  })

  it('asks for the kind of qualification its source names, and for none where the source names none (#547)', () => {
    const asked = [
      'chimney_sweeping',
      'fireplace_inspection',
      'flue_gas_first_measurement',
      'flue_gas_measurement_gas',
      'flue_gas_measurement_gas_older',
      'flue_gas_measurement_gas_self_calibrating',
      'flue_gas_measurement_oil',
      'flue_gas_measurement_oil_older',
      'flue_gas_measurement_oil_self_calibrating',
      'flue_gas_measurement_solid',
      'gas_installation_maintenance',
      'gas_installation_serviceability_test',
      'gas_installation_visual_check',
      'heat_pump_check',
      'heating_check',
      'heating_check_before_2009',
      'heating_maintenance',
      'oil_storage_self_check',
    ].map((key) => [key, heating.qualificationFor(`heizung.${key}`)?.qualification.key ?? null])

    expect(asked).toEqual([
      ['chimney_sweeping', 'heizung.chimney_sweep'],
      ['fireplace_inspection', 'heizung.district_chimney_sweep'],
      ['flue_gas_first_measurement', 'heizung.chimney_sweep'],
      ['flue_gas_measurement_gas', 'heizung.chimney_sweep'],
      ['flue_gas_measurement_gas_older', 'heizung.chimney_sweep'],
      ['flue_gas_measurement_gas_self_calibrating', 'heizung.chimney_sweep'],
      ['flue_gas_measurement_oil', 'heizung.chimney_sweep'],
      ['flue_gas_measurement_oil_older', 'heizung.chimney_sweep'],
      ['flue_gas_measurement_oil_self_calibrating', 'heizung.chimney_sweep'],
      ['flue_gas_measurement_solid', 'heizung.chimney_sweep'],
      ['gas_installation_maintenance', 'heizung.registered_gas_installer'],
      ['gas_installation_serviceability_test', 'heizung.registered_gas_installer'],
      // The operator or somebody the operator instructed.
      ['gas_installation_visual_check', null],
      ['heat_pump_check', 'heizung.heat_pump_inspector'],
      ['heating_check', 'heizung.heating_inspector'],
      ['heating_check_before_2009', 'heizung.heating_inspector'],
      // Whoever has the knowledge and skills it needs, § 60 Abs. 2.
      ['heating_maintenance', null],
      ['oil_storage_self_check', null],
    ])
    // A district chimney sweep is a chimney sweep.
    expect(
      heating.coveredBy('heizung.chimney_sweep').map((kind) => kind.qualification.key),
    ).toEqual(['heizung.district_chimney_sweep'])
  })
})
