import { closedActivitiesStayDays, syncEntities } from '@opengewerk/haustechnik-domain'
import {
  fingerprintOf,
  idArray,
  type PullScope,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'

// What the device of one person holds (ADR 0006, points 1 to 3). The areas
// are drawn by the database already: a row of a property outside the person's
// areas is not read at all (ADR 0003). What is decided here is what a device
// holds of what the person sees, and what the answer names for it, so that a
// device handed to somebody else, or whose person's areas change, lets go of
// what it may no longer hold.

/**
 * The part of the operator the device of a person holds. Whoever sees every
 * area holds the whole operator. Whoever sees only some holds the places of
 * those, with the assets and duties there, their own activities while they are
 * open (given to them or to nobody) and closed ones for
 * `closedActivitiesStayDays`, with what hangs on them, and the open defects.
 */
export interface DeviceScope {
  readonly everyArea: boolean
  /** The properties the person sees, marked as deleted ones included. */
  readonly propertyIds: readonly string[]
  readonly activityIds: readonly string[]
  readonly defectIds: readonly string[]
}

/**
 * The scope of the person of the transaction. The clock is a parameter so
 * that the thirty days can be tested without waiting for them.
 */
export async function deviceScope(
  tx: TenantTransaction,
  userId: string,
  now: Date = new Date(),
): Promise<DeviceScope> {
  const { rows: seen } = await tx.execute<{ every: boolean }>(
    sql`select session_sees_all_areas() as every`,
  )

  if (seen[0]?.every === true) {
    return { everyArea: true, propertyIds: [], activityIds: [], defectIds: [] }
  }

  const since = new Date(now.getTime() - closedActivitiesStayDays * 24 * 60 * 60 * 1000)
  const ids = async (query: SQL) =>
    (await tx.execute<{ id: string }>(query)).rows.map((row) => row.id)

  return {
    everyArea: false,
    propertyIds: await ids(sql`select id from properties order by id`),
    activityIds: await ids(sql`
      select id from activities
       where deleted_at is null
         and (responsible_user_id = ${userId} or performer_user_id = ${userId}
              or (responsible_user_id is null and performer_user_id is null))
         and (status in ('open', 'started', 'signed') or updated_at >= ${since.toISOString()})
       order by id`),
    defectIds: await ids(sql`
      select id from defects
       where deleted_at is null and status in ('found', 'ordered')
       order by id`),
  }
}

/** The kinds of record that hang on a place, held as far as the person sees the places. */
const placeEntities = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'asset_lifecycle',
  'asset_supplies',
  'duties',
  'duty_dismissals',
]

/** The kinds of record of the work on an activity, held with the activity. */
const workEntities = [
  'activities',
  'activity_duties',
  'work_orders',
  'activity_signatures',
  'work_order_decisions',
]

/**
 * The pull of a scope: what keeps the rows of an entity to what the device
 * holds, and what the answer names for each entity, so that a device that
 * finds another value drops what it holds of that entity and asks from the
 * start (ADR 0006, point 2).
 *
 * The places are named by a fingerprint over the properties the person sees:
 * another person, other areas, a substitution that begins or ends, or a
 * property moved to another area give another value, and the device lets go
 * of what it may no longer hold. The work and the defects by a fingerprint
 * over the records held: an activity that closed long enough ago or was given
 * to somebody else, and a defect that was set right, are exactly the changes a
 * narrowed pull leaves out, and without that they stayed on the device.
 */
export function pullScope(scope: DeviceScope): PullScope {
  if (scope.everyArea) {
    return { narrowed: Object.fromEntries(syncEntities.map((entity) => [entity, 'all'])) }
  }

  const activities = idArray(scope.activityIds)
  const column = (entity: string, name: string) =>
    sql`${sql.identifier(entity)}.${sql.identifier(name)}`
  const narrowing: Readonly<Record<string, SQL>> = {
    activities: sql`${column('activities', 'id')} = any(${activities})`,
    activity_duties: sql`${column('activity_duties', 'activity_id')} = any(${activities})`,
    work_orders: sql`${column('work_orders', 'activity_id')} = any(${activities})`,
    activity_signatures: sql`${column('activity_signatures', 'activity_id')} = any(${activities})`,
    work_order_decisions: sql`${column('work_order_decisions', 'work_order_id')} in
      (select id from work_orders where activity_id = any(${activities}))`,
    defects: sql`${column('defects', 'id')} = any(${idArray(scope.defectIds)})`,
  }
  const places = `properties:${fingerprintOf(scope.propertyIds)}`
  const work = `activities:${fingerprintOf(scope.activityIds)}`

  return {
    narrow: (entity) => (Object.hasOwn(narrowing, entity) ? narrowing[entity] : undefined),
    narrowed: {
      ...Object.fromEntries(placeEntities.map((entity) => [entity, places])),
      ...Object.fromEntries(workEntities.map((entity) => [entity, work])),
      defects: `defects:${fingerprintOf(scope.defectIds)}`,
    },
  }
}
