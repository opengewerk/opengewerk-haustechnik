import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  addMonths,
  catalogueOf,
  type IsoDate,
  type MeterDetails,
  type MeterList,
  missingRight,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The meters in the office (#119, section 4.9 of the concept): the list for
 * a key date, the page of a measuring point with its readings and its
 * consumption, a reading by hand and its correction, the replacement of a
 * meter, the periods it rests, its lock, its note and its main meter.
 *
 * Every role reads meters; the replacement, the pauses, the lock, the note
 * and the rest are for whoever takes care of assets. A reading is never
 * changed, and consumption is worked out from the readings that count.
 */

const small = newId<'tenant'>() as TenantId
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
/** The key date of this month, and the ones before it. */
const current = `${today.slice(0, 7)}-01` as IsoDate
const monthsBack = (months: number): IsoDate => addMonths(current, -months)

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** A property with a building, made by the Technische Leitung; the ids. */
async function buildingIn(
  tenantId: TenantId = small,
  area: string | null = null,
): Promise<{ readonly property: string; readonly building: string }> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: 'Schulzentrum Am Lindenhain',
    street: 'Lindenstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...(area === null ? {} : { areaId: area }),
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Schulhaus',
    kinds: ['school'],
  })

  return { property, building }
}

/** A water meter in a building, taken in by the Technische Leitung; its id. */
async function meterIn(
  building: string,
  mark: string,
  tenantId: TenantId = small,
  meterNumber = `13-${mark}`,
): Promise<string> {
  return (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({
        kind: 'probe.water_meter',
        name: `Wasserzähler ${mark}`,
        mark,
        meterNumber,
        meterUnit: 'cubic_metres',
      })
      .expect(201)
  ).body.id
}

/** A reading by hand, as somebody sends it. */
function readingOf(meter: string, body: object, header: string = by('u-tech')) {
  return http().post(`/meters/${meter}/readings`).set(testIdentityHeader, header).send(body)
}

/** A reading that is taken, read on a day. */
async function read(meter: string, readOn: IsoDate, valueMilli: number): Promise<MeterDetails> {
  return (await readingOf(meter, { readOn, valueMilli }).expect(201)).body as MeterDetails
}

async function pageOf(meter: string, header: string = by('u-lead')): Promise<MeterDetails> {
  return (await http().get(`/meters/${meter}`).set(testIdentityHeader, header).expect(200))
    .body as MeterDetails
}

async function listed(address = '', header: string = by('u-lead')): Promise<MeterList> {
  return (await http().get(`/meters${address}`).set(testIdentityHeader, header).expect(200))
    .body as MeterList
}

function send(
  method: 'post' | 'put' | 'delete',
  path: string,
  body: object = {},
  header: string = by('u-site'),
) {
  return http()[method](path).set(testIdentityHeader, header).send(body)
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
  ])

  for (const tenantId of [small, large]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
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
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the list "Zähler"', () => {
  it('names every measuring point with its last reading and how it stands for a key date, and counts what is missing, resting and locked', async () => {
    const { building } = await buildingIn()
    const present = await meterIn(building, 'WZ-01')
    const lacking = await meterIn(building, 'WZ-02')
    const resting = await meterIn(building, 'WZ-03')
    const locked = await meterIn(building, 'WZ-04')

    // An elevator is no measuring point.
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ kind: 'probe.elevator', name: 'Aufzug' })
      .expect(201)
    await read(present, current, 1_000_000)
    await read(lacking, monthsBack(1), 2_000_000)
    await send('post', `/meters/${resting}/pauses`, {
      startsOn: monthsBack(1),
      reason: 'Hauptleitung abgesperrt',
    }).expect(201)
    await send('put', `/meters/${locked}/lock`, { lockReason: 'Schacht überflutet' }).expect(200)

    const mine = new Set([present, lacking, resting, locked])
    const list = await listed()
    const shown = list.meters.filter((meter) => mine.has(meter.assetId))

    expect(list.keyDate).toBe(current)
    expect(shown.map((meter) => [meter.mark, meter.state])).toEqual([
      ['WZ-01', 'present'],
      ['WZ-02', 'missing'],
      ['WZ-03', 'paused'],
      ['WZ-04', 'locked'],
    ])
    expect(shown[1]).toMatchObject({
      medium: 'water',
      unit: 'cubic_metres',
      meterNumber: '13-WZ-02',
      lastReading: { keyDate: monthsBack(1), valueMilli: 2_000_000 },
    })
    expect(list.counts).toEqual({ missing: 1, paused: 1, locked: 1 })

    const missingOnly = await listed('?state=missing')

    expect(missingOnly.meters.map((meter) => meter.mark)).toEqual(['WZ-02'])
    expect(missingOnly.counts).toEqual(list.counts)
    // A month before, the second has its reading and the first lacks one.
    expect(
      (await listed(`?keyDate=${monthsBack(1)}`)).meters
        .filter((meter) => mine.has(meter.assetId))
        .map((meter) => meter.state),
    ).toEqual(['missing', 'present', 'paused', 'locked'])
    expect((await listed('?medium=electricity')).meters).toEqual([])
    await http()
      .get(`/meters?keyDate=${addDays(current, 4)}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(400, /Der Stichtag ist der erste Tag eines Monats/)
  })

  it('shows whoever works in the north the meters of the north and none of the south', async () => {
    const { building: inNorth } = await buildingIn(large, north)
    const { building: inSouth } = await buildingIn(large, south)
    const northern = await meterIn(inNorth, 'N-01', large)
    const southern = await meterIn(inSouth, 'S-01', large)
    const shown = (await listed('', by('u-tech', large))).meters.map((meter) => meter.assetId)

    expect(shown).toContain(northern)
    expect(shown).not.toContain(southern)
    await http().get(`/meters/${southern}`).set(testIdentityHeader, by('u-tech', large)).expect(404)
  })
})

describe('a reading by hand', () => {
  it('is entered by every role, for the key date of its day, in the name of whoever enters it, once a key date', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-10')
    const page = await read(meter, addDays(monthsBack(1), -1), 1_204_600)

    // Read the day before a key date, it is the reading for that key date.
    expect(page.rows.find((row) => row.keyDate === monthsBack(1))?.reading).toMatchObject({
      readOn: addDays(monthsBack(1), -1),
      valueMilli: 1_204_600,
      source: 'by_hand',
      name: 'Tobias Wendt',
      valid: true,
    })
    await readingOf(meter, { readOn: monthsBack(1), valueMilli: 1_300_000 }).expect(
      409,
      /Für den Stichtag .* gibt es einen Stand. Ein falscher wird berichtigt./,
    )
    await readingOf(meter, { readOn: addDays(today, 1), valueMilli: 1_300_000 }).expect(
      400,
      /nicht in der Zukunft/,
    )
  })

  it('is refused below the reading before it and above the one after it, with the reason', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-11')

    await read(meter, monthsBack(3), 4_773_600)
    await read(meter, monthsBack(1), 4_812_000)

    const below = await readingOf(meter, { readOn: current, valueMilli: 4_801_200 }).expect(409)

    expect(below.body.message).toMatch(
      /^Kleiner als der letzte Stand vom .*, 4\.812,0 m³\. Wurde der Zähler getauscht, dann über „Zählertausch“\.$/,
    )
    await readingOf(meter, { readOn: monthsBack(2), valueMilli: 4_900_000 }).expect(
      409,
      /Größer als der Stand danach/,
    )
    await read(meter, monthsBack(2), 4_790_000)
  })

  it('is taken by no measuring point that is locked, and says why, while one read before is still corrected', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-12')

    await read(meter, monthsBack(1), 50)

    const [before] = (
      await admin.query<{ id: string }>('select id from meter_readings where asset_id = $1', [
        meter,
      ])
    ).rows

    await send('put', `/meters/${meter}/lock`, { lockReason: 'Schacht überflutet' }).expect(200)
    await readingOf(meter, { readOn: current, valueMilli: 1 }).expect(
      409,
      /Die Messstelle ist gesperrt: Schacht überflutet/,
    )
    await readingOf(meter, {
      readOn: monthsBack(1),
      valueMilli: 0,
      correctsId: before?.id,
      correctionReason: 'Zahlendreher',
    }).expect(201)
    await send('delete', `/meters/${meter}/lock`).expect(200)
    await read(meter, current, 1)
  })

  it('is corrected by a new one with the reason, which counts in its place, while the one corrected stays', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-13')
    const wrong = (await read(meter, monthsBack(1), 4_812_000)).rows.find(
      (row) => row.keyDate === monthsBack(1),
    )?.reading?.id

    await readingOf(meter, {
      readOn: monthsBack(1),
      valueMilli: 4_811_000,
      correctsId: wrong,
    }).expect(400, /Eine Berichtigung nennt ihren Grund/)

    const corrected = (
      await readingOf(
        meter,
        {
          readOn: monthsBack(1),
          valueMilli: 4_811_000,
          correctsId: wrong,
          correctionReason: 'Zahlendreher',
        },
        by('u-lead'),
      ).expect(201)
    ).body as MeterDetails
    const row = corrected.rows.find((each) => each.keyDate === monthsBack(1))

    expect(row?.reading).toMatchObject({
      valueMilli: 4_811_000,
      correctsId: wrong,
      correctionReason: 'Zahlendreher',
      name: 'Sabine Krämer',
      valid: true,
    })
    expect(row?.corrected).toEqual([expect.objectContaining({ id: wrong, valid: false })])
    expect(corrected.lastReading?.valueMilli).toBe(4_811_000)
    await readingOf(meter, {
      readOn: monthsBack(1),
      valueMilli: 4_810_000,
      correctsId: wrong,
      correctionReason: 'Noch einmal',
    }).expect(409, /schon berichtigt/)
  })

  it('is changed and removed by nobody, also not in the database', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-14')

    await read(meter, current, 100)

    const [reading] = (
      await admin.query<{ id: string }>('select id from meter_readings where asset_id = $1', [
        meter,
      ])
    ).rows

    await expect(
      database.forTenant({ tenantId: small, userId: 'u-lead' }, (tx) =>
        tx.execute(sql`update meter_readings set value_milli = 5 where id = ${reading?.id}`),
      ),
    ).rejects.toThrow()
    await expect(
      admin.query('update meter_readings set value_milli = 5 where id = $1', [reading?.id]),
    ).rejects.toThrow(/Ein Zählerstand wird nicht geändert und nicht gelöscht/)
    await expect(
      admin.query('delete from meter_readings where id = $1', [reading?.id]),
    ).rejects.toThrow(/Ein Zählerstand wird nicht geändert und nicht gelöscht/)
  })
})

describe('the consumption of a measuring point', () => {
  it('is worked out from the readings that count, across a replacement, times the factor, and not over a time that rests', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-20')

    await read(meter, monthsBack(4), 1_000_000)
    await read(meter, monthsBack(3), 1_050_000)
    await send('post', `/meters/${meter}/exchanges`, {
      exchangedOn: addDays(monthsBack(3), 10),
      oldEndMilli: 1_060_000,
      newNumber: 'NEU-1',
      newStartMilli: 0,
    }).expect(201)
    await read(meter, monthsBack(2), 20_000)
    await send('post', `/meters/${meter}/pauses`, {
      startsOn: monthsBack(2),
      endsOn: monthsBack(1),
      reason: 'Sommerferien',
    }).expect(201)
    await read(meter, monthsBack(1), 20_000)

    const page = await pageOf(meter)
    const at = (keyDate: IsoDate) => page.rows.find((row) => row.keyDate === keyDate)

    expect(page.meterNumber).toBe('NEU-1')
    expect(at(monthsBack(4))?.consumption).toEqual({ kind: 'first' })
    expect(at(monthsBack(3))?.consumption).toEqual({ kind: 'consumed', milli: 50_000, months: 1 })
    expect(at(monthsBack(2))?.consumption).toEqual({ kind: 'consumed', milli: 30_000, months: 1 })
    expect(at(monthsBack(1))?.consumption).toEqual({ kind: 'paused' })
    expect(at(current)?.state).toBe('missing')
    expect(page.rows[0]?.keyDate).toBe(current)
    expect(page.history).toHaveLength(24)
    expect(page.history[2]).toMatchObject({
      keyDate: monthsBack(2),
      consumption: { kind: 'consumed', milli: 30_000 },
      previousYear: null,
    })

    // A factor of ten counts every figure ten times.
    const counted = (await send('put', `/meters/${meter}`, { conversionFactor: 10 }).expect(200))
      .body as MeterDetails

    expect(counted.rows.find((row) => row.keyDate === monthsBack(3))?.consumption).toEqual({
      kind: 'consumed',
      milli: 500_000,
      months: 1,
    })
  })
})

describe('the replacement of a meter', () => {
  it('is for whoever takes care of assets, takes the new number, and refuses an end below the last reading and the old number', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-30')

    await read(meter, monthsBack(1), 4_812_000)

    const exchange = {
      exchangedOn: addDays(monthsBack(1), 13),
      oldEndMilli: 4_839_700,
      newNumber: '13-920455',
      newStartMilli: 0,
    }
    const refused = await send('post', `/meters/${meter}/exchanges`, exchange, by('u-tech')).expect(
      403,
    )

    expect(refused.body.message).toBe(missingRight('asset.write'))
    await send('post', `/meters/${meter}/exchanges`, {
      ...exchange,
      oldEndMilli: 4_800_000,
    }).expect(409, /Der Endstand ist kleiner als der letzte Stand/)
    await send('post', `/meters/${meter}/exchanges`, { ...exchange, newNumber: '13-WZ-30' }).expect(
      400,
      /andere Nummer/,
    )

    const page = (await send('post', `/meters/${meter}/exchanges`, exchange).expect(201))
      .body as MeterDetails

    expect(page.meterNumber).toBe('13-920455')
    expect(page.exchanges).toEqual([
      expect.objectContaining({
        oldNumber: '13-WZ-30',
        oldEndMilli: 4_839_700,
        newNumber: '13-920455',
      }),
    ])
  })
})

describe('a pause, a lock and a note', () => {
  it('a pause names its reason, does not overlap another, and an open one is ended once', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-40')

    await send('post', `/meters/${meter}/pauses`, { startsOn: monthsBack(2) }).expect(
      400,
      /Der Grund fehlt/,
    )

    const open = (
      await send('post', `/meters/${meter}/pauses`, {
        startsOn: monthsBack(2),
        reason: 'Hauptleitung abgesperrt',
      }).expect(201)
    ).body as MeterDetails
    const pause = open.pauses[0]

    await send('post', `/meters/${meter}/pauses`, {
      startsOn: monthsBack(1),
      endsOn: current,
      reason: 'Noch einmal',
    }).expect(409, /ruht die Messstelle schon/)
    expect(
      (
        (
          await send('put', `/meters/${meter}/pauses/${pause?.id}`, {
            endsOn: monthsBack(1),
          }).expect(200)
        ).body as MeterDetails
      ).pauses[0],
    ).toMatchObject({ endsOn: monthsBack(1) })
    await send('put', `/meters/${meter}/pauses/${pause?.id}`, { endsOn: current }).expect(
      409,
      /schon ein Ende/,
    )
    await send(
      'post',
      `/meters/${meter}/pauses`,
      { startsOn: current, reason: 'x' },
      by('u-tech'),
    ).expect(403)
  })

  it('a lock is set and lifted by whoever takes care of assets, with its reason and since when', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-41')

    await send('put', `/meters/${meter}/lock`, { lockReason: 'Schacht' }, by('u-tech')).expect(403)
    await send('put', `/meters/${meter}/lock`, { lockReason: ' ' }).expect(
      400,
      /Eine Sperre nennt ihren Grund/,
    )
    expect(
      (
        (await send('put', `/meters/${meter}/lock`, { lockReason: 'Schacht' }).expect(200))
          .body as MeterDetails
      ).lock,
    ).toEqual({ reason: 'Schacht', on: today })
    expect(
      ((await send('delete', `/meters/${meter}/lock`).expect(200)).body as MeterDetails).lock,
    ).toBeNull()
    await send('delete', `/meters/${meter}/lock`).expect(409, /nicht gesperrt/)
  })

  it('a note names who wrote it and since when, and none removes it', async () => {
    const { building } = await buildingIn()
    const meter = await meterIn(building, 'WZ-42')
    const noted = (
      await send('put', `/meters/${meter}/note`, {
        note: 'Schacht im Hof, Deckel schwer.',
      }).expect(200)
    ).body as MeterDetails

    expect(noted.note).toEqual({
      text: 'Schacht im Hof, Deckel schwer.',
      name: 'Petra Lindner',
      on: today,
    })
    expect(
      ((await send('put', `/meters/${meter}/note`, { note: '' }).expect(200)).body as MeterDetails)
        .note,
    ).toBeNull()
    await send('put', `/meters/${meter}/note`, { note: 'x' }, by('u-tech')).expect(403)
  })
})

describe('what only a measuring point carries', () => {
  it('counts under a main meter of its property and never under itself or one that counts under it', async () => {
    const { building } = await buildingIn()
    const main = await meterIn(building, 'WZ-50')
    const sub = await meterIn(building, 'WZ-51')
    const { building: elsewhere } = await buildingIn()
    const foreign = await meterIn(elsewhere, 'WZ-52')
    const sentence = /Hauptzähler ist eine andere Messstelle derselben Liegenschaft/

    const under = (
      await send('put', `/meters/${sub}`, { mainMeterId: main, controlId: 'GLT-4711' }).expect(200)
    ).body as MeterDetails

    expect(under).toMatchObject({
      mainMeterId: main,
      mainMeter: { assetId: main, mark: 'WZ-50' },
      controlId: 'GLT-4711',
    })
    expect((await pageOf(main)).subMeters).toEqual([
      { assetId: sub, mark: 'WZ-51', name: 'Wasserzähler WZ-51' },
    ])
    await send('put', `/meters/${main}`, { mainMeterId: sub }).expect(400, sentence)
    await send('put', `/meters/${main}`, { mainMeterId: main }).expect(400, sentence)
    await send('put', `/meters/${sub}`, { mainMeterId: foreign }).expect(400, sentence)
    await send('put', `/meters/${sub}`, { conversionFactor: 0 }).expect(
      400,
      /Der Wandlerfaktor ist eine ganze Zahl/,
    )
  })
})
