import {
  type Asset,
  type AssetId,
  type Building,
  type BuildingId,
  type Floor,
  type FloorId,
  type Property,
  type Room,
  type RoomId,
  roomTitle,
} from '@opengewerk/haustechnik-domain'
import type { LabelFace, TenantTransaction } from '@opengewerk/platform-server'
import { tenants } from '@opengewerk/platform-server/schema'
import { inArray } from 'drizzle-orm'

import { buildings, floors, rooms } from '../database/schema/index.js'

// What stands on a printed label of this application (#98, board "Etikett:
// Karte und Druck"): the operator in the first line, then what the label is
// stuck on, then where that is, and the code under it, which the page of the
// foundation prints. Three lines and no more: a label of 62 by 29 millimetres
// holds a QR code and that much text that can still be read on a door.

/** The operator, as the first line of every label names it. */
export async function keeperOf(tx: TenantTransaction): Promise<string> {
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants)

  return tenant?.name ?? ''
}

function joined(parts: readonly (string | null | undefined)[], between: string): string | null {
  const said = parts.filter((part): part is string => typeof part === 'string' && part !== '')

  return said.length === 0 ? null : said.join(between)
}

type AssetOnALabel = Pick<Asset, 'id' | 'number' | 'name' | 'buildingId' | 'roomId'>
type RoomOnALabel = Pick<Room, 'id' | 'number' | 'name' | 'buildingId' | 'floorId'>

/**
 * The lines of the labels of these assets, by asset: its number and what it
 * is called, and its building and room. The places are read once for all of
 * them, under the policies of whoever asks.
 */
export async function assetFaces(
  tx: TenantTransaction,
  keeper: string,
  onLabels: readonly AssetOnALabel[],
): Promise<ReadonlyMap<AssetId, Omit<LabelFace, 'code'>>> {
  const buildingIds = [...new Set(onLabels.map((asset) => asset.buildingId))]
  const roomIds = [
    ...new Set(onLabels.map((asset) => asset.roomId).filter((id) => id !== null)),
  ] as RoomId[]
  const buildingNames = await namesOfBuildings(tx, buildingIds)
  const roomRows =
    roomIds.length === 0
      ? []
      : await tx
          .select({ id: rooms.id, number: rooms.number, name: rooms.name })
          .from(rooms)
          .where(inArray(rooms.id, roomIds))
  const roomTitles = new Map(roomRows.map((room) => [room.id as RoomId, roomTitle(room)]))

  return new Map(
    onLabels.map((asset) => [
      asset.id,
      {
        keeper,
        name: joined([asset.number, asset.name], ' '),
        place: joined(
          [
            buildingNames.get(asset.buildingId),
            asset.roomId === null ? null : roomTitles.get(asset.roomId),
          ],
          ', ',
        ),
      },
    ]),
  )
}

/**
 * The lines of the labels of these rooms, by room: its number and what it is
 * called, and its building and floor.
 */
export async function roomFaces(
  tx: TenantTransaction,
  keeper: string,
  onLabels: readonly RoomOnALabel[],
): Promise<ReadonlyMap<RoomId, Omit<LabelFace, 'code'>>> {
  const buildingNames = await namesOfBuildings(tx, [
    ...new Set(onLabels.map((room) => room.buildingId)),
  ])
  const floorIds = [...new Set(onLabels.map((room) => room.floorId))]
  const floorRows =
    floorIds.length === 0
      ? []
      : await tx
          .select({ id: floors.id, name: floors.name })
          .from(floors)
          .where(inArray(floors.id, floorIds))
  const floorNames = new Map(
    (floorRows as Pick<Floor, 'id' | 'name'>[]).map((floor) => [floor.id as FloorId, floor.name]),
  )

  return new Map(
    onLabels.map((room) => [
      room.id,
      {
        keeper,
        name: roomTitle(room),
        place: joined([buildingNames.get(room.buildingId), floorNames.get(room.floorId)], ', '),
      },
    ]),
  )
}

/**
 * The lines of a label from a sheet printed for taking stock: it hangs on
 * nothing yet, so it names its property and leaves the line of the asset
 * empty, for a pen.
 */
export function blankFace(
  keeper: string,
  property: Pick<Property, 'name'>,
): Omit<LabelFace, 'code'> {
  return { keeper, name: null, place: property.name }
}

async function namesOfBuildings(
  tx: TenantTransaction,
  ids: readonly BuildingId[],
): Promise<ReadonlyMap<BuildingId, string>> {
  if (ids.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({ id: buildings.id, name: buildings.name })
    .from(buildings)
    .where(inArray(buildings.id, [...ids]))

  return new Map(
    (rows as Pick<Building, 'id' | 'name'>[]).map((building) => [building.id, building.name]),
  )
}
