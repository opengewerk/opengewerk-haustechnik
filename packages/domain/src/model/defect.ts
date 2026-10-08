import { addDays, type Id, type IsoDate, type Synced } from '@opengewerk/platform-domain'

import type { ActivityId, WorkOrderId } from './activity.js'
import { generalPackage } from './asset-duplicate.js'
import type { Catalogue, CatalogueDefectClass } from './catalogue.js'
import type { EvidenceId } from './evidence.js'
import { calendarDay, oneOf, optional, type Problems, required, wholeFromTo } from './fields.js'
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
  checkNote: 1000,
} as const

/**
 * Whether the day to set a defect right by still asks for something: while it
 * is found or ordered. Once remedied, its deadline is met; checking it again
 * is a step without a deadline (section 4.6 of the concept).
 */
export function awaitsRemedy(status: DefectStatus): boolean {
  return status === 'found' || status === 'ordered'
}

/** Whether a defect is past the day it was to be set right by, on a day. */
export function isOverdue(
  defect: { readonly status: DefectStatus; readonly dueOn: IsoDate | null },
  today: IsoDate,
): boolean {
  // ISO dates sort the same way as the days they name.
  return awaitsRemedy(defect.status) && defect.dueOn !== null && defect.dueOn < today
}

/**
 * A defect at its place: the property always, and at most one of a building,
 * a room or an asset there, like a duty and an activity.
 *
 * Its class is a key, `<package>.<key>`, of the classes the package names in
 * its `mangelklassen.json` (opengewerk-haustechnik#61). Which of them a
 * defect may take says `defectClassChoices`, and the routes hold the class
 * against it; a reported defect has none until whoever keeps defects gives
 * it one (section 4.6 of the concept).
 */
export interface Defect extends Synced, PlaceTarget {
  readonly id: DefectId
  /** The activity it was noticed in, if there was one. */
  readonly foundInActivityId: ActivityId | null
  /** The evidence of the report that named it, if it came from one (#110). */
  readonly foundInEvidenceId: EvidenceId | null
  /** The work order that sets it right, once there is one. */
  readonly remedyWorkOrderId: WorkOrderId | null
  readonly description: string
  readonly defectClass: string | null
  readonly foundOn: IsoDate
  /** The day by which it is to be set right; the default of each class is the operator's. */
  readonly dueOn: IsoDate | null
  readonly status: DefectStatus
  /** The day it was last checked again, whichever way that came out. */
  readonly checkedOn: IsoDate | null
  /** What was found when it was last checked again. */
  readonly checkNote: string | null
}

/**
 * What is wrong with a defect, one sentence per field. Undefined is a field
 * that was not given and is not asked about; the day by which it is to be set
 * right is held against the day it was found when the record names both, and
 * the day it was found against today where that is given (a route; a device
 * may send what it noted on a day that has passed since).
 */
export function defectProblems(
  defect: Readonly<Record<string, unknown>>,
  today?: IsoDate,
): Readonly<Problems> {
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
  } else if (today !== undefined && calendarDay(foundOn) && foundOn > today) {
    problems['foundOn'] = 'Der Tag der Feststellung liegt nicht in der Zukunft.'
  }

  if (dueOn !== undefined && dueOn !== null && !calendarDay(dueOn)) {
    problems['dueOn'] = 'Die Frist zur Beseitigung ist ein Tag, geschrieben 2026-10-03.'
  } else if (calendarDay(foundOn) && calendarDay(dueOn) && dueOn < foundOn) {
    // ISO dates sort the same way as the days they name.
    problems['dueOn'] = 'Die Frist zur Beseitigung liegt nicht vor dem Tag der Feststellung.'
  }

  return problems
}

/**
 * The classes a defect may take, in the order they are offered (section 4.6
 * of the concept): one found in a test takes those of the packages of its
 * duty kinds, any other the three general ones of the package Allgemein. A
 * test whose packages name no classes of their own leaves the general ones
 * too, so that every defect has classes to choose from (#116).
 *
 * The duty kinds are the keys `<package>.<key>` of the duties of the activity
 * or of the report the defect was found in; none for one reported by hand or
 * in a round.
 */
export function defectClassChoices(
  catalogue: Pick<Catalogue, 'defectClasses'>,
  dutyKinds: readonly (string | null)[],
): readonly CatalogueDefectClass[] {
  const packages = [
    ...new Set(
      dutyKinds.flatMap((kind) => (kind === null ? [] : [kind.slice(0, kind.indexOf('.'))])),
    ),
  ]
  const own = packages.flatMap((name) => catalogue.defectClasses(name))

  return own.length > 0 ? own : catalogue.defectClasses(generalPackage)
}

/** What a route says to a class that is not among those a defect may take. */
export const classNotOffered = 'Diese Klasse steht für diesen Mangel nicht zur Wahl.'

/**
 * What whoever keeps defects may still change of one: nothing once it was
 * checked again, because then it is done (#116). The sentence, or null.
 */
export function defectChangeRefusal(status: DefectStatus): string | null {
  return status === 'verified'
    ? 'Ein nachgeprüfter Mangel ist erledigt und ändert sich nicht mehr.'
    : null
}

/**
 * How checking a remedied defect again comes out (section 4.6): it is set
 * right, or it is not.
 */
export const defectCheckOutcomes = ['verified', 'not_remedied'] as const

export type DefectCheckOutcome = (typeof defectCheckOutcomes)[number]

export const defectCheckOutcomeLabel: Readonly<Record<DefectCheckOutcome, string>> = {
  verified: 'Nachgeprüft',
  not_remedied: 'Nicht behoben',
}

/**
 * The status a check leaves a defect in. One that was not set right is found
 * once more and waits for a work order of its own; the order that did not
 * set it right stays named until a new one takes its place (#117).
 */
export const statusAfterCheck: Readonly<Record<DefectCheckOutcome, DefectStatus>> = {
  verified: 'verified',
  not_remedied: 'found',
}

/** What checking a defect again says: how it came out, on which day, and what was found. */
export interface DefectCheck {
  readonly outcome: DefectCheckOutcome
  readonly checkedOn: IsoDate
  readonly note: string | null
}

/**
 * Whether a defect may be checked again: only once it is remedied, "Nachgeprüft
 * ist ein eigener Schritt" after the work order. The sentence, or null.
 */
export function defectCheckRefusal(status: DefectStatus): string | null {
  return status === 'remedied' ? null : 'Nachprüfen lässt sich nur ein Mangel, der behoben ist.'
}

/**
 * What is wrong with a check, one sentence per field: the outcome is one of
 * the two, the day lies neither after today nor before the day the defect was
 * found, and a defect that was not set right says what was found.
 */
export function defectCheckProblems(
  check: Readonly<Record<string, unknown>>,
  foundOn: IsoDate,
  today: IsoDate,
): Readonly<Problems> {
  const problems: Problems = {}
  const { outcome, checkedOn, note } = check

  if (!(defectCheckOutcomes as readonly unknown[]).includes(outcome)) {
    problems['outcome'] = 'Sagen Sie, ob der Mangel behoben ist.'
  }

  if (!calendarDay(checkedOn)) {
    problems['checkedOn'] = 'Der Tag der Nachprüfung ist ein Tag, geschrieben 2026-10-03.'
  } else if (checkedOn > today) {
    problems['checkedOn'] = 'Der Tag der Nachprüfung liegt nicht in der Zukunft.'
  } else if (checkedOn < foundOn) {
    problems['checkedOn'] = 'Der Tag der Nachprüfung liegt nicht vor dem Tag der Feststellung.'
  }

  optional(
    problems,
    check,
    'note',
    defectLimits.checkNote,
    `Die Bemerkung hat höchstens ${String(defectLimits.checkNote)} Zeichen.`,
  )

  if (
    outcome === 'not_remedied' &&
    problems['note'] === undefined &&
    (typeof note !== 'string' || note.trim() === '')
  ) {
    problems['note'] = 'Sagen Sie, was Sie vorgefunden haben.'
  }

  return problems
}

/**
 * The default of a class (section 4.6): the days to set a defect of it right
 * in, counted from the day it was found, which the operator sets under
 * "Einstellungen". A class without one leaves the day to whoever keeps
 * defects.
 */
export interface DefectClassTerm {
  /** The key of the class, `<package>.<key>`. */
  readonly defectClass: string
  readonly dueDays: number
}

/** The same as the row the operator keeps a default in. */
export interface KeptDefectClassTerm extends DefectClassTerm {
  readonly id: Id<'defect-class-term'>
  readonly tenantId: Id<'tenant'>
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** The bounds of a default: one day at least, ten years at most. */
export const defectTermLimits = { least: 1, most: 3650 } as const

/** What is wrong with the days of a default, or null. */
export function defectTermProblem(days: unknown): string | null {
  return wholeFromTo(days, defectTermLimits.least, defectTermLimits.most)
    ? null
    : `Die Vorgabe ist eine ganze Zahl von ${String(defectTermLimits.least)} bis ${String(defectTermLimits.most)} Tagen.`
}

/** The day a defect is to be set right by after the default of its class, or null without one. */
export function defaultDueOn(foundOn: IsoDate, dueDays: number | null): IsoDate | null {
  return dueDays === null ? null : addDays(foundOn, dueDays)
}
