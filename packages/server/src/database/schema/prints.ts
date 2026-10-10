import type { RoundRecordState } from '@opengewerk/haustechnik-domain'
import { primaryId, reference, tenantIsolation } from '@opengewerk/platform-server'
import { files, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { withinAreas } from './areas.js'
import { evidence } from './evidence.js'
import { properties } from './locations.js'

/**
 * The frozen state of a round as a whole (section 2.6 of the concept, #111):
 * every answer, the photos, the defects that came of it, the signatures with
 * their drawings and the evidence it was written down with, written once when
 * the round is written down, with the fingerprint over it. A round that meets
 * no duty has no evidence, and this is what its PDF is made of; one that
 * meets duties has its evidence beside it. Never changed and never removed.
 */
export const roundRecords = pgTable(
  'round_records',
  {
    id: primaryId<'round-record'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    state: jsonb('state').$type<RoundRecordState>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('round_records_tenant_id_key').on(table.tenantId, table.id),
    unique('round_records_once').on(table.tenantId, table.activityId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'round_records_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'round_records_of_an_activity_of_their_property',
    }),
    check('round_records_fingerprint_shaped', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
)

/**
 * The PDF of an evidence or a round (section 2.6, #111): "das PDF entsteht
 * beim ersten Abruf und liegt danach im inhaltsadressierten Speicher." Made
 * from the frozen state the first time somebody asks for it, kept in the
 * store under its hash, and handed out from there every time after, so that
 * it stays the same file byte for byte whatever changes in the records. An
 * evidence that is declared invalid afterwards is printed once more, with
 * the declaration on it. Never changed and never removed.
 */
export const prints = pgTable(
  'prints',
  {
    id: primaryId<'print'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    evidenceId: reference<'evidence'>('evidence_id'),
    activityId: reference<'activity'>('activity_id'),
    /** Printed with the declaration that the evidence is invalid. */
    voided: boolean('voided').notNull().default(false),
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'prints_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.evidenceId, table.propertyId],
      foreignColumns: [evidence.tenantId, evidence.id, evidence.propertyId],
      name: 'prints_of_an_evidence_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'prints_of_an_activity_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.sha256],
      foreignColumns: [files.tenantId, files.sha256],
      name: 'prints_in_a_file_of_the_tenant',
    }),
    uniqueIndex('prints_of_an_evidence_once').on(table.tenantId, table.evidenceId, table.voided),
    uniqueIndex('prints_of_a_round_once').on(table.tenantId, table.activityId),
    // Of an evidence or of a round, never both.
    check('prints_of_one_record', sql`num_nonnulls(${table.evidenceId}, ${table.activityId}) = 1`),
    // Only an evidence is declared invalid.
    check('prints_voided_evidence', sql`not ${table.voided} or ${table.evidenceId} is not null`),
  ],
)
