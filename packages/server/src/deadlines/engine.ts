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
  everyTenant,
  type RepeatingJob,
  runDeadlineCycle as runFoundationCycle,
  runDeadlinesOf as runFoundationDeadlinesOf,
  startRepeating,
} from '@opengewerk/platform-server'

import { activityFromDeadline } from '../activities/from-deadline.js'
import { inEveryArea } from '../database/every-area.js'
import { applyDelegations } from '../delegations/apply.js'
import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import { deadlines } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { mayAnswerForDeadlines } from './answerers.js'
import { deadlineKindRegistry } from './registry.js'
import { upgradeOpenRounds } from '../rounds/plans.js'
import { settleDeadlineTasks, taskFromDeadline } from '../tasks/from-deadline.js'
import { handBackEndedAccesses, removeEndedAccounts } from '../memberships/end.js'
import { removeAfterRetention } from '../retention/removal.js'
import {
  activityRetentionSource,
  contractSource,
  delegationSource,
  qualificationSource,
  evidenceSource,
  type DeadlineValues,
  defectRetentionSource,
  defectSource,
  documentSource,
  dutySource,
  membershipRemovalSource,
  membershipSource,
  meterSource,
  roundPlanSource,
  warrantySource,
} from './sources.js'

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
  removalFailed: (tenantId: TenantId) =>
    `Die Angaben beendeter Zugänge des Betreibers ${tenantId} ließen sich nicht entfernen.`,
  retentionFailed: (tenantId: TenantId) =>
    `Was nach Ablauf seiner Aufbewahrung beim Betreiber ${tenantId} geht, ließ sich nicht löschen.`,
}

/**
 * The engine of the foundation (ADR 0010 in the repository opengewerk) over
 * the kinds, sources and columns of this application: the appointments of
 * the duties, with the reminder of the foundation and the activity that is
 * to meet a duty as the actions (#105), the days the defects are to be set
 * right by, with the reminder (#116), the next pass of the plan of a round,
 * whose action makes its rounds (#113), and the reading of the meters of a
 * property, whose action gives whoever answers for it the task (#242).
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
      round_plan: roundPlanSource({
        today: () => dayInGermany(job.now?.() ?? new Date()),
        catalogue: job.catalogue,
      }),
      meter: meterSource({ today: () => dayInGermany(job.now?.() ?? new Date()) }),
      // The day of the newest version of a document, its expiry or for a
      // risk assessment its review (#327).
      document: documentSource(false),
      risk_assessment: documentSource(true),
      // The day to give notice and the end of a contract, and the end of a warranty (#329).
      contract_notice: contractSource('notice', {
        today: () => dayInGermany(job.now?.() ?? new Date()),
      }),
      contract_end: contractSource('end', { today: () => dayInGermany(job.now?.() ?? new Date()) }),
      warranty: warrantySource(),
      // The end of a delegation of duties (#336).
      delegation: delegationSource({ today: () => dayInGermany(job.now?.() ?? new Date()) }),
      // The expiry of a qualification of a person (#337).
      qualification: qualificationSource({
        today: () => dayInGermany(job.now?.() ?? new Date()),
        catalogue: job.catalogue,
      }),
      // The end of the retention of an evidence (#340).
      evidence: evidenceSource({ today: () => dayInGermany(job.now?.() ?? new Date()) }),
      // The end of the retention of an activity without evidence and of a remedied defect (#412).
      activity_retention: activityRetentionSource({
        today: () => dayInGermany(job.now?.() ?? new Date()),
      }),
      defect_retention: defectRetentionSource({
        today: () => dayInGermany(job.now?.() ?? new Date()),
      }),
      // The end of an access and the day its data goes (#356).
      membership: membershipSource({ today: () => dayInGermany(job.now?.() ?? new Date()) }),
      membership_removal: membershipRemovalSource(),
    },
    actions: { activity: activityFromDeadline(job.catalogue), task: taskFromDeadline() },
    // A round nobody has begun walks the newest version of its template, and
    // a task whose deadline no longer waits for its day is done.
    complete: async (tx, now) => {
      await upgradeOpenRounds(tx, now)
      await settleDeadlineTasks(tx, now)
      // What an access that has ended hands back, before the delegations
      // are applied, which no longer count for it (#356).
      await handBackEndedAccesses(tx, dayInGermany(now))
      // A delegation of duties begins and ends on a day (#336).
      await applyDelegations(tx, job.catalogue, dayInGermany(now))
    },
    sentences,
    inTenant: (actor, work) => inEveryArea(job.database, actor, work),
    // A reminder only for somebody who sees the area of the deadline (#473).
    mayAnswer: mayAnswerForDeadlines,
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
  return runFoundationDeadlinesOf(bound(job), tenantId, now).then(async (report) => {
    await removeEndedAccounts(job.database, tenantId, dayInGermany(now))
    await removeAfterRetention(job.database, tenantId)

    return report
  })
}

/**
 * One pass over every operator. An operator whose pass fails does not stop
 * the others, and how each pass ended is written down for the office.
 */
export async function runDeadlineCycle(job: DeadlineJob): Promise<DeadlineReport> {
  const report = await runFoundationCycle(bound(job))

  // The data of an access whose period after its last day has come (#356),
  // after the passes and outside their transactions: the foundation opens
  // transactions of its own for the account. One operator whose removal fails
  // does not stop the others, and the next cycle tries it again.
  for (const tenantId of await everyTenant(job.database)) {
    try {
      await removeEndedAccounts(job.database, tenantId, dayInGermany(job.now?.() ?? new Date()))
    } catch (error) {
      console.error(sentences.removalFailed(tenantId), error)
    }

    // What goes once its retention has ended without a confirmation (#412):
    // a task done, the person at a reading and at a booking.
    try {
      await removeAfterRetention(job.database, tenantId)
    } catch (error) {
      console.error(sentences.retentionFailed(tenantId), error)
    }
  }

  return report
}

/** Runs the engine every minute, one cycle after the other and never two at once. */
export function startDeadlineWorker(job: DeadlineJob, intervalMs = 60_000): RepeatingJob {
  return startRepeating({
    run: () => runDeadlineCycle(job),
    intervalMs,
    firstAfterMs: 10_000,
    failure: 'Der Abgleich der Fristen ist gescheitert.',
  })
}
