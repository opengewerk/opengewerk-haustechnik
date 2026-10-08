import type { Id, IsoDate, Synced } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import type { DutyTask } from './catalogue.js'
import {
  type DutyId,
  type DutyPerformer,
  dutyPerformerLabel,
  dutyPerformers,
} from './duty-record.js'
import { type EvidenceResult, evidenceResultLabel, evidenceResults } from './evidence.js'
import { calendarDay, oneOf, optional, type Problems, required } from './fields.js'
import type { PropertyId } from './location.js'
import type { PlaceTarget } from './target.js'

/**
 * An activity (section 2.2 of the concept, ADR 0002, point 13): what is done
 * to meet a due day or to set a fault right. A round, an inspection, a
 * maintenance and a work order are kinds of one activity and not four modules
 * with a truth each, so that a round, the test of a contractor and a work
 * order meet the same duty the same way (guiding decision 1). What only one
 * kind has stands in a table beside it: the number of a work order here, the
 * points and answers of a round with the filled forms of phase 1.
 */
export type ActivityId = Id<'activity'>
export type ActivityDutyId = Id<'activity-duty'>
export type WorkOrderId = Id<'work-order'>

/** The kinds of an activity, in the words of section 2.2 of the concept. */
export const activityKinds = ['round', 'inspection', 'maintenance', 'work_order'] as const

export type ActivityKind = (typeof activityKinds)[number]

export const activityKindLabel: Readonly<Record<ActivityKind, string>> = {
  round: 'Rundgang',
  inspection: 'Prüfung',
  maintenance: 'Wartung',
  work_order: 'Arbeitsauftrag',
}

/**
 * Where an activity stands. Open until somebody begins it, then begun; signed
 * once its signature is given, while it waits for a countersignature, for the
 * acceptance of a work order or for the server that writes its evidence down
 * (ADR 0004, points 8 and 10); done; or not performed, with the reason. That
 * is how a round of a past period is closed instead of quietly disappearing
 * (section 4.5 of the concept).
 */
export const activityStatuses = ['open', 'started', 'signed', 'done', 'not_performed'] as const

export type ActivityStatus = (typeof activityStatuses)[number]

export const activityStatusLabel: Readonly<Record<ActivityStatus, string>> = {
  open: 'Offen',
  started: 'Begonnen',
  signed: 'Unterschrieben',
  done: 'Erledigt',
  not_performed: 'Nicht durchgeführt',
}

/**
 * The states of an activity whose work is still to come or still going on. A
 * duty with an activity in one of them gets no second one, neither from its
 * due day nor by hand (#105, #183).
 */
export const activityUnderWay = [
  'open',
  'started',
  'signed',
] as const satisfies readonly ActivityStatus[]

/**
 * The states in which whoever plans and hands out work closes an activity as
 * not performed, with the reason (#183): before its signature. One that is
 * signed waits for the evidence its signature makes.
 */
export const activityClosable = ['open', 'started'] as const satisfies readonly ActivityStatus[]

/**
 * The kinds an activity takes that comes of the due day of a duty (section
 * 4.4 of the concept): an inspection or a maintenance. A round has a plan of
 * its own and a work order is handed out (sections 4.5 and 4.8).
 */
export const dueActivityKinds = [
  'inspection',
  'maintenance',
] as const satisfies readonly ActivityKind[]

export type DueActivityKind = (typeof dueActivityKinds)[number]

/**
 * What the due day of a duty becomes, by what the duty has somebody do: a
 * maintenance for a maintenance, an inspection for everything else that is
 * looked at, tested, checked or sampled. A duty of the operator's own that was
 * made before it named its task (`0023_own_duty_task`) has none, and its
 * activity becomes a maintenance, as the office can tell from its title.
 */
export function activityKindOfTask(task: DutyTask | null): DueActivityKind {
  return task === null || task === 'maintenance' ? 'maintenance' : 'inspection'
}

/** The kinds of a work order, in the words of section 4.8 of the concept. */
export const workOrderKinds = [
  'fault',
  'defect_remedy',
  'maintenance',
  'inspection',
  'other',
] as const

export type WorkOrderKind = (typeof workOrderKinds)[number]

export const workOrderKindLabel: Readonly<Record<WorkOrderKind, string>> = {
  fault: 'Störung',
  defect_remedy: 'Mangelbeseitigung',
  maintenance: 'Wartung',
  inspection: 'Prüfung',
  other: 'Sonstiger Auftrag',
}

/** The bounds of the texts of an activity, the same in the form, the sync and the database. */
export const activityLimits = {
  title: 200,
  contractorNote: 200,
  closingReason: 500,
  /** The key of a form, `<package>.<key>` like every key of a package. */
  formKey: 130,
} as const

/**
 * An activity at its place: the property always, and at most one of a
 * building, a room or an asset there, like a duty. A collective activity, all
 * the fire extinguishers of a building (section 4.4), hangs on the building
 * and names its duties beside it.
 */
export interface Activity extends Synced, PlaceTarget {
  readonly id: ActivityId
  readonly kind: ActivityKind
  /** What is done, in words: "Hauptprüfung Aufzug Haus A", "Rundgang Technikzentrale". */
  readonly title: string
  readonly status: ActivityStatus
  /** The day it is due on, or the day of the round. */
  readonly dueOn: IsoDate | null
  /** Who answers for it, and who carries it out: a person of the operator, or a contractor named in words. */
  readonly responsibleUserId: string | null
  /**
   * Whether the operator's own people perform it or a contractor (section
   * 4.4: "eigene" or "fremde Durchführung"), null until somebody says. A
   * person performing it is one of the own people, a contractor's name
   * belongs to a contractor.
   */
  readonly performer: DutyPerformer | null
  readonly performerUserId: string | null
  readonly contractorNote: string | null
  /** Why it was not performed; only an activity that was not. */
  readonly closingReason: string | null
  /** The day it was performed on, which every evidence of it carries. */
  readonly performedOn: IsoDate | null
  /** Whether the site management countersigns it, as its template asks (section 4.5). */
  readonly countersignatureRequired: boolean
  /**
   * The form it is filled in and the version of it (#106): written by the
   * server when the activity is made, and kept, so that an activity under
   * way stays on its version (section 4.5). An inspection or a maintenance
   * takes the form its duty kind names as its evidence; none for an activity
   * without a form, which has no answers.
   */
  readonly formKey: string | null
  readonly formVersion: number | null
}

/**
 * A duty an activity is to meet. A collective activity meets many, and one
 * evidence per duty comes of it when it is written down (ADR 0002, point 14).
 */
export interface ActivityDuty extends Synced {
  readonly id: ActivityDutyId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly dutyId: DutyId
  /** What came of it for this duty, entered while the activity is performed, with the reason of "not performed". */
  readonly result: EvidenceResult | null
  readonly resultReason: string | null
}

/**
 * What only a work order has, beside its activity (section 4.8 of the
 * concept): the number from the sequence of the work orders and the kind of
 * the order. The server draws the number, never a device; a work order made
 * on a device without a connection gets it when it arrives, as an asset does.
 */
export interface WorkOrder extends Synced {
  readonly id: WorkOrderId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly number: string | null
  readonly kind: WorkOrderKind
}

/**
 * What is wrong with an activity, one sentence per field. Undefined is a
 * field that was not given, as in a change of other fields, and is not asked
 * about; whether a status and a reason go together is asked when the record
 * names the status, so that a change merges with the row before it asks.
 */
export function activityProblems(activity: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, activity, 'title', activityLimits.title, 'Die Bezeichnung')
  optional(
    problems,
    activity,
    'contractorNote',
    activityLimits.contractorNote,
    `Die Angabe zur Fremdfirma hat höchstens ${String(activityLimits.contractorNote)} Zeichen.`,
  )
  optional(
    problems,
    activity,
    'closingReason',
    activityLimits.closingReason,
    `Der Grund hat höchstens ${String(activityLimits.closingReason)} Zeichen.`,
  )
  oneOf(
    problems,
    activity,
    'kind',
    activityKinds,
    `Ein Vorgang ist einer von: ${activityKinds.map((kind) => activityKindLabel[kind]).join(', ')}.`,
  )
  oneOf(
    problems,
    activity,
    'status',
    activityStatuses,
    `Der Stand ist einer von: ${activityStatuses.map((status) => activityStatusLabel[status]).join(', ')}.`,
  )

  const dueOn = activity['dueOn']

  if (dueOn !== undefined && dueOn !== null && !calendarDay(dueOn)) {
    problems['dueOn'] = 'Die Fälligkeit ist ein Tag, geschrieben 2026-10-03.'
  }

  const performedOn = activity['performedOn']

  if (performedOn !== undefined && performedOn !== null && !calendarDay(performedOn)) {
    problems['performedOn'] = 'Der Tag der Durchführung ist ein Tag, geschrieben 2026-10-03.'
  }

  const status = activity['status']
  const reason = activity['closingReason']
  const hasReason = typeof reason === 'string' && reason.trim() !== ''

  if (status === 'not_performed' && !hasReason && problems['closingReason'] === undefined) {
    problems['closingReason'] = 'Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund.'
  } else if (
    status !== undefined &&
    status !== 'not_performed' &&
    hasReason &&
    problems['closingReason'] === undefined
  ) {
    problems['closingReason'] = 'Einen Grund nennt nur ein Vorgang, der nicht durchgeführt wurde.'
  }

  return problems
}

/**
 * What is wrong with the result of a duty of an activity: one of the four, and
 * the reason with "not performed" and only then, asked when the record names
 * the result.
 */
export function activityDutyProblems(line: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  oneOf(
    problems,
    line,
    'result',
    evidenceResults,
    `Das Ergebnis ist eines von: ${evidenceResults.map((result) => evidenceResultLabel[result]).join(', ')}.`,
  )
  optional(
    problems,
    line,
    'resultReason',
    activityLimits.closingReason,
    `Der Grund hat höchstens ${String(activityLimits.closingReason)} Zeichen.`,
  )

  const result = line['result']
  const reason = line['resultReason']
  const hasReason = typeof reason === 'string' && reason.trim() !== ''

  if (result === 'not_performed' && !hasReason && problems['resultReason'] === undefined) {
    problems['resultReason'] = 'Was nicht durchgeführt wurde, nennt den Grund.'
  } else if (
    result !== undefined &&
    result !== 'not_performed' &&
    hasReason &&
    problems['resultReason'] === undefined
  ) {
    problems['resultReason'] = 'Einen Grund nennt nur, was nicht durchgeführt wurde.'
  }

  return problems
}

/** What is wrong with what only a work order has: its kind. Its number comes from the server. */
export function workOrderProblems(order: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  oneOf(
    problems,
    order,
    'kind',
    workOrderKinds,
    `Ein Auftrag ist einer von: ${workOrderKinds.map((kind) => workOrderKindLabel[kind]).join(', ')}.`,
  )

  return problems
}

/**
 * The plan of an activity, which whoever plans and hands out work sets in the
 * office (section 4.4 of the concept): who answers for it, whether the own
 * people or a contractor perform it, which person or which contractor, and
 * the day it is due on.
 */
export interface ActivityPlan {
  readonly responsibleUserId: string | null
  readonly performer: DutyPerformer
  readonly performerUserId: string | null
  readonly contractorNote: string | null
  readonly dueOn: IsoDate
}

/**
 * What is wrong with a plan, one sentence per field: the way it is performed
 * and the day are needed, a person performing it belongs to the own people
 * and the name of a contractor to a contractor. Whether the people named may
 * be named is asked by the server, which knows who sees the area.
 */
export function activityPlanProblems(plan: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const performer = plan['performer']

  if (performer === undefined || performer === null) {
    problems['performer'] = 'Die Durchführung ist eigen oder fremd.'
  } else {
    oneOf(
      problems,
      plan,
      'performer',
      dutyPerformers,
      `Die Durchführung ist eine von: ${dutyPerformers.map((key) => dutyPerformerLabel[key]).join(', ')}.`,
    )
  }

  optional(
    problems,
    plan,
    'contractorNote',
    activityLimits.contractorNote,
    `Die Angabe zur Fremdfirma hat höchstens ${String(activityLimits.contractorNote)} Zeichen.`,
  )

  const given = (field: string) => {
    const value = plan[field]

    return value !== undefined && value !== null && value !== ''
  }

  if (given('performerUserId') && performer === 'contractor') {
    problems['performerUserId'] = 'Eine Person führt aus, wenn die eigenen Leute es tun.'
  }

  if (
    given('contractorNote') &&
    performer === 'own_staff' &&
    problems['contractorNote'] === undefined
  ) {
    problems['contractorNote'] = 'Eine Fremdfirma steht nur bei fremder Durchführung.'
  }

  if (!calendarDay(plan['dueOn'])) {
    problems['dueOn'] = 'Die Fälligkeit ist ein Tag, geschrieben 2026-10-03.'
  }

  return problems
}
