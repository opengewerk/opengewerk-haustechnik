import { activityClosable, type ActivityId } from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { activities, activityDuties } from '../database/schema/index.js'

/**
 * An activity closed as not performed, with the reason (section 4.4 of the
 * concept, #183, and 4.8 for a work order, #117): while it is open or begun,
 * by whoever plans and hands out work. Each of its duties takes "not
 * performed" with the same reason as its result. No evidence comes of it,
 * and the appointment of its duties stays as it is: planned and not performed
 * is overdue. A device that still holds the activity changes nothing of it
 * afterwards; its progress is taken only while it is open or begun.
 *
 * Says whether it was closed: one somebody signed meanwhile waits for what
 * its signature makes, and stays as it is.
 */
export async function closeAsNotPerformed(
  tx: TenantTransaction,
  activityId: ActivityId,
  reason: string,
): Promise<boolean> {
  const [closed] = await tx
    .update(activities)
    .set({ status: 'not_performed', closingReason: reason, updatedAt: new Date() })
    .where(and(eq(activities.id, activityId), inArray(activities.status, [...activityClosable])))
    .returning({ id: activities.id })

  if (closed === undefined) {
    return false
  }

  await tx
    .update(activityDuties)
    .set({ result: 'not_performed', resultReason: reason })
    .where(and(eq(activityDuties.activityId, activityId), isNull(activityDuties.deletedAt)))

  return true
}
