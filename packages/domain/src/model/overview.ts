import type { IsoDate } from '@opengewerk/platform-domain'

import type { ActivityKind } from './activity.js'
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

/**
 * What is to do at a place, in the words of the Lagebild (section 4.1 of the
 * concept, #121): the duties overdue, due and never recorded, the defects not
 * yet checked again, and the measuring points whose reading for the key date
 * is missing. Each is the total of a list narrowed to the place: the register
 * of duties by its state, the defects under "Offen" and the meters under
 * "fehlt". Derived on the day it is read and never kept (section 2.2).
 *
 * A duty counts once, in its state: never recorded comes before overdue, and
 * the states do not overlap. "Fällig" is the state of the register, counted
 * with the lead of each deadline (decision 41 of phase 1).
 */
export interface PlaceToDo {
  readonly overdue: number
  readonly due: number
  readonly neverRecorded: number
  /** Null for whoever may not read the defects. */
  readonly openDefects: number | null
  /** Null for whoever may not read the assets. */
  readonly missingReadings: number | null
}

/** What is to do at a property, over all of it, and at each of its buildings. */
export interface PropertyToDo extends PlaceToDo {
  readonly propertyId: string
  readonly buildings: readonly (PlaceToDo & { readonly buildingId: string })[]
}

/**
 * What is to do at every property the person asking sees, each with its
 * buildings: the numbers of the list "Liegenschaften", counted in one go for
 * the whole list and not row by row.
 */
export interface PlacesToDo {
  /** The key date the readings are asked for. */
  readonly keyDate: IsoDate
  readonly properties: readonly PropertyToDo[]
}

/**
 * What came of an activity, as the last activities of a Lagebild say it: begun,
 * signed and waiting for the countersignature, not performed, or done, and
 * then without defects, with defects or failed, as its duties and the defects
 * found in it say. A work order done is done.
 */
export const activityOutcomes = [
  'started',
  'signed',
  'not_performed',
  'without_defects',
  'with_defects',
  'failed',
  'done',
] as const

export type ActivityOutcome = (typeof activityOutcomes)[number]

export const activityOutcomeLabel: Readonly<Record<ActivityOutcome, string>> = {
  started: 'Begonnen',
  signed: 'Unterschrieben',
  not_performed: 'Nicht durchgeführt',
  without_defects: 'Ohne Mangel',
  with_defects: 'Mit Mängeln',
  failed: 'Nicht bestanden',
  done: 'Erledigt',
}

/**
 * An activity at a building as the Lagebild lists it: the day, what it is and
 * what came of it. No person: who performed it stands on its page (decision
 * 42 of phase 1).
 */
export interface LastActivity {
  readonly id: string
  readonly kind: ActivityKind
  readonly title: string
  /** The number of a work order, `AU-2026-0031`; none for the other kinds. */
  readonly number: string | null
  /** The day it was performed on, or for one begun the day it was last changed. */
  readonly day: IsoDate
  readonly outcome: ActivityOutcome
}

/** How many of the last activities the Lagebild lists. */
export const lastActivitiesShown = 5

/** The Lagebild of a building: what is to do there, and its last activities. */
export interface BuildingSituation extends PlaceToDo {
  readonly keyDate: IsoDate
  /** Null for whoever may not read the activities. */
  readonly lastActivities: readonly LastActivity[] | null
}
