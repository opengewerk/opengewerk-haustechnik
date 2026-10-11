import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  activityKindLabel,
  type ActivityList,
  addDays,
  type AssetRegister,
  assetRegisterPage,
  catalogueOf,
  dayInWords,
  type DefectClassSetting,
  type DefectRegister,
  missingRight,
  type Right,
  type RoleKey,
  shippedRoles,
  type TenantId,
  type WorkOrderList,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'
import { stampIn, stampsOf as allStampsOf, tableReaders, todayInWords } from './test-tables.js'

/**
 * The lists of the office as tables (#138, section 3 of the concept): what
 * the list shows under its filter, in its order and under its columns, also
 * where the list is read a page at a time, under the rights and in the areas
 * of the person asking, and nothing of the stamp of the last change (#157).
 *
 * Every table is read back by the reader of the foundation, as an import
 * would read it, so that a test compares the cells somebody sees.
 */

/** Where the assets are taken in, with one area. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south, for the assets. */
const large = newId<'tenant'>() as TenantId
/** Two areas, north and south, for the properties and nothing else. */
const estate = newId<'tenant'>() as TenantId
let north = ''
let south = ''
let estateNorth = ''
let estateSouth = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-tech': 'technician',
}

/** What each is called: never their id, which is what a stamp would name. */
const names: Readonly<Record<string, string>> = {
  'u-lead': 'Lena Leitung',
  'u-duties': 'Tom Technik',
  'u-tech': 'Hana Haus',
}

/** The packages of the application beside the one of the tests: the classes of defects come from them. */
const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
})

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

/** A header for the technician with exactly these rights: one that carries rights is taken at its word. */
function holding(tenantId: TenantId, ...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId, roles: ['technician'], rights })
}

const elevator = { kind: 'probe.elevator', name: 'Aufzug' }
const waterMeter = {
  kind: 'probe.water_meter',
  name: 'Wasserzähler',
  meterNumber: '9WAT1234567',
  meterUnit: 'cubic_metres',
}

/** Made through its route by the Technische Leitung, which keeps the places. */
async function made(path: string, body: object, tenantId: TenantId): Promise<string> {
  return (
    await http().post(path).set(testIdentityHeader, by('u-duties', tenantId)).send(body).expect(201)
  ).body.id
}

/** A property with a building on it. */
async function propertyIn(
  tenantId: TenantId,
  name: string,
  extra: object = {},
  building = 'Haus A',
): Promise<{ readonly property: string; readonly building: string }> {
  const property = await made(
    '/properties',
    {
      name,
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      ...extra,
    },
    tenantId,
  )

  return {
    property,
    building: await made(
      `/properties/${property}/buildings`,
      { name: building, kinds: ['school'] },
      tenantId,
    ),
  }
}

/** An asset taken into the register through the route, by the technician. */
async function assetIn(
  building: string,
  body: object,
  tenantId: TenantId = small,
): Promise<string> {
  return (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by('u-tech', tenantId))
      .send(body)
      .expect(201)
  ).body.id
}

const { asked, tableOf, rawOf, refusalOf } = tableReaders(http)

/** A page of the register as the list reads it. */
async function register(
  query: Readonly<Record<string, string>>,
  header: string = by('u-tech'),
): Promise<AssetRegister> {
  return (await http().get('/assets').query(query).set(testIdentityHeader, header).expect(200)).body
}

/** The stamps of the places and the assets of a tenant, which every table of these tests reads. */
function stampsOf(tenantId: TenantId, ...more: string[]): Promise<string[]> {
  return allStampsOf(admin, tenantId, ['properties', 'buildings', 'assets', ...more])
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
    estate,
    'Liegenschaften Probe',
  ])

  // The tenants with two areas have them before anybody works for them, so
  // that they do not begin with the one a tenant gets with its first membership.
  const { rows } = await admin.query<{ id: string; name: string; tenant_id: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd'), ($2, 'Nord'), ($2, 'Süd')
     returning id, name, tenant_id`,
    [large, estate],
  )
  const area = (tenantId: TenantId, name: string) =>
    rows.find((row) => row.tenant_id === tenantId && row.name === name)?.id ?? ''

  north = area(large, 'Nord')
  south = area(large, 'Süd')
  estateNorth = area(estate, 'Nord')
  estateSouth = area(estate, 'Süd')

  // The roles as rows, with the rights each ships with: who may lead a work
  // order is asked of them, as of a real operator.
  for (const tenantId of [small, large, estate]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      names[userId],
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large, estate]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  // In the tenants with two areas the technician works in the north.
  await admin.query(
    'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3), ($4, $2, $5)',
    [large, 'u-tech', north, estate, estateNorth],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
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

describe('the register of assets as a table', () => {
  it('holds every asset the filter passes, in the order of the list, also beyond its first page', async () => {
    const { property, building } = await propertyIn(small, 'Schulzentrum Am Neckar')
    const count = assetRegisterPage.size + 2

    for (let index = 1; index <= count; index += 1) {
      await assetIn(building, { ...elevator, name: `Aufzug ${String(index).padStart(2, '0')}` })
    }

    const first = await register({ propertyId: property })
    const second = await register({ propertyId: property, offset: String(first.assets.length) })
    const table = await tableOf('/assets/table', { propertyId: property }, by('u-tech'))

    expect(first.total).toBe(count)
    expect(first.assets.length).toBeLessThan(count)
    expect(table.slice(1).map((row) => row[1])).toEqual(
      [...first.assets, ...second.assets].map((asset) => asset.name),
    )
  })

  it('names its columns and fills them as the list does: number, kind, place, condition, life cycle', async () => {
    const { property, building } = await propertyIn(small, 'Rathaus Süd')
    const lift = await assetIn(building, { ...elevator, name: 'Aufzug Rathaus' })
    const meter = await assetIn(building, waterMeter)

    await http()
      .post(`/assets/${lift}/lifecycle`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ state: 'in_service', validFrom: '2020-01-01' })
      .expect(201)

    const numbers = new Map<string, string | null>(
      (await register({ propertyId: property })).assets.map((asset) => [
        asset.id as string,
        asset.number,
      ]),
    )

    for (const format of ['xlsx', 'csv'] as const) {
      expect(
        await tableOf('/assets/table', { propertyId: property }, by('u-tech'), format),
      ).toEqual([
        ['Nummer', 'Anlage', 'Anlagenart', 'Standort', 'Zustand', 'Lebenszyklus'],
        [
          numbers.get(lift),
          'Aufzug Rathaus',
          'Aufzugsanlage',
          'Rathaus Süd, Haus A',
          'Ohne Pflichten',
          'In Betrieb',
        ],
        [
          numbers.get(meter),
          'Wasserzähler',
          'Wasserzähler',
          'Rathaus Süd, Haus A',
          'Ohne Pflichten',
        ],
      ])
    }
  })

  it('narrows by what the list is narrowed by', async () => {
    const { property, building } = await propertyIn(small, 'Feuerwache Nord')

    await assetIn(building, { ...elevator, name: 'Aufzug Wache' })
    await assetIn(building, waterMeter)

    const table = await tableOf(
      '/assets/table',
      { propertyId: property, kind: 'probe.water_meter' },
      by('u-tech'),
    )

    expect(table.slice(1).map((row) => row[1])).toEqual(['Wasserzähler'])
  })

  it('holds no asset of an area the person does not see', async () => {
    const inNorth = await propertyIn(large, 'Bauhof Nord', { areaId: north })
    const inSouth = await propertyIn(large, 'Bauhof Süd', { areaId: south })

    await assetIn(inNorth.building, { ...elevator, name: 'Aufzug Nord' }, large)
    await http()
      .post(`/buildings/${inSouth.building}/assets`)
      .set(testIdentityHeader, by('u-duties', large))
      .send({ ...elevator, name: 'Aufzug Süd' })
      .expect(201)

    const names = async (header: string) =>
      (await tableOf('/assets/table', {}, header)).slice(1).map((row) => row[1])

    expect(await names(by('u-tech', large))).toEqual(['Aufzug Nord'])
    expect((await names(by('u-lead', large))).sort()).toEqual(['Aufzug Nord', 'Aufzug Süd'])
    // Named in the address, the other area gives nothing either.
    expect(
      await tableOf('/assets/table', { propertyId: inSouth.property }, by('u-tech', large)),
    ).toEqual([['Nummer', 'Anlage', 'Anlagenart', 'Standort', 'Zustand', 'Lebenszyklus']])
  })

  it('is only for whoever reads the register', async () => {
    const refused = await asked(
      '/assets/table',
      { format: 'xlsx' },
      holding(small, 'location.read'),
    )

    expect(refused.status).toBe(403)
    expect(JSON.parse(String(refused.body)).message).toBe(missingRight('asset.read'))
  })

  it('names the place only for whoever reads places as well', async () => {
    const { property, building } = await propertyIn(small, 'Rathaus Nord')
    await assetIn(building, { ...elevator, name: 'Aufzug Nord' })

    for (const format of ['xlsx', 'csv'] as const) {
      const [, row] = await tableOf(
        '/assets/table',
        { propertyId: property },
        holding(small, 'asset.read'),
        format,
      )

      expect(row?.slice(1, 4)).toEqual(['Aufzug Nord', 'Aufzugsanlage', ''])
    }

    const [, named] = await tableOf(
      '/assets/table',
      { propertyId: property },
      holding(small, 'asset.read', 'location.read'),
    )

    expect(named?.[3]).toBe('Rathaus Nord, Haus A')
  })

  it('is asked for as a workbook or as text, and refused in words otherwise', async () => {
    const refused = await asked('/assets/table', { format: 'pdf' }, by('u-tech')).expect(400)

    expect(JSON.parse(String(refused.body)).message).toBe(
      'Eine Tabelle gibt es als xlsx oder als csv.',
    )
    await asked('/assets/table', {}, by('u-tech')).expect(400)
  })

  it('writes a name that begins like a formula so that no spreadsheet runs it', async () => {
    const { property, building } = await propertyIn(small, 'Kita Sonnenhang')

    await assetIn(building, { ...elevator, name: '=HYPERLINK("http://x.example")' })
    await assetIn(building, { ...elevator, name: '@SUMME(A1)' })

    const csv = await rawOf('/assets/table', { propertyId: property }, by('u-tech'), 'csv')
    const sheet = await rawOf('/assets/table', { propertyId: property }, by('u-tech'), 'xlsx')

    expect(csv).toContain(`;"'=HYPERLINK(""http://x.example"")";`)
    expect(csv).toContain(";'@SUMME(A1);")
    expect(sheet).not.toMatch(/<f[ >]/)
    expect(sheet).toContain(
      't="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://x.example&quot;)</t>',
    )
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const stamps = await stampsOf(small)

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/assets/table', {}, by('u-tech'), format)

      expect(table.length).toBeGreaterThan(10)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the properties as a table', () => {
  /** The header of the table of the Leitung in the tenant with two areas. */
  const everything = [
    'Liegenschaft',
    'Gebäude',
    'Adresse',
    'Bereich',
    'Überfällig',
    'Fällig',
    'Nie erfasst',
    'Offene Mängel',
    'Zählerstände fehlen',
  ]

  beforeAll(async () => {
    await propertyIn(estate, 'Wohnanlage Birkenweg', { areaId: estateNorth }, 'Haus B')
    await propertyIn(estate, 'Altes Rathaus', { areaId: estateNorth })
    await propertyIn(estate, 'Sporthalle Süd', { areaId: estateSouth, postalCode: '01067' })
  })

  it('holds each property and its buildings under it, in the order of the list, with the numbers', async () => {
    const lead = by('u-lead', estate)

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await tableOf('/properties/table', {}, lead, format)).toEqual([
        everything,
        [
          'Altes Rathaus',
          '',
          'Neckarstraße 4, 68535 Edingen-Neckarhausen',
          'Nord',
          '0',
          '0',
          '0',
          '0',
          '0',
        ],
        [
          'Altes Rathaus',
          'Haus A',
          'Neckarstraße 4, 68535 Edingen-Neckarhausen',
          'Nord',
          '0',
          '0',
          '0',
          '0',
          '0',
        ],
        [
          'Sporthalle Süd',
          '',
          'Neckarstraße 4, 01067 Edingen-Neckarhausen',
          'Süd',
          '0',
          '0',
          '0',
          '0',
          '0',
        ],
        [
          'Sporthalle Süd',
          'Haus A',
          'Neckarstraße 4, 01067 Edingen-Neckarhausen',
          'Süd',
          '0',
          '0',
          '0',
          '0',
          '0',
        ],
        [
          'Wohnanlage Birkenweg',
          '',
          'Neckarstraße 4, 68535 Edingen-Neckarhausen',
          'Nord',
          '0',
          '0',
          '0',
          '0',
          '0',
        ],
        [
          'Wohnanlage Birkenweg',
          'Haus B',
          'Neckarstraße 4, 68535 Edingen-Neckarhausen',
          'Nord',
          '0',
          '0',
          '0',
          '0',
          '0',
        ],
      ])
    }
  })

  it('narrows to the area of the chip and to what is searched for, as the list does', async () => {
    const lead = by('u-lead', estate)
    const names = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/properties/table', query, lead)).slice(1).map((row) => `${row[0]}/${row[1]}`)

    expect(await names({ area: estateSouth })).toEqual(['Sporthalle Süd/', 'Sporthalle Süd/Haus A'])
    expect(await names({ search: ' haus b ' })).toEqual([
      'Wohnanlage Birkenweg/',
      'Wohnanlage Birkenweg/Haus B',
    ])
    // An area that is no area of the person narrows nothing, as on the list.
    expect(await names({ area: newId() })).toHaveLength(6)
  })

  it('comes in the order of urgency where the list is ordered so', async () => {
    const lead = by('u-lead', estate)
    const { rows } = await admin.query<{ id: string }>(
      `select id from buildings where tenant_id = $1 and property_id =
         (select id from properties where tenant_id = $1 and name = 'Wohnanlage Birkenweg')`,
      [estate],
    )
    const asset = await assetIn(rows[0]?.id ?? '', elevator, estate)

    // A duty never recorded: the property has something to do, the others nothing.
    await admin.query(
      `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                           counting, interval_months, confirmed_by)
       select tenant_id, property_id, area_id, id, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
              'from_performance', 12, 'u-duties'
         from assets where id = $1`,
      [asset],
    )

    const order = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/properties/table', query, lead))
        .slice(1)
        .filter((row) => row[1] === '')
        .map((row) => row[0])

    expect(await order({ order: 'urgency' })).toEqual([
      'Wohnanlage Birkenweg',
      'Altes Rathaus',
      'Sporthalle Süd',
    ])
    expect(await order({})).toEqual(['Altes Rathaus', 'Sporthalle Süd', 'Wohnanlage Birkenweg'])
    await asked('/properties/table', { format: 'xlsx', order: 'name' }, lead).expect(400)
  })

  it('holds no property of an area the person does not see, and no column of the area for one area', async () => {
    const table = await tableOf('/properties/table', {}, by('u-tech', estate))

    expect(table[0]).toEqual(everything.filter((column) => column !== 'Bereich'))
    expect([...new Set(table.slice(1).map((row) => row[0]))]).toEqual([
      'Altes Rathaus',
      'Wohnanlage Birkenweg',
    ])
    // Named in the address, an area the person does not hold in narrows nothing and shows nothing.
    expect(
      (await tableOf('/properties/table', { area: estateSouth }, by('u-tech', estate)))
        .slice(1)
        .map((row) => row[0]),
    ).toEqual(['Altes Rathaus', 'Altes Rathaus', 'Wohnanlage Birkenweg', 'Wohnanlage Birkenweg'])
  })

  it('carries the numbers only for whoever may read the duties, each where its list may be read', async () => {
    const places = await tableOf('/properties/table', {}, holding(estate, 'location.read'))
    const withDuties = await tableOf(
      '/properties/table',
      {},
      holding(estate, 'location.read', 'duty.read'),
    )

    expect(places[0]).toEqual(['Liegenschaft', 'Gebäude', 'Adresse'])
    expect(places.slice(1).every((row) => row.length <= 3)).toBe(true)
    expect(withDuties[0]).toEqual([
      'Liegenschaft',
      'Gebäude',
      'Adresse',
      'Überfällig',
      'Fällig',
      'Nie erfasst',
    ])
  })

  it('is only for whoever reads places', async () => {
    const refused = await asked(
      '/properties/table',
      { format: 'csv' },
      holding(estate, 'asset.read'),
    )

    expect(refused.status).toBe(403)
    expect(JSON.parse(String(refused.body)).message).toBe(missingRight('location.read'))
  })

  it('holds nothing of the stamp of the last change, in neither format', async () => {
    const stamps = await stampsOf(estate)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/properties/table', {}, by('u-lead', estate), format)

      expect(table.length).toBeGreaterThan(5)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

// --- The lists that got their table with #236 ------------------------------------------------------

const today = dayInGermany()

/** Somebody with the rights of the Leitung in the small tenant, and exactly these. */
function leading(...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-lead', tenantId: small, roles: ['management'], rights })
}

/** A duty of the operator's own at an asset, with who answers for it and who performs it. */
async function dutyAt(
  asset: string,
  label: string,
  said: {
    readonly responsible?: string
    readonly performer?: 'own_staff' | 'contractor'
    readonly note?: string
  } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by, responsible_user_id, performer,
                         performer_note)
     select tenant_id, property_id, area_id, id, $2, 'own_decision', 'Hausordnung',
            'from_performance', 1, 'u-duties', $3, $4, $5
       from assets where id = $1
     returning id`,
    [asset, label, said.responsible ?? null, said.performer ?? null, said.note ?? null],
  )

  return rows[0]?.id ?? ''
}

/** An inspection for a duty, made by hand by the Technische Leitung as the engine would make it. */
async function activityFor(duty: string, tenantId: TenantId = small): Promise<string> {
  return (
    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({ dutyId: duty })
      .expect(201)
  ).body.id
}

/** A work order by hand at an asset, made by the Technische Leitung. */
async function orderAt(
  asset: string,
  title: string,
  tenantId: TenantId = small,
  more: object = {},
): Promise<string> {
  return (
    await http()
      .post('/work-orders')
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({
        title,
        kind: 'other',
        urgency: 'normal',
        dueOn: addDays(today, 10),
        responsibleUserId: 'u-tech',
        participantUserIds: [],
        origin: 'hand',
        assetId: asset,
        ...more,
      })
      .expect(201)
  ).body.id
}

/** A defect at an asset, found three days ago and reported by the Technische Leitung. */
async function defectAt(
  asset: string,
  description: string,
  tenantId: TenantId = small,
  more: object = {},
): Promise<string> {
  return (
    await http()
      .post('/defects')
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({ assetId: asset, description, foundOn: addDays(today, -3), ...more })
      .expect(201)
  ).body.id
}

/** A page of a list, two rows long, as the list reads it. */
async function pageOf<Page>(
  path: string,
  query: Readonly<Record<string, string>>,
  offset: number,
  header: string = by('u-lead'),
): Promise<Page> {
  return (
    await http()
      .get(path)
      .query({ ...query, limit: '2', offset: String(offset) })
      .set(testIdentityHeader, header)
      .expect(200)
  ).body as Page
}

/** A lift in a building of a property of its own, with the number the register gave it. */
async function liftIn(
  name: string,
  tenantId: TenantId = small,
  extra: object = {},
): Promise<{ readonly property: string; readonly asset: string; readonly number: string }> {
  const { property, building } = await propertyIn(tenantId, name, extra)
  const asset = await made(
    `/buildings/${building}/assets`,
    { ...elevator, name: `Aufzug ${name}` },
    tenantId,
  )
  const { rows } = await admin.query<{ number: string }>(
    'select number from assets where id = $1',
    [asset],
  )

  return { property, asset, number: rows[0]?.number ?? '' }
}

describe('the activities as a table (#236)', () => {
  const heads = [
    'Fällig am',
    'Überfällig',
    'Vorgang',
    'Art',
    'Anlage und Ort',
    'Verantwortlich',
    'Ausführend',
    'Stand',
  ]
  const withoutPeople = heads.filter((head) => head !== 'Verantwortlich')

  it('holds every activity the filter passes, in the order of the list, also beyond a page', async () => {
    const { property, asset } = await liftIn('Prüfschule Ost')

    for (const label of ['Türen prüfen', 'Notruf prüfen', 'Schacht prüfen']) {
      await activityFor(await dutyAt(asset, label))
    }

    const first = await pageOf<ActivityList>('/activities', { property }, 0)
    const second = await pageOf<ActivityList>('/activities', { property }, 2)
    // A page named in the address of a table is not what it holds.
    const table = await tableOf('/activities/table', { property, limit: '2' }, by('u-lead'))

    expect([first.total, first.more, first.activities.length]).toEqual([3, true, 2])
    expect(table.slice(1).map((row) => row[2])).toEqual(
      [...first.activities, ...second.activities].map((activity) => activity.title),
    )
  })

  it('names its columns and fills them as the list does, and the people only for the Leitung', async () => {
    const { property, asset, number } = await liftIn('Prüfschule West')
    const own = await activityFor(
      await dutyAt(asset, 'Türen im Fluchtweg prüfen', {
        responsible: 'u-tech',
        performer: 'own_staff',
      }),
    )

    await activityFor(
      await dutyAt(asset, 'Notruf prüfen', {
        responsible: 'u-duties',
        performer: 'contractor',
        note: 'Aufzugsdienst Beispiel GmbH',
      }),
    )
    await admin.query(`update activities set performer_user_id = 'u-tech' where id = $1`, [own])

    const list = await pageOf<ActivityList>('/activities', { property }, 0)
    const where = `${number} Aufzug Prüfschule West, Prüfschule West, Haus A`
    const dayOf = (title: string) => {
      const due = list.activities.find((activity) => activity.title === title)?.dueOn ?? null

      return { day: due === null ? '' : dayInWords(due), late: due !== null && due < today }
    }
    const kindOf = (title: string) =>
      list.activities.find((activity) => activity.title === title)?.kind ?? 'round'
    const row = (title: string, people: readonly string[], performer: string) => [
      dayOf(title).day,
      dayOf(title).late ? 'überfällig' : '',
      title,
      activityKindLabel[kindOf(title)],
      where,
      ...people,
      performer,
      'Offen',
    ]
    const titles = list.activities.map((activity) => activity.title)

    expect([...titles].sort()).toEqual(['Notruf prüfen', 'Türen im Fluchtweg prüfen'])

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await tableOf('/activities/table', { property }, by('u-lead'), format)).toEqual([
        heads,
        ...titles.map((title) =>
          title === 'Notruf prüfen'
            ? row(title, ['Tom Technik'], 'Aufzugsdienst Beispiel GmbH')
            : row(title, ['Hana Haus'], 'Hana Haus'),
        ),
      ])
      // Without the right of the staff: no column of who answers, and nobody who performs.
      expect(await tableOf('/activities/table', { property }, by('u-duties'), format)).toEqual([
        withoutPeople,
        ...titles.map((title) =>
          title === 'Notruf prüfen'
            ? row(title, [], 'Aufzugsdienst Beispiel GmbH')
            : // A cell that holds nothing is as empty as the one before the state.
              [...row(title, [], '').slice(0, 5), '', 'Offen'],
        ),
      ])
    }

    const nameless = await tableOf('/activities/table', { property }, by('u-duties'))

    expect(nameless.flat().join(' ')).not.toMatch(/Hana Haus|Tom Technik|Lena Leitung/)
  })

  it('narrows by what the list is narrowed by', async () => {
    const { property, asset } = await liftIn('Prüfschule Süd')

    await activityFor(await dutyAt(asset, 'Türen prüfen'))
    await activityFor(await dutyAt(asset, 'Notruf prüfen'))

    const titles = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/activities/table', { property, ...query }, by('u-lead')))
        .slice(1)
        .map((row) => row[2])

    expect(await titles({ search: 'notruf' })).toEqual(['Notruf prüfen'])
    expect(await titles({ kind: 'inspection' })).toEqual([])
    expect(await titles({ kind: 'maintenance' })).toHaveLength(2)
    expect(await titles({ state: 'done' })).toEqual([])
    expect((await titles({})).sort()).toEqual(['Notruf prüfen', 'Türen prüfen'])
  })

  it('holds no activity of an area the person does not see', async () => {
    const inNorth = await liftIn('Prüfhof Nord', large, { areaId: north })
    const inSouth = await liftIn('Prüfhof Süd', large, { areaId: south })

    await activityFor(await dutyAt(inNorth.asset, 'Nordtür prüfen'), large)
    await activityFor(await dutyAt(inSouth.asset, 'Südtür prüfen'), large)

    const titles = async (header: string, query: Readonly<Record<string, string>> = {}) =>
      (await tableOf('/activities/table', query, header)).slice(1).map((row) => row[2])

    expect(await titles(by('u-tech', large))).toEqual(['Nordtür prüfen'])
    expect((await titles(by('u-lead', large))).sort()).toEqual(['Nordtür prüfen', 'Südtür prüfen'])
    // Named in the address, the other area gives nothing either.
    expect(await titles(by('u-tech', large), { area: south })).toEqual([])
    expect(await titles(by('u-tech', large), { property: inSouth.property })).toEqual([])
  })

  it('is only for whoever reads activities', async () => {
    expect(await refusalOf('/activities/table', {}, holding(small, 'location.read'))).toEqual({
      status: 403,
      message: missingRight('activity.read'),
    })
  })

  it('names the place and the asset only for whoever reads them as well', async () => {
    const { property, asset, number } = await liftIn('Prüfschule Nord')

    await activityFor(await dutyAt(asset, 'Türen prüfen'))

    const where = async (...rights: Right[]) =>
      (
        await tableOf('/activities/table', { property }, leading('activity.read', ...rights))
      )[1]?.[4]

    expect(await where()).toBe('Anlage, Liegenschaft')
    expect(await where('asset.read')).toBe(`${number} Aufzug Prüfschule Nord, Liegenschaft`)
    expect(await where('location.read')).toBe('Anlage, Prüfschule Nord, Haus A')
    expect(await where('asset.read', 'location.read')).toBe(
      `${number} Aufzug Prüfschule Nord, Prüfschule Nord, Haus A`,
    )
  })

  it('writes a title that begins like a formula so that no spreadsheet runs it', async () => {
    const { property, asset } = await liftIn('Prüfschule Formel')

    await activityFor(await dutyAt(asset, '=HYPERLINK("http://x.example")'))

    const csv = await rawOf('/activities/table', { property }, by('u-lead'), 'csv')
    const sheet = await rawOf('/activities/table', { property }, by('u-lead'), 'xlsx')

    expect(csv).toContain(`;"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const { property, asset } = await liftIn('Prüfschule Stempel')
    const activity = await activityFor(await dutyAt(asset, 'Türen prüfen'))

    // Due on a day that is not the one of its last change.
    await admin.query(`update activities set due_on = $2 where id = $1`, [
      activity,
      addDays(today, 40),
    ])

    const stamps = await stampsOf(small, 'activities', 'duties')

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/activities/table', { property }, by('u-lead'), format)

      expect(table).toHaveLength(2)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the work orders as a table (#236)', () => {
  const heads = [
    'Nummer',
    'Auftrag',
    'Art',
    'Ort oder Anlage',
    'Dringlichkeit',
    'Frist',
    'Überschritten',
    'Verantwortlich',
    'Stand',
  ]
  const withoutPeople = heads.filter((head) => head !== 'Verantwortlich')

  it('holds every order the filter passes, in the order of the list, also beyond a page', async () => {
    const { asset } = await liftIn('Auftragshaus Ost')

    for (const title of ['Tür richten', 'Licht tauschen', 'Schild anbringen']) {
      await orderAt(asset, title)
    }

    const first = await pageOf<WorkOrderList>('/work-orders', { asset }, 0)
    const second = await pageOf<WorkOrderList>('/work-orders', { asset }, 2)
    const table = await tableOf('/work-orders/table', { asset, limit: '2' }, by('u-lead'))

    expect([first.total, first.more, first.orders.length]).toEqual([3, true, 2])
    expect(table.slice(1).map((row) => row[1])).toEqual(
      [...first.orders, ...second.orders].map((order) => order.title),
    )
  })

  it('names its columns and fills them as the list does, and who answers only for the Leitung', async () => {
    const { asset, number } = await liftIn('Auftragshaus West')

    await orderAt(asset, 'Tür richten', small, { kind: 'fault', urgency: 'immediate' })

    const { orders } = await pageOf<WorkOrderList>('/work-orders', { asset }, 0)
    const row = (people: readonly string[]) => [
      orders[0]?.number ?? '',
      'Tür richten',
      'Störung',
      `${number} Aufzug Auftragshaus West, Auftragshaus West, Haus A`,
      'sofort',
      dayInWords(addDays(today, 10)),
      '',
      ...people,
      'Offen',
    ]

    expect(orders[0]?.number).toMatch(/\d/)

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await tableOf('/work-orders/table', { asset }, by('u-lead'), format)).toEqual([
        heads,
        row(['Hana Haus']),
      ])
      expect(await tableOf('/work-orders/table', { asset }, by('u-duties'), format)).toEqual([
        withoutPeople,
        row([]),
      ])
    }
  })

  it('says that an order is past its day in a column of its own', async () => {
    const { asset } = await liftIn('Auftragshaus Spät')
    const order = await orderAt(asset, 'Tür richten')

    await admin.query(`update activities set due_on = $2 where id = $1`, [
      order,
      addDays(today, -2),
    ])

    const [, row] = await tableOf('/work-orders/table', { asset }, by('u-duties'))

    expect(row?.slice(5, 7)).toEqual([dayInWords(addDays(today, -2)), 'überschritten'])
  })

  it('narrows by what the list is narrowed by', async () => {
    const { asset } = await liftIn('Auftragshaus Süd')

    await orderAt(asset, 'Tür richten', small, { kind: 'fault' })
    await orderAt(asset, 'Licht tauschen')

    const titles = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/work-orders/table', { asset, ...query }, by('u-lead')))
        .slice(1)
        .map((row) => row[1])

    expect(await titles({ kind: 'fault' })).toEqual(['Tür richten'])
    expect(await titles({ search: 'licht' })).toEqual(['Licht tauschen'])
    expect(await titles({ state: 'accepted' })).toEqual([])
  })

  it('holds no order of an area the person does not see', async () => {
    const inNorth = await liftIn('Auftragshof Nord', large, { areaId: north })
    const inSouth = await liftIn('Auftragshof Süd', large, { areaId: south })

    await orderAt(inNorth.asset, 'Nordtür richten', large)
    await orderAt(inSouth.asset, 'Südtür richten', large, { responsibleUserId: 'u-duties' })

    const titles = async (header: string, query: Readonly<Record<string, string>> = {}) =>
      (await tableOf('/work-orders/table', query, header)).slice(1).map((row) => row[1])

    expect(await titles(by('u-tech', large))).toEqual(['Nordtür richten'])
    expect((await titles(by('u-lead', large))).sort()).toEqual([
      'Nordtür richten',
      'Südtür richten',
    ])
    expect(await titles(by('u-tech', large), { area: south })).toEqual([])
    expect(await titles(by('u-tech', large), { asset: inSouth.asset })).toEqual([])
  })

  it('is only for whoever reads activities', async () => {
    expect(await refusalOf('/work-orders/table', {}, holding(small, 'defect.read'))).toEqual({
      status: 403,
      message: missingRight('activity.read'),
    })
  })

  it('names the place and the asset only for whoever reads them as well', async () => {
    const { asset, number } = await liftIn('Auftragshaus Nord')

    await orderAt(asset, 'Tür richten')

    const where = async (...rights: Right[]) =>
      (
        await tableOf(
          '/work-orders/table',
          { asset },
          leading('activity.read', 'activity.write', ...rights),
        )
      )[1]?.[3]

    expect(await where()).toBe('Anlage, Liegenschaft')
    expect(await where('asset.read')).toBe(`${number} Aufzug Auftragshaus Nord, Liegenschaft`)
    expect(await where('location.read')).toBe('Anlage, Auftragshaus Nord, Haus A')
  })

  it('writes a title that begins like a formula so that no spreadsheet runs it', async () => {
    const { asset } = await liftIn('Auftragshaus Formel')

    await orderAt(asset, '=HYPERLINK("http://x.example")')

    const csv = await rawOf('/work-orders/table', { asset }, by('u-lead'), 'csv')
    const sheet = await rawOf('/work-orders/table', { asset }, by('u-lead'), 'xlsx')

    expect(csv).toContain(`;"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const { asset } = await liftIn('Auftragshaus Stempel')

    await orderAt(asset, 'Tür richten')

    const stamps = await stampsOf(small, 'activities', 'work_orders')

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/work-orders/table', { asset }, by('u-lead'), format)

      expect(table).toHaveLength(2)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the defects as a table (#236)', () => {
  const heads = [
    'Mangel',
    'Anlage oder Ort',
    'Klasse',
    'Frist',
    'Über der Frist',
    'Stand',
    'Herkunft',
    'Festgestellt am',
    'Auftrag',
  ]

  it('holds every defect the filter passes, in the order of the list, also beyond a page', async () => {
    const { asset } = await liftIn('Mangelhaus Ost')

    for (const description of ['Tür klemmt', 'Licht flackert', 'Schild fehlt']) {
      await defectAt(asset, description)
    }

    const first = await pageOf<DefectRegister>('/defects', { assetId: asset }, 0)
    const second = await pageOf<DefectRegister>('/defects', { assetId: asset }, 2)
    const table = await tableOf('/defects/table', { assetId: asset, limit: '2' }, by('u-lead'))

    expect([first.total, first.more, first.defects.length]).toEqual([3, true, 2])
    expect(table.slice(1).map((row) => row[0])).toEqual(
      [...first.defects, ...second.defects].map((defect) => defect.description),
    )
  })

  it('names its columns and fills them as the list does, with its class, its day and its order', async () => {
    const { asset, number } = await liftIn('Mangelhaus West')
    const late = await defectAt(asset, 'Tür klemmt')

    await defectAt(asset, 'Licht flackert')
    await http()
      .patch(`/defects/${late}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ defectClass: 'allgemein.minor', dueOn: addDays(today, -1) })
      .expect(200)

    const order = await orderAt(asset, 'Tür richten', small, {
      kind: 'defect_remedy',
      origin: 'defect',
      defectId: late,
      assetId: undefined,
    })
    const { rows } = await admin.query<{ number: string }>(
      'select number from work_orders where activity_id = $1',
      [order],
    )
    const where = `${number} Aufzug Mangelhaus West, Mangelhaus West, Haus A`
    const found = dayInWords(addDays(today, -3))
    const minor = catalogue.defectClass('allgemein.minor')?.defectClass.label ?? ''

    expect(minor).not.toBe('')

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/defects/table', { assetId: asset }, by('u-lead'), format)

      expect(table[0]).toEqual(heads)
      expect(
        table.slice(1).sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      ).toEqual([
        [
          'Licht flackert',
          where,
          'ohne Klasse',
          '',
          '',
          'Festgestellt',
          'von Hand',
          found,
          'keiner',
        ],
        [
          'Tür klemmt',
          where,
          minor,
          dayInWords(addDays(today, -1)),
          'über der Frist',
          'Beauftragt',
          'von Hand',
          found,
          rows[0]?.number ?? '',
        ],
      ])
    }
  })

  it('narrows by what the list is narrowed by', async () => {
    const { asset } = await liftIn('Mangelhaus Süd')
    const classed = await defectAt(asset, 'Tür klemmt')

    await defectAt(asset, 'Licht flackert')
    await http()
      .patch(`/defects/${classed}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ defectClass: 'allgemein.minor' })
      .expect(200)

    const found = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/defects/table', { assetId: asset, ...query }, by('u-lead')))
        .slice(1)
        .map((row) => row[0])

    expect(await found({ defectClass: 'allgemein.minor' })).toEqual(['Tür klemmt'])
    expect(await found({ state: 'verified' })).toEqual([])
    expect((await found({})).sort()).toEqual(['Licht flackert', 'Tür klemmt'])
  })

  it('holds no defect of an area the person does not see', async () => {
    const inNorth = await liftIn('Mangelhof Nord', large, { areaId: north })
    const inSouth = await liftIn('Mangelhof Süd', large, { areaId: south })

    await defectAt(inNorth.asset, 'Nordtür klemmt', large)
    await defectAt(inSouth.asset, 'Südtür klemmt', large)

    const found = async (header: string, query: Readonly<Record<string, string>> = {}) =>
      (await tableOf('/defects/table', query, header)).slice(1).map((row) => row[0])

    expect(await found(by('u-tech', large))).toEqual(['Nordtür klemmt'])
    expect((await found(by('u-lead', large))).sort()).toEqual(['Nordtür klemmt', 'Südtür klemmt'])
    expect(await found(by('u-tech', large), { areaId: south })).toEqual([])
    expect(await found(by('u-tech', large), { assetId: inSouth.asset })).toEqual([])
  })

  it('is only for whoever reads defects', async () => {
    expect(await refusalOf('/defects/table', {}, holding(small, 'activity.read'))).toEqual({
      status: 403,
      message: missingRight('defect.read'),
    })
  })

  it('names the place, the asset and the order only for whoever reads them as well', async () => {
    const { asset, number } = await liftIn('Mangelhaus Nord')
    const defect = await defectAt(asset, 'Tür klemmt')

    await orderAt(asset, 'Tür richten', small, {
      kind: 'defect_remedy',
      origin: 'defect',
      defectId: defect,
      assetId: undefined,
    })

    const cells = async (...rights: Right[]) => {
      const [, row] = await tableOf(
        '/defects/table',
        { assetId: asset },
        leading('defect.read', ...rights),
      )

      return [row?.[1], row?.[8] ?? '']
    }

    expect(await cells()).toEqual(['Anlage, Liegenschaft', ''])
    expect(await cells('asset.read')).toEqual([
      `${number} Aufzug Mangelhaus Nord, Liegenschaft`,
      '',
    ])
    expect(await cells('location.read')).toEqual(['Anlage, Mangelhaus Nord, Haus A', ''])
    expect((await cells('activity.read'))[1]).toMatch(/\d/)
  })

  it('writes what was found so that no spreadsheet runs it where it begins like a formula', async () => {
    const { asset } = await liftIn('Mangelhaus Formel')

    await defectAt(asset, '=HYPERLINK("http://x.example")')

    const csv = await rawOf('/defects/table', { assetId: asset }, by('u-lead'), 'csv')
    const sheet = await rawOf('/defects/table', { assetId: asset }, by('u-lead'), 'xlsx')

    expect(csv).toContain(`"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const { asset } = await liftIn('Mangelhaus Stempel')

    await defectAt(asset, 'Tür klemmt')

    const stamps = await stampsOf(small, 'defects')

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/defects/table', { assetId: asset }, by('u-lead'), format)

      expect(table).toHaveLength(2)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the classes of defects as a table (#236)', () => {
  it('holds every class of the packages as the list shows it, with the days the operator set', async () => {
    await http()
      .put('/settings/defect-classes/allgemein.minor')
      .set(testIdentityHeader, by('u-lead'))
      .send({ dueDays: 30 })
      .expect(200)

    const listed = (
      await http().get('/settings/defect-classes').set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as readonly DefectClassSetting[]

    expect(listed.length).toBeGreaterThan(2)
    expect(listed.some((setting) => setting.unsafe)).toBe(true)

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await tableOf('/settings/defect-classes/table', {}, by('u-lead'), format)).toEqual([
        ['Klasse', 'Wirkung', 'Vorgabe der Frist', 'Woher'],
        ...listed.map((setting) => [
          setting.label,
          setting.unsafe ? 'macht die Anlage unsicher' : 'die Anlage bleibt in Betrieb',
          setting.key === 'allgemein.minor' ? '30' : '',
          setting.packageTitle,
        ]),
      ])
    }
  })

  it('is only for whoever sees the settings', async () => {
    expect(
      await refusalOf('/settings/defect-classes/table', {}, holding(small, 'defect.read')),
    ).toEqual({ status: 403, message: missingRight('settings.read') })
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    // What an operator set for a class carries no person, only the day it was set.
    const { rows } = await admin.query<{ changed: string }>(
      `select to_char(updated_at at time zone 'Europe/Berlin', 'YYYY-MM-DD') as changed
         from defect_class_terms where tenant_id = $1`,
      [small],
    )
    const stamps = [todayInWords(), today]

    expect(rows.map((row) => row.changed)).toEqual([today])

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/settings/defect-classes/table', {}, by('u-lead'), format)

      expect(table.length).toBeGreaterThan(2)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})
