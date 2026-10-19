import { ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  type AnswerCircuit,
  answerFindings,
  answerFitProblem,
  answersMissing,
  answerVerdict,
  circuitOfAnswer,
  type FilledAnswer,
  formValuesOf,
} from './answer.js'
import { canonicalForm } from './canonical.js'
import { type FormDefinition, forms, type MeasurementField } from './forms.js'
import { type SignedPageParts, signedPageOf } from './signature.js'

/**
 * A form measured on the circuits of an installation (#350): one block for
 * each circuit, its key the id of the circuit, a measured value judged with
 * the facts of its circuit, every circuit asked before the signature, and a
 * defect at the installation with the circuit it was found on.
 */

const loopImpedance: MeasurementField = {
  kind: 'measurement',
  key: 'loop_impedance',
  label: 'Schleifenimpedanz Zs',
  unit: 'ohms',
  decimals: 2,
  limit: { kind: 'loop_impedance' },
}

const tripCurrent: MeasurementField = {
  kind: 'measurement',
  key: 'rcd_trip_current',
  label: 'Auslösestrom IΔ',
  unit: 'milliamperes',
  decimals: 1,
  limit: { kind: 'rcd_trip_current' },
}

const tripTime: MeasurementField = {
  kind: 'measurement',
  key: 'rcd_trip_time',
  label: 'Auslösezeit tΔ',
  unit: 'milliseconds',
  decimals: 0,
  limit: { kind: 'at_most', rule: 'elektro.rcd_trip_time_maximum' },
}

const protocol: FormDefinition = {
  key: 'elektro.installation_test',
  version: 1,
  title: 'Prüfung der elektrischen Anlage',
  sections: [
    {
      key: 'inspection',
      title: 'Besichtigen',
      fields: [{ kind: 'check_point', key: 'documentation', label: 'Unterlagen vorhanden' }],
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
            loopImpedance,
            tripCurrent,
            tripTime,
            { kind: 'check_point', key: 'circuit_ok', label: 'Stromkreis in Ordnung' },
          ],
        },
      ],
    },
  ],
}

const rules = ruleSet(
  [
    ['elektro.rcd_trip_time_maximum', 'milliseconds', 300, 'DIN EN 61008-1'],
    ['elektro.rcd_trip_current_maximum', 'basis_points', 10_000, 'DIN EN 61008-1, IΔn'],
    ['elektro.loop_nominal_voltage', 'volts', 230, 'DIN VDE 0100-410, 411.4.4'],
    ['elektro.loop_factor_b', 'factor', 5, 'DIN EN 60898-1, Typ B'],
    ['elektro.loop_factor_c', 'factor', 10, 'DIN EN 60898-1, Typ C'],
    ['elektro.loop_factor_d', 'factor', 20, 'DIN EN 60898-1, Typ D'],
  ].map(([key, unit, value, source]) => ({
    key: key as string,
    validFrom: '2017-06-01' as const,
    validUntil: null,
    unit: unit as 'factor',
    value: value as number,
    source: source as string,
  })),
)

// The first on the chart has the larger id: the chart, not the key, says the order.
const lighting: AnswerCircuit = {
  id: '0192f0c4-7b4e-7000-8000-0000000000f1',
  designation: 'F1',
  consumer: 'Licht Flur',
  tripCharacteristic: 'b',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
  board: 'UV 1',
  place: 0,
}

const workbench: AnswerCircuit = {
  id: '0192f0c4-7b4e-7000-8000-0000000000a3',
  designation: 'F3',
  consumer: 'Steckdosen Werkbank',
  tripCharacteristic: 'c',
  ratedCurrentMilli: 16_000,
  ratedResidualCurrentMilli: 30,
  board: 'UV 1',
  place: 1,
}

const gone = '0192f0c4-7b4e-7000-8000-0000000000e9'

const circuits = [workbench, lighting]
const context = { rules, on: '2026-10-19' as const, circuits }

function answer(fields: Partial<FilledAnswer> & Pick<FilledAnswer, 'fieldKey'>): FilledAnswer {
  return {
    groupKey: null,
    blockKey: null,
    value: null,
    result: null,
    remark: null,
    attachmentId: null,
    ...fields,
  }
}

function measured(circuit: string, fieldKey: string, value: number): FilledAnswer {
  return answer({ groupKey: 'circuits', blockKey: circuit, fieldKey, value: String(value) })
}

function judged(circuit: string, result: 'ok' | 'not_ok', remark: string | null = null) {
  return answer({ groupKey: 'circuits', blockKey: circuit, fieldKey: 'circuit_ok', result, remark })
}

/** Both circuits measured within their limits and judged in order. */
const complete: FilledAnswer[] = [
  answer({ fieldKey: 'documentation', result: 'ok' }),
  ...[lighting, workbench].flatMap(({ id }) => [
    measured(id, 'loop_impedance', 1_200),
    measured(id, 'rcd_trip_current', 21_000),
    measured(id, 'rcd_trip_time', 25_000),
    judged(id, 'ok'),
  ]),
]

describe('a block of a group over the circuits (#350)', () => {
  it('carries its circuit as the engine reads it, and a circuit not given is left out', () => {
    const values = formValuesOf(
      protocol,
      [...complete, measured(gone, 'loop_impedance', 900)],
      circuits,
    )
    const facts = ({ id: _id, board: _board, place: _place, ...rest }: AnswerCircuit) => rest

    expect(values['circuits']).toEqual([
      {
        itemId: workbench.id,
        item: facts(workbench),
        values: {
          loop_impedance: 1_200,
          rcd_trip_current: 21_000,
          rcd_trip_time: 25_000,
          circuit_ok: { result: 'ok' },
        },
      },
      {
        itemId: lighting.id,
        item: facts(lighting),
        values: {
          loop_impedance: 1_200,
          rcd_trip_current: 21_000,
          rcd_trip_time: 25_000,
          circuit_ok: { result: 'ok' },
        },
      },
    ])
    expect(forms.valuesProblem(protocol, values)).toBeNull()
  })

  it('is judged with the facts of its own circuit: the same value within on a B 16, outside on a C 16', () => {
    const value = answer({ fieldKey: 'loop_impedance', value: '1600' })

    expect(answerVerdict(loopImpedance, value, { ...context, circuit: lighting })).toEqual({
      within: true,
      limitMilli: 2_875,
      text: 'Innerhalb des Grenzwerts, höchstens 2,87 Ω.',
      source: 'DIN VDE 0100-410, 411.4.4; DIN EN 60898-1, Typ B',
    })
    expect(answerVerdict(loopImpedance, value, { ...context, circuit: workbench })).toEqual({
      within: false,
      limitMilli: 1_437,
      text: 'Außerhalb des Grenzwerts, höchstens 1,43 Ω.',
      source: 'DIN VDE 0100-410, 411.4.4; DIN EN 60898-1, Typ C',
    })
    // The tripping current is held to the rated residual current of the circuit.
    expect(
      answerVerdict(tripCurrent, answer({ fieldKey: 'rcd_trip_current', value: '31000' }), {
        ...context,
        circuit: workbench,
      }).within,
    ).toBe(false)
    // Without its circuit there is no limit to work out.
    expect(answerVerdict(loopImpedance, value, context).within).toBeNull()
  })

  it('names the circuit of its key among those given, and none for another place', () => {
    expect(circuitOfAnswer(protocol, measured(lighting.id, 'loop_impedance', 1), circuits)).toBe(
      lighting,
    )
    expect(circuitOfAnswer(protocol, measured(gone, 'loop_impedance', 1), circuits)).toBeNull()
    expect(circuitOfAnswer(protocol, complete[0] as FilledAnswer, circuits)).toBeNull()
  })

  it('takes an answer only for a circuit of the installation, where the circuits are handed in', () => {
    const elsewhere = measured(gone, 'loop_impedance', 900)

    expect(answerFitProblem(protocol, elsewhere, null, circuits)).toBe(
      '„Messen je Stromkreis“ fragt nur nach den Stromkreisen der Anlage des Vorgangs.',
    )
    expect(answerFitProblem(protocol, elsewhere, null, null)).toBe(
      '„Messen je Stromkreis“ fragt nur nach den Stromkreisen der Anlage des Vorgangs.',
    )
    expect(
      answerFitProblem(protocol, measured(lighting.id, 'loop_impedance', 900), null, circuits),
    ).toBeNull()
    // Where nobody hands the circuits in, the shape is asked and nothing more.
    expect(answerFitProblem(protocol, elsewhere)).toBeNull()
  })
})

describe('a form over the circuits, before it is signed (#350)', () => {
  it('has nothing missing once every circuit is answered', () => {
    expect(answersMissing(protocol, complete, context)).toEqual([])
  })

  it('asks a group over the circuits circuit by circuit, also where it is marked required', () => {
    const required: FormDefinition = {
      ...protocol,
      sections: protocol.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.kind === 'group' ? { ...field, required: true } : field,
        ),
      })),
    }

    expect(answersMissing(required, complete, context)).toEqual([])
  })

  it('misses every circuit without a block, named with the group and the circuit in the order of the chart', () => {
    expect(answersMissing(protocol, complete.slice(0, 1), context)).toEqual([
      'Messen je Stromkreis, F1 Licht Flur: Stromkreis in Ordnung fehlt.',
      'Messen je Stromkreis, F3 Steckdosen Werkbank: Stromkreis in Ordnung fehlt.',
    ])
  })

  it('misses a block of a circuit the installation does not have', () => {
    expect(
      answersMissing(protocol, [...complete, measured(gone, 'loop_impedance', 900)], context),
    ).toEqual(['Messen je Stromkreis: Antworten zu einem Stromkreis, den die Anlage nicht hat.'])
  })

  it('misses the remark of a value outside the limit of its circuit, named with the circuit', () => {
    const outside = [
      ...complete.filter(
        (each) => !(each.blockKey === workbench.id && each.fieldKey === 'loop_impedance'),
      ),
      measured(workbench.id, 'loop_impedance', 1_600),
    ]

    expect(answersMissing(protocol, outside, context)).toEqual([
      'Messen je Stromkreis, F3 Steckdosen Werkbank: Schleifenimpedanz Zs: außerhalb des Grenzwerts, die Bemerkung fehlt.',
    ])
    // The same value on the circuit of the lighting is within its limit.
    expect(
      answersMissing(
        protocol,
        [
          ...complete.filter(
            (each) => !(each.blockKey === lighting.id && each.fieldKey === 'loop_impedance'),
          ),
          measured(lighting.id, 'loop_impedance', 1_600),
        ],
        context,
      ),
    ).toEqual([])
  })
})

describe('what a form over the circuits comes to with the signature (#350)', () => {
  it('is a defect at the installation with the circuit it was found on, in the order of the chart', () => {
    const answers = [
      ...complete.filter(
        (each) => each.fieldKey !== 'loop_impedance' && each.fieldKey !== 'circuit_ok',
      ),
      measured(workbench.id, 'loop_impedance', 1_600),
      measured(lighting.id, 'loop_impedance', 3_000),
      judged(workbench.id, 'ok'),
      judged(lighting.id, 'not_ok', 'Klemme lose'),
    ]

    expect(
      answerFindings(protocol, answers, context).map(({ description, about, circuitId }) => ({
        description,
        about,
        circuitId,
      })),
    ).toEqual([
      {
        description:
          'Messen je Stromkreis, F1 Licht Flur: Schleifenimpedanz Zs: 3,00 Ω gemessen. Außerhalb des Grenzwerts, höchstens 2,87 Ω (DIN VDE 0100-410, 411.4.4; DIN EN 60898-1, Typ B).',
        about: null,
        circuitId: lighting.id,
      },
      {
        description:
          'Messen je Stromkreis, F3 Steckdosen Werkbank: Schleifenimpedanz Zs: 1,60 Ω gemessen. Außerhalb des Grenzwerts, höchstens 1,43 Ω (DIN VDE 0100-410, 411.4.4; DIN EN 60898-1, Typ C).',
        about: null,
        circuitId: workbench.id,
      },
      {
        description: 'Messen je Stromkreis, F1 Licht Flur: Stromkreis in Ordnung: Klemme lose',
        about: null,
        circuitId: lighting.id,
      },
    ])
  })

  it('names no circuit for an answer outside a group over the circuits', () => {
    const [finding] = answerFindings(
      protocol,
      [answer({ fieldKey: 'documentation', result: 'not_ok', remark: 'Fehlen' })],
      context,
    )

    expect(finding).toEqual({
      answer: answer({ fieldKey: 'documentation', result: 'not_ok', remark: 'Fehlen' }),
      description: 'Unterlagen vorhanden: Fehlen',
      about: null,
    })
  })
})

describe('the page of a form over the circuits (#350)', () => {
  const parts: SignedPageParts = {
    activity: {
      id: 'ac-1',
      kind: 'inspection',
      title: 'Prüfung der elektrischen Anlage',
      performedOn: '2026-10-19',
    },
    place: {
      property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
      building: null,
      room: null,
      asset: {
        id: 'as-1',
        name: 'Hauptverteilung',
        kind: 'elektro.low_voltage_installation',
        serialNumber: null,
      },
    },
    duties: [
      {
        dutyId: 'du-1',
        kind: 'elektro.installation_test_dguv_v3',
        label: null,
        result: 'without_defects',
        resultReason: null,
      },
    ],
    defects: [],
    form: { key: 'elektro.installation_test', version: 1 },
    answers: [answer({ fieldKey: 'instrument', value: '"Prüfgerät"' })],
  }
  // The fingerprint is taken over the canonical form: the same text, the same fingerprint.
  const fingerprint = (page: unknown) => canonicalForm(page)

  it('keeps the fingerprint it had before without circuits', () => {
    // Written out with the page as it was before #350.
    const before = String.raw`{"activity":{"id":"ac-1","kind":"inspection","performedOn":"2026-10-19","title":"Prüfung der elektrischen Anlage"},"answers":[{"attachmentId":null,"blockKey":null,"fieldKey":"instrument","groupKey":null,"remark":null,"result":null,"value":"\"Prüfgerät\""}],"defects":[],"duties":[{"dutyId":"du-1","kind":"elektro.installation_test_dguv_v3","label":null,"result":"without_defects","resultReason":null}],"form":{"key":"elektro.installation_test","version":1},"place":{"asset":{"id":"as-1","kind":"elektro.low_voltage_installation","name":"Hauptverteilung","serialNumber":null},"building":null,"property":{"address":"Hauptstraße 1, 68535 Edingen-Neckarhausen","name":"Campus"},"room":null}}`

    expect(fingerprint(signedPageOf(parts))).toBe(before)
    expect(fingerprint(signedPageOf({ ...parts, circuits: [] }))).toBe(before)
    expect(fingerprint(signedPageOf({ ...parts, circuits: null }))).toBe(before)
  })

  it('names the circuits by their keys, with what they are judged by and nothing else', () => {
    const page = signedPageOf({
      ...parts,
      circuits: [{ ...lighting, position: 3 } as AnswerCircuit, workbench],
    })

    expect(page.circuits).toEqual([workbench, lighting])
    expect(fingerprint(page)).not.toBe(fingerprint(signedPageOf(parts)))
    expect(fingerprint(page)).toBe(
      fingerprint(signedPageOf({ ...parts, circuits: [workbench, lighting] })),
    )
  })
})
