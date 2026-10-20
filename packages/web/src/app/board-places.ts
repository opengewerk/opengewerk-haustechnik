import { byNameIn, type RecordState } from '@opengewerk/haustechnik-domain'
import { type Draft, type FormField, text, useRecords } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

import { byNumber, titleOfRoom } from './place-records.js'

/**
 * Where a board stands (#495): in a building, and in a room of it where that
 * is known. The building is the one of its low-voltage installation or one
 * the installation supplies, by itself or through a room in it, as the
 * trigger of migration 0100 holds; a device works the same choices out from
 * the records it holds, so that a board is placed without a network as well.
 */

/** A choice in a list of the form. */
interface Choice {
  readonly value: string
  readonly label: string
}

/** The buildings a board of the asset may stand in: the one of the asset first, then the ones it supplies. */
export function boardBuildingsOf(
  asset: RecordState | null | undefined,
  supplies: readonly RecordState[],
  rooms: readonly RecordState[],
): readonly string[] {
  if (!asset) {
    return []
  }

  const own = String(asset['buildingId'])
  const supplied = supplies
    .filter((supply) => supply['assetId'] === asset['id'] && !supply['deletedAt'])
    .map((supply) => {
      if (typeof supply['buildingId'] === 'string') {
        return supply['buildingId']
      }

      const room = rooms.find((each) => each['id'] === supply['roomId'])

      return room ? String(room['buildingId']) : null
    })
    .filter((building): building is string => building !== null && building !== own)

  return [own, ...new Set(supplied)]
}

/** The places of the boards of an asset, read from the device. */
export function useBoardPlaces(assetId: string | undefined) {
  const assets = useRecords('assets')
  const supplies = useRecords('asset_supplies')
  const buildings = useRecords('buildings')
  const rooms = useRecords('rooms')

  return useMemo(() => {
    const asset = assets.find((each) => each['id'] === assetId)
    const allowed = boardBuildingsOf(asset, supplies, rooms)
    const nameOf = (id: string) => {
      const building = buildings.find((each) => each['id'] === id)

      return building ? text(building, 'name') : 'Gebäude'
    }
    const roomsOf = (buildingId: string): readonly Choice[] => [
      { value: '', label: 'Kein Raum angegeben' },
      ...rooms
        .filter((room) => room['buildingId'] === buildingId && !room['deletedAt'])
        .sort(byNumber)
        .map((room) => ({ value: String(room['id']), label: titleOfRoom(room) })),
    ]

    return {
      /** The building of the asset, where a new board stands unless another is chosen. */
      own: allowed[0] ?? null,
      buildings: allowed.map((id) => ({ value: id, label: nameOf(id) })) as readonly Choice[],
      roomsOf,
      /** Where a board stands, in words: the building and the room, the room only where it is known. */
      standsIn: (board: RecordState): string => {
        const room = rooms.find((each) => each['id'] === board['roomId'])
        const building = nameOf(String(board['buildingId']))

        return room ? `${building}, ${titleOfRoom(room)}` : building
      },
      nameOf,
    }
  }, [assets, supplies, buildings, rooms, assetId])
}

/** The two fields of the place of a board, in the form of a board. */
export function boardPlaceFields(places: ReturnType<typeof useBoardPlaces>): readonly FormField[] {
  return [
    {
      name: 'buildingId',
      label: 'Gebäude',
      required: true,
      options: [...places.buildings].sort((left, right) =>
        left.value === places.own
          ? -1
          : right.value === places.own
            ? 1
            : byNameIn(left.label, right.label),
      ),
      hint: 'Wo die Anlage steht oder ein Gebäude, das sie versorgt.',
    },
    {
      name: 'roomId',
      label: 'Raum',
      optionsFor: (values) => places.roomsOf(values['buildingId'] ?? places.own ?? ''),
    },
  ]
}

/** The place of a board as the form holds it, for a board there is or a new one in a building and room. */
export function boardPlaceValues(
  board: RecordState | null | undefined,
  building: string | null,
  room: string | null = null,
): { readonly buildingId: string; readonly roomId: string } {
  if (board) {
    return {
      buildingId: String(board['buildingId']),
      roomId: typeof board['roomId'] === 'string' ? board['roomId'] : '',
    }
  }

  return { buildingId: building ?? '', roomId: room ?? '' }
}

/** The place of a board as it is written. */
export function asBoardPlace(values: Readonly<Record<string, string>>): Draft {
  return {
    buildingId: values['buildingId'] ?? null,
    roomId: values['roomId'] ? values['roomId'] : null,
  }
}
