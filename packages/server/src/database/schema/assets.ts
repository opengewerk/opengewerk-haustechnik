import {
  assetLimits,
  type AssetValue,
  lifecycleStates,
  meterUnits,
} from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { buildings, properties, rooms, trimmed } from './locations.js'

// The technology, the other half of the data model (section 2.2 of the
// concept, ADR 0002, points 4 to 9): an asset in exactly one building and on
// request a room, the components under it in the same table, its life cycle
// as a list of entries, and the rooms and buildings it supplies. Every row
// carries the property and the area of the place it belongs to, kept by the
// key over `(tenant_id, property_id, area_id)` with ON UPDATE CASCADE, and the
// policy `within_areas` (ADR 0003). The rows carry the columns of the sync;
// which device holds which comes with the rules of the sync (#27).

/** The states of a life cycle, from the list in `domain`. */
export const lifecycleState = pgEnum('lifecycle_state', lifecycleStates)

/** What a meter counts in, from the list in `domain`. */
export const meterUnit = pgEnum('meter_unit', meterUnits)

/** A text the row may leave empty, trimmed and bounded when it is there. */
function optionalTrimmed(column: unknown, most: number) {
  return sql`${column} is null or (${trimmed(column, most)})`
}

/**
 * An asset, or a component when it hangs under an asset. Its kind is a key of
 * the catalogue, `<package>.<key>` (ADR 0005, point 2); that the catalogue
 * knows it is asked by whoever writes the row, because the catalogue is no
 * table. The values of the characteristics and fields of the kind stand in one
 * JSON column (ADR 0002, point 6): a package gets no column. The number is
 * drawn by the server and never handed out again; an asset made on a device
 * without a connection gets it when it arrives (ADR 0002, point 8).
 */
export const assets = pgTable(
  'assets',
  {
    id: primaryId<'asset'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    buildingId: reference<'building'>('building_id').notNull(),
    roomId: reference<'room'>('room_id'),
    parentAssetId: reference<'asset'>('parent_asset_id'),
    kind: text('kind').notNull(),
    number: text('number'),
    name: text('name').notNull(),
    mark: text('mark'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    yearBuilt: integer('year_built'),
    commissionedOn: date('commissioned_on', { mode: 'string' }),
    warrantyEndsOn: date('warranty_ends_on', { mode: 'string' }),
    values: jsonb('values')
      .$type<Readonly<Record<string, AssetValue>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    meterNumber: text('meter_number'),
    meterUnit: meterUnit('meter_unit'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('assets_tenant_id_key').on(table.tenantId, table.id),
    // What an entry of the life cycle and a supply point at.
    unique('assets_place').on(table.tenantId, table.id, table.propertyId),
    // What a component points at: its asset in the building they share.
    unique('assets_in_their_building').on(
      table.tenantId,
      table.id,
      table.buildingId,
      table.propertyId,
    ),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'assets_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'assets_in_a_building_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.buildingId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.buildingId, rooms.propertyId],
      name: 'assets_in_a_room_of_their_building',
    }),
    // A component stands in the building of its asset, and moves with it:
    // when the asset moves to another building, the cascade takes every
    // component along, at any depth.
    foreignKey({
      columns: [table.tenantId, table.parentAssetId, table.buildingId, table.propertyId],
      foreignColumns: [table.tenantId, table.id, table.buildingId, table.propertyId],
      name: 'components_in_the_building_of_their_asset',
    }).onUpdate('cascade'),
    index('assets_building_idx').on(table.tenantId, table.buildingId),
    index('assets_parent_idx').on(table.tenantId, table.parentAssetId),
    uniqueIndex('assets_number_once')
      .on(table.tenantId, table.number)
      .where(sql`${table.number} is not null`),
    check('assets_kind_shaped', trimmed(table.kind, assetLimits.kind)),
    check('assets_name_shaped', trimmed(table.name, assetLimits.name)),
    check('assets_number_shaped', optionalTrimmed(table.number, 40)),
    check('assets_mark_shaped', optionalTrimmed(table.mark, assetLimits.mark)),
    check(
      'assets_manufacturer_shaped',
      optionalTrimmed(table.manufacturer, assetLimits.manufacturer),
    ),
    check('assets_model_shaped', optionalTrimmed(table.model, assetLimits.model)),
    check(
      'assets_serial_number_shaped',
      optionalTrimmed(table.serialNumber, assetLimits.serialNumber),
    ),
    check(
      'assets_meter_number_shaped',
      optionalTrimmed(table.meterNumber, assetLimits.meterNumber),
    ),
    check(
      'assets_year_built_shaped',
      sql`${table.yearBuilt} is null or ${table.yearBuilt} between ${sql.raw(String(assetLimits.earliestYearBuilt))} and ${sql.raw(String(assetLimits.latestYearBuilt))}`,
    ),
    check('assets_values_shaped', sql`jsonb_typeof(${table.values}) = 'object'`),
    // A meter has its number and its unit, an asset of another kind neither.
    // Which kind is a meter the catalogue says; the route asks it.
    check('assets_meter_whole', sql`(${table.meterNumber} is null) = (${table.meterUnit} is null)`),
    // Not under itself when the row is made: the trigger that refuses every
    // circle walks up from the parent and cannot see a row that is not there
    // yet, and the key would be content with the row itself.
    check(
      'assets_not_their_own_component',
      sql`${table.parentAssetId} is distinct from ${table.id}`,
    ),
  ],
)

/**
 * The life cycle of an asset: the state it is in from a day on (ADR 0002,
 * point 7). On a day exactly one state applies, so an asset has one entry a
 * day; a marked entry makes room for another on its day.
 */
export const assetLifecycle = pgTable(
  'asset_lifecycle',
  {
    id: primaryId<'lifecycle-entry'>(),
    ...tenantColumn,
    assetId: reference<'asset'>('asset_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    state: lifecycleState('state').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('asset_lifecycle_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'asset_lifecycle_of_an_asset',
    }),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'asset_lifecycle_follows_its_property',
    }).onUpdate('cascade'),
    index('asset_lifecycle_asset_idx').on(table.tenantId, table.assetId),
    uniqueIndex('asset_lifecycle_one_state_a_day')
      .on(table.tenantId, table.assetId, table.validFrom)
      .where(sql`${table.deletedAt} is null`),
  ],
)

/**
 * A building or a room an asset supplies without standing there (ADR 0002,
 * point 4), on the property of the asset.
 */
export const assetSupplies = pgTable(
  'asset_supplies',
  {
    id: primaryId<'asset-supply'>(),
    ...tenantColumn,
    assetId: reference<'asset'>('asset_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    buildingId: reference<'building'>('building_id'),
    roomId: reference<'room'>('room_id'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('asset_supplies_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'asset_supplies_of_an_asset',
    }),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'asset_supplies_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'asset_supplies_to_a_building_of_its_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'asset_supplies_to_a_room_of_its_property',
    }),
    index('asset_supplies_asset_idx').on(table.tenantId, table.assetId),
    uniqueIndex('asset_supplies_building_once')
      .on(table.tenantId, table.assetId, table.buildingId)
      .where(sql`${table.buildingId} is not null and ${table.deletedAt} is null`),
    uniqueIndex('asset_supplies_room_once')
      .on(table.tenantId, table.assetId, table.roomId)
      .where(sql`${table.roomId} is not null and ${table.deletedAt} is null`),
    // A building or a room, never both and never neither.
    check(
      'asset_supplies_one_place',
      sql`(${table.buildingId} is null) <> (${table.roomId} is null)`,
    ),
  ],
)
