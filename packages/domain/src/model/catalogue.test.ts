import { describe, expect, it } from 'vitest'

import {
  acceptanceTally,
  type AssetKind,
  type CatalogueBundle,
  type CatalogueDefectClass,
  type CatalogueEntry,
  type CatalogueReview,
  type CatalogueRule,
  catalogueFormat,
  catalogueOf,
  type DutyKind,
  dutyKindsNaming,
  intervalLine,
  type PackagedForm,
  reviewMarks,
  ruleUnitEntry,
  ruleValueWords,
  scopeWords,
} from './catalogue.js'

const unaccepted: CatalogueReview = { checkedOn: '2026-10-03', accepted: null }
const accepted: CatalogueReview = {
  checkedOn: '2026-10-03',
  accepted: { by: 'Eine Fachkraft', on: '2026-10-04' },
}

const elevator: AssetKind = {
  label: 'Aufzugsanlage',
  costGroup: '461',
  characteristics: [],
  fields: [],
  expectedDocuments: [],
  meter: null,
}

const mainTest: DutyKind = {
  label: 'Hauptprüfung der Aufzugsanlage',
  description: 'Die Aufzugsanlage wird wiederkehrend geprüft.',
  task: 'inspection',
  origin: 'state_law',
  bindingness: 'statute',
  source: 'Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV',
  interval: { kind: 'maximum', rule: 'probe.elevator_main_test_interval' },
  counting: 'betrsichv',
  qualification: { level: 'approved_body' },
  evidence: { kinds: ['report'] },
  retention: { kind: 'while_in_use' },
  scope: { assetKinds: ['probe.elevator'], conditions: [], buildingKinds: [], states: [] },
}

function entry<Definition>(
  key: string,
  version: number,
  validFrom: string,
  definition: Definition,
  review: CatalogueReview = unaccepted,
): CatalogueEntry<Definition> {
  return { key, version, validFrom, definition, review }
}

function rule(
  key: string,
  validFrom: string,
  validUntil: string | null,
  value: number,
  more: Partial<CatalogueRule['record']> = {},
  review: CatalogueReview = unaccepted,
): CatalogueRule {
  return {
    record: {
      key,
      validFrom,
      validUntil,
      unit: 'months',
      value,
      source: 'Anhang 2 Abschnitt 2 Nr. 4.1 Satz 4 BetrSichV',
      origin: 'state_law',
      ...more,
    },
    review,
  }
}

function defectClass(
  key: string,
  label: string,
  unsafe: boolean,
  review: CatalogueReview = unaccepted,
): CatalogueDefectClass {
  return { defectClass: { key, label, unsafe, source: null }, review }
}

function bundle(content: Partial<CatalogueBundle['packages'][number]> = {}): CatalogueBundle {
  return {
    format: catalogueFormat,
    sha256: 'a'.repeat(64),
    packages: [
      {
        name: 'probe',
        title: 'Probepaket',
        version: '1.0.0',
        minimumCore: '0.0.0',
        assetKinds: [entry('probe.elevator', 1, '2015-06-01', elevator)],
        dutyKinds: [entry('probe.elevator_main_test', 1, '2015-06-01', mainTest)],
        forms: [],
        roundTemplates: [],
        rules: [rule('probe.elevator_main_test_interval', '2015-06-01', null, 24)],
        defectClasses: [],
        ...content,
      },
    ],
  }
}

describe('the catalogue', () => {
  it('has no answer for a day before a rule begins', () => {
    const catalogue = catalogueOf(bundle())

    expect(catalogue.rule('probe.elevator_main_test_interval', '2015-05-31')).toBeNull()
    expect(catalogue.rule('probe.elevator_main_test_interval', '2015-06-01')?.record.value).toBe(24)
    expect(catalogue.interval(mainTest, '2015-05-31')).toBeNull()
    expect(catalogue.interval(mainTest, '2026-10-03')?.record.value).toBe(24)
  })

  it('answers with the record in force on the day, and none after the last one ended', () => {
    const catalogue = catalogueOf(
      bundle({
        rules: [
          rule('probe.elevator_main_test_interval', '2015-06-01', '2026-12-31', 24),
          rule('probe.elevator_main_test_interval', '2027-01-01', '2027-12-31', 12),
        ],
      }),
    )

    expect(catalogue.interval(mainTest, '2026-12-31')?.record.value).toBe(24)
    expect(catalogue.interval(mainTest, '2027-01-01')?.record.value).toBe(12)
    expect(catalogue.interval(mainTest, '2028-01-01')).toBeNull()
  })

  it('answers for a state with its own rule or one of the whole country, and never with another state', () => {
    const catalogue = catalogueOf(
      bundle({
        rules: [
          rule('probe.elevator_main_test_interval', '2015-06-01', null, 24),
          rule('probe.special_building_interval', '2010-01-01', null, 36, { scope: 'DE-BW' }),
        ],
      }),
    )

    expect(
      catalogue.rule('probe.special_building_interval', '2026-10-03', 'DE-BW')?.record.value,
    ).toBe(36)
    expect(catalogue.rule('probe.special_building_interval', '2026-10-03', 'DE-BY')).toBeNull()
    expect(catalogue.rule('probe.special_building_interval', '2026-10-03')).toBeNull()
    expect(
      catalogue.rule('probe.elevator_main_test_interval', '2026-10-03', 'DE-BY')?.record.value,
    ).toBe(24)
  })

  it('names no rule for an interval without a value', () => {
    const catalogue = catalogueOf(bundle())

    expect(catalogue.interval({ ...mainTest, interval: { kind: 'none' } }, '2026-10-03')).toBeNull()
  })

  it('hands on the version of an entry in force on a day, and nothing before its first', () => {
    const corrected: DutyKind = {
      ...mainTest,
      label: 'Hauptprüfung der Aufzugsanlage (berichtigt)',
    }
    const later: DutyKind = { ...mainTest, label: 'Hauptprüfung nach der neuen Fassung' }
    const catalogue = catalogueOf(
      bundle({
        dutyKinds: [
          entry('probe.elevator_main_test', 1, '2015-06-01', mainTest),
          entry('probe.elevator_main_test', 2, '2015-06-01', corrected),
          entry('probe.elevator_main_test', 3, '2027-01-01', later),
        ],
      }),
    )

    expect(catalogue.dutyKind('probe.elevator_main_test', '2015-05-31')).toBeNull()
    // A correction from the same first day replaces the version it corrects on every day.
    expect(catalogue.dutyKind('probe.elevator_main_test', '2015-06-01')?.version).toBe(2)
    expect(catalogue.dutyKind('probe.elevator_main_test', '2026-12-31')?.version).toBe(2)
    expect(catalogue.dutyKind('probe.elevator_main_test', '2027-01-01')?.definition).toEqual(later)
    expect(catalogue.dutyKindVersion('probe.elevator_main_test', 1)?.definition).toEqual(mainTest)
    expect(catalogue.dutyKindVersion('probe.elevator_main_test', 4)).toBeNull()
    expect(catalogue.dutyKinds('2026-10-03').map((each) => each.version)).toEqual([2])
    expect(catalogue.dutyKinds('2015-05-31')).toEqual([])
  })

  it('knows the asset kinds of every package by the key outside their package', () => {
    const catalogue = catalogueOf(bundle())

    expect(catalogue.assetKind('probe.elevator', '2026-10-03')?.definition).toEqual(elevator)
    expect(catalogue.assetKind('elevator', '2026-10-03')).toBeNull()
    expect(catalogue.assetKinds('2026-10-03').map((each) => each.key)).toEqual(['probe.elevator'])
    expect(catalogue.packages).toEqual([{ name: 'probe', title: 'Probepaket', version: '1.0.0' }])
  })

  it('says how long the evidence is kept, with the rule for a number of years', () => {
    const kept: DutyKind = {
      ...mainTest,
      retention: { kind: 'years', rule: 'probe.record_retention' },
    }
    const catalogue = catalogueOf(
      bundle({
        rules: [
          rule('probe.elevator_main_test_interval', '2015-06-01', null, 24),
          rule('probe.record_retention', '2023-06-24', null, 10, { unit: 'years' }),
        ],
      }),
    )

    expect(catalogue.retention(mainTest, '2026-10-03')).toEqual({ kind: 'while_in_use' })
    expect(catalogue.retention(kept, '2026-10-03')).toMatchObject({
      kind: 'years',
      rule: { record: { value: 10, unit: 'years' } },
    })
    expect(catalogue.retention(kept, '2023-06-23')).toBeNull()
  })

  it('hands out no entry and no rule without its review', () => {
    const catalogue = catalogueOf(
      bundle({
        assetKinds: [entry('probe.elevator', 1, '2015-06-01', elevator, accepted)],
        rules: [rule('probe.elevator_main_test_interval', '2015-06-01', null, 24, {}, accepted)],
      }),
    )
    const read = [
      catalogue.assetKind('probe.elevator', '2026-10-03'),
      ...catalogue.assetKinds('2026-10-03'),
      catalogue.dutyKind('probe.elevator_main_test', '2026-10-03'),
      catalogue.dutyKindVersion('probe.elevator_main_test', 1),
      ...catalogue.dutyKinds('2026-10-03'),
      catalogue.rule('probe.elevator_main_test_interval', '2026-10-03'),
      catalogue.interval(mainTest, '2026-10-03'),
    ]

    expect(read.map((each) => each?.review)).toEqual([
      accepted,
      accepted,
      unaccepted,
      unaccepted,
      unaccepted,
      accepted,
      accepted,
    ])
    expect(reviewMarks(unaccepted, '2026-10-03').unaccepted).toBe(true)
    expect(reviewMarks(accepted, '2026-10-03').unaccepted).toBe(false)
  })

  it('marks an entry whose last check against the source lies more than a year back', () => {
    const checked = (checkedOn: string) => ({ checkedOn, accepted: null })

    expect(reviewMarks(checked('2025-10-03'), '2026-10-03').checkedLongAgo).toBe(false)
    expect(reviewMarks(checked('2025-10-02'), '2026-10-03').checkedLongAgo).toBe(true)
    // A year before the twenty ninth of February is the twenty eighth.
    expect(reviewMarks(checked('2027-02-28'), '2028-02-29').checkedLongAgo).toBe(false)
    expect(reviewMarks(checked('2027-02-27'), '2028-02-29').checkedLongAgo).toBe(true)
  })

  it('refuses a bundle in another format, and rules that are in force twice on one day', () => {
    // Format 1 had no counting at its duty kinds (#25).
    expect(() => catalogueOf({ ...bundle(), format: 1 as never })).toThrow(/Format 1/)
    // Format 2 had no defect classes at its packages (#61): a device that
    // kept such a bundle is told so, and fetches the one of its server.
    expect(() => catalogueOf({ ...bundle(), format: 2 as never })).toThrow(
      'Der Katalog hat das Format 2, gelesen wird 3.',
    )
    expect(() =>
      catalogueOf(
        bundle({
          rules: [
            rule('probe.elevator_main_test_interval', '2015-06-01', null, 24),
            rule('probe.elevator_main_test_interval', '2020-01-01', null, 12),
          ],
        }),
      ),
    ).toThrow(/gleichzeitig/)
  })
})

const reading: PackagedForm = { title: 'Ablesung des Wasserzählers', sections: [] }

describe('a package as a person reads it', () => {
  it('holds of every key the version in force on the day, each with its review', () => {
    const catalogue = catalogueOf(
      bundle({
        assetKinds: [
          entry('probe.elevator', 1, '2015-06-01', elevator, accepted),
          entry('probe.elevator', 2, '2027-01-01', { ...elevator, label: 'Aufzug' }),
        ],
        dutyKinds: [
          entry('probe.elevator_main_test', 1, '2015-06-01', mainTest),
          entry(
            'probe.elevator_main_test',
            2,
            '2027-01-01',
            { ...mainTest, label: 'Hauptprüfung' },
            accepted,
          ),
        ],
        forms: [
          entry('probe.reading', 1, '2020-01-01', reading),
          entry('probe.reading', 2, '2027-01-01', { ...reading, title: 'Ablesung' }, accepted),
        ],
        roundTemplates: [entry('probe.round', 1, '2030-01-01', reading)],
      }),
    )
    const [before] = catalogue.contents('2026-10-05')
    const [after] = catalogue.contents('2027-01-01')

    expect(before).toMatchObject({
      name: 'probe',
      title: 'Probepaket',
      version: '1.0.0',
      minimumCore: '0.0.0',
    })
    expect(before?.assetKinds.map((each) => [each.version, each.review])).toEqual([[1, accepted]])
    expect(before?.forms.map((each) => [each.version, each.review])).toEqual([[1, unaccepted]])
    expect(before?.dutyKinds.map((each) => [each.key, each.version, each.review])).toEqual([
      ['probe.elevator_main_test', 1, unaccepted],
    ])
    // A template that has not begun is no template of the day.
    expect(before?.roundTemplates).toEqual([])
    expect(after?.assetKinds.map((each) => [each.version, each.review])).toEqual([[2, unaccepted]])
    expect(after?.dutyKinds.map((each) => [each.version, each.review])).toEqual([[2, accepted]])
    expect(after?.forms.map((each) => [each.version, each.review])).toEqual([[2, accepted]])
  })

  it('holds of a package what that package brings and nothing of another', () => {
    const catalogue = catalogueOf({
      ...bundle(),
      packages: [
        ...bundle({ roundTemplates: [entry('probe.round', 1, '2020-01-01', reading)] }).packages,
        {
          name: 'second',
          title: 'Zweites Paket',
          version: '2.0.0',
          minimumCore: '0.0.0',
          assetKinds: [entry('second.boiler', 1, '2015-06-01', elevator)],
          dutyKinds: [],
          forms: [entry('second.reading', 1, '2020-01-01', reading)],
          roundTemplates: [],
          rules: [rule('second.limit', '2015-06-01', null, 12)],
          defectClasses: [],
        },
      ],
    })

    expect(
      catalogue.contents('2026-10-05').map((contents) => ({
        name: contents.name,
        assetKinds: contents.assetKinds.map((each) => each.key),
        dutyKinds: contents.dutyKinds.map((each) => each.key),
        forms: contents.forms.map((each) => each.key),
        roundTemplates: contents.roundTemplates.map((each) => each.key),
        rules: contents.rules.map((each) => each.record.key),
      })),
    ).toEqual([
      {
        name: 'probe',
        assetKinds: ['probe.elevator'],
        dutyKinds: ['probe.elevator_main_test'],
        forms: [],
        roundTemplates: ['probe.round'],
        rules: ['probe.elevator_main_test_interval'],
      },
      {
        name: 'second',
        assetKinds: ['second.boiler'],
        dutyKinds: [],
        forms: ['second.reading'],
        roundTemplates: [],
        rules: ['second.limit'],
      },
    ])
  })

  it('holds every record of its rules, by key, the country before a state, the earliest first', () => {
    const catalogue = catalogueOf(
      bundle({
        // A key applies in the whole country or state by state on a day, never both.
        rules: [
          rule('probe.special', '2010-01-01', null, 48, { scope: 'DE-BY' }),
          rule('probe.special', '2010-01-01', null, 36, { scope: 'DE-BW' }, accepted),
          rule('probe.elevator_main_test_interval', '2027-01-01', null, 12),
          rule('probe.special', '2000-01-01', '2009-12-31', 60),
          rule('probe.elevator_main_test_interval', '2015-06-01', '2026-12-31', 24),
        ],
      }),
    )
    const read = (rules: readonly CatalogueRule[]) =>
      rules.map(({ record, review }) => [
        record.key,
        record.scope ?? 'DE',
        record.validFrom,
        review.accepted !== null,
      ])

    // The record that has ended and the one to come are both there.
    expect(read(catalogue.contents('2026-10-05')[0]?.rules ?? [])).toEqual([
      ['probe.elevator_main_test_interval', 'DE', '2015-06-01', false],
      ['probe.elevator_main_test_interval', 'DE', '2027-01-01', false],
      ['probe.special', 'DE', '2000-01-01', false],
      ['probe.special', 'DE-BW', '2010-01-01', true],
      ['probe.special', 'DE-BY', '2010-01-01', false],
    ])
    expect(read(catalogue.ruleRecords('probe.special'))).toEqual([
      ['probe.special', 'DE', '2000-01-01', false],
      ['probe.special', 'DE-BW', '2010-01-01', true],
      ['probe.special', 'DE-BY', '2010-01-01', false],
    ])
    expect(catalogue.ruleRecords('probe.unknown')).toEqual([])
  })

  it('names the form a duty kind gives as its evidence, in the version of the day', () => {
    const catalogue = catalogueOf(
      bundle({
        forms: [
          entry('probe.reading', 1, '2020-01-01', reading),
          entry('probe.reading', 2, '2027-01-01', { ...reading, title: 'Ablesung' }),
        ],
      }),
    )

    expect(catalogue.form('probe.reading', '2019-12-31')).toBeNull()
    expect(catalogue.form('probe.reading', '2026-10-05')?.definition.title).toBe(
      'Ablesung des Wasserzählers',
    )
    expect(catalogue.form('probe.reading', '2027-01-01')?.definition.title).toBe('Ablesung')
    expect(catalogue.form('probe.round', '2027-01-01')).toBeNull()
  })

  it('names the defect classes of a package in the order of its file, and one by the key a defect keeps', () => {
    const made = bundle({
      defectClasses: [
        defectClass('probe.minor', 'gering', false),
        defectClass('probe.dangerous', 'gefährlich', true, accepted),
      ],
    })
    const catalogue = catalogueOf({
      ...made,
      packages: [
        ...made.packages,
        {
          name: 'second',
          title: 'Zweites Paket',
          version: '2.0.0',
          minimumCore: '0.0.0',
          assetKinds: [],
          dutyKinds: [],
          forms: [],
          roundTemplates: [],
          rules: [],
          defectClasses: [defectClass('second.minor', 'geringfügig', false)],
        },
      ],
    })

    // Not by key: the most severe class comes last because the file says so.
    expect(catalogue.defectClasses('probe').map((each) => each.defectClass.key)).toEqual([
      'probe.minor',
      'probe.dangerous',
    ])
    expect(catalogue.defectClasses('second').map((each) => each.defectClass.label)).toEqual([
      'geringfügig',
    ])
    expect(catalogue.defectClasses('third')).toEqual([])
    expect(catalogue.defectClass('probe.dangerous')).toEqual({
      defectClass: { key: 'probe.dangerous', label: 'gefährlich', unsafe: true, source: null },
      review: accepted,
    })
    // The same key in another package is another class, and a key nobody names is none.
    expect(catalogue.defectClass('second.minor')?.defectClass.label).toBe('geringfügig')
    expect(catalogue.defectClass('second.dangerous')).toBeNull()
    expect(
      catalogue.contents('2026-10-05').map((contents) => contents.defectClasses.length),
    ).toEqual([2, 1])
  })

  it('hands on the bundle it was made from, whole', () => {
    const made = bundle()

    expect(catalogueOf(made).bundle).toBe(made)
  })

  it('counts every entry of a package for its tally, an asset kind and a rule like a duty kind', () => {
    const tally = (content: Parameters<typeof bundle>[0]) => {
      const [contents] = catalogueOf(bundle(content)).contents('2026-10-05')

      return contents ? acceptanceTally(contents) : null
    }

    expect(tally({})).toEqual({ accepted: 0, entries: 3 })
    expect(
      tally({
        assetKinds: [entry('probe.elevator', 1, '2015-06-01', elevator, accepted)],
        dutyKinds: [entry('probe.elevator_main_test', 1, '2015-06-01', mainTest, accepted)],
        forms: [entry('probe.reading', 1, '2020-01-01', reading)],
        roundTemplates: [entry('probe.round', 1, '2020-01-01', reading, accepted)],
      }),
    ).toEqual({ accepted: 3, entries: 5 })
    // A defect class has a review like every other entry, and counts like one.
    expect(
      tally({
        defectClasses: [
          defectClass('probe.minor', 'gering', false, accepted),
          defectClass('probe.dangerous', 'gefährlich', true),
        ],
      }),
    ).toEqual({ accepted: 1, entries: 5 })
    // A duty kind accepted over a rule that is not is not a package accepted.
    expect(
      tally({
        assetKinds: [],
        dutyKinds: [entry('probe.elevator_main_test', 1, '2015-06-01', mainTest, accepted)],
      }),
    ).toEqual({ accepted: 1, entries: 2 })
    expect(tally({ assetKinds: [], dutyKinds: [], rules: [] })).toEqual({ accepted: 0, entries: 0 })
  })
})

describe('the words of a rule', () => {
  it('reads a value in its unit, one of a thing in the singular', () => {
    expect(ruleValueWords(24, 'months')).toBe('24 Monate')
    expect(ruleValueWords(1, 'months')).toBe('1 Monat')
    expect(ruleValueWords(1, 'years')).toBe('1 Jahr')
    expect(ruleValueWords(7, 'days')).toBe('7 Tage')
    expect(ruleValueWords(30, 'minutes')).toBe('30 Minuten')
    expect(ruleValueWords(0, 'flag')).toBe('nein')
    expect(ruleValueWords(1, 'flag')).toBe('ja')
  })

  it('writes the small steps of a unit as the decimal number a person expects', () => {
    expect(ruleValueWords(600, 'decidegrees_celsius')).toBe('60,0 °C')
    expect(ruleValueWords(5, 'decidegrees_celsius')).toBe('0,5 °C')
    expect(ruleValueWords(-25, 'decidegrees_celsius')).toBe('-2,5 °C')
    expect(ruleValueWords(1900, 'basis_points')).toBe('19,00 %')
    expect(ruleValueWords(2200000, 'cents')).toBe('22000,00 €')
    expect(ruleValueWords(70, 'kilowatts')).toBe('70 kW')
    expect(ruleValueWords(5, 'tonnes_co2e')).toBe('5 t CO2-Äquivalent')
    expect(ruleValueWords(100, 'count_per_100_ml')).toBe('100 je 100 ml')
  })

  it('says how a figure of a unit is typed: what stands behind it and how many places it has', () => {
    expect(ruleUnitEntry('kilowatts')).toEqual({ symbol: 'kW', places: 0 })
    expect(ruleUnitEntry('decidegrees_celsius')).toEqual({ symbol: '°C', places: 1 })
    expect(ruleUnitEntry('basis_points')).toEqual({ symbol: '%', places: 2 })
    expect(ruleUnitEntry('months')).toEqual({ symbol: 'Monate', places: 0 })
  })

  it('names the duty kinds in force that have an asset kind in their scope', () => {
    const catalogue = catalogueOf(bundle())
    const keys = (kind: string, on: string) =>
      dutyKindsNaming(catalogue, kind, on).map((entry) => entry.key)

    expect(keys('probe.elevator', '2026-10-05')).toEqual(['probe.elevator_main_test'])
    expect(keys('probe.water_meter', '2026-10-05')).toEqual([])
    expect(keys('probe.elevator', '1990-01-01')).toEqual([])
  })

  it('says the interval of a duty kind in a line, and who enters one where the catalogue names none', () => {
    const catalogue = catalogueOf(bundle())
    const guide: DutyKind = {
      ...mainTest,
      interval: { kind: 'guide', rule: 'probe.elevator_main_test_interval' },
    }

    expect(intervalLine(catalogue, mainTest, '2026-10-05')).toBe('Höchstfrist 24 Monate')
    expect(intervalLine(catalogue, guide, '2026-10-05')).toBe('Richtwert 24 Monate')
    expect(intervalLine(catalogue, { ...mainTest, interval: { kind: 'none' } }, '2026-10-05')).toBe(
      'die Frist trägt der Betreiber ein',
    )
    // Before the rule begins there is no number, and the line does not invent one.
    expect(intervalLine(catalogue, mainTest, '2015-05-31')).toBe(
      'Höchstfrist, an diesem Tag ohne Wert',
    )
  })
})

describe('the scope of a duty kind in words', () => {
  const boiler: AssetKind = {
    ...elevator,
    label: 'Wärmeerzeuger',
    characteristics: [
      { key: 'output', label: 'Nennleistung', kind: 'number', unit: 'kilowatts' },
      { key: 'condensing', label: 'Brennwertgerät', kind: 'flag' },
      {
        key: 'fuel',
        label: 'Brennstoff',
        kind: 'choice',
        options: [
          { value: 'gas', label: 'Gas' },
          { value: 'oil', label: 'Heizöl' },
        ],
      },
    ],
  }
  const catalogue = catalogueOf(
    bundle({
      assetKinds: [
        entry('probe.elevator', 1, '2015-06-01', elevator),
        entry('probe.boiler', 1, '2015-06-01', boiler),
      ],
      rules: [
        rule('probe.elevator_main_test_interval', '2015-06-01', null, 24),
        rule('probe.output_threshold', '2020-01-01', null, 70, { unit: 'kilowatts' }),
      ],
    }),
  )
  const scoped = (scope: Partial<DutyKind['scope']>): DutyKind => ({
    ...mainTest,
    scope: { assetKinds: [], conditions: [], buildingKinds: [], states: [], ...scope },
  })

  it('names asset kinds, building kinds and states by what a person calls them', () => {
    expect(
      scopeWords(
        catalogue,
        scoped({
          assetKinds: ['probe.boiler', 'probe.elevator'],
          buildingKinds: ['hospital'],
          states: ['DE-BW'],
        }),
        '2026-10-05',
      ),
    ).toEqual({
      assetKinds: ['Wärmeerzeuger', 'Aufzugsanlage'],
      conditions: [],
      buildingKinds: ['Krankenhaus'],
      states: ['Baden-Württemberg'],
    })
  })

  it('leaves a list empty that the scope leaves empty', () => {
    expect(scopeWords(catalogue, scoped({}), '2026-10-05')).toEqual({
      assetKinds: [],
      conditions: [],
      buildingKinds: [],
      states: [],
    })
  })

  it('reads a condition with the label of its characteristic and the value of its rule on the day', () => {
    const words = (on: string) =>
      scopeWords(
        catalogue,
        scoped({
          assetKinds: ['probe.boiler'],
          conditions: [
            { characteristic: 'output', atLeast: 'probe.output_threshold' },
            { characteristic: 'output', below: 'probe.output_threshold' },
            { characteristic: 'condensing', is: false },
            { characteristic: 'fuel', oneOf: ['gas', 'oil'] },
          ],
        }),
        on,
      ).conditions

    expect(words('2026-10-05')).toEqual([
      'Nennleistung ab 70 kW',
      'Nennleistung unter 70 kW',
      'Brennwertgerät: nein',
      'Brennstoff: Gas oder Heizöl',
    ])
    // Before the threshold begins the line names the rule and no number.
    expect(words('2019-12-31')[0]).toBe('Nennleistung ab dem Wert der Regel probe.output_threshold')
  })
})
