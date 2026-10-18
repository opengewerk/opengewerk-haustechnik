import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  addMonths,
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueOf,
  type DutyKind,
  type IsoDate,
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
import { runDeadlinesOf } from '../deadlines/engine.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * Duties that fall due once (#439): a duty kind whose source names the day,
 * and one whose rule counts the day from the commissioning of the asset. The
 * catalogue is the probe package with two such kinds beside its main test,
 * made from it for this test alone: the first test of an elevator within the
 * 24 months of the main test after its commissioning, and a registration due
 * on a day the source names. Confirmed, the duty carries its due day and no
 * interval; it is outstanding until its day comes near, met for good by its
 * first evidence, and keeps a deadline only until then.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-duties': 'technical_management',
  'u-tech': 'technician',
}

const mainTest = 'probe.elevator_main_test'
/** Within the 24 months of the main test after the commissioning. */
const firstTest = 'probe.elevator_first_test'
/** On the day its source names. */
const registration = 'probe.elevator_registration'
const registrationDay: IsoDate = '2027-09-30'

/** The probe bundle with the two kinds that fall due once beside the main test. */
function withOnceKinds(bundle: CatalogueBundle): CatalogueBundle {
  return {
    ...bundle,
    packages: bundle.packages.map((pack) => {
      const main = pack.dutyKinds.find((entry) => entry.key === mainTest)

      if (main === undefined || !('rule' in main.definition.interval)) {
        return pack
      }

      const like = (
        key: string,
        label: string,
        interval: DutyKind['interval'],
      ): CatalogueEntry<DutyKind> => ({
        ...main,
        key,
        definition: { ...main.definition, label, interval, counting: 'once' },
      })

      return {
        ...pack,
        dutyKinds: [
          ...pack.dutyKinds,
          like(firstTest, 'Erstprüfung der Aufzugsanlage', {
            kind: 'once',
            rule: main.definition.interval.rule,
            from: 'commissioning',
          }),
          like(registration, 'Anmeldung der Aufzugsanlage', {
            kind: 'once',
            dueOn: registrationDay,
          }),
        ],
      }
    }),
  }
}

const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: [...catalogueBundle.packages, ...withOnceKinds(probeCatalogueBundle).packages],
})

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

const today = dayInGermany()

/** A property with a building and an elevator in it, commissioned on a day or on none. */
async function elevatorIn(commissionedOn: IsoDate | null): Promise<string> {
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, by('u-duties')).send(body).expect(201)).body.id

  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })

  return made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug Haus A',
    ...(commissionedOn === null ? {} : { commissionedOn }),
  })
}

function post(body: object) {
  return http().post('/duties').set(testIdentityHeader, by('u-duties')).send(body)
}

function patch(duty: string, body: object) {
  return http().patch(`/duties/${duty}`).set(testIdentityHeader, by('u-duties')).send(body)
}

async function read(duty: string) {
  return (await http().get(`/duties/${duty}`).set(testIdentityHeader, by('u-duties')).expect(200))
    .body as { state: string; appointment: { dueOn: IsoDate } | null }
}

/** An evidence of a duty on a day, put in past the application. */
async function evidenceOf(duty: string, performedOn: IsoDate): Promise<void> {
  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result, ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, 'without_defects', ${writtenPlaceholders(3)}
       from duties where id = $1`,
    [duty, performedOn, ...writtenValues('u-duties', performedOn, 'without_defects')],
  )
}

/** The day the open deadline of a duty is due on, or nothing, after a pass of the engine. */
async function deadlineOf(duty: string): Promise<string | null> {
  const now = new Date()

  await runDeadlinesOf({ database, catalogue, now: () => now }, tenant, now)

  const { rows } = await admin.query<{ due_on: string }>(
    `select due_on::text from deadlines where duty_id = $1 and status = 'open'`,
    [duty],
  )

  return rows[0]?.due_on ?? null
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [role],
    ])
  }

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

describe('a duty that falls due once', () => {
  it('is confirmed with the day its source names, and no interval', async () => {
    const elevator = await elevatorIn(null)
    const answer = await post({ assetId: elevator, kind: registration }).expect(201)

    expect(answer.body).toMatchObject({
      kind: registration,
      counting: 'once',
      dueOn: registrationDay,
      countedFrom: null,
      intervalDays: null,
      intervalMonths: null,
      maximumMonths: null,
      guideMonths: null,
    })
  })

  it('takes no interval, and no day of the asset where its source names the day', async () => {
    const elevator = await elevatorIn('2026-11-02')

    expect(
      (await post({ assetId: elevator, kind: registration, intervalMonths: 12 }).expect(400)).body
        .message,
    ).toBe(
      'Eine einmalige Pflicht hat keine Frist, sondern einen Termin; sie nennt weder Frist noch Begründung noch ein Dokument, das eine Frist trägt.',
    )
    expect(
      (await post({ assetId: elevator, kind: registration, countedFrom: '2026-11-02' }).expect(400))
        .body.message,
    ).toBe('Den Termin dieser Pflicht nennt ihre Vorschrift; sie zählt von keinem Tag der Anlage.')
  })

  it('counts its due day from the commissioning in the file of its asset, or from the day it names', async () => {
    const commissioned = await elevatorIn('2026-11-02')
    const fromTheFile = await post({ assetId: commissioned, kind: firstTest }).expect(201)

    expect(fromTheFile.body).toMatchObject({
      counting: 'once',
      countedFrom: '2026-11-02',
      dueOn: '2028-11-02',
      intervalMonths: null,
    })

    const named = await post({
      assetId: await elevatorIn(null),
      kind: firstTest,
      countedFrom: '2027-01-15',
    }).expect(201)

    expect(named.body).toMatchObject({ countedFrom: '2027-01-15', dueOn: '2029-01-15' })
    expect(
      (await post({ assetId: await elevatorIn(null), kind: firstTest }).expect(400)).body.message,
    ).toBe('Für diese Pflicht fehlt der Tag der Inbetriebnahme; von ihm aus zählt ihr Termin.')
  })

  it('changes the day it is counted from and with it its due day, never an interval or a day its source names', async () => {
    const elevator = await elevatorIn('2026-11-02')
    const counted = (await post({ assetId: elevator, kind: firstTest }).expect(201)).body.id
    const fixed = (await post({ assetId: elevator, kind: registration }).expect(201)).body.id

    expect((await patch(counted, { countedFrom: '2027-03-01' }).expect(200)).body).toMatchObject({
      countedFrom: '2027-03-01',
      dueOn: '2029-03-01',
    })
    expect((await patch(counted, { intervalMonths: 12 }).expect(400)).body.message).toBe(
      'Eine einmalige Pflicht hat keine Frist, sondern einen Termin; sie nennt weder Frist noch Begründung noch ein Dokument, das eine Frist trägt.',
    )
    expect((await patch(fixed, { countedFrom: '2027-03-01' }).expect(400)).body.message).toBe(
      'Den Termin dieser Pflicht nennt ihre Vorschrift; sie zählt von keinem Tag der Anlage.',
    )
    // Who answers for it changes like at any duty, and leaves its due day.
    expect((await patch(fixed, { responsibleUserId: 'u-tech' }).expect(200)).body).toMatchObject({
      responsibleUserId: 'u-tech',
      dueOn: registrationDay,
    })
  })

  it('is confirmed in a batch from the commissioning of each asset, or at none where one has none', async () => {
    const first = await elevatorIn('2026-11-02')
    const second = await elevatorIn(null)
    const refused = await http()
      .post('/duties/batch')
      .set(testIdentityHeader, by('u-duties'))
      .send({ kind: firstTest, assetIds: [first, second] })
      .expect(400)

    expect(refused.body.message).toContain(
      'Für diese Pflicht fehlt der Tag der Inbetriebnahme; von ihm aus zählt ihr Termin.',
    )

    const { rows } = await admin.query('select id from duties where asset_id = any($1)', [
      [first, second],
    ])

    expect(rows).toEqual([])
  })

  it('is outstanding until its day comes near, then due, and met for good by its first evidence from the day it is counted from', async () => {
    const elevator = await elevatorIn(null)
    // Counted from a day a month ago, due in 23 months.
    const later = (
      await post({ assetId: elevator, kind: firstTest, countedFrom: addMonths(today, -1) }).expect(
        201,
      )
    ).body as { id: string; dueOn: IsoDate }

    expect(await read(later.id)).toMatchObject({
      state: 'outstanding',
      appointment: { dueOn: later.dueOn },
    })

    // An evidence from before the day it is counted from does not meet it.
    await evidenceOf(later.id, addMonths(today, -2))
    expect((await read(later.id)).state).toBe('outstanding')

    await evidenceOf(later.id, today)
    expect(await read(later.id)).toMatchObject({ state: 'met', appointment: null })

    // Counted from a day almost 24 months ago, due within the lead.
    const soon = (
      await post({
        assetId: await elevatorIn(null),
        kind: firstTest,
        countedFrom: addDays(addMonths(today, -24), 10),
      }).expect(201)
    ).body as { id: string }

    expect((await read(soon.id)).state).toBe('due')
  })

  it('keeps its deadline until an evidence met it, and none afterwards', async () => {
    const elevator = await elevatorIn(null)
    const duty = (
      await post({ assetId: elevator, kind: firstTest, countedFrom: addMonths(today, -1) }).expect(
        201,
      )
    ).body as { id: string; dueOn: IsoDate }

    expect(await deadlineOf(duty.id)).toBe(duty.dueOn)

    await evidenceOf(duty.id, today)

    expect(await deadlineOf(duty.id)).toBeNull()
  })

  it('is listed in the register under "Ausstehend"', async () => {
    const elevator = await elevatorIn(null)
    const duty = (await post({ assetId: elevator, kind: registration }).expect(201)).body as {
      id: string
    }
    const register = await http()
      .get('/duties/register')
      .query({ state: 'outstanding' })
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    expect(register.body.duties.map((row: { id: string }) => row.id)).toContain(duty.id)
    expect(
      register.body.duties.every((row: { state: string }) => row.state === 'outstanding'),
    ).toBe(true)
  })
})

/** A duty of the operator's own at an asset, as an insurer asks for it once or again and again (#441). */
function own(assetId: string, values: object) {
  return post({
    assetId,
    label: 'Prüfung des Sicherheitsventils',
    basis: 'insurer',
    sourceNote: 'Versicherungsschein 4711, Auflage 3',
    task: 'inspection',
    ...values,
  })
}

const noInterval =
  'Eine einmalige Pflicht hat keine Frist, sondern einen Termin; sie nennt weder Frist noch Begründung noch ein Dokument, das eine Frist trägt.'
const noDayOfTheAsset =
  'Eine eigene Pflicht zählt von keinem Tag der Anlage; ihren Termin oder ihre Frist nennt ihre Quelle.'
const dueDayMissing = 'Der Termin einer einmaligen Pflicht fehlt; ihn nennt ihre Quelle.'
const recursWithoutDueDay =
  'Nur eine einmalige Pflicht hat einen Termin; eine Pflicht, die wiederkehrt, hat eine Frist.'

describe("a duty of the operator's own that falls due once (#441)", () => {
  it('is made with the due day its source names and no interval, and is met for good by its first evidence', async () => {
    const elevator = await elevatorIn(null)
    const dueOn = addMonths(today, 5)
    const made = (await own(elevator, { counting: 'once', dueOn }).expect(201)).body as {
      id: string
    }

    expect(made).toMatchObject({
      kind: null,
      counting: 'once',
      dueOn,
      countedFrom: null,
      intervalDays: null,
      intervalMonths: null,
    })
    expect(await read(made.id)).toMatchObject({ state: 'outstanding', appointment: { dueOn } })
    expect(await deadlineOf(made.id)).toBe(dueOn)

    await evidenceOf(made.id, today)

    expect(await read(made.id)).toMatchObject({ state: 'met', appointment: null })
    expect(await deadlineOf(made.id)).toBeNull()
  })

  it('is refused without its due day, with an interval or counted from a day of its asset, and only it has a due day', async () => {
    const elevator = await elevatorIn('2026-11-02')

    expect((await own(elevator, { counting: 'once' }).expect(400)).body.message).toBe(dueDayMissing)
    expect(
      (
        await own(elevator, { counting: 'once', dueOn: '2027-03-31', intervalMonths: 12 }).expect(
          400,
        )
      ).body.message,
    ).toBe(noInterval)
    expect(
      (
        await own(elevator, {
          counting: 'once',
          dueOn: '2027-03-31',
          countedFrom: '2026-11-02',
        }).expect(400)
      ).body.message,
    ).toBe(noDayOfTheAsset)
    expect(
      (await own(elevator, { intervalMonths: 12, dueOn: '2027-03-31' }).expect(400)).body.message,
    ).toBe(recursWithoutDueDay)
    expect(
      (await post({ assetId: elevator, kind: registration, dueOn: '2027-03-31' }).expect(400)).body
        .message,
    ).toBe(
      'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle, Tätigkeit, Zählweise und Termin von ihrer Pflichtart.',
    )
  })

  it('changes its due day as its source names it, never to none, never to an interval or a day of its asset', async () => {
    const elevator = await elevatorIn('2026-11-02')
    const once = (await own(elevator, { counting: 'once', dueOn: '2027-03-31' }).expect(201)).body
      .id as string
    const recurring = (await own(elevator, { intervalMonths: 12 }).expect(201)).body.id as string
    const fromTheCatalogue = (await post({ assetId: elevator, kind: registration }).expect(201))
      .body.id as string

    expect((await patch(once, { dueOn: '2027-06-30' }).expect(200)).body).toMatchObject({
      counting: 'once',
      dueOn: '2027-06-30',
    })
    expect((await read(once)).appointment).toMatchObject({ dueOn: '2027-06-30' })
    expect((await patch(once, { dueOn: null }).expect(400)).body.message).toBe(dueDayMissing)
    expect((await patch(once, { intervalMonths: 12 }).expect(400)).body.message).toBe(noInterval)
    expect((await patch(once, { countedFrom: '2026-11-02' }).expect(400)).body.message).toBe(
      noDayOfTheAsset,
    )
    expect((await patch(recurring, { dueOn: '2027-06-30' }).expect(400)).body.message).toBe(
      recursWithoutDueDay,
    )
    expect((await patch(fromTheCatalogue, { dueOn: '2027-06-30' }).expect(400)).body.message).toBe(
      'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle, Tätigkeit und Termin von ihrer Pflichtart.',
    )
    expect((await read(fromTheCatalogue)).appointment).toMatchObject({ dueOn: registrationDay })
  })
})

describe('the database', () => {
  it('holds a duty that falls due once to its due day, without an interval, and a day counted from to it', async () => {
    const elevator = await elevatorIn(null)
    const { rows } = await admin.query<{ property_id: string; area_id: string }>(
      'select property_id, area_id from assets where id = $1',
      [elevator],
    )
    const [place] = rows
    const insert = (columns: string, values: string) =>
      admin.query(
        `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, confirmed_by, ${columns})
         values ($1, $2, $3, $4, $5, 1, 'u-duties', ${values})`,
        [tenant, place?.property_id, place?.area_id, elevator, firstTest],
      )

    await expect(insert('counting', `'once'`)).rejects.toThrow(/duties_due_day_once/)
    await expect(
      insert('counting, due_on, interval_months', `'once', '2027-09-30', 12`),
    ).rejects.toThrow(/duties_interval_one_unit/)
    await expect(
      insert('counting, interval_months, due_on', `'from_performance', 12, '2027-09-30'`),
    ).rejects.toThrow(/duties_due_day_once/)
    await expect(
      insert('counting, due_on, counted_from', `'once', '2027-09-30', '2027-10-01'`),
    ).rejects.toThrow(/duties_counted_from_once/)
    await expect(
      insert('counting, due_on, counted_from', `'once', '2027-09-30', '2026-09-30'`),
    ).resolves.toBeDefined()
  })
})
