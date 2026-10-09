import {
  addMonths,
  type Asset,
  type AssetId,
  defaultKeyDay,
  type IsoDate,
  keyDateIn,
  keyDayOf,
  type MeterExchange,
  type MeterPause,
  type MeterPoint,
  type MeterReading,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import {
  assets,
  meterExchanges,
  meterPauses,
  meterPoints,
  meterReadings,
  meterSettings,
} from './schema/index.js'

// What a measuring point holds, read once for the routes of the office and
// for the sync, which ask the same of a reading (#119, #120): its asset,
// what only it carries, its readings, the replacements of its meter, the
// periods it rests, and the day of the month its readings are due on.

/**
 * The key date that is due on a day for a key day: the one of its month, if
 * it has come, else the one of the month before (#120).
 */
export function keyDateDue(day: IsoDate, keyDay: number): IsoDate {
  const own = keyDateIn(day, keyDay)

  return own <= day ? own : addMonths(own, -1)
}

/** The key day the operator set, the 1st where it set none (#120). */
export async function operatorKeyDay(tx: TenantTransaction): Promise<number> {
  const [setting] = await tx
    .select({ keyDay: meterSettings.keyDay })
    .from(meterSettings)
    .where(isNull(meterSettings.deletedAt))

  return setting?.keyDay ?? defaultKeyDay
}

/** What a measuring point holds, as the pages are worked out from it. */
export interface Held {
  readonly asset: Asset
  readonly point: MeterPoint | null
  /** The day of the month its readings are due on: its own, or the operator's. */
  readonly keyDay: number
  readonly operatorKeyDay: number
  readonly readings: readonly MeterReading[]
  readonly exchanges: readonly MeterExchange[]
  readonly pauses: readonly MeterPause[]
}

/**
 * The asset of a measuring point and what it holds, as the person asking
 * sees it: an asset with a meter, not marked, in their areas. Held, the
 * asset is read with the lock of a change, so that two readings for the
 * same key date at the same moment wait for each other.
 */
export async function heldMeter(
  tx: TenantTransaction,
  id: unknown,
  lock: boolean,
): Promise<Held | null> {
  if (!isUuid(id)) {
    return null
  }

  const query = tx
    .select()
    .from(assets)
    .where(
      and(eq(assets.id, id as AssetId), isNotNull(assets.meterNumber), isNull(assets.deletedAt)),
    )
  const [asset] = lock ? await query.for('no key update') : await query

  if (asset === undefined) {
    return null
  }

  return (await heldOf(tx, [asset as Asset], await operatorKeyDay(tx)))[0] as Held
}

/** What each of some measuring points holds, read at once. */
export async function heldOf(
  tx: TenantTransaction,
  meters: readonly Asset[],
  operatorDay: number,
): Promise<Held[]> {
  if (meters.length === 0) {
    return []
  }

  const ids = meters.map((meter) => meter.id)
  const points = await tx.select().from(meterPoints).where(inArray(meterPoints.assetId, ids))
  const readings = await tx
    .select()
    .from(meterReadings)
    .where(and(inArray(meterReadings.assetId, ids), isNull(meterReadings.deletedAt)))
  const exchanges = await tx
    .select()
    .from(meterExchanges)
    .where(and(inArray(meterExchanges.assetId, ids), isNull(meterExchanges.deletedAt)))
  const pauses = await tx
    .select()
    .from(meterPauses)
    .where(and(inArray(meterPauses.assetId, ids), isNull(meterPauses.deletedAt)))

  return meters.map((asset) => {
    const point = (points.find((each) => each.assetId === asset.id) ?? null) as MeterPoint | null

    return {
      asset,
      point,
      keyDay: keyDayOf(point, { keyDay: operatorDay }),
      operatorKeyDay: operatorDay,
      readings: readings.filter((reading) => reading.assetId === asset.id) as MeterReading[],
      exchanges: exchanges.filter((exchange) => exchange.assetId === asset.id) as MeterExchange[],
      pauses: pauses.filter((pause) => pause.assetId === asset.id) as MeterPause[],
    }
  })
}
