import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  addMonths,
  catalogueOf,
  type Counting,
  type DutyDetails,
  type DutyEntry,
  type DutyEvidenceEntry,
  type DutyReading,
  type DutyRegister,
  dutyStateOn,
  type IsoDate,
  missingRight,
  nextAppointment,
  type Right,
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
 * The register of duties, the page of one and the duties of a room (#101,
 * section 4.3 of the concept): the state of every row is the one
 * `dutyStateOn` works out on the day it is read, the day its deadline is
 * counted on; a duty nobody answers for is there without a filter; every
 * filter narrows on the server and two give what passes both; nobody reads
 * beyond their areas; and narrowing the register to one person is for
 * whoever keeps it, and answered without a number.
 *
 * Duties and evidence are put in past the application where a route would
 * not let a test choose their days. The catalogue is the probe package, an
 * elevator and a water meter.
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
/** A tenant of its own for what is counted over a whole tenant. */
const apart = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)
/** Met on this day, a duty of a year is due in ten days: within the lead of thirty. */
const dueInTenDays = addDays(addMonths(today, -12), 10)
/** Met on this day, a duty of a year has been due for about a month. */
const dueAMonthAgo = addMonths(today, -13)

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** A header for the technician with exactly these rights: one that carries rights is taken at its word. */
function holding(...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId: small, roles: ['technician'], rights })
}

const elevator = { kind: 'probe.elevator', name: 'Aufzug' }
const waterMeter = {
  kind: 'probe.water_meter',
  name: 'Wasserzähler',
  meterNumber: '9WAT1234567',
  meterUnit: 'cubic_metres',
}

interface Place {
  readonly property: string
  readonly building: string
  readonly annex: string
  /** A room on the ground floor of the building. */
  readonly room: string
}

/** A property with two buildings, Haus A with a room and Haus B. */
async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id

  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...extra,
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })

  return {
    property,
    building,
    annex: await made(`/properties/${property}/buildings`, { name: 'Haus B', kinds: ['office'] }),
    room: await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' }),
  }
}

/** An asset taken into the register through the route, an elevator of a name unless told otherwise. */
async function assetIn(
  building: string,
  name: string,
  tenantId: TenantId = small,
  body: object = elevator,
): Promise<string> {
  return (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({ ...body, name })
      .expect(201)
  ).body.id
}

/** An entry in the life cycle of an asset, by the Objektleitung. */
async function stateOf(asset: string, state: string, validFrom: IsoDate): Promise<void> {
  await http()
    .post(`/assets/${asset}/lifecycle`)
    .set(testIdentityHeader, by('u-site'))
    .send({ state, validFrom })
    .expect(201)
}

/** An evidence of a duty on a day, put in past the application. Answers its id. */
async function evidenceOf(
  duty: string,
  performedOn: IsoDate,
  result = 'without_defects',
  replaces: string | null = null,
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           replaces_evidence_id, replacement_reason, ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, $3::evidence_result, $4::uuid, $5,
            ${writtenPlaceholders(6)}
       from duties where id = $1
     returning id`,
    [
      duty,
      performedOn,
      result,
      replaces,
      replaces === null ? null : 'Falscher Tag.',
      ...writtenValues('u-duties', performedOn, result),
    ],
  )

  return rows[0]?.id ?? ''
}

/** What a duty put in past the application hangs on: one table and one row of it. */
type Target =
  | { readonly asset: string }
  | { readonly room: string }
  | { readonly building: string }
  | { readonly property: string }

interface DutyOptions {
  readonly label?: string
  readonly endsOn?: IsoDate
  readonly metOn?: readonly IsoDate[]
  readonly responsible?: string
  readonly performer?: 'own_staff' | 'contractor'
  readonly performerNote?: string
  /** From the catalogue in its first version, and not of the operator's own. */
  readonly mainTest?: boolean
}

/**
 * A duty at an asset, a room, a building or a property, met on the days
 * named: of the operator's own, of a year and counted from the day it was
 * done, or the main test of an elevator from the catalogue.
 */
async function dutyAt(target: Target, options: DutyOptions = {}): Promise<string> {
  const [table, column, id] =
    'asset' in target
      ? ['assets', 'asset_id', target.asset]
      : 'room' in target
        ? ['rooms', 'room_id', target.room]
        : 'building' in target
          ? ['buildings', 'building_id', target.building]
          : ['properties', null, target.property]
  const property = table === 'properties' ? 'id' : 'property_id'
  const what =
    options.mainTest === true
      ? `'probe.elevator_main_test', 1, $2::text, null, null, 'betrsichv', 24`
      : `null, null, $2, 'manufacturer', 'Betriebsanleitung', 'from_performance', 12`
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id${column === null ? '' : `, ${column}`},
                         kind, kind_version, label, basis, source_note, counting, interval_months,
                         confirmed_by, ends_on, responsible_user_id, performer, performer_note)
     select tenant_id, ${property}, area_id${column === null ? '' : ', id'},
            ${what},
            'u-duties', $3::date, $4, $5::duty_performer, $6
       from ${table} where id = $1
     returning id`,
    [
      id,
      options.mainTest === true ? null : (options.label ?? 'Sichtprüfung'),
      options.endsOn ?? null,
      options.responsible ?? null,
      options.performer ?? null,
      options.performerNote ?? null,
    ],
  )
  const duty = rows[0]?.id ?? ''

  for (const day of options.metOn ?? []) {
    await evidenceOf(duty, day)
  }

  return duty
}

/** A page of the register as somebody reads it. */
async function register(
  query: Readonly<Record<string, string>> = {},
  header: string = by('u-tech'),
): Promise<DutyRegister> {
  return (
    await http().get('/duties/register').query(query).set(testIdentityHeader, header).expect(200)
  ).body
}

/** What the duties on a page are called, in its order. */
async function titlesOf(
  query: Readonly<Record<string, string>>,
  header?: string,
): Promise<string[]> {
  return (await register(query, header)).duties.map((duty) => duty.title)
}

async function pageOf(duty: string, header: string = by('u-tech')): Promise<DutyDetails> {
  return (await http().get(`/duties/${duty}`).set(testIdentityHeader, header).expect(200)).body
}

/** Five elevators in a building, each with a duty of a year in another state. */
async function oneOfEachState(place: Place) {
  const lift = (name: string) => assetIn(place.building, name)
  const resting = await lift('Aufzug E')

  await stateOf(resting, 'in_service', '2015-03-01')
  await stateOf(resting, 'decommissioned', daysAgo(20))

  return {
    met: await dutyAt(
      { asset: await lift('Aufzug D') },
      { label: 'Erfüllt', metOn: [daysAgo(10)] },
    ),
    dormant: await dutyAt({ asset: resting }, { label: 'Ruht', metOn: [dueAMonthAgo] }),
    due: await dutyAt(
      { asset: await lift('Aufzug C') },
      { label: 'Fällig', metOn: [dueInTenDays] },
    ),
    overdue: await dutyAt(
      { asset: await lift('Aufzug B') },
      { label: 'Überfällig', metOn: [dueAMonthAgo] },
    ),
    never: await dutyAt({ asset: await lift('Aufzug A') }, { label: 'Nie erfasst' }),
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
    apart,
    'Stadtwerke Probe',
  ])

  // The large tenant has its two areas before anybody works for it, so that
  // it does not begin with the one a tenant gets with its first membership.
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

    for (const tenantId of [small, large, apart]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
      ])
    }
  }

  // In the large tenant the technician works in the north.
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

describe('the register of duties', () => {
  it('gives every row the state dutyStateOn works out today, the day its deadline is counted on', async () => {
    const place = await placeIn()
    const duties = await oneOfEachState(place)
    // Counted as § 14 Abs. 5 BetrSichV counts, on time until two months after the due month.
    const mainTest = await dutyAt(
      { asset: await assetIn(place.annex, 'Aufzug F') },
      { mainTest: true, metOn: [addMonths(today, -25)] },
    )
    const met: Readonly<Record<string, readonly IsoDate[]>> = {
      [duties.met]: [daysAgo(10)],
      [duties.dormant]: [dueAMonthAgo],
      [duties.due]: [dueInTenDays],
      [duties.overdue]: [dueAMonthAgo],
      [duties.never]: [],
      [mainTest]: [addMonths(today, -25)],
    }

    const page = await register({ propertyId: place.property })

    expect(page.duties).toHaveLength(6)

    for (const row of page.duties) {
      const counting: Counting = row.id === mainTest ? 'betrsichv' : 'from_performance'

      expect({ id: row.id, state: row.state, appointment: row.appointment }).toEqual({
        id: row.id,
        ...dutyStateOn({
          appointment: nextAppointment(
            { counting, interval: { months: row.intervalMonths ?? 0 } },
            met[row.id] ?? [],
          ),
          resting: row.id === duties.dormant,
          // The lead of the kind of deadline, which no tenant here has changed.
          leadDays: 30,
          on: dayInGermany(),
        }),
      })
    }

    // Each of the five states is among them, never recorded before overdue.
    expect(page.duties.map((row) => [row.id, row.state])).toEqual([
      [duties.never, 'never_recorded'],
      [duties.overdue, 'overdue'],
      // Due since the first of last month, and on time until the end of next month.
      [mainTest, 'due'],
      [duties.due, 'due'],
      [duties.met, 'met'],
      [duties.dormant, 'dormant'],
    ])

    // The deadline engine counts the same appointment on the same day: a
    // deadline for every duty that has one and does not rest, due on the day
    // its row names.
    const now = new Date()

    await runDeadlinesOf({ database, catalogue, now: () => now }, small, now)

    const { rows: kept } = await admin.query<{ duty_id: string; due_on: string }>(
      `select duty_id, due_on::text from deadlines where property_id = $1 and status = 'open'`,
      [place.property],
    )

    expect(Object.fromEntries(kept.map((row) => [row.duty_id, row.due_on]))).toEqual(
      Object.fromEntries(
        page.duties
          .filter((row) => row.state !== 'never_recorded' && row.state !== 'dormant')
          .map((row) => [row.id, row.appointment?.dueOn]),
      ),
    )
  })

  it('names what a duty hangs on, its interval, who answers for it, who performs it and its last evidence', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')
    const duty = await dutyAt(
      { asset: lift },
      {
        label: 'Wartung',
        responsible: 'u-site',
        performer: 'contractor',
        performerNote: 'Aufzugsdienst Beispiel GmbH',
      },
    )

    await evidenceOf(duty, daysAgo(400))

    const last = await evidenceOf(duty, daysAgo(10))

    // What was not carried out met nothing, and is not the last evidence.
    await evidenceOf(duty, daysAgo(1), 'not_performed')

    const [row] = (await register({ propertyId: place.property })).duties
    const dueOn = addMonths(daysAgo(10), 12)

    expect(row).toEqual({
      id: duty,
      kind: null,
      kindVersion: null,
      label: 'Wartung',
      basis: 'manufacturer',
      sourceNote: 'Betriebsanleitung',
      task: null,
      counting: 'from_performance',
      intervalDays: null,
      intervalMonths: 12,
      intervalReason: null,
      endsOn: null,
      title: 'Wartung',
      state: 'met',
      appointment: { dueOn, onTimeUntil: dueOn },
      lastMetOn: daysAgo(10),
      propertyId: place.property,
      buildingId: null,
      roomId: null,
      assetId: lift,
      responsibleUserId: 'u-site',
      performer: 'contractor',
      performerNote: 'Aufzugsdienst Beispiel GmbH',
      ended: false,
      asset: {
        id: lift,
        number: expect.stringMatching(/^AN-\d{5}$/),
        name: 'Aufzug Haus A',
        kind: 'probe.elevator',
        buildingId: place.building,
        roomId: null,
      },
      responsible: { userId: 'u-site', name: 'Dennis Roth' },
      // The row links to its page (#109).
      lastEvidence: {
        id: last,
        number: expect.stringMatching(/^NW-TEST-\d{5}$/),
        performedOn: daysAgo(10),
        origin: 'report',
      },
    } satisfies Record<keyof DutyEntry, unknown>)
  })

  it('lists a duty at a room, at a building and at the property itself, and one from the catalogue by its kind', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')

    await dutyAt({ room: place.room }, { label: 'Raum frei von Brandlasten' })
    await dutyAt({ building: place.annex }, { label: 'Dachrinnen reinigen' })
    await dutyAt({ property: place.property }, { label: 'Winterdienst' })
    await dutyAt({ asset: lift }, { mainTest: true })

    const page = await register({ propertyId: place.property })

    expect(
      page.duties.map((row) => [row.title, row.roomId, row.buildingId, row.assetId, row.kind]),
    ).toEqual([
      // Without an asset there is no number to go by: by what they are called.
      ['Dachrinnen reinigen', null, place.annex, null, null],
      ['Raum frei von Brandlasten', place.room, null, null, null],
      ['Winterdienst', null, null, null, null],
      ['Hauptprüfung der Aufzugsanlage', null, null, lift, 'probe.elevator_main_test'],
    ])
    expect(page.duties.map((row) => row.asset?.name ?? null)).toEqual([
      null,
      null,
      null,
      'Aufzug Haus A',
    ])
    expect({ total: page.total, assets: page.assets, places: page.places }).toEqual({
      total: 4,
      assets: 1,
      places: 3,
    })
  })

  it('gives a duty of the operator own at a building the appointment and the state of one from the catalogue', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')
    // Through the route, as the form of the office makes it: counted and
    // as long as the main test of the catalogue beside it.
    const own: string = (
      await http()
        .post('/duties')
        .set(testIdentityHeader, by('u-duties'))
        .send({
          buildingId: place.annex,
          label: 'Prüfung der Blitzschutzanlage',
          basis: 'authority',
          sourceNote: 'Baugenehmigung vom 12.03.2019, Auflage 7',
          task: 'inspection',
          counting: 'betrsichv',
          intervalMonths: 24,
        })
        .expect(201)
    ).body.id
    const fromTheCatalogue = await dutyAt({ asset: lift }, { mainTest: true })
    const standing = async () => {
      const rows = (await register({ propertyId: place.property })).duties
      const of = (id: string) => {
        const row = rows.find((each) => each.id === id)

        return { state: row?.state, appointment: row?.appointment, lastMetOn: row?.lastMetOn }
      }

      return { own: of(own), fromTheCatalogue: of(fromTheCatalogue) }
    }

    // Never recorded, both of them, and without an appointment.
    const before = await standing()

    expect(before.own).toEqual({ state: 'never_recorded', appointment: null, lastMetOn: null })
    expect(before.own).toEqual(before.fromTheCatalogue)

    for (const duty of [own, fromTheCatalogue]) {
      await evidenceOf(duty, daysAgo(1200))
    }

    // Met on the same day more than three years ago: overdue alike, on the same day, on any
    // day of the month (800 days were within the window of the appointment on some).
    const after = await standing()

    expect(after.own.state).toBe('overdue')
    expect(after.own.appointment).not.toBeNull()
    expect(after.own).toEqual(after.fromTheCatalogue)
  })

  it('shows a duty nobody answers for without any filter, counts those, and narrows to them', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')

    await dutyAt({ asset: lift }, { label: 'Mit Person', responsible: 'u-site' })
    await dutyAt({ asset: lift }, { label: 'Ohne Person' })
    // One that has ended calls for nothing, and for nobody either.
    await dutyAt({ asset: lift }, { label: 'Beendet ohne Person', endsOn: daysAgo(1) })

    const page = await register({ propertyId: place.property })

    expect(page.duties.map((row) => [row.title, row.responsible?.name ?? null])).toEqual([
      ['Mit Person', 'Dennis Roth'],
      ['Ohne Person', null],
    ])
    expect(page.withoutResponsible).toBe(1)

    // Every role narrows to them: that names no person.
    for (const userId of Object.keys(people)) {
      expect(
        await titlesOf({ propertyId: place.property, responsible: 'none' }, by(userId)),
      ).toEqual(['Ohne Person'])
    }

    // The count says so whatever state the page is narrowed to.
    expect(
      (await register({ propertyId: place.property, state: 'overdue' })).withoutResponsible,
    ).toBe(1)
  })

  it('narrows by state, each to the duties in it, and counts every state whatever the page is narrowed to', async () => {
    const place = await placeIn()

    await oneOfEachState(place)
    await dutyAt(
      { asset: await assetIn(place.annex, 'Aufzug G') },
      { label: 'Beendet', metOn: [dueAMonthAgo], endsOn: daysAgo(1) },
    )

    const counts = {
      never_recorded: 1,
      overdue: 1,
      due: 1,
      met: 1,
      dormant: 1,
      ended: 1,
    }

    expect((await register({ propertyId: place.property })).counts).toEqual(counts)

    for (const [state, title] of [
      ['never_recorded', 'Nie erfasst'],
      ['overdue', 'Überfällig'],
      ['due', 'Fällig'],
      ['met', 'Erfüllt'],
      ['dormant', 'Ruht'],
      ['ended', 'Beendet'],
    ] as const) {
      const page = await register({ propertyId: place.property, state })

      expect(page.duties.map((row) => row.title)).toEqual([title])
      expect({ total: page.total, counts: page.counts }).toEqual({ total: 1, counts })
    }
  })

  it('narrows to the duties whose appointment falls in the next 30 or 90 days, the overdue ones only where the window says so (#122)', async () => {
    const place = await placeIn()
    const metForDueIn = (days: number) => addDays(addMonths(today, -12), days)

    await oneOfEachState(place)
    await dutyAt(
      { asset: await assetIn(place.annex, 'Aufzug G') },
      { label: 'In 60 Tagen', metOn: [metForDueIn(60)] },
    )
    await dutyAt(
      { asset: await assetIn(place.annex, 'Aufzug H') },
      { label: 'In 100 Tagen', metOn: [metForDueIn(100)] },
    )
    await dutyAt(
      { asset: await assetIn(place.annex, 'Aufzug I') },
      { label: 'Beendet', metOn: [dueInTenDays], endsOn: daysAgo(1) },
    )

    const within = (due: string, state?: string) =>
      titlesOf({ propertyId: place.property, due, ...(state === undefined ? {} : { state }) })

    expect(await within('in_30_days')).toEqual(['Fällig'])
    expect(await within('in_90_days')).toEqual(['Fällig', 'In 60 Tagen'])
    expect(await within('overdue_or_in_30_days')).toEqual(['Überfällig', 'Fällig'])

    // The window narrows like a place: the state within it, and the counts are those in it.
    expect(await within('in_90_days', 'met')).toEqual(['In 60 Tagen'])
    expect(await within('in_30_days', 'overdue')).toEqual([])
    expect((await register({ propertyId: place.property, due: 'in_90_days' })).counts).toEqual({
      never_recorded: 0,
      overdue: 0,
      due: 1,
      met: 1,
      dormant: 0,
      ended: 0,
    })
  })

  it('keeps the duties that have ended in a list of their own, the newest end first', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')

    await dutyAt({ asset: lift }, { label: 'Läuft' })
    await dutyAt({ asset: lift }, { label: 'Endet morgen', endsOn: addDays(today, 1) })
    await dutyAt({ asset: lift }, { label: 'Endete heute', endsOn: today })
    await dutyAt({ asset: lift }, { label: 'Endete früher', endsOn: daysAgo(30) })

    const running = await register({ propertyId: place.property })

    expect(running.duties.map((row) => [row.title, row.ended])).toEqual([
      ['Endet morgen', false],
      ['Läuft', false],
    ])
    expect(running.total).toBe(2)

    const ended = await register({ propertyId: place.property, state: 'ended' })

    expect(ended.duties.map((row) => [row.title, row.ended, row.endsOn])).toEqual([
      ['Endete heute', true, today],
      ['Endete früher', true, daysAgo(30)],
    ])
    // One that has ended is in no list of a state.
    expect(await titlesOf({ propertyId: place.property, state: 'never_recorded' })).toEqual([
      'Endet morgen',
      'Läuft',
    ])
  })

  it('narrows by property and by building: the duties at the building, at its rooms and at the assets in it', async () => {
    const here = await placeIn()
    const there = await placeIn()

    await dutyAt({ asset: await assetIn(here.building, 'Aufzug Haus A') }, { label: 'Anlage in A' })
    await dutyAt({ room: here.room }, { label: 'Raum in A' })
    await dutyAt({ building: here.building }, { label: 'Haus A' })
    await dutyAt({ asset: await assetIn(here.annex, 'Aufzug Haus B') }, { label: 'Anlage in B' })
    await dutyAt({ property: here.property }, { label: 'Liegenschaft' })
    await dutyAt({ building: there.building }, { label: 'Woanders' })

    expect((await titlesOf({ propertyId: here.property })).sort()).toEqual([
      'Anlage in A',
      'Anlage in B',
      'Haus A',
      'Liegenschaft',
      'Raum in A',
    ])
    expect((await titlesOf({ buildingId: here.building })).sort()).toEqual([
      'Anlage in A',
      'Haus A',
      'Raum in A',
    ])
    expect(await titlesOf({ buildingId: here.annex })).toEqual(['Anlage in B'])
    // A building of another property together with this property: nothing is in both.
    expect(await titlesOf({ propertyId: here.property, buildingId: there.building })).toEqual([])
  })

  it('narrows by the kind of the asset and by the duty kind, and by two filters to what passes both', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')
    const meter = await assetIn(place.building, 'Wasserzähler', small, waterMeter)

    await dutyAt({ asset: lift }, { mainTest: true })
    await dutyAt({ asset: lift }, { label: 'Wartung', metOn: [daysAgo(10)] })
    await dutyAt({ asset: meter }, { label: 'Eichfrist' })
    await dutyAt({ room: place.room }, { label: 'Raum' })

    const at = { propertyId: place.property }

    expect((await titlesOf({ ...at, assetKind: 'probe.elevator' })).sort()).toEqual([
      'Hauptprüfung der Aufzugsanlage',
      'Wartung',
    ])
    expect(await titlesOf({ ...at, assetKind: 'probe.water_meter' })).toEqual(['Eichfrist'])
    expect(await titlesOf({ ...at, dutyKind: 'probe.elevator_main_test' })).toEqual([
      'Hauptprüfung der Aufzugsanlage',
    ])
    // Two filters give what passes both.
    expect(await titlesOf({ ...at, assetKind: 'probe.elevator', state: 'met' })).toEqual([
      'Wartung',
    ])
    expect(
      await titlesOf({
        ...at,
        assetKind: 'probe.water_meter',
        dutyKind: 'probe.elevator_main_test',
      }),
    ).toEqual([])
    expect(await titlesOf({ ...at, assetKind: 'probe.unknown' })).toEqual([])
  })

  it('hands out a page at a time and says whether more follow', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')

    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      await dutyAt({ asset: lift }, { label })
    }

    const at = { propertyId: place.property }
    const first = await register({ ...at, limit: '2' })
    const second = await register({ ...at, limit: '2', offset: '2' })
    const last = await register({ ...at, limit: '2', offset: '4' })

    expect([first, second, last].map((page) => page.duties.map((row) => row.title))).toEqual([
      ['A', 'B'],
      ['C', 'D'],
      ['E'],
    ])
    expect([first, second, last].map((page) => [page.total, page.more])).toEqual([
      [5, true],
      [5, true],
      [5, false],
    ])
    expect((await register({ ...at, offset: '9' })).duties).toEqual([])
  })

  it('refuses a state there is none of and a page out of its bounds, and names nothing for a place whose id is none', async () => {
    const refused = async (query: Readonly<Record<string, string>>): Promise<string> =>
      (
        await http()
          .get('/duties/register')
          .query(query)
          .set(testIdentityHeader, by('u-tech'))
          .expect(400)
      ).body.message

    expect(await refused({ state: 'late' })).toBe(
      'Diesen Zustand kennt das Pflichtenverzeichnis nicht.',
    )
    expect(await refused({ due: 'next_week' })).toBe(
      '„Fällig“ ist eines von: in_30_days, in_90_days, overdue_or_in_30_days.',
    )
    expect(await refused({ offset: '-1' })).toBe('Eine Seite beginnt bei einer ganzen Zahl ab 0.')
    expect(await refused({ limit: '0' })).toBe('Eine Seite hält zwischen 1 und 200 Pflichten.')
    expect(await refused({ limit: '201' })).toBe('Eine Seite hält zwischen 1 und 200 Pflichten.')

    expect(await register({ propertyId: 'keine-kennung' })).toMatchObject({ total: 0, duties: [] })
    expect(await register({ buildingId: 'keine-kennung' })).toMatchObject({ total: 0, duties: [] })
    expect(await register({ areaId: 'keine-kennung' })).toMatchObject({ total: 0, duties: [] })
  })
})

describe('narrowing the register to one person', () => {
  it('is for whoever keeps the register, and the others are refused', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')

    await dutyAt({ asset: lift }, { label: 'Von Roth', responsible: 'u-site' })
    await dutyAt({ asset: lift }, { label: 'Von Wendt', responsible: 'u-tech' })

    const asked = { propertyId: place.property, responsible: 'u-site' }

    for (const userId of ['u-lead', 'u-duties']) {
      expect(await titlesOf(asked, by(userId))).toEqual(['Von Roth'])
    }

    // Not the Objektleitung, not the Haustechnik, and not about themselves either.
    for (const [userId, person] of [
      ['u-site', 'u-site'],
      ['u-tech', 'u-site'],
      ['u-tech', 'u-tech'],
    ] as const) {
      await http()
        .get('/duties/register')
        .query({ ...asked, responsible: person })
        .set(testIdentityHeader, by(userId))
        .expect(403)
        .expect((answer) => expect(answer.body.message).toBe(missingRight('duty.write')))
    }

    await http()
      .get('/duties/register')
      .query(asked)
      .set(testIdentityHeader, holding('duty.read'))
      .expect(403)
    await http()
      .get('/duties/register')
      .query(asked)
      .set(testIdentityHeader, holding('duty.read', 'duty.write'))
      .expect(200)
  })

  it('answers without a single number, and says all the same whether more follow', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')

    await dutyAt({ asset: lift }, { label: 'A', responsible: 'u-site', metOn: [dueAMonthAgo] })
    await dutyAt({ asset: lift }, { label: 'B', responsible: 'u-site', metOn: [dueAMonthAgo] })
    await dutyAt({ asset: lift }, { label: 'C', responsible: 'u-site' })
    await dutyAt({ asset: lift }, { label: 'Von niemandem' })

    const asked = { propertyId: place.property, responsible: 'u-site' }
    const keeper = by('u-duties')

    for (const query of [asked, { ...asked, state: 'overdue' }, { ...asked, state: 'ended' }]) {
      const { total, assets, places, counts } = await register(query, keeper)

      expect({ total, assets, places, counts }).toEqual({
        total: null,
        assets: null,
        places: null,
        counts: null,
      })
    }

    const first = await register({ ...asked, limit: '2' }, keeper)
    const second = await register({ ...asked, limit: '2', offset: '2' }, keeper)

    expect([first, second].map((page) => [page.duties.map((row) => row.title), page.more])).toEqual(
      [
        [['C', 'A'], true],
        [['B'], false],
      ],
    )
    // How many duties name nobody is no number about a person.
    expect(first.withoutResponsible).toBe(1)

    // Without a person, and narrowed to those of nobody, the numbers are there.
    expect((await register({ propertyId: place.property }, keeper)).total).toBe(4)
    expect(
      (await register({ propertyId: place.property, responsible: 'none' }, keeper)).counts,
    ).toMatchObject({ never_recorded: 1, overdue: 0 })
  })

  it('hands the people to choose from to whoever keeps the register, and to nobody else', async () => {
    const place = await placeIn(apart)
    const lift = await assetIn(place.building, 'Aufzug Haus A', apart)

    await dutyAt({ asset: lift }, { label: 'A', responsible: 'u-tech' })
    await dutyAt({ asset: lift }, { label: 'B', responsible: 'u-site' })
    await dutyAt({ asset: lift }, { label: 'C', responsible: 'u-site' })
    await dutyAt({ asset: lift }, { label: 'D' })

    // By name, each once, whoever is named by a duty and nobody else of the tenant.
    for (const userId of ['u-lead', 'u-duties']) {
      expect((await register({}, by(userId, apart))).people).toEqual([
        { userId: 'u-site', name: 'Dennis Roth' },
        { userId: 'u-tech', name: 'Tobias Wendt' },
      ])
    }

    // Whatever the page is narrowed to.
    expect((await register({ state: 'ended' }, by('u-duties', apart))).people).toHaveLength(2)

    for (const userId of ['u-site', 'u-tech']) {
      expect((await register({}, by(userId, apart))).people).toBeNull()
    }
  })
})

describe('the register in a tenant with two areas', () => {
  it('holds the duties of the areas of the person, whatever the address names', async () => {
    const inNorth = await placeIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await placeIn(large, { areaId: south, name: 'Campus Süd' })
    const northern = await dutyAt(
      { asset: await assetIn(inNorth.building, 'Aufzug Nord', large) },
      { label: 'Im Norden', responsible: 'u-site' },
    )
    const southern = await dutyAt(
      { asset: await assetIn(inSouth.building, 'Aufzug Süd', large) },
      { label: 'Im Süden' },
    )
    const atRoom = await dutyAt({ room: inSouth.room }, { label: 'Raum im Süden' })
    const tech = by('u-tech', large)

    await evidenceOf(southern, daysAgo(10))

    expect(await register({}, tech)).toMatchObject({
      total: 1,
      assets: 1,
      places: 0,
      counts: { never_recorded: 1, met: 0 },
      withoutResponsible: 0,
      duties: [{ id: northern, title: 'Im Norden' }],
    })

    // Naming the other area, by its property, its building or the state of its duty, opens nothing.
    const elsewhere: readonly Readonly<Record<string, string>>[] = [
      { propertyId: inSouth.property },
      { buildingId: inSouth.building },
      { state: 'met' },
      { responsible: 'none' },
    ]

    for (const query of elsewhere) {
      expect(await register(query, tech)).toMatchObject({ total: 0, duties: [] })
    }

    // The page of a duty, its evidence and the duties of a room there are not there for them.
    await http().get(`/duties/${southern}`).set(testIdentityHeader, tech).expect(404)
    await http().get(`/duties/${southern}/evidence`).set(testIdentityHeader, tech).expect(404)
    await http().get(`/rooms/${inSouth.room}/duties`).set(testIdentityHeader, tech).expect(404)
    await http().get(`/duties/${northern}`).set(testIdentityHeader, tech).expect(200)

    // Whoever sees every area reads both.
    const every = await register({}, by('u-duties', large))

    expect(every.duties.map((row) => row.id).sort()).toEqual([northern, southern, atRoom].sort())
    expect({ total: every.total, withoutResponsible: every.withoutResponsible }).toEqual({
      total: 3,
      withoutResponsible: 2,
    })
  })
})

describe('the register narrowed to an area (#122)', () => {
  it('holds the duties of that area, and nothing of an area that is not the person', async () => {
    const inNorth = await placeIn(large, { areaId: north, name: 'Werkhof Nord' })
    const inSouth = await placeIn(large, { areaId: south, name: 'Werkhof Süd' })
    const northern = await dutyAt({ building: inNorth.building }, { label: 'Gebäude im Norden' })
    const southern = await dutyAt({ building: inSouth.building }, { label: 'Gebäude im Süden' })
    const lead = by('u-duties', large)
    const ids = (page: DutyRegister) => page.duties.map((row) => row.id)
    const all = await register({}, lead)
    const ofNorth = await register({ areaId: north }, lead)
    const ofSouth = await register({ areaId: south }, lead)

    expect(ids(ofNorth)).toContain(northern)
    expect(ids(ofNorth)).not.toContain(southern)
    expect(ids(ofSouth)).toContain(southern)
    expect(ids(ofSouth)).not.toContain(northern)
    expect((ofNorth.total ?? 0) + (ofSouth.total ?? 0)).toBe(all.total)

    // The technician works in the north: the south names nothing for them.
    expect(await register({ areaId: south }, by('u-tech', large))).toMatchObject({
      total: 0,
      duties: [],
    })
    expect(ids(await register({ areaId: north }, by('u-tech', large)))).toContain(northern)
  })
})

describe('the page of a duty', () => {
  it('reads the record whole with how it stands today, its asset and who answers for it', async () => {
    const place = await placeIn()
    const lift = await assetIn(place.building, 'Aufzug Haus A')
    const duty = await dutyAt(
      { asset: lift },
      { label: 'Wartung', responsible: 'u-site', performer: 'own_staff', metOn: [dueAMonthAgo] },
    )
    const dueOn = addMonths(dueAMonthAgo, 12)

    expect(await pageOf(duty)).toMatchObject({
      id: duty,
      propertyId: place.property,
      assetId: lift,
      label: 'Wartung',
      basis: 'manufacturer',
      sourceNote: 'Betriebsanleitung',
      intervalMonths: 12,
      maximumMonths: null,
      performer: 'own_staff',
      confirmedBy: 'u-duties',
      title: 'Wartung',
      state: 'overdue',
      appointment: { dueOn, onTimeUntil: dueOn },
      lastMetOn: dueAMonthAgo,
      ended: false,
      asset: { id: lift, name: 'Aufzug Haus A', kind: 'probe.elevator' },
      responsible: { userId: 'u-site', name: 'Dennis Roth' },
    })

    // The same state its row has.
    const [row] = (await register({ propertyId: place.property })).duties

    expect([row?.state, row?.appointment]).toEqual(['overdue', { dueOn, onTimeUntil: dueOn }])
  })

  it('reads a duty at a place without an asset, one nobody answers for, and one that has ended', async () => {
    const place = await placeIn()
    const atRoom = await dutyAt({ room: place.room }, { label: 'Raum frei von Brandlasten' })
    const ended = await dutyAt(
      { building: place.building },
      { label: 'Alte Pflicht', endsOn: daysAgo(1) },
    )

    expect(await pageOf(atRoom)).toMatchObject({
      roomId: place.room,
      asset: null,
      responsible: null,
      state: 'never_recorded',
      ended: false,
    })
    expect(await pageOf(ended)).toMatchObject({ endsOn: daysAgo(1), ended: true })

    await http().get(`/duties/${newId<'duty'>()}`).set(testIdentityHeader, by('u-tech')).expect(404)
  })

  it('lists its evidence, the newest first, each with what it means for the appointment, and names nobody', async () => {
    const place = await placeIn()
    const duty = await dutyAt({ asset: await assetIn(place.building, 'Aufzug Haus A') })
    const other = await dutyAt({ asset: await assetIn(place.building, 'Aufzug Haus B') })
    const wrongDay = await evidenceOf(duty, daysAgo(40))
    const corrected = await evidenceOf(duty, daysAgo(41), 'without_defects', wrongDay)
    const invalid = await evidenceOf(duty, daysAgo(20), 'with_defects')
    const failed = await evidenceOf(duty, daysAgo(5), 'failed')

    await evidenceOf(other, daysAgo(3))
    await admin.query(
      `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
       select tenant_id, property_id, area_id, id, 'Der Bericht gehört zu einer anderen Anlage.', 'u-lead'
         from evidence where id = $1`,
      [invalid],
    )

    const listed: DutyEvidenceEntry[] = (
      await http().get(`/duties/${duty}/evidence`).set(testIdentityHeader, by('u-tech')).expect(200)
    ).body

    expect(
      listed.map((entry) => [entry.id, entry.performedOn, entry.result, entry.standing]),
    ).toEqual([
      [failed, daysAgo(5), 'failed', 'does_not_meet'],
      [invalid, daysAgo(20), 'with_defects', 'voided'],
      [wrongDay, daysAgo(40), 'without_defects', 'replaced'],
      [corrected, daysAgo(41), 'without_defects', 'counts'],
    ])
    // What a row says, and nothing about who did it or wrote it down.
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([
      'id',
      'number',
      'origin',
      'performedOn',
      'result',
      'standing',
    ])
    // The appointment is counted from the one that counts.
    expect((await pageOf(duty)).lastMetOn).toBe(daysAgo(41))
  })
})

describe('the duties of a room', () => {
  it('are the ones that hang on the room itself and have not ended, each with how it stands today', async () => {
    const place = await placeIn()
    const due = await dutyAt({ room: place.room }, { label: 'Brandlasten', metOn: [dueInTenDays] })

    await dutyAt({ room: place.room }, { label: 'Abgelaufen', endsOn: daysAgo(1) })
    await dutyAt({ room: place.room }, { label: 'Aushang prüfen' })
    // What hangs on the building or on an asset is not the room's.
    await dutyAt({ building: place.building }, { label: 'Dach' })
    await dutyAt({ asset: await assetIn(place.building, 'Aufzug Haus A') })

    const listed: DutyReading[] = (
      await http()
        .get(`/rooms/${place.room}/duties`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body
    const dueOn = addMonths(dueInTenDays, 12)

    expect(listed.map((duty) => [duty.title, duty.state, duty.appointment?.dueOn ?? null])).toEqual(
      [
        ['Aushang prüfen', 'never_recorded', null],
        ['Brandlasten', 'due', dueOn],
      ],
    )
    expect(listed[1]).toMatchObject({ id: due, lastMetOn: dueInTenDays })

    await http()
      .get(`/rooms/${newId<'room'>()}/duties`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(404)
  })
})

describe('the people to name for a duty', () => {
  it('are everybody who works for the operator, by name and whether they can still be named, and nothing else of them', async () => {
    await admin.query(
      `update memberships set blocked_at = now() where tenant_id = $1 and user_id = 'u-tech'`,
      [apart],
    )

    const listed = (
      await http()
        .get('/duties/colleagues')
        .set(testIdentityHeader, by('u-duties', apart))
        .expect(200)
    ).body

    expect(listed).toEqual([
      { userId: 'u-site', name: 'Dennis Roth', active: true },
      { userId: 'u-duties', name: 'Jörg Albrecht', active: true },
      { userId: 'u-lead', name: 'Sabine Krämer', active: true },
      { userId: 'u-tech', name: 'Tobias Wendt', active: false },
    ])
  })
})

describe('the rights to the register of duties', () => {
  it('let whoever reads duties read the register, a duty and the duties of a room; evidence and colleagues ask for their own', async () => {
    const place = await placeIn()
    const duty = await dutyAt({ room: place.room })
    const routes: readonly (readonly [string, Right])[] = [
      ['/duties/register', 'duty.read'],
      [`/duties/${duty}`, 'duty.read'],
      [`/rooms/${place.room}/duties`, 'duty.read'],
      [`/duties/${duty}/evidence`, 'evidence.read'],
      ['/duties/colleagues', 'duty.write'],
    ]
    const others: readonly Right[] = ['location.read', 'asset.read', 'duty.read', 'evidence.read']

    for (const [path, right] of routes) {
      await http()
        .get(path)
        .set(testIdentityHeader, holding(...others.filter((each) => each !== right)))
        .expect(403)
        .expect((answer) => expect(answer.body.message).toBe(missingRight(right)))
      await http().get(path).set(testIdentityHeader, holding(right)).expect(200)
    }

    // Each of the four roles reads the register, a duty, its evidence and the duties of a room.
    for (const userId of Object.keys(people)) {
      for (const [path] of routes.slice(0, 4)) {
        await http().get(path).set(testIdentityHeader, by(userId)).expect(200)
      }
    }

    // Who works here is named to whoever keeps the register: Leitung and Technische Leitung.
    for (const [userId, status] of [
      ['u-lead', 200],
      ['u-duties', 200],
      ['u-site', 403],
      ['u-tech', 403],
    ] as const) {
      await http().get('/duties/colleagues').set(testIdentityHeader, by(userId)).expect(status)
    }
  })
})
