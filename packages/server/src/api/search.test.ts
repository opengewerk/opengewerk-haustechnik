import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type IsoDate,
  type Right,
  type RoleKey,
  type SearchAnswer,
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
 * The search by name, number and mark (#125, section 3 of the concept): it
 * finds each kind by what it is called and numbered, the closest first, at
 * most five of a kind, and nothing from an area the person asking does not
 * see, not even as a number. Whoever only performs finds of the activities
 * what is given to them or to nobody, and no hit names a person.
 *
 * The catalogue is the probe package; every asset here is an elevator or a
 * water meter, whatever its name says.
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; the technician works in the north. */
const large = newId<'tenant'>() as TenantId
/** A tenant of its own for the numbers, so that they are the first it draws. */
const counted = newId<'tenant'>() as TenantId
/** A tenant beside the others, with a property of the same name. */
const other = newId<'tenant'>() as TenantId
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

function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

/** The technician with exactly these rights: a header that carries rights is taken at its word. */
function holding(...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId: small, roles: ['technician'], rights })
}

async function made(path: string, body: object, header: string): Promise<string> {
  return (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
}

interface School {
  readonly property: string
  readonly house: string
  readonly canteen: string
  readonly boilerRoom: string
}

/** A school with two buildings and a boiler room on the ground floor of the first. */
async function schoolIn(tenantId: TenantId, name: string, extra: object = {}): Promise<School> {
  const header = by('u-duties', tenantId)
  const property = await made(
    '/properties',
    {
      name,
      street: 'Lindenstraße 4',
      postalCode: '00001',
      city: 'Beispielstadt',
      federalState: 'DE-BW',
      ...extra,
    },
    header,
  )
  const house = await made(
    `/properties/${property}/buildings`,
    { name: 'Schulhaus', shortCode: 'SH', kinds: ['school'] },
    header,
  )
  const canteen = await made(
    `/properties/${property}/buildings`,
    { name: 'Mensa', shortCode: 'ME', kinds: ['school'] },
    header,
  )
  const ground = await made(`/buildings/${house}/floors`, { name: 'Erdgeschoss', level: 0 }, header)
  const boilerRoom = await made(
    `/floors/${ground}/rooms`,
    { number: 'E.14', name: 'Heizraum' },
    header,
  )

  return { property, house, canteen, boilerRoom }
}

/** An asset taken into a building through the route, by whoever sees every area. */
async function assetIn(
  building: string,
  body: object,
  tenantId: TenantId = small,
  roomId?: string,
): Promise<string> {
  return made(
    `/buildings/${building}/assets`,
    { kind: 'probe.elevator', ...body, ...(roomId === undefined ? {} : { roomId }) },
    by('u-duties', tenantId),
  )
}

/** A work order at a building, put in past the application, given to nobody unless named. */
async function workOrderAt(
  building: string,
  title: string,
  number: string,
  responsible: string | null = null,
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into activities (tenant_id, property_id, area_id, building_id, kind, title, status,
                             responsible_user_id)
     select tenant_id, property_id, area_id, id, 'work_order', $2, 'open', $3
       from buildings where id = $1
     returning id`,
    [building, title, responsible],
  )
  const activity = rows[0]?.id ?? ''

  await admin.query(
    `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
     select tenant_id, property_id, area_id, id, $2, 'defect_remedy'
       from activities where id = $1`,
    [activity, number],
  )

  return activity
}

/** An evidence of a duty of the operator's own at an asset, put in past the application. */
async function evidenceAt(asset: string, performedOn: IsoDate): Promise<string> {
  const { rows: duties } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     select tenant_id, property_id, area_id, id, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-duties'
       from assets where id = $1
     returning id`,
    [asset],
  )
  const { rows } = await admin.query<{ number: string }>(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, 'without_defects',
            ${writtenPlaceholders(3)}
       from duties where id = $1
     returning number`,
    [duties[0]?.id, performedOn, ...writtenValues('u-duties', performedOn, 'without_defects')],
  )

  return rows[0]?.number ?? ''
}

async function search(words: string, header: string = by('u-lead')): Promise<SearchAnswer> {
  return (
    await http().get('/search').query({ q: words }).set(testIdentityHeader, header).expect(200)
  ).body
}

/** The hits as kind and id, in their order. */
async function found(words: string, header?: string): Promise<string[]> {
  return (await search(words, header)).hits.map((hit) => `${hit.kind} ${hit.id}`)
}

let school: School
let boiler = ''
let meter = ''
let openOrder = ''
let leadsOrder = ''

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query(
    'insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6), ($7, $8)',
    [
      small,
      'Liegenschaften Beispielstadt',
      large,
      'Gebäudeverwaltung Süd',
      counted,
      'Zählwerk',
      other,
      'Nachbarstadt',
    ],
  )

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

    for (const tenantId of [small, large, counted, other]) {
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

  school = await schoolIn(small, 'Schulzentrum Am Lindenhain')
  boiler = await assetIn(
    school.house,
    { name: 'Heizkessel', mark: 'HZ-SH-01', serialNumber: 'SN-4711' },
    small,
    school.boilerRoom,
  )
  meter = await assetIn(school.house, {
    kind: 'probe.water_meter',
    name: 'Hauptwasserzähler',
    meterNumber: '13-882914',
    meterUnit: 'cubic_metres',
  })
  openOrder = await workOrderAt(school.canteen, 'Heizkessel Mensa entlüften', 'AU-2026-0028')
  leadsOrder = await workOrderAt(school.house, 'Heizkreis spülen', 'AU-2026-0029', 'u-lead')

  // The same name in another tenant, which nobody here finds.
  await schoolIn(other, 'Schulzentrum Am Lindenhain')
}, 120_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the search', () => {
  it('finds each kind by its name and its number, in the order of the kinds, with the places above it', async () => {
    expect(await search('heiz')).toEqual({
      hits: [
        {
          kind: 'room',
          id: school.boilerRoom,
          number: 'E.14',
          name: 'Heizraum',
          property: 'Schulzentrum Am Lindenhain',
          building: 'Schulhaus',
          floor: 'Erdgeschoss',
        },
        {
          kind: 'asset',
          id: boiler,
          number: expect.stringMatching(/^AN-\d{5}$/),
          name: 'Heizkessel',
          mark: { field: 'mark', value: 'HZ-SH-01' },
          building: 'Schulhaus',
          room: 'E.14 Heizraum',
        },
        {
          kind: 'activity',
          id: openOrder,
          activityKind: 'work_order',
          number: 'AU-2026-0028',
          title: 'Heizkessel Mensa entlüften',
          status: 'open',
          place: 'Mensa',
        },
        {
          kind: 'activity',
          id: leadsOrder,
          activityKind: 'work_order',
          number: 'AU-2026-0029',
          title: 'Heizkreis spülen',
          status: 'open',
          place: 'Schulhaus',
        },
      ],
      more: [],
    })

    expect(await search('Lindenhain')).toEqual({
      hits: [
        {
          kind: 'property',
          id: school.property,
          name: 'Schulzentrum Am Lindenhain',
          address: 'Lindenstraße 4, 00001 Beispielstadt',
        },
      ],
      more: [],
    })
    // A building by its short code, a work order by its number.
    expect(await found('me')).toContain(`building ${school.canteen}`)
    expect(await found('AU-2026-0028')).toEqual([`activity ${openOrder}`])
  })

  it('finds an asset by its mark, its serial number and its meter number, and says which it was found by', async () => {
    expect((await search('hz-sh-01')).hits).toEqual([
      expect.objectContaining({ id: boiler, mark: { field: 'mark', value: 'HZ-SH-01' } }),
    ])
    expect((await search('4711')).hits).toEqual([
      expect.objectContaining({ id: boiler, mark: { field: 'serialNumber', value: 'SN-4711' } }),
    ])
    expect((await search('882914')).hits).toEqual([
      expect.objectContaining({ id: meter, mark: { field: 'meterNumber', value: '13-882914' } }),
    ])
  })

  it('finds an evidence by its number, with what it proves and where, and nothing else of it', async () => {
    const number = await evidenceAt(boiler, '2026-09-30')
    const answer = await search(number)

    expect(answer.hits).toEqual([
      {
        kind: 'evidence',
        id: expect.any(String),
        number,
        title: 'Hauptprüfung der Aufzugsanlage',
        performedOn: '2026-09-30',
        place: 'Campus',
      },
    ])
  })

  it('finds an asset by its number and no other with it', async () => {
    const school = await schoolIn(counted, 'Werkhof')
    const numbers = new Map<string, string>()

    // Twelve assets, AN-00001 to AN-00012: the number of the eleventh is held
    // in that of none of the others, while a part of it is held in three.
    for (let index = 1; index <= 12; index++) {
      const id = await assetIn(school.house, { name: `Aufzug ${String(index)}` }, counted)
      const read = await http().get(`/assets/${id}`).set(testIdentityHeader, by('u-lead', counted))

      numbers.set(String(read.body.number), id)
    }

    const eleventh = [...numbers.keys()].sort()[10] ?? ''

    expect(eleventh).toBe('AN-00011')
    expect(await found(eleventh, by('u-tech', counted))).toEqual([
      `asset ${String(numbers.get(eleventh))}`,
    ])
  })

  it('puts the closest first, holds at most five of a kind, and says that there are more without how many', async () => {
    const yard = await schoolIn(counted, 'Pumpwerk')

    for (const name of ['Abwasserpumpe', 'Pumpe Ost', 'Pumpe', 'Zirkulationspumpe 1']) {
      await assetIn(yard.canteen, { name }, counted)
    }

    const first = await search('pumpe', by('u-tech', counted))

    expect(first.hits.map((hit) => (hit.kind === 'asset' ? hit.name : hit.kind))).toEqual([
      'Pumpe',
      'Pumpe Ost',
      'Abwasserpumpe',
      'Zirkulationspumpe 1',
    ])
    expect(first.more).toEqual([])

    for (const name of ['Zirkulationspumpe 2', 'Zirkulationspumpe 3']) {
      await assetIn(yard.canteen, { name }, counted)
    }

    const second = await search('pumpe', by('u-tech', counted))

    expect(second.hits.filter((hit) => hit.kind === 'asset')).toHaveLength(5)
    expect(second.more).toEqual(['asset'])
  })

  it('finds nothing from an area the person does not see, not even as a number, and nothing of another tenant', async () => {
    const inNorth = await schoolIn(large, 'Campus Nord', { areaId: north })
    const inSouth = await schoolIn(large, 'Campus Süd', { areaId: south })
    const northern = await assetIn(inNorth.house, { name: 'Umwälzpumpe Nord' }, large)

    // More in the south than an answer holds, so that "more" would say they are there.
    for (let index = 1; index <= 7; index++) {
      await assetIn(inSouth.house, { name: `Umwälzpumpe Süd ${String(index)}` }, large)
    }

    const southern = await assetIn(
      inSouth.house,
      { name: 'Heizkessel Süd' },
      large,
      inSouth.boilerRoom,
    )
    const southernOrder = await workOrderAt(
      inSouth.canteen,
      'Umwälzpumpe Süd tauschen',
      'AU-2026-0101',
    )
    const southernEvidence = await evidenceAt(southern, '2026-09-01')
    const tech = by('u-tech', large)

    expect(await search('Umwälzpumpe', tech)).toEqual({
      hits: [expect.objectContaining({ kind: 'asset', id: northern })],
      more: [],
    })
    // Not a property, a building, a room, an asset, an activity or an evidence of the south.
    for (const words of [
      'Campus Süd',
      'Umwälzpumpe Süd',
      'Heizkessel Süd',
      'AU-2026-0101',
      southernEvidence,
    ]) {
      expect(await search(words, tech), words).toEqual({ hits: [], more: [] })
    }

    expect(await found('Heizraum', tech)).toEqual([`room ${inNorth.boilerRoom}`])
    expect(await found('Campus', tech)).toEqual([`property ${inNorth.property}`])

    // Whoever sees every area finds both, and the south has more than an answer holds.
    const lead = await search('Umwälzpumpe', by('u-lead', large))

    expect(lead.hits.filter((hit) => hit.kind === 'asset')).toHaveLength(5)
    expect(lead.more).toEqual(['asset'])
    expect(await found('AU-2026-0101', by('u-lead', large))).toEqual([`activity ${southernOrder}`])

    // The other tenant holds a property of this name; nobody here finds it.
    expect(await found('Lindenhain')).toEqual([`property ${school.property}`])
  })

  it('finds for whoever only performs the activities given to them or to nobody', async () => {
    expect(await found('heiz', by('u-tech'))).toEqual([
      `room ${school.boilerRoom}`,
      `asset ${boiler}`,
      `activity ${openOrder}`,
    ])
    expect(await found('AU-2026-0029', by('u-tech'))).toEqual([])
    // Whoever plans and hands out finds both.
    expect(await found('AU-2026-002', by('u-site'))).toEqual([
      `activity ${openOrder}`,
      `activity ${leadsOrder}`,
    ])
  })

  it('finds each kind only for whoever may read it', async () => {
    const number = await evidenceAt(boiler, '2026-08-31')

    expect(await found('heiz', holding('location.read'))).toEqual([`room ${school.boilerRoom}`])
    expect(await found(number, holding('location.read'))).toEqual([])
    expect(await found(number, holding('location.read', 'evidence.read'))).toHaveLength(1)
    expect(await found('heiz', holding('location.read', 'asset.read'))).toEqual([
      `room ${school.boilerRoom}`,
      `asset ${boiler}`,
    ])
    expect(await found('heiz', holding('location.read', 'activity.read'))).toEqual([
      `room ${school.boilerRoom}`,
      `activity ${openOrder}`,
    ])

    // Without the places, no search at all.
    await http()
      .get('/search')
      .query({ q: 'heiz' })
      .set(testIdentityHeader, holding('asset.read'))
      .expect(403)
  })

  it('names nobody in a hit', async () => {
    const number = await evidenceAt(boiler, '2026-07-31')
    const told = JSON.stringify([await search('heiz'), await search(number)])

    // The evidence froze the examiner and the person who wrote it down, the
    // work order the person who answers for it.
    for (const person of ['Erika Muster', 'Prüfstelle Süd', 'u-lead', 'u-duties', 'Probe']) {
      expect(told).not.toContain(person)
    }
  })

  it('asks from two characters to a hundred, and takes the words literally', async () => {
    const refused = async (words: unknown) =>
      (
        await http()
          .get('/search')
          .query(words === undefined ? {} : { q: words })
          .set(testIdentityHeader, by('u-lead'))
          .expect(400)
      ).body.message

    expect(await refused(undefined)).toBe('Gesucht wird ab 2 Zeichen.')
    expect(await refused(' h ')).toBe('Gesucht wird ab 2 Zeichen.')
    expect(await refused('x'.repeat(101))).toBe('Gesucht wird nach höchstens 100 Zeichen.')

    // A percent sign and an underscore are what they are, not a wildcard.
    expect(await search('%%')).toEqual({ hits: [], more: [] })
    expect(await search('__')).toEqual({ hits: [], more: [] })
    // Spaces around and between the words count once.
    expect(await found('  E.14   Heizraum ')).toEqual([`room ${school.boilerRoom}`])
  })
})
