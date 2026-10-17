import {
  type IsoDate,
  readEvidenceState,
  type RoundRecordState,
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
