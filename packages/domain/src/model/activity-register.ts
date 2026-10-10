import type { DeadlineInterval, IsoDate } from '@opengewerk/platform-domain'

import type {
  ActivityDutyId,
  ActivityId,
  ActivityKind,
  ActivityStatus,
  DueActivityKind,
} from './activity.js'
import type { QualificationLevel } from './catalogue.js'
import type { DutyState } from './duty.js'
import type { DutyId, DutyPerformer } from './duty-record.js'
import type { DutyPerson } from './duty-register.js'
import type { EvidenceResult } from './evidence.js'
import type { PlaceTarget } from './target.js'

/**
 * The list "Prüfungen" and the page of one activity in the office (section
 * 4.4 of the concept, #105): the inspections and the maintenance that came of
 * the due days of the duties, with who answers for each and who performs it.
 * What the server answers and the office reads.
 *
 * Whoever plans and hands out work sees every one in their areas. Whoever
 * only performs sees what is given to them or to nobody, as their device
 * holds it: the list tells nobody who else works on what.
 */

/**
 * What the list is narrowed to under "Stand": what is still to be done (open,
 * begun, or signed and waiting), what of that waits for the report of a
 * contractor, what is done, what was not performed, or everything.
 *
 * "Bericht fehlt" (#122) is derived, because the application does not hold
 * the day a contractor came: an inspection or a maintenance a contractor
 * performs, whose day has passed and which is neither signed nor settled by
 * a report (decision 39 of phase 1, 10.10.2026). It is what the overview
 * counts as "Nachweis fehlt".
 */
export const activityListStates = [
  'pending',
  'report_missing',
  'done',
  'not_performed',
  'all',
] as const

export type ActivityListState = (typeof activityListStates)[number]

export const activityListStateLabel: Readonly<Record<ActivityListState, string>> = {
  pending: 'Offen',
  report_missing: 'Bericht fehlt',
  done: 'Erledigt',
  not_performed: 'Nicht durchgeführt',
  all: 'Alle',
}

/**
 * The states of an activity each choice of the list holds. "Bericht fehlt"
 * holds more than a state: the server narrows it to a contractor and to a
 * day that has passed.
 */
export const activityListStatuses: Readonly<
  Record<ActivityListState, readonly ActivityStatus[] | null>
> = {
  pending: ['open', 'started', 'signed'],
  report_missing: ['open', 'started'],
  done: ['done'],
  not_performed: ['not_performed'],
  all: null,
}

/** How many activities a page holds, and how many one may ask for at most. */
export const activityListPage = { size: 50, most: 200 } as const

/** What the list may be narrowed to besides its state, each one a part of the address. */
export interface ActivityListFilter {
  readonly kind?: DueActivityKind
  readonly propertyId?: string
  /** An area of the person asking: the activities at the places in it (#122). */
  readonly areaId?: string
  /** A part of the title of the activity or of the name of its property. */
  readonly search?: string
}

/**
 * An activity as the list shows it: what it is and where, the day it is due
 * on, how far it is, who answers for it, and who performs it, a person of the
 * operator or a contractor.
 */
export interface ActivityEntry extends PlaceTarget {
  readonly id: ActivityId
  readonly kind: ActivityKind
  readonly title: string
  readonly status: ActivityStatus
  readonly dueOn: IsoDate | null
  readonly responsible: DutyPerson | null
  readonly performer: DutyPerformer | null
  readonly performerPerson: DutyPerson | null
  readonly contractorNote: string | null
}

/** A page of the list, with how many pass the filters and whether a further page follows. */
export interface ActivityList {
  readonly total: number
  readonly more: boolean
  readonly activities: readonly ActivityEntry[]
}

/**
 * A duty an activity is to meet, as its page shows it: what the duty is and
 * where it comes from, its interval, how it stands today with the day it is
 * due on, and what came of it in this activity.
 */
export interface ActivityDutyLine {
  readonly id: ActivityDutyId
  readonly dutyId: DutyId
  readonly title: string
  /** The source of the duty: the reference of its kind, or what the operator wrote for one of its own. */
  readonly source: string | null
  readonly interval: DeadlineInterval | null
  readonly state: DutyState
  readonly appointment: IsoDate | null
  readonly lastMetOn: IsoDate | null
  /** Who may carry it out, as the duty kind of the catalogue says; nothing for a duty of the operator's own. */
  readonly qualification: QualificationLevel | null
  /** Whether the report of a contractor is evidence of it, as its kind says (#110). */
  readonly takesReport: boolean
  readonly result: EvidenceResult | null
  readonly resultReason: string | null
}

/** The page of an activity: what the list says, with the duties it meets and when it came about. */
export interface ActivityDetails extends ActivityEntry {
  readonly createdAt: string
  readonly performedOn: IsoDate | null
  readonly closingReason: string | null
  readonly duties: readonly ActivityDutyLine[]
}

/**
 * Who may be named in the plan of an activity: who answers for it among those
 * who plan and hand out work, and who performs it among those who perform
 * activities, each of them seeing the area of the activity and not shut out.
 * The name and nothing else of a person.
 */
export interface ActivityCandidates {
  readonly responsible: readonly DutyPerson[]
  readonly performers: readonly DutyPerson[]
}
