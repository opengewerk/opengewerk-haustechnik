import { closedActivitiesStayDays, type Right, syncEntities } from '@opengewerk/haustechnik-domain'
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
  /** The person of the device, whose qualifications it holds and nobody else's (#337). */
  readonly userId: string
  /**
   * A fingerprint over the activities emptied with their last evidence
   * (#409), empty while there is none: what the pull of what they lost is
   * named by.
   */
  readonly emptied?: string
  /**
   * A fingerprint over the passes that removed tasks a year after they were
   * done (#412), empty while none did: what the pull of the tasks is named by,
   * so that a device holding every task lets those go.
   */
  readonly tasksRemoved?: string
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

  // How many activities were emptied, and the last time one was (#409).
  const { rows: counted } = await tx.execute<{ count: string; latest: string | null }>(
    sql`select count(*)::text as count, max(emptied_at)::text as latest
          from activities where emptied_at is not null`,
  )
  const emptied =
    counted[0] === undefined || counted[0].count === '0'
      ? ''
      : fingerprintOf([`count:${counted[0].count}`, `latest:${counted[0].latest ?? ''}`])
  // How many passes removed tasks, and the last time one did (#412).
  const { rows: removals } = await tx.execute<{ count: string; latest: string | null }>(
    sql`select count(*)::text as count, max(created_at)::text as latest
          from retention_removals where kind = 'task'`,
  )
  const tasksRemoved =
    removals[0] === undefined || removals[0].count === '0'
      ? ''
      : fingerprintOf([`count:${removals[0].count}`, `latest:${removals[0].latest ?? ''}`])

  if (seen[0]?.every === true) {
    return {
      everyArea: true,
      propertyIds: [],
      buildingIds: [],
      activityIds: [],
      defectIds: [],
      taskIds: [],
      userId,
      emptied,
      tasksRemoved,
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
    userId,
    emptied,
    tasksRemoved,
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
  // The electrical structure below a low-voltage installation (#349).
  'distribution_boards',
  'board_sections',
  'circuits',
  'equipment',
  // The PV structure below a PV installation (#461).
  'inverters',
  'pv_strings',
  'pv_modules',
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

/**
 * What an activity emptied with its last evidence loses on the server (#409):
 * its rows are deleted, which a pull of the changes does not carry. A device
 * that holds them finds another value once an activity is emptied, lets them
 * go and asks from the start.
 */
const emptiedEntities: readonly string[] = [
  'activity_answers',
  'activity_signatures',
  'work_order_participants',
  'work_order_notes',
  'work_order_decisions',
  'work_order_materials',
  'service_reports',
  'briefings',
  'work_permits',
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
  // The briefings and permits of a contractor at work (#330).
  'briefings',
  'work_permits',
  // The material taken for a work order (#326).
  'work_order_materials',
]

/** A column of an entity, as a condition names it. */
function column(entity: string, name: string): SQL {
  return sql`${sql.identifier(entity)}.${sql.identifier(name)}`
}

/**
 * What a device needs to hold a kind of record: one of the rights of the
 * routes that show it in the office, and what it holds without them.
 */
interface Reading {
  /** The rights, any one of which will do. */
  readonly rights: readonly Right[]
  /** The rows a device holds without them; none where it is not given. */
  readonly keeps?: () => SQL
  /** The word its value takes on without them, where it had one before #360. */
  readonly word?: string
}

const placesRead: Reading = { rights: ['location.read'] }
const assetsRead: Reading = { rights: ['asset.read'] }
const workRead: Reading = { rights: ['activity.read'] }
const storesRead: Reading = { rights: ['store.read'] }

/**
 * What each kind of record asks of whoever holds it on a device (#360): the
 * right the route that shows it asks for, or of a record without a route of
 * its own, the right of the route it is shown on. A device holds of a kind of
 * record only what that route would hand its person, so that a role of the
 * operator's own that may not look at assets in the office does not find them
 * on its device either. A kind not named here goes to no device.
 *
 * - The own qualifications stand under "Konto" for whoever looks at the
 *   activities, with the kinds they name, and in the list of everybody's for
 *   whoever looks at the qualifications.
 * - The key day of the meters is what the meters are read by, and whether
 *   names and times stand on a service report is what its page says: each
 *   for whoever reads those, and for whoever reads the settings.
 * - Of a firm, whoever looks at the contractors holds all a device holds, and
 *   whoever looks at the duties, the activities or the contracts, which name
 *   a firm, its name (#377).
 * - A label of a room is printed for whoever sees the room; one of an asset,
 *   and one of a sheet that hangs on nothing yet, for whoever looks at the
 *   assets.
 */
const readings: Readonly<Record<string, Reading>> = {
  properties: placesRead,
  buildings: placesRead,
  floors: placesRead,
  contacts: placesRead,
  building_closures: placesRead,
  rooms: placesRead,
  round_templates: workRead,
  round_template_versions: workRead,
  round_plans: workRead,
  assets: assetsRead,
  asset_lifecycle: assetsRead,
  asset_supplies: assetsRead,
  distribution_boards: assetsRead,
  board_sections: assetsRead,
  circuits: assetsRead,
  equipment: assetsRead,
  inverters: assetsRead,
  pv_strings: assetsRead,
  pv_modules: assetsRead,
  meter_points: assetsRead,
  meter_exchanges: assetsRead,
  meter_pauses: assetsRead,
  meter_readings: assetsRead,
  meter_settings: { rights: ['asset.read', 'settings.read'] },
  duties: { rights: ['duty.read'] },
  duty_dismissals: { rights: ['duty.read'] },
  ...Object.fromEntries(workEntities.map((entity) => [entity, workRead])),
  work_order_settings: { rights: ['activity.read', 'settings.read'] },
  defects: { rights: ['defect.read'] },
  tasks: { rights: ['task.read'] },
  attachments: { rights: ['document.read'] },
  attachment_versions: { rights: ['document.read'] },
  labels: {
    rights: ['asset.read'],
    keeps: () => sql`${column('labels', 'room_id')} is not null`,
  },
  articles: storesRead,
  suppliers: storesRead,
  stores: storesRead,
  store_articles: storesRead,
  stock_movements: storesRead,
  store_labels: storesRead,
  contractors: { rights: ['contractor.read', 'duty.read', 'activity.read', 'contract.read'] },
  // The word of the contracts since #329, so that no device asks for them again.
  contracts: { rights: ['contract.read'], word: 'without-contracts' },
  qualifications: { rights: ['activity.read', 'qualification.read'] },
  qualification_kinds: { rights: ['activity.read', 'qualification.read'] },
}

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
 *
 * So does every kind of record without the right to read it (`readings`,
 * #360): its value takes on a word, a device whose person loses the right
 * lets go of what it holds, and one whose person gains it asks from the
 * start.
 */
export function pullScope(scope: DeviceScope, reads: PullRights): PullScope {
  // Whoever does not see the places, a Melder (#331), gets nothing of the
  // operator on the device: no place, no work, nothing tenant-wide either.
  // Its screens ask the server for what they show.
  if (!reads.holds('location.read') && !reads.onlyWhatDutiesHangOn) {
    return {
      narrow: () => sql`false`,
      narrowed: Object.fromEntries(syncEntities.map((entity) => [entity, 'nothing'])),
    }
  }

  // An auditor from outside (#339) holds what the duties hang on and nothing
  // else of the operator: no work, no defect, no document. Which of those rows
  // the database hands over, it decides by the limits of the access
  // (`within_limits`). Only the shipped role is limited, which always reads
  // the duties, and these are what a duty names to it (#360). The firms lie in
  // no area and no limit: of them the device holds those its duties name
  // (#474), under a value that changes with them, so that a firm a duty comes
  // to name is asked for and one no duty names any more is let go.
  if (reads.onlyWhatDutiesHangOn) {
    const firms = reads.firmsOfTheDuties ?? []
    const firmsHeld = sql`${column('contractors', 'id')} = any(${idArray(firms)})`
    const firmsValue = `auditor:firms:${fingerprintOf(firms)}`

    return {
      narrow: (entity) =>
        entity === 'contractors'
          ? firmsHeld
          : dutiesHangOn.includes(entity)
            ? undefined
            : sql`false`,
      narrowed: Object.fromEntries(
        syncEntities.map((entity) => [
          entity,
          entity === 'contractors'
            ? firmsValue
            : dutiesHangOn.includes(entity)
              ? 'auditor'
              : 'nothing',
        ]),
      ),
      // A firm by its name alone, as for whoever does not see the contractors (#377).
      answer: (changes) =>
        changes.map((change) =>
          change.entity === 'contractors'
            ? { ...change, rows: change.rows.map(namedFirm) }
            : change,
        ),
    }
  }

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

  const contracts = reads.holds('contract.read')
  const contractors = reads.holds('contractor.read')

  if (!contracts) {
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

  if (!contractors) {
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

  // Of each kind of record, nothing without a right to read it, or only the
  // rows it keeps (#360).
  for (const entity of syncEntities) {
    // A kind nobody named a right for goes to no device.
    const reading = readings[entity] ?? { rights: [] }

    if (!reading.rights.some((right) => reads.holds(right))) {
      withhold(
        entity,
        reading.word ?? `without-${reading.rights.join('-')}`,
        reading.keeps?.() ?? sql`false`,
      )
    }
  }

  const kept: Readonly<Record<string, SQL>> = Object.fromEntries(
    [...withheld].flatMap(([entity, { conditions }]) =>
      conditions.length === 0 ? [] : [[entity, and(...conditions) as SQL]],
    ),
  )
  // The rows of an entity the device holds: what its rights keep, and what
  // the scope keeps of those.
  const narrowedBy = (entity: string, scoped: SQL | undefined): SQL | undefined => {
    const conditions = [kept[entity], scoped].filter((condition) => condition !== undefined)

    return conditions.length === 0 ? undefined : and(...conditions)
  }
  const named = (entity: string, value: string) =>
    [value, ...(withheld.get(entity)?.words ?? [])].join(':')
  const answering: Pick<PullScope, 'answer'> = contractors
    ? {}
    : {
        answer: (changes) =>
          changes.map((change) =>
            change.entity === 'contractors'
              ? { ...change, rows: change.rows.map(namedFirm) }
              : change,
          ),
      }

  // The qualifications of the person of the device and nobody else's, also
  // for whoever sees every area (#337): what another holds is no business of
  // a device, and the office reads it from the server.
  const own = sql`${column('qualifications', 'user_id')} = ${scope.userId}`
  const ownValue = `own:${fingerprintOf([scope.userId])}`
  // The value of an entity, with the words of what its rights keep from it
  // and, for what an emptied activity held, the activities emptied (#409).
  const valueOf = (entity: string, value: string) => {
    const words = named(entity, value)
    const withEmptied =
      scope.emptied !== undefined && scope.emptied !== '' && emptiedEntities.includes(entity)
        ? `${words}:emptied-${scope.emptied}`
        : words

    // And for the tasks, the passes that removed some a year after they were done (#412).
    return entity === 'tasks' && scope.tasksRemoved !== undefined && scope.tasksRemoved !== ''
      ? `${withEmptied}:removed-${scope.tasksRemoved}`
      : withEmptied
  }

  if (scope.everyArea) {
    return {
      narrow: (entity) => narrowedBy(entity, entity === 'qualifications' ? own : undefined),
      narrowed: Object.fromEntries(
        syncEntities.map((entity) => [
          entity,
          valueOf(entity, entity === 'qualifications' ? ownValue : 'all'),
        ]),
      ),
      ...answering,
    }
  }

  const activities = idArray(scope.activityIds)
  const narrowing: Readonly<Record<string, SQL>> = {
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
    briefings: sql`${column('briefings', 'activity_id')} = any(${activities})`,
    work_permits: sql`${column('work_permits', 'activity_id')} = any(${activities})`,
    defects: sql`${column('defects', 'id')} = any(${idArray(scope.defectIds)})`,
    tasks: sql`${column('tasks', 'id')} = any(${idArray(scope.taskIds)})`,
    qualifications: own,
  }
  const places = `properties:${fingerprintOf(scope.propertyIds)}:buildings:${fingerprintOf(scope.buildingIds)}`
  // The templates of the rounds lie in no area: every device holds them all,
  // whatever it sees, to fill a round in the version it names.
  const operator = 'operator'
  const work = `activities:${fingerprintOf(scope.activityIds)}`
  const values: Readonly<Record<string, string>> = {
    ...Object.fromEntries(placeEntities.map((entity) => [entity, places])),
    ...Object.fromEntries(workEntities.map((entity) => [entity, work])),
    defects: `defects:${fingerprintOf(scope.defectIds)}`,
    // The own tasks, by a fingerprint over those held: one that went to
    // somebody else or was done long enough ago leaves the device.
    tasks: `tasks:${fingerprintOf(scope.taskIds)}`,
    // The own qualifications (#337), and the kinds of the operator they name.
    qualifications: ownValue,
    qualification_kinds: operator,
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
    contractors: operator,
    // The contracts with them (#329), for the name a document or a duty shows.
    contracts: operator,
  }

  return {
    narrow: (entity) =>
      narrowedBy(entity, Object.hasOwn(narrowing, entity) ? narrowing[entity] : undefined),
    narrowed: Object.fromEntries(
      Object.entries(values).map(([entity, value]) => [entity, valueOf(entity, value)]),
    ),
    ...answering,
  }
}

/**
 * The rights a pull asks of the person: whether they see the places at all
 * (#331), what lies in no area (#328, #329), and for each kind of record the
 * right to read it (#360).
 */
export interface PullRights {
  /** Whether the person holds a right, as the guard of a route asks it. */
  readonly holds: (right: Right) => boolean
  /** An auditor from outside (#339): the places, the assets and the duties, and nothing else. */
  readonly onlyWhatDutiesHangOn?: boolean
  /** The firms the live duties of an auditor name (#474), `firmsOfTheDuties`; none where not given. */
  readonly firmsOfTheDuties?: readonly string[]
}

/**
 * The firms the live duties the person sees name (#474): for an auditor from
 * outside, whose duties the database keeps to the limits of the access, the
 * firms its device holds by their name.
 */
export async function firmsOfTheDuties(tx: TenantTransaction): Promise<readonly string[]> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`select distinct contractor_id as id from duties
         where deleted_at is null and contractor_id is not null
         order by 1`,
  )

  return rows.map((row) => row.id)
}

/** What the device of an auditor from outside holds (#339). */
const dutiesHangOn: readonly string[] = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'duties',
  // The firm that performs a duty, by its name, and only one a duty names (#474).
  'contractors',
]

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
