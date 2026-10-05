import { randomUUID } from 'node:crypto'

import { closureLimits, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  refusedBy,
  resetSchema,
} from './test-database.js'

/**
 * The times a building is closed in the database (#86, section 4.1 of the
 * concept): that a closure hangs on a building of its tenant, on the property
 * of that building and in the area of it, that the closures of a marked
 * building are marked with it, also when the building goes with its property,
 * that a closure a moved property takes along carries the stamp a device
 * needs, and that the database refuses what the model in `domain` refuses.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key or the check and never a policy.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()

let admin: Pool
let database: Database

let area = ''
let secondArea = ''
/** A property with a building, and one beside it with a building of its own. */
let here = { property: '', building: '' }
let beside = { property: '', building: '' }
/** A property of the other tenant with a building, in an area of its own. */
let elsewhere = { property: '', building: '', area: '' }

async function areaOf(tenantId: TenantId, name: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'insert into areas (tenant_id, name) values ($1, $2) returning id',
    [tenantId, name],
  )

  return rows[0]?.id ?? ''
}

async function propertyIn(tenantId: TenantId, areaId: string): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Schulzentrum', 'Hauptstraße 1', '00001', 'Ort', 'DE-BW')`,
    [id, tenantId, areaId],
  )

  return id
}

/** A building on a property, in the area the property lies in. */
async function buildingOn(property: string): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     select $1, tenant_id, id, area_id, 'Schulhaus', '{school}' from properties where id = $2`,
    [id, property],
  )

  return id
}

async function placeIn(tenantId: TenantId, areaId: string) {
  const property = await propertyIn(tenantId, areaId)

  return { property, building: await buildingOn(property) }
}

/** A closure of a building, on the property and in the area the building lies in. */
async function closureOf(building: string, reason = 'Weihnachtsferien'): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into building_closures (id, tenant_id, building_id, property_id, area_id, starts_on, ends_on, reason)
     select $1, tenant_id, id, property_id, area_id, '2026-12-24', '2027-01-06', $3
       from buildings where id = $2`,
    [id, building, reason],
  )

  return id
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

  area = await areaOf(tenant, 'Nord')
  secondArea = await areaOf(tenant, 'Süd')
  here = await placeIn(tenant, area)
  beside = await placeIn(tenant, area)

  const foreign = await areaOf(other, 'Nord')

  elsewhere = { ...(await placeIn(other, foreign)), area: foreign }

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

/** A row put in past the application, and the key or check that refused it. */
function tried(statement: string, values: readonly unknown[]) {
  return refusedBy(admin.query(statement, [...values]))
}

/**
 * Something done as the application does it, inside the tenant and under the
 * policies, in every area: a trigger runs as whoever changes the row.
 */
function asTheApplication(statement: ReturnType<typeof sql>) {
  return database.forTenant({ tenantId: tenant, userId: 'user-lead' }, async (tx) => {
    await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
    await tx.execute(statement)
  })
}

async function deletedAt(table: string, id: string): Promise<string | null> {
  const { rows } = await admin.query<{ at: string | null }>(
    `select deleted_at::text as at from ${table} where id = $1`,
    [id],
  )

  return rows[0]?.at ?? null
}

describe('a closure in the database', () => {
  const closure = (tenantId: string, building: string, property: string, areaId: string) =>
    tried(
      `insert into building_closures (tenant_id, building_id, property_id, area_id, starts_on, ends_on)
       values ($1, $2, $3, $4, '2026-12-24', '2027-01-06')`,
      [tenantId, building, property, areaId],
    )

  /**
   * One attempt per key of the table, read from the catalogue, each breaking
   * that key and no other: a key that a later migration adds without an
   * attempt here turns this red, and so does an attempt that is not refused by
   * the key it names.
   */
  it('hangs on a building of its tenant, on the property of it and in the area of it, key by key', async () => {
    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f'
          and c.relname = 'building_closures'
          and k.conname not like '%_tenant_id_tenants_id_fk'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual([
      'building_closures_follow_their_property',
      'building_closures_of_their_building',
    ])

    const building = { code: '23503', constraint: 'building_closures_of_their_building' }
    const property = { code: '23503', constraint: 'building_closures_follow_their_property' }

    // On a property its building does not stand on.
    expect(await closure(tenant, here.building, beside.property, area)).toEqual(building)
    // Of a building there is none of.
    expect(await closure(tenant, randomUUID(), here.property, area)).toEqual(building)
    // In another area than its property.
    expect(await closure(tenant, here.building, here.property, secondArea)).toEqual(property)
  })

  it('names no building of another tenant, whatever else it names of that tenant', async () => {
    const refused = await closure(tenant, elsewhere.building, elsewhere.property, elsewhere.area)

    expect(refused.code).toBe('23503')
    expect(refused.constraint).toMatch(
      /^building_closures_(of_their_building|follow_their_property)$/,
    )
  })

  it('has a building, a first and a last day', async () => {
    const without = async (column: string) => {
      const columns = ['building_id', 'starts_on', 'ends_on'].filter((each) => each !== column)
      const values: Record<string, string> = {
        building_id: here.building,
        starts_on: '2026-12-24',
        ends_on: '2027-01-06',
      }

      return (
        await tried(
          `insert into building_closures (tenant_id, property_id, area_id, ${columns.join(', ')})
           values ($1, $2, $3, $4, $5)`,
          [tenant, here.property, area, ...columns.map((each) => values[each])],
        )
      ).code
    }

    expect({
      building: await without('building_id'),
      first: await without('starts_on'),
      last: await without('ends_on'),
    }).toEqual({ building: '23502', first: '23502', last: '23502' })
  })

  it('is taken when it names its building, the property and the area of it', async () => {
    const { rowCount } = await admin.query(
      `insert into building_closures (tenant_id, building_id, property_id, area_id, starts_on, ends_on)
       values ($1, $2, $3, $4, '2026-12-24', '2027-01-06')`,
      [tenant, here.building, here.property, area],
    )

    expect(rowCount).toBe(1)
  })
})

describe('the closures of a building marked deleted', () => {
  /**
   * A building that is gone is closed on no day, and a device that holds its
   * closures learns from the mark that it may let them go: the cascades of
   * the keys never run for a row that is only marked.
   */
  it('are marked with it at the same moment, and none of the building beside it', async () => {
    const doomed = await placeIn(tenant, area)
    const christmas = await closureOf(doomed.building, 'Weihnachtsferien')
    const summer = await closureOf(doomed.building, 'Sommerferien')
    const neighbour = await closureOf(beside.building)

    await asTheApplication(
      sql`update buildings set deleted_at = now() where id = ${doomed.building}`,
    )

    const moment = await deletedAt('buildings', doomed.building)

    expect(moment).not.toBeNull()
    expect({
      christmas: await deletedAt('building_closures', christmas),
      summer: await deletedAt('building_closures', summer),
    }).toEqual({ christmas: moment, summer: moment })
    expect(await deletedAt('building_closures', neighbour)).toBeNull()
  })

  /** A property marks its buildings, and each of those marks its closures. */
  it('are marked when the building goes with its property', async () => {
    const doomed = await placeIn(tenant, area)
    const closure = await closureOf(doomed.building)

    await asTheApplication(
      sql`update properties set deleted_at = now() where id = ${doomed.property}`,
    )

    const moment = await deletedAt('properties', doomed.property)

    expect(moment).not.toBeNull()
    expect(await deletedAt('buildings', doomed.building)).toBe(moment)
    expect(await deletedAt('building_closures', closure)).toBe(moment)
  })

  it('keep the moment they were taken away themselves', async () => {
    const doomed = await placeIn(tenant, area)
    const gone = await closureOf(doomed.building, 'Herbstferien')
    const still = await closureOf(doomed.building, 'Sommerferien')

    await asTheApplication(
      sql`update building_closures set deleted_at = now() - interval '1 day' where id = ${gone}`,
    )

    const earlier = await deletedAt('building_closures', gone)

    await asTheApplication(
      sql`update buildings set deleted_at = now() where id = ${doomed.building}`,
    )

    const moment = await deletedAt('buildings', doomed.building)

    expect(earlier).not.toBeNull()
    expect(await deletedAt('building_closures', gone)).toBe(earlier)
    expect(await deletedAt('building_closures', still)).toBe(moment)
    expect(moment).not.toBe(earlier)
  })

  /**
   * Only the step from live to deleted marks anything. A statement that names
   * the mark of a building and leaves it live touches no closure: one touched
   * would carry a new version, and every device would be sent it again.
   */
  it('are left as they are while their building stays live', async () => {
    const staying = await placeIn(tenant, area)
    const closure = await closureOf(staying.building)

    await asTheApplication(
      sql`update buildings set deleted_at = null where id = ${staying.building}`,
    )

    const { rows } = await admin.query<{ version: number; deleted_at: string | null }>(
      'select version, deleted_at::text as deleted_at from building_closures where id = $1',
      [closure],
    )

    expect(rows).toEqual([{ version: 1, deleted_at: null }])
  })

  /**
   * A mark is a change like any other: the row carries a new version and a
   * later place in the order of changes, so that the next pull of a device
   * brings it.
   */
  it('reach a device as a change, with the stamp of whoever marked the building', async () => {
    const doomed = await placeIn(tenant, area)
    const closure = await closureOf(doomed.building)
    const stamp = async () =>
      (
        await admin.query<{ version: number; sequence: string; updated_by: string | null }>(
          `select version, change_sequence::text as sequence, updated_by
             from building_closures where id = $1`,
          [closure],
        )
      ).rows[0]
    const before = await stamp()

    await asTheApplication(
      sql`update buildings set deleted_at = now() where id = ${doomed.building}`,
    )

    const after = await stamp()

    expect(before?.version).toBe(1)
    expect(after?.version).toBe(2)
    expect(Number(after?.sequence)).toBeGreaterThan(Number(before?.sequence))
    expect(after?.updated_by).toBe('user-lead')
  })
})

describe('a closure of a building whose property moved to another area', () => {
  it('lies in the new area and carries the stamp a device needs', async () => {
    const moving = await placeIn(tenant, area)
    const closure = await closureOf(moving.building)
    const read = async () =>
      (
        await admin.query<{
          area_id: string
          version: number
          sequence: string
          updated_by: string | null
        }>(
          `select area_id, version, change_sequence::text as sequence, updated_by
             from building_closures where id = $1`,
          [closure],
        )
      ).rows[0]
    const before = await read()

    expect(before).toMatchObject({ area_id: area, version: 1 })
    expect(Number(before?.sequence)).toBeGreaterThan(0)

    await asTheApplication(
      sql`update properties set area_id = ${secondArea} where id = ${moving.property}`,
    )

    const after = await read()

    expect(after).toMatchObject({ area_id: secondArea, version: 2, updated_by: 'user-lead' })
    expect(Number(after?.sequence)).toBeGreaterThan(Number(before?.sequence))
  })
})

describe('the days and the reason of a closure in the database', () => {
  function written(startsOn: string, endsOn: string, reason: string | null = null) {
    return admin.query(
      `insert into building_closures (tenant_id, building_id, property_id, area_id, starts_on, ends_on, reason)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [tenant, here.building, here.property, area, startsOn, endsOn, reason],
    )
  }

  /**
   * Each what the model in `domain` refuses or a route would never hand over,
   * and the check that refuses it here.
   */
  it('are refused as the model refuses them, check by check', async () => {
    const order = { code: '23514', constraint: 'building_closures_in_order' }
    const shaped = { code: '23514', constraint: 'building_closures_reason_shaped' }
    const days = ['2026-12-24', '2027-01-06'] as const

    expect({
      'ending before it begins': await refusedBy(written('2027-01-06', '2026-12-24')),
      'ending the day before it begins': await refusedBy(written('2026-12-24', '2026-12-23')),
      'a reason with a space before it': await refusedBy(written(...days, ' Ferien')),
      'a reason with a space after it': await refusedBy(written(...days, 'Ferien ')),
      'a reason left empty': await refusedBy(written(...days, '')),
      'a reason a sign too long': await refusedBy(
        written(...days, 'x'.repeat(closureLimits.reason + 1)),
      ),
    }).toEqual({
      'ending before it begins': order,
      'ending the day before it begins': order,
      'a reason with a space before it': shaped,
      'a reason with a space after it': shaped,
      'a reason left empty': shaped,
      'a reason a sign too long': shaped,
    })

    // Every check of the table has its attempts above.
    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'c' and c.relname = 'building_closures'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual([
      'building_closures_in_order',
      'building_closures_reason_shaped',
    ])
  })

  it('take a day that is none for none', async () => {
    // 22008: a date out of range, 22007: nothing a date is read from.
    expect((await refusedBy(written('2026-02-30', '2026-03-01'))).code).toBe('22008')
    expect((await refusedBy(written('bald', '2026-03-01'))).code).toBe('22007')
  })

  it('are taken for a single day, at the bound of the reason and without one', async () => {
    await expect(written('2026-10-30', '2026-10-30')).resolves.toMatchObject({ rowCount: 1 })
    await expect(
      written('2026-12-24', '2027-01-06', 'x'.repeat(closureLimits.reason)),
    ).resolves.toMatchObject({ rowCount: 1 })
    await expect(written('2026-12-24', '2027-01-06', null)).resolves.toMatchObject({ rowCount: 1 })
  })
})
