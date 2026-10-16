import {
  activityLimits,
  briefingLimits,
  type FormValues,
  longestFormValues,
  longestSignaturePath,
  workPermitLimits,
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
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { withinAreas } from './areas.js'
import { contractors } from './contractors.js'
import { optionalTrimmed, trimmed } from './locations.js'

/**
 * The briefing of a contractor's person at a work order (section 4.11 of the
 * concept, #330): whom, of which firm, in what, the drawing and the moment of
 * the device, taken on the device of whoever leads the order or plans and
 * hands out work, also without a connection. It belongs to its order and has
 * no deadline of its own. Who held the device is the person signed in, which
 * the server writes. Written once: the application may read and add a row
 * and nothing else, and a trigger refuses a change to every role but the area
 * that follows the property.
 */
export const briefings = pgTable(
  'briefings',
  {
    id: primaryId<'briefing'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    contractorId: reference<'contractor'>('contractor_id').notNull(),
    personName: text('person_name').notNull(),
    subject: text('subject').notNull(),
    path: text('path').notNull(),
    signedBy: text('signed_by').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    deviceInfo: text('device_info'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('briefings_tenant_id_key').on(table.tenantId, table.id),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'briefings_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'briefings_of_an_activity_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.contractorId],
      foreignColumns: [contractors.tenantId, contractors.id],
      name: 'briefings_of_a_contractor_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.signedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'briefings_by_somebody_here',
    }),
    index('briefings_activity_idx').on(table.tenantId, table.activityId),
    index('briefings_contractor_idx').on(table.tenantId, table.contractorId),
    check('briefings_person_name_shaped', trimmed(table.personName, briefingLimits.personName)),
    check('briefings_subject_shaped', trimmed(table.subject, briefingLimits.subject)),
    // The shape `signaturePathIsValid` checks in `domain`, as for a signature.
    check(
      'briefings_path_shaped',
      sql`${table.path} ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length(${table.path}) <= ${sql.raw(String(longestSignaturePath))}`,
    ),
    check(
      'briefings_device_info_shaped',
      optionalTrimmed(table.deviceInfo, briefingLimits.deviceInfo),
    ),
  ],
)

/**
 * A permit for hot work at a work order (4.11, #330): the form of the package
 * Brandschutz by its key and version and what was entered in it, the
 * signature of whoever carries the work out among it, filled in on the device
 * of whoever leads the order or plans and hands out work. The office reads it
 * in the version it names, whatever version the catalogue holds later. Who
 * held the device, and issued it, is the person signed in. Written once, like
 * a briefing.
 */
export const workPermits = pgTable(
  'work_permits',
  {
    id: primaryId<'work-permit'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    contractorId: reference<'contractor'>('contractor_id').notNull(),
    formKey: text('form_key').notNull(),
    formVersion: integer('form_version').notNull(),
    answers: jsonb('answers').$type<FormValues>().notNull(),
    signedBy: text('signed_by').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    deviceInfo: text('device_info'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('work_permits_tenant_id_key').on(table.tenantId, table.id),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'work_permits_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'work_permits_of_an_activity_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.contractorId],
      foreignColumns: [contractors.tenantId, contractors.id],
      name: 'work_permits_of_a_contractor_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.signedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'work_permits_by_somebody_here',
    }),
    index('work_permits_activity_idx').on(table.tenantId, table.activityId),
    index('work_permits_contractor_idx').on(table.tenantId, table.contractorId),
    // The key of a form as `activities` keeps it, with its version.
    check(
      'work_permits_form_shaped',
      sql`${table.formKey} ~ '^[a-z][a-z0-9_.-]*$' and char_length(${table.formKey}) <= ${sql.raw(String(activityLimits.formKey))} and ${table.formVersion} >= 1`,
    ),
    // An object of answers, at most as long as the values of a filled form.
    check(
      'work_permits_answers_shaped',
      sql`jsonb_typeof(${table.answers}) = 'object' and octet_length(${table.answers}::text) <= ${sql.raw(String(longestFormValues))}`,
    ),
    check(
      'work_permits_device_info_shaped',
      optionalTrimmed(table.deviceInfo, workPermitLimits.deviceInfo),
    ),
  ],
)
