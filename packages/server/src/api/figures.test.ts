import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type DefectFigures,
  type DefectRegister,
  type FaultFigures,
  type FulfilmentRow,
  type IsoDate,
  type MeasureRow,
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
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The figures over time (#334, section 4.16 of the concept): for the Leitung
 * and the Technische Leitung, in the areas of whoever looks, per place and
 * never per person. The terms of a duty replayed from its evidence, the open
 * defects as the list counts them, the faults by category and building, the
 * activities by DIN 31051, and each as a table.
 */

const tenant = newId<'tenant'>() as TenantId
const areas = { north: '', south: '' }

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

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId]?.role as RoleKey)
}

/** The Objektleitung of the north with the right to look at the figures: someone who sees one area. */
const northOnly = JSON.stringify({
  userId: 'u-site',
  tenantId: tenant,
  roles: ['site_management'],
  rights: ['report.read', 'defect.read'],
})

interface Place {
  readonly property: string
  readonly building: string
  readonly asset: string
}

const places: Record<'north' | 'south', Place> = {
  north: { property: '', building: '', asset: '' },
  south: { property: '', building: '', asset: '' },
}

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

/** A yearly duty at an asset, counted from its performance, met on these days; its id. */
async function dutyAt(asset: string, metOn: readonly IsoDate[]): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by, responsible_user_id)
     select tenant_id, property_id, area_id, id, 'Prüfung', 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-duties', 'u-site'
       from assets where id = $1
     returning id`,
    [asset],
  )
  const duty = rows[0]?.id ?? ''

  for (const day of metOn) {
    await evidenceOf(duty, day)
  }

  return duty
}

async function defectAt(
  asset: string,
  defect: {
    readonly foundOn: IsoDate
    readonly dueOn: IsoDate | null
    readonly status: string
    readonly checkedOn?: IsoDate
  },
): Promise<void> {
  await admin.query(
    `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on, due_on,
                          status, checked_on)
     select tenant_id, property_id, area_id, id, 'Notleuchte ohne Funktion', $2::date, $3::date,
            $4, $5::date
       from assets where id = $1`,
    [asset, defect.foundOn, defect.dueOn, defect.status, defect.checkedOn ?? null],
  )
}

/** A fault at the building of a place, received on a day, rejected if it says so; its id. */
async function faultAt(
  place: Place,
  areaId: string,
  receivedAt: string,
  rejected = false,
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into fault_reports (tenant_id, property_id, area_id, building_id, category_id,
                                description, reported_by, received_at, rejected_at,
                                rejection_reason)
     select $1, $2, $3, $4, c.id, 'Heizkörper kalt.', 'u-tech', $5::timestamptz,
            case when $6 then $5::timestamptz + interval '1 day' end,
            case when $6 then 'Bauunterhalt der Stadt.' end
       from fault_categories c where c.tenant_id = $1 order by c.position limit 1
     returning id`,
    [tenant, place.property, areaId, place.building, receivedAt, rejected],
  )

  return rows[0]?.id ?? ''
}

/** An activity of a kind at an asset, signed and performed on a day. */
async function activityAt(asset: string, kind: string, performedOn: IsoDate): Promise<void> {
  await admin.query(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             performed_on, responsible_user_id)
     select tenant_id, property_id, area_id, id, $2::activity_kind, 'Vorgang', 'done',
            $3::date, 'u-site'
       from assets where id = $1`,
    [asset, kind, performedOn],
  )
}

async function stock(where: 'north' | 'south'): Promise<void> {
  const header = by('u-lead')
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: `Schulzentrum ${where}`,
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    areaId: areas[where],
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: where === 'north' ? 'Haus Nord' : 'Haus Süd',
    kinds: ['school'],
  })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
  })

  places[where] = { property, building, asset }
}

async function figures<Body>(
  view: string,
  query: Readonly<Record<string, string>>,
  header: string,
): Promise<Body> {
  return (
    await http().get(`/reports/${view}`).query(query).set(testIdentityHeader, header).expect(200)
  ).body as Body
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Stadt Probe'])

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

  areas.north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  areas.south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@probe.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [person.role],
    ])
  }

  await admin.query(
    `insert into member_areas (tenant_id, user_id, area_id) values ($1, 'u-site', $2), ($1, 'u-tech', $2)`,
    [tenant, areas.north],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  await stock('north')
  await stock('south')

  // The categories the first start proposes.
  await http().get('/settings/fault-categories').set(testIdentityHeader, by('u-lead')).expect(200)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the figures over time', () => {
  it('are for whoever may look at them, the Leitung and the Technische Leitung', async () => {
    for (const view of ['duties', 'defects', 'faults', 'activities']) {
      expect(
        (await http().get(`/reports/${view}`).set(testIdentityHeader, by('u-site')).expect(403))
          .body.message,
      ).toBe(missingRight('report.read'))
      await http().get(`/reports/${view}`).set(testIdentityHeader, by('u-duties')).expect(200)
    }
  })

  it('count the terms of the duties in the period they fell due in: on time, later and still open', async () => {
    // Met each year: on time for the term of 2024, later for the one of 2025,
    // and the one of March 2026 open. A duty never met has no term.
    await dutyAt(places.north.asset, ['2023-01-10', '2024-01-05', '2025-03-01'])
    await dutyAt(places.north.asset, [])

    const rows = await figures<FulfilmentRow[]>(
      'duties',
      { areaId: areas.north, from: '2023-01', to: '2026-10', grid: 'year' },
      by('u-lead'),
    )

    expect(rows.map((row) => [row.label, row.due, row.onTime, row.late, row.open])).toEqual([
      ['2023', 0, 0, 0, 0],
      ['2024', 1, 1, 0, 0],
      ['2025', 1, 0, 1, 0],
      ['2026', 1, 0, 0, 1],
    ])
  })

  it('count the defects open as the list of the defects does, by class and age, and past their day', async () => {
    await defectAt(places.north.asset, {
      foundOn: '2020-03-01',
      dueOn: '2020-04-01',
      status: 'found',
    })
    await defectAt(places.north.asset, { foundOn: '2020-05-01', dueOn: null, status: 'ordered' })
    // Remedied and not yet checked again: open, and not overdue any more.
    await defectAt(places.north.asset, {
      foundOn: '2020-06-01',
      dueOn: '2020-07-01',
      status: 'remedied',
    })
    await defectAt(places.north.asset, {
      foundOn: '2020-07-01',
      dueOn: '2020-08-01',
      status: 'verified',
      checkedOn: '2020-08-15',
    })

    const shown = await figures<DefectFigures>('defects', { areaId: areas.north }, by('u-lead'))
    const list = (
      await http()
        .get('/defects')
        .query({ areaId: areas.north, state: 'open', limit: '1' })
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as DefectRegister

    expect(shown.rows).toEqual([
      {
        defectClass: null,
        label: 'Ohne Klasse',
        bands: { month: 0, quarter: 0, year: 0, older: 3 },
        open: 3,
        overdue: 1,
      },
    ])
    expect(shown.rows.reduce((sum, row) => sum + row.open, 0)).toBe(list.counts.open)
    expect(shown.rows.reduce((sum, row) => sum + row.overdue, 0)).toBe(list.counts.overdue)
  })

  it('count the faults of the period by category and by building, the merged ones with their report', async () => {
    const first = await faultAt(places.north, areas.north, '2026-02-10T09:00:00+01:00')
    const merged = await faultAt(places.north, areas.north, '2026-02-11T09:00:00+01:00')

    await faultAt(places.north, areas.north, '2026-02-12T09:00:00+01:00', true)
    // Before the period: in no row.
    await faultAt(places.north, areas.north, '2025-12-31T09:00:00+01:00')
    await admin.query('update fault_reports set merged_into_id = $1 where id = $2', [first, merged])

    const shown = await figures<FaultFigures>(
      'faults',
      { areaId: areas.north, from: '2026-01', to: '2026-03' },
      by('u-lead'),
    )

    expect(shown.byBuilding).toEqual([
      {
        key: places.north.building,
        label: 'Haus Nord',
        sub: 'Schulzentrum north',
        received: 2,
        accepted: 0,
        done: 0,
        rejected: 1,
        daysToAcceptance: null,
        daysToDone: null,
      },
    ])
    expect(shown.byCategory.map((row) => [row.label, row.received, row.rejected])).toEqual([
      ['Elektro', 2, 1],
    ])
  })

  it('count the activities performed in a period by the basic measure of DIN 31051', async () => {
    await activityAt(places.north.asset, 'inspection', '2026-01-15')
    await activityAt(places.north.asset, 'round', '2026-02-15')
    await activityAt(places.north.asset, 'maintenance', '2026-04-02')

    const rows = await figures<MeasureRow[]>(
      'activities',
      { areaId: areas.north, from: '2026-01', to: '2026-06', grid: 'quarter' },
      by('u-lead'),
    )

    expect(rows.map((row) => [row.label, row.counts, row.total])).toEqual([
      ['1. Quartal 2026', { maintenance: 0, inspection: 2, repair: 0, improvement: 0, none: 0 }, 2],
      ['2. Quartal 2026', { maintenance: 1, inspection: 0, repair: 0, improvement: 0, none: 0 }, 1],
    ])
  })

  it('see the areas of whoever looks and nothing of the others', async () => {
    await dutyAt(places.south.asset, ['2023-01-10', '2024-01-05'])
    await defectAt(places.south.asset, { foundOn: '2020-03-01', dueOn: null, status: 'found' })
    await faultAt(places.south, areas.south, '2026-02-10T09:00:00+01:00')
    await activityAt(places.south.asset, 'inspection', '2026-01-20')

    const query = { from: '2023-01', to: '2026-06', grid: 'year' }
    const total = (rows: readonly FulfilmentRow[]) => rows.reduce((sum, row) => sum + row.due, 0)
    const done = (rows: readonly MeasureRow[]) => rows.reduce((sum, row) => sum + row.total, 0)

    // The Leitung sees both areas, the north alone what lies in the north.
    const inNorth = total(await figures('duties', { ...query, areaId: areas.north }, by('u-lead')))
    const inSouth = total(await figures('duties', { ...query, areaId: areas.south }, by('u-lead')))

    // The duty of the south was met on time in 2024 and has been open since 2025.
    expect(inSouth).toBe(2)
    expect(total(await figures('duties', query, by('u-lead')))).toBe(inNorth + inSouth)
    expect(total(await figures('duties', query, northOnly))).toBe(
      total(await figures('duties', { ...query, areaId: areas.north }, by('u-lead'))),
    )
    expect(total(await figures('duties', { ...query, areaId: areas.south }, northOnly))).toBe(0)
    expect(
      (await figures<DefectFigures>('defects', { areaId: areas.south }, northOnly)).rows,
    ).toEqual([])
    expect(
      (await figures<FaultFigures>('faults', { ...query, areaId: areas.south }, northOnly))
        .byBuilding,
    ).toEqual([])
    expect(done(await figures('activities', query, northOnly))).toBe(
      done(await figures('activities', { ...query, areaId: areas.north }, by('u-lead'))),
    )
  })

  it('name nobody, in no answer and no table, and group by no person', async () => {
    const query = { from: '2023-01', to: '2026-10', grid: 'month' }
    const said: string[] = []

    for (const view of ['duties', 'defects', 'faults', 'activities']) {
      said.push(JSON.stringify(await figures(view, query, by('u-lead'))))
      said.push(
        (
          await http()
            .get(`/reports/${view}/table`)
            .query({ ...query, format: 'csv' })
            .set(testIdentityHeader, by('u-lead'))
            .expect(200)
        ).text,
      )
    }

    const all = said.join('\n')

    for (const [userId, person] of Object.entries(people)) {
      expect(all).not.toContain(userId)
      expect(all).not.toContain(person.name)
    }

    for (const word of ['Person', 'Mitarbeit', 'Verantwortlich', 'Gemeldet von', 'Erledigt von']) {
      expect(all).not.toContain(word)
    }
  })

  it('refuse a period backwards or longer than five years, and a grid they do not know', async () => {
    const asked = (query: Readonly<Record<string, string>>) =>
      http().get('/reports/duties').query(query).set(testIdentityHeader, by('u-lead')).expect(400)

    expect((await asked({ from: '2026-10', to: '2026-01' })).body.message).toBe(
      'Der Zeitraum endet vor seinem Anfang.',
    )
    expect((await asked({ from: '2020-01', to: '2026-10' })).body.message).toBe(
      'Ein Zeitraum ist höchstens 5 Jahre lang.',
    )
    expect((await asked({ grid: 'week' })).body.message).toBe(
      'Ein Raster ist ein Monat, ein Quartal oder ein Jahr.',
    )
  })

  it('come as a table with what the filter shows', async () => {
    const table = await http()
      .get('/reports/duties/table')
      .query({ areaId: areas.north, from: '2024-01', to: '2025-12', grid: 'year', format: 'csv' })
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    const lines = table.text
      .replace(/^\uFEFF/u, '')
      .trim()
      .split(/\r?\n/u)

    expect(lines).toEqual([
      'Zeitraum;Fällig geworden;Rechtzeitig;Später;Noch offen',
      '2024;1;1;0;0',
      '2025;1;0;1;0',
    ])
  })
})
