import { closedActivitiesStayDays, syncEntities } from '@opengewerk/haustechnik-domain'
import {
  fingerprintOf,
  idArray,
  type PullScope,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, type SQL, sql } from 'drizzle-orm'

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
 * open (given to them or to nobody, or work orders they work on, #73) and
 * closed ones for
 * `closedActivitiesStayDays`, with what hangs on them, and the open defects,
 * with every defect found in an activity it holds: the page a device shows
 * for a signature names them, also one set right meanwhile. Of the tasks, its
 * own (#124): those for the person and those the person wrote, open ones and
 * done ones for `closedActivitiesStayDays`.
 */
export interface DeviceScope {
  readonly everyArea: boolean
  /** The properties the person sees, marked as deleted ones included. */
  readonly propertyIds: readonly string[]
  /**
   * The buildings the person sees, marked as deleted ones included. A
   * building with an area of its own is seen apart from its property (#306).
   */
  readonly buildingIds: readonly string[]
  readonly activityIds: readonly string[]
  readonly defectIds: readonly string[]
  readonly taskIds: readonly string[]
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
    return {
      everyArea: true,
      propertyIds: [],
      buildingIds: [],
      activityIds: [],
      defectIds: [],
      taskIds: [],
    }
  }

  const since = new Date(now.getTime() - closedActivitiesStayDays * 24 * 60 * 60 * 1000)
  const ids = async (query: SQL) =>
    (await tx.execute<{ id: string }>(query)).rows.map((row) => row.id)
  // The two halves of the last condition are what `activities_open_idx` and
  // `activities_changed_idx` carry, word for word: whoever changes one changes
  // the index with it. The work orders the person works on are read once, as
  // a list. Asked for each activity, the database reckoned with one question
  // per row, estimated the whole far too high and compiled the query before
  // running it, which took longer than reading every activity (#80).
  const activityIds = await ids(sql`
      select id from activities
       where deleted_at is null
         and (responsible_user_id = ${userId} or performer_user_id = ${userId}
              or (responsible_user_id is null and performer_user_id is null)
              or id = any(array(select activity_id from work_order_participants
                                 where user_id = ${userId} and deleted_at is null)))
         and (status in ('open', 'started', 'signed') or updated_at >= ${since.toISOString()})
       order by id`)

  return {
    everyArea: false,
    propertyIds: await ids(sql`select id from properties order by id`),
    buildingIds: await ids(sql`select id from buildings order by id`),
    activityIds,
    defectIds: await ids(sql`
      select id from defects
       where deleted_at is null
         and (status in ('found', 'ordered') or found_in_activity_id = any(${idArray(activityIds)}))
       order by id`),
    taskIds: await ids(sql`
      select id from tasks
       where deleted_at is null
         and (assignee_user_id = ${userId} or created_by = ${userId})
         and (status = 'open' or updated_at >= ${since.toISOString()})
       order by id`),
  }
}

/** The kinds of record that hang on a place, held as far as the person sees the places. */
const placeEntities = [
  'properties',
  'buildings',
  'floors',
  'contacts',
  'building_closures',
  // The plans of the rounds there: a device reads the lead of a round.
  'round_plans',
  'rooms',
  'assets',
  'asset_lifecycle',
  'asset_supplies',
  // What a measuring point holds beside its asset (#119): a device shows the
  // reading before and why a meter is not read.
  'meter_points',
  'meter_readings',
  'meter_exchanges',
  'meter_pauses',
  'duties',
  'duty_dismissals',
  // The documents of those places, of the assets there and of the work on
  // them, with their versions: the rows, never the bytes. A document carries
  // the property it hangs on, whatever else it names.
  'attachments',
  'attachment_versions',
  // The labels of those places, of the assets and rooms there and of the
  // sheets printed for them: a scan opens an asset without a network. A label
  // carries the property it lies in, whatever it hangs on.
  'labels',
]

/** The kinds of record of the work on an activity, held with the activity. */
const workEntities = [
  'activities',
  'activity_duties',
  'activity_answers',
  'work_orders',
  'work_order_participants',
  'work_order_notes',
  'activity_signatures',
  'work_order_decisions',
  // The client's signature under the service report of a work order (#324).
  'service_reports',
  // The material taken for a work order (#326).
  'work_order_materials',
]

/**
 * The pull of a scope: what keeps the rows of an entity to what the device
 * holds, and what the answer names for each entity, so that a device that
 * finds another value drops what it holds of that entity and asks from the
 * start (ADR 0006, point 2).
 *
 * The places are named by a fingerprint over the properties and the
 * buildings the person sees: another person, other areas, a substitution
 * that begins or ends, or a property or a building moved to another area
 * give another value, and the device lets go of what it may no longer hold.
 * The buildings count apart, because one with an area of its own is seen
 * without the rest of its property (#306). The work and the defects by a fingerprint
 * over the records held: an activity that closed long enough ago or was given
 * to somebody else, and a defect that was set right, are exactly the changes a
 * narrowed pull leaves out, and without that they stayed on the device.
 *
 * The people and the documents of a contractor lie in no area (#328), so the
 * policies hand them to everybody in the operator, whatever areas they see. A
 * device holds them only for whoever sees the contractors, and names them by
 * another value without that right: one whose person loses it lets them go,
 * and one whose person gains it asks for them from the start. Of the firms
 * themselves such a device holds which firm it is and its name, and no more
 * (#377): an order on site names the firm, and the name is no protected fact
 * (section 4.11 of the concept); the address, the contact, the services and
 * the note stay with whoever sees the firms.
 *
 * The contracts lie in no area either (#329), and with them their documents:
 * a device holds both only for whoever reads the contracts, and names them by
 * another value without that right, in the same way.
 */
export function pullScope(scope: DeviceScope, reads: PullRights): PullScope {
  const column = (entity: string, name: string) =>
    sql`${sql.identifier(entity)}.${sql.identifier(name)}`
  // What a device holds without a right, by entity: each a condition its rows
  // have to meet, and the word its value takes on.
  const withheld = new Map<string, { conditions: SQL[]; words: string[] }>()
  const withhold = (entity: string, word: string, condition: SQL | null) => {
    const held = withheld.get(entity) ?? { conditions: [], words: [] }

    withheld.set(entity, {
      conditions: condition === null ? held.conditions : [...held.conditions, condition],
      words: [...held.words, word],
    })
  }

  if (!reads.contracts) {
    withhold('contracts', 'without-contracts', sql`false`)
    withhold(
      'attachments',
      'without-contracts',
      sql`${column('attachments', 'contract_id')} is null`,
    )
    withhold(
      'attachment_versions',
      'without-contracts',
      sql`${column('attachment_versions', 'attachment_id')} in
          (select id from attachments where contract_id is null)`,
    )
  }

  if (!reads.contractors) {
    withhold('contacts', 'without-contractors', sql`${column('contacts', 'contractor_id')} is null`)
    withhold(
      'attachments',
      'without-contractors',
      sql`${column('attachments', 'contractor_id')} is null`,
    )
    withhold(
      'attachment_versions',
      'without-contractors',
      sql`${column('attachment_versions', 'attachment_id')} in
          (select id from attachments where contractor_id is null)`,
    )
    // The firms themselves stay, by their name alone (`answering`).
    withhold('contractors', 'without-contractors', null)
  }

  const firms: Readonly<Record<string, SQL>> = Object.fromEntries(
    [...withheld].flatMap(([entity, { conditions }]) =>
      conditions.length === 0 ? [] : [[entity, and(...conditions) as SQL]],
    ),
  )
  const named = (entity: string, value: string) =>
    [value, ...(withheld.get(entity)?.words ?? [])].join(':')
  const answering: Pick<PullScope, 'answer'> = reads.contractors
    ? {}
    : {
        answer: (changes) =>
          changes.map((change) =>
            change.entity === 'contractors'
              ? { ...change, rows: change.rows.map(namedFirm) }
              : change,
          ),
      }

  if (scope.everyArea) {
    return {
      narrow: (entity) => (Object.hasOwn(firms, entity) ? firms[entity] : undefined),
      narrowed: Object.fromEntries(syncEntities.map((entity) => [entity, named(entity, 'all')])),
      ...answering,
    }
  }

  const activities = idArray(scope.activityIds)
  const narrowing: Readonly<Record<string, SQL>> = {
    ...firms,
    activities: sql`${column('activities', 'id')} = any(${activities})`,
    activity_duties: sql`${column('activity_duties', 'activity_id')} = any(${activities})`,
    activity_answers: sql`${column('activity_answers', 'activity_id')} = any(${activities})`,
    work_orders: sql`${column('work_orders', 'activity_id')} = any(${activities})`,
    work_order_participants: sql`${column('work_order_participants', 'activity_id')} = any(${activities})`,
    work_order_notes: sql`${column('work_order_notes', 'activity_id')} = any(${activities})`,
    work_order_materials: sql`${column('work_order_materials', 'activity_id')} = any(${activities})`,
    activity_signatures: sql`${column('activity_signatures', 'activity_id')} = any(${activities})`,
    work_order_decisions: sql`${column('work_order_decisions', 'work_order_id')} in
      (select id from work_orders where activity_id = any(${activities}))`,
    service_reports: sql`${column('service_reports', 'activity_id')} = any(${activities})`,
    defects: sql`${column('defects', 'id')} = any(${idArray(scope.defectIds)})`,
    tasks: sql`${column('tasks', 'id')} = any(${idArray(scope.taskIds)})`,
  }
  const places = `properties:${fingerprintOf(scope.propertyIds)}:buildings:${fingerprintOf(scope.buildingIds)}`
  // The templates of the rounds lie in no area: every device holds them all,
  // whatever it sees, to fill a round in the version it names.
  const operator = 'operator'
  const work = `activities:${fingerprintOf(scope.activityIds)}`

  return {
    narrow: (entity) => (Object.hasOwn(narrowing, entity) ? narrowing[entity] : undefined),
    narrowed: {
      ...Object.fromEntries(placeEntities.map((entity) => [entity, named(entity, places)])),
      ...Object.fromEntries(workEntities.map((entity) => [entity, work])),
      defects: `defects:${fingerprintOf(scope.defectIds)}`,
      // The own tasks, by a fingerprint over those held: one that went to
      // somebody else or was done long enough ago leaves the device.
      tasks: `tasks:${fingerprintOf(scope.taskIds)}`,
      round_templates: operator,
      round_template_versions: operator,
      // The key day of the meters, which names the key date of a reading on site (#120).
      meter_settings: operator,
      // Whether names and times stand on a service report, which its page says (#324).
      work_order_settings: operator,
      // The stores of the operator, without an area (#325): a device takes
      // from them at a work order (#326).
      articles: operator,
      suppliers: operator,
      stores: operator,
      store_articles: operator,
      stock_movements: operator,
      // The labels on the shelves, which a scan reads like a barcode (#326).
      store_labels: operator,
      // The contractors of the operator, whose name an order shows (#328).
      contractors: named('contractors', operator),
      // The contracts with them (#329), for the name a document or a duty shows.
      contracts: named('contracts', operator),
    },
    ...answering,
  }
}

/** The rights a pull asks of the person, for what lies in no area (#328, #329). */
export interface PullRights {
  readonly contractors: boolean
  readonly contracts: boolean
}

/**
 * What a device without the right to see the contractors holds of a firm
 * (#377): the firm and its name, with what the sync needs to keep the row.
 * Named one by one, so that a column the firms gain later stays in the
 * office until somebody decides otherwise.
 */
const firmNamedBy: readonly string[] = [
  'id',
  'tenantId',
  'name',
  'version',
  'deletedAt',
  'changeSequence',
]

function namedFirm(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([field]) => firmNamedBy.includes(field)))
}
