import {
  type AssetId,
  type BuildingId,
  buildingKindLabel,
  byNameIn,
  byNumberIn,
  type FloorId,
  type PropertyId,
  type RecordState,
  type RoomId,
  roomTitle,
} from '@opengewerk/haustechnik-domain'
import { maybeText, text } from '@opengewerk/platform-web/sync'

import type { PlaceAbove } from './place-path.js'

/**
 * The places as a device holds them, read for a screen: what a building is
 * used as in words, what a room is called in one line, the order floors and
 * rooms are listed in, and the path a page stands under. Both entries read
 * the same records, so both read them here.
 */

/**
 * The kinds of a building by their keys, in the order they were chosen. On a
 * device they are the text of a list (ADR 0005 in the repository opengewerk),
 * from a route a list.
 */
export function kindKeysOf(
  building: Readonly<Record<string, unknown>> | null | undefined,
): readonly string[] {
  const held: unknown = building?.['kinds']
  let kinds: unknown = held

  if (typeof held === 'string') {
    try {
      kinds = JSON.parse(held)
    } catch {
      kinds = []
    }
  }

  return Array.isArray(kinds) ? kinds.map(String) : []
}

/**
 * The kinds of a building in words, in the order they were chosen; a kind
 * this version does not know is shown by its key rather than dropped.
 */
export function kindsOf(
  building: Readonly<Record<string, unknown>> | null | undefined,
): readonly string[] {
  return kindKeysOf(building).map((kind) =>
    Object.hasOwn(buildingKindLabel, kind)
      ? buildingKindLabel[kind as keyof typeof buildingKindLabel]
      : kind,
  )
}

/** What a room is called in one line: its number and its name, whichever it has. */
export function titleOfRoom(room: RecordState | null | undefined): string {
  return roomTitle({ number: maybeText(room, 'number'), name: maybeText(room, 'name') })
}

/** Floors from the lowest level up, as a building is read from the ground; two on one level by name. */
export function byLevel(left: RecordState, right: RecordState): number {
  const level = (floor: RecordState) => (typeof floor['level'] === 'number' ? floor['level'] : 0)

  return level(left) - level(right) || byNameIn(text(left, 'name'), text(right, 'name'))
}

/** Rooms and assets by their number as a person counts them, as `byNumberIn` of the domain orders them. */
export function byNumber(left: RecordState, right: RecordState): number {
  const numbered = (record: RecordState) => ({
    number: maybeText(record, 'number'),
    name: text(record, 'name'),
  })

  return byNumberIn(numbered(left), numbered(right))
}

/**
 * What a page at a place stands under, from the records a device holds: the
 * property, and of building, floor, room and asset the ones the page stands
 * below. The page itself is left out by whoever calls this.
 */
export function placeAbove(records: {
  readonly property: RecordState
  readonly building?: RecordState | null
  readonly floor?: RecordState | null
  readonly room?: RecordState | null
  readonly asset?: RecordState | null
}): PlaceAbove {
  const { property, building, floor, room, asset } = records
  const id = (record: RecordState) => String(record['id'])

  return {
    property: { id: id(property) as PropertyId, name: text(property, 'name') },
    ...(building
      ? { building: { id: id(building) as BuildingId, name: text(building, 'name') } }
      : {}),
    ...(floor ? { floor: { id: id(floor) as FloorId, name: text(floor, 'name') } } : {}),
    ...(room
      ? {
          room: {
            id: id(room) as RoomId,
            number: maybeText(room, 'number'),
            name: maybeText(room, 'name'),
          },
        }
      : {}),
    ...(asset ? { asset: { id: id(asset) as AssetId, name: text(asset, 'name') } } : {}),
  }
}
