import { addMonths, type Id, type IsoDate, type Synced } from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import { calendarDay, optional, type Problems, required, wholeFromTo } from './fields.js'
import type { PropertyId } from './location.js'
import { type MeterUnit, meterUnitSymbol } from './meter.js'

/**
 * What a measuring point holds beside its asset (section 4.9 of the concept,
 * #119): its readings, each written once and corrected by a new one; the
 * replacement of its meter; the periods it rests; and what only a measuring
 * point carries, its conversion factor, its main meter, its id in the
 * building management system, a note and a lock with its reason.
 *
 * A figure is kept in thousandths of the unit of the meter, as the answer to
 * a point `meter_reading` of a form keeps it (#106), so that no reading is
 * ever a fraction a database rounds. Consumption is worked out from the
 * readings and never kept.
 */

export type MeterPointId = Id<'meter-point'>
export type MeterReadingId = Id<'meter-reading'>
export type MeterExchangeId = Id<'meter-exchange'>
export type MeterPauseId = Id<'meter-pause'>

/** The bounds of what a measuring point holds, the same in the form, the route and the database. */
export const meterLimits = {
  controlId: 100,
  note: 1000,
  reason: 500,
  meterNumber: 60,
  /** The largest conversion factor, for a current transformer of 5000/5 A and more. */
  factor: 100_000,
  /** The largest figure in thousandths, well inside what a number of JavaScript holds exactly. */
  valueMilli: 999_999_999_999_999,
} as const

/** How a reading came: typed in the office, read on a round of the meters, in a round or in a protocol. */
export const meterReadingSources = ['by_hand', 'reading_round', 'round', 'protocol'] as const

export type MeterReadingSource = (typeof meterReadingSources)[number]

export const meterReadingSourceLabel: Readonly<Record<MeterReadingSource, string>> = {
  by_hand: 'Von Hand',
  reading_round: 'Eigene Runde',
  round: 'Rundgang',
  protocol: 'Protokoll',
}

/**
 * What only a measuring point holds, beside its asset: the factor its
 * register is multiplied with (a current transformer), the main meter it
 * counts under, its id in the building management system, a note for
 * whoever reads it ("Zutritt nur für Elektrofachkräfte") with who wrote it and
 * since when, and a lock with its reason, which holds the reading until it is
 * lifted.
 */
export interface MeterPoint extends Synced {
  readonly id: MeterPointId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly assetId: AssetId
  readonly conversionFactor: number | null
  readonly mainMeterId: AssetId | null
  readonly controlId: string | null
  readonly note: string | null
  readonly noteBy: string | null
  readonly notedOn: IsoDate | null
  readonly lockReason: string | null
  readonly lockedOn: IsoDate | null
}

/**
 * A reading of a measuring point: the key date it is the reading for, the
 * day it was read, the figure, how it came, and who entered it. It is never
 * changed: a reading that was wrong is corrected by a new one for the same
 * key date, which names it and the reason, and from then on counts in its
 * place. Both stay readable.
 */
export interface MeterReading extends Synced {
  readonly id: MeterReadingId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly assetId: AssetId
  readonly keyDate: IsoDate
  readonly readOn: IsoDate
  readonly valueMilli: number
  readonly source: MeterReadingSource
  /** The round or the protocol a reading came of. */
  readonly activityId: ActivityId | null
  readonly correctsId: MeterReadingId | null
  readonly correctionReason: string | null
  readonly recordedBy: string
}

/**
 * The meter of a measuring point replaced on a day: the last figure of the
 * old one and its number, the first figure of the new one and its number.
 * The measuring point stays, with its history; the consumption across the
 * day of the replacement counts on both meters.
 */
export interface MeterExchange extends Synced {
  readonly id: MeterExchangeId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly assetId: AssetId
  readonly exchangedOn: IsoDate
  readonly oldNumber: string
  readonly oldEndMilli: number
  readonly newNumber: string
  readonly newStartMilli: number
}

/** A period a measuring point rests, from a day and on request to a day, with its reason. */
export interface MeterPause extends Synced {
  readonly id: MeterPauseId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly assetId: AssetId
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate | null
  readonly reason: string
}

/** How many places after the comma a figure of a unit shows. */
export const meterDecimals: Readonly<Record<MeterUnit, number>> = {
  kilowatt_hours: 0,
  megawatt_hours: 2,
  cubic_metres: 1,
}

const figureFormats = new Map<number, Intl.NumberFormat>()

/** A figure in thousandths of a unit, as a meter of that unit shows it: `4.812,0 m³`. */
export function meterFigure(milli: number, unit: MeterUnit): string {
  const decimals = meterDecimals[unit]
  const format =
    figureFormats.get(decimals) ??
    new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })

  figureFormats.set(decimals, format)

  return `${format.format(milli / 1000)} ${meterUnitSymbol[unit]}`
}

/**
 * The key date a reading of a day is the reading for (section 4.9): the
 * first day of the month nearest to it, the first of this month up to the
 * 15th, the first of the next one after it. A reading on the 30th of April is
 * the reading for the 1st of May.
 */
export function keyDateFor(readOn: IsoDate): IsoDate {
  const first = `${readOn.slice(0, 7)}-01` as IsoDate

  return Number(readOn.slice(8, 10)) <= 15 ? first : addMonths(first, 1)
}

/** Whether a day is a key date: the first day of a month. */
export function isKeyDate(day: string): boolean {
  return calendarDay(day) && day.endsWith('-01')
}

/** The key dates from one to another, both included, one a month. */
export function keyDatesBetween(from: IsoDate, to: IsoDate): readonly IsoDate[] {
  const dates: IsoDate[] = []

  for (let at = from; at <= to; at = addMonths(at, 1)) {
    dates.push(at)
  }

  return dates
}

/** Whether a day lies in a period a measuring point rests. */
export function meterRestsOn(
  pauses: readonly Pick<MeterPause, 'startsOn' | 'endsOn'>[],
  day: IsoDate,
) {
  return pauses.some(
    (pause) => pause.startsOn <= day && (pause.endsOn === null || day <= pause.endsOn),
  )
}

/** The readings that count: those no other reading corrects. */
export function validReadings<
  Reading extends { readonly id: string; readonly correctsId: string | null },
>(readings: readonly Reading[]): readonly Reading[] {
  const corrected = new Set(readings.map((reading) => reading.correctsId).filter(Boolean))

  return readings.filter((reading) => !corrected.has(reading.id))
}

/** What a consumption is worked out from: the readings that count, the replacements, the factor. */
export interface ConsumptionInput {
  readonly readings: readonly Pick<MeterReading, 'keyDate' | 'readOn' | 'valueMilli'>[]
  readonly exchanges: readonly Pick<
    MeterExchange,
    'exchangedOn' | 'oldEndMilli' | 'newStartMilli'
  >[]
  readonly pauses: readonly Pick<MeterPause, 'startsOn' | 'endsOn'>[]
  readonly conversionFactor: number | null
}

/**
 * The consumption up to a key date, from the reading before it: in
 * thousandths of the unit, multiplied with the factor; `paused` where the
 * whole time between the two lies in periods the measuring point rests; none
 * for the first reading, which has nothing before it.
 */
export type Consumption =
  | { readonly kind: 'consumed'; readonly milli: number; readonly months: number }
  | { readonly kind: 'paused' }
  | { readonly kind: 'first' }

/**
 * The consumption up to each key date with a reading that counts, by key
 * date (section 4.9, #119). Across a replacement it counts on both meters:
 * from the reading before up to the last figure of the old one, and from the
 * first figure of the new one up to the reading. Never kept, always worked
 * out again.
 */
export function consumptionByKeyDate(input: ConsumptionInput): ReadonlyMap<IsoDate, Consumption> {
  const readings = [...input.readings].sort((left, right) =>
    left.keyDate === right.keyDate
      ? left.readOn < right.readOn
        ? -1
        : 1
      : left.keyDate < right.keyDate
        ? -1
        : 1,
  )
  const exchanges = [...input.exchanges].sort((left, right) =>
    left.exchangedOn < right.exchangedOn ? -1 : 1,
  )
  const factor = input.conversionFactor ?? 1
  const result = new Map<IsoDate, Consumption>()

  readings.forEach((reading, index) => {
    const before = readings[index - 1]

    if (before === undefined) {
      result.set(reading.keyDate, { kind: 'first' })

      return
    }

    const between = keyDatesBetween(before.keyDate, reading.keyDate)
    const days = daysBetween(before.keyDate, reading.keyDate)

    if (days.length > 0 && days.every((day) => meterRestsOn(input.pauses, day))) {
      result.set(reading.keyDate, { kind: 'paused' })

      return
    }

    let from = before.valueMilli
    let counted = 0

    for (const exchange of exchanges) {
      if (exchange.exchangedOn > before.readOn && exchange.exchangedOn <= reading.readOn) {
        counted += exchange.oldEndMilli - from
        from = exchange.newStartMilli
      }
    }

    counted += reading.valueMilli - from
    result.set(reading.keyDate, {
      kind: 'consumed',
      milli: counted * factor,
      months: between.length - 1,
    })
  })

  return result
}

/** The days from one key date up to the day before the next, which a consumption covers. */
function daysBetween(from: IsoDate, to: IsoDate): readonly IsoDate[] {
  const days: IsoDate[] = []
  const end = new Date(`${to}T00:00:00Z`)

  for (const at = new Date(`${from}T00:00:00Z`); at < end; at.setUTCDate(at.getUTCDate() + 1)) {
    days.push(at.toISOString().slice(0, 10) as IsoDate)
  }

  return days
}

/**
 * Why a figure for a key date is in doubt, in a sentence, or null (section
 * 4.9: "kleiner als der letzte Stand"): smaller than the reading that counts
 * before it, or than the first figure of a meter put in since. A meter that
 * was replaced is entered as a replacement, not as a smaller reading.
 */
export function readingDoubt(
  figure: { readonly keyDate: IsoDate; readonly readOn: IsoDate; readonly valueMilli: number },
  before: ConsumptionInput,
  unit: MeterUnit,
): string | null {
  const earlier = [...before.readings]
    .filter((reading) => reading.keyDate < figure.keyDate)
    .sort((left, right) => (left.keyDate < right.keyDate ? 1 : -1))[0]
  const replaced = [...before.exchanges]
    .filter(
      (exchange) =>
        exchange.exchangedOn <= figure.readOn &&
        (earlier === undefined || exchange.exchangedOn > earlier.readOn),
    )
    .sort((left, right) => (left.exchangedOn < right.exchangedOn ? 1 : -1))[0]

  if (replaced !== undefined) {
    return figure.valueMilli < replaced.newStartMilli
      ? `Kleiner als der Anfangsstand des neuen Zählers, ${meterFigure(replaced.newStartMilli, unit)}.`
      : null
  }

  if (earlier !== undefined && figure.valueMilli < earlier.valueMilli) {
    return `Kleiner als der letzte Stand vom ${germanDay(earlier.keyDate)}, ${meterFigure(earlier.valueMilli, unit)}. Wurde der Zähler getauscht, dann über „Zählertausch“.`
  }

  // A reading entered after a later one, or a correction of an older one,
  // is not larger than the reading after it on the same meter.
  const later = [...before.readings]
    .filter((reading) => reading.keyDate > figure.keyDate)
    .sort((left, right) => (left.keyDate < right.keyDate ? -1 : 1))[0]
  const replacedSince =
    later !== undefined &&
    before.exchanges.some(
      (exchange) => exchange.exchangedOn > figure.readOn && exchange.exchangedOn <= later.readOn,
    )

  if (later !== undefined && !replacedSince && figure.valueMilli > later.valueMilli) {
    return `Größer als der Stand danach vom ${germanDay(later.keyDate)}, ${meterFigure(later.valueMilli, unit)}.`
  }

  return null
}

function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** What is wrong with a reading as it is entered, one sentence per field. */
export function meterReadingProblems(
  reading: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}
  const keyDate = reading['keyDate']
  const readOn = reading['readOn']
  const value = reading['valueMilli']

  if (keyDate !== undefined && (typeof keyDate !== 'string' || !isKeyDate(keyDate))) {
    problems['keyDate'] = 'Der Stichtag ist der erste Tag eines Monats.'
  }

  if (readOn !== undefined && !calendarDay(readOn)) {
    problems['readOn'] = 'Der Tag der Ablesung ist ein Tag, geschrieben 2026-10-05.'
  }

  if (value !== undefined && !wholeFromTo(value, 0, meterLimits.valueMilli)) {
    problems['valueMilli'] = 'Der Stand ist eine Zahl ab 0.'
  }

  optional(
    problems,
    reading,
    'correctionReason',
    meterLimits.reason,
    `Der Grund hat höchstens ${String(meterLimits.reason)} Zeichen.`,
  )

  const corrects = reading['correctsId']
  const reason = reading['correctionReason']

  if (
    corrects !== undefined &&
    corrects !== null &&
    (typeof reason !== 'string' || reason.trim() === '') &&
    problems['correctionReason'] === undefined
  ) {
    problems['correctionReason'] = 'Eine Berichtigung nennt ihren Grund.'
  }

  return problems
}

/** What is wrong with a replacement of a meter. */
export function meterExchangeProblems(
  exchange: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  if (exchange['exchangedOn'] !== undefined && !calendarDay(exchange['exchangedOn'])) {
    problems['exchangedOn'] = 'Der Tag des Tauschs ist ein Tag, geschrieben 2026-10-14.'
  }

  required(
    problems,
    exchange,
    'newNumber',
    meterLimits.meterNumber,
    'Die Zählernummer des neuen Zählers',
  )

  for (const field of ['oldEndMilli', 'newStartMilli'] as const) {
    const value = exchange[field]

    if (value !== undefined && !wholeFromTo(value, 0, meterLimits.valueMilli)) {
      problems[field] =
        field === 'oldEndMilli'
          ? 'Der Endstand ist eine Zahl ab 0.'
          : 'Der Anfangsstand ist eine Zahl ab 0.'
    }
  }

  return problems
}

/** What is wrong with a period a measuring point rests. */
export function meterPauseProblems(pause: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const startsOn = pause['startsOn']
  const endsOn = pause['endsOn']

  if (startsOn !== undefined && !calendarDay(startsOn)) {
    problems['startsOn'] = 'Der erste Tag ist ein Tag, geschrieben 2026-07-15.'
  }

  if (endsOn !== undefined && endsOn !== null && !calendarDay(endsOn)) {
    problems['endsOn'] = 'Der letzte Tag ist ein Tag, geschrieben 2026-08-31.'
  } else if (
    typeof startsOn === 'string' &&
    typeof endsOn === 'string' &&
    calendarDay(startsOn) &&
    endsOn < startsOn
  ) {
    problems['endsOn'] = 'Der letzte Tag liegt nicht vor dem ersten.'
  }

  required(problems, pause, 'reason', meterLimits.reason, 'Der Grund')

  return problems
}

/** What is wrong with what only a measuring point holds. */
export function meterPointProblems(point: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}
  const factor = point['conversionFactor']

  if (factor !== undefined && factor !== null && !wholeFromTo(factor, 1, meterLimits.factor)) {
    problems['conversionFactor'] =
      `Der Wandlerfaktor ist eine ganze Zahl von 1 bis ${String(meterLimits.factor)}.`
  }

  optional(
    problems,
    point,
    'controlId',
    meterLimits.controlId,
    `Die Kennung in der Leittechnik hat höchstens ${String(meterLimits.controlId)} Zeichen.`,
  )
  optional(
    problems,
    point,
    'note',
    meterLimits.note,
    `Die Notiz hat höchstens ${String(meterLimits.note)} Zeichen.`,
  )
  optional(
    problems,
    point,
    'lockReason',
    meterLimits.reason,
    `Der Grund hat höchstens ${String(meterLimits.reason)} Zeichen.`,
  )

  return problems
}
