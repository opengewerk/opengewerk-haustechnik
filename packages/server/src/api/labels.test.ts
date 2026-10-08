import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  isLabelCode,
  labelBatchMost,
  missingRight,
  printedLabelCode,
  type Right,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  type SyncValue,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  Database,
  newId,
  type PrintJob,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The labels with a QR code over the routes of the server (#98, section 3 of
 * the concept): who makes, blocks and prints a label of an asset and of a
 * room, what stands on one, what a print of many makes, what a device holds,
 * and what a code is for the person asking.
 *
 * The page of a label, the drawing of a code and the QR code are the
 * foundation's and tested there. What is held here is what this application
 * decides: what a label hangs on, whose right it takes, that an asset and a
 * room have one valid label, that a blocked label opens nothing for anybody,
 * and that the answer about a code in another area names nothing.
 */

/** One area, as most tenants have it: everybody works in it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south: the Haustechnik in the north, the Objektleitung in the south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
}

const address = 'https://haustechnik.example'

let admin: Pool
let database: Database
let app: INestApplication

/** What the renderer was handed, newest last, and what it does when asked. */
let printed: PrintJob[] = []
let rendering: (job: PrintJob) => Promise<Uint8Array>

const bytes = Buffer.from('%PDF-1.7\n% Etikett\n%%EOF\n', 'utf8')

function http() {
  return request(app.getHttpServer())
}

/** The header of somebody with one of the four roles, in one of the tenants. */
function by(role: RoleKey, tenantId: TenantId = small): string {
  return as(tenantId, people[role], role)
}

/** Somebody with the rights of a role except for some, as a role of a tenant's own could be. */
function without(role: RoleKey, ...taken: Right[]): string {
  return JSON.stringify({
    userId: people[role],
    tenantId: small,
    roles: [role],
    rights: [...rightsOfRoles([role])].filter((right) => !taken.includes(right)),
  })
}

function post(path: string, header: string, body: object = {}) {
  return http().post(path).set(testIdentityHeader, header).send(body)
}

function get(path: string, header: string) {
  return http().get(path).set(testIdentityHeader, header)
}

let recorded = Date.parse('2026-10-06T08:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  entity: string,
  kind: 'create' | 'update' | 'delete',
  recordId: string,
  values: Readonly<Record<string, SyncValue>> = {},
) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind,
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

/** A property with a building, a floor and a room, and an elevator in the room. */
interface Place {
  readonly property: string
  readonly building: string
  readonly floor: string
  readonly room: string
  readonly asset: string
}

async function made(header: string, path: string, body: object): Promise<string> {
  return (await post(path, header, body).expect(201)).body.id as string
}

async function assetIn(
  tenantId: TenantId,
  building: string,
  room: string | null,
  name: string,
): Promise<string> {
  return made(by('technical_management', tenantId), `/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name,
    ...(room === null ? {} : { roomId: room }),
  })
}

async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('technical_management', tenantId)
  const property = await made(header, '/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...extra,
  })
  const building = await made(header, `/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const floor = await made(header, `/buildings/${building}/floors`, {
    name: 'Erdgeschoss',
    level: 0,
  })
  const room = await made(header, `/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' })
  const asset = await assetIn(tenantId, building, room, 'Aufzug Haus A')

  return { property, building, floor, room, asset }
}

interface MadeLabel {
  readonly id: string
  readonly code: string
  readonly blockedAt: string | null
  readonly propertyId: string
  readonly areaId: string
  readonly assetId: string | null
  readonly roomId: string | null
}

async function labelOf(holder: 'assets' | 'rooms', id: string, header: string) {
  return (await post(`/${holder}/${id}/labels`, header).expect(201)).body as MadeLabel
}

/** The labels of a property as the database holds them, the newest last. */
async function labelsIn(property: string) {
  const { rows } = await admin.query<{
    code: string
    asset_id: string | null
    room_id: string | null
    blocked: boolean
  }>(
    `select code, asset_id, room_id, blocked_at is not null as blocked
       from labels where property_id = $1 and deleted_at is null order by created_at, id`,
    [property],
  )

  return rows
}

/** What a code is for somebody, the whole answer. */
async function standingOf(code: string, header: string): Promise<unknown> {
  return (await get(`/labels/${code}`, header).expect(200)).body
}

/** The page the renderer was handed last. */
function lastPage(): string {
  return printed.at(-1)?.html ?? ''
}

let place: Place
let inNorth: Place
let inSouth: Place

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
  ])

  // The large tenant has its two areas before anybody works for it.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const role of roleKeys) {
    const userId = people[role]

    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  await admin.query(
    'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3), ($1, $4, $5)',
    [large, people.technician, north, people.site_management, south],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue: catalogueOf(probeCatalogueBundle),
        trustedOrigins: [address],
        renderer: (job) => rendering(job),
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  place = await placeIn()
  inNorth = await placeIn(large, { areaId: north })
  inSouth = await placeIn(large, { areaId: south })
})

beforeEach(() => {
  printed = []
  rendering = (job) => {
    printed.push(job)

    return Promise.resolve(bytes)
  }
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the label of an asset', () => {
  it('is made by whoever takes assets into the register, with a code the server draws and the place of the asset', async () => {
    const fresh = await placeIn()
    const label = await labelOf('assets', fresh.asset, by('technician'))

    expect(isLabelCode(label.code)).toBe(true)
    expect(label).toMatchObject({
      blockedAt: null,
      propertyId: fresh.property,
      assetId: fresh.asset,
      roomId: null,
    })
    expect(await labelsIn(fresh.property)).toEqual([
      { code: label.code, asset_id: fresh.asset, room_id: null, blocked: false },
    ])
  })

  it('is not made by somebody who may only look at assets', async () => {
    const fresh = await placeIn()
    const answer = await post(
      `/assets/${fresh.asset}/labels`,
      without('technician', 'asset.record'),
    ).expect(403)

    expect(answer.body.message).toBe(missingRight('asset.record'))
    expect(await labelsIn(fresh.property)).toEqual([])
  })

  /**
   * Two valid labels would be two stickers that open the asset, and blocking
   * the one would not block the other.
   */
  it('is the only valid one: a second is refused until the first is blocked', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const first = await labelOf('assets', fresh.asset, tech)
    const refused = await post(`/assets/${fresh.asset}/labels`, tech).expect(409)

    expect(refused.body.message).toBe(
      'Diese Anlage hat schon ein gültiges Etikett. Erst sperren, dann ein neues anlegen.',
    )

    await post(`/assets/${fresh.asset}/labels/${first.id}/block`, tech).expect(200)

    const second = await labelOf('assets', fresh.asset, tech)

    expect(second.code).not.toBe(first.code)
    expect(await labelsIn(fresh.property)).toEqual([
      { code: first.code, asset_id: fresh.asset, room_id: null, blocked: true },
      { code: second.code, asset_id: fresh.asset, room_id: null, blocked: false },
    ])
  })

  it('is blocked for good by whoever takes assets into the register, and blocking it again changes nothing', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const label = await labelOf('assets', fresh.asset, tech)
    const path = `/assets/${fresh.asset}/labels/${label.id}/block`

    await post(path, without('technician', 'asset.record')).expect(403)
    expect(await labelsIn(fresh.property)).toMatchObject([{ blocked: false }])

    const blocked = (await post(path, tech).expect(200)).body as MadeLabel
    const again = (await post(path, tech).expect(200)).body as MadeLabel

    expect(blocked.blockedAt).not.toBeNull()
    expect(again.blockedAt).toBe(blocked.blockedAt)
  })

  it('is not there under another asset, and not for somebody outside the area of its asset', async () => {
    const label = await labelOf('assets', inSouth.asset, by('site_management', large))

    // The technician of the north sees neither the asset nor its label.
    await post(`/assets/${inSouth.asset}/labels/${label.id}/block`, by('technician', large)).expect(
      404,
    )
    await get(`/assets/${inSouth.asset}/labels/${label.id}/pdf`, by('technician', large)).expect(
      404,
    )
    await post(`/assets/${inSouth.asset}/labels`, by('technician', large)).expect(404)
    // And under the asset of the north there is no such label.
    await post(`/assets/${inNorth.asset}/labels/${label.id}/block`, by('management', large)).expect(
      404,
    )

    expect(await labelsIn(inSouth.property)).toEqual([
      { code: label.code, asset_id: inSouth.asset, room_id: null, blocked: false },
    ])
    expect(await labelsIn(inNorth.property)).toEqual([])
  })
})

describe('the printed label of an asset', () => {
  it('names the operator, the asset with its number, and its building and room, and leads to its code at the address of the instance', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const label = await labelOf('assets', fresh.asset, tech)
    const { rows } = await admin.query<{ number: string }>(
      'select number from assets where id = $1',
      [fresh.asset],
    )
    const answer = await get(`/assets/${fresh.asset}/labels/${label.id}/pdf`, tech)
      .buffer(true)
      .expect(200)

    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(printed).toHaveLength(1)
    expect(lastPage()).toContain('Wohnbau Nord eG')
    expect(lastPage()).toContain(`${String(rows[0]?.number)} Aufzug Haus A`)
    expect(lastPage()).toContain('Haus A, 0.01 Technik')
    expect(lastPage()).toContain(printedLabelCode(label.code))
    expect(printed[0]?.size).toEqual({ width: '62mm', height: '29mm' })
  })

  it('is printed as often as asked, on a sheet from the field named, and no more than a sheet holds', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const label = await labelOf('assets', fresh.asset, tech)
    const path = `/assets/${fresh.asset}/labels/${label.id}/pdf`

    await get(`${path}?format=sheet&count=3&start=5`, tech).expect(200)

    expect(lastPage().split(printedLabelCode(label.code))).toHaveLength(4)
    expect(printed[0]?.size).toBeUndefined()

    await get(`${path}?format=sheet&count=25`, tech).expect(422)
    await get(`${path}?format=sheet&start=25`, tech).expect(422)
    await get(`${path}?format=folio`, tech).expect(400)
    expect(printed).toHaveLength(1)
  })

  it('is not printed once it is blocked', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const label = await labelOf('assets', fresh.asset, tech)

    await post(`/assets/${fresh.asset}/labels/${label.id}/block`, tech).expect(200)

    const refused = await get(`/assets/${fresh.asset}/labels/${label.id}/pdf`, tech).expect(409)

    expect(refused.body.message).toBe('Ein gesperrtes Etikett wird nicht mehr gedruckt.')
    expect(printed).toEqual([])
  })

  it('answers with the sentence of the renderer when there is none, and names a refusal as one', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const label = await labelOf('assets', fresh.asset, tech)
    const path = `/assets/${fresh.asset}/labels/${label.id}/pdf`

    rendering = () => Promise.reject(new RendererUnavailableError('Kein Renderer eingerichtet.'))
    expect((await get(path, tech).expect(503)).body.message).toBe('Kein Renderer eingerichtet.')

    rendering = () => Promise.reject(new Error('Seite abgelehnt'))
    expect((await get(path, tech).expect(502)).body.message).toBe('Seite abgelehnt')
  })
})

describe('the label of a room', () => {
  it('is made and blocked by whoever takes rooms into the register, one valid label per room', async () => {
    const fresh = await placeIn()
    const tech = by('technician')

    await post(`/rooms/${fresh.room}/labels`, without('technician', 'room.record')).expect(403)

    const label = await labelOf('rooms', fresh.room, tech)

    expect(label).toMatchObject({ propertyId: fresh.property, assetId: null, roomId: fresh.room })
    expect((await post(`/rooms/${fresh.room}/labels`, tech).expect(409)).body.message).toBe(
      'Dieser Raum hat schon ein gültiges Etikett. Erst sperren, dann ein neues anlegen.',
    )

    await post(
      `/rooms/${fresh.room}/labels/${label.id}/block`,
      without('technician', 'room.record'),
    ).expect(403)
    await post(`/rooms/${fresh.room}/labels/${label.id}/block`, tech).expect(200)

    expect(await labelsIn(fresh.property)).toEqual([
      { code: label.code, asset_id: null, room_id: fresh.room, blocked: true },
    ])
    // The label of the asset in the room is another matter.
    await labelOf('assets', fresh.asset, tech)
    await labelOf('rooms', fresh.room, tech)
  })

  it('names the operator, the room, and its building and floor', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const label = await labelOf('rooms', fresh.room, tech)

    await get(`/rooms/${fresh.room}/labels/${label.id}/pdf`, tech).expect(200)

    expect(lastPage()).toContain('Wohnbau Nord eG')
    expect(lastPage()).toContain('0.01 Technik')
    expect(lastPage()).toContain('Haus A, Erdgeschoss')
    expect(lastPage()).toContain(printedLabelCode(label.code))
    expect(lastPage()).not.toContain('Aufzug')
  })
})

describe('what a code is for the person asking', () => {
  it('is open for a valid label in one of their areas', async () => {
    const label = await labelOf('assets', inNorth.asset, by('management', large))

    expect(await standingOf(label.code, by('technician', large))).toEqual({ standing: 'open' })
    expect(await standingOf(label.code, by('management', large))).toEqual({ standing: 'open' })

    await post(`/assets/${inNorth.asset}/labels/${label.id}/block`, by('management', large)).expect(
      200,
    )
  })

  /**
   * The second point of the acceptance of #98: the scan of a label from
   * another area names neither asset nor room. The whole answer is compared,
   * so that a field added later shows here.
   */
  it('is outside their areas for a valid label elsewhere, in one word and nothing beside it', async () => {
    const fresh = await placeIn(large, { areaId: south })
    const onAsset = await labelOf('assets', fresh.asset, by('site_management', large))
    const onRoom = await labelOf('rooms', fresh.room, by('site_management', large))

    for (const code of [onAsset.code, onRoom.code]) {
      const answer = await get(`/labels/${code}`, by('technician', large)).expect(200)

      expect(answer.body).toEqual({ standing: 'outside' })
      expect(answer.text).toBe('{"standing":"outside"}')
    }

    expect(await standingOf(onAsset.code, by('site_management', large))).toEqual({
      standing: 'open',
    })
  })

  /**
   * The first point of the acceptance of #98: a blocked label opens nothing,
   * not for the Leitung either. No right reads past a block.
   */
  it('is blocked for a blocked label, for the Leitung as for anybody, in whatever area', async () => {
    const fresh = await placeIn(large, { areaId: south })
    const lead = by('management', large)
    const label = await labelOf('assets', fresh.asset, lead)

    await post(`/assets/${fresh.asset}/labels/${label.id}/block`, lead).expect(200)

    for (const role of roleKeys) {
      expect(await standingOf(label.code, by(role, large)), role).toEqual({ standing: 'blocked' })
    }
  })

  it('is blocked for the label of an asset that was removed: it opens nothing any more', async () => {
    const fresh = await placeIn(large, { areaId: south })
    const asset = await assetIn(large, fresh.building, null, 'Notstromaggregat')
    const label = await labelOf('assets', asset, by('site_management', large))

    await http()
      .delete(`/assets/${asset}`)
      .set(testIdentityHeader, by('technical_management', large))
      .expect(200)

    expect(await standingOf(label.code, by('site_management', large))).toEqual({
      standing: 'blocked',
    })
    expect(await standingOf(label.code, by('technician', large))).toEqual({ standing: 'blocked' })
  })

  it('is unknown for a label of another operator, for a code nobody carries and for what is no code', async () => {
    const foreign = await labelOf('assets', place.asset, by('technician'))

    expect(await standingOf(foreign.code, by('management', large))).toEqual({
      standing: 'unknown',
    })
    expect(await standingOf('0000000000000000', by('management', large))).toEqual({
      standing: 'unknown',
    })
    expect(await standingOf('kein-code', by('management', large))).toEqual({ standing: 'unknown' })
    // For its own operator it is a label like any other.
    expect(await standingOf(foreign.code, by('technician'))).toEqual({ standing: 'open' })
  })

  it('is told to nobody who may not look at assets', async () => {
    const answer = await get(
      '/labels/0000000000000000',
      without('technician', 'asset.read'),
    ).expect(403)

    expect(answer.body.message).toBe(missingRight('asset.read'))
  })
})

describe('the labels a device holds', () => {
  async function pulled(header: string) {
    const answer = await get('/sync?since=0', header).expect(200)
    const changes = answer.body.changes as { entity: string; rows: Record<string, unknown>[] }[]

    return changes.find((change) => change.entity === 'labels')?.rows ?? []
  }

  it('are those of the areas of its person, with their code and what they hang on', async () => {
    const northern = await placeIn(large, { areaId: north })
    const southern = await placeIn(large, { areaId: south })
    const here = await labelOf('assets', northern.asset, by('management', large))
    const there = await labelOf('rooms', southern.room, by('management', large))
    const held = await pulled(by('technician', large))

    expect(held.find((row) => row['id'] === here.id)).toMatchObject({
      code: here.code,
      blockedAt: null,
      propertyId: northern.property,
      areaId: north,
      assetId: northern.asset,
      roomId: null,
    })
    expect(held.some((row) => row['id'] === there.id)).toBe(false)
    expect((await pulled(by('management', large))).some((row) => row['id'] === there.id)).toBe(true)
  })

  /**
   * The server draws the code, which is what keeps the address on a label
   * from being guessed: a label a device made up is no label.
   */
  it('are made by no device: a label from an outbox is refused, and so is a block', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const label = await labelOf('assets', fresh.asset, tech)
    const answer = await post('/sync', tech, {
      deviceId: 'phone',
      operations: [
        operation('labels', 'create', newId<'label'>(), {
          code: '3XQ7M2K9PDH4TA6W',
          roomId: fresh.room,
          propertyId: fresh.property,
        }),
        operation('labels', 'update', label.id, { blockedAt: '2026-10-06T08:00:00.000Z' }),
      ],
    }).expect(201)

    expect(
      (answer.body.receipts as { outcome: string; reason: string | null }[]).map(
        ({ outcome, reason }) => ({ outcome, reason }),
      ),
    ).toEqual([
      // Its code and its property are the server's to write (#99), and that
      // is answered before the question whether a device makes one at all.
      { outcome: 'conflict', reason: 'set_by_server' },
      { outcome: 'conflict', reason: 'online_only' },
    ])
    expect(await labelsIn(fresh.property)).toEqual([
      { code: label.code, asset_id: fresh.asset, room_id: null, blocked: false },
    ])
  })
})

describe('a print of the labels of every asset a register lists', () => {
  it('prints the label each asset has and makes one for each that has none, in the order of the register', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const second = await assetIn(small, fresh.building, null, 'Brandmeldezentrale')
    const third = await assetIn(small, fresh.building, fresh.room, 'Druckerhöhung')
    const had = await labelOf('assets', second, tech)
    const answer = await post('/labels/print/assets', tech, {
      filter: { buildingId: fresh.building },
      format: 'sheet',
      start: 3,
    })
      .buffer(true)
      .expect(200)

    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['cache-control']).toBe('no-store')

    const labels = await labelsIn(fresh.property)
    const codeOf = (asset: string) => labels.find((label) => label.asset_id === asset)?.code ?? ''

    expect(labels).toHaveLength(3)
    expect(codeOf(second)).toBe(had.code)

    const page = lastPage()
    const places = [fresh.asset, second, third].map((asset) =>
      page.indexOf(printedLabelCode(codeOf(asset))),
    )

    // Each once, and in the order of their numbers.
    expect(places.every((at) => at >= 0)).toBe(true)
    expect([...places].sort((a, b) => a - b)).toEqual(places)
    expect(page).toContain('Brandmeldezentrale')
    expect(page).toContain('Haus A, 0.01 Technik')

    // A second print makes nothing new.
    await post('/labels/print/assets', tech, { filter: { buildingId: fresh.building } }).expect(200)
    expect(await labelsIn(fresh.property)).toHaveLength(3)
  })

  it('prints the assets of the areas of whoever asks and makes a label for no other', async () => {
    const northern = await placeIn(large, { areaId: north })
    const southern = await placeIn(large, { areaId: south })

    await post('/labels/print/assets', by('technician', large), {
      filter: { propertyId: northern.property },
    }).expect(200)
    // Named outright, the property of the south lists nothing for the north.
    await post('/labels/print/assets', by('technician', large), {
      filter: { propertyId: southern.property },
    }).expect(422)

    expect(await labelsIn(northern.property)).toHaveLength(1)
    expect(await labelsIn(southern.property)).toEqual([])
  })

  it('makes labels, so it is for whoever takes assets into the register', async () => {
    const fresh = await placeIn()
    const answer = await post('/labels/print/assets', without('technician', 'asset.record'), {
      filter: { propertyId: fresh.property },
    }).expect(403)

    expect(answer.body.message).toBe(missingRight('asset.record'))
    expect(await labelsIn(fresh.property)).toEqual([])
  })

  it('refuses a list longer than ten sheets and one that is empty, and makes no label then', async () => {
    const fresh = await placeIn()
    const tech = by('technician')

    await admin.query(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
       select tenant_id, property_id, area_id, id, 'probe.elevator', 'Leuchte ' || n
         from buildings, generate_series(1, $2::int) n where id = $1`,
      [fresh.building, labelBatchMost],
    )

    const tooMany = await post('/labels/print/assets', tech, {
      filter: { propertyId: fresh.property },
    }).expect(422)

    expect(tooMany.body.message).toBe(
      'Die Liste nennt 241 Anlagen. Gedruckt werden höchstens 240 Etiketten auf einmal, die Liste lässt sich im Verzeichnis eingrenzen.',
    )

    const none = await post('/labels/print/assets', tech, {
      filter: { propertyId: fresh.property, kind: 'probe.boiler' },
    }).expect(422)

    expect(none.body.message).toBe('Die Liste ist leer, es gibt kein Etikett zu drucken.')
    expect(await labelsIn(fresh.property)).toEqual([])
    expect(printed).toEqual([])
  })

  it('checks the format before it makes a label', async () => {
    const fresh = await placeIn()
    const tech = by('technician')

    await post('/labels/print/assets', tech, {
      filter: { propertyId: fresh.property },
      format: 'folio',
    }).expect(400)
    await post('/labels/print/assets', tech, {
      filter: { propertyId: fresh.property },
      format: 'sheet',
      start: 25,
    }).expect(422)

    expect(await labelsIn(fresh.property)).toEqual([])
  })
})

describe('a print of the labels of the rooms of a building', () => {
  it('prints a label for every door, the one a room has or a new one, floor by floor', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const lead = by('technical_management')
    const upstairs = await made(lead, `/buildings/${fresh.building}/floors`, {
      name: 'Obergeschoss',
      level: 1,
    })
    const upper = await made(lead, `/floors/${upstairs}/rooms`, { number: '1.07', name: 'Lager' })
    const basement = await made(lead, `/buildings/${fresh.building}/floors`, {
      name: 'Untergeschoss',
      level: -1,
    })
    const lower = await made(lead, `/floors/${basement}/rooms`, { number: 'U.02' })
    const had = await labelOf('rooms', upper, tech)

    await post('/labels/print/rooms', without('technician', 'room.record'), {
      buildingId: fresh.building,
    }).expect(403)
    await post('/labels/print/rooms', tech, { buildingId: fresh.building }).expect(200)

    const labels = await labelsIn(fresh.property)
    const codeOf = (room: string) => labels.find((label) => label.room_id === room)?.code ?? ''
    const page = lastPage()
    const places = [lower, fresh.room, upper].map((room) =>
      page.indexOf(printedLabelCode(codeOf(room))),
    )

    expect(labels).toHaveLength(3)
    expect(labels.every((label) => label.asset_id === null)).toBe(true)
    expect(codeOf(upper)).toBe(had.code)
    expect(places.every((at) => at >= 0)).toBe(true)
    expect([...places].sort((a, b) => a - b)).toEqual(places)
    expect(page).toContain('Haus A, Untergeschoss')
    expect(page).toContain('1.07 Lager')
  })

  it('is not there for a building outside the areas of whoever asks', async () => {
    await post('/labels/print/rooms', by('technician', large), {
      buildingId: inSouth.building,
    }).expect(404)

    expect((await labelsIn(inSouth.property)).filter((label) => label.room_id !== null)).toEqual([])
  })
})

describe('a sheet of labels that hang on nothing yet', () => {
  it('makes as many labels as asked in the property named, each with a code of its own, for whoever takes assets into the register', async () => {
    const fresh = await placeIn()
    const tech = by('technician')

    await post('/labels/print/blank', without('technician', 'asset.record'), {
      propertyId: fresh.property,
      count: 5,
    }).expect(403)
    await post('/labels/print/blank', tech, {
      propertyId: fresh.property,
      count: 5,
      format: 'sheet',
    }).expect(200)

    const labels = await labelsIn(fresh.property)

    expect(labels).toHaveLength(5)
    expect(new Set(labels.map((label) => label.code)).size).toBe(5)
    expect(labels.every((label) => label.asset_id === null && label.room_id === null)).toBe(true)

    for (const label of labels) {
      expect(lastPage()).toContain(printedLabelCode(label.code))
    }

    expect(lastPage()).toContain('Schulzentrum Am Neckar')
    expect(lastPage()).not.toContain('Aufzug')
    // A label of a sheet is one of the operator: whoever sees its property finds it open.
    expect(await standingOf(labels[0]?.code ?? '', tech)).toEqual({ standing: 'open' })
  })

  it('makes none beyond ten sheets, none in a property outside the areas of whoever asks, and none for a format there is not', async () => {
    const fresh = await placeIn()
    const tech = by('technician')
    const tooMany = await post('/labels/print/blank', tech, {
      propertyId: fresh.property,
      count: labelBatchMost + 1,
    }).expect(422)

    expect(tooMany.body.message).toBe('Gedruckt werden 1 bis 240 Etiketten auf einmal.')

    await post('/labels/print/blank', tech, { propertyId: fresh.property, count: 0 }).expect(422)
    await post('/labels/print/blank', tech, {
      propertyId: fresh.property,
      count: 3,
      format: 'folio',
    }).expect(400)
    await post('/labels/print/blank', by('technician', large), {
      propertyId: inSouth.property,
      count: 3,
    }).expect(404)

    expect(await labelsIn(fresh.property)).toEqual([])
    expect((await labelsIn(inSouth.property)).filter((label) => label.asset_id === null)).toEqual(
      [],
    )
  })
})
