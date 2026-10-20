import { Database, newId } from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  applicationRole,
  connect,
  foundationDefinerFunctions,
  insufficientPrivilege,
  keysBetweenTenantTables,
  readDefinerFunctions,
  readPolicies,
  refusedBy,
  resetToMigrated,
  tableProtections,
  unprotected,
  withoutTheTenant,
} from './test-database.js'
import { inEveryArea } from './every-area.js'
import { areaBoundaryProblems } from './test-areas.js'
import { insertOf, rowsOf, rowsOfTheInstance, type Tenant } from './test-tenant-rows.js'

/**
 * Row level security is a property of the database and not of the code above
 * it, so these tests talk to a real PostgreSQL through the role the
 * application uses. A superuser walks past every policy, which is exactly why
 * the application must never be one, and why a test run as one would prove
 * nothing.
 *
 * Two kinds of question are asked. The catalogue is asked what protects each
 * table, with the questions of the foundation (ADR 0010 in the repository
 * opengewerk). And two tenants are given a row in every table, to see what
 * each of them reaches: the catalogue says what should hold, the rows say
 * whether it does.
 *
 * A tenant is what the interface calls a "Betreiber". In the database it
 * keeps the name the foundation gives it.
 */

/**
 * A tenant, and the two people working for it: one stands in for the other,
 * which is the one row of a tenant that needs two.
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
const both = [north.id, south.id].sort()
/** A table as the catalogue knows it. */
interface CatalogueTable {
  readonly table: string
  /** The column that says whose row it is, or nothing: then it is the instance's. */
  readonly tenantColumn: 'tenant_id' | 'id' | null
  /** What the application role may do with it, as the grants say. */
  readonly mayInsert: boolean
  readonly mayDelete: boolean
  /** A column the role may update, to try an update with. */
  readonly updatable: string | null
}

/**
 * Every table in `public`, read from the catalogue and not from a list. A
 * list is complete on the day it is written; the catalogue knows the table a
 * later migration added.
 */
async function tablesInTheCatalogue(): Promise<CatalogueTable[]> {
  const { rows } = await admin.query<{
    table_name: string
    has_tenant: boolean
    may_insert: boolean
    may_delete: boolean
    updatable: string | null
  }>(
    `select c.relname as table_name,
            exists (
              select 1 from pg_attribute a
               where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
            ) as has_tenant,
            has_table_privilege($1, c.oid, 'INSERT') as may_insert,
            has_table_privilege($1, c.oid, 'DELETE') as may_delete,
            (select a.attname from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                and has_column_privilege($1, c.oid, a.attnum, 'UPDATE')
              order by a.attnum
              limit 1) as updatable
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
      order by c.relname`,
    [applicationRole],
  )

  return rows.map((row) => ({
    table: row.table_name,
    tenantColumn: row.has_tenant ? 'tenant_id' : row.table_name === 'tenants' ? 'id' : null,
    mayInsert: row.may_insert,
    mayDelete: row.may_delete,
    updatable: row.updatable,
  }))
}

async function tablesOfATenant(): Promise<(CatalogueTable & { tenantColumn: string })[]> {
  const tables = await tablesInTheCatalogue()

  return tables.filter(
    (table): table is CatalogueTable & { tenantColumn: string } => table.tenantColumn !== null,
  )
}

/** The tenants whose rows a query came back with, each once. */
function tenantsIn(rows: readonly { tenant: string }[]): string[] {
  return [...new Set(rows.map((row) => row.tenant))].sort()
}

/**
 * Thrown at the end of a transaction that only wanted to see what a statement
 * finds: the transaction is rolled back, and what it found comes out with the
 * error.
 */
class TakenBack extends Error {
  constructor(readonly found: Readonly<Record<string, unknown>>) {
    super('Taken back on purpose')
  }
}

let admin: Pool
let database: Database

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  // The rows go in past the application: a tenant is not something its role
  // creates, and the accounts are written outside any tenant. What is asked
  // below is what the application reaches afterwards.
  const asAdmin = drizzle(admin)

  for (const row of rowsOfTheInstance(north, south)) {
    await asAdmin.execute(insertOf(row))
  }

  // The same rows on both sides, so that nothing passes by accident: if a
  // query came back with the rows of the wrong tenant, a count would not show
  // it.
  for (const tenant of [north, south]) {
    for (const row of rowsOf(tenant)) {
      if (row.table !== 'audit_redactions') {
        await asAdmin.execute(insertOf(row))
      }
    }

    await admin.query('select next_sync_sequence($1)', [tenant.id])
  }

  database = Database.connect(applicationDatabaseUrl())

  // A redaction goes in as the application writes one (#355): by whoever
  // leads the tenant, through the trigger that asks for that.
  for (const tenant of [north, south]) {
    await admin.query(
      `update memberships set roles = roles || array[(
          select key from tenant_roles where tenant_id = $1 and leads order by key limit 1)]
        where tenant_id = $1 and user_id = $2`,
      [tenant.id, tenant.colleagueId],
    )
    await database.forTenant(
      { tenantId: tenant.id, userId: tenant.colleagueId, reason: 'audit.redact' },
      (tx) =>
        tx.execute(sql`insert into audit_redactions (tenant_id, entry_id, side, reason, redacted_by)
          select tenant_id, id, 'new', 'Auskunft der Person', ${tenant.colleagueId}
            from audit_entries
           where tenant_id = ${tenant.id} and new_value is not null and table_name = 'processing_descriptions'
           order by sequence desc limit 1`),
    )
  }
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the tables', () => {
  it('all have row level security enabled and forced, with a policy and a grant', async () => {
    // The check that keeps this working. A table added by a later migration
    // that forgets one of them is a leak nobody notices, because everything
    // still works: its rows are simply there for everyone.
    const tables = await tableProtections(admin)

    // A floor, so that a query that finds nothing cannot pass as "no table
    // unprotected": the first migration alone creates 23.
    expect(tables.length).toBeGreaterThanOrEqual(23)
    expect(unprotected(tables)).toEqual([])
  })

  /**
   * The test above asks whether a table has a policy, not what the policy
   * says. One with `using (true)`, or one that compares against the wrong
   * setting, passes it and opens the table to every tenant. This reads the
   * expression of every policy the application falls under and holds it
   * against the one comparison that is allowed: the tenant of the row against
   * the tenant of the transaction.
   */
  it('let the application reach a row only through the tenant of the transaction', async () => {
    // The exceptions are the two of the foundation, the chooser after a sign
    // in, which reads its memberships and the names of its tenants outside
    // any tenant. This application has added none of its own.
    const reading = await readPolicies(admin)

    // 13 tables carry a tenant after the first migration.
    expect(reading.tables).toBeGreaterThanOrEqual(13)
    expect(reading.violations).toEqual([])
    expect(reading.stale).toEqual([])
  })

  /**
   * A function that runs as its definer runs as the owner of the tables,
   * whoever calls it, and so walks past every policy above. Each of them was
   * opened on purpose for one question and is on the list of the foundation
   * with its reason. This application has added one: a migration that adds
   * another, or leaves one behind it meant to replace, turns this red, and
   * the place for its reason is here.
   */
  it('let a function past the policies only where a list says why', async () => {
    expect(
      await readDefinerFunctions(admin, {
        ...foundationDefinerFunctions,
        'asset_duplicate_candidates(asked_serials text[], asked_marks text[])':
          'an asset taken stock of in one area, entered in the office or read in from a table may stand in another area already, and the policy of the areas hides it from whoever enters it; asked with lists, so that a table is one pass over the assets and not one per line, handed over are the few assets of the tenant of the transaction whose digits fit, and the server alone compares them',
        'label_state_in_tenant(asked text)':
          'a scan of a label in another area is told that it lies outside the areas of the person, not that no such label exists; one word, and the tenant is read from the transaction',
        'own_kind_uses()':
          'a kind or a field the operator added goes only while no asset uses it, and an asset in an area of somebody else uses it as well (#62); handed out are counts and the codes of the choices of a choice, for the tenant of the transaction, never a text an asset holds and never an id',
        'label_open_to_reports(asked text)':
          'the page of a label takes a report from somebody without an account (#332), who is in no tenant: the code alone has to find the operator and the area of a valid label at a room or an asset whose operator switched the page on; handed out are those two ids, to the server and never further, and nothing for every other code',
      }),
    ).toEqual({
      unexplained: [],
      stale: [],
      openToEveryRole: [],
    })
  })

  /**
   * A foreign key is checked past row level security: the database looks the
   * parent up as the owner of its table. A key on the id alone therefore
   * finds the record of any tenant, and a record of one could be hung on a
   * record of the next. Between two tables of a tenant the tenant comes first
   * on both sides.
   */
  it('run every key between two tables of a tenant over the tenant', async () => {
    const keys = await keysBetweenTenantTables(admin)

    // The passkey of a member points at the membership, the one such key of
    // the first migration.
    expect(keys.length).toBeGreaterThanOrEqual(1)

    // The one exception, the same as in the trades application (#349): the
    // key of the foundation from a circuit to its section pairs the section
    // with the board, and the circuit's key onto its board runs over the
    // tenant. The section belongs to that board, the board to the tenant of
    // the circuit, so the section does as well.
    expect(withoutTheTenant(keys).map((key) => key.key)).toEqual([
      'circuits_section_belongs_to_board',
    ])
  })

  /**
   * The second line, between the areas of a tenant (ADR 0003). A table with a
   * place that lacks any part of it turns this red; that the check finds what
   * it looks for is shown in `areas.test.ts`, on tables built to lack one part
   * each.
   */
  it('draw the line between the areas wherever a row has a place', async () => {
    const { rows } = await admin.query<{ tables: number }>(
      `select count(distinct polrelid)::int as tables from pg_policy where polname = 'within_areas'`,
    )

    // A floor, so that a check that finds no table with a place cannot pass:
    // the four levels of the place carry the line since #18, the assets, their
    // life cycle and their supplies since #20, the duties and the dismissed
    // proposals since #25, the activities with their duties and work orders
    // and the defects since #26.
    expect(rows[0]?.tables).toBeGreaterThanOrEqual(13)
    expect(await areaBoundaryProblems(admin)).toEqual([])
  })

  /**
   * What is removed by marking it (ADR 0002, point 17) carries `deleted_at`,
   * and the application may not delete it either: a row that is gone cannot
   * tell a device that it went, and the triggers that mark what hangs below a
   * row answer to the mark, not to a DELETE.
   */
  it('keep a row that is removed by marking out of reach of DELETE', async () => {
    const { rows } = await admin.query<{ table_name: string; deletable: boolean }>(
      `select table_name,
              has_table_privilege('opengewerk_app', format('%I.%I', table_schema, table_name), 'DELETE')
                as deletable
         from information_schema.columns
        where table_schema = 'public' and column_name = 'deleted_at'
        order by table_name`,
    )

    // A floor: the place since #18, the technology since #20, the duties and
    // the dismissed proposals since #25, the activities with their duties and
    // work orders and the defects since #26.
    expect(rows.length).toBeGreaterThanOrEqual(13)
    // The one exception, the content of an activity emptied with its last
    // evidence after the end of the retention (#409): there the lock of each
    // table refuses every other way, which `activity-emptying.test.ts` holds.
    expect(rows.filter((row) => row.deletable).map((row) => row.table_name)).toEqual([
      'activity_answers',
      'activity_signatures',
      'briefings',
      'service_reports',
      'work_order_decisions',
      'work_order_materials',
      'work_order_notes',
      'work_order_participants',
      'work_permits',
    ])
  })
})

/**
 * Every transaction below that reads or writes as a tenant does so in every
 * area of it (`inEveryArea`), so that what is seen or refused is the line
 * between the tenants and not the one between the areas, which
 * `areas.test.ts` holds.
 */
describe('a tenant', () => {
  /**
   * Table by table, and the tables come from the catalogue. A table of a
   * tenant in which one of the two has no row turns this red as well: an
   * empty table shows nobody anything, and would pass for well guarded.
   */
  it('sees its own rows in every table of a tenant, and no row of another', async () => {
    const tables = await tablesOfATenant()
    const seen: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    // A table whose rows a person reads only of their own, who stored which
    // file (#360), is read as the person its row names. Asked of the
    // catalogue, so that a table added later with such a policy is not empty
    // here by mistake.
    const personal = await admin.query<{ table: string }>(
      `select c.relname as table from pg_policy p join pg_class c on c.oid = p.polrelid
        where p.polname = 'held_by_the_person_asking'`,
    )
    const heldByThePerson = new Set(personal.rows.map((row) => row.table))

    for (const { table, tenantColumn } of tables) {
      const select = `select "${tenantColumn}"::text as tenant from "${table}"`
      const through = async (tenant: Tenant) => {
        const person = heldByThePerson.has(table) ? { userId: tenant.userId } : {}
        const result = await inEveryArea(database, { tenantId: tenant.id, ...person }, (tx) =>
          tx.execute<{ tenant: string }>(sql.raw(select)),
        )

        return tenantsIn(result.rows)
      }
      const held = await admin.query<{ tenant: string }>(select)

      seen[table] = {
        held: tenantsIn(held.rows),
        north: await through(north),
        south: await through(south),
      }
      expected[table] = { held: both, north: [north.id], south: [south.id] }
    }

    expect(tables.length).toBeGreaterThanOrEqual(13)
    expect(seen).toEqual(expected)
  })

  /**
   * The other half of the schema, from inside a tenant: the accounts and what
   * belongs to whoever runs the instance. They hold the people of every
   * tenant, so from inside one of them they are closed altogether. The names
   * of its own people a tenant gets by asking the instance for exactly the
   * accounts its memberships name, in a transaction outside any tenant.
   */
  it('sees no row of a table that belongs to the instance', async () => {
    const tables = (await tablesInTheCatalogue()).filter((table) => table.tenantColumn === null)
    const seen: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const { table } of tables) {
      const count = `select count(*)::int as rows from "${table}"`
      const held = await admin.query<{ rows: number }>(count)
      const inside = await database.forTenant({ tenantId: north.id }, (tx) =>
        tx.execute<{ rows: number }>(sql.raw(count)),
      )

      // Whether the table holds anything at all is part of the answer: an
      // empty one would show nothing to anybody.
      seen[table] = { holdsRows: (held.rows[0]?.rows ?? 0) > 0, fromInside: inside.rows[0]?.rows }
      expected[table] = { holdsRows: true, fromInside: 0 }
    }

    // The seven tables of the accounts and the three of the instance.
    expect(tables.length).toBeGreaterThanOrEqual(10)
    expect(seen).toEqual(expected)
  })

  /**
   * And the tables of a tenant from outside any tenant, where signing in
   * happens before anybody knows which tenant is meant. A policy that
   * compares a row against a tenant that was never set matches nothing, so
   * every one of them is empty there.
   */
  it('is not seen from outside any tenant, by somebody who is nobody yet', async () => {
    const tables = await tablesOfATenant()
    const seen: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const { table } of tables) {
      const outside = await database.forInstance((tx) =>
        tx.execute<{ rows: number }>(sql.raw(`select count(*)::int as rows from "${table}"`)),
      )

      seen[table] = outside.rows[0]?.rows
      expected[table] = 0
    }

    expect(seen).toEqual(expected)
  })

  /**
   * Writing, table by table. Where the application may insert at all, a row
   * that names the other tenant is refused by the policy. Where it may not,
   * the table is written by a trigger or a function alone, and the attempt
   * ends at the missing right. Both answer with the same code, so the
   * catalogue is asked which of the two it has to be.
   */
  it('cannot put a row into another tenant, in any table', async () => {
    const tables = await tablesOfATenant()
    const offered = new Map(rowsOf(south).map((row) => [row.table, row]))
    const outcome: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const { table, mayInsert } of tables) {
      const row = offered.get(table)

      if (mayInsert && !row) {
        // A table the application writes into and no row to try it with:
        // `rowsOf` is short one entry.
        outcome[table] = 'no row to try with'
      } else if (row) {
        const refusal = await refusedBy(
          inEveryArea(database, { tenantId: north.id }, (tx) => tx.execute(insertOf(row))),
        )

        outcome[table] = refusal.code
      } else {
        outcome[table] = 'written by a trigger or a function alone'
      }

      expected[table] =
        mayInsert || row ? insufficientPrivilege : 'written by a trigger or a function alone'
    }

    expect(outcome).toEqual(expected)

    // And nothing arrived: the other tenant holds what it held.
    const held = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from number_ranges where tenant_id = $1',
      [south.id],
    )

    expect(held.rows).toEqual([{ rows: 1 }])
  })

  /**
   * Changing and removing. The policy hides the rows of the other tenant from
   * an update and a delete as it hides them from a select, so both find
   * nothing to work on. Where the application may not update or delete at
   * all, the attempt ends at the missing right.
   */
  it('cannot change or remove a row of another tenant, in any table', async () => {
    const tables = await tablesOfATenant()
    const outcome: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    const asNorth = (statement: SQL) =>
      inEveryArea(database, { tenantId: north.id }, (tx) => tx.execute(statement))

    // What the catalogue says decides how an attempt is read: with the right,
    // it has to go through and find nothing; without it, it has to be refused.
    const attempt = async (permitted: boolean, statement: SQL): Promise<unknown> =>
      permitted ? (await asNorth(statement)).rowCount : (await refusedBy(asNorth(statement))).code

    for (const { table, tenantColumn, updatable, mayDelete } of tables) {
      const theirs = sql`${sql.identifier(tenantColumn)} = ${south.id}`
      const column = sql.identifier(updatable ?? tenantColumn)

      outcome[table] = {
        updated: await attempt(
          updatable !== null,
          sql`update ${sql.identifier(table)} set ${column} = ${column} where ${theirs}`,
        ),
        deleted: await attempt(
          mayDelete,
          sql`delete from ${sql.identifier(table)} where ${theirs}`,
        ),
      }
      expected[table] = {
        updated: updatable !== null ? 0 : insufficientPrivilege,
        deleted: mayDelete ? 0 : insufficientPrivilege,
      }
    }

    expect(outcome).toEqual(expected)

    // The same two statements find the rows when the tenant is the one they
    // belong to. Without this the zeros above could come from a statement
    // that matches nothing for anybody. Taken back again, so that the rows
    // stay for whichever test runs after this one.
    const own = await database
      .forTenant({ tenantId: south.id }, async (tx) => {
        const updated = await tx.execute(
          sql`update number_ranges set pattern = pattern where tenant_id = ${south.id}`,
        )
        const deleted = await tx.execute(sql`delete from secrets where tenant_id = ${south.id}`)

        throw new TakenBack({ updated: updated.rowCount, deleted: deleted.rowCount })
      })
      .catch((error: unknown) => {
        if (error instanceof TakenBack) {
          return error.found
        }

        throw error
      })

    expect(own).toEqual({ updated: 1, deleted: 1 })
  })
})
