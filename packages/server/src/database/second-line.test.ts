import { leadingRights, offerableRights, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from './test-database.js'
import { insertOf, rowsOf, rowsOfTheInstance, type Tenant } from './test-tenant-rows.js'

/**
 * The second line of the database where the server alone held the first
 * (#534, with #539; migration 0110): a role of the operator's own neither
 * leads nor holds a right that stays with the Leitung, past every route, and
 * after the last day of an access the tables without an area keep the
 * person out, as those with one do.
 */

const north: Tenant = {
  id: newId<'tenant'>(),
  name: 'Wohnbau Nord eG',
  userId: 'user-north',
  email: 'leitung@nord.example',
  colleagueId: 'colleague-north',
}
const south: Tenant = {
  id: newId<'tenant'>(),
  name: 'Wohnbau Süd eG',
  userId: 'user-south',
  email: 'leitung@sued.example',
  colleagueId: 'colleague-south',
}

/** The tables without an area that keep a person out after the last day (#539). */
const withoutAnArea = [
  'suppliers',
  'articles',
  'stores',
  'store_articles',
  'stock_movements',
  'store_labels',
  'contractors',
  'contracts',
  'qualification_kinds',
  'qualifications',
  'duty_delegations',
  'duty_delegation_areas',
  'duty_delegation_signatures',
  'duty_delegation_revocations',
]

/** The tables whose rows lie in no area where they hang on a contractor. */
const partlyWithoutAnArea = ['contacts', 'attachments', 'deadlines']

let admin: Pool
let database: Database

/** What the database answers a statement of a person of an operator: its class, or that it wrote. */
async function answerTo(tenantId: TenantId, userId: string, statement: SQL): Promise<string> {
  try {
    await database.forTenant({ tenantId, userId }, (tx) => tx.execute(statement))
  } catch (error) {
    return (
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code ??
      'thrown'
    )
  }

  return 'written'
}

/** How many rows a person of the north reads of a table, those in no area where the table has an area. */
async function readBy(userId: string, table: string): Promise<number> {
  const inNoArea = partlyWithoutAnArea.includes(table) ? ' where area_id is null' : ''
  const { rows } = await database.forTenant({ tenantId: north.id, userId }, (tx) =>
    tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${table}"${inNoArea}`)),
  )

  return rows[0]?.n ?? -1
}

async function lastDay(userId: string, day: string | null): Promise<void> {
  await admin.query('update memberships set last_day = $3 where tenant_id = $1 and user_id = $2', [
    north.id,
    userId,
    day,
  ])
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  const asAdmin = drizzle(admin)

  for (const row of rowsOfTheInstance(north, south)) {
    await asAdmin.execute(insertOf(row))
  }

  for (const tenant of [north, south]) {
    for (const row of rowsOf(tenant)) {
      if (row.table !== 'audit_redactions') {
        await asAdmin.execute(insertOf(row))
      }
    }
  }

  // A contact of a contractor of the north, which lies in no area.
  await admin.query(
    `insert into contacts (tenant_id, contractor_id, family_name, role)
     select tenant_id, id, 'Weber', 'Bauleitung' from contractors where tenant_id = $1 limit 1`,
    [north.id],
  )

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a role of the operator own', () => {
  const ownRole = (key: string, rights: readonly string[], leads = false) =>
    sql`insert into tenant_roles (tenant_id, key, label, rights, leads, offered_rights)
        values (${north.id}, ${key}, ${`Rolle ${key}`}, ${sql.raw(`array[${rights.map((right) => `'${right}'`).join(',')}]::text[]`)}, ${leads}, '{}')`

  it('does not lead the operator, past every route (#534)', async () => {
    expect(await answerTo(north.id, north.userId, ownRole('zweite-leitung', [], true))).toBe(
      'HT019',
    )
  })

  it('holds no right that stays with the Leitung, when it is added or changed (#534)', async () => {
    for (const right of leadingRights) {
      expect(
        await answerTo(north.id, north.userId, ownRole(`mit-${right.replace('.', '-')}`, [right])),
        right,
      ).toBe('HT019')
    }

    // Every right a role of its own may hold, all at once.
    expect(await answerTo(north.id, north.userId, ownRole('alles-andere', offerableRights))).toBe(
      'written',
    )
    expect(
      await answerTo(
        north.id,
        north.userId,
        sql`update tenant_roles set rights = array_append(rights, 'audit.read') where key = 'alles-andere'`,
      ),
    ).toBe('HT019')
  })

  it('leads an operator when it is its first, as a new operator gets its roles', async () => {
    const newcomer = newId<'tenant'>() as TenantId

    await admin.query('insert into tenants (id, name) values ($1, $2)', [newcomer, 'Neu eG'])

    expect(
      await answerTo(
        newcomer,
        north.userId,
        sql`insert into tenant_roles (tenant_id, key, label, rights, leads)
            values (${newcomer}, 'management', 'Leitung', array['audit.read']::text[], true)`,
      ),
    ).toBe('written')
  })
})

describe('a person after the last day of an access', () => {
  it('reads nothing of the tables without an area any more, as of those with one (#539)', async () => {
    await lastDay(north.colleagueId, null)

    const before = new Map<string, number>()

    for (const table of [...withoutAnArea, ...partlyWithoutAnArea]) {
      before.set(table, await readBy(north.colleagueId, table))
    }

    // A floor: the person reads something of every table while the access holds.
    expect([...before].filter(([, n]) => n < 1)).toEqual([])

    await lastDay(north.colleagueId, '2020-01-01')

    const after: [string, number][] = []

    for (const table of [...withoutAnArea, ...partlyWithoutAnArea]) {
      after.push([table, await readBy(north.colleagueId, table)])
    }

    expect(after.filter(([, n]) => n !== 0)).toEqual([])
    // Whoever still works here reads them as before.
    expect(await readBy(north.userId, 'contractors')).toBe(before.get('contractors'))

    await lastDay(north.colleagueId, null)
  })

  it('writes nothing into them either', async () => {
    await lastDay(north.colleagueId, '2020-01-01')

    expect(
      await answerTo(
        north.id,
        north.colleagueId,
        sql`insert into suppliers (tenant_id, name) values (${north.id}, 'Großhandel Rhein')`,
      ),
    ).toBe('42501')

    await lastDay(north.colleagueId, null)
  })

  it('stands as a policy on each of these tables, which the application role cannot leave', async () => {
    const { rows } = await admin.query<{ table: string }>(
      `select c.relname as table from pg_policy p join pg_class c on c.oid = p.polrelid
        where p.polname = 'within_access' and not p.polpermissive
        order by c.relname`,
    )

    expect(rows.map((row) => row.table)).toEqual([...withoutAnArea, ...partlyWithoutAnArea].sort())
  })
})
