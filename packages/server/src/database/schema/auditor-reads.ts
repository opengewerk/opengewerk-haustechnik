import { primaryId, tenantIsolation } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { foreignKey, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Every request of an auditor from outside (#339, section 4.3 of the concept:
 * "jeder Zugriff festgehalten"): who, when, and what the request asked for,
 * by the route as it is declared and the path it named. Written before the
 * request is served, in a transaction of its own, so that nothing is read
 * that is not written down; a request whose line cannot be written is not
 * served.
 *
 * Only written and read, never changed or removed by the application: the
 * grant is SELECT and INSERT. The Leitung reads it under "Zugänge". No area:
 * it is about a person, not a place.
 */
export const auditorReads = pgTable(
  'auditor_reads',
  {
    id: primaryId<'auditor-read'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
    /** The route as the controller declares it: `/duties/:id`. */
    route: text('route').notNull(),
    /** The path the request named, without its query. */
    path: text('path').notNull(),
    /** What the request named beside its path, the choices of the register for one. */
    query: text('query'),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('auditor_reads_newest_idx').on(table.tenantId, table.readAt),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'auditor_reads_of_somebody_who_works_here',
    }),
  ],
)
