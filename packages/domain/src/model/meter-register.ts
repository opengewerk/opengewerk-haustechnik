import type { IsoDate } from '@opengewerk/platform-domain'

import type { AssetId } from './asset.js'
import type { MeterMedium, MeterUnit } from './meter.js'
import type {
  Consumption,
  MeterExchangeId,
  MeterPauseId,
  MeterReadingId,
  MeterReadingSource,
} from './meter-reading.js'
import type { PlaceTarget } from './target.js'

/**
 * The meters in the office (section 4.9 of the concept, #119): the list
 * "Zähler" with the reading for a key date, and the page of a measuring
 * point with its readings, its consumption and its history. The routes
 * answer with these, and the screens read them.
 */

/**
 * How a measuring point stands for a key date: its reading is there, it is
 * missing, the measuring point rests on that day, or it is locked.
 */
export const meterStates = ['present', 'missing', 'paused', 'locked'] as const

export type MeterState = (typeof meterStates)[number]

export const meterStateLabel: Readonly<Record<MeterState, string>> = {
  present: 'liegt vor',
  missing: 'fehlt',
  paused: 'Stillgelegt',
  locked: 'Gesperrt',
}

/** What the list "Zähler" may be narrowed to: every measuring point, or one state for the key date. */
export const meterListStates = ['all', 'missing', 'paused', 'locked'] as const

export type MeterListState = (typeof meterListStates)[number]

/** A reading as a line shows it: the key date, the day, the figure. */
export interface MeterFigureLine {
  readonly keyDate: IsoDate
  readonly readOn: IsoDate
  readonly valueMilli: number
}

/**
 * A measuring point as the list shows it: where it is, its mark and name,
 * what it measures in which unit, the number of its meter, the main meter it
 * counts under, its last reading that counts, and how it stands for the key
 * date asked.
 */
export interface MeterEntry extends PlaceTarget {
  readonly assetId: AssetId
  readonly number: string | null
  readonly mark: string | null
  readonly name: string
  readonly medium: MeterMedium | null
  readonly unit: MeterUnit
  readonly meterNumber: string
  readonly mainMeterId: AssetId | null
  readonly lastReading: MeterFigureLine | null
  readonly state: MeterState
}

/** The list "Zähler" for a key date: the measuring points and how many stand which way. */
export interface MeterList {
  readonly keyDate: IsoDate
  readonly total: number
  readonly properties: number
  readonly counts: Readonly<Record<Exclude<MeterState, 'present'>, number>>
  readonly meters: readonly MeterEntry[]
}

/** A reading on the page of a measuring point, with who entered it and whether it still counts. */
export interface MeterReadingLine extends MeterFigureLine {
  readonly id: MeterReadingId
  readonly source: MeterReadingSource
  readonly name: string
  readonly correctsId: MeterReadingId | null
  readonly correctionReason: string | null
  readonly valid: boolean
}

/**
 * A key date on the page of a measuring point: the reading that counts for
 * it, the ones it corrected, the consumption up to it, and how it stands.
 */
export interface MeterRow {
  readonly keyDate: IsoDate
  readonly state: MeterState
  readonly reading: MeterReadingLine | null
  readonly corrected: readonly MeterReadingLine[]
  readonly consumption: Consumption | null
}

/** The consumption up to a key date and up to the same key date a year before, for the history. */
export interface MeterHistoryLine {
  readonly keyDate: IsoDate
  readonly consumption: Consumption | null
  readonly previousYear: Consumption | null
}

/** Another measuring point by its mark and its name. */
export interface MeterReference {
  readonly assetId: AssetId
  readonly mark: string | null
  readonly name: string
}

/**
 * The page of a measuring point: what the list says, its kind, what only a
 * measuring point carries, the periods it rests and the replacements of its
 * meter, a row for every key date from its first reading on, newest first,
 * and its history over 24 key dates.
 */
export interface MeterDetails extends MeterEntry {
  readonly kind: string
  readonly currentKeyDate: IsoDate
  readonly conversionFactor: number | null
  readonly controlId: string | null
  readonly mainMeter: MeterReference | null
  readonly subMeters: readonly MeterReference[]
  readonly note: { readonly text: string; readonly name: string; readonly on: IsoDate } | null
  readonly lock: { readonly reason: string; readonly on: IsoDate } | null
  readonly pauses: readonly {
    readonly id: MeterPauseId
    readonly startsOn: IsoDate
    readonly endsOn: IsoDate | null
    readonly reason: string
  }[]
  readonly exchanges: readonly {
    readonly id: MeterExchangeId
    readonly exchangedOn: IsoDate
    readonly oldNumber: string
    readonly oldEndMilli: number
    readonly newNumber: string
    readonly newStartMilli: number
  }[]
  readonly rows: readonly MeterRow[]
  readonly history: readonly MeterHistoryLine[]
}
