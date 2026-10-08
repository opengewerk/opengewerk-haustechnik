import type { ApplicationDeadlineKind, Catalogue, DutyId } from '@opengewerk/haustechnik-domain'
import type { DeadlineActionHandler } from '@opengewerk/platform-server'

import type { deadlines } from '../database/schema/index.js'
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
 */
export function activityFromDeadline(
  catalogue: Catalogue,
): DeadlineActionHandler<ApplicationDeadlineKind, DeadlineRow> {
  return async ({ tx, tenantId, deadline, responsible, now }) => {
    // Only the appointment of a duty names this action; a deadline of a
    // defect follows no duty (#116).
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
