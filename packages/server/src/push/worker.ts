import type {
  ApplicationDeadlineKind,
  DeadlineRegistry,
  PushEntry,
  PushOccasion,
  TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  type Database,
  type PushJob as FoundationPushJob,
  type PushPost,
  type PushReport,
  type RepeatingJob,
  runPushCycle as runFoundationCycle,
  startPushWorker as startFoundationWorker,
  type VapidKeys,
} from '@opengewerk/platform-server'

import { occasions } from '../notifications/occasions.js'
import { pushes } from './outbox.js'

export type { PushReport } from '@opengewerk/platform-server'

/** What the job needs, handed in so that a test can bring a push service and a clock of its own. */
export interface PushJob {
  readonly database: Database
  readonly vapid: VapidKeys
  readonly post: PushPost
  /** The kinds of deadline, the instance's own unless a test brings others. */
  readonly deadlineKinds?: DeadlineRegistry<ApplicationDeadlineKind>
  readonly now?: () => Date
}

/** The sentence of the job that names an operator. */
const sentences = {
  tenantFailed: (tenantId: TenantId) =>
    `Die Push-Nachrichten des Betreibers ${tenantId} ließen sich nicht senden.`,
}

/**
 * The job of the foundation (ADR 0010 in the repository opengewerk) over the
 * occasions of this application (#126): a deadline that reminds, a task due
 * this morning, a round or a work order that waits for a second person and a
 * work order sent back, raised from what the rows say and decided the same
 * way as for mail.
 */
function bound(job: PushJob): FoundationPushJob<PushEntry, PushOccasion> {
  return {
    database: job.database,
    vapid: job.vapid,
    post: job.post,
    store: pushes,
    raise: occasions.raisePush(
      job.database,
      job.deadlineKinds ? { deadlineKinds: job.deadlineKinds } : {},
    ),
    sentences,
    ...(job.now ? { now: job.now } : {}),
  }
}

/**
 * One pass over every operator that has a device taking push messages: take
 * off the devices that were signed out, write what has become due, send what
 * is waiting. How a pass goes is the foundation's, `runPushCycle` there.
 */
export function runPushCycle(job: PushJob): Promise<PushReport> {
  return runFoundationCycle(bound(job))
}

/** Runs the job every minute, one pass after the other and never two at once. */
export function startPushWorker(job: PushJob, intervalMs = 60_000): RepeatingJob {
  return startFoundationWorker(bound(job), intervalMs)
}
