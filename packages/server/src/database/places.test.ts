import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
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
 * The place in the database (ADR 0002): that every level hangs on the right
 * level above it, key by key, that marking a place deleted marks what hangs
 * below it, that every change carries the stamp a device needs, and that the
 * database refuses what the model in `domain` refuses.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key or the check and never a policy.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()

/** A whole place in one area of one tenant, from the property down to the room. */
interface Place {
  readonly tenant: TenantId
  readonly area: string
  readonly property: string
  readonly building: string
  readonly floor: string
  readonly room: string
}

let admin: Pool
let database: Database

async function areaOf(tenantId: TenantId, name: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'insert into areas (tenant_id, name) values ($1, $2) returning id',
    [tenantId, name],
  )

  return rows[0]?.id ?? ''
}

async function placeIn(tenantId: TenantId, area: string): Promise<Place> {
  const at = {
    tenant: tenantId,
    area,
    property: randomUUID(),
    building: randomUUID(),
    floor: randomUUID(),
    room: randomUUID(),
  }

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus', 'Hauptstraße 1', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [at.property, tenantId, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus A', '{school,assembly}')`,
    [at.building, tenantId, at.property, area],
  )
  await admin.query(
    `insert into floors (id, tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, $5, 'Erdgeschoss', 0)`,
    [at.floor, tenantId, at.building, at.property, area],
  )
  await admin.query(
    `insert into rooms (id, tenant_id, floor_id, building_id, property_id, area_id, number)
     values ($1, $2, $3, $4, $5, $6, '0.01')`,
    [at.room, tenantId, at.floor, at.building, at.property, area],
  )

  return at
}

let here: Place
let beside: Place
let elsewhere: Place
let secondArea: string

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

  const area = await areaOf(tenant, 'Nord')

  secondArea = await areaOf(tenant, 'Süd')
  here = await placeIn(tenant, area)
  beside = await placeIn(tenant, area)
  elsewhere = await placeIn(other, await areaOf(other, 'Nord'))

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

describe('the levels of the place', () => {
  /**
   * One attempt per key between two levels, read from the catalogue: a key
   * that a later migration adds without an attempt here turns this red, and
   * so does an attempt that is not refused by the key it names.
   */
  it('hold every row to the level above it, key by key', async () => {
    const attempts: Record<string, () => Promise<{ code: string; constraint: string }>> = {
      properties_in_an_area_of_the_tenant: () =>
        tried(
          `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
           values ($1, $2, 'Fremd', 'Hauptstraße 1', '68535', 'Ort', 'DE-BW')`,
          [tenant, elsewhere.area],
        ),
      buildings_follow_their_property: () =>
        tried(
          `insert into buildings (tenant_id, property_id, area_id, name, kinds)
           values ($1, $2, $3, 'Haus B', '{office}')`,
          [tenant, here.property, secondArea],
        ),
      floors_in_their_building: () =>
        tried(
          `insert into floors (tenant_id, building_id, property_id, area_id, name, level)
           values ($1, $2, $3, $4, 'Obergeschoss', 1)`,
          [tenant, beside.building, here.property, here.area],
        ),
      floors_follow_their_property: () =>
        tried(
          `insert into floors (tenant_id, building_id, property_id, area_id, name, level)
           values ($1, $2, $3, $4, 'Obergeschoss', 1)`,
          [tenant, here.building, here.property, secondArea],
        ),
      rooms_on_a_floor_of_their_building: () =>
        tried(`update rooms set floor_id = $2 where id = $1`, [here.room, beside.floor]),
      rooms_follow_their_property: () =>
        tried(
          `insert into rooms (tenant_id, floor_id, building_id, property_id, area_id, number)
           values ($1, $2, $3, $4, $5, '0.02')`,
          [tenant, here.floor, here.building, here.property, secondArea],
        ),
    }

    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f'
          and c.relname in ('properties', 'buildings', 'floors', 'rooms')
          and k.conname not like '%_tenant_id_tenants_id_fk'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual(Object.keys(attempts).sort())

    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [key, attempt] of Object.entries(attempts)) {
      refused[key] = await attempt()
      expected[key] = { code: '23503', constraint: key }
    }

    expect(refused).toEqual(expected)
  })

  it('takes a row that names its places rightly', async () => {
    const { rowCount } = await admin.query(
      `insert into rooms (tenant_id, floor_id, building_id, property_id, area_id, name)
       values ($1, $2, $3, $4, $5, 'Treppenhaus')`,
      [tenant, here.floor, here.building, here.property, here.area],
    )

    expect(rowCount).toBe(1)
  })
})

describe('a place marked deleted', () => {
  /**
   * A deleted place keeps its row: a device that was offline learns of the
   * deletion only from a row that changed, and a row that is gone never
   * changes again.
   */
  it('is only ever marked: the application may not remove a row of the place', async () => {
    const { rows } = await admin.query<{ table_name: string; may_delete: boolean }>(
      `select c.relname as table_name, has_table_privilege('opengewerk_app', c.oid, 'DELETE') as may_delete
         from pg_class c
        where c.relname in ('properties', 'buildings', 'floors', 'rooms')
        order by 1`,
    )

    expect(rows).toEqual([
      { table_name: 'buildings', may_delete: false },
      { table_name: 'floors', may_delete: false },
      { table_name: 'properties', may_delete: false },
      { table_name: 'rooms', may_delete: false },
    ])
  })

  async function deletedAt(table: string, id: string): Promise<string | null> {
    const { rows } = await admin.query<{ at: string | null }>(
      `select deleted_at::text as at from ${table} where id = $1`,
      [id],
    )

    return rows[0]?.at ?? null
  }

  /**
   * Marked as the application marks it, inside the tenant and under the
   * policies, in every area: the trigger runs as whoever marks the row.
   */
  function marking(work: (tx: TenantTransaction) => Promise<unknown>) {
    return database.forTenant({ tenantId: tenant, userId: 'user-lead' }, async (tx) => {
      await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
      await work(tx)
    })
  }

  it('marks everything below it with the same moment, and nothing beside it', async () => {
    const doomed = await placeIn(tenant, here.area)

    await marking((tx) =>
      tx.execute(sql`update properties set deleted_at = now() where id = ${doomed.property}`),
    )

    const moment = await deletedAt('properties', doomed.property)

    expect(moment).not.toBeNull()
    expect({
      building: await deletedAt('buildings', doomed.building),
      floor: await deletedAt('floors', doomed.floor),
      room: await deletedAt('rooms', doomed.room),
    }).toEqual({ building: moment, floor: moment, room: moment })

    // The place beside it is untouched.
    expect(await deletedAt('rooms', beside.room)).toBeNull()
  })

  it('marks from any level down, and keeps the moment a row was marked first', async () => {
    const doomed = await placeIn(tenant, here.area)

    await marking((tx) =>
      tx.execute(
        sql`update rooms set deleted_at = now() - interval '1 day' where id = ${doomed.room}`,
      ),
    )

    const roomMoment = await deletedAt('rooms', doomed.room)

    await marking((tx) =>
      tx.execute(sql`update buildings set deleted_at = now() where id = ${doomed.building}`),
    )

    const buildingMoment = await deletedAt('buildings', doomed.building)

    expect(await deletedAt('floors', doomed.floor)).toBe(buildingMoment)
    // Marked before its building, a room keeps its own moment.
    expect(await deletedAt('rooms', doomed.room)).toBe(roomMoment)
    expect(await deletedAt('properties', doomed.property)).toBeNull()
  })

  it('keeps the moment of a floor marked before its building, and of its rooms with it', async () => {
    const doomed = await placeIn(tenant, here.area)

    await marking((tx) =>
      tx.execute(
        sql`update floors set deleted_at = now() - interval '1 day' where id = ${doomed.floor}`,
      ),
    )

    const floorMoment = await deletedAt('floors', doomed.floor)

    // The room went with its floor, at the moment of the floor.
    expect(await deletedAt('rooms', doomed.room)).toBe(floorMoment)

    await marking((tx) =>
      tx.execute(sql`update buildings set deleted_at = now() where id = ${doomed.building}`),
    )

    expect(await deletedAt('buildings', doomed.building)).not.toBe(floorMoment)
    expect(await deletedAt('floors', doomed.floor)).toBe(floorMoment)
    expect(await deletedAt('rooms', doomed.room)).toBe(floorMoment)
  })
})

describe('a change of a place', () => {
  async function stampOf(table: string, id: string) {
    const { rows } = await admin.query<{
      version: number
      sequence: string
      updated_by: string | null
    }>(
      `select version, change_sequence::text as sequence, updated_by from ${table} where id = $1`,
      [id],
    )

    return rows[0]
  }

  it('carries the stamp a device needs, also on the rows a moved property takes along', async () => {
    const moving = await placeIn(tenant, here.area)
    const before = await stampOf('rooms', moving.room)

    expect(before?.version).toBe(1)
    expect(Number(before?.sequence)).toBeGreaterThan(0)

    await database.forTenant({ tenantId: tenant, userId: 'user-lead' }, async (tx) => {
      await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
      await tx.execute(
        sql`update properties set area_id = ${secondArea} where id = ${moving.property}`,
      )
    })

    const after = await stampOf('rooms', moving.room)

    // The room moved with its property, and a device learns of it from the stamp.
    expect(after?.version).toBe(2)
    expect(Number(after?.sequence)).toBeGreaterThan(Number(before?.sequence))
    expect(after?.updated_by).toBe('user-lead')
  })
})

describe('the rules of the model in the database', () => {
  /** Each a row the model in `domain` refuses, and the check that refuses it here. */
  it('refuses what `domain` refuses, check by check', async () => {
    const property = (name: string, postalCode: string) =>
      tried(
        `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         values ($1, $2, $3, 'Hauptstraße 1', $4, 'Ort', 'DE-BW')`,
        [tenant, here.area, name, postalCode],
      )
    const building = (kinds: string, year: number | null) =>
      tried(
        `insert into buildings (tenant_id, property_id, area_id, name, kinds, year_built)
         values ($1, $2, $3, 'Haus C', $4, $5)`,
        [tenant, here.property, here.area, kinds, year],
      )

    expect(await property(' Campus', '68535')).toEqual({
      code: '23514',
      constraint: 'properties_name_shaped',
    })
    expect(await property('Campus', '6853')).toEqual({
      code: '23514',
      constraint: 'properties_postal_code_shaped',
    })
    expect(await building('{}', null)).toEqual({
      code: '23514',
      constraint: 'buildings_kinds_shaped',
    })
    expect(await building('{school,school}', null)).toEqual({
      code: '23514',
      constraint: 'buildings_kinds_shaped',
    })
    expect(await building('{school}', 2101)).toEqual({
      code: '23514',
      constraint: 'buildings_year_built_shaped',
    })
    expect(
      await tried(
        `insert into floors (tenant_id, building_id, property_id, area_id, name, level)
         values ($1, $2, $3, $4, 'Dach', 201)`,
        [tenant, here.building, here.property, here.area],
      ),
    ).toEqual({ code: '23514', constraint: 'floors_level_shaped' })
    expect(
      await tried(
        `insert into rooms (tenant_id, floor_id, building_id, property_id, area_id)
         values ($1, $2, $3, $4, $5)`,
        [tenant, here.floor, here.building, here.property, here.area],
      ),
    ).toEqual({ code: '23514', constraint: 'rooms_named' })

    // A kind the list does not know is no value of the enum at all.
    expect((await building('{castle}', null)).code).toBe('22P02')
  })
})
