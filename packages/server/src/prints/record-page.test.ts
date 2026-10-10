import type { IsoDate, RoundRecordState } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { roundPrintJob } from './record-page.js'

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
