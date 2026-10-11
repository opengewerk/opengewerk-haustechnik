import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  dayInWords,
  type DutyProposals,
  type DutyRegister,
  dutyTableWords,
  type MeterList,
  meterMediumLabel,
  meterStateLabel,
  missingRight,
  type Right,
  type RoleKey,
  shippedRoles,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
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
let north = ''
let south = ''

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

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
  ])

  // The roles as rows, with the rights each ships with, as a real operator has them.
  for (const tenantId of [small, large]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  // The tenant with two areas has them before anybody works for it, so that
  // it does not begin with the one a tenant gets with its first membership.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    // Called by a name that is not the id, which is what a stamp would hold.
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

  // In the tenant with two areas the technician works in the north.
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
