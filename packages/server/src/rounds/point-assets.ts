import {
  byNameIn,
  type DutyId,
  dutyHasEnded,
  everyAssetOf,
  fulfilledKind,
  type IsoDate,
  type LifecycleState,
  lifecycleStateOn,
  type PointAssets,
  placeWords,
  roomTitle,
  type TemplateDefinition,
  templatePoints,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import {
  assetLifecycle,
  assets,
  buildings,
  duties,
  floors,
  rooms,
} from '../database/schema/index.js'

/** A duty as its table holds it. */
type DutyRow = typeof duties.$inferSelect

/** Where a round stands: its property, its area and, on request, its building. */
export interface RoundPlace {
  readonly propertyId: DutyRow['propertyId']
  readonly areaId: DutyRow['areaId']
  readonly buildingId: typeof assets.$inferSelect.buildingId | null
}

/**
 * What a round of a version is given beside its form, on its day (#343,
 * section 4.5 of the concept): the assets of each point for every asset of a
 * kind, and the duties such a point fulfils at them.
 */
export interface RoundAssets {
  /** The assets of each point for every asset, null for a version without one. */
  readonly on: (day: IsoDate) => PointAssets | null
  /** At each of those assets, its duty of the kind its point fulfils, in force on the day. */
  readonly duties: (day: IsoDate) => readonly DutyRow[]
}

/**
 * A state in which an asset is not there to be asked about: not yet built,
 * out of service, shut down or removed ("ohne die außer Betrieb genommenen
 * und die zurückgebauten", decided on 15.10.2026).
 */
const notThere: readonly LifecycleState[] = [
  'planned',
  'out_of_service',
  'decommissioned',
  'removed',
]

/**
 * The assets a round asks each point for every asset of a kind about (#343):
 * every asset of the kind under the place of its plan, the property or the
 * building, in the area of the round, that is not marked and on the day of
 * the round not in a state in which it is not there, in the order of where
 * they are and then of their number. Read once for a version at a place,
 * and asked for each day.
 */
export async function roundAssetsOf(
  tx: TenantTransaction,
  definition: TemplateDefinition,
  place: RoundPlace,
): Promise<RoundAssets> {
  const points = templatePoints(definition).flatMap(({ field }) => {
    const kind = everyAssetOf(field)

    return kind === null ? [] : [{ key: field.key, kind, fulfils: fulfilledKind(field) }]
  })

  if (points.length === 0) {
    return { on: () => null, duties: () => [] }
  }

  const rows = await tx
    .select({
      id: assets.id,
      kind: assets.kind,
      number: assets.number,
      buildingName: buildings.name,
      floorName: floors.name,
      roomNumber: rooms.number,
      roomName: rooms.name,
    })
    .from(assets)
    .innerJoin(buildings, eq(buildings.id, assets.buildingId))
    .leftJoin(rooms, eq(rooms.id, assets.roomId))
    .leftJoin(floors, eq(floors.id, rooms.floorId))
    .where(
      and(
        eq(assets.propertyId, place.propertyId),
        eq(assets.areaId, place.areaId),
        place.buildingId === null ? undefined : eq(assets.buildingId, place.buildingId),
        inArray(assets.kind, [...new Set(points.map((point) => point.kind))]),
        isNull(assets.deletedAt),
      ),
    )
  const ordered = rows
    .map((row) => ({
      ...row,
      where: placeWords([
        place.buildingId === null ? row.buildingName : null,
        row.floorName,
        row.roomName === null
          ? row.roomNumber
          : roomTitle({ number: row.roomNumber, name: row.roomName }),
      ]),
    }))
    .sort(
      (left, right) =>
        byNameIn(left.where, right.where) || byNameIn(left.number ?? '', right.number ?? ''),
    )
  const ids = ordered.map((row) => row.id)
  const entries =
    ids.length === 0
      ? []
      : await tx
          .select({
            assetId: assetLifecycle.assetId,
            state: assetLifecycle.state,
            validFrom: assetLifecycle.validFrom,
          })
          .from(assetLifecycle)
          .where(and(inArray(assetLifecycle.assetId, ids), isNull(assetLifecycle.deletedAt)))
  const kinds = [
    ...new Set(points.flatMap((point) => (point.fulfils === null ? [] : [point.fulfils]))),
  ]
  const dutyRows =
    ids.length === 0 || kinds.length === 0
      ? []
      : await tx
          .select()
          .from(duties)
          .where(
            and(
              inArray(duties.assetId, ids),
              inArray(duties.kind, kinds),
              eq(duties.propertyId, place.propertyId),
              isNull(duties.deletedAt),
            ),
          )
  const there = (id: string, day: IsoDate) => {
    const state = lifecycleStateOn(
      entries.filter((entry) => entry.assetId === id),
      day,
    )

    return state === null || !notThere.includes(state)
  }
  const on = (day: IsoDate): PointAssets =>
    Object.fromEntries(
      points.map((point) => [
        point.key,
        ordered
          .filter((row) => row.kind === point.kind && there(row.id, day))
          .map((row) => row.id as string),
      ]),
    )

  return {
    on,
    duties: (day) => {
      const given = on(day)
      const taken = new Set<DutyId>()

      return points.flatMap((point) =>
        point.fulfils === null
          ? []
          : dutyRows.filter((duty) => {
              const fits =
                duty.kind === point.fulfils &&
                duty.assetId !== null &&
                (given[point.key] ?? []).includes(duty.assetId) &&
                !dutyHasEnded(duty, day) &&
                !taken.has(duty.id as DutyId)

              if (fits) {
                taken.add(duty.id as DutyId)
              }

              return fits
            }),
      )
    },
  }
}

/**
 * The number and the name of the assets a round asks its points for every
 * asset about (#343), as a signature names one in a sentence and an
 * evidence keeps it.
 */
export async function pointAssetNames(
  tx: TenantTransaction,
  given: PointAssets | null,
): Promise<ReadonlyMap<string, { readonly number: string | null; readonly name: string }>> {
  const ids = [...new Set(Object.values(given ?? {}).flat())]

  if (ids.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({ id: assets.id, number: assets.number, name: assets.name })
    .from(assets)
    .where(inArray(assets.id, ids as (typeof assets.$inferSelect.id)[]))

  return new Map(rows.map((row) => [row.id as string, { number: row.number, name: row.name }]))
}

/** An asset in a sentence: its number and its name. */
export function assetInWords(asset: {
  readonly number: string | null
  readonly name: string
}): string {
  return [asset.number, asset.name].filter((part) => part !== null && part !== '').join(' ')
}
