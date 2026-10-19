import { ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  asksCircuits,
  boundOf,
  type FilledAnswer,
  pageAsksCircuits,
  statedAnswers,
  statedCircuitsOf,
} from './answer.js'
import { canonicalForm } from './canonical.js'
import {
  type ChartBoard,
  type ChartCircuit,
  type ChartSection,
  circuitProtectionWords,
  circuitsInChartOrder,
} from './electrical.js'
import { readEvidenceState, statedPointWords } from './evidence.js'
import type { FormDefinition } from './forms.js'
import type { FormVersions } from './round-template.js'
import { type HeldRecord, heldPageOf } from './signature.js'

/**
 * The circuits of an installation as a form over them takes them (#350): in
 * the order of the chart, the same on the device and on the server, on the
 * page that is signed only where the form asks for them, and in the
 * evidence with what a table of the circuits shows.
 */

const board = (id: string, designation: string, position: number): ChartBoard => ({
  id,
  kind: position === 0 ? 'main_distribution' : 'sub_distribution',
  designation,
  position,
})

const section = (
  id: string,
  distributionBoardId: string,
  designation: string,
  position: number,
): ChartSection => ({ id, distributionBoardId, designation, position })

const circuit = (
  id: string,
  distributionBoardId: string,
  boardSectionId: string | null,
  designation: string,
  position = 0,
): ChartCircuit => ({
  id,
  distributionBoardId,
  boardSectionId,
  designation,
  consumer: `Verbraucher ${designation}`,
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
  position,
})

describe('the order of the circuit chart (#350)', () => {
  const boards = [board('b-sub', 'UV 1', 1), board('b-main', 'HV 1', 0)]
  const sections = [
    section('s-2', 'b-main', 'Feld 2', 2),
    section('s-1', 'b-main', 'Feld 1', 1),
    section('s-other', 'b-elsewhere', 'Feld 1', 1),
  ]
  const circuits = [
    circuit('c-f10', 'b-sub', null, 'F10'),
    circuit('c-f2', 'b-sub', null, 'F2'),
    circuit('c-f5', 'b-main', 's-2', 'F5'),
    circuit('c-q1', 'b-main', 's-1', 'Q1'),
    circuit('c-direct', 'b-main', null, 'F0'),
    // Its section is gone: it stands on the board directly, as the chart prints it.
    circuit('c-lost', 'b-main', 's-gone', 'F9'),
    circuit('c-other', 'b-elsewhere', 's-other', 'F1'),
  ]

  it('goes board by board, the circuits on the board first, then section by section, F2 before F10', () => {
    expect(
      circuitsInChartOrder(boards, sections, circuits).map(({ id, board: on, place }) => [
        id,
        on,
        place,
      ]),
    ).toEqual([
      ['c-direct', 'HV 1', 0],
      ['c-lost', 'HV 1', 1],
      ['c-q1', 'HV 1', 2],
      ['c-f5', 'HV 1', 3],
      ['c-f2', 'UV 1', 4],
      ['c-f10', 'UV 1', 5],
    ])
  })

  it('keeps what a block is judged with and the kind of the board, and nothing of the place it was put', () => {
    expect(circuitsInChartOrder(boards, sections, circuits)[2]).toStrictEqual({
      id: 'c-q1',
      designation: 'Q1',
      consumer: 'Verbraucher Q1',
      tripCharacteristic: 'b',
      ratedCurrentMilli: 16_000,
      ratedResidualCurrentMilli: 30,
      board: 'HV 1',
      boardKind: 'main_distribution',
      place: 2,
    })
  })

  it('has no circuit without a board', () => {
    expect(circuitsInChartOrder([], sections, circuits)).toEqual([])
  })
})

describe('what protects a circuit, in words (#350)', () => {
  const facts = {
    tripCharacteristic: null,
    ratedCurrentMilli: null,
    ratedResidualCurrentMilli: null,
  }

  it('names the characteristic with the rated current and the RCD', () => {
    expect(
      circuitProtectionWords({
        tripCharacteristic: 'b',
        ratedCurrentMilli: 16_000,
        ratedResidualCurrentMilli: 30,
      }),
    ).toBe('B 16 A, RCD 30 mA')
    expect(
      circuitProtectionWords({ ...facts, tripCharacteristic: 'c', ratedCurrentMilli: 63_000 }),
    ).toBe('C 63 A')
    expect(circuitProtectionWords({ ...facts, ratedCurrentMilli: 6_000 })).toBe('6 A')
  })

  it('says nothing where nothing a limit is worked out from is known', () => {
    expect(circuitProtectionWords(facts)).toBeNull()
    expect(circuitProtectionWords({ ...facts, tripCharacteristic: 'b' })).toBeNull()
  })
})

const measured: FormDefinition = {
  key: 'elektro.installation_test',
  version: 1,
  title: 'Prüfung der elektrischen Anlage',
  sections: [
    {
      key: 'general',
      title: 'Prüfung',
      fields: [{ kind: 'text', key: 'instrument', label: 'Messgerät' }],
    },
    {
      key: 'measurements',
      title: 'Messen',
      fields: [
        {
          kind: 'group',
          key: 'circuits',
          label: 'Messen je Stromkreis',
          repeat: 'circuits',
          fields: [
            {
              kind: 'measurement',
              key: 'protective_conductor',
              label: 'Durchgängigkeit des Schutzleiters RPE',
              unit: 'ohms',
              decimals: 2,
            },
            {
              kind: 'measurement',
              key: 'loop_impedance',
              label: 'Schleifenimpedanz Zs',
              unit: 'ohms',
              decimals: 2,
              limit: { kind: 'loop_impedance' },
            },
          ],
        },
      ],
    },
  ],
}

const unmeasured: FormDefinition = {
  ...measured,
  key: 'elektro.installation_report',
  sections: measured.sections.slice(0, 1),
}

const catalogue: FormVersions = {
  formVersion: (key, version) => {
    const form = [measured, unmeasured].find((each) => each.key === key && each.version === version)

    return form === undefined ? null : { key, version, definition: form }
  },
}

describe('a form over the circuits on the page that is signed (#350)', () => {
  it('is a form with a group over the circuits', () => {
    expect(asksCircuits(measured)).toBe(true)
    expect(asksCircuits(unmeasured)).toBe(false)
    expect(
      asksCircuits({
        sections: [
          {
            key: 'lights',
            title: 'Leuchten',
            fields: [
              {
                kind: 'group',
                key: 'lights',
                label: 'Leuchte',
                repeat: 'free',
                fields: [{ kind: 'check_point', key: 'lights_up', label: 'Leuchtet' }],
              },
            ],
          },
        ],
      }),
    ).toBe(false)
  })

  it('asks the circuits of the asset only for such a form out of the catalogue, at an asset', () => {
    const at = { formKey: measured.key, formVersion: 1, assetId: 'as-1' }

    expect(pageAsksCircuits(catalogue, at)).toBe(true)
    expect(pageAsksCircuits(catalogue, { ...at, assetId: null })).toBe(false)
    expect(pageAsksCircuits(catalogue, { ...at, formKey: unmeasured.key })).toBe(false)
    expect(pageAsksCircuits(catalogue, { ...at, formVersion: 2 })).toBe(false)
    expect(pageAsksCircuits(null, at)).toBe(false)
  })

  const held = (formKey: string): Readonly<Record<string, readonly HeldRecord[]>> => ({
    activities: [
      {
        id: 'ac-1',
        kind: 'inspection',
        title: 'Prüfung der elektrischen Anlage',
        performedOn: '2026-10-19',
        propertyId: 'pr-1',
        assetId: 'as-1',
        formKey,
        formVersion: 1,
        collectiveKind: null,
        deletedAt: null,
      },
    ],
    properties: [
      {
        id: 'pr-1',
        name: 'Werkhof Nord',
        street: 'Lagerweg 12',
        postalCode: '00002',
        city: 'Beispielstadt',
      },
    ],
    assets: [
      {
        id: 'as-1',
        name: 'Elektrische Anlage Halle 1',
        kind: 'elektro.low_voltage_installation',
        serialNumber: null,
      },
    ],
    distribution_boards: [
      {
        id: 'b-sub',
        assetId: 'as-1',
        kind: 'sub_distribution',
        designation: 'UV 1',
        position: 1,
        deletedAt: null,
      },
      {
        id: 'b-main',
        assetId: 'as-1',
        kind: 'main_distribution',
        designation: 'HV 1',
        position: 0,
        deletedAt: null,
      },
      {
        id: 'b-gone',
        assetId: 'as-1',
        kind: 'sub_distribution',
        designation: 'UV 2',
        position: 2,
        deletedAt: '2026-10-18T10:00:00.000Z',
      },
      {
        id: 'b-other',
        assetId: 'as-2',
        kind: 'main_distribution',
        designation: 'HV 9',
        position: 0,
        deletedAt: null,
      },
    ],
    board_sections: [
      {
        id: 's-1',
        distributionBoardId: 'b-main',
        designation: 'Feld 1',
        position: 1,
        deletedAt: null,
      },
    ],
    circuits: [
      {
        id: 'c-f1',
        distributionBoardId: 'b-sub',
        boardSectionId: null,
        designation: 'F1',
        consumer: 'Licht',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 10_000,
        ratedResidualCurrentMilli: 30,
        position: 1,
        deletedAt: null,
      },
      {
        id: 'c-q1',
        distributionBoardId: 'b-main',
        boardSectionId: 's-1',
        designation: 'Q1',
        consumer: 'Zuleitung UV 1',
        tripCharacteristic: 'c',
        ratedCurrentMilli: 63_000,
        ratedResidualCurrentMilli: null,
        position: 1,
        deletedAt: null,
      },
      {
        id: 'c-marked',
        distributionBoardId: 'b-sub',
        boardSectionId: null,
        designation: 'F2',
        consumer: null,
        tripCharacteristic: null,
        ratedCurrentMilli: null,
        ratedResidualCurrentMilli: null,
        position: 2,
        deletedAt: '2026-10-18T10:00:00.000Z',
      },
      {
        id: 'c-on-gone',
        distributionBoardId: 'b-gone',
        boardSectionId: null,
        designation: 'F1',
        consumer: null,
        tripCharacteristic: null,
        ratedCurrentMilli: null,
        ratedResidualCurrentMilli: null,
        position: 1,
        deletedAt: null,
      },
      {
        id: 'c-other',
        distributionBoardId: 'b-other',
        boardSectionId: null,
        designation: 'F1',
        consumer: null,
        tripCharacteristic: null,
        ratedCurrentMilli: null,
        ratedResidualCurrentMilli: null,
        position: 1,
        deletedAt: null,
      },
    ],
  })
  const pageOf = (formKey: string, given: FormVersions | null = catalogue) => {
    const holding = held(formKey)

    return heldPageOf(
      {
        find: (entity, id) => holding[entity]?.find((each) => each['id'] === id) ?? null,
        related: (entity, field, id) =>
          (holding[entity] ?? []).filter((each) => each[field] === id),
      },
      'ac-1',
      given,
    )
  }

  it('names every circuit of the asset that is not marked, on a board that is not, with its board and place', () => {
    expect(pageOf(measured.key)?.circuits).toStrictEqual([
      {
        id: 'c-f1',
        designation: 'F1',
        consumer: 'Licht',
        tripCharacteristic: 'b',
        ratedCurrentMilli: 10_000,
        ratedResidualCurrentMilli: 30,
        board: 'UV 1',
        place: 1,
      },
      {
        id: 'c-q1',
        designation: 'Q1',
        consumer: 'Zuleitung UV 1',
        tripCharacteristic: 'c',
        ratedCurrentMilli: 63_000,
        ratedResidualCurrentMilli: null,
        board: 'HV 1',
        place: 0,
      },
    ])
  })

  it('stays the page it was for a form without such a group, and without the catalogue', () => {
    const before = pageOf(unmeasured.key, null)

    expect(before?.circuits).toBeUndefined()
    expect(canonicalForm(pageOf(unmeasured.key))).toBe(canonicalForm(before))
    expect(pageOf(measured.key, null)?.circuits).toBeUndefined()
  })
})

describe('the circuits in the evidence (#350)', () => {
  const rules = ruleSet(
    [
      ['elektro.loop_nominal_voltage', 'volts', 230, 'DIN VDE 0100-410, 411.4.4'],
      ['elektro.loop_factor_b', 'factor', 5, 'DIN EN 60898-1, Typ B'],
    ].map(([key, unit, value, source]) => ({
      key: key as string,
      validFrom: '2017-06-01' as const,
      validUntil: null,
      unit: unit as 'factor',
      value: value as number,
      source: source as string,
    })),
  )
  // The first on the chart has the larger key: the chart, not the key, places a block.
  const charted = circuitsInChartOrder(
    [board('b-main', 'HV 1', 0)],
    [],
    [
      { ...circuit('c-a3', 'b-main', null, 'F3', 2), consumer: 'Steckdosen Werkbank' },
      { ...circuit('c-z1', 'b-main', null, 'F1', 1), tripCharacteristic: null },
    ],
  )
  const answer = (blockKey: string, fieldKey: string, value: string): FilledAnswer => ({
    groupKey: 'circuits',
    blockKey,
    fieldKey,
    value,
    result: null,
    remark: null,
    attachmentId: null,
  })
  const stated = statedAnswers(
    measured,
    [
      answer('c-a3', 'loop_impedance', '3400'),
      answer('c-z1', 'loop_impedance', '900'),
      answer('c-z1', 'protective_conductor', '420'),
    ],
    { rules, on: '2026-10-19', circuits: charted, fileOf: () => null },
  )

  it('names the circuit of each answer of a block, at its place on the chart, with the limit beside the value', () => {
    expect(
      stated.map(({ label, group, circuit: of, workedOut, limit, value }) => ({
        label,
        group,
        of,
        workedOut,
        bound: limit?.bound,
        within: limit?.within,
        value,
      })),
    ).toEqual([
      {
        label: 'Durchgängigkeit des Schutzleiters RPE',
        group: { label: 'Messen je Stromkreis', block: 1 },
        of: 'c-z1',
        workedOut: undefined,
        bound: undefined,
        within: undefined,
        value: '0,42 Ω',
      },
      // Without its characteristic the circuit gives no limit, and the kind says why.
      {
        label: 'Schleifenimpedanz Zs',
        group: { label: 'Messen je Stromkreis', block: 1 },
        of: 'c-z1',
        workedOut: 'loop_impedance',
        bound: undefined,
        within: undefined,
        value: '0,90 Ω',
      },
      {
        label: 'Schleifenimpedanz Zs',
        group: { label: 'Messen je Stromkreis', block: 2 },
        of: 'c-a3',
        workedOut: 'loop_impedance',
        bound: 'höchstens 2,87 Ω',
        within: false,
        value: '3,40 Ω',
      },
    ])
  })

  it('keeps the circuits in the order of the chart, with what protects them in words', () => {
    expect(statedCircuitsOf([...charted].reverse())).toStrictEqual([
      {
        id: 'c-z1',
        board: 'HV 1',
        boardKind: 'main_distribution',
        designation: 'F1',
        consumer: 'Verbraucher F1',
        protection: '16 A, RCD 30 mA',
        place: 0,
      },
      {
        id: 'c-a3',
        board: 'HV 1',
        boardKind: 'main_distribution',
        designation: 'F3',
        consumer: 'Steckdosen Werkbank',
        protection: 'B 16 A, RCD 30 mA',
        place: 1,
      },
    ])
  })

  it('names the point of an answer with its circuit, and by the place of its block without the circuits', () => {
    const last = stated[2]

    if (last === undefined) {
      throw new Error('The answer of F3 is stated.')
    }

    expect(statedPointWords(last, statedCircuitsOf(charted))).toBe(
      'Messen je Stromkreis, F3 Steckdosen Werkbank: Schleifenimpedanz Zs',
    )
    expect(statedPointWords(last)).toBe('Messen je Stromkreis 2: Schleifenimpedanz Zs')
  })

  it('takes the limit out of each sentence of a verdict, and nothing out of any other', () => {
    expect(boundOf('Grenzwert: höchstens 2,87 Ω.')).toEqual({ bound: 'höchstens 2,87 Ω' })
    expect(boundOf('Innerhalb des Grenzwerts, mindestens 1,00 MΩ.')).toEqual({
      bound: 'mindestens 1,00 MΩ',
    })
    expect(boundOf('Außerhalb des Grenzwerts, unter 2,88 Ω.')).toEqual({ bound: 'unter 2,88 Ω' })
    expect(boundOf('Kein Grenzwert.')).toEqual({})
  })

  it('reads a state with circuits as it was written', () => {
    const stored = { version: 14, circuits: statedCircuitsOf(charted), answers: stated }

    expect(readEvidenceState(stored)).toBe(stored)
  })
})
