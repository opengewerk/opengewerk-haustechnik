import { defectLimits, defectStatuses, defectTermLimits } from '@opengewerk/haustechnik-domain'
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
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { activities, workOrders } from './activities.js'
import { activityAnswers } from './answers.js'
import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { evidence } from './evidence.js'
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
 * Its class is a key of a package, `<package>.<key>`, which the routes hold
 * against the classes it may take (`defectClassChoices` in `domain`); a
 * reported defect has none until whoever keeps defects gives it one. A defect
 * named in the report of a contractor names that evidence (#110), and one
 * that was checked again the day and what was found (#116).
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
    foundInEvidenceId: reference<'evidence'>('found_in_evidence_id'),
    foundInAnswerId: reference<'activity-answer'>('found_in_answer_id'),
    remedyWorkOrderId: reference<'work-order'>('remedy_work_order_id'),
    description: text('description').notNull(),
    defectClass: text('defect_class'),
    foundOn: date('found_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    status: defectStatus('status').notNull().default('found'),
    checkedOn: date('checked_on', { mode: 'string' }),
    checkNote: text('check_note'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('defects_tenant_id_key').on(table.tenantId, table.id),
    // What a document or a deadline of a defect points at, on its property.
    unique('defects_place').on(table.tenantId, table.id, table.propertyId),
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
      columns: [table.tenantId, table.foundInEvidenceId, table.propertyId],
      foreignColumns: [evidence.tenantId, evidence.id, evidence.propertyId],
      name: 'defects_named_in_an_evidence_of_their_property',
    }),
    // A defect that came of an answer names it, in the activity it was
    // noticed in (#106); once per answer among the defects that are not marked.
    foreignKey({
      columns: [table.tenantId, table.foundInAnswerId, table.propertyId, table.foundInActivityId],
      foreignColumns: [
        activityAnswers.tenantId,
        activityAnswers.id,
        activityAnswers.propertyId,
        activityAnswers.activityId,
      ],
      name: 'defects_from_an_answer_of_their_activity',
    }),
    check(
      'defects_answer_in_their_activity',
      sql`${table.foundInAnswerId} is null or ${table.foundInActivityId} is not null`,
    ),
    uniqueIndex('defects_once_per_answer')
      .on(table.tenantId, table.foundInAnswerId)
      .where(sql`${table.foundInAnswerId} is not null and ${table.deletedAt} is null`),
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
    check('defects_check_note_shaped', optionalTrimmed(table.checkNote, defectLimits.checkNote)),
    // Checked again on the day it was found or later, and never checked
    // again without the day it was.
    check(
      'defects_checked_after_found',
      sql`${table.checkedOn} is null or ${table.checkedOn} >= ${table.foundOn}`,
    ),
    check(
      'defects_verified_on_a_day',
      sql`${table.status} <> 'verified' or ${table.checkedOn} is not null`,
    ),
  ],
)

/**
 * The default of a class of defects (section 4.6 of the concept, #116): the
 * days to set a defect of the class right in, counted from the day it was
 * found, which the operator sets under "Einstellungen". One row per class
 * that has one; a class without a row has none. The class is a key of a
 * package, which the route holds against the catalogue.
 */
export const defectClassTerms = pgTable(
  'defect_class_terms',
  {
    id: primaryId<'defect-class-term'>(),
    ...tenantColumn,
    defectClass: text('defect_class').notNull(),
    dueDays: integer('due_days').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('defect_class_terms_tenant_id_key').on(table.tenantId, table.id),
    unique('defect_class_terms_once').on(table.tenantId, table.defectClass),
    check('defect_class_terms_class_shaped', trimmed(table.defectClass, defectLimits.defectClass)),
    check(
      'defect_class_terms_days',
      sql`${table.dueDays} between ${sql.raw(String(defectTermLimits.least))} and ${sql.raw(String(defectTermLimits.most))}`,
    ),
  ],
)
