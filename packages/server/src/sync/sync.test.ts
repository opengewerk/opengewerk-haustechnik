import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type IsoDate,
  missingRight,
  type RoleKey,
  signedPageOf,
  syncEntities,
  type SyncValue,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, fingerprintOf, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { pageFingerprint } from '../activities/signing.js'
import { ApiModule } from '../api/api.module.js'
import { as, testIdentities } from '../api/test-identity.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
  testIdentityHeader,
} from '../database/test-database.js'
import { deviceScope } from './device-scope.js'

/**
 * What a device sends without a connection and what the server makes of it
 * (#27, ADR 0006): the records a device takes stock of, the work on an
 * activity up to its signature, a defect, and what the server derives, draws,
 * writes down and refuses. Over
 * the routes of the sync, as a device sends, by the roles section 7 of the
 * concept gives each right.
 *
 * The catalogue is the probe package, with an elevator and a water meter.
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; the technician works in the north. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

type Person = keyof typeof people & string

/** The names of their accounts, which an evidence freezes. */
const names: Readonly<Record<Person, string>> = {
  'u-lead': 'Hanna Leitung',
  'u-duties': 'Theo Technik',
  'u-site': 'Sina Objekt',
  'u-tech': 'Tom Haustechnik',
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: Person, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

let recorded = Date.parse('2026-10-04T08:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  entity: string,
  kind: 'create' | 'update' | 'delete',
  recordId: string,
  values: Readonly<Record<string, SyncValue>> = {},
  seen: Readonly<Record<string, SyncValue>> = {},
) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind,
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({
      field,
      from: seen[field] ?? null,
      to,
    })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

type Sent = ReturnType<typeof operation>

function send(userId: Person, operations: readonly Sent[], tenantId = small, deviceId = 'phone') {
  return http()
    .post('/sync')
    .set(testIdentityHeader, by(userId, tenantId))
    .send({ deviceId, operations })
}

/** What became of each operation, as the device reads it. */
async function outcomes(
  userId: Person,
  operations: readonly Sent[],
  tenantId = small,
  deviceId = 'phone',
) {
  const answer = await send(userId, operations, tenantId, deviceId).expect(201)

  return (
    answer.body.receipts as { outcome: string; reason: string | null; fields: string[] }[]
  ).map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))
}

const applied = { outcome: 'applied', reason: null, fields: [] }

/** The rows of each kind of record a device of the person is sent. */
async function pulled(
  userId: Person,
  tenantId = small,
): Promise<Readonly<Record<string, readonly Record<string, unknown>[]>>> {
  const answer = await http()
    .get('/sync?since=0')
    .set(testIdentityHeader, by(userId, tenantId))
    .expect(200)

  return Object.fromEntries(
    (answer.body.changes as { entity: string; rows: Record<string, unknown>[] }[]).map((change) => [
      change.entity,
      change.rows,
    ]),
  )
}

async function rowOf(userId: Person, entity: string, id: string, tenantId = small) {
  return (await pulled(userId, tenantId))[entity]?.find((row) => row['id'] === id)
}

/** A property with two buildings: Haus A with a floor and a room, Haus B with a floor and a room. */
interface Place {
  readonly property: string
  readonly building: string
  readonly floor: string
  readonly room: string
  readonly annex: string
  readonly annexFloor: string
  readonly annexRoom: string
}

async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id

  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...extra,
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
  const room = await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' })
  const annex = await made(`/properties/${property}/buildings`, {
    name: 'Haus B',
    kinds: ['office'],
  })
  const annexFloor = await made(`/buildings/${annex}/floors`, { name: 'Erdgeschoss', level: 0 })
  const annexRoom = await made(`/floors/${annexFloor}/rooms`, { number: '0.01', name: 'Heizung' })

  return { property, building, floor, room, annex, annexFloor, annexRoom }
}

/** An elevator in Haus A, taken stock of on a device. */
async function elevatorIn(place: Place, roomId: string | null = null): Promise<string> {
  const asset = newId<'asset'>()

  expect(
    await outcomes('u-tech', [
      operation('assets', 'create', asset, {
        buildingId: place.building,
        roomId,
        kind: 'probe.elevator',
        name: 'Aufzug Haus A',
      }),
    ]),
  ).toEqual([applied])

  return asset
}

let place: Place

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

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

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      names[userId as Person],
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

  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-tech',
    north,
  ])
  // And the Objektleitung in the south.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-site',
    south,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue: catalogueOf(probeCatalogueBundle) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  place = await placeIn()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('taking stock without a connection', () => {
  it('makes a room on its floor and an asset with a component in it, and the asset comes back with its number', async () => {
    const room = newId<'room'>()
    const asset = newId<'asset'>()
    const component = newId<'asset'>()

    expect(
      await outcomes('u-tech', [
        operation('rooms', 'create', room, {
          floorId: place.floor,
          number: '0.12',
          name: '  Heizraum ',
          use: '',
        }),
        operation('assets', 'create', asset, {
          buildingId: place.building,
          roomId: room,
          kind: 'probe.elevator',
          name: 'Aufzug Haus A',
          values: '{ "stops": 4, "firefighters_lift": true }',
        }),
        operation('assets', 'create', component, {
          buildingId: place.building,
          parentAssetId: asset,
          kind: 'probe.elevator',
          name: 'Antrieb',
        }),
      ]),
    ).toEqual([applied, applied, applied])

    const rows = await pulled('u-tech')
    const made = rows['rooms']?.find((row) => row['id'] === room)
    const [taken, part] = [asset, component].map((id) =>
      rows['assets']?.find((row) => row['id'] === id),
    )

    // Building, property and area come from the floor; a text is taken the
    // way a route takes it.
    expect(made).toMatchObject({
      buildingId: place.building,
      propertyId: place.property,
      name: 'Heizraum',
      use: null,
    })
    expect(made?.['areaId']).toEqual(expect.any(String))
    expect(taken?.['number']).toMatch(/^AN-\d{5}$/)
    expect(part?.['number']).toMatch(/^AN-\d{5}$/)
    expect(part?.['number']).not.toBe(taken?.['number'])
    // A value of JSON travels as its text.
    expect(taken).toMatchObject({
      propertyId: place.property,
      values: '{"firefighters_lift":true,"stops":4}',
    })
    expect(part).toMatchObject({ parentAssetId: asset, values: '{}' })
  })

  it('answers a field the server keeps with set_by_server, and lands the rest of the transmission', async () => {
    expect(
      await outcomes('u-tech', [
        operation('assets', 'create', newId<'asset'>(), {
          buildingId: place.building,
          kind: 'probe.elevator',
          name: 'Aufzug Haus B',
          number: 'AN-99999',
        }),
        operation('rooms', 'create', newId<'room'>(), {
          floorId: place.floor,
          buildingId: place.annex,
          number: '0.13',
        }),
        operation('rooms', 'create', newId<'room'>(), { floorId: place.floor, number: '0.14' }),
      ]),
    ).toEqual([
      { outcome: 'conflict', reason: 'set_by_server', fields: ['number'] },
      { outcome: 'conflict', reason: 'set_by_server', fields: ['buildingId'] },
      applied,
    ])
  })

  it('refuses what the rules of domain refuse, with the sentence of the form, and names the operation', async () => {
    const refusal = async (sent: Sent) => {
      const answer = await send('u-tech', [sent]).expect(400)

      expect(answer.body.operationId).toBe(sent.id)

      return answer.body.message as string
    }

    expect(
      await refusal(
        operation('assets', 'create', newId<'asset'>(), {
          buildingId: place.building,
          kind: 'probe.nothing',
          name: 'Unbekannt',
        }),
      ),
    ).toBe('Die Anlagenart probe.nothing kennt kein Paket des Katalogs.')
    expect(
      await refusal(
        operation('assets', 'create', newId<'asset'>(), {
          buildingId: place.building,
          kind: 'probe.elevator',
          name: 'Aufzug',
          values: '{"colour":"rot"}',
        }),
      ),
    ).toBe('Das Feld colour hat die Anlagenart Aufzugsanlage nicht.')
    expect(
      await refusal(
        operation('assets', 'create', newId<'asset'>(), {
          buildingId: place.building,
          kind: 'probe.water_meter',
          name: 'Hauswasserzähler',
          meterUnit: 'cubic_metres',
        }),
      ),
    ).toBe('Die Zählernummer fehlt.')
    expect(
      await refusal(
        operation('rooms', 'create', newId<'room'>(), { floorId: place.floor, use: 'Lager' }),
      ),
    ).toBe('Ein Raum hat eine Nummer oder eine Bezeichnung.')
  })

  it('keeps the second of two devices that changed the same field of an asset for a person, and takes different fields from both', async () => {
    const asset = await elevatorIn(place)

    expect(
      await outcomes(
        'u-tech',
        [operation('assets', 'update', asset, { name: 'Aufzug Nord' }, { name: 'Aufzug Haus A' })],
        small,
        'phone-a',
      ),
    ).toEqual([applied])
    // The second device saw the name the first one changed.
    expect(
      await outcomes(
        'u-site',
        [operation('assets', 'update', asset, { name: 'Lastenaufzug' }, { name: 'Aufzug Haus A' })],
        small,
        'phone-b',
      ),
    ).toEqual([{ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['name'] }])
    expect(
      await outcomes(
        'u-site',
        [operation('assets', 'update', asset, { manufacturer: 'Schindler' })],
        small,
        'phone-b',
      ),
    ).toEqual([applied])

    expect(await rowOf('u-tech', 'assets', asset)).toMatchObject({
      name: 'Aufzug Nord',
      manufacturer: 'Schindler',
    })
  })

  it('answers values that no longer fit a kind changed meanwhile as a conflict about that operation', async () => {
    const asset = await elevatorIn(place)

    // The office corrects the kind; a device still holds the elevator.
    await http()
      .patch(`/assets/${asset}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({
        kind: 'probe.water_meter',
        meterNumber: '9WAT1',
        meterUnit: 'cubic_metres',
      })
      .expect(200)

    expect(
      await outcomes('u-tech', [
        operation('assets', 'update', asset, { values: '{"stops":6}' }, { values: '{}' }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['kind', 'values'] }])
  })

  it('answers a place that is gone or does not fit with record_missing, for that operation alone', async () => {
    const asset = await elevatorIn(place)
    const gone = (
      await http()
        .post(`/buildings/${place.annex}/floors`)
        .set(testIdentityHeader, by('u-duties'))
        .send({ name: 'Keller', level: -1 })
        .expect(201)
    ).body.id as string

    await http().delete(`/floors/${gone}`).set(testIdentityHeader, by('u-duties')).expect(200)

    expect(
      await outcomes('u-tech', [
        operation('rooms', 'create', newId<'room'>(), { floorId: newId<'floor'>(), number: '9' }),
        operation('rooms', 'create', newId<'room'>(), { floorId: gone, number: '-1.01' }),
        operation('assets', 'create', newId<'asset'>(), {
          buildingId: place.building,
          roomId: place.annexRoom,
          kind: 'probe.elevator',
          name: 'Aufzug',
        }),
        operation('assets', 'create', newId<'asset'>(), {
          buildingId: place.annex,
          parentAssetId: asset,
          kind: 'probe.elevator',
          name: 'Antrieb',
        }),
        operation('rooms', 'create', newId<'room'>(), { floorId: place.floor, number: '0.15' }),
      ]),
    ).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['floorId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['floorId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['roomId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['parentAssetId'] },
      applied,
    ])
  })

  it('keeps what may not be written without a connection to the office, as online_only', async () => {
    const asset = await elevatorIn(place)

    expect(
      await outcomes('u-duties', [
        operation(
          'rooms',
          'update',
          place.room,
          { floorId: place.annexFloor },
          { floorId: place.floor },
        ),
        operation('rooms', 'delete', place.room),
        operation('buildings', 'update', place.annex, { name: 'Haus C' }, { name: 'Haus B' }),
        operation('assets', 'update', asset, { roomId: place.room }),
      ]),
    ).toEqual([
      { outcome: 'conflict', reason: 'online_only', fields: ['floorId'] },
      { outcome: 'conflict', reason: 'online_only', fields: [] },
      { outcome: 'conflict', reason: 'online_only', fields: [] },
      { outcome: 'conflict', reason: 'online_only', fields: ['roomId'] },
    ])
  })

  it('asks for the right of the office once an operation leaves the work on site', async () => {
    const moving = operation(
      'rooms',
      'update',
      place.room,
      { floorId: place.annexFloor },
      { floorId: place.floor },
    )
    const answer = await send('u-tech', [moving]).expect(400)

    expect(answer.body).toMatchObject({
      message: missingRight('location.write'),
      operationId: moving.id,
    })
  })
})

describe('what an asset supplies', () => {
  it('adds a place of its property and takes it away, and a second device entering the same place gets a conflict', async () => {
    const asset = await elevatorIn(place)
    const supply = newId<'asset-supply'>()
    const other = await placeIn()

    expect(
      await outcomes('u-tech', [
        operation('asset_supplies', 'create', supply, { assetId: asset, roomId: place.annexRoom }),
        operation('asset_supplies', 'create', newId<'asset-supply'>(), {
          assetId: asset,
          buildingId: other.building,
        }),
      ]),
    ).toEqual([applied, { outcome: 'conflict', reason: 'record_missing', fields: ['buildingId'] }])
    expect(
      await outcomes(
        'u-tech',
        [
          operation('asset_supplies', 'create', newId<'asset-supply'>(), {
            assetId: asset,
            roomId: place.annexRoom,
          }),
        ],
        small,
        'tablet',
      ),
    ).toEqual([{ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['roomId'] }])

    const both = operation('asset_supplies', 'create', newId<'asset-supply'>(), {
      assetId: asset,
      buildingId: place.annex,
      roomId: place.annexRoom,
    })

    expect((await send('u-tech', [both]).expect(400)).body.message).toBe(
      'Ein Eintrag versorgt genau ein Gebäude oder einen Raum.',
    )

    expect(await outcomes('u-tech', [operation('asset_supplies', 'delete', supply)])).toEqual([
      applied,
    ])
    expect((await rowOf('u-tech', 'asset_supplies', supply))?.['deletedAt']).toEqual(
      expect.any(String),
    )
  })
})

describe('the work on an activity', () => {
  /** A round with two duties at an asset, put in past the application, as the office plans one. */
  async function roundWithDuties(): Promise<{ activity: string; lines: string[] }> {
    const asset = await elevatorIn(place)
    const { rows: area } = await admin.query<{ area_id: string }>(
      'select area_id from properties where id = $1',
      [place.property],
    )
    const areaId = area[0]?.area_id
    const { rows: made } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status)
       values ($1, $2, $3, $4, 'round', 'Rundgang Technikzentrale', 'open') returning id`,
      [small, place.property, areaId, asset],
    )
    const activity = made[0]?.id ?? ''
    const lines: string[] = []

    for (const label of ['Sichtkontrolle', 'Notruf prüfen']) {
      const { rows: duty } = await admin.query<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                             counting, interval_months, confirmed_by)
         values ($1, $2, $3, $4, $5, 'own_decision', 'Hausordnung', 'from_performance', 1, 'u-lead')
         returning id`,
        [small, place.property, areaId, asset, label],
      )
      const { rows: line } = await admin.query<{ id: string }>(
        `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [small, place.property, areaId, activity, duty[0]?.id],
      )

      lines.push(line[0]?.id ?? '')
    }

    return { activity, lines }
  }

  it('makes a work order for a fault on site, with its number and the kind of its activity, and one per activity', async () => {
    const activity = newId<'activity'>()
    const order = newId<'work-order'>()

    expect(
      await outcomes('u-site', [
        operation('activities', 'create', activity, {
          kind: 'work_order',
          title: 'Heizung kalt',
          status: 'open',
          propertyId: place.property,
          roomId: place.annexRoom,
        }),
        operation('work_orders', 'create', order, { activityId: activity, kind: 'fault' }),
      ]),
    ).toEqual([applied, applied])

    expect(await rowOf('u-site', 'work_orders', order)).toMatchObject({
      number: expect.stringMatching(/^AU-\d{4}-\d{4}$/),
      activityKind: 'work_order',
      propertyId: place.property,
    })
    expect(
      await outcomes('u-site', [
        operation('work_orders', 'create', newId<'work-order'>(), {
          activityId: activity,
          kind: 'fault',
        }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['activityId'] }])

    // An activity is made with its name, as the form asks before it saves.
    const untitled = operation('activities', 'create', newId<'activity'>(), {
      kind: 'work_order',
      status: 'open',
      propertyId: place.property,
    })

    expect((await send('u-site', [untitled]).expect(400)).body.message).toBe(
      'Die Bezeichnung fehlt.',
    )

    // Handing out a work order is the Objektleitung's, not the work on site.
    const handedOut = operation('activities', 'create', newId<'activity'>(), {
      kind: 'work_order',
      title: 'Licht defekt',
      status: 'open',
      propertyId: place.property,
    })

    expect((await send('u-tech', [handedOut]).expect(400)).body.message).toBe(
      missingRight('activity.write'),
    )
  })

  it('takes the progress of an activity from whoever does the work, and nothing once it is signed', async () => {
    const { activity } = await roundWithDuties()

    expect(
      await outcomes('u-tech', [
        operation(
          'activities',
          'update',
          activity,
          { status: 'started', performedOn: '2026-10-04' },
          { status: 'open' },
        ),
      ]),
    ).toEqual([applied])

    await admin.query(`update activities set status = 'signed' where id = $1`, [activity])

    expect(
      await outcomes('u-tech', [
        operation(
          'activities',
          'update',
          activity,
          { performedOn: '2026-10-05' },
          { performedOn: '2026-10-04' },
        ),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] }])
  })

  it('lets two devices answer different duties of one activity, and keeps two answers to the same for a person', async () => {
    const { lines } = await roundWithDuties()
    const [first, second] = lines as [string, string]

    expect(
      await outcomes(
        'u-tech',
        [operation('activity_duties', 'update', first, { result: 'without_defects' })],
        small,
        'phone-a',
      ),
    ).toEqual([applied])
    expect(
      await outcomes(
        'u-site',
        [operation('activity_duties', 'update', second, { result: 'with_defects' })],
        small,
        'phone-b',
      ),
    ).toEqual([applied])
    expect(
      await outcomes(
        'u-site',
        [operation('activity_duties', 'update', first, { result: 'failed' })],
        small,
        'phone-b',
      ),
    ).toEqual([{ outcome: 'conflict', reason: 'changed_elsewhere', fields: ['result'] }])

    // Not performed names its reason, as the form asks before it saves.
    const withoutReason = operation(
      'activity_duties',
      'update',
      second,
      {
        result: 'not_performed',
        resultReason: ' ',
      },
      { result: 'with_defects' },
    )

    expect((await send('u-tech', [withoutReason]).expect(400)).body.message).toBe(
      'Was nicht durchgeführt wurde, nennt den Grund.',
    )
  })
})

describe('a signature from a device', () => {
  const drawing = 'M10,10L200,300M400,20L410,30'

  /** What a signature is given for: an activity at an elevator, with its duties and their lines. */
  interface ToSign {
    readonly activity: string
    readonly kind: 'inspection' | 'round'
    readonly title: string
    readonly asset: string
    readonly duties: readonly {
      readonly duty: string
      readonly line: string
      readonly label: string | null
    }[]
    readonly dutyKind: string | null
  }

  /**
   * An activity at a new elevator, put in past the application as the office
   * plans one: open and given to nobody. An inspection with one duty of its
   * own by default; on request a round with several, a countersignature, or a
   * duty of the catalogue instead.
   */
  async function activityToSign({
    kind = 'inspection',
    duties = 1,
    countersigned = false,
    dutyKind = null,
  }: {
    kind?: 'inspection' | 'round'
    duties?: number
    countersigned?: boolean
    dutyKind?: string | null
  } = {}): Promise<ToSign> {
    const asset = await elevatorIn(place)
    const title = kind === 'round' ? 'Rundgang Aufzug' : 'Sichtprüfung Aufzug'
    const { rows: area } = await admin.query<{ area_id: string }>(
      'select area_id from properties where id = $1',
      [place.property],
    )
    const areaId = area[0]?.area_id
    const { rows: made } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                               countersignature_required)
       values ($1, $2, $3, $4, $5, $6, 'open', $7) returning id`,
      [small, place.property, areaId, asset, kind, title, countersigned],
    )
    const activity = made[0]?.id ?? ''
    const lines: { duty: string; line: string; label: string | null }[] = []

    for (const label of ['Sichtprüfung', 'Notruf prüfen', 'Schacht prüfen'].slice(0, duties)) {
      const { rows: duty } = await admin.query<{ id: string }>(
        dutyKind === null
          ? `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis,
                                 source_note, counting, interval_months, confirmed_by)
             values ($1, $2, $3, $4, $5, 'own_decision', 'Hausordnung', 'from_performance', 1,
                     'u-lead')
             returning id`
          : `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                                 counting, interval_months, confirmed_by)
             values ($1, $2, $3, $4, $5, 1, 'from_performance', 12, 'u-lead') returning id`,
        [small, place.property, areaId, asset, dutyKind ?? label],
      )
      const { rows: line } = await admin.query<{ id: string }>(
        `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [small, place.property, areaId, activity, duty[0]?.id],
      )

      lines.push({
        duty: duty[0]?.id ?? '',
        line: line[0]?.id ?? '',
        label: dutyKind === null ? label : null,
      })
    }

    return { activity, kind, title, asset, duties: lines, dutyKind }
  }

  /**
   * The work on site, as a device queues it, one entry after the other:
   * started and performed on the first, then each duty without defects.
   */
  function workDone(toSign: ToSign): Sent[] {
    return [
      operation(
        'activities',
        'update',
        toSign.activity,
        { status: 'started', performedOn: '2026-10-01' },
        { status: 'open' },
      ),
      ...toSign.duties.map(({ line }) =>
        operation('activity_duties', 'update', line, { result: 'without_defects' }),
      ),
    ]
  }

  /**
   * The fingerprint of the page a device shows, from what it holds: by default
   * once the work is done, otherwise with another title or before any work on
   * it.
   */
  function pageOnTheDevice(
    toSign: ToSign,
    { title = toSign.title, worked = true }: { title?: string; worked?: boolean } = {},
  ): string {
    return pageFingerprint(
      signedPageOf({
        activity: {
          id: toSign.activity,
          kind: toSign.kind,
          title,
          performedOn: worked ? ('2026-10-01' as IsoDate) : null,
        },
        place: {
          property: {
            name: 'Schulzentrum Am Neckar',
            address: 'Neckarstraße 4, 68535 Edingen-Neckarhausen',
          },
          building: { name: 'Haus A', shortCode: null },
          room: null,
          asset: {
            id: toSign.asset,
            name: 'Aufzug Haus A',
            kind: 'probe.elevator',
            serialNumber: null,
          },
        },
        duties: toSign.duties.map(({ duty, label }) => ({
          dutyId: duty,
          kind: toSign.dutyKind,
          label,
          result: worked ? 'without_defects' : null,
          resultReason: null,
        })),
        defects: [],
      }),
    )
  }

  /** A signature for the page with a fingerprint, given on the device on the first at half past nine. */
  function signature(
    activity: string,
    fingerprint: string,
    role: 'signer' | 'countersigner' = 'signer',
  ): Sent {
    return operation('activity_signatures', 'create', newId<'activity-signature'>(), {
      activityId: activity,
      role,
      signedAt: '2026-10-01T09:30:00.000Z',
      deviceInfo: 'Probe-Telefon',
      path: drawing,
      pageFingerprint: fingerprint,
    })
  }

  async function statusOf(activity: string): Promise<string | undefined> {
    const { rows } = await admin.query<{ status: string }>(
      'select status from activities where id = $1',
      [activity],
    )

    return rows[0]?.status
  }

  /** Who signed an activity, and as what, in the order the server took the signatures. */
  async function signaturesOf(activity: string): Promise<string[][]> {
    const { rows } = await admin.query<{ signed_by: string; role: string }>(
      `select signed_by, role from activity_signatures where activity_id = $1
        order by created_at, id`,
      [activity],
    )

    return rows.map((row) => [row.signed_by, row.role])
  }

  /** The evidence written for an activity: its origin and what its state says about the people. */
  async function evidenceOf(activity: string) {
    const { rows } = await admin.query<{
      origin: string
      state: {
        signatures: { name: string; role: string; signedAt: string }[]
        performer: unknown
        writtenBy: string
      }
    }>('select origin, state from evidence where activity_id = $1 order by number', [activity])

    return rows
  }

  it('takes a round given without a connection from its first answer to the signature, and writes it down in the name of whoever signed', async () => {
    const toSign = await activityToSign({ kind: 'round', duties: 2 })
    // One outbox: the progress, the result of each duty and the signature, in
    // the order they were given; the page is the one after the work.
    const work = workDone(toSign)
    const signed = signature(toSign.activity, pageOnTheDevice(toSign))

    expect(await outcomes('u-tech', [...work, signed])).toEqual([
      applied,
      applied,
      applied,
      applied,
    ])

    expect(await statusOf(toSign.activity)).toBe('done')
    expect(await rowOf('u-tech', 'activity_signatures', signed.recordId)).toMatchObject({
      activityId: toSign.activity,
      role: 'signer',
      signedBy: 'u-tech',
      propertyId: place.property,
    })

    const written = await evidenceOf(toSign.activity)

    // One evidence per duty, as points of a round.
    expect(written.map((evidence) => evidence.origin)).toEqual(['round_point', 'round_point'])
    // The names of the accounts, read before the transaction.
    expect(written[0]?.state.signatures).toEqual([
      { name: 'Tom Haustechnik', role: 'signer', signedAt: '2026-10-01T09:30:00.000Z' },
    ])
    expect(written[0]?.state.performer).toEqual({ person: 'Tom Haustechnik' })
    expect(written[0]?.state.writtenBy).toBe('Tom Haustechnik')
  })

  it('answers a signature for a page the server no longer has with a conflict about it, and keeps nothing of it', async () => {
    const toSign = await activityToSign()

    expect(await outcomes('u-tech', workDone(toSign))).toEqual([applied, applied])

    const shown = pageOnTheDevice(toSign)

    // The office renames the activity while the technician signs on site.
    await admin.query(`update activities set title = 'Sichtprüfung Lastenaufzug' where id = $1`, [
      toSign.activity,
    ])

    expect(await outcomes('u-tech', [signature(toSign.activity, shown)])).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['pageFingerprint'] },
    ])
    expect(await signaturesOf(toSign.activity)).toEqual([])
    expect(await statusOf(toSign.activity)).toBe('started')
    expect(await evidenceOf(toSign.activity)).toEqual([])

    // Shown again and signed again, it is taken; the old one was never moved onto it.
    expect(
      await outcomes('u-tech', [
        signature(toSign.activity, pageOnTheDevice(toSign, { title: 'Sichtprüfung Lastenaufzug' })),
      ]),
    ).toEqual([applied])
    expect(await statusOf(toSign.activity)).toBe('done')
  })

  it('answers a signature for a day the office took back as a conflict about the page, not as a mistake of the form', async () => {
    const toSign = await activityToSign()

    expect(await outcomes('u-tech', workDone(toSign))).toEqual([applied, applied])

    const shown = pageOnTheDevice(toSign)

    await admin.query('update activities set performed_on = null where id = $1', [toSign.activity])

    expect(await outcomes('u-tech', [signature(toSign.activity, shown)])).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['pageFingerprint'] },
    ])
  })

  it('answers a signature for an activity the office removed with record_missing', async () => {
    const toSign = await activityToSign()

    expect(await outcomes('u-tech', workDone(toSign))).toEqual([applied, applied])

    const shown = pageOnTheDevice(toSign)

    await admin.query('update activities set deleted_at = now() where id = $1', [toSign.activity])

    expect(await outcomes('u-tech', [signature(toSign.activity, shown)])).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['activityId'] },
    ])
  })

  it('takes the countersignature after the signature from whoever countersigns, and answers one out of its turn as a conflict', async () => {
    const toSign = await activityToSign({ countersigned: true })
    const page = pageOnTheDevice(toSign)

    expect(
      await outcomes('u-tech', [...workDone(toSign), signature(toSign.activity, page)]),
    ).toEqual([applied, applied, applied])
    expect(await statusOf(toSign.activity)).toBe('signed')
    expect(await evidenceOf(toSign.activity)).toEqual([])

    // A second device signed the same activity before it heard of the first.
    expect(await outcomes('u-site', [signature(toSign.activity, page)], small, 'phone-b')).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['role'] },
    ])

    // The countersignature is the Objektleitung's, not the work on site.
    const byTheTechnician = signature(toSign.activity, page, 'countersigner')

    expect((await send('u-tech', [byTheTechnician]).expect(400)).body).toMatchObject({
      message: missingRight('activity.accept'),
      operationId: byTheTechnician.id,
    })

    expect(
      await outcomes(
        'u-site',
        [signature(toSign.activity, page, 'countersigner')],
        small,
        'phone-b',
      ),
    ).toEqual([applied])
    expect(await statusOf(toSign.activity)).toBe('done')
    expect(await signaturesOf(toSign.activity)).toEqual([
      ['u-tech', 'signer'],
      ['u-site', 'countersigner'],
    ])
    expect(
      (await evidenceOf(toSign.activity))[0]?.state.signatures.map((signed) => [
        signed.name,
        signed.role,
      ]),
    ).toEqual([
      ['Tom Haustechnik', 'signer'],
      ['Sina Objekt', 'countersigner'],
    ])

    // Done, it takes no signature at all.
    expect(
      await outcomes(
        'u-site',
        [signature(toSign.activity, page, 'countersigner')],
        small,
        'phone-b',
      ),
    ).toEqual([{ outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] }])
  })

  it('refuses a signature on a page without its day or a result with the sentence of the form, naming the operation', async () => {
    const toSign = await activityToSign()
    // The page as it is before any work on it, signed anyway.
    const signed = signature(toSign.activity, pageOnTheDevice(toSign, { worked: false }))

    expect((await send('u-tech', [signed]).expect(400)).body).toMatchObject({
      message: 'Der Tag der Durchführung fehlt.',
      operationId: signed.id,
    })
    expect(await signaturesOf(toSign.activity)).toEqual([])
  })

  it('refuses the transmission with the sentence of the evidence when its kind of duty takes no protocol, naming the signature', async () => {
    // The main test of the probe package takes reports only.
    const toSign = await activityToSign({ dutyKind: 'probe.elevator_main_test' })
    const work = workDone(toSign)
    const signed = signature(toSign.activity, pageOnTheDevice(toSign))

    expect((await send('u-tech', [...work, signed]).expect(400)).body).toMatchObject({
      message:
        'Diese Pflichtart nimmt als Nachweis: Bericht einer Fremdfirma oder Prüforganisation.',
      operationId: signed.id,
    })
    // One transaction: the work before it is not there either.
    expect(await statusOf(toSign.activity)).toBe('open')
    expect(await signaturesOf(toSign.activity)).toEqual([])
  })
})

describe('a defect', () => {
  it('is reported at its place and completed on site, and its status stays with the office', async () => {
    const asset = await elevatorIn(place)
    const other = await placeIn()
    const defect = newId<'defect'>()

    expect(
      await outcomes('u-tech', [
        operation('defects', 'create', defect, {
          description: 'Tür schließt nicht',
          foundOn: '2026-10-04',
          propertyId: place.property,
          assetId: asset,
        }),
        operation('defects', 'create', newId<'defect'>(), {
          description: 'Tür klemmt',
          foundOn: '2026-10-04',
          propertyId: other.property,
          assetId: asset,
        }),
        operation(
          'defects',
          'update',
          defect,
          { description: 'Tür schließt nicht, Notruf ohne Ton' },
          { description: 'Tür schließt nicht' },
        ),
      ]),
    ).toEqual([
      applied,
      { outcome: 'conflict', reason: 'record_missing', fields: ['assetId'] },
      applied,
    ])

    const twoPlaces = operation('defects', 'create', newId<'defect'>(), {
      description: 'Riss',
      foundOn: '2026-10-04',
      propertyId: place.property,
      roomId: place.room,
      assetId: asset,
    })

    expect((await send('u-tech', [twoPlaces]).expect(400)).body.message).toBe(
      'Ein Mangel hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum oder einem Gebäude.',
    )
    expect(
      await outcomes('u-site', [
        operation('defects', 'update', defect, { status: 'remedied' }, { status: 'found' }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'online_only', fields: ['status'] }])
  })
})

describe('what a device holds', () => {
  let inNorth: Place
  let inSouth: Place

  beforeAll(async () => {
    inNorth = await placeIn(large, { areaId: north })
    inSouth = await placeIn(large, { areaId: south })
  })

  /** What the answer of a pull names as narrowed, for a person. */
  async function narrowedFor(userId: Person, tenantId = large) {
    const answer = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, by(userId, tenantId))
      .expect(200)

    return answer.body.narrowed as Readonly<Record<string, string>>
  }

  /** The area of the property of the small tenant, for rows put in past the application. */
  async function areaOfPlace(): Promise<string> {
    const { rows } = await admin.query<{ area_id: string }>(
      'select area_id from properties where id = $1',
      [place.property],
    )

    return rows[0]?.area_id ?? ''
  }

  /** An activity at an elevator of the small tenant, as the office plans one. */
  async function activityOf(
    status: string,
    responsible: string | null,
    performer: string | null,
    kind = 'inspection',
  ): Promise<string> {
    const asset = await elevatorIn(place)
    const { rows } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                               responsible_user_id, performer_user_id, closing_reason)
       values ($1, $2, $3, $4, $5, 'Sichtprüfung', $6, $7, $8, $9) returning id`,
      [
        small,
        place.property,
        await areaOfPlace(),
        asset,
        kind,
        status,
        responsible,
        performer,
        status === 'not_performed' ? 'Anlage abgeschaltet' : null,
      ],
    )

    return rows[0]?.id ?? ''
  }

  it('hands a device what its person sees, by area, and nothing of the area next door', async () => {
    const theirs = await pulled('u-tech', large)
    const everything = await pulled('u-duties', large)

    expect(theirs['properties']?.map((row) => row['id'])).toEqual([inNorth.property])
    expect(theirs['rooms']?.map((row) => row['propertyId'])).toEqual([
      inNorth.property,
      inNorth.property,
    ])
    expect(everything['properties']?.map((row) => row['id'])).toEqual(
      expect.arrayContaining([inNorth.property, inSouth.property]),
    )
    // A list travels as its text.
    expect(theirs['buildings']?.map((row) => row['kinds'])).toEqual(['["school"]', '["office"]'])

    // And nothing goes into the south from there.
    expect(
      await outcomes(
        'u-tech',
        [operation('rooms', 'create', newId<'room'>(), { floorId: inSouth.floor, number: '1' })],
        large,
      ),
    ).toEqual([{ outcome: 'conflict', reason: 'record_missing', fields: ['floorId'] }])
  })

  it('hands whoever sees every area the whole operator, and says so for every kind of record', async () => {
    const narrowed = await narrowedFor('u-duties')

    expect(Object.keys(narrowed).sort()).toEqual([...syncEntities].sort())
    expect(new Set(Object.values(narrowed))).toEqual(new Set(['all']))
  })

  it('names the places of whoever sees some areas by the properties they see, and others for another person on the same device', async () => {
    const theTechnician = await narrowedFor('u-tech')
    const theSiteManagement = await narrowedFor('u-site')

    expect(Object.keys(theTechnician).sort()).toEqual([...syncEntities].sort())
    expect(theTechnician['properties']).toBe(`properties:${fingerprintOf([inNorth.property])}`)
    expect(theTechnician['rooms']).toBe(theTechnician['properties'])
    expect(theTechnician['duties']).toBe(theTechnician['properties'])
    expect(theSiteManagement['properties']).toBe(`properties:${fingerprintOf([inSouth.property])}`)

    // The same device in the hands of the Objektleitung of the south holds
    // nothing of the north once it has asked from the start, which the other
    // value tells it to do.
    const theirs = await pulled('u-site', large)

    expect(theirs['properties']?.map((row) => row['id'])).toEqual([inSouth.property])
    expect(theirs['rooms']?.every((row) => row['propertyId'] === inSouth.property)).toBe(true)
  })

  it('names the places by another value once the areas of the person change', async () => {
    const before = await narrowedFor('u-tech')

    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [large, 'u-tech', south],
    )

    try {
      const after = await narrowedFor('u-tech')

      expect(after['properties']).toBe(
        `properties:${fingerprintOf([inNorth.property, inSouth.property])}`,
      )
      expect(after['properties']).not.toBe(before['properties'])
    } finally {
      await admin.query(
        'delete from member_areas where tenant_id = $1 and user_id = $2 and area_id = $3',
        [large, 'u-tech', south],
      )
    }
  })

  it('holds the activities of the person while open, given to them or to nobody, and closed ones for thirty days', async () => {
    const mine = await activityOf('open', 'u-tech', null)
    const theirs = await activityOf('started', 'u-site', 'u-site')
    const nobodys = await activityOf('open', null, null)
    const closed = await activityOf('done', null, 'u-tech')
    const scopeAt = (now: Date) =>
      database.forTenant({ tenantId: small, userId: 'u-tech' }, (tx) =>
        deviceScope(tx, 'u-tech', now),
      )

    const today = await scopeAt(new Date())
    const later = await scopeAt(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000))

    expect(today.everyArea).toBe(false)
    expect(today.activityIds).toEqual(expect.arrayContaining([mine, nobodys, closed]))
    expect(today.activityIds).not.toContain(theirs)
    expect(later.activityIds).toEqual(expect.arrayContaining([mine, nobodys]))
    expect(later.activityIds).not.toContain(closed)

    // Over the routes, and named by a fingerprint over what it holds.
    const rows = await pulled('u-tech')
    const narrowed = await narrowedFor('u-tech', small)

    expect(rows['activities']?.map((row) => row['id'])).toEqual(
      expect.arrayContaining([mine, nobodys, closed]),
    )
    expect(rows['activities']?.map((row) => row['id'])).not.toContain(theirs)
    expect(narrowed['activities']).toBe(`activities:${fingerprintOf(today.activityIds)}`)
    expect(narrowed['activity_duties']).toBe(narrowed['activities'])

    // The Objektleitung, who sees the area as well, holds their own, and one
    // that was begun stays as long as it is open.
    const theirScope = await database.forTenant({ tenantId: small, userId: 'u-site' }, (tx) =>
      deviceScope(tx, 'u-site', new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)),
    )

    expect(theirScope.activityIds).toEqual(expect.arrayContaining([theirs, nobodys]))
    expect(theirScope.activityIds).not.toContain(mine)
  })

  it('holds the duties and the work order of the activities it holds, and of no other', async () => {
    const theirs = await activityOf('open', 'u-site', null, 'work_order')
    const areaId = await areaOfPlace()
    const { rows: duty } = await admin.query<{ id: string }>(
      `insert into duties (tenant_id, property_id, area_id, label, basis, source_note, counting,
                           interval_months, confirmed_by)
       values ($1, $2, $3, 'Kontrollgang', 'own_decision', 'Hausordnung', 'from_performance', 1,
               'u-lead') returning id`,
      [small, place.property, areaId],
    )
    const { rows: line } = await admin.query<{ id: string }>(
      `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [small, place.property, areaId, theirs, duty[0]?.id],
    )
    const { rows: order } = await admin.query<{ id: string }>(
      `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
       values ($1, $2, $3, $4, 'AU-2026-9999', 'fault') returning id`,
      [small, place.property, areaId, theirs],
    )

    const mine = await pulled('u-tech')
    const ours = await pulled('u-site')
    const ids = (
      rows: Readonly<Record<string, readonly Record<string, unknown>[]>>,
      entity: string,
    ) => (rows[entity] ?? []).map((row) => row['id'])

    expect(ids(mine, 'activity_duties')).not.toContain(line[0]?.id)
    expect(ids(mine, 'work_orders')).not.toContain(order[0]?.id)
    expect(ids(ours, 'activity_duties')).toContain(line[0]?.id)
    expect(ids(ours, 'work_orders')).toContain(order[0]?.id)
  })

  it('holds every defect found in an activity it holds, also one set right, for the page it signs', async () => {
    const mine = await activityOf('started', null, null)
    const theirs = await activityOf('started', 'u-site', 'u-site')
    const inMine = newId<'defect'>()
    const inTheirs = newId<'defect'>()

    expect(
      await outcomes('u-tech', [
        operation('defects', 'create', inMine, {
          description: 'Kabinenlicht defekt',
          foundOn: '2026-10-04',
          propertyId: place.property,
          foundInActivityId: mine,
        }),
        operation('defects', 'create', inTheirs, {
          description: 'Notruf ohne Ton',
          foundOn: '2026-10-04',
          propertyId: place.property,
          foundInActivityId: theirs,
        }),
      ]),
    ).toEqual([applied, applied])

    await admin.query(`update defects set status = 'remedied' where id = any($1)`, [
      [inMine, inTheirs],
    ])

    const held = (await pulled('u-tech'))['defects']?.map((row) => row['id'])

    expect(held).toContain(inMine)
    expect(held).not.toContain(inTheirs)
  })

  it('holds the open defects of its areas, and lets one that was set right go', async () => {
    const open = newId<'defect'>()
    const remedied = newId<'defect'>()

    expect(
      await outcomes('u-tech', [
        operation('defects', 'create', open, {
          description: 'Notbeleuchtung flackert',
          foundOn: '2026-10-04',
          propertyId: place.property,
        }),
        operation('defects', 'create', remedied, {
          description: 'Tür quietscht',
          foundOn: '2026-10-04',
          propertyId: place.property,
        }),
      ]),
    ).toEqual([applied, applied])

    const before = await narrowedFor('u-tech', small)

    await admin.query(`update defects set status = 'remedied' where id = $1`, [remedied])

    const rows = await pulled('u-tech')
    const after = await narrowedFor('u-tech', small)

    expect(rows['defects']?.map((row) => row['id'])).toContain(open)
    expect(rows['defects']?.map((row) => row['id'])).not.toContain(remedied)
    expect(after['defects']).not.toBe(before['defects'])
    expect(after['defects']).toBe(
      `defects:${fingerprintOf(
        (
          await database.forTenant({ tenantId: small, userId: 'u-tech' }, (tx) =>
            deviceScope(tx, 'u-tech'),
          )
        ).defectIds,
      )}`,
    )
  })
})
