import {
  type DeadlineInterval,
  type Id,
  intervalMonthsProblem,
  intervalProblem,
  type IsoDate,
  type RuleUnit,
  type Synced,
} from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import { type Counting, countings, type IntervalKind } from './catalogue.js'
import { calendarDay, optional, type Problems, required } from './fields.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'

/**
 * A duty as the register of an operator keeps it (section 2.3 of the concept,
 * ADR 0002, points 10 and 11): at exactly one of an asset, a room, a building
 * or the property itself, from a duty kind of the catalogue or of the
 * operator's own, with the interval it actually has. A proposal is no record;
 * what is kept is the decision, a confirmed duty or a dismissal with its
 * reason and the person.
 */
export type DutyId = Id<'duty'>
export type DutyDismissalId = Id<'duty-dismissal'>

/** Where a duty of the operator's own comes from, in the words of section 2.3 of the concept. */
export const dutyBases = ['manufacturer', 'authority', 'insurer', 'own_decision'] as const

export type DutyBasis = (typeof dutyBases)[number]

export const dutyBasisLabel: Readonly<Record<DutyBasis, string>> = {
  manufacturer: 'Vorgabe des Herstellers',
  authority: 'Auflage aus Baugenehmigung oder Brandschutzkonzept',
  insurer: 'Forderung des Versicherers',
  own_decision: 'Eigene Festlegung',
}

/**
 * Who performs a duty (section 2.3): the operator's own people or a
 * contractor. Until contracts come (phase 2) a note names the contractor.
 */
export const dutyPerformers = ['own_staff', 'contractor'] as const

export type DutyPerformer = (typeof dutyPerformers)[number]

export const dutyPerformerLabel: Readonly<Record<DutyPerformer, string>> = {
  own_staff: 'Eigene Leute',
  contractor: 'Fremdfirma',
}

/** The bounds of the texts of a duty, the same in the form, the sync and the database. */
export const dutyLimits = {
  kind: 130,
  label: 120,
  sourceNote: 300,
  intervalReason: 500,
  performerNote: 200,
  endReason: 300,
  dismissalReason: 500,
} as const

/** What a duty hangs on: the property always, and at most one of a building, a room or an asset there. */
export interface DutyTarget {
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly buildingId: BuildingId | null
  readonly roomId: RoomId | null
  readonly assetId: AssetId | null
}

export interface Duty extends Synced, DutyTarget {
  readonly id: DutyId
  /** The duty kind of the catalogue, `<package>.<key>`, and the version that was confirmed; both empty for a duty of the operator's own. */
  readonly kind: string | null
  readonly kindVersion: number | null
  /** What a duty of the operator's own is called, where it comes from, and the source it names. */
  readonly label: string | null
  readonly basis: DutyBasis | null
  readonly sourceNote: string | null
  readonly counting: Counting
  /** The interval it actually has, in days or in months, never both. */
  readonly intervalDays: number | null
  readonly intervalMonths: number | null
  readonly intervalReason: string | null
  /** The maximum of its kind on the day it was confirmed: a confirmed duty does not change quietly. */
  readonly maximumDays: number | null
  readonly maximumMonths: number | null
  readonly responsibleUserId: string | null
  readonly performer: DutyPerformer | null
  readonly performerNote: string | null
  readonly confirmedBy: string
  readonly confirmedAt: Date
  /** The day it ends, from which it calls for nothing any more. */
  readonly endsOn: IsoDate | null
  readonly endReason: string | null
}

/**
 * A proposal of the catalogue the operator dismissed, with the reason and the
 * person (ADR 0002, point 11). Proposals are made for assets, so a dismissal
 * is one for an asset.
 */
export interface DutyDismissal extends Synced {
  readonly id: DutyDismissalId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly assetId: AssetId
  readonly kind: string
  readonly kindVersion: number
  readonly reason: string
  readonly dismissedBy: string
}

/** The interval of a duty as the deadline engine counts it. */
export function dutyInterval(
  duty: Pick<Duty, 'intervalDays' | 'intervalMonths'>,
): DeadlineInterval {
  return duty.intervalMonths !== null
    ? { months: duty.intervalMonths }
    : { days: duty.intervalDays ?? 0 }
}

/** The maximum of a duty, if it has one. */
export function dutyMaximum(
  duty: Pick<Duty, 'maximumDays' | 'maximumMonths'>,
): DeadlineInterval | null {
  if (duty.maximumMonths !== null) {
    return { months: duty.maximumMonths }
  }

  return duty.maximumDays === null ? null : { days: duty.maximumDays }
}

/**
 * The interval a rule names, in the unit a duty counts in: days stay days,
 * months stay months, and years become months, because the deadline engine
 * counts in days and months. A rule in another unit names no interval.
 */
export function intervalOfRule(rule: {
  readonly value: number
  readonly unit: RuleUnit
}): DeadlineInterval | null {
  switch (rule.unit) {
    case 'days':
      return { days: rule.value }
    case 'months':
      return { months: rule.value }
    case 'years':
      return { months: rule.value * 12 }
    default:
      return null
  }
}

/** "24 Monate", "7 Tage". */
export function intervalWords(interval: DeadlineInterval): string {
  return 'days' in interval
    ? `${String(interval.days)} ${interval.days === 1 ? 'Tag' : 'Tage'}`
    : `${String(interval.months)} ${interval.months === 1 ? 'Monat' : 'Monate'}`
}

/**
 * What is wrong with the interval of a duty, or null: one unit and within the
 * bounds of the deadline engine; in months under § 14 Abs. 5 BetrSichV, which
 * gives its appointment as a month; and never longer than the maximum, held
 * in the unit the maximum has, because a maximum may only be shortened
 * (section 2.3 of the concept).
 */
export function dutyIntervalProblem(
  interval: { readonly intervalDays?: unknown; readonly intervalMonths?: unknown },
  counting: Counting,
  maximum: DeadlineInterval | null,
): string | null {
  const days = interval.intervalDays ?? null
  const months = interval.intervalMonths ?? null

  if ((days === null) === (months === null)) {
    return 'Die Frist steht in Tagen oder in Monaten, genau eines von beiden.'
  }

  const shape =
    days !== null
      ? typeof days === 'number'
        ? intervalProblem(days)
        : 'Die Frist ist eine ganze Zahl von Tagen, mindestens 1.'
      : typeof months === 'number'
        ? intervalMonthsProblem(months)
        : 'Die Frist ist eine ganze Zahl von Monaten, mindestens 1.'

  if (shape !== null) {
    return shape
  }

  if (counting === 'betrsichv' && days !== null) {
    return 'Nach § 14 Abs. 5 BetrSichV zählt die Frist in Monaten.'
  }

  if (maximum === null) {
    return null
  }

  if ('months' in maximum) {
    if (months === null) {
      return 'Die Höchstfrist dieser Pflicht zählt in Monaten, die Frist ebenso.'
    }

    return (months as number) > maximum.months
      ? `Die Höchstfrist beträgt ${intervalWords(maximum)}, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.`
      : null
  }

  if (days === null) {
    return 'Die Höchstfrist dieser Pflicht zählt in Tagen, die Frist ebenso.'
  }

  return (days as number) > maximum.days
    ? `Die Höchstfrist beträgt ${intervalWords(maximum)}, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.`
    : null
}

/**
 * Whether an interval needs its reason (section 2.3 of the concept): where
 * the kind leaves the interval to the operator, who determines it, in the
 * risk assessment for instance, and where the operator departs from a guide.
 * Shortening a maximum needs none; a duty of the operator's own names its
 * source instead.
 */
export function intervalNeedsReason(
  kindInterval: IntervalKind | null,
  interval: DeadlineInterval,
  guide: DeadlineInterval | null,
): boolean {
  if (kindInterval === 'none') {
    return true
  }

  if (kindInterval !== 'guide' || guide === null) {
    return false
  }

  return 'days' in guide
    ? !('days' in interval) || interval.days !== guide.days
    : !('months' in interval) || interval.months !== guide.months
}

/** A choice of a list the record may leave empty. */
function oneOf(
  problems: Problems,
  record: Readonly<Record<string, unknown>>,
  field: string,
  values: readonly string[],
  sentence: string,
): void {
  const value = record[field]

  if (value !== undefined && value !== null && !values.includes(value as string)) {
    problems[field] = sentence
  }
}

/**
 * What is wrong with the texts and choices of a duty, one sentence per field.
 * The interval is a question for `dutyIntervalProblem`, which takes the
 * counting and the maximum; whether a kind is one the catalogue knows, and
 * whether a duty of the operator's own has its name, its basis and its
 * source, the route asks, which knows which of the two it writes.
 */
export function dutyProblems(duty: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  optional(
    problems,
    duty,
    'label',
    dutyLimits.label,
    `Die Bezeichnung hat höchstens ${String(dutyLimits.label)} Zeichen.`,
  )
  optional(
    problems,
    duty,
    'sourceNote',
    dutyLimits.sourceNote,
    `Die Quelle hat höchstens ${String(dutyLimits.sourceNote)} Zeichen.`,
  )
  optional(
    problems,
    duty,
    'intervalReason',
    dutyLimits.intervalReason,
    `Die Begründung der Frist hat höchstens ${String(dutyLimits.intervalReason)} Zeichen.`,
  )
  optional(
    problems,
    duty,
    'performerNote',
    dutyLimits.performerNote,
    `Die Angabe zur Fremdfirma hat höchstens ${String(dutyLimits.performerNote)} Zeichen.`,
  )
  optional(
    problems,
    duty,
    'endReason',
    dutyLimits.endReason,
    `Der Grund für das Ende hat höchstens ${String(dutyLimits.endReason)} Zeichen.`,
  )
  oneOf(
    problems,
    duty,
    'basis',
    dutyBases,
    `Die Grundlage ist keine von: ${dutyBases.map((basis) => dutyBasisLabel[basis]).join(', ')}.`,
  )
  oneOf(
    problems,
    duty,
    'performer',
    dutyPerformers,
    'Ausgeführt wird von eigenen Leuten oder einer Fremdfirma.',
  )
  oneOf(
    problems,
    duty,
    'counting',
    countings,
    'Gezählt wird ab dem Tag der Durchführung, ab dem fälligen Tag oder nach § 14 Abs. 5 BetrSichV.',
  )

  const endsOn = duty['endsOn']

  if (endsOn !== undefined && endsOn !== null && !calendarDay(endsOn)) {
    problems['endsOn'] = 'Das Ende ist ein Tag, geschrieben 2026-10-03.'
  }

  return problems
}

/** What is wrong with a dismissal: it has its reason (ADR 0002, point 11). */
export function dismissalProblems(
  dismissal: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  required(
    problems,
    { reason: dismissal['reason'] ?? null },
    'reason',
    dutyLimits.dismissalReason,
    'Die Begründung',
  )

  return problems
}
