import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
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

import { ApiModule } from '../api/api.module.js'
import { as, testIdentities } from '../api/test-identity.js'
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
import { runDeadlinesOf } from './engine.js'

/**
 * The deadlines of an operator through the routes of the foundation (#25):
 * the list with the duty and the property an entry hangs on, the settings of
 * the kind, for whoever may look after the deadlines (section 7 of the
 * concept), and only in the areas of the person who asks (ADR 0003).
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

const catalogue = catalogueOf(probeCatalogueBundle)
const october = new Date('2026-10-05T10:00:00Z')

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

let places = 0

/** One page of the list of deadlines, as the route answers it. */
interface Page {
  readonly rows: readonly {
    readonly dutyId: string
    readonly responsible: { readonly userId: string } | null
  }[]
  readonly total: number | null
  readonly more: boolean
}

/** The page of deadlines a person is answered for the question in the address. */
async function pageOf(
  userId: keyof typeof people & string,
  query = '',
  tenantId: TenantId = small,
): Promise<Page> {
  const answer = await http()
    .get(query === '' ? '/deadlines' : `/deadlines?${query}`)
    .set(testIdentityHeader, by(userId, tenantId))
    .expect(200)

  return answer.body as Page
}

/**
 * An elevator with its main test, met on a day, in the first area of the
 * operator or the one named, at a property of the name given.
 */
async function dutyWithEvidence(
  tenantId: TenantId,
  performedOn: string,
  areaId?: string,
  propertyName = 'Schulzentrum Am Neckar',
): Promise<{ duty: string; property: string }> {
  places += 1

  const { rows } = await admin.query<{ duty: string; property: string }>(
    `with property as (
       insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, coalesce($2::uuid, (select id from areas where tenant_id = $1 order by name limit 1)),
              $13, 'Neckarstraße 4', '68535', 'Edingen-Neckarhausen', 'DE-BW'
       returning id, area_id
     ), building as (
       insert into buildings (tenant_id, property_id, area_id, name, kinds)
       select $1, id, area_id, 'Haus A', '{school}' from property
       returning id, property_id, area_id
     ), elevator as (
       insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
       select $1, property_id, area_id, id, 'probe.elevator', $3, 'Aufzug Haus A' from building
       returning id, property_id, area_id
     ), duty as (
       insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                           interval_months, maximum_months, confirmed_by)
       select $1, property_id, area_id, id, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24,
              'u-duties'
         from elevator
       returning id, property_id, area_id
     ), done as (
       insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       select $1, property_id, area_id, id, $4, 'without_defects', ${writtenPlaceholders(5)}
         from duty
     )
     select id as duty, property_id as property from duty`,
    [
      tenantId,
      areaId ?? null,
      `AN-${String(places).padStart(5, '0')}`,
      performedOn,
      ...writtenValues('u-duties', performedOn, 'without_defects'),
      propertyName,
    ],
  )

  return rows[0] as { duty: string; property: string }
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

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  // In the large operator the technical management looks after the north
  // alone; the Leitung keeps every area.
  await admin.query('delete from member_all_areas where tenant_id = $1 and user_id = $2', [
    large,
    'u-duties',
  ])
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-duties',
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

describe('the list of deadlines', () => {
  it('names the duty and the property a deadline hangs on, with the kind and its lead', async () => {
    const { duty, property } = await dutyWithEvidence(small, '2025-03-14')

    await runDeadlinesOf({ database, catalogue, now: () => october }, small, october)

    const answer = await http()
      .get('/deadlines')
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    expect(answer.body).toMatchObject({ total: 1, more: false })
    expect((answer.body as Page).rows).toEqual([
      expect.objectContaining({
        kind: 'duty.due',
        kindTitle: 'Fälligkeit einer Pflicht',
        status: 'open',
        anchorOn: '2025-03-14',
        dueOn: '2027-03-01',
        leadDays: 30,
        remindOn: '2027-01-30',
        source: { label: 'Hauptprüfung der Aufzugsanlage, Aufzug Haus A (AN-00001)' },
        dutyId: duty,
        dutyTitle: 'Hauptprüfung der Aufzugsanlage',
        propertyId: property,
        buildingId: expect.any(String) as unknown,
        roomId: null,
        asset: { id: expect.any(String), number: 'AN-00001', name: 'Aufzug Haus A' },
      }),
    ])
  })

  it('shows the north what is in the north, and the Leitung both', async () => {
    const inNorth = await dutyWithEvidence(large, '2025-03-14', north)
    const inSouth = await dutyWithEvidence(large, '2025-05-02', south)

    await runDeadlinesOf({ database, catalogue, now: () => october }, large, october)

    const seen = async (userId: keyof typeof people & string) =>
      (await pageOf(userId, '', large)).rows.map((entry) => entry.dutyId).sort()

    expect(await seen('u-duties')).toEqual([inNorth.duty])
    expect(await seen('u-lead')).toEqual([inNorth.duty, inSouth.duty].sort())
  })

  // #104, acceptance 1: looking after the deadlines and their settings is
  // for the Leitung and the Technische Leitung, a test for each role.
  it.each([
    ['u-lead', true],
    ['u-duties', true],
    ['u-site', false],
    ['u-tech', false],
  ] as const)('%s looks after the deadlines and their settings: %s', async (userId, may) => {
    // One after the other: each request listens and closes on its own.
    const asked = [
      () => http().get('/deadlines'),
      () => http().get('/settings/deadlines'),
      () => http().patch(`/deadlines/${newId()}`).send({ leadDays: 3 }),
      () => http().put('/settings/deadlines/duty.unknown').send({ leadDays: 3 }),
    ]
    const answers = []

    for (const question of asked) {
      answers.push(await question().set(testIdentityHeader, by(userId)))
    }

    expect(answers.map((answer) => answer.status)).toEqual(
      may ? [200, 200, 404, 404] : [403, 403, 403, 403],
    )

    if (!may) {
      expect(answers.map((answer) => (answer.body as { message: string }).message)).toEqual([
        missingRight('deadline.read'),
        missingRight('deadline.read'),
        missingRight('deadline.write'),
        missingRight('deadline.write'),
      ])
    }
  })

  // #75: a property and an area narrow the list, and the search finds a
  // property by its name, all in the areas of the person.
  it('narrows to a property and to an area, and finds a property by its name', async () => {
    const harbour = await dutyWithEvidence(large, '2025-06-02', north, 'Hafenamt Rheinau')
    const depot = await dutyWithEvidence(large, '2025-06-03', south, 'Betriebshof Seckenheim')

    await runDeadlinesOf({ database, catalogue, now: () => october }, large, october)

    const duties = async (query: string, userId: 'u-lead' | 'u-duties' = 'u-lead') =>
      (await pageOf(userId, query, large)).rows.map((entry) => entry.dutyId)

    expect(await pageOf('u-lead', `property=${harbour.property}`, large)).toMatchObject({
      rows: [{ dutyId: harbour.duty }],
      total: 1,
    })
    expect(await duties(`area=${south}`)).toContain(depot.duty)
    expect(await duties(`area=${south}`)).not.toContain(harbour.duty)
    expect(await duties('search=hafenamt')).toEqual([harbour.duty])
    expect(await duties(`property=${depot.property}`, 'u-duties')).toEqual([])

    for (const query of ['property=Hafenamt', 'area=Nord']) {
      await http()
        .get(`/deadlines?${query}`)
        .set(testIdentityHeader, by('u-lead', large))
        .expect(400)
    }
  })

  // Narrowed to a person the list names no number (Moritz, 08.10.2026, as in
  // the register of duties): neither how many deadlines the person has nor
  // how many of them are late.
  it('narrowed to a person, names no number and says all the same whether more follow', async () => {
    const named = [
      await dutyWithEvidence(small, '2025-04-01'),
      await dutyWithEvidence(small, '2025-04-02'),
    ]

    await admin.query('update duties set responsible_user_id = $1 where id = any($2)', [
      'u-duties',
      named.map((one) => one.duty),
    ])
    await runDeadlinesOf({ database, catalogue, now: () => october }, small, october)

    const all = await pageOf('u-lead')
    const theirs = await pageOf('u-lead', 'person=u-duties&limit=1')

    expect(all.total).toBeGreaterThan(2)
    expect(theirs).toMatchObject({ total: null, more: true })
    expect(theirs.rows.map((entry) => entry.responsible?.userId)).toEqual(['u-duties'])
    expect(await pageOf('u-lead', 'person=u-site')).toEqual({
      rows: [],
      total: null,
      more: false,
    })
  })
})

describe('the settings of a kind', () => {
  it('give the lead of the kind and take a lead of the operator own, and no interval', async () => {
    const kinds = await http()
      .get('/settings/deadlines')
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    expect(kinds.body).toEqual([
      expect.objectContaining({
        key: 'duty.due',
        title: 'Fälligkeit einer Pflicht',
        source: 'duty',
        actions: ['reminder', 'activity'],
        responsible: 'source',
        intervalDays: null,
        intervalMonths: null,
        leadDays: 30,
      }),
      expect.objectContaining({
        key: 'defect.due',
        title: 'Frist zur Beseitigung eines Mangels',
        source: 'defect',
        actions: ['reminder'],
        responsible: 'lead',
        intervalDays: null,
        intervalMonths: null,
        leadDays: 7,
      }),
      expect.objectContaining({
        key: 'round.due',
        title: 'Rundgang nach Plan',
        source: 'round_plan',
        actions: ['activity'],
        responsible: 'lead',
        intervalDays: null,
        intervalMonths: null,
        leadDays: 14,
      }),
    ])

    await http()
      .put('/settings/deadlines/duty.due')
      .set(testIdentityHeader, by('u-duties'))
      .send({ leadDays: 14 })
      .expect(200)

    expect(
      (
        await http()
          .put('/settings/deadlines/duty.due')
          .set(testIdentityHeader, by('u-duties'))
          .send({ intervalMonths: 12 })
          .expect(400)
      ).body.message,
    ).toBe('Bei dieser Art nennt die Quelle den Tag, eine eigene Frist gibt es nicht.')

    const { body } = await http()
      .get('/deadlines')
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
    const { rows } = body as { rows: { leadDays: number }[] }

    expect(rows).not.toHaveLength(0)
    expect(rows.every((entry) => entry.leadDays === 14)).toBe(true)
  })
})
