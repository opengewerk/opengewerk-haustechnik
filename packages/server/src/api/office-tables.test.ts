import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type AssetRegister,
  assetRegisterPage,
  catalogueOf,
  missingRight,
  type Right,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId, tableFileOf, unzip } from '@opengewerk/platform-server'
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

/** The bytes of an answer, as a browser saves them. */
function asked(path: string, query: Readonly<Record<string, string>>, header: string) {
  return http()
    .get(path)
    .query(query)
    .set(testIdentityHeader, header)
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        done(null, Buffer.concat(chunks))
      })
    })
}

type Format = 'xlsx' | 'csv'

/** The table at the address as its rows, read by the reader of the foundation; the header first. */
async function tableOf(
  path: string,
  query: Readonly<Record<string, string>>,
  header: string,
  format: Format = 'xlsx',
): Promise<string[][]> {
  const answer = await asked(path, { ...query, format }, header).expect(200)
  const sheets = tableFileOf(new Uint8Array(answer.body as Buffer), `Liste.${format}`).sheets

  return sheets[0]?.rows.map((row) => [...row]) ?? []
}

/** The raw text of a table: the sheet of a workbook, or the file of separated values. */
async function rawOf(
  path: string,
  query: Readonly<Record<string, string>>,
  header: string,
  format: Format,
): Promise<string> {
  const bytes = new Uint8Array(
    (await asked(path, { ...query, format }, header).expect(200)).body as Buffer,
  )

  return format === 'csv'
    ? new TextDecoder().decode(bytes)
    : new TextDecoder().decode(
        unzip(bytes, 50_000_000).find((entry) => entry.path === 'xl/worksheets/sheet1.xml')?.bytes,
      )
}

/** A page of the register as the list reads it. */
async function register(
  query: Readonly<Record<string, string>>,
  header: string = by('u-tech'),
): Promise<AssetRegister> {
  return (await http().get('/assets').query(query).set(testIdentityHeader, header).expect(200)).body
}

/**
 * Whatever of the stamp of the last change a table could carry: who changed
 * a record of the kinds it reads, from which device, and the day it was
 * changed, as a list writes a day and as a program does.
 */
async function stampsOf(tenantId: TenantId): Promise<string[]> {
  const { rows } = await admin.query<{ updated_by: string | null; device_id: string | null }>(
    `select updated_by, device_id from properties where tenant_id = $1
     union select updated_by, device_id from buildings where tenant_id = $1
     union select updated_by, device_id from assets where tenant_id = $1`,
    [tenantId],
  )
  const [year, month, day] = dayInGermany().split('-')

  return [
    ...new Set(
      rows.flatMap((row) => [row.updated_by, row.device_id]).filter((value) => value !== null),
    ),
    `${day ?? ''}.${month ?? ''}.${year ?? ''}`,
    dayInGermany(),
  ] as string[]
}

/** The cells of a table that hold a part of the stamp, and the columns that are named for one. */
function stampIn(rows: readonly (readonly string[])[], stamps: readonly string[]): string[] {
  const named = /geändert|gerät|updated|device|stempel/i

  return [
    ...(rows[0] ?? []).filter((column) => named.test(column)),
    ...rows.flat().filter((cell) => stamps.some((stamp) => cell.includes(stamp))),
  ]
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

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
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
