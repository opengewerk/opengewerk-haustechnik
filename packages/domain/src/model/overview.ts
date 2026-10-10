import type { IsoDate } from '@opengewerk/platform-domain'

import type { DefectEntry } from './defect-register.js'
import type { DutyEntry } from './duty-register.js'

/**
 * The overview of the operator's responsibility (section 4.3 of the concept,
 * scenario 1, #122), the start page of the office: over every property the
 * person asking sees, or over one of their areas, how many duties are
 * overdue, fall due in the next 30 and 90 days and were never recorded, for
 * how many inspections and maintenance the report of a contractor is
 * missing, and how many defects are past their deadline.
 *
 * Every number is the total of a list the office has, narrowed the same way:
 * the register of duties, the list "Prüfungen" and the defects. The server
 * counts them with the filters of those lists, so that a number and the list
 * it leads to agree.
 *
 * It names nobody (section 4.16): neither who answers for a duty nor who
 * performs an activity, and no number about a person.
 */

/** A duty as the overview names it: what it is, where, its appointment and its state. */
export type OverviewDuty = Pick<
  DutyEntry,
  | 'id'
  | 'title'
  | 'state'
  | 'appointment'
  | 'propertyId'
  | 'buildingId'
  | 'roomId'
  | 'assetId'
  | 'asset'
>

/** How many of each list the overview names one by one; the rest is behind its link. */
export const overviewShown = { soon: 8, neverRecorded: 3, defectsOverdue: 3 } as const

export interface Overview {
  /** The day the numbers are counted on, in Germany. */
  readonly today: IsoDate
  readonly overdue: number
  /** Not overdue, and the appointment within 30 days; the 90 days hold the 30. */
  readonly dueIn30Days: number
  readonly dueIn90Days: number
  readonly neverRecorded: number
  /** Null for whoever may not read the activities, who is not shown the list either. */
  readonly reportsMissing: number | null
  /** Null for whoever may not read the defects. */
  readonly defectsOverdue: number | null
  /** The overdue duties and those of the next 30 days, the first ones in the order of the register. */
  readonly soon: readonly OverviewDuty[]
  /** How many there are of those, overdue and in 30 days together. */
  readonly soonTotal: number
  /** The first duties never recorded, in the order of the register. */
  readonly neverRecordedFirst: readonly OverviewDuty[]
  /** The first defects past their deadline, in the order of their register; null as above. */
  readonly defectsOverdueFirst: readonly DefectEntry[] | null
}
