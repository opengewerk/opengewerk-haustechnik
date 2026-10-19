import {
  type ChartCircuit,
  circuitsInChartOrder,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { blockCircuits, ordered } from './electrical.js'

/**
 * The order of the circuit chart twice (#350): the foundation lists the
 * blocks of a form on the screen (`blockCircuits`), the domain of this
 * application lists the circuits of the page that is signed
 * (`circuitsInChartOrder`), on the device and on the server. Should the two
 * part, the screen would show the circuits in another order than the page,
 * the evidence and the PDF; this holds them together on one sample.
 */

const boards: readonly RecordState[] = [
  { id: 'b-uv', kind: 'sub_distribution', designation: 'UV 1', position: 1 },
  { id: 'b-hv', kind: 'main_distribution', designation: 'HV 1', position: 0 },
  // The same place as UV 1: the designation decides, then the key.
  { id: 'b-uv0', kind: 'sub_distribution', designation: 'UV 0', position: 1 },
]

const sections: readonly RecordState[] = [
  { id: 's-2', distributionBoardId: 'b-hv', designation: 'Feld 2', position: 2 },
  { id: 's-1', distributionBoardId: 'b-hv', designation: 'Feld 1', position: 1 },
  { id: 's-uv', distributionBoardId: 'b-uv', designation: 'Feld 1', position: 0 },
]

const circuit = (
  id: string,
  distributionBoardId: string,
  boardSectionId: string | null,
  designation: string,
  position: number,
): RecordState => ({
  id,
  distributionBoardId,
  boardSectionId,
  designation,
  consumer: null,
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
  position,
})

const circuits: readonly RecordState[] = [
  circuit('c-1', 'b-uv', null, 'F10', 0),
  circuit('c-2', 'b-uv', null, 'F2', 0),
  circuit('c-3', 'b-uv', 's-uv', 'F1', 0),
  circuit('c-4', 'b-hv', 's-2', 'F7', 1),
  circuit('c-5', 'b-hv', 's-2', 'F5', 1),
  circuit('c-6', 'b-hv', 's-1', 'Q1', 0),
  circuit('c-7', 'b-hv', null, 'F9', 3),
  circuit('c-8', 'b-hv', 's-gone', 'F8', 3),
  circuit('c-9', 'b-uv0', null, 'F1', 0),
  // Put first on its board, and so first however it is named.
  circuit('c-10', 'b-uv', null, 'F99', -1),
]

describe('the order of the circuit chart (#350)', () => {
  it('is the same as the foundation lists the blocks of a form', () => {
    const plain = (record: RecordState) => ({
      id: String(record['id']),
      designation: String(record['designation']),
      position: Number(record['position']),
    })
    const charted = circuitsInChartOrder(
      boards.map((board) => ({
        ...plain(board),
        kind: board['kind'] as 'main_distribution' | 'sub_distribution',
      })),
      sections.map((section) => ({
        ...plain(section),
        distributionBoardId: String(section['distributionBoardId']),
      })),
      circuits.map((record): ChartCircuit => ({
        ...plain(record),
        distributionBoardId: String(record['distributionBoardId']),
        boardSectionId: record['boardSectionId'] as string | null,
        consumer: null,
        tripCharacteristic: 'b',
        ratedCurrentMilli: 16_000,
        ratedResidualCurrentMilli: 30,
      })),
    )
    // The foundation takes the boards in the order of the chart, as the screen holds them.
    const listed = blockCircuits(ordered(boards), sections, circuits)

    expect(charted.map((each) => each.id)).toEqual(listed.map((each) => each.id))
    expect(charted.map((each) => each.id)).toEqual([
      'c-8',
      'c-7',
      'c-6',
      'c-5',
      'c-4',
      'c-9',
      'c-10',
      'c-2',
      'c-1',
      'c-3',
    ])
  })
})
