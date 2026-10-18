import { describe, expect, it } from 'vitest'

import {
  assetBookCountWords,
  assetBookFacts,
  type AssetBookEvidence,
  assetBookLines,
  assetBookRows,
  assetBookTitle,
  bookAnswerWords,
} from './asset-book.js'
import { type EvidenceId, type EvidenceState, readEvidenceState } from './evidence.js'

/** A lab test of an evaporative cooling system as it was signed, in the newest shape. */
const labTest: EvidenceState = readEvidenceState({
  activity: { kind: 'inspection', title: 'Laboruntersuchung' },
  answers: [
    {
      group: null,
      kind: 'measurement',
      label: 'Legionella spp.',
      limit: {
        source: 'Anlage 1 der 42. BImSchV',
        text: 'höchstens 100 KBE/100 ml',
        within: false,
      },
      photo: null,
      remark: null,
      result: null,
      section: 'Befund',
      value: '1.300 KBE/100 ml',
    },
    {
      group: null,
      kind: 'text',
      label: 'Akkreditiertes Prüflaboratorium',
      limit: null,
      photo: null,
      remark: null,
      result: null,
      section: 'Befund',
      value: 'Labor Beispiel GmbH',
    },
  ],
  collective: null,
  defects: [
    {
      defectClass: 'raumluft.significant',
      description: 'Prüfwert 1 überschritten',
      dueOn: '2026-10-09',
    },
  ],
  duty: {
    counting: 'from_performance',
    dueOn: null,
    interval: { months: 3 },
    kind: 'raumluft.cooling_water_lab_test',
    kindVersion: 2,
    label: 'Nutzwasser im Labor untersuchen lassen',
    source: '§ 4 Abs. 2 Nr. 2 und Abs. 3 der 42. BImSchV',
  },
  files: [],
  form: null,
  nextDueOn: null,
  number: 'NW-2026-00126',
  origin: 'report',
  performedOn: '2026-10-02',
  performer: { examiner: 'Mara Roth', organisation: 'Labor Beispiel GmbH' },
  place: {
    asset: {
      kind: 'raumluft.evaporative_cooling_system',
      kindLabel: 'Verdunstungskühlanlage',
      name: 'Verdunstungskühlanlage Dach',
      number: 'AN-00120',
      serialNumber: null,
    },
    building: { name: 'Verwaltungsgebäude', shortCode: null },
    property: { address: 'Rathausplatz 1, 69115 Beispielstadt', name: 'Rathaus' },
    room: null,
  },
  remark: null,
  replaces: null,
  result: 'with_defects',
  resultReason: null,
  retention: {
    kind: 'while_in_use',
    on: '2026-10-02',
    rule: 'raumluft.cooling_book_retention',
    yearsAfter: 5,
  },
  signatures: [],
  version: 12,
  writtenAt: '2026-10-02T14:10:00.000Z',
  writtenBy: 'Dennis Roth',
})

function evidence(changes: Partial<AssetBookEvidence>): AssetBookEvidence {
  return {
    id: 'e-1' as EvidenceId,
    number: labTest.number,
    performedOn: labTest.performedOn,
    result: labTest.result,
    duty: labTest.duty.label,
    standing: 'counts',
    voidedFor: null,
    state: labTest,
    ...changes,
  }
}

const classes = (key: string) => (key === 'raumluft.significant' ? 'erheblich' : null)

describe('the book of an asset (#437)', () => {
  it('is the "Anlagenbuch" unless the package of its kind gives it a name with the regulation', () => {
    expect(assetBookTitle(undefined)).toEqual({ title: 'Anlagenbuch', source: null })
    expect(assetBookTitle({ title: 'Betriebstagebuch', source: '§ 12 der 42. BImSchV' })).toEqual({
      title: 'Betriebstagebuch',
      source: '§ 12 der 42. BImSchV',
    })
  })

  it('lists the life cycle and the evidence in the order of time, the life cycle first on one day', () => {
    const lines = assetBookLines(
      [
        { state: 'out_of_service', validFrom: '2026-10-02' },
        { state: 'in_service', validFrom: '2026-07-06' },
      ],
      [
        evidence({ id: 'e-2' as EvidenceId, number: 'NW-2026-00133', performedOn: '2026-10-12' }),
        evidence({}),
      ],
      classes,
    )

    expect(lines.map((line) => [line.on, line.entry, line.number])).toEqual([
      ['2026-07-06', 'In Betrieb', null],
      ['2026-10-02', 'Außer Betrieb', null],
      ['2026-10-02', 'Nutzwasser im Labor untersuchen lassen', 'NW-2026-00126'],
      ['2026-10-12', 'Nutzwasser im Labor untersuchen lassen', 'NW-2026-00133'],
    ])
  })

  it('writes an evidence from its frozen state: the answers against their limit, the defects with class and deadline, who did it', () => {
    const [line] = assetBookLines([], [evidence({})], classes)

    expect(line).toEqual({
      on: '2026-10-02',
      kind: 'evidence',
      entry: 'Nutzwasser im Labor untersuchen lassen',
      number: 'NW-2026-00126',
      source: '§ 4 Abs. 2 Nr. 2 und Abs. 3 der 42. BImSchV',
      said:
        'Legionella spp.: 1.300 KBE/100 ml, höchstens 100 KBE/100 ml: nicht eingehalten; ' +
        'Akkreditiertes Prüflaboratorium: Labor Beispiel GmbH',
      defects: 'Mangel: Prüfwert 1 überschritten, erheblich, Frist 09.10.2026',
      result: 'Mit Mängeln',
      performer: 'Mara Roth, Labor Beispiel GmbH',
      mark: null,
      evidenceId: 'e-1',
    })
  })

  it('names no person of the operator who did the work, only an examiner from outside with the organisation', () => {
    const [own, outside] = assetBookLines(
      [],
      [
        evidence({ state: { ...labTest, performer: { person: 'Jana Weber' } } }),
        evidence({ id: 'e-2' as EvidenceId, number: 'NW-2026-00127' }),
      ],
      classes,
    )

    expect([own?.performer, outside?.performer]).toEqual([
      'Eigenes Personal',
      'Mara Roth, Labor Beispiel GmbH',
    ])
    expect(JSON.stringify(own)).not.toContain('Jana Weber')
  })

  it('keeps an evidence declared invalid, replaced, from the old stock or emptied, and says which', () => {
    const marks = assetBookLines(
      [],
      [
        evidence({ standing: 'voided', voidedFor: 'An der falschen Anlage erfasst' }),
        evidence({ id: 'e-2' as EvidenceId, number: 'NW-2026-00127', standing: 'replaced' }),
        evidence({
          id: 'e-3' as EvidenceId,
          number: 'NW-2026-00128',
          state: { ...labTest, origin: 'legacy' },
        }),
        evidence({ id: 'e-4' as EvidenceId, number: 'NW-2026-00129', state: null }),
      ],
      classes,
    ).map((line) => [line.number, line.mark, line.entry, line.said])

    expect(marks).toEqual([
      [
        'NW-2026-00126',
        'Für ungültig erklärt: An der falschen Anlage erfasst',
        'Nutzwasser im Labor untersuchen lassen',
        expect.any(String),
      ],
      ['NW-2026-00127', 'Ersetzt', 'Nutzwasser im Labor untersuchen lassen', expect.any(String)],
      [
        'NW-2026-00128',
        'Altbestand, ohne Unterschrift',
        'Nutzwasser im Labor untersuchen lassen',
        expect.any(String),
      ],
      [
        'NW-2026-00129',
        'Nach Ablauf der Aufbewahrung geleert',
        'Nutzwasser im Labor untersuchen lassen',
        null,
      ],
    ])
  })

  it('says of an answer within its limit that the limit was kept, and of a check point its result', () => {
    const [legionella] = labTest.answers

    expect(
      bookAnswerWords({
        ...legionella!,
        value: '40 KBE/100 ml',
        limit: { ...legionella!.limit!, within: true },
      }),
    ).toBe('Legionella spp.: 40 KBE/100 ml, höchstens 100 KBE/100 ml: eingehalten')
    expect(
      bookAnswerWords({
        ...legionella!,
        kind: 'check_point',
        label: 'Keine sichtbare Verschmutzung',
        value: null,
        limit: null,
        result: 'not_ok',
        remark: 'Belag am Tropfenabscheider',
      }),
    ).toBe('Keine sichtbare Verschmutzung: nicht in Ordnung, Belag am Tropfenabscheider')
  })

  it('heads with what the file knows of the asset, the fields of its kind among it', () => {
    expect(
      assetBookFacts({
        title: 'Betriebstagebuch',
        source: '§ 12 der 42. BImSchV',
        today: '2026-10-18',
        operator: 'Liegenschaften Beispielstadt',
        asset: 'AN-00120 Verdunstungskühlanlage Dach',
        kind: 'Verdunstungskühlanlage',
        place: 'Rathaus, Verwaltungsgebäude, Dach',
        address: 'Rathausplatz 1, 69115 Beispielstadt',
        commissionedOn: '2026-07-06',
        fields: [{ label: 'Anlagen-ID nach der 42. BImSchV', value: 'VKA-2026-0412' }],
      }).map((fact) => [fact.label, fact.value]),
    ).toEqual([
      ['Anlage', 'AN-00120 Verdunstungskühlanlage Dach'],
      ['Anlagenart', 'Verdunstungskühlanlage'],
      ['Anlagen-ID nach der 42. BImSchV', 'VKA-2026-0412'],
      ['Standort', 'Rathaus, Verwaltungsgebäude, Dach\nRathausplatz 1, 69115 Beispielstadt'],
      ['Betreiber', 'Liegenschaften Beispielstadt'],
      ['Erste Inbetriebnahme', '06.07.2026'],
    ])
  })

  it('counts its entries with the first and the last day', () => {
    expect(assetBookCountWords(['2026-10-02', '2026-07-13'], ['2026-07-06'])).toBe(
      '3 Einträge vom 06.07.2026 bis 02.10.2026: 2 Nachweise und 1 Eintrag des Lebenszyklus.',
    )
    expect(assetBookCountWords(['2026-10-02'], [])).toBe(
      '1 Eintrag am 02.10.2026: 1 Nachweis und 0 Einträge des Lebenszyklus.',
    )
    expect(assetBookCountWords([], [])).toBe(
      'Noch kein Eintrag: die Anlage hat keinen Nachweis und keinen Eintrag im Lebenszyklus.',
    )
  })

  it('is a table with a row per entry, the day as a day', () => {
    const rows = assetBookRows(
      assetBookLines([{ state: 'in_service', validFrom: '2026-07-06' }], [evidence({})], classes),
    )

    expect(rows.map((row) => row.slice(0, 5))).toEqual([
      [{ day: '2026-07-06' }, 'Lebenszyklus', 'In Betrieb', null, null],
      [
        { day: '2026-10-02' },
        'Nachweis',
        'Nutzwasser im Labor untersuchen lassen',
        '§ 4 Abs. 2 Nr. 2 und Abs. 3 der 42. BImSchV',
        'NW-2026-00126',
      ],
    ])
  })
})
