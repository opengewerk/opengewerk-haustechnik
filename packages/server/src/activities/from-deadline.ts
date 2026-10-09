import {
  addDays,
  type ApplicationDeadlineKind,
  berlinClock,
  type Catalogue,
  type DutyId,
  leadOf,
} from '@opengewerk/haustechnik-domain'
import type { DeadlineActionHandler } from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'

import { type deadlines, roundPlans } from '../database/schema/index.js'
import { fillRounds } from '../rounds/plans.js'
import { makeActivityForDuty } from './for-duty.js'

/** A deadline of this application as the engine hands it to an action. */
type DeadlineRow = typeof deadlines.$inferSelect

/**
 * The action "activity" of the appointment of a duty (#105, section 4.4 of
 * the concept): when the lead of a due day begins, an inspection or a
 * maintenance comes of it, with the person who answers for the deadline, due
 * on the due day, at the place of the duty and meeting the duty
 * (`makeActivityForDuty`).
 *
 * Once for a due day: the engine of the foundation calls an action in the
 * transaction that marks the deadline reminded for that day, and of two runs
 * only one gets the mark. A duty that already has an activity under way, one
 * made by hand among them (#183), gets no second one, so that a due day that
 * moved, because its interval was changed, adds nothing to what is planned.
 *
 * The next pass of the plan of a round (#113) makes the rounds of the plan
 * from today as far ahead as the lead reaches, each pass once
 * (`fillRounds`). The deadline then moves on to the first pass after them,
 * whose lead begins the next day.
 */
export function activityFromDeadline(
  catalogue: Catalogue,
): DeadlineActionHandler<ApplicationDeadlineKind, DeadlineRow> {
  return async ({ tx, tenantId, kind, setting, deadline, responsible, now }) => {
    if (deadline.roundPlanId !== null) {
      const [plan] = await tx
        .select()
        .from(roundPlans)
        .where(and(eq(roundPlans.id, deadline.roundPlanId), eq(roundPlans.tenantId, tenantId)))

      if (plan !== undefined) {
        const today = berlinClock(now).day

        await fillRounds(tx, plan, today, addDays(today, leadOf(kind, setting, deadline.leadDays)))
      }

      return
    }

    // A deadline of a defect follows no duty and names no action (#116).
    if (deadline.dutyId === null) {
      return
    }

    await makeActivityForDuty(tx, catalogue, {
      tenantId,
      dutyId: deadline.dutyId as DutyId,
      dueOn: deadline.dueOn,
      responsible,
      now,
    })
  }
}
