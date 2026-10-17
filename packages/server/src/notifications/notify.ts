import {
  type ApplicationDeadlineKind,
  berlinClock,
  type DeadlineRegistry,
  type IsoDate,
  morningMinute,
  remindsBy,
  renderSignature,
  type Right,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  beforeItsEnd,
  type Database,
  deadlineRemindsOn,
  deadlineSettingsOf,
  responsibleFor,
  stillOpen,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, desc, eq, gte, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { application } from '../configuration.js'
import { inEveryArea } from '../database/every-area.js'
import {
  activities,
  activitySignatures,
  deadlines,
  faultReports,
  invitations,
  mailOutbox,
  mailSettings,
  memberAllAreas,
  memberAreas,
  memberships,
  pushOptOuts,
  pushOutbox,
  pushSubscriptions,
  tasks,
  tenantRoles,
  tenants,
  workOrderDecisions,
  workOrders,
} from '../database/schema/index.js'
import { deadlineKindRegistry } from '../deadlines/registry.js'
import { deadlineDueMessage, invitationMessage } from './templates.js'

type ActivityId = (typeof activities.$inferSelect)['id']
type SignatureId = (typeof activitySignatures.$inferSelect)['id']
type DecisionId = (typeof workOrderDecisions.$inferSelect)['id']
type TaskId = (typeof tasks.$inferSelect)['id']
type DeadlineId = (typeof deadlines.$inferSelect)['id']
type InvitationId = (typeof invitations.$inferSelect)['id']
type FaultReportId = (typeof faultReports.$inferSelect)['id']

/**
 * Something that happened and may be worth a message (#126).
 *
 * The notifications have exactly two sources, section 3 of the concept says:
 * a deadline that has come and a status that has changed. Whatever wants
 * somebody told raises one of these; it never writes a message itself, and it
 * never talks to a mail server or a push service. Each has one cause and is
 * written once for it in a channel, and its writer asks first whether there
 * is still something to tell and to whom.
 *
 * A deadline that reminds goes by mail and by push. Everything else an
 * operator tells its own people goes by push alone, and the invitation of an
 * access by mail alone.
 */
export type Notification =
  | {
      /**
       * A deadline that has come within its lead, of a kind that reminds. The
       * engine marks it reminded for its due day; the message goes once per
       * due day.
       */
      readonly kind: 'deadline_due'
      readonly deadlineId: DeadlineId
      readonly dueOn: IsoDate
    }
  | {
      /**
       * Somebody invited to work for the operator, with the link by mail
       * instead of handed on by whoever leads.
       */
      readonly kind: 'invitation'
      readonly invitationId: InvitationId
      readonly requestedBy: string
    }
  | {
      /**
       * A round, an inspection, a maintenance or a work order that went to
       * somebody, raised by the route that saved it. Once per activity and
       * person, so that an activity changed again tells nobody twice.
       */
      readonly kind: 'assigned'
      readonly activityId: ActivityId
      readonly userId: string
    }
  | {
      /**
       * A work order of the urgency "sofort", to whoever leads it, whatever
       * they switched off (section 4.8 of the concept). Raised by the route
       * that saved the order, once per order and person.
       */
      readonly kind: 'immediate'
      readonly activityId: ActivityId
      readonly userId: string
    }
  | {
      /** A task that falls due today, told on the morning of its day. */
      readonly kind: 'task_due'
      readonly taskId: TaskId
      readonly dueOn: IsoDate
    }
  | {
      /**
       * A round that waits for its countersignature or a work order that
       * waits for its acceptance, to one of the people it waits for. The
       * signature is the cause: an order signed again after it was sent back
       * waits again.
       */
      readonly kind: 'waiting'
      readonly activityId: ActivityId
      readonly signatureId: SignatureId
      readonly userId: string
    }
  | {
      /** A work order that was sent back, to whoever signed it. */
      readonly kind: 'work_order_rejected'
      readonly decisionId: DecisionId
    }
  | {
      /**
       * A fault reported in an area, to everybody who accepts faults there
       * but the person who reported it (#331, section 3 of the concept). Once
       * per report and person.
       */
      readonly kind: 'fault_received'
      readonly faultReportId: FaultReportId
      readonly userId: string
    }
  | {
      /**
       * A report accepted or done, to whoever reported it; a report merged
       * into another hears what that one hears (decided 15.10.2026). Once per
       * report and step.
       */
      readonly kind: 'fault_answered'
      readonly faultReportId: FaultReportId
      readonly step: 'accepted' | 'done'
    }

/** A notification of one kind, as the writer of that kind receives it. */
export type Of<Kind extends Notification['kind']> = Extract<Notification, { readonly kind: Kind }>

/** What every mail needs besides its cause: where the instance is reached. */
export interface NotifyContext {
  /** The first trusted origin, for links back into the instance. */
  readonly origin: string
  /** The kinds of deadline, the instance's own unless a test brings others. */
  readonly deadlineKinds?: DeadlineRegistry<ApplicationDeadlineKind>
}

/** The cause a message is written once for. */
export function causeOf(notification: Notification): string {
  switch (notification.kind) {
    case 'deadline_due':
      return `deadline_due:${notification.deadlineId}:${notification.dueOn}`
    case 'invitation':
      return `invitation:${notification.invitationId}`
    case 'assigned':
      return `assigned:${notification.activityId}:${notification.userId}`
    case 'immediate':
      return `immediate:${notification.activityId}:${notification.userId}`
    case 'task_due':
      return `task_due:${notification.taskId}:${notification.dueOn}`
    case 'waiting':
      return `waiting:${notification.signatureId}:${notification.userId}`
    case 'work_order_rejected':
      return `work_order_rejected:${notification.decisionId}`
    case 'fault_received':
      return `fault_received:${notification.faultReportId}:${notification.userId}`
    case 'fault_answered':
      return `fault_answered:${notification.faultReportId}:${notification.step}`
  }
}

/** The two ways a message goes out, each with its own outbox. */
export type Channel = 'mail' | 'push'

/** Whether a cause has no message in the outbox of this channel yet. */
function notToldBy(channel: Channel, tenant: SQL, cause: SQL): SQL {
  return channel === 'mail'
    ? sql`not exists (
        select 1 from ${mailOutbox}
         where ${mailOutbox.tenantId} = ${tenant}
           and ${mailOutbox.cause} = ${cause}
      )`
    : sql`not exists (
        select 1 from ${pushOutbox}
         where ${pushOutbox.tenantId} = ${tenant}
           and ${pushOutbox.cause} = ${cause}
      )`
}

/**
 * Whether a person has a device that takes push and has not switched this
 * occasion off. Asked where the job raises something for push every minute:
 * without it the same thing would be raised again and again for somebody who
 * will never get a message about it.
 */
function takesPush(tenant: SQL, user: SQL, occasion: string): SQL {
  return sql`exists (
      select 1 from ${pushSubscriptions}
       where ${pushSubscriptions.tenantId} = ${tenant}
         and ${pushSubscriptions.userId} = ${user}
    ) and not exists (
      select 1 from ${pushOptOuts}
       where ${pushOptOuts.tenantId} = ${tenant}
         and ${pushOptOuts.userId} = ${user}
         and ${pushOptOuts.occasion} = ${occasion}
    )`
}

/**
 * Whether a membership holds a right in an area: not shut out, a role of the
 * operator gives the right, and the person sees the area, every area or this
 * one. The same question the candidates of a task are found with.
 */
function mayIn(right: Right, area: SQL): SQL {
  return sql`${memberships.blockedAt} is null and ${beforeItsEnd()}
    and exists (
      select 1 from ${tenantRoles}
       where ${tenantRoles.tenantId} = ${memberships.tenantId}
         and ${tenantRoles.key} = any(${memberships.roles})
         and ${right} = any(${tenantRoles.rights}))
    and (exists (select 1 from ${memberAllAreas}
                  where ${memberAllAreas.tenantId} = ${memberships.tenantId}
                    and ${memberAllAreas.userId} = ${memberships.userId})
         or exists (select 1 from ${memberAreas}
                     where ${memberAreas.tenantId} = ${memberships.tenantId}
                       and ${memberAreas.userId} = ${memberships.userId}
                       and ${memberAreas.areaId} = ${area}))`
}

/**
 * How far back something counts that the job finds by its moment: a reminder,
 * a signature, a decision. The job looks every minute, and the margin is for
 * an instance that was down for a night. Switching mail or push on does not
 * send a pile of what happened long ago.
 */
const withinHours = 48

function since(now: Date): Date {
  return new Date(now.getTime() - withinHours * 3_600_000)
}

/** The actor of everything here: the operator, and nobody in particular. */
function actorOf(tenantId: TenantId) {
  return { tenantId, reason: 'notification' }
}

/** What the operator is called, which is how its mail is signed and whom it comes from. */
async function operatorName(tx: TenantTransaction): Promise<string> {
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants)

  return tenant?.name ?? application.name
}

/**
 * The signature under a message of this operator, finished.
 *
 * Put together when the message is written, like the rest of it: the row is
 * the record of what the operator said, and a signature changed next week
 * must not change what went out today. `sender` is the person a message goes
 * out for; a message nobody sent by hand has none.
 */
async function signatureFor(
  tx: TenantTransaction,
  tenantId: TenantId,
  operator: string,
  sender: string | null,
): Promise<string> {
  const [settings] = await tx
    .select({ signature: mailSettings.signature })
    .from(mailSettings)
    .where(eq(mailSettings.tenantId, tenantId))

  return renderSignature(settings?.signature ?? null, { operator, sender })
}

/**
 * The deadlines reminded lately whose kind reminds and whose message has not
 * been written in this channel, as notifications.
 *
 * The engine marks a deadline reminded for its due day when its lead comes,
 * whether or not anybody can be told; the mail job writes the message only
 * for an operator that has a mail server, the push job only for a person with
 * a device. A deadline has a place, so the question is asked in every area.
 */
export async function dueDeadlines(
  database: Database,
  tenantId: TenantId,
  now: Date,
  registry: DeadlineRegistry<ApplicationDeadlineKind> = deadlineKindRegistry,
  channel: Channel = 'mail',
): Promise<readonly Of<'deadline_due'>[]> {
  const reminding = registry.kinds.filter((kind) => kind.actions.includes('reminder'))

  if (reminding.length === 0) {
    return []
  }

  const rows = await inEveryArea(database, actorOf(tenantId), (tx) =>
    tx
      .select({ id: deadlines.id, dueOn: deadlines.dueOn })
      .from(deadlines)
      .where(
        and(
          eq(deadlines.status, 'open'),
          inArray(
            deadlines.kind,
            reminding.map((kind) => kind.key),
          ),
          eq(deadlines.remindedFor, deadlines.dueOn),
          gte(deadlines.remindedAt, since(now)),
          // Not of a kind the operator set to keep this channel quiet (#269).
          deadlineRemindsOn(channel, sql`${deadlines.tenantId}`, sql`${deadlines.kind}`),
          notToldBy(
            channel,
            sql`${deadlines.tenantId}`,
            sql`'deadline_due:' || ${deadlines.id}::text || ':' || to_char(${deadlines.dueOn}, 'YYYY-MM-DD')`,
          ),
        ),
      ),
  )

  return rows.map((row) => ({
    kind: 'deadline_due' as const,
    deadlineId: row.id,
    dueOn: row.dueOn as IsoDate,
  }))
}

/**
 * The deadline of a notification with its kind and the person it goes to, if
 * it is still open, of a kind that reminds, and reminded for the day the
 * notification is about; otherwise null. Asked by every channel, so that mail
 * and push agree on whom a deadline is told to and when not at all.
 *
 * It goes to the person its task went to, or, for a kind without a task, to
 * the person the engine would name now; somebody shut out in the meantime is
 * passed over for the next one, in the end whoever leads the operator.
 */
export async function deadlineStillDue(
  tx: TenantTransaction,
  tenantId: TenantId,
  notification: Of<'deadline_due'>,
  registry: DeadlineRegistry<ApplicationDeadlineKind>,
  channel: Channel = 'mail',
) {
  const [deadline] = await tx
    .select()
    .from(deadlines)
    .where(eq(deadlines.id, notification.deadlineId))
  const kind = deadline ? registry.kind(deadline.kind) : null

  if (
    !deadline ||
    !kind ||
    !kind.actions.includes('reminder') ||
    deadline.status !== 'open' ||
    deadline.dueOn !== notification.dueOn ||
    deadline.remindedFor !== deadline.dueOn
  ) {
    return null
  }

  const [task] = deadline.taskId
    ? await tx
        .select({ assignee: tasks.assigneeUserId })
        .from(tasks)
        .where(eq(tasks.id, deadline.taskId))
    : []
  const setting = (await deadlineSettingsOf(tx)).get(kind.key) ?? null

  // Set to keep this channel quiet since the message was raised (#269).
  if (!remindsBy(setting?.reminder ?? null, channel)) {
    return null
  }

  const recipient = await responsibleFor(tx, tenantId, kind, setting, {
    responsibleUserId: task?.assignee ?? deadline.responsibleUserId,
    naturalUserId: deadline.naturalUserId,
  })

  return recipient === null ? null : { deadline, kind, recipient }
}

/**
 * A deadline on its way to whoever answers for it, by mail.
 *
 * Only an open one, still due on the day it was reminded for, and only of a
 * kind that reminds. Sent by nobody. The mail names the kind, the day and
 * the way to the list; what the deadline follows, an asset, a property or the
 * words somebody typed about a defect, it leaves to the list.
 */
export async function deadlineDue(
  database: Database,
  tenantId: TenantId,
  notification: Of<'deadline_due'>,
  context: NotifyContext,
): Promise<readonly string[]> {
  const registry = context.deadlineKinds ?? deadlineKindRegistry
  const actor = actorOf(tenantId)

  const found = await inEveryArea(database, actor, async (tx) => {
    const due = await deadlineStillDue(tx, tenantId, notification, registry)

    if (!due) {
      return null
    }

    const operator = await operatorName(tx)

    return { ...due, operator, signature: await signatureFor(tx, tenantId, operator, null) }
  })

  if (!found) {
    return []
  }

  // The address lives with the account, on the instance, asked for exactly
  // the one identifier the operator gave.
  const account = (await accountsOf(database, [found.recipient], '')).get(found.recipient)

  if (!account) {
    return []
  }

  const text = deadlineDueMessage({
    deadline: {
      kind: found.kind.title,
      dueOn: found.deadline.dueOn,
    },
    recipientName: account.name || null,
    origin: context.origin,
    signature: found.signature,
  })

  const written = await database.forTenant(actor, (tx) =>
    tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'deadline_due',
        cause: causeOf(notification),
        senderName: found.operator,
        recipientAddress: account.email,
        recipientName: account.name || null,
        subject: text.subject,
        body: text.body,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id }),
  )

  return written.map((row) => row.id)
}

/**
 * An invitation on its way to the person invited.
 *
 * Only an open one: called back, used or run out before the message is
 * written, it gets none. The message holds a placeholder where the link goes;
 * the job makes the token when it sends, so that no row ever keeps a way in.
 */
export async function invitationByMail(
  database: Database,
  tenantId: TenantId,
  notification: Of<'invitation'>,
): Promise<readonly string[]> {
  const actor = { ...actorOf(tenantId), userId: notification.requestedBy }

  const found = await database.forTenant(actor, async (tx) => {
    const [invitation] = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
        invitedBy: invitations.invitedBy,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(and(eq(invitations.id, notification.invitationId), stillOpen()))

    return invitation ? { invitation, operator: await operatorName(tx) } : null
  })

  if (!found) {
    return []
  }

  // The one who invited works here, the invitation says so; their name is
  // looked up on the instance for exactly that identifier.
  const inviter = (await accountsOf(database, [found.invitation.invitedBy], '')).get(
    found.invitation.invitedBy,
  )
  const text = invitationMessage({
    name: found.invitation.name,
    operator: found.operator,
    inviter: inviter?.name || null,
    expiresAt: found.invitation.expiresAt,
    application: application.name,
    signature: await database.forTenant(actor, (tx) =>
      signatureFor(tx, tenantId, found.operator, inviter?.name || null),
    ),
  })

  const written = await database.forTenant(actor, (tx) =>
    tx
      .insert(mailOutbox)
      .values({
        tenantId,
        kind: 'invitation',
        cause: causeOf(notification),
        invitationId: found.invitation.id,
        requestedBy: notification.requestedBy,
        senderName: found.operator,
        recipientAddress: found.invitation.email,
        recipientName: found.invitation.name,
        subject: text.subject,
        body: text.body,
      })
      .onConflictDoNothing({ target: [mailOutbox.tenantId, mailOutbox.cause] })
      .returning({ id: mailOutbox.id }),
  )

  return written.map((row) => row.id)
}

/**
 * The tasks due today whose person takes push and has not been told, as
 * notifications. Only the day itself counts, and only from the morning on: a
 * task written for a day already past has been late since it was written.
 *
 * A task the deadline engine made is left out (#242): its person was
 * reminded when the lead of the deadline began, for the same thing.
 */
export async function dueTasks(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Of<'task_due'>[]> {
  const { day, minute } = berlinClock(now)

  if (minute < morningMinute) {
    return []
  }

  const rows = await inEveryArea(database, actorOf(tenantId), (tx) =>
    tx
      .select({ id: tasks.id, dueOn: tasks.dueOn })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'open'),
          isNull(tasks.deletedAt),
          eq(tasks.dueOn, day),
          sql`not exists (
            select 1 from ${deadlines}
             where ${deadlines.tenantId} = ${tasks.tenantId}
               and ${deadlines.taskId} = ${tasks.id})`,
          notToldBy(
            'push',
            sql`${tasks.tenantId}`,
            sql`'task_due:' || ${tasks.id}::text || ':' || to_char(${tasks.dueOn}, 'YYYY-MM-DD')`,
          ),
          takesPush(sql`${tasks.tenantId}`, sql`${tasks.assigneeUserId}`, 'task_due'),
        ),
      ),
  )

  return rows.map((row) => ({
    kind: 'task_due' as const,
    taskId: row.id,
    dueOn: row.dueOn as IsoDate,
  }))
}

/**
 * The task of a notification, if it is still open, not removed and due on the
 * day the notification is about, and its person still works for the operator;
 * otherwise null.
 */
export async function taskStillDue(
  tx: TenantTransaction,
  notification: Of<'task_due'>,
): Promise<{ readonly assignee: string } | null> {
  const [task] = await tx
    .select({ assignee: tasks.assigneeUserId })
    .from(tasks)
    .innerJoin(
      memberships,
      and(
        eq(memberships.tenantId, tasks.tenantId),
        eq(memberships.userId, tasks.assigneeUserId),
        isNull(memberships.blockedAt),
        beforeItsEnd(),
      ),
    )
    .where(
      and(
        eq(tasks.id, notification.taskId),
        eq(tasks.status, 'open'),
        isNull(tasks.deletedAt),
        eq(tasks.dueOn, notification.dueOn),
      ),
    )

  return task ?? null
}

/** The last signature of whoever did the work, for one activity: what it waits with. */
function lastSignatureOf(activity: SQL): SQL {
  return sql`(select s.id from ${activitySignatures} s
               where s.tenant_id = ${activities.tenantId}
                 and s.activity_id = ${activity}
                 and s.role = 'signer'
                 and s.deleted_at is null
               order by s.signed_at desc, s.id desc
               limit 1)`
}

/** Whom a signed activity waits for, as a condition on a membership beside it. */
function waitsFor(): SQL {
  // A work order waits for whoever leads it, where it names somebody who did
  // not sign it themselves; otherwise, like a round, for everybody who may
  // accept in its area. Never for whoever signed.
  return sql`${memberships.userId} <> ${activitySignatures.signedBy}
    and case
      when ${activities.kind} = 'work_order'
       and ${activities.responsibleUserId} is not null
       and ${activities.responsibleUserId} <> ${activitySignatures.signedBy}
      then ${memberships.userId} = ${activities.responsibleUserId}
       and ${memberships.blockedAt} is null and ${beforeItsEnd()}
      else ${mayIn('activity.accept', sql`${activities.areaId}`)}
    end`
}

/** An activity that is signed and waits for a second person: a work order, or a round that asks for one. */
function waiting(): SQL {
  return sql`${activities.status} = 'signed'
    and ${activities.deletedAt} is null
    and (${activities.kind} = 'work_order'
         or (${activities.kind} = 'round' and ${activities.countersignatureRequired}))`
}

/**
 * The rounds that wait for their countersignature and the work orders that
 * wait for their acceptance, signed lately, one notification per person they
 * wait for who takes push and has not been told.
 */
export async function waitingActivities(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Of<'waiting'>[]> {
  const rows = await inEveryArea(database, actorOf(tenantId), (tx) =>
    tx
      .select({
        activityId: activities.id,
        signatureId: activitySignatures.id,
        userId: memberships.userId,
      })
      .from(activities)
      .innerJoin(
        activitySignatures,
        and(
          eq(activitySignatures.tenantId, activities.tenantId),
          sql`${activitySignatures.id} = ${lastSignatureOf(sql`${activities.id}`)}`,
        ),
      )
      .innerJoin(memberships, eq(memberships.tenantId, activities.tenantId))
      .where(
        and(
          waiting(),
          gte(activitySignatures.signedAt, since(now)),
          waitsFor(),
          notToldBy(
            'push',
            sql`${activities.tenantId}`,
            sql`'waiting:' || ${activitySignatures.id}::text || ':' || ${memberships.userId}`,
          ),
          takesPush(sql`${activities.tenantId}`, sql`${memberships.userId}`, 'waiting'),
        ),
      ),
  )

  return rows.map((row) => ({ kind: 'waiting' as const, ...row }))
}

/**
 * The activity of a notification, if it still waits with the signature the
 * notification names, for the person it names; otherwise null. A round
 * countersigned or an order decided in the meantime waits for nobody.
 */
export async function stillWaiting(
  tx: TenantTransaction,
  notification: Of<'waiting'>,
): Promise<{ readonly kind: (typeof activities.$inferSelect)['kind'] } | null> {
  const [found] = await tx
    .select({ kind: activities.kind })
    .from(activities)
    .innerJoin(
      activitySignatures,
      and(
        eq(activitySignatures.tenantId, activities.tenantId),
        sql`${activitySignatures.id} = ${lastSignatureOf(sql`${activities.id}`)}`,
      ),
    )
    .innerJoin(memberships, eq(memberships.tenantId, activities.tenantId))
    .where(
      and(
        eq(activities.id, notification.activityId),
        eq(activitySignatures.id, notification.signatureId),
        eq(memberships.userId, notification.userId),
        waiting(),
        waitsFor(),
      ),
    )

  return found ?? null
}

/**
 * The work orders sent back lately whose signer takes push and has not been
 * told, as notifications.
 */
export async function rejectedOrders(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Of<'work_order_rejected'>[]> {
  const rows = await inEveryArea(database, actorOf(tenantId), (tx) =>
    tx
      .select({ id: workOrderDecisions.id })
      .from(workOrderDecisions)
      .where(
        and(
          eq(workOrderDecisions.decision, 'rejected'),
          isNull(workOrderDecisions.deletedAt),
          gte(workOrderDecisions.decidedAt, since(now)),
          notToldBy(
            'push',
            sql`${workOrderDecisions.tenantId}`,
            sql`'work_order_rejected:' || ${workOrderDecisions.id}::text`,
          ),
          // The work on the order still goes on, and somebody who signed it
          // before it was sent back takes push. Who exactly is told the writer
          // decides, `stillRejected`.
          sql`exists (
            select 1 from ${activitySignatures}
              join ${workOrders}
                on ${workOrders.tenantId} = ${activitySignatures.tenantId}
               and ${workOrders.activityId} = ${activitySignatures.activityId}
              join ${activities}
                on ${activities.tenantId} = ${workOrders.tenantId}
               and ${activities.id} = ${workOrders.activityId}
             where ${workOrders.tenantId} = ${workOrderDecisions.tenantId}
               and ${workOrders.id} = ${workOrderDecisions.workOrderId}
               and ${activities.deletedAt} is null
               and ${activities.status} = 'started'
               and ${activitySignatures.role} = 'signer'
               and ${activitySignatures.deletedAt} is null
               and ${activitySignatures.signedAt} <= ${workOrderDecisions.decidedAt}
               and ${takesPush(
                 sql`${activitySignatures.tenantId}`,
                 sql`${activitySignatures.signedBy}`,
                 'work_order_rejected',
               )})`,
        ),
      ),
  )

  return rows.map((row) => ({ kind: 'work_order_rejected' as const, decisionId: row.id }))
}

/**
 * The work order of a rejection with whoever signed it last before it was
 * sent back, if the work on it still goes on; otherwise null. An order signed
 * again or closed in the meantime has nothing left to say about the
 * rejection, and whoever sent their own order back needs no message.
 */
export async function stillRejected(
  tx: TenantTransaction,
  notification: Of<'work_order_rejected'>,
): Promise<{ readonly activityId: ActivityId; readonly signer: string } | null> {
  const [decision] = await tx
    .select({
      activityId: workOrders.activityId,
      decidedAt: workOrderDecisions.decidedAt,
      decidedBy: workOrderDecisions.decidedBy,
      status: activities.status,
    })
    .from(workOrderDecisions)
    .innerJoin(
      workOrders,
      and(
        eq(workOrders.tenantId, workOrderDecisions.tenantId),
        eq(workOrders.id, workOrderDecisions.workOrderId),
      ),
    )
    .innerJoin(
      activities,
      and(eq(activities.tenantId, workOrders.tenantId), eq(activities.id, workOrders.activityId)),
    )
    .where(
      and(
        eq(workOrderDecisions.id, notification.decisionId),
        eq(workOrderDecisions.decision, 'rejected'),
        isNull(workOrderDecisions.deletedAt),
        isNull(activities.deletedAt),
      ),
    )

  if (!decision || decision.status !== 'started') {
    return null
  }

  const [signature] = await tx
    .select({ signedBy: activitySignatures.signedBy })
    .from(activitySignatures)
    .innerJoin(
      memberships,
      and(
        eq(memberships.tenantId, activitySignatures.tenantId),
        eq(memberships.userId, activitySignatures.signedBy),
        isNull(memberships.blockedAt),
        beforeItsEnd(),
      ),
    )
    .where(
      and(
        eq(activitySignatures.activityId, decision.activityId),
        eq(activitySignatures.role, 'signer'),
        isNull(activitySignatures.deletedAt),
        lte(activitySignatures.signedAt, decision.decidedAt),
      ),
    )
    .orderBy(desc(activitySignatures.signedAt), desc(activitySignatures.id))
    .limit(1)

  return signature && signature.signedBy !== decision.decidedBy
    ? { activityId: decision.activityId, signer: signature.signedBy }
    : null
}

/** An activity that is still open for somebody to do: not signed, not done, not closed. */
const stillToDo = ['open', 'started'] as const

/**
 * The activity of a notification, if it is still to do and still names the
 * person as the one who leads it, who does it or who takes part in it;
 * otherwise null. Handed to somebody else in the meantime, it tells the
 * first person nothing.
 */
export async function stillAssigned(
  tx: TenantTransaction,
  notification: Of<'assigned'> | Of<'immediate'>,
): Promise<{
  readonly kind: (typeof activities.$inferSelect)['kind']
  readonly dueOn: string | null
  readonly immediate: boolean
} | null> {
  const [activity] = await tx
    .select({
      kind: activities.kind,
      dueOn: activities.dueOn,
      status: activities.status,
      responsible: activities.responsibleUserId,
      performer: activities.performerUserId,
      urgency: workOrders.urgency,
      takesPart: sql<boolean>`exists (
        select 1 from work_order_participants p
         where p.tenant_id = ${activities.tenantId}
           and p.activity_id = ${activities.id}
           and p.user_id = ${notification.userId}
           and p.deleted_at is null)`,
    })
    .from(activities)
    .leftJoin(
      workOrders,
      and(
        eq(workOrders.tenantId, activities.tenantId),
        eq(workOrders.activityId, activities.id),
        isNull(workOrders.deletedAt),
      ),
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.tenantId, activities.tenantId),
        eq(memberships.userId, notification.userId),
        isNull(memberships.blockedAt),
        beforeItsEnd(),
      ),
    )
    .where(and(eq(activities.id, notification.activityId), isNull(activities.deletedAt)))

  if (!activity || !(stillToDo as readonly string[]).includes(activity.status)) {
    return null
  }

  const leads = activity.responsible === notification.userId
  const named = leads || activity.performer === notification.userId || activity.takesPart

  if (notification.kind === 'immediate') {
    return leads && activity.urgency === 'immediate'
      ? { kind: activity.kind, dueOn: activity.dueOn, immediate: true }
      : null
  }

  return named
    ? { kind: activity.kind, dueOn: activity.dueOn, immediate: activity.urgency === 'immediate' }
    : null
}

/** A report still in the inbox by itself: not merged, not rejected and never accepted. */
function inTheInbox(): SQL {
  return sql`${faultReports.mergedIntoId} is null
    and ${faultReports.rejectedAt} is null
    and ${faultReports.workOrderId} is null`
}

/**
 * The reports received lately, one notification per person who accepts faults
 * in their area, takes push and has not been told; never to the person who
 * reported it (#331).
 */
export async function receivedFaults(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Of<'fault_received'>[]> {
  const rows = await inEveryArea(database, actorOf(tenantId), (tx) =>
    tx
      .select({ faultReportId: faultReports.id, userId: memberships.userId })
      .from(faultReports)
      .innerJoin(memberships, eq(memberships.tenantId, faultReports.tenantId))
      .where(
        and(
          inTheInbox(),
          gte(faultReports.receivedAt, since(now)),
          // Nobody is told of their own report; one without an account (#332) has
          // nobody, and everybody who accepts is told.
          sql`${memberships.userId} is distinct from ${faultReports.reportedBy}`,
          mayIn('fault.accept', sql`${faultReports.areaId}`),
          notToldBy(
            'push',
            sql`${faultReports.tenantId}`,
            sql`'fault_received:' || ${faultReports.id}::text || ':' || ${memberships.userId}`,
          ),
          takesPush(sql`${faultReports.tenantId}`, sql`${memberships.userId}`, 'fault_received'),
        ),
      ),
  )

  return rows.map((row) => ({ kind: 'fault_received' as const, ...row }))
}

/** Whether the report of a notification is still in the inbox, for a person who still accepts faults in its area. */
export async function stillReceived(
  tx: TenantTransaction,
  notification: Of<'fault_received'>,
): Promise<boolean> {
  const [found] = await tx
    .select({ id: faultReports.id })
    .from(faultReports)
    .innerJoin(memberships, eq(memberships.tenantId, faultReports.tenantId))
    .where(
      and(
        eq(faultReports.id, notification.faultReportId),
        eq(memberships.userId, notification.userId),
        inTheInbox(),
        mayIn('fault.accept', sql`${faultReports.areaId}`),
      ),
    )

  return found !== undefined
}

/** The report a feedback follows: the report itself, or the one it went into. */
const followed = alias(faultReports, 'followed_report')
const followedOrder = alias(workOrders, 'followed_order')
const followedWork = alias(activities, 'followed_work')

/** The reports with the order of the report they follow, and their reporter where that person still works here. */
function answeredRows(tx: TenantTransaction) {
  return tx
    .select({ faultReportId: faultReports.id, reportedBy: faultReports.reportedBy })
    .from(faultReports)
    .innerJoin(
      followed,
      sql`${followed.id} = coalesce(${faultReports.mergedIntoId}, ${faultReports.id})`,
    )
    .innerJoin(followedOrder, eq(followedOrder.id, followed.workOrderId))
    .innerJoin(followedWork, eq(followedWork.id, followedOrder.activityId))
    .innerJoin(
      memberships,
      and(
        eq(memberships.tenantId, faultReports.tenantId),
        eq(memberships.userId, faultReports.reportedBy),
        isNull(memberships.blockedAt),
        beforeItsEnd(),
      ),
    )
}

/** Where the order a report follows stands for a step: under way or done for "accepted", done for "done". */
function reached(step: 'accepted' | 'done'): SQL {
  return step === 'accepted'
    ? sql`${followedWork.deletedAt} is null and ${followedWork.status} in ('open', 'started', 'signed', 'done')`
    : sql`${followedWork.deletedAt} is null and ${followedWork.status} in ('signed', 'done')`
}

/**
 * The reports accepted or done lately, one notification per report and step
 * for a reporter who takes push and has not been told (#331). Done is the
 * signature under the order (decided 15.10.2026).
 */
export async function answeredFaults(
  database: Database,
  tenantId: TenantId,
  now: Date,
): Promise<readonly Of<'fault_answered'>[]> {
  const from = since(now)
  const told = (step: 'accepted' | 'done') =>
    notToldBy(
      'push',
      sql`${faultReports.tenantId}`,
      sql`'fault_answered:' || ${faultReports.id}::text || ${`:${step}`}`,
    )
  const takes = takesPush(
    sql`${faultReports.tenantId}`,
    sql`${faultReports.reportedBy}`,
    'fault_answered',
  )

  return inEveryArea(database, actorOf(tenantId), async (tx) => {
    const accepted = await answeredRows(tx).where(
      and(reached('accepted'), gte(followed.acceptedAt, from), told('accepted'), takes),
    )
    const done = await answeredRows(tx).where(
      and(
        reached('done'),
        sql`exists (
          select 1 from ${activitySignatures}
           where ${activitySignatures.tenantId} = ${followedWork.tenantId}
             and ${activitySignatures.activityId} = ${followedWork.id}
             and ${activitySignatures.role} = 'signer'
             and ${activitySignatures.deletedAt} is null
             and ${activitySignatures.signedAt} >= ${from})`,
        told('done'),
        takes,
      ),
    )

    return [
      ...accepted.map((row) => ({
        kind: 'fault_answered' as const,
        faultReportId: row.faultReportId,
        step: 'accepted' as const,
      })),
      ...done.map((row) => ({
        kind: 'fault_answered' as const,
        faultReportId: row.faultReportId,
        step: 'done' as const,
      })),
    ]
  })
}

/** Who reported the report of a notification, if it still stands where the step says; otherwise null. */
export async function stillAnswered(
  tx: TenantTransaction,
  notification: Of<'fault_answered'>,
): Promise<string | null> {
  const [found] = await answeredRows(tx).where(
    and(eq(faultReports.id, notification.faultReportId), reached(notification.step)),
  )

  return found?.reportedBy ?? null
}
