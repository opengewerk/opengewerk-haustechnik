import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type Catalogue,
  type CatalogueEntry,
  catalogueOf,
  type DutyKind,
  type FormField,
  forms,
  type MeasurementField,
  type ScopeCondition,
  type TemplateField,
  templateProblems,
  type TemplateRecords,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Trinkwasser as the repository holds it under pakete/, read the
// way the build reads it (opengewerk-haustechnik#93, sections 5 and 8 of the
// concept). What is expected below is checked against the Trinkwasserverordnung
// of 20 June 2023 on gesetze-im-internet.de: § 31 for whom the sampling binds
// and how often, § 44 Abs. 3 for the ten years, § 51 Abs. 1 with Anlage 3
// Teil II for the action value. Whoever changes one in the package changes it
// here, against the same text.
const shipped = readPackageFiles(fileURLToPath(new URL('../../../pakete/', import.meta.url)))

// With the version of the application and the day in Germany the build takes,
// as in the test of the package Elektro.
const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const options = {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
}

function drinkingWater(): Catalogue {
  const { bundle, problems } = loadCatalogue(shipped, options)

  if (!bundle) {
    throw new Error(`Die Pakete laden nicht: ${problems.join(' ')}`)
  }

  return catalogueOf(bundle)
}

type Characteristics = Readonly<Record<string, string | boolean>>

// Whether a condition of a scope holds for the characteristics of an asset.
// Only the comparisons this package uses.
function holds(condition: ScopeCondition, characteristics: Characteristics): boolean {
  const value = characteristics[condition.characteristic]

  if ('is' in condition) {
    return value === condition.is
  }

  if ('oneOf' in condition) {
    return typeof value === 'string' && condition.oneOf.includes(value)
  }

  throw new Error(`Das Paket vergleicht ${condition.characteristic} anders als erwartet.`)
}

// The duty kinds of the package that come into question for an asset of a
// kind with these characteristics.
function proposed(
  catalogue: Catalogue,
  assetKind: string,
  characteristics: Characteristics,
): readonly CatalogueEntry<DutyKind>[] {
  return catalogue
    .dutyKinds(options.today)
    .filter(
      ({ key, definition }) =>
        key.startsWith('trinkwasser.') &&
        definition.scope.assetKinds.includes(`trinkwasser.${assetKind}`) &&
        definition.scope.conditions.every((condition) => holds(condition, characteristics)),
    )
}

// The duty kinds proposed for an installation, each with its interval in words of value and unit.
function sampling(characteristics: Characteristics): readonly (readonly [string, string])[] {
  const catalogue = drinkingWater()

  return proposed(catalogue, 'drinking_water_installation', characteristics)
    .filter((entry) => entry.key.includes('legionella_sampling'))
    .map((entry) => {
      const rule = catalogue.interval(entry.definition, options.today)

      return [entry.key, rule === null ? 'none' : `${rule.record.value} ${rule.record.unit}`]
    })
}

// An installation the sampling binds, given out to the public.
const bound = {
  large_water_heating: true,
  aerosol_outlets: true,
  one_or_two_family_house: false,
  supply: 'public',
}

function fieldsOf(fields: readonly FormField[]): readonly FormField[] {
  return fields.flatMap((field) => (field.kind === 'group' ? fieldsOf(field.fields) : [field]))
}

describe('the package Trinkwasser', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(drinkingWater().packages.find((entry) => entry.name === 'trinkwasser')?.title).toBe(
      'Trinkwasser',
    )
  })

  it('has Legionella sampled every year where the water is given out to the public, every three years where only commercially', () => {
    expect(sampling(bound)).toEqual([['trinkwasser.legionella_sampling_public', '1 years']])
    expect(sampling({ ...bound, supply: 'commercial' })).toEqual([
      ['trinkwasser.legionella_sampling_commercial', '3 years'],
    ])
    expect(sampling({ ...bound, supply: 'none' })).toEqual([])
  })

  it('asks for no sampling without large water heating, without showers or in a house for one or two families', () => {
    expect(sampling({ ...bound, large_water_heating: false })).toEqual([])
    expect(sampling({ ...bound, aerosol_outlets: false })).toEqual([])
    expect(sampling({ ...bound, one_or_two_family_house: true })).toEqual([])
    // An installation whose characteristics nobody has entered yet gets no proposal at all.
    expect(sampling({})).toEqual([])
  })

  it('has a new installation examined once, at the latest twelve months after its commissioning, whoever it is given out to (#439)', () => {
    const catalogue = drinkingWater()
    const first = (characteristics: Characteristics) =>
      proposed(catalogue, 'drinking_water_installation', characteristics)
        .map((entry) => entry.key)
        .filter((key) => key.includes('first_examination'))

    expect(first(bound)).toEqual(['trinkwasser.legionella_first_examination'])
    expect(first({ ...bound, supply: 'commercial' })).toEqual([
      'trinkwasser.legionella_first_examination',
    ])
    expect(first({ ...bound, supply: 'none' })).toEqual([])
    expect(first({ ...bound, one_or_two_family_house: true })).toEqual([])

    const kind = catalogue.dutyKind('trinkwasser.legionella_first_examination', options.today)

    expect(kind && catalogue.onceDue(kind, '2026-11-02')).toBe('2027-11-02')
    expect(kind?.definition.source).toBe('§ 31 Abs. 4 TrinkwV')
  })

  it('takes the sampling from an approved laboratory, with its findings as evidence kept for ten years', () => {
    const catalogue = drinkingWater()
    const duties = catalogue
      .dutyKinds(options.today)
      .filter((entry) => entry.key.startsWith('trinkwasser.legionella_sampling'))

    expect(duties).toHaveLength(2)

    for (const { key, definition } of duties) {
      const retention = catalogue.retention(definition, options.today)

      expect(
        [
          definition.origin,
          definition.task,
          definition.interval.kind,
          definition.qualification.level,
          definition.evidence.form,
        ],
        key,
      ).toEqual([
        'state_law',
        'sampling',
        'maximum',
        'accredited_laboratory',
        'trinkwasser.legionella_findings',
      ])
      expect(definition.source, key).toMatch(
        /^§ 31 Abs\. 1 und Abs\. 2 Nr\. 2 Buchst\. [ab] TrinkwV$/,
      )
      expect(
        retention?.kind === 'years'
          ? [retention.rule.record.value, retention.rule.record.source]
          : null,
        key,
      ).toEqual([10, '§ 44 Abs. 3 TrinkwV'])
    }
  })

  it('judges a finding that reaches the technical action value as outside, with the rule it was measured by', () => {
    const catalogue = drinkingWater()
    const form = catalogue.form('trinkwasser.legionella_findings', options.today)
    const legionella = fieldsOf(
      form?.definition.sections.flatMap((section) => section.fields) ?? [],
    ).find((field): field is MeasurementField => field.key === 'legionella')

    if (!legionella) {
      throw new Error('Das Formular hat kein Feld für Legionellen.')
    }

    const context = { rules: catalogue.ruleSet, on: options.today }

    expect(forms.limitVerdict(legionella, 99_000, context)).toEqual({
      within: true,
      limitMilli: 100_000,
      text: 'Innerhalb des Grenzwerts, unter 100 je 100 ml.',
      source: '§ 51 Abs. 1 TrinkwV mit Anlage 3 Teil II',
    })
    expect(forms.limitVerdict(legionella, 100_000, context)).toEqual({
      within: false,
      limitMilli: 100_000,
      text: 'Außerhalb des Grenzwerts, unter 100 je 100 ml.',
      source: '§ 51 Abs. 1 TrinkwV mit Anlage 3 Teil II',
    })
    // Before the Verordnung of 2023 the package holds no value, and says so.
    expect(
      forms.limitVerdict(legionella, 100_000, { ...context, on: '2023-06-23' }).within,
    ).toBeNull()
  })

  it('lends the technical action value to a template of its own with "unter", where 100 is outside (#299)', () => {
    const catalogue = drinkingWater()
    const point: TemplateField = {
      kind: 'measurement',
      key: 'legionella',
      label: 'Legionellen',
      unit: 'count_per_100_ml',
      decimals: 0,
      limit: { kind: 'below', rule: 'trinkwasser.legionella_technical_action_value' },
    }
    const records: TemplateRecords = {
      record: () => true,
      duty: () => null,
      ruleUnits: (key) => {
        const rule = catalogue.rule(key, options.today)

        return rule ? [rule.record.unit] : null
      },
      assetKind: () => true,
      dutyKind: () => null,
    }
    const context = { rules: catalogue.ruleSet, on: options.today }

    expect(
      templateProblems(
        {
          title: 'Eigene Probennahme',
          sections: [{ key: 'w', title: 'Warmwasser', fields: [point] }],
        },
        records,
      ),
    ).toEqual({})
    expect(forms.limitVerdict(point as MeasurementField, 99_000, context)).toMatchObject({
      within: true,
      text: 'Innerhalb des Grenzwerts, unter 100 je 100 ml.',
    })
    expect(forms.limitVerdict(point as MeasurementField, 100_000, context)).toMatchObject({
      within: false,
      text: 'Außerhalb des Grenzwerts, unter 100 je 100 ml.',
    })
  })

  it('brings three defect classes of its own, of which the last makes an asset unsafe', () => {
    expect(
      drinkingWater()
        .defectClasses('trinkwasser')
        .map(({ defectClass }) => [defectClass.key, defectClass.unsafe]),
    ).toEqual([
      ['trinkwasser.no_hygienic_impact', false],
      ['trinkwasser.hygienic_concern', false],
      ['trinkwasser.health_hazard', true],
    ])
  })
})
