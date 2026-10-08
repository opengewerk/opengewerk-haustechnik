import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, refusedBy, resetToMigrated } from './test-database.js'

/**
 * The technology in the database (ADR 0002, points 4 to 9): that every row
 * hangs on its asset and its place, key by key, that no asset hangs under
 * itself, that an asset stays on its property and takes its components along
 * to another building, that an asset has one state a day and a number once,
 * and that marking a place or an asset marks what hangs below it.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key, the check or the trigger and never a policy: a trigger
 * that holds for the superuser holds for every role.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()

/** A place in one area, with a second building on the same property. */
interface Place {
  readonly tenant: TenantId
  readonly area: string
  readonly property: string
  readonly building: string
  readonly room: string
  readonly annex: string
  readonly annexRoom: string
}

let admin: Pool
let database: Database
let here: Place
let beside: Place
let elsewhere: Place
let secondArea: string
let numbers = 0

async function areaOf(tenantId: TenantId, name: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'insert into areas (tenant_id, name) values ($1, $2) returning id',
    [tenantId, name],
  )

  return rows[0]?.id ?? ''
}

/** A building with a floor and a room on it. */
async function buildingWithRoom(
  tenantId: TenantId,
  property: string,
  area: string,
): Promise<{ building: string; room: string }> {
  const building = randomUUID()
  const floor = randomUUID()
  const room = randomUUID()

  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus', '{school}')`,
    [building, tenantId, property, area],
  )
  await admin.query(
    `insert into floors (id, tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, $5, 'Erdgeschoss', 0)`,
    [floor, tenantId, building, property, area],
  )
  await admin.query(
    `insert into rooms (id, tenant_id, floor_id, building_id, property_id, area_id, number)
     values ($1, $2, $3, $4, $5, $6, '0.01')`,
    [room, tenantId, floor, building, property, area],
  )

  return { building, room }
}

async function placeIn(tenantId: TenantId, area: string): Promise<Place> {
  const property = randomUUID()

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus', 'Hauptstraße 1', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenantId, area],
  )

  const main = await buildingWithRoom(tenantId, property, area)
  const annex = await buildingWithRoom(tenantId, property, area)

  return {
    tenant: tenantId,
    area,
    property,
    building: main.building,
    room: main.room,
    annex: annex.building,
    annexRoom: annex.room,
  }
}

/** An asset in a place, put in past the application, with a number nobody else has. */
async function assetIn(
  at: Place,
  where: { building?: string; room?: string | null; parent?: string | null } = {},
): Promise<string> {
  numbers += 1

  const { rows } = await admin.query<{ id: string }>(
    `insert into assets (tenant_id, property_id, area_id, building_id, room_id, parent_asset_id, kind, number, name)
     values ($1, $2, $3, $4, $5, $6, 'probe.elevator', $7, 'Aufzug')
     returning id`,
    [
      at.tenant,
      at.property,
      at.area,
      where.building ?? at.building,
      where.room ?? null,
      where.parent ?? null,
      `AN-${String(numbers).padStart(5, '0')}`,
    ],
  )

  return rows[0]?.id ?? ''
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

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

/** A row put in past the application, and the key, check or trigger that refused it. */
function tried(statement: string, values: readonly unknown[]) {
  return refusedBy(admin.query(statement, [...values]))
}

describe('the keys of the technology', () => {
  /**
   * One attempt per key, read from the catalogue: a key that a later
   * migration adds without an attempt here turns this red, and so does an
   * attempt that is not refused by the key it names.
   */
  it('hold every row to its asset and its place, key by key', async () => {
    const asset = await assetIn(here)
    const besideAsset = await assetIn(beside)
    const attempts: Record<string, () => Promise<{ code: string; constraint: string }>> = {
      assets_follow_their_property: () =>
        tried(
          `insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
           values ($1, $2, $3, $4, 'probe.elevator', 'Aufzug')`,
          [tenant, here.property, secondArea, here.building],
        ),
      assets_in_a_building_of_their_property: () =>
        tried(
          `insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
           values ($1, $2, $3, $4, 'probe.elevator', 'Aufzug')`,
          [tenant, here.property, here.area, beside.building],
        ),
      assets_in_a_room_of_their_building: () =>
        tried(
          `insert into assets (tenant_id, property_id, area_id, building_id, room_id, kind, name)
           values ($1, $2, $3, $4, $5, 'probe.elevator', 'Aufzug')`,
          [tenant, here.property, here.area, here.building, here.annexRoom],
        ),
      components_in_the_building_of_their_asset: () =>
        tried(
          `insert into assets (tenant_id, property_id, area_id, building_id, parent_asset_id, kind, name)
           values ($1, $2, $3, $4, $5, 'probe.elevator', 'Antrieb')`,
          [tenant, here.property, here.area, here.annex, asset],
        ),
      asset_lifecycle_of_an_asset: () =>
        tried(
          `insert into asset_lifecycle (tenant_id, asset_id, property_id, area_id, state, valid_from)
           values ($1, $2, $3, $4, 'in_service', '2020-01-01')`,
          [tenant, besideAsset, here.property, here.area],
        ),
      asset_lifecycle_follows_its_property: () =>
        tried(
          `insert into asset_lifecycle (tenant_id, asset_id, property_id, area_id, state, valid_from)
           values ($1, $2, $3, $4, 'in_service', '2020-01-01')`,
          [tenant, asset, here.property, secondArea],
        ),
      asset_supplies_of_an_asset: () =>
        tried(
          `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
           values ($1, $2, $3, $4, $5)`,
          [tenant, besideAsset, here.property, here.area, here.annex],
        ),
      asset_supplies_follow_their_property: () =>
        tried(
          `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
           values ($1, $2, $3, $4, $5)`,
          [tenant, asset, here.property, secondArea, here.annex],
        ),
      asset_supplies_to_a_building_of_its_property: () =>
        tried(
          `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
           values ($1, $2, $3, $4, $5)`,
          [tenant, asset, here.property, here.area, beside.building],
        ),
      asset_supplies_to_a_room_of_its_property: () =>
        tried(
          `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, room_id)
           values ($1, $2, $3, $4, $5)`,
          [tenant, asset, here.property, here.area, beside.room],
        ),
    }

    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f'
          and c.relname in ('assets', 'asset_lifecycle', 'asset_supplies')
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

  it('take an asset in a room of its building, a component under it and what it supplies', async () => {
    const asset = await assetIn(here, { room: here.room })
    const component = await assetIn(here, { parent: asset })
    const { rowCount } = await admin.query(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, room_id)
       values ($1, $2, $3, $4, $5)`,
      [tenant, component, here.property, here.area, here.annexRoom],
    )

    expect(component).not.toBe('')
    expect(rowCount).toBe(1)
  })
})

describe('a component', () => {
  it('does not hang under itself, neither directly nor at the end of a chain', async () => {
    const top = await assetIn(here)
    const middle = await assetIn(here, { parent: top })
    const bottom = await assetIn(here, { parent: middle })
    const itself = randomUUID()

    // A row that names itself when it is made: the trigger walks up from a
    // parent that is not there yet and finds nothing, and the key would be
    // content with the row itself. Only the check sees it.
    expect(
      await tried(
        `insert into assets (id, tenant_id, property_id, area_id, building_id, parent_asset_id, kind, name)
         values ($1, $2, $3, $4, $5, $1, 'probe.elevator', 'Aufzug')`,
        [itself, tenant, here.property, here.area, here.building],
      ),
    ).toEqual({ code: '23514', constraint: 'assets_not_their_own_component' })
    // A row that is there: the trigger comes before the check and finds it.
    expect(
      await tried('update assets set parent_asset_id = id where id = $1', [top]),
    ).toMatchObject({ code: 'HT001' })
    expect(
      await tried('update assets set parent_asset_id = $2 where id = $1', [top, middle]),
    ).toMatchObject({ code: 'HT001' })
    expect(
      await tried('update assets set parent_asset_id = $2 where id = $1', [top, bottom]),
    ).toMatchObject({ code: 'HT001' })
  })

  it('moves with its asset to another building of the property, at any depth', async () => {
    const top = await assetIn(here)
    const middle = await assetIn(here, { parent: top })
    const bottom = await assetIn(here, { parent: middle })

    await admin.query('update assets set building_id = $2 where id = $1', [top, here.annex])

    const { rows } = await admin.query<{ id: string; building_id: string }>(
      'select id, building_id from assets where id = any($1::uuid[]) order by id',
      [[top, middle, bottom]],
    )

    expect(rows.map((row) => row.building_id)).toEqual([here.annex, here.annex, here.annex])
  })
})

describe('an asset', () => {
  it('stays on its property', async () => {
    const asset = await assetIn(here)

    expect(
      await tried('update assets set property_id = $2, building_id = $3 where id = $1', [
        asset,
        beside.property,
        beside.building,
      ]),
    ).toMatchObject({ code: 'HT002' })
  })

  it('has one state a day, and a marked entry makes room on its day', async () => {
    const asset = await assetIn(here)
    const entry = (state: string) =>
      admin.query(
        `insert into asset_lifecycle (tenant_id, asset_id, property_id, area_id, state, valid_from)
         values ($1, $2, $3, $4, $5, '2020-01-01') returning id`,
        [tenant, asset, here.property, here.area, state],
      )
    const { rows } = await entry('in_service')

    expect(await refusedBy(entry('planned'))).toEqual({
      code: '23505',
      constraint: 'asset_lifecycle_one_state_a_day',
    })

    await admin.query('update asset_lifecycle set deleted_at = now() where id = $1', [rows[0]?.id])

    expect((await entry('planned')).rowCount).toBe(1)
  })

  it('carries its number once in its tenant, and another tenant may carry the same', async () => {
    await admin.query(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
       values ($1, $2, $3, $4, 'probe.elevator', 'AN-77777', 'Aufzug')`,
      [tenant, here.property, here.area, here.building],
    )

    expect(
      await tried(
        `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
         values ($1, $2, $3, $4, 'probe.elevator', 'AN-77777', 'Aufzug')`,
        [tenant, here.property, here.area, here.annex],
      ),
    ).toEqual({ code: '23505', constraint: 'assets_number_once' })
    expect(
      (
        await admin.query(
          `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
           values ($1, $2, $3, $4, 'probe.elevator', 'AN-77777', 'Aufzug')`,
          [other, elsewhere.property, elsewhere.area, elsewhere.building],
        )
      ).rowCount,
    ).toBe(1)
  })

  it('is refused what the model in domain refuses', async () => {
    const values = (column: string, value: unknown) =>
      tried(
        `insert into assets (tenant_id, property_id, area_id, building_id, kind, name, ${column})
         values ($1, $2, $3, $4, 'probe.elevator', 'Aufzug', $5)`,
        [tenant, here.property, here.area, here.building, value],
      )

    expect(await values('values', JSON.stringify(['stops']))).toEqual({
      code: '23514',
      constraint: 'assets_values_shaped',
    })
    expect(await values('meter_number', '1ESY1160123456')).toEqual({
      code: '23514',
      constraint: 'assets_meter_whole',
    })
    expect(await values('year_built', 1799)).toEqual({
      code: '23514',
      constraint: 'assets_year_built_shaped',
    })
    expect(await values('mark', ' AZ-01 ')).toEqual({
      code: '23514',
      constraint: 'assets_mark_shaped',
    })
    expect(
      await tried(
        `insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
         values ($1, $2, $3, $4, 'probe.elevator', '  ')`,
        [tenant, here.property, here.area, here.building],
      ),
    ).toEqual({ code: '23514', constraint: 'assets_name_shaped' })
    expect(
      await tried(
        `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id, room_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenant, await assetIn(here), here.property, here.area, here.annex, here.annexRoom],
      ),
    ).toEqual({ code: '23514', constraint: 'asset_supplies_one_place' })
  })
})

describe('the technology marked deleted', () => {
  it('is only ever marked: the application may not remove a row of it', async () => {
    const { rows } = await admin.query<{ table_name: string; may_delete: boolean }>(
      `select c.relname as table_name, has_table_privilege('opengewerk_app', c.oid, 'DELETE') as may_delete
         from pg_class c
        where c.relname in ('assets', 'asset_lifecycle', 'asset_supplies')
        order by 1`,
    )

    expect(rows).toEqual([
      { table_name: 'asset_lifecycle', may_delete: false },
      { table_name: 'asset_supplies', may_delete: false },
      { table_name: 'assets', may_delete: false },
    ])
  })

  async function deletedAt(table: string, id: string): Promise<string | null> {
    const { rows } = await admin.query<{ at: string | null }>(
      `select deleted_at::text as at from ${table} where id = $1`,
      [id],
    )

    return rows[0]?.at ?? null
  }

  /** Marked as the application marks it, inside the tenant and under the policies, in every area. */
  function marking(work: (tx: TenantTransaction) => Promise<unknown>) {
    return database.forTenant({ tenantId: tenant, userId: 'user-lead' }, async (tx) => {
      await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
      await work(tx)
    })
  }

  /** An asset in the room with a component, an entry of its life cycle and a supply. */
  async function equipped(at: Place) {
    const asset = await assetIn(at, { room: at.room })
    const component = await assetIn(at, { parent: asset })
    const { rows: entry } = await admin.query<{ id: string }>(
      `insert into asset_lifecycle (tenant_id, asset_id, property_id, area_id, state, valid_from)
       values ($1, $2, $3, $4, 'in_service', '2020-01-01') returning id`,
      [at.tenant, asset, at.property, at.area],
    )
    const { rows: supply } = await admin.query<{ id: string }>(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, room_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [at.tenant, asset, at.property, at.area, at.annexRoom],
    )

    return { asset, component, entry: entry[0]?.id ?? '', supply: supply[0]?.id ?? '' }
  }

  it('takes along, with an asset, its components, its life cycle and its supplies', async () => {
    const made = await equipped(here)

    await marking((tx) =>
      tx.execute(sql`update assets set deleted_at = now() where id = ${made.asset}`),
    )

    const moment = await deletedAt('assets', made.asset)

    expect(moment).not.toBeNull()
    expect(await deletedAt('assets', made.component)).toBe(moment)
    expect(await deletedAt('asset_lifecycle', made.entry)).toBe(moment)
    expect(await deletedAt('asset_supplies', made.supply)).toBe(moment)
  })

  it('takes along, with a building, the assets in it and the supplies to it', async () => {
    const at = await placeIn(tenant, here.area)
    const made = await equipped(at)
    // The asset in the room goes with its room as well; this one stands in no
    // room, and only the building takes it along.
    const roomless = await assetIn(at)
    const { rows: toBuilding } = await admin.query<{ id: string }>(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [tenant, await assetIn(at, { building: at.annex }), at.property, at.area, at.building],
    )

    await marking((tx) =>
      tx.execute(sql`update buildings set deleted_at = now() where id = ${at.building}`),
    )

    const moment = await deletedAt('buildings', at.building)

    expect(await deletedAt('assets', roomless)).toBe(moment)
    expect(await deletedAt('assets', made.asset)).toBe(moment)
    expect(await deletedAt('assets', made.component)).toBe(moment)
    expect(await deletedAt('asset_lifecycle', made.entry)).toBe(moment)
    expect(await deletedAt('asset_supplies', toBuilding[0]?.id ?? '')).toBe(moment)
  })

  it('takes along, with a room, the assets standing in it and the supplies to it', async () => {
    const at = await placeIn(tenant, here.area)
    const made = await equipped(at)
    const elsewhereInTheAnnex = await assetIn(at, { building: at.annex })

    await marking((tx) =>
      tx.execute(sql`update rooms set deleted_at = now() where id = ${at.annexRoom}`),
    )

    const moment = await deletedAt('rooms', at.annexRoom)

    // The supply to the room goes; the asset supplying it stands in another
    // room and stays, as does an asset of the annex that stands in no room.
    expect(await deletedAt('asset_supplies', made.supply)).toBe(moment)
    expect(await deletedAt('assets', made.asset)).toBeNull()
    expect(await deletedAt('assets', elsewhereInTheAnnex)).toBeNull()

    await marking((tx) =>
      tx.execute(sql`update rooms set deleted_at = now() where id = ${at.room}`),
    )

    expect(await deletedAt('assets', made.asset)).toBe(await deletedAt('rooms', at.room))
  })
})

describe('a change of the technology', () => {
  it('carries the stamp a device needs, in every table of it', async () => {
    const asset = await assetIn(here)
    const { rows } = await admin.query<{ table_name: string; stamped: boolean }>(
      `select 'assets' as table_name, change_sequence > 0 as stamped from assets where id = $1`,
      [asset],
    )

    expect(rows).toEqual([{ table_name: 'assets', stamped: true }])

    const { rows: triggers } = await admin.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where t.tgname = 'stamp_sync_columns'
          and c.relname in ('assets', 'asset_lifecycle', 'asset_supplies')
        order by 1`,
    )

    expect(triggers.map((row) => row.table_name)).toEqual([
      'asset_lifecycle',
      'asset_supplies',
      'assets',
    ])
  })
})
