import {
  evidenceLimits,
  evidenceOrigins,
  type StoredEvidenceState,
} from '@opengewerk/haustechnik-domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { withinAreas } from './areas.js'
import { duties } from './duties.js'
import { evidenceResult } from './evidence-result.js'
import { optionalTrimmed, properties, trimmed } from './locations.js'

/** What an evidence came from, from the list in `domain`. */
export const evidenceOrigin = pgEnum('evidence_origin', evidenceOrigins)

/**
 * An evidence (ADR 0004): which duty was met on which day, with which result,
 * at the place of the duty, with its number from the sequence of the
 * evidence, where it came from, who did it, who wrote it down and when, its
 * frozen state and the fingerprint over it. The next due day of a duty is
 * counted from it. It carries the property and the area of its duty, kept by
 * the key over the property with ON UPDATE CASCADE, and the policy
 * `within_areas` (ADR 0003).
 *
 * The state stands on the row and not in a table beside it: an evidence comes
 * about only when it is written down, there is no draft of it, and in one
 * row the two cannot come apart (ADR 0004, addendum of #26).
 *
 * The application may read and add a row and nothing else, and a trigger
 * refuses every change and every removal to every role, the owner and a
 * superuser included; the one change it lets through is the area that
 * follows a property into another area, by the key and nothing else.
 *
 * A correction is a new evidence of the same duty that names the one it
 * replaces, with the reason, at most one for an evidence; both stay readable
 * (ADR 0004, point 14).
 */
export const evidence = pgTable(
  'evidence',
  {
    id: primaryId<'evidence'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    dutyId: reference<'duty'>('duty_id').notNull(),
    performedOn: date('performed_on', { mode: 'string' }).notNull(),
    result: evidenceResult('result').notNull(),
    resultReason: text('result_reason'),
    number: text('number').notNull(),
    origin: evidenceOrigin('origin').notNull(),
    activityId: reference<'activity'>('activity_id'),
    performedBy: text('performed_by'),
    examiner: text('examiner'),
    examinerOrganisation: text('examiner_organisation'),
    writtenBy: text('written_by').notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).notNull().defaultNow(),
    replacesEvidenceId: reference<'evidence'>('replaces_evidence_id'),
    replacementReason: text('replacement_reason'),
    state: jsonb('state').$type<StoredEvidenceState>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('evidence_tenant_id_key').on(table.tenantId, table.id),
    // What a correction and a declaration of invalidity point at.
    unique('evidence_tenant_id_property_duty_key').on(
      table.tenantId,
      table.id,
      table.propertyId,
      table.dutyId,
    ),
    unique('evidence_tenant_id_property_key').on(table.tenantId, table.id, table.propertyId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'evidence_follows_its_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.dutyId, table.propertyId],
      foreignColumns: [duties.tenantId, duties.id, duties.propertyId],
      name: 'evidence_of_a_duty_of_its_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'evidence_from_an_activity_of_its_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.performedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'evidence_performed_by_somebody_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.writtenBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'evidence_written_by_somebody_here',
    }),
    // A correction replaces an evidence of its own duty, and each evidence once.
    // The key runs over the property as every key between rows with a place.
    foreignKey({
      columns: [table.tenantId, table.replacesEvidenceId, table.propertyId, table.dutyId],
      foreignColumns: [table.tenantId, table.id, table.propertyId, table.dutyId],
      name: 'evidence_replaces_one_of_its_duty',
    }),
    uniqueIndex('evidence_replaced_once').on(table.tenantId, table.replacesEvidenceId),
    index('evidence_duty_idx').on(table.tenantId, table.dutyId, table.performedOn),
    uniqueIndex('evidence_number_once').on(table.tenantId, table.number),
    check('evidence_number_shaped', trimmed(table.number, evidenceLimits.number)),
    check(
      'evidence_result_reason_shaped',
      optionalTrimmed(table.resultReason, evidenceLimits.resultReason),
    ),
    // A reason with "not performed", and only then.
    check(
      'evidence_not_performed_with_a_reason',
      sql`(${table.result} = 'not_performed') = (${table.resultReason} is not null)`,
    ),
    check('evidence_examiner_shaped', optionalTrimmed(table.examiner, evidenceLimits.examiner)),
    check(
      'evidence_examiner_organisation_shaped',
      optionalTrimmed(table.examinerOrganisation, evidenceLimits.examinerOrganisation),
    ),
    // An examiner from outside is named with the organisation, both or neither.
    check(
      'evidence_examiner_with_organisation',
      sql`(${table.examiner} is null) = (${table.examinerOrganisation} is null)`,
    ),
    // A report names its examiner; everything but the holdings of a
    // predecessor names somebody who did it.
    check(
      'evidence_report_by_an_examiner',
      sql`${table.origin} <> 'report' or ${table.examiner} is not null`,
    ),
    check(
      'evidence_performed_by_somebody',
      sql`${table.origin} = 'legacy' or num_nonnulls(${table.performedBy}, ${table.examiner}) >= 1`,
    ),
    // One of the two did it: a person of the operator or an examiner from outside.
    check(
      'evidence_performed_by_one',
      sql`num_nonnulls(${table.performedBy}, ${table.examiner}) <= 1`,
    ),
    // A protocol, a point of a round and a work order come from an activity;
    // the holdings of a predecessor from none.
    check(
      'evidence_activity_as_its_origin_says',
      sql`(${table.origin} not in ('protocol', 'round_point', 'work_order') or ${table.activityId} is not null)
        and (${table.origin} <> 'legacy' or ${table.activityId} is null)`,
    ),
    // An object with its version. Without the coalesce a state without a
    // version would pass: the comparison is null then, and a check that is
    // null holds.
    check(
      'evidence_state_shaped',
      sql`jsonb_typeof(${table.state}) = 'object'
        and coalesce(jsonb_typeof(${table.state} -> 'version') = 'number', false)`,
    ),
    check('evidence_fingerprint_shaped', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    // A correction names its reason, and only a correction has one.
    check(
      'evidence_replacement_with_a_reason',
      sql`(${table.replacesEvidenceId} is null) = (${table.replacementReason} is null)`,
    ),
    check(
      'evidence_replacement_reason_shaped',
      optionalTrimmed(table.replacementReason, evidenceLimits.replacementReason),
    ),
    check('evidence_not_its_own_replacement', sql`${table.replacesEvidenceId} <> ${table.id}`),
  ],
)

/**
 * An evidence declared invalid (ADR 0004, point 15): the reason, who did it
 * and when, at most one for an evidence. The evidence stays readable and
 * carries the note wherever it is shown, and its duty counts from the
 * evidence before it, as if it had never been written (`standingEvidence` in
 * `domain`).
 *
 * At the place of its evidence, with the property and the area kept by the
 * key over the property with ON UPDATE CASCADE and the policy `within_areas`
 * (ADR 0003). Written once, like the evidence: the application may read and
 * add a row, and a trigger refuses every change and every removal to every
 * role but the area that follows its property.
 */
export const evidenceVoidings = pgTable(
  'evidence_voidings',
  {
    id: primaryId<'evidence_voiding'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    evidenceId: reference<'evidence'>('evidence_id').notNull(),
    reason: text('reason').notNull(),
    voidedBy: text('voided_by').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('evidence_voidings_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'evidence_voidings_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.evidenceId, table.propertyId],
      foreignColumns: [evidence.tenantId, evidence.id, evidence.propertyId],
      name: 'evidence_voidings_of_an_evidence_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.voidedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'evidence_voidings_by_somebody_here',
    }),
    uniqueIndex('evidence_voided_once').on(table.tenantId, table.evidenceId),
    check('evidence_voidings_reason_shaped', trimmed(table.reason, evidenceLimits.voidingReason)),
  ],
)
