import type {
  ApplicationDeadlineKind,
  Catalogue,
  DeadlineRegistry,
  TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  type Database,
  type DeadlineEngine,
  type DeadlineReport,
  type RepeatingJob,
  runDeadlineCycle as runFoundationCycle,
  runDeadlinesOf as runFoundationDeadlinesOf,
  startDeadlineWorker as startFoundationWorker,
} from '@opengewerk/platform-server'

import { activityFromDeadline } from '../activities/from-deadline.js'
import { inEveryArea } from '../database/every-area.js'
import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import { deadlines } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { deadlineKindRegistry } from './registry.js'
import { type DeadlineValues, defectSource, dutySource } from './sources.js'

export type { DeadlineReport } from '@opengewerk/platform-server'

/** What the engine needs, handed in so that a test can bring a clock and kinds of its own. */
export interface DeadlineJob {
  readonly database: Database
  /** The catalogue the titles of duty kinds are read from. */
  readonly catalogue: Catalogue
  readonly registry?: DeadlineRegistry<ApplicationDeadlineKind>
  readonly now?: () => Date
}

/** The sentence of the engine that names an operator. */
const sentences = {
  tenantFailed: (tenantId: TenantId) =>
    `Die Fristen des Betreibers ${tenantId} ließen sich nicht abgleichen.`,
}

/**
 * The engine of the foundation (ADR 0010 in the repository opengewerk) over
 * the kinds, sources and columns of this application: the appointments of
 * the duties, with the reminder of the foundation and the activity that is
 * to meet a duty as the actions (#105), and the days the defects are to be
 * set right by, with the reminder (#116).
 *
 * A pass works for nobody, and the deadlines and duties carry the areas of
 * their property (ADR 0003): each transaction of a pass therefore opens every
 * area of the operator (`inEveryArea`). The routes of the deadlines stay on
 * the transaction of the person who asked.
 */
function bound(
  job: DeadlineJob,
): DeadlineEngine<ApplicationDeadlineKind, ApplicationDeadlineColumns, DeadlineValues> {
  return {
    database: job.database,
    table: deadlines,
    registry: job.registry ?? deadlineKindRegistry,
    sources: {
      duty: dutySource({
        catalogue: job.catalogue,
        today: () => dayInGermany(job.now?.() ?? new Date()),
      }),
      defect: defectSource(),
    },
    actions: { activity: activityFromDeadline(job.catalogue) },
    sentences,
    inTenant: (actor, work) => inEveryArea(job.database, actor, work),
    ...(job.now ? { now: job.now } : {}),
  }
}

/**
 * One pass over one operator: first the sources, then what has come within
 * its lead. How a pass goes is the foundation's, `runDeadlinesOf` there.
 */
export function runDeadlinesOf(
  job: DeadlineJob,
  tenantId: TenantId,
  now: Date,
): Promise<DeadlineReport> {
  return runFoundationDeadlinesOf(bound(job), tenantId, now)
}

/**
 * One pass over every operator. An operator whose pass fails does not stop
 * the others, and how each pass ended is written down for the office.
 */
export function runDeadlineCycle(job: DeadlineJob): Promise<DeadlineReport> {
  return runFoundationCycle(bound(job))
}

/** Runs the engine every minute, one pass after the other and never two at once. */
export function startDeadlineWorker(job: DeadlineJob, intervalMs = 60_000): RepeatingJob {
  return startFoundationWorker(bound(job), intervalMs)
}
