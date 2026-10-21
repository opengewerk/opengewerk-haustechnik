import { recordRetentionKinds, recordRetentionYears } from '@opengewerk/haustechnik-domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { withinAreas } from './areas.js'
import { defects } from './defects.js'
import { kindOfItsActivity, kindOfItsDefect, withinLimits } from './limit-policies.js'

/**
 * What hangs on no evidence has a retention of its own (#412, section 2.6 of
 * the concept, decided on 21.10.2026). An activity without evidence and a
 * defect after it was remedied are proposed and confirmed as an evidence is
 * (#340); a task done, the person at a meter reading and the person at a
 * booking go with the pass of the deadlines.
 */

/** The years of an operator beyond the law, per kind; nothing set is the law alone. */
const years = (kind: keyof typeof recordRetentionYears) => integer(`${kind}_years`)

/**
 * How long an operator keeps what hangs on no evidence, per kind: at least
 * the years of the law (`recordRetentionYears`), never fewer. One row per
 * operator that set one; nothing set is the years of the law.
 */
export const recordRetentionSettings = pgTable(
  'record_retention_settings',
  {
    id: primaryId<'record-retention-setting'>(),
    ...tenantColumn,
    activityYears: years('activity'),
    defectYears: years('defect'),
    taskYears: years('task'),
    readingPersonYears: years('reading_person'),
    bookingPersonYears: years('booking_person'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('record_retention_settings_once').on(table.tenantId),
    ...(
      [
        ['activity', table.activityYears],
        ['defect', table.defectYears],
        ['task', table.taskYears],
        ['reading_person', table.readingPersonYears],
        ['booking_person', table.bookingPersonYears],
      ] as const
    ).map(([kind, column]) =>
      check(
        `record_retention_settings_${kind}_years_shaped`,
        sql`${column} is null or ${column} between ${sql.raw(String(recordRetentionYears[kind]))} and 50`,
      ),
    ),
  ],
)

/**
 * The confirmation that an activity without evidence becomes its shell after
 * the end of its retention: written through the application by whoever leads
 * the operator, read and never changed. Before it is written the database
 * checks the end itself and fills in what it found.
 */
export const activityEmptyings = pgTable(
  'activity_emptyings',
  {
    id: primaryId<'activity-emptying'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    confirmedBy: text('confirmed_by').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    // Written by the database from what it found, not by the application.
    years: integer('years').notNull(),
    endedOn: date('ended_on', { mode: 'string' }).notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsActivity(table.activityId)),
    unique('activity_emptyings_tenant_id_key').on(table.tenantId, table.id),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'activity_emptyings_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'activity_emptyings_of_an_activity_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.confirmedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'activity_emptyings_by_somebody_here',
    }),
    uniqueIndex('activity_emptied_once').on(table.tenantId, table.activityId),
  ],
)

/** The confirmation that a remedied defect loses its content after the end of its retention, as for an activity. */
export const defectEmptyings = pgTable(
  'defect_emptyings',
  {
    id: primaryId<'defect-emptying'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    defectId: reference<'defect'>('defect_id').notNull(),
    confirmedBy: text('confirmed_by').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    // Written by the database from what it found, not by the application.
    years: integer('years').notNull(),
    endedOn: date('ended_on', { mode: 'string' }).notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsDefect(table.defectId)),
    unique('defect_emptyings_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.areaId],
      foreignColumns: [defects.tenantId, defects.id, defects.areaId],
      name: 'defect_emptyings_follow_their_defect',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.propertyId],
      foreignColumns: [defects.tenantId, defects.id, defects.propertyId],
      name: 'defect_emptyings_of_a_defect_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.confirmedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'defect_emptyings_by_somebody_here',
    }),
    uniqueIndex('defect_emptied_once').on(table.tenantId, table.defectId),
  ],
)

/**
 * What the pass of the deadlines removed without a confirmation, one row per
 * pass and kind that removed anything: how many and when, and nothing of
 * what went. A device that holds every task learns from it that some are
 * gone (`device-scope.ts`), and the change log names the removal.
 */
export const retentionRemovals = pgTable(
  'retention_removals',
  {
    id: primaryId<'retention-removal'>(),
    ...tenantColumn,
    kind: text('kind').notNull(),
    removedCount: integer('removed_count').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('retention_removals_tenant_id_key').on(table.tenantId, table.id),
    check(
      'retention_removals_kind_known',
      sql.raw(`"kind" in (${recordRetentionKinds.map((kind) => `'${kind}'`).join(', ')})`),
    ),
    check('retention_removals_count_shaped', sql`${table.removedCount} > 0`),
  ],
)
