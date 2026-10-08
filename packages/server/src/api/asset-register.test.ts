import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  addInterval,
  addMonths,
  type AssetCondition,
  assetConditions,
  type AssetDetails,
  type AssetRegister,
  catalogueOf,
  type DutyReading,
  type IsoDate,
  missingRight,
  type Right,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
  testIdentityHeader,
} from '../database/test-database.js'
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The register of assets and the file of one (#87, section 4.2 of the
 * concept): every filter narrows on the server and two give what passes
 * both, the condition of an asset follows from its duties, their evidence
 * and its defects on the day it is read, a decommissioned asset keeps its
 * past while its duties rest, and nobody reads beyond their areas.
 *
 * Duties, evidence and defects are put in past the application: the routes
 * that write them arrive with their own issues. The catalogue is the probe
 * package, an elevator in cost group 461 and a water meter in 412.
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
/** A tenant that sets a lead of its own, so that no other test counts with it. */
const leading = newId<'tenant'>() as TenantId
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

const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)
const yearly = { months: 12 } as const
/** Met on this day, a duty of a year is due in ten days: within the lead of thirty. */
const dueInTenDays = addDays(addMonths(today, -12), 10)
/** Met on this day, a duty of a year has been due for about a month. */
const dueAMonthAgo = addMonths(today, -13)

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

/** A header for the technician with exactly these rights: one that carries rights is taken at its word. */
function holding(...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId: small, roles: ['technician'], rights })
}

const elevator = { kind: 'probe.elevator', name: 'Aufzug' }
const waterMeter = {
  kind: 'probe.water_meter',
  name: 'Wasserzähler',
  meterNumber: '9WAT1234567',
  meterUnit: 'cubic_metres',
}

interface Place {
  readonly property: string
  readonly building: string
  readonly annex: string
}

/** A property with two buildings, Haus A and Haus B. */
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

  return {
    property,
    building: await made(`/properties/${property}/buildings`, {
      name: 'Haus A',
      kinds: ['school'],
    }),
    annex: await made(`/properties/${property}/buildings`, { name: 'Haus B', kinds: ['office'] }),
  }
}

/** An asset taken into the register through the route. */
async function assetIn(
  building: string,
  body: object = elevator,
  userId: keyof typeof people & string = 'u-tech',
  tenantId: TenantId = small,
): Promise<string> {
  return (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by(userId, tenantId))
      .send(body)
      .expect(201)
  ).body.id
}

/** An elevator of a name, so that a test reads its rows by what they are. */
function named(building: string, name: string, tenantId: TenantId = small): Promise<string> {
  return assetIn(building, { ...elevator, name }, 'u-tech', tenantId)
}

/** An entry in the life cycle of an asset, by the Objektleitung. */
async function stateOf(
  asset: string,
  state: string,
  validFrom: IsoDate,
  tenantId: TenantId = small,
): Promise<void> {
  await http()
    .post(`/assets/${asset}/lifecycle`)
    .set(testIdentityHeader, by('u-site', tenantId))
    .send({ state, validFrom })
    .expect(201)
}

/** An evidence of a duty on a day, put in past the application. */
async function evidenceOf(
  duty: string,
  performedOn: IsoDate,
  result = 'without_defects',
): Promise<void> {
  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, $3::evidence_result,
            ${writtenPlaceholders(4)}
       from duties where id = $1`,
    [duty, performedOn, result, ...writtenValues('u-duties', performedOn, result)],
  )
}

/**
 * A duty of the operator's own at an asset, of a year and counted from the
 * day it was done, met on the days named.
 */
async function dutyAt(
  asset: string,
  options: {
    readonly label?: string
    readonly endsOn?: IsoDate
    readonly metOn?: readonly IsoDate[]
  } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by, ends_on)
     select tenant_id, property_id, area_id, id, $2, 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-duties', $3::date
       from assets where id = $1
     returning id`,
    [asset, options.label ?? 'Sichtprüfung', options.endsOn ?? null],
  )
  const duty = rows[0]?.id ?? ''

  for (const day of options.metOn ?? []) {
    await evidenceOf(duty, day)
  }

  return duty
}

/** A defect at an asset in a status, put in past the application. */
async function defectAt(asset: string, status: string): Promise<void> {
  await admin.query(
    `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on, status,
                          checked_on)
     select tenant_id, property_id, area_id, id, 'Leck am Antrieb', $2::date, $3::defect_status,
            case when $3::defect_status = 'verified' then $2::date end
       from assets where id = $1`,
    [asset, daysAgo(3), status],
  )
}

/** A page of the register as somebody reads it. */
async function register(
  query: Readonly<Record<string, string>> = {},
  header: string = by('u-tech'),
): Promise<AssetRegister> {
  return (await http().get('/assets').query(query).set(testIdentityHeader, header).expect(200)).body
}

/** The names on a page, in its order. */
async function namesOf(
  query: Readonly<Record<string, string>>,
  header?: string,
): Promise<string[]> {
  return (await register(query, header)).assets.map((asset) => asset.name)
}

async function fileOf(asset: string, header: string = by('u-tech')): Promise<AssetDetails> {
  return (await http().get(`/assets/${asset}`).set(testIdentityHeader, header).expect(200)).body
}

async function dutiesOf(asset: string, header: string = by('u-tech')): Promise<DutyReading[]> {
  return (await http().get(`/assets/${asset}/duties`).set(testIdentityHeader, header).expect(200))
    .body
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
    leading,
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

    for (const tenantId of [small, large, leading]) {
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
        catalogue: catalogueOf(probeCatalogueBundle),
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

describe('the register of assets', () => {
  it('lists the assets in the order of their numbers, each with its life cycle and its condition', async () => {
    const place = await placeIn()
    const lift = await named(place.building, 'Aufzug Haus A')
    const meter = await assetIn(place.annex, waterMeter)
    const drive = (
      await http()
        .post(`/assets/${lift}/components`)
        .set(testIdentityHeader, by('u-tech'))
        .send({ ...elevator, name: 'Antrieb' })
        .expect(201)
    ).body.id as string

    await stateOf(lift, 'in_service', '2020-01-01')

    const page = await register({ propertyId: place.property })

    expect({ total: page.total, properties: page.properties }).toEqual({ total: 3, properties: 1 })
    expect(page.assets.map((asset) => asset.id)).toEqual([lift, meter, drive])
    expect(page.assets[0]).toEqual({
      id: lift,
      propertyId: place.property,
      buildingId: place.building,
      roomId: null,
      parentAssetId: null,
      kind: 'probe.elevator',
      number: expect.stringMatching(/^AN-\d{5}$/),
      name: 'Aufzug Haus A',
      lifecycleState: 'in_service',
      condition: 'no_duties',
      until: null,
    })
    expect(page.assets[1]?.lifecycleState).toBeNull()
    expect(page.assets[2]?.parentAssetId).toBe(lift)

    // An asset that was removed is no longer in the register.
    await http().delete(`/assets/${drive}`).set(testIdentityHeader, by('u-site')).expect(200)
    expect(
      (await register({ propertyId: place.property })).assets.map((asset) => asset.id),
    ).toEqual([lift, meter])
  })

  it('narrows by property and by building, and by both to what stands in both', async () => {
    const here = await placeIn()
    const there = await placeIn()

    await named(here.building, 'In Haus A')
    await named(here.annex, 'In Haus B')
    await named(there.building, 'Woanders')

    expect(await namesOf({ propertyId: here.property })).toEqual(['In Haus A', 'In Haus B'])
    expect(await namesOf({ buildingId: here.annex })).toEqual(['In Haus B'])
    expect(await namesOf({ propertyId: here.property, buildingId: here.annex })).toEqual([
      'In Haus B',
    ])
    // A building of the one property and the other property: nothing stands in both.
    expect(await register({ propertyId: there.property, buildingId: here.annex })).toEqual({
      total: 0,
      properties: 0,
      assets: [],
    })

    // Without a place the register holds every one of them, on both properties.
    const every = await register({ limit: '200' })

    expect(every.assets.map((asset) => asset.name)).toEqual(
      expect.arrayContaining(['In Haus A', 'In Haus B', 'Woanders']),
    )
    expect(every.properties).toBeGreaterThanOrEqual(2)
  })

  it('narrows by kind and by the cost group its kind names, and by both to what is both', async () => {
    const place = await placeIn()

    await named(place.building, 'Aufzug')
    await assetIn(place.building, waterMeter)

    const here = { propertyId: place.property }

    expect(await namesOf({ ...here, kind: 'probe.water_meter' })).toEqual(['Wasserzähler'])
    expect(await namesOf({ ...here, costGroup: '461' })).toEqual(['Aufzug'])
    expect(await namesOf({ ...here, costGroup: '412' })).toEqual(['Wasserzähler'])
    // A group holds the groups below it: 460 the elevators of 461.
    expect(await namesOf({ ...here, costGroup: '460' })).toEqual(['Aufzug'])
    expect(await namesOf({ ...here, costGroup: '400' })).toEqual(['Aufzug', 'Wasserzähler'])
    expect(await namesOf({ ...here, costGroup: '462' })).toEqual([])
    // No kind of the catalogue is in this group, and no elevator is a meter.
    expect(await namesOf({ ...here, costGroup: '999' })).toEqual([])
    expect(await namesOf({ ...here, costGroup: '461', kind: 'probe.water_meter' })).toEqual([])
  })

  it('names nothing for a place whose id is none', async () => {
    expect(await register({ propertyId: 'liegenschaft-1' })).toEqual({
      total: 0,
      properties: 0,
      assets: [],
    })
    expect((await register({ buildingId: 'haus-a' })).total).toBe(0)
  })

  it('hands out a page at a time and says how many assets there are behind it', async () => {
    const place = await placeIn()
    const here = { propertyId: place.property }

    for (const name of ['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf']) {
      await named(place.building, name)
    }

    const first = await register({ ...here, limit: '2' })

    expect(first.total).toBe(5)
    expect(first.assets.map((asset) => asset.name)).toEqual(['Eins', 'Zwei'])
    expect(await namesOf({ ...here, limit: '2', offset: '2' })).toEqual(['Drei', 'Vier'])
    expect(await namesOf({ ...here, limit: '2', offset: '4' })).toEqual(['Fünf'])

    const beyond = await register({ ...here, offset: '9' })

    expect({ total: beyond.total, assets: beyond.assets }).toEqual({ total: 5, assets: [] })
    // Without a word about the page it is the first, of fifty.
    expect((await register(here)).assets).toHaveLength(5)
  })

  it('refuses a page, a condition and a state of the life cycle there is none of', async () => {
    const refusals: readonly (readonly [Record<string, string>, string])[] = [
      [{ limit: '0' }, 'Eine Seite hält zwischen 1 und 200 Anlagen.'],
      [{ limit: '201' }, 'Eine Seite hält zwischen 1 und 200 Anlagen.'],
      [{ limit: 'alle' }, 'Eine Seite hält zwischen 1 und 200 Anlagen.'],
      [{ offset: '-1' }, 'Eine Seite beginnt bei einer ganzen Zahl ab 0.'],
      [{ offset: '1.5' }, 'Eine Seite beginnt bei einer ganzen Zahl ab 0.'],
      [{ condition: 'kaputt' }, 'Diesen Zustand kennt das Anlagenverzeichnis nicht.'],
      [{ lifecycle: 'asleep' }, 'Diesen Zustand im Lebenszyklus gibt es nicht.'],
    ]

    for (const [query, sentence] of refusals) {
      await http()
        .get('/assets')
        .query(query)
        .set(testIdentityHeader, by('u-tech'))
        .expect(400)
        .expect((answer) => expect(answer.body.message).toBe(sentence))
    }

    await http()
      .get('/assets')
      .query({ limit: '200' })
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)
  })
})

describe('the condition of an asset', () => {
  /** What each asset of the test is to be, by its name. */
  const expected: Readonly<Record<string, AssetCondition>> = {
    'Ohne Pflicht': 'no_duties',
    'Nie geprüft': 'never_checked',
    Überfällig: 'overdue',
    Fällig: 'due',
    'In Ordnung': 'in_order',
    'Mangel behoben, nicht nachgeprüft': 'defect_open',
    'Mangel nachgeprüft': 'no_duties',
    'Außer Betrieb': 'resting',
    'Pflicht beendet': 'no_duties',
    'Pflicht endet vor dem Termin': 'in_order',
    'Mangel und Pflicht entfernt': 'no_duties',
  }
  let here: { propertyId: string }

  beforeAll(async () => {
    const place = await placeIn()
    const made = async (name: string) => named(place.building, name)

    here = { propertyId: place.property }

    await made('Ohne Pflicht')
    await dutyAt(await made('Nie geprüft'))
    await dutyAt(await made('Überfällig'), { metOn: [dueAMonthAgo] })
    await dutyAt(await made('Fällig'), { metOn: [dueInTenDays] })

    const fine = await made('In Ordnung')

    await dutyAt(fine, { metOn: [daysAgo(10)] })
    await dutyAt(fine, { label: 'Wartung', metOn: [daysAgo(400), daysAgo(40)] })

    const remedied = await made('Mangel behoben, nicht nachgeprüft')

    await dutyAt(remedied, { metOn: [daysAgo(10)] })
    await defectAt(remedied, 'remedied')
    await defectAt(await made('Mangel nachgeprüft'), 'verified')

    const resting = await made('Außer Betrieb')

    await dutyAt(resting, { metOn: [dueAMonthAgo] })
    await stateOf(resting, 'in_service', '2015-03-01')
    await stateOf(resting, 'out_of_service', daysAgo(5))

    await dutyAt(await made('Pflicht beendet'), { metOn: [dueAMonthAgo], endsOn: daysAgo(1) })
    await dutyAt(await made('Pflicht endet vor dem Termin'), {
      metOn: [dueInTenDays],
      endsOn: addDays(today, 5),
    })

    // A duty and a defect that were removed say nothing about their asset.
    const cleared = await made('Mangel und Pflicht entfernt')
    const removed = await dutyAt(cleared)

    await defectAt(cleared, 'found')
    await admin.query('update duties set deleted_at = now() where id = $1', [removed])
    await admin.query('update defects set deleted_at = now() where asset_id = $1', [cleared])
  })

  it('follows from its duties, their evidence and its defects on the day it is read', async () => {
    const page = await register(here)

    expect(Object.fromEntries(page.assets.map((asset) => [asset.name, asset.condition]))).toEqual(
      expected,
    )
    // In order until the first of its duties falls due, and a day for no other.
    expect(
      Object.fromEntries(
        page.assets.filter((asset) => asset.until !== null).map((each) => [each.name, each.until]),
      ),
    ).toEqual({ 'In Ordnung': addInterval(daysAgo(40), yearly) })
  })

  it('narrows the register, each condition to the assets that are in it', async () => {
    for (const condition of assetConditions) {
      const page = await register({ ...here, condition })
      const names = Object.keys(expected).filter((name) => expected[name] === condition)

      expect([condition, page.total, page.assets.map((asset) => asset.name).sort()]).toEqual([
        condition,
        names.length,
        [...names].sort(),
      ])
    }
  })

  it('narrows together with the life cycle, which no column holds either', async () => {
    expect(await namesOf({ ...here, lifecycle: 'out_of_service' })).toEqual(['Außer Betrieb'])
    expect(await namesOf({ ...here, lifecycle: 'in_service' })).toEqual([])
    expect((await register({ ...here, lifecycle: 'none' })).total).toBe(10)
    expect((await namesOf({ ...here, lifecycle: 'none', condition: 'no_duties' })).sort()).toEqual([
      'Mangel nachgeprüft',
      'Mangel und Pflicht entfernt',
      'Ohne Pflicht',
      'Pflicht beendet',
    ])
    // Every asset that rests is out of service here, and none without an entry rests.
    expect(await namesOf({ ...here, lifecycle: 'none', condition: 'resting' })).toEqual([])
    expect(await namesOf({ ...here, lifecycle: 'out_of_service', condition: 'resting' })).toEqual([
      'Außer Betrieb',
    ])
  })

  it('counts as due from the lead the operator set, and from the lead a deadline has of its own', async () => {
    const place = await placeIn(leading)
    const asset = await named(place.building, 'Aufzug', leading)
    const duty = await dutyAt(asset, { metOn: [dueInTenDays] })
    const condition = async () =>
      (await register({ propertyId: place.property }, by('u-tech', leading))).assets[0]?.condition

    // Thirty days, the lead of the kind.
    expect(await condition()).toBe('due')

    await admin.query(
      `insert into deadline_settings (tenant_id, kind, lead_days) values ($1, 'duty.due', 5)`,
      [leading],
    )
    expect(await condition()).toBe('in_order')

    await admin.query(
      `insert into deadlines (tenant_id, kind, source_id, source_label, anchor_on, due_on, lead_days,
                              duty_id, property_id, area_id)
       select tenant_id, 'duty.due', id, 'Sichtprüfung', $2::date, $3::date, 20,
              id, property_id, area_id
         from duties where id = $1`,
      [duty, dueInTenDays, addInterval(dueInTenDays, yearly)],
    )
    expect(await condition()).toBe('due')
  })
})

describe('the file of an asset', () => {
  it('names its components, the asset it is one of, and its condition', async () => {
    const place = await placeIn()
    const lift = await named(place.building, 'Aufzug Haus A')
    const drive = (
      await http()
        .post(`/assets/${lift}/components`)
        .set(testIdentityHeader, by('u-tech'))
        .send({ ...elevator, name: 'Antrieb' })
        .expect(201)
    ).body as { id: string; number: string }

    await dutyAt(lift)

    const file = await fileOf(lift)

    expect({
      components: file.components,
      parent: file.parent,
      condition: file.condition,
      until: file.until,
    }).toEqual({
      components: [{ id: drive.id, number: drive.number, name: 'Antrieb', kind: 'probe.elevator' }],
      parent: null,
      condition: 'never_checked',
      until: null,
    })

    const part = await fileOf(drive.id)

    expect({ components: part.components, parent: part.parent, condition: part.condition }).toEqual(
      {
        components: [],
        parent: { id: lift, number: file.number, name: 'Aufzug Haus A' },
        // The duty of the asset is not one of its component.
        condition: 'no_duties',
      },
    )

    // A component that was removed is none any more.
    await http().delete(`/assets/${drive.id}`).set(testIdentityHeader, by('u-site')).expect(200)
    expect((await fileOf(lift)).components).toEqual([])
  })

  it('keeps the past of a decommissioned asset, and its duties rest', async () => {
    const place = await placeIn()
    const old = await named(place.building, 'Alter Aufzug')
    const running = await named(place.building, 'Neuer Aufzug')

    for (const asset of [old, running]) {
      await stateOf(asset, 'in_service', '2015-03-01')
      await dutyAt(asset, { metOn: [daysAgo(800), dueAMonthAgo] })
    }

    await stateOf(old, 'decommissioned', daysAgo(20))

    const file = await fileOf(old)

    expect({
      lifecycle: file.lifecycle.map((entry) => [entry.state, entry.validFrom]),
      lifecycleState: file.lifecycleState,
      condition: file.condition,
    }).toEqual({
      lifecycle: [
        ['in_service', '2015-03-01'],
        ['decommissioned', daysAgo(20)],
      ],
      lifecycleState: 'decommissioned',
      condition: 'resting',
    })
    expect((await dutiesOf(old)).map((duty) => [duty.title, duty.state, duty.lastMetOn])).toEqual([
      ['Sichtprüfung', 'dormant', dueAMonthAgo],
    ])

    // The same duty with the same evidence at an asset in service is overdue.
    expect((await fileOf(running)).condition).toBe('overdue')
    expect((await dutiesOf(running)).map((duty) => duty.state)).toEqual(['overdue'])
  })

  it('lists its duties by what they are called, each with its last evidence, its appointment and its state', async () => {
    const place = await placeIn()
    const lift = await named(place.building, 'Aufzug Haus A')
    const maintenance = await dutyAt(lift, { label: 'Wartung', metOn: [daysAgo(10)] })

    // From the catalogue, confirmed in its first version and never recorded.
    await admin.query(
      `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                           counting, interval_months, confirmed_by)
       select tenant_id, property_id, area_id, id, 'probe.elevator_main_test', 1,
              'betrsichv', 24, 'u-duties'
         from assets where id = $1`,
      [lift],
    )
    // One that has ended calls for nothing and is not among them.
    await dutyAt(lift, { label: 'Alte Pflicht', metOn: [dueAMonthAgo], endsOn: daysAgo(1) })
    // What was not carried out met nothing.
    await evidenceOf(maintenance, daysAgo(1), 'not_performed')

    const dueOn = addInterval(daysAgo(10), yearly)

    expect(
      (await dutiesOf(lift)).map((duty) => ({
        title: duty.title,
        state: duty.state,
        appointment: duty.appointment,
        lastMetOn: duty.lastMetOn,
        interval: duty.intervalMonths,
      })),
    ).toEqual([
      {
        title: 'Hauptprüfung der Aufzugsanlage',
        state: 'never_recorded',
        appointment: null,
        lastMetOn: null,
        interval: 24,
      },
      {
        title: 'Wartung',
        state: 'met',
        appointment: { dueOn, onTimeUntil: dueOn },
        lastMetOn: daysAgo(10),
        interval: 12,
      },
    ])
  })
})

describe('the register and the file in a tenant with two areas', () => {
  it('hold the assets of the areas of the person, whatever the address names', async () => {
    const inNorth = await placeIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await placeIn(large, { areaId: south, name: 'Campus Süd' })
    const northern = await named(inNorth.building, 'Aufzug Nord', large)
    const southern = await assetIn(
      inSouth.building,
      { ...elevator, name: 'Aufzug Süd' },
      'u-duties',
      large,
    )
    const tech = by('u-tech', large)

    await dutyAt(southern)

    expect(await register({}, tech)).toMatchObject({
      total: 1,
      properties: 1,
      assets: [{ id: northern, name: 'Aufzug Nord' }],
    })
    expect(await register({ propertyId: inSouth.property }, tech)).toEqual({
      total: 0,
      properties: 0,
      assets: [],
    })
    expect(await namesOf({ condition: 'never_checked' }, tech)).toEqual([])

    await http().get(`/assets/${southern}/duties`).set(testIdentityHeader, tech).expect(404)

    // Whoever sees every area reads both.
    const every = await register({}, by('u-duties', large))

    expect({ total: every.total, properties: every.properties }).toEqual({
      total: 2,
      properties: 2,
    })
    expect(await namesOf({ condition: 'never_checked' }, by('u-duties', large))).toEqual([
      'Aufzug Süd',
    ])
  })
})

describe('the rights to the register and the file', () => {
  it('let whoever reads assets read the register, and whoever reads duties the duties of an asset', async () => {
    const place = await placeIn()
    const lift = await named(place.building, 'Aufzug')

    await http()
      .get('/assets')
      .set(testIdentityHeader, holding('duty.read'))
      .expect(403)
      .expect((answer) => expect(answer.body.message).toBe(missingRight('asset.read')))
    await http()
      .get(`/assets/${lift}/duties`)
      .set(testIdentityHeader, holding('asset.read'))
      .expect(403)
      .expect((answer) => expect(answer.body.message).toBe(missingRight('duty.read')))

    await http().get('/assets').set(testIdentityHeader, holding('asset.read')).expect(200)
    // Asking for a possible duplicate names assets, so it is reading them.
    await http()
      .get('/assets/duplicates')
      .query({ mark: 'A1' })
      .set(testIdentityHeader, holding('asset.record'))
      .expect(403)
      .expect((answer) => expect(answer.body.message).toBe(missingRight('asset.read')))
    await http()
      .get('/assets/duplicates')
      .query({ mark: 'A1' })
      .set(testIdentityHeader, holding('asset.read'))
      .expect(200)
    await http()
      .get(`/assets/${lift}/duties`)
      .set(testIdentityHeader, holding('duty.read'))
      .expect(200)

    // Each of the four roles reads both.
    for (const userId of Object.keys(people)) {
      await http().get('/assets').set(testIdentityHeader, by(userId)).expect(200)
      await http().get(`/assets/${lift}/duties`).set(testIdentityHeader, by(userId)).expect(200)
    }
  })
})
