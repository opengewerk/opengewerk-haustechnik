import type { Activity, ActivityStatus } from '@opengewerk/haustechnik-domain'
import { isUuid, type SyncCheck, type SyncRefusal } from '@opengewerk/platform-server'
import { and, eq, inArray } from 'drizzle-orm'

import { activities } from '../database/schema/index.js'
import type { Sender } from './signatures.js'

// A round handed on to another person (#559, section 4.5 of the concept):
// whoever plans and hands out gives a round that was begun to somebody else,
// when the person walking it falls ill in the middle of the week, and what the
// server holds of it stays with the round. The device of the person before
// may still hold answers or a signature it has not sent; it sends them once
// it is online again, and the server takes none of them, so that nothing from
// there stands over what the person after wrote. The device hears that the
// person of the round changed while it was away. A photo it sends still lands
// as a document at the round, without an answer that names it.

/** The records the person walking a round writes on it, by the field that names the round. */
const ofTheRound: Readonly<Record<string, string>> = {
  activities: 'id',
  activity_answers: 'activityId',
  activity_signatures: 'activityId',
}

/** The states in which a round is being walked; one handed in is the countersigner's. */
const walked: readonly ActivityStatus[] = ['open', 'started']

const handedOn: SyncRefusal = {
  kind: 'conflict',
  reason: 'changed_elsewhere',
  fields: ['performerUserId'],
}

/** A round given to a person is walked and signed by that person alone. */
export const walkedByItsPerson: SyncCheck<Sender> = async ({
  tx,
  operation,
  values,
  current,
  sender,
}) => {
  const field = ofTheRound[operation.entity]

  if (field === undefined) {
    return null
  }

  const activityId =
    operation.entity === 'activities'
      ? operation.recordId
      : Object.hasOwn(values, field)
        ? values[field]
        : current?.[field]

  if (!isUuid(activityId)) {
    return null
  }

  const [round] = await tx
    .select({ performerUserId: activities.performerUserId })
    .from(activities)
    .where(
      and(
        eq(activities.id, activityId as Activity['id']),
        eq(activities.kind, 'round'),
        inArray(activities.status, [...walked]),
      ),
    )

  return round === undefined ||
    round.performerUserId === null ||
    round.performerUserId === sender.userId
    ? null
    : handedOn
}
