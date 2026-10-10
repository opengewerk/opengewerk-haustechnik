import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityList,
  addDays,
  addMonths,
  catalogueOf,
  type DefectRegister,
  type DutyRegister,
  type IsoDate,
  missingRight,
  type Overview,
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
import { as, testIdentities } from './test-identity.js'

/**
 * The overview of the operator's responsibility (#122, section 4.3 of the
 * concept, scenario 1): every number is the total of the list it leads to,
 * narrowed the same way, for the same person on the same day; whoever sees
 * two of three areas gets the numbers of those two; and the overview names
 * nobody.
 *
 * An operator with three areas, each stocked alike: an overdue duty whose
 * inspection a contractor was to do a month ago and one overdue for two
 * months, so that overdue and due differ in number, a duty due in ten days, one
 * met until two months from now, one never recorded and one that has ended;
 * an inspection of the own people whose day has passed; a defect past its
 * deadline and one that is not. Everything is put in past the application,
 * where a route would not let a test choose its days.
 */

const tenant = newId<'tenant'>() as TenantId
const areas: Record<'north' | 'south' | 'east', string> = { north: '', south: '', east: '' }

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
/** Met a year before this day, a duty of a year falls due in so many days. */
const metForDueIn = (days: number): IsoDate => addDays(addMonths(today, -12), days)

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

/** An evidence of a duty on a day. */
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

/** A duty of a year at an asset, counted from the day it was done, which Jörg Albrecht answers for. */
async function dutyAt(
  asset: string,
  label: string,
  options: { readonly metOn?: IsoDate; readonly endsOn?: IsoDate } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by, ends_on, responsible_user_id,
                         performer, performer_note)
     select tenant_id, property_id, area_id, id, $2, 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-duties', $3::date, 'u-duties', 'contractor',
            'Prüfdienst Beispiel GmbH'
       from assets where id = $1
     returning id`,
    [asset, label, options.endsOn ?? null],
  )
  const duty = rows[0]?.id ?? ''

  if (options.metOn !== undefined) {
    await evidenceOf(duty, options.metOn)
  }

  return duty
}

/** An inspection of a duty, open and due on a day, which Dennis Roth answers for. */
async function inspectionOf(
  duty: string,
  dueOn: IsoDate,
  performer: { readonly contractor: string } | { readonly person: string },
): Promise<void> {
  await admin.query(
    `with activity as (
       insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                               due_on, responsible_user_id, performer, performer_user_id,
                               contractor_note)
       select tenant_id, property_id, area_id, asset_id, 'inspection', 'Prüfung', 'open', $2,
              'u-site', $3::duty_performer, $4, $5
         from duties where id = $1
       returning id, tenant_id, property_id, area_id
     )
     insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
     select tenant_id, property_id, area_id, id, $1 from activity`,
    [
      duty,
      dueOn,
      'contractor' in performer ? 'contractor' : 'own_staff',
      'person' in performer ? performer.person : null,
      'contractor' in performer ? performer.contractor : null,
    ],
  )
}

/** A defect at an asset, found ten days ago, to be set right by a day. */
async function defectAt(asset: string, dueOn: IsoDate): Promise<void> {
  await admin.query(
    `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on,
                          due_on, status)
     select tenant_id, property_id, area_id, id, 'Notleuchte ohne Funktion', $2::date, $3::date,
            'found'
       from assets where id = $1`,
    [asset, daysAgo(10), dueOn],
  )
}

/** One area stocked as the head of this file says, through the routes where they allow it. */
async function stock(area: string, name: string): Promise<void> {
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
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const asset = (label: string) =>
    made(`/buildings/${building}/assets`, { kind: 'probe.elevator', name: label })

  const overdue = await dutyAt(await asset('Aufzug 1'), 'Überfällig', { metOn: metForDueIn(-30) })

  await dutyAt(await asset('Aufzug 6'), 'Lange überfällig', { metOn: metForDueIn(-60) })

  const due = await dutyAt(await asset('Aufzug 2'), 'In 10 Tagen', { metOn: metForDueIn(10) })

  await dutyAt(await asset('Aufzug 3'), 'In 60 Tagen', { metOn: metForDueIn(60) })
  await dutyAt(await asset('Aufzug 4'), 'Nie erfasst')
  await dutyAt(await asset('Aufzug 5'), 'Beendet', { metOn: metForDueIn(-30), endsOn: daysAgo(1) })

  // The contractor was to come a month ago and no report is there; the own
  // people were to do the other one a week ago, which is no missing report.
  await inspectionOf(overdue, daysAgo(30), { contractor: 'Prüfdienst Beispiel GmbH' })
  await inspectionOf(due, daysAgo(7), { person: 'u-tech' })

  const lamp = await asset('Notleuchte')

  await defectAt(lamp, daysAgo(3))
  await defectAt(lamp, addDays(today, 5))
}

/** The overview as somebody reads it, over their areas or the one named. */
async function overview(header: string, area?: string): Promise<Overview> {
  return (
    await http()
      .get('/overview')
      .query(area === undefined ? {} : { area })
      .set(testIdentityHeader, header)
      .expect(200)
  ).body
}

async function listOf<Body>(
  path: string,
  query: Readonly<Record<string, string>>,
  header: string,
): Promise<Body> {
  return (await http().get(path).query(query).set(testIdentityHeader, header).expect(200)).body
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

  await stock(areas.north, 'Werkhof Nord')
  await stock(areas.south, 'Schulzentrum Süd')
  await stock(areas.east, 'Bürgerhaus Ost')
}, 120_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the overview of the operator responsibility', () => {
  it('counts every number as the list it leads to counts it, for each person and area', async () => {
    const askings: readonly [string, string | undefined][] = [
      ['u-lead', undefined],
      ['u-lead', areas.north],
      ['u-lead', areas.east],
      ['u-site', undefined],
      ['u-site', areas.south],
      ['u-tech', undefined],
    ]

    for (const [userId, area] of askings) {
      const header = by(userId)
      const read = await overview(header, area)
      const inArea: Record<string, string> = area === undefined ? {} : { areaId: area }
      const duties = (query: Readonly<Record<string, string>>) =>
        listOf<DutyRegister>('/duties/register', { ...query, ...inArea }, header)
      const named = (page: DutyRegister) =>
        page.duties.map((duty) => ({
          id: duty.id,
          title: duty.title,
          state: duty.state,
          appointment: duty.appointment,
          propertyId: duty.propertyId,
          buildingId: duty.buildingId,
          roomId: duty.roomId,
          assetId: duty.assetId,
          asset: duty.asset,
        }))
      const soon = await duties({ due: 'overdue_or_in_30_days', limit: '8' })
      const never = await duties({ state: 'never_recorded', limit: '3' })
      const reports = await listOf<ActivityList>(
        '/activities',
        { state: 'report_missing', ...(area === undefined ? {} : { area }) },
        header,
      )
      const defects = await listOf<DefectRegister>(
        '/defects',
        { state: 'overdue', limit: '3', ...inArea },
        header,
      )

      expect(read, `${userId} ${area ?? 'überall'}`).toEqual({
        today,
        overdue: (await duties({ state: 'overdue' })).total,
        dueIn30Days: (await duties({ due: 'in_30_days' })).total,
        dueIn90Days: (await duties({ due: 'in_90_days' })).total,
        neverRecorded: never.total,
        reportsMissing: reports.total,
        defectsOverdue: defects.total,
        soon: named(soon),
        soonTotal: soon.total,
        neverRecordedFirst: named(never),
        defectsOverdueFirst: defects.defects,
      })
    }
  })

  it('counts what the stock of each area holds: overdue apart, 90 days holding the 30, no ended duty', async () => {
    expect(await overview(by('u-lead'), areas.north)).toMatchObject({
      overdue: 2,
      dueIn30Days: 1,
      dueIn90Days: 2,
      neverRecorded: 1,
      reportsMissing: 1,
      defectsOverdue: 1,
      soonTotal: 3,
    })
    expect((await overview(by('u-lead'), areas.north)).soon.map((duty) => duty.title)).toEqual([
      'Lange überfällig',
      'Überfällig',
      'In 10 Tagen',
    ])
  })

  it('gives whoever sees two of three areas the numbers of those two, and nothing of the third', async () => {
    const everywhere = await overview(by('u-lead'))
    const site = await overview(by('u-site'))

    expect(everywhere).toMatchObject({
      overdue: 6,
      dueIn30Days: 3,
      dueIn90Days: 6,
      neverRecorded: 3,
      reportsMissing: 3,
      defectsOverdue: 3,
      soonTotal: 9,
    })
    expect(site).toMatchObject({
      overdue: 4,
      dueIn30Days: 2,
      dueIn90Days: 4,
      neverRecorded: 2,
      reportsMissing: 2,
      defectsOverdue: 2,
      soonTotal: 6,
    })
    expect(await overview(by('u-site'), areas.east)).toMatchObject({
      overdue: 0,
      dueIn30Days: 0,
      dueIn90Days: 0,
      neverRecorded: 0,
      reportsMissing: 0,
      defectsOverdue: 0,
      soon: [],
      soonTotal: 0,
      neverRecordedFirst: [],
      defectsOverdueFirst: [],
    })

    await http()
      .get('/overview')
      .query({ area: 'kein-bereich' })
      .set(testIdentityHeader, by('u-lead'))
      .expect(400, /Ein Bereich wird mit seiner Kennung genannt/)
  })

  it('names nobody: neither who answers for a duty nor who performs an inspection', async () => {
    const body = JSON.stringify(await overview(by('u-lead')))

    for (const [userId, person] of Object.entries(people)) {
      expect(body).not.toContain(userId)
      expect(body).not.toContain(person.name)
    }

    expect(body).not.toMatch(/responsible|performer/)
  })

  it('counts the reports and the defects only for whoever may read their lists, and is for whoever reads duties', async () => {
    expect(await overview(holding('duty.read'))).toMatchObject({
      overdue: 2,
      reportsMissing: null,
      defectsOverdue: null,
      defectsOverdueFirst: null,
    })
    expect(await overview(holding('duty.read', 'activity.read', 'defect.read'))).toMatchObject({
      reportsMissing: expect.any(Number),
      defectsOverdue: 1,
    })

    const refused = await http()
      .get('/overview')
      .set(testIdentityHeader, holding('activity.read', 'defect.read'))
      .expect(403)

    expect(refused.body.message).toBe(missingRight('duty.read'))
  })
})
