import type { IsoDate } from '@opengewerk/platform-domain'

import { type BasicMeasure, basicMeasureLabel, basicMeasures } from './activity.js'
import { nextAppointment, type Rhythm } from './duty.js'
import type { Problems } from './fields.js'

/**
 * The figures over time, "Auswertungen" (section 4.16 of the concept, #334,
 * decided 15.10.2026): the fulfilment of the duties per month, the open
 * defects by age and class, the faults by category and building with the time
 * to acceptance and to the end, and the activities by the basic measures of
 * DIN 31051.
 *
 * Per building, property and area, never per person: no ranking, no delay of
 * an employee, and no column of a person in a table either. That is a promise
 * to a works council (section 9), and a test holds it. Where only one person
 * answers for a building, a figure of the building points at them; the
 * processing description says so.
 */

/** The views of the screen, in the order of its tabs; the consumption of the meters since #335. */
export const reportViews = ['duties', 'defects', 'faults', 'activities', 'consumption'] as const

export type ReportView = (typeof reportViews)[number]

export const reportViewLabel: Readonly<Record<ReportView, string>> = {
  duties: 'Pflichten',
  defects: 'Mängel',
  faults: 'Störungen',
  activities: 'Vorgänge',
  consumption: 'Verbrauch',
}

/** The grid a period is counted in. */
export const reportGrids = ['month', 'quarter', 'year'] as const

export type ReportGrid = (typeof reportGrids)[number]

export const reportGridLabel: Readonly<Record<ReportGrid, string>> = {
  month: 'Monat',
  quarter: 'Quartal',
  year: 'Jahr',
}

/** A month as an address and a question write it: "2026-10". */
export type ReportMonth = string

/** The longest period, in months. */
export const reportMostMonths = 60

const monthNames = [
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
] as const

export function isReportMonth(value: unknown): value is ReportMonth {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/u.test(value)
}

/** The months from one to the other, both included. */
function monthsBetween(from: ReportMonth, to: ReportMonth): number {
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number]
  const [toYear, toMonth] = to.split('-').map(Number) as [number, number]

  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1
}

/** What is wrong with a period: two months, the first not after the second, and not longer than five years. */
export function reportPeriodProblems(period: {
  readonly from: unknown
  readonly to: unknown
}): Readonly<Problems> {
  if (!isReportMonth(period.from) || !isReportMonth(period.to)) {
    return {
      period: 'Ein Zeitraum geht von einem Monat zu einem Monat, etwa von 2025-10 bis 2026-09.',
    }
  }

  const months = monthsBetween(period.from, period.to)

  if (months < 1) {
    return { period: 'Der Zeitraum endet vor seinem Anfang.' }
  }

  return months > reportMostMonths
    ? { period: `Ein Zeitraum ist höchstens ${String(reportMostMonths / 12)} Jahre lang.` }
    : {}
}

/** The month of a day. */
export function monthOf(day: IsoDate): ReportMonth {
  return day.slice(0, 7)
}

/** The twelve months up to the month of a day, as the screen opens. */
export function lastTwelveMonths(today: IsoDate): {
  readonly from: ReportMonth
  readonly to: ReportMonth
} {
  const [year, month] = today.split('-').map(Number) as [number, number]
  const start = year * 12 + (month - 1) - 11

  return {
    from: `${String(Math.floor(start / 12))}-${String((start % 12) + 1).padStart(2, '0')}`,
    to: monthOf(today),
  }
}

/** The first and the last day of a period of months. */
export function daysOfPeriod(
  from: ReportMonth,
  to: ReportMonth,
): { readonly first: IsoDate; readonly last: IsoDate } {
  const [year, month] = to.split('-').map(Number) as [number, number]
  // Day 0 of the month after is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

  return { first: `${from}-01`, last }
}

/** One period of a grid: its key, which sorts, and how a person reads it. */
export interface ReportPeriod {
  readonly key: string
  readonly label: string
}

/** The period a day falls in. */
export function periodOf(day: IsoDate, grid: ReportGrid): ReportPeriod {
  const year = day.slice(0, 4)
  const month = Number(day.slice(5, 7))

  switch (grid) {
    case 'year':
      return { key: year, label: year }
    case 'quarter': {
      const quarter = Math.floor((month - 1) / 3) + 1

      return { key: `${year}-Q${String(quarter)}`, label: `${String(quarter)}. Quartal ${year}` }
    }
    default:
      return {
        key: `${year}-${String(month).padStart(2, '0')}`,
        label: `${monthNames[month - 1] ?? ''} ${year}`,
      }
  }
}

/** Every period of a grid from the first month to the last, in order. */
export function periodsBetween(
  from: ReportMonth,
  to: ReportMonth,
  grid: ReportGrid,
): readonly ReportPeriod[] {
  const periods: ReportPeriod[] = []
  const [year, month] = from.split('-').map(Number) as [number, number]
  const start = year * 12 + (month - 1)
  const end = start + monthsBetween(from, to)

  for (let at = start; at < end; at += 1) {
    const day = `${String(Math.floor(at / 12))}-${String((at % 12) + 1).padStart(2, '0')}-01`
    const period = periodOf(day, grid)

    if (periods.at(-1)?.key !== period.key) {
      periods.push(period)
    }
  }

  return periods
}

/**
 * A term of a duty, replayed from its evidence: no table keeps past terms,
 * they are worked out on every reading like the appointment of today (ADR
 * 0002 of this application, point 12). The day it fell due, the last day
 * doing it still counted as on time, and the day it was met, if it was.
 */
export interface DutyTerm {
  readonly dueOn: IsoDate
  readonly onTimeUntil: IsoDate
  readonly metOn: IsoDate | null
}

/**
 * The terms a duty had up to a day, from the days it was met on: the term
 * after the k-th performance is what `nextAppointment` names for the first k,
 * the appointment the duty had on the day after it, and the (k+1)-th
 * performance is the one that met it. A duty never met has no term, it was
 * never recorded; a term on or after the day the duty ends is none, as for the
 * register; a term after the day of asking has not fallen due yet.
 */
export function replayedTerms(
  rhythm: Rhythm,
  metOn: readonly IsoDate[],
  bounds: { readonly endsOn: IsoDate | null; readonly today: IsoDate },
): readonly DutyTerm[] {
  const days = [...metOn].sort()
  const terms: DutyTerm[] = []

  for (let count = 1; count <= days.length; count += 1) {
    const appointment = nextAppointment(rhythm, days.slice(0, count))

    if (appointment === null) {
      continue
    }

    if (bounds.endsOn !== null && appointment.dueOn >= bounds.endsOn) {
      break
    }

    if (appointment.dueOn > bounds.today) {
      break
    }

    terms.push({
      dueOn: appointment.dueOn,
      onTimeUntil: appointment.onTimeUntil,
      metOn: days[count] ?? null,
    })
  }

  return terms
}

/**
 * The one term of a duty that falls due once (#439): its due day, met by the
 * first evidence on or after the day it is counted from. Like a term of a
 * duty that recurs, it is none once the duty has ended before it, and it has
 * not fallen due before the day of asking.
 */
export function onceTerms(
  duty: { readonly dueOn: IsoDate; readonly countedFrom: IsoDate | null },
  metOn: readonly IsoDate[],
  bounds: { readonly endsOn: IsoDate | null; readonly today: IsoDate },
): readonly DutyTerm[] {
  const { dueOn, countedFrom } = duty

  if ((bounds.endsOn !== null && dueOn >= bounds.endsOn) || dueOn > bounds.today) {
    return []
  }

  const met = [...metOn].sort().find((day) => countedFrom === null || day >= countedFrom)

  return [{ dueOn, onTimeUntil: dueOn, metOn: met ?? null }]
}

/** How a term turned out: met by its last day, met later, or not met yet. */
export type TermOutcome = 'on_time' | 'late' | 'open'

export function termOutcome(term: DutyTerm): TermOutcome {
  if (term.metOn === null) {
    return 'open'
  }

  return term.metOn <= term.onTimeUntil ? 'on_time' : 'late'
}

/** The fulfilment in one period: the terms that fell due in it, and how each turned out. */
export interface FulfilmentRow extends ReportPeriod {
  readonly due: number
  readonly onTime: number
  readonly late: number
  readonly open: number
}

/** The fulfilment of the duties per period, each term in the period it fell due in. */
export function fulfilmentByPeriod(
  terms: readonly DutyTerm[],
  from: ReportMonth,
  to: ReportMonth,
  grid: ReportGrid,
): readonly FulfilmentRow[] {
  const { first, last } = daysOfPeriod(from, to)
  const counted = new Map(
    periodsBetween(from, to, grid).map((period) => [
      period.key,
      { ...period, due: 0, onTime: 0, late: 0, open: 0 },
    ]),
  )

  for (const term of terms) {
    if (term.dueOn < first || term.dueOn > last) {
      continue
    }

    const row = counted.get(periodOf(term.dueOn, grid).key)

    if (row === undefined) {
      continue
    }

    const outcome = termOutcome(term)

    row.due += 1
    row[outcome === 'on_time' ? 'onTime' : outcome] += 1
  }

  return [...counted.values()]
}

/** The ages a defect open today falls in, from the day it was found. */
export const defectAgeBands = ['month', 'quarter', 'year', 'older'] as const

export type DefectAgeBand = (typeof defectAgeBands)[number]

export const defectAgeBandLabel: Readonly<Record<DefectAgeBand, string>> = {
  month: 'bis 30 Tage',
  quarter: '31 bis 90 Tage',
  year: '91 bis 365 Tage',
  older: 'über ein Jahr',
}

/** The band of a defect found on a day, on another day. */
export function defectAgeBand(foundOn: IsoDate, today: IsoDate): DefectAgeBand {
  const days = Math.round((Date.parse(today) - Date.parse(foundOn)) / 86_400_000)

  if (days <= 30) {
    return 'month'
  }

  if (days <= 90) {
    return 'quarter'
  }

  return days <= 365 ? 'year' : 'older'
}

/** The open defects of one class, by age, and how many are past the day to remedy them. */
export interface DefectFiguresRow {
  /** The class, as its package names it, or null for a defect without one. */
  readonly defectClass: string | null
  readonly label: string
  readonly bands: Readonly<Record<DefectAgeBand, number>>
  readonly open: number
  readonly overdue: number
}

export interface DefectFigures {
  /** The day the defects are open on: today, as a defect keeps no day it was remedied. */
  readonly on: IsoDate
  readonly rows: readonly DefectFiguresRow[]
}

/** The middle of some numbers, or nothing for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/** The faults of one category or one building that came in during the period, and how long they took. */
export interface FaultFiguresRow {
  readonly key: string
  readonly label: string
  /** For a building, its property. */
  readonly sub: string | null
  readonly received: number
  readonly accepted: number
  readonly done: number
  readonly rejected: number
  /** The median in days from coming in to being accepted, or nothing where none was. */
  readonly daysToAcceptance: number | null
  /** The median in days from coming in to the signature under its work order. */
  readonly daysToDone: number | null
}

export interface FaultFigures {
  readonly byCategory: readonly FaultFiguresRow[]
  readonly byBuilding: readonly FaultFiguresRow[]
}

/** What an activity counts as, by DIN 31051: one of the four basic measures, or none for an old order without one. */
export const measureColumns = [...basicMeasures, 'none'] as const

export type MeasureColumn = (typeof measureColumns)[number]

export const measureColumnLabel: Readonly<Record<MeasureColumn, string>> = {
  ...basicMeasureLabel,
  none: 'Ohne Zuordnung',
}

/** The activities finished in one period, by their basic measure. */
export interface MeasureRow extends ReportPeriod {
  readonly counts: Readonly<Record<MeasureColumn, number>>
  readonly total: number
}

/** The column an activity is counted in. */
export function measureColumnOf(measure: BasicMeasure | null): MeasureColumn {
  return measure ?? 'none'
}

/** What the screen and the table ask: where, and over which months in which grid. */
export interface FiguresFilter {
  readonly areaId?: string
  readonly propertyId?: string
  readonly buildingId?: string
  readonly from: ReportMonth
  readonly to: ReportMonth
  readonly grid: ReportGrid
}
