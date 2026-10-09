import { addDays, type Id, type IsoDate, type Synced } from '@opengewerk/platform-domain'

import { activityClosable, type ActivityStatus } from './activity.js'
import type { AreaId } from './area.js'
import { closureOn } from './closure.js'
import type { DefectStatus } from './defect.js'
import type { DutyPerson } from './duty-register.js'
import { calendarDay, oneOf, type Problems, wholeFromTo } from './fields.js'
import type { BuildingId, PropertyId } from './location.js'
import type { RoundTemplateId } from './round-template.js'
import type { SignatureRole, SignedPage } from './signature.js'

/**
 * The plan of a round (section 4.5 of the concept, #113): which template is
 * walked where, in which rhythm and for whom. Every pass that falls due is a
 * round of its own, with a signature of its own: a daily round makes seven a
 * week and no list of the week with seven columns.
 *
 * A plan lies at a property or at a building there, in the area of the
 * property, like every row with a place. While the building is closed no
 * round is made for it (4.1). A plan ends on a day or rests, and the rounds it
 * made stay where they are: a past round is closed with a reason, never
 * dropped.
 *
 * Kept by whoever plans and hands out activities, with a connection (section
 * 7); a device holds the plans of its areas, to read.
 */
export type RoundPlanId = Id<'round_plan'>

/** How often a plan falls due, in the words of section 4.5. */
export const planRhythms = ['daily', 'weekly', 'monthly', 'yearly'] as const

export type PlanRhythm = (typeof planRhythms)[number]

export const planRhythmLabel: Readonly<Record<PlanRhythm, string>> = {
  daily: 'täglich',
  weekly: 'wöchentlich',
  monthly: 'monatlich',
  yearly: 'jährlich',
}

/** The days of the week as ISO 8601 counts them: Monday is 1, Sunday 7. */
export const weekdays = [1, 2, 3, 4, 5, 6, 7] as const

export type Weekday = (typeof weekdays)[number]

export const weekdayLabel: Readonly<Record<Weekday, string>> = {
  1: 'Montag',
  2: 'Dienstag',
  3: 'Mittwoch',
  4: 'Donnerstag',
  5: 'Freitag',
  6: 'Samstag',
  7: 'Sonntag',
}

export const weekdayShort: Readonly<Record<Weekday, string>> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
  7: 'So',
}

export const monthLabel: readonly string[] = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

export interface RoundPlan extends Synced {
  readonly id: RoundPlanId
  readonly propertyId: PropertyId
  /** The building the rounds are walked in, none where they go over the property. */
  readonly buildingId: BuildingId | null
  readonly areaId: AreaId
  /** The template whose newest version a round takes when it is made. */
  readonly templateId: RoundTemplateId
  readonly rhythm: PlanRhythm
  /**
   * The days of the week a daily plan holds on, and the one day of a weekly
   * plan; none for a monthly or a yearly plan, which name their day.
   */
  readonly weekdays: readonly Weekday[] | null
  /** The day of the month of a monthly or a yearly plan; the last day of a shorter month. */
  readonly dayOfMonth: number | null
  /** The month of a yearly plan, counted from 1 for January. */
  readonly month: number | null
  /** How many days before its pass a round stands on site under "Start". */
  readonly leadDays: number
  /** The first day a pass may fall on. */
  readonly startsOn: IsoDate
  /** The last day a pass may fall on; none while the plan runs on. */
  readonly endsOn: IsoDate | null
  /** Whether the plan rests: no round is made until it runs again. */
  readonly resting: boolean
  /**
   * Whether a pass on a statutory public holiday of the state of its
   * property is left out, like one in a closure of its building (4.5, #200);
   * otherwise a holiday counts like any day.
   */
  readonly skipHolidays: boolean
  /**
   * The person who walks a new round, one of the own people; none hands it
   * to everybody in the area who performs, and whoever begins it walks it.
   */
  readonly performerUserId: string | null
}

/** The bounds of a plan, the same in the form, at the route and in the database. */
export const planLimits = {
  /** No more than a round is made before its pass (`roundDue`). */
  leadDays: 14,
} as const

/** What a pass is worked out from: the rhythm and the days a plan holds from and to. */
export type PlanCalendar = Pick<
  RoundPlan,
  'rhythm' | 'weekdays' | 'dayOfMonth' | 'month' | 'startsOn' | 'endsOn'
>

/** The day of the week of a day, Monday 1 to Sunday 7. */
export function weekdayOf(day: IsoDate): Weekday {
  const sunday0 = new Date(`${day}T00:00:00Z`).getUTCDay()

  return (sunday0 === 0 ? 7 : sunday0) as Weekday
}

/** The Monday of the week a day lies in. */
export function weekOf(day: IsoDate): IsoDate {
  return addDays(day, 1 - weekdayOf(day))
}

/**
 * The Monday of the week a value names, a day in it written in ISO 8601, or
 * null when it names none: how an address and a body name a week.
 */
export function weekNamed(value: unknown): IsoDate | null {
  return calendarDay(value) ? weekOf(value as IsoDate) : null
}

/**
 * The number of the week a day lies in, as ISO 8601 counts: the week with the
 * first Thursday of a year is its first, so the days around New Year may
 * belong to the week of the year before or after.
 */
export function weekNumberOf(day: IsoDate): number {
  const thursday = addDays(day, 4 - weekdayOf(day))
  const firstOfYear = `${thursday.slice(0, 4)}-01-01` as IsoDate
  const days =
    (Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${firstOfYear}T00:00:00Z`)) / 86_400_000

  return Math.floor(days / 7) + 1
}

/** The last day of the month a day lies in, as a number. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Whether a pass of a plan falls on a day, by its rhythm and the days it
 * holds from and to; what a building being closed does to it is asked
 * beside this (`passesBetween`). A monthly or a yearly plan whose day a month
 * lacks falls on the last day of that month: the 31st is the 30th in April and
 * the 29th of February the 28th in a common year.
 */
export function isPassDay(plan: PlanCalendar, day: IsoDate): boolean {
  if (day < plan.startsOn || (plan.endsOn !== null && day > plan.endsOn)) {
    return false
  }

  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  const named = (dayOfMonth: number | null) =>
    dayOfMonth !== null && date === Math.min(dayOfMonth, lastDayOfMonth(year, month))

  switch (plan.rhythm) {
    case 'daily':
      return plan.weekdays?.includes(weekdayOf(day)) ?? false
    case 'weekly':
      return plan.weekdays?.[0] === weekdayOf(day)
    case 'monthly':
      return named(plan.dayOfMonth)
    case 'yearly':
      return plan.month === month && named(plan.dayOfMonth)
  }
}

/** A time a building is closed, as far as a plan asks it. */
export type PlanClosure = { readonly startsOn: IsoDate; readonly endsOn: IsoDate }

/**
 * The passes of a plan from a day to a day, both of them counted, in order:
 * every day its rhythm falls on, except while its building is closed (4.1).
 * A pass in a closure is left out and not moved: no round is made for a
 * building nobody can walk.
 */
export function passesBetween(
  plan: PlanCalendar,
  from: IsoDate,
  until: IsoDate,
  closures: readonly PlanClosure[] = [],
): readonly IsoDate[] {
  const passes: IsoDate[] = []

  for (let day = from; day <= until; day = addDays(day, 1)) {
    if (isPassDay(plan, day) && closureOn(closures, day) === null) {
      passes.push(day)
    }
  }

  return passes
}

/**
 * How far ahead the next pass is looked for: two years and a day, so that a
 * yearly pass in a closure still finds the one after it.
 */
export const passSearchDays = 2 * 366 + 1

/**
 * The first pass of a plan on or after a day that has no round yet, or null
 * when none comes within `passSearchDays`, for a plan that ends or whose
 * building stays closed.
 */
export function firstOpenPass(
  plan: PlanCalendar,
  from: IsoDate,
  closures: readonly PlanClosure[],
  taken: ReadonlySet<string>,
): IsoDate | null {
  const until = addDays(from, passSearchDays)

  for (let day = from; day <= until; day = addDays(day, 1)) {
    if (plan.endsOn !== null && day > plan.endsOn) {
      return null
    }

    if (isPassDay(plan, day) && closureOn(closures, day) === null && !taken.has(day)) {
      return day
    }
  }

  return null
}

/** "Montag bis Freitag" for a run of days, otherwise the short names one by one. */
function weekdayText(days: readonly Weekday[]): string {
  const sorted = [...days].sort((one, other) => one - other)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  if (first === undefined || last === undefined) {
    return ''
  }

  if (sorted.length === 1) {
    return weekdayLabel[first]
  }

  if (sorted.length > 2 && last - first === sorted.length - 1) {
    return `${weekdayLabel[first]} bis ${weekdayLabel[last]}`
  }

  return sorted.map((day) => weekdayShort[day]).join(', ')
}

/**
 * What the rhythm of a plan reads as in a list: "täglich", "täglich, Montag
 * bis Freitag", "wöchentlich, Mittwoch", "monatlich, am 5.", "jährlich, am
 * 1. März".
 */
export function rhythmText(
  plan: Pick<RoundPlan, 'rhythm' | 'weekdays' | 'dayOfMonth' | 'month'>,
): string {
  const label = planRhythmLabel[plan.rhythm]

  switch (plan.rhythm) {
    case 'daily':
      return plan.weekdays === null || plan.weekdays.length === weekdays.length
        ? label
        : `${label}, ${weekdayText(plan.weekdays)}`
    case 'weekly':
      return plan.weekdays?.[0] === undefined
        ? label
        : `${label}, ${weekdayLabel[plan.weekdays[0]]}`
    case 'monthly':
      return plan.dayOfMonth === null ? label : `${label}, am ${String(plan.dayOfMonth)}.`
    case 'yearly':
      return plan.dayOfMonth === null || plan.month === null
        ? label
        : `${label}, am ${String(plan.dayOfMonth)}. ${monthLabel[plan.month - 1] ?? ''}`
  }
}

/** Where a plan stands on a day. */
export type PlanState = 'upcoming' | 'running' | 'resting' | 'ended'

export function planStateOn(
  plan: Pick<RoundPlan, 'startsOn' | 'endsOn' | 'resting'>,
  today: IsoDate,
): PlanState {
  if (plan.endsOn !== null && plan.endsOn < today) {
    return 'ended'
  }

  if (plan.resting) {
    return 'resting'
  }

  return plan.startsOn > today ? 'upcoming' : 'running'
}

/** Whether a value is a list of days of the week, each once. */
function weekdayList(value: unknown): value is readonly Weekday[] {
  return (
    Array.isArray(value) &&
    value.every((day) => wholeFromTo(day, 1, 7)) &&
    new Set(value).size === value.length
  )
}

/**
 * What is wrong with a plan, one sentence per field, empty when nothing is.
 * Undefined is a field that was not given. What a rhythm needs is asked of
 * the fields the rhythm names, and a field it does not name has to be empty,
 * so that a plan that changes its rhythm leaves nothing of the old one behind.
 * Whether the template, the place and the person may be named is asked by
 * the server, which knows who sees the area.
 */
export function planProblems(plan: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const rhythm = plan['rhythm']

  if (rhythm === null || rhythm === '') {
    problems['rhythm'] = 'Der Rhythmus fehlt.'
  } else {
    oneOf(
      problems,
      plan,
      'rhythm',
      planRhythms,
      `Der Rhythmus ist einer von: ${planRhythms.map((key) => planRhythmLabel[key]).join(', ')}.`,
    )
  }

  if (typeof rhythm === 'string' && problems['rhythm'] === undefined) {
    const days = plan['weekdays']
    const dayOfMonth = plan['dayOfMonth']
    const month = plan['month']
    const given = (value: unknown) => value !== undefined && value !== null

    if (rhythm === 'daily' && (!weekdayList(days) || days.length === 0)) {
      problems['weekdays'] = 'Ein täglicher Plan nennt mindestens einen Wochentag.'
    } else if (rhythm === 'weekly' && (!weekdayList(days) || days.length !== 1)) {
      problems['weekdays'] = 'Ein wöchentlicher Plan nennt seinen Wochentag.'
    } else if ((rhythm === 'monthly' || rhythm === 'yearly') && given(days)) {
      problems['weekdays'] =
        'Ein monatlicher oder jährlicher Plan nennt einen Tag, keinen Wochentag.'
    }

    if (rhythm === 'monthly' || rhythm === 'yearly') {
      if (!wholeFromTo(dayOfMonth, 1, 31)) {
        problems['dayOfMonth'] = 'Der Tag ist eine Zahl von 1 bis 31.'
      }
    } else if (given(dayOfMonth)) {
      problems['dayOfMonth'] = 'Nur ein monatlicher oder jährlicher Plan nennt einen Tag.'
    }

    if (rhythm === 'yearly') {
      if (!wholeFromTo(month, 1, 12)) {
        problems['month'] = 'Der Monat ist eine Zahl von 1 bis 12.'
      } else if (
        problems['dayOfMonth'] === undefined &&
        (dayOfMonth as number) > lastDayOfMonth(2024, month as number)
      ) {
        problems['dayOfMonth'] =
          `Den ${String(dayOfMonth)}. ${monthLabel[(month as number) - 1] ?? ''} gibt es nicht.`
      }
    } else if (given(month)) {
      problems['month'] = 'Nur ein jährlicher Plan nennt einen Monat.'
    }
  }

  const lead = plan['leadDays']

  if (lead !== undefined && !wholeFromTo(lead, 0, planLimits.leadDays)) {
    problems['leadDays'] =
      `Der Vorlauf ist eine Zahl von 0 bis ${String(planLimits.leadDays)} Tagen.`
  }

  const startsOn = plan['startsOn']
  const endsOn = plan['endsOn']

  if (startsOn !== undefined && !calendarDay(startsOn)) {
    problems['startsOn'] =
      startsOn === null || startsOn === ''
        ? 'Der erste Tag fehlt.'
        : 'Der erste Tag ist ein Tag, geschrieben 2026-10-03.'
  }

  if (endsOn !== undefined && endsOn !== null && !calendarDay(endsOn)) {
    problems['endsOn'] = 'Der letzte Tag ist ein Tag, geschrieben 2026-10-03.'
  } else if (
    problems['startsOn'] === undefined &&
    typeof startsOn === 'string' &&
    typeof endsOn === 'string' &&
    endsOn < startsOn
  ) {
    problems['endsOn'] = 'Der letzte Tag liegt vor dem ersten.'
  }

  return problems
}

/**
 * Where a round of a plan stands in the overview of a week (section 4.5):
 * open, begun, waiting for the countersignature, handed in, or not performed.
 * Handed in is signed and, where the template asks for it, countersigned; the
 * evidence it makes is then the server's to write.
 */
export const roundStates = [
  'open',
  'started',
  'awaiting_countersignature',
  'submitted',
  'not_performed',
] as const

export type RoundState = (typeof roundStates)[number]

export const roundStateLabel: Readonly<Record<RoundState, string>> = {
  open: 'Offen',
  started: 'Begonnen',
  awaiting_countersignature: 'Wartet auf Gegenzeichnung',
  submitted: 'Abgegeben',
  not_performed: 'Nicht durchgeführt',
}

/**
 * The state of a round from its status and whether its countersignature is
 * still to come, which the server knows from its signatures.
 */
export function roundStateOf(status: ActivityStatus, awaitsCountersignature: boolean): RoundState {
  switch (status) {
    case 'open':
      return 'open'
    case 'started':
      return 'started'
    case 'signed':
      return awaitsCountersignature ? 'awaiting_countersignature' : 'submitted'
    case 'done':
      return 'submitted'
    case 'not_performed':
      return 'not_performed'
  }
}

/** A round as the overview of a week shows it. */
export interface WeekRound {
  readonly id: string
  readonly planId: RoundPlanId
  readonly dueOn: IsoDate
  readonly state: RoundState
  /** Who walks it, none for everybody in the area. */
  readonly performerUserId: string | null
}

/** The overview of a week: the rounds of the plans in it, and those still open from before. */
export interface RoundWeek {
  /** The Monday of the week. */
  readonly weekOf: IsoDate
  readonly rounds: readonly WeekRound[]
  /**
   * Rounds of earlier weeks that are open or begun, the latest first: not
   * quietly gone, until somebody closes them with a reason (#115).
   */
  readonly before: readonly WeekRound[]
}

/**
 * Whether a round may be closed as not performed (section 4.5 of the
 * concept, #115): a round of a past day that is still open or begun. One
 * signed meanwhile waits for what its signature makes, and one of today or
 * later is still to be walked.
 */
export function roundClosable(
  round: { readonly status: ActivityStatus; readonly dueOn: IsoDate | null },
  today: IsoDate,
): boolean {
  return (
    (activityClosable as readonly ActivityStatus[]).includes(round.status) &&
    round.dueOn !== null &&
    round.dueOn < today
  )
}

/** A signature on a round as its page in the office shows it, with the name of whoever gave it. */
export interface RoundSignature {
  readonly id: string
  readonly role: SignatureRole
  readonly name: string
  /** The clock of the device at the moment it was confirmed. */
  readonly signedAt: string
  readonly deviceInfo: string | null
  readonly path: string
  /** Whether it was given for the page as it is now. */
  readonly valid: boolean
}

/** A defect that came of an answer of the round, with the state it is in now. */
export interface RoundDefect {
  readonly id: string
  readonly description: string
  readonly defectClass: string | null
  readonly status: DefectStatus
  readonly roomId: string | null
  readonly assetId: string | null
}

/** An evidence the round was written down as, for the duty a point of it fulfils. */
export interface RoundEvidence {
  readonly id: string
  readonly dutyId: string
  readonly number: string
}

/**
 * A round as its page in the office shows it (#115, section 4.5 of the
 * concept): where and when, who walks it, and once it is signed the page
 * that was signed, with the signatures, the defects that came of its answers
 * and the evidence it was written down as. The answers of a round nobody has
 * signed yet are the work of whoever walks it and are not shown here.
 */
export interface RoundDetails {
  readonly id: string
  readonly planId: string | null
  readonly title: string
  readonly status: ActivityStatus
  readonly state: RoundState
  readonly dueOn: IsoDate | null
  readonly performedOn: IsoDate | null
  readonly propertyId: string
  readonly buildingId: string | null
  readonly areaId: string
  /** Who walks it, none for everybody in the area. */
  readonly performer: DutyPerson | null
  readonly countersignatureRequired: boolean
  readonly formKey: string | null
  readonly formVersion: number | null
  /** Why it was not performed; only a round that was not. */
  readonly closingReason: string | null
  /** The page as the server works it out, once somebody signed it; what a countersignature is given for. */
  readonly page: SignedPage | null
  readonly signatures: readonly RoundSignature[]
  readonly defects: readonly RoundDefect[]
  readonly evidence: readonly RoundEvidence[]
}
