import {
  type IsoDate,
  readEvidenceState,
  type RoundRecordState,
  type StatedAnswer,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { evidencePrintJob, roundPrintJob } from './record-page.js'

/** A round as it was frozen, signed with a drawing and countersigned with the typed name. */
const record: RoundRecordState = {
  version: 1,
  title: 'Technikzentrale Schulhaus',
  place: {
    property: { name: 'Schulzentrum', address: 'Musterweg 1, 00001 Beispielstadt' },
    building: { name: 'Schulhaus', shortCode: null },
    room: null,
    asset: null,
  },
  dueOn: '2026-10-05' as IsoDate,
  performedOn: '2026-10-05' as IsoDate,
  form: { key: 'template-x', version: 3, title: 'Technikzentrale Schulhaus' },
  answers: [],
  performer: { person: 'Tobias Wendt' },
  defects: [],
  signatures: [
    {
      name: 'Tobias Wendt',
      role: 'signer',
      signedAt: '2026-10-05T05:38:00.000Z',
      path: 'M10,10L200,80',
      way: 'drawing',
      receivedAt: '2026-10-05T05:52:00.000Z',
    },
    {
      name: 'Dennis Roth',
      role: 'countersigner',
      signedAt: '2026-10-05T08:14:00.000Z',
      path: null,
      way: 'name',
      receivedAt: null,
    },
  ],
  evidence: [],
  writtenBy: 'Dennis Roth',
  writtenAt: '2026-10-05T08:14:30.000Z',
}

describe('the PDF of a round', () => {
  it('shows a drawn signature as its drawing and a typed one as the name with the way (#209)', () => {
    const { html } = roundPrintJob(record, 'a'.repeat(64), [])

    expect(html).toContain('d="M10,10L200,80"')
    expect(html).toContain('<span class="typed-name">Dennis Roth</span>')
    expect(html).toContain('mit getipptem Namen bestätigt')
    expect(html).not.toContain('Ohne Zeichnung eingefroren')
  })

  it('shows beside the moment of the device the one the server took a signature at (#79)', () => {
    const { html } = roundPrintJob(record, 'a'.repeat(64), [])

    expect(html).toContain(
      '<p class="muted">05.10.2026, 07:38</p><p class="muted">beim Server 05.10.2026, 07:52</p>',
    )
    // Nothing for a signature stated before the server kept it.
    expect(html.match(/beim Server/g)).toHaveLength(1)
  })
})

describe('the PDF of an evidence', () => {
  it('says of one written with a collective activity which one, and that its signature stands under all its assets (#342)', () => {
    const state = readEvidenceState({
      version: 9,
      number: 'NW-2026-00140',
      origin: 'protocol',
      performedOn: '2026-10-05',
      result: 'without_defects',
      resultReason: null,
      remark: null,
      replaces: null,
      nextDueOn: null,
      duty: {
        label: 'Prüfung der Feuerlöscher',
        kind: null,
        kindVersion: null,
        source: 'ASR A2.2',
        interval: { months: 24 },
        counting: 'from_performance',
      },
      place: record.place,
      activity: { kind: 'inspection', title: 'Prüfung der Feuerlöscher' },
      collective: { title: 'Prüfung der Feuerlöscher, Haus A', parts: 5 },
      form: null,
      answers: [],
      performer: { person: 'Tobias Wendt' },
      defects: [],
      signatures: record.signatures.slice(0, 1),
      files: [],
      retention: null,
      writtenBy: 'Tobias Wendt',
      writtenAt: '2026-10-05T05:41:02.000Z',
    })
    const { html } = evidencePrintJob(state, 'a'.repeat(64), [], null)

    expect(html).toContain(
      'Prüfung der Feuerlöscher, Haus A, 5 Anlagen. Die Unterschrift steht unter der Seite aller Anlagen.',
    )
  })
})

describe('the PDF of an evidence measured on circuits (#350)', () => {
  const zs = (
    circuit: string,
    value: string | null,
    limit: StatedAnswer['limit'],
  ): StatedAnswer => ({
    section: 'Messen',
    label: 'Schleifenimpedanz Zs',
    group: { label: 'Messen je Stromkreis', block: 1 },
    kind: 'measurement',
    value,
    result: null,
    remark: null,
    limit,
    photo: null,
    circuit,
    workedOut: 'loop_impedance',
  })
  const state = readEvidenceState({
    ...(readEvidenceState({
      version: 9,
      number: 'NW-2026-00163',
      origin: 'protocol',
      performedOn: '2026-10-16',
      result: 'with_defects',
      resultReason: null,
      remark: null,
      replaces: null,
      nextDueOn: null,
      duty: {
        label: 'Prüfung der elektrischen Anlage',
        kind: null,
        kindVersion: null,
        source: 'DGUV Vorschrift 3',
        interval: { months: 48 },
        counting: 'from_due',
      },
      place: record.place,
      activity: { kind: 'inspection', title: 'Prüfung der elektrischen Anlage' },
      collective: null,
      form: { key: 'elektro.installation_test', version: 1, title: 'Prüfung' },
      answers: [],
      performer: { person: 'Murat Yilmaz' },
      defects: [],
      signatures: [],
      files: [],
      retention: null,
      writtenBy: 'Murat Yilmaz',
      writtenAt: '2026-10-16T13:42:00.000Z',
    }) as object),
    version: 14,
    circuits: [
      {
        id: 'c-1',
        board: 'UV 1',
        boardKind: 'sub_distribution',
        designation: 'F14',
        consumer: 'Hallentor Tor 2',
        protection: null,
        place: 0,
      },
    ],
    answers: [
      zs('c-1', '0,88 Ω', null),
      {
        ...zs('c-1', null, null),
        label: 'Stromkreis in Ordnung',
        kind: 'check_point',
        result: 'not_ok',
        remark: 'Klemme lose',
        workedOut: undefined,
      },
    ],
  })

  it('says of a circuit without what its limit is worked out from that it has none', () => {
    const { html } = evidencePrintJob(state, 'a'.repeat(64), [], null)

    expect(html).toContain('<td class="muted protection">nicht erfasst</td>')
    expect(html).toContain('<td class="figure">0,88</td><td class="figure muted">keiner</td>')
    expect(html).toContain('ohne Angaben zur Schutzeinrichtung keiner für Zs.')
    // A check point of the circuit not in order stands with its remark.
    expect(html).toContain('Stromkreis in Ordnung: nicht in Ordnung, Klemme lose')
  })
})
