import {
  type BuildingKind,
  buildingKinds,
  federalStates,
  locationLimits,
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
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { areas, withinAreas } from './areas.js'

// The place, the one half of the data model (section 2.2 of the concept,
// ADR 0002): a property, its buildings, their floors and the rooms on a
// floor. Every level carries the ids of the levels above it, and composite
// keys hold them together, so that a room can only stand on a floor of its own
// building, and a building only on its own property. The area of a row is the
// area of its property, kept by the key over `(tenant_id, property_id,
// area_id)` with ON UPDATE CASCADE, and the policy `within_areas` lets through
// the areas of the person asking (ADR 0003).
//
// The rows travel to a device, so they carry the columns of the sync; which
// device holds which comes with the rules of the sync (#27). Deleting marks a
// row, and what hangs below it is marked with it by a trigger.

/** The federal state of a property, one of the sixteen, written as ISO 3166-2 (`DE-BW`). */
export const federalState = pgEnum('federal_state', federalStates)

/** What a building is used for, from the list in `domain`. */
export const buildingKind = pgEnum('building_kind', buildingKinds)

/** A trimmed text of one character up to the bound. */
export function trimmed(column: unknown, most: number) {
  return sql`${column} = btrim(${column}) and char_length(${column}) between 1 and ${sql.raw(String(most))}`
}

/** A text the row may leave empty, trimmed and bounded when it is there. */
export function optionalTrimmed(column: unknown, most: number) {
  return sql`${column} is null or (${trimmed(column, most)})`
}

/**
 * A property: a site or a campus with an address and a federal state. The
 * state decides with the kinds of its buildings which duties are proposed.
 */
export const properties = pgTable(
  'properties',
  {
    id: primaryId<'property'>(),
    ...tenantColumn,
    areaId: reference<'area'>('area_id').notNull(),
    name: text('name').notNull(),
    street: text('street').notNull(),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    federalState: federalState('federal_state').notNull(),
    note: text('note'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('properties_tenant_id_key').on(table.tenantId, table.id),
    // What every row with a place points at: the property and its area
    // together, so that the area of the row follows the property.
    unique('properties_place').on(table.tenantId, table.id, table.areaId),
    foreignKey({
      columns: [table.tenantId, table.areaId],
      foreignColumns: [areas.tenantId, areas.id],
      name: 'properties_in_an_area_of_the_tenant',
    }),
    check('properties_name_shaped', trimmed(table.name, locationLimits.name)),
    check('properties_street_shaped', trimmed(table.street, locationLimits.street)),
    check('properties_city_shaped', trimmed(table.city, locationLimits.city)),
    check('properties_postal_code_shaped', sql`${table.postalCode} ~ '^[0-9]{5}$'`),
    check('properties_note_shaped', optionalTrimmed(table.note, locationLimits.propertyNote)),
  ],
)

/**
 * A building on a property, with its kinds, which decide with the federal
 * state which duties are proposed. An outdoor facility is a building of the
 * kind `outdoor` (ADR 0002, point 1).
 */
export const buildings = pgTable(
  'buildings',
  {
    id: primaryId<'building'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    name: text('name').notNull(),
    shortCode: text('short_code'),
    kinds: buildingKind('kinds').array().notNull().$type<readonly BuildingKind[]>(),
    yearBuilt: integer('year_built'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('buildings_tenant_id_key').on(table.tenantId, table.id),
    // What a floor and a room point at: the building on its property.
    unique('buildings_place').on(table.tenantId, table.id, table.propertyId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'buildings_follow_their_property',
    }).onUpdate('cascade'),
    index('buildings_property_idx').on(table.tenantId, table.propertyId),
    check('buildings_name_shaped', trimmed(table.name, locationLimits.name)),
    check(
      'buildings_short_code_shaped',
      sql`${table.shortCode} is null or (${trimmed(table.shortCode, locationLimits.shortCode)})`,
    ),
    // One kind or several, each once. A check may not ask a sub-select, so
    // the counting is in a function of the migration, `each_once`.
    check(
      'buildings_kinds_shaped',
      sql`cardinality(${table.kinds}) >= 1 and each_once(${table.kinds})`,
    ),
    check(
      'buildings_year_built_shaped',
      sql`${table.yearBuilt} is null or ${table.yearBuilt} between ${sql.raw(String(locationLimits.earliestYearBuilt))} and ${sql.raw(String(locationLimits.latestYearBuilt))}`,
    ),
  ],
)

/**
 * A floor of a building. The level orders the floors: nought is the ground
 * floor, the basements are below it.
 */
export const floors = pgTable(
  'floors',
  {
    id: primaryId<'floor'>(),
    ...tenantColumn,
    buildingId: reference<'building'>('building_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    name: text('name').notNull(),
    level: integer('level').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('floors_tenant_id_key').on(table.tenantId, table.id),
    // What a room points at: the floor in its building on its property.
    unique('floors_place').on(table.tenantId, table.id, table.buildingId, table.propertyId),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'floors_in_their_building',
    }),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'floors_follow_their_property',
    }).onUpdate('cascade'),
    index('floors_building_idx').on(table.tenantId, table.buildingId),
    check('floors_name_shaped', trimmed(table.name, locationLimits.floorName)),
    check(
      'floors_level_shaped',
      sql`${table.level} between ${sql.raw(String(locationLimits.lowestLevel))} and ${sql.raw(String(locationLimits.highestLevel))}`,
    ),
  ],
)

/**
 * A room on a floor, with a number or a name or both, and what it is used
 * for. A room always belongs to a floor (ADR 0002, point 3), and only to a
 * floor of its own building: the key over the floor names the building and
 * the property as well. That building and property belong together the key
 * of the floor holds, so a key of the room on its building would be a second
 * key that can never be the one to refuse.
 */
export const rooms = pgTable(
  'rooms',
  {
    id: primaryId<'room'>(),
    ...tenantColumn,
    floorId: reference<'floor'>('floor_id').notNull(),
    buildingId: reference<'building'>('building_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    number: text('number'),
    name: text('name'),
    use: text('use'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('rooms_tenant_id_key').on(table.tenantId, table.id),
    unique('rooms_place').on(table.tenantId, table.id, table.propertyId),
    // What an asset points at: the room in its building, so that an asset can
    // only name a room of the building it stands in (#20).
    unique('rooms_in_their_building').on(
      table.tenantId,
      table.id,
      table.buildingId,
      table.propertyId,
    ),
    foreignKey({
      columns: [table.tenantId, table.floorId, table.buildingId, table.propertyId],
      foreignColumns: [floors.tenantId, floors.id, floors.buildingId, floors.propertyId],
      name: 'rooms_on_a_floor_of_their_building',
    }),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'rooms_follow_their_property',
    }).onUpdate('cascade'),
    index('rooms_floor_idx').on(table.tenantId, table.floorId),
    check(
      'rooms_number_shaped',
      sql`${table.number} is null or (${trimmed(table.number, locationLimits.roomNumber)})`,
    ),
    check(
      'rooms_name_shaped',
      sql`${table.name} is null or (${trimmed(table.name, locationLimits.name)})`,
    ),
    check(
      'rooms_use_shaped',
      sql`${table.use} is null or (${trimmed(table.use, locationLimits.roomUse)})`,
    ),
    // What `roomProblems` asks: a number or a name, or both.
    check('rooms_named', sql`${table.number} is not null or ${table.name} is not null`),
  ],
)
