import {
  longestSignaturePath,
  signatureLimits,
  signatureRoles,
  workOrderDecisionKinds,
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
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { activities, workOrders } from './activities.js'
import { withinAreas } from './areas.js'
import { optionalTrimmed, properties } from './locations.js'

/** Who a signature is given as, from the list in `domain`. */
export const signatureRole = pgEnum('signature_role', signatureRoles)

/** How a work order is taken back, from the list in `domain`. */
export const workOrderDecision = pgEnum('work_order_decision', workOrderDecisionKinds)

/**
 * A signature on an activity (ADR 0004, point 7), made on the device, also
 * without a connection, with the moment of the device, the drawing and the
 * fingerprint of the page that was shown. Written once: the application may
 * read and add a row and nothing else, and a trigger refuses a change to
 * every role but the area that follows the property. A work order turned
 * back leaves it standing and no longer valid.
 */
export const activitySignatures = pgTable(
  'activity_signatures',
  {
    id: primaryId<'activity-signature'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    signedBy: text('signed_by').notNull(),
    role: signatureRole('role').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    deviceInfo: text('device_info'),
    path: text('path').notNull(),
    pageFingerprint: text('page_fingerprint').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('activity_signatures_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'activity_signatures_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'activity_signatures_of_an_activity_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.signedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'activity_signatures_by_somebody_here',
    }),
    index('activity_signatures_activity_idx').on(table.tenantId, table.activityId),
    // The shape `signaturePathIsValid` checks in `domain`, minus the box: a
    // regular expression cannot compare numbers, the application does that.
    check(
      'activity_signatures_path_shaped',
      sql`${table.path} ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
        and char_length(${table.path}) <= ${sql.raw(String(longestSignaturePath))}`,
    ),
    check(
      'activity_signatures_device_info_shaped',
      sql`${table.deviceInfo} is null or char_length(${table.deviceInfo}) <= ${sql.raw(String(signatureLimits.deviceInfo))}`,
    ),
    check(
      'activity_signatures_page_fingerprint_shaped',
      sql`${table.pageFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)

/**
 * The acceptance of a signed work order or its rejection with the reason
 * (section 4.8 of the concept). Written once, like a signature.
 */
export const workOrderDecisions = pgTable(
  'work_order_decisions',
  {
    id: primaryId<'work-order-decision'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    workOrderId: reference<'work-order'>('work_order_id').notNull(),
    decision: workOrderDecision('decision').notNull(),
    reason: text('reason'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('work_order_decisions_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'work_order_decisions_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.workOrderId, table.propertyId],
      foreignColumns: [workOrders.tenantId, workOrders.id, workOrders.propertyId],
      name: 'work_order_decisions_of_a_work_order_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.decidedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'work_order_decisions_by_somebody_here',
    }),
    index('work_order_decisions_work_order_idx').on(table.tenantId, table.workOrderId),
    check(
      'work_order_decisions_reason_shaped',
      optionalTrimmed(table.reason, signatureLimits.decisionReason),
    ),
    // A rejection names its reason, an acceptance none.
    check(
      'work_order_decisions_rejected_with_a_reason',
      sql`(${table.decision} = 'rejected') = (${table.reason} is not null)`,
    ),
  ],
)
