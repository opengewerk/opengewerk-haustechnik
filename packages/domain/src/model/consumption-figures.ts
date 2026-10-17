import { addMonths, type IsoDate } from '@opengewerk/platform-domain'

import { periodOf, type ReportGrid, type ReportMonth, type ReportPeriod } from './figures.js'
import {
  type MeterMedium,
  meterMedia,
  meterMediumLabel,
  type MeterUnit,
  meterUnitSymbol,
} from './meter.js'
import {
  type Consumption,
  type ConsumptionInput,
  consumptionByKeyDate,
  keyDateIn,
  meterRestsOn,
} from './meter-reading.js'

/**
 * The consumption of the meters over time (#335, sections 4.9 and 4.16 of the
 * concept, decided 15.10.2026): sums per building, property and medium with
 * the year before; a sub-meter counted once, the main meter with its rest; a
 * period chosen from a month to a month; and a key date without a reading as
 * a gap, never as an estimate. A reading taken over counts like any other and
 * says so.
 *
 * A consumption counts in the month of its key date, as on the page of a
 * measuring point: "up to the key date". Nothing here reads who took a
 * reading.
 */

/** The units a sum is kept in: megawatt hours are summed as kilowatt hours. */
export type SumUnit = Exclude<MeterUnit, 'megawatt_hours'>

export function sumUnitOf(unit: MeterUnit): SumUnit {
  return unit === 'megawatt_hours' ? 'kilowatt_hours' : unit
}

/** What a figure of a unit is multiplied with to be one of its sum. */
export function sumFactorOf(unit: MeterUnit): number {
  return unit === 'megawatt_hours' ? 1000 : 1
}

/** What can be summed: a medium in a unit, "electricity:kilowatt_hours". */
export type MediumKey = `${MeterMedium}:${SumUnit}`

export function mediumKeyOf(medium: MeterMedium, unit: MeterUnit): MediumKey {
  return `${medium}:${sumUnitOf(unit)}`
}

/** "Strom (kWh)", as the choice names it. */
export function mediumKeyLabel(key: MediumKey): string {
  const [medium, unit] = key.split(':') as [MeterMedium, SumUnit]

  return `${meterMediumLabel[medium]} (${meterUnitSymbol[unit]})`
}

export function isMediumKey(value: unknown): value is MediumKey {
  if (typeof value !== 'string') {
    return false
  }

  const [medium, unit, ...rest] = value.split(':')

  return (
    rest.length === 0 &&
    (meterMedia as readonly string[]).includes(medium ?? '') &&
    (unit === 'kilowatt_hours' || unit === 'cubic_metres')
  )
}

/** The pairs in the order of the media, then of the units. */
export function byMediumKey(left: MediumKey, right: MediumKey): number {
  const [leftMedium = '', leftUnit = ''] = left.split(':')
  const [rightMedium = '', rightUnit = ''] = right.split(':')
  const order = (medium: string) => (meterMedia as readonly string[]).indexOf(medium)

  return order(leftMedium) - order(rightMedium) || leftUnit.localeCompare(rightUnit)
}

/** A measuring point as its consumption over time is worked out. */
export interface ConsumptionMeter {
  /** Its readings that count, the replacements of its meter, the periods it rests, its factor. */
  readonly input: ConsumptionInput
  /** The day of the month its readings are due on. */
  readonly keyDay: number
  /** What a figure of its unit is multiplied with to be one of its sum. */
  readonly sumFactor: number
  /** The day it was taken in: without a reading yet, a key date before it is no gap. */
  readonly since: IsoDate
}

/** The month after one, "2026-12" after "2026-11". */
function monthAfter(month: ReportMonth): ReportMonth {
  return addMonths(`${month}-01` as IsoDate, 1).slice(0, 7)
}

/** The months from one to another, both included. */
function monthsFrom(from: ReportMonth, to: ReportMonth): ReportMonth[] {
  const months: ReportMonth[] = []

  for (let at = from; at <= to; at = monthAfter(at)) {
    months.push(at)
  }

  return months
}

/**
 * Whether a measuring point rested the whole month up to a key date: every
 * day from the key date a month before up to the day before this one. Only
 * then does a key date without a reading need none.
 */
function restedUpTo(pauses: ConsumptionMeter['input']['pauses'], keyDate: IsoDate): boolean {
  const end = new Date(`${keyDate}T00:00:00Z`)

  for (
    const at = new Date(`${addMonths(keyDate, -1)}T00:00:00Z`);
    at < end;
    at.setUTCDate(at.getUTCDate() + 1)
  ) {
    if (!meterRestsOn(pauses, at.toISOString().slice(0, 10) as IsoDate)) {
      return false
    }
  }

  return true
}

/** The month a span of months back from a month begins in. */
function monthsBack(month: ReportMonth, months: number): ReportMonth {
  return addMonths(`${month}-01` as IsoDate, -(months - 1)).slice(0, 7)
}

/**
 * The consumption of a measuring point in the months from one to another, in
 * thousandths of its sum unit, or null for a gap. Each key date in the months
 * has to be accounted for: by a consumption up to it that does not reach back
 * before the first month; by a period the point rested the whole month up to
 * it; by lying before its
 * first reading, or before the day it was taken in where it has none yet,
 * when it did not count yet; by lying after today, when it is not due yet;
 * or, without a reading, by a later consumption in the same months that
 * reaches back over it. A key date none of this accounts for is a
 * gap, and so is the whole: a consumption is never spread over months it
 * might belong to.
 */
export function consumptionInMonths(
  meter: ConsumptionMeter,
  from: ReportMonth,
  to: ReportMonth,
  today: IsoDate,
): number | null {
  const byKeyDate = consumptionByKeyDate(meter.input)
  const byMonth = new Map<ReportMonth, Consumption>()

  for (const [keyDate, consumption] of byKeyDate) {
    byMonth.set(keyDate.slice(0, 7), consumption)
  }

  // The day before which it did not count yet: its first reading, or the day it was taken in.
  const starts = [...byKeyDate.keys()].sort()[0] ?? meter.since
  const months = monthsFrom(from, to)
  let milli = 0
  // The earliest month a consumption further on reaches back to.
  let reachedBack = null as ReportMonth | null

  for (const month of [...months].reverse()) {
    const consumption = byMonth.get(month)
    const keyDate = keyDateIn(`${month}-01` as IsoDate, meter.keyDay)

    if (consumption?.kind === 'consumed') {
      const begins = monthsBack(month, consumption.months)

      if (begins < from) {
        return null
      }

      milli += consumption.milli
      reachedBack = reachedBack === null || begins < reachedBack ? begins : reachedBack
      continue
    }

    const accounted =
      consumption !== undefined ||
      keyDate < starts ||
      keyDate > today ||
      restedUpTo(meter.input.pauses, keyDate) ||
      (reachedBack !== null && reachedBack <= month)

    if (!accounted) {
      return null
    }
  }

  return milli * meter.sumFactor
}

/**
 * What a main meter measured without its sub-meters, its rest, or null where
 * it or one of them has a gap. A sub-meter counts once, where it stands, and
 * the main meter with what is left.
 */
export function restOf(own: number | null, subs: readonly (number | null)[]): number | null {
  if (own === null || subs.some((sub) => sub === null)) {
    return null
  }

  return subs.reduce<number>((left, sub) => left - (sub ?? 0), own)
}

/** One period of the course: the consumption, the same months a year before, and how many measuring points have a gap. */
export interface ConsumptionCourseRow extends ReportPeriod {
  readonly milli: number | null
  readonly previousMilli: number | null
  /** How many measuring points have a gap in the period: a key date without a reading, or one whose consumption cannot be split. */
  readonly withGap: number
  /** Whether a key date of the period is due yet. */
  readonly due: boolean
  /** Whether a measuring point counted had a reading by the end of the period, and of the same months a year before. */
  readonly read: boolean
  readonly readBefore: boolean
}

/** A building with its consumption over the whole period and the year before. */
export interface ConsumptionBuildingRow {
  readonly buildingId: string
  readonly label: string
  readonly sub: string
  readonly milli: number | null
  readonly previousMilli: number | null
  /** Whether a measuring point counted had a reading by the end of the period, and of the same months a year before. */
  readonly read: boolean
  readonly readBefore: boolean
}

/** A measuring point in the table "Je Messstelle". */
export interface ConsumptionMeterRow {
  readonly assetId: string
  readonly mark: string | null
  readonly name: string
  readonly building: string
  /** How deep it stands under main meters: 0 for one under none. */
  readonly depth: number
  /** The mark or name of the main meter it counts under, or null. */
  readonly under: string | null
  /** Whether it has sub-meters: then its figures are its rest. */
  readonly rest: boolean
  /** Whether it had a reading by the end of the period, and by the end of the same months a year before. */
  readonly read: boolean
  readonly readBefore: boolean
  readonly milli: number | null
  readonly previousMilli: number | null
  /** Whether a reading that counts in the period was taken over from a predecessor application. */
  readonly takenOver: boolean
  /** The days its meter was replaced in the period. */
  readonly exchangedOn: readonly IsoDate[]
}

export interface ConsumptionFigures {
  /** What can be summed at the place, and which of it is shown. */
  readonly choices: readonly MediumKey[]
  readonly chosen: MediumKey | null
  readonly course: readonly ConsumptionCourseRow[]
  readonly byBuilding: readonly ConsumptionBuildingRow[]
  readonly byMeter: readonly ConsumptionMeterRow[]
}

/** The periods of a grid in some months, each with its first and its last month. */
export function periodsWithMonths(
  from: ReportMonth,
  to: ReportMonth,
  grid: ReportGrid,
): readonly (ReportPeriod & { readonly from: ReportMonth; readonly to: ReportMonth })[] {
  const periods: (ReportPeriod & { from: ReportMonth; to: ReportMonth })[] = []

  for (const month of monthsFrom(from, to)) {
    const period = periodOf(`${month}-01` as IsoDate, grid)
    const last = periods.at(-1)

    if (last?.key === period.key) {
      last.to = month
    } else {
      periods.push({ ...period, from: month, to: month })
    }
  }

  return periods
}

/** The same month a year before. */
export function yearBefore(month: ReportMonth): ReportMonth {
  return addMonths(`${month}-01` as IsoDate, -12).slice(0, 7)
}

/** Whether a key date of a measuring point in the months is due on a day. */
export function dueIn(keyDay: number, from: ReportMonth, today: IsoDate): boolean {
  return keyDateIn(`${from}-01` as IsoDate, keyDay) <= today
}

/** Whether a measuring point has a reading for a key date up to a month: before that it shows "noch kein Stand". */
export function readBy(meter: ConsumptionMeter, month: ReportMonth): boolean {
  return meter.input.readings.some((reading) => reading.keyDate.slice(0, 7) <= month)
}
