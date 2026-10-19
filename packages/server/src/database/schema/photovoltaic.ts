import { type PhotovoltaicTables, photovoltaicSchema } from '@opengewerk/platform-server'
import { foreignKey, text, unique } from 'drizzle-orm/pg-core'

import { placeColumns, type PlaceColumns, placeKeys } from './structure-place.js'

// The PV structure below a PV installation (#461, section 4.2 of the
// concept): inverter, string, module. The tables are the foundation's
// (`photovoltaicSchema`, ADR 0014 in the repository opengewerk), under the
// names they have in the trades application, made the way the electrical
// structure beside them is (`electrical.ts`): every part carries the place of
// its asset, an inverter hangs on the asset, and a string and a module carry
// the asset of the part above them, which the keys onto that part hold. An
// inverter says where it hangs as well, a column of this application's own.
//
// That the asset is a PV installation is held by a trigger of the migration,
// since no key can say it, and asked by the sync before.

/** The place of an inverter, and where it hangs in the building. */
function inverterColumns() {
  return { ...placeColumns(), location: text('location') }
}

type InverterColumns = ReturnType<typeof inverterColumns>

/**
 * The three tables, named with their type: the keys of a string and a module
 * point at the table above them, which this value holds. Drizzle asks for
 * those keys only once every table is made.
 */
const structure: PhotovoltaicTables<InverterColumns, PlaceColumns, PlaceColumns> =
  photovoltaicSchema<InverterColumns, PlaceColumns, PlaceColumns>({
    inverters: {
      columns: inverterColumns(),
      constraints: (table) => [
        ...placeKeys('inverters', table),
        // What a string points at, so that it stays on the asset of its inverter.
        unique('inverters_of_their_asset').on(table.tenantId, table.id, table.assetId),
      ],
    },
    strings: {
      columns: placeColumns(),
      constraints: (table) => [
        ...placeKeys('pv_strings', table),
        foreignKey({
          columns: [table.tenantId, table.inverterId, table.assetId],
          foreignColumns: [
            structure.inverters.tenantId,
            structure.inverters.id,
            structure.inverters.assetId,
          ],
          name: 'pv_strings_on_an_inverter_of_their_asset',
        }),
        // What a module points at, so that it stays on the asset of its string.
        unique('pv_strings_of_their_asset').on(table.tenantId, table.id, table.assetId),
      ],
    },
    modules: {
      columns: placeColumns(),
      constraints: (table) => [
        ...placeKeys('pv_modules', table),
        foreignKey({
          columns: [table.tenantId, table.pvStringId, table.assetId],
          foreignColumns: [
            structure.pvStrings.tenantId,
            structure.pvStrings.id,
            structure.pvStrings.assetId,
          ],
          name: 'pv_modules_on_a_string_of_their_asset',
        }),
      ],
    },
  })

export const { inverters, pvStrings, pvModules } = structure
