import { randomUUID } from 'node:crypto'

import { documentLimits, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, refusedBy, resetToMigrated } from './test-database.js'

/**
 * The documents of an operator in the database (#97, section 4.10 of the
 * concept): that a document hangs on its property and on at most one record
 * there, on none of another property and none of another tenant, that its
 * name is kept as the model in `domain` keeps it, that the documents of a
 * marked record are marked with it while their versions stay, that a version
 * names only a file of its own tenant, and that who stored it is written from
 * the request.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key or the check and never a policy. The line between the
 * areas is asked in `areas.test.ts`.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()

let admin: Pool
let database: Database

interface Place {
  property: string
  building: string
  room: string
  asset: string
  activity: string
  file: string
}

const empty: Place = { property: '', building: '', room: '', asset: '', activity: '', file: '' }

/** A property with one of everything a document hangs on, and one beside it. */
let here = empty
let beside = empty
/** The same for the other tenant. */
let elsewhere = empty

async function placeIn(tenantId: TenantId, areaName: string): Promise<Place> {
  const place: Place = {
    property: randomUUID(),
    building: randomUUID(),
    room: randomUUID(),
    asset: randomUUID(),
    activity: randomUUID(),
    file: randomUUID().replaceAll('-', '').repeat(2),
  }
  const floor = randomUUID()
  const {
    rows: [area],
  } = await admin.query<{ id: string }>(
    `insert into areas (tenant_id, name) values ($1, $2)
     on conflict (tenant_id, lower(name)) do update set name = excluded.name returning id`,
    [tenantId, areaName],
  )
  const areaId = area?.id

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Schulzentrum', 'Hauptstraße 1', '00001', 'Ort', 'DE-BW')`,
    [place.property, tenantId, areaId],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Schulhaus', '{school}')`,
    [place.building, tenantId, place.property, areaId],
  )
  await admin.query(
    `insert into floors (id, tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, $5, 'Erdgeschoss', 0)`,
    [floor, tenantId, place.building, place.property, areaId],
  )
  await admin.query(
    `insert into rooms (id, tenant_id, floor_id, building_id, property_id, area_id, number)
     values ($1, $2, $3, $4, $5, $6, 'E.14')`,
    [place.room, tenantId, floor, place.building, place.property, areaId],
  )
  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, room_id, kind, number, name)
     values ($1, $2, $3, $4, $5, $6, 'probe.elevator', $7, 'Aufzug')`,
    [
      place.asset,
      tenantId,
      place.property,
      areaId,
      place.building,
      place.room,
      `AN-${randomUUID().slice(0, 8)}`,
    ],
  )
  await admin.query(
    `insert into activities (id, tenant_id, property_id, area_id, kind, title)
     values ($1, $2, $3, $4, 'work_order', 'Notleuchte tauschen')`,
    [place.activity, tenantId, place.property, areaId],
  )
  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type)
     values ($1, $2, 2048, 'application/pdf')`,
    [tenantId, place.file],
  )

  return place
}

/** The columns of a document somebody names, beside its tenant and its name. */
type Hung = Partial<Record<'building' | 'room' | 'asset' | 'activity', string>>

const insertDocument = `insert into attachments (id, tenant_id, property_id, area_id, building_id, room_id,
                                                  asset_id, activity_id, title)
                        select $1, tenant_id, id, area_id, $3, $4, $5, $6, $7
                          from properties where id = $2`

/** A document on a property, at the record named, in the area the property lies in. */
async function documentAt(
  property: string,
  hung: Hung = {},
  title = 'Schaltplan',
): Promise<string> {
  const id = randomUUID()

  await admin.query(insertDocument, [
    id,
    property,
    hung.building ?? null,
    hung.room ?? null,
    hung.asset ?? null,
    hung.activity ?? null,
    title,
  ])

  return id
}

/** The same row, and the key or check that refused it. */
function refusedDocument(property: string, hung: Hung = {}, title = 'Schaltplan') {
  return refusedBy(
    admin.query(insertDocument, [
      randomUUID(),
      property,
      hung.building ?? null,
      hung.room ?? null,
      hung.asset ?? null,
      hung.activity ?? null,
      title,
    ]),
  )
}

async function versionOf(document: string, file: string): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into attachment_versions (id, tenant_id, attachment_id, sha256, file_name, media_type,
                                      size_bytes)
     select $1, tenant_id, id, $3, 'schaltplan.pdf', 'application/pdf', 2048
       from attachments where id = $2`,
    [id, document, file],
  )

  return id
}

async function marked(table: string, id: string): Promise<boolean> {
  const { rows } = await admin.query<{ marked: boolean }>(
    `select deleted_at is not null as marked from ${table} where id = $1`,
    [id],
  )

  return rows[0]?.marked === true
}

/**
 * Something done as the application does it, inside the tenant and under the
 * policies, in every area: a trigger runs as whoever changes the row.
 */
function asTheApplication(statement: ReturnType<typeof sql>, userId = 'user-lead') {
  return database.forTenant({ tenantId: tenant, userId }, async (tx) => {
    await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)

    return tx.execute(statement)
  })
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

  here = await placeIn(tenant, 'Nord')
  beside = await placeIn(tenant, 'Nord')
  elsewhere = await placeIn(other, 'Nord')

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a document', () => {
  it('hangs on its property, or on one record there', async () => {
    for (const hung of [
      {},
      { building: here.building },
      { room: here.room },
      { asset: here.asset },
      { activity: here.activity },
    ]) {
      expect(await marked('attachments', await documentAt(here.property, hung))).toBe(false)
    }
  })

  it('hangs on no two records at once', async () => {
    for (const hung of [
      { asset: here.asset, room: here.room },
      { building: here.building, activity: here.activity },
      { asset: here.asset, activity: here.activity },
    ]) {
      expect(await refusedDocument(here.property, hung)).toEqual({
        code: '23514',
        constraint: 'attachments_hang_on_one_record',
      })
    }
  })

  it('hangs on no record of another property', async () => {
    const constraints = {
      building: 'attachments_at_a_building_of_their_property',
      room: 'attachments_at_a_room_of_their_property',
      asset: 'attachments_at_an_asset_of_their_property',
      activity: 'attachments_at_an_activity_of_their_property',
    } as const

    for (const [record, constraint] of Object.entries(constraints)) {
      const named = record as keyof typeof constraints

      expect([named, await refusedDocument(here.property, { [named]: beside[named] })]).toEqual([
        named,
        { code: '23503', constraint },
      ])
    }
  })

  it('hangs on no record of another tenant, whichever part it gets wrong', async () => {
    // A record of the other tenant under a property of this one.
    expect(await refusedDocument(here.property, { asset: elsewhere.asset })).toEqual({
      code: '23503',
      constraint: 'attachments_at_an_asset_of_their_property',
    })

    // The property of the other tenant, named in this one.
    expect(
      await refusedBy(
        admin.query(
          `insert into attachments (tenant_id, property_id, area_id, title)
           select $1, id, area_id, 'Schaltplan' from properties where id = $2`,
          [tenant, elsewhere.property],
        ),
      ),
    ).toEqual({ code: '23503', constraint: 'attachments_follow_their_property' })
  })

  it('keeps its name trimmed and within the bound of the model', async () => {
    const longest = 'x'.repeat(documentLimits.title)

    expect(await marked('attachments', await documentAt(here.property, {}, longest))).toBe(false)

    for (const title of ['', ' ', ' Schaltplan', 'Schaltplan ', `${longest}x`]) {
      expect([title, await refusedDocument(here.property, {}, title)]).toEqual([
        title,
        { code: '23514', constraint: 'attachments_title_shaped' },
      ])
    }
  })

  it('has one of the kinds of the model, or none', async () => {
    const document = await documentAt(here.property)

    await admin.query(`update attachments set kind = 'circuit_diagram' where id = $1`, [document])

    expect(
      (
        await refusedBy(
          admin.query(`update attachments set kind = 'invoice' where id = $1`, [document]),
        )
      ).code,
    ).toBe('22P02')
  })
})

describe('the documents of a record that is marked', () => {
  it('are marked with it, at the same moment, and no others', async () => {
    const place = await placeIn(tenant, 'Nord')
    const atAsset = await documentAt(place.property, { asset: place.asset })
    const atActivity = await documentAt(place.property, { activity: place.activity })
    const atRoom = await documentAt(place.property, { room: place.room })
    const atBuilding = await documentAt(place.property, { building: place.building })
    const atProperty = await documentAt(place.property)
    const version = await versionOf(atAsset, place.file)
    const untouched = await documentAt(here.property, { asset: here.asset })
    const standing = async () => ({
      asset: await marked('attachments', atAsset),
      activity: await marked('attachments', atActivity),
      room: await marked('attachments', atRoom),
      building: await marked('attachments', atBuilding),
      property: await marked('attachments', atProperty),
    })
    const none = { asset: false, activity: false, room: false, building: false, property: false }

    await asTheApplication(
      sql`update assets set deleted_at = now() where id = ${place.asset} and deleted_at is null`,
    )
    expect(await standing()).toEqual({ ...none, asset: true })

    await asTheApplication(
      sql`update activities set deleted_at = now() where id = ${place.activity} and deleted_at is null`,
    )
    expect(await standing()).toEqual({ ...none, asset: true, activity: true })

    await asTheApplication(
      sql`update rooms set deleted_at = now() where id = ${place.room} and deleted_at is null`,
    )
    expect(await standing()).toEqual({ ...none, asset: true, activity: true, room: true })

    await asTheApplication(
      sql`update buildings set deleted_at = now() where id = ${place.building} and deleted_at is null`,
    )
    expect(await standing()).toEqual({
      ...none,
      asset: true,
      activity: true,
      room: true,
      building: true,
    })

    await asTheApplication(
      sql`update properties set deleted_at = now() where id = ${place.property} and deleted_at is null`,
    )
    expect(await standing()).toEqual({
      asset: true,
      activity: true,
      room: true,
      building: true,
      property: true,
    })

    // The version of a marked document stays as it was written, and a
    // document of another record is none of this.
    expect(await marked('attachment_versions', version)).toBe(false)
    expect(await marked('attachments', untouched)).toBe(false)
  })

  it('go with their property at once, whatever they hang on there', async () => {
    const place = await placeIn(tenant, 'Nord')
    const documents = [
      await documentAt(place.property, { asset: place.asset }),
      await documentAt(place.property, { activity: place.activity }),
      await documentAt(place.property),
    ]

    await asTheApplication(
      sql`update properties set deleted_at = now() where id = ${place.property}`,
    )

    for (const document of documents) {
      expect(await marked('attachments', document)).toBe(true)
    }
  })

  it('stay marked when the record comes back: nothing here brings a row back', async () => {
    const place = await placeIn(tenant, 'Nord')
    const document = await documentAt(place.property, { asset: place.asset })

    await asTheApplication(sql`update assets set deleted_at = now() where id = ${place.asset}`)
    await admin.query('update assets set deleted_at = null where id = $1', [place.asset])

    expect(await marked('attachments', document)).toBe(true)
  })
})

describe('a version of a document', () => {
  it('names a file of its own tenant and of no other', async () => {
    const document = await documentAt(here.property, { asset: here.asset })

    expect(await marked('attachment_versions', await versionOf(document, here.file))).toBe(false)
    expect(await refusedBy(versionOf(document, elsewhere.file))).toEqual({
      code: '23503',
      constraint: 'attachment_versions_file_in_tenant',
    })
    expect(await refusedBy(versionOf(document, 'f'.repeat(64)))).toEqual({
      code: '23503',
      constraint: 'attachment_versions_file_in_tenant',
    })
  })

  it('says who stored it, from the request and from nothing a row names', async () => {
    const document = await documentAt(here.property, { asset: here.asset })
    const id = randomUUID()

    await asTheApplication(
      sql`insert into attachment_versions (id, tenant_id, attachment_id, sha256, file_name, media_type,
                                           size_bytes, created_by)
          values (${id}, ${tenant}, ${document}, ${here.file}, 'schaltplan.pdf', 'application/pdf',
                  2048, 'somebody-else')`,
      'user-technician',
    )

    const { rows } = await admin.query<{ created_by: string | null }>(
      'select created_by from attachment_versions where id = $1',
      [id],
    )

    expect(rows[0]?.created_by).toBe('user-technician')
  })
})
