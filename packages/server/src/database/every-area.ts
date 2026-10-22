import type { Actor, Database, TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

/**
 * The work of a background run inside one tenant, in every area of it.
 *
 * A transaction without a person sees no row with a place (ADR 0003, point
 * 10): the functions behind the policy read the areas of the person, and
 * there is none. A run that works for nobody, the deadlines, the reminders,
 * says that it needs every area, and this is the one way to say it. No route
 * calls it: a route works for the person who asked, and sees what they see.
 * A test of this package holds the list of the files that may.
 */
export function inEveryArea<Result>(
  database: Database,
  actor: Actor,
  work: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return database.forTenant(actor, async (tx) => {
    // Local to the transaction, like the tenant the foundation sets: the
    // connection goes back to the pool without it.
    await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)

    return work(tx)
  })
}

/**
 * The pass of the deadlines that removes what has passed its own retention
 * (#412), in every area, and saying that it is that pass (#542): the database
 * lets a done task go and a person at a reading, a booking or a material
 * become nobody only for the transaction that says so, without a person, and
 * no longer for any transaction that merely has none. No route calls it, and
 * a test of this package holds the one file that does.
 */
export function asTheDeadlineRun<Result>(
  database: Database,
  actor: Actor,
  work: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return inEveryArea(database, actor, async (tx) => {
    await tx.execute(sql`select set_config('app.deadline_run', 'on', true)`)

    return work(tx)
  })
}
