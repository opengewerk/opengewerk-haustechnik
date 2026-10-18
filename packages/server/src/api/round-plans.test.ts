import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityId,
  addDays,
  catalogueOf,
  type IsoDate,
  type RoleKey,
  roundShowsFrom,
  shippedRoles,
  type SignedPage,
  type TenantId,
  weekdayOf,
  weekOf,
  ruleSet,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { pageFingerprint, pageOf, takeSignature } from '../activities/signing.js'
import { activities } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { withdrawRounds } from '../rounds/plans.js'
import { deviceScope } from '../sync/device-scope.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The plans of the rounds and the rounds they make (#113, section 4.5 of the
 * concept): every pass of a plan is a round of its own, made once, as far
 * ahead as rounds are made; none while the building is closed; a change of
 * the plan takes back the rounds nobody has begun that no longer fall due;
 * the office sees a week by building, hands rounds out, also like the week
 * before; and a round given to nobody lies on the devices of everybody in
 * the area.
 *
 * Two areas, north and south. The Objektleitung plans in the north, two
 * people of the Haustechnik walk rounds there, a third in the south.
 */

const tenant = newId<'tenant'>() as TenantId
let north = ''
let south = ''
const northProperty = randomUUID()
const northBuilding = randomUUID()
const otherBuilding = randomUUID()
const southProperty = randomUUID()
const northAsset = randomUUID()
let duty = ''
let template = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-site': 'site_management',
  'u-tech': 'technician',
  'u-tech2': 'technician',
  'u-south': 'technician',
}

type Person = keyof typeof people & string

let admin: Pool
let database: Database
let app: INestApplication

/** Today in Germany, the day the routes count from, and a day from it. */
const today = dayInGermany(new Date())
const plus = (days: number) => addDays(today, days)

/**
 * Two statutory public holidays of Baden-Württemberg within the reach of the
 * rounds (#200), as rules of a day the way the package of the holidays
 * writes them; the 29th of February, which no rule of a day names, gives way
 * to the day after.
 */
const holidayDays = [3, 6].map((ahead) =>
  plus(ahead).endsWith('-02-29') ? plus(ahead + 1) : plus(ahead),
)
const probe = catalogueOf(probeCatalogueBundle)
const mainTest = probe.dutyKindVersion('probe.elevator_main_test', 1)

/**
 * A look at every elevator on a round (#343), which a point of a round takes
 * as its evidence: the probe package has no kind of duty a round fulfils.
 */
const elevatorLook =
  mainTest === null
    ? null
    : {
        ...mainTest,
        key: 'probe.elevator_look',
        definition: {
          ...mainTest.definition,
          label: 'Sichtkontrolle des Aufzugs',
          evidence: { kinds: ['round_point' as const] },
        },
      }
const catalogue = {
  ...probe,
  dutyKind: (key: string, on: IsoDate) =>
    key === 'probe.elevator_look' ? elevatorLook : probe.dutyKind(key, on),
  dutyKindVersion: (key: string, version: number) =>
    key === 'probe.elevator_look' && version === 1
      ? elevatorLook
      : probe.dutyKindVersion(key, version),
  ruleSet: ruleSet([
    ...probe.ruleSet.all(),
    ...holidayDays.map((day, index) => ({
      key: `probe.holiday_${String(index)}`,
      scope: 'DE-BW' as const,
      validFrom: '1995-05-08' as IsoDate,
      validUntil: null,
      unit: 'month_day' as const,
      value: Number(day.slice(5, 7)) * 100 + Number(day.slice(8, 10)),
      source: '§ 1 FTG',
      note: `Probefeiertag ${String(index)}`,
    })),
  ]),
}

/** How far ahead the rounds are made, the lead of `round.due`. */
const reach = 14

function http() {
  return request(app.getHttpServer())
}

function by(userId: Person): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

/** What a request was answered with: its status, its sentence and its body. */
async function answered(sent: request.Test) {
  const answer = await sent

  return {
    status: answer.status,
    message: answer.body.message as string | undefined,
    body: answer.body as Record<string, unknown>,
  }
}

/** A plan at the building in the north, daily on every day unless the fields say otherwise. */
function planned(person: Person, fields: object = {}) {
  return answered(
    http()
      .post('/round-plans')
      .set(testIdentityHeader, by(person))
      .send({
        templateId: template,
        propertyId: northProperty,
        buildingId: northBuilding,
        rhythm: 'daily',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        leadDays: 0,
        startsOn: today,
        ...fields,
      }),
  )
}

function removed(person: Person, id: unknown) {
  return answered(
    http()
      .delete(`/round-plans/${String(id)}`)
      .set(testIdentityHeader, by(person)),
  )
}

function changed(person: Person, id: unknown, fields: object) {
  return answered(
    http()
      .patch(`/round-plans/${String(id)}`)
      .set(testIdentityHeader, by(person))
      .send(fields),
  )
}

interface RoundRow {
  readonly id: string
  readonly due_on: string
  readonly status: string
  readonly performer_user_id: string | null
  readonly form_version: number
  readonly countersignature_required: boolean
}

/** The live rounds of a plan, by their day. */
async function roundsOf(plan: unknown): Promise<RoundRow[]> {
  const { rows } = await admin.query<RoundRow>(
    `select id, to_char(due_on, 'YYYY-MM-DD') as due_on, status, performer_user_id, form_version,
            countersignature_required
       from activities where round_plan_id = $1 and deleted_at is null order by due_on`,
    [plan],
  )

  return rows
}

/** Every day from a day to a day, both counted. */
function days(from: IsoDate, until: IsoDate): string[] {
  const all: string[] = []

  for (let day = from; day <= until; day = addDays(day, 1)) {
    all.push(day)
  }

  return all
}

/** A plan put in past the routes, so that only the engine makes its rounds. */
async function planInserted(fields: Record<string, unknown> = {}): Promise<string> {
  const values = {
    rhythm: 'daily',
    weekdays: '{1,2,3,4,5,6,7}',
    starts_on: today,
    performer_user_id: null,
    ...fields,
  }
  const { rows } = await admin.query<{ id: string }>(
    `insert into round_plans (tenant_id, property_id, building_id, area_id, template_id, rhythm, weekdays,
                              starts_on, performer_user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      tenant,
      northProperty,
      otherBuilding,
      north,
      template,
      values.rhythm,
      values.weekdays,
      values.starts_on,
      values.performer_user_id,
    ],
  )

  return rows[0]?.id ?? ''
}

/**
 * A pass of the engine on the morning of today, with the clock of the source
 * on the same moment; at night it follows the sources and makes nothing.
 */
function engineRun(at = '09:00') {
  const now = new Date(`${today}T${at}:00Z`)

  return runDeadlinesOf({ database, catalogue, now: () => now }, tenant, now)
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Stadt Beispiel'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [tenant],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, role] of Object.entries(people)) {
    await admin.query(
      'insert into auth_users (id, name, email) values ($1, $2, $3) on conflict do nothing',
      [userId, `Person ${userId}`, `${userId}@beispiel.example`],
    )
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [role],
    ])
  }

  for (const [userId, area] of [
    ['u-site', north],
    ['u-tech', north],
    ['u-tech2', north],
    ['u-south', south],
  ] as const) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [tenant, userId, area],
    )
  }

  for (const [property, area, name] of [
    [northProperty, north, 'Feuerwache Nord'],
    [southProperty, south, 'Sporthalle Süd'],
  ] as const) {
    await admin.query(
      `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
       values ($1, $2, $3, $4, 'Straße 1', '00001', 'Musterstadt', 'DE-BW')`,
      [property, tenant, area, name],
    )
  }

  for (const [building, name] of [
    [northBuilding, 'Wache'],
    [otherBuilding, 'Halle'],
  ] as const) {
    await admin.query(
      `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
       values ($1, $2, $3, $4, $5, '{school}')`,
      [building, tenant, northProperty, north, name],
    )
  }

  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, 'probe.elevator', 'AN-00001', 'Aufzug')`,
    [northAsset, tenant, northProperty, north, northBuilding],
  )

  const { rows: duties } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     values ($1, $2, $3, $4, 'Sichtkontrolle Aufzug', 'own_decision', 'Hygieneplan',
             'from_performance', 1, 'u-lead')
     returning id`,
    [tenant, northProperty, north, northAsset],
  )

  duty = duties[0]?.id ?? ''

  const { rows: templates } = await admin.query<{ id: string }>(
    `insert into round_templates (tenant_id, title) values ($1, 'Wache, täglicher Rundgang') returning id`,
    [tenant],
  )

  template = templates[0]?.id ?? ''

  await admin.query(
    `insert into round_template_versions (tenant_id, template_id, form_version, definition, asks_countersignature)
     values ($1, $2, 1, $3, true)`,
    [
      tenant,
      template,
      JSON.stringify({
        title: 'Wache, täglicher Rundgang',
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
                about: { kind: 'asset', id: northAsset },
                fulfils: duty,
              },
            ],
          },
        ],
      }),
    ],
  )

  database = Database.connect(applicationDatabaseUrl())

  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the plan of a round', () => {
  it('is made by whoever plans, with a round for every pass as far ahead as rounds are made, and not by whoever only performs', async () => {
    expect((await planned('u-tech')).status).toBe(403)

    const plan = await planned('u-site')

    expect(plan.status).toBe(201)

    const rounds = await roundsOf(plan.body['id'])

    expect(rounds.map((round) => round.due_on)).toEqual(days(today, plus(reach)))
    expect(
      rounds.every((round) => round.status === 'open' && round.performer_user_id === null),
    ).toBe(true)
    expect(
      rounds.every((round) => round.form_version === 1 && round.countersignature_required),
    ).toBe(true)

    const { rows: met } = await admin.query<{ duty_id: string }>(
      `select duty_id from activity_duties where activity_id = $1 and deleted_at is null`,
      [rounds[0]?.id],
    )

    expect(met.map((row) => row.duty_id)).toEqual([duty])

    const { rows: made } = await admin.query<{
      kind: string
      form_key: string
      building_id: string
    }>('select kind, form_key, building_id from activities where id = $1', [rounds[0]?.id])

    expect(made[0]).toEqual({
      kind: 'round',
      form_key: `template-${template}`,
      building_id: northBuilding,
    })
  })

  it('refuses what is wrong with it, a place it does not have and a person who does not walk rounds in its area', async () => {
    expect(await planned('u-site', { rhythm: 'weekly', weekdays: [1, 3] })).toMatchObject({
      status: 400,
      message: 'Ein wöchentlicher Plan nennt seinen Wochentag.',
    })
    expect(await planned('u-site', { templateId: randomUUID() })).toMatchObject({
      status: 400,
      message: 'Diese Vorlage gibt es bei diesem Betreiber nicht.',
    })
    expect(await planned('u-site', { propertyId: southProperty, buildingId: null })).toMatchObject({
      status: 400,
      message: 'Der Ort ist eine Liegenschaft, die Sie sehen.',
    })
    expect(await planned('u-lead', { propertyId: southProperty })).toMatchObject({
      status: 400,
      message: 'Das Gebäude steht nicht auf dieser Liegenschaft.',
    })
    expect(await planned('u-site', { performerUserId: 'u-south' })).toMatchObject({
      status: 400,
      message: 'Zuständig ist jemand, der Vorgänge ausführt und den Bereich sieht.',
    })
  })

  it('makes no round while its building is closed, and follows a closure that is entered or removed', async () => {
    const plan = await planned('u-site', { performerUserId: 'u-tech' })
    const closure = await answered(
      http()
        .post(`/buildings/${northBuilding}/closures`)
        .set(testIdentityHeader, by('u-site'))
        .send({ startsOn: plus(2), endsOn: plus(4), reason: 'Sanierung' }),
    )

    expect(closure.status).toBe(201)
    expect((await roundsOf(plan.body['id'])).map((round) => round.due_on)).toEqual(
      days(today, plus(reach)).filter((day) => day < plus(2) || day > plus(4)),
    )

    const again = await planned('u-site')

    expect((await roundsOf(again.body['id'])).map((round) => round.due_on)).not.toContain(plus(3))

    await answered(
      http()
        .delete(`/buildings/${northBuilding}/closures/${String(closure.body['id'])}`)
        .set(testIdentityHeader, by('u-site')),
    )

    const back = await roundsOf(plan.body['id'])

    expect(back.map((round) => round.due_on)).toEqual(days(today, plus(reach)))
    expect(back.find((round) => round.due_on === plus(3))?.performer_user_id).toBe('u-tech')
  })

  it('leaves out the statutory public holidays of its state where it is asked to, and counts them like any day otherwise (#200)', async () => {
    const leaves = await planned('u-site', { skipHolidays: true })
    const counts = await planned('u-site')
    const open = days(today, plus(reach)).filter((day) => !holidayDays.includes(day))

    expect(leaves.status).toBe(201)
    expect((await roundsOf(leaves.body['id'])).map((round) => round.due_on)).toEqual(open)
    expect((await roundsOf(counts.body['id'])).map((round) => round.due_on)).toEqual(
      days(today, plus(reach)),
    )

    // Asked no more, the plan makes the rounds of the holidays; asked again, it takes them back.
    expect((await changed('u-site', leaves.body['id'], { skipHolidays: false })).status).toBe(200)
    expect((await roundsOf(leaves.body['id'])).map((round) => round.due_on)).toEqual(
      days(today, plus(reach)),
    )
    expect((await changed('u-site', leaves.body['id'], { skipHolidays: true })).status).toBe(200)
    expect((await roundsOf(leaves.body['id'])).map((round) => round.due_on)).toEqual(open)
  })

  it('is not asked to leave out holidays where the catalogue holds none for the state of its property', async () => {
    const hessen = randomUUID()

    await admin.query(
      `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
       values ($1, $2, $3, 'Rathaus Hessen', 'Straße 2', '00002', 'Musterstadt', 'DE-HE')`,
      [hessen, tenant, north],
    )

    const refused = await planned('u-site', {
      propertyId: hessen,
      buildingId: null,
      skipHolidays: true,
    })

    expect(refused).toMatchObject({
      status: 400,
      message:
        'Für das Land dieser Liegenschaft kennt der Katalog keine gesetzlichen Feiertage. Der Plan zählt einen Feiertag dort wie jeden Tag.',
    })

    const plan = await planned('u-site', { propertyId: hessen, buildingId: null })

    expect(plan.status).toBe(201)
    expect((await changed('u-site', plan.body['id'], { skipHolidays: true })).status).toBe(400)
    expect((await changed('u-site', plan.body['id'], { skipHolidays: 'ja' })).status).toBe(400)
    expect((await roundsOf(plan.body['id'])).map((round) => round.due_on)).toEqual(
      days(today, plus(reach)),
    )
  })

  it('takes back the rounds of days it no longer falls on, keeps a begun one and the person of a day it keeps', async () => {
    const plan = await planned('u-site')
    const id = plan.body['id']
    const rounds = await roundsOf(id)
    const begun = rounds.find((round) => round.due_on === plus(1))
    const kept = rounds.find((round) => round.due_on === plus(3))

    await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
      begun?.id,
      today,
    ])
    expect(
      (
        await answered(
          http()
            .put('/rounds/assignment')
            .set(testIdentityHeader, by('u-site'))
            .send({ rounds: [{ id: kept?.id, performerUserId: 'u-tech2' }] }),
        )
      ).status,
    ).toBe(200)

    const weekly = await changed('u-site', id, { rhythm: 'weekly', weekdays: [weekdayOf(plus(3))] })

    expect(weekly.status).toBe(200)

    const after = await roundsOf(id)

    // A weekly round is made once the Monday of its week comes within the
    // lead (#394), so the pass of the week after the lead is among them from
    // Monday to Thursday.
    expect(after.map((round) => round.due_on)).toEqual(
      [
        plus(1),
        ...days(today, plus(reach + 6)).filter(
          (day) =>
            weekdayOf(day as IsoDate) === weekdayOf(plus(3)) &&
            roundShowsFrom(
              { rhythm: 'weekly', showsFromDay: null, showsFromMonth: null, leadDays: reach },
              day as IsoDate,
            ) <= plus(reach),
        ),
      ].sort(),
    )
    expect(after.find((round) => round.due_on === plus(1))?.status).toBe('started')
    expect(after.find((round) => round.id === kept?.id)?.performer_user_id).toBe('u-tech2')
  })

  it('rests and runs again, ends on a day, and leaves every past round where it is', async () => {
    const plan = await planned('u-site')
    const id = plan.body['id']
    const { rows: past } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, building_id, kind, title, due_on, round_plan_id)
       values ($1, $2, $3, $4, 'round', 'Wache, täglicher Rundgang', $5, $6) returning id`,
      [tenant, northProperty, north, northBuilding, plus(-1), id],
    )

    expect((await changed('u-site', id, { resting: true })).status).toBe(200)
    expect((await roundsOf(id)).map((round) => round.due_on)).toEqual([plus(-1)])

    expect((await changed('u-site', id, { resting: false })).status).toBe(200)
    expect((await roundsOf(id)).map((round) => round.due_on)).toEqual([
      plus(-1),
      ...days(today, plus(reach)),
    ])

    expect((await changed('u-site', id, { endsOn: plus(3) })).status).toBe(200)
    expect((await roundsOf(id)).map((round) => round.due_on)).toEqual([
      plus(-1),
      ...days(today, plus(3)),
    ])

    expect((await changed('u-site', id, { endsOn: today })).status).toBe(200)
    expect((await roundsOf(id)).map((round) => round.due_on)).toEqual([plus(-1), today])
    expect((await roundsOf(id))[0]?.id).toBe(past[0]?.id)

    // A plan that ended yesterday stays as it was.
    await admin.query('update round_plans set starts_on = $2, ends_on = $3 where id = $1', [
      id,
      plus(-10),
      plus(-1),
    ])

    expect(await changed('u-site', id, { resting: true })).toMatchObject({
      status: 409,
      message:
        'Dieser Plan ist beendet und bleibt, wie er war. Für neue Rundgänge legen Sie einen neuen Plan an.',
    })
    expect((await changed('u-tech', id, { resting: true })).status).toBe(403)
  })

  it('hands its rounds on to its new person, except those handed to somebody else', async () => {
    const plan = await planned('u-site', { performerUserId: 'u-tech' })
    const id = plan.body['id']
    const other = (await roundsOf(id)).find((round) => round.due_on === plus(2))

    await answered(
      http()
        .put('/rounds/assignment')
        .set(testIdentityHeader, by('u-site'))
        .send({ rounds: [{ id: other?.id, performerUserId: null }] }),
    )

    expect((await changed('u-site', id, { performerUserId: 'u-tech2' })).status).toBe(200)

    const rounds = await roundsOf(id)

    expect(rounds.find((round) => round.id === other?.id)?.performer_user_id).toBeNull()
    expect(
      rounds
        .filter((round) => round.id !== other?.id)
        .every((round) => round.performer_user_id === 'u-tech2'),
    ).toBe(true)
  })

  it('is removed by whoever plans while nobody walked a round of it, with its open rounds and its deadline (#320)', async () => {
    const plan = await planned('u-site')
    const id = plan.body['id']

    // An open round of yesterday that nobody walked goes with it.
    await admin.query(
      `insert into activities (tenant_id, property_id, area_id, building_id, kind, title, due_on, round_plan_id)
       values ($1, $2, $3, $4, 'round', 'Wache, täglicher Rundgang', $5, $6)`,
      [tenant, northProperty, north, northBuilding, plus(-1), id],
    )
    await engineRun()

    const deadlines = async () =>
      (
        await admin.query<{ id: string }>(
          `select id from deadlines where round_plan_id = $1 and status = 'open'`,
          [id],
        )
      ).rows

    expect(await deadlines()).toHaveLength(1)
    expect((await removed('u-tech', id)).status).toBe(403)
    expect(await removed('u-site', id)).toMatchObject({ status: 200, body: { id } })
    expect(await roundsOf(id)).toEqual([])

    const { rows: marked } = await admin.query<{ gone: boolean }>(
      'select deleted_at is not null as gone from round_plans where id = $1',
      [id],
    )

    expect(marked).toEqual([{ gone: true }])

    await engineRun()

    expect(await deadlines()).toEqual([])
    // Marked, it is no plan any more: not to remove again, and not to change.
    expect((await removed('u-site', id)).status).toBe(404)
    expect((await changed('u-site', id, { resting: true })).status).toBe(404)
  })

  it('is not removed once a round of it was begun, and keeps every round; it ends instead (#320)', async () => {
    const plan = await planned('u-site')
    const id = plan.body['id']
    const rounds = await roundsOf(id)

    await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
      rounds[0]?.id,
      today,
    ])

    expect(await removed('u-site', id)).toMatchObject({
      status: 409,
      message:
        'Von diesem Plan ist schon ein Rundgang begonnen, gegangen oder geschlossen. Er wird nicht entfernt, sondern beendet.',
    })
    expect((await roundsOf(id)).map((round) => round.id)).toEqual(rounds.map((round) => round.id))
    expect((await changed('u-site', id, { endsOn: today })).status).toBe(200)
  })
})

describe('the rounds of a week', () => {
  it('show each state, the countersignature still to come among them, and what is open from before', async () => {
    const plan = await planned('u-site')
    const id = String(plan.body['id'])
    const rounds = await roundsOf(id)
    // The week of tomorrow: on a Sunday the week of today holds a single round
    // of the plan, which starts today, and the test needs two.
    const day = plus(1)
    const monday = weekOf(day)
    const [signed, countersigned] = rounds.filter(
      (round) => round.due_on >= monday && round.due_on <= addDays(monday, 6),
    )

    for (const round of [signed, countersigned]) {
      await admin.query(
        `update activities set status = 'signed', performed_on = $2 where id = $1`,
        [round?.id, today],
      )
    }

    await admin.query(
      `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                        signed_at, path, page_fingerprint)
       values ($1, $2, $3, $4, 'u-site', 'countersigner', now(), 'M10,10L200,300', repeat('a', 64))`,
      [tenant, northProperty, north, countersigned?.id],
    )
    const { rows: late } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, building_id, kind, title, due_on, round_plan_id)
       values ($1, $2, $3, $4, 'round', 'Wache, täglicher Rundgang', $5, $6) returning id`,
      [tenant, northProperty, north, northBuilding, addDays(monday, -3), id],
    )

    const week = await answered(
      http().get(`/rounds/week?of=${day}`).set(testIdentityHeader, by('u-site')),
    )

    expect(week.status).toBe(200)
    expect(week.body['weekOf']).toBe(monday)

    const mine = (
      week.body['rounds'] as { id: string; planId: string; state: string; dueOn: string }[]
    ).filter((round) => round.planId === id)

    expect(mine.find((round) => round.id === signed?.id)?.state).toBe('awaiting_countersignature')
    expect(mine.find((round) => round.id === countersigned?.id)?.state).toBe('submitted')
    expect(mine.every((round) => round.dueOn >= monday && round.dueOn <= addDays(monday, 6))).toBe(
      true,
    )
    // Open from before, each of them, until somebody closes it with a reason,
    // and nothing of this week.
    expect(
      (week.body['before'] as { dueOn: string }[]).every((round) => round.dueOn < monday),
    ).toBe(true)
    expect(week.body['before']).toContainEqual({
      id: late[0]?.id,
      planId: id,
      dueOn: addDays(monday, -3),
      state: 'open',
      performerUserId: null,
    })
    expect(
      (await answered(http().get('/rounds/week?of=morgen').set(testIdentityHeader, by('u-site'))))
        .message,
    ).toBe('Die Woche ist ein Tag darin, geschrieben 2026-10-03.')
  })

  it('show whoever only performs what is given to them or to nobody', async () => {
    const plan = await planned('u-site', { performerUserId: 'u-tech' })
    const id = String(plan.body['id'])
    const free = await planned('u-site')
    const seen = async (person: Person) =>
      (
        (await answered(http().get(`/rounds/week?of=${today}`).set(testIdentityHeader, by(person))))
          .body['rounds'] as { planId: string }[]
      ).map((round) => round.planId)

    expect(await seen('u-tech')).toContain(id)
    expect(await seen('u-tech2')).not.toContain(id)
    expect(await seen('u-tech2')).toContain(free.body['id'])
    expect(await seen('u-south')).toEqual([])
  })

  it('are handed out by whoever plans, to somebody who performs in their area, while nobody has begun them', async () => {
    const plan = await planned('u-site')
    const [first, second] = await roundsOf(plan.body['id'])
    const assign = (person: Person, rounds: object[]) =>
      answered(
        http().put('/rounds/assignment').set(testIdentityHeader, by(person)).send({ rounds }),
      )

    expect((await assign('u-tech', [{ id: first?.id, performerUserId: 'u-tech' }])).status).toBe(
      403,
    )
    expect(await assign('u-site', [{ id: first?.id, performerUserId: 'u-south' }])).toMatchObject({
      status: 400,
      message: 'Zuständig ist jemand, der Vorgänge ausführt und den Bereich sieht.',
    })
    expect(
      (
        await assign('u-site', [
          { id: first?.id, performerUserId: 'u-tech' },
          { id: second?.id, performerUserId: 'u-tech2' },
        ])
      ).status,
    ).toBe(200)
    expect(
      (await roundsOf(plan.body['id'])).slice(0, 2).map((round) => round.performer_user_id),
    ).toEqual(['u-tech', 'u-tech2'])

    await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
      second?.id,
      today,
    ])

    expect(
      await assign('u-site', [
        { id: first?.id, performerUserId: null },
        { id: second?.id, performerUserId: null },
      ]),
    ).toMatchObject({ status: 409 })
    expect((await roundsOf(plan.body['id']))[0]?.performer_user_id).toBe('u-tech')
  })

  it('are handed out like the week before, each to whoever had the round of its plan seven days earlier', async () => {
    const plan = await planned('u-site', { performerUserId: 'u-tech' })
    const id = String(plan.body['id'])
    const nextMonday = addDays(weekOf(today), 7)
    const lastWeek = (await roundsOf(id)).filter(
      (round) => round.due_on >= addDays(nextMonday, -7) && round.due_on < nextMonday,
    )

    // Every second day to the other one, the rest to nobody, and the first to somebody of the south.
    const handedTo = (day: string) =>
      day === lastWeek[0]?.due_on
        ? 'u-south'
        : weekdayOf(day as IsoDate) % 2 === 0
          ? 'u-tech2'
          : null

    for (const round of lastWeek) {
      await admin.query('update activities set performer_user_id = $2 where id = $1', [
        round.id,
        handedTo(round.due_on),
      ])
    }

    const handed = await answered(
      http()
        .post('/rounds/like-last-week')
        .set(testIdentityHeader, by('u-site'))
        .send({ weekOf: nextMonday }),
    )

    expect(handed.status).toBe(201)

    const nextWeek = (await roundsOf(id)).filter(
      (round) => round.due_on >= nextMonday && round.due_on <= addDays(nextMonday, 6),
    )

    for (const round of nextWeek) {
      const before = lastWeek.find((each) => each.due_on === addDays(round.due_on as IsoDate, -7))
      const theirs = before === undefined ? undefined : handedTo(before.due_on)

      // Without a round a week earlier, or where its person walks no rounds here, it stays.
      expect(round.performer_user_id).toBe(
        theirs === undefined || theirs === 'u-south' ? 'u-tech' : theirs,
      )
    }

    expect(handed.body['kept']).toBeGreaterThanOrEqual(1)

    expect(
      (
        await answered(
          http()
            .post('/rounds/like-last-week')
            .set(testIdentityHeader, by('u-tech'))
            .send({ weekOf: nextMonday }),
        )
      ).status,
    ).toBe(403)
  })

  it('name the people of the plans, and who may walk the rounds of an area to whoever plans there', async () => {
    await planned('u-site', { performerUserId: 'u-tech' })

    const named = await answered(http().get('/rounds/people').set(testIdentityHeader, by('u-site')))
    // Whoever only performs is named the people of the rounds they are shown, and of no plan.
    const theirs = await answered(
      http().get('/rounds/people').set(testIdentityHeader, by('u-tech2')),
    )

    expect(theirs.status).toBe(200)
    expect(
      (theirs.body as unknown as { userId: string }[]).map((person) => person.userId),
    ).not.toContain('u-tech')

    expect(named.body).toEqual(
      expect.arrayContaining([{ userId: 'u-tech', name: 'Person u-tech' }]),
    )

    const performers = await answered(
      http().get(`/rounds/performers?area=${north}`).set(testIdentityHeader, by('u-site')),
    )

    expect(
      (performers.body as unknown as { userId: string }[]).map((person) => person.userId),
    ).toEqual(expect.arrayContaining(['u-tech', 'u-tech2']))
    expect(
      (performers.body as unknown as { userId: string }[]).map((person) => person.userId),
    ).not.toContain('u-south')
    expect(
      await answered(
        http().get(`/rounds/performers?area=${south}`).set(testIdentityHeader, by('u-site')),
      ),
    ).toMatchObject({ status: 200, body: [] })
    expect(
      (
        await answered(
          http().get(`/rounds/performers?area=${north}`).set(testIdentityHeader, by('u-tech')),
        )
      ).status,
    ).toBe(403)
  })
})

describe('a round in the office', () => {
  const drawing = 'M10,10L200,300'

  /** A live round a plan made for a person, by its id. */
  async function roundFor(person: Person): Promise<ActivityId> {
    const plan = await planned('u-site', { performerUserId: person })
    const [round] = await roundsOf(plan.body['id'])

    return round?.id as ActivityId
  }

  /** A round of a plan put in past the routes, on a day and in a state. */
  async function roundInserted(dueOn: IsoDate, status = 'open'): Promise<ActivityId> {
    const plan = await planned('u-site')
    const { rows } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, building_id, kind, title, due_on,
                               round_plan_id, status, performed_on)
       values ($1, $2, $3, $4, 'round', 'Wache, täglicher Rundgang', $5, $6, $7, $8) returning id`,
      [
        tenant,
        northProperty,
        north,
        northBuilding,
        dueOn,
        plan.body['id'],
        status,
        status === 'open' ? null : dueOn,
      ],
    )

    return rows[0]?.id as ActivityId
  }

  /** Answers the one point of the round on site and signs it there, as the sync takes it. */
  async function signedOnSite(round: ActivityId, person: Person = 'u-tech') {
    await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
      round,
      today,
    ])
    await admin.query(
      `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, result)
       values ($1, $2, $3, $4, 'p1', 'ok')`,
      [tenant, northProperty, north, round],
    )
    await database.forTenant({ tenantId: tenant, userId: person }, async (tx) => {
      const [row] = await tx.select().from(activities).where(eq(activities.id, round))

      if (row === undefined) {
        throw new Error('No such round')
      }

      await takeSignature(
        tx,
        {
          tenantId: tenant,
          writtenBy: person,
          at: new Date(),
          catalogue,
          nameOf: (userId) => `Person ${userId}`,
        },
        {
          activityId: round,
          role: 'signer',
          signedAt: new Date(),
          deviceInfo: 'Probe-Telefon',
          path: drawing,
          typedName: null,
          pageFingerprint: pageFingerprint(await pageOf(tx, row)),
        },
      )
    })
  }

  function page(person: Person, round: ActivityId) {
    return answered(http().get(`/rounds/${round}`).set(testIdentityHeader, by(person)))
  }

  function countersigned(
    person: Person,
    round: ActivityId,
    fingerprint: string,
    way: object = { path: 'M20,20L300,200' },
  ) {
    return answered(
      http()
        .post(`/rounds/${round}/countersignature`)
        .set(testIdentityHeader, by(person))
        .send({ ...way, pageFingerprint: fingerprint, deviceInfo: 'Büro' }),
    )
  }

  function closed(person: Person, round: ActivityId, closingReason?: string) {
    return answered(
      http()
        .post(`/rounds/${round}/close`)
        .set(testIdentityHeader, by(person))
        .send(closingReason === undefined ? {} : { closingReason }),
    )
  }

  async function evidenceOf(round: ActivityId) {
    const { rows } = await admin.query<{ duty_id: string; origin: string }>(
      'select duty_id, origin from evidence where activity_id = $1',
      [round],
    )

    return rows
  }

  it('shows no answers before the signature, and the page that was signed after it, waiting for the countersignature', async () => {
    const round = await roundFor('u-tech')
    const open = await page('u-site', round)

    expect(open.status).toBe(200)
    expect(open.body).toMatchObject({
      state: 'open',
      performer: { userId: 'u-tech', name: 'Person u-tech' },
      countersignatureRequired: true,
      page: null,
      signatures: [],
    })

    await signedOnSite(round)

    const signed = await page('u-site', round)

    expect(signed.body).toMatchObject({
      status: 'signed',
      state: 'awaiting_countersignature',
      performedOn: today,
      evidence: [],
      defects: [],
    })
    expect((signed.body['page'] as SignedPage).answers).toEqual([
      expect.objectContaining({ fieldKey: 'p1', result: 'ok' }),
    ])
    expect(signed.body['signatures']).toEqual([
      expect.objectContaining({
        role: 'signer',
        name: 'Person u-tech',
        deviceInfo: 'Probe-Telefon',
        path: drawing,
        valid: true,
      }),
    ])
    // Without the countersignature the template asks for there is no evidence.
    expect(await evidenceOf(round)).toEqual([])
    // A round outside the areas of the person asking is not there for them,
    // nor one given to somebody else for whoever only performs.
    expect((await page('u-south', round)).status).toBe(404)
    expect((await page('u-tech2', round)).status).toBe(404)
    expect((await page('u-tech', round)).status).toBe(200)
  })

  it('is countersigned by the Objektleitung for the page that was shown, and only then written down', async () => {
    const round = await roundFor('u-tech')

    await signedOnSite(round)

    const shown = pageFingerprint((await page('u-site', round)).body['page'] as SignedPage)

    // Whoever only performs does not countersign.
    expect((await countersigned('u-tech', round, shown)).status).toBe(403)

    const otherPage = await countersigned('u-site', round, 'f'.repeat(64))

    expect(otherPage.status).toBe(409)
    expect(otherPage.message).toBe(
      'Die Seite hat sich geändert, seit sie gezeigt wurde. Sie wird neu gezeigt und neu unterschrieben.',
    )
    expect(await evidenceOf(round)).toEqual([])

    const given = await countersigned('u-site', round, shown)

    expect(given.status).toBe(201)
    expect(given.body).toMatchObject({ status: 'done', state: 'submitted' })
    expect(
      (given.body['signatures'] as { role: string; name: string; deviceInfo: string }[]).map(
        (signature) => [signature.role, signature.name, signature.deviceInfo],
      ),
    ).toEqual([
      ['signer', 'Person u-tech', 'Probe-Telefon'],
      ['countersigner', 'Person u-site', 'Büro'],
    ])
    expect(await evidenceOf(round)).toEqual([{ duty_id: duty, origin: 'round_point' }])
    expect(given.body['evidence']).toEqual([expect.objectContaining({ dutyId: duty })])

    const again = await countersigned('u-site', round, shown)

    expect(again.status).toBe(409)
    expect(await evidenceOf(round)).toHaveLength(1)
  })

  it('is countersigned with the typed name of whoever countersigns, and not with another (#209)', async () => {
    const round = await roundFor('u-tech')

    await signedOnSite(round)

    const shown = pageFingerprint((await page('u-site', round)).body['page'] as SignedPage)
    const other = await countersigned('u-site', round, shown, { typedName: 'Person u-tech' })

    expect(other).toMatchObject({
      status: 400,
      message: 'Bestätigt wird mit dem eigenen Namen, wie er im Konto steht: Person u-site.',
    })

    const given = await countersigned('u-site', round, shown, { typedName: 'Person u-site' })

    expect(given.status).toBe(201)
    expect(
      (
        given.body['signatures'] as {
          role: string
          path: string | null
          typedName: string | null
        }[]
      ).map((signature) => [signature.role, signature.path === null, signature.typedName]),
    ).toEqual([
      ['signer', false, null],
      ['countersigner', true, 'Person u-site'],
    ])
    expect(await evidenceOf(round)).toEqual([{ duty_id: duty, origin: 'round_point' }])
  })

  it('closes a round of a past day as not performed, with the reason, by whoever plans, and it fulfils nothing', async () => {
    const round = await roundInserted(plus(-2), 'started')
    // The week after it, where the round is one open from before.
    const before = async () =>
      (
        (
          await answered(
            http()
              .get(`/rounds/week?of=${plus(7)}`)
              .set(testIdentityHeader, by('u-site')),
          )
        ).body['before'] as { id: string }[]
      ).map((each) => each.id)

    expect(await before()).toContain(round)
    expect((await closed('u-tech', round, 'Die Wache war nicht besetzt.')).status).toBe(403)

    const without = await closed('u-site', round)

    expect(without.status).toBe(400)
    expect(JSON.stringify(without.body)).toContain(
      'Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund.',
    )

    const done = await closed('u-site', round, 'Die Wache war nicht besetzt.')

    expect(done.status).toBe(201)
    expect(done.body).toMatchObject({
      status: 'not_performed',
      state: 'not_performed',
      closingReason: 'Die Wache war nicht besetzt.',
    })
    expect(await evidenceOf(round)).toEqual([])

    expect(await before()).not.toContain(round)
    expect((await closed('u-site', round, 'Noch einmal.')).status).toBe(409)
  })

  it('closes no round of today, which is still to be walked, and none somebody signed', async () => {
    const now = await closed('u-site', await roundFor('u-tech'), 'Zu früh.')

    expect(now.status).toBe(409)
    expect(now.message).toBe(
      'Mit Grund geschlossen wird ein Rundgang eines vergangenen Tages. Dieser ist noch zu gehen.',
    )

    const signed = await closed('u-site', await roundInserted(plus(-1), 'signed'), 'Zu spät.')

    expect(signed.status).toBe(409)
    expect(signed.message).toBe(
      'Geschlossen wird ein Rundgang, solange er offen oder begonnen ist. Dieser ist schon unterschrieben oder abgeschlossen.',
    )
  })
})

describe('the rounds the deadline engine makes', () => {
  it('make each pass of a plan once, however often and however many run at once', async () => {
    const plan = await planInserted()

    // The night writes the deadline; the morning makes the rounds, twice at once.
    await engineRun('01:00')

    expect(await roundsOf(plan)).toEqual([])

    await Promise.all([engineRun(), engineRun()])
    await engineRun()
    await engineRun()

    expect((await roundsOf(plan)).map((round) => round.due_on)).toEqual(days(today, plus(reach)))

    const { rows } = await admin.query<{ due_on: string; status: string }>(
      `select to_char(due_on, 'YYYY-MM-DD') as due_on, status from deadlines
        where round_plan_id = $1 and kind = 'round.due'`,
      [plan],
    )

    expect(rows).toEqual([{ due_on: plus(reach + 1), status: 'open' }])
  })

  it('count the deadline of a plan that leaves out holidays from the first pass after them (#200)', async () => {
    const plan = await planInserted({ starts_on: holidayDays[0] })

    await admin.query('update round_plans set skip_holidays = true where id = $1', [plan])
    await engineRun()

    const { rows } = await admin.query<{ anchor_on: string }>(
      `select to_char(anchor_on, 'YYYY-MM-DD') as anchor_on from deadlines where round_plan_id = $1`,
      [plan],
    )

    expect(rows).toEqual([{ anchor_on: plus(4) }])
  })

  it('make none for a plan that rests, which has no deadline either', async () => {
    const plan = await planInserted()

    await admin.query('update round_plans set resting = true where id = $1', [plan])
    await engineRun()

    expect(await roundsOf(plan)).toEqual([])

    const { rows } = await admin.query<{ id: string }>(
      `select id from deadlines where round_plan_id = $1 and status = 'open'`,
      [plan],
    )

    expect(rows).toEqual([])
  })

  it('take back no round somebody has begun, whatever was read before', async () => {
    const plan = await planInserted()

    await engineRun()

    const [begun, open] = await roundsOf(plan)

    await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
      begun?.id,
      today,
    ])

    const taken = await database.forTenant({ tenantId: tenant, userId: 'u-site' }, (tx) =>
      withdrawRounds(
        tx,
        [begun?.id, open?.id] as unknown as Parameters<typeof withdrawRounds>[1],
        new Date(),
      ),
    )

    expect(taken).toBe(1)
    expect((await roundsOf(plan)).map((round) => round.id)).toContain(begun?.id)
    expect((await roundsOf(plan)).map((round) => round.id)).not.toContain(open?.id)
  })

  it('put a round given to nobody on the device of everybody in the area, and one given to somebody on theirs', async () => {
    const free = await planInserted()
    const given = await planInserted({ performer_user_id: 'u-tech' })

    await engineRun()

    const held = async (person: Person) =>
      new Set(
        (
          await database.forTenant({ tenantId: tenant, userId: person }, (tx) =>
            deviceScope(tx, person),
          )
        ).activityIds,
      )
    const freeRound = (await roundsOf(free))[0]?.id
    const givenRound = (await roundsOf(given))[0]?.id

    expect((await held('u-tech')).has(freeRound ?? '')).toBe(true)
    expect((await held('u-tech2')).has(freeRound ?? '')).toBe(true)
    expect((await held('u-tech')).has(givenRound ?? '')).toBe(true)
    expect((await held('u-tech2')).has(givenRound ?? '')).toBe(false)
    expect((await held('u-south')).has(freeRound ?? '')).toBe(false)
  })

  it('walk a new version of the template from the next round on, and leave a begun round on its version', async () => {
    const plan = await planInserted()

    await engineRun()

    const [begun] = await roundsOf(plan)

    await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
      begun?.id,
      today,
    ])
    await admin.query(
      `insert into round_template_versions (tenant_id, template_id, form_version, definition, asks_countersignature)
       values ($1, $2, 2, $3, false)`,
      [
        tenant,
        template,
        JSON.stringify({
          title: 'Wache, täglicher Rundgang',
          sections: [
            {
              key: 'k1',
              title: 'Fahrzeughalle',
              fields: [{ kind: 'text', key: 'p9', label: 'Bemerkung' }],
            },
          ],
        }),
      ],
    )
    await engineRun()

    const rounds = await roundsOf(plan)

    expect(rounds.find((round) => round.id === begun?.id)).toMatchObject({
      form_version: 1,
      countersignature_required: true,
    })
    expect(
      rounds
        .filter((round) => round.id !== begun?.id)
        .every((round) => round.form_version === 2 && !round.countersignature_required),
    ).toBe(true)

    const { rows: met } = await admin.query<{ open: number }>(
      `select count(*)::int as open from activity_duties
        where activity_id = any($1) and deleted_at is null`,
      [rounds.filter((round) => round.id !== begun?.id).map((round) => round.id)],
    )

    expect(met[0]?.open).toBe(0)
  })
})

/** A device of this person that takes push (#126), as the row a browser left. */
async function aPushDevice(userId: string, tenantId: TenantId): Promise<void> {
  await admin.query(
    `insert into push_subscriptions (tenant_id, user_id, entry, label, endpoint, p256dh, auth)
     values ($1, $2, 'site', 'Chrome auf Android', $3, 'BPublic', 'Secret')`,
    [tenantId, userId, `https://push.example.com/${userId}/${newId()}`],
  )
}

describe('rounds handed to somebody (#126)', () => {
  it('tell whoever they went to once, however many of them', async () => {
    const plan = await planned('u-site')
    const rounds = (await roundsOf(plan.body['id'])).filter((round) => round.due_on >= plus(1))

    expect(rounds.length).toBeGreaterThan(1)

    await aPushDevice('u-tech2', tenant)

    expect(
      (
        await answered(
          http()
            .put('/rounds/assignment')
            .set(testIdentityHeader, by('u-site'))
            .send({
              rounds: rounds.map((round) => ({ id: round.id, performerUserId: 'u-tech2' })),
            }),
        )
      ).status,
    ).toBe(200)

    const { rows } = await admin.query<{ title: string; cause: string }>(
      `select o.title, o.cause
         from push_outbox o join push_subscriptions s on s.id = o.subscription_id
        where s.user_id = 'u-tech2'`,
    )
    const first = rounds.map((round) => round.due_on).sort()[0]

    expect(rows).toEqual([
      {
        title: 'Neu zugeteilt',
        cause: `assigned:${String(rounds.find((round) => round.due_on === first)?.id)}:u-tech2`,
      },
    ])
  })
})

/**
 * A plan for a building with an area of its own (section 2.8 of the concept,
 * #306): it lies in the area of the building, and only somebody who walks
 * rounds there is named for it. Last in the file, and taken away again, so
 * that the weeks of the tests above stay as they are.
 */
describe('a plan for a building with an area of its own', () => {
  it('lies in the area of the building and is walked by somebody of that area', async () => {
    await admin.query('update buildings set own_area_id = $2, area_id = $2 where id = $1', [
      otherBuilding,
      south,
    ])

    try {
      const northern = await planned('u-lead', {
        buildingId: otherBuilding,
        performerUserId: 'u-tech',
      })

      // Whoever walks rounds in the north does not see the building.
      expect(northern).toMatchObject({
        status: 400,
        message: 'Zuständig ist jemand, der Vorgänge ausführt und den Bereich sieht.',
      })

      const southern = await planned('u-lead', {
        buildingId: otherBuilding,
        performerUserId: 'u-south',
      })

      expect(southern.status).toBe(201)

      const { rows } = await admin.query<{ building: string; area: string }>(
        'select building_id as building, area_id as area from round_plans where id = $1',
        [southern.body['id']],
      )

      expect(rows).toEqual([{ building: otherBuilding, area: south }])
    } finally {
      await admin.query(
        `update activities set deleted_at = now()
          where round_plan_id in (select id from round_plans where building_id = $1)`,
        [otherBuilding],
      )
      await admin.query('update round_plans set deleted_at = now() where building_id = $1', [
        otherBuilding,
      ])
      await admin.query('update buildings set own_area_id = null, area_id = $2 where id = $1', [
        otherBuilding,
        north,
      ])
    }
  })
})

describe('a round that shows from a day of its week, month or year (#394)', () => {
  /** The day of the month of a day, as a number. */
  const dateOf = (day: IsoDate) => Number(day.slice(8, 10))
  /** The month of a day, counted from 1. */
  const monthOf = (day: IsoDate) => Number(day.slice(5, 7))

  it('makes the round of a monthly pass twenty days ahead today, when it shows from today', async () => {
    const pass = plus(20)
    const plan = await planned('u-site', {
      rhythm: 'monthly',
      weekdays: null,
      dayOfMonth: dateOf(pass),
      showsFromDay: dateOf(today),
    })

    expect(plan.status).toBe(201)
    expect((await roundsOf(plan.body['id'])).map((round) => round.due_on)).toEqual([pass])

    const { rows } = await admin.query<{ shows_from_day: number; lead_days: number }>(
      'select shows_from_day, lead_days from round_plans where id = $1',
      [plan.body['id']],
    )

    expect(rows).toEqual([{ shows_from_day: dateOf(today), lead_days: 0 }])
  })

  it('makes the round of a yearly pass a hundred days ahead, and its deadline falls due when the next one shows', async () => {
    const pass = plus(100)
    const plan = await planned('u-site', {
      rhythm: 'yearly',
      weekdays: null,
      dayOfMonth: dateOf(pass),
      month: monthOf(pass),
      showsFromDay: dateOf(today),
      showsFromMonth: monthOf(today),
    })

    expect(plan.status).toBe(201)
    expect((await roundsOf(plan.body['id'])).map((round) => round.due_on)).toEqual([pass])

    await engineRun('01:00')

    const { rows } = await admin.query<{ due_on: string; anchor_on: string }>(
      `select to_char(due_on, 'YYYY-MM-DD') as due_on, to_char(anchor_on, 'YYYY-MM-DD') as anchor_on
         from deadlines where round_plan_id = $1 and kind = 'round.due'`,
      [plan.body['id']],
    )

    // The next pass is a year after this one, and its round shows about a hundred days before it.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.anchor_on.slice(5)).toBe(pass.slice(5))
    expect(rows[0]?.anchor_on.slice(0, 4)).toBe(String(Number(pass.slice(0, 4)) + 1))
    expect((rows[0]?.due_on ?? '') < (rows[0]?.anchor_on ?? '')).toBe(true)
    expect(rows[0]?.due_on).toBe(
      `${String(Number(today.slice(0, 4)) + 1)}-${today.slice(5).replace('02-29', '02-28')}`,
    )
  })

  it('drops a lead a weekly plan kept from before at its next change, and takes none for it', async () => {
    const plan = await planInserted({ rhythm: 'weekly', weekdays: `{${String(weekdayOf(today))}}` })

    await admin.query('update round_plans set lead_days = 3 where id = $1', [plan])

    const rested = await answered(
      http()
        .patch(`/round-plans/${plan}`)
        .set(testIdentityHeader, by('u-site'))
        .send({ resting: true }),
    )

    expect(rested.status).toBe(200)

    const { rows } = await admin.query<{ lead_days: number }>(
      'select lead_days from round_plans where id = $1',
      [plan],
    )

    expect(rows).toEqual([{ lead_days: 0 }])
    expect(
      await answered(
        http()
          .patch(`/round-plans/${plan}`)
          .set(testIdentityHeader, by('u-site'))
          .send({ leadDays: 2 }),
      ),
    ).toMatchObject({
      status: 400,
      message:
        'Nur ein täglicher Plan hat einen Vorlauf; die anderen zeigen ihren Rundgang ab „Sichtbar ab“.',
    })
  })

  it('is held by the database to a day its rhythm can name', async () => {
    const plan = await planInserted({ rhythm: 'weekly', weekdays: '{3}' })

    await expect(
      admin.query('update round_plans set shows_from_day = 8 where id = $1', [plan]),
    ).rejects.toThrow(/round_plans_shows_from/)
    await expect(
      admin.query('update round_plans set shows_from_month = 1 where id = $1', [plan]),
    ).rejects.toThrow(/round_plans_shows_from/)
  })
})

describe('a point for every asset of a kind (#343)', () => {
  const everyBuilding = randomUUID()
  const ownAreaBuilding = randomUUID()
  const first = randomUUID()
  const second = randomUUID()
  const shutDown = randomUUID()
  const elsewhere = randomUUID()
  const southern = randomUUID()
  const looks: Record<string, string> = {}
  let everyTemplate = ''

  beforeAll(async () => {
    await admin.query(
      `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
       values ($1, $2, $3, $4, 'Verwaltung', '{school}')`,
      [everyBuilding, tenant, northProperty, north],
    )
    await admin.query(
      `insert into buildings (id, tenant_id, property_id, area_id, own_area_id, name, kinds)
       values ($1, $2, $3, $4, $4, 'Werkstatt Süd', '{school}')`,
      [ownAreaBuilding, tenant, northProperty, south],
    )

    for (const [id, building, area, number] of [
      [second, everyBuilding, north, 'AN-00102'],
      [first, everyBuilding, north, 'AN-00101'],
      [shutDown, everyBuilding, north, 'AN-00103'],
      [elsewhere, otherBuilding, north, 'AN-00104'],
      [southern, ownAreaBuilding, south, 'AN-00105'],
    ] as const) {
      await admin.query(
        `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
         values ($1, $2, $3, $4, $5, 'probe.elevator', $6, $7)`,
        [id, tenant, northProperty, area, building, number, `Aufzug ${number}`],
      )
    }

    // Shut down since a year ago: no round asks about it any more.
    await admin.query(
      `insert into asset_lifecycle (tenant_id, property_id, area_id, asset_id, state, valid_from)
       values ($1, $2, $3, $4, 'decommissioned', $5)`,
      [tenant, northProperty, north, shutDown, addDays(today, -365)],
    )

    for (const [name, asset] of [
      ['first', first],
      ['second', second],
      ['shutDown', shutDown],
    ] as const) {
      const { rows } = await admin.query<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                             counting, interval_months, confirmed_by)
         values ($1, $2, $3, $4, 'probe.elevator_look', 1, 'from_performance', 1, 'u-lead')
         returning id`,
        [tenant, northProperty, north, asset],
      )

      looks[name] = rows[0]?.id ?? ''
    }

    const { rows: made } = await admin.query<{ id: string }>(
      `insert into round_templates (tenant_id, title) values ($1, 'Aufzüge, monatlich') returning id`,
      [tenant],
    )

    everyTemplate = made[0]?.id ?? ''
    await admin.query(
      `insert into round_template_versions (tenant_id, template_id, form_version, definition, asks_countersignature)
       values ($1, $2, 1, $3, false)`,
      [
        tenant,
        everyTemplate,
        JSON.stringify({
          title: 'Aufzüge, monatlich',
          sections: [
            {
              key: 'k1',
              title: 'Aufzüge',
              fields: [
                {
                  kind: 'check_point',
                  key: 'p1',
                  label: 'Aufzug ohne Störung',
                  everyAssetOf: 'probe.elevator',
                  fulfilsKind: 'probe.elevator_look',
                },
                { kind: 'check_point', key: 'p2', label: 'Maschinenraum verschlossen' },
              ],
            },
          ],
        }),
      ],
    )
  })

  /** The round of today a plan at the building makes for the technician. */
  async function roundOfToday(): Promise<ActivityId> {
    const plan = await planned('u-site', {
      templateId: everyTemplate,
      buildingId: everyBuilding,
      performerUserId: 'u-tech',
    })

    expect(plan.status).toBe(201)

    const [round] = await roundsOf(plan.body['id'])

    return round?.id as ActivityId
  }

  async function pointAssetsOf(round: string): Promise<unknown> {
    const { rows } = await admin.query<{ point_assets: unknown }>(
      'select point_assets from activities where id = $1',
      [round],
    )

    return rows[0]?.point_assets
  }

  function answerOf(round: string, fieldKey: string, asset: string | null, result: string) {
    return admin.query(
      `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, asset_id,
                                     result, remark)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenant,
        northProperty,
        north,
        round,
        fieldKey,
        asset,
        result,
        result === 'not_ok' ? 'Tür schließt nicht ganz.' : null,
      ],
    )
  }

  it('gives a round every asset of its kind at the place of its plan, without one shut down, and the duty of its kind at each', async () => {
    const round = await roundOfToday()

    expect(await pointAssetsOf(round)).toEqual({ p1: [first, second] })

    const { rows } = await admin.query<{ duty_id: string }>(
      'select duty_id from activity_duties where activity_id = $1 and deleted_at is null',
      [round],
    )

    expect(rows.map((row) => row.duty_id).sort()).toEqual([looks['first'], looks['second']].sort())
  })

  it('takes at a plan of the property the assets of its area in every building, and none of a building with an area of its own', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into round_plans (tenant_id, property_id, area_id, template_id, rhythm, weekdays, starts_on)
       values ($1, $2, $3, $4, 'daily', '{1,2,3,4,5,6,7}', $5) returning id`,
      [tenant, northProperty, north, everyTemplate, today],
    )
    const plan = rows[0]?.id ?? ''

    await engineRun('01:00')
    await engineRun()

    const [round] = await roundsOf(plan)

    // The elevator of the Wache stands there from the start.
    expect(await pointAssetsOf(round?.id ?? '')).toEqual({
      p1: [elsewhere, first, second, northAsset],
    })
  })

  it('takes an answer for each of its assets and none else, and writes the evidence of the duty of each with the answer about it', async () => {
    const round = await roundOfToday()

    await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
      round,
      today,
    ])

    // Without its asset, with one the round was not given, and at a point that asks about none.
    await expect(answerOf(round, 'p1', null, 'ok')).rejects.toMatchObject({ code: 'HT012' })
    await expect(answerOf(round, 'p1', shutDown, 'ok')).rejects.toMatchObject({ code: 'HT012' })
    await expect(answerOf(round, 'p2', first, 'ok')).rejects.toMatchObject({ code: 'HT012' })

    await answerOf(round, 'p1', first, 'ok')
    await answerOf(round, 'p1', second, 'not_ok')
    await answerOf(round, 'p2', null, 'ok')

    // Once for each asset.
    await expect(answerOf(round, 'p1', first, 'ok')).rejects.toMatchObject({ code: '23505' })

    await database.forTenant({ tenantId: tenant, userId: 'u-tech' }, async (tx) => {
      const [row] = await tx.select().from(activities).where(eq(activities.id, round))

      if (row === undefined) {
        throw new Error('No such round')
      }

      await takeSignature(
        tx,
        {
          tenantId: tenant,
          writtenBy: 'u-tech',
          at: new Date(),
          catalogue,
          nameOf: (userId) => `Person ${userId}`,
        },
        {
          activityId: round,
          role: 'signer',
          signedAt: new Date(),
          deviceInfo: 'Probe-Telefon',
          path: 'M10,10L200,300',
          typedName: null,
          pageFingerprint: pageFingerprint(await pageOf(tx, row)),
        },
      )
    })

    // "Nicht in Ordnung" is a defect at exactly the asset it is about.
    const { rows: found } = await admin.query<{ asset_id: string; description: string }>(
      'select asset_id, description from defects where found_in_activity_id = $1',
      [round],
    )

    expect(found).toEqual([
      { asset_id: second, description: 'Aufzug ohne Störung: Tür schließt nicht ganz.' },
    ])

    // Each duty its own evidence, holding the answer about its asset alone.
    const { rows: written } = await admin.query<{
      duty_id: string
      origin: string
      result: string
      state: { answers: { asset?: { number: string | null }; result: string | null }[] }
    }>('select duty_id, origin, result, state from evidence where activity_id = $1', [round])

    expect(
      written
        .map((each) => [
          each.duty_id,
          each.origin,
          each.result,
          each.state.answers.map((answer) => [answer.asset?.number, answer.result]),
        ])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    ).toEqual(
      [
        [looks['first'], 'round_point', 'without_defects', [['AN-00101', 'ok']]],
        [looks['second'], 'round_point', 'with_defects', [['AN-00102', 'not_ok']]],
      ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    )

    // The round as a whole names every asset with its answer.
    const { rows: records } = await admin.query<{
      state: { answers: { label: string; asset?: { number: string | null } }[] }
    }>('select state from round_records where activity_id = $1', [round])

    expect(
      records[0]?.state.answers.map((answer) => [answer.label, answer.asset?.number ?? null]),
    ).toEqual([
      ['Aufzug ohne Störung', 'AN-00101'],
      ['Aufzug ohne Störung', 'AN-00102'],
      ['Maschinenraum verschlossen', null],
    ])

    // The office shows the round with its assets named.
    const shown = await answered(
      http().get(`/rounds/${round}`).set(testIdentityHeader, by('u-site')),
    )

    expect(shown.body).toMatchObject({
      pointAssets: { p1: [first, second] },
      assets: expect.arrayContaining([
        { id: first, number: 'AN-00101', name: 'Aufzug AN-00101' },
        { id: second, number: 'AN-00102', name: 'Aufzug AN-00102' },
      ]),
    })
  })

  it('gives a round nobody has begun the assets of a new version of its template, and none where it has no such point', async () => {
    const round = await roundOfToday()

    expect(await pointAssetsOf(round)).toEqual({ p1: [first, second] })

    await admin.query(
      `insert into round_template_versions (tenant_id, template_id, form_version, definition, asks_countersignature)
       values ($1, $2, 2, $3, false)`,
      [
        tenant,
        everyTemplate,
        JSON.stringify({
          title: 'Aufzüge, monatlich',
          sections: [
            {
              key: 'k1',
              title: 'Aufzüge',
              fields: [{ kind: 'check_point', key: 'p2', label: 'Maschinenraum verschlossen' }],
            },
          ],
        }),
      ],
    )
    await engineRun()

    expect(await pointAssetsOf(round)).toBeNull()

    const { rows } = await admin.query<{ duty_id: string }>(
      'select duty_id from activity_duties where activity_id = $1 and deleted_at is null',
      [round],
    )

    expect(rows).toEqual([])
  })
})
