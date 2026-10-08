import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The routes of the technology (#20): an asset taken into the register in a
 * building, its components, its life cycle and what it supplies, by the roles
 * section 7 of the concept gives each right, and only in the areas of the
 * person asking.
 *
 * The catalogue is the probe package, with an elevator and a water meter,
 * and in front of it what this build ships: the package Allgemein with the
 * general asset kinds (#61).
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
/** A tenant nobody writes in but the test of the numbers, so that its numbers are the first. */
const counting = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

const property = {
  name: 'Schulzentrum Am Neckar',
  street: 'Neckarstraße 4',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  federalState: 'DE-BW',
}

const elevator = { kind: 'probe.elevator', name: 'Aufzug Haus A' }
const waterMeter = {
  kind: 'probe.water_meter',
  name: 'Hauswasserzähler',
  meterNumber: '9WAT1234567',
  meterUnit: 'cubic_metres',
}

/** A property with two buildings: Haus A with two floors and a room, Haus B with a room. */
interface Place {
  readonly property: string
  readonly building: string
  readonly floor: string
  readonly upstairs: string
  readonly room: string
  readonly annex: string
  readonly annexFloor: string
  readonly annexRoom: string
}

async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id

  const propertyId = await made('/properties', { ...property, ...extra })
  const building = await made(`/properties/${propertyId}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
  const upstairs = await made(`/buildings/${building}/floors`, {
    name: '1. Obergeschoss',
    level: 1,
  })
  const room = await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' })
  const annex = await made(`/properties/${propertyId}/buildings`, {
    name: 'Haus B',
    kinds: ['office'],
  })
  const annexFloor = await made(`/buildings/${annex}/floors`, { name: 'Erdgeschoss', level: 0 })
  const annexRoom = await made(`/floors/${annexFloor}/rooms`, { number: '0.01', name: 'Heizung' })

  return {
    property: propertyId,
    building,
    floor,
    upstairs,
    room,
    annex,
    annexFloor,
    annexRoom,
  }
}

/** An asset taken into the register through the route, by the technician unless said otherwise. */
async function assetIn(
  building: string,
  body: object = elevator,
  userId: keyof typeof people & string = 'u-tech',
  tenantId: TenantId = small,
): Promise<Record<string, unknown> & { readonly id: string }> {
  return (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by(userId, tenantId))
      .send(body)
      .expect(201)
  ).body
}

/** A component under an asset, by the technician. */
async function componentOf(
  asset: string,
  body: object = { ...elevator, name: 'Antrieb' },
): Promise<Record<string, unknown> & { readonly id: string }> {
  return (
    await http()
      .post(`/assets/${asset}/components`)
      .set(testIdentityHeader, by('u-tech'))
      .send(body)
      .expect(201)
  ).body
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
    counting,
    'Stadtwerke Probe',
  ])

  // The large tenant has its two areas before anybody works for it, so that
  // it does not begin with the one a tenant gets with its first membership.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large, counting]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  // In the large tenant the technician works in the north.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-tech',
    north,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        // The packages this build ships, the general one among them (#61),
        // and beside them the probe package as the specialist package.
        catalogue: catalogueOf({
          ...probeCatalogueBundle,
          packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
        }),
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an asset', () => {
  it('is taken into the register in a building, with what is known about it', async () => {
    const place = await placeIn()
    const created = await assetIn(place.building, {
      ...elevator,
      roomId: place.room,
      mark: ' AZ-01 ',
      manufacturer: 'Schindler',
      model: '3300',
      serialNumber: 'S-123456',
      yearBuilt: 2014,
      commissionedOn: '2014-09-01',
      warrantyEndsOn: '',
      values: { firefighters_lift: true, stops: 6 },
    })

    // Property and area from the building; trimmed, and an empty text is no text.
    expect(created).toMatchObject({
      propertyId: place.property,
      buildingId: place.building,
      roomId: place.room,
      parentAssetId: null,
      kind: 'probe.elevator',
      number: expect.stringMatching(/^AN-\d{5}$/),
      name: 'Aufzug Haus A',
      mark: 'AZ-01',
      manufacturer: 'Schindler',
      yearBuilt: 2014,
      commissionedOn: '2014-09-01',
      warrantyEndsOn: null,
      values: { firefighters_lift: true, stops: 6 },
      meterNumber: null,
      meterUnit: null,
      version: 1,
    })

    await http()
      .get(`/assets/${created.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)
      .expect((answer) =>
        expect(answer.body).toMatchObject({
          id: created.id,
          lifecycle: [],
          lifecycleState: null,
          supplies: [],
        }),
      )
    await http()
      .get(`/buildings/${place.building}/assets`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)
      .expect((answer) =>
        expect(answer.body.map((one: { id: string }) => one.id)).toEqual([created.id]),
      )
  })

  /**
   * Acceptance of #20: the number comes from the sequence of the tenant and is
   * never handed out again, also after its asset is deleted. A component
   * draws from the same sequence.
   */
  it('has a number from the sequence of its tenant, never handed out again', async () => {
    const place = await placeIn(counting)
    const first = await assetIn(place.building, elevator, 'u-tech', counting)

    await http()
      .delete(`/assets/${first.id}`)
      .set(testIdentityHeader, by('u-site', counting))
      .expect(200)

    const second = await assetIn(place.building, elevator, 'u-tech', counting)
    const component = await http()
      .post(`/assets/${second.id}/components`)
      .set(testIdentityHeader, by('u-tech', counting))
      .send({ ...elevator, name: 'Antrieb' })
      .expect(201)

    expect([first['number'], second['number'], component.body.number]).toEqual([
      'AN-00001',
      'AN-00002',
      'AN-00003',
    ])
  })

  /** Acceptance of #20: the kind of an asset is one a loaded package knows. */
  it('has a kind a loaded package knows, on its creation and on every change', async () => {
    const place = await placeIn()

    for (const kind of ['probe.escalator', 'elevator', 'zweites.elevator']) {
      await http()
        .post(`/buildings/${place.building}/assets`)
        .set(testIdentityHeader, by('u-tech'))
        .send({ ...elevator, kind })
        .expect(400)
        .expect((answer) =>
          expect(answer.body.message).toBe(`Die Anlagenart ${kind} kennt kein Paket des Katalogs.`),
        )
    }

    await http()
      .post(`/buildings/${place.building}/assets`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ name: 'Aufzug' })
      .expect(400)
      .expect((answer) => expect(answer.body.message).toBe('Die Anlagenart fehlt.'))

    const asset = await assetIn(place.building)

    await http()
      .patch(`/assets/${asset.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ kind: 'probe.escalator' })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Die Anlagenart probe.escalator kennt kein Paket des Katalogs.',
        ),
      )
  })

  /** Acceptance of #61: the general kind first, the kind of a specialist package later. */
  it('is taken in with the general kind of its cost group and corrected to the kind of a package later', async () => {
    const place = await placeIn()
    const general = 'allgemein.conveying_system'
    const asset = await assetIn(place.building, { name: 'Aufzug Altbau', kind: general })

    expect(asset).toMatchObject({ kind: general, name: 'Aufzug Altbau', values: {} })

    // A general kind asks nothing about an asset: it has no field a value could go to.
    await http()
      .patch(`/assets/${asset.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ values: { stops: 3 } })
      .expect(400)

    const corrected = await http()
      .patch(`/assets/${asset.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ kind: 'probe.elevator', values: { firefighters_lift: false, stops: 3 } })
      .expect(200)

    // The same asset under the same number, now of the kind its package describes.
    expect(corrected.body).toMatchObject({
      id: asset.id,
      number: asset['number'],
      kind: 'probe.elevator',
      name: 'Aufzug Altbau',
      values: { firefighters_lift: false, stops: 3 },
    })

    const read = await http()
      .get(`/assets/${asset.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)

    expect(read.body).toMatchObject({ id: asset.id, kind: 'probe.elevator' })
  })

  it('carries the values of its kind, each of the sort the kind says', async () => {
    const place = await placeIn()
    const refused = async (values: unknown): Promise<string> =>
      (
        await http()
          .post(`/buildings/${place.building}/assets`)
          .set(testIdentityHeader, by('u-tech'))
          .send({ ...elevator, values })
          .expect(400)
      ).body.message

    expect([
      await refused({ stops: 'sechs' }),
      await refused({ firefighters_lift: 'ja' }),
      await refused({ hot_water: true }),
      await refused(['stops']),
    ]).toEqual([
      'Haltestellen ist eine Zahl.',
      'Feuerwehraufzug ist ja oder nein.',
      'Das Feld hot_water hat die Anlagenart Aufzugsanlage nicht.',
      'Die Angaben zur Anlagenart stehen als Feld und Wert.',
    ])

    // A value may be left out: an asset taken stock of on site is seldom
    // complete on the first day. The values are replaced as a whole.
    const asset = await assetIn(place.building, { ...elevator, values: { stops: 4 } })

    await http()
      .patch(`/assets/${asset.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ values: { firefighters_lift: false } })
      .expect(200)
      .expect((answer) => expect(answer.body.values).toEqual({ firefighters_lift: false }))
  })

  it('is a meter when its kind is a measuring point, with its number and a unit of the kind', async () => {
    const place = await placeIn()
    const meter = await assetIn(place.annex, {
      ...waterMeter,
      values: { hot_water: false, calibration_year: 2024 },
    })
    const refused = async (body: object): Promise<string> =>
      (
        await http()
          .post(`/buildings/${place.annex}/assets`)
          .set(testIdentityHeader, by('u-tech'))
          .send(body)
          .expect(400)
      ).body.message

    expect(meter).toMatchObject({ meterNumber: '9WAT1234567', meterUnit: 'cubic_metres' })
    expect([
      await refused({ ...waterMeter, meterNumber: ' ' }),
      await refused({ ...waterMeter, meterUnit: 'kilowatt_hours' }),
      await refused({ ...waterMeter, meterUnit: 'litres' }),
      await refused({ ...elevator, meterNumber: '1ESY1160' }),
      await refused({ ...elevator, meterUnit: 'cubic_metres' }),
    ]).toEqual([
      'Die Zählernummer fehlt.',
      'Ein Zähler dieser Art zählt in m³.',
      'Die Einheit ist keine von kWh, MWh, m³.',
      'Eine Zählernummer hat nur eine Messstelle.',
      'Eine Einheit hat nur eine Messstelle.',
    ])

    // A kind captured wrong on site is corrected, and with it what hangs on
    // the kind: the values and the meter are asked of the asset as it will be.
    const change = (body: object) =>
      http().patch(`/assets/${meter.id}`).set(testIdentityHeader, by('u-tech')).send(body)

    await change({ kind: 'probe.elevator' })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Das Feld hot_water hat die Anlagenart Aufzugsanlage nicht.',
        ),
      )
    await change({ kind: 'probe.elevator', values: {} })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe('Eine Zählernummer hat nur eine Messstelle.'),
      )
    await change({ kind: 'probe.elevator', values: {}, meterNumber: '', meterUnit: '' })
      .expect(200)
      .expect((answer) =>
        expect(answer.body).toMatchObject({
          kind: 'probe.elevator',
          values: {},
          meterNumber: null,
          meterUnit: null,
        }),
      )
  })

  it('stands in a room of its building, or in none', async () => {
    const place = await placeIn()

    await http()
      .post(`/buildings/${place.building}/assets`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ ...elevator, roomId: place.annexRoom })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe('Der Raum liegt nicht in diesem Gebäude.'),
      )
    await http()
      .post(`/buildings/${place.building}/assets`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ ...elevator, roomId: 'Technik' })
      .expect(404)
      .expect((answer) =>
        expect(answer.body.message).toBe('Diesen Raum gibt es nicht oder nicht mehr.'),
      )

    expect(await assetIn(place.building, { ...elevator, roomId: '' })).toMatchObject({
      roomId: null,
    })
  })

  it('stays on its property', async () => {
    const place = await placeIn()
    const other = await placeIn()
    const asset = await assetIn(place.building)

    await http()
      .put(`/assets/${asset.id}/location`)
      .set(testIdentityHeader, by('u-site'))
      .send({ buildingId: other.building })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Eine Anlage bleibt auf ihrer Liegenschaft; an einem anderen Ort ist sie eine neue Anlage.',
        ),
      )
  })

  it('is deleted with its components, its life cycle and its supplies', async () => {
    const place = await placeIn()
    const asset = await assetIn(place.building)
    const component = await componentOf(asset.id)

    await http()
      .post(`/assets/${asset.id}/lifecycle`)
      .set(testIdentityHeader, by('u-site'))
      .send({ state: 'in_service', validFrom: '2014-09-01' })
      .expect(201)
    await http()
      .put(`/assets/${asset.id}/supplies`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ buildingIds: [place.annex] })
      .expect(200)
    await http().delete(`/assets/${asset.id}`).set(testIdentityHeader, by('u-site')).expect(200)

    for (const id of [asset.id, component.id]) {
      await http()
        .get(`/assets/${id}`)
        .set(testIdentityHeader, by('u-site'))
        .expect(404)
        .expect((answer) =>
          expect(answer.body.message).toBe('Diese Anlage gibt es nicht oder nicht mehr.'),
        )
    }

    const { rows } = await admin.query<{ standing: string }>(
      `select (select count(*) from asset_lifecycle where asset_id = $1 and deleted_at is null)
            + (select count(*) from asset_supplies where asset_id = $1 and deleted_at is null) as standing`,
      [asset.id],
    )

    expect(rows[0]?.standing).toBe('0')
  })

  it('is taken out of service and not deleted once it has an evidence, nor is its building', async () => {
    const place = await placeIn()
    const asset = await assetIn(place.building)
    const sentence =
      'Eine Anlage mit Nachweis wird zurückgebaut und nicht gelöscht; ihre Nachweise bleiben bei ihr.'

    // A duty at the asset and an evidence of it, put in past the application:
    // no route writes an evidence before phase 1.
    await admin.query(
      `with duty as (
         insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                             counting, interval_months, confirmed_by)
         select tenant_id, property_id, area_id, id, 'Sichtprüfung', 'manufacturer',
                'Betriebsanleitung', 'from_performance', 12, 'u-duties'
           from assets where id = $1
         returning id, tenant_id, property_id, area_id
       )
       insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       select tenant_id, property_id, area_id, id, '2026-09-30', 'without_defects',
              ${writtenPlaceholders(2)}
         from duty`,
      [asset.id, ...writtenValues('u-duties', '2026-09-30', 'without_defects')],
    )

    for (const [path, userId] of [
      [`/assets/${asset.id}`, 'u-site'],
      [`/buildings/${place.building}`, 'u-duties'],
    ] as const) {
      await http()
        .delete(path)
        .set(testIdentityHeader, by(userId))
        .expect(409)
        .expect((answer) => expect(answer.body.message).toBe(sentence))
    }

    await http().get(`/assets/${asset.id}`).set(testIdentityHeader, by('u-site')).expect(200)
  })
})

describe('a component', () => {
  it('hangs under its asset in its building, and moves with it out of its room', async () => {
    const place = await placeIn()
    const asset = await assetIn(place.building, { ...elevator, roomId: place.room })
    const drive = await componentOf(asset.id, { ...elevator, name: 'Antrieb', roomId: place.room })
    const motor = await componentOf(drive.id, { ...elevator, name: 'Motor' })
    const move = (id: string, body: object) =>
      http().put(`/assets/${id}/location`).set(testIdentityHeader, by('u-site')).send(body)

    expect(drive).toMatchObject({
      parentAssetId: asset.id,
      propertyId: place.property,
      buildingId: place.building,
      roomId: place.room,
    })
    expect(motor).toMatchObject({ parentAssetId: drive.id, buildingId: place.building })

    // On its own a component moves only to another room of its building.
    await move(drive.id, { buildingId: place.annex })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Eine Komponente steht im Gebäude ihrer Anlage und zieht mit ihr um.',
        ),
      )
    await move(drive.id, { buildingId: place.building, roomId: '' })
      .expect(200)
      .expect((answer) => expect(answer.body.roomId).toBeNull())
    await move(drive.id, { buildingId: place.building, roomId: place.room }).expect(200)

    // The asset moves to Haus B, and every component comes along, out of the
    // room it stood in in Haus A.
    await move(asset.id, { buildingId: place.annex, roomId: place.annexRoom })
      .expect(200)
      .expect((answer) =>
        expect(answer.body).toMatchObject({ buildingId: place.annex, roomId: place.annexRoom }),
      )

    for (const id of [drive.id, motor.id]) {
      await http()
        .get(`/assets/${id}`)
        .set(testIdentityHeader, by('u-site'))
        .expect(200)
        .expect((answer) =>
          expect(answer.body).toMatchObject({ buildingId: place.annex, roomId: null }),
        )
    }
  })

  /** Acceptance of #20, through the route: the database refuses the circle. */
  it('hangs under another asset of its building, never under itself', async () => {
    const place = await placeIn()
    const top = await assetIn(place.building)
    const middle = await componentOf(top.id)
    const bottom = await componentOf(middle.id)
    const elsewhere = await assetIn(place.annex)
    const hang = (id: string, parentAssetId: string | null) =>
      http()
        .put(`/assets/${id}/parent`)
        .set(testIdentityHeader, by('u-site'))
        .send({ parentAssetId })

    for (const parent of [bottom.id, top.id]) {
      await hang(top.id, parent)
        .expect(409)
        .expect((answer) =>
          expect(answer.body.message).toBe('Eine Komponente hängt nicht unter sich selbst.'),
        )
    }

    await hang(bottom.id, elsewhere.id)
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe('Eine Komponente steht im Gebäude ihrer Anlage.'),
      )
    await hang(bottom.id, top.id)
      .expect(200)
      .expect((answer) => expect(answer.body.parentAssetId).toBe(top.id))
    await hang(middle.id, null)
      .expect(200)
      .expect((answer) => expect(answer.body.parentAssetId).toBeNull())
  })
})

describe('the life cycle of an asset', () => {
  /**
   * Acceptance of #20: on a day exactly one state applies. The state is
   * derived from the entries on the day it is asked for, never stored.
   */
  it('names one state a day, and the state today follows from its entries', async () => {
    const place = await placeIn()
    const asset = await assetIn(place.building)
    const other = await assetIn(place.building)
    const enter = (id: string, state: string, validFrom: string) =>
      http()
        .post(`/assets/${id}/lifecycle`)
        .set(testIdentityHeader, by('u-site'))
        .send({ state, validFrom })
    const read = async () =>
      (await http().get(`/assets/${asset.id}`).set(testIdentityHeader, by('u-site')).expect(200))
        .body

    await enter(asset.id, 'planned', '2013-11-01').expect(201)

    const service = (await enter(asset.id, 'in_service', '2014-09-01').expect(201)).body

    await enter(asset.id, 'decommissioned', '2099-01-01').expect(201)
    await enter(asset.id, 'out_of_service', '2014-09-01')
      .expect(409)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'An diesem Tag hat die Anlage schon einen Zustand; auf einen Tag kommt einer.',
        ),
      )
    await enter(asset.id, 'broken', '2015-01-01')
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Der Zustand ist einer von Geplant, In Betrieb, Außer Betrieb, Stillgelegt, Zurückgebaut.',
        ),
      )
    await enter(asset.id, 'in_service', '1.9.2014')
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Der Tag, ab dem der Zustand gilt, fehlt oder ist keiner.',
        ),
      )

    expect(await read()).toMatchObject({
      lifecycleState: 'in_service',
      lifecycle: [
        { state: 'planned', validFrom: '2013-11-01' },
        { state: 'in_service', validFrom: '2014-09-01' },
        { state: 'decommissioned', validFrom: '2099-01-01' },
      ],
    })

    // An entry belongs to its asset; removed, it makes room on its day.
    await http()
      .delete(`/assets/${other.id}/lifecycle/${String(service.id)}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Diesen Eintrag im Lebenszyklus gibt es nicht oder nicht mehr.',
        ),
      )
    await http()
      .delete(`/assets/${asset.id}/lifecycle/${String(service.id)}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(200)

    expect((await read()).lifecycleState).toBe('planned')

    await enter(asset.id, 'out_of_service', '2014-09-01').expect(201)

    expect((await read()).lifecycleState).toBe('out_of_service')

    const { rows } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'assets' and column_name like '%state%'`,
    )

    expect(rows).toEqual([])
  })
})

describe('what an asset supplies', () => {
  it('is a list of buildings and rooms of its property, replaced as a whole', async () => {
    const place = await placeIn()
    const other = await placeIn()
    const asset = await assetIn(place.annex)
    const supply = (body: object) =>
      http().put(`/assets/${asset.id}/supplies`).set(testIdentityHeader, by('u-tech')).send(body)
    const places = (answer: { body: readonly { buildingId: string; roomId: string }[] }) =>
      answer.body.map((one) => one.buildingId ?? one.roomId).sort()

    await supply({ buildingIds: [place.building], roomIds: [place.room, place.room] })
      .expect(200)
      .expect((answer) => expect(places(answer)).toEqual([place.building, place.room].sort()))
    await supply({ roomIds: [place.room] })
      .expect(200)
      .expect((answer) => expect(places(answer)).toEqual([place.room]))
    // What was taken out of the list comes back as a new entry.
    await supply({ buildingIds: [place.building], roomIds: [place.room] })
      .expect(200)
      .expect((answer) => expect(places(answer)).toEqual([place.building, place.room].sort()))
    for (const elsewhere of [{ buildingIds: [other.building] }, { roomIds: [other.room] }]) {
      await supply(elsewhere)
        .expect(400)
        .expect((answer) =>
          expect(answer.body.message).toBe('Eine Anlage versorgt nur Orte ihrer Liegenschaft.'),
        )
    }
    await supply({ roomIds: ['Heizung'] })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe('Versorgte Orte stehen als Liste von Kennungen.'),
      )
    await supply({})
      .expect(200)
      .expect((answer) => expect(answer.body).toEqual([]))
  })
})

describe('a room with assets', () => {
  const moving = (room: string, floorId: string) =>
    http().put(`/rooms/${room}/floor`).set(testIdentityHeader, by('u-duties')).send({ floorId })

  it('moves to another building only while no asset stands in it, a deleted one included', async () => {
    const place = await placeIn()
    const asset = await assetIn(place.building, { ...elevator, roomId: place.room })
    const refusal =
      'In diesem Raum stehen Anlagen, gelöschte mitgezählt; er zieht deshalb nur innerhalb seines Gebäudes um.'

    await moving(place.room, place.annexFloor)
      .expect(400)
      .expect((answer) => expect(answer.body.message).toBe(refusal))
    // Within its building it moves, and the asset stays in it.
    await moving(place.room, place.upstairs).expect(200)
    await http().delete(`/assets/${asset.id}`).set(testIdentityHeader, by('u-site')).expect(200)
    await moving(place.room, place.annexFloor)
      .expect(400)
      .expect((answer) => expect(answer.body.message).toBe(refusal))
  })

  it('moves to another property only while no asset supplies it', async () => {
    const place = await placeIn()
    const other = await placeIn()
    const asset = await assetIn(place.annex)

    await http()
      .put(`/assets/${asset.id}/supplies`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ roomIds: [place.room] })
      .expect(200)
    // To another building of its property it moves: the supply names the room
    // on the property of its asset, and that stays so.
    await moving(place.room, place.annexFloor).expect(200)
    await moving(place.room, other.floor)
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Diesen Raum versorgen Anlagen, gelöschte Einträge mitgezählt; er zieht deshalb nur innerhalb seiner Liegenschaft um.',
        ),
      )
  })
})

describe('a possible duplicate', () => {
  /**
   * Section 4.2 of the concept: an asset with the same serial number or the
   * same mark is named, and the new one is made all the same.
   */
  const heater = { ...elevator, name: 'Aufzug Mensa', serialNumber: 'DUP-750-22', mark: 'DUP-A1' }
  const ask = (query: object, header: string = by('u-tech')) =>
    http().get('/assets/duplicates').query(query).set(testIdentityHeader, header)

  it('is an asset with the same serial number or the same mark, however it was typed', async () => {
    const place = await placeIn()
    const elsewhere = await placeIn(small, { name: 'Sporthalle Süd' })
    const there = await assetIn(place.building, heater)
    // An asset that carries a mark and no serial number.
    const marked = await assetIn(elsewhere.building, {
      ...elevator,
      name: 'Aufzug Halle',
      mark: 'dup-a1',
    })

    await ask({ serialNumber: 'dup -750- 22' })
      .expect(200)
      .expect((answer) => {
        expect(answer.body).toEqual([
          {
            id: there.id,
            number: there['number'],
            name: 'Aufzug Mensa',
            kind: 'probe.elevator',
            propertyId: place.property,
            buildingId: place.building,
            roomId: null,
            serialNumber: 'DUP-750-22',
            mark: 'DUP-A1',
            same: ['serialNumber'],
          },
        ])
      })
    // Both fields: the asset that shares both stands first, the one on the
    // other property is found by its mark.
    await ask({ serialNumber: 'DUP-750-22', mark: 'DUP-A1' })
      .expect(200)
      .expect((answer) => {
        expect(
          answer.body.map((found: { id: string; same: string[] }) => [found.id, found.same]),
        ).toEqual([
          [there.id, ['serialNumber', 'mark']],
          [marked.id, ['mark']],
        ])
      })
    // A serial number is not held against a mark.
    await ask({ serialNumber: 'DUP-A1' })
      .expect(200)
      .expect((answer) => expect(answer.body).toEqual([]))
  })

  it('is never the asset that is being changed, nor one that was removed', async () => {
    const place = await placeIn()
    const serialNumber = 'DUP-SELF-1'
    const asset = await assetIn(place.building, { ...elevator, serialNumber })
    const twin = await assetIn(place.building, { ...elevator, name: 'Zwilling', serialNumber })
    const found = async (query: object): Promise<string[]> =>
      (await ask(query).expect(200)).body.map((each: { id: string }) => each.id)

    expect(await found({ serialNumber })).toEqual([asset.id, twin.id])
    expect(await found({ serialNumber, except: asset.id })).toEqual([twin.id])

    await http().delete(`/assets/${twin.id}`).set(testIdentityHeader, by('u-site')).expect(200)

    expect(await found({ serialNumber, except: asset.id })).toEqual([])
  })

  it('does not keep the new asset from being made', async () => {
    const place = await placeIn()
    const serialNumber = 'DUP-TWICE-1'

    await assetIn(place.building, { ...elevator, serialNumber })

    const second = await assetIn(place.building, { ...elevator, name: 'Zweiter', serialNumber })

    expect(second['serialNumber']).toBe(serialNumber)
  })

  it('is asked about with a serial number or a mark, and with nothing else', async () => {
    const refused = async (query: object): Promise<string> =>
      (await ask(query).expect(400)).body.message

    expect(await refused({})).toBe(
      'Nach einer Dublette wird mit einer Seriennummer oder einem Kennzeichen gefragt.',
    )
    expect(await refused({ serialNumber: '   ' })).toBe(
      'Nach einer Dublette wird mit einer Seriennummer oder einem Kennzeichen gefragt.',
    )
    expect(await refused({ serialNumber: 'x'.repeat(81) })).toBe(
      'Gefragt wird mit einer Seriennummer und einem Kennzeichen, wie eine Anlage sie trägt.',
    )
    expect(await refused({ mark: ['a', 'b'] })).toBe(
      'Gefragt wird mit einer Seriennummer und einem Kennzeichen, wie eine Anlage sie trägt.',
    )
    expect(await refused({ mark: 'A1', except: 'keine-kennung' })).toBe(
      'Die Anlage, die ausgenommen wird, steht als Kennung.',
    )
  })

  it('names nobody an asset of another tenant or of an area they do not work in', async () => {
    const serialNumber = 'DUP-AREA-1'
    const inNorth = await placeIn(large, { areaId: north, name: 'Dublette Nord' })
    const inSouth = await placeIn(large, { areaId: south, name: 'Dublette Süd' })
    const northern = await assetIn(inNorth.building, { ...elevator, serialNumber }, 'u-tech', large)
    const southern = await assetIn(
      inSouth.building,
      { ...elevator, serialNumber },
      'u-duties',
      large,
    )
    const found = async (header: string): Promise<string[]> =>
      (await ask({ serialNumber }, header).expect(200)).body.map((each: { id: string }) => each.id)

    expect(await found(by('u-duties', large))).toEqual([northern.id, southern.id])
    expect(await found(by('u-tech', large))).toEqual([northern.id])
    expect(await found(by('u-duties', small))).toEqual([])
  })
})

describe('the rights to the technology', () => {
  /**
   * Section 7 of the concept: whoever works on site takes assets into the
   * register and completes what is known about them ("aufnehmen"); their
   * life cycle, moving them and removing them is "pflegen", from the
   * Objektleitung up.
   */
  it('let each role do what section 7 gives it, and no more', async () => {
    const place = await placeIn()
    const asset = await assetIn(place.building)
    const tech = by('u-tech')
    const site = by('u-site')
    const outcome = {
      technicianChanges: (
        await http()
          .patch(`/assets/${asset.id}`)
          .set(testIdentityHeader, tech)
          .send({ manufacturer: 'Kone' })
      ).status,
      technicianAddsComponent: (
        await http()
          .post(`/assets/${asset.id}/components`)
          .set(testIdentityHeader, tech)
          .send({ ...elevator, name: 'Antrieb' })
      ).status,
      technicianSetsSupplies: (
        await http()
          .put(`/assets/${asset.id}/supplies`)
          .set(testIdentityHeader, tech)
          .send({ roomIds: [place.room] })
      ).status,
      technicianMoves: (
        await http()
          .put(`/assets/${asset.id}/location`)
          .set(testIdentityHeader, tech)
          .send({ buildingId: place.annex })
      ).status,
      technicianHangs: (
        await http()
          .put(`/assets/${asset.id}/parent`)
          .set(testIdentityHeader, tech)
          .send({ parentAssetId: null })
      ).status,
      technicianEntersState: (
        await http()
          .post(`/assets/${asset.id}/lifecycle`)
          .set(testIdentityHeader, tech)
          .send({ state: 'in_service', validFrom: '2020-01-01' })
      ).status,
      technicianRemoves: (await http().delete(`/assets/${asset.id}`).set(testIdentityHeader, tech))
        .status,
      siteManagementEntersState: (
        await http()
          .post(`/assets/${asset.id}/lifecycle`)
          .set(testIdentityHeader, site)
          .send({ state: 'in_service', validFrom: '2020-01-01' })
      ).status,
      siteManagementMoves: (
        await http()
          .put(`/assets/${asset.id}/location`)
          .set(testIdentityHeader, site)
          .send({ buildingId: place.annex })
      ).status,
    }

    expect(outcome).toEqual({
      technicianChanges: 200,
      technicianAddsComponent: 201,
      technicianSetsSupplies: 200,
      technicianMoves: 403,
      technicianHangs: 403,
      technicianEntersState: 403,
      technicianRemoves: 403,
      siteManagementEntersState: 201,
      siteManagementMoves: 200,
    })

    await http()
      .delete(`/assets/${asset.id}`)
      .set(testIdentityHeader, tech)
      .expect(403)
      .expect((answer) => expect(answer.body.message).toBe(missingRight('asset.write')))

    // An entry of the life cycle is taken back by whoever may enter one.
    const [entry] = (
      await http().get(`/assets/${asset.id}`).set(testIdentityHeader, site).expect(200)
    ).body.lifecycle

    await http()
      .delete(`/assets/${asset.id}/lifecycle/${String(entry.id)}`)
      .set(testIdentityHeader, tech)
      .expect(403)
    await http()
      .delete(`/assets/${asset.id}/lifecycle/${String(entry.id)}`)
      .set(testIdentityHeader, site)
      .expect(200)
  })
})

describe('the technology of a tenant with two areas', () => {
  /**
   * The routes ask for nothing by area; the database answers with the areas
   * of the person. An asset is in the area of its property.
   */
  it('shows each person the assets of their areas', async () => {
    const inNorth = await placeIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await placeIn(large, { areaId: south, name: 'Campus Süd' })
    const northern = await assetIn(inNorth.building, elevator, 'u-tech', large)
    const southern = await assetIn(inSouth.building, elevator, 'u-duties', large)
    const tech = by('u-tech', large)

    expect([northern['areaId'], southern['areaId']]).toEqual([north, south])

    await http().get(`/assets/${northern.id}`).set(testIdentityHeader, tech).expect(200)
    await http()
      .get(`/assets/${southern.id}`)
      .set(testIdentityHeader, tech)
      .expect(404)
      .expect((answer) =>
        expect(answer.body.message).toBe('Diese Anlage gibt es nicht oder nicht mehr.'),
      )
    await http()
      .post(`/buildings/${inSouth.building}/assets`)
      .set(testIdentityHeader, tech)
      .send(elevator)
      .expect(404)
      .expect((answer) =>
        expect(answer.body.message).toBe('Dieses Gebäude gibt es nicht oder nicht mehr.'),
      )
  })

  it('moves an asset to another area with its property, its life cycle and its supplies', async () => {
    const place = await placeIn(large, { areaId: north, name: 'Campus West' })
    const asset = await assetIn(place.building, elevator, 'u-tech', large)
    const lead = by('u-lead', large)

    await http()
      .post(`/assets/${asset.id}/lifecycle`)
      .set(testIdentityHeader, lead)
      .send({ state: 'in_service', validFrom: '2014-09-01' })
      .expect(201)
    await http()
      .put(`/assets/${asset.id}/supplies`)
      .set(testIdentityHeader, lead)
      .send({ roomIds: [place.annexRoom] })
      .expect(200)
    await http()
      .patch(`/properties/${place.property}`)
      .set(testIdentityHeader, lead)
      .send({ areaId: south })
      .expect(200)

    await http()
      .get(`/assets/${asset.id}`)
      .set(testIdentityHeader, lead)
      .expect(200)
      .expect((answer) => {
        expect(answer.body.areaId).toBe(south)
        expect(answer.body.lifecycle.map((entry: { areaId: string }) => entry.areaId)).toEqual([
          south,
        ])
        expect(answer.body.supplies.map((supply: { areaId: string }) => supply.areaId)).toEqual([
          south,
        ])
      })
    // The technician of the north does not find it any more.
    await http().get(`/assets/${asset.id}`).set(testIdentityHeader, by('u-tech', large)).expect(404)
  })
})
