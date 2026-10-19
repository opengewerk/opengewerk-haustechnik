import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core'

/**
 * A document on data protection the Leitung made (#358, section 9 of the
 * concept): the record of the processing, the technical and organisational
 * measures or the deletion concept, with its whole text as it was made, the
 * version it holds for and the sections that differ from the one of its kind
 * before, null for the first. Like a description of the processing (#357),
 * written once, never changed and never removed. The day it was made is
 * `created_at`.
 */
export const privacyDocuments = pgTable(
  'privacy_documents',
  {
    id: primaryId<'privacy-document'>(),
    ...tenantColumn,
    kind: text('kind').notNull(),
    madeBy: text('made_by').notNull(),
    holdsFor: text('holds_for'),
    text: text('text').notNull(),
    changed: text('changed').array(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    check('privacy_documents_kind_known', sql`${table.kind} in ('record', 'measures', 'deletion')`),
    foreignKey({
      columns: [table.tenantId, table.madeBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'privacy_documents_made_here',
    }),
    index('privacy_documents_newest').on(table.tenantId, table.kind, table.createdAt),
  ],
)

/**
 * Who is responsible and the data protection officer, as the record of the
 * processing names them (#358): one row per operator that wrote them, as the
 * Leitung typed them. Without a row the record says they are missing.
 */
export const processingRecordSettings = pgTable(
  'processing_record_settings',
  {
    id: primaryId<'processing-record-setting'>(),
    ...tenantColumn,
    controller: text('controller'),
    officer: text('officer'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('processing_record_settings_once').on(table.tenantId),
  ],
)

/**
 * What the Leitung wrote for one activity of the record (#358): the purpose
 * and the legal basis it confirmed or changed, null while the proposal of the
 * application stands, and the recipients. One row per operator and activity;
 * taking the proposal back sets both to null again, so a row is never removed.
 */
export const processingRecordActivities = pgTable(
  'processing_record_activities',
  {
    id: primaryId<'processing-record-activity'>(),
    ...tenantColumn,
    activity: text('activity').notNull(),
    purpose: text('purpose'),
    legalBasis: text('legal_basis'),
    recipients: text('recipients'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('processing_record_activities_once').on(table.tenantId, table.activity),
    // Confirmed is both or neither: a purpose of the Leitung beside the
    // proposed legal basis would be a record nobody confirmed as a whole.
    check(
      'processing_record_activities_confirmed_whole',
      sql`(${table.purpose} is null) = (${table.legalBasis} is null)`,
    ),
  ],
)
