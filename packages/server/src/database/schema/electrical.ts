import { type ElectricalTables, electricalSchema, reference } from '@opengewerk/platform-server'
import { foreignKey, index, type PgColumn, unique } from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { kindOfItsAsset, withinLimits } from './limit-policies.js'

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

/** The place of a part of the structure: the asset, its property and its area. */
function placeColumns() {
  return {
    assetId: reference<'asset'>('asset_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
  }
}

type PlaceColumns = ReturnType<typeof placeColumns>

/** The columns of a place, as the keys below read them. */
interface Placed {
  readonly tenantId: PgColumn
  readonly assetId: PgColumn
  readonly propertyId: PgColumn
  readonly areaId: PgColumn
}

/** What every table of the structure holds about its place, under names of its own. */
function placeKeys(name: string, table: Placed) {
  return [
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsAsset(table.assetId)),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.assetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: `${name}_follow_their_asset`,
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: `${name}_of_an_asset_of_their_property`,
    }).onUpdate('cascade'),
    index(`${name}_asset_idx`).on(table.tenantId, table.assetId),
  ]
}

/**
 * The four tables, named with their type: the keys of a section, a circuit
 * and a piece of equipment point at the table above them, which this value
 * holds. Drizzle asks for those keys only once every table is made.
 */
const structure: ElectricalTables<PlaceColumns, PlaceColumns, PlaceColumns, PlaceColumns> =
  electricalSchema<PlaceColumns, PlaceColumns, PlaceColumns, PlaceColumns>({
    boards: {
      columns: placeColumns(),
      constraints: (table) => [
        ...placeKeys('distribution_boards', table),
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
