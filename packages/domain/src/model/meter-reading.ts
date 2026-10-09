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
  /** The last day of the month a key date may fall on: every month has it. */
  keyDay: 28,
} as const

/**
 * What an operator sets for its meters (section 4.9, #120): the day of the
 * month every reading is due on, the 1st unless it says otherwise. A
 * measuring point may have a day of its own.
 */
export interface MeterSettings {
  readonly keyDay: number
}

export type MeterSettingId = Id<'meter-setting'>

/** The row an operator's settings of its meters are kept in, one per operator. */
export interface MeterSetting extends Synced, MeterSettings {
  readonly id: MeterSettingId
}

/** The key day of an operator that has set none. */
export const defaultKeyDay = 1

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
  /** The day of the month its readings are due on, where it is not the operator's (#120). */
  readonly keyDay: number | null
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
  /** That whoever read it confirmed a figure far above the reading before (#120). */
  readonly jumpConfirmed: boolean
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
 * The key date a reading of a day is the reading for (section 4.9): the key
 * day on or before it, if that is at most 14 days back, else the next one.
 * The operator sets the day, a measuring point may have its own (#120). With
 * the 1st, a reading up to the 15th is the one for the 1st of its month, and a
 * reading on the 30th of April the one for the 1st of May.
 */
export function keyDateFor(readOn: IsoDate, keyDay: number = defaultKeyDay): IsoDate {
  const own = keyDateIn(readOn, keyDay)
  const last = own <= readOn ? own : addMonths(own, -1)

  return daysApart(last, readOn) <= 14 ? last : addMonths(last, 1)
}

/** The key date in the month a day lies in, for a key day. */
export function keyDateIn(day: IsoDate, keyDay: number = defaultKeyDay): IsoDate {
  return `${day.slice(0, 7)}-${String(keyDay).padStart(2, '0')}` as IsoDate
}

/** The key day that counts for a measuring point: its own, or the operator's. */
export function keyDayOf(
  point: { readonly keyDay: number | null } | null,
  settings: MeterSettings,
) {
  return point?.keyDay ?? settings.keyDay
}

/** Whether a day may be a key date: a day of a month from the 1st to the 28th. */
export function isKeyDate(day: string): boolean {
  return calendarDay(day) && Number(day.slice(8, 10)) <= meterLimits.keyDay
}

/** Whether a value is a key day: a whole day of the month from 1 to 28. */
export function isKeyDay(value: unknown): value is number {
  return wholeFromTo(value, 1, meterLimits.keyDay)
}

/** The days from one day to another, negative where the other lies before. */
function daysApart(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
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

/** The words for a figure so many times the one before. */
function timesWords(ratio: number): string {
  for (const [power, words] of [
    [10, 'zehnmal'],
    [100, 'hundertmal'],
    [1000, 'tausendmal'],
  ] as const) {
    if (Math.abs(ratio - power) <= power * 0.15) {
      return words
    }
  }

  return `${Math.round(ratio).toLocaleString('de-DE')}-mal`
}

/**
 * A figure that jumps (section 4.9, #120): far above what the meter showed or
 * ran before. Nine times the reading before and more is most likely a slip of
 * the comma; a consumption per month ten times the one before it most likely
 * a slip of a digit. Either may be right, a meter that ran wild or a burst
 * pipe, so the person is warned and confirms; a right figure is never
 * refused. Nothing to compare across a replacement of the meter, nor without
 * a reading before.
 */
export function readingJump(
  figure: { readonly keyDate: IsoDate; readonly readOn: IsoDate; readonly valueMilli: number },
  before: ConsumptionInput,
): string | null {
  const earlier = [...before.readings]
    .filter((reading) => reading.keyDate < figure.keyDate)
    .sort((left, right) => (left.keyDate < right.keyDate ? 1 : -1))
  const last = earlier[0]

  if (last === undefined) {
    return null
  }

  const replacedBetween = (from: IsoDate, to: IsoDate) =>
    before.exchanges.some((exchange) => exchange.exchangedOn > from && exchange.exchangedOn <= to)

  if (replacedBetween(last.readOn, figure.readOn)) {
    return null
  }

  if (last.valueMilli > 0 && figure.valueMilli >= last.valueMilli * 9) {
    return `Etwa ${timesWords(figure.valueMilli / last.valueMilli)} so viel wie im Vormonat. Stimmt das Komma?`
  }

  const previous = earlier[1]

  if (previous === undefined || replacedBetween(previous.readOn, last.readOn)) {
    return null
  }

  const perMonth = (from: IsoDate, to: IsoDate, milli: number) =>
    milli / Math.max(1, keyDatesBetween(from, to).length - 1)
  const was = perMonth(previous.keyDate, last.keyDate, last.valueMilli - previous.valueMilli)
  const is = perMonth(last.keyDate, figure.keyDate, figure.valueMilli - last.valueMilli)

  return was > 0 && is >= was * 10
    ? `Etwa ${timesWords(is / was)} so viel verbraucht wie im Monat davor. Stimmt der Stand?`
    : null
}

function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** What is said of a key day that is none. */
export const keyDayWords = `Der Stichtag ist ein Tag im Monat von 1 bis ${String(meterLimits.keyDay)}.`

/** What is wrong with the settings of the meters of an operator. */
export function meterSettingsProblems(
  settings: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  return isKeyDay(settings['keyDay']) ? {} : { keyDay: keyDayWords }
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
    problems['keyDate'] = 'Der Stichtag ist ein Tag eines Monats vom 1. bis zum 28.'
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

  const keyDay = point['keyDay']

  if (keyDay !== undefined && keyDay !== null && !isKeyDay(keyDay)) {
    problems['keyDay'] = keyDayWords
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
