import { taskLimits, taskStatuses } from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, date, foreignKey, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { areaFromPropertyColumn, areaFromTheProperty, withinAreas } from './areas.js'
import { assets } from './assets.js'
import { buildings, properties, rooms, trimmed } from './locations.js'
import { kindOfItsAssetOrActivity, withinLimits } from './limit-policies.js'

/** Open or done, the two states of the foundation (`taskStatuses`). */
export const taskStatus = pgEnum('task_status', taskStatuses)

/**
 * Something one person has to do by a day (#124, section 3 of the concept),
 * with the columns of the task of the foundation (`TaskBase`) under their
 * names and what it hangs on here.
 *
 * A task hangs on its property always and on at most one record there, which
 * the check says; every such key runs over the tenant and the property, so
 * that a task cannot hang on a record of another property or of another area
 * (ADR 0003). Its area follows its property by the key with ON UPDATE
 * CASCADE, and the restrictive policy `within_areas` keeps it in the areas of
 * the person asking: a task at an asset is seen by whoever sees the asset.
 *
 * The person it is for is held to the operator: the key runs through the
 * membership, tenant and user together, so a task cannot go to somebody of
 * another operator. That the person is not shut out, may do tasks and sees
 * the area is asked by the sync, where a refusal is a conflict about one task
 * and not the whole transmission. `created_by` is the server's, written by a
 * trigger from the person of the transaction, and null for a task no person
 * wrote, which is the way in for the deadline engine; like `updated_by` it
 * carries no key.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: primaryId<'task'>(),
    ...tenantColumn,
    title: text('title').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    assigneeUserId: text('assignee_user_id').notNull(),
    status: taskStatus('status').notNull().default('open'),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    areaFromPropertyId: areaFromPropertyColumn(),
    buildingId: reference<'building'>('building_id'),
    roomId: reference<'room'>('room_id'),
    assetId: reference<'asset'>('asset_id'),
    activityId: reference<'activity'>('activity_id'),
    createdBy: text('created_by'),
    // The day it was done (#412): the database's to write, from its status,
    // for the year after which it goes.
    doneOn: date('done_on', { mode: 'string' }),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsAssetOrActivity(table.assetId, table.activityId)),
    unique('tasks_tenant_id_key').on(table.tenantId, table.id),
    // For the key of a deadline that names the task made of it (#242).
    unique('tasks_place').on(table.tenantId, table.id, table.propertyId),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.areaId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.areaId],
      name: 'tasks_follow_their_building',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.areaId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.areaId],
      name: 'tasks_follow_their_room',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: 'tasks_follow_their_asset',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'tasks_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.areaFromPropertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'tasks_follow_their_property',
    }).onUpdate('cascade'),
    areaFromTheProperty('tasks_area_from_the_property', table, [
      table.buildingId,
      table.roomId,
      table.assetId,
      table.activityId,
    ]),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'tasks_at_a_building_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'tasks_at_a_room_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'tasks_at_an_asset_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'tasks_at_an_activity_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assigneeUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'tasks_assignee_works_here',
    }).onDelete('restrict'),
    index('tasks_assignee_idx').on(table.tenantId, table.assigneeUserId, table.status),
    index('tasks_property_idx').on(table.tenantId, table.propertyId),
    index('tasks_asset_idx').on(table.tenantId, table.assetId),
    index('tasks_activity_idx').on(table.tenantId, table.activityId),
    // What `taskTargetProblem` asks: the property, or one record on it.
    check(
      'tasks_hang_on_one_record',
      sql`num_nonnulls(${table.buildingId}, ${table.roomId}, ${table.assetId}, ${table.activityId}) <= 1`,
    ),
    // What `taskTitleProblem` asks of the text, held here for every other way in.
    check('tasks_title_shaped', trimmed(table.title, taskLimits.title)),
  ],
)
