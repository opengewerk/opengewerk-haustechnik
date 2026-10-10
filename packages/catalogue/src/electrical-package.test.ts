import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type Catalogue,
  type CatalogueEntry,
  catalogueOf,
  type DutyKind,
  type ScopeCondition,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package Elektro as the repository holds it under pakete/, read the way
// the build reads it (opengewerk-haustechnik#91, sections 5 and 8 of the
// concept). The intervals expected below are those of the instructions on
// § 5 of DGUV Vorschrift 3 (April 1997, reprint of January 2005) and of DGUV
// Vorschrift 4 (October 1999, edition of 2005), tables 1A and 1B: whoever
// changes one in the package changes it here, against the same text.
const shipped = readPackageFiles(fileURLToPath(new URL('../../../pakete/', import.meta.url)))

// With the version of the application and the day in Germany the build takes,
// as in the test of the package Allgemein.
const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const options = {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
}

function electrical(): Catalogue {
  const { bundle, problems } = loadCatalogue(shipped, options)

  if (!bundle) {
    throw new Error(`Die Pakete laden nicht: ${problems.join(' ')}`)
  }

  return catalogueOf(bundle)
}

type Rulebook = 'DGUV Vorschrift 3' | 'DGUV Vorschrift 4'

const rulebooks: readonly Rulebook[] = ['DGUV Vorschrift 3', 'DGUV Vorschrift 4']

// Whether a condition of a scope holds for the characteristics of an asset.
// Only the comparisons this package uses; the suggestions of the catalogue
// come with #102.
function holds(
  condition: ScopeCondition,
  characteristics: Readonly<Record<string, string | boolean>>,
): boolean {
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
// kind with these characteristics, under one rulebook.
function proposed(
  catalogue: Catalogue,
  assetKind: string,
  characteristics: Readonly<Record<string, string | boolean>>,
  rulebook: Rulebook,
): readonly CatalogueEntry<DutyKind>[] {
  return catalogue
    .dutyKinds(options.today)
    .filter(
      ({ key, definition }) =>
        key.startsWith('elektro.') &&
        definition.source.includes(rulebook) &&
        definition.scope.assetKinds.some((kind) => kind.endsWith(assetKind)) &&
        definition.scope.conditions.every((condition) => holds(condition, characteristics)),
    )
}

// The interval a duty kind proposes, in words of value and unit, or "none".
function interval(catalogue: Catalogue, entry: CatalogueEntry<DutyKind>): string {
  const rule = catalogue.interval(entry.definition, options.today)

  return rule === null ? 'none' : `${rule.record.value} ${rule.record.unit}`
}

describe('the package Elektro', () => {
  it('loads without a finding', () => {
    expect(loadCatalogue(shipped, options).problems).toEqual([])
    expect(electrical().packages.find((entry) => entry.name === 'elektro')?.title).toBe('Elektro')
  })

  it('names a source for every duty kind and takes every interval from the rulebook it cites', () => {
    const catalogue = electrical()
    const duties = catalogue
      .dutyKinds(options.today)
      .filter((entry) => entry.key.startsWith('elektro.'))

    expect(duties).toHaveLength(13)

    for (const { key, definition } of duties) {
      expect(definition.source, key).not.toBe('')
      // No private standard in this version: its references come once they
      // are checked against the text of the standard (README of the package).
      expect(definition.origin, key).not.toBe('private_standard')

      const rule = catalogue.interval(definition, options.today)
      const rulebook = rulebooks.find((name) => definition.source.includes(name))

      if (rule !== null) {
        expect(rulebook, key).toBeDefined()
        expect(rule.record.source, key).toContain(rulebook)
        expect(definition.interval.kind, key).toBe('guide')
      }
    }
  })

  it('proposes one test of portable equipment for every work area under each rulebook, with its guide value', () => {
    const catalogue = electrical()
    const areas = catalogue
      .assetKind('elektro.portable_equipment', options.today)
      ?.definition.characteristics.find((entry) => entry.key === 'work_area')
    const values = areas?.kind === 'choice' ? areas.options.map((option) => option.value) : []
    const expected: Readonly<Record<string, readonly [string, string]>> = {
      office: ['6 months', '24 months'],
      workshop: ['6 months', '12 months'],
      construction_site: ['3 months', '12 months'],
      bath: ['6 months', '6 months'],
      slaughterhouse: ['6 months', '6 months'],
      communal_kitchen: ['6 months', '6 months'],
      other_kitchen: ['6 months', '12 months'],
      fire_brigade: ['6 months', '12 months'],
      building_cleaning: ['6 months', '12 months'],
      laboratory: ['6 months', '12 months'],
      classroom: ['6 months', '12 months'],
      laundry: ['6 months', '12 months'],
      care: ['6 months', '24 months'],
      other: ['6 months', 'none'],
    }

    expect(values).toEqual(Object.keys(expected))

    for (const area of values) {
      const found = rulebooks.map((rulebook) =>
        proposed(catalogue, 'portable_equipment', { work_area: area }, rulebook),
      )

      expect(
        found.map((entries) => entries.length),
        area,
      ).toEqual([1, 1])
      expect(
        found.map(([entry]) => (entry ? interval(catalogue, entry) : 'nothing')),
        area,
      ).toEqual(expected[area])
    }

    // An asset whose work area nobody has entered yet gets no proposal at all.
    expect(
      rulebooks.flatMap((rulebook) => proposed(catalogue, 'portable_equipment', {}, rulebook)),
    ).toEqual([])
  })

  it('tests an installation every four years, in a room of a special kind every year by Vorschrift 3 alone', () => {
    const catalogue = electrical()

    for (const assetKind of ['low_voltage_installation', 'fixed_equipment']) {
      const ordinary = rulebooks.map((rulebook) =>
        proposed(catalogue, assetKind, { special_location: false }, rulebook).map((entry) =>
          interval(catalogue, entry),
        ),
      )
      const special = rulebooks.map((rulebook) =>
        proposed(catalogue, assetKind, { special_location: true }, rulebook).map((entry) =>
          interval(catalogue, entry),
        ),
      )

      expect(ordinary, assetKind).toEqual([['4 years'], ['4 years']])
      expect(special, assetKind).toEqual([['1 years'], ['4 years']])
    }
  })

  it('has whoever uses an installation press the test button of a residual current device every six months', () => {
    const catalogue = electrical()
    const found = rulebooks.map((rulebook) =>
      proposed(catalogue, 'residual_current_device', {}, rulebook),
    )

    expect(found.map((entries) => entries.map((entry) => interval(catalogue, entry)))).toEqual([
      ['6 months'],
      ['6 months'],
    ])
    expect(
      found.flat().map(({ definition }) => [definition.task, definition.evidence.form]),
    ).toEqual([
      ['function_check', 'elektro.rcd_test_button'],
      ['function_check', 'elektro.rcd_test_button'],
    ])
  })

  it('brings safety lighting and the emergency supply from the Arbeitsstättenverordnung without an interval', () => {
    const catalogue = electrical()

    expect(
      catalogue
        .dutyKinds(options.today)
        .filter((entry) => entry.definition.origin === 'state_law')
        .filter((entry) => entry.key.startsWith('elektro.'))
        .map(({ key, definition }) => [
          key,
          definition.source,
          definition.interval.kind,
          definition.scope.assetKinds,
        ]),
    ).toEqual([
      [
        'elektro.safety_lighting_check',
        '§ 4 Abs. 3 ArbStättV',
        'none',
        ['elektro.safety_lighting'],
      ],
      [
        'elektro.safety_power_supply_check',
        '§ 4 Abs. 3 ArbStättV',
        'none',
        ['elektro.safety_power_supply'],
      ],
    ])
  })

  it('brings three defect classes of its own, of which the last makes an asset unsafe', () => {
    expect(
      electrical()
        .defectClasses('elektro')
        .map(({ defectClass }) => [defectClass.key, defectClass.unsafe]),
    ).toEqual([
      ['elektro.no_immediate_danger', false],
      ['elektro.danger', false],
      ['elektro.immediate_danger', true],
    ])
  })
})
