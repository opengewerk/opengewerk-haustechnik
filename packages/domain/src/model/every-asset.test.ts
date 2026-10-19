import { ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  answerFindings,
  answerFitProblem,
  answerProblems,
  answersMissing,
  type FilledAnswer,
  formValuesOf,
  type PointAssets,
  statedAnswers,
} from './answer.js'
import type { FormDefinition } from './forms.js'
import { statedPointWords } from './evidence.js'
import { pointFulfilling } from './round-template.js'
import { type SignedPage, signedPageOf } from './signature.js'

/**
 * A point for every asset of a kind in a round (#343, section 4.5 of the
 * concept): answered once for each asset the round was given, each answer
 * naming its asset, a defect found at that asset, and the evidence of the
 * duty of each asset holding the answer about it.
 */

const upstairs = '0192f0c4-7b4e-7000-8000-000000000a43'
const downstairs = '0192f0c4-7b4e-7000-8000-000000000a41'
const elsewhere = '0192f0c4-7b4e-7000-8000-000000000a99'

/** A round with a point for every hold-open device and one for the hall, as its template saved it. */
const round: FormDefinition = {
  key: 'template-0192f0c4-7b4e-7000-8000-000000000001',
  version: 2,
  title: 'Brandschutz Haus A, monatlich',
  sections: [
    {
      key: 'k1',
      title: 'Türen mit Feststellanlage',
      fields: [
        {
          kind: 'check_point',
          key: 'p1',
          label: 'Feststellanlage ausgelöst, Tür schließt selbsttätig',
          everyAssetOf: 'probe.hold_open_device',
          fulfilsKind: 'probe.hold_open_device_monthly',
        } as FormDefinition['sections'][number]['fields'][number],
        { kind: 'check_point', key: 'p2', label: 'Schließbereich frei' },
      ],
    },
  ],
}

/** The assets the round was given for the point, in the order it shows them. */
const given: PointAssets = { p1: [downstairs, upstairs] }

const context = {
  rules: ruleSet([]),
  on: '2026-10-01' as const,
  pointAssets: given,
  assetName: (id: string) =>
    id === downstairs
      ? 'AN-00041 Feststellanlage EG'
      : id === upstairs
        ? 'AN-00043 Feststellanlage 1. OG'
        : null,
}

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

const atBoth: FilledAnswer[] = [
  answer({ fieldKey: 'p2', result: 'ok' }),
  answer({
    fieldKey: 'p1',
    assetId: upstairs as FilledAnswer['assetId'],
    result: 'not_ok',
    remark: 'Tür bleibt am Haftmagneten hängen.',
  }),
  answer({ fieldKey: 'p1', assetId: downstairs as FilledAnswer['assetId'], result: 'ok' }),
]

describe('an answer to a point for every asset (#343)', () => {
  it('names its asset as a key, and stands in no group with it', () => {
    expect(answerProblems({ fieldKey: 'p1', assetId: upstairs })).toEqual({})
    expect(answerProblems({ fieldKey: 'p1', assetId: 'AN-00043' })).toEqual({
      assetId: 'Das ist keine Anlage.',
    })
    expect(
      answerProblems({ fieldKey: 'p1', groupKey: 'g', blockKey: 'b', assetId: upstairs }),
    ).toEqual({ assetId: 'Eine Antwort zu einer Anlage steht in keiner Gruppe.' })
  })

  it('names one of the assets the round was given for its point, and an answer to any other point none', () => {
    const at = (fieldKey: string, assetId: string | null) =>
      answerFitProblem(
        round,
        answer({ fieldKey, result: 'ok', assetId: assetId as FilledAnswer['assetId'] }),
        given,
      )

    expect(at('p1', upstairs)).toBeNull()
    expect(at('p1', null)).toBe(
      'Der Punkt „Feststellanlage ausgelöst, Tür schließt selbsttätig“ wird für jede seiner Anlagen beantwortet, die Antwort nennt ihre Anlage.',
    )
    expect(at('p1', elsewhere)).toBe(
      'Nach dieser Anlage fragt der Punkt „Feststellanlage ausgelöst, Tür schließt selbsttätig“ in diesem Rundgang nicht.',
    )
    expect(at('p2', upstairs)).toBe('Der Punkt „Schließbereich frei“ fragt nach keiner Anlage.')
    expect(at('p2', null)).toBeNull()
  })

  it('is asked for each asset before the signature, by its name, and a point that names none of them asks nothing', () => {
    expect(answersMissing(round, atBoth, context)).toEqual([])
    expect(answersMissing(round, atBoth.slice(0, 2), context)).toEqual([
      'Feststellanlage ausgelöst, Tür schließt selbsttätig, AN-00041 Feststellanlage EG fehlt.',
    ])
    expect(
      answersMissing(round, [atBoth[0] as FilledAnswer], { ...context, pointAssets: { p1: [] } }),
    ).toEqual([])
  })

  it('wants the remark of an answer not in order about one asset, named with it', () => {
    const silent = atBoth.map((each) =>
      each.assetId === upstairs ? { ...each, remark: null } : each,
    )

    expect(answersMissing(round, silent, context)).toEqual([
      'Feststellanlage ausgelöst, Tür schließt selbsttätig, AN-00043 Feststellanlage 1. OG: zu „nicht in Ordnung“ fehlt die Bemerkung.',
    ])
  })

  it('is no value of the form the engine is asked about', () => {
    expect(formValuesOf(round, atBoth)).toEqual({ p2: { result: 'ok' } })
  })

  it('becomes a defect at exactly the asset it is about', () => {
    expect(
      answerFindings(round, atBoth, context).map((finding) => [finding.about, finding.description]),
    ).toEqual([
      [
        { kind: 'asset', id: upstairs },
        'Feststellanlage ausgelöst, Tür schließt selbsttätig: Tür bleibt am Haftmagneten hängen.',
      ],
    ])
  })

  it('stands in an evidence with its asset, in the order of the assets of the round', () => {
    const stated = statedAnswers(round, atBoth, {
      ...context,
      fileOf: () => null,
      assetOf: (id) =>
        id === upstairs
          ? { number: 'AN-00043', name: 'Feststellanlage 1. OG' }
          : { number: 'AN-00041', name: 'Feststellanlage EG' },
    })

    expect(stated.map((answer) => statedPointWords(answer))).toEqual([
      'Feststellanlage ausgelöst, Tür schließt selbsttätig, AN-00041 Feststellanlage EG',
      'Feststellanlage ausgelöst, Tür schließt selbsttätig, AN-00043 Feststellanlage 1. OG',
      'Schließbereich frei',
    ])
  })

  it('is the point that fulfils the duty of its kind at each asset, after a point that names the duty', () => {
    expect(pointFulfilling(round, 'some-duty', 'probe.hold_open_device_monthly')?.key).toBe('p1')
    expect(pointFulfilling(round, 'some-duty', 'probe.other_kind')).toBeNull()
    expect(pointFulfilling(round, 'some-duty')).toBeNull()
  })
})

describe('the page of a round with a point for every asset (#343)', () => {
  const parts: SignedPage = {
    activity: { id: 'a-1', kind: 'round', title: 'Rundgang', performedOn: '2026-10-01' },
    place: {
      property: { name: 'Campus', address: 'Hauptstraße 1, 68535 Edingen-Neckarhausen' },
      building: null,
      room: null,
      asset: null,
    },
    duties: [],
    defects: [],
  }

  it('names the asset of an answer only where there is one, in the order of the assets', () => {
    const page = signedPageOf({
      ...parts,
      form: { key: round.key, version: round.version },
      answers: atBoth,
    })

    expect(page.answers?.map((each) => [each.fieldKey, each.assetId])).toEqual([
      ['p1', downstairs],
      ['p1', upstairs],
      ['p2', undefined],
    ])
    expect(Object.keys(page.answers?.[2] ?? {})).not.toContain('assetId')
  })
})
