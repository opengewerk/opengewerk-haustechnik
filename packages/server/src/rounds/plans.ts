import {
  activityLimits,
  addDays,
  type Catalogue,
  closureOn,
  type DutyId,
  dutyHasEnded,
  holidayClosures,
  holidaysBetween,
  isPassDay,
  type IsoDate,
  leadOf,
  passesBetween,
  passSearchDays,
  type PlanClosure,
  roundDue,
  type TemplateDefinition,
  templateFormKey,
  templatePoints,
} from '@opengewerk/haustechnik-domain'
import { deadlineSettingsOf, type TenantTransaction } from '@opengewerk/platform-server'
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import {
  activities,
  activityDuties,
  buildingClosures,
  deadlines,
  duties,
  properties,
  roundPlans,
  roundTemplateVersions,
} from '../database/schema/index.js'

/** A plan as it stands in its table. */
export type PlanRow = typeof roundPlans.$inferSelect

/** The newest version of a template, which a round takes when it is made. */
async function newestVersion(
  tx: TenantTransaction,
  templateId: PlanRow['templateId'],
): Promise<typeof roundTemplateVersions.$inferSelect | null> {
  const [version] = await tx
    .select()
    .from(roundTemplateVersions)
    .where(eq(roundTemplateVersions.templateId, templateId))
    .orderBy(desc(roundTemplateVersions.formVersion))
    .limit(1)

  return version ?? null
}

/**
 * The duties the points of a version fulfil, as far as a round at the
 * property of the plan can meet them: a duty of another property is no duty
 * of this round (`activity_duties` holds a duty to the property of its
 * activity), and one that was removed is none at all.
 */
async function dutiesOf(
  tx: TenantTransaction,
  definition: TemplateDefinition,
  propertyId: PlanRow['propertyId'],
): Promise<readonly (typeof duties.$inferSelect)[]> {
  const ids = templatePoints(definition)
    .map(({ field }) => field.fulfils)
    .filter((id): id is DutyId => typeof id === 'string')

  if (ids.length === 0) {
    return []
  }

  return tx
    .select()
    .from(duties)
    .where(
      and(inArray(duties.id, ids), eq(duties.propertyId, propertyId), isNull(duties.deletedAt)),
    )
}

/**
 * The rounds of a plan for its passes from a day to a day (#113, section 4.5
 * of the concept), each pass once: the deadline engine when the lead of the
 * next pass begins, and the routes of the plan when it is made, changed or
 * runs again, so that the office sees the rounds of the coming days at once.
 *
 * A round takes the newest version of the template on the day it is made and
 * keeps it; whether it is countersigned, that version says. It is due on its
 * pass, at the place of the plan, performed by the own people: by the person
 * of the plan, or by nobody named, which puts it on the devices of everybody
 * in the area. Nobody answers for it in particular; whoever plans in the area
 * sees it. Every point
 * that fulfils a duty that is in force on the day of the pass brings that
 * duty along, with no result: the evidence takes it from the answer.
 *
 * None while the plan rests, none in a closure of its building, and none for
 * a pass that has a round: the unique index `activities_once_per_pass` holds
 * that against two runs at the same moment, which then leave each other's
 * round alone. Returns how many it made.
 */
export async function fillRounds(
  tx: TenantTransaction,
  plan: PlanRow,
  from: IsoDate,
  until: IsoDate,
  rules: HolidayRules,
): Promise<number> {
  if (plan.resting || plan.deletedAt !== null) {
    return 0
  }

  const closures = await daysOffOf(tx, plan, rules, from, until)
  const passes = passesBetween(plan, from, until, closures)

  if (passes.length === 0) {
    return 0
  }

  const version = await newestVersion(tx, plan.templateId)

  if (version === null) {
    return 0
  }

  const taken = new Set(
    (
      await tx
        .select({ dueOn: activities.dueOn })
        .from(activities)
        .where(
          and(
            eq(activities.roundPlanId, plan.id),
            isNull(activities.deletedAt),
            gte(activities.dueOn, from),
            lte(activities.dueOn, until),
          ),
        )
    ).map((row) => row.dueOn),
  )
  const fulfilled = await dutiesOf(tx, version.definition, plan.propertyId)
  const place = { tenantId: plan.tenantId, propertyId: plan.propertyId, areaId: plan.areaId }
  let made = 0

  for (const pass of passes) {
    if (taken.has(pass)) {
      continue
    }

    const [round] = await tx
      .insert(activities)
      .values({
        ...place,
        buildingId: plan.buildingId,
        kind: 'round',
        title: version.definition.title.trim().slice(0, activityLimits.title).trim(),
        status: 'open',
        dueOn: pass,
        performer: 'own_staff',
        performerUserId: plan.performerUserId,
        countersignatureRequired: version.asksCountersignature,
        formKey: templateFormKey(plan.templateId),
        formVersion: version.formVersion,
        roundPlanId: plan.id,
      })
      .onConflictDoNothing()
      .returning({ id: activities.id })

    if (round === undefined) {
      continue
    }

    const due = fulfilled.filter((duty) => !dutyHasEnded(duty, pass))

    if (due.length > 0) {
      await tx
        .insert(activityDuties)
        .values(due.map((duty) => ({ ...place, activityId: round.id, dutyId: duty.id })))
    }

    made += 1
  }

  return made
}

/**
 * Takes back rounds nobody has begun (#113): when the plan that made them
 * changes, rests or ends, or their building closes on their day, they no
 * longer say what is to be done, and the plan makes again what it says now.
 * A round that was begun, signed or closed stays, and so does every round of
 * a past day: a past round is closed with a reason and never dropped
 * (section 4.5). Only rounds that are open now are taken, whatever the
 * caller read before.
 *
 * Marks the rounds and the duties they were to meet, at one moment; a device
 * that holds them hears that it may let them go. Returns how many.
 */
export async function withdrawRounds(
  tx: TenantTransaction,
  ids: readonly (typeof activities.$inferSelect)['id'][],
  now: Date,
): Promise<number> {
  if (ids.length === 0) {
    return 0
  }

  const withdrawn = await tx
    .update(activities)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        inArray(activities.id, ids),
        eq(activities.status, 'open'),
        isNotNull(activities.roundPlanId),
        isNull(activities.deletedAt),
      ),
    )
    .returning({ id: activities.id })

  if (withdrawn.length > 0) {
    await tx
      .update(activityDuties)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(
            activityDuties.activityId,
            withdrawn.map((round) => round.id),
          ),
          isNull(activityDuties.deletedAt),
        ),
      )
  }

  return withdrawn.length
}

/** The rounds of a plan from a day on that nobody has begun. */
async function openRoundsOf(tx: TenantTransaction, planId: PlanRow['id'], from: IsoDate) {
  return tx
    .select({
      id: activities.id,
      dueOn: activities.dueOn,
      performerUserId: activities.performerUserId,
    })
    .from(activities)
    .where(
      and(
        eq(activities.roundPlanId, planId),
        eq(activities.status, 'open'),
        gte(activities.dueOn, from),
        isNull(activities.deletedAt),
      ),
    )
}

/**
 * What a change of a plan does to its rounds from today on that nobody has
 * begun (#113). A round whose day is no pass of the plan any more is taken
 * back, every one when the plan rests or walks another template; one whose
 * day stays keeps the person it was handed to, unless it went to the person
 * the plan named before, who is then replaced by the one it names now. Then
 * the plan makes the rounds it is missing, as far ahead as rounds are made.
 */
export async function replan(
  tx: TenantTransaction,
  before: PlanRow,
  after: PlanRow,
  today: IsoDate,
  now: Date,
  rules: HolidayRules,
): Promise<void> {
  const rounds = await openRoundsOf(tx, after.id, today)
  const closures = await daysOffOf(tx, after, rules, today, addDays(today, passSearchDays))
  const every = after.resting || after.deletedAt !== null || before.templateId !== after.templateId
  const gone = rounds.filter(
    (round) =>
      every ||
      round.dueOn === null ||
      !isPassDay(after, round.dueOn) ||
      closureOn(closures, round.dueOn) !== null,
  )
  const goneIds = new Set(gone.map((round) => round.id))

  await withdrawRounds(tx, [...goneIds], now)

  if (before.performerUserId !== after.performerUserId) {
    const handedOn = rounds.filter(
      (round) => !goneIds.has(round.id) && round.performerUserId === before.performerUserId,
    )

    if (handedOn.length > 0) {
      await tx
        .update(activities)
        .set({ performerUserId: after.performerUserId, updatedAt: now })
        .where(
          and(
            inArray(
              activities.id,
              handedOn.map((round) => round.id),
            ),
            eq(activities.status, 'open'),
          ),
        )
    }
  }

  await fillAhead(tx, after, today, rules)
}

/**
 * What a closure of a building does to the rounds there (#113, section 4.1):
 * a new one takes back the rounds nobody has begun on its days, and one that
 * is removed lets the plans of the building make the rounds of its days
 * again, as far ahead as rounds are made.
 */
export async function followClosures(
  tx: TenantTransaction,
  buildingId: NonNullable<PlanRow['buildingId']>,
  today: IsoDate,
  now: Date,
  rules: HolidayRules,
): Promise<void> {
  const plans = await tx
    .select()
    .from(roundPlans)
    .where(and(eq(roundPlans.buildingId, buildingId), isNull(roundPlans.deletedAt)))

  for (const plan of plans) {
    const closures = await daysOffOf(tx, plan, rules, today, addDays(today, passSearchDays))
    const closed = (await openRoundsOf(tx, plan.id, today)).filter(
      (round) => round.dueOn !== null && closureOn(closures, round.dueOn) !== null,
    )

    await withdrawRounds(
      tx,
      closed.map((round) => round.id),
      now,
    )
    await fillAhead(tx, plan, today, rules)
  }
}

/** What a plan asks of the catalogue: the statutory public holidays of a state (#200). */
export type HolidayRules = Pick<Catalogue, 'ruleSet'>

/**
 * The days a plan makes no round on from a day to a day (4.1, 4.5): the
 * closures of its building that stand, and where the plan leaves them out,
 * the statutory public holidays of the state of its property (#200). A pass
 * on either is left out and not moved.
 */
async function daysOffOf(
  tx: TenantTransaction,
  plan: Pick<PlanRow, 'buildingId' | 'propertyId' | 'skipHolidays'>,
  rules: HolidayRules,
  from: IsoDate,
  until: IsoDate,
): Promise<readonly PlanClosure[]> {
  const closures = await closuresOf(tx, plan.buildingId)

  if (!plan.skipHolidays) {
    return closures
  }

  const [property] = await tx
    .select({ federalState: properties.federalState })
    .from(properties)
    .where(eq(properties.id, plan.propertyId))

  return property === undefined
    ? closures
    : [...closures, ...holidayClosures(holidaysBetween(rules, property.federalState, from, until))]
}

/** The times a building is closed that stand, none for a plan over a whole property. */
async function closuresOf(
  tx: TenantTransaction,
  buildingId: PlanRow['buildingId'],
): Promise<readonly PlanClosure[]> {
  return buildingId === null
    ? []
    : tx
        .select({ startsOn: buildingClosures.startsOn, endsOn: buildingClosures.endsOn })
        .from(buildingClosures)
        .where(and(eq(buildingClosures.buildingId, buildingId), isNull(buildingClosures.deletedAt)))
}

/**
 * How far ahead the rounds of a plan are made: the lead of `round.due`, as
 * the deadline of the plan has it, the operator has set it or the kind says
 * (`leadOf`). The same reach the engine has when it makes them.
 */
export async function roundReach(tx: TenantTransaction, planId: PlanRow['id']): Promise<number> {
  const settings = await deadlineSettingsOf(tx)
  const [deadline] = await tx
    .select({ leadDays: deadlines.leadDays })
    .from(deadlines)
    .where(and(eq(deadlines.roundPlanId, planId), eq(deadlines.kind, roundDue.key)))

  return leadOf(roundDue, settings.get(roundDue.key) ?? null, deadline?.leadDays ?? null)
}

/** Makes the rounds of a plan from a day as far ahead as they are made. */
export async function fillAhead(
  tx: TenantTransaction,
  plan: PlanRow,
  today: IsoDate,
  rules: HolidayRules,
): Promise<number> {
  const reach = await roundReach(tx, plan.id)

  return fillRounds(tx, plan, today, addDays(today, reach), rules)
}

/**
 * Brings the rounds of the plans that nobody has begun onto the newest
 * version of their template (#113): rounds are made ahead, and a template
 * changed today is walked from the next round on, not from the one after
 * the lead. A round that was begun stays on its version (section 4.5).
 *
 * The round takes the countersignature the version asks for, and the duties
 * its points fulfil: a duty no point fulfils any more is taken off it, one
 * that a point fulfils now is added, while it is in force on the day of the
 * round. Run by the deadline engine at the end of every pass, in every area
 * of the operator; returns how many rounds it moved.
 */
export async function upgradeOpenRounds(tx: TenantTransaction, now: Date): Promise<number> {
  const stale = await tx
    .select({ round: activities, templateId: roundPlans.templateId })
    .from(activities)
    .innerJoin(roundPlans, eq(roundPlans.id, activities.roundPlanId))
    .where(
      and(
        eq(activities.status, 'open'),
        isNull(activities.deletedAt),
        sql`${activities.formVersion} < (select max(${roundTemplateVersions.formVersion}) from ${roundTemplateVersions} where ${roundTemplateVersions.templateId} = ${roundPlans.templateId})`,
      ),
    )

  for (const { round, templateId } of stale) {
    const version = await newestVersion(tx, templateId)

    if (version === null || round.dueOn === null) {
      continue
    }

    const [moved] = await tx
      .update(activities)
      .set({
        formVersion: version.formVersion,
        countersignatureRequired: version.asksCountersignature,
        title: version.definition.title.trim().slice(0, activityLimits.title).trim(),
        updatedAt: now,
      })
      .where(and(eq(activities.id, round.id), eq(activities.status, 'open')))
      .returning({ id: activities.id })

    if (moved === undefined) {
      continue
    }

    const dueOn = round.dueOn
    const wanted = new Set(
      (await dutiesOf(tx, version.definition, round.propertyId))
        .filter((duty) => !dutyHasEnded(duty, dueOn))
        .map((duty) => duty.id as string),
    )
    const held = await tx
      .select({ id: activityDuties.id, dutyId: activityDuties.dutyId })
      .from(activityDuties)
      .where(and(eq(activityDuties.activityId, round.id), isNull(activityDuties.deletedAt)))
    const dropped = held.filter((row) => !wanted.has(row.dutyId))
    const added = [...wanted].filter((dutyId) => !held.some((row) => row.dutyId === dutyId))

    if (dropped.length > 0) {
      await tx
        .update(activityDuties)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          inArray(
            activityDuties.id,
            dropped.map((row) => row.id),
          ),
        )
    }

    if (added.length > 0) {
      await tx.insert(activityDuties).values(
        added.map((dutyId) => ({
          tenantId: round.tenantId,
          propertyId: round.propertyId,
          areaId: round.areaId,
          activityId: round.id,
          dutyId: dutyId as DutyId,
        })),
      )
    }
  }

  return stale.length
}
