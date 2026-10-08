import {
  type Activity,
  type ActivityId,
  activityKindOfTask,
  activityLimits,
  activityUnderWay,
  type Catalogue,
  type DutyId,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm'

import { dutyTitle } from '../database/duty-standing.js'
import { activities, activityDuties, duties } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/** What an activity for a duty is made with, beside the duty. */
export interface MakingAnActivity {
  readonly tenantId: (typeof activities.$inferInsert)['tenantId']
  readonly dutyId: DutyId
  /** The day it is due on. */
  readonly dueOn: IsoDate
  /** Who answers for it, or nobody. */
  readonly responsible: string | null
  readonly now: Date
}

/** The activity that was made, or why none was. */
export type MadeActivity =
  { readonly made: ActivityId } | { readonly made: null; readonly because: 'missing' | 'under_way' }

/**
 * An inspection or a maintenance for a duty (#105, #183, section 4.4 of the
 * concept), from its due day when the lead begins or by hand by whoever plans
 * and hands out work: at the place of the duty, meeting the duty, whether the
 * own people or a contractor perform it as the duty says, and with the form
 * its kind names as its evidence in the version in force on the day it is
 * made, which it keeps (#106).
 *
 * None while an activity is under way for the duty, so that a due day that
 * moved adds nothing to what is planned. The duty is held until the activity
 * is written: of the engine and somebody making one by hand at the same
 * time, only one makes it.
 *
 * What it makes changes nothing of the deadline: the next due day comes of
 * the next evidence and never of an activity (section 4.4).
 */
export async function makeActivityForDuty(
  tx: TenantTransaction,
  catalogue: Catalogue,
  making: MakingAnActivity,
): Promise<MadeActivity> {
  const [duty] = await tx
    .select()
    .from(duties)
    .where(and(eq(duties.id, making.dutyId), isNull(duties.deletedAt)))
    .for('update')

  if (duty === undefined) {
    return { made: null, because: 'missing' }
  }

  if ((await underWayFor(tx, [duty.id])).size > 0) {
    return { made: null, because: 'under_way' }
  }

  // A duty of the operator's own names its task, one from the catalogue
  // takes it from its kind in the version that was confirmed.
  const kind =
    duty.kind === null || duty.kindVersion === null
      ? null
      : (catalogue.dutyKindVersion(duty.kind, duty.kindVersion)?.definition ?? null)
  const task = duty.task ?? kind?.task ?? null
  const formKey = kind?.evidence.form
  const form = formKey === undefined ? null : catalogue.form(formKey, dayInGermany(making.now))
  const place = {
    tenantId: making.tenantId,
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
      dueOn: making.dueOn,
      responsibleUserId: making.responsible,
      performer: duty.performer,
      contractorNote: duty.performer === 'contractor' ? duty.performerNote : null,
      formKey: form?.key ?? null,
      formVersion: form?.version ?? null,
    })
    .returning({ id: activities.id })

  if (activity === undefined) {
    throw new Error(`The activity for the duty ${duty.id} was not written`)
  }

  await tx.insert(activityDuties).values({ ...place, activityId: activity.id, dutyId: duty.id })

  return { made: activity.id as ActivityId }
}

/**
 * The activity under way for each of the duties that has one, narrowed to
 * what the person asking is shown where the caller says so. A duty has at
 * most one: neither the engine nor a hand makes a second.
 */
export async function underWayFor(
  tx: TenantTransaction,
  dutyIds: readonly string[],
  shown?: SQL,
): Promise<ReadonlyMap<string, Activity>> {
  if (dutyIds.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({ dutyId: activityDuties.dutyId, activity: activities })
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
        inArray(activityDuties.dutyId, [...dutyIds] as DutyId[]),
        isNull(activityDuties.deletedAt),
        isNull(activities.deletedAt),
        inArray(activities.status, [...activityUnderWay]),
        shown,
      ),
    )
    .orderBy(asc(activities.createdAt))

  return new Map(rows.map(({ dutyId, activity }) => [dutyId, activity as Activity]))
}
