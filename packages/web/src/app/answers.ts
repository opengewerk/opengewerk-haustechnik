import {
  type AnswerContent,
  answerValue,
  answerVerdict,
  type BlockField,
  type CheckPointResult,
  type FilledAnswer,
  type FormDefinition,
  type FormSection,
  forms,
  formUnits,
  type GroupField,
  type LimitContext,
  type RecordState,
} from '@opengewerk/haustechnik-domain'
import type { PointState } from '@opengewerk/platform-web/forms'
import { maybeText, refusalFor, text } from '@opengewerk/platform-web/sync'

import type { SyncClient } from '../sync/client.js'

/**
 * The points of the form of an activity and their answers on the device
 * (#107, 2.5 and 4.5 of the concept): one answer per point, a record of its
 * own through the outbox (#106), written as soon as somebody gives it, so
 * that it outlasts the page, the battery and the cellar without a network.
 */

/** The entity an answer travels as. */
export const answerEntity = 'activity_answers'

/**
 * One point of a form: a field outside a group, or a field in one block of
 * a repeating group. The signature is not a point; it is the signature of
 * the activity (#108).
 */
export interface FormPoint {
  /** Where the point is found in an address: its field, or group, block and field. */
  readonly key: string
  readonly section: FormSection
  readonly group: GroupField | null
  readonly blockKey: string | null
  /** The place of its block among the blocks of its group, counted from one. */
  readonly block: number | null
  readonly field: BlockField
}

/** The key of a point in an address, its parts apart by dots, which no key contains. */
export function pointKey(
  groupKey: string | null,
  blockKey: string | null,
  fieldKey: string,
): string {
  return groupKey === null || blockKey === null ? fieldKey : `${groupKey}.${blockKey}.${fieldKey}`
}

/** A block opened on this device that holds no answer yet. */
export interface OpenedBlock {
  readonly groupKey: string
  readonly blockKey: string
}

/** The block a key of a point names, where it names one. */
export function openedBy(key: string): OpenedBlock | null {
  const [groupKey, blockKey, fieldKey] = key.split('.')

  return groupKey === undefined || blockKey === undefined || fieldKey === undefined
    ? null
    : { groupKey, blockKey }
}

/** An answer record as the form reads it. */
export function filledOf(record: RecordState): FilledAnswer {
  return {
    groupKey: maybeText(record, 'groupKey'),
    blockKey: maybeText(record, 'blockKey'),
    fieldKey: text(record, 'fieldKey'),
    value: maybeText(record, 'value'),
    result: maybeText(record, 'result') as CheckPointResult | null,
    remark: maybeText(record, 'remark'),
    attachmentId: maybeText(record, 'attachmentId') as FilledAnswer['attachmentId'],
  }
}

function byKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** The blocks of each group, those the answers hold and those opened here, in the order of their keys. */
function blocksOf(
  answers: readonly FilledAnswer[],
  opened: readonly OpenedBlock[],
): ReadonlyMap<string, readonly string[]> {
  const blocks = new Map<string, string[]>()

  for (const { groupKey, blockKey } of [...answers, ...opened]) {
    if (groupKey === null || blockKey === null) {
      continue
    }

    const known = blocks.get(groupKey) ?? []

    if (!known.includes(blockKey)) {
      known.push(blockKey)
    }

    blocks.set(groupKey, known)
  }

  for (const known of blocks.values()) {
    known.sort(byKey)
  }

  return blocks
}

/**
 * Every point of a form in its order: section by section, a group as its
 * blocks with their fields. A block is there once it holds an answer, or
 * while it is open on this device.
 */
export function pointsOf(
  definition: FormDefinition,
  answers: readonly FilledAnswer[],
  opened: readonly OpenedBlock[] = [],
): readonly FormPoint[] {
  const blocks = blocksOf(answers, opened)
  const points: FormPoint[] = []

  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (field.kind === 'signature') {
        continue
      }

      if (field.kind === 'group') {
        for (const [index, blockKey] of (blocks.get(field.key) ?? []).entries()) {
          for (const nested of field.fields) {
            points.push({
              key: pointKey(field.key, blockKey, nested.key),
              section,
              group: field,
              blockKey,
              block: index + 1,
              field: nested,
            })
          }
        }

        continue
      }

      points.push({ key: field.key, section, group: null, blockKey: null, block: null, field })
    }
  }

  return points
}

/** The record of the answer to a point, where there is one. */
export function answerAt(
  answers: readonly RecordState[],
  point: FormPoint,
): RecordState | undefined {
  return answers.find(
    (answer) =>
      text(answer, 'fieldKey') === point.field.key &&
      maybeText(answer, 'groupKey') === (point.group?.key ?? null) &&
      maybeText(answer, 'blockKey') === point.blockKey,
  )
}

/** Whether a point has its answer: a result, a value, a photo. A remark alone is none. */
export function isAnswered(point: FormPoint, answer: FilledAnswer | undefined): boolean {
  return answer !== undefined && answerValue(point.field, answer) !== undefined
}

/**
 * Whether a point has to be answered before the activity is signed: every
 * check point, whatever its definition says, and every field it marks as
 * required (4.5 of the concept).
 */
export function isDemanded(point: FormPoint): boolean {
  return point.field.kind === 'check_point' || point.field.required === true
}

/** The sign of the unit of a field with a figure. */
export function unitSign(field: Extract<BlockField, { readonly unit: unknown }>): string {
  return formUnits[field.unit].sign
}

/** What a point holds, as its line in the list of points says it. */
export function pointState(
  point: FormPoint,
  answer: FilledAnswer | undefined,
  context: LimitContext,
): PointState {
  const value = answer === undefined ? undefined : answerValue(point.field, answer)

  if (answer === undefined || value === undefined) {
    return { kind: 'open' }
  }

  const field = point.field

  switch (field.kind) {
    case 'check_point':
      return { kind: 'result', result: (value as { readonly result: CheckPointResult }).result }
    case 'measurement':
      return {
        kind: 'value',
        text: forms.formatMeasured(value as number, field.unit, field.decimals),
        outside: answerVerdict(field, answer, context).within === false,
      }
    case 'number':
    case 'meter_reading':
      return {
        kind: 'value',
        text: forms.formatMeasured(value as number, field.unit, field.decimals),
      }
    case 'yes_no':
      return { kind: 'value', text: value === true ? 'ja' : 'nein' }
    case 'choice':
      return {
        kind: 'value',
        text: field.options.find((option) => option.value === value)?.label ?? String(value),
      }
    case 'text':
      return { kind: 'value', text: 'eingetragen' }
    case 'photo':
      return { kind: 'value', text: 'Foto' }
  }
}

/** Whether an answer would say nothing at all, and so is no answer. */
function saysNothing(content: AnswerContent): boolean {
  return (
    content.value === null &&
    content.result === null &&
    content.remark === null &&
    content.attachmentId === null
  )
}

/**
 * Writes what somebody gave at a point, through the outbox: a new answer, a
 * change to the one there, or none once nothing is left of it. The sentence
 * to show when the device turns it down, or null when it is queued.
 *
 * The answer there is looked up in the store at the moment of writing and
 * not taken from the screen, which may not have drawn the one a write just
 * before it made: two quick taps would otherwise make two answers to one
 * point.
 */
export async function saveAnswer(
  client: SyncClient,
  activityId: string,
  point: FormPoint,
  change: Partial<AnswerContent>,
): Promise<string | null> {
  const held = answerAt(
    client.list(answerEntity).filter((answer) => text(answer, 'activityId') === activityId),
    point,
  )
  const before: AnswerContent =
    held === undefined
      ? { value: null, result: null, remark: null, attachmentId: null }
      : filledOf(held)
  const after: AnswerContent = { ...before, ...change }

  if (held !== undefined) {
    const done = saysNothing(after)
      ? await client.remove(answerEntity, String(held['id']))
      : await client.update(answerEntity, String(held['id']), change)

    return done.outcome === 'refused' ? refusalFor(done) : null
  }

  if (saysNothing(after)) {
    return null
  }

  const made = await client.create(answerEntity, {
    activityId,
    fieldKey: point.field.key,
    ...(point.group === null || point.blockKey === null
      ? {}
      : { groupKey: point.group.key, blockKey: point.blockKey }),
    ...Object.fromEntries(Object.entries(after).filter(([, value]) => value !== null)),
  })

  return made.outcome === 'refused' ? refusalFor(made) : null
}
