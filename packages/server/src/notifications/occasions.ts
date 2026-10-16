import type {
  ApplicationDeadlineKind,
  DeadlineRegistry,
  TenantId,
} from '@opengewerk/haustechnik-domain'
import { type Database, occasionsOf } from '@opengewerk/platform-server'

import {
  causeOf,
  deadlineDue,
  dueDeadlines,
  dueTasks,
  invitationByMail,
  type Notification,
  type NotifyContext,
  rejectedOrders,
  answeredFaults,
  receivedFaults,
  waitingActivities,
} from './notify.js'
import {
  pushAssigned,
  pushDeadlineDue,
  pushImmediate,
  type PushNotifyContext,
  pushFaultAnswered,
  pushFaultReceived,
  pushRejected,
  pushTaskDue,
  pushWaiting,
} from './push.js'

/** What the writers of this application need beside the moment: the kinds of deadline, for a test. */
export interface NotificationExtra {
  readonly deadlineKinds?: DeadlineRegistry<ApplicationDeadlineKind>
}

/**
 * The occasions of this application, one per kind of notification, for the
 * mechanism of the foundation (`occasionsOf`, ADR 0010 in the repository
 * opengewerk): what is due by itself, who is told, what a message says and
 * where it leads (#126, section 3 of the concept).
 *
 * A deadline that reminds goes by mail and by push, an invitation by mail,
 * everything else by push. The deadline, the task due this morning, the round
 * or work order that waits and the work order sent back are raised by the
 * jobs every minute, from what the rows say; the invitation, an activity
 * handed to somebody and a work order of the urgency "sofort" by the route
 * that saved them.
 */
export const occasions = occasionsOf<Notification, NotificationExtra>({
  deadline_due: {
    causeOf,
    raise: {
      mail: (database, tenantId, now, extra) =>
        dueDeadlines(database, tenantId, now, extra.deadlineKinds, 'mail'),
      push: (database, tenantId, now, extra) =>
        dueDeadlines(database, tenantId, now, extra.deadlineKinds, 'push'),
    },
    mail: deadlineDue,
    push: pushDeadlineDue,
  },
  invitation: {
    causeOf,
    mail: (database, tenantId, notification) => invitationByMail(database, tenantId, notification),
  },
  assigned: { causeOf, push: pushAssigned },
  immediate: { causeOf, push: pushImmediate },
  task_due: {
    causeOf,
    raise: { push: (database, tenantId, now) => dueTasks(database, tenantId, now) },
    push: pushTaskDue,
  },
  waiting: {
    causeOf,
    raise: { push: (database, tenantId, now) => waitingActivities(database, tenantId, now) },
    push: pushWaiting,
  },
  work_order_rejected: {
    causeOf,
    raise: { push: (database, tenantId, now) => rejectedOrders(database, tenantId, now) },
    push: pushRejected,
  },
  fault_received: {
    causeOf,
    raise: { push: (database, tenantId, now) => receivedFaults(database, tenantId, now) },
    push: pushFaultReceived,
  },
  fault_answered: {
    causeOf,
    raise: { push: (database, tenantId, now) => answeredFaults(database, tenantId, now) },
    push: pushFaultAnswered,
  },
})

/**
 * Turns a notification into a mail in the outbox, or into nothing.
 *
 * The only door a mail is written through. It decides who is told and what
 * the message says, from the state of things right now. Sending is not done
 * here; the row waits for the job, and that is what lets a message survive a
 * mail server that is gone for an afternoon. Written once per cause: asked
 * twice for the same one, the second time finds the row and writes nothing.
 */
export function notify(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  context: NotifyContext,
): Promise<readonly string[]> {
  return occasions.mail(database, tenantId, notification, { ...context, now: new Date() })
}

/**
 * Turns a notification into push messages, one for every device of the
 * person it is for, or into nothing. Returns the identifiers of the messages.
 */
export function notifyPush(
  database: Database,
  tenantId: TenantId,
  notification: Notification,
  context: PushNotifyContext,
): Promise<readonly string[]> {
  return occasions.push(database, tenantId, notification, context)
}
