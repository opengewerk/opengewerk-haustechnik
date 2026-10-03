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
