import { randomBytes, randomUUID } from 'node:crypto'

import {
  firstAreaName,
  labelCodeFrom,
  rolesSeeingEveryArea,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  Database,
  grantMembership,
  newId,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inEveryArea } from './every-area.js'
import { withinAreasExpression, withinAreasOfTheirFileExpression } from './schema/index.js'
import { areaBoundaryProblems, areaColumnsWithoutTheLine, linesThroughARow } from './test-areas.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  insufficientPrivilege,
  ownerDatabaseUrl,
  refusedBy,
  resetSchema,
} from './test-database.js'
import { writtenColumnNames, writtenPlaceholders, writtenValues } from './test-evidence.js'

/**
 * The line between the areas of a tenant (ADR 0003), asked through the role
 * the application uses, because a policy is a property of the database and
 * not of the code above it.
 *
 * On the tables with a place, from the catalogue: since #18 the four levels of
 * the place, a property, a building on it, a floor in the building and a room
 * on the floor, one of each in the north and in the south. The tables of the
 * counterproofs at the end are built for one check each by the owner of the
 * tables, the way a migration builds them, and dropped again after it.
 */

const tenant: TenantId = newId<'tenant'>()
const area = { north: randomUUID(), south: randomUUID() }

/** The people of the tenant, by what they see. */
const person = {
  lead: 'user-lead',
  north: 'user-north',
  south: 'user-south',
  blocked: 'user-blocked',
  unplaced: 'user-unplaced',
} as const

/** The place in each area, from the property down to the room. */
const place = {
  north: {
    property: randomUUID(),
    building: randomUUID(),
    floor: randomUUID(),
    room: randomUUID(),
    asset: randomUUID(),
    lifecycle: randomUUID(),
    supply: randomUUID(),
    duty: randomUUID(),
    activity: randomUUID(),
    workOrder: randomUUID(),
    document: randomUUID(),
    version: randomUUID(),
    file: randomUUID().replaceAll('-', '').repeat(2),
  },
  south: {
    property: randomUUID(),
    building: randomUUID(),
    floor: randomUUID(),
    room: randomUUID(),
    asset: randomUUID(),
    lifecycle: randomUUID(),
    supply: randomUUID(),
    duty: randomUUID(),
    activity: randomUUID(),
    workOrder: randomUUID(),
    document: randomUUID(),
    version: randomUUID(),
    file: randomUUID().replaceAll('-', '').repeat(2),
  },
}

/** The policies, FORCE and the grants of a table with a place, as a migration writes them. */
function protections(
  table: string,
  { line = withinAreasExpression, as = 'RESTRICTIVE' }: { line?: string | null; as?: string } = {},
): string[] {
  const ownTenant = `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`

  return [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON ${table} AS PERMISSIVE FOR ALL TO opengewerk_app
       USING (${ownTenant}) WITH CHECK (${ownTenant})`,
    ...(line === null
      ? []
      : [
          `CREATE POLICY within_areas ON ${table} AS ${as} FOR ALL TO opengewerk_app
             USING (${line}) WITH CHECK (${line})`,
        ]),
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
    `GRANT SELECT, INSERT, UPDATE ON ${table} TO opengewerk_app`,
  ]
}

/**
 * Thrown at the end of a transaction that only wanted to see whether a write
 * goes through: the transaction is rolled back, and what it found comes out
 * with the error.
 */
class TakenBack extends Error {
  constructor(readonly found: unknown) {
    super('Taken back on purpose')
  }
}

let admin: Pool
let owner: Pool
let database: Database

/** Statements run by the owner of the tables, the role every migration runs as. */
async function asOwner(statements: readonly string[]): Promise<void> {
  for (const statement of statements) {
    await owner.query(statement)
  }
}

/**
 * The tables with a place, from the catalogue: every table with `area_id` but
 * the few that name areas without lying in one, the same list the check of
 * the catalogue leaves aside.
 */
async function tablesWithAPlace(): Promise<string[]> {
  const { rows } = await admin.query<{ table_name: string }>(
    `select distinct c.relname as table_name
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'area_id'
        and not a.attisdropped and c.relname <> all ($1::text[])
      order by 1`,
    [Object.keys(areaColumnsWithoutTheLine)],
  )

  return rows.map((row) => row.table_name)
}

/**
 * Whether a table is removed by marking a row, as the place and the
 * technology are. An evidence is never removed, and a deadline drops out
 * through its state; neither has the mark.
 */
async function removedByMarking(table: string): Promise<boolean> {
  const { rows } = await admin.query<{ marked: boolean }>(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = 'deleted_at'
     ) as marked`,
    [table],
  )

  return rows[0]?.marked === true
}

/** Whether the application may change the rows of a table at all. */
async function changeable(table: string): Promise<boolean> {
  const { rows } = await admin.query<{ changeable: boolean }>(
    `select has_table_privilege('opengewerk_app', format('public.%I', $1::text), 'UPDATE')
              as changeable`,
    [table],
  )

  return rows[0]?.changeable === true
}

/** An area by the name this test gives it. */
function named(id: string): string {
  return id === area.north ? 'north' : id === area.south ? 'south' : id
}

/** The areas of the rows somebody reaches in a table, by name, each once. */
async function areasSeen(
  table: string,
  userId: string | undefined,
  { background = false }: { background?: boolean } = {},
): Promise<string[]> {
  const actor = userId === undefined ? { tenantId: tenant } : { tenantId: tenant, userId }
  const live = (await removedByMarking(table)) ? ' where deleted_at is null' : ''
  const read = async (tx: TenantTransaction) =>
    (
      await tx.execute<{ area: string }>(
        sql.raw(`select distinct area_id::text as area from ${table}${live}`),
      )
    ).rows
  const rows = background
    ? await inEveryArea(database, actor, read)
    : await database.forTenant(actor, read)

  return rows.map((row) => named(row.area)).sort()
}

/** Runs a write as somebody and rolls it back, handing out what it returned. */
async function triedAs(
  userId: string,
  write: (tx: TenantTransaction) => Promise<unknown>,
): Promise<unknown> {
  return database
    .forTenant({ tenantId: tenant, userId }, async (tx) => {
      throw new TakenBack(await write(tx))
    })
    .catch((error: unknown) => {
      if (error instanceof TakenBack) {
        return error.found
      }

      throw error
    })
}

/** Today in Germany as the database counts it, and the days around it. */
async function days(): Promise<{ yesterday: string; today: string; tomorrow: string }> {
  const { rows } = await admin.query<{ yesterday: string; today: string; tomorrow: string }>(
    `select (d - 1)::text as yesterday, d::text as today, (d + 1)::text as tomorrow
       from (select (now() at time zone 'Europe/Berlin')::date as d) as day`,
  )
  const found = rows[0]

  if (!found) {
    throw new Error('The database told no day')
  }

  return found
}

/** A substitution for the length of one check, removed again after it. */
async function whileStandingIn<Result>(
  substitution: { substitute: string; absent: string; startsOn: string; endsOn: string },
  check: () => Promise<Result>,
): Promise<Result> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into substitutions (tenant_id, substitute_user_id, absent_user_id, starts_on, ends_on)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      tenant,
      substitution.substitute,
      substitution.absent,
      substitution.startsOn,
      substitution.endsOn,
    ],
  )

  try {
    return await check()
  } finally {
    await admin.query('delete from substitutions where id = $1', [rows[0]?.id])
  }
}

/**
 * The place in one area, from the property down to the room, and an asset in
 * the room with an entry of its life cycle and the building it supplies, put
 * in past the application.
 */
async function placeIn(where: 'north' | 'south'): Promise<void> {
  const at = place[where]
  const areaId = area[where]
  const name = where === 'north' ? 'Wohnanlage Nordstraße' : 'Wohnanlage Südring'

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, $4, 'Hauptstraße 1', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [at.property, tenant, areaId, name],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus A', '{residential}')`,
    [at.building, tenant, at.property, areaId],
  )
  await admin.query(
    `insert into floors (id, tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, $5, 'Erdgeschoss', 0)`,
    [at.floor, tenant, at.building, at.property, areaId],
  )
  await admin.query(
    `insert into contacts (tenant_id, property_id, area_id, family_name, role)
     values ($1, $2, $3, 'Becker', 'Hausmeister')`,
    [tenant, at.property, areaId],
  )
  await admin.query(
    `insert into building_closures (tenant_id, building_id, property_id, area_id, starts_on, ends_on, reason)
     values ($1, $2, $3, $4, '2026-12-24', '2027-01-06', 'Weihnachtsferien')`,
    [tenant, at.building, at.property, areaId],
  )
  await admin.query(
    `insert into rooms (id, tenant_id, floor_id, building_id, property_id, area_id, number)
     values ($1, $2, $3, $4, $5, $6, '0.01')`,
    [at.room, tenant, at.floor, at.building, at.property, areaId],
  )
  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, room_id, kind, number, name)
     values ($1, $2, $3, $4, $5, $6, 'probe.elevator', $7, 'Aufzug')`,
    [
      at.asset,
      tenant,
      at.property,
      areaId,
      at.building,
      at.room,
      where === 'north' ? 'AN-00001' : 'AN-00002',
    ],
  )
  await admin.query(
    `insert into asset_lifecycle (id, tenant_id, asset_id, property_id, area_id, state, valid_from)
     values ($1, $2, $3, $4, $5, 'in_service', '2020-01-01')`,
    [at.lifecycle, tenant, at.asset, at.property, areaId],
  )
  await admin.query(
    `insert into asset_supplies (id, tenant_id, asset_id, property_id, area_id, building_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [at.supply, tenant, at.asset, at.property, areaId, at.building],
  )
  // A duty of the property itself: the evidence below would keep an asset it
  // hung on from being marked, and with it the room the asset stands in.
  await admin.query(
    `insert into duties (id, tenant_id, property_id, area_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     values ($1, $2, $3, $4, 'Zufahrt freihalten', 'authority', 'Brandschutzkonzept',
             'from_performance', 1, $5)`,
    [at.duty, tenant, at.property, areaId, person.lead],
  )
  // An evidence of the duty, and the deadline the engine keeps from it.
  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           ${writtenColumnNames})
     values ($1, $2, $3, $4, '2025-03-14', 'without_defects', ${writtenPlaceholders(5)})`,
    [
      tenant,
      at.property,
      areaId,
      at.duty,
      ...writtenValues(person.lead, '2025-03-14', 'without_defects'),
    ],
  )
  await admin.query(
    `insert into deadlines (tenant_id, kind, source_id, source_label, anchor_on, due_on, duty_id,
                            property_id, area_id)
     values ($1, 'duty.due', $2, 'Hauptprüfung der Aufzugsanlage, Aufzug', '2025-03-14',
             '2027-03-01', $2, $3, $4)`,
    [tenant, at.duty, at.property, areaId],
  )
  await admin.query(
    `insert into duty_dismissals (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                                  reason, dismissed_by)
     values ($1, $2, $3, $4, 'probe.elevator_annual_check', 1, 'Keine Notrufeinrichtung.', $5)`,
    [tenant, at.property, areaId, at.asset, person.lead],
  )
  // A work order at the asset to meet the duty, and a defect noticed in it.
  await admin.query(
    `insert into activities (id, tenant_id, property_id, area_id, asset_id, kind, title)
     values ($1, $2, $3, $4, $5, 'work_order', 'Hauptprüfung Aufzug')`,
    [at.activity, tenant, at.property, areaId, at.asset],
  )
  await admin.query(
    `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
     values ($1, $2, $3, $4, $5)`,
    [tenant, at.property, areaId, at.activity, at.duty],
  )
  // The answer to a point of its form (#106).
  await admin.query(
    `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, result)
     values ($1, $2, $3, $4, 'door_closed', 'ok')`,
    [tenant, at.property, areaId, at.activity],
  )
  await admin.query(
    `insert into work_orders (id, tenant_id, property_id, area_id, activity_id, number, kind)
     values ($1, $2, $3, $4, $5, $6, 'inspection')`,
    [
      at.workOrder,
      tenant,
      at.property,
      areaId,
      at.activity,
      where === 'north' ? 'AU-2026-0001' : 'AU-2026-0002',
    ],
  )
  await admin.query(
    `insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                          description, found_on)
     values ($1, $2, $3, $4, $5, 'Notruf im Fahrkorb ohne Verbindung.', '2026-10-01')`,
    [tenant, at.property, areaId, at.asset, at.activity],
  )
  // The signature on the work order, and its rejection.
  await admin.query(
    `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                      signed_at, path, page_fingerprint)
     values ($1, $2, $3, $4, $5, 'signer', '2026-10-01T09:30:00Z', 'M10,10L200,300', $6)`,
    [tenant, at.property, areaId, at.activity, person.lead, 'a'.repeat(64)],
  )
  await admin.query(
    `insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision,
                                       reason, decided_by)
     values ($1, $2, $3, $4, 'rejected', 'Die Notrufverbindung fehlt noch.', $5)`,
    [tenant, at.property, areaId, at.workOrder, person.lead],
  )
  // The evidence of the duty, declared invalid.
  await admin.query(
    `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
     select tenant_id, property_id, area_id, id, 'Der Bericht gehört zu einer anderen Anlage.', $2
       from evidence where duty_id = $1`,
    [at.duty, person.lead],
  )
  // A document at the asset, with the file its one version names.
  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type)
     values ($1, $2, 2048, 'application/pdf')`,
    [tenant, at.file],
  )
  await admin.query(
    `insert into attachments (id, tenant_id, property_id, area_id, asset_id, title, kind)
     values ($1, $2, $3, $4, $5, 'Betriebsanleitung', 'operating_manual')`,
    [at.document, tenant, at.property, areaId, at.asset],
  )
  await admin.query(
    `insert into attachment_versions (id, tenant_id, attachment_id, sha256, file_name, media_type,
                                      size_bytes)
     values ($1, $2, $3, $4, 'betriebsanleitung.pdf', 'application/pdf', 2048)`,
    [at.version, tenant, at.document, at.file],
  )
  // The label on the asset.
  await admin.query(
    `insert into labels (tenant_id, property_id, area_id, asset_id, code)
     values ($1, $2, $3, $4, $5)`,
    [tenant, at.property, areaId, at.asset, labelCodeFrom(randomBytes(10))],
  )
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  owner = new Pool({ connectionString: ownerDatabaseUrl() })

  // The tenant and its people go in past the application. The two areas come
  // before the first membership, so that the tenant does not begin with the
  // one area a tenant gets with its first membership.
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])
  await admin.query(
    `insert into areas (id, tenant_id, name) values ($1, $3, 'Nord'), ($2, $3, 'Süd')`,
    [area.north, area.south, tenant],
  )

  for (const userId of Object.values(person)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@nord.example`,
    ])
  }

  await admin.query(
    `insert into memberships (tenant_id, user_id, roles, blocked_at) values
       ($1, $2, '{management}', null),
       ($1, $3, '{technician}', null),
       ($1, $4, '{technician}', null),
       ($1, $5, '{technician}', now()),
       ($1, $6, '{technician}', null)`,
    [tenant, person.lead, person.north, person.south, person.blocked, person.unplaced],
  )
  await admin.query(
    `insert into member_areas (tenant_id, user_id, area_id) values
       ($1, $2, $4), ($1, $3, $5), ($1, $6, $4)`,
    [tenant, person.north, person.south, area.north, area.south, person.blocked],
  )

  await placeIn('north')
  await placeIn('south')

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await owner.end()
  await admin.end()
})

describe('a person with the north', () => {
  /**
   * Table by table, and the tables come from the catalogue. Who leads sees
   * both areas, so a table that showed nobody anything would turn this red as
   * well as one that showed the south to the north.
   */
  it('reads the rows of the north and none of the south, in every table with a place', async () => {
    const tables = await tablesWithAPlace()
    const seen: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const table of tables) {
      seen[table] = {
        north: await areasSeen(table, person.north),
        south: await areasSeen(table, person.south),
        lead: await areasSeen(table, person.lead),
        blocked: await areasSeen(table, person.blocked),
        unplaced: await areasSeen(table, person.unplaced),
        nobody: await areasSeen(table, undefined),
      }
      expected[table] = {
        north: ['north'],
        south: ['south'],
        lead: ['north', 'south'],
        // Blocked, nothing at all, also of the area still named for them.
        blocked: [],
        unplaced: [],
        // A transaction without a person sees no row with a place.
        nobody: [],
      }
    }

    expect(tables).toEqual([
      'activities',
      'activity_answers',
      'activity_duties',
      'activity_signatures',
      'asset_lifecycle',
      'asset_supplies',
      'assets',
      'attachments',
      'building_closures',
      'buildings',
      'contacts',
      'deadlines',
      'defects',
      'duties',
      'duty_dismissals',
      'evidence',
      'evidence_voidings',
      'floors',
      'labels',
      'properties',
      'rooms',
      'work_order_decisions',
      'work_orders',
    ])
    expect(seen).toEqual(expected)
  })

  /**
   * Changing a row and marking it deleted, which is how a place is removed:
   * the application role has no DELETE on them. A table without the mark is
   * only changed, and one the application may not change at all, the
   * evidence, refuses the change to anybody, whichever area the row is in.
   */
  it('changes and removes no row of the south, in every table with a place', async () => {
    const tables = await tablesWithAPlace()
    const outcome: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const table of tables) {
      const theirs = `area_id = '${area.south}'`

      if (!(await changeable(table))) {
        outcome[table] = await triedAs(person.north, (tx) =>
          tx.execute(sql.raw(`update ${table} set area_id = area_id where ${theirs}`)),
        ).catch((error: unknown) =>
          (error as { cause?: { code?: string } }).cause?.code === insufficientPrivilege
            ? 'refused'
            : error,
        )
        expected[table] = 'refused'
        continue
      }

      const marked = await removedByMarking(table)

      outcome[table] = await triedAs(person.north, async (tx) => ({
        updated: (
          await tx.execute(sql.raw(`update ${table} set area_id = area_id where ${theirs}`))
        ).rowCount,
        ...(marked
          ? {
              removed: (
                await tx.execute(sql.raw(`update ${table} set deleted_at = now() where ${theirs}`))
              ).rowCount,
            }
          : {}),
      }))
      expected[table] = marked ? { updated: 0, removed: 0 } : { updated: 0 }
    }

    expect(outcome).toEqual(expected)

    // The same statements find the rows of the area the person has. Without
    // this the zeros above could come from statements that match nothing for
    // anybody. From the room up, so that every level counts its own row and
    // not one a level above it marked.
    const own = await triedAs(person.north, async (tx) => {
      const mine = `area_id = '${area.north}'`
      const found: Record<string, unknown> = {}

      for (const table of ['rooms', 'floors', 'buildings', 'properties']) {
        found[table] = {
          updated: (
            await tx.execute(sql.raw(`update ${table} set area_id = area_id where ${mine}`))
          ).rowCount,
          removed: (
            await tx.execute(sql.raw(`update ${table} set deleted_at = now() where ${mine}`))
          ).rowCount,
        }
      }

      return found
    })

    expect(own).toEqual({
      rooms: { updated: 1, removed: 1 },
      floors: { updated: 1, removed: 1 },
      buildings: { updated: 1, removed: 1 },
      properties: { updated: 1, removed: 1 },
    })
  })

  /**
   * A row has to name the place above it and the area of its property, and
   * all of it is checked: the area against what the person may see, by the
   * policy, and the rest against the rows above, by the keys. A place of
   * another area is out of reach whichever part the row gets wrong.
   */
  it('hangs no row on a place of the south', async () => {
    const north = place.north
    const south = place.south
    const buildingOn = (property: string, inArea: string) =>
      refusedBy(
        triedAs(person.north, (tx) =>
          tx.execute(sql`insert into buildings (tenant_id, property_id, area_id, name, kinds)
                         values (${tenant}, ${property}, ${inArea}, 'Haus B', '{office}')`),
        ),
      )
    const roomOn = (floor: string, building: string, property: string, inArea: string) =>
      refusedBy(
        triedAs(person.north, (tx) =>
          tx.execute(sql`insert into rooms (tenant_id, floor_id, building_id, property_id, area_id, number)
                         values (${tenant}, ${floor}, ${building}, ${property}, ${inArea}, '0.02')`),
        ),
      )

    // Naming the south: the policy.
    expect((await buildingOn(south.property, area.south)).code).toBe(insufficientPrivilege)
    expect((await roomOn(south.floor, south.building, south.property, area.south)).code).toBe(
      insufficientPrivilege,
    )
    // Naming the north for a place of the south: the key that follows the property.
    expect(await buildingOn(south.property, area.north)).toEqual({
      code: '23503',
      constraint: 'buildings_follow_their_property',
    })
    expect(await roomOn(south.floor, south.building, south.property, area.north)).toEqual({
      code: '23503',
      constraint: 'rooms_follow_their_property',
    })
    // A floor of the south under the building and property of the north: the
    // keys that hold the levels together.
    expect((await roomOn(south.floor, north.building, north.property, area.north)).code).toBe(
      '23503',
    )

    // And in the north the same rows go in.
    const written = await triedAs(person.north, async (tx) => ({
      building: (
        await tx.execute(sql`insert into buildings (tenant_id, property_id, area_id, name, kinds)
                             values (${tenant}, ${north.property}, ${area.north}, 'Haus B', '{office}')`)
      ).rowCount,
      room: (
        await tx.execute(sql`insert into rooms (tenant_id, floor_id, building_id, property_id, area_id, number)
                             values (${tenant}, ${north.floor}, ${north.building}, ${north.property}, ${area.north}, '0.02')`)
      ).rowCount,
    }))

    expect(written).toEqual({ building: 1, room: 1 })
  })

  it('cannot move a property out of its sight', async () => {
    const refusal = await refusedBy(
      triedAs(person.north, (tx) =>
        tx.execute(
          sql`update properties set area_id = ${area.south} where id = ${place.north.property}`,
        ),
      ),
    )

    expect(refusal.code).toBe(insufficientPrivilege)
  })
})

describe('a property moved to another area', () => {
  /**
   * The key does it, in the same statement, past the policy (ADR 0003, point
   * 12): whoever may move the property moves everything below it. Every table
   * that names a property is asked, from the catalogue.
   */
  it('takes every row below it along, in every table that names a property', async () => {
    const move = (to: string) =>
      database.forTenant({ tenantId: tenant, userId: person.lead }, (tx) =>
        tx.execute(sql`update properties set area_id = ${to} where id = ${place.north.property}`),
      )
    const { rows: tables } = await admin.query<{ table_name: string }>(
      `select distinct c.relname as table_name
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'property_id'
          and not a.attisdropped
        order by 1`,
    )

    await move(area.south)

    try {
      const below: Record<string, unknown> = {}
      const expected: Record<string, unknown> = {}

      for (const { table_name: table } of tables) {
        const { rows } = await admin.query<{ rows: number; elsewhere: number }>(
          `select count(*)::int as rows,
                  count(*) filter (where area_id <> $2)::int as elsewhere
             from ${table} where property_id = $1`,
          [place.north.property, area.south],
        )

        below[table] = rows[0]
        expected[table] = { rows: 1, elsewhere: 0 }
      }

      expect(tables.map((row) => row.table_name)).toEqual([
        'activities',
        'activity_answers',
        'activity_duties',
        'activity_signatures',
        'asset_lifecycle',
        'asset_supplies',
        'assets',
        'attachments',
        'building_closures',
        'buildings',
        'contacts',
        'deadlines',
        'defects',
        'duties',
        'duty_dismissals',
        'evidence',
        'evidence_voidings',
        'floors',
        'labels',
        'rooms',
        'work_order_decisions',
        'work_orders',
      ])
      expect(below).toEqual(expected)

      // What the people see follows: the north has nothing left, the south both.
      expect(await areasSeen('rooms', person.north)).toEqual([])
      expect(await areasSeen('rooms', person.south)).toEqual(['south'])
    } finally {
      await move(area.north)
    }

    expect(await areasSeen('rooms', person.north)).toEqual(['north'])
  })
})

/**
 * A version of a document carries no area (ADR 0003, addendum of #97): it is
 * written once and a trigger of the foundation refuses every change to it, so
 * an area on the row could not follow its property. Its line is the one of
 * its document, asked by a policy of its own, and the tests above, which walk
 * the tables with `area_id`, do not reach it. These do.
 */
describe('the versions of a document', () => {
  /** The documents whose versions somebody reaches, by the area of the document. */
  async function versionsSeen(userId: string | undefined): Promise<string[]> {
    const actor = userId === undefined ? { tenantId: tenant } : { tenantId: tenant, userId }
    const rows = await database.forTenant(actor, (tx) =>
      tx.execute<{ attachment_id: string }>(sql`select attachment_id from attachment_versions`),
    )

    return rows.rows
      .map((row) =>
        row.attachment_id === place.north.document
          ? 'north'
          : row.attachment_id === place.south.document
            ? 'south'
            : row.attachment_id,
      )
      .sort()
  }

  const versionOf = (document: string, file: string) =>
    sql`insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type,
                                         size_bytes)
        values (${tenant}, ${document}, ${file}, 'neu.pdf', 'application/pdf', 2048)`

  it('are read by whoever reads their document, and by nobody else', async () => {
    expect({
      north: await versionsSeen(person.north),
      south: await versionsSeen(person.south),
      lead: await versionsSeen(person.lead),
      blocked: await versionsSeen(person.blocked),
      unplaced: await versionsSeen(person.unplaced),
      nobody: await versionsSeen(undefined),
    }).toEqual({
      north: ['north'],
      south: ['south'],
      lead: ['north', 'south'],
      blocked: [],
      unplaced: [],
      nobody: [],
    })
  })

  it('are added to a document in sight, and to none of the south', async () => {
    const refusal = await refusedBy(
      triedAs(person.north, (tx) => tx.execute(versionOf(place.south.document, place.south.file))),
    )

    expect(refusal.code).toBe(insufficientPrivilege)

    const added = await triedAs(
      person.north,
      async (tx) => (await tx.execute(versionOf(place.north.document, place.north.file))).rowCount,
    )

    expect(added).toBe(1)
  })

  /**
   * The reason a version has no area of its own: with one, the key that
   * follows the property would change the row, the trigger would refuse it,
   * and the property could not be moved at all.
   */
  it('follow their document into another area without being changed', async () => {
    const stamp = async () =>
      (
        await admin.query<{ updated_at: Date; change_sequence: string }>(
          'select updated_at, change_sequence from attachment_versions where id = $1',
          [place.north.version],
        )
      ).rows[0]
    const before = await stamp()
    const move = (to: string) =>
      database.forTenant({ tenantId: tenant, userId: person.lead }, (tx) =>
        tx.execute(sql`update properties set area_id = ${to} where id = ${place.north.property}`),
      )

    await move(area.south)

    try {
      expect(await versionsSeen(person.north)).toEqual([])
      expect(await versionsSeen(person.south)).toEqual(['north', 'south'])
      expect(await stamp()).toEqual(before)
    } finally {
      await move(area.north)
    }

    expect(await versionsSeen(person.north)).toEqual(['north'])
  })

  it('are changed and removed by nobody, not even past every policy', async () => {
    for (const statement of [
      `update attachment_versions set file_name = 'anders.pdf' where id = '${place.north.version}'`,
      `delete from attachment_versions where id = '${place.north.version}'`,
    ]) {
      // Asked past the policies, where the row is in reach: the trigger of
      // the foundation refuses, whoever asks.
      const refusal = await refusedBy(admin.query(statement))

      expect([statement, refusal.code]).toEqual([statement, 'OG001'])
    }
  })

  /**
   * The counterproof of the check of the catalogue: without its policy, with
   * one another policy could widen, and with one that asks something else,
   * the versions are named. The policy of the migration is put back after
   * each, and the last line holds that it is.
   */
  it('are refused by the catalogue without the policy that asks their document', async () => {
    const through = linesThroughARow['attachment_versions']

    if (!through) {
      throw new Error('The versions of a document are not on the list')
    }

    const policy = (as: string, line: string) =>
      `CREATE POLICY ${through.policy} ON attachment_versions AS ${as} FOR ALL TO opengewerk_app
         USING (${line}) WITH CHECK (${line})`
    const problemsWithPolicy = async (statements: readonly string[]) => {
      await asOwner([`DROP POLICY ${through.policy} ON attachment_versions`, ...statements])

      try {
        return await areaBoundaryProblems(admin)
      } finally {
        await asOwner([
          `DROP POLICY IF EXISTS ${through.policy} ON attachment_versions`,
          policy('RESTRICTIVE', withinAreasOfTheirFileExpression),
        ])
      }
    }

    expect(await problemsWithPolicy([])).toEqual([
      'table attachment_versions: its rows are a part of attachments and it has no policy within_areas_of_their_file',
    ])
    expect(
      await problemsWithPolicy([policy('PERMISSIVE', withinAreasOfTheirFileExpression)]),
    ).toEqual([
      'table attachment_versions, policy within_areas_of_their_file: not restrictive for every command, so another policy can widen it',
    ])
    expect(await problemsWithPolicy([policy('RESTRICTIVE', 'true')])).toEqual([
      'table attachment_versions, policy within_areas_of_their_file reads through something else than the building block: true',
      'table attachment_versions, policy within_areas_of_their_file writes through something else than the building block: true',
    ])
    expect(await areaBoundaryProblems(admin)).toEqual([])
  })
})

describe('a substitution', () => {
  it('shows the substitute the areas of the absent person on its days and on no other', async () => {
    const { yesterday, today, tomorrow } = await days()
    const seenBySouth = () => areasSeen('rooms', person.south)

    expect(
      await whileStandingIn(
        { substitute: person.south, absent: person.north, startsOn: today, endsOn: today },
        seenBySouth,
      ),
    ).toEqual(['north', 'south'])
    expect(
      await whileStandingIn(
        { substitute: person.south, absent: person.north, startsOn: yesterday, endsOn: yesterday },
        seenBySouth,
      ),
    ).toEqual(['south'])
    expect(
      await whileStandingIn(
        { substitute: person.south, absent: person.north, startsOn: tomorrow, endsOn: tomorrow },
        seenBySouth,
      ),
    ).toEqual(['south'])

    // And the absent person keeps seeing what they saw.
    expect(
      await whileStandingIn(
        { substitute: person.south, absent: person.north, startsOn: today, endsOn: today },
        () => areasSeen('rooms', person.north),
      ),
    ).toEqual(['north'])
  })

  it('shows every area when the absent person sees every area', async () => {
    const { today } = await days()

    expect(
      await whileStandingIn(
        { substitute: person.unplaced, absent: person.lead, startsOn: today, endsOn: today },
        () => areasSeen('rooms', person.unplaced),
      ),
    ).toEqual(['north', 'south'])
  })

  /**
   * Somebody leaves, and the substitution takes over (section 1 of the
   * concept, scene 7): the absent person may be blocked meanwhile. The
   * substitute may not, a blocked person sees nothing at all.
   */
  it('outlives a block of the absent person and not one of the substitute', async () => {
    const { today } = await days()

    expect(
      await whileStandingIn(
        { substitute: person.unplaced, absent: person.blocked, startsOn: today, endsOn: today },
        () => areasSeen('rooms', person.unplaced),
      ),
    ).toEqual(['north'])
    expect(
      await whileStandingIn(
        { substitute: person.blocked, absent: person.south, startsOn: today, endsOn: today },
        () => areasSeen('rooms', person.blocked),
      ),
    ).toEqual([])
  })

  it('is refused for oneself and when it ends before it begins', async () => {
    const insert = (substitute: string, absent: string, startsOn: string, endsOn: string) =>
      refusedBy(
        admin.query(
          `insert into substitutions (tenant_id, substitute_user_id, absent_user_id, starts_on, ends_on)
           values ($1, $2, $3, $4, $5)`,
          [tenant, substitute, absent, startsOn, endsOn],
        ),
      )

    expect(await insert(person.south, person.south, '2026-10-05', '2026-10-09')).toEqual({
      code: '23514',
      constraint: 'substitutions_not_oneself',
    })
    expect(await insert(person.south, person.north, '2026-10-09', '2026-10-05')).toEqual({
      code: '23514',
      constraint: 'substitutions_in_order',
    })
  })
})

describe('a run in the background', () => {
  it('sees every area when it says so, and that ends with its transaction', async () => {
    expect(await areasSeen('rooms', undefined, { background: true })).toEqual(['north', 'south'])

    // The setting is local to the transaction: the connection goes back to the
    // pool without it, and the next transaction without a person sees nothing.
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await areasSeen('rooms', undefined)).toEqual([])
    }
  })
})

describe('a new membership', () => {
  /** A tenant of its own, with the given areas, put in past the application. */
  async function freshTenant(areas: readonly string[]): Promise<TenantId> {
    const id = newId<'tenant'>()

    await admin.query('insert into tenants (id, name) values ($1, $2)', [id, `Betreiber ${id}`])

    for (const name of areas) {
      await admin.query('insert into areas (tenant_id, name) values ($1, $2)', [id, name])
    }

    return id
  }

  /** An account, and its membership written the way the foundation writes it: inside the tenant, as the application. */
  async function joins(tenantId: TenantId, roles: readonly string[]): Promise<string> {
    const userId = `user-${randomUUID()}`

    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@beispiel.example`,
    ])
    await database.forInstanceAndTenant('membership.create', async ({ tx, enter }) => {
      await enter(tenantId, userId)
      await grantMembership(tx, { tenantId, userId, roles })
    })

    return userId
  }

  /** What a person was given: every area, or the names of the areas named for them. */
  async function givenTo(tenantId: TenantId, userId: string): Promise<string | string[]> {
    const { rows: every } = await admin.query(
      'select 1 from member_all_areas where tenant_id = $1 and user_id = $2',
      [tenantId, userId],
    )

    if (every.length > 0) {
      return 'every area'
    }

    const { rows } = await admin.query<{ name: string }>(
      `select a.name from member_areas m join areas a on a.id = m.area_id
        where m.tenant_id = $1 and m.user_id = $2 order by a.name`,
      [tenantId, userId],
    )

    return rows.map((row) => row.name)
  }

  it('gives a tenant its first area with its first member, and the log says on which way', async () => {
    const fresh = await freshTenant([])
    const lead = await joins(fresh, ['management'])

    const { rows: areas } = await admin.query<{ name: string }>(
      'select name from areas where tenant_id = $1',
      [fresh],
    )

    expect(areas).toEqual([{ name: firstAreaName }])
    expect(await givenTo(fresh, lead)).toBe('every area')

    // Written by the application role inside the tenant, so the log of the
    // tenant has it, with the reason of the transaction that made the member.
    const { rows: logged } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and table_name in ('areas', 'member_all_areas', 'member_areas')
        order by table_name`,
      [fresh],
    )

    expect(logged).toEqual([
      { table_name: 'areas', reason: 'membership.create' },
      { table_name: 'member_all_areas', reason: 'membership.create' },
    ])
  })

  /** The list in `domain` and the one in the database, role by role. */
  it('gives every area to the roles that see every area, and the one area to the others', async () => {
    const outcome: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const role of shippedRoles) {
      const fresh = await freshTenant(['Nord'])

      outcome[role.key] = await givenTo(fresh, await joins(fresh, [role.key]))
      expected[role.key] = rolesSeeingEveryArea.includes(role.key) ? 'every area' : ['Nord']
    }

    expect(outcome).toEqual(expected)
  })

  it('gives nobody an area unasked once a tenant has two', async () => {
    const fresh = await freshTenant(['Nord', 'Süd'])

    expect(await givenTo(fresh, await joins(fresh, ['technician']))).toEqual([])
    expect(await givenTo(fresh, await joins(fresh, ['technical_management']))).toBe('every area')
  })

  /**
   * A default when a membership is made, and only then: somebody let back in,
   * the way add-staff lets in whoever shut themselves out, keeps the areas
   * they had, also when the Leitung had taken the last one away.
   */
  it('leaves the areas of a membership that is let back in as they were', async () => {
    const fresh = await freshTenant([])
    const member = await joins(fresh, ['technician'])

    expect(await givenTo(fresh, member)).toEqual([firstAreaName])

    await admin.query('delete from member_areas where tenant_id = $1 and user_id = $2', [
      fresh,
      member,
    ])
    await database.forInstanceAndTenant('membership.create', async ({ tx, enter }) => {
      await enter(fresh, member)
      await grantMembership(tx, { tenantId: fresh, userId: member, roles: ['technician'] })
    })

    expect(await givenTo(fresh, member)).toEqual([])

    // And the tenant still has its one first area, not a second beside it.
    const { rows } = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from areas where tenant_id = $1',
      [fresh],
    )

    expect(rows).toEqual([{ rows: 1 }])
  })
})

describe('the name of an area', () => {
  /** An area put in past the application, and what the database said to it. */
  const named = (tenantId: TenantId, name: string) =>
    refusedBy(admin.query('insert into areas (tenant_id, name) values ($1, $2)', [tenantId, name]))

  it('is held to what `areaNameProblem` asks, for every other way in', async () => {
    expect(await named(tenant, ' Nord-Ost')).toEqual({
      code: '23514',
      constraint: 'areas_name_shaped',
    })
    expect(await named(tenant, '')).toEqual({ code: '23514', constraint: 'areas_name_shaped' })
    expect(await named(tenant, 'x'.repeat(121))).toEqual({
      code: '23514',
      constraint: 'areas_name_shaped',
    })
  })

  it('stands once in a tenant whatever its case, and once more in the next one', async () => {
    expect(await named(tenant, 'NORD')).toEqual({ code: '23505', constraint: 'areas_name_once' })

    const next = newId<'tenant'>()

    await admin.query('insert into tenants (id, name) values ($1, $2)', [next, 'Wohnbau Ost eG'])
    await admin.query('insert into areas (tenant_id, name) values ($1, $2)', [next, 'Nord'])

    const { rows } = await admin.query<{ rows: number }>(
      `select count(*)::int as rows from areas where lower(name) = 'nord' and tenant_id = any ($1::uuid[])`,
      [[tenant, next]],
    )

    expect(rows).toEqual([{ rows: 2 }])
  })
})

describe('the catalogue', () => {
  it('finds the line between the areas on every table with a place', async () => {
    expect(await areaBoundaryProblems(admin)).toEqual([])
  })

  /** A table built for one check by the owner, and dropped again after it. */
  async function problemsWith(statements: readonly string[], table: string): Promise<string[]> {
    await asOwner(statements)

    try {
      return await areaBoundaryProblems(admin)
    } finally {
      await owner.query(`drop table ${table}`)
    }
  }

  const columns = `id uuid PRIMARY KEY DEFAULT uuidv7(),
     tenant_id uuid NOT NULL REFERENCES tenants (id),
     property_id uuid NOT NULL,
     area_id uuid NOT NULL`
  const follows = `CONSTRAINT probe_more_follows FOREIGN KEY (tenant_id, property_id, area_id)
       REFERENCES properties (tenant_id, id, area_id) ON UPDATE CASCADE`

  /**
   * The counterproof: each of the ways ADR 0003 names for a table with a place
   * to go wrong, and the check names each of them. A check that found nothing
   * because it looked at nothing would pass the test above as well.
   */
  it('refuses a table with a place that lacks any part of the line', async () => {
    expect(
      await problemsWith(
        [
          `CREATE TABLE probe_more (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, property_id uuid NOT NULL)`,
          ...protections('probe_more', { line: null }),
        ],
        'probe_more',
      ),
    ).toEqual(['table probe_more: carries property_id and no area_id'])

    expect(
      await problemsWith(
        [
          `CREATE TABLE probe_more (${columns},
             CONSTRAINT probe_more_follows FOREIGN KEY (tenant_id, property_id, area_id)
               REFERENCES properties (tenant_id, id, area_id))`,
          ...protections('probe_more'),
        ],
        'probe_more',
      ),
    ).toEqual([
      'table probe_more: no key over (tenant_id, property_id, area_id) to properties with ON UPDATE CASCADE',
    ])

    expect(
      await problemsWith(
        [
          `CREATE TABLE probe_more (${columns}, ${follows})`,
          ...protections('probe_more', { line: null }),
        ],
        'probe_more',
      ),
    ).toEqual(['table probe_more: carries area_id and no policy within_areas'])

    expect(
      await problemsWith(
        [
          `CREATE TABLE probe_more (${columns}, ${follows})`,
          ...protections('probe_more', { as: 'PERMISSIVE' }),
        ],
        'probe_more',
      ),
    ).toEqual([
      'table probe_more, policy within_areas: not restrictive for every command, so another policy can widen it',
    ])
  })

  it('refuses a policy that calls the functions for every row', async () => {
    const direct = 'session_sees_all_areas() OR area_id = ANY (session_areas())'

    expect(
      await problemsWith(
        [
          `CREATE TABLE probe_more (${columns}, ${follows})`,
          ...protections('probe_more', { line: direct }),
        ],
        'probe_more',
      ),
    ).toEqual([
      'table probe_more, policy within_areas reads through a direct call of the functions, which runs them for every row: (session_sees_all_areas() OR (area_id = ANY (session_areas())))',
      'table probe_more, policy within_areas writes through a direct call of the functions, which runs them for every row: (session_sees_all_areas() OR (area_id = ANY (session_areas())))',
    ])
  })

  it('refuses a key that hangs a row on a place without running over the property', async () => {
    expect(
      await problemsWith(
        [
          `CREATE TABLE probe_more (${columns},
             room_id uuid NOT NULL,
             ${follows},
             CONSTRAINT probe_more_of_a_room FOREIGN KEY (room_id) REFERENCES rooms (id))`,
          ...protections('probe_more'),
        ],
        'probe_more',
      ),
    ).toEqual([
      'table probe_more, key probe_more_of_a_room: points at rooms, which has an area, without running over tenant_id and property_id',
    ])
  })
})

describe('what the line costs', () => {
  /**
   * The measurement of ADR 0003, point 9, repeated as a test. Time is a
   * property of the machine; the number of buffers a statement reads is a
   * property of the plan, and that is what turns a direct call into one query
   * per row. The same assets three times over, two tenants with four areas,
   * twenty properties and six thousand assets each: under the policy of the
   * tenant alone, under the building block, and under the direct call the
   * catalogue refuses, as the counterproof that the measurement can tell the
   * two apart.
   */
  it('is a few buffers per statement, and not one query per row', async () => {
    const measured = newId<'tenant'>()
    const beside = newId<'tenant'>()
    const technician = 'user-measured'
    const variants = {
      bare: null,
      block: withinAreasExpression,
      direct: 'session_sees_all_areas() OR area_id = ANY (session_areas())',
    } as const

    for (const [id, name] of [
      [measured, 'Gemessen eG'],
      [beside, 'Daneben eG'],
    ] as const) {
      await admin.query('insert into tenants (id, name) values ($1, $2)', [id, name])
      await admin.query(
        `insert into areas (tenant_id, name) select $1, 'Bereich ' || n from generate_series(1, 4) as n`,
        [id],
      )
    }

    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      technician,
      'gemessen@beispiel.example',
    ])
    await admin.query(
      `insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{technician}')`,
      [measured, technician],
    )
    await admin.query(
      `insert into member_areas (tenant_id, user_id, area_id)
       select $1, $2, id from areas where tenant_id = $1 and name = 'Bereich 1'`,
      [measured, technician],
    )

    for (const [variant, line] of Object.entries(variants)) {
      await asOwner([
        `CREATE TABLE measure_${variant} (
           id uuid PRIMARY KEY DEFAULT uuidv7(),
           tenant_id uuid NOT NULL,
           property_id uuid NOT NULL,
           area_id uuid NOT NULL,
           name text NOT NULL
         )`,
        ...protections(`measure_${variant}`, { line }),
      ])
    }

    try {
      await admin.query(
        `with places as (
           select a.tenant_id, gen_random_uuid() as property_id, a.id as area_id
             from areas a, generate_series(1, 5)
            where a.tenant_id = any ($1::uuid[])
         )
         insert into measure_bare (tenant_id, property_id, area_id, name)
         select tenant_id, property_id, area_id, 'Anlage ' || n from places, generate_series(1, 300) as n`,
        [[measured, beside]],
      )
      await admin.query('insert into measure_block select * from measure_bare')
      await admin.query('insert into measure_direct select * from measure_bare')
      await admin.query('analyze measure_bare, measure_block, measure_direct')

      const buffers: Record<string, number> = {}
      const counted: Record<string, number> = {}

      for (const variant of Object.keys(variants)) {
        // Twice, and the second one counts: the first call of a function in a
        // session reads the catalogue to find it.
        for (let run = 0; run < 2; run++) {
          const plan = await database.forTenant({ tenantId: measured, userId: technician }, (tx) =>
            tx.execute<{ 'QUERY PLAN': [{ Plan: Record<string, number> }] }>(
              sql.raw(
                `explain (analyze, buffers, format json) select count(*) from measure_${variant}`,
              ),
            ),
          )
          const top = plan.rows[0]?.['QUERY PLAN'][0].Plan ?? {}

          buffers[variant] = (top['Shared Hit Blocks'] ?? 0) + (top['Shared Read Blocks'] ?? 0)
        }

        const { rows } = await database.forTenant(
          { tenantId: measured, userId: technician },
          (tx) =>
            tx.execute<{ rows: number }>(
              sql.raw(`select count(*)::int as rows from measure_${variant}`),
            ),
        )

        counted[variant] = rows[0]?.rows ?? -1
      }

      // The tenant has six thousand assets; the technician sees the quarter in
      // their area, and everything where only the tenant draws a line.
      expect(counted).toEqual({ bare: 6000, block: 1500, direct: 1500 })

      const { bare = 0, block = 0, direct = 0 } = buffers

      // The building block reads what the table has and a handful of pages of
      // the tables the functions ask, once.
      expect(block - bare).toBeLessThan(50)
      // Called directly, the functions ask those tables for each of the twelve
      // thousand rows the scan reads.
      expect(direct).toBeGreaterThan(20 * block)
    } finally {
      await owner.query('drop table measure_bare, measure_block, measure_direct')
    }
  })
})
