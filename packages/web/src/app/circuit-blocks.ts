import type { AnswersContext, FilledAnswer } from '@opengewerk/haustechnik-domain'

import { type FormPoint, isAnswered, isDemanded, pointState } from './answers.js'

/**
 * How far the block of one circuit is (#350), as its card in the protocol and
 * its screen say it: how many of its points that ask for a value or a result
 * are answered, of how many, whether it is done, and whether a value in it is
 * outside its limit or a check point not in order, which the signature makes
 * a defect of.
 *
 * Done is a block whose points that have to be answered are, the check point
 * "Stromkreis in Ordnung" of the forms of the package Elektro; a form whose
 * block has no such point asks every point that asks for something. A text,
 * the remark of the block, and a photo are free and not counted.
 */
export interface CircuitBlockState {
  readonly answered: number
  readonly counted: number
  /** Whether anything is given in the block, a remark among it. */
  readonly begun: boolean
  readonly done: boolean
  readonly outside: boolean
  readonly notOk: boolean
}

export function circuitBlockState(
  points: readonly FormPoint[],
  filledAt: (point: FormPoint) => FilledAnswer | undefined,
  context: AnswersContext,
): CircuitBlockState {
  const answered = (point: FormPoint) => isAnswered(point, filledAt(point))
  const counted = points.filter(
    (point) => point.field.kind !== 'text' && point.field.kind !== 'photo',
  )
  const demanded = points.filter(isDemanded)
  const states = points.map((point) => pointState(point, filledAt(point), context))

  return {
    answered: counted.filter(answered).length,
    counted: counted.length,
    begun: points.some((point) => filledAt(point) !== undefined),
    done: (demanded.length > 0 ? demanded : counted).every(answered) && points.length > 0,
    outside: states.some((state) => state.kind === 'value' && state.outside === true),
    notOk: states.some((state) => state.kind === 'result' && state.result === 'not_ok'),
  }
}

/** The state of a block in words: "fertig", "3 von 6" or "noch offen". */
export function circuitStateWords(state: CircuitBlockState): string {
  return state.done
    ? 'fertig'
    : state.begun
      ? `${String(state.answered)} von ${String(state.counted)}`
      : 'noch offen'
}
