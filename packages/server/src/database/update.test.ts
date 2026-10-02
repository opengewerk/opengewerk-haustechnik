import { rmSync } from 'node:fs'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from './migrations.js'
import { numberRanges } from './schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  enumValues,
  migrationsFolderUpTo,
  ownerDatabaseUrl,
  refusedBy,
  resetSchema,
  revertMigration,
} from './test-database.js'

// What an update does to a database that has been in use. The tests beside
// this one migrate an empty database, and an empty database forgives a
// migration almost anything: a statement that fails on a table with rows in
// it, or quietly takes some of them along, passes there. Here a database
// stands on an earlier release with rows of a tenant in it, and the update
// runs over that.

let admin: Pool
const folders: string[] = []

/** A folder built for one test, removed again after it. */
function kept(folder: string): string {
  folders.push(folder)

  return folder
}

/** A tenant with counters that have been drawn from, put in past the application. */
async function tenantWithCounters(
  counters: Readonly<Record<string, number>>,
): Promise<{ id: TenantId }> {
  const tenant = { id: newId<'tenant'>() }

  await admin.query('insert into tenants (id, name) values ($1, $2)', [
    tenant.id,
    'Wohnbau Nord eG',
  ])

  for (const [key, nextValue] of Object.entries(counters)) {
    await admin.query(
      'insert into number_ranges (tenant_id, key, pattern, next_value) values ($1, $2, $3, $4)',
      [tenant.id, key, `${key}-{number:4}`, nextValue],
    )
  }

  return tenant
}

/** The counters of a tenant as the database holds them, by sequence. */
async function countersOf(tenant: { id: TenantId }): Promise<Record<string, number>> {
  const { rows } = await admin.query<{ key: string; next_value: number }>(
    'select key::text as key, next_value from number_ranges where tenant_id = $1',
    [tenant.id],
  )

  return Object.fromEntries(rows.map((row) => [row.key, row.next_value]))
}

async function sequences(): Promise<string[] | undefined> {
  return (await enumValues(admin)).get('number_range_key')
}

beforeAll(async () => {
  admin = await connect()
})

beforeEach(async () => {
  await resetSchema(admin)
})

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

afterAll(async () => {
  await admin.end()
})

/**
 * The first migration created the sequences for assets and evidence and left
 * the one for work orders out, which the concept names with them. The second
 * adds it. An installation that began on the first has counters by then.
 */
describe('an installation that began on the first migration', () => {
  it('takes the sequence for work orders with the update and keeps its counters', async () => {
    await runMigrations(ownerDatabaseUrl(), kept(migrationsFolderUpTo(1)))

    const tenant = await tenantWithCounters({ asset: 42, evidence: 7 })

    expect(await sequences()).toEqual(['asset', 'evidence'])

    // The update: every migration this application carries, over what is there.
    await runMigrations(ownerDatabaseUrl())

    // In the order of the list in the code, not appended at the end.
    expect(await sequences()).toEqual(['asset', 'work_order', 'evidence'])
    expect(await countersOf(tenant)).toEqual({ asset: 42, evidence: 7 })

    // And the new sequence is one the application can start a counter in,
    // once the update is through.
    await allowApplicationLogin(admin)
    const database = Database.connect(applicationDatabaseUrl())

    try {
      await database.forTenant({ tenantId: tenant.id }, (tx) =>
        tx
          .insert(numberRanges)
          .values({ tenantId: tenant.id, key: 'work_order', pattern: 'WO-{number:4}' }),
      )
    } finally {
      await database.close()
    }

    expect(await countersOf(tenant)).toEqual({ asset: 42, evidence: 7, work_order: 1 })
  })

  /**
   * PostgreSQL does not take a value out of an enum, so the rollback makes
   * the type anew, and a rollback that rebuilds a type under a table with
   * rows in it is exactly the kind that works on an empty database only.
   */
  it('loses the counter of the work orders and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = await tenantWithCounters({ asset: 42, work_order: 7, evidence: 3 })

    await revertMigration(admin, '0001_work_order_numbers')

    expect(await sequences()).toEqual(['asset', 'evidence'])
    expect(await countersOf(tenant)).toEqual({ asset: 42, evidence: 3 })

    // The log of the tenant says that the counter went, and why.
    const { rows: removed } = await admin.query<{ operation: string; reason: string | null }>(
      `select distinct operation::text as operation, reason
         from audit_entries
        where tenant_id = $1 and table_name = 'number_ranges' and operation = 'delete'`,
      [tenant.id],
    )

    expect(removed).toEqual([{ operation: 'delete', reason: 'migration' }])

    // And the column is a column of the type again: it refuses what the type
    // no longer knows, rather than having turned into free text on the way.
    const refusal = await refusedBy(
      admin.query('insert into number_ranges (tenant_id, key, pattern) values ($1, $2, $3)', [
        tenant.id,
        'work_order',
        'WO-{number:4}',
      ]),
    )

    // invalid_text_representation: not a value of the enum.
    expect(refusal.code).toBe('22P02')
  })
})
