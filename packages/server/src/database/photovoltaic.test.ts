import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, refusedBy, resetToMigrated } from './test-database.js'

/**
 * The PV structure below a PV installation in the database (#461, migration
 * 0094): that every part hangs on the asset of the part above it and lies
 * where that asset lies, key by key; that an inverter hangs on a PV
 * installation and nothing else; and that a part marked deleted takes what
 * hangs below it along, as the electrical structure beside it does.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key or the trigger and never a policy, as in the test of the
 * electrical structure.
 */

const tenant: TenantId = newId<'tenant'>()
const installationKind = 'elektro.photovoltaic_installation'

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
     values ($1, $2, $3, 'Werkhof', 'Lagerweg 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenant, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Halle', '{commercial}')`,
    [building, tenant, property, area],
  )

  return { area, property, building }
}

/** An asset of a kind in a place, with a number nobody else has. */
async function assetIn(at: Place, kind = installationKind): Promise<string> {
  numbers += 1

  const { rows } = await admin.query<{ id: string }>(
    `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, $6, 'PV-Anlage') returning id`,
    [tenant, at.property, at.area, at.building, kind, `AN-${String(numbers).padStart(5, '0')}`],
  )

  return rows[0]?.id ?? ''
}

/** An inverter on an asset with a string on it and a module in that. */
async function structureOn(at: Place, asset: string) {
  const place = [tenant, asset, at.property, at.area]
  const { rows: inverter } = await admin.query<{ id: string }>(
    `insert into inverters (tenant_id, asset_id, property_id, area_id, designation)
     values ($1, $2, $3, $4, 'WR 1') returning id`,
    place,
  )
  const { rows: pvString } = await admin.query<{ id: string }>(
    `insert into pv_strings (tenant_id, asset_id, property_id, area_id, inverter_id, designation)
     values ($1, $2, $3, $4, $5, 'String 1') returning id`,
    [...place, inverter[0]?.id],
  )
  const { rows: pvModule } = await admin.query<{ id: string }>(
    `insert into pv_modules (tenant_id, asset_id, property_id, area_id, pv_string_id, rated_power_w)
     values ($1, $2, $3, $4, $5, 400) returning id`,
    [...place, pvString[0]?.id],
  )

  return {
    inverter: inverter[0]?.id ?? '',
    string: pvString[0]?.id ?? '',
    module: pvModule[0]?.id ?? '',
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

describe('the keys of the PV structure', () => {
  /**
   * One attempt per key of this application, read from the catalogue: a key
   * that a later migration adds to the three tables without an attempt here
   * turns this red, and so does an attempt that is not refused by the key it
   * names.
   */
  it('hold every part to the asset of the part above it and to its place, key by key', async () => {
    const asset = await assetIn(here)
    const besideAsset = await assetIn(beside)
    const own = await structureOn(here, asset)
    const other = await structureOn(beside, besideAsset)
    const attempts: Record<string, () => Promise<{ code: string; constraint: string }>> = {}

    for (const table of ['inverters', 'pv_strings', 'pv_modules']) {
      const parent =
        table === 'inverters'
          ? { designation: 'WR 9' }
          : table === 'pv_strings'
            ? { inverter_id: own.inverter, designation: 'String 9' }
            : { pv_string_id: own.string }
      const insert = (values: Record<string, unknown>) => {
        const row = { tenant_id: tenant, ...parent, ...values }

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
    attempts['pv_strings_on_an_inverter_of_their_asset'] = () =>
      tried(
        `insert into pv_strings (tenant_id, asset_id, property_id, area_id, inverter_id, designation)
         values ($1, $2, $3, $4, $5, 'String 2')`,
        [tenant, besideAsset, beside.property, beside.area, own.inverter],
      )
    attempts['pv_modules_on_a_string_of_their_asset'] = () =>
      tried(
        `insert into pv_modules (tenant_id, asset_id, property_id, area_id, pv_string_id)
         values ($1, $2, $3, $4, $5)`,
        [tenant, asset, here.property, here.area, other.string],
      )

    const { rows: keys } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k join pg_class c on c.oid = k.conrelid
        where k.contype = 'f'
          and c.relname in ('inverters', 'pv_strings', 'pv_modules')
          and k.conname ~ '_(follow_their_asset|of_an_asset_of_their_property|on_an_inverter_of_their_asset|on_a_string_of_their_asset)$'
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
      `select area_id::text as area from inverters where id = $1
       union all select area_id::text from pv_strings where id = $2
       union all select area_id::text from pv_modules where id = $3`,
      [made.inverter, made.string, made.module],
    )

    expect(rows).toEqual([{ area: secondArea }, { area: secondArea }, { area: secondArea }])
  })
})

describe('an inverter', () => {
  it('hangs on a PV installation and on no other asset', async () => {
    const lowVoltage = await assetIn(here, 'elektro.low_voltage_installation')
    const installation = await assetIn(here)

    expect(
      await tried(
        `insert into inverters (tenant_id, asset_id, property_id, area_id, designation)
         values ($1, $2, $3, $4, 'WR 1')`,
        [tenant, lowVoltage, here.property, here.area],
      ),
    ).toEqual({ code: 'HT015', constraint: 'unknown' })

    const { inverter } = await structureOn(here, installation)

    // Put on another asset afterwards, the same.
    expect(
      await tried('update inverters set asset_id = $1 where id = $2', [lowVoltage, inverter]),
    ).toMatchObject({ code: 'HT015' })
  })

  it('keeps its installation one while it stands, and lets it go once it is marked', async () => {
    const installation = await assetIn(here)
    const { inverter } = await structureOn(here, installation)

    expect(
      await tried("update assets set kind = 'probe.elevator' where id = $1", [installation]),
    ).toEqual({ code: 'HT015', constraint: 'unknown' })

    await marking((tx) =>
      tx.execute(sql`update inverters set deleted_at = now() where id = ${inverter}`),
    )
    await admin.query("update assets set kind = 'probe.elevator' where id = $1", [installation])

    const { rows } = await admin.query<{ kind: string }>('select kind from assets where id = $1', [
      installation,
    ])

    expect(rows).toEqual([{ kind: 'probe.elevator' }])
  })
})

describe('the PV structure marked deleted', () => {
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
        where c.relname in ('inverters', 'pv_strings', 'pv_modules')
        order by 1`,
    )

    expect(rows).toEqual(
      ['inverters', 'pv_modules', 'pv_strings'].map((table) => ({
        table_name: table,
        may: 'select,insert,update',
        stamped: true,
        logged: true,
      })),
    )
  })

  it('takes along, with an asset, its inverters and everything on them', async () => {
    const asset = await assetIn(here)
    const made = await structureOn(here, asset)

    await marking((tx) => tx.execute(sql`update assets set deleted_at = now() where id = ${asset}`))

    const moment = await deletedAt('assets', asset)

    expect(moment).not.toBeNull()
    expect(await deletedAt('inverters', made.inverter)).toBe(moment)
    expect(await deletedAt('pv_strings', made.string)).toBe(moment)
    expect(await deletedAt('pv_modules', made.module)).toBe(moment)
  })

  it('takes along, with a string, its modules, and leaves the inverter', async () => {
    const made = await structureOn(here, await assetIn(here))

    await marking((tx) =>
      tx.execute(sql`update pv_strings set deleted_at = now() where id = ${made.string}`),
    )

    expect(await deletedAt('pv_modules', made.module)).toBe(
      await deletedAt('pv_strings', made.string),
    )
    expect(await deletedAt('inverters', made.inverter)).toBeNull()
  })

  it('takes along, with an inverter, its strings and their modules', async () => {
    const made = await structureOn(here, await assetIn(here))

    await marking((tx) =>
      tx.execute(sql`update inverters set deleted_at = now() where id = ${made.inverter}`),
    )

    const moment = await deletedAt('inverters', made.inverter)

    expect(await deletedAt('pv_strings', made.string)).toBe(moment)
    expect(await deletedAt('pv_modules', made.module)).toBe(moment)
  })

  it('still takes along, with an asset, its boards and everything on them', async () => {
    const asset = await assetIn(here, 'elektro.low_voltage_installation')
    const { rows } = await admin.query<{ id: string }>(
      `insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation)
       values ($1, $2, $3, $4, 'main_distribution', 'HV') returning id`,
      [tenant, asset, here.property, here.area],
    )

    await marking((tx) => tx.execute(sql`update assets set deleted_at = now() where id = ${asset}`))

    expect(await deletedAt('distribution_boards', rows[0]?.id ?? '')).toBe(
      await deletedAt('assets', asset),
    )
  })
})
