import {
  addDays,
  addInterval,
  addMonths,
  type DeadlineInterval,
  type IsoDate,
} from '@opengewerk/platform-domain'

import type { LifecycleState } from './asset.js'
import type { Counting } from './catalogue.js'

/**
 * When a duty falls due next (its appointment, the "Termin" of ADR 0002,
 * point 12), counted from what was done, and what state a duty is in on a
 * day (point 16). Both are derived on every reading and never stored: a
 * stored one would have to be kept up and would be wrong between two runs.
 */

/** The next appointment of a duty. */
export interface Appointment {
  /** The first day the duty is due on. */
  readonly dueOn: IsoDate
  /**
   * The last day doing it still counts as on time: the due day itself, or
   * later where the counting allows a margin, two months after the due month
   * under § 14 Abs. 5 BetrSichV.
   */
  readonly onTimeUntil: IsoDate
}

/** How a duty is counted: the counting of its kind and the interval it actually has. */
export interface Rhythm {
  readonly counting: Counting
  readonly interval: DeadlineInterval
  /**
   * The maximum a regulation sets for the duty on a day, and the day of
   * asking (section 2.3 of the concept, #139): from the day a shorter maximum
   * begins, the duty counts with it, whether anybody took the new maximum
   * over or not. The appointment that is open is judged on the day of asking;
   * one that was met, on the day it was met, so that a maximum of today does
   * not rewrite the rhythm of the years before it. Without it the interval
   * is the same on every day.
   */
  readonly ceiling?: {
    readonly on: (day: IsoDate) => DeadlineInterval | null
    readonly today: IsoDate
  }
  /**
   * Whether the asset of the duty was out of service on a day. Asked by the
   * counting of § 14 Abs. 5 BetrSichV on a due day that passed; a duty of a
   * place is never out of service, and that is the default.
   */
  readonly outOfServiceOn?: (day: IsoDate) => boolean
  /**
   * The appointment a list named when the evidence of the duty was taken over
   * from a predecessor application (section 11 of the concept, #130): the day
   * of that evidence, and the day the list says the duty is due next.
   *
   * No deadline begins anew with the change of application. So this
   * appointment stands as the list names it, and what is done after the
   * evidence counts on from it as from any other appointment; what was done
   * before that evidence no longer counts. A maximum of a regulation holds
   * all the same: an appointment later than the maximum allows, counted from
   * the day of the evidence, is cut short to it, because the operator
   * overrides no regulation (Leitentscheidung 3).
   */
  readonly takenOver?: TakenOverAppointment | null
}

/** The day of an evidence taken over from a list, and the next due day the list names with it. */
export interface TakenOverAppointment {
  readonly performedOn: IsoDate
  readonly dueOn: IsoDate
}

/**
 * The appointment a duty was taken over with: that of the latest evidence
 * which names one, among the evidence that met the duty and stands. An
 * evidence that came about here names none, so a duty nothing was taken over
 * for has none.
 */
export function takenOverFrom(
  met: readonly { readonly performedOn: IsoDate; readonly nextDueOn: IsoDate | null }[],
): TakenOverAppointment | null {
  let found: TakenOverAppointment | null = null

  for (const each of met) {
    if (each.nextDueOn !== null && (found === null || each.performedOn >= found.performedOn)) {
      found = { performedOn: each.performedOn, dueOn: each.nextDueOn }
    }
  }

  return found
}

/**
 * An interval within the maximum a regulation sets: the shorter of the two.
 * In one unit that is plain. Across units nothing compares to the day, so the
 * interval stays only where it lies within the maximum however the months
 * fall, a month taken as its longest against a maximum in days and as its
 * shortest against one in months; in doubt the maximum is the interval,
 * because the operator overrides no regulation (Leitentscheidung 3).
 */
export function withinCeiling(
  interval: DeadlineInterval,
  ceiling: DeadlineInterval | null,
): DeadlineInterval {
  if (ceiling === null) {
    return interval
  }

  if ('months' in interval) {
    const within =
      'months' in ceiling ? interval.months <= ceiling.months : interval.months * 31 <= ceiling.days

    return within ? interval : ceiling
  }

  const within =
    'days' in ceiling ? interval.days <= ceiling.days : interval.days <= ceiling.months * 28

  return within ? interval : ceiling
}

/** Whether two intervals are the same count of the same unit. */
export function sameInterval(left: DeadlineInterval, right: DeadlineInterval): boolean {
  return 'days' in left
    ? 'days' in right && left.days === right.days
    : 'months' in right && left.months === right.months
}

/**
 * The interval of a rhythm for the appointment a performance opens: judged on
 * the day the appointment was met, or on the day of asking where it is open.
 */
type IntervalFor = (metOn: IsoDate | undefined) => DeadlineInterval

/** The first day of the month of a day. */
function monthOf(day: IsoDate): IsoDate {
  return `${day.slice(0, 7)}-01`
}

/** The last day of the month of a day. */
function endOfMonth(day: IsoDate): IsoDate {
  return addDays(addMonths(monthOf(day), 1), -1)
}

/** How many months the month of one day lies before the month of another. */
function monthsBefore(earlier: IsoDate, later: IsoDate): number {
  const count = (day: IsoDate) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7))

  return count(later) - count(earlier)
}

/** The interval `steps` times over, from the same first day, so that months do not drift. */
function stepped(from: IsoDate, interval: DeadlineInterval, steps: number): IsoDate {
  return 'days' in interval
    ? addDays(from, interval.days * steps)
    : addMonths(from, interval.months * steps)
}

/**
 * § 14 Abs. 5 BetrSichV: the appointment is a month, and doing it is on time
 * until two months after it. The next interval begins with the due month of
 * the last; with the month of the inspection where it came before the due
 * month, for an interval of more than two years only if it came more than two
 * months before; and with the month of the inspection where the equipment was
 * out of service when it was due.
 */
function underBetrSichV(
  rhythm: Rhythm,
  monthsFor: (metOn: IsoDate | undefined) => number,
  performances: readonly IsoDate[],
  takenOverDueOn?: IsoDate,
): Appointment | null {
  // An appointment taken over is the due month the rhythm goes on from, as
  // `keptAppointment` hands it over, with the interval that leads up to it as
  // the duty has it when it is met.
  let due: IsoDate | null = takenOverDueOn ?? null
  let months = takenOverDueOn === undefined ? 0 : monthsFor(performances[0])

  for (const [index, performedOn] of performances.entries()) {
    const performedMonth = monthOf(performedOn)
    let start: IsoDate

    if (due === null) {
      start = performedMonth
    } else if (performedMonth < due) {
      const earlyEnough = months <= 24 || monthsBefore(performedMonth, due) > 2

      start = earlyEnough ? performedMonth : due
    } else if (rhythm.outOfServiceOn?.(due) === true) {
      start = performedMonth
    } else {
      start = due
    }

    months = monthsFor(performances[index + 1])
    due = addMonths(start, months)
  }

  return due === null ? null : { dueOn: due, onTimeUntil: endOfMonth(addMonths(due, 2)) }
}

/** How many days lie from one day to a later one. */
function daysFrom(earlier: IsoDate, later: IsoDate): number {
  return Math.round((Date.parse(later) - Date.parse(earlier)) / 86_400_000)
}

/**
 * From the day it was due (section 4.4 of the concept, #77): a performance
 * sets the rhythm, and every appointment after it lies a whole number of
 * intervals later. A later performance meets the open appointment when it
 * lies at most a twelfth of the interval before it, as § 14 Abs. 5 BetrSichV
 * reckons, and the rhythm stays; done late, it meets it as well, and leaves
 * the appointments behind that it came after instead of making the duty
 * overdue the moment it was done. Done earlier than the twelfth, the interval
 * counts anew from its day. So no appointment is skipped, no performance is
 * lost, and two performances never lie much more than the interval apart.
 *
 * The twelfth is counted in days, of the period that leads up to the open
 * appointment: a month for a yearly duty, two for one of two years.
 */
function fromDue(
  intervalFor: IntervalFor,
  performances: readonly IsoDate[],
  takenOverDueOn?: IsoDate,
): Appointment | null {
  const [first, ...others] = performances

  if (takenOverDueOn === undefined && first === undefined) {
    return null
  }

  // Every appointment of a rhythm is counted from the day that began it: from
  // the end of a month, a month counted from a clamped appointment would drift
  // to the 28th and stay there. A performance begins a rhythm with the
  // appointment one interval after it; an appointment taken over begins one
  // with itself.
  let start = takenOverDueOn ?? (first as IsoDate)
  let ahead = takenOverDueOn === undefined ? 1 : 0
  const rest = takenOverDueOn === undefined ? others : performances
  let interval = intervalFor(rest[0])
  const appointment = (index: number) => stepped(start, interval, index + ahead)
  // The earliest appointment not met yet, as its number in the rhythm.
  let open = 0

  for (const [index, performedOn] of rest.entries()) {
    const due = appointment(open)
    const twelfth = Math.floor(daysFrom(appointment(open - 1), due) / 12)

    if (performedOn < addDays(due, -twelfth)) {
      start = performedOn
      ahead = 1
      open = 0
    } else {
      open += 1

      while (appointment(open) <= performedOn) {
        open += 1
      }
    }

    // Where a regulation gives the next appointment another interval, the
    // rhythm counts on from the last appointment that was met or left behind.
    const next = intervalFor(rest[index + 1])

    if (!sameInterval(next, interval)) {
      start = appointment(open - 1)
      ahead = 1
      open = 0
      interval = next
    }
  }

  const dueOn = appointment(open)

  return { dueOn, onTimeUntil: dueOn }
}

/**
 * The appointment a list named, as the duty keeps it: the day itself, the
 * first day of its month under § 14 Abs. 5 BetrSichV, and never later than
 * the maximum of a regulation allows from the day of the evidence. The
 * maximum is judged like that of any appointment: on the day it was met, or
 * on the day of asking while it is open.
 */
function keptAppointment(
  rhythm: Rhythm,
  takenOver: TakenOverAppointment,
  metOn: IsoDate | undefined,
): IsoDate {
  const { ceiling, counting } = rhythm
  const maximum = ceiling === undefined ? null : ceiling.on(metOn ?? ceiling.today)
  const named = counting === 'betrsichv' ? monthOf(takenOver.dueOn) : takenOver.dueOn

  if (maximum === null) {
    return named
  }

  const latest =
    counting === 'betrsichv'
      ? addMonths(
          monthOf(takenOver.performedOn),
          'months' in maximum ? maximum.months : Math.max(1, Math.floor(maximum.days / 31)),
        )
      : addInterval(takenOver.performedOn, maximum)

  return named > latest ? latest : named
}

/**
 * The next appointment of a duty from the days it was met on, earliest first.
 * Only performances that meet the duty count (`meetsTheDuty`); without one
 * the duty has no appointment, it was never recorded.
 *
 * The counting of § 14 Abs. 5 BetrSichV takes its interval in months; one in
 * days is refused here, because the kind of duty and the form both refuse it
 * before it gets this far.
 */
export function nextAppointment(
  rhythm: Rhythm,
  performances: readonly IsoDate[],
): Appointment | null {
  const { ceiling } = rhythm
  const takenOver = rhythm.takenOver ?? null
  // What was done before the evidence a list was taken over with counts no
  // longer: the list has said where the rhythm stands.
  const days = [...performances]
    .sort()
    .filter((day) => takenOver === null || day > takenOver.performedOn)
  const kept = takenOver === null ? undefined : keptAppointment(rhythm, takenOver, days[0])
  const intervalFor: IntervalFor = (metOn) =>
    ceiling === undefined
      ? rhythm.interval
      : withinCeiling(rhythm.interval, ceiling.on(metOn ?? ceiling.today))

  if (rhythm.counting === 'betrsichv') {
    if ('days' in rhythm.interval) {
      throw new Error('Nach § 14 Abs. 5 BetrSichV zählt eine Frist in Monaten, nicht in Tagen.')
    }

    return underBetrSichV(
      rhythm,
      (metOn) => {
        const interval = intervalFor(metOn)

        // A maximum in days cuts an interval in months short as whole months,
        // rounded down, because the appointment of this counting is a month.
        return 'months' in interval ? interval.months : Math.max(1, Math.floor(interval.days / 31))
      },
      days,
      kept,
    )
  }

  if (rhythm.counting === 'from_due') {
    return fromDue(intervalFor, days, kept)
  }

  const last = days.at(-1)

  if (last === undefined) {
    return kept === undefined ? null : { dueOn: kept, onTimeUntil: kept }
  }

  const dueOn = addInterval(last, intervalFor(undefined))

  return { dueOn, onTimeUntil: dueOn }
}

/**
 * The appointment of a duty that falls due once (#439): its due day, until an
 * evidence met it, and then none, for good. What met it before the day it is
 * counted from does not count: a duty counted from a commissioning asks for
 * what was done after it, and one whose day moved to a later commissioning
 * is open again. On time is the due day itself.
 */
export function onceAppointment(
  duty: { readonly dueOn: IsoDate; readonly countedFrom: IsoDate | null },
  performances: readonly IsoDate[],
): Appointment | null {
  const { countedFrom } = duty
  const met = performances.some((day) => countedFrom === null || day >= countedFrom)

  return met ? null : { dueOn: duty.dueOn, onTimeUntil: duty.dueOn }
}

/**
 * The states of a duty on a day, in the words of section 2.3 of the concept.
 * A duty that falls due once is outstanding until its due day comes near
 * (#439): it was never met, and nothing is wrong with that yet.
 */
export const dutyStates = [
  'never_recorded',
  'dormant',
  'overdue',
  'due',
  'outstanding',
  'met',
] as const

export type DutyState = (typeof dutyStates)[number]

export const dutyStateLabel: Readonly<Record<DutyState, string>> = {
  never_recorded: 'Nie erfasst',
  dormant: 'Ruht',
  overdue: 'Überfällig',
  due: 'Fällig',
  outstanding: 'Ausstehend bis',
  met: 'Erfüllt bis',
}

/**
 * Whether the duties of an asset rest on a day of its life cycle: while it is
 * planned, out of service, decommissioned or removed, nothing on it falls
 * due, and nothing lapses either (section 2.2 of the concept). An asset
 * without any entry in its life cycle counts as in service: a duty that
 * rested because nobody had entered the day an asset went into service would
 * be the overlooked one that nobody notices.
 */
export function restsOn(state: LifecycleState | null): boolean {
  return state !== null && state !== 'in_service'
}

/** What a duty is on a day, and for a duty that has one, its appointment. */
export interface DutyStanding {
  readonly state: DutyState
  readonly appointment: Appointment | null
}

/**
 * The state of a duty on a day. A resting duty rests whatever its
 * appointment; one without an appointment was never recorded, which is a
 * state of its own before overdue, because the one calls for a first
 * recording and the other for a test (section 2.3). Past the last day on
 * which doing it is on time it is overdue, from `leadDays` before its due day
 * it is due, and before that it is met until its due day.
 *
 * A duty that falls due once (#439) has its appointment from the day it was
 * confirmed: before it comes near it is outstanding, not met, and once an
 * evidence met it, it has no appointment and is met for good.
 */
export function dutyStateOn(duty: {
  readonly appointment: Appointment | null
  readonly resting: boolean
  readonly leadDays: number
  readonly on: IsoDate
  readonly once?: boolean
}): DutyStanding {
  const { appointment, on } = duty
  const once = duty.once === true

  if (duty.resting) {
    return { state: 'dormant', appointment }
  }

  if (appointment === null) {
    return { state: once ? 'met' : 'never_recorded', appointment }
  }

  if (on > appointment.onTimeUntil) {
    return { state: 'overdue', appointment }
  }

  if (on >= addDays(appointment.dueOn, -duty.leadDays)) {
    return { state: 'due', appointment }
  }

  return { state: once ? 'outstanding' : 'met', appointment }
}
