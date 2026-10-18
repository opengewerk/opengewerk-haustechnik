import type { TableRecord } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  type DeadlineImportAsset,
  type DeadlineImportDuty,
  deadlineImportFields,
  type DeadlineImportStock,
  deadlineImportSummary,
  deadlineImportTotal,
  intervalOfCell,
  planDeadlines,
} from './import-deadlines.js'

const today = '2026-10-13'

const extinguisher: DeadlineImportAsset = {
  id: 'a-extinguisher',
  number: 'AN-00031',
  name: 'Feuerlöscher Flur',
  mark: 'FL-031',
  serialNumber: 'SN 4711',
  kind: 'fire.extinguisher',
  federalState: 'DE-BW',
}

const lift: DeadlineImportAsset = {
  id: 'a-lift',
  number: 'AN-00044',
  name: 'Aufzug Haus A',
  mark: 'AUF-1',
  serialNumber: null,
  kind: 'probe.elevator',
  federalState: 'DE-BW',
}

/** A duty kind as the plan reads it: its name, the asset kinds it applies to, its interval and counting. */
function kind(
  key: string,
  label: string,
  assetKinds: readonly string[],
  interval: 'maximum' | 'guide' | 'none' | 'once',
  counting: 'from_performance' | 'from_due' | 'betrsichv' | 'once' = 'from_performance',
) {
  return {
    key,
    version: 3,
    definition: { label, scope: { assetKinds }, interval: { kind: interval }, counting },
  }
}

const kinds = [
  kind('fire.extinguisher_test', 'Prüfung der Feuerlöscher', ['fire.extinguisher'], 'maximum'),
  kind('fire.extinguisher_look', 'Sichtkontrolle der Feuerlöscher', ['fire.extinguisher'], 'guide'),
  kind(
    'fire.extinguisher_risk',
    'Prüfung nach Gefährdungsbeurteilung',
    ['fire.extinguisher'],
    'none',
  ),
  kind(
    'probe.elevator_main_test',
    'Hauptprüfung der Aufzugsanlage',
    ['probe.elevator'],
    'maximum',
    'betrsichv',
  ),
  kind('probe.elevator_first_test', 'Erstprüfung des Aufzugs', ['probe.elevator'], 'once', 'once'),
]

/** Two years for the tests, a year as the guide of the look. */
const months: Readonly<Record<string, number>> = {
  'Prüfung der Feuerlöscher': 24,
  'Sichtkontrolle der Feuerlöscher': 12,
  'Hauptprüfung der Aufzugsanlage': 24,
}

const catalogue = {
  dutyKinds: () => kinds,
  dutyKind: (key: string) => kinds.find((each) => each.key === key) ?? null,
  interval: (definition: { label: string }) => {
    const value = months[definition.label]

    return value === undefined ? null : { record: { value, unit: 'months' } }
  },
} as unknown as DeadlineImportStock['catalogue']

function stock(with_: Partial<DeadlineImportStock> = {}): DeadlineImportStock {
  return {
    assets: [extinguisher, lift],
    duties: [],
    takenOver: [],
    files: ['pruefung-2024-09.pdf', 'pruefung-2022.pdf'],
    catalogue,
    today,
    ...with_,
  }
}

/** The lines of a table, counted from the second line of the file. */
function lines(...rows: Readonly<Record<string, string>>[]): TableRecord[] {
  return rows.map((values, index) => ({ line: index + 2, values }))
}

const tested = {
  mark: 'FL-031',
  duty: 'Prüfung der Feuerlöscher',
  performedOn: '14.09.2024',
  nextDueOn: '30.06.2026',
  file: 'pruefung-2024-09.pdf',
}

const standingTest: DeadlineImportDuty = {
  id: 'd-test',
  assetId: 'a-extinguisher',
  kind: 'fire.extinguisher_test',
  label: null,
  counting: 'from_performance',
  intervalDays: null,
  intervalMonths: 12,
  evidenceDays: [],
}

describe('the fields of a list of running deadlines', () => {
  it('need no column for every line, because a line is an evidence or a document', () => {
    expect(deadlineImportFields.filter((field) => field.required)).toEqual([])
    expect(deadlineImportFields.map((field) => field.label)).toEqual([
      'Anlagennummer',
      'Kennzeichen',
      'Seriennummer',
      'Pflicht',
      'Letzter Nachweis',
      'Nächste Fälligkeit',
      'Ergebnis',
      'Vermerk',
      'Datei',
      'Bezeichnung des Dokuments',
      'Grundlage',
      'Quelle',
      'Tätigkeit',
      'Frist',
      'Zählweise',
      'Begründung der Frist',
    ])
  })

  it('read an interval with its unit, and a bare count as months', () => {
    expect(
      ['24 Monate', '24', '2 Jahre', '90 Tage', '6 Wochen', '12 Mon.', '1 Jahr'].map(
        intervalOfCell,
      ),
    ).toEqual([
      { months: 24 },
      { months: 24 },
      { months: 24 },
      { days: 90 },
      { days: 42 },
      { months: 12 },
      { months: 12 },
    ])
    expect(['jährlich', '0', '2,5 Jahre', '12 Stunden', ''].map(intervalOfCell)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
  })
})

describe('the plan of a list of running deadlines', () => {
  it('confirms the duty of the catalogue and takes the line over as its evidence, due on the day the list names', () => {
    const plan = planDeadlines(lines({ ...tested, remark: 'ohne prüfbare Unterschrift' }), stock())

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ duties: 1, evidence: 1, documents: 0, known: 0 })
    expect(plan.create.duties).toEqual([
      {
        assetId: 'a-extinguisher',
        kind: 'fire.extinguisher_test',
        kindVersion: 3,
        label: null,
        basis: null,
        sourceNote: null,
        task: null,
        counting: 'from_performance',
        // The interval of its kind, the maximum, where the list names none.
        interval: { months: 24 },
        intervalReason: null,
        maximum: { months: 24 },
        guide: null,
      },
    ])
    expect(plan.create.evidence).toEqual([
      {
        line: 2,
        assetId: 'a-extinguisher',
        duty: { planned: 0 },
        performedOn: '2024-09-14',
        nextDueOn: '2026-06-30',
        // A list that names no result names one that lets the deadline run on.
        result: 'without_defects',
        remark: 'ohne prüfbare Unterschrift',
        file: 'pruefung-2024-09.pdf',
      },
    ])
    expect(plan.rows).toEqual([
      {
        line: 2,
        asset: { id: 'a-extinguisher', number: 'AN-00031', name: 'Feuerlöscher Flur' },
        duty: 'Prüfung der Feuerlöscher',
        becomes: 'evidence',
        confirms: true,
        performedOn: '2024-09-14',
        dueOn: '2026-06-30',
        dueFrom: 'list',
        remark: 'ohne prüfbare Unterschrift',
        file: 'pruefung-2024-09.pdf',
      },
    ])
  })

  it('counts the due day from the evidence where the list names none', () => {
    const { nextDueOn: _, ...withoutDue } = tested
    const [row] = planDeadlines(lines(withoutDue), stock()).rows

    expect([row?.dueOn, row?.dueFrom]).toEqual(['2026-09-14', 'counted'])
  })

  it('finds the asset by its number, its mark or its serial number, whatever of them a line gives', () => {
    const found = (asset: Readonly<Record<string, string>>) => {
      const { mark: _, ...rest } = tested

      return planDeadlines(lines({ ...rest, ...asset }), stock()).create.evidence[0]?.assetId
    }

    expect(found({ assetNumber: 'an-00031' })).toBe('a-extinguisher')
    expect(found({ mark: 'fl - 031' })).toBe('a-extinguisher')
    expect(found({ serialNumber: 'sn4711' })).toBe('a-extinguisher')
    expect(found({ assetNumber: 'AN-00031', mark: 'FL-031', serialNumber: 'SN 4711' })).toBe(
      'a-extinguisher',
    )
  })

  it('takes no line whose asset is not named, not there, not one, or named two ways', () => {
    const said = (
      asset: Readonly<Record<string, string>>,
      with_?: Partial<DeadlineImportStock>,
    ) => {
      const { mark: _, ...rest } = tested
      const plan = planDeadlines(lines({ ...rest, ...asset }), stock(with_))

      expect(plan.create.evidence).toEqual([])

      return plan.problems.map((problem) => problem.what)
    }

    expect(said({})).toEqual(['Die Anlage fehlt: Anlagennummer, Kennzeichen oder Seriennummer'])
    expect(said({ mark: 'FL-999' })).toEqual([
      'Eine Anlage mit dem Kennzeichen „FL-999“ gibt es in Ihren Bereichen nicht',
    ])
    expect(said({ assetNumber: 'AN-00031', mark: 'AUF-1' })).toEqual([
      'Anlagennummer „AN-00031“ und Kennzeichen „AUF-1“ gehören zu verschiedenen Anlagen',
    ])
    expect(
      said(
        { mark: 'FL-031' },
        { assets: [extinguisher, { ...extinguisher, id: 'a-second', number: 'AN-00032' }] },
      ),
    ).toEqual(['Kennzeichen „FL-031“ trägt mehr als eine Anlage: AN-00031 und AN-00032'])
  })

  it('takes a duty of the operator own where the line gives its basis, with source, task and interval', () => {
    const own = {
      mark: 'FL-031',
      duty: 'Wartung nach Herstellerangabe',
      performedOn: '2025-03-01',
      basis: 'Vorgabe des Herstellers',
      sourceNote: 'Betriebsanleitung, Abschnitt 7',
      task: 'Wartung',
      interval: '6 Monate',
      counting: 'Ab dem fälligen Tag',
    }
    const plan = planDeadlines(lines(own), stock())

    expect(plan.problems).toEqual([])
    expect(plan.create.duties).toEqual([
      {
        assetId: 'a-extinguisher',
        kind: null,
        kindVersion: null,
        label: 'Wartung nach Herstellerangabe',
        basis: 'manufacturer',
        sourceNote: 'Betriebsanleitung, Abschnitt 7',
        task: 'maintenance',
        counting: 'from_due',
        interval: { months: 6 },
        intervalReason: null,
        maximum: null,
        guide: null,
      },
    ])

    // The basis in the one word a list writes, as well as in the words of the form.
    expect(
      planDeadlines(lines({ ...own, basis: 'Versicherer' }), stock()).create.duties[0]?.basis,
    ).toBe('insurer')
    expect(
      planDeadlines(lines({ ...own, basis: 'Prüfdienst' }), stock()).problems.map(
        (problem) => problem.what,
      ),
    ).toEqual(['Die Grundlage ist eine von: Hersteller, Auflage, Versicherer, Eigene Festlegung'])

    const { sourceNote: _s, task: _t, interval: _i, ...bare } = own

    expect(planDeadlines(lines(bare), stock()).problems.map((problem) => problem.what)).toEqual([
      'Die Quelle einer eigenen Pflicht fehlt',
      'Die Tätigkeit einer eigenen Pflicht ist eine von: Prüfung, Wartung, Inspektion, Funktionskontrolle, Sichtkontrolle, Probenahme',
      'Die Frist einer eigenen Pflicht fehlt',
    ])
  })

  it('names the duties of the catalogue for the asset where the list names none of them', () => {
    const plan = planDeadlines(lines({ ...tested, duty: 'Prüfung FL' }), stock())

    expect(plan.create.duties).toEqual([])
    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Für AN-00031 kennt der Katalog keine Pflicht „Prüfung FL“, er nennt: Prüfung der Feuerlöscher, Sichtkontrolle der Feuerlöscher und Prüfung nach Gefährdungsbeurteilung',
        next: 'Die Pflicht nennen, wie der Katalog sie nennt, oder mit Grundlage, Quelle, Tätigkeit und Frist als eigene Pflicht übernehmen',
      },
    ])
    // By its key as well, and a duty of another asset kind is none of this asset.
    expect(
      planDeadlines(lines({ ...tested, duty: 'fire.extinguisher_test' }), stock()).problems,
    ).toEqual([])
    expect(
      planDeadlines(lines({ ...tested, duty: 'Hauptprüfung der Aufzugsanlage' }), stock()).create
        .duties,
    ).toEqual([])
  })

  it('takes no duty of the catalogue that falls due once: that one is confirmed from its proposal (#439)', () => {
    const plan = planDeadlines(
      lines({ ...tested, mark: 'AUF-1', duty: 'Erstprüfung des Aufzugs' }),
      stock(),
    )

    expect(plan.create.duties).toEqual([])
    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Die Pflicht Erstprüfung des Aufzugs ist einmalig fällig; eine Liste übernimmt nur Pflichten, die wiederkehren',
        next: 'Die Pflicht an der Anlage aus dem Vorschlag bestätigen und ihren Nachweis dort eintragen',
      },
    ])
  })

  it('holds the interval of a duty of the catalogue to its maximum, its guide and its reason', () => {
    const said = (duty: string, with_: Readonly<Record<string, string>>) =>
      planDeadlines(lines({ ...tested, nextDueOn: '', duty, ...with_ }), stock()).problems.map(
        (problem) => problem.what,
      )

    expect(said('Prüfung der Feuerlöscher', { interval: '36 Monate' })).toEqual([
      'Prüfung der Feuerlöscher: Die Höchstfrist beträgt 24 Monate, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen',
    ])
    expect(said('Prüfung der Feuerlöscher', { interval: '12 Monate' })).toEqual([])
    expect(said('Sichtkontrolle der Feuerlöscher', { interval: '6 Monate' })).toEqual([
      'Der Richtwert der Pflicht Sichtkontrolle der Feuerlöscher beträgt 12 Monate; eine Frist, die davon abweicht, braucht ihre Begründung',
    ])
    expect(
      said('Sichtkontrolle der Feuerlöscher', {
        interval: '6 Monate',
        intervalReason: 'Feuchter Keller',
      }),
    ).toEqual([])
    expect(said('Prüfung nach Gefährdungsbeurteilung', {})).toEqual([
      'Die Frist der Pflicht Prüfung nach Gefährdungsbeurteilung legt der Betreiber fest: die Liste nennt sie, mit ihrer Begründung',
    ])
    expect(said('Prüfung nach Gefährdungsbeurteilung', { interval: '12' })).toEqual([
      'Die Frist der Pflicht Prüfung nach Gefährdungsbeurteilung legt der Betreiber fest; sie braucht ihre Begründung',
    ])
  })

  it('adds the evidence to a duty that stands at the asset, and confirms none', () => {
    const { nextDueOn: _, ...withoutDue } = tested
    const plan = planDeadlines(lines(withoutDue), stock({ duties: [standingTest] }))

    expect(plan.counts).toEqual({ duties: 0, evidence: 1, documents: 0, known: 0 })
    expect(plan.create.evidence[0]?.duty).toEqual({ id: 'd-test' })
    // Counted with the interval the duty has here, a year, and not with that of the list or of its kind.
    expect([plan.rows[0]?.confirms, plan.rows[0]?.dueOn]).toEqual([false, '2025-09-14'])
  })

  it('takes the latest line of a duty as its evidence and what lies before it as a document, or not at all', () => {
    const plan = planDeadlines(
      lines(
        { ...tested, performedOn: '2022-09-20', nextDueOn: '', file: 'pruefung-2022.pdf' },
        tested,
        { ...tested, performedOn: '2020-09-18', nextDueOn: '', file: '' },
      ),
      stock(),
    )

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ duties: 1, evidence: 1, documents: 1, known: 0 })
    expect(plan.create.evidence.map((each) => [each.line, each.performedOn])).toEqual([
      [3, '2024-09-14'],
    ])
    expect(plan.create.documents).toEqual([
      {
        line: 2,
        assetId: 'a-extinguisher',
        title: 'Prüfung der Feuerlöscher vom 20.09.2022',
        kind: 'test_certificate',
        file: 'pruefung-2022.pdf',
      },
    ])
    expect(plan.notes).toEqual([
      {
        lines: [4],
        column: 'Datei',
        why: 'Ein älterer Nachweis ohne Datei wird nicht übernommen: für die Frist zählt der letzte',
      },
    ])
    expect(plan.rows.map((row) => [row.line, row.becomes])).toEqual([
      [2, 'document'],
      [3, 'evidence'],
    ])
  })

  it('takes a line without a duty as a document with its file, under the name the list gives it', () => {
    const plan = planDeadlines(
      lines(
        { mark: 'FL-031', file: 'pruefung-2022.pdf', title: 'Abnahme 2022' },
        { mark: 'AUF-1', file: 'Pruefung-2024-09.PDF' },
        { mark: 'AUF-1' },
      ),
      stock(),
    )

    expect(plan.create.documents).toEqual([])
    expect(plan.problems).toEqual([
      {
        lines: [4],
        what: 'Eine Zeile ohne Pflicht ist ein Dokument und nennt seine Datei',
        next: 'Die Pflicht oder die Datei nennen und neu hochladen',
      },
    ])

    const whole = planDeadlines(
      lines(
        { mark: 'FL-031', file: 'pruefung-2022.pdf', title: 'Abnahme 2022' },
        { mark: 'AUF-1', file: 'Pruefung-2024-09.PDF' },
      ),
      stock(),
    )

    expect(whole.create.documents.map((each) => [each.assetId, each.title, each.file])).toEqual([
      ['a-extinguisher', 'Abnahme 2022', 'pruefung-2022.pdf'],
      // The file as it was chosen, whatever the list makes of its capitals.
      ['a-lift', 'pruefung-2024-09', 'pruefung-2024-09.pdf'],
    ])
    expect(whole.counts).toEqual({ duties: 0, evidence: 0, documents: 2, known: 0 })
  })

  it('makes nothing of what is here already: an evidence of that day, a document taken over before', () => {
    const plan = planDeadlines(
      lines(tested, { mark: 'AUF-1', file: 'pruefung-2022.pdf' }),
      stock({
        duties: [{ ...standingTest, evidenceDays: ['2024-09-14'] }],
        takenOver: [{ assetId: 'a-lift', fileName: 'Pruefung-2022.pdf' }],
      }),
    )

    expect(plan.counts).toEqual({ duties: 0, evidence: 0, documents: 0, known: 2 })
    expect([plan.rows, plan.problems]).toEqual([[], []])
    expect(deadlineImportTotal(plan.counts)).toBe(0)
  })

  it('files a line as a document where its duty has a later evidence already', () => {
    const plan = planDeadlines(
      lines(tested),
      stock({ duties: [{ ...standingTest, evidenceDays: ['2025-02-01'] }] }),
    )

    expect(plan.counts).toEqual({ duties: 0, evidence: 0, documents: 1, known: 0 })
    expect(plan.create.documents[0]?.title).toBe('Prüfung der Feuerlöscher vom 14.09.2024')
  })

  it('takes no due day beyond the maximum of the duty, counted from the evidence', () => {
    const said = (line: Readonly<Record<string, string>>) =>
      planDeadlines(lines(line), stock()).problems.map((problem) => problem.what)

    expect(said({ ...tested, nextDueOn: '31.12.2026' })).toEqual([
      'Die nächste Fälligkeit 31.12.2026 liegt hinter der Höchstfrist der Pflicht Prüfung der Feuerlöscher: fällig spätestens am 14.09.2026',
    ])
    expect(said({ ...tested, nextDueOn: '14.09.2026' })).toEqual([])

    // Under § 14 Abs. 5 BetrSichV the appointment is a month: any day of it stands.
    const main = {
      mark: 'AUF-1',
      duty: 'Hauptprüfung der Aufzugsanlage',
      performedOn: '2024-09-14',
    }

    expect(said({ ...main, nextDueOn: '30.09.2026' })).toEqual([])
    const [inItsMonth] = planDeadlines(lines({ ...main, nextDueOn: '30.09.2026' }), stock()).rows

    // The preview shows the first day of the month, and says that the month is the list's.
    expect([inItsMonth?.dueOn, inItsMonth?.dueFrom]).toEqual(['2026-09-01', 'month_of_list'])
    expect(said({ ...main, nextDueOn: '01.10.2026' })).toEqual([
      'Die nächste Fälligkeit 01.10.2026 liegt hinter der Höchstfrist der Pflicht Hauptprüfung der Aufzugsanlage: fällig spätestens am 01.09.2026',
    ])
  })

  it('takes a due day of a duty of the operator own as the list names it, however far it lies', () => {
    const plan = planDeadlines(
      lines({
        mark: 'FL-031',
        duty: 'Wartung',
        performedOn: '2025-03-01',
        nextDueOn: '2029-03-01',
        basis: 'Eigene Festlegung',
        sourceNote: 'Wartungsplan',
        task: 'Wartung',
        interval: '12',
      }),
      stock(),
    )

    expect([plan.problems, plan.rows[0]?.dueOn]).toEqual([[], '2029-03-01'])
  })

  it('names what a line says wrong about its days, its result and its file', () => {
    const said = (with_: Readonly<Record<string, string>>) =>
      planDeadlines(lines({ ...tested, ...with_ }), stock()).problems.map((problem) => problem.what)

    expect(said({ performedOn: '' })).toEqual(['Der Tag des letzten Nachweises fehlt'])
    expect(said({ performedOn: 'September 2024' })).toEqual([
      'Der letzte Nachweis ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02',
    ])
    expect(said({ performedOn: '14.10.2026', nextDueOn: '' })).toEqual([
      'Ein Nachweis gilt für einen Tag, der schon war',
    ])
    expect(said({ nextDueOn: '14.09.2024' })).toEqual([
      'Die nächste Fälligkeit liegt nach dem Tag des letzten Nachweises',
    ])
    expect(said({ nextDueOn: 'bald' })).toEqual([
      'Die nächste Fälligkeit ist kein Tag, geschrieben 02.10.2026 oder 2026-10-02',
    ])
    expect(said({ result: 'Nicht bestanden' })).toEqual([
      'Das Ergebnis ist „Ohne Mangel“ oder „Mit Mängeln“: übernommen wird, was die Frist weiterlaufen lässt',
    ])
    expect(said({ file: 'fehlt.pdf' })).toEqual(['Die Datei „fehlt.pdf“ ist nicht gewählt'])
    expect(said({ remark: 'x'.repeat(501) })).toEqual(['Der Vermerk hat höchstens 500 Zeichen'])
    expect(
      planDeadlines(lines({ ...tested, result: 'mit Mängeln' }), stock()).create.evidence[0]
        ?.result,
    ).toBe('with_defects')
  })

  it('takes no duty that stands twice for one day in the file', () => {
    const plan = planDeadlines(lines(tested, { ...tested, file: '' }), stock())

    expect(plan.problems).toEqual([
      {
        lines: [2, 3],
        what: 'Prüfung der Feuerlöscher an AN-00031 steht für den 14.09.2024 zweimal in der Datei',
        next: 'Eine der Zeilen streichen und neu hochladen',
      },
    ])
  })

  it('writes nothing while a line is open, and says in words what it made', () => {
    const plan = planDeadlines(lines(tested, { ...tested, mark: 'FL-999' }), stock())

    expect(plan.lines).toBe(2)
    expect(plan.problems).toHaveLength(1)
    expect(plan.create).toEqual({ duties: [], evidence: [], documents: [] })
    expect(deadlineImportSummary({ duties: 3, evidence: 5, documents: 1, known: 2 })).toBe(
      '5 Nachweise als Altbestand übernommen, 3 Pflichten bestätigt, 1 Dokument als Altbestand abgelegt',
    )
    expect(deadlineImportSummary({ duties: 0, evidence: 0, documents: 2, known: 0 })).toBe(
      '2 Dokumente als Altbestand abgelegt',
    )
  })
})
