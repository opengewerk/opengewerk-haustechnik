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
   * Whether the asset of the duty was out of service on a day. Asked by the
   * counting of § 14 Abs. 5 BetrSichV on a due day that passed; a duty of a
   * place is never out of service, and that is the default.
   */
  readonly outOfServiceOn?: (day: IsoDate) => boolean
}

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
  months: number,
  performances: readonly IsoDate[],
): Appointment | null {
  let due: IsoDate | null = null

  for (const performedOn of performances) {
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

    due = addMonths(start, months)
  }

  return due === null ? null : { dueOn: due, onTimeUntil: endOfMonth(addMonths(due, 2)) }
}

/**
 * From the day it was due: the first performance sets the rhythm, and every
 * appointment after it lies a whole number of intervals later. A performance
 * meets the earliest open appointment once it lies within one interval of
 * it, so a second one in the same period is no reason to skip the next; one
 * that comes later than the appointment after that leaves the missed ones
 * behind instead of making the duty overdue the moment it was done.
 */
function fromDue(interval: DeadlineInterval, performances: readonly IsoDate[]): Appointment | null {
  const [first, ...rest] = performances

  if (first === undefined) {
    return null
  }

  // Every appointment is counted from the first day itself: from the end of
  // a month, a month counted from a clamped appointment would drift to the
  // 28th and stay there.
  const appointment = (index: number) => stepped(first, interval, index + 1)
  // The earliest appointment not met yet, as its number in the rhythm.
  let open = 0

  for (const performedOn of rest) {
    if (performedOn <= appointment(open - 1)) {
      continue
    }

    open += 1

    while (appointment(open) <= performedOn) {
      open += 1
    }
  }

  const dueOn = appointment(open)

  return { dueOn, onTimeUntil: dueOn }
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
  const days = [...performances].sort()

  if (rhythm.counting === 'betrsichv') {
    if ('days' in rhythm.interval) {
      throw new Error('Nach § 14 Abs. 5 BetrSichV zählt eine Frist in Monaten, nicht in Tagen.')
    }

    return underBetrSichV(rhythm, rhythm.interval.months, days)
  }

  if (rhythm.counting === 'from_due') {
    return fromDue(rhythm.interval, days)
  }

  const last = days.at(-1)

  if (last === undefined) {
    return null
  }

  const dueOn = addInterval(last, rhythm.interval)

  return { dueOn, onTimeUntil: dueOn }
}

/** The states of a duty on a day, in the words of section 2.3 of the concept. */
export const dutyStates = ['never_recorded', 'dormant', 'overdue', 'due', 'met'] as const

export type DutyState = (typeof dutyStates)[number]

export const dutyStateLabel: Readonly<Record<DutyState, string>> = {
  never_recorded: 'Nie erfasst',
  dormant: 'Ruht',
  overdue: 'Überfällig',
  due: 'Fällig',
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
 */
export function dutyStateOn(duty: {
  readonly appointment: Appointment | null
  readonly resting: boolean
  readonly leadDays: number
  readonly on: IsoDate
}): DutyStanding {
  const { appointment, on } = duty

  if (duty.resting) {
    return { state: 'dormant', appointment }
  }

  if (appointment === null) {
    return { state: 'never_recorded', appointment }
  }

  if (on > appointment.onTimeUntil) {
    return { state: 'overdue', appointment }
  }

  if (on >= addDays(appointment.dueOn, -duty.leadDays)) {
    return { state: 'due', appointment }
  }

  return { state: 'met', appointment }
}
