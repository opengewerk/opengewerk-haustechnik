import type { Id, IsoDate, Synced } from '@opengewerk/platform-domain'

import type { ActivityId, WorkOrderId } from './activity.js'
import { calendarDay, oneOf, optional, type Problems, required } from './fields.js'
import type { PlaceTarget } from './target.js'

/**
 * A defect (section 4.6 of the concept, ADR 0002, point 15): what was noticed,
 * always at an asset or a place, from a round, a test, a fault report or by
 * hand, with its class, the day by which it is to be set right, and its
 * status until it is remedied and checked again.
 */
export type DefectId = Id<'defect'>

/**
 * The status of a defect, in the order of section 4.6: found, ordered,
 * remedied, checked again. "Remedied" comes from the work order that set it
 * right; checking it again is a step of its own.
 */
export const defectStatuses = ['found', 'ordered', 'remedied', 'verified'] as const

export type DefectStatus = (typeof defectStatuses)[number]

export const defectStatusLabel: Readonly<Record<DefectStatus, string>> = {
  found: 'Festgestellt',
  ordered: 'Beauftragt',
  remedied: 'Behoben',
  verified: 'Nachgeprüft',
}

/** The bounds of the texts of a defect, the same in the form, the sync and the database. */
export const defectLimits = {
  description: 1000,
  defectClass: 130,
} as const

/**
 * A defect at its place: the property always, and at most one of a building,
 * a room or an asset there, like a duty and an activity.
 *
 * Its class is a key, `<package>.<key>`. Section 4.4 of the concept takes the
 * classes from the package, which names them in its `mangelklassen.json`
 * since opengewerk-haustechnik#61 (`defectClass` and `defectClasses` of the
 * catalogue). Nothing holds the class of a defect against the catalogue yet;
 * that comes with the screens of the defects, and a defect may have none.
 */
export interface Defect extends Synced, PlaceTarget {
  readonly id: DefectId
  /** The activity it was noticed in, if there was one. */
  readonly foundInActivityId: ActivityId | null
  /** The work order that sets it right, once there is one. */
  readonly remedyWorkOrderId: WorkOrderId | null
  readonly description: string
  readonly defectClass: string | null
  readonly foundOn: IsoDate
  /** The day by which it is to be set right; the default of each class is the operator's. */
  readonly dueOn: IsoDate | null
  readonly status: DefectStatus
}

/**
 * What is wrong with a defect, one sentence per field. Undefined is a field
 * that was not given and is not asked about; the day by which it is to be set
 * right is held against the day it was found when the record names both.
 */
export function defectProblems(defect: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, defect, 'description', defectLimits.description, 'Die Beschreibung')
  optional(
    problems,
    defect,
    'defectClass',
    defectLimits.defectClass,
    `Die Klasse hat höchstens ${String(defectLimits.defectClass)} Zeichen.`,
  )
  oneOf(
    problems,
    defect,
    'status',
    defectStatuses,
    `Der Stand ist einer von: ${defectStatuses.map((status) => defectStatusLabel[status]).join(', ')}.`,
  )

  const foundOn = defect['foundOn']
  const dueOn = defect['dueOn']

  if (foundOn !== undefined && !calendarDay(foundOn)) {
    problems['foundOn'] = 'Der Tag der Feststellung ist ein Tag, geschrieben 2026-10-03.'
  }

  if (dueOn !== undefined && dueOn !== null && !calendarDay(dueOn)) {
    problems['dueOn'] = 'Die Frist zur Beseitigung ist ein Tag, geschrieben 2026-10-03.'
  } else if (calendarDay(foundOn) && calendarDay(dueOn) && dueOn < foundOn) {
    // ISO dates sort the same way as the days they name.
    problems['dueOn'] = 'Die Frist zur Beseitigung liegt nicht vor dem Tag der Feststellung.'
  }

  return problems
}
