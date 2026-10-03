import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from './test-database.js'

/**
 * The row of an evidence before #26 (ADR 0004, Nachtrag vom 03.10.2026): the
 * application may read and add one, and change and remove none. What #26
 * brings on top, the triggers that refuse a change to every role, holds the
 * same for the owner of the tables and a superuser; this holds the rights of
 * the application, which are all that stands in the way until then.
 */

const tenant = newId<'tenant'>() as TenantId
const insufficientPrivilege = '42501'

let admin: Pool
let database: Database
let duty = ''
let property = ''
let area = ''

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])
  await admin.query(
    `insert into auth_users (id, name, email) values ('u-lead', 'u-lead', 'lead@beispiel.example')`,
  )
  // The first membership gives the operator its first area, and the Leitung every area.
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-lead', '{management}')`,
    [tenant],
  )

  const { rows } = await admin.query<{ duty: string; property: string; area: string }>(
    `with property as (
       insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
         from areas where tenant_id = $1
       returning id, area_id
     ), duty as (
       insert into duties (tenant_id, property_id, area_id, label, basis, source_note, counting,
                           interval_months, confirmed_by)
       select $1, id, area_id, 'Zufahrt freihalten', 'authority', 'Brandschutzkonzept',
              'from_performance', 1, 'u-lead' from property
       returning id, property_id, area_id
     )
     select id as duty, property_id as property, area_id as area from duty`,
    [tenant],
  )
  const made = rows[0] as { duty: string; property: string; area: string }

  duty = made.duty
  property = made.property
  area = made.area

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

/** The code of the error a statement of the application ends with, or null when it goes through. */
async function refusalOf(statement: ReturnType<typeof sql>): Promise<string | null> {
  try {
    await database.forTenant({ tenantId: tenant, userId: 'u-lead' }, (tx) => tx.execute(statement))

    return null
  } catch (error) {
    return (error as { cause?: { code?: string } }).cause?.code ?? 'unknown'
  }
}

describe('an evidence', () => {
  it('is added by the application, which changes and removes none', async () => {
    expect(
      await refusalOf(
        sql`insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result)
            values (${tenant}, ${property}, ${area}, ${duty}, '2026-09-30', 'without_defects')`,
      ),
    ).toBeNull()

    // Not even a row of its own, in an area it sees.
    expect(
      await refusalOf(sql`update evidence set result = 'failed' where tenant_id = ${tenant}`),
    ).toBe(insufficientPrivilege)
    expect(await refusalOf(sql`delete from evidence where tenant_id = ${tenant}`)).toBe(
      insufficientPrivilege,
    )

    const { rows } = await admin.query<{ result: string }>(
      'select result from evidence where tenant_id = $1',
      [tenant],
    )

    expect(rows).toEqual([{ result: 'without_defects' }])
  })
})
