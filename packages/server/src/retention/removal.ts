import type { RecordRetentionKind, TenantId } from '@opengewerk/haustechnik-domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { type SQL, and, eq, sql } from 'drizzle-orm'

import { inEveryArea } from '../database/every-area.js'
import { retentionRemovals, tasks } from '../database/schema/index.js'

/** The kinds that go without a confirmation, and how many of each went. */
export type Removed = Readonly<
  Record<Extract<RecordRetentionKind, 'task' | 'reading_person' | 'booking_person'>, number>
>

/** How many rows a statement that returns its rows touched. */
async function touched(tx: TenantTransaction, statement: SQL): Promise<number> {
  const { rows } = await tx.execute(statement)

  return rows.length
}

/**
 * What goes without a confirmation once its retention has ended (#412,
 * section 2.6 of the concept, decided on 21.10.2026): a task a year after it
 * was done, and the person at a meter reading, at a booking in a store and at
 * the material taken for a work order three years after it, an operator's
 * longer years counting. The reading, the booking and the material stay.
 *
 * Runs after the pass of the deadlines, for nobody and in every area. The
 * database counts each end itself (`record_retention_ended`) and refuses the
 * same statements on every other way, for somebody, or before the end; the
 * conditions here only pick what it lets through. What went is written as a
 * count per kind, nothing of what it was.
 */
export function removeAfterRetention(database: Database, tenantId: TenantId): Promise<Removed> {
  return inEveryArea(database, { tenantId, reason: 'retention.removal' }, async (tx) => {
    const removed: Removed = {
      task: (
        await tx
          .delete(tasks)
          .where(
            and(
              eq(tasks.status, 'done'),
              sql`public.record_retention_ended('task', coalesce(${tasks.doneOn}, (${tasks.updatedAt} at time zone 'Europe/Berlin')::date))`,
            ),
          )
          .returning({ id: tasks.id })
      ).length,
      reading_person: await touched(
        tx,
        sql`update meter_readings set recorded_by = null
             where recorded_by is not null
               and public.record_retention_ended('reading_person', read_on)
            returning id`,
      ),
      booking_person:
        (await touched(
          tx,
          sql`update stock_movements set booked_by = null
               where booked_by is not null
                 and public.record_retention_ended('booking_person', (booked_at at time zone 'Europe/Berlin')::date)
              returning id`,
        )) +
        (await touched(
          tx,
          sql`update work_order_materials set taken_by = null
               where taken_by is not null
                 and public.record_retention_ended('booking_person', (taken_at at time zone 'Europe/Berlin')::date)
              returning id`,
        )),
    }
    const counted = Object.entries(removed).filter(([, count]) => count > 0)

    if (counted.length > 0) {
      await tx
        .insert(retentionRemovals)
        .values(counted.map(([kind, count]) => ({ tenantId, kind, removedCount: count })))
    }

    return removed
  })
}
