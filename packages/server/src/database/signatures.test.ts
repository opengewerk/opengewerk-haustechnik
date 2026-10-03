import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  insufficientPrivilege,
  ownerDatabaseUrl,
  resetSchema,
} from './test-database.js'

/**
 * Signatures and the decisions on work orders in the database (ADR 0004,
 * points 7, 8 and 16, section 4.8 of the concept): written once and changed
 * or removed by no role, the application, the owner of the tables and a
 * superuser each with a test; the area follows the property; the rules of the
 * rows and their keys; and the result each duty of an activity carries.
 */

const tenant = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const kept = 'HT005'
const fingerprint = 'a'.repeat(64)

/** A property with a building, an asset, a duty at it and a work order to meet the duty. */
interface Place {
  readonly property: string
  readonly area: string
  readonly asset: string
  readonly duty: string
  readonly activity: string
  readonly workOrder: string
}

let admin: Pool
let owner: Pool
let database: Database
let here: Place
let beside: Place
let secondArea = ''
let numbers = 0

async function placeIn(area: string): Promise<Place> {
  const property = randomUUID()
  const building = randomUUID()
  const asset = randomUUID()
  const duty = randomUUID()
  const activity = randomUUID()
  const workOrder = randomUUID()

  numbers += 1
  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenant, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus A', '{school}')`,
    [building, tenant, property, area],
  )
  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, 'probe.elevator', $6, 'Aufzug')`,
    [asset, tenant, property, area, building, `AN-${String(numbers).padStart(5, '0')}`],
  )
  await admin.query(
    `insert into duties (id, tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     values ($1, $2, $3, $4, $5, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
             'from_performance', 12, $6)`,
    [duty, tenant, property, area, asset, lead],
  )
  await admin.query(
    `insert into activities (id, tenant_id, property_id, area_id, asset_id, kind, title)
     values ($1, $2, $3, $4, $5, 'work_order', 'Sichtprüfung Aufzug')`,
    [activity, tenant, property, area, asset],
  )
  await admin.query(
    `insert into work_orders (id, tenant_id, property_id, area_id, activity_id, number, kind)
     values ($1, $2, $3, $4, $5, $6, 'inspection')`,
    [workOrder, tenant, property, area, activity, `AU-2026-${String(numbers).padStart(4, '0')}`],
  )

  return { property, area, asset, duty, activity, workOrder }
}

/** The columns of a signature on the work order of a place. */
function signatureAt(at: Place): Record<string, unknown> {
  return {
    tenant_id: tenant,
    property_id: at.property,
    area_id: at.area,
    activity_id: at.activity,
    signed_by: lead,
    role: 'signer',
    signed_at: '2026-10-01T09:30:00Z',
    path: 'M10,10L200,300',
    page_fingerprint: fingerprint,
  }
}

/** The columns of a rejection of the work order of a place. */
function decisionAt(at: Place): Record<string, unknown> {
  return {
    tenant_id: tenant,
    property_id: at.property,
    area_id: at.area,
    work_order_id: at.workOrder,
    decision: 'rejected',
    reason: 'Die Notrufverbindung fehlt noch.',
    decided_by: lead,
  }
}

/** A row put in past the application, as the superuser. */
async function written(table: string, values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values)
  const { rows } = await admin.query<{ id: string }>(
    `insert into ${table} (${columns.join(', ')})
     values (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')}) returning id`,
    Object.values(values),
  )

  return rows[0]?.id ?? ''
}

/** The key or check that refused a row, or that it was accepted. */
async function triedRow(
  table: string,
  values: Record<string, unknown>,
): Promise<{ code?: string; constraint?: string } | 'accepted'> {
  try {
    await written(table, values)

    return 'accepted'
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string }

    return { code, constraint }
  }
}

/** The code of the error a statement ends with, or null when it goes through. */
async function codeOf(pending: Promise<unknown>): Promise<string | null> {
  try {
    await pending

    return null
  } catch (error) {
    return (
      (error as { code?: string; cause?: { code?: string } }).cause?.code ??
      (error as { code?: string }).code ??
      'unknown'
    )
  }
}

/** A statement of the application, in every area. */
function asApplication(work: (tx: TenantTransaction) => Promise<unknown>) {
  return codeOf(
    database.forTenant({ tenantId: tenant, userId: lead }, async (tx) => {
      await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
      await work(tx)
    }),
  )
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  owner = new Pool({ connectionString: ownerDatabaseUrl() })

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [tenant],
  )
  const north = rows.find((row) => row.name === 'Nord')?.id ?? ''

  secondArea = rows.find((row) => row.name === 'Süd')?.id ?? ''
  await admin.query(
    `insert into auth_users (id, name, email) values ($1, $1, 'lead@beispiel.example')`,
    [lead],
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{management}')`,
    [tenant, lead],
  )

  here = await placeIn(north)
  beside = await placeIn(north)
  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await owner.end()
  await admin.end()
})

describe.each([
  ['activity_signatures', signatureAt, 'role', "'countersigner'"],
  ['work_order_decisions', decisionAt, 'reason', "'Doch nicht.'"],
] as const)('a row of %s', (table, rowAt, column, value) => {
  it('is added by the application, which changes and removes none', async () => {
    const values = rowAt(here)
    const columns = Object.keys(values)

    expect(
      await asApplication((tx) =>
        tx.execute(
          sql`insert into ${sql.identifier(table)} (${sql.join(
            columns.map((name) => sql.identifier(name)),
            sql`, `,
          )}) values (${sql.join(
            columns.map((name) => sql.param(values[name])),
            sql`, `,
          )})`,
        ),
      ),
    ).toBeNull()
    expect(
      await asApplication((tx) =>
        tx.execute(
          sql.raw(`update ${table} set ${column} = ${value} where tenant_id = '${tenant}'`),
        ),
      ),
    ).toBe(insufficientPrivilege)
    expect(
      await asApplication((tx) =>
        tx.execute(sql.raw(`update ${table} set deleted_at = now() where tenant_id = '${tenant}'`)),
      ),
    ).toBe(insufficientPrivilege)
    expect(
      await asApplication((tx) =>
        tx.execute(sql.raw(`delete from ${table} where tenant_id = '${tenant}'`)),
      ),
    ).toBe(insufficientPrivilege)
  })

  it('is changed and removed by nobody, not by the owner of the tables', async () => {
    const id = await written(table, rowAt(here))
    const client = await owner.connect()
    const asOwner = async (statement: string, values: readonly unknown[] = []) => {
      await client.query('begin')

      try {
        await client.query(`alter table ${table} no force row level security`)

        return await codeOf(client.query(statement, [...values]))
      } finally {
        await client.query('rollback')
      }
    }

    try {
      expect(await asOwner(`update ${table} set ${column} = ${value} where id = $1`, [id])).toBe(
        kept,
      )
      expect(await asOwner(`delete from ${table} where id = $1`, [id])).toBe(kept)
      expect(await asOwner(`truncate ${table}`)).toBe(kept)
    } finally {
      client.release()
    }
  })

  it('is changed and removed by nobody, not by a superuser', async () => {
    const id = await written(table, rowAt(here))

    expect(
      await codeOf(admin.query(`update ${table} set ${column} = ${value} where id = $1`, [id])),
    ).toBe(kept)
    expect(
      await codeOf(admin.query(`update ${table} set deleted_at = now() where id = $1`, [id])),
    ).toBe(kept)
    expect(await codeOf(admin.query(`delete from ${table} where id = $1`, [id]))).toBe(kept)
    expect(await codeOf(admin.query(`truncate ${table}`))).toBe(kept)
  })

  it('takes no other change from a trigger, which runs a level deeper as the key does', async () => {
    const at = await placeIn(here.area)

    await written(table, rowAt(at))
    // As for an evidence: a trigger that fires before the one of the key,
    // moves the row with its property and changes something else besides.
    await admin.query(`
      create function probe_rewrite() returns trigger language plpgsql as $$
      begin
        update ${table} set area_id = new.area_id, ${column} = ${value} where property_id = new.id;
        return null;
      end;
      $$`)
    await admin.query(`
      create trigger "A_probe_rewrite" after update of area_id on properties
        for each row execute function probe_rewrite()`)

    try {
      expect(
        await codeOf(
          admin.query('update properties set area_id = $1 where id = $2', [
            secondArea,
            at.property,
          ]),
        ),
      ).toBe(kept)
    } finally {
      await admin.query('drop trigger "A_probe_rewrite" on properties')
      await admin.query('drop function probe_rewrite()')
    }
  })

  it('follows its property into another area, and takes no other change that way', async () => {
    const at = await placeIn(here.area)
    const id = await written(table, rowAt(at))
    const row = async () =>
      (
        await admin.query<{ area: string; version: number }>(
          `select area_id as area, version from ${table} where id = $1`,
          [id],
        )
      ).rows[0]

    await admin.query('update properties set area_id = $1 where id = $2', [secondArea, at.property])

    // The area followed, and the stamp of the sync says so to a device.
    expect(await row()).toEqual({ area: secondArea, version: 2 })
    expect(
      await codeOf(admin.query(`update ${table} set area_id = $1 where id = $2`, [here.area, id])),
    ).toBe(kept)

    await admin.query('update properties set area_id = $1 where id = $2', [here.area, at.property])
  })
})

describe('a signature', () => {
  it('is refused what `domain` refuses, check by check', async () => {
    const checks: Record<string, Record<string, unknown>> = {
      activity_signatures_path_shaped: { ...signatureAt(here), path: 'M1,1 L2,2' },
      activity_signatures_device_info_shaped: {
        ...signatureAt(here),
        device_info: 'x'.repeat(501),
      },
      activity_signatures_page_fingerprint_shaped: {
        ...signatureAt(here),
        page_fingerprint: 'A'.repeat(64),
      },
    }
    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [check, values] of Object.entries(checks)) {
      refused[check] = await triedRow('activity_signatures', values)
      expected[check] = { code: '23514', constraint: check }
    }

    expect(refused).toEqual(expected)
    // A drawing longer than the bound is refused by the same check.
    expect(
      await triedRow('activity_signatures', {
        ...signatureAt(here),
        path: `M1,1${'L2,2'.repeat(10_000)}`,
      }),
    ).toEqual({ code: '23514', constraint: 'activity_signatures_path_shaped' })
  })

  it('hangs on an activity of its property and on somebody here, key by key', async () => {
    const attempts: Record<string, Record<string, unknown>> = {
      activity_signatures_follow_their_property: { ...signatureAt(here), area_id: secondArea },
      activity_signatures_of_an_activity_of_their_property: {
        ...signatureAt(here),
        activity_id: beside.activity,
      },
      activity_signatures_by_somebody_here: { ...signatureAt(here), signed_by: 'u-nobody' },
      work_order_decisions_follow_their_property: { ...decisionAt(here), area_id: secondArea },
      work_order_decisions_of_a_work_order_of_their_property: {
        ...decisionAt(here),
        work_order_id: beside.workOrder,
      },
      work_order_decisions_by_somebody_here: { ...decisionAt(here), decided_by: 'u-nobody' },
    }
    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f' and c.relname in ('activity_signatures', 'work_order_decisions')
          and k.conname not like '%_tenant_id_tenants_id_fk'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual(Object.keys(attempts).sort())

    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [key, values] of Object.entries(attempts)) {
      const table = key.startsWith('activity_signatures')
        ? 'activity_signatures'
        : 'work_order_decisions'

      refused[key] = await triedRow(table, values)
      expected[key] = { code: '23503', constraint: key }
    }

    expect(refused).toEqual(expected)
  })
})

describe('a decision on a work order', () => {
  it('names the reason of a rejection, and an acceptance none', async () => {
    expect(await triedRow('work_order_decisions', { ...decisionAt(here), reason: null })).toEqual({
      code: '23514',
      constraint: 'work_order_decisions_rejected_with_a_reason',
    })
    expect(
      await triedRow('work_order_decisions', { ...decisionAt(here), decision: 'accepted' }),
    ).toEqual({
      code: '23514',
      constraint: 'work_order_decisions_rejected_with_a_reason',
    })
    expect(
      await triedRow('work_order_decisions', { ...decisionAt(here), reason: ' Doch.' }),
    ).toEqual({
      code: '23514',
      constraint: 'work_order_decisions_reason_shaped',
    })
    expect(
      await written('work_order_decisions', {
        ...decisionAt(here),
        decision: 'accepted',
        reason: null,
      }),
    ).not.toBe('')
  })
})

describe('an activity and its duties', () => {
  it('carry the result of each duty with the reason of "not performed", and no countersignature on a work order', async () => {
    const line = async (result: string | null, reason: string | null) =>
      triedRow('activity_duties', {
        tenant_id: tenant,
        property_id: here.property,
        area_id: here.area,
        activity_id: await written('activities', {
          tenant_id: tenant,
          property_id: here.property,
          area_id: here.area,
          kind: 'inspection',
          title: 'Sichtprüfung',
        }),
        duty_id: here.duty,
        result,
        result_reason: reason,
      })

    expect(await line('not_performed', null)).toEqual({
      code: '23514',
      constraint: 'activity_duties_not_performed_with_a_reason',
    })
    expect(await line('failed', 'Anlage war aus.')).toEqual({
      code: '23514',
      constraint: 'activity_duties_not_performed_with_a_reason',
    })
    expect(await line(null, 'Anlage war aus.')).toEqual({
      code: '23514',
      constraint: 'activity_duties_not_performed_with_a_reason',
    })
    expect(await line('not_performed', ' Anlage war aus.')).toEqual({
      code: '23514',
      constraint: 'activity_duties_result_reason_shaped',
    })
    expect(await line('not_performed', 'Anlage war aus.')).toBe('accepted')
    expect(await line(null, null)).toBe('accepted')
    expect(
      await triedRow('activities', {
        tenant_id: tenant,
        property_id: here.property,
        area_id: here.area,
        kind: 'work_order',
        title: 'Auftrag',
        countersignature_required: true,
      }),
    ).toEqual({ code: '23514', constraint: 'activities_countersigned_but_no_work_order' })
  })
})
