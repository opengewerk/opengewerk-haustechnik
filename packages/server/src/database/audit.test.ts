import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { numberRanges, secrets } from './schema/index.js'
import {
  applicationDatabaseUrl,
  applicationRole,
  auditEntryColumns,
  columnNames,
  connect,
  foundationOutsideTheLog,
  instanceLogCoverage,
  logCoverage,
  resetToMigrated,
  unstampedTables,
} from './test-database.js'

/**
 * The log of a tenant in this database: which tables it watches, that its
 * entries keep their shape, and that a change through the application lands
 * in it. How the log is written and chained is the foundation's and is held
 * there. What is held here is that this application's migrations put it on
 * the tables it belongs on, and that a table a later migration adds does not
 * come without it.
 */

const tenant: { readonly id: TenantId; readonly name: string } = {
  id: newId<'tenant'>(),
  name: 'Wohnbau Nord eG',
}

/**
 * What stays out of the log in this application, beyond what the foundation
 * keeps out everywhere: the log itself, the sync layer, the accounts, what
 * belongs to the instance and the passes of the deadline engine, which would
 * fill it once a minute.
 *
 * `secrets` is the one table of a tenant this application adds without the
 * trigger. The log writes every value it sees, and a sealed value written
 * there would stay for as long as the log is kept, which is longer than any
 * credential should live.
 */
const outsideTheLog = {
  prefixes: [...foundationOutsideTheLog.prefixes],
  tables: [...foundationOutsideTheLog.tables, 'secrets'],
}

let admin: Pool
let database: Database

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  // A tenant is not something the application role creates.
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant.id, tenant.name])

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the tables', () => {
  it('are watched by the log of their tenant, all but the ones on the list', async () => {
    // Asked of the catalogue: a table of a tenant that a later migration adds
    // without the trigger turns this red, and so does one that is put on the
    // list above without a reason anybody wrote down.
    const coverage = await logCoverage(admin, outsideTheLog)

    // A floor, so that a query that finds nothing cannot pass: the first
    // migration puts the trigger on seven tables.
    expect(coverage.watched.length).toBeGreaterThanOrEqual(7)
    expect(coverage.unwatched).toEqual([])
  })

  it('leave the log itself alone, so that it does not log its own logging', async () => {
    const coverage = await logCoverage(admin, outsideTheLog)

    expect(coverage.watchedAgainstTheList).toEqual([])
  })

  it('give what belongs to the instance a log of its own, and the tenants coming and going too', async () => {
    // Who runs the instance and its settings, and `tenants` for a tenant
    // being created or removed. The log of the instance itself is what is
    // written, so it carries no writer.
    expect(await instanceLogCoverage(admin)).toEqual([
      'instance_operators',
      'instance_settings',
      'tenants',
    ])
  })

  it('carry the stamp wherever their rows travel to a device', async () => {
    // No table of the first migration travels. The first one that does comes
    // with the trigger that keeps its version and its change number true, or
    // it is named here.
    expect(await unstampedTables(admin)).toEqual([])
  })
})

describe('the shape of an entry', () => {
  it('is frozen, because the chain is hashed over the whole row', async () => {
    // One more column changes the text form of every entry that is already
    // there, and a chain that was sound reports a break at entry one. On an
    // installation that has been running, an update with one extra column
    // here would tell a tenant its log had been tampered with.
    //
    // The list is the foundation's (ADR 0010 in the repository opengewerk,
    // point 9): the columns and the fingerprint are the same in every
    // application that carries the log.
    expect(await columnNames(admin, 'audit_entries')).toEqual(auditEntryColumns)
  })
})

describe('a change through the application', () => {
  it('lands in the log of the tenant field by field, with who and why, and the chain holds', async () => {
    const [counter] = await database.forTenant(
      { tenantId: tenant.id, userId: 'user-north', reason: 'number-range.write' },
      (tx) =>
        tx
          .insert(numberRanges)
          .values({ tenantId: tenant.id, key: 'asset', pattern: 'A-{number:5}' })
          .returning({ id: numberRanges.id }),
    )

    const { rows: entries } = await admin.query<{
      field: string
      new_value: string | null
      operation: string
      user_id: string | null
      reason: string | null
      database_role: string
    }>(
      `select field, new_value, operation, user_id, reason, database_role
         from audit_entries
        where tenant_id = $1 and table_name = 'number_ranges' and record_id = $2
        order by sequence`,
      [tenant.id, counter?.id],
    )
    const byField = new Map(entries.map((entry) => [entry.field, entry]))

    expect(byField.get('pattern')).toEqual({
      field: 'pattern',
      new_value: 'A-{number:5}',
      operation: 'insert',
      user_id: 'user-north',
      reason: 'number-range.write',
      database_role: applicationRole,
    })
    expect(byField.get('key')?.new_value).toBe('asset')
    expect(byField.get('next_value')?.new_value).toBe('1')

    // A column that moves on every write says nothing the entry does not
    // already say better, and stays out.
    expect(byField.has('updated_at')).toBe(false)

    // The tenant checks its own chain, as the application and from inside:
    // the creation of the tenant is in it, and the counter after it.
    const checked = await database.forTenant({ tenantId: tenant.id }, (tx) =>
      tx.execute<{ checked: string; broken_at: string | null; problem: string | null }>(
        sql`select checked, broken_at, problem from verify_audit_chain(${tenant.id})`,
      ),
    )

    expect(checked.rows).toHaveLength(1)
    expect(checked.rows[0]).toMatchObject({ broken_at: null, problem: null })
    expect(Number(checked.rows[0]?.checked)).toBeGreaterThanOrEqual(entries.length + 1)
  })

  it('leaves what a tenant hands over to be kept sealed out of the log', async () => {
    const sealed = 'sealed-value-that-must-not-be-copied'

    await database.forTenant({ tenantId: tenant.id, userId: 'user-north' }, (tx) =>
      tx.insert(secrets).values({ tenantId: tenant.id, purpose: 'smtp_password', sealed }),
    )

    // The row is there, and the log does not know of it: neither the table
    // nor the value, in any entry of any table.
    const { rows: kept } = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from secrets where tenant_id = $1',
      [tenant.id],
    )
    const { rows: logged } = await admin.query<{ rows: number }>(
      `select count(*)::int as rows from audit_entries
        where table_name = 'secrets'
           or position($1 in coalesce(new_value, '')) > 0
           or position($1 in coalesce(old_value, '')) > 0`,
      [sealed],
    )

    expect(kept).toEqual([{ rows: 1 }])
    expect(logged).toEqual([{ rows: 0 }])
  })
})
