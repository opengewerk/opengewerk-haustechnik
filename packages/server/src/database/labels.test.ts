import { randomBytes, randomUUID } from 'node:crypto'

import { labelCodeFrom, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  insufficientPrivilege,
  refusedBy,
  resetSchema,
} from './test-database.js'

/**
 * The labels with a QR code in the database (#98, section 3 of the concept):
 * that a code stands once in the whole instance, that an asset and a room have
 * at most one valid label, that a label hangs on an asset or a room of its own
 * property and never on both, that the application may block a label and
 * nothing else about it, that a blocked label stays blocked, that the labels
 * of a marked record are marked with it, and what the one function that looks
 * past the areas says.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key or the check and never a policy. The line between the
 * areas is asked in `areas.test.ts` and over the routes in
 * `api/labels.test.ts`.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()

let admin: Pool
let database: Database

interface Place {
  area: string
  property: string
  building: string
  floor: string
  room: string
  asset: string
}

const empty: Place = { area: '', property: '', building: '', floor: '', room: '', asset: '' }

let here = empty
let beside = empty
let elsewhere = empty

async function placeIn(tenantId: TenantId, areaName: string): Promise<Place> {
  const place: Place = {
    area: '',
    property: randomUUID(),
    building: randomUUID(),
    floor: randomUUID(),
    room: randomUUID(),
    asset: randomUUID(),
  }
  const {
    rows: [area],
  } = await admin.query<{ id: string }>(
    `insert into areas (tenant_id, name) values ($1, $2)
     on conflict (tenant_id, lower(name)) do update set name = excluded.name returning id`,
    [tenantId, areaName],
  )

  place.area = area?.id ?? ''

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Schulzentrum', 'Hauptstraße 1', '00001', 'Ort', 'DE-BW')`,
    [place.property, tenantId, place.area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Schulhaus', '{school}')`,
    [place.building, tenantId, place.property, place.area],
  )
  await admin.query(
    `insert into floors (id, tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, $5, 'Erdgeschoss', 0)`,
    [place.floor, tenantId, place.building, place.property, place.area],
  )
  place.room = await roomIn(tenantId, place)
  place.asset = await assetIn(tenantId, place)

  return place
}

async function roomIn(tenantId: TenantId, place: Place): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into rooms (id, tenant_id, floor_id, building_id, property_id, area_id, number)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      tenantId,
      place.floor,
      place.building,
      place.property,
      place.area,
      `E.${randomUUID().slice(0, 4)}`,
    ],
  )

  return id
}

async function assetIn(tenantId: TenantId, place: Place): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, 'probe.elevator', $6, 'Aufzug')`,
    [id, tenantId, place.property, place.area, place.building, `AN-${randomUUID().slice(0, 8)}`],
  )

  return id
}

function freshCode(): string {
  return labelCodeFrom(randomBytes(10))
}

interface Hung {
  readonly asset?: string
  readonly room?: string
  readonly code?: string
  readonly blocked?: boolean
}

const insertLabel = `insert into labels (id, tenant_id, property_id, area_id, asset_id, room_id, code, blocked_at)
                     select $1, tenant_id, id, area_id, $3, $4, $5, $6
                       from properties where id = $2`

function valuesOf(id: string, property: string, hung: Hung) {
  return [
    id,
    property,
    hung.asset ?? null,
    hung.room ?? null,
    hung.code ?? freshCode(),
    hung.blocked === true ? new Date() : null,
  ]
}

/** A label in a property, on what is named, in the area the property lies in. */
async function labelAt(property: string, hung: Hung = {}): Promise<string> {
  const id = randomUUID()

  await admin.query(insertLabel, valuesOf(id, property, hung))

  return id
}

/** The same row, and the key, the index or the check that refused it. */
function refusedLabel(property: string, hung: Hung = {}) {
  return refusedBy(admin.query(insertLabel, valuesOf(randomUUID(), property, hung)))
}

async function rowOf(id: string) {
  const { rows } = await admin.query<{
    marked: boolean
    blocked: boolean
    area_id: string
    code: string
  }>(
    `select deleted_at is not null as marked, blocked_at is not null as blocked, area_id, code
       from labels where id = $1`,
    [id],
  )

  return rows[0]
}

/**
 * Something done as the application does it, inside a tenant and under the
 * policies, in every area: a trigger runs as whoever changes the row.
 */
function asTheApplication(statement: ReturnType<typeof sql>, tenantId: TenantId = tenant) {
  return database.forTenant({ tenantId, userId: 'user-lead' }, async (tx) => {
    await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)

    return tx.execute(statement)
  })
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

  here = await placeIn(tenant, 'Nord')
  beside = await placeIn(tenant, 'Nord')
  elsewhere = await placeIn(other, 'Nord')

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a label', () => {
  it('hangs on an asset, on a room, or on nothing but its property', async () => {
    const place = await placeIn(tenant, 'Nord')

    for (const hung of [{ asset: place.asset }, { room: place.room }, {}]) {
      expect((await rowOf(await labelAt(place.property, hung)))?.marked).toBe(false)
    }
  })

  it('hangs on no asset and room at once', async () => {
    const place = await placeIn(tenant, 'Nord')

    expect(await refusedLabel(place.property, { asset: place.asset, room: place.room })).toEqual({
      code: '23514',
      constraint: 'labels_hang_on_one_record',
    })
  })

  it('hangs on no asset and no room of another property', async () => {
    expect(await refusedLabel(here.property, { asset: beside.asset })).toEqual({
      code: '23503',
      constraint: 'labels_on_an_asset_of_their_property',
    })
    expect(await refusedLabel(here.property, { room: beside.room })).toEqual({
      code: '23503',
      constraint: 'labels_on_a_room_of_their_property',
    })
  })

  it('carries a code in the shape of the foundation and no other', async () => {
    for (const code of ['3XQ7M2K9PDH4TA6', '3xq7m2k9pdh4ta6w', '3XQ7M2K9PDH4TA6I', '']) {
      expect(await refusedLabel(here.property, { code }), code).toEqual({
        code: '23514',
        constraint: 'labels_code_shaped',
      })
    }
  })

  /**
   * The address on a label names no tenant, so two tenants with the same code
   * would be two doors behind one address.
   */
  it('carries a code that stands once in the whole instance, over every tenant', async () => {
    const code = freshCode()

    await labelAt(here.property, { code })

    expect(await refusedLabel(beside.property, { code })).toEqual({
      code: '23505',
      constraint: 'labels_code_once',
    })
    expect(await refusedLabel(elsewhere.property, { code })).toEqual({
      code: '23505',
      constraint: 'labels_code_once',
    })
  })
})

describe('the valid label of an asset and of a room', () => {
  it('is the only one: a second valid label is refused, one beside a blocked label is not', async () => {
    const place = await placeIn(tenant, 'Nord')

    await labelAt(place.property, { asset: place.asset })
    await labelAt(place.property, { room: place.room })

    expect(await refusedLabel(place.property, { asset: place.asset })).toEqual({
      code: '23505',
      constraint: 'labels_one_valid_per_asset',
    })
    expect(await refusedLabel(place.property, { room: place.room })).toEqual({
      code: '23505',
      constraint: 'labels_one_valid_per_room',
    })

    const second = await placeIn(tenant, 'Nord')

    await labelAt(second.property, { asset: second.asset, blocked: true })
    await labelAt(second.property, { asset: second.asset, blocked: true })
    expect((await rowOf(await labelAt(second.property, { asset: second.asset })))?.blocked).toBe(
      false,
    )
  })

  it('does not count the labels of a sheet, which hang on nothing: there are as many as were printed', async () => {
    const place = await placeIn(tenant, 'Nord')

    for (let made = 0; made < 3; made++) {
      await labelAt(place.property)
    }

    const { rows } = await admin.query<{ labels: number }>(
      `select count(*)::int as labels from labels
        where property_id = $1 and asset_id is null and room_id is null`,
      [place.property],
    )

    expect(rows[0]?.labels).toBe(3)
  })
})

describe('the application', () => {
  it('blocks a label, and changes neither its code nor what it hangs on', async () => {
    const place = await placeIn(tenant, 'Nord')
    const label = await labelAt(place.property, { asset: place.asset })

    await expect(
      asTheApplication(sql`update labels set code = ${freshCode()} where id = ${label}`),
    ).rejects.toMatchObject({ cause: { code: insufficientPrivilege } })
    await expect(
      asTheApplication(sql`update labels set asset_id = null where id = ${label}`),
    ).rejects.toMatchObject({ cause: { code: insufficientPrivilege } })
    await expect(
      asTheApplication(sql`update labels set room_id = ${place.room} where id = ${label}`),
    ).rejects.toMatchObject({ cause: { code: insufficientPrivilege } })
    await expect(
      asTheApplication(sql`update labels set property_id = ${beside.property} where id = ${label}`),
    ).rejects.toMatchObject({ cause: { code: insufficientPrivilege } })
    await expect(
      asTheApplication(sql`delete from labels where id = ${label}`),
    ).rejects.toMatchObject({ cause: { code: insufficientPrivilege } })

    await asTheApplication(sql`update labels set blocked_at = now() where id = ${label}`)

    expect(await rowOf(label)).toMatchObject({ blocked: true, marked: false })
  })
})

describe('a blocked label', () => {
  /**
   * A label is blocked because it was lost or stuck on the wrong thing. One
   * that could be opened again would open whatever it was stuck on, for
   * whoever found it.
   */
  it('stays blocked, whoever asks: neither opened again nor blocked at another time', async () => {
    const place = await placeIn(tenant, 'Nord')
    const label = await labelAt(place.property, { asset: place.asset, blocked: true })

    for (const change of [
      sql`update labels set blocked_at = null where id = ${label}`,
      sql`update labels set blocked_at = now() + interval '1 day' where id = ${label}`,
    ]) {
      await expect(asTheApplication(change)).rejects.toMatchObject({
        cause: { code: '23514', message: 'Ein gesperrtes Etikett bleibt gesperrt.' },
      })
    }

    expect(
      await refusedBy(admin.query('update labels set blocked_at = null where id = $1', [label])),
    ).toMatchObject({ code: '23514' })
    expect((await rowOf(label))?.blocked).toBe(true)
  })
})

describe('the labels of a record that is marked', () => {
  it('are marked with their asset, their room and their property, and no others', async () => {
    const place = await placeIn(tenant, 'Nord')
    const secondAsset = await assetIn(tenant, place)
    const onAsset = await labelAt(place.property, { asset: place.asset })
    const onOther = await labelAt(place.property, { asset: secondAsset })
    const onRoom = await labelAt(place.property, { room: place.room })
    const blank = await labelAt(place.property)

    await asTheApplication(sql`update assets set deleted_at = now() where id = ${place.asset}`)

    expect((await rowOf(onAsset))?.marked).toBe(true)
    expect((await rowOf(onOther))?.marked).toBe(false)
    expect((await rowOf(onRoom))?.marked).toBe(false)

    await asTheApplication(sql`update rooms set deleted_at = now() where id = ${place.room}`)

    expect((await rowOf(onRoom))?.marked).toBe(true)
    expect((await rowOf(blank))?.marked).toBe(false)

    await asTheApplication(
      sql`update properties set deleted_at = now() where id = ${place.property}`,
    )

    expect((await rowOf(onOther))?.marked).toBe(true)
    expect((await rowOf(blank))?.marked).toBe(true)
  })

  it('follow a building down to the doors of its rooms', async () => {
    const place = await placeIn(tenant, 'Nord')
    const onRoom = await labelAt(place.property, { room: place.room })

    await asTheApplication(
      sql`update buildings set deleted_at = now() where id = ${place.building}`,
    )

    expect((await rowOf(onRoom))?.marked).toBe(true)
  })
})

describe('the area of a label', () => {
  it('follows its property into another area', async () => {
    const place = await placeIn(tenant, 'Nord')
    const label = await labelAt(place.property, { asset: place.asset })
    const {
      rows: [south],
    } = await admin.query<{ id: string }>(
      `insert into areas (tenant_id, name) values ($1, 'Süd')
       on conflict (tenant_id, lower(name)) do update set name = excluded.name returning id`,
      [tenant],
    )

    await admin.query('update properties set area_id = $1 where id = $2', [
      south?.id,
      place.property,
    ])

    expect((await rowOf(label))?.area_id).toBe(south?.id)
  })
})

describe('what a code is in the tenant of the transaction, past the areas', () => {
  async function stateOf(code: string, tenantId: TenantId = tenant, userId = 'user-nobody') {
    const { rows } = await database.forTenant({ tenantId, userId }, (tx) =>
      tx.execute<{ state: string | null }>(sql`select label_state_in_tenant(${code}) as state`),
    )

    return rows[0]?.state ?? null
  }

  /**
   * Asked by somebody who sees no area at all: the function looks past the
   * policy of the areas, which is the one thing it is there for.
   */
  it('is valid for a label that opens something, and blocked for one that is blocked or gone with its record', async () => {
    const place = await placeIn(tenant, 'Nord')
    const valid = await labelAt(place.property, { asset: place.asset })
    const blocked = await labelAt(place.property, { room: place.room, blocked: true })
    const gone = await labelAt(place.property)

    await admin.query('update labels set deleted_at = now() where id = $1', [gone])

    expect(await stateOf((await rowOf(valid))?.code ?? '')).toBe('valid')
    expect(await stateOf((await rowOf(blocked))?.code ?? '')).toBe('blocked')
    expect(await stateOf((await rowOf(gone))?.code ?? '')).toBe('blocked')
  })

  it('says nothing about a code nobody carries, and nothing about a label of another tenant', async () => {
    const foreign = await labelAt(elsewhere.property, { asset: elsewhere.asset })
    const code = (await rowOf(foreign))?.code ?? ''

    expect(await stateOf(freshCode())).toBeNull()
    expect(await stateOf(code)).toBeNull()
    expect(await stateOf(code, other)).toBe('valid')
  })

  it('sees no row of the table as the application: only the one word comes out', async () => {
    const place = await placeIn(tenant, 'Nord')
    const label = await labelAt(place.property, { asset: place.asset })
    const { rows } = await database.forTenant({ tenantId: tenant, userId: 'user-nobody' }, (tx) =>
      tx.execute(sql`select id from labels where id = ${label}`),
    )

    expect(rows).toEqual([])
  })
})
