import {
  type AssignedToPerson,
  delegationInForce,
  type IsoDate,
  membershipRemovalDays,
  removalDay,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  type Database,
  removeAccountData,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { and, count, eq, inArray, isNotNull, isNull, lt, or, gte, sql } from 'drizzle-orm'

import { access } from '../authentication/access.js'
import {
  activities,
  duties,
  membershipRemovals,
  membershipSettings,
  roundPlans,
  tasks,
} from '../database/schema/index.js'
import { heldDelegations, standingOf } from '../delegations/reading.js'
import { forgetPushDevicesOf } from '../notifications/push.js'

/**
 * The end of an access (sections 2.4 and 9 of the concept, #356, decided
 * 15.10.2026). The last day stands on the membership (0069), and after it
 * the foundation refuses the person by itself. What follows here is what the
 * pass of the deadlines does about it: on the day after the last day it hands
 * back what was assigned to the person, and after the period of the operator
 * it removes the data no record needs.
 */

/** The operator a transaction works for, as the foundation set it. */
export async function tenantOf(tx: TenantTransaction): Promise<TenantId> {
  const result = await tx.execute(sql`select current_setting('app.tenant_id', true) as id`)

  return result.rows[0]?.['id'] as TenantId
}

/** The people whose last day here has passed. Somebody blocked is not among them: a block can be undone. */
export async function endedMembers(
  tx: TenantTransaction,
  today: IsoDate,
): Promise<ReadonlySet<string>> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(isNotNull(memberships.lastDay), lt(memberships.lastDay, today)))

  return new Set(rows.map((row) => row.userId))
}

/** The first who leads the operator and still works here, for a task nobody else can take. */
async function firstLead(tx: TenantTransaction, today: IsoDate): Promise<string | null> {
  const result = await tx.execute(sql`
    select m.user_id from memberships m
     where m.blocked_at is null and (m.last_day is null or m.last_day >= ${today})
       and exists (select 1 from tenant_roles r where r.tenant_id = m.tenant_id and r.leads and r.key = any (m.roles))
     order by m.created_at limit 1`)

  return (result.rows[0]?.['user_id'] as string | undefined) ?? null
}

/**
 * Hands back what was assigned to the people whose last day has passed
 * (decided 15.10.2026): their open and started activities go back to
 * planning, as do the plans of rounds they perform; their open tasks go to
 * whoever made them where that person still works here, else to the first
 * who leads the operator; and the duties they answer for themselves stand
 * without a person. A duty they answer for by a delegation follows the
 * delegation, which no longer counts for them (`applyDelegations`). What they
 * signed and what is done stays as it is. Every day once more, and the second
 * time there is nothing left.
 */
export async function handBackEndedAccesses(tx: TenantTransaction, today: IsoDate): Promise<void> {
  const ended = [...(await endedMembers(tx, today))]

  if (ended.length === 0) {
    return
  }

  const open = inArray(activities.status, ['open', 'started'])

  await tx
    .update(activities)
    .set({ performerUserId: null, updatedAt: new Date() })
    .where(and(open, inArray(activities.performerUserId, ended), isNull(activities.deletedAt)))
  await tx
    .update(activities)
    .set({ responsibleUserId: null, updatedAt: new Date() })
    .where(and(open, inArray(activities.responsibleUserId, ended), isNull(activities.deletedAt)))
  await tx
    .update(roundPlans)
    .set({ performerUserId: null, updatedAt: new Date() })
    .where(
      and(
        inArray(roundPlans.performerUserId, ended),
        isNull(roundPlans.deletedAt),
        or(isNull(roundPlans.endsOn), gte(roundPlans.endsOn, today)),
      ),
    )
  await tx
    .update(duties)
    .set({ responsibleUserId: null, updatedAt: new Date() })
    .where(
      and(
        inArray(duties.responsibleUserId, ended),
        isNull(duties.responsibleDelegationId),
        isNull(duties.deletedAt),
      ),
    )

  const openTasks = await tx
    .select({ id: tasks.id, createdBy: tasks.createdBy })
    .from(tasks)
    .where(
      and(eq(tasks.status, 'open'), inArray(tasks.assigneeUserId, ended), isNull(tasks.deletedAt)),
    )

  if (openTasks.length === 0) {
    return
  }

  const working = new Set(
    (
      await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            isNull(memberships.blockedAt),
            or(isNull(memberships.lastDay), gte(memberships.lastDay, today)),
          ),
        )
    ).map((row) => row.userId),
  )
  const lead = await firstLead(tx, today)

  for (const task of openTasks) {
    const next = task.createdBy !== null && working.has(task.createdBy) ? task.createdBy : lead

    if (next !== null) {
      await tx
        .update(tasks)
        .set({ assigneeUserId: next, updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
    }
  }
}

/**
 * What still hangs on a person (#356), for whoever sets their last day: open
 * activities assigned to them or that they answer for, the started among
 * them, plans of rounds they perform, open tasks, duties they answer for and
 * delegations of duties to them that are in force. Counted over every area,
 * because the access is the operator's.
 */
export async function assignedTo(
  tx: TenantTransaction,
  userId: string,
  today: IsoDate,
): Promise<AssignedToPerson> {
  const mine = or(eq(activities.performerUserId, userId), eq(activities.responsibleUserId, userId))
  const [open] = await tx
    .select({
      all: count(),
      started: sql<number>`count(*) filter (where ${activities.status} = 'started')`.mapWith(
        Number,
      ),
    })
    .from(activities)
    .where(and(mine, inArray(activities.status, ['open', 'started']), isNull(activities.deletedAt)))
  const [plans] = await tx
    .select({ all: count() })
    .from(roundPlans)
    .where(
      and(
        eq(roundPlans.performerUserId, userId),
        isNull(roundPlans.deletedAt),
        or(isNull(roundPlans.endsOn), gte(roundPlans.endsOn, today)),
      ),
    )
  const [openTasks] = await tx
    .select({ all: count() })
    .from(tasks)
    .where(and(eq(tasks.assigneeUserId, userId), eq(tasks.status, 'open'), isNull(tasks.deletedAt)))
  const [answered] = await tx
    .select({ all: count() })
    .from(duties)
    .where(
      and(
        eq(duties.responsibleUserId, userId),
        isNull(duties.deletedAt),
        or(isNull(duties.endsOn), gte(duties.endsOn, today)),
      ),
    )
  const delegations = (await heldDelegations(tx)).filter(
    (held) =>
      held.delegation.delegateUserId === userId && delegationInForce(standingOf(held), today),
  ).length

  return {
    activities: open?.all ?? 0,
    startedActivities: open?.started ?? 0,
    roundPlans: plans?.all ?? 0,
    tasks: openTasks?.all ?? 0,
    duties: answered?.all ?? 0,
    delegations,
  }
}

/** The period of an operator, or the standard where it set none. */
export async function removalDaysOf(tx: TenantTransaction): Promise<number> {
  const [setting] = await tx
    .select({ removalDays: membershipSettings.removalDays })
    .from(membershipSettings)

  return setting?.removalDays ?? membershipRemovalDays.standard
}

/**
 * Removes the data of every access of an operator whose period after the last
 * day has come (#356): the foundation takes the devices and the passkeys here
 * and, where the account works nowhere else, its address, passkeys, second
 * factor and password; the push subscriptions of the person here go as well.
 * Each removal is written down once, and the deadline drops out with it.
 *
 * Held by `membership-end.test.ts`, "removes after the period the devices,
 * the passkeys and the address, and leaves what the person signed as it
 * was": an account that works for one operator loses its address, one that
 * also works for a second operator (`u-both`) keeps address and account, and
 * the name and what the person signed stay for both. The guards inside the
 * foundation, that the last day has passed and that the account works
 * nowhere else, are held by `administration.test.ts` there (opengewerk#669).
 */
export async function removeEndedAccounts(
  database: Database,
  tx: TenantTransaction,
  tenantId: TenantId,
  today: IsoDate,
): Promise<number> {
  const days = await removalDaysOf(tx)
  const removed = new Set(
    (await tx.select({ userId: membershipRemovals.userId }).from(membershipRemovals)).map(
      (row) => row.userId,
    ),
  )
  const due = (
    await tx
      .select({ userId: memberships.userId, lastDay: memberships.lastDay })
      .from(memberships)
      .where(isNotNull(memberships.lastDay))
  ).filter(
    (row) =>
      row.lastDay !== null && !removed.has(row.userId) && removalDay(row.lastDay, days) <= today,
  )

  for (const { userId } of due) {
    const { account } = await removeAccountData(
      access,
      database,
      { tenantId, reason: 'membership.data_removal' },
      userId,
    )

    await forgetPushDevicesOf(tx, userId)
    await tx.insert(membershipRemovals).values({ tenantId, userId, accountRemoved: account })
  }

  return due.length
}
