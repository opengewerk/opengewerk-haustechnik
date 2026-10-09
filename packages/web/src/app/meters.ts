import {
  type ConsumptionInput,
  defaultKeyDay,
  type IsoDate,
  keyDateFor,
  keyDayOf,
  meterRestsOn,
  type MeterUnit,
  readingDoubt,
  readingJump,
  type RecordState,
  validReadings,
} from '@opengewerk/haustechnik-domain'
import { maybeText, text, useRecords } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

/**
 * A measuring point as this device holds it (section 4.9 of the concept,
 * #120): its asset, the day of the month its readings are due on, the
 * readings that count, the replacements of its meter and the periods it
 * rests. What a reading on site is asked, the device asks of this, with the
 * rules of `domain` the server asks again.
 */
export interface HeldMeter {
  readonly asset: RecordState
  readonly unit: MeterUnit
  readonly keyDay: number
  readonly lockReason: string | null
  readonly history: ConsumptionInput
}

/** What a figure read on a day comes to at its measuring point. */
export interface ReadingStanding {
  readonly keyDate: IsoDate
  /** The reading before the key date, the "Vormonat" beside the figure. */
  readonly before: { readonly keyDate: IsoDate; readonly valueMilli: number } | null
  /** Whether the key date has a reading already. */
  readonly taken: boolean
  /** Whether the measuring point rests on the key date. */
  readonly rests: boolean
}

function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

function figureOf(record: RecordState, field: string): number {
  return Number(record[field])
}

/**
 * The measuring points this device holds, by the id of their asset: every
 * asset with a meter number that is not removed, with what it holds.
 */
export function useHeldMeters(): ReadonlyMap<string, HeldMeter> {
  const assets = useRecords('assets')
  const points = useRecords('meter_points')
  const readings = useRecords('meter_readings')
  const exchanges = useRecords('meter_exchanges')
  const pauses = useRecords('meter_pauses')
  const settings = useRecords('meter_settings')

  return useMemo(() => {
    const operator = settings.find(live)
    const operatorDay = operator === undefined ? defaultKeyDay : figureOf(operator, 'keyDay')
    const held = new Map<string, HeldMeter>()

    for (const asset of assets) {
      if (!live(asset) || maybeText(asset, 'meterNumber') === null) {
        continue
      }

      const id = text(asset, 'id')
      const of = (records: readonly RecordState[]) =>
        records.filter((record) => live(record) && record['assetId'] === id)
      const point = of(points)[0] ?? null
      const own = point === null || point['keyDay'] === null ? null : figureOf(point, 'keyDay')
      const keyDay = keyDayOf({ keyDay: own }, { keyDay: operatorDay })

      held.set(id, {
        asset,
        unit: (maybeText(asset, 'meterUnit') ?? 'cubic_metres') as MeterUnit,
        keyDay,
        lockReason: point === null ? null : maybeText(point, 'lockReason'),
        history: {
          readings: validReadings(
            of(readings).map((reading) => ({
              id: text(reading, 'id'),
              correctsId: maybeText(reading, 'correctsId'),
              // A reading made on this device has its key date from the server
              // once it is exchanged; until then the device works it out the same way.
              keyDate: (maybeText(reading, 'keyDate') ??
                keyDateFor(text(reading, 'readOn') as IsoDate, keyDay)) as IsoDate,
              readOn: text(reading, 'readOn') as IsoDate,
              valueMilli: figureOf(reading, 'valueMilli'),
            })),
          ),
          exchanges: of(exchanges).map((exchange) => ({
            exchangedOn: text(exchange, 'exchangedOn') as IsoDate,
            oldEndMilli: figureOf(exchange, 'oldEndMilli'),
            newStartMilli: figureOf(exchange, 'newStartMilli'),
          })),
          pauses: of(pauses).map((pause) => ({
            startsOn: text(pause, 'startsOn') as IsoDate,
            endsOn: maybeText(pause, 'endsOn') as IsoDate | null,
          })),
          conversionFactor:
            point === null || point['conversionFactor'] === null
              ? null
              : figureOf(point, 'conversionFactor'),
        },
      })
    }

    return held
  }, [assets, points, readings, exchanges, pauses, settings])
}

/** Where a figure read on a day stands at its measuring point. */
export function readingStanding(meter: HeldMeter, readOn: IsoDate): ReadingStanding {
  const keyDate = keyDateFor(readOn, meter.keyDay)
  const before = [...meter.history.readings]
    .filter((reading) => reading.keyDate < keyDate)
    .sort((left, right) => (left.keyDate < right.keyDate ? 1 : -1))[0]

  return {
    keyDate,
    before:
      before === undefined ? null : { keyDate: before.keyDate, valueMilli: before.valueMilli },
    taken: meter.history.readings.some((reading) => reading.keyDate === keyDate),
    rests: meterRestsOn(meter.history.pauses, keyDate),
  }
}

/**
 * What the rules of `domain` say of a figure read on a day (#120): a refusal
 * where it lies below the reading before or above the one after, which the
 * server answers in the same words; a question where it jumps, which the
 * person may answer by keeping it.
 */
export function judgedFigure(
  meter: HeldMeter,
  readOn: IsoDate,
  valueMilli: number,
): { readonly refused: string | null; readonly jump: string | null } {
  const figure = { keyDate: keyDateFor(readOn, meter.keyDay), readOn, valueMilli }

  return {
    refused: readingDoubt(figure, meter.history, meter.unit),
    jump: readingJump(figure, meter.history),
  }
}
