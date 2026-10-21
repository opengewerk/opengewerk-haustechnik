import { type ElectricalTables, electricalSchema, reference } from '@opengewerk/platform-server'
import { foreignKey, index, unique } from 'drizzle-orm/pg-core'

import { buildings, rooms } from './locations.js'
import { placeColumns, type PlaceColumns, placeKeys } from './structure-place.js'

// The electrical structure below a low-voltage installation (#349, section
// 4.2 of the concept): board, section, circuit, equipment. The tables are the
// foundation's (`electricalSchema`, ADR 0014 in the repository opengewerk),
// under the names they have in the trades application. What this application
// gives every one of them is the place of a record: the asset the structure
// hangs on, its property and its area, kept by the keys onto the asset with
// ON UPDATE CASCADE and the restrictive policies `within_areas` and
// `within_limits` (ADR 0003, #339), as for the periods a measuring point
// rests. A board hangs on the asset; every part below it carries the same
// asset, which the keys onto its parent hold, so that the policies of a place
// work on each row without a walk up the structure.
//
// That the asset is a low-voltage installation (decision 31 of phase 2, "Unter
// der Niederspannungsanlage wie in OpenGewerk") is held by a trigger of the
// migration, since no key can say it, and asked by the sync before.
//
// A board stands in a building, and in a room where that is known (#495): the
// main board stands where the installation stands, a sub-board in every
// building the installation supplies. The building is the one of the asset or
// one the asset supplies, by itself or through a room in it, which a trigger
// of migration 0100 holds and the sync asks before. Its area stays the one of
// the asset: a test of the installation measures every circuit, and the
// evidence and its defects belong to the asset.

/** What a board holds about its place beside the asset: the building and the room it stands in. */
function boardPlaceColumns() {
  return {
    ...placeColumns(),
    buildingId: reference<'building'>('building_id').notNull(),
    roomId: reference<'room'>('room_id'),
  }
}

type BoardPlaceColumns = ReturnType<typeof boardPlaceColumns>

/**
 * The four tables, named with their type: the keys of a section, a circuit
 * and a piece of equipment point at the table above them, which this value
 * holds. Drizzle asks for those keys only once every table is made.
 */
const structure: ElectricalTables<BoardPlaceColumns, PlaceColumns, PlaceColumns, PlaceColumns> =
  electricalSchema<BoardPlaceColumns, PlaceColumns, PlaceColumns, PlaceColumns>({
    boards: {
      columns: boardPlaceColumns(),
      constraints: (table) => [
        ...placeKeys('distribution_boards', table),
        // The building and the room on the property of the asset (#495).
        foreignKey({
          columns: [table.tenantId, table.buildingId, table.propertyId],
          foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
          name: 'distribution_boards_in_a_building_of_their_property',
        }),
        foreignKey({
          columns: [table.tenantId, table.roomId, table.buildingId, table.propertyId],
          foreignColumns: [rooms.tenantId, rooms.id, rooms.buildingId, rooms.propertyId],
          name: 'distribution_boards_in_a_room_of_their_building',
        }),
        index('distribution_boards_building_idx').on(table.tenantId, table.buildingId),
        // What a section and a circuit point at, so that they stay on the
        // asset of their board.
        unique('distribution_boards_of_their_asset').on(table.tenantId, table.id, table.assetId),
      ],
    },
    sections: {
      columns: placeColumns(),
      constraints: (table) => [
        ...placeKeys('board_sections', table),
        foreignKey({
          columns: [table.tenantId, table.distributionBoardId, table.assetId],
          foreignColumns: [
            structure.distributionBoards.tenantId,
            structure.distributionBoards.id,
            structure.distributionBoards.assetId,
          ],
          name: 'board_sections_on_a_board_of_their_asset',
        }),
      ],
    },
    circuits: {
      columns: placeColumns(),
      constraints: (table) => [
        ...placeKeys('circuits', table),
        foreignKey({
          columns: [table.tenantId, table.distributionBoardId, table.assetId],
          foreignColumns: [
            structure.distributionBoards.tenantId,
            structure.distributionBoards.id,
            structure.distributionBoards.assetId,
          ],
          name: 'circuits_on_a_board_of_their_asset',
        }),
        // What a piece of equipment points at, so that it stays on the asset
        // of its circuit.
        unique('circuits_of_their_asset').on(table.tenantId, table.id, table.assetId),
      ],
    },
    equipment: {
      columns: placeColumns(),
      constraints: (table) => [
        ...placeKeys('equipment', table),
        foreignKey({
          columns: [table.tenantId, table.circuitId, table.assetId],
          foreignColumns: [
            structure.circuits.tenantId,
            structure.circuits.id,
            structure.circuits.assetId,
          ],
          name: 'equipment_on_a_circuit_of_their_asset',
        }),
      ],
    },
  })

export const {
  distributionBoardKind,
  overcurrentDevice,
  tripCharacteristic,
  rcdType,
  cableInstallationMethod,
  distributionBoards,
  boardSections,
  circuits,
  equipment,
} = structure
