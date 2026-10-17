import {
  longestSignaturePath,
  type ServiceReportState,
  serviceReportLimits,
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
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { withinAreas } from './areas.js'
import { optionalTrimmed, trimmed } from './locations.js'
import { kindOfItsActivity, onNoAsset, withinLimits } from './limit-policies.js'

/**
 * The client's signature under the service report of a work order (section
 * 4.8 of the concept, #324): the name in block letters, the drawing, the
 * moment of the device and the fingerprint of the page that was shown, taken
 * on the device of whoever finishes the order, also without a connection.
 * Who held the device is the person signed in, which the server writes; the
 * signature of that account covers the page (2.6). Written once: the
 * application may read and add a row and nothing else, and a trigger refuses
 * a change to every role but the area that follows the property. A rejection
 * of the order leaves it standing and no longer valid.
 */
export const serviceReports = pgTable(
  'service_reports',
  {
    id: primaryId<'service-report'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    clientName: text('client_name').notNull(),
    path: text('path').notNull(),
    signedBy: text('signed_by').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    deviceInfo: text('device_info'),
    pageFingerprint: text('page_fingerprint').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsActivity(table.activityId)),
    unique('service_reports_tenant_id_key').on(table.tenantId, table.id),
    // What a print and a frozen state name: the report with its area and its property.
    unique('service_reports_area_key').on(table.tenantId, table.id, table.areaId),
    unique('service_reports_place').on(table.tenantId, table.id, table.propertyId),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'service_reports_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'service_reports_of_an_activity_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.signedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'service_reports_by_somebody_here',
    }),
    index('service_reports_activity_idx').on(table.tenantId, table.activityId),
    check(
      'service_reports_client_name_shaped',
      trimmed(table.clientName, serviceReportLimits.clientName),
    ),
    // The shape `signaturePathIsValid` checks in `domain`, as for a signature.
    check(
      'service_reports_path_shaped',
      sql`${table.path} ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length(${table.path}) <= ${sql.raw(String(longestSignaturePath))}`,
    ),
    check(
      'service_reports_device_info_shaped',
      optionalTrimmed(table.deviceInfo, serviceReportLimits.deviceInfo),
    ),
    check(
      'service_reports_page_fingerprint_shaped',
      sql`${table.pageFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

/**
 * The frozen state of a service report (2.6, #324): what the order said, the
 * client's name and drawing and, where the operator had switched them on,
 * the names and times of the people who did the work, written once by the
 * server when it takes the client's signature, with the fingerprint over it.
 * The PDF is made of it, never of the current records. Never changed and
 * never removed; it does not travel to a device.
 */
export const serviceReportRecords = pgTable(
  'service_report_records',
  {
    id: primaryId<'service-report-record'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    serviceReportId: reference<'service-report'>('service_report_id').notNull(),
    state: jsonb('state').$type<ServiceReportState>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, onNoAsset()),
    unique('service_report_records_tenant_id_key').on(table.tenantId, table.id),
    unique('service_report_records_once').on(table.tenantId, table.serviceReportId),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.serviceReportId, table.areaId],
      foreignColumns: [serviceReports.tenantId, serviceReports.id, serviceReports.areaId],
      name: 'service_report_records_follow_their_report',
    }).onUpdate('cascade'),
    // The property of what the row hangs on, the report, which a moved
    // building takes along (#307).
    foreignKey({
      columns: [table.tenantId, table.serviceReportId, table.propertyId],
      foreignColumns: [serviceReports.tenantId, serviceReports.id, serviceReports.propertyId],
      name: 'service_report_records_of_a_report_of_their_property',
    }).onUpdate('cascade'),
    check(
      'service_report_records_fingerprint_shaped',
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

/**
 * What an operator sets for its work orders (section 15 of the concept,
 * #324): whether the service report names the people who did the work and
 * the times of their notes. One row per operator that has set it; none is
 * off. Every device holds it, whatever area it sees, so that the page a
 * client signs says what will stand on the report.
 */
export const workOrderSettings = pgTable(
  'work_order_settings',
  {
    id: primaryId<'work-order-setting'>(),
    ...tenantColumn,
    namesAndTimes: boolean('names_and_times').notNull().default(false),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('work_order_settings_once').on(table.tenantId),
  ],
)
