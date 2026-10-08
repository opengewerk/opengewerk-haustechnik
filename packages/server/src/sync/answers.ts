import {
  type Activity,
  type ActivityAnswer,
  answerFitProblem,
  type Catalogue,
  formOfActivity,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type SyncCheck, type SyncRefusal } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { activities, attachments } from '../database/schema/index.js'
import type { Sender } from './signatures.js'

// The answer to a point of the form of an activity (#106), asked against the
// form as the server holds it, before the database does (ADR 0006, point 11).
// The device fills its form from the same definition with the same engine,
// so an answer that does not fit it is a mistake of the device and refuses
// the transmission with the sentence of the engine; the gate on the state of
// the activity and the point answered twice are the sync's and the place's.

/** The columns of an answer as it would stand: the row before, with what the operation writes. */
type AnswerColumns = Pick<
  ActivityAnswer,
  | 'activityId'
  | 'groupKey'
  | 'blockKey'
  | 'fieldKey'
  | 'value'
  | 'result'
  | 'remark'
  | 'attachmentId'
>

function columnOf(
  values: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
  field: keyof AnswerColumns,
): unknown {
  return Object.hasOwn(values, field) ? values[field] : (current?.[field] ?? null)
}

/**
 * An answer that is given or changed fits the form of its activity: the
 * activity names a form this build knows, the point is a field of it, the
 * answer fills the columns of its kind with a value the field takes, and a
 * photo is a document at the same activity.
 */
export function answered(catalogue: Catalogue): SyncCheck<Sender> {
  return async ({ tx, operation, values, current }) => {
    if (operation.entity !== 'activity_answers' || operation.kind === 'delete') {
      return null
    }

    const at = (field: keyof AnswerColumns) => columnOf(values, current, field)
    const activityId = at('activityId')

    if (!isUuid(activityId)) {
      return { kind: 'conflict', reason: 'record_missing', fields: ['activityId'] }
    }

    const [activity] = (await tx
      .select()
      .from(activities)
      .where(
        and(eq(activities.id, activityId as Activity['id']), isNull(activities.deletedAt)),
      )) as Activity[]

    if (activity === undefined) {
      return { kind: 'conflict', reason: 'record_missing', fields: ['activityId'] }
    }

    const form = formOfActivity(catalogue, activity)

    if (form === null) {
      return { kind: 'client', message: 'Dieser Vorgang hat kein Formular, das Antworten nimmt.' }
    }

    if (form === undefined) {
      return { kind: 'client', message: 'Das Formular dieses Vorgangs kennt dieser Stand nicht.' }
    }

    const problem = answerFitProblem(form, {
      groupKey: (at('groupKey') ?? null) as string | null,
      blockKey: (at('blockKey') ?? null) as string | null,
      fieldKey: String(at('fieldKey')),
      value: (at('value') ?? null) as string | null,
      result: (at('result') ?? null) as AnswerColumns['result'],
      remark: (at('remark') ?? null) as string | null,
      attachmentId: (at('attachmentId') ?? null) as AnswerColumns['attachmentId'],
    })

    if (problem !== null) {
      return { kind: 'client', message: problem }
    }

    return Object.hasOwn(values, 'attachmentId') && values['attachmentId'] !== null
      ? photoAt(tx, activity, values['attachmentId'])
      : null
  }
}

/** A photo of an answer: a document at the same activity, there for the person asking. */
async function photoAt(
  tx: Parameters<SyncCheck<Sender>>[0]['tx'],
  activity: Activity,
  attachmentId: unknown,
): Promise<SyncRefusal | null> {
  if (!isUuid(attachmentId)) {
    return { kind: 'conflict', reason: 'record_missing', fields: ['attachmentId'] }
  }

  const [document] = await tx
    .select({ activityId: attachments.activityId })
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId as typeof attachments.$inferSelect.id),
        isNull(attachments.deletedAt),
      ),
    )

  return document?.activityId === activity.id
    ? null
    : { kind: 'conflict', reason: 'record_missing', fields: ['attachmentId'] }
}
