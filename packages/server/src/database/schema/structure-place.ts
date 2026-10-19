import { reference } from '@opengewerk/platform-server'
import { foreignKey, index, type PgColumn } from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { kindOfItsAsset, withinLimits } from './limit-policies.js'

// What every table of a structure below an asset holds about its place, the
// electrical one (#349) and the PV one (#461) alike: the asset the structure
// hangs on, its property and its area, kept by the keys onto the asset with
// ON UPDATE CASCADE and the restrictive policies `within_areas` and
// `within_limits` (ADR 0003, #339). Not part of the schema itself, which
// `index.ts` gathers: the tables are made in `electrical.ts` and
// `photovoltaic.ts`.

/** The place of a part of the structure: the asset, its property and its area. */
export function placeColumns() {
  return {
    assetId: reference<'asset'>('asset_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
  }
}

export type PlaceColumns = ReturnType<typeof placeColumns>

/** The columns of a place, as the keys below read them. */
interface Placed {
  readonly tenantId: PgColumn
  readonly assetId: PgColumn
  readonly propertyId: PgColumn
  readonly areaId: PgColumn
}

/** What every table of the structure holds about its place, under names of its own. */
export function placeKeys(name: string, table: Placed) {
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
