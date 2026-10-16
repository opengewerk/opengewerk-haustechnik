import { faultReportLimits } from '@opengewerk/haustechnik-domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { files, memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { workOrders } from './activities.js'
import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { defects } from './defects.js'
import { buildings, rooms, trimmed } from './locations.js'

/**
 * The categories of the fault reports of an operator (section 4.7 of the
 * concept, decided 15.10.2026): a list the first start proposes and whoever
 * changes settings renames, adds to and removes from. It belongs to the
 * operator and lies in no area. A category is marked when it is removed and
 * never deleted: the reports that carry it keep it.
 */
export const faultCategories = pgTable(
  'fault_categories',
  {
    id: primaryId<'fault-category'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    position: integer('position').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('fault_categories_tenant_id_key').on(table.tenantId, table.id),
    check('fault_categories_name_shaped', trimmed(table.name, faultReportLimits.category)),
    check('fault_categories_position', sql`${table.position} >= 0`),
    index('fault_categories_tenant_position_idx').on(table.tenantId, table.position),
  ],
)

/**
 * A fault report (section 4.7 of the concept, #331): in a building always,
 * and at a room or an asset there where the person who reported it chose one,
 * with the area of its building. A room and an asset name the building they
 * are in, over keys that follow a building into another area and a room or
 * an asset that moves (ADR 0003), and the policy `within_areas` keeps it in
 * the areas of whoever reads it.
 *
 * `reported_by` is who reported it, for the own list and for the feedback;
 * no answer of the inbox carries it. Accepting it makes the work order it
 * names in `work_order_id`; `accepted_at` is when, for the time to an
 * acceptance (4.7). Rejecting it keeps the moment and the reason, merging it
 * the report it went into, in the same building. A defect reported from it
 * is named in `defect_id`. The photo is a file of the operator's store,
 * named by its hash.
 */
export const faultReports = pgTable(
  'fault_reports',
  {
    id: primaryId<'fault-report'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    buildingId: reference<'building'>('building_id').notNull(),
    roomId: reference<'room'>('room_id'),
    assetId: reference<'asset'>('asset_id'),
    categoryId: reference<'fault-category'>('category_id').notNull(),
    description: text('description').notNull(),
    photoSha256: text('photo_sha256'),
    reportedBy: text('reported_by').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    workOrderId: reference<'work-order'>('work_order_id'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    mergedIntoId: reference<'fault-report'>('merged_into_id'),
    defectId: reference<'defect'>('defect_id'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('fault_reports_tenant_id_key').on(table.tenantId, table.id),
    // What a report merged into another points at: one in the same building,
    // on the same property.
    unique('fault_reports_in_their_building').on(
      table.tenantId,
      table.id,
      table.propertyId,
      table.buildingId,
    ),
    // The area of what the row hangs on (ADR 0003, addendum of #306): its
    // building always, and its room or its asset, which share its area.
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.areaId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.areaId],
      name: 'fault_reports_follow_their_building',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.areaId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.areaId],
      name: 'fault_reports_follow_their_room',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: 'fault_reports_follow_their_asset',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'fault_reports_in_a_building_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.buildingId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.buildingId, rooms.propertyId],
      name: 'fault_reports_at_a_room_of_their_building',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.buildingId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.buildingId, assets.propertyId],
      name: 'fault_reports_at_an_asset_of_their_building',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [faultCategories.tenantId, faultCategories.id],
      name: 'fault_reports_of_a_category',
    }),
    foreignKey({
      columns: [table.tenantId, table.photoSha256],
      foreignColumns: [files.tenantId, files.sha256],
      name: 'fault_reports_photo_stored',
    }),
    foreignKey({
      columns: [table.tenantId, table.reportedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'fault_reports_reporter_works_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.workOrderId, table.propertyId],
      foreignColumns: [workOrders.tenantId, workOrders.id, workOrders.propertyId],
      name: 'fault_reports_accepted_as_a_work_order_of_their_property',
    }),
    // Without ON UPDATE CASCADE, as every key onto what a row does not hang
    // on: a building moves with both reports in it (#307).
    foreignKey({
      columns: [table.tenantId, table.mergedIntoId, table.propertyId, table.buildingId],
      foreignColumns: [table.tenantId, table.id, table.propertyId, table.buildingId],
      name: 'fault_reports_merged_in_their_building',
    }),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.propertyId],
      foreignColumns: [defects.tenantId, defects.id, defects.propertyId],
      name: 'fault_reports_reported_as_a_defect_of_their_property',
    }),
    check('fault_reports_room_or_asset', sql`${table.roomId} is null or ${table.assetId} is null`),
    check(
      'fault_reports_description_shaped',
      trimmed(table.description, faultReportLimits.description),
    ),
    check(
      'fault_reports_reason_shaped',
      sql`${table.rejectionReason} is null or (${trimmed(table.rejectionReason, faultReportLimits.reason)})`,
    ),
    check(
      'fault_reports_rejected_with_a_reason',
      sql`(${table.rejectedAt} is null) = (${table.rejectionReason} is null)`,
    ),
    check(
      'fault_reports_accepted_with_an_order',
      sql`(${table.workOrderId} is null) = (${table.acceptedAt} is null)`,
    ),
    check(
      'fault_reports_not_into_itself',
      sql`${table.mergedIntoId} is null or ${table.mergedIntoId} <> ${table.id}`,
    ),
    // One way on: accepted, rejected or merged, never two of them.
    check(
      'fault_reports_one_way_on',
      sql`num_nonnulls(${table.workOrderId}, ${table.rejectedAt}, ${table.mergedIntoId}) <= 1`,
    ),
    check(
      'fault_reports_photo_is_a_hash',
      sql`${table.photoSha256} is null or ${table.photoSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    index('fault_reports_received_idx').on(table.tenantId, table.receivedAt),
    index('fault_reports_building_idx').on(table.tenantId, table.buildingId),
    index('fault_reports_reporter_idx').on(table.tenantId, table.reportedBy),
    index('fault_reports_work_order_idx').on(table.tenantId, table.workOrderId),
    index('fault_reports_merged_into_idx').on(table.tenantId, table.mergedIntoId),
  ],
)
