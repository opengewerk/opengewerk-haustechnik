import { describe, expect, it } from 'vitest'

import {
  type AssetKind,
  type CatalogueBundle,
  type CatalogueEntry,
  type CatalogueReview,
  type CatalogueRule,
  catalogueFormat,
  catalogueOf,
  type DutyKind,
  reviewMarks,
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
    expect(() => catalogueOf({ ...bundle(), format: 2 as never })).toThrow(/Format 2/)
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
