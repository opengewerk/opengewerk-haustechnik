import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from './test-database.js'

/**
 * What migration 0022 does to the log of a tenant (#100, section 11 of the
 * concept): an import is one entry, the row in `imports`, and the places and
 * assets written beside it make none.
 *
 * The log is silent about a record in one case and in no other: inside the
 * transaction that wrote the row of the import it names. Held here is the
 * function that says so, case by case, and that the condition stands on the
 * five tables an import writes and nowhere else. Everything that does not fit
 * is logged as always: the condition fails on the side of more log.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()

/** Somebody who leads the tenant, and so holds in every area of it. */
const lead = { tenantId: tenant, userId: 'user-lead' }

let admin: Pool
let database: Database
let area = ''

/** The row of an import, written by the transaction. Hands back its id. */
async function importRow(tx: TenantTransaction, fileName: string): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`insert into imports (tenant_id, kind, file_name, lines, summary)
        values (${tenant}, 'structure', ${fileName}, 1, '1 Liegenschaft angelegt') returning id`,
  )

  return rows[0]?.id ?? ''
}

/** Names an import to the transaction, as the server does after writing its row. */
async function name(tx: TenantTransaction, importId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.import_id', ${importId}, true)`)
}

async function writing(tx: TenantTransaction): Promise<boolean> {
  const { rows } = await tx.execute<{ writing: boolean }>(sql`select import_writing() as writing`)

  return rows[0]?.writing ?? true
}

/** A property written by the transaction. Hands back its id. */
async function property(tx: TenantTransaction, called: string): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
        values (${tenant}, ${area}, ${called}, 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW')
        returning id`,
  )

  return rows[0]?.id ?? ''
}

/** How many entries the log holds about a record. */
async function entriesAbout(recordId: string): Promise<number> {
  const { rows } = await admin.query<{ entries: number }>(
    'select count(*)::int as entries from audit_entries where record_id = $1',
    [recordId],
  )

  return rows[0]?.entries ?? 0
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    tenant,
    'Wohnbau Nord eG',
    other,
    'Wohnbau Süd eG',
  ])
  await admin.query(
    `insert into auth_users (id, name, email) values ('user-lead', 'Lea Leitung', 'lea@nord.example.de')`,
  )
  // The first membership gives the tenant its area, and whoever leads holds in it.
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, 'user-lead', '{management}')`,
    [tenant],
  )

  const { rows } = await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [
    tenant,
  ])

  area = rows[0]?.id ?? ''
  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the triggers of the log', () => {
  it('carry the condition on the five tables an import writes, and on no other', async () => {
    const { rows } = await admin.query<{
      table_name: string
      conditional: boolean
      definition: string
    }>(
      `select c.relname as table_name, t.tgqual is not null as conditional,
              pg_get_triggerdef(t.oid) as definition
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and p.proname = 'record_change'
        order by c.relname`,
    )
    const conditional = rows.filter((row) => row.conditional)
    const always = rows.filter((row) => !row.conditional).map((row) => row.table_name)

    expect(conditional.map((row) => row.table_name)).toEqual([
      'assets',
      'buildings',
      'floors',
      'properties',
      'rooms',
    ])

    for (const row of conditional) {
      expect(row.definition).toMatch(
        / AFTER INSERT OR DELETE OR UPDATE ON public\.\w+ FOR EACH ROW WHEN \(\(NOT import_writing\(\)\)\) EXECUTE FUNCTION record_change\(\)$/,
      )
    }

    // A floor, so that a query that finds nothing cannot pass: the log
    // watches far more tables than these five, the row of an import and the
    // counter of the numbers among them, and each of those without a condition.
    expect(always.length).toBeGreaterThanOrEqual(20)
    expect(always).toEqual(
      expect.arrayContaining(['imports', 'asset_kind_names', 'number_ranges', 'areas', 'labels']),
    )
  })
})

describe('whether a transaction writes the records of an import', () => {
  it('is no, where nothing is named or what is named is no import', async () => {
    await database.forTenant(lead, async (tx) => {
      expect(await writing(tx)).toBe(false)

      await name(tx, '')
      expect(await writing(tx)).toBe(false)

      // An id that is nobody's row.
      await name(tx, newId<'import'>())
      expect(await writing(tx)).toBe(false)
    })
  })

  it('is yes inside the transaction that wrote the row it names, and the records beside it make no entry', async () => {
    const made = await database.forTenant(lead, async (tx) => {
      const importId = await importRow(tx, 'bestand.csv')

      // Written, and not yet named.
      expect(await writing(tx)).toBe(false)

      const before = await property(tx, 'Vor dem Namen')

      await name(tx, importId)
      expect(await writing(tx)).toBe(true)

      return { importId, before, after: await property(tx, 'Nach dem Namen') }
    })

    // The row of the import is in the log, and so is the record written
    // before the import was named. The one written after it is not.
    expect(await entriesAbout(made.importId)).toBeGreaterThan(0)
    expect(await entriesAbout(made.before)).toBeGreaterThan(0)
    expect(await entriesAbout(made.after)).toBe(0)

    // The record is there all the same, with what the sync stamps on it.
    const { rows } = await admin.query(
      'select name, version, change_sequence > 0 as stamped, updated_by from properties where id = $1',
      [made.after],
    )

    expect(rows).toEqual([
      { name: 'Nach dem Namen', version: 1, stamped: true, updated_by: 'user-lead' },
    ])
  })

  it('is no for a later transaction that names the row of an import that is done, and its records are logged', async () => {
    const importId = await database.forTenant(lead, (tx) => importRow(tx, 'von-gestern.csv'))
    const made = await database.forTenant(lead, async (tx) => {
      await name(tx, importId)
      expect(await writing(tx)).toBe(false)

      return property(tx, 'Am Import vorbei')
    })

    expect(await entriesAbout(made)).toBeGreaterThan(0)

    // The same for a change and for a removal of a record an import made.
    const quiet = await database.forTenant(lead, async (tx) => {
      const own = await importRow(tx, 'heute.csv')

      await name(tx, own)

      return property(tx, 'Aus dem Import')
    })

    expect(await entriesAbout(quiet)).toBe(0)

    await database.forTenant(lead, async (tx) => {
      await name(tx, importId)
      await tx.execute(sql`update properties set name = 'Umbenannt' where id = ${quiet}`)
    })

    const { rows } = await admin.query(
      `select operation::text as operation, field, old_value, new_value
         from audit_entries where record_id = $1`,
      [quiet],
    )

    expect(rows).toEqual([
      { operation: 'update', field: 'name', old_value: 'Aus dem Import', new_value: 'Umbenannt' },
    ])
  })

  it('is no behind a savepoint, where the row was written by a transaction within the transaction', async () => {
    const made = await database.forTenant(lead, async (tx) => {
      await tx.execute(sql`savepoint behind`)

      const importId = await importRow(tx, 'hinter-dem-sicherungspunkt.csv')

      await tx.execute(sql`release savepoint behind`)
      await name(tx, importId)
      expect(await writing(tx)).toBe(false)

      return property(tx, 'Hinter dem Sicherungspunkt')
    })

    expect(await entriesAbout(made)).toBeGreaterThan(0)
  })

  it('is no for the row of another tenant, also where no policy stands in the way', async () => {
    // The application role cannot write the row of another tenant at all, so
    // the case is asked as the superuser, whom no policy holds: a
    // transaction for the one tenant that has written and named an import of
    // the other.
    const client: PoolClient = await admin.connect()

    try {
      await client.query('begin')
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenant])

      const row = (tenantId: string) =>
        client.query<{ id: string }>(
          `insert into imports (tenant_id, kind, file_name, lines, summary)
           values ($1, 'assets', 'anlagen.csv', 1, '1 Anlage angelegt') returning id`,
          [tenantId],
        )
      const asked = async (importId: string | undefined) => {
        await client.query(`select set_config('app.import_id', $1, true)`, [importId])

        return (await client.query<{ writing: boolean }>('select import_writing() as writing'))
          .rows[0]?.writing
      }

      expect(await asked((await row(other)).rows[0]?.id)).toBe(false)
      // The same transaction with a row of its own tenant, so that the no above is about the tenant.
      expect(await asked((await row(tenant)).rows[0]?.id)).toBe(true)
    } finally {
      await client.query('rollback')
      client.release()
    }
  })
})

describe('the list of the imports', () => {
  it('is written once and read: the application neither changes nor removes a row', async () => {
    const importId = await database.forTenant(lead, (tx) => importRow(tx, 'bestand.csv'))

    for (const statement of [
      sql`update imports set summary = '2 Liegenschaften angelegt' where id = ${importId}`,
      sql`delete from imports where id = ${importId}`,
    ]) {
      const refusal = await database
        .forTenant(lead, (tx) => tx.execute(statement))
        .then(
          () => 'accepted',
          (error: unknown) =>
            String((error as { cause?: { code?: unknown } }).cause?.code ?? 'unknown'),
        )

      // insufficient_privilege: the role has no such right on the table.
      expect(refusal).toBe('42501')
    }

    const { rows } = await admin.query('select summary from imports where id = $1', [importId])

    expect(rows).toEqual([{ summary: '1 Liegenschaft angelegt' }])
  })
})
