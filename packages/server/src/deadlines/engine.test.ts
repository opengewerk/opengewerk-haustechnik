import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import { catalogueOf, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { runDeadlineCycle, runDeadlinesOf } from './engine.js'

/**
 * The appointments of the duties as the deadline engine keeps them (#25,
 * ADR 0002, point 12): one deadline for every duty that has an appointment,
 * due on the day it names, following every new evidence, resting with its
 * asset and dropping out when the duty ends; and a pass that goes through
 * every area of an operator, because it works for nobody.
 *
 * The catalogue is the probe package: the main test of an elevator, at most
 * every 24 months and counted under § 14 Abs. 5 BetrSichV.
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

let admin: Pool
let database: Database

const catalogue = catalogueOf(probeCatalogueBundle)

/** A morning in October, after six in Germany: deadlines follow and reminders go. */
const october = new Date('2026-10-05T10:00:00Z')

/** One pass over one operator at a moment, with the clock of the source on the same moment. */
function run(tenantId: TenantId, now: Date = october) {
  return runDeadlinesOf({ database, catalogue, now: () => now }, tenantId, now)
}

/** A property with a building and an elevator in it, in the first area of the operator or in the one named. */
interface Place {
  readonly tenantId: TenantId
  /** The number of the elevator, one of its own in every place. */
  readonly number: string
  readonly property: string
  readonly area: string
  readonly building: string
  readonly elevator: string
}

let places = 0

async function placeIn(tenantId: TenantId, areaId?: string): Promise<Place> {
  places += 1

  const number = `AN-${String(places).padStart(5, '0')}`
  const { rows } = await admin.query<{
    property: string
    area: string
    building: string
    elevator: string
  }>(
    `with property as (
       insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, coalesce($2::uuid, (select id from areas where tenant_id = $1 order by name limit 1)),
              'Schulzentrum Am Neckar', 'Neckarstraße 4', '68535', 'Edingen-Neckarhausen', 'DE-BW'
       returning id, area_id
     ), building as (
       insert into buildings (tenant_id, property_id, area_id, name, kinds)
       select $1, id, area_id, 'Haus A', '{school}' from property
       returning id, property_id, area_id
     ), elevator as (
       insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
       select $1, property_id, area_id, id, 'probe.elevator', $3, 'Aufzug Haus A'
         from building
       returning id, building_id, property_id, area_id
     )
     select property_id as property, area_id as area, building_id as building, id as elevator
       from elevator`,
    [tenantId, areaId ?? null, number],
  )

  return { tenantId, number, ...(rows[0] as Omit<Place, 'tenantId' | 'number'>) }
}

/** The main test of the elevator, confirmed, with the person who answers for it. */
async function mainTestAt(at: Place, extra: { endsOn?: string } = {}): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, maximum_months, responsible_user_id, confirmed_by, ends_on)
     values ($1, $2, $3, $4, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24, 'u-site',
             'u-duties', $5)
     returning id`,
    [at.tenantId, at.property, at.area, at.elevator, extra.endsOn ?? null],
  )

  return (rows[0] as { id: string }).id
}

/** An evidence of a duty on a day, with a result. */
async function evidenceOf(
  at: Place,
  dutyId: string,
  performedOn: string,
  result = 'without_defects',
): Promise<void> {
  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result)
     values ($1, $2, $3, $4, $5, $6)`,
    [at.tenantId, at.property, at.area, dutyId, performedOn, result],
  )
}

/** The state of the asset from a day. */
async function lifeOf(at: Place, state: string, validFrom: string): Promise<void> {
  await admin.query(
    `insert into asset_lifecycle (tenant_id, asset_id, property_id, area_id, state, valid_from)
     values ($1, $2, $3, $4, $5, $6)`,
    [at.tenantId, at.elevator, at.property, at.area, state, validFrom],
  )
}

/** The deadlines of a duty as the table keeps them. */
async function deadlinesOf(dutyId: string) {
  const { rows } = await admin.query<Record<string, unknown>>(
    `select kind, status, source_id, source_label, anchor_on::text, due_on::text,
            natural_user_id, duty_id, property_id, area_id, reminded_for::text
       from deadlines where duty_id = $1`,
    [dutyId],
  )

  return rows
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
  ])

  // The large operator has its two areas before anybody works for it.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, role] of [
    ['u-duties', 'technical_management'],
    ['u-site', 'site_management'],
  ] as const) {
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

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the deadline of a duty', () => {
  it('is none for a duty that was never recorded', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    await run(small)

    expect(await deadlinesOf(duty)).toEqual([])
  })

  it('follows the evidence that met the duty, in the counting of its kind', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    await evidenceOf(at, duty, '2025-03-14')
    await run(small)

    // § 14 Abs. 5 BetrSichV: the month of the test and 24 months.
    expect(await deadlinesOf(duty)).toEqual([
      {
        kind: 'duty.due',
        status: 'open',
        source_id: duty,
        source_label: `Hauptprüfung der Aufzugsanlage, Aufzug Haus A (${at.number})`,
        anchor_on: '2025-03-14',
        due_on: '2027-03-01',
        natural_user_id: 'u-site',
        duty_id: duty,
        property_id: at.property,
        area_id: at.area,
        reminded_for: null,
      },
    ])

    // A test that failed and one that was not performed leave it where it was.
    await evidenceOf(at, duty, '2026-01-10', 'failed')
    await evidenceOf(at, duty, '2026-01-12', 'not_performed')

    expect((await run(small)).moved).toBe(0)
    expect(await deadlinesOf(duty)).toMatchObject([{ due_on: '2027-03-01' }])

    // One with defects meets it, and the next interval begins with its month.
    await evidenceOf(at, duty, '2026-02-20', 'with_defects')
    await run(small)

    expect(await deadlinesOf(duty)).toMatchObject([
      { status: 'open', anchor_on: '2026-02-20', due_on: '2028-02-01' },
    ])
  })

  it('rests with its asset, and comes back once the asset is in service again', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    await evidenceOf(at, duty, '2025-03-14')
    await lifeOf(at, 'in_service', '2020-01-01')
    await run(small)
    await lifeOf(at, 'out_of_service', '2026-09-01')
    await run(small)

    expect(await deadlinesOf(duty)).toMatchObject([{ status: 'dropped' }])

    await lifeOf(at, 'in_service', '2026-10-10')
    await run(small, new Date('2026-10-12T10:00:00Z'))

    expect(await deadlinesOf(duty)).toMatchObject([{ status: 'open', due_on: '2027-03-01' }])
  })

  it('starts over from the test when its asset was out of service on the day it was due', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    // Due on 2025-01-01 after the test of January 2023, out of service on
    // that day and tested again in March 2025: under § 14 Abs. 5 BetrSichV
    // the next interval begins with the month of that test.
    await evidenceOf(at, duty, '2023-01-10')
    await lifeOf(at, 'in_service', '2020-01-01')
    await lifeOf(at, 'out_of_service', '2024-12-01')
    await lifeOf(at, 'in_service', '2025-03-01')
    await evidenceOf(at, duty, '2025-03-20')
    await run(small)

    expect(await deadlinesOf(duty)).toMatchObject([{ status: 'open', due_on: '2027-03-01' }])
  })

  it('drops out when the duty ends, and is none for an appointment on or after its end', async () => {
    const at = await placeIn(small)
    const ending = await mainTestAt(at)

    // Due on 2026-03-01, overdue in October: an appointment before the end
    // of the duty, and the duty ends all the same.
    await evidenceOf(at, ending, '2024-03-14')
    await run(small)

    expect(await deadlinesOf(ending)).toMatchObject([{ status: 'open', due_on: '2026-03-01' }])

    await admin.query(`update duties set ends_on = '2026-10-05' where id = $1`, [ending])
    await run(small)

    expect(await deadlinesOf(ending)).toMatchObject([{ status: 'dropped' }])

    // Due on 2027-03-01, and over by then.
    const elsewhere = await placeIn(small)
    const over = await mainTestAt(elsewhere, { endsOn: '2027-03-01' })

    await evidenceOf(elsewhere, over, '2025-03-14')
    await run(small)

    expect(await deadlinesOf(over)).toEqual([])
  })

  it('names a duty of the operator own and counts it as the duty says', async () => {
    const at = await placeIn(small)
    const { rows } = await admin.query<{ id: string }>(
      `insert into duties (tenant_id, property_id, area_id, building_id, label, basis, source_note,
                           counting, interval_months, confirmed_by)
       values ($1, $2, $3, $4, 'Dachrinnen reinigen', 'insurer', 'Vertrag 4711', 'from_due', 6,
               'u-duties')
       returning id`,
      [small, at.property, at.area, at.building],
    )
    const duty = (rows[0] as { id: string }).id

    // From the due day: the rhythm begins on the first day, and the second
    // time met the appointment of October.
    await evidenceOf(at, duty, '2025-04-01')
    await evidenceOf(at, duty, '2025-10-15')
    await run(small)

    expect(await deadlinesOf(duty)).toMatchObject([
      {
        source_label: 'Dachrinnen reinigen, Haus A',
        anchor_on: '2025-10-15',
        due_on: '2026-04-01',
        natural_user_id: null,
      },
    ])
  })

  it('reminds within the lead of its kind, on the morning of the day', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    // Due on 2026-11-01, thirty days of lead before it.
    await evidenceOf(at, duty, '2024-11-20')

    const night = await run(small, new Date('2026-10-05T03:00:00Z'))

    expect(night.reminded).toBe(0)
    expect(await deadlinesOf(duty)).toMatchObject([{ due_on: '2026-11-01', reminded_for: null }])

    const morning = await run(small)

    expect(morning.reminded).toBe(1)
    expect(await deadlinesOf(duty)).toMatchObject([{ reminded_for: '2026-11-01' }])
  })
})

describe('a pass of the engine', () => {
  it('goes through every area of an operator, for nobody in particular', async () => {
    const inNorth = await placeIn(large, north)
    const inSouth = await placeIn(large, south)
    const northern = await mainTestAt(inNorth)
    const southern = await mainTestAt(inSouth)

    await evidenceOf(inNorth, northern, '2025-03-14')
    await evidenceOf(inSouth, southern, '2025-05-02')
    await runDeadlineCycle({ database, catalogue, now: () => october })

    expect(await deadlinesOf(northern)).toMatchObject([{ area_id: north, due_on: '2027-03-01' }])
    expect(await deadlinesOf(southern)).toMatchObject([{ area_id: south, due_on: '2027-05-01' }])

    // And it says so for the office: the pass went through.
    const { rows } = await admin.query<{ succeeded: boolean }>(
      'select succeeded_at is not null as succeeded from deadline_runs where tenant_id = $1',
      [large],
    )

    expect(rows).toEqual([{ succeeded: true }])
  })
})
