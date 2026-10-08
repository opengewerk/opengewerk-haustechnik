import {
  activityKindOfTask,
  activityLimits,
  type ApplicationDeadlineKind,
  type Catalogue,
} from '@opengewerk/haustechnik-domain'
import type { DeadlineActionHandler } from '@opengewerk/platform-server'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { dutyTitle } from '../database/duty-standing.js'
import { activities, activityDuties, type deadlines, duties } from '../database/schema/index.js'

/** A deadline of this application as the engine hands it to an action. */
type DeadlineRow = typeof deadlines.$inferSelect

/** The states of an activity whose work is still to come or still going on. */
const underWay = ['open', 'started', 'signed'] as const

/**
 * The action "activity" of the appointment of a duty (#105, section 4.4 of
 * the concept): when the lead of a due day begins, an inspection or a
 * maintenance comes of it, with the person who answers for the deadline, due
 * on the due day, at the place of the duty and meeting the duty.
 *
 * Once for a due day: the engine of the foundation calls an action in the
 * transaction that marks the deadline reminded for that day, and of two runs
 * only one gets the mark. A duty that already has an activity under way gets
 * no second one, so that a due day that moved, because its interval was
 * changed, adds nothing to what is planned.
 *
 * What it makes changes nothing of the deadline: the next due day comes of
 * the next evidence and never of an activity (section 4.4).
 */
export function activityFromDeadline(
  catalogue: Catalogue,
): DeadlineActionHandler<ApplicationDeadlineKind, DeadlineRow> {
  return async ({ tx, tenantId, deadline, responsible }) => {
    const [duty] = await tx
      .select()
      .from(duties)
      .where(and(eq(duties.id, deadline.dutyId), isNull(duties.deletedAt)))

    if (duty === undefined) {
      return
    }

    const [underWayAlready] = await tx
      .select({ id: activityDuties.id })
      .from(activityDuties)
      .innerJoin(
        activities,
        and(
          eq(activities.tenantId, activityDuties.tenantId),
          eq(activities.id, activityDuties.activityId),
        ),
      )
      .where(
        and(
          eq(activityDuties.dutyId, duty.id),
          isNull(activityDuties.deletedAt),
          isNull(activities.deletedAt),
          inArray(activities.status, [...underWay]),
        ),
      )
      .limit(1)

    if (underWayAlready !== undefined) {
      return
    }

    // A duty of the operator's own names its task, one from the catalogue
    // takes it from its kind in the version that was confirmed.
    const task =
      duty.task ??
      (duty.kind === null || duty.kindVersion === null
        ? null
        : (catalogue.dutyKindVersion(duty.kind, duty.kindVersion)?.definition.task ?? null))
    const place = {
      tenantId,
      propertyId: duty.propertyId,
      areaId: duty.areaId,
    }
    const [activity] = await tx
      .insert(activities)
      .values({
        ...place,
        buildingId: duty.buildingId,
        roomId: duty.roomId,
        assetId: duty.assetId,
        kind: activityKindOfTask(task),
        title: dutyTitle(duty, catalogue).trim().slice(0, activityLimits.title).trim(),
        status: 'open',
        dueOn: deadline.dueOn,
        responsibleUserId: responsible,
        performer: duty.performer,
        contractorNote: duty.performer === 'contractor' ? duty.performerNote : null,
      })
      .returning({ id: activities.id })

    if (activity === undefined) {
      throw new Error(`The activity for the duty ${duty.id} was not written`)
    }

    await tx.insert(activityDuties).values({ ...place, activityId: activity.id, dutyId: duty.id })
  }
}
