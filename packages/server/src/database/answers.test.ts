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
  ownerDatabaseUrl,
  resetSchema,
} from './test-database.js'

/**
 * The answers to the points of the form of an activity in the database
 * (#106, ADR 0006, point 7): one row per point among the rows that are not
 * marked, a photo that is a document at the same activity, and once the
 * activity is signed no answer given, changed or removed, by the application,
 * the owner of the tables or a superuser (HT007). A work order turned back
 * goes on, and its answers with it.
 */

const tenant = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const kept = 'HT007'
const uniqueViolation = '23505'
const checkViolation = '23514'
const foreignKeyViolation = '23503'

let admin: Pool
let owner: Pool
let database: Database
let north = ''
let south = ''
let numbers = 0

interface Place {
  readonly property: string
  readonly activity: string
  readonly other: string
  readonly workOrder: string | null
}

/** A property with an asset and an activity at it filled in a form, and a second activity there. */
async function placeIn(
  area: string,
  kind: 'inspection' | 'work_order' = 'inspection',
): Promise<Place> {
  const property = randomUUID()
  const building = randomUUID()
  const asset = randomUUID()
  const activity = randomUUID()
  const other = randomUUID()

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
    `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name,
                         meter_number, meter_unit)
     values ($1, $2, $3, $4, $5, 'probe.water_meter', $6, 'Wasserzähler', 'WZ-1', 'cubic_metres')`,
    [asset, tenant, property, area, building, `AN-${String(numbers).padStart(5, '0')}`],
  )

  for (const id of [activity, other]) {
    await admin.query(
      `insert into activities (id, tenant_id, property_id, area_id, asset_id, kind, title, status,
                               form_key, form_version)
       values ($1, $2, $3, $4, $5, $6, 'Ablesung', 'started', 'probe.water_meter_reading', 1)`,
      [id, tenant, property, area, asset, kind],
    )
  }

  let workOrder: string | null = null

  if (kind === 'work_order') {
    workOrder = randomUUID()
    await admin.query(
      `insert into work_orders (id, tenant_id, property_id, area_id, activity_id, number, kind)
       values ($1, $2, $3, $4, $5, $6, 'inspection')`,
      [workOrder, tenant, property, area, activity, `AU-2026-${String(numbers).padStart(4, '0')}`],
    )
  }

  return { property, activity, other, workOrder }
}

/** An answer at a point of the activity of a place, put in as the superuser. */
async function answered(
  at: Place,
  values: Record<string, unknown> = {},
  activity: string = at.activity,
): Promise<string> {
  const row = {
    tenant_id: tenant,
    property_id: at.property,
    area_id: await areaOf(at),
    activity_id: activity,
    field_key: 'seal_intact',
    result: 'ok',
    ...values,
  }
  const columns = Object.keys(row)
  const { rows } = await admin.query<{ id: string }>(
    `insert into activity_answers (${columns.join(', ')})
     values (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')}) returning id`,
    Object.values(row),
  )

  return rows[0]?.id ?? ''
}

async function areaOf(at: Place): Promise<string> {
  const { rows } = await admin.query<{ area_id: string }>(
    'select area_id from properties where id = $1',
    [at.property],
  )

  return rows[0]?.area_id ?? ''
}

/** A signature on the activity of a place, as a device gives one. */
async function signed(at: Place): Promise<void> {
  await admin.query(
    `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                      signed_at, path, page_fingerprint)
     values ($1, $2, $3, $4, $5, 'signer', '2026-10-07T09:30:00Z', 'M10,10L200,300', $6)`,
    [tenant, at.property, await areaOf(at), at.activity, lead, 'a'.repeat(64)],
  )
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

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''
  await admin.query(
    `insert into auth_users (id, name, email) values ($1, $1, 'lead@beispiel.example')`,
    [lead],
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{management}')`,
    [tenant, lead],
  )
  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await owner.end()
  await admin.end()
})

describe('an answer to a point', () => {
  it('stands once per point among the rows that are not marked, in a group with its block', async () => {
    const at = await placeIn(north)
    const first = await answered(at)

    expect(await codeOf(answered(at, { field_key: 'no_leak' }))).toBeNull()
    expect(await codeOf(answered(at))).toBe(uniqueViolation)
    // The same point of another activity is another point.
    expect(await codeOf(answered(at, {}, at.other))).toBeNull()
    // The same field in two blocks of a group is two points, and once in each.
    expect(await codeOf(answered(at, { group_key: 'branches', block_key: 'b-1' }))).toBeNull()
    expect(await codeOf(answered(at, { group_key: 'branches', block_key: 'b-2' }))).toBeNull()
    expect(await codeOf(answered(at, { group_key: 'branches', block_key: 'b-2' }))).toBe(
      uniqueViolation,
    )

    await admin.query('update activity_answers set deleted_at = now() where id = $1', [first])

    expect(await codeOf(answered(at))).toBeNull()
  })

  it('names a block with its group, holds a result or a value, and says something', async () => {
    const at = await placeIn(north)

    for (const values of [
      { field_key: 'one', group_key: 'branches' },
      { field_key: 'two', block_key: 'b-1' },
      { field_key: 'three', value: '1', result: 'ok' },
      { field_key: 'four', result: null },
      { field_key: 'Fünf' },
      { field_key: 'six', result: 'not_ok', remark: ' Lose. ' },
    ]) {
      expect(await codeOf(answered(at, values)), values.field_key).toBe(checkViolation)
    }
  })

  it('takes a photo that is a document at its own activity, and none of another', async () => {
    const at = await placeIn(north)
    const documentAt = async (activity: string) =>
      (
        await admin.query<{ id: string }>(
          `insert into attachments (tenant_id, property_id, area_id, activity_id, title)
           values ($1, $2, $3, $4, 'Plombe') returning id`,
          [tenant, at.property, north, activity],
        )
      ).rows[0]?.id

    expect(
      await codeOf(
        answered(at, {
          field_key: 'photo',
          result: null,
          attachment_id: await documentAt(at.other),
        }),
      ),
    ).toBe(foreignKeyViolation)
    expect(
      await codeOf(
        answered(at, {
          field_key: 'photo',
          result: null,
          attachment_id: await documentAt(at.activity),
        }),
      ),
    ).toBeNull()
  })

  it('is given, changed and removed by the application while the activity is not signed', async () => {
    const at = await placeIn(north)
    const id = await answered(at)

    expect(
      await asApplication((tx) =>
        tx.execute(
          sql`update activity_answers set result = 'not_ok', remark = 'Plombe fehlt.' where id = ${id}`,
        ),
      ),
    ).toBeNull()
    expect(
      await asApplication((tx) =>
        tx.execute(sql`update activity_answers set deleted_at = now() where id = ${id}`),
      ),
    ).toBeNull()
  })
})

describe('the answers of a signed activity', () => {
  it('take nothing new, no change and no removal from the application', async () => {
    const at = await placeIn(north)
    const id = await answered(at)

    await signed(at)

    expect(
      await asApplication((tx) =>
        tx.execute(
          sql`update activity_answers set result = 'not_ok', remark = 'Doch.' where id = ${id}`,
        ),
      ),
    ).toBe(kept)
    expect(
      await asApplication((tx) =>
        tx.execute(sql`update activity_answers set deleted_at = now() where id = ${id}`),
      ),
    ).toBe(kept)
    expect(
      await asApplication((tx) =>
        tx.execute(
          sql`insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, result)
              values (${tenant}, ${at.property}, ${north}, ${at.activity}, 'no_leak', 'ok')`,
        ),
      ),
    ).toBe(kept)
    // An answer of another activity there goes on as before.
    expect(await codeOf(answered(at, {}, at.other))).toBeNull()
  })

  it('are changed and removed by nobody, not by the owner of the tables', async () => {
    const at = await placeIn(north)
    const id = await answered(at)

    await signed(at)

    const client = await owner.connect()
    const asOwner = async (statement: string, values: readonly unknown[] = []) => {
      await client.query('begin')

      try {
        await client.query('alter table activity_answers no force row level security')
        await client.query('alter table activity_signatures no force row level security')

        return await codeOf(client.query(statement, [...values]))
      } finally {
        await client.query('rollback')
      }
    }

    try {
      expect(
        await asOwner(
          `update activity_answers set result = 'not_ok', remark = 'Doch.' where id = $1`,
          [id],
        ),
      ).toBe(kept)
      expect(await asOwner('delete from activity_answers where id = $1', [id])).toBe(kept)
      expect(await asOwner('truncate activity_answers cascade')).toBe(kept)
    } finally {
      client.release()
    }
  })

  it('are changed and removed by nobody, not by a superuser, and no answer moves to another activity', async () => {
    const at = await placeIn(north)
    const id = await answered(at)
    const open = await answered(at, { field_key: 'no_leak' }, at.other)

    await signed(at)

    expect(
      await codeOf(
        admin.query(
          `update activity_answers set remark = 'Doch.', result = 'not_ok' where id = $1`,
          [id],
        ),
      ),
    ).toBe(kept)
    expect(
      await codeOf(
        admin.query('update activity_answers set deleted_at = now() where id = $1', [id]),
      ),
    ).toBe(kept)
    expect(await codeOf(admin.query('delete from activity_answers where id = $1', [id]))).toBe(kept)
    expect(
      await codeOf(
        admin.query('update activity_answers set activity_id = $2 where id = $1', [
          open,
          at.activity,
        ]),
      ),
    ).toBe(kept)
    // Out of the signed activity into one that is not signed, neither.
    expect(
      await codeOf(
        admin.query('update activity_answers set activity_id = $2 where id = $1', [id, at.other]),
      ),
    ).toBe(kept)
    expect(await codeOf(admin.query('truncate activity_answers cascade'))).toBe(kept)
  })

  it('go on with a work order that was turned back after its signature', async () => {
    const at = await placeIn(north, 'work_order')
    const id = await answered(at)

    await signed(at)

    expect(
      await codeOf(
        admin.query(
          `update activity_answers set result = 'not_possible', remark = 'Gesperrt.' where id = $1`,
          [id],
        ),
      ),
    ).toBe(kept)

    await admin.query(
      `insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision,
                                         reason, decided_by)
       values ($1, $2, $3, $4, 'rejected', 'Die Plombe fehlt noch.', $5)`,
      [tenant, at.property, north, at.workOrder, lead],
    )

    expect(
      await codeOf(
        admin.query(
          `update activity_answers set result = 'not_possible', remark = 'Gesperrt.' where id = $1`,
          [id],
        ),
      ),
    ).toBeNull()
  })

  it('follow their property into another area, and nothing else changes with it', async () => {
    const at = await placeIn(north)
    const id = await answered(at)

    await signed(at)
    await admin.query('update properties set area_id = $2 where id = $1', [at.property, south])

    const { rows } = await admin.query<{ area_id: string; result: string }>(
      'select area_id, result from activity_answers where id = $1',
      [id],
    )

    expect(rows).toEqual([{ area_id: south, result: 'ok' }])
  })
})
