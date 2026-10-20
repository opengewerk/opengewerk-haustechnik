import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, refusedBy, resetToMigrated } from './test-database.js'

/**
 * The electrical structure below a low-voltage installation in the database
 * (#349, migration 0092): that every part hangs on the asset of the part
 * above it and lies where that asset lies, key by key; that a board hangs on
 * a low-voltage installation and nothing else; that a part marked deleted
 * takes what hangs below it along; and that removing a section leaves its
 * circuits on their board.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key or the trigger and never a policy, as in the test of the
 * assets.
 */

const tenant: TenantId = newId<'tenant'>()
const installationKind = 'elektro.low_voltage_installation'

interface Place {
  readonly area: string
  readonly property: string
  readonly building: string
}

let admin: Pool
let database: Database
let here: Place
let beside: Place
let secondArea: string
let numbers = 0

async function areaOf(name: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'insert into areas (tenant_id, name) values ($1, $2) returning id',
    [tenant, name],
  )

  return rows[0]?.id ?? ''
}

async function placeIn(area: string): Promise<Place> {
  const property = randomUUID()
  const building = randomUUID()

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus', 'Hauptstraße 1', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenant, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus', '{school}')`,
    [building, tenant, property, area],
  )

  return { area, property, building }
}

/** An asset of a kind in a place, with a number nobody else has. */
async function assetIn(at: Place, kind = installationKind): Promise<string> {
  numbers += 1

  const { rows } = await admin.query<{ id: string }>(
    `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, $6, 'Niederspannungsanlage') returning id`,
    [tenant, at.property, at.area, at.building, kind, `AN-${String(numbers).padStart(5, '0')}`],
  )

  return rows[0]?.id ?? ''
}

/** A board on an asset with a section, a circuit in it and a piece of equipment on that. */
async function structureOn(at: Place, asset: string) {
  const place = [tenant, asset, at.property, at.area]
  const { rows: board } = await admin.query<{ id: string }>(
    `insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation)
     values ($1, $2, $3, $4, 'main_distribution', 'HV') returning id`,
    place,
  )
  const { rows: section } = await admin.query<{ id: string }>(
    `insert into board_sections (tenant_id, asset_id, property_id, area_id, distribution_board_id, designation)
     values ($1, $2, $3, $4, $5, 'Feld 1') returning id`,
    [...place, board[0]?.id],
  )
  const { rows: circuit } = await admin.query<{ id: string }>(
    `insert into circuits (tenant_id, asset_id, property_id, area_id, distribution_board_id,
                           board_section_id, designation)
     values ($1, $2, $3, $4, $5, $6, 'F1') returning id`,
    [...place, board[0]?.id, section[0]?.id],
  )
  const { rows: device } = await admin.query<{ id: string }>(
    `insert into equipment (tenant_id, asset_id, property_id, area_id, circuit_id, designation)
     values ($1, $2, $3, $4, $5, 'Steckdose Flur') returning id`,
    [...place, circuit[0]?.id],
  )

  return {
    board: board[0]?.id ?? '',
    section: section[0]?.id ?? '',
    circuit: circuit[0]?.id ?? '',
    equipment: device[0]?.id ?? '',
  }
}

/** A row put in past the application, and the key or trigger that refused it. */
function tried(statement: string, values: readonly unknown[]) {
  return refusedBy(admin.query(statement, [...values]))
}

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

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  const area = await areaOf('Nord')

  secondArea = await areaOf('Süd')
  here = await placeIn(area)
  beside = await placeIn(area)

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the keys of the electrical structure', () => {
  /**
   * One attempt per key of this application, read from the catalogue: a key
   * that a later migration adds to the four tables without an attempt here
   * turns this red, and so does an attempt that is not refused by the key it
   * names.
   */
  it('hold every part to the asset of the part above it and to its place, key by key', async () => {
    const asset = await assetIn(here)
    const besideAsset = await assetIn(beside)
    const own = await structureOn(here, asset)
    const other = await structureOn(beside, besideAsset)
    const attempts: Record<string, () => Promise<{ code: string; constraint: string }>> = {}

    for (const table of ['distribution_boards', 'board_sections', 'circuits', 'equipment']) {
      const parent =
        table === 'distribution_boards'
          ? {}
          : table === 'equipment'
            ? { circuit_id: own.circuit }
            : { distribution_board_id: own.board }
      const insert = (values: Record<string, unknown>) => {
        const row = {
          tenant_id: tenant,
          designation: 'Probe',
          ...(table === 'distribution_boards' ? { kind: 'sub_distribution' } : {}),
          ...parent,
          ...values,
        }

        return tried(
          `insert into ${table} (${Object.keys(row).join(', ')})
           values (${Object.keys(row)
             .map((_, index) => `$${index + 1}`)
             .join(', ')})`,
          Object.values(row),
        )
      }

      attempts[`${table}_follow_their_asset`] = () =>
        insert({ asset_id: asset, property_id: here.property, area_id: secondArea })
      attempts[`${table}_of_an_asset_of_their_property`] = () =>
        insert({ asset_id: asset, property_id: beside.property, area_id: here.area })
    }

    // A part on another asset than the part above it, though its place is right.
    attempts['board_sections_on_a_board_of_their_asset'] = () =>
      tried(
        `insert into board_sections (tenant_id, asset_id, property_id, area_id, distribution_board_id, designation)
         values ($1, $2, $3, $4, $5, 'Feld 2')`,
        [tenant, besideAsset, beside.property, beside.area, own.board],
      )
    attempts['circuits_on_a_board_of_their_asset'] = () =>
      tried(
        `insert into circuits (tenant_id, asset_id, property_id, area_id, distribution_board_id, designation)
         values ($1, $2, $3, $4, $5, 'F2')`,
        [tenant, besideAsset, beside.property, beside.area, own.board],
      )
    attempts['equipment_on_a_circuit_of_their_asset'] = () =>
      tried(
        `insert into equipment (tenant_id, asset_id, property_id, area_id, circuit_id, designation)
         values ($1, $2, $3, $4, $5, 'Leuchte')`,
        [tenant, asset, here.property, here.area, other.circuit],
      )

    const { rows: keys } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k join pg_class c on c.oid = k.conrelid
        where k.contype = 'f'
          and c.relname in ('distribution_boards', 'board_sections', 'circuits', 'equipment')
          and k.conname ~ '_(follow_their_asset|of_an_asset_of_their_property|on_a_board_of_their_asset|on_a_circuit_of_their_asset)$'
        order by 1`,
    )

    expect(Object.keys(attempts).sort()).toEqual(keys.map((key) => key.name))

    const refused: Record<string, string> = {}

    for (const [name, attempt] of Object.entries(attempts)) {
      const { code, constraint } = await attempt()

      refused[name] = `${code} ${constraint}`
    }

    expect(refused).toEqual(
      Object.fromEntries(Object.keys(attempts).map((name) => [name, `23503 ${name}`])),
    )
  })

  it('take every part along when its asset follows its property into another area', async () => {
    const at = await placeIn(here.area)
    const made = await structureOn(at, await assetIn(at))

    await admin.query('update properties set area_id = $1 where id = $2', [secondArea, at.property])

    const { rows } = await admin.query<{ area: string }>(
      `select area_id::text as area from distribution_boards where id = $1
       union all select area_id::text from board_sections where id = $2
       union all select area_id::text from circuits where id = $3
       union all select area_id::text from equipment where id = $4`,
      [made.board, made.section, made.circuit, made.equipment],
    )

    expect(rows).toEqual([
      { area: secondArea },
      { area: secondArea },
      { area: secondArea },
      { area: secondArea },
    ])
  })
})

describe('a board', () => {
  it('hangs on a low-voltage installation and on no other asset', async () => {
    const elevator = await assetIn(here, 'probe.elevator')
    const installation = await assetIn(here)

    expect(
      await tried(
        `insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation)
         values ($1, $2, $3, $4, 'main_distribution', 'HV')`,
        [tenant, elevator, here.property, here.area],
      ),
    ).toEqual({ code: 'HT014', constraint: 'unknown' })

    const { board } = await structureOn(here, installation)

    // Put on another asset afterwards, the same.
    expect(
      await tried('update distribution_boards set asset_id = $1 where id = $2', [elevator, board]),
    ).toMatchObject({ code: 'HT014' })
  })

  it('keeps its installation one while it stands, and lets it go once it is marked', async () => {
    const installation = await assetIn(here)
    const { board } = await structureOn(here, installation)

    expect(
      await tried("update assets set kind = 'probe.elevator' where id = $1", [installation]),
    ).toEqual({ code: 'HT014', constraint: 'unknown' })

    await marking((tx) =>
      tx.execute(sql`update distribution_boards set deleted_at = now() where id = ${board}`),
    )
    await admin.query("update assets set kind = 'probe.elevator' where id = $1", [installation])

    const { rows } = await admin.query<{ kind: string }>('select kind from assets where id = $1', [
      installation,
    ])

    expect(rows).toEqual([{ kind: 'probe.elevator' }])
  })
})

/** A further building on the property of a place, in its area, and a room in it. */
async function buildingBeside(
  at: Place,
  name: string,
): Promise<{ building: string; room: string }> {
  const building = randomUUID()
  const floor = randomUUID()
  const room = randomUUID()

  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, $5, '{school}')`,
    [building, tenant, at.property, at.area, name],
  )
  await admin.query(
    `insert into floors (id, tenant_id, property_id, area_id, building_id, name, level)
     values ($1, $2, $3, $4, $5, 'EG', 0)`,
    [floor, tenant, at.property, at.area, building],
  )
  await admin.query(
    `insert into rooms (id, tenant_id, property_id, area_id, building_id, floor_id, name)
     values ($1, $2, $3, $4, $5, $6, 'Technik')`,
    [room, tenant, at.property, at.area, building, floor],
  )

  return { building, room }
}

/** A board on an asset, in a building and room where they are named. */
function boardIn(asset: string, building: string | null, room: string | null = null) {
  return admin.query<{ id: string; building_id: string; room_id: string | null }>(
    `insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation,
                                      building_id, room_id)
     values ($1, $2, $3, $4, 'sub_distribution', 'UV', $5, $6)
     returning id, building_id, room_id`,
    [tenant, asset, here.property, here.area, building, room],
  )
}

/**
 * A board stands in a building (#495, migration 0100): the one of its
 * installation, or one the installation supplies, by itself or through a
 * room in it, and in a room of that building where one is named. Made
 * without a building, it stands where its installation stands, as every
 * board did before; and it follows the installation to another building,
 * unless the installation still supplies the one of before.
 */
describe('a board in a building', () => {
  it('stands where its installation stands when nobody names a building', async () => {
    const asset = await assetIn(here)
    const { rows } = await boardIn(asset, null)

    expect(rows[0]).toMatchObject({ building_id: here.building, room_id: null })
  })

  it('stands in a building its installation supplies, by itself or through a room, in a room there', async () => {
    const asset = await assetIn(here)
    const annex = await buildingBeside(here, 'Anbau')
    const hall = await buildingBeside(here, 'Halle')

    await admin.query(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
       values ($1, $2, $3, $4, $5)`,
      [tenant, asset, here.property, here.area, annex.building],
    )
    await admin.query(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, room_id)
       values ($1, $2, $3, $4, $5)`,
      [tenant, asset, here.property, here.area, hall.room],
    )

    expect((await boardIn(asset, annex.building, annex.room)).rows[0]).toMatchObject({
      building_id: annex.building,
      room_id: annex.room,
    })
    expect((await boardIn(asset, hall.building)).rows[0]).toMatchObject({
      building_id: hall.building,
    })
  })

  it('is refused in a building its installation neither stands in nor supplies, and in a room of another', async () => {
    const asset = await assetIn(here)
    const elsewhere = await buildingBeside(here, 'Turnhalle')
    const removed = await buildingBeside(here, 'Pavillon')

    // A supply marked deleted supplies nothing.
    await admin.query(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id, deleted_at)
       values ($1, $2, $3, $4, $5, now())`,
      [tenant, asset, here.property, here.area, removed.building],
    )

    expect(await refusedBy(boardIn(asset, elsewhere.building))).toMatchObject({ code: 'HT016' })
    expect(await refusedBy(boardIn(asset, removed.building))).toMatchObject({ code: 'HT016' })
    expect(await refusedBy(boardIn(asset, here.building, elsewhere.room))).toMatchObject({
      constraint: 'distribution_boards_in_a_room_of_their_building',
    })

    // Nor moved there afterwards.
    const { rows } = await boardIn(asset, null)

    expect(
      await refusedBy(
        admin.query('update distribution_boards set building_id = $1 where id = $2', [
          elsewhere.building,
          rows[0]?.id,
        ]),
      ),
    ).toMatchObject({ code: 'HT016' })
  })

  it('follows its installation to another building, and stays in one the installation supplies', async () => {
    const asset = await assetIn(here)
    const annex = await buildingBeside(here, 'Neubau')
    const moved = await buildingBeside(here, 'Altbau')

    await admin.query(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
       values ($1, $2, $3, $4, $5)`,
      [tenant, asset, here.property, here.area, annex.building],
    )

    const main = (await boardIn(asset, null)).rows[0]?.id
    const sub = (await boardIn(asset, annex.building, annex.room)).rows[0]?.id

    await admin.query('update assets set building_id = $1 where id = $2', [moved.building, asset])

    const { rows } = await admin.query<{ id: string; building_id: string; room_id: string | null }>(
      'select id, building_id, room_id from distribution_boards where id = any($1)',
      [[main, sub]],
    )
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]))

    expect(byId[main ?? '']).toMatchObject({ building_id: moved.building, room_id: null })
    expect(byId[sub ?? '']).toMatchObject({ building_id: annex.building, room_id: annex.room })
  })
})

describe('the structure marked deleted', () => {
  it('is only ever marked: the application may read, add and change a part and remove none', async () => {
    const { rows } = await admin.query<{
      table_name: string
      may: string
      stamped: boolean
      logged: boolean
    }>(
      `select c.relname as table_name,
              concat_ws(',',
                case when has_table_privilege('opengewerk_app', c.oid, 'SELECT') then 'select' end,
                case when has_table_privilege('opengewerk_app', c.oid, 'INSERT') then 'insert' end,
                case when has_table_privilege('opengewerk_app', c.oid, 'UPDATE') then 'update' end,
                case when has_table_privilege('opengewerk_app', c.oid, 'DELETE') then 'delete' end) as may,
              exists (select 1 from pg_trigger t
                       where t.tgrelid = c.oid and t.tgname = 'stamp_sync_columns') as stamped,
              exists (select 1 from pg_trigger t
                       where t.tgrelid = c.oid and t.tgname = 'audit_changes') as logged
         from pg_class c
        where c.relname in ('distribution_boards', 'board_sections', 'circuits', 'equipment')
        order by 1`,
    )

    expect(rows).toEqual(
      ['board_sections', 'circuits', 'distribution_boards', 'equipment'].map((table) => ({
        table_name: table,
        may: 'select,insert,update',
        stamped: true,
        logged: true,
      })),
    )
  })

  it('takes along, with an asset, its boards and everything on them', async () => {
    const asset = await assetIn(here)
    const made = await structureOn(here, asset)

    await marking((tx) => tx.execute(sql`update assets set deleted_at = now() where id = ${asset}`))

    const moment = await deletedAt('assets', asset)

    expect(moment).not.toBeNull()
    expect(await deletedAt('distribution_boards', made.board)).toBe(moment)
    expect(await deletedAt('board_sections', made.section)).toBe(moment)
    expect(await deletedAt('circuits', made.circuit)).toBe(moment)
    expect(await deletedAt('equipment', made.equipment)).toBe(moment)
  })

  it('takes along, with a section, its circuits and their equipment, and leaves the board', async () => {
    const made = await structureOn(here, await assetIn(here))
    const { rows: direct } = await admin.query<{ id: string }>(
      `insert into circuits (tenant_id, asset_id, property_id, area_id, distribution_board_id, designation)
       select tenant_id, asset_id, property_id, area_id, id, 'F9' from distribution_boards where id = $1
       returning id`,
      [made.board],
    )

    await marking((tx) =>
      tx.execute(sql`update board_sections set deleted_at = now() where id = ${made.section}`),
    )

    const moment = await deletedAt('board_sections', made.section)

    expect(await deletedAt('circuits', made.circuit)).toBe(moment)
    expect(await deletedAt('equipment', made.equipment)).toBe(moment)
    expect(await deletedAt('distribution_boards', made.board)).toBeNull()
    expect(await deletedAt('circuits', direct[0]?.id ?? '')).toBeNull()
  })

  it('takes along, with a circuit, its equipment', async () => {
    const made = await structureOn(here, await assetIn(here))

    await marking((tx) =>
      tx.execute(sql`update circuits set deleted_at = now() where id = ${made.circuit}`),
    )

    expect(await deletedAt('equipment', made.equipment)).toBe(
      await deletedAt('circuits', made.circuit),
    )
    expect(await deletedAt('board_sections', made.section)).toBeNull()
  })

  it('leaves a circuit on its board when its section is removed for real', async () => {
    const made = await structureOn(here, await assetIn(here))

    await admin.query('delete from board_sections where id = $1', [made.section])

    const { rows } = await admin.query<{ board: string; section: string | null }>(
      'select distribution_board_id as board, board_section_id as section from circuits where id = $1',
      [made.circuit],
    )

    expect(rows).toEqual([{ board: made.board, section: null }])
  })
})
