import { describe, expect, it } from 'vitest'

import { type RoundRecordState, roundTableColumns, roundTableRows } from './round-record.js'

/** A frozen round with a check point and a measured value in the second block of a group. */
const state: RoundRecordState = {
  version: 1,
  title: 'Technikzentrale Schulhaus',
  place: {
    property: { name: 'Schulzentrum Am Neckar', address: 'Neckarstraße 4, 68535 Edingen' },
    building: { name: 'Haus A', shortCode: null },
    room: { number: 'E.14', name: 'Heizraum' },
    asset: null,
  },
  dueOn: '2026-10-05',
  performedOn: '2026-10-05',
  form: null,
  answers: [
    {
      section: 'Heizraum',
      label: 'Tür schließt selbsttätig',
      group: null,
      kind: 'check_point',
      value: null,
      result: 'ok',
      remark: null,
      limit: null,
      photo: null,
    },
    {
      section: 'Heizraum',
      label: 'Vorlauftemperatur',
      group: { label: 'Kessel', block: 2 },
      kind: 'measurement',
      value: '74 °C',
      result: null,
      remark: 'Zu warm.',
      limit: { text: '60 bis 70 °C', source: null, within: false },
      photo: null,
    },
  ],
  performer: { person: 'Tobias Wendt' },
  defects: [],
  signatures: [],
  evidence: [],
  writtenBy: 'Tobias Wendt',
  writtenAt: '2026-10-05T08:00:00.000Z',
}

describe('a round as a table (#344)', () => {
  it('is a row a point, with its place, its block and its limit, and no person', () => {
    expect(roundTableColumns).toHaveLength(9)
    expect(roundTableRows(state, '2026-10-06')).toEqual([
      [
        '2026-10-06',
        'Technikzentrale Schulhaus',
        'Schulzentrum Am Neckar, Haus A, E.14 Heizraum',
        'Heizraum',
        'Tür schließt selbsttätig',
        'in Ordnung',
        null,
        null,
        null,
      ],
      [
        '2026-10-06',
        'Technikzentrale Schulhaus',
        'Schulzentrum Am Neckar, Haus A, E.14 Heizraum',
        'Heizraum',
        'Kessel 2: Vorlauftemperatur',
        '74 °C',
        '60 bis 70 °C',
        'nein',
        'Zu warm.',
      ],
    ])
    expect(JSON.stringify(roundTableRows(state, '2026-10-06'))).not.toContain('Tobias Wendt')
  })
})
