import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  addMonths,
  type BuildingSituation,
  catalogueOf,
  type DefectRegister,
  type DutyRegister,
  type IsoDate,
  type MeterList,
  missingRight,
  type PlacesToDo,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { outcomeOf } from './place-situation.js'
import { as, testIdentities } from './test-identity.js'

/**
 * What is to do at a place (#121, section 4.1 of the concept): the Lagebild of
 * a building and the numbers of every property and building in the list
 * "Liegenschaften". Each number is the total of the list it leads to,
 * narrowed to the place, for the same person on the same day: the register of
 * duties by state, the defects under "Offen", the meters under "fehlt". A duty
 * counts once, never recorded apart from overdue. The last activities of a
 * building come with what came of them and name nobody.
 *
 * An operator with three areas, each with a property of two buildings, stocked
 * alike; whatever a route would not let a test choose is put in past it.
 */

const tenant = newId<'tenant'>() as TenantId
const areas: Record<'north' | 'south' | 'east', string> = { north: '', south: '', east: '' }

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)
/** Met a year before this day, a duty of a year falls due in so many days. */
const metForDueIn = (days: number): IsoDate => addDays(addMonths(today, -12), days)

interface Stocked {
  readonly property: string
  /** Haus A: an overdue duty at an asset, a due one at a room, two meters, defects. */
  readonly house: string
  /** Haus B: a duty never recorded at the building itself, and a meter that rests. */
  readonly annex: string
  /** The activities at Haus A, by what is to come of them. */
  readonly activities: Readonly<Record<string, string>>
}

const stocked: Partial<Record<keyof typeof areas, Stocked>> = {}

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId]?.role as RoleKey)
}

/** A header for the technician with exactly these rights: one that carries rights is taken at its word. */
function holding(...rights: string[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId: tenant, roles: ['technician'], rights })
}

/** A duty of a year at an asset, a room, a building or the property, met on the day named. */
async function dutyAt(
  table: 'assets' | 'rooms' | 'buildings' | 'properties',
  id: string,
  label: string,
  options: { readonly metOn?: IsoDate; readonly endsOn?: IsoDate } = {},
): Promise<string> {
  const column = {
    assets: 'asset_id',
    rooms: 'room_id',
    buildings: 'building_id',
    properties: null,
  }[table]
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id${column === null ? '' : `, ${column}`},
                         label, basis, source_note, counting, interval_months, confirmed_by,
                         ends_on)
     select tenant_id, ${table === 'properties' ? 'id' : 'property_id'},
            area_id${column === null ? '' : ', id'}, $2, 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-lead', $3::date
       from ${table} where id = $1
     returning id`,
    [id, label, options.endsOn ?? null],
  )
  const duty = rows[0]?.id ?? ''

  if (options.metOn !== undefined) {
    await admin.query(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       select tenant_id, property_id, area_id, id, $2::date, 'without_defects',
              ${writtenPlaceholders(3)}
         from duties where id = $1`,
      [duty, options.metOn, ...writtenValues('u-lead', options.metOn, 'without_defects')],
    )
  }

  return duty
}

/** A defect at an asset, a room or a building, in a status. */
async function defectAt(
  table: 'assets' | 'rooms' | 'buildings',
  id: string,
  status: 'found' | 'ordered' | 'remedied' | 'verified',
): Promise<void> {
  const column = { assets: 'asset_id', rooms: 'room_id', buildings: 'building_id' }[table]

  await admin.query(
    `insert into defects (tenant_id, property_id, area_id, ${column}, description, found_on,
                          status, checked_on)
     select tenant_id, property_id, area_id, id, 'Leck', $2::date, $3::defect_status,
            case when $3::defect_status = 'verified' then $2::date end
       from ${table} where id = $1`,
    [id, daysAgo(5), status],
  )
}

/**
 * An activity at an asset, in a state, due on a day and performed on it where
 * it was performed, with what came of its duty. One begun or closed was last
 * changed when it is made, which the database says, today.
 */
async function activityAt(
  asset: string,
  duty: string | null,
  made: {
    readonly kind: string
    readonly title: string
    readonly status: string
    readonly day: IsoDate
    readonly result?: string
    readonly closingReason?: string
  },
): Promise<string> {
  const performed = made.status === 'done' || made.status === 'signed'
  const { rows } = await admin.query<{ id: string }>(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             due_on, performed_on, closing_reason, responsible_user_id,
                             performer, performer_user_id)
     select tenant_id, property_id, area_id, id, $2, $3, $4, $5::date, $6::date, $7, 'u-site',
            'own_staff', 'u-tech'
       from assets where id = $1
     returning id`,
    [
      asset,
      made.kind,
      made.title,
      made.status,
      made.day,
      performed ? made.day : null,
      made.closingReason ?? null,
    ],
  )
  const activity = rows[0]?.id ?? ''

  if (duty !== null) {
    await admin.query(
      `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result,
                                    result_reason)
       select tenant_id, property_id, area_id, $1, id, $3::evidence_result, $4
         from duties where id = $2`,
      [
        activity,
        duty,
        made.result ?? null,
        made.result === 'not_performed' ? 'Kein Zugang.' : null,
      ],
    )
  }

  return activity
}

/** One area stocked as the head of this file says. */
async function stock(area: string, name: string): Promise<Stocked> {
  const header = by('u-lead')
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name,
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    areaId: area,
  })
  const house = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const annex = await made(`/properties/${property}/buildings`, {
    name: 'Haus B',
    kinds: ['office'],
  })
  const floor = await made(`/buildings/${house}/floors`, { name: 'Erdgeschoss', level: 0 })
  const room = await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' })
  const lift = await made(`/buildings/${house}/assets`, { kind: 'probe.elevator', name: 'Aufzug' })
  const meter = (building: string, mark: string) =>
    made(`/buildings/${building}/assets`, {
      kind: 'probe.water_meter',
      name: `Wasserzähler ${mark}`,
      meterNumber: `9WAT${mark}`,
      meterUnit: 'cubic_metres',
    })

  // Haus A: overdue at the elevator, due at the room, met, and one that ended.
  const overdue = await dutyAt('assets', lift, 'Überfällig', { metOn: metForDueIn(-30) })

  await dutyAt('rooms', room, 'Fällig', { metOn: metForDueIn(10) })
  await dutyAt('assets', lift, 'Erfüllt', { metOn: metForDueIn(100) })
  await dutyAt('assets', lift, 'Beendet', { metOn: metForDueIn(-30), endsOn: daysAgo(1) })
  // Haus B and the property itself: never recorded, and overdue.
  await dutyAt('buildings', annex, 'Nie erfasst')
  await dutyAt('properties', property, 'Liegenschaft überfällig', { metOn: metForDueIn(-60) })

  // Defects: two open at Haus A, one checked again there, one remedied at Haus B.
  await defectAt('assets', lift, 'found')
  await defectAt('rooms', room, 'ordered')
  await defectAt('rooms', room, 'verified')
  await defectAt('buildings', annex, 'remedied')

  // Two meters in Haus A without a reading; one in Haus B that rests.
  await meter(house, `${name.slice(0, 3)}1`)
  await meter(house, `${name.slice(0, 3)}2`)

  const resting = await meter(annex, `${name.slice(0, 3)}3`)

  await http()
    .post(`/meters/${resting}/pauses`)
    .set(testIdentityHeader, header)
    .send({ startsOn: daysAgo(400), endsOn: null, reason: 'Leerstand' })
    .expect(201)

  // The activities at Haus A, the newest last made.
  const activities = {
    withDefects: await activityAt(lift, overdue, {
      kind: 'inspection',
      title: 'Hauptprüfung mit Mängeln',
      status: 'done',
      day: daysAgo(40),
      result: 'with_defects',
    }),
    failed: await activityAt(lift, overdue, {
      kind: 'inspection',
      title: 'Prüfung nicht bestanden',
      status: 'done',
      day: daysAgo(30),
      result: 'failed',
    }),
    clean: await activityAt(lift, overdue, {
      kind: 'maintenance',
      title: 'Wartung ohne Mangel',
      status: 'done',
      day: daysAgo(20),
      result: 'without_defects',
    }),
    notPerformed: await activityAt(lift, overdue, {
      kind: 'inspection',
      title: 'Nicht durchgeführt',
      status: 'not_performed',
      day: daysAgo(10),
      result: 'not_performed',
      closingReason: 'Kein Zugang.',
    }),
    signed: await activityAt(lift, null, {
      kind: 'round',
      title: 'Rundgang unterschrieben',
      status: 'signed',
      day: daysAgo(5),
    }),
    started: await activityAt(lift, null, {
      kind: 'round',
      title: 'Rundgang begonnen',
      status: 'started',
      day: daysAgo(2),
    }),
    open: await activityAt(lift, null, {
      kind: 'inspection',
      title: 'Noch offen',
      status: 'open',
      day: daysAgo(1),
    }),
  }

  return { property, house, annex, activities }
}

async function situation(header: string, building: string): Promise<BuildingSituation> {
  return (
    await http().get(`/overview/buildings/${building}`).set(testIdentityHeader, header).expect(200)
  ).body
}

async function places(header: string): Promise<PlacesToDo> {
  return (await http().get('/overview/places').set(testIdentityHeader, header).expect(200)).body
}

async function listOf<Body>(
  path: string,
  query: Readonly<Record<string, string>>,
  header: string,
): Promise<Body> {
  return (await http().get(path).query(query).set(testIdentityHeader, header).expect(200)).body
}

/** What the lists narrowed to a place hold, as the numbers of that place are to say it. */
async function listsAt(
  header: string,
  place: { readonly buildingId: string } | { readonly propertyId: string },
) {
  const duties = async (state: string) =>
    (await listOf<DutyRegister>('/duties/register', { ...place, state }, header)).total
  const meterPlace: Record<string, string> =
    'buildingId' in place ? { building: place.buildingId } : { property: place.propertyId }

  return {
    overdue: await duties('overdue'),
    due: await duties('due'),
    neverRecorded: await duties('never_recorded'),
    openDefects: (await listOf<DefectRegister>('/defects', { ...place, state: 'open' }, header))
      .total,
    missingReadings: (
      await listOf<MeterList>('/meters', { ...meterPlace, state: 'missing' }, header)
    ).meters.length,
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Stadt Probe'])

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd'), ($1, 'Ost')
     returning id, name`,
    [tenant],
  )

  areas.north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  areas.south = rows.find((row) => row.name === 'Süd')?.id ?? ''
  areas.east = rows.find((row) => row.name === 'Ost')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [person.role],
    ])
  }

  // The Objektleitung works in two of the three areas, the technician in one.
  for (const [userId, area] of [
    ['u-site', areas.north],
    ['u-site', areas.south],
    ['u-tech', areas.north],
  ] as const) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [tenant, userId, area],
    )
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  stocked.north = await stock(areas.north, 'Werkhof Nord')
  stocked.south = await stock(areas.south, 'Schulzentrum Süd')
  stocked.east = await stock(areas.east, 'Bürgerhaus Ost')
}, 180_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the Lagebild of a building', () => {
  it('counts every number as its list narrowed to the building counts it, for each person', async () => {
    const north = stocked.north as Stocked

    for (const userId of ['u-lead', 'u-site', 'u-tech'] as const) {
      for (const building of [north.house, north.annex]) {
        const read = await situation(by(userId), building)

        expect(
          {
            overdue: read.overdue,
            due: read.due,
            neverRecorded: read.neverRecorded,
            openDefects: read.openDefects,
            missingReadings: read.missingReadings,
          },
          `${userId} ${building === north.house ? 'Haus A' : 'Haus B'}`,
        ).toEqual(await listsAt(by(userId), { buildingId: building }))
      }
    }
  })

  it('counts what each building holds, a duty once, never recorded apart from overdue', async () => {
    const north = stocked.north as Stocked

    expect(await situation(by('u-lead'), north.house)).toMatchObject({
      overdue: 1,
      due: 1,
      neverRecorded: 0,
      openDefects: 2,
      missingReadings: 2,
    })
    expect(await situation(by('u-lead'), north.annex)).toMatchObject({
      overdue: 0,
      due: 0,
      neverRecorded: 1,
      openDefects: 1,
      missingReadings: 0,
    })
  })

  it('lists the last activities at the building, the newest first, with what came of them, and names nobody', async () => {
    const north = stocked.north as Stocked
    const read = await situation(by('u-lead'), north.house)

    // Begun and closed today, the day they were last changed; the newer change first.
    expect(
      read.lastActivities?.map((each) => [each.title, each.kind, each.outcome, each.day]),
    ).toEqual([
      ['Rundgang begonnen', 'round', 'started', today],
      ['Nicht durchgeführt', 'inspection', 'not_performed', today],
      ['Rundgang unterschrieben', 'round', 'signed', daysAgo(5)],
      ['Wartung ohne Mangel', 'maintenance', 'without_defects', daysAgo(20)],
      ['Prüfung nicht bestanden', 'inspection', 'failed', daysAgo(30)],
    ])

    const body = JSON.stringify(read)

    for (const [userId, person] of Object.entries(people)) {
      expect(body).not.toContain(userId)
      expect(body).not.toContain(person.name)
    }

    // Haus B has none; what happened at Haus A is not its.
    expect((await situation(by('u-lead'), north.annex)).lastActivities).toEqual([])
  })

  it('is not there for a building the person does not see, nor for one that is no id', async () => {
    const east = stocked.east as Stocked

    for (const building of [east.house, newId<'building'>(), 'kein-gebaeude']) {
      await http()
        .get(`/overview/buildings/${building}`)
        .set(testIdentityHeader, by('u-site'))
        .expect(404, /Dieses Gebäude gibt es nicht oder nicht mehr/)
    }
  })

  it('leaves out what the person may not read, and is for whoever reads duties', async () => {
    const north = stocked.north as Stocked

    expect(await situation(holding('duty.read'), north.house)).toMatchObject({
      overdue: 1,
      openDefects: null,
      missingReadings: null,
      lastActivities: null,
    })

    const refused = await http()
      .get(`/overview/buildings/${north.house}`)
      .set(testIdentityHeader, holding('defect.read', 'asset.read', 'activity.read'))
      .expect(403)

    expect(refused.body.message).toBe(missingRight('duty.read'))
  })
})

describe('the numbers of the list "Liegenschaften"', () => {
  it('counts every property and every building as its list narrowed to it counts it, in one answer', async () => {
    for (const userId of ['u-lead', 'u-site', 'u-tech'] as const) {
      const read = await places(by(userId))

      for (const property of read.properties) {
        const { buildings, propertyId, ...numbers } = property

        expect(numbers, `${userId} ${propertyId}`).toEqual(
          await listsAt(by(userId), { propertyId }),
        )

        for (const { buildingId, ...ofBuilding } of buildings) {
          expect(ofBuilding, `${userId} ${buildingId}`).toEqual(
            await listsAt(by(userId), { buildingId }),
          )
        }
      }
    }
  })

  it('holds the properties of the areas of the person, each with what is to do over all of it', async () => {
    const north = stocked.north as Stocked
    const lead = await places(by('u-lead'))
    const site = await places(by('u-site'))
    const tech = await places(by('u-tech'))

    expect(lead.properties).toHaveLength(3)
    expect(site.properties).toHaveLength(2)
    expect(tech.properties.map((property) => property.propertyId)).toEqual([north.property])
    // Over the property: the overdue duty at the property itself as well.
    expect(tech.properties[0]).toMatchObject({
      overdue: 2,
      due: 1,
      neverRecorded: 1,
      openDefects: 3,
      missingReadings: 2,
    })
  })

  it('leaves out the numbers the person may not read, and is for whoever reads duties', async () => {
    const read = await places(holding('duty.read'))

    expect(read.properties[0]).toMatchObject({ openDefects: null, missingReadings: null })
    await http()
      .get('/overview/places')
      .set(testIdentityHeader, holding('defect.read', 'asset.read'))
      .expect(403)
  })
})

describe('what came of an activity', () => {
  it('is its state while it is not done, and once it is, the worst its duties and the defects found in it say', () => {
    expect(outcomeOf('inspection', 'started', [], false)).toBe('started')
    expect(outcomeOf('round', 'signed', [], false)).toBe('signed')
    expect(outcomeOf('inspection', 'not_performed', ['not_performed'], false)).toBe('not_performed')
    expect(outcomeOf('inspection', 'done', ['without_defects', 'failed'], false)).toBe('failed')
    expect(outcomeOf('inspection', 'done', ['without_defects', 'with_defects'], false)).toBe(
      'with_defects',
    )
    expect(outcomeOf('round', 'done', [], true)).toBe('with_defects')
    expect(outcomeOf('maintenance', 'done', ['without_defects'], false)).toBe('without_defects')
    expect(outcomeOf('work_order', 'done', [], true)).toBe('done')
  })
})
