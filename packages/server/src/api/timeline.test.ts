import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  type IsoDate,
  missingRight,
  type RoleKey,
  type TenantId,
  type Timeline,
  timelineEventWords,
  timelinePage,
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
 * The timeline of a place (#123, section 4.1 of the concept): what happened
 * at a property, a building, a room or an asset and below it, the newest
 * first, a page at a time, narrowed to a category; an evidence declared
 * invalid stands with that remark; nothing of an area the person does not
 * see; and no person is named.
 *
 * What happened is put in past the application with the days and moments a
 * test chooses: signatures, decisions, activities, defects and evidence.
 */

const tenant = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)
/** A moment on a day, at an hour in UTC. */
const at = (day: IsoDate, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`

const places = {
  property: '',
  house: '',
  annex: '',
  room: '',
  lift: '',
  boiler: '',
  southProperty: '',
}

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId]?.role as RoleKey)
}

function holding(...rights: string[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId: tenant, roles: ['technician'], rights })
}

async function added(sql: string, values: readonly unknown[]): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(`${sql} returning id`, [...values])

  return rows[0]?.id ?? ''
}

/** The tenant, property and area columns of a record, for an insert past the application. */
async function keysOf(table: string, id: string): Promise<[string, string, string]> {
  const { rows } = await admin.query<{ tenant_id: string; property_id: string; area_id: string }>(
    `select tenant_id, ${table === 'properties' ? 'id as property_id' : 'property_id'}, area_id
       from ${table} where id = $1`,
    [id],
  )
  const row = rows[0]

  return [row?.tenant_id ?? '', row?.property_id ?? '', row?.area_id ?? '']
}

/** An activity at a place, in a state, made at a moment. */
async function activityAt(
  place: {
    readonly column: 'building_id' | 'room_id' | 'asset_id'
    readonly table: string
    readonly id: string
  },
  kind: string,
  title: string,
  status: string,
  made: string,
): Promise<string> {
  const keys = await keysOf(place.table, place.id)

  return added(
    `insert into activities (tenant_id, property_id, area_id, ${place.column}, kind, title, status,
                             due_on, performed_on, closing_reason, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11)`,
    [
      ...keys,
      place.id,
      kind,
      title,
      status,
      made.slice(0, 10),
      status === 'done' || status === 'signed' ? made.slice(0, 10) : null,
      status === 'not_performed' ? 'Kein Zugang.' : null,
      made,
    ],
  )
}

async function signatureOf(activity: string, role: string, moment: string): Promise<void> {
  await added(
    `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                      signed_at, path, page_fingerprint)
     select tenant_id, property_id, area_id, id, 'u-tech', $2::signature_role, $3, 'M1,1L2,2', $4
       from activities where id = $1`,
    [activity, role, moment, 'a'.repeat(64)],
  )
}

/** A duty of a year at an asset or a building, of the operator's own. */
async function dutyAt(
  column: 'asset_id' | 'building_id',
  table: string,
  id: string,
  label: string,
) {
  return added(
    `insert into duties (tenant_id, property_id, area_id, ${column}, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     select tenant_id, property_id, area_id, id, $2, 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-lead'
       from ${table} where id = $1`,
    [id, label],
  )
}

async function evidenceOf(
  duty: string,
  performedOn: IsoDate,
  origin: string,
  activity: string | null = null,
): Promise<string> {
  const written = [...writtenValues('u-lead', performedOn, 'without_defects')]

  // The third of the written columns is the origin.
  written[2] = origin

  return added(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           activity_id, ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, 'without_defects', $3,
            ${writtenPlaceholders(4)}
       from duties where id = $1`,
    [duty, performedOn, activity, ...written],
  )
}

async function defectAt(
  column: 'asset_id' | 'room_id' | 'property_id',
  table: string,
  id: string,
  description: string,
  foundOn: IsoDate,
  checkedOn: IsoDate | null = null,
): Promise<void> {
  const keys = await keysOf(table, id)
  const at = column === 'property_id' ? [] : [id]
  const placed = column === 'property_id' ? '' : `, ${column}`
  const values = [
    ...keys,
    ...at,
    description,
    foundOn,
    checkedOn === null ? 'found' : 'verified',
    checkedOn,
  ]
  const marks = values.map((_, index) => `$${String(index + 1)}`)

  await added(
    `insert into defects (tenant_id, property_id, area_id${placed}, description, found_on, status,
                          checked_on)
     values (${marks.join(', ')})`,
    values,
  )
}

async function timeline(
  header: string,
  query: Readonly<Record<string, string>>,
): Promise<Timeline> {
  return (
    await http().get('/overview/timeline').query(query).set(testIdentityHeader, header).expect(200)
  ).body
}

/** The entries in words, each with its day and how what it is about stands. */
function said(read: Timeline): string[] {
  return read.events.map((event) => {
    const activity = event.subject.type === 'activity' ? event.subject.activityKind : null
    const mark =
      event.mark.kind === 'activity'
        ? event.mark.outcome
        : event.mark.kind === 'defect'
          ? event.mark.status
          : `${event.mark.result}${event.mark.voided ? ', voided' : ''}`

    return `${event.day} ${timelineEventWords(event.kind, activity)}: ${event.title} (${mark})`
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Stadt Probe'])

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [tenant],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

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

  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    tenant,
    'u-tech',
    north,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const header = by('u-lead')
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = (name: string, areaId: string) =>
    made('/properties', {
      name,
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      areaId,
    })

  places.property = await property('Schulzentrum Nord', north)
  places.southProperty = await property('Werkhof Süd', south)
  places.house = await made(`/properties/${places.property}/buildings`, {
    name: 'Schulhaus',
    kinds: ['school'],
  })
  places.annex = await made(`/properties/${places.property}/buildings`, {
    name: 'Mensa',
    kinds: ['school'],
  })

  const floor = await made(`/buildings/${places.house}/floors`, { name: 'Erdgeschoss', level: 0 })

  places.room = await made(`/floors/${floor}/rooms`, { number: 'E.14', name: 'Heizraum' })
  places.lift = await made(`/buildings/${places.house}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
  })
  places.boiler = await made(`/buildings/${places.house}/assets`, {
    kind: 'probe.elevator',
    name: 'Heizkessel',
    roomId: places.room,
  })

  const house = { column: 'building_id', table: 'buildings', id: places.house } as const
  const annex = { column: 'building_id', table: 'buildings', id: places.annex } as const
  const room = { column: 'room_id', table: 'rooms', id: places.room } as const
  const lift = { column: 'asset_id', table: 'assets', id: places.lift } as const

  // A round of the school house, handed in and countersigned.
  const round = await activityAt(
    house,
    'round',
    'Wöchentlicher Rundgang',
    'done',
    at(daysAgo(3), 7),
  )

  await signatureOf(round, 'signer', at(daysAgo(3), 9))
  await signatureOf(round, 'countersigner', at(daysAgo(2), 10))

  // An inspection of the elevator, signed with defects; its protocol is an
  // evidence of the application, which stands no second time.
  const liftDuty = await dutyAt('asset_id', 'assets', places.lift, 'Hauptprüfung Aufzug')
  const inspection = await activityAt(
    lift,
    'inspection',
    'Hauptprüfung Aufzug',
    'done',
    at(daysAgo(5), 6),
  )

  await signatureOf(inspection, 'signer', at(daysAgo(5), 8))
  await admin.query(
    `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result)
     select tenant_id, property_id, area_id, $1, id, 'with_defects' from duties where id = $2`,
    [inspection, liftDuty],
  )
  await evidenceOf(liftDuty, daysAgo(5), 'protocol', inspection)
  // A report of a contractor ten days ago.
  await evidenceOf(liftDuty, daysAgo(10), 'report')

  // An inspection in the boiler room, begun; one at the canteen not performed.
  await activityAt(room, 'inspection', 'Sichtprüfung Heizraum', 'started', at(daysAgo(20), 6))
  await activityAt(annex, 'maintenance', 'Wartung Lüftung', 'not_performed', at(daysAgo(20), 6))

  // One the Leitung performs itself: the Haustechnik is not shown it.
  const ofTheLead = await activityAt(
    annex,
    'inspection',
    'Prüfung der Leitung',
    'started',
    at(daysAgo(20), 6),
  )

  await admin.query(
    `update activities set responsible_user_id = 'u-lead', performer = 'own_staff',
                           performer_user_id = 'u-lead' where id = $1`,
    [ofTheLead],
  )

  // A work order at the elevator, made yesterday morning and accepted at noon.
  const order = await activityAt(lift, 'work_order', 'Notruf tauschen', 'done', at(daysAgo(1), 8))
  const [tenantId, propertyId, areaId] = await keysOf('activities', order)
  const workOrder = await added(
    `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
     values ($1, $2, $3, $4, 'AU-2026-0001', 'defect_remedy')`,
    [tenantId, propertyId, areaId, order],
  )

  await added(
    `insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision,
                                       decided_by, decided_at)
     values ($1, $2, $3, $4, 'accepted', 'u-lead', $5)`,
    [tenantId, propertyId, areaId, workOrder, at(daysAgo(1), 12)],
  )

  // Defects: one at the elevator, one in the boiler room checked again.
  await defectAt('asset_id', 'assets', places.lift, 'Notruf ohne Verbindung', daysAgo(4))
  await defectAt('room_id', 'rooms', places.room, 'Brandlast im Heizraum', daysAgo(6), daysAgo(2))
  // And one at the boiler, which stands in the boiler room.
  await defectAt('asset_id', 'assets', places.boiler, 'Kessel tropft', daysAgo(7))

  // An evidence taken over at the canteen, declared invalid.
  const canteenDuty = await dutyAt('building_id', 'buildings', places.annex, 'Prüfung Küchenabluft')
  const taken = await evidenceOf(canteenDuty, daysAgo(30), 'legacy')

  await admin.query(
    `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
     select tenant_id, property_id, area_id, id, 'Falsche Anlage.', 'u-lead' from evidence where id = $1`,
    [taken],
  )

  // In the south, a defect at the property itself.
  await defectAt('property_id', 'properties', places.southProperty, 'Tor klemmt', daysAgo(1))
}, 120_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the timeline of a place', () => {
  it('lists what happened at a building and below it, the newest first, with how it stands now', async () => {
    expect(said(await timeline(by('u-lead'), { building: places.house }))).toEqual([
      `${today} Prüfung begonnen: Sichtprüfung Heizraum (started)`,
      `${daysAgo(1)} Auftrag abgenommen: Notruf tauschen (done)`,
      `${daysAgo(1)} Auftrag angelegt: Notruf tauschen (done)`,
      `${daysAgo(2)} Mangel nachgeprüft: Brandlast im Heizraum (verified)`,
      `${daysAgo(2)} Rundgang gegengezeichnet: Wöchentlicher Rundgang (without_defects)`,
      `${daysAgo(3)} Rundgang abgegeben: Wöchentlicher Rundgang (without_defects)`,
      `${daysAgo(4)} Mangel festgestellt: Notruf ohne Verbindung (found)`,
      `${daysAgo(5)} Prüfung unterschrieben: Hauptprüfung Aufzug (with_defects)`,
      `${daysAgo(6)} Mangel festgestellt: Brandlast im Heizraum (verified)`,
      `${daysAgo(7)} Mangel festgestellt: Kessel tropft (found)`,
      `${daysAgo(10)} Nachweis eingetragen: Hauptprüfung der Aufzugsanlage (without_defects)`,
    ])
  })

  it('holds what happened at a room and to the assets in it, and at an asset only what happened to it', async () => {
    expect(said(await timeline(by('u-lead'), { room: places.room }))).toEqual([
      `${today} Prüfung begonnen: Sichtprüfung Heizraum (started)`,
      `${daysAgo(2)} Mangel nachgeprüft: Brandlast im Heizraum (verified)`,
      `${daysAgo(6)} Mangel festgestellt: Brandlast im Heizraum (verified)`,
      `${daysAgo(7)} Mangel festgestellt: Kessel tropft (found)`,
    ])
    expect(said(await timeline(by('u-lead'), { asset: places.lift }))).toEqual([
      `${daysAgo(1)} Auftrag abgenommen: Notruf tauschen (done)`,
      `${daysAgo(1)} Auftrag angelegt: Notruf tauschen (done)`,
      `${daysAgo(4)} Mangel festgestellt: Notruf ohne Verbindung (found)`,
      `${daysAgo(5)} Prüfung unterschrieben: Hauptprüfung Aufzug (with_defects)`,
      `${daysAgo(10)} Nachweis eingetragen: Hauptprüfung der Aufzugsanlage (without_defects)`,
    ])
  })

  it('holds an evidence declared invalid with that remark', async () => {
    // All today: declared invalid after the inspection of the Leitung was begun,
    // and that after the maintenance was closed.
    expect(said(await timeline(by('u-lead'), { building: places.annex }))).toEqual([
      `${today} Nachweis für ungültig erklärt: Hauptprüfung der Aufzugsanlage (without_defects, voided)`,
      `${today} Prüfung begonnen: Prüfung der Leitung (started)`,
      `${today} Wartung nicht durchgeführt: Wartung Lüftung (not_performed)`,
      `${daysAgo(30)} Nachweis eingetragen: Hauptprüfung der Aufzugsanlage (without_defects, voided)`,
    ])
  })

  it('holds everything of a property, and is narrowed to a category', async () => {
    const all = await timeline(by('u-lead'), { property: places.property })

    expect(all.events).toHaveLength(15)

    const of = async (category: string) =>
      (await timeline(by('u-lead'), { property: places.property, category })).events.map(
        (event) => event.kind,
      )

    expect(await of('rounds')).toEqual(['countersigned', 'signed'])
    expect(await of('work_orders')).toEqual(['order_accepted', 'order_made'])
    // All today: the inspection of the Leitung was begun after the maintenance at the
    // canteen was closed, and that after the inspection in the boiler room was begun.
    expect(await of('inspections')).toEqual(['started', 'not_performed', 'started', 'signed'])
    expect(await of('defects')).toEqual([
      'defect_checked',
      'defect_found',
      'defect_found',
      'defect_found',
    ])
    expect(await of('evidence')).toEqual([
      'evidence_voided',
      'evidence_entered',
      'evidence_entered',
    ])
  })

  it('hands out a page at a time and says whether older entries follow', async () => {
    const whole = (await timeline(by('u-lead'), { building: places.house })).events.map(
      (event) => event.id,
    )
    const first = await timeline(by('u-lead'), { building: places.house, limit: '4' })
    const last = await timeline(by('u-lead'), {
      building: places.house,
      offset: '8',
      limit: '4',
    })

    expect(first.events.map((event) => event.id)).toEqual(whole.slice(0, 4))
    expect(first.more).toBe(true)
    expect(last.events.map((event) => event.id)).toEqual(whole.slice(8, 12))
    expect(last.more).toBe(false)
  })

  it('holds nothing of an area the person does not see', async () => {
    expect(said(await timeline(by('u-lead'), { property: places.southProperty }))).toEqual([
      `${daysAgo(1)} Mangel festgestellt: Tor klemmt (found)`,
    ])
    expect((await timeline(by('u-tech'), { property: places.southProperty })).events).toEqual([])
  })

  it('holds of the activities what the person is shown: whoever only performs, nothing given to somebody else', async () => {
    const titles = async (userId: 'u-lead' | 'u-tech') =>
      (await timeline(by(userId), { building: places.annex })).events.map((event) => event.title)

    expect(await titles('u-lead')).toContain('Prüfung der Leitung')
    expect(await titles('u-tech')).not.toContain('Prüfung der Leitung')
    expect(await titles('u-tech')).toContain('Wartung Lüftung')
  })

  it('names nobody', async () => {
    const body = JSON.stringify(await timeline(by('u-lead'), { property: places.property }))

    for (const [userId, person] of Object.entries(people)) {
      expect(body).not.toContain(userId)
      expect(body).not.toContain(person.name)
    }
  })

  it('holds of each kind of entry only what the person may read, and is for whoever reads places', async () => {
    expect(
      (await timeline(holding('location.read'), { property: places.property })).events,
    ).toEqual([])
    expect(
      (
        await timeline(holding('location.read', 'defect.read'), { property: places.property })
      ).events.map((event) => event.kind),
    ).toEqual(['defect_checked', 'defect_found', 'defect_found', 'defect_found'])

    const refused = await http()
      .get('/overview/timeline')
      .query({ property: places.property })
      .set(testIdentityHeader, holding('defect.read'))
      .expect(403)

    expect(refused.body.message).toBe(missingRight('location.read'))
  })

  it('asks for exactly one place by its id, and a category there is', async () => {
    const refused = async (query: Readonly<Record<string, string>>) =>
      (
        await http()
          .get('/overview/timeline')
          .query(query)
          .set(testIdentityHeader, by('u-lead'))
          .expect(400)
      ).body.message as string

    expect(await refused({})).toMatch(/Eine Zeitachse ist die einer Liegenschaft/)
    expect(await refused({ property: places.property, building: places.house })).toMatch(
      /Eine Zeitachse ist die einer Liegenschaft/,
    )
    expect(await refused({ building: 'kein-gebaeude' })).toBe(
      'Ein Ort wird mit seiner Kennung genannt.',
    )
    expect(await refused({ building: places.house, category: 'tasks' })).toMatch(
      /Die Art ist eine von/,
    )
  })

  // Every source is read up to the end of the page asked for, so a page far
  // back would have the server read and sort a place's entire history (CWE-400,
  // Strix on #223).
  it('reaches back no further than its pages go', async () => {
    const page = (offset: number) =>
      http()
        .get('/overview/timeline')
        .query({ building: places.house, offset: String(offset) })
        .set(testIdentityHeader, by('u-lead'))

    await page(timelinePage.furthest).expect(200)

    const refused = await page(timelinePage.furthest + 1).expect(400)

    expect(refused.body.message).toBe(
      `Eine Seite beginnt bei einer ganzen Zahl von 0 bis ${String(timelinePage.furthest)}; ältere Einträge stehen in den Listen der Vorgänge, Mängel und Nachweise.`,
    )
  })
})
