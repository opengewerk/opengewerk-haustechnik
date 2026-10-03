import { defectLimits, defectStatuses } from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, date, foreignKey, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { activities, workOrders } from './activities.js'
import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { buildings, optionalTrimmed, properties, rooms, trimmed } from './locations.js'

/** The status of a defect, from the list in `domain`. */
export const defectStatus = pgEnum('defect_status', defectStatuses)

/**
 * A defect (section 4.6 of the concept, ADR 0002, point 15): at an asset or a
 * place, with the activity it was noticed in if there was one and the work
 * order that sets it right once there is one, both on its property. The place
 * is the property always and at most one of a building, a room or an asset
 * there, as for a duty, with the property and the area kept by the key over
 * `(tenant_id, property_id, area_id)` with ON UPDATE CASCADE and the policy
 * `within_areas` (ADR 0003).
 *
 * Its class is a key that no package names yet (opengewerk-haustechnik#59), so
 * nothing holds it against the catalogue, and a defect may have none until
 * one does.
 */
export const defects = pgTable(
  'defects',
  {
    id: primaryId<'defect'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    buildingId: reference<'building'>('building_id'),
    roomId: reference<'room'>('room_id'),
    assetId: reference<'asset'>('asset_id'),
    foundInActivityId: reference<'activity'>('found_in_activity_id'),
    remedyWorkOrderId: reference<'work-order'>('remedy_work_order_id'),
    description: text('description').notNull(),
    defectClass: text('defect_class'),
    foundOn: date('found_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    status: defectStatus('status').notNull().default('found'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('defects_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'defects_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'defects_at_a_building_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'defects_at_a_room_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'defects_at_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.foundInActivityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'defects_found_in_an_activity_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.remedyWorkOrderId, table.propertyId],
      foreignColumns: [workOrders.tenantId, workOrders.id, workOrders.propertyId],
      name: 'defects_set_right_by_a_work_order_of_their_property',
    }),
    index('defects_property_idx').on(table.tenantId, table.propertyId),
    index('defects_asset_idx').on(table.tenantId, table.assetId),
    // At most one of building, room and asset; none is the property itself.
    check(
      'defects_one_target',
      sql`num_nonnulls(${table.buildingId}, ${table.roomId}, ${table.assetId}) <= 1`,
    ),
    check('defects_description_shaped', trimmed(table.description, defectLimits.description)),
    check('defects_class_shaped', optionalTrimmed(table.defectClass, defectLimits.defectClass)),
    // To be set right on the day it was found or later.
    check(
      'defects_due_after_found',
      sql`${table.dueOn} is null or ${table.dueOn} >= ${table.foundOn}`,
    ),
  ],
)
