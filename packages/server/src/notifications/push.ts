import {
  type ActivityKind,
  type ApplicationDeadlineKind,
  berlinClock,
  type DeadlineRegistry,
  type PushEntry,
  pushEntries,
  type PushOccasion,
  pushOccasionWords,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import type { Database, PushDraft, PushRules, TenantTransaction } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { application } from '../configuration.js'
import { inEveryArea } from '../database/every-area.js'
import { deadlineKindRegistry } from '../deadlines/registry.js'
import { pushSubscriptions } from '../database/schema/index.js'
import { pushes } from '../push/outbox.js'
import {
  causeOf,
  deadlineStillDue,
  type Notification,
  type Of,
  stillAnswered,
  stillAssigned,
  stillReceived,
  stillRejected,
  stillWaiting,
  taskStillDue,
} from './notify.js'
import {
  assignedPush,
  deadlineDuePush,
  faultAnsweredPush,
  faultReceivedPush,
  immediatePush,
  rejectedPush,
  taskDuePush,
  testPush,
  waitingPush,
} from './templates.js'

/**
 * The second channel of the notifications (#126): push messages to the
 * devices of the people of an operator, beside the mail a deadline reminds
 * with.
 *
 * Every writer asks first whether there is still something to tell and to
 * whom, from the state of things right now, in every area of the operator: a
 * run works for nobody, and what it reads has a place. What a message says is
 * a title and one line that name no person and no place (`templates.ts`);
 * where a tap leads is an address of the application, which shows what is
 * behind it only to somebody who is signed in and sees the area. Writing, one
 * message per device, and sending are the foundation's (`pushStore`).
 */

type Urls = Readonly<Record<PushEntry, string>>

/** The start of the entry on site, where the device shows what is due from its own data. */
const onSite = '/m/'

/** Where a tap leads for what has no page of its own. */
const links = {
  deadline_due: { office: '/fristen', site: onSite },
  task_due: { office: '/aufgaben', site: onSite },
  test: { office: '/konto', site: onSite },
} as const satisfies Readonly<Record<string, Urls>>

/** The page of an activity in the office, by its kind. */
function activityUrls(kind: ActivityKind, id: string): Urls {
  const office =
    kind === 'work_order'
      ? `/auftraege/${id}`
      : kind === 'round'
        ? `/rundgaenge/${id}`
        : `/pruefungen/${id}`

  return { office, site: onSite }
}

/**
 * What this application says about push to the routes of the foundation: a
 * device works in the office or on site, the occasions in the words of
 * "Konto", and the test message.
 */
/**
 * Forgets the devices a person took push on at this operator (#356): once the
 * data of an access that ended goes, nothing is to be sent there any more.
 */
export async function forgetPushDevicesOf(tx: TenantTransaction, userId: string): Promise<void> {
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
}

export const pushRules: PushRules<PushEntry, PushOccasion> = {
  store: pushes,
  entries: pushEntries,
  entryRefused: 'Ein Gerät arbeitet im Büro ("office") oder vor Ort ("site").',
  occasions: pushOccasionWords,
  test: { text: testPush(application.name), urls: links.test },
}

/** What a push message needs besides its cause: the moment, and the kinds of deadline. */
export interface PushNotifyContext {
  readonly now: Date
  readonly deadlineKinds?: DeadlineRegistry<ApplicationDeadlineKind>
}

function hoursAfter(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 3_600_000)
}

/** The end of the day in Berlin that `now` falls on, give or take the hour of a clock change. */
function endOfDay(now: Date): Date {
  return new Date(now.getTime() + (24 * 60 - berlinClock(now).minute) * 60_000)
}

/** Asks in every area of the operator, as a run that works for nobody does. */
function ask<Result>(
  database: Database,
  tenantId: TenantId,
  question: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return inEveryArea(database, { tenantId, reason: 'notification' }, question)
}

/** Writes the message of a draft, one per signed in device of its person. */
function write(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  draft: Omit<PushDraft<PushEntry, PushOccasion>, 'cause'>,
  now: Date,
): Promise<readonly string[]> {
  return pushes.write(database, tenantId, { ...draft, cause: causeOf(notification) }, now)
}

/** The push messages of a deadline that reminds, to the person who answers for it, or none. */
export async function pushDeadlineDue(
  database: Database,
  tenantId: TenantId,
  notification: Of<'deadline_due'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const registry = context.deadlineKinds ?? deadlineKindRegistry
  const due = await ask(database, tenantId, (tx) =>
    deadlineStillDue(tx, tenantId, notification, registry, 'push'),
  )

  if (!due) {
    return []
  }

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'deadline_due',
      userId: due.recipient,
      text: deadlineDuePush({ kind: due.kind.title, dueOn: due.deadline.dueOn }),
      urls: links.deadline_due,
      // A reminder comes its lead before the day; a day late it still helps.
      expiresAt: hoursAfter(context.now, 24),
    },
    context.now,
  )
}

/** The push messages of an activity that went to somebody, or none. */
export async function pushAssigned(
  database: Database,
  tenantId: TenantId,
  notification: Of<'assigned'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const activity = await ask(database, tenantId, (tx) => stillAssigned(tx, notification))

  if (!activity) {
    return []
  }

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'assigned',
      userId: notification.userId,
      text: assignedPush({ kind: activity.kind, dueOn: activity.dueOn }),
      urls: activityUrls(activity.kind, notification.activityId),
      expiresAt: hoursAfter(context.now, 24),
    },
    context.now,
  )
}

/**
 * The push messages of a work order of the urgency "sofort", to whoever
 * leads it, whatever they switched off (section 4.8 of the concept), or none.
 */
export async function pushImmediate(
  database: Database,
  tenantId: TenantId,
  notification: Of<'immediate'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const activity = await ask(database, tenantId, (tx) => stillAssigned(tx, notification))

  if (!activity) {
    return []
  }

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'assigned',
      always: true,
      userId: notification.userId,
      text: immediatePush(),
      urls: activityUrls(activity.kind, notification.activityId),
      expiresAt: hoursAfter(context.now, 24),
    },
    context.now,
  )
}

/** The push messages of a task due today, one for every device of its person, or none. */
export async function pushTaskDue(
  database: Database,
  tenantId: TenantId,
  notification: Of<'task_due'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const task = await ask(database, tenantId, (tx) => taskStillDue(tx, notification))

  if (!task) {
    return []
  }

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'task_due',
      userId: task.assignee,
      text: taskDuePush(),
      urls: links.task_due,
      // A task due today is worth a message until the day is over.
      expiresAt: endOfDay(context.now),
    },
    context.now,
  )
}

/** The push messages of a round or a work order that waits for a second person, or none. */
export async function pushWaiting(
  database: Database,
  tenantId: TenantId,
  notification: Of<'waiting'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const activity = await ask(database, tenantId, (tx) => stillWaiting(tx, notification))

  if (!activity) {
    return []
  }

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'waiting',
      userId: notification.userId,
      text: waitingPush(activity.kind),
      urls: activityUrls(activity.kind, notification.activityId),
      expiresAt: hoursAfter(context.now, 24),
    },
    context.now,
  )
}

/** The push messages of a work order that was sent back, to whoever signed it, or none. */
export async function pushRejected(
  database: Database,
  tenantId: TenantId,
  notification: Of<'work_order_rejected'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const order = await ask(database, tenantId, (tx) => stillRejected(tx, notification))

  if (!order) {
    return []
  }

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'work_order_rejected',
      userId: order.signer,
      text: rejectedPush(),
      urls: activityUrls('work_order', order.activityId),
      expiresAt: hoursAfter(context.now, 24),
    },
    context.now,
  )
}

/** The push message of a fault received in an area, to one who accepts faults there, or none (#331). */
export async function pushFaultReceived(
  database: Database,
  tenantId: TenantId,
  notification: Of<'fault_received'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  if (!(await ask(database, tenantId, (tx) => stillReceived(tx, notification)))) {
    return []
  }

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'fault_received',
      userId: notification.userId,
      text: faultReceivedPush(),
      urls: { office: `/stoerungen/${notification.faultReportId}`, site: onSite },
      expiresAt: hoursAfter(context.now, 24),
    },
    context.now,
  )
}

/** The push message of a report accepted or done, to whoever reported it, or none (#331). */
export async function pushFaultAnswered(
  database: Database,
  tenantId: TenantId,
  notification: Of<'fault_answered'>,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  const reporter = await ask(database, tenantId, (tx) => stillAnswered(tx, notification))

  if (reporter === null) {
    return []
  }

  // The own reports are a page on site, for every role that reports.
  const own = `/m/meldungen/${notification.faultReportId}`

  return write(
    database,
    tenantId,
    notification,
    {
      kind: 'fault_answered',
      userId: reporter,
      text: faultAnsweredPush(notification.step),
      urls: { office: own, site: own },
      expiresAt: hoursAfter(context.now, 24),
    },
    context.now,
  )
}
