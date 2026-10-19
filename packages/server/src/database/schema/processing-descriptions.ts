import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { foreignKey, index, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * A description of the processing the Leitung made (#357, section 9 of the
 * concept): the whole text as it was made, with the version it holds for and
 * the sections that differ from the one before, null for the first. Each one
 * stays with its day, so that a works council can read what changed: written
 * once, never changed and never removed. The day it was made is `created_at`.
 */
export const processingDescriptions = pgTable(
  'processing_descriptions',
  {
    id: primaryId<'processing-description'>(),
    ...tenantColumn,
    madeBy: text('made_by').notNull(),
    holdsFor: text('holds_for'),
    text: text('text').notNull(),
    changed: text('changed').array(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.madeBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'processing_descriptions_made_here',
    }),
    index('processing_descriptions_newest').on(table.tenantId, table.createdAt),
  ],
)
