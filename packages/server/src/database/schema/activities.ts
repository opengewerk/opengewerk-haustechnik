import {
  activityKinds,
  activityLimits,
  activityStatuses,
  workOrderKinds,
  workOrderLimits,
  workOrderUrgencies,
} from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { defects } from './defects.js'
import { duties, dutyPerformer } from './duties.js'
import { evidenceResult } from './evidence-result.js'
import { buildings, optionalTrimmed, properties, rooms, trimmed } from './locations.js'
import { roundPlans } from './round-plans.js'

// The activities of an operator (section 2.2 of the concept, ADR 0002, point
// 13): what is done to meet a due day or to set a fault right, one table for
// rounds, inspections, maintenance and work orders, with what only a work
// order has in a table beside it. Every row carries the property and the area
// of its place, kept by the key over `(tenant_id, property_id, area_id)` with
// ON UPDATE CASCADE, and the policy `within_areas` (ADR 0003). The rows carry
// the columns of the sync; which device holds which, and what a device may
// write, comes with the rules of the sync (#27).

/** The kind of an activity, from the list in `domain`. */
export const activityKind = pgEnum('activity_kind', activityKinds)

/** Where an activity stands, from the list in `domain`. */
export const activityStatus = pgEnum('activity_status', activityStatuses)

/** The kind of a work order, from the list in `domain`. */
export const workOrderKind = pgEnum('work_order_kind', workOrderKinds)

/** How urgent a work order is, from the list in `domain` (#73). */
export const workOrderUrgency = pgEnum('work_order_urgency', workOrderUrgencies)

/**
 * An activity at its place: the property always, and at most one of a
 * building, a room or an asset there, as a duty hangs on its place. Who
 * answers for it and who carries it out work for the operator; a contractor
 * is named in words until contracts come (phase 2). Whether the own people or
 * a contractor perform it is said in `performer`, with the values of a duty
 * (#105): a person carrying it out is one of the own people, a contractor's
 * name belongs to a contractor. Only an activity that was not performed names
 * a reason, and it always does.
 */
export const activities = pgTable(
  'activities',
  {
    id: primaryId<'activity'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    buildingId: reference<'building'>('building_id'),
    roomId: reference<'room'>('room_id'),
    assetId: reference<'asset'>('asset_id'),
    kind: activityKind('kind').notNull(),
    title: text('title').notNull(),
    status: activityStatus('status').notNull().default('open'),
    dueOn: date('due_on', { mode: 'string' }),
    responsibleUserId: text('responsible_user_id'),
    performer: dutyPerformer('performer'),
    performerUserId: text('performer_user_id'),
    contractorNote: text('contractor_note'),
    closingReason: text('closing_reason'),
    performedOn: date('performed_on', { mode: 'string' }),
    countersignatureRequired: boolean('countersignature_required').notNull().default(false),
    // The form it is filled in, and its version (#106): the server's to write.
    formKey: text('form_key'),
    formVersion: integer('form_version'),
    // The day of the protocol it took as its template (#108): the server's to write.
    templateOn: date('template_on', { mode: 'string' }),
    // The plan a round was made by, for its day (#113): the server's to write.
    roundPlanId: reference<'round_plan'>('round_plan_id'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('activities_tenant_id_key').on(table.tenantId, table.id),
    // What the duties of an activity and a defect noticed in it point at, on
    // the property of the activity.
    unique('activities_place').on(table.tenantId, table.id, table.propertyId),
    // What a work order points at: an activity of its kind, on its property.
    unique('activities_kind_place').on(table.tenantId, table.id, table.propertyId, table.kind),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'activities_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'activities_at_a_building_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'activities_at_a_room_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'activities_at_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.responsibleUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'activities_responsible_works_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.performerUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'activities_performer_works_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.roundPlanId, table.propertyId],
      foreignColumns: [roundPlans.tenantId, roundPlans.id, roundPlans.propertyId],
      name: 'activities_of_a_plan_of_their_property',
    }),
    index('activities_property_idx').on(table.tenantId, table.propertyId),
    index('activities_asset_idx').on(table.tenantId, table.assetId),
    // One round for each pass of a plan (section 4.5): two runs of the
    // deadline engine, or the engine and the office at the same moment, make
    // it once. A round that was removed makes room for a new one.
    uniqueIndex('activities_once_per_pass')
      .on(table.tenantId, table.roundPlanId, table.dueOn)
      .where(sql`${table.roundPlanId} is not null and ${table.deletedAt} is null`),
    // At most one of building, room and asset; none is the property itself.
    check(
      'activities_one_target',
      sql`num_nonnulls(${table.buildingId}, ${table.roomId}, ${table.assetId}) <= 1`,
    ),
    check('activities_title_shaped', trimmed(table.title, activityLimits.title)),
    check(
      'activities_contractor_note_shaped',
      optionalTrimmed(table.contractorNote, activityLimits.contractorNote),
    ),
    check(
      'activities_closing_reason_shaped',
      optionalTrimmed(table.closingReason, activityLimits.closingReason),
    ),
    // A person carries it out for the own people, a name stands for a contractor.
    check(
      'activities_performed_by_own_staff',
      sql`${table.performerUserId} is null or ${table.performer} = 'own_staff'`,
    ),
    check(
      'activities_contractor_named_for_a_contractor',
      sql`${table.contractorNote} is null or ${table.performer} = 'contractor'`,
    ),
    // A reason with "not performed", and only then.
    check(
      'activities_closed_with_a_reason',
      sql`(${table.status} = 'not_performed') = (${table.closingReason} is not null)`,
    ),
    // A form with its version, or neither.
    check(
      'activities_form_with_its_version',
      sql`(${table.formKey} is null) = (${table.formVersion} is null)`,
    ),
    check(
      'activities_form_shaped',
      sql`${table.formKey} is null or (${table.formKey} ~ '^[a-z][a-z0-9_.-]*$' and char_length(${table.formKey}) <= ${sql.raw(String(activityLimits.formKey))} and ${table.formVersion} >= 1)`,
    ),
    // A plan makes rounds, each for its day.
    check(
      'activities_plan_makes_rounds',
      sql`${table.roundPlanId} is null or (${table.kind} = 'round' and ${table.dueOn} is not null)`,
    ),
    // A work order is accepted by whoever handed it out, and not countersigned.
    check(
      'activities_countersigned_but_no_work_order',
      sql`${table.kind} <> 'work_order' or not ${table.countersignatureRequired}`,
    ),
  ],
)

/**
 * A duty an activity is to meet, on the property of both. A duty stands once
 * among the duties of an activity; a link that was marked makes room for it.
 */
export const activityDuties = pgTable(
  'activity_duties',
  {
    id: primaryId<'activity-duty'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    dutyId: reference<'duty'>('duty_id').notNull(),
    result: evidenceResult('result'),
    resultReason: text('result_reason'),
    // What is said with the result (#108).
    remark: text('remark'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('activity_duties_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'activity_duties_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'activity_duties_of_an_activity_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.dutyId, table.propertyId],
      foreignColumns: [duties.tenantId, duties.id, duties.propertyId],
      name: 'activity_duties_of_a_duty_of_their_property',
    }),
    index('activity_duties_duty_idx').on(table.tenantId, table.dutyId),
    uniqueIndex('activity_duties_once')
      .on(table.tenantId, table.activityId, table.dutyId)
      .where(sql`${table.deletedAt} is null`),
    check(
      'activity_duties_result_reason_shaped',
      optionalTrimmed(table.resultReason, activityLimits.closingReason),
    ),
    check('activity_duties_remark_shaped', optionalTrimmed(table.remark, activityLimits.remark)),
    // A reason with "not performed", and only then; no result, no reason.
    check(
      'activity_duties_not_performed_with_a_reason',
      sql`(${table.result} is not distinct from 'not_performed') = (${table.resultReason} is not null)`,
    ),
  ],
)

/**
 * What only a work order has, beside its activity (ADR 0002, point 13): its
 * number, its kind, how urgent it is (#73), the defect it came of (#117), and
 * the time spent on it, which the people working on it say on site (#118).
 * It hangs on an activity of the kind "work order" on its property, and the
 * key says so with the kind of the activity in it: a column that is always
 * `work_order`, so that a work order cannot hang on a round, and an activity
 * with a work order cannot become one.
 *
 * The number is drawn by the server from the sequence of the work orders,
 * once in a tenant and never again (#26); a work order made on a device
 * without a connection gets it when it arrives, as an asset does.
 *
 * The defect it came of is a defect of its property. It stays when the
 * defect gets a new order: the defect names the order that sets it right
 * now, the order the defect it came of.
 *
 * The callback of the constraints is typed by hand: `defects` points at this
 * table and this one at `defects`, and in such a circle TypeScript cannot
 * infer the type of the table (TS7022).
 */
export const workOrders = pgTable(
  'work_orders',
  {
    id: primaryId<'work-order'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    activityKind: activityKind('activity_kind')
      .notNull()
      .default('work_order')
      .$type<'work_order'>(),
    number: text('number'),
    kind: workOrderKind('kind').notNull(),
    urgency: workOrderUrgency('urgency').notNull().default('normal'),
    originDefectId: reference<'defect'>('origin_defect_id'),
    durationMinutes: integer('duration_minutes'),
    ...timestamps,
    ...syncColumns,
  },
  (table): PgTableExtraConfigValue[] => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('work_orders_tenant_id_key').on(table.tenantId, table.id),
    // What a defect that a work order sets right points at, on its property.
    unique('work_orders_place').on(table.tenantId, table.id, table.propertyId),
    // One work order for an activity.
    unique('work_orders_one_per_activity').on(table.tenantId, table.activityId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'work_orders_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId, table.activityKind],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId, activities.kind],
      name: 'work_orders_of_a_work_order_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.originDefectId, table.propertyId],
      foreignColumns: [defects.tenantId, defects.id, defects.propertyId],
      name: 'work_orders_from_a_defect_of_their_property',
    }),
    index('work_orders_origin_defect_idx').on(table.tenantId, table.originDefectId),
    uniqueIndex('work_orders_number_once')
      .on(table.tenantId, table.number)
      .where(sql`${table.number} is not null`),
    check('work_orders_of_a_work_order', sql`${table.activityKind} = 'work_order'`),
    check('work_orders_number_shaped', optionalTrimmed(table.number, 40)),
    check(
      'work_orders_duration_shaped',
      sql`${table.durationMinutes} is null or ${table.durationMinutes} between 1 and ${sql.raw(String(workOrderLimits.durationMinutes))}`,
    ),
  ],
)

/**
 * The further people working on a work order (section 4.8 of the concept,
 * #73): beside the person who answers for it, each a person of the operator,
 * once per order among the rows that are not marked. A person taken off the
 * order is marked, as everything the sync carries.
 *
 * A row hangs on the activity of the work order, on its property, with the
 * kind of the activity in the key as `work_orders` has it: the people of an
 * order travel with the work on it, which a device holds by its activities,
 * and the log of the activity names them.
 */
export const workOrderParticipants = pgTable(
  'work_order_participants',
  {
    id: primaryId<'work-order-participant'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    activityKind: activityKind('activity_kind')
      .notNull()
      .default('work_order')
      .$type<'work_order'>(),
    userId: text('user_id').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('work_order_participants_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'work_order_participants_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId, table.activityKind],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId, activities.kind],
      name: 'work_order_participants_of_a_work_order_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'work_order_participants_work_here',
    }),
    index('work_order_participants_activity_idx').on(table.tenantId, table.activityId),
    index('work_order_participants_user_idx').on(table.tenantId, table.userId),
    uniqueIndex('work_order_participants_once')
      .on(table.tenantId, table.activityId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    check('work_order_participants_of_a_work_order', sql`${table.activityKind} = 'work_order'`),
  ],
)

/**
 * The notes on a work order (section 4.8 of the concept, #118): each an entry
 * of its own, written on site by whoever works on the order, with the moment
 * of the device it was written on and the person signed in, which the server
 * writes. A note is written once: the application may read and add a row and
 * nothing else, as a signature.
 *
 * A row hangs on the activity of the work order, on its property, with the
 * kind of the activity in the key as `work_orders` has it: the notes travel
 * with the work on the order, and the log of the activity names them.
 */
export const workOrderNotes = pgTable(
  'work_order_notes',
  {
    id: primaryId<'work-order-note'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    activityKind: activityKind('activity_kind')
      .notNull()
      .default('work_order')
      .$type<'work_order'>(),
    text: text('text').notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).notNull(),
    writtenBy: text('written_by').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('work_order_notes_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'work_order_notes_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId, table.activityKind],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId, activities.kind],
      name: 'work_order_notes_of_a_work_order_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.writtenBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'work_order_notes_written_by_somebody_here',
    }),
    index('work_order_notes_activity_idx').on(table.tenantId, table.activityId),
    check('work_order_notes_of_a_work_order', sql`${table.activityKind} = 'work_order'`),
    check('work_order_notes_text_shaped', trimmed(table.text, workOrderLimits.note)),
  ],
)
