import { type AttachmentId, ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  answerFindings,
  answerFitProblem,
  answerProblems,
  answersMissing,
  type FilledAnswer,
  formValuesOf,
  statedAnswers,
} from './answer.js'
import type { FormDefinition } from './forms.js'
import { type SignedPage, signedPageOf } from './signature.js'

const room = '0192f0c4-7b4e-7000-8000-000000000001'
const photo = '0192f0c4-7b4e-7000-8000-0000000000aa' as AttachmentId

/** A protocol with a check point about a room, a measured value, a choice, a photo and a free group. */
const protocol: FormDefinition = {
  key: 'probe.drinking_water_protocol',
  version: 2,
  title: 'Prüfprotokoll Trinkwasser',
  sections: [
    {
      key: 'look',
      title: 'Sichtprüfung',
      fields: [
        {
          kind: 'check_point',
          key: 'room_tidy',
          label: 'Raum aufgeräumt',
          about: { kind: 'room', id: room },
        },
        {
          kind: 'choice',
          key: 'sampling',
          label: 'Probenahme',
          required: true,
          options: [
            { value: 'taken', label: 'genommen' },
            { value: 'none', label: 'keine' },
          ],
        },
        { kind: 'photo', key: 'plate', label: 'Typenschild' },
      ],
    },
    {
      key: 'measured',
      title: 'Messwerte',
      fields: [
        {
          kind: 'measurement',
          key: 'outlet',
          label: 'Temperatur am Speicheraustritt',
          unit: 'degrees_celsius',
          decimals: 1,
          limit: { kind: 'at_least', rule: 'probe.hot_water_minimum' },
        },
        {
          kind: 'group',
          key: 'branches',
          label: 'Abgänge',
          repeat: 'free',
          fields: [{ kind: 'check_point', key: 'insulation', label: 'Dämmung' }],
        },
      ],
    },
  ],
}

const rules = ruleSet([
  {
    key: 'probe.hot_water_minimum',
    validFrom: '2015-06-01',
    validUntil: null,
    unit: 'decidegrees_celsius',
    value: 600,
    source: 'DVGW W 551',
  },
])

const context = { rules, on: '2026-10-07' as const }

const empty = {
  groupKey: null,
  blockKey: null,
  value: null,
  result: null,
  remark: null,
  attachmentId: null,
}

function answer(fields: Partial<FilledAnswer> & Pick<FilledAnswer, 'fieldKey'>): FilledAnswer {
  return { ...empty, ...fields }
}

/** Every point answered, the measured value within its limit, one block of the group. */
const complete: FilledAnswer[] = [
  answer({ fieldKey: 'room_tidy', result: 'ok' }),
  answer({ fieldKey: 'sampling', value: '"taken"' }),
  answer({ fieldKey: 'outlet', value: '61500' }),
  answer({ groupKey: 'branches', blockKey: 'b-1', fieldKey: 'insulation', result: 'ok' }),
]

describe('an answer as it arrives', () => {
  it('names its field, and a group with its block or neither', () => {
    expect(answerProblems({ fieldKey: 'room_tidy', groupKey: null, blockKey: null })).toEqual({})
    expect(answerProblems({ fieldKey: null })).toEqual({ fieldKey: 'Eine Antwort nennt ihr Feld.' })
    expect(answerProblems({ fieldKey: 'Raum aufgeräumt' })).toEqual({
      fieldKey: 'Eine Antwort nennt ihr Feld.',
    })
    expect(
      answerProblems({ fieldKey: 'insulation', groupKey: 'branches', blockKey: null }),
    ).toEqual({
      blockKey:
        'Ein Block gehört zu einer Gruppe, und eine Antwort in einer Gruppe nennt ihren Block.',
    })
    expect(answerProblems({ fieldKey: 'insulation', groupKey: null, blockKey: 'b-1' })).toEqual({
      blockKey:
        'Ein Block gehört zu einer Gruppe, und eine Antwort in einer Gruppe nennt ihren Block.',
    })
    expect(
      answerProblems({ fieldKey: 'insulation', groupKey: 'branches', blockKey: 'b 1' }),
    ).toEqual({
      blockKey: 'Der Block hat keinen gültigen Schlüssel.',
    })
  })

  it('holds a value as JSON, a result of a check point and a remark within its bounds', () => {
    expect(answerProblems({ value: '{"name":' })).toEqual({
      value: 'Das ist kein Wert eines Formulars.',
    })
    expect(answerProblems({ result: 'fine' })).toEqual({
      result: 'Ein Prüfpunkt ist in Ordnung, nicht in Ordnung, entfällt oder ist nicht möglich.',
    })
    expect(answerProblems({ remark: 'x'.repeat(4001) })).toEqual({
      remark: 'Die Bemerkung hat höchstens 4000 Zeichen.',
    })
    expect(answerProblems({ value: '1', result: 'ok' })).toEqual({
      value: 'Ein Prüfpunkt hält sein Ergebnis und keinen Wert.',
    })
  })
})

describe('an answer in the form of its activity', () => {
  it('is about a field the form has, where the form has it', () => {
    expect(answerFitProblem(protocol, answer({ fieldKey: 'room_tidy', result: 'ok' }))).toBeNull()
    expect(answerFitProblem(protocol, answer({ fieldKey: 'gone', result: 'ok' }))).toBe(
      'Das Feld gone gibt es in Prüfprotokoll Trinkwasser nicht.',
    )
    // A field of a group is answered in a block, never outside it.
    expect(answerFitProblem(protocol, answer({ fieldKey: 'insulation', result: 'ok' }))).toBe(
      'Das Feld insulation gibt es in Prüfprotokoll Trinkwasser nicht.',
    )
    expect(
      answerFitProblem(
        protocol,
        answer({ groupKey: 'branches', blockKey: 'b-1', fieldKey: 'room_tidy', result: 'ok' }),
      ),
    ).toBe('Das Feld room_tidy gibt es in der Gruppe branches von Prüfprotokoll Trinkwasser nicht.')
  })

  it('fills the columns its kind fills, with a value the field takes', () => {
    expect(answerFitProblem(protocol, answer({ fieldKey: 'room_tidy' }))).toBe(
      'Raum aufgeräumt: in Ordnung, nicht in Ordnung, entfällt oder nicht möglich.',
    )
    expect(answerFitProblem(protocol, answer({ fieldKey: 'sampling', value: '"kept"' }))).toBe(
      'Probenahme: eine der angebotenen Möglichkeiten.',
    )
    expect(
      answerFitProblem(protocol, answer({ fieldKey: 'sampling', value: '"none"', remark: 'Nein' })),
    ).toBe('Probenahme: ein Wert und sonst nichts.')
    expect(
      answerFitProblem(protocol, answer({ fieldKey: 'plate', attachmentId: photo })),
    ).toBeNull()
    expect(answerFitProblem(protocol, answer({ fieldKey: 'plate', value: '"x"' }))).toBe(
      'Typenschild: ein Foto aus den Dokumenten des Vorgangs.',
    )
    expect(answerFitProblem(protocol, answer({ fieldKey: 'outlet', value: '"warm"' }))).toBe(
      'Temperatur am Speicheraustritt: eine Zahl.',
    )
    expect(
      answerFitProblem(
        protocol,
        answer({ fieldKey: 'outlet', value: '57500', remark: 'Heizt nach.' }),
      ),
    ).toBeNull()
  })

  it('makes the values of the form, the blocks of a group in the order of their keys', () => {
    expect(
      formValuesOf(protocol, [
        answer({ fieldKey: 'room_tidy', result: 'not_ok', remark: 'Kartons', attachmentId: photo }),
        answer({ groupKey: 'branches', blockKey: 'b-2', fieldKey: 'insulation', result: 'ok' }),
        answer({ fieldKey: 'outlet', value: '61500' }),
        answer({
          groupKey: 'branches',
          blockKey: 'b-1',
          fieldKey: 'insulation',
          result: 'not_applicable',
          remark: 'Neu',
        }),
      ]),
    ).toEqual({
      room_tidy: { result: 'not_ok', remark: 'Kartons', photo },
      outlet: 61_500,
      branches: [
        { values: { insulation: { result: 'not_applicable', remark: 'Neu' } } },
        { values: { insulation: { result: 'ok' } } },
      ],
    })
  })
})

describe('an activity with a form, before it is signed', () => {
  it('has nothing missing once every point is answered', () => {
    expect(answersMissing(protocol, complete, context)).toEqual([])
  })

  it('misses every point without an answer, a check point included that nobody marked required', () => {
    expect(answersMissing(protocol, [], context)).toEqual([
      'Raum aufgeräumt fehlt.',
      'Probenahme fehlt.',
    ])
  })

  it('misses the remark of every answer other than in order, in a block too', () => {
    const missing = answersMissing(
      protocol,
      [
        ...complete.slice(1, 3),
        answer({ fieldKey: 'room_tidy', result: 'not_possible' }),
        answer({
          groupKey: 'branches',
          blockKey: 'b-1',
          fieldKey: 'insulation',
          result: 'not_ok',
          remark: ' ',
        }),
      ],
      context,
    )

    expect(missing).toHaveLength(2)
    expect(missing[0]).toMatch(/^Raum aufgeräumt/)
    expect(missing[1]).toMatch(/^Abgänge, Block 1: Dämmung/)
  })

  it('misses the remark of a measured value outside its limit', () => {
    const outside = [
      ...complete.filter((each) => each.fieldKey !== 'outlet'),
      answer({ fieldKey: 'outlet', value: '57500' }),
    ]

    expect(answersMissing(protocol, outside, context)).toEqual([
      'Temperatur am Speicheraustritt: außerhalb des Grenzwerts, die Bemerkung fehlt.',
    ])
    expect(
      answersMissing(
        protocol,
        [
          ...outside.slice(0, -1),
          answer({ fieldKey: 'outlet', value: '57500', remark: 'Heizt nach.' }),
        ],
        context,
      ),
    ).toEqual([])
  })
})

describe('what the answers come to with the signature', () => {
  it('is a defect for a check point not in order and a measured value outside its limit, nothing else', () => {
    const findings = answerFindings(
      protocol,
      [
        answer({ fieldKey: 'outlet', value: '57500', remark: 'Speicher heizt nach.' }),
        answer({ fieldKey: 'room_tidy', result: 'not_ok', remark: 'Kartons vor dem Verteiler.' }),
        answer({
          groupKey: 'branches',
          blockKey: 'b-1',
          fieldKey: 'insulation',
          result: 'not_ok',
          remark: 'Lose.',
        }),
        answer({
          groupKey: 'branches',
          blockKey: 'b-2',
          fieldKey: 'insulation',
          result: 'not_possible',
          remark: 'Verbaut.',
        }),
        answer({ fieldKey: 'sampling', value: '"taken"' }),
      ],
      context,
    )

    expect(findings.map(({ description, about }) => [description, about])).toEqual([
      ['Raum aufgeräumt: Kartons vor dem Verteiler.', { kind: 'room', id: room }],
      [
        'Temperatur am Speicheraustritt: 57,5 °C gemessen. Außerhalb des Grenzwerts, mindestens 60,0 °C (DVGW W 551). Speicher heizt nach.',
        null,
      ],
      ['Abgänge, Block 1: Dämmung: Lose.', null],
    ])
    expect(answerFindings(protocol, complete, context)).toEqual([])
  })
})

describe('the answers an evidence freezes', () => {
  it('stand in the order of the form, in words, with the limit and the file of a photo', () => {
    const file = { sha256: 'a'.repeat(64), name: 'kartons.jpg', mediaType: 'image/jpeg' }
    const stated = statedAnswers(
      protocol,
      [
        answer({ fieldKey: 'outlet', value: '61500' }),
        answer({ fieldKey: 'sampling', value: '"taken"' }),
        answer({ fieldKey: 'room_tidy', result: 'not_ok', remark: 'Kartons', attachmentId: photo }),
        answer({ groupKey: 'branches', blockKey: 'b-1', fieldKey: 'insulation', result: 'ok' }),
      ],
      { ...context, fileOf: (id) => (id === photo ? file : null) },
    )

    expect(stated).toEqual([
      {
        section: 'Sichtprüfung',
        label: 'Raum aufgeräumt',
        group: null,
        kind: 'check_point',
        value: null,
        result: 'not_ok',
        remark: 'Kartons',
        limit: null,
        photo: file,
      },
      {
        section: 'Sichtprüfung',
        label: 'Probenahme',
        group: null,
        kind: 'choice',
        value: 'genommen',
        result: null,
        remark: null,
        limit: null,
        photo: null,
      },
      {
        section: 'Messwerte',
        label: 'Temperatur am Speicheraustritt',
        group: null,
        kind: 'measurement',
        value: '61,5 °C',
        result: null,
        remark: null,
        limit: {
          text: 'Innerhalb des Grenzwerts, mindestens 60,0 °C.',
          source: 'DVGW W 551',
          within: true,
        },
        photo: null,
      },
      {
        section: 'Messwerte',
        label: 'Dämmung',
        group: { label: 'Abgänge', block: 1 },
        kind: 'check_point',
        value: null,
        result: 'ok',
        remark: null,
        limit: null,
        photo: null,
      },
    ])
  })
})

describe('the page of an activity with a form', () => {
  const parts: SignedPage = {
    activity: { id: 'a-1', kind: 'inspection', title: 'Prüfung', performedOn: '2026-10-07' },
    place: {
      property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
      building: null,
      room: null,
      asset: null,
    },
    duties: [],
    defects: [],
  }

  it('names neither a form nor answers for an activity without a form, as before', () => {
    expect(Object.keys(signedPageOf(parts))).toEqual(['activity', 'place', 'duties', 'defects'])
  })

  it('names the form and every answer in the order of its point', () => {
    const page = signedPageOf({
      ...parts,
      form: { key: protocol.key, version: protocol.version },
      answers: [...complete].reverse(),
    })

    expect(page.form).toEqual({ key: 'probe.drinking_water_protocol', version: 2 })
    expect(page.answers?.map((each) => [each.groupKey, each.blockKey, each.fieldKey])).toEqual([
      [null, null, 'outlet'],
      [null, null, 'room_tidy'],
      [null, null, 'sampling'],
      ['branches', 'b-1', 'insulation'],
    ])
  })
})
