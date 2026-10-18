import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * How many days after the last day of an access its data goes (sections 2.4
 * and 9 of the concept, #356): the devices, the passkeys and, where the
 * account works nowhere else, its address. One row per operator that set it;
 * without one the application counts `membershipRemovalDays.standard`.
 */
export const membershipSettings = pgTable(
  'membership_settings',
  {
    id: primaryId<'membership-setting'>(),
    ...tenantColumn,
    removalDays: integer('removal_days').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('membership_settings_once').on(table.tenantId),
    check('membership_settings_removal_days_shaped', sql`${table.removalDays} between 1 and 3650`),
  ],
)

/**
 * When the data of an access that ended went (#356): once per access, written
 * by the pass of the deadlines, never changed and never removed. Whether the
 * account went with it, its address, passkeys, second factor and password,
 * because it worked nowhere else. The name stays: what the person signed
 * still names them.
 */
export const membershipRemovals = pgTable(
  'membership_removals',
  {
    id: primaryId<'membership-removal'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }).notNull().defaultNow(),
    accountRemoved: boolean('account_removed').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'membership_removals_of_somebody_here',
    }),
    uniqueIndex('membership_removals_once').on(table.tenantId, table.userId),
  ],
)
