import { closureLimits } from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, date, foreignKey, index, pgTable, text } from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { buildings, optionalTrimmed, properties } from './locations.js'

/**
 * The times a building is closed (#86, section 4.1 of the concept): from a
 * day to a day, both of them closed, with what for. While a building is
 * closed no round is made for it (4.5).
 *
 * A closure hangs on its building, on the property of that building, and
 * lies in the area of the property, like every row with a place: the key
 * over the building names the property as well, and the key over the property
 * the area, with ON UPDATE CASCADE (ADR 0002, ADR 0003). The policy
 * `within_areas` lets through the areas of the person asking.
 *
 * The rows travel to a device, to read. Deleting marks a row, and a building
 * that is marked takes its closures along, by a trigger of the migration. None
 * is changed in place: one entered wrongly is removed and entered again.
 */
export const buildingClosures = pgTable(
  'building_closures',
  {
    id: primaryId<'building_closure'>(),
    ...tenantColumn,
    buildingId: reference<'building'>('building_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    reason: text('reason'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'building_closures_of_their_building',
    }),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'building_closures_follow_their_property',
    }).onUpdate('cascade'),
    index('building_closures_building_idx').on(table.tenantId, table.buildingId),
    // What `closureProblems` asks: it does not end before it begins.
    check('building_closures_in_order', sql`${table.startsOn} <= ${table.endsOn}`),
    check('building_closures_reason_shaped', optionalTrimmed(table.reason, closureLimits.reason)),
  ],
)
