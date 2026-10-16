import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  dayInWords,
  documentKindLabel,
  type DutyProposals,
  type DutyRegister,
  dutyTableWords,
  evidenceRegisterColumns,
  evidenceRegisterWords,
  type IsoDate,
  type MeterList,
  meterMediumLabel,
  meterStateLabel,
  missingRight,
  type Right,
  type RoleKey,
  type RoundWeek,
  shippedRoles,
  type TenantId,
  weekNamed,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import type { TemplateRounds } from './round-templates.controller.js'
import { as, testIdentities } from './test-identity.js'
import { stampIn, stampsOf, tableReaders } from './test-tables.js'

/**
 * The rest of the lists of the office as tables (#236, section 3 of the
 * concept), beside those of `office-tables.test.ts`: the meters, the register
 * of duties and the proposals of the catalogue. Each holds what its list
 * shows under its filter, whole, under the rights and in the areas of the
 * person asking; a place and an asset by their names only for whoever reads
 * them, a person only for whoever may see the staff, and nothing of the stamp
 * of the last change (#157).
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
/** Two areas, north and south, for the table of the areas and nothing else. */
const estate = newId<'tenant'>() as TenantId
let north = ''
let south = ''
let estateNorth = ''
let estateSouth = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Lena Leitung' },
  'u-duties': { role: 'technical_management', name: 'Tom Technik' },
  'u-tech': { role: 'technician', name: 'Hana Haus' },
}

type Person = keyof typeof people & string

/** The packages of the application beside the one of the tests. */
const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
})
const today = dayInGermany()

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

const { tableOf, rawOf, refusalOf } = tableReaders(http)

/** A request header for one of the people, in one of the tenants. */
function by(userId: Person, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** Somebody with the role of the Leitung in the small tenant, and exactly these rights. */
function leading(...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-lead', tenantId: small, roles: ['management'], rights })
}

/** Made through its route by the Technische Leitung, which keeps the places and the assets. */
async function made(path: string, body: object, tenantId: TenantId = small): Promise<string> {
  return (
    await http().post(path).set(testIdentityHeader, by('u-duties', tenantId)).send(body).expect(201)
  ).body.id
}

/** A property with a building "Haus A" on it. */
async function propertyIn(
  name: string,
  tenantId: TenantId = small,
  extra: object = {},
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
      { name: 'Haus A', kinds: ['school'] },
      tenantId,
    ),
  }
}

/** A lift in a building of a property of its own, with the number the register gave it. */
async function liftIn(
  name: string,
  tenantId: TenantId = small,
  extra: object = {},
): Promise<{ readonly property: string; readonly asset: string; readonly number: string }> {
  const { property, building } = await propertyIn(name, tenantId, extra)
  const asset = await made(
    `/buildings/${building}/assets`,
    { kind: 'probe.elevator', name: `Aufzug ${name}` },
    tenantId,
  )
  const { rows } = await admin.query<{ number: string }>(
    'select number from assets where id = $1',
    [asset],
  )

  return { property, asset, number: rows[0]?.number ?? '' }
}

/** A water meter in a building, by its name and the number of its meter. */
async function meterIn(
  building: string,
  name: string,
  meterNumber: string,
  tenantId: TenantId = small,
): Promise<string> {
  return made(
    `/buildings/${building}/assets`,
    { kind: 'probe.water_meter', name, meterNumber, meterUnit: 'cubic_metres' },
    tenantId,
  )
}

/** A duty of the operator's own at an asset, with who answers for it and who performs it. */
async function dutyAt(
  asset: string,
  label: string,
  said: {
    readonly responsible?: string
    readonly performer?: 'own_staff' | 'contractor'
    readonly note?: string
    readonly endsOn?: string
  } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by, responsible_user_id, performer,
                         performer_note, ends_on)
     select tenant_id, property_id, area_id, id, $2, 'own_decision', 'Hausordnung',
            'from_performance', 1, 'u-duties', $3, $4, $5, $6
       from assets where id = $1
     returning id`,
    [
      asset,
      label,
      said.responsible ?? null,
      said.performer ?? null,
      said.note ?? null,
      said.endsOn ?? null,
    ],
  )

  return rows[0]?.id ?? ''
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

  // The roles as rows, with the rights each ships with, as a real operator has them.
  for (const tenantId of [small, large, estate]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

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

  for (const [userId, person] of Object.entries(people)) {
    // Called by a name that is not the id, which is what a stamp would hold.
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large, estate]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
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

describe('the meters as a table (#236)', () => {
  const heads = [
    'Messstelle',
    'Hauptzähler',
    'Ort',
    'Medium',
    'Einheit',
    'Zählernummer',
    'Letzter Stand',
    'Abgelesen am',
    'Stand zum Stichtag',
  ]

  /** The list as the screen reads it. */
  async function listed(query: Readonly<Record<string, string>>): Promise<MeterList> {
    return (
      await http().get('/meters').query(query).set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as MeterList
  }

  /** A main meter with a reading and a sub meter under it, in a property of their own. */
  async function twoMeters(name: string, numbers: string, tenantId: TenantId = small) {
    const { property, building } = await propertyIn(name, tenantId)
    const main = await meterIn(building, 'Hauptzähler Wasser', `9WAT${numbers}1`, tenantId)
    const sub = await meterIn(building, 'Zähler Küche', `9WAT${numbers}2`, tenantId)

    await http()
      .put(`/meters/${sub}`)
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({ mainMeterId: main })
      .expect(200)
    await http()
      .post(`/meters/${main}/readings`)
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({ readOn: addDays(today, -5), valueMilli: 4_812_500 })
      .expect(201)

    return { property, main, sub }
  }

  it('holds the measuring points the list shows, a sub meter under its main meter, with its columns', async () => {
    const { property, main } = await twoMeters('Zählerhaus West', '10000')
    const list = await listed({ property })
    const stateOf = (id: string) =>
      meterStateLabel[list.meters.find((meter) => meter.assetId === id)?.state ?? 'missing']
    const medium = list.meters[0]?.medium ?? null

    expect(list.meters.map((meter) => meter.name).sort()).toEqual([
      'Hauptzähler Wasser',
      'Zähler Küche',
    ])

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/meters/table', { property }, by('u-lead'), format)

      expect(table).toEqual([
        heads,
        [
          'Hauptzähler Wasser',
          '',
          'Zählerhaus West, Haus A',
          medium === null ? '' : meterMediumLabel[medium],
          'm³',
          '9WAT100001',
          '4812,5',
          dayInWords(addDays(today, -5)),
          stateOf(main),
        ],
        [
          'Zähler Küche',
          'Hauptzähler Wasser',
          'Zählerhaus West, Haus A',
          medium === null ? '' : meterMediumLabel[medium],
          'm³',
          '9WAT100002',
          '',
          '',
          'fehlt',
        ],
      ])
    }
  })

  it('narrows by what the list is narrowed by', async () => {
    const { property } = await twoMeters('Zählerhaus Süd', '20000')
    const names = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/meters/table', { property, ...query }, by('u-lead')))
        .slice(1)
        .map((row) => row[0])
    const list = await listed({ property, state: 'missing' })

    expect(await names({ state: 'missing' })).toEqual(list.meters.map((meter) => meter.name))
    expect(await names({ state: 'locked' })).toEqual([])
    expect(await names({ medium: 'gas' })).toEqual([])
    expect(await names({})).toHaveLength(2)
  })

  it('holds no measuring point of an area the person does not see', async () => {
    const inNorth = await propertyIn('Zählerhof Nord', large, { areaId: north })
    const inSouth = await propertyIn('Zählerhof Süd', large, { areaId: south })

    await meterIn(inNorth.building, 'Zähler Nord', '9WAT900001', large)
    await meterIn(inSouth.building, 'Zähler Süd', '9WAT900002', large)

    const names = async (header: string, query: Readonly<Record<string, string>> = {}) =>
      (await tableOf('/meters/table', query, header)).slice(1).map((row) => row[0])

    expect(await names(by('u-tech', large))).toEqual(['Zähler Nord'])
    expect((await names(by('u-lead', large))).sort()).toEqual(['Zähler Nord', 'Zähler Süd'])
    // Named in the address, the other area gives nothing either.
    expect(await names(by('u-tech', large), { property: inSouth.property })).toEqual([])
  })

  it('is only for whoever reads assets', async () => {
    expect(await refusalOf('/meters/table', {}, leading('location.read'))).toEqual({
      status: 403,
      message: missingRight('asset.read'),
    })
  })

  it('names the place only for whoever reads places as well', async () => {
    const { property } = await twoMeters('Zählerhaus Nord', '30000')
    const places = async (...rights: Right[]) =>
      (await tableOf('/meters/table', { property }, leading('asset.read', ...rights)))
        .slice(1)
        .map((row) => row[2])

    expect(await places()).toEqual(['', ''])
    expect(await places('location.read')).toEqual([
      'Zählerhaus Nord, Haus A',
      'Zählerhaus Nord, Haus A',
    ])
  })

  it('writes a name that begins like a formula so that no spreadsheet runs it', async () => {
    const { property, building } = await propertyIn('Zählerhaus Formel')

    await meterIn(building, '=HYPERLINK("http://x.example")', '9WAT700001')

    const csv = await rawOf('/meters/table', { property }, by('u-lead'), 'csv')
    const sheet = await rawOf('/meters/table', { property }, by('u-lead'), 'xlsx')

    expect(csv).toContain(`"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const { property } = await twoMeters('Zählerhaus Stempel', '40000')
    const stamps = await stampsOf(admin, small, [
      'properties',
      'buildings',
      'assets',
      'meter_readings',
    ])

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/meters/table', { property }, by('u-lead'), format)

      expect(table).toHaveLength(3)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the register of duties as a table (#236)', () => {
  const heads = [
    'Anlage oder Ort',
    'Pflicht',
    'Grundlage',
    'Frist',
    'Art der Frist',
    'Frist prüfen',
    'Zuständig',
    'Ausführung',
    'Letzter Nachweis',
    'Nachweis vom',
    'Nächster Termin',
    'Zustand',
  ]
  const withoutPeople = heads.filter((head) => head !== 'Zuständig')

  /** A page of the register, two duties long. */
  async function pageOf(
    query: Readonly<Record<string, string>>,
    offset: number,
  ): Promise<DutyRegister> {
    return (
      await http()
        .get('/duties/register')
        .query({ ...query, limit: '2', offset: String(offset) })
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as DutyRegister
  }

  it('holds every duty the filter passes, in the order of the register, also beyond a page', async () => {
    const { property, asset } = await liftIn('Pflichthaus Ost')

    for (const label of ['Türen prüfen', 'Notruf prüfen', 'Schacht prüfen']) {
      await dutyAt(asset, label)
    }

    const first = await pageOf({ propertyId: property }, 0)
    const second = await pageOf({ propertyId: property }, 2)
    // A page named in the address of a table is not what it holds.
    const table = await tableOf(
      '/duties/register/table',
      { propertyId: property, limit: '2' },
      by('u-lead'),
    )

    expect([first.total, first.more, first.duties.length]).toEqual([3, true, 2])
    expect(table.slice(1).map((row) => row[1])).toEqual(
      [...first.duties, ...second.duties].map((duty) => duty.title),
    )
  })

  it('names its columns and fills them as the register does, and who answers only for the Leitung', async () => {
    const { property, asset, number } = await liftIn('Pflichthaus West')

    await dutyAt(asset, 'Türen im Fluchtweg prüfen', {
      responsible: 'u-tech',
      performer: 'contractor',
      note: 'Aufzugsdienst Beispiel GmbH',
    })
    await dutyAt(asset, 'Notruf prüfen', { performer: 'own_staff' })

    const { duties } = await pageOf({ propertyId: property }, 0)
    const where = `${number} Aufzug Pflichthaus West, Pflichthaus West, Haus A`
    const next = (title: string) => {
      const due = duties.find((duty) => duty.title === title)?.appointment?.dueOn ?? null

      return due === null ? '' : dayInWords(due)
    }
    const row = (title: string, people: readonly string[], performer: string) => [
      where,
      title,
      'Eigene Festlegung, Hausordnung',
      '1 Monat',
      'Eigene Pflicht',
      '',
      ...people,
      performer,
      'keiner',
      '',
      next(title),
      'Nie erfasst',
    ]
    const titles = duties.map((duty) => duty.title)

    expect([...titles].sort()).toEqual(['Notruf prüfen', 'Türen im Fluchtweg prüfen'])

    for (const format of ['xlsx', 'csv'] as const) {
      expect(
        await tableOf('/duties/register/table', { propertyId: property }, by('u-lead'), format),
      ).toEqual([
        heads,
        ...titles.map((title) =>
          title === 'Notruf prüfen'
            ? row(title, ['Niemand benannt'], 'Eigene Leute')
            : row(title, ['Hana Haus'], 'Aufzugsdienst Beispiel GmbH'),
        ),
      ])
      // Without the right of the staff the column of who answers is not there.
      expect(
        await tableOf('/duties/register/table', { propertyId: property }, by('u-duties'), format),
      ).toEqual([
        withoutPeople,
        ...titles.map((title) =>
          title === 'Notruf prüfen'
            ? row(title, [], 'Eigene Leute')
            : row(title, [], 'Aufzugsdienst Beispiel GmbH'),
        ),
      ])
    }

    const nameless = await tableOf(
      '/duties/register/table',
      { propertyId: property },
      by('u-duties'),
    )

    expect(nameless.flat().join(' ')).not.toMatch(/Hana Haus|Tom Technik|Lena Leitung/)
  })

  it('narrowed to a person, is a table only for whoever may see the staff', async () => {
    const { property, asset } = await liftIn('Pflichthaus Person')

    await dutyAt(asset, 'Türen prüfen', { responsible: 'u-tech' })
    await dutyAt(asset, 'Notruf prüfen')

    const query = { propertyId: property, responsible: 'u-tech' }

    // Whoever keeps the register narrows the list to a person, and takes no table of it away.
    await http()
      .get('/duties/register')
      .query(query)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
    expect(await refusalOf('/duties/register/table', query, by('u-duties'))).toEqual({
      status: 403,
      message: dutyTableWords.narrowedToAPerson,
    })
    expect(await refusalOf('/duties/register/table', query, by('u-tech'))).toEqual({
      status: 403,
      message: missingRight('duty.write'),
    })
    expect(
      (await tableOf('/duties/register/table', query, by('u-lead'))).slice(1).map((row) => row[1]),
    ).toEqual(['Türen prüfen'])
    // Nobody is no person: the duties without one go out for everybody who reads the register.
    expect(
      (
        await tableOf(
          '/duties/register/table',
          { propertyId: property, responsible: 'none' },
          by('u-tech'),
        )
      )
        .slice(1)
        .map((row) => row[1]),
    ).toEqual(['Notruf prüfen'])
  })

  it('narrows by what the register is narrowed by', async () => {
    const { property, asset } = await liftIn('Pflichthaus Süd')

    await dutyAt(asset, 'Türen prüfen')
    await dutyAt(asset, 'Notruf prüfen', { endsOn: addDays(today, -30) })

    const titles = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/duties/register/table', { propertyId: property, ...query }, by('u-lead')))
        .slice(1)
        .map((row) => row[1])

    expect(await titles({})).toEqual(['Türen prüfen'])
    expect(await titles({ state: 'ended' })).toEqual(['Notruf prüfen'])
    expect(await titles({ state: 'met' })).toEqual([])
    expect(await titles({ assetKind: 'probe.water_meter' })).toEqual([])
  })

  it('holds no duty of an area the person does not see', async () => {
    const inNorth = await liftIn('Pflichthof Nord', large, { areaId: north })
    const inSouth = await liftIn('Pflichthof Süd', large, { areaId: south })

    await dutyAt(inNorth.asset, 'Nordtür prüfen')
    await dutyAt(inSouth.asset, 'Südtür prüfen')

    const titles = async (header: string, query: Readonly<Record<string, string>> = {}) =>
      (await tableOf('/duties/register/table', query, header)).slice(1).map((row) => row[1])

    expect(await titles(by('u-tech', large))).toEqual(['Nordtür prüfen'])
    expect((await titles(by('u-lead', large))).sort()).toEqual(['Nordtür prüfen', 'Südtür prüfen'])
    // Named in the address, the other area gives nothing either.
    expect(await titles(by('u-tech', large), { areaId: south })).toEqual([])
    expect(await titles(by('u-tech', large), { propertyId: inSouth.property })).toEqual([])
  })

  it('is only for whoever reads duties', async () => {
    expect(await refusalOf('/duties/register/table', {}, leading('asset.read'))).toEqual({
      status: 403,
      message: missingRight('duty.read'),
    })
  })

  it('names the place and the asset only for whoever reads them as well', async () => {
    const { property, asset, number } = await liftIn('Pflichthaus Nord')

    await dutyAt(asset, 'Türen prüfen')

    const where = async (...rights: Right[]) =>
      (
        await tableOf(
          '/duties/register/table',
          { propertyId: property },
          leading('duty.read', ...rights),
        )
      )[1]?.[0]

    expect(await where()).toBe('Anlage, Liegenschaft')
    expect(await where('asset.read')).toBe(`${number} Aufzug Pflichthaus Nord, Liegenschaft`)
    expect(await where('location.read')).toBe('Anlage, Pflichthaus Nord, Haus A')
    expect(await where('asset.read', 'location.read')).toBe(
      `${number} Aufzug Pflichthaus Nord, Pflichthaus Nord, Haus A`,
    )
  })

  it('writes a duty that begins like a formula so that no spreadsheet runs it', async () => {
    const { property, asset } = await liftIn('Pflichthaus Formel')

    await dutyAt(asset, '=HYPERLINK("http://x.example")')

    const csv = await rawOf('/duties/register/table', { propertyId: property }, by('u-lead'), 'csv')
    const sheet = await rawOf(
      '/duties/register/table',
      { propertyId: property },
      by('u-lead'),
      'xlsx',
    )

    expect(csv).toContain(`;"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const { property, asset } = await liftIn('Pflichthaus Stempel')

    // Ended a month ago, so that no day of its own is the day of its last change.
    await dutyAt(asset, 'Türen prüfen', { responsible: 'u-tech', endsOn: addDays(today, -30) })

    const stamps = await stampsOf(admin, small, ['properties', 'buildings', 'assets', 'duties'])
    const query = { propertyId: property, state: 'ended' }

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/duties/register/table', query, by('u-lead'), format)

      expect(table).toHaveLength(2)
      expect(table[1]?.at(-1)).toBe(`Beendet seit ${dayInWords(addDays(today, -30))}`)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the register of evidence as a table (#338)', () => {
  const path = '/duties/evidence-register/table'

  /** An evidence of a duty on a day, put in past the application: signed here, or from the old stock. */
  async function evidenceOf(duty: string, performedOn: IsoDate, legacy = false): Promise<string> {
    const values = [...writtenValues('u-duties', performedOn, 'without_defects')]

    if (legacy) {
      values[2] = 'legacy'
    }

    await admin.query(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       select tenant_id, property_id, area_id, id, $2::date, 'without_defects'::evidence_result,
              ${writtenPlaceholders(3)}
         from duties where id = $1`,
      [duty, performedOn, ...values],
    )

    return String(values[1])
  }

  it('holds a row per duty with its last evidence, marks the old stock and what was never recorded, and counts as the register does', async () => {
    const { property, asset } = await liftIn('Nachweishaus')
    const doors = await dutyAt(asset, 'Türen prüfen')
    const call = await dutyAt(asset, 'Notruf prüfen')

    await dutyAt(asset, 'Schacht prüfen')

    const signed = await evidenceOf(doors, addDays(today, -3))
    const old = await evidenceOf(call, addDays(today, -20), true)
    const columns = [...evidenceRegisterColumns]
    const pick = (row: readonly string[]) => [
      row[columns.indexOf('Pflicht')],
      row[columns.indexOf('Nummer des Nachweises')],
      row[columns.indexOf('Kennzeichnung')],
    ]

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf(path, { propertyId: property }, by('u-duties'), format)

      expect(table[0]).toEqual(columns)
      expect(table.slice(1).map(pick)).toEqual([
        ['Notruf prüfen', old, evidenceRegisterWords.legacy],
        ['Schacht prüfen', '', evidenceRegisterWords.never],
        ['Türen prüfen', signed, ''],
      ])
    }

    const register = (
      await http()
        .get('/duties/register')
        .query({ propertyId: property })
        .set(testIdentityHeader, by('u-duties'))
        .expect(200)
    ).body as DutyRegister

    expect(register.total).toBe(3)
  })

  it('holds nothing of an area the person does not see, and is for whoever looks at evidence', async () => {
    const { property, asset } = await liftIn('Nachweishaus Süd', large, { areaId: south })

    await dutyAt(asset, 'Türen prüfen')

    // The technician works in the north of the large tenant.
    expect(await tableOf(path, { propertyId: property }, by('u-tech', large))).toEqual([
      [...evidenceRegisterColumns],
    ])
    expect(
      (await tableOf(path, { propertyId: property }, by('u-duties', large))).slice(1).length,
    ).toBe(1)
    expect(await refusalOf(path, { propertyId: property }, leading('duty.read'))).toEqual({
      status: 403,
      message: missingRight('evidence.read'),
    })
  })
})

describe('the proposals of the catalogue as a table (#236)', () => {
  /** The proposals as the list reads them. */
  async function proposalsOf(
    query: Readonly<Record<string, string>>,
    tenantId: TenantId = small,
  ): Promise<DutyProposals> {
    return (
      await http()
        .get('/duties/proposals')
        .query(query)
        .set(testIdentityHeader, by('u-lead', tenantId))
        .expect(200)
    ).body as DutyProposals
  }

  /** Dismisses the first proposal of an asset with a reason; the kind it was for. */
  async function dismissFirst(asset: string, reason: string, tenantId: TenantId = small) {
    const kind = (await proposalsOf({ assetId: asset }, tenantId)).proposals[0]?.kind ?? ''

    await http()
      .post('/duty-dismissals')
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({ assetId: asset, kind, reason })
      .expect(201)

    return kind
  }

  const labelOf = (kind: string) => catalogue.dutyKind(kind, today)?.definition.label ?? kind

  it('holds a row for each duty kind at each asset, in the order of the list', async () => {
    const one = await liftIn('Vorschlagshaus West')
    const { proposals } = await proposalsOf({ propertyId: one.property })
    const kinds = catalogue.dutyKinds(today).map((entry) => entry.key)
    const inOrder = [...proposals].sort(
      (left, right) => kinds.indexOf(left.kind) - kinds.indexOf(right.kind),
    )

    expect(proposals.length).toBeGreaterThan(0)

    for (const format of ['xlsx', 'csv'] as const) {
      expect(
        await tableOf(
          '/duties/proposals/table',
          { propertyId: one.property },
          by('u-lead'),
          format,
        ),
      ).toEqual([
        ['Pflichtart', 'Paket', 'Anlage', 'Ort', 'Angelegt am'],
        ...inOrder.map((proposal) => [
          labelOf(proposal.kind),
          'Probepaket',
          `${one.number} Aufzug Vorschlagshaus West`,
          'Vorschlagshaus West, Haus A',
          dayInWords(today),
        ]),
      ])
    }
  })

  it('holds the proposals dismissed where they are asked for, each with its reason and its day', async () => {
    const one = await liftIn('Vorschlagshaus Ost')
    const before = (await proposalsOf({ propertyId: one.property })).proposals.length
    const kind = await dismissFirst(one.asset, 'Wird vom Vermieter geprüft.')
    const query = { propertyId: one.property }

    for (const format of ['xlsx', 'csv'] as const) {
      expect(
        await tableOf(
          '/duties/proposals/table',
          { ...query, list: 'dismissed' },
          by('u-lead'),
          format,
        ),
      ).toEqual([
        ['Anlage', 'Ort', 'Pflichtart', 'Paket', 'Begründung', 'Verworfen am'],
        [
          `${one.number} Aufzug Vorschlagshaus Ost`,
          'Vorschlagshaus Ost, Haus A',
          labelOf(kind),
          'Probepaket',
          'Wird vom Vermieter geprüft.',
          dayInWords(today),
        ],
      ])
    }

    // What is dismissed is no open proposal any more.
    expect(await tableOf('/duties/proposals/table', query, by('u-lead'))).toHaveLength(before)
    expect(
      await refusalOf('/duties/proposals/table', { ...query, list: 'beides' }, by('u-lead')),
    ).toEqual({ status: 400, message: 'Die Vorschläge gibt es offen oder verworfen.' })
  })

  it('narrows by what the list is narrowed by, the package included', async () => {
    const one = await liftIn('Vorschlagshaus Süd')
    const other = await liftIn('Vorschlagshaus Mitte')
    const assets = async (query: Readonly<Record<string, string>>) => [
      ...new Set(
        (await tableOf('/duties/proposals/table', query, by('u-lead')))
          .slice(1)
          .map((row) => row[2]),
      ),
    ]

    expect(await assets({ assetId: one.asset })).toEqual([
      `${one.number} Aufzug Vorschlagshaus Süd`,
    ])
    expect(await assets({ propertyId: other.property })).toEqual([
      `${other.number} Aufzug Vorschlagshaus Mitte`,
    ])
    expect(await assets({ assetId: one.asset, package: 'probe' })).toHaveLength(1)
    expect(await assets({ assetId: one.asset, package: 'allgemein' })).toEqual([])
    expect(await assets({ assetId: one.asset, dutyKind: 'probe.unbekannt' })).toEqual([])
  })

  it('holds no proposal of an area the person does not see', async () => {
    const inNorth = await liftIn('Vorschlagshof Nord', large, { areaId: north })
    const inSouth = await liftIn('Vorschlagshof Süd', large, { areaId: south })
    const dismissedInSouth = await liftIn('Vorschlagshof Fern', large, { areaId: south })

    await dismissFirst(dismissedInSouth.asset, 'Im Süden nicht nötig.', large)

    const northern = `${inNorth.number} Aufzug Vorschlagshof Nord`
    const southern = `${inSouth.number} Aufzug Vorschlagshof Süd`
    const assets = async (header: string, query: Readonly<Record<string, string>> = {}) =>
      (await tableOf('/duties/proposals/table', query, header)).slice(1).map((row) => row[2])
    const theirs = await assets(by('u-tech', large))
    const all = await assets(by('u-lead', large))

    expect(theirs).toContain(northern)
    expect(theirs).not.toContain(southern)
    expect(all).toContain(northern)
    expect(all).toContain(southern)
    // Named in the address, the other area gives nothing either.
    expect(await assets(by('u-tech', large), { propertyId: inSouth.property })).toEqual([])
    expect(await assets(by('u-tech', large), { assetId: inSouth.asset })).toEqual([])
    expect(
      await tableOf('/duties/proposals/table', { list: 'dismissed' }, by('u-tech', large)),
    ).toHaveLength(1)
    expect(
      await tableOf('/duties/proposals/table', { list: 'dismissed' }, by('u-lead', large)),
    ).toHaveLength(2)
  })

  it('is only for whoever reads duties', async () => {
    expect(await refusalOf('/duties/proposals/table', {}, leading('asset.read'))).toEqual({
      status: 403,
      message: missingRight('duty.read'),
    })
  })

  it('names the asset and its place only for whoever reads them as well', async () => {
    const open = await liftIn('Vorschlagshaus Nord')
    const dismissed = await liftIn('Vorschlagshaus Fern')

    await dismissFirst(dismissed.asset, 'Entfällt.')

    for (const [list, lift, name, at] of [
      ['open', open, 'Vorschlagshaus Nord', 2],
      ['dismissed', dismissed, 'Vorschlagshaus Fern', 0],
    ] as const) {
      const cells = async (...rights: Right[]) => {
        const [, row] = await tableOf(
          '/duties/proposals/table',
          { assetId: lift.asset, list },
          leading('duty.read', ...rights),
        )

        return [row?.[at], row?.[at + 1]]
      }

      expect(await cells()).toEqual(['Anlage', ''])
      expect(await cells('asset.read')).toEqual([`${lift.number} Aufzug ${name}`, ''])
      expect(await cells('location.read')).toEqual(['Anlage', `${name}, Haus A`])
    }
  })

  it('writes a reason that begins like a formula so that no spreadsheet runs it', async () => {
    const one = await liftIn('Vorschlagshaus Formel')

    await dismissFirst(one.asset, '=HYPERLINK("http://x.example")')

    const query = { propertyId: one.property, list: 'dismissed' }
    const csv = await rawOf('/duties/proposals/table', query, by('u-lead'), 'csv')
    const sheet = await rawOf('/duties/proposals/table', query, by('u-lead'), 'xlsx')

    expect(csv).toContain(`;"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const open = await liftIn('Vorschlagshaus Stempel')
    const dismissed = await liftIn('Vorschlagshaus Siegel')

    await dismissFirst(dismissed.asset, 'Entfällt.')
    // Entered and dismissed weeks ago, so that no day of their own is the day of the last change.
    await admin.query(
      `update assets set created_at = created_at - interval '40 days' where id = any($1)`,
      [[open.asset, dismissed.asset]],
    )
    await admin.query(
      `update duty_dismissals set created_at = created_at - interval '20 days' where asset_id = $1`,
      [dismissed.asset],
    )

    const stamps = await stampsOf(admin, small, [
      'properties',
      'buildings',
      'assets',
      'duty_dismissals',
    ])

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      for (const [list, lift, days] of [
        ['open', open, -40],
        ['dismissed', dismissed, -20],
      ] as const) {
        const table = await tableOf(
          '/duties/proposals/table',
          { assetId: lift.asset, list },
          by('u-lead'),
          format,
        )

        expect(table.length).toBeGreaterThan(1)
        expect(table[1]?.at(-1)).toBe(dayInWords(addDays(today, days)))
        expect(stampIn(table, stamps)).toEqual([])
      }
    }
  })
})

describe('the areas as a table (#236)', () => {
  /** Somebody of the Leitung in the tenant of these tests, with exactly these rights. */
  const holding = (...rights: Right[]) =>
    JSON.stringify({ userId: 'u-lead', tenantId: estate, roles: ['management'], rights })
  /** The rows of the table by the name of their area, the properties of each in the order of their names. */
  async function byArea(header: string, format: 'xlsx' | 'csv' = 'xlsx') {
    const [heads, ...rows] = await tableOf('/areas/overview/table', {}, header, format)

    return {
      heads,
      rows: Object.fromEntries(
        rows.map((row) => [
          row[0],
          row.slice(1).map((cell, at) => (at === 1 ? cell.split(', ').sort().join(', ') : cell)),
        ]),
      ),
    }
  }

  it('holds every area with what lies in it and who it is named for, as the list shows them', async () => {
    await propertyIn('Hof A', estate, { areaId: estateNorth })
    await propertyIn('Hof B', estate, { areaId: estateNorth })

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await byArea(by('u-lead', estate), format)).toEqual({
        heads: ['Bereich', 'Umfang', 'Liegenschaften und Gebäude', 'Zugänge mit diesem Bereich'],
        rows: {
          Nord: ['2 Liegenschaften, 2 Gebäude', 'Hof A, Hof B', 'Hana Haus'],
          Süd: ['keine Liegenschaft', 'keine', 'niemand'],
        },
      })
    }
  })

  it('names who an area is for only for whoever may see the staff, and the properties only for whoever reads places', async () => {
    expect(await byArea(holding('settings.read', 'location.read'))).toEqual({
      heads: ['Bereich', 'Umfang', 'Liegenschaften und Gebäude'],
      rows: {
        Nord: ['2 Liegenschaften, 2 Gebäude', 'Hof A, Hof B'],
        Süd: ['keine Liegenschaft', 'keine'],
      },
    })

    const nameless = await tableOf('/areas/overview/table', {}, holding('settings.read'))

    expect(nameless.flat().join(' ')).not.toMatch(/Hana Haus|Hof A|Hof B/)
    expect(nameless[0]).toEqual(['Bereich', 'Umfang', 'Liegenschaften und Gebäude'])
  })

  it('is only for whoever sees the settings', async () => {
    expect(await refusalOf('/areas/overview/table', {}, holding('location.read'))).toEqual({
      status: 403,
      message: missingRight('settings.read'),
    })
    expect((await refusalOf('/areas/overview/table', {}, by('u-tech', estate))).status).toBe(403)
  })

  it('writes a name that begins like a formula so that no spreadsheet runs it', async () => {
    await propertyIn('=HYPERLINK("http://x.example")', estate, { areaId: estateSouth })

    const csv = await rawOf('/areas/overview/table', {}, by('u-lead', estate), 'csv')
    const sheet = await rawOf('/areas/overview/table', {}, by('u-lead', estate), 'xlsx')

    expect(csv).toContain(`;"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds no part of the stamp of the last change, in neither format', async () => {
    const stamps = await stampsOf(admin, estate, ['properties', 'buildings'])

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/areas/overview/table', {}, by('u-lead', estate), format)

      expect(table).toHaveLength(3)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the tasks as a table (#236)', () => {
  const heads = ['Liste', 'Aufgabe', 'Fällig am', 'Überfällig', 'Hängt an', 'Verantwortlich']

  /** A task at an asset, a property or an activity, for somebody and written by somebody. */
  async function taskAt(
    at: { readonly asset?: string; readonly property?: string; readonly activity?: string },
    title: string,
    assignee: Person,
    dueOn: string,
    more: { readonly author?: Person; readonly status?: 'open' | 'done' } = {},
  ): Promise<void> {
    const from = at.asset ? 'assets' : at.activity ? 'activities' : 'properties'
    const place =
      from === 'properties' ? 'id, area_id, null::uuid, null::uuid' : 'property_id, area_id, $6, $7'

    const { rows } = await admin.query<{ id: string }>(
      `insert into tasks (tenant_id, title, due_on, assignee_user_id, status,
                          property_id, area_id, asset_id, activity_id)
       select tenant_id, $2, $3, $4, $5, ${place}
         from ${from} where id = $1
       returning id`,
      [
        at.asset ?? at.activity ?? at.property,
        title,
        dueOn,
        assignee,
        more.status ?? 'open',
        ...(from === 'properties' ? [] : [at.asset ?? null, at.activity ?? null]),
      ],
    )

    // Who wrote a task is taken from the session when it is made; said here afterwards.
    await admin.query('update tasks set created_by = $2 where id = $1', [
      rows[0]?.id,
      more.author ?? assignee,
    ])
  }

  it('holds the open tasks of the two lists, the own ones first, each with its day and what it hangs on', async () => {
    const { property, asset, number } = await liftIn('Aufgabenhaus West')

    await taskAt({ asset }, 'Plaketten bestellen', 'u-lead', addDays(today, 5))
    await taskAt({ property }, 'Schlüssel abholen', 'u-tech', addDays(today, -2), {
      author: 'u-duties',
    })
    await taskAt({ property }, 'Erledigtes', 'u-lead', addDays(today, 1), { status: 'done' })

    const atAsset = `${number} Aufzug Aufgabenhaus West, Aufgabenhaus West, Haus A`
    const own = ['Plaketten bestellen', dayInWords(addDays(today, 5)), '', atAsset]
    const others = [
      'Schlüssel abholen',
      dayInWords(addDays(today, -2)),
      'überfällig',
      'Aufgabenhaus West, Liegenschaft',
    ]

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await tableOf('/tasks/table', {}, by('u-lead'), format)).toEqual([
        heads,
        ['Ihre Aufgaben', ...own, 'Lena Leitung'],
        ['Offen bei anderen', ...others, 'Hana Haus'],
      ])
      // Without the right of the staff: whose a task is, by its list alone.
      expect(await tableOf('/tasks/table', {}, by('u-duties'), format)).toEqual([
        heads.slice(0, 5),
        ['Offen bei anderen', ...others],
        ['Offen bei anderen', ...own],
      ])
    }

    const nameless = await tableOf('/tasks/table', {}, by('u-duties'))

    expect(nameless.flat().join(' ')).not.toMatch(/Hana Haus|Tom Technik|Lena Leitung/)
  })

  it('holds for whoever sees only some areas their own tasks, and none of an area they do not see', async () => {
    const inNorth = await liftIn('Aufgabenhof Nord', large, { areaId: north })
    const inSouth = await liftIn('Aufgabenhof Süd', large, { areaId: south })

    await taskAt({ asset: inNorth.asset }, 'Nordtür ölen', 'u-tech', addDays(today, 3))
    await taskAt({ asset: inNorth.asset }, 'Nordlicht tauschen', 'u-lead', addDays(today, 4))
    await taskAt({ asset: inNorth.asset }, 'Nordschild richten', 'u-lead', addDays(today, 6), {
      author: 'u-tech',
    })
    await taskAt({ asset: inSouth.asset }, 'Südtür ölen', 'u-lead', addDays(today, 3))

    const titles = async (header: string) =>
      (await tableOf('/tasks/table', {}, header)).slice(1).map((row) => `${row[0]}: ${row[1]}`)

    // Their own and those they wrote, as their device holds them.
    expect(await titles(by('u-tech', large))).toEqual([
      'Ihre Aufgaben: Nordtür ölen',
      'Offen bei anderen: Nordschild richten',
    ])
    expect(await titles(by('u-lead', large))).toEqual([
      'Ihre Aufgaben: Südtür ölen',
      'Ihre Aufgaben: Nordlicht tauschen',
      'Ihre Aufgaben: Nordschild richten',
      'Offen bei anderen: Nordtür ölen',
    ])
  })

  it('is only for whoever looks at tasks', async () => {
    expect(await refusalOf('/tasks/table', {}, leading('asset.read'))).toEqual({
      status: 403,
      message: missingRight('task.read'),
    })
  })

  it('names the place, the asset and the activity a task hangs on only for whoever reads them', async () => {
    const tenant = newId<'tenant'>() as TenantId

    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Aufgaben Probe'])
    await admin.query(
      `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-lead', '{management}'),
                                                                   ($1, 'u-duties', '{technical_management}')`,
      [tenant],
    )

    const { asset, number } = await liftIn('Aufgabenhaus Nord', tenant)
    const activity = (
      await http()
        .post('/activities')
        .set(testIdentityHeader, by('u-duties', tenant))
        .send({ dutyId: await dutyAt(asset, 'Türen prüfen') })
        .expect(201)
    ).body.id as string

    await taskAt({ asset }, 'An der Anlage', 'u-lead', addDays(today, 1))
    await taskAt({ activity }, 'Am Vorgang', 'u-lead', addDays(today, 2))

    const where = async (...rights: Right[]) =>
      (
        await tableOf(
          '/tasks/table',
          {},
          JSON.stringify({
            userId: 'u-lead',
            tenantId: tenant,
            roles: ['management'],
            rights: ['task.read', ...rights],
          }),
        )
      )
        .slice(1)
        .map((row) => row[4])

    expect(await where()).toEqual(['Anlage, Liegenschaft', 'Vorgang, Liegenschaft'])
    expect(await where('asset.read', 'location.read', 'activity.read')).toEqual([
      `${number} Aufzug Aufgabenhaus Nord, Aufgabenhaus Nord, Haus A`,
      'Türen prüfen, Aufgabenhaus Nord',
    ])
    expect(await where('location.read')).toEqual([
      'Anlage, Aufgabenhaus Nord, Haus A',
      'Vorgang, Aufgabenhaus Nord',
    ])

    // Given to somebody else, the activity is not shown to whoever only performs, and its title is not either.
    await admin.query(`update activities set performer_user_id = 'u-duties' where id = $1`, [
      activity,
    ])

    expect((await where('location.read', 'activity.read'))[1]).toBe('Vorgang, Aufgabenhaus Nord')
    expect((await where('location.read', 'activity.read', 'activity.write'))[1]).toBe(
      'Türen prüfen, Aufgabenhaus Nord',
    )
  })

  it('writes a task that begins like a formula so that no spreadsheet runs it, and nothing of the stamp', async () => {
    const tenant = newId<'tenant'>() as TenantId

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant,
      'Aufgaben Stempel',
    ])
    await admin.query(
      `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-lead', '{management}'),
                                                                   ($1, 'u-duties', '{technical_management}')`,
      [tenant],
    )

    const { asset } = await liftIn('Aufgabenhaus Stempel', tenant)

    await taskAt({ asset }, '=HYPERLINK("http://x.example")', 'u-lead', addDays(today, 9))
    const csv = await rawOf('/tasks/table', {}, by('u-lead', tenant), 'csv')
    const sheet = await rawOf('/tasks/table', {}, by('u-lead', tenant), 'xlsx')
    const stamps = await stampsOf(admin, tenant, ['tasks', 'assets', 'properties'])

    expect(csv).toContain(`;"'=HYPERLINK(""http://x.example"")";`)
    expect(sheet).not.toMatch(/<f[ >]/)
    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/tasks/table', {}, by('u-lead', tenant), format)

      expect(table).toHaveLength(2)
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the documents as a table (#236)', () => {
  const heads = ['Dokument', 'Datei', 'Art', 'Hängt an', 'Fassung', 'Abgelegt am']
  let files = 0

  /** A document at an asset, a property, an activity or a defect, with as many versions as it has files. */
  async function documentAt(
    at: {
      readonly asset?: string
      readonly property?: string
      readonly activity?: string
      readonly defect?: string
    },
    title: string,
    kind: string | null,
    fileNames: readonly (readonly [name: string, mediaType: string])[],
    /** A version is never changed: the day it was filed is said as it is made. */
    daysAgo = 10,
  ): Promise<string> {
    const from = at.asset
      ? 'assets'
      : at.activity
        ? 'activities'
        : at.defect
          ? 'defects'
          : 'properties'
    const column = at.asset
      ? 'asset_id'
      : at.activity
        ? 'activity_id'
        : at.defect
          ? 'defect_id'
          : null
    const { rows } = await admin.query<{ id: string }>(
      `insert into attachments (tenant_id, property_id, area_id, title, kind${column ? `, ${column}` : ''})
       select tenant_id, ${from === 'properties' ? 'id' : 'property_id'}, area_id, $2, $3${column ? ', id' : ''}
         from ${from} where id = $1
       returning id`,
      [at.asset ?? at.activity ?? at.defect ?? at.property, title, kind],
    )
    const id = rows[0]?.id ?? ''

    for (const [name, mediaType] of fileNames) {
      files += 1

      const sha256 = String(files).padStart(64, '0')

      await admin.query(
        `insert into files (tenant_id, sha256, size_bytes, media_type)
         select tenant_id, $2, 2048, $3 from attachments where id = $1`,
        [id, sha256, mediaType],
      )
      await admin.query(
        `insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type,
                                          size_bytes, created_by, created_at)
         select tenant_id, id, $2, $3, $4, 2048, 'u-duties', now() - make_interval(days => $5)
           from attachments where id = $1`,
        [id, sha256, name, mediaType, daysAgo],
      )
    }

    return id
  }

  it('holds each document with its newest file, its kind, what it hangs on, its versions and the day it was filed, the newest first', async () => {
    const { property, asset, number } = await liftIn('Dokumentenhaus West')
    await documentAt(
      { asset },
      'Betriebsanleitung Aufzug',
      'operating_manual',
      [
        ['anleitung-alt.pdf', 'application/pdf'],
        ['anleitung-neu.pdf', 'application/pdf'],
      ],
      12,
    )
    await documentAt({ property }, 'Eingang', null, [['eingang.jpg', 'image/jpeg']], 3)

    const kindOf = (await tableOf('/attachments/table', { home: 'assetId' }, by('u-lead')))[1]?.[2]

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/attachments/table', {}, by('u-lead'), format)

      expect(table[0]).toEqual(heads)
      expect(table.slice(1).filter((row) => /Dokumentenhaus West/.test(row[3] ?? ''))).toEqual([
        [
          'Eingang',
          'eingang.jpg',
          'Foto',
          'Liegenschaft Dokumentenhaus West',
          '1',
          dayInWords(addDays(today, -3)),
        ],
        [
          'Betriebsanleitung Aufzug',
          'anleitung-neu.pdf',
          kindOf,
          `${number} Aufzug Dokumentenhaus West`,
          '2',
          dayInWords(addDays(today, -12)),
        ],
      ])
    }

    expect(kindOf).toBe(documentKindLabel.operating_manual)
  })

  it('narrows by what the list is narrowed by', async () => {
    const titles = async (query: Readonly<Record<string, string>>) =>
      (await tableOf('/attachments/table', query, by('u-lead'))).slice(1).map((row) => row[0])

    expect(await titles({ kind: 'operating_manual' })).toEqual(['Betriebsanleitung Aufzug'])
    expect(await titles({ home: 'propertyId' })).toEqual(['Eingang'])
    expect(await titles({ kind: 'permit' })).toEqual([])
    expect(await refusalOf('/attachments/table', { kind: 'gedicht' }, by('u-lead'))).toEqual({
      status: 400,
      message: 'Diese Art von Dokument gibt es nicht.',
    })
    expect((await refusalOf('/attachments/table', { home: 'userId' }, by('u-lead'))).status).toBe(
      400,
    )
  })

  it('holds no document of an area the person does not see', async () => {
    const inNorth = await liftIn('Dokumentenhof Nord', large, { areaId: north })
    const inSouth = await liftIn('Dokumentenhof Süd', large, { areaId: south })

    await documentAt({ asset: inNorth.asset }, 'Nordplan', 'circuit_diagram', [
      ['nord.pdf', 'application/pdf'],
    ])
    await documentAt({ asset: inSouth.asset }, 'Südplan', 'circuit_diagram', [
      ['sued.pdf', 'application/pdf'],
    ])

    const titles = async (header: string) =>
      (await tableOf('/attachments/table', {}, header)).slice(1).map((row) => row[0])

    expect(await titles(by('u-tech', large))).toEqual(['Nordplan'])
    expect((await titles(by('u-lead', large))).sort()).toEqual(['Nordplan', 'Südplan'])
  })

  it('is only for whoever looks at documents', async () => {
    expect(await refusalOf('/attachments/table', {}, leading('asset.read'))).toEqual({
      status: 403,
      message: missingRight('document.read'),
    })
  })

  it('names what a document hangs on only for whoever reads that record', async () => {
    const tenant = newId<'tenant'>() as TenantId

    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Dokumente Probe'])
    await admin.query(
      `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-lead', '{management}'),
                                                                   ($1, 'u-duties', '{technical_management}')`,
      [tenant],
    )

    const { property, asset, number } = await liftIn('Dokumentenhaus Nord', tenant)
    const activity = (
      await http()
        .post('/activities')
        .set(testIdentityHeader, by('u-duties', tenant))
        .send({ dutyId: await dutyAt(asset, 'Türen prüfen') })
        .expect(201)
    ).body.id as string
    const defect = (
      await http()
        .post('/defects')
        .set(testIdentityHeader, by('u-duties', tenant))
        .send({ assetId: asset, description: 'Tür klemmt', foundOn: addDays(today, -3) })
        .expect(201)
    ).body.id as string

    await documentAt({ property }, 'D Liegenschaft', null, [])
    await documentAt({ asset }, 'C Anlage', null, [])
    await documentAt({ activity }, 'B Vorgang', null, [])
    await documentAt({ defect }, 'A Mangel', null, [])

    const homes = async (...rights: Right[]) =>
      Object.fromEntries(
        (
          await tableOf(
            '/attachments/table',
            {},
            JSON.stringify({
              userId: 'u-lead',
              tenantId: tenant,
              roles: ['management'],
              rights: ['document.read', ...rights],
            }),
          )
        )
          .slice(1)
          .map((row) => [row[0]?.slice(2), row[3]]),
      )

    expect(await homes()).toEqual({
      Liegenschaft: 'Liegenschaft',
      Anlage: 'Anlage',
      Vorgang: 'Vorgang',
      Mangel: 'Mangel',
    })
    expect(await homes('location.read')).toEqual({
      Liegenschaft: 'Liegenschaft Dokumentenhaus Nord',
      Anlage: 'Anlage, Dokumentenhaus Nord',
      Vorgang: 'Vorgang, Dokumentenhaus Nord',
      Mangel: 'Mangel, Dokumentenhaus Nord',
    })
    expect(await homes('asset.read', 'activity.read', 'defect.read')).toEqual({
      Liegenschaft: 'Liegenschaft',
      Anlage: `${number} Aufzug Dokumentenhaus Nord`,
      Vorgang: 'Türen prüfen',
      Mangel: 'Tür klemmt',
    })
  })

  it('writes a name that begins like a formula so that no spreadsheet runs it', async () => {
    const { property } = await propertyIn('Dokumentenhaus Formel')

    await documentAt({ property }, '=HYPERLINK("http://x.example")', null, [
      ['=1+1.pdf', 'application/pdf'],
    ])

    const csv = await rawOf('/attachments/table', {}, by('u-lead'), 'csv')
    const sheet = await rawOf('/attachments/table', {}, by('u-lead'), 'xlsx')

    expect(csv).toContain(`"'=HYPERLINK(""http://x.example"")";'=1+1.pdf;`)
    expect(sheet).not.toMatch(/<f[ >]/)
  })

  it('holds the day a version was filed and no part of the stamp of the last change, in neither format', async () => {
    // Every version of these tests was filed before today; who filed it is named nowhere.
    const stamps = [
      ...(await stampsOf(admin, small, ['attachments', 'attachment_versions'])),
      'u-duties',
    ]

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/attachments/table', {}, by('u-lead'), format)

      expect(table.length).toBeGreaterThan(3)
      expect(table.flat()).toContain(dayInWords(addDays(today, -12)))
      expect(stampIn(table, stamps)).toEqual([])
    }
  })
})

describe('the rounds as tables (#236)', () => {
  const tenant = newId<'tenant'>() as TenantId
  /** The Monday of the week after this one, every day of which has a round. */
  const monday = weekNamed(addDays(today, 7)) as IsoDate
  const title = 'Wache, täglicher Rundgang'
  let area = ''
  let areaName = ''
  let building = ''
  let plan = ''
  let template = ''

  /** Somebody of the Leitung in the tenant of these tests, with exactly these rights. */
  const holding = (...rights: Right[]) =>
    JSON.stringify({ userId: 'u-lead', tenantId: tenant, roles: ['management'], rights })
  const weekTable = (
    header: string,
    query: Readonly<Record<string, string>> = {},
    format: 'xlsx' | 'csv' = 'xlsx',
  ) => tableOf('/rounds/week/table', { of: monday, ...query }, header, format)
  const ofTheWeek = (rows: readonly string[][]) => rows.filter((row) => row[0] === 'In der Woche')

  beforeAll(async () => {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Rundgänge Probe'])

    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }

    for (const [userId, person] of Object.entries(people)) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenant,
        userId,
        [person.role],
      ])
    }

    const { rows: areas } = await admin.query<{ id: string; name: string }>(
      'select id, name from areas where tenant_id = $1',
      [tenant],
    )

    area = areas[0]?.id ?? ''
    areaName = areas[0]?.name ?? ''

    const { property, ...place } = await propertyIn('Rundenhaus', tenant)

    building = place.building

    const asset = await made(
      `/buildings/${building}/assets`,
      { kind: 'probe.elevator', name: 'Aufzug Rundenhaus' },
      tenant,
    )
    const { rows: templates } = await admin.query<{ id: string }>(
      'insert into round_templates (tenant_id, title) values ($1, $2) returning id',
      [tenant, title],
    )

    template = templates[0]?.id ?? ''
    // Its version was made twenty days ago: a version is never changed.
    await admin.query(
      `insert into round_template_versions (tenant_id, template_id, form_version, definition,
                                            asks_countersignature, created_at)
       values ($1, $2, 1, $3, true, now() - interval '20 days')`,
      [
        tenant,
        template,
        JSON.stringify({
          title,
          sections: [
            {
              key: 'k1',
              title: 'Fahrzeughalle',
              fields: [
                {
                  kind: 'check_point',
                  key: 'p1',
                  label: 'Aufzug ohne Störung',
                  required: true,
                  about: { kind: 'asset', id: asset },
                },
              ],
            },
          ],
        }),
      ],
    )
    plan = (
      await http()
        .post('/round-plans')
        .set(testIdentityHeader, by('u-duties', tenant))
        .send({
          templateId: template,
          propertyId: property,
          buildingId: building,
          rhythm: 'daily',
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          leadDays: 0,
          startsOn: today,
        })
        .expect(201)
    ).body.id as string
  })

  it('hold a row for each round of the week in the order of its days, and who walks one only for the Leitung', async () => {
    // The round of the Tuesday is given to one of the Haustechnik.
    await admin.query(
      `update activities set performer_user_id = 'u-tech' where round_plan_id = $1 and due_on = $2`,
      [plan, addDays(monday, 1)],
    )

    const row = (days: number, walker: string) => [
      'In der Woche',
      'Haus A',
      'Rundenhaus',
      title,
      'täglich',
      dayInWords(addDays(monday, days)),
      walker,
      'Offen',
    ]
    const everybody = `Alle im Bereich ${areaName}`

    expect(areaName).not.toBe('')

    for (const format of ['xlsx', 'csv'] as const) {
      const named = await weekTable(by('u-lead', tenant), {}, format)

      expect(named[0]).toEqual([
        'Liste',
        'Gebäude',
        'Liegenschaft',
        'Rundgang',
        'Rhythmus',
        'Fällig am',
        'Zuständig',
        'Stand',
      ])
      expect(ofTheWeek(named)).toEqual(
        [0, 1, 2, 3, 4, 5, 6].map((days) => row(days, days === 1 ? 'Hana Haus' : everybody)),
      )
      // Everybody in the area is no person and stands for everybody; a person only for the Leitung.
      expect(ofTheWeek(await weekTable(by('u-duties', tenant), {}, format))).toEqual(
        [0, 1, 2, 3, 4, 5, 6].map((days) => row(days, days === 1 ? '' : everybody)),
      )
    }

    const nameless = await weekTable(by('u-duties', tenant))

    expect(nameless.flat().join(' ')).not.toMatch(/Hana Haus|Tom Technik|Lena Leitung/)
  })

  it('hold the rounds left open from earlier weeks after those of the week, as the overview lists them', async () => {
    const week = (
      await http()
        .get('/rounds/week')
        .query({ of: monday })
        .set(testIdentityHeader, by('u-lead', tenant))
        .expect(200)
    ).body as RoundWeek
    const table = await weekTable(by('u-lead', tenant))
    const before = table.slice(1).filter((row) => row[0] === 'Offen aus vergangenen Wochen')

    // The round of today is open, and today lies before the week asked for.
    expect(week.before.length).toBeGreaterThan(0)
    expect(before.map((row) => row[5])).toEqual(week.before.map((round) => dayInWords(round.dueOn)))
    expect(table.slice(1).map((row) => row[0])).toEqual([
      ...week.rounds.map(() => 'In der Woche'),
      ...week.before.map(() => 'Offen aus vergangenen Wochen'),
    ])
  })

  it('are narrowed to the area of the screen', async () => {
    expect(ofTheWeek(await weekTable(by('u-lead', tenant), { area }))).toHaveLength(7)
    expect(await weekTable(by('u-lead', tenant), { area: newId<'area'>() })).toHaveLength(1)
    expect(
      (await refusalOf('/rounds/week/table', { of: monday, area: 'nord' }, by('u-lead', tenant)))
        .status,
    ).toBe(400)
  })

  it('are only for whoever reads activities', async () => {
    for (const path of ['/rounds/week/table', '/round-plans/table', '/round-templates/table']) {
      expect(await refusalOf(path, {}, holding('location.read'))).toEqual({
        status: 403,
        message: missingRight('activity.read'),
      })
    }
  })

  it('name where a plan is walked only for whoever reads places', async () => {
    const places = async (...rights: Right[]) =>
      ofTheWeek(await weekTable(holding('activity.read', 'activity.write', ...rights)))[0]?.slice(
        1,
        3,
      )

    expect(await places()).toEqual(['Gebäude', 'Liegenschaft'])
    expect(await places('location.read')).toEqual(['Haus A', 'Rundenhaus'])
  })

  it('hold the templates of the operator with their newest version and the rounds made of them', async () => {
    const counted = (
      (
        await http()
          .get('/round-templates/rounds')
          .set(testIdentityHeader, by('u-lead', tenant))
          .expect(200)
      ).body as readonly TemplateRounds[]
    ).reduce((sum, each) => sum + (each.templateId === template ? each.rounds : 0), 0)

    expect(counted).toBeGreaterThan(7)

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await tableOf('/round-templates/table', {}, by('u-lead', tenant), format)).toEqual([
        ['Vorlage', 'Umfang', 'Fassung', 'Seit', 'Gegenzeichnung', 'Rundgänge'],
        [
          title,
          '1 Kapitel, 1 Punkt',
          '1',
          dayInWords(addDays(today, -20)),
          'verlangt',
          String(counted),
        ],
      ])
    }
  })

  it('hold the plans with their place, who walks their rounds, their next pass and whether they run', async () => {
    const heads = [
      'Rundgang',
      'Rhythmus',
      'Gebäude',
      'Liegenschaft',
      'Zuständig',
      'Nächster Durchgang',
      'Stand',
    ]
    const row = (walker: string, next: string) => [
      title,
      'täglich',
      'Haus A',
      'Rundenhaus',
      walker,
      next,
      'Läuft',
    ]
    const plans = (header: string, format: 'xlsx' | 'csv' = 'xlsx') =>
      tableOf('/round-plans/table', {}, header, format)

    for (const format of ['xlsx', 'csv'] as const) {
      expect(await plans(by('u-lead', tenant), format)).toEqual([
        heads,
        row(`Alle im Bereich ${areaName}`, dayInWords(today)),
      ])
    }

    // The building is closed today and tomorrow: the next pass is the day after, as in the list.
    await admin.query(
      `insert into building_closures (tenant_id, building_id, property_id, area_id, starts_on, ends_on)
       select tenant_id, id, property_id, area_id, $2, $3 from buildings where id = $1`,
      [building, today, addDays(today, 1)],
    )
    await admin.query(`update round_plans set performer_user_id = 'u-tech' where id = $1`, [plan])

    const next = dayInWords(addDays(today, 2))

    expect(await plans(by('u-lead', tenant))).toEqual([heads, row('Hana Haus', next)])
    // A person only for whoever may see the staff.
    expect(await plans(by('u-duties', tenant))).toEqual([heads, row('', next)])
    expect((await plans(holding('activity.read')))[1]?.slice(2, 4)).toEqual([
      'Gebäude',
      'Liegenschaft',
    ])
  })

  it('hold no part of the stamp of the last change, in neither format', async () => {
    // No round of these tables is due today: the one of today was due three days ago.
    await admin.query(
      `update activities set due_on = $2 where round_plan_id = $1 and due_on = $3`,
      [plan, addDays(today, -3), today],
    )

    const stamps = await stampsOf(admin, tenant, [
      'activities',
      'round_plans',
      'round_templates',
      'round_template_versions',
      'building_closures',
      'properties',
      'buildings',
    ])

    expect(stamps.length).toBeGreaterThan(2)

    for (const format of ['xlsx', 'csv'] as const) {
      const week = await weekTable(by('u-lead', tenant), {}, format)
      const templates = await tableOf('/round-templates/table', {}, by('u-lead', tenant), format)

      expect(week.length).toBeGreaterThan(7)
      expect(week.flat()).toContain(dayInWords(addDays(today, -3)))
      expect(stampIn(week, stamps)).toEqual([])
      expect(templates).toHaveLength(2)
      expect(stampIn(templates, stamps)).toEqual([])

      const plans = await tableOf('/round-plans/table', {}, by('u-lead', tenant), format)

      expect(plans).toHaveLength(2)
      expect(stampIn(plans, stamps)).toEqual([])
    }
  })

  it('write a name that begins like a formula so that no spreadsheet runs it', async () => {
    await admin.query('update round_templates set title = $2 where id = $1', [
      template,
      '=HYPERLINK("http://x.example")',
    ])

    for (const [path, query] of [
      ['/rounds/week/table', { of: monday }],
      ['/round-plans/table', {}],
      ['/round-templates/table', {}],
    ] as const) {
      const csv = await rawOf(path, query, by('u-lead', tenant), 'csv')
      const sheet = await rawOf(path, query, by('u-lead', tenant), 'xlsx')

      expect(csv).toContain(`"'=HYPERLINK(""http://x.example"")";`)
      expect(sheet).not.toMatch(/<f[ >]/)
    }
  })

  it('hold no round and no plan of an area the person does not see, and count no round of it', async () => {
    // A second area, made after everybody began: the Haustechnik stays in the first one.
    const { rows: added } = await admin.query<{ id: string }>(
      `insert into areas (tenant_id, name) values ($1, 'Außenstelle') returning id`,
      [tenant],
    )
    const far = await propertyIn('Außenhaus', tenant, { areaId: added[0]?.id ?? '' })

    await http()
      .post('/round-plans')
      .set(testIdentityHeader, by('u-duties', tenant))
      .send({
        templateId: template,
        propertyId: far.property,
        buildingId: far.building,
        rhythm: 'daily',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        leadDays: 0,
        startsOn: today,
      })
      .expect(201)

    const propertiesIn = (rows: readonly string[][], column: number) =>
      [...new Set(rows.slice(1).map((row) => row[column] ?? ''))].sort()
    const roundsOf = async (header: string) =>
      Number((await tableOf('/round-templates/table', {}, header))[1]?.[5])

    expect(propertiesIn(await weekTable(by('u-lead', tenant)), 2)).toEqual([
      'Außenhaus',
      'Rundenhaus',
    ])
    expect(propertiesIn(await weekTable(by('u-tech', tenant)), 2)).toEqual(['Rundenhaus'])
    expect(propertiesIn(await tableOf('/round-plans/table', {}, by('u-lead', tenant)), 3)).toEqual([
      'Außenhaus',
      'Rundenhaus',
    ])
    expect(propertiesIn(await tableOf('/round-plans/table', {}, by('u-tech', tenant)), 3)).toEqual([
      'Rundenhaus',
    ])
    // The rounds of a template are counted in the areas of the person, as the list counts them.
    expect(await roundsOf(by('u-tech', tenant))).toBeGreaterThan(0)
    expect(await roundsOf(by('u-tech', tenant))).toBeLessThan(await roundsOf(by('u-lead', tenant)))
  })
})
