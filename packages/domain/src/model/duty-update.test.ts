import { describe, expect, it } from 'vitest'

import {
  type AssetKind,
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueFormat,
  catalogueOf,
  type CatalogueReview,
  type CatalogueRule,
  type DutyKind,
} from './catalogue.js'
import {
  adoption,
  batchDutiesProblem,
  ceilingOf,
  cutShortTo,
  dutyUpdate,
  keeping,
  keepingProblems,
  type UpdatedDuty,
  updateBatch,
  updatesSentence,
} from './duty-update.js'

const review: CatalogueReview = { checkedOn: '2026-10-03', accepted: null }
const today = '2026-10-12'
const state = 'DE-BW'
const key = 'probe.elevator_main_test'
const ruleKey = 'probe.elevator_main_test_interval'

const elevator: AssetKind = {
  label: 'Aufzugsanlage',
  costGroup: '461',
  characteristics: [{ key: 'load', label: 'Tragfähigkeit', kind: 'number', unit: 'kilowatts' }],
  fields: [],
  expectedDocuments: [],
  meter: null,
} as unknown as AssetKind

const mainTest: DutyKind = {
  label: 'Hauptprüfung der Aufzugsanlage',
  description: 'Die Aufzugsanlage wird wiederkehrend geprüft.',
  task: 'inspection',
  origin: 'state_law',
  bindingness: 'statute',
  source: 'Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV',
  interval: { kind: 'maximum', rule: ruleKey },
  counting: 'betrsichv',
  qualification: { level: 'approved_body' },
  evidence: { kinds: ['report'] },
  retention: { kind: 'while_in_use' },
  scope: { assetKinds: ['probe.elevator'], conditions: [], buildingKinds: [], states: [] },
}

function version(
  number: number,
  validFrom: string,
  definition: DutyKind = mainTest,
): CatalogueEntry<DutyKind> {
  return { key, version: number, validFrom, definition, review }
}

function rule(
  validFrom: string,
  validUntil: string | null,
  value: number,
  more: Partial<CatalogueRule['record']> = {},
): CatalogueRule {
  return {
    record: {
      key: ruleKey,
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

function catalogueWith(content: Partial<CatalogueBundle['packages'][number]> = {}) {
  return catalogueOf({
    format: catalogueFormat,
    sha256: 'a'.repeat(64),
    packages: [
      {
        name: 'probe',
        title: 'Probepaket',
        version: '1.0.0',
        minimumCore: '0.0.0',
        assetKinds: [
          {
            key: 'probe.elevator',
            version: 1,
            validFrom: '2015-06-01',
            definition: elevator,
            review,
          },
        ],
        dutyKinds: [version(1, '2015-06-01')],
        forms: [],
        roundTemplates: [],
        rules: [rule('2015-06-01', null, 24)],
        defectClasses: [],
        qualifications: [],
        ...content,
      },
    ],
  })
}

/** A duty confirmed against version 1 with the maximum of 24 months, at its maximum unless it says otherwise. */
function confirmed(more: Partial<UpdatedDuty> = {}): UpdatedDuty {
  return {
    kind: key,
    kindVersion: 1,
    counting: 'betrsichv',
    intervalDays: null,
    intervalMonths: 24,
    intervalReason: null,
    maximumDays: null,
    maximumMonths: 24,
    guideDays: null,
    guideMonths: null,
    keptVersion: null,
    keptDays: null,
    keptMonths: null,
    confirmedAt: new Date('2026-09-14T08:00:00Z'),
    ...more,
  }
}

const anywhere = { state, subject: null } as const

/** The rule shortened to 12 months from the first day of 2027, as a record that continues it. */
const shortened = [rule('2015-06-01', '2026-12-31', 24), rule('2027-01-01', null, 12)]

const guided: DutyKind = {
  ...mainTest,
  interval: { kind: 'guide', rule: ruleKey },
  counting: 'from_performance',
}

describe('the maximum of a duty on a day', () => {
  it('is that of the version in force on the day, in the state of the duty', () => {
    const ceiling = ceilingOf(catalogueWith({ rules: shortened }), key, state)

    expect(ceiling('2026-12-31')).toEqual({ months: 24 })
    expect(ceiling('2027-01-01')).toEqual({ months: 12 })
    // Before the kind begins there is none, and none for a duty of the operator's own.
    expect(ceiling('2015-05-31')).toBeNull()
    expect(ceilingOf(catalogueWith(), null, state)('2026-10-12')).toBeNull()
  })

  it('is none where the version of the day names a guide or no value', () => {
    const later = catalogueWith({
      dutyKinds: [version(1, '2015-06-01'), version(2, '2027-01-01', guided)],
    })

    expect(ceilingOf(later, key, state)('2026-12-31')).toEqual({ months: 24 })
    expect(ceilingOf(later, key, state)('2027-01-01')).toBeNull()
  })

  it('cuts an interval short that lies beyond it, and leaves one within it alone', () => {
    expect(cutShortTo({ intervalDays: null, intervalMonths: 24 }, { months: 12 })).toEqual({
      months: 12,
    })
    expect(cutShortTo({ intervalDays: null, intervalMonths: 12 }, { months: 12 })).toBeNull()
    expect(cutShortTo({ intervalDays: null, intervalMonths: 6 }, null)).toBeNull()
  })
})

describe('what the catalogue says differently about a confirmed duty', () => {
  it("is nothing while the duty carries what the catalogue says, and nothing for one of the operator's own", () => {
    expect(dutyUpdate(catalogueWith(), confirmed(), anywhere, today)).toBeNull()
    expect(
      dutyUpdate(catalogueWith(), confirmed({ kind: null, kindVersion: null }), anywhere, today),
    ).toBeNull()
  })

  it('names a newer version with the day it applies from and what reads differently in it', () => {
    const second: DutyKind = {
      ...mainTest,
      source: 'Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV in der Fassung von 2027',
      counting: 'from_due',
      qualification: { level: 'competent_person', note: 'mit Zusatzausbildung' },
    }
    const catalogue = catalogueWith({
      dutyKinds: [version(1, '2015-06-01'), version(2, '2027-01-01', second)],
    })

    expect(dutyUpdate(catalogue, confirmed(), anywhere, today)).toEqual({
      held: 1,
      newest: 2,
      from: '2027-01-01',
      changes: [
        {
          field: 'counting',
          held: 'Nach § 14 Abs. 5 BetrSichV',
          newest: 'Ab dem fälligen Tag',
        },
        {
          field: 'qualification',
          held: 'Zugelassene Überwachungsstelle',
          newest: 'Zur Prüfung befähigte Person, mit Zusatzausbildung',
        },
        {
          field: 'source',
          held: 'Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV',
          newest: 'Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV in der Fassung von 2027',
        },
      ],
      maximum: null,
      shorter: null,
      lapse: null,
      adoptable: true,
      becomes: { months: 24 },
      obstacle: null,
      keepable: true,
    })
  })

  it('names a version that only reads differently in its wording without a change', () => {
    const reworded = { ...mainTest, description: 'Dieselbe Pflicht, anders gesagt.' }
    const catalogue = catalogueWith({
      dutyKinds: [version(1, '2015-06-01'), version(2, '2015-06-01', reworded)],
    })

    expect(dutyUpdate(catalogue, confirmed(), anywhere, today)).toMatchObject({
      newest: 2,
      from: '2015-06-01',
      changes: [],
    })
  })

  it('reports a maximum a rule shortens, from the day of its record, and allows no leaving it', () => {
    const update = dutyUpdate(catalogueWith({ rules: shortened }), confirmed(), anywhere, today)

    expect(update).toEqual({
      held: 1,
      newest: 1,
      from: null,
      changes: [{ field: 'interval', held: '24 Monate', newest: '12 Monate' }],
      maximum: { interval: { months: 12 }, from: '2027-01-01' },
      shorter: { interval: { months: 12 }, from: '2027-01-01' },
      lapse: null,
      adoptable: true,
      // Taken over, the interval is the new maximum.
      becomes: { months: 12 },
      obstacle: null,
      keepable: false,
    })
  })

  it('reports a shorter maximum to a duty within it too, which may be left as it is', () => {
    const update = dutyUpdate(
      catalogueWith({ rules: shortened }),
      confirmed({ intervalMonths: 6 }),
      anywhere,
      today,
    )

    expect(update).toMatchObject({
      // The maximum is shorter for this duty too; its own interval is within it.
      maximum: { interval: { months: 12 }, from: '2027-01-01' },
      shorter: null,
      keepable: true,
      adoptable: true,
      becomes: { months: 6 },
    })
    expect(update?.changes).toEqual([{ field: 'interval', held: '24 Monate', newest: '12 Monate' }])
  })

  it('reports a maximum that was corrected in its record, because the duty carries the old one', () => {
    const corrected = catalogueWith({ rules: [rule('2015-06-01', null, 12)] })

    expect(dutyUpdate(corrected, confirmed(), anywhere, today)).toMatchObject({
      changes: [{ field: 'interval', held: '24 Monate', newest: '12 Monate' }],
      shorter: { interval: { months: 12 }, from: '2015-06-01' },
    })
  })

  it('holds a duty with a guide against the guide it carries, and one from before against the guide of its day', () => {
    const one = catalogueWith({ dutyKinds: [version(1, '2015-06-01', guided)] })
    const corrected = catalogueWith({
      dutyKinds: [version(1, '2015-06-01', guided)],
      rules: [rule('2015-06-01', null, 12)],
    })
    const continued = catalogueWith({
      dutyKinds: [version(1, '2015-06-01', guided)],
      rules: shortened,
    })
    const follows = confirmed({
      counting: 'from_performance',
      maximumMonths: null,
      guideMonths: 24,
    })
    const fromBefore = confirmed({ counting: 'from_performance', maximumMonths: null })

    expect(dutyUpdate(one, follows, anywhere, today)).toBeNull()
    expect(dutyUpdate(one, fromBefore, anywhere, today)).toBeNull()
    // A guide corrected in its record is seen by the duty that carries the old one.
    expect(dutyUpdate(corrected, follows, anywhere, today)).toMatchObject({
      changes: [{ field: 'interval', held: '24 Monate', newest: '12 Monate' }],
      // A guide is no maximum: nothing holds without a decision.
      maximum: null,
      shorter: null,
      keepable: true,
    })
    // One from before the column sees a guide that was continued, by the day it was confirmed.
    expect(dutyUpdate(continued, fromBefore, anywhere, today)).toMatchObject({
      changes: [{ field: 'interval', held: '24 Monate', newest: '12 Monate' }],
    })
  })

  it('says that the kind of the interval changes, and what the operator sets where the newest names no value', () => {
    const free: DutyKind = { ...mainTest, interval: { kind: 'none' } }
    const catalogue = catalogueWith({
      dutyKinds: [version(1, '2015-06-01'), version(2, '2026-01-01', free)],
    })

    const update = dutyUpdate(catalogue, confirmed(), anywhere, today)

    expect(update?.changes).toEqual([
      { field: 'interval', held: '24 Monate', newest: 'legt der Betreiber fest' },
      { field: 'intervalKind', held: 'Höchstfrist', newest: 'Ohne Vorgabe' },
    ])
    // An interval the operator sets needs its reason: without one the version is not taken over yet.
    expect(update).toMatchObject({
      adoptable: false,
      becomes: null,
      obstacle:
        'Die neue Fassung verlangt eine Begründung der Frist. Tragen Sie sie an der Pflicht unter „Frist festlegen“ ein und übernehmen Sie danach.',
      keepable: true,
    })
  })

  it('is silent about a duty left as it is, until the catalogue says something else again', () => {
    const second = catalogueWith({ rules: shortened })
    const third = catalogueWith({
      rules: [
        rule('2015-06-01', '2026-12-31', 24),
        rule('2027-01-01', '2027-12-31', 12),
        rule('2028-01-01', null, 9),
      ],
    })
    const kept = confirmed({ intervalMonths: 6, keptVersion: 1, keptMonths: 12 })

    expect(dutyUpdate(second, kept, anywhere, today)).toBeNull()
    expect(dutyUpdate(third, kept, anywhere, today)?.changes).toEqual([
      { field: 'interval', held: '24 Monate', newest: '9 Monate' },
    ])
  })

  it('reports a duty whose kind or version the catalogue lost, with nothing to take over', () => {
    const without = catalogueWith({ dutyKinds: [] })

    expect(dutyUpdate(without, confirmed(), anywhere, today)).toEqual({
      held: 1,
      newest: null,
      from: null,
      changes: [],
      maximum: null,
      shorter: null,
      lapse: 'gone',
      adoptable: false,
      becomes: null,
      obstacle: 'Der Katalog kennt diese Pflichtart nicht mehr.',
      keepable: false,
    })
    expect(dutyUpdate(catalogueWith(), confirmed({ kindVersion: 3 }), anywhere, today)?.lapse).toBe(
      'gone',
    )
  })

  it('reports a duty whose asset the newest version no longer takes in, to be left with a reason or ended', () => {
    const narrower: DutyKind = {
      ...mainTest,
      scope: { ...mainTest.scope, states: ['DE-BY'] },
    }
    const catalogue = catalogueWith({
      dutyKinds: [version(1, '2015-06-01'), version(2, '2027-01-01', narrower)],
    })
    const subject = {
      assetKind: 'probe.elevator',
      values: {},
      buildingKinds: [],
      federalState: state,
    } as const

    expect(dutyUpdate(catalogue, confirmed(), { state, subject }, today)).toMatchObject({
      lapse: 'out_of_scope',
      adoptable: false,
      becomes: null,
      obstacle: 'Nach der neuen Fassung gilt die Pflichtart für diese Anlage nicht mehr.',
      keepable: true,
    })
    // In the state the scope names, the same version is one to take over.
    expect(
      dutyUpdate(
        catalogue,
        confirmed(),
        { state: 'DE-BY', subject: { ...subject, federalState: 'DE-BY' } },
        today,
      ),
    ).toMatchObject({ lapse: null, adoptable: true })
  })
})

describe('taking the newest version over', () => {
  it('names the version, counts as it says and carries its maximum, cut to it where the interval lay beyond', () => {
    expect(adoption(catalogueWith({ rules: shortened }), confirmed(), state, today)).toEqual({
      values: {
        kindVersion: 1,
        counting: 'betrsichv',
        intervalDays: null,
        intervalMonths: 12,
        maximumDays: null,
        maximumMonths: 12,
        guideDays: null,
        guideMonths: null,
        keptVersion: null,
        keptDays: null,
        keptMonths: null,
        keptReason: null,
      },
    })
  })

  it('leaves an interval within the new maximum alone, and forgets that the duty was left as it is', () => {
    const second: DutyKind = { ...mainTest, counting: 'from_due' }
    const catalogue = catalogueWith({
      dutyKinds: [version(1, '2015-06-01'), version(2, '2027-01-01', second)],
      rules: shortened,
    })
    const adopted = adoption(
      catalogue,
      confirmed({ intervalMonths: 6, keptVersion: 1, keptMonths: 24 }),
      state,
      today,
    )

    expect(adopted).toMatchObject({
      values: {
        kindVersion: 2,
        counting: 'from_due',
        intervalMonths: 6,
        maximumMonths: 12,
        keptVersion: null,
        keptMonths: null,
      },
    })
  })

  it('lets a duty that followed its guide follow the new one, and one that departed from it stay', () => {
    const catalogue = catalogueWith({
      dutyKinds: [version(1, '2015-06-01', guided)],
      rules: [rule('2015-06-01', null, 12)],
    })
    const follows = confirmed({
      counting: 'from_performance',
      maximumMonths: null,
      guideMonths: 24,
    })

    expect(adoption(catalogue, follows, state, today)).toMatchObject({
      values: { intervalMonths: 12, guideMonths: 12, maximumMonths: null },
    })
    expect(
      adoption(
        catalogue,
        { ...follows, intervalMonths: 18, intervalReason: 'Wenig genutzt.' },
        state,
        today,
      ),
    ).toMatchObject({ values: { intervalMonths: 18, guideMonths: 12 } })
  })

  it('says what the newest version will not take, and writes nothing', () => {
    const free: DutyKind = { ...mainTest, interval: { kind: 'none' } }
    const needsReason = catalogueWith({
      dutyKinds: [version(1, '2015-06-01'), version(2, '2026-01-01', free)],
    })
    const inDays = catalogueWith({
      dutyKinds: [
        version(1, '2015-06-01', { ...guided, interval: { kind: 'none' } }),
        version(2, '2026-01-01', { ...mainTest, interval: { kind: 'none' } }),
      ],
    })

    expect(adoption(needsReason, confirmed(), state, today)).toEqual({
      problem:
        'Die neue Fassung verlangt eine Begründung der Frist. Tragen Sie sie an der Pflicht unter „Frist festlegen“ ein und übernehmen Sie danach.',
    })
    expect(
      adoption(
        needsReason,
        confirmed({ intervalReason: 'Gefährdungsbeurteilung 2026.' }),
        state,
        today,
      ),
    ).toMatchObject({ values: { kindVersion: 2, maximumMonths: null } })
    // Version 2 counts under § 14 Abs. 5 BetrSichV, which takes no interval in days.
    expect(
      adoption(
        inDays,
        confirmed({
          counting: 'from_performance',
          intervalDays: 90,
          intervalMonths: null,
          maximumMonths: null,
          intervalReason: 'Eigene Festlegung.',
        }),
        state,
        today,
      ),
    ).toEqual({ problem: 'Nach § 14 Abs. 5 BetrSichV zählt die Frist in Monaten.' })
  })
})

describe('leaving a duty as it is', () => {
  it('keeps what the catalogue said, with the reason', () => {
    expect(
      keeping(
        catalogueWith({ rules: shortened }),
        confirmed({ intervalMonths: 6 }),
        anywhere,
        'Wir prüfen ohnehin halbjährlich.',
        today,
      ),
    ).toEqual({
      values: {
        keptVersion: 1,
        keptDays: null,
        keptMonths: 12,
        keptReason: 'Wir prüfen ohnehin halbjährlich.',
      },
    })
  })

  it('is refused where the new maximum is shorter than the interval of the duty', () => {
    expect(
      keeping(catalogueWith({ rules: shortened }), confirmed(), anywhere, 'Bleibt so.', today),
    ).toEqual({
      problem:
        'Die neue Höchstfrist ist kürzer als die Frist dieser Pflicht. Sie lässt sich nicht so lassen, sondern wird übernommen; eine Höchstfrist lässt sich nur verkürzen.',
    })
  })

  it('is refused where there is nothing to decide', () => {
    expect(keeping(catalogueWith(), confirmed(), anywhere, 'Bleibt so.', today)).toEqual({
      problem: 'Für diese Pflicht sagt der Katalog nichts Neues; es gibt nichts zu entscheiden.',
    })
  })

  it('asks for its reason', () => {
    expect(keepingProblems({})).toHaveProperty('reason')
    expect(keepingProblems({ reason: '   ' })).toHaveProperty('reason')
    expect(keepingProblems({ reason: 'x'.repeat(501) })).toHaveProperty('reason')
    expect(keepingProblems({ reason: 'Wir prüfen ohnehin halbjährlich.' })).toEqual({})
  })
})

describe('a batch of duties', () => {
  it('names at least one duty, not too many, each once', () => {
    expect(batchDutiesProblem(undefined)).not.toBeNull()
    expect(batchDutiesProblem([])).not.toBeNull()
    expect(batchDutiesProblem(['a', ''])).not.toBeNull()
    expect(batchDutiesProblem(['a', 'a'])).not.toBeNull()
    expect(
      batchDutiesProblem(Array.from({ length: updateBatch.most + 1 }, (_, index) => String(index))),
    ).not.toBeNull()
    expect(batchDutiesProblem(['a', 'b'])).toBeNull()
  })
})

describe('the sentence that announces what a package changes', () => {
  const update = (shorter: { from: string } | null) => ({
    held: 1,
    newest: 2,
    from: null,
    changes: [],
    maximum: shorter === null ? null : { interval: { months: 12 }, from: shorter.from },
    shorter: null,
    lapse: null,
    adoptable: true,
    becomes: { months: 12 },
    obstacle: null,
    keepable: true,
  })

  it('names the shorter maximum and its day where that is what the catalogue says of every duty', () => {
    expect(
      updatesSentence(
        'Trinkwasser',
        [
          update({ from: '2027-01-01' }),
          update({ from: '2027-01-01' }),
          update({ from: '2027-01-01' }),
        ],
        today,
      ),
    ).toBe(
      'Neue Fassung des Pakets Trinkwasser: Für 3 Pflichten gilt ab dem 01.01.2027 eine kürzere Höchstfrist, von diesem Tag an auch ohne Übernahme.',
    )
    expect(updatesSentence('Trinkwasser', [update({ from: '2026-10-01' })], today)).toBe(
      'Neue Fassung des Pakets Trinkwasser: Für 1 Pflicht gilt seit dem 01.10.2026 eine kürzere Höchstfrist, auch ohne Übernahme.',
    )
  })

  it('says that something changes where the duties differ in what happens to them', () => {
    expect(
      updatesSentence('Trinkwasser', [update({ from: '2027-01-01' }), update(null)], today),
    ).toBe('Neue Fassung des Pakets Trinkwasser: Für 2 Pflichten ändert sich etwas.')
  })
})
