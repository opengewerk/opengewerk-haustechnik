import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityCandidates,
  type ActivityDetails,
  type ActivityList,
  addDays,
  catalogueOf,
  type DutyDetails,
  type IsoDate,
  missingRight,
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
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The inspections and the maintenance in the office (#105, section 4.4 of the
 * concept): the list "Prüfungen", the page of an activity and its plan, and
 * closing one with the reason and making one by hand (#183).
 * Whoever plans and hands out work sees every activity in their areas and
 * names who answers for one and who performs it, among the people who see
 * its area; whoever only performs sees what is given to them or to nobody,
 * and gets an inspection given to them onto their device with the next sync.
 *
 * The activities are put in past the application: the engine makes them, and
 * `deadlines/engine.test.ts` holds how.
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  'u-south': { role: 'technician', name: 'Murat Yilmaz' },
  'u-gone': { role: 'technician', name: 'Lena Vogt' },
}

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const inDays = (days: number): IsoDate => addDays(today, days)

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the operators. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** A property with a building and an elevator in it, made by the Technische Leitung. */
async function elevatorIn(
  tenantId: TenantId = small,
  area: string | null = null,
  name = 'Schulzentrum Am Neckar',
): Promise<string> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name,
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...(area === null ? {} : { areaId: area }),
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })

  return made(`/buildings/${building}/assets`, { kind: 'probe.elevator', name: 'Aufzug' })
}

/** The main test of the elevator from the catalogue, at most every 24 months. */
async function mainTestAt(asset: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, maximum_months, confirmed_by)
     select tenant_id, property_id, area_id, id, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24,
            'u-duties'
       from assets where id = $1
     returning id`,
    [asset],
  )

  return rows[0]?.id ?? ''
}

interface Made {
  readonly kind?: string
  readonly title?: string
  readonly status?: string
  readonly dueOn?: IsoDate
  readonly responsible?: string | null
  readonly performerUserId?: string | null
}

/** An activity that is to meet a duty, at the place of the duty, as the engine makes one. */
async function activityFor(duty: string, made: Made = {}): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `with activity as (
       insert into activities (tenant_id, property_id, area_id, building_id, room_id, asset_id, kind,
                               title, status, due_on, responsible_user_id, performer,
                               performer_user_id)
       select tenant_id, property_id, area_id, building_id, room_id, asset_id, $2, $3, $4, $5, $6,
              case when $7::text is null then null else 'own_staff'::duty_performer end, $7
         from duties where id = $1
       returning id, tenant_id, property_id, area_id
     ), line as (
       insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       select tenant_id, property_id, area_id, id, $1 from activity
     )
     select id from activity`,
    [
      duty,
      made.kind ?? 'inspection',
      made.title ?? 'Hauptprüfung der Aufzugsanlage',
      made.status ?? 'open',
      made.dueOn ?? inDays(20),
      made.responsible === undefined ? 'u-duties' : made.responsible,
      made.performerUserId ?? null,
    ],
  )

  return rows[0]?.id ?? ''
}

/** An evidence of a duty on a day, put in past the application. */
async function evidenceOf(duty: string, performedOn: IsoDate): Promise<void> {
  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, 'without_defects',
            ${writtenPlaceholders(3)}
       from duties where id = $1`,
    [duty, performedOn, ...writtenValues('u-duties', performedOn, 'without_defects')],
  )
}

/** The page of a duty, as somebody reads it. */
async function dutyPage(duty: string, header: string = by('u-lead')): Promise<DutyDetails> {
  return (await http().get(`/duties/${duty}`).set(testIdentityHeader, header).expect(200))
    .body as DutyDetails
}

/** A page of the list, as somebody asks it. */
async function listed(header: string, address = ''): Promise<ActivityList> {
  return (await http().get(`/activities${address}`).set(testIdentityHeader, header).expect(200))
    .body as ActivityList
}

/** The page of an activity, as somebody reads it. */
async function pageOf(id: string, header: string = by('u-lead')): Promise<ActivityDetails> {
  return (await http().get(`/activities/${id}`).set(testIdentityHeader, header).expect(200))
    .body as ActivityDetails
}

/** The rows of a kind of record a device of somebody is sent. */
async function pulled(header: string, entity: string): Promise<Record<string, unknown>[]> {
  const answer = await http().get('/sync?since=0').set(testIdentityHeader, header).expect(200)
  const change = (
    answer.body.changes as { entity: string; rows: Record<string, unknown>[] }[]
  ).find((each) => each.entity === entity)

  return change?.rows ?? []
}

/** A plan that the own people carry out, due in a month. */
const ownPlan = {
  responsibleUserId: 'u-site',
  performer: 'own_staff',
  performerUserId: 'u-tech',
  contractorNote: null,
  dueOn: inDays(30),
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

  // The roles each operator starts with, which say who may plan and who
  // performs, as the rows of a real operator do.
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

  // In the large operator the Objektleitung and one technician work in the
  // north, the other technician in the south.
  for (const [userId, area] of [
    ['u-site', north],
    ['u-tech', north],
    ['u-gone', north],
    ['u-south', south],
  ] as const) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [large, userId, area],
    )
  }

  // One technician has left both operators.
  await admin.query("update memberships set blocked_at = now() where user_id = 'u-gone'")

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

describe('the list "Prüfungen"', () => {
  it('holds the inspections and the maintenance, the earliest due day first, a page at a time, and no round', async () => {
    const tenantId = newId<'tenant'>() as TenantId

    // An operator of its own, so that nothing of the other tests is listed.
    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenantId,
      'Stift Lindenhof',
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenantId,
      'u-duties',
      ['technical_management'],
    ])

    const duty = await mainTestAt(await elevatorIn(tenantId))
    const later = await activityFor(duty, {
      kind: 'maintenance',
      title: 'Wartung',
      dueOn: inDays(40),
    })
    const sooner = await activityFor(duty, { dueOn: inDays(5) })

    await activityFor(duty, { kind: 'round', title: 'Rundgang', dueOn: inDays(1) })

    const header = by('u-duties', tenantId)
    const first = await listed(header, '?limit=1')

    expect(first).toMatchObject({ total: 2, more: true })
    expect(first.activities.map((entry) => entry.id)).toEqual([sooner])
    expect((await listed(header, '?offset=1&limit=1')).activities.map((each) => each.id)).toEqual([
      later,
    ])
    expect((await listed(header)).activities[0]).toMatchObject({
      id: sooner,
      kind: 'inspection',
      title: 'Hauptprüfung der Aufzugsanlage',
      status: 'open',
      dueOn: inDays(5),
      responsible: { userId: 'u-duties', name: 'Jörg Albrecht' },
      performer: null,
      performerPerson: null,
    })
    expect((await listed(header, '?kind=maintenance')).activities.map((each) => each.id)).toEqual([
      later,
    ])
  })

  it('narrows by state, by property and by a search through the title, the asset and the property', async () => {
    const atNeckar = await mainTestAt(await elevatorIn(small, null, 'Haus am Neckarufer'))
    const atRhine = await mainTestAt(await elevatorIn(small, null, 'Rheinschule'))
    const open = await activityFor(atNeckar, { title: 'Prüfung Neckarufer 7' })
    const done = await activityFor(atRhine, { status: 'done', title: 'Prüfung 50% Rhein' })
    const header = by('u-lead')
    const ids = async (address: string) =>
      (await listed(header, address)).activities.map((entry) => entry.id)

    expect(await ids('?search=neckarufer')).toEqual([open])

    const { rows: numbered } = await admin.query<{ number: string }>(
      'select s.number from activities a join assets s on s.id = a.asset_id where a.id = $1',
      [open],
    )

    expect(await ids(`?state=all&search=${numbered[0]?.number ?? ''}`)).toEqual([open])
    expect(await ids('?search=rheinschule')).toEqual([])
    expect(await ids('?state=done&search=rheinschule')).toEqual([done])
    expect(await ids('?state=all&search=50%25')).toEqual([done])
    expect(await ids('?state=all&search=%25')).toContain(done)

    const { rows } = await admin.query<{ property_id: string }>(
      'select property_id from activities where id = $1',
      [open],
    )
    const property = rows[0]?.property_id ?? ''

    expect(await ids(`?state=all&property=${property}`)).toEqual([open])
    expect(await ids('?state=all&property=keine-kennung')).toEqual([])

    await http()
      .get('/activities?state=planned')
      .set(testIdentityHeader, header)
      .expect(400, /Der Stand ist einer von/)
    await http()
      .get('/activities?kind=round')
      .set(testIdentityHeader, header)
      .expect(400, /Die Art ist eine von/)
  })
})

describe('who sees which activity', () => {
  it('shows whoever plans every activity in their areas, and whoever only performs what is given to them or to nobody', async () => {
    const inNorth = await mainTestAt(await elevatorIn(large, north))
    const inSouth = await mainTestAt(await elevatorIn(large, south))
    const theirs = await activityFor(inNorth, { responsible: null, performerUserId: 'u-tech' })
    const nobodys = await activityFor(inNorth, { responsible: null })
    const another = await activityFor(inNorth, { responsible: 'u-site' })
    const southern = await activityFor(inSouth, { responsible: null })
    const seen = async (userId: string) =>
      (await listed(by(userId, large), '?limit=200')).activities.map((entry) => entry.id)

    expect(await seen('u-site')).toEqual(expect.arrayContaining([theirs, nobodys, another]))
    expect(await seen('u-site')).not.toContain(southern)
    expect(await seen('u-lead')).toEqual(
      expect.arrayContaining([theirs, nobodys, another, southern]),
    )
    expect((await seen('u-tech')).sort()).toEqual([theirs, nobodys].sort())

    // Not even by its address.
    await http()
      .get(`/activities/${another}`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(404, /Diesen Vorgang gibt es nicht oder nicht mehr/)
    await http()
      .get(`/activities/${southern}`)
      .set(testIdentityHeader, by('u-site', large))
      .expect(404)
    expect((await pageOf(theirs, by('u-tech', large))).performerPerson).toEqual({
      userId: 'u-tech',
      name: 'Tobias Wendt',
    })
  })
})

describe('the page of an activity', () => {
  it('names each duty with its source, its interval, how it stands, the qualification and what came of it', async () => {
    const duty = await mainTestAt(await elevatorIn())
    const id = await activityFor(duty)

    await admin.query(
      `update activity_duties set result = 'not_performed', result_reason = 'Anlage abgeschaltet'
        where activity_id = $1`,
      [id],
    )

    const page = await pageOf(id)

    expect(page).toMatchObject({ id, kind: 'inspection', status: 'open', performedOn: null })
    expect(Date.parse(page.createdAt)).not.toBeNaN()
    expect(page.duties).toEqual([
      {
        id: expect.any(String),
        dutyId: duty,
        title: 'Hauptprüfung der Aufzugsanlage',
        source: '§ 16 Abs. 1, § 17 Abs. 1 und Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV',
        interval: { months: 24 },
        state: 'never_recorded',
        appointment: null,
        lastMetOn: null,
        qualification: 'approved_body',
        takesReport: true,
        result: 'not_performed',
        resultReason: 'Anlage abgeschaltet',
      },
    ])
  })
})

describe('the plan of an activity', () => {
  it('offers who plans and who performs among the people who see its area and have not left', async () => {
    const id = await activityFor(await mainTestAt(await elevatorIn(large, north)))
    const offered = (
      await http()
        .get(`/activities/${id}/candidates`)
        .set(testIdentityHeader, by('u-site', large))
        .expect(200)
    ).body as ActivityCandidates

    expect(offered.responsible.map((person) => person.userId)).toEqual([
      'u-site',
      'u-duties',
      'u-lead',
    ])
    expect(offered.performers).toEqual([
      { userId: 'u-site', name: 'Dennis Roth' },
      { userId: 'u-duties', name: 'Jörg Albrecht' },
      { userId: 'u-lead', name: 'Sabine Krämer' },
      { userId: 'u-tech', name: 'Tobias Wendt' },
    ])
  })

  it('names who answers for it, who performs it and the day, and moves nothing of its duty', async () => {
    const duty = await mainTestAt(await elevatorIn())
    const id = await activityFor(duty)
    const before = (
      await http().get(`/duties/${duty}`).set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as { appointment: unknown }

    const planned = (
      await http()
        .put(`/activities/${id}/plan`)
        .set(testIdentityHeader, by('u-site'))
        .send(ownPlan)
        .expect(200)
    ).body as ActivityDetails

    expect(planned).toMatchObject({
      responsible: { userId: 'u-site', name: 'Dennis Roth' },
      performer: 'own_staff',
      performerPerson: { userId: 'u-tech', name: 'Tobias Wendt' },
      contractorNote: null,
      dueOn: inDays(30),
      status: 'open',
    })

    // A contractor instead, named in words.
    expect(
      (
        await http()
          .put(`/activities/${id}/plan`)
          .set(testIdentityHeader, by('u-site'))
          .send({
            ...ownPlan,
            performer: 'contractor',
            performerUserId: '',
            contractorNote: ' Aufzug Beispiel GmbH ',
          })
          .expect(200)
      ).body,
    ).toMatchObject({
      performer: 'contractor',
      performerPerson: null,
      contractorNote: 'Aufzug Beispiel GmbH',
    })

    const after = (
      await http().get(`/duties/${duty}`).set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as { appointment: unknown }

    expect(after.appointment).toEqual(before.appointment)
  })

  it('is not for whoever only performs, and names nobody who could not be named', async () => {
    const id = await activityFor(await mainTestAt(await elevatorIn(large, north)))
    const plan = (header: string, body: object) =>
      http().put(`/activities/${id}/plan`).set(testIdentityHeader, header).send(body)

    const refused = await plan(by('u-tech', large), ownPlan).expect(403)

    expect(refused.body.message).toBe(missingRight('activity.write'))
    await http()
      .get(`/activities/${id}/candidates`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(403)

    // Somebody of the south, somebody who left, and a technician to answer for it.
    for (const performerUserId of ['u-south', 'u-gone']) {
      await plan(by('u-site', large), { ...ownPlan, performerUserId }).expect(
        400,
        /Ausführen kann, wer Vorgänge ausführt und den Bereich sieht/,
      )
    }

    await plan(by('u-site', large), { ...ownPlan, responsibleUserId: 'u-tech' }).expect(
      400,
      /Verantwortlich ist jemand, der Vorgänge plant und verteilt und den Bereich sieht/,
    )
    await plan(by('u-site', large), { ...ownPlan, performer: 'contractor' }).expect(
      400,
      /Eine Person führt aus, wenn die eigenen Leute es tun/,
    )
    await plan(by('u-site', large), { ...ownPlan, dueOn: '' }).expect(
      400,
      /Die Fälligkeit ist ein Tag/,
    )

    const { rows } = await admin.query('select performer_user_id from activities where id = $1', [
      id,
    ])

    expect(rows).toEqual([{ performer_user_id: null }])
  })

  it('keeps who was named before, and stays as it is once the work has begun', async () => {
    const id = await activityFor(await mainTestAt(await elevatorIn(large, north)), {
      performerUserId: 'u-gone',
    })

    await http()
      .put(`/activities/${id}/plan`)
      .set(testIdentityHeader, by('u-site', large))
      .send({ ...ownPlan, performerUserId: 'u-gone', responsibleUserId: 'u-duties' })
      .expect(200)

    await admin.query("update activities set status = 'started' where id = $1", [id])
    await http()
      .put(`/activities/${id}/plan`)
      .set(testIdentityHeader, by('u-site', large))
      .send({ ...ownPlan, responsibleUserId: 'u-duties' })
      .expect(409, /Geplant wird ein Vorgang, solange er offen ist/)
  })

  it('brings the inspection onto the device of whoever performs it with the next sync', async () => {
    const id = await activityFor(await mainTestAt(await elevatorIn(large, north)), {
      responsible: 'u-site',
    })
    const held = async () => ({
      activities: (await pulled(by('u-tech', large), 'activities')).map((row) => row['id']),
      duties: (await pulled(by('u-tech', large), 'activity_duties')).map(
        (row) => row['activityId'],
      ),
    })

    expect((await held()).activities).not.toContain(id)

    await http()
      .put(`/activities/${id}/plan`)
      .set(testIdentityHeader, by('u-site', large))
      .send(ownPlan)
      .expect(200)

    const now = await held()

    expect(now.activities).toContain(id)
    expect(now.duties).toContain(id)
  })
})

describe('closing an activity with the reason (#183)', () => {
  const reason = 'Der Aufzug war wegen des Umbaus stillgelegt.'

  it('closes an open or a begun one as not performed, gives each duty the reason, and moves nothing of the duty', async () => {
    const duty = await mainTestAt(await elevatorIn())

    await evidenceOf(duty, addDays(today, -800))

    const before = await dutyPage(duty)
    const open = await activityFor(duty)
    const closed = (
      await http()
        .post(`/activities/${open}/close`)
        .set(testIdentityHeader, by('u-site'))
        .send({ closingReason: `  ${reason}  ` })
        .expect(201)
    ).body as ActivityDetails

    expect(closed.status).toBe('not_performed')
    expect(closed.closingReason).toBe(reason)
    expect(closed.duties.map((line) => [line.result, line.resultReason])).toEqual([
      ['not_performed', reason],
    ])

    const after = await dutyPage(duty)

    expect(after.state).toBe('overdue')
    expect(after.appointment).toEqual(before.appointment)
    expect(after.lastMetOn).toBe(before.lastMetOn)
    expect(after.activity).toBeNull()

    const begun = await activityFor(duty, { status: 'started' })

    await http()
      .post(`/activities/${begun}/close`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ closingReason: reason })
      .expect(201)

    expect((await pageOf(begun)).status).toBe('not_performed')
  })

  it('asks for the reason, of at most 500 characters', async () => {
    const open = await activityFor(await mainTestAt(await elevatorIn()))
    const missing = 'Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund.'

    for (const [body, sentence] of [
      [{}, missing],
      [{ closingReason: '   ' }, missing],
      [{ closingReason: 'x'.repeat(501) }, 'Der Grund hat höchstens 500 Zeichen.'],
    ] as const) {
      const refused = await http()
        .post(`/activities/${open}/close`)
        .set(testIdentityHeader, by('u-lead'))
        .send(body)
        .expect(400)

      expect(refused.body.message).toBe(sentence)
    }

    expect((await pageOf(open)).status).toBe('open')
  })

  it('leaves one that is signed, done or closed as it is', async () => {
    const duty = await mainTestAt(await elevatorIn())

    for (const status of ['signed', 'done']) {
      const id = await activityFor(duty, { status })

      await http()
        .post(`/activities/${id}/close`)
        .set(testIdentityHeader, by('u-lead'))
        .send({ closingReason: reason })
        .expect(409)

      expect((await pageOf(id)).status).toBe(status)
    }

    const once = await activityFor(duty)

    await http()
      .post(`/activities/${once}/close`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ closingReason: reason })
      .expect(201)
    await http()
      .post(`/activities/${once}/close`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ closingReason: 'Ein anderer Grund.' })
      .expect(409)

    expect((await pageOf(once)).closingReason).toBe(reason)
  })

  it('closes no work order and no round here', async () => {
    const duty = await mainTestAt(await elevatorIn())

    for (const kind of ['work_order', 'round']) {
      const id = await activityFor(duty, { kind })

      await http()
        .post(`/activities/${id}/close`)
        .set(testIdentityHeader, by('u-lead'))
        .send({ closingReason: reason })
        .expect(400)

      expect((await pageOf(id)).status).toBe('open')
    }
  })

  it('is for whoever plans, not for whoever only performs, even an activity given to them', async () => {
    const id = await activityFor(await mainTestAt(await elevatorIn()), {
      performerUserId: 'u-tech',
    })
    const refused = await http()
      .post(`/activities/${id}/close`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ closingReason: reason })
      .expect(403)

    expect(refused.body.message).toBe(missingRight('activity.write'))
    expect((await pageOf(id)).status).toBe('open')
  })
})

describe('making an activity by hand (#183)', () => {
  /** A duty of the elevator, answered for by the Objektleitung and performed by a contractor. */
  async function contractedDuty(tenantId: TenantId = small, area: string | null = null) {
    const duty = await mainTestAt(await elevatorIn(tenantId, area))

    await admin.query(
      `update duties set responsible_user_id = 'u-site', performer = 'contractor',
                         performer_note = 'Aufzugsdienst Beispiel GmbH'
        where id = $1`,
      [duty],
    )

    return duty
  }

  it('makes one for a duty with none under way, as the engine would, due on its appointment', async () => {
    const duty = await contractedDuty()

    await evidenceOf(duty, addDays(today, -800))

    const before = await dutyPage(duty)
    const made = (
      await http()
        .post('/activities')
        .set(testIdentityHeader, by('u-duties'))
        .send({ dutyId: duty })
        .expect(201)
    ).body as ActivityDetails

    expect(made).toMatchObject({
      kind: 'inspection',
      title: before.title,
      status: 'open',
      dueOn: before.appointment?.dueOn,
      responsible: { userId: 'u-site', name: 'Dennis Roth' },
      performer: 'contractor',
      contractorNote: 'Aufzugsdienst Beispiel GmbH',
      assetId: before.assetId,
      propertyId: before.propertyId,
    })
    expect(made.dueOn).not.toBe(today)
    expect(made.duties.map((line) => [line.dutyId, line.result])).toEqual([[duty, null]])

    const after = await dutyPage(duty)

    expect(after.appointment).toEqual(before.appointment)
    expect(after.activity).toEqual({
      id: made.id,
      kind: 'inspection',
      status: 'open',
      dueOn: made.dueOn,
      performer: 'contractor',
      contractorNote: 'Aufzugsdienst Beispiel GmbH',
    })
  })

  it('makes one due today for a duty never recorded', async () => {
    const duty = await contractedDuty()
    const made = (
      await http()
        .post('/activities')
        .set(testIdentityHeader, by('u-site'))
        .send({ dutyId: duty })
        .expect(201)
    ).body as ActivityDetails

    expect(made.dueOn).toBe(today)
  })

  it('makes none beside one under way, and a new one once that is closed', async () => {
    const duty = await contractedDuty()

    for (const status of ['open', 'started', 'signed']) {
      const under = await activityFor(duty, { status })

      await http()
        .post('/activities')
        .set(testIdentityHeader, by('u-lead'))
        .send({ dutyId: duty })
        .expect(409)
      await admin.query("update activities set status = 'done' where id = $1", [under])
    }

    const open = await activityFor(duty)

    await http()
      .post(`/activities/${open}/close`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ closingReason: 'Der Aufzug war gesperrt.' })
      .expect(201)
    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-lead'))
      .send({ dutyId: duty })
      .expect(201)
    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-lead'))
      .send({ dutyId: duty })
      .expect(409)
  })

  it('makes none for a duty that has ended or rests', async () => {
    const ended = await contractedDuty()

    await admin.query('update duties set ends_on = $2 where id = $1', [ended, addDays(today, -1)])
    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-lead'))
      .send({ dutyId: ended })
      .expect(409)

    const asset = await elevatorIn()
    const resting = await mainTestAt(asset)

    for (const [state, validFrom] of [
      ['in_service', '2015-03-01'],
      ['decommissioned', addDays(today, -20)],
    ] as const) {
      await http()
        .post(`/assets/${asset}/lifecycle`)
        .set(testIdentityHeader, by('u-site'))
        .send({ state, validFrom })
        .expect(201)
    }

    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-lead'))
      .send({ dutyId: resting })
      .expect(409)

    const { rows } = await admin.query(
      'select 1 from activity_duties where duty_id = any($1::uuid[])',
      [[ended, resting]],
    )

    expect(rows).toEqual([])
  })

  it('is for whoever plans, in their areas, and asks for a duty that is there', async () => {
    const duty = await contractedDuty()
    const refused = await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-tech'))
      .send({ dutyId: duty })
      .expect(403)

    expect(refused.body.message).toBe(missingRight('activity.write'))

    const inTheSouth = await contractedDuty(large, south)

    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-site', large))
      .send({ dutyId: inTheSouth })
      .expect(404)
    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-site', small))
      .send({ dutyId: inTheSouth })
      .expect(404)
    await http().post('/activities').set(testIdentityHeader, by('u-lead')).send({}).expect(400)

    const { rows } = await admin.query('select 1 from activity_duties where duty_id = $1', [
      inTheSouth,
    ])

    expect(rows).toEqual([])
  })
})

describe('the page of a duty names the activity under way (#183)', () => {
  it('for whoever plans, and for whoever only performs only one given to them or to nobody', async () => {
    const duty = await mainTestAt(await elevatorIn())
    const id = await activityFor(duty, { performerUserId: 'u-south' })

    expect((await dutyPage(duty, by('u-site'))).activity?.id).toBe(id)
    expect((await dutyPage(duty, by('u-tech'))).activity).toBeNull()

    await admin.query(
      'update activities set responsible_user_id = null, performer_user_id = null, performer = null where id = $1',
      [id],
    )

    expect((await dutyPage(duty, by('u-tech'))).activity?.id).toBe(id)

    await admin.query("update activities set status = 'done' where id = $1", [id])

    expect((await dutyPage(duty, by('u-site'))).activity).toBeNull()
  })

  it('names none to somebody who does not read activities', async () => {
    const duty = await mainTestAt(await elevatorIn())

    await activityFor(duty, { responsible: null })

    const readsDutiesOnly = JSON.stringify({
      userId: 'u-tech',
      tenantId: small,
      roles: ['technician'],
      rights: ['duty.read'],
    })

    expect((await dutyPage(duty, by('u-tech'))).activity).not.toBeNull()
    expect((await dutyPage(duty, readsDutiesOnly)).activity).toBeNull()
  })
})
