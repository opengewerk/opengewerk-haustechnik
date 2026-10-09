import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { yearInGermany } from '../today.js'
import { assignNumber } from './number-ranges.js'
import { applicationDatabaseUrl, connect, refusedBy, resetToMigrated } from './test-database.js'
import { writtenColumnNames, writtenPlaceholders, writtenValues } from './test-evidence.js'

/**
 * The activities, their duties and work orders, and the defects in the
 * database (ADR 0002, points 13 and 15): that every row hangs on its place,
 * its activity, its duty and its work order, key by key; that a work order
 * hangs on an activity of its kind and keeps it that kind; that a work order
 * carries its number once in a tenant, drawn from the sequence of the work
 * orders; that an activity names a reason when it was not performed and only
 * then; and that marking a place, an asset, an activity or a duty marks what
 * hangs below it.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key, the check or the trigger and never a policy.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()
const lead = 'user-lead'

/** A place in one area: a property with two buildings, a room in each, an asset and a duty at it. */
interface Place {
  readonly tenant: TenantId
  readonly area: string
  readonly property: string
  readonly building: string
  readonly room: string
  readonly annex: string
  readonly annexRoom: string
  readonly asset: string
  readonly duty: string
}

let admin: Pool
let database: Database
let here: Place
let beside: Place
let elsewhere: Place
let secondArea: string
let numbers = 0

async function areaOf(tenantId: TenantId, name: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'insert into areas (tenant_id, name) values ($1, $2) returning id',
    [tenantId, name],
  )

  return rows[0]?.id ?? ''
}

/** A building with a floor and a room on it. */
async function buildingWithRoom(
  tenantId: TenantId,
  property: string,
  area: string,
): Promise<{ building: string; room: string }> {
  const building = randomUUID()
  const floor = randomUUID()
  const room = randomUUID()

  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus', '{school}')`,
    [building, tenantId, property, area],
  )
  await admin.query(
    `insert into floors (id, tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, $5, 'Erdgeschoss', 0)`,
    [floor, tenantId, building, property, area],
  )
  await admin.query(
    `insert into rooms (id, tenant_id, floor_id, building_id, property_id, area_id, number)
     values ($1, $2, $3, $4, $5, $6, '0.01')`,
    [room, tenantId, floor, building, property, area],
  )

  return { building, room }
}

/** An asset in a building of a place, with a number nobody else has. */
async function assetIn(
  tenantId: TenantId,
  property: string,
  area: string,
  building: string,
): Promise<string> {
  numbers += 1

  const { rows } = await admin.query<{ id: string }>(
    `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, 'probe.elevator', $5, 'Aufzug')
     returning id`,
    [tenantId, property, area, building, `AN-${String(numbers).padStart(5, '0')}`],
  )

  return rows[0]?.id ?? ''
}

/** A duty of the operator's own at an asset, confirmed by the lead of the tenant. */
async function dutyAt(at: Omit<Place, 'duty'>, asset: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     values ($1, $2, $3, $4, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung, Abschnitt 7',
             'from_performance', 12, $5)
     returning id`,
    [at.tenant, at.property, at.area, asset, lead],
  )

  return rows[0]?.id ?? ''
}

async function placeIn(tenantId: TenantId, area: string): Promise<Place> {
  const property = randomUUID()

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus', 'Hauptstraße 1', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenantId, area],
  )

  const main = await buildingWithRoom(tenantId, property, area)
  const annex = await buildingWithRoom(tenantId, property, area)
  const asset = await assetIn(tenantId, property, area, main.building)
  const at = {
    tenant: tenantId,
    area,
    property,
    building: main.building,
    room: main.room,
    annex: annex.building,
    annexRoom: annex.room,
    asset,
  }

  return { ...at, duty: await dutyAt(at, asset) }
}

/** An activity at a place, put in past the application. */
async function activityIn(
  at: Place,
  {
    kind = 'inspection',
    building = null,
    room = null,
    asset = at.asset,
  }: { kind?: string; building?: string | null; room?: string | null; asset?: string | null } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into activities (tenant_id, property_id, area_id, building_id, room_id, asset_id, kind, title)
     values ($1, $2, $3, $4, $5, $6, $7, 'Hauptprüfung Aufzug')
     returning id`,
    [at.tenant, at.property, at.area, building, room, asset, kind],
  )

  return rows[0]?.id ?? ''
}

/** A work order for an activity of its kind, with a number nobody else has. */
async function workOrderFor(at: Place, activity: string): Promise<string> {
  numbers += 1

  const { rows } = await admin.query<{ id: string }>(
    `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
     values ($1, $2, $3, $4, $5, 'defect_remedy')
     returning id`,
    [at.tenant, at.property, at.area, activity, `AU-2026-${String(numbers).padStart(4, '0')}`],
  )

  return rows[0]?.id ?? ''
}

/** A defect at the asset of a place, put in past the application. */
async function defectIn(
  at: Place,
  where: {
    building?: string | null
    room?: string | null
    asset?: string | null
    foundIn?: string | null
    setRightBy?: string | null
  } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into defects (tenant_id, property_id, area_id, building_id, room_id, asset_id,
                          found_in_activity_id, remedy_work_order_id, description, found_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'Notbeleuchtung fällt aus.', '2026-10-01')
     returning id`,
    [
      at.tenant,
      at.property,
      at.area,
      where.building ?? null,
      where.room ?? null,
      where.asset === undefined ? at.asset : where.asset,
      where.foundIn ?? null,
      where.setRightBy ?? null,
    ],
  )

  return rows[0]?.id ?? ''
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    tenant,
    'Wohnbau Nord eG',
    other,
    'Wohnbau Süd eG',
  ])

  // The areas come before the first membership, so that a tenant does not
  // begin with the one area a tenant gets with its first membership.
  const area = await areaOf(tenant, 'Nord')
  const otherArea = await areaOf(other, 'Nord')

  secondArea = await areaOf(tenant, 'Süd')
  await admin.query(
    `insert into auth_users (id, name, email) values ($1, $1, 'leitung@nord.example')`,
    [lead],
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, $3, '{management}'), ($2, $3, '{management}')`,
    [tenant, other, lead],
  )

  here = await placeIn(tenant, area)
  beside = await placeIn(tenant, area)
  elsewhere = await placeIn(other, otherArea)

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

/** A row put in past the application, and the key, check or trigger that refused it. */
function tried(statement: string, values: readonly unknown[]) {
  return refusedBy(admin.query(statement, [...values]))
}

describe('the keys of the activities and defects', () => {
  /**
   * One attempt per key, read from the catalogue: a key that a later
   * migration adds without an attempt here turns this red, and so does an
   * attempt that is not refused by the key it names.
   */
  it('hold every row to its place, its activity, its duty and its work order, key by key', async () => {
    const activity = await activityIn(here)
    const besideActivity = await activityIn(beside)
    const besideOrder = await workOrderFor(beside, await activityIn(beside, { kind: 'work_order' }))
    // The evidence of a report on the other property, as one that named a defect (#116).
    const { rows: written } = await admin.query<{ id: string }>(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       select tenant_id, property_id, area_id, id, '2026-10-01'::date, 'with_defects',
              ${writtenPlaceholders(2)}
         from duties where id = $1
       returning id`,
      [beside.duty, ...writtenValues(lead, '2026-10-01', 'with_defects')],
    )
    const besideEvidence = written[0]?.id ?? ''
    // A plan of a round on the other property (#113).
    const { rows: templates } = await admin.query<{ id: string }>(
      `insert into round_templates (tenant_id, title) values ($1, 'Rundgang') returning id`,
      [tenant],
    )
    const { rows: plans } = await admin.query<{ id: string }>(
      `insert into round_plans (tenant_id, property_id, area_id, template_id, rhythm, weekdays, starts_on)
       select $1, id, area_id, $3, 'weekly', '{3}', '2026-10-07' from properties where id = $2
       returning id`,
      [tenant, beside.property, templates[0]?.id],
    )
    const besidePlan = plans[0]?.id ?? ''
    const activityRow = (column: string, value: unknown) =>
      tried(
        `insert into activities (tenant_id, property_id, area_id, kind, title, ${column})
         values ($1, $2, $3, 'inspection', 'Hauptprüfung Aufzug', $4)`,
        [tenant, here.property, here.area, value],
      )
    const defectRow = (column: string, value: unknown) =>
      tried(
        `insert into defects (tenant_id, property_id, area_id, description, found_on, ${column})
         values ($1, $2, $3, 'Notbeleuchtung fällt aus.', '2026-10-01', $4)`,
        [tenant, here.property, here.area, value],
      )
    const attempts: Record<string, () => Promise<{ code: string; constraint: string }>> = {
      activities_follow_their_property: () =>
        tried(
          `insert into activities (tenant_id, property_id, area_id, kind, title)
           values ($1, $2, $3, 'inspection', 'Hauptprüfung Aufzug')`,
          [tenant, here.property, secondArea],
        ),
      activities_at_a_building_of_their_property: () => activityRow('building_id', beside.building),
      activities_at_a_room_of_their_property: () => activityRow('room_id', beside.room),
      activities_at_an_asset_of_their_property: () => activityRow('asset_id', beside.asset),
      activities_responsible_works_here: () => activityRow('responsible_user_id', 'user-nobody'),
      activities_performer_works_here: () => activityRow('performer_user_id', 'user-nobody'),
      activities_of_a_plan_of_their_property: () =>
        tried(
          `insert into activities (tenant_id, property_id, area_id, kind, title, due_on, round_plan_id)
           values ($1, $2, $3, 'round', 'Rundgang', '2026-10-07', $4)`,
          [tenant, here.property, here.area, besidePlan],
        ),
      activity_duties_follow_their_property: () =>
        tried(
          `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
           values ($1, $2, $3, $4, $5)`,
          [tenant, here.property, secondArea, activity, here.duty],
        ),
      activity_duties_of_an_activity_of_their_property: () =>
        tried(
          `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
           values ($1, $2, $3, $4, $5)`,
          [tenant, here.property, here.area, besideActivity, here.duty],
        ),
      activity_duties_of_a_duty_of_their_property: () =>
        tried(
          `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
           values ($1, $2, $3, $4, $5)`,
          [tenant, here.property, here.area, activity, beside.duty],
        ),
      work_orders_follow_their_property: async () =>
        tried(
          `insert into work_orders (tenant_id, property_id, area_id, activity_id, kind)
           values ($1, $2, $3, $4, 'fault')`,
          [tenant, here.property, secondArea, await activityIn(here, { kind: 'work_order' })],
        ),
      work_orders_of_a_work_order_of_their_property: async () =>
        tried(
          `insert into work_orders (tenant_id, property_id, area_id, activity_id, kind)
           values ($1, $2, $3, $4, 'fault')`,
          [tenant, here.property, here.area, await activityIn(beside, { kind: 'work_order' })],
        ),
      defects_follow_their_property: () =>
        tried(
          `insert into defects (tenant_id, property_id, area_id, description, found_on)
           values ($1, $2, $3, 'Notbeleuchtung fällt aus.', '2026-10-01')`,
          [tenant, here.property, secondArea],
        ),
      defects_at_a_building_of_their_property: () => defectRow('building_id', beside.building),
      defects_at_a_room_of_their_property: () => defectRow('room_id', beside.room),
      defects_at_an_asset_of_their_property: () => defectRow('asset_id', beside.asset),
      defects_found_in_an_activity_of_their_property: () =>
        defectRow('found_in_activity_id', besideActivity),
      defects_named_in_an_evidence_of_their_property: () =>
        defectRow('found_in_evidence_id', besideEvidence),
      // The answer of one activity, named by a defect noticed in another (#106).
      defects_from_an_answer_of_their_activity: async () => {
        const { rows: given } = await admin.query<{ id: string }>(
          `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key,
                                         result)
           values ($1, $2, $3, $4, 'door_closed', 'not_ok') returning id`,
          [tenant, here.property, here.area, activity],
        )

        return tried(
          `insert into defects (tenant_id, property_id, area_id, description, found_on,
                                found_in_activity_id, found_in_answer_id)
           values ($1, $2, $3, 'Tür offen.', '2026-10-01', $4, $5)`,
          [tenant, here.property, here.area, await activityIn(here), given[0]?.id],
        )
      },
      defects_set_right_by_a_work_order_of_their_property: () =>
        defectRow('remedy_work_order_id', besideOrder),
      // A work order that came of a defect on another property (#117).
      work_orders_from_a_defect_of_their_property: async () => {
        const { rows: found } = await admin.query<{ id: string }>(
          `insert into defects (tenant_id, property_id, area_id, description, found_on)
           values ($1, $2, $3, 'Tür klemmt.', '2026-10-01') returning id`,
          [tenant, beside.property, beside.area],
        )

        return tried(
          `insert into work_orders (tenant_id, property_id, area_id, activity_id, kind,
                                    origin_defect_id)
           values ($1, $2, $3, $4, 'defect_remedy', $5)`,
          [
            tenant,
            here.property,
            here.area,
            await activityIn(here, { kind: 'work_order' }),
            found[0]?.id,
          ],
        )
      },
    }

    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f'
          and c.relname in ('activities', 'activity_duties', 'work_orders', 'defects')
          and k.conname not like '%_tenant_id_tenants_id_fk'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual(Object.keys(attempts).sort())

    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [key, attempt] of Object.entries(attempts)) {
      refused[key] = await attempt()
      expected[key] = { code: '23503', constraint: key }
    }

    expect(refused).toEqual(expected)
  })

  it('take an activity at each kind of place, with its duties, its work order and a defect', async () => {
    const atTheProperty = await activityIn(here, { asset: null })
    const inTheRoom = await activityIn(here, { asset: null, room: here.room })
    const order = await activityIn(here, { kind: 'work_order', asset: null, building: here.annex })
    const workOrder = await workOrderFor(here, order)
    const { rowCount: linked } = await admin.query(
      `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       values ($1, $2, $3, $4, $5), ($1, $2, $3, $6, $5)`,
      [tenant, here.property, here.area, atTheProperty, here.duty, order],
    )
    const defect = await defectIn(here, {
      asset: null,
      room: here.annexRoom,
      foundIn: inTheRoom,
      setRightBy: workOrder,
    })

    expect(linked).toBe(2)
    expect(defect).not.toBe('')
  })
})

describe('a work order', () => {
  it('hangs on an activity of its kind, which stays that kind while it has the work order', async () => {
    const round = await activityIn(here, { kind: 'round' })

    expect(
      await tried(
        `insert into work_orders (tenant_id, property_id, area_id, activity_id, kind)
         values ($1, $2, $3, $4, 'fault')`,
        [tenant, here.property, here.area, round],
      ),
    ).toEqual({ code: '23503', constraint: 'work_orders_of_a_work_order_of_their_property' })
    // Naming another kind for its activity is refused before any key is asked.
    expect(
      await tried(
        `insert into work_orders (tenant_id, property_id, area_id, activity_id, activity_kind, kind)
         values ($1, $2, $3, $4, 'round', 'fault')`,
        [tenant, here.property, here.area, round],
      ),
    ).toEqual({ code: '23514', constraint: 'work_orders_of_a_work_order' })

    const order = await activityIn(here, { kind: 'work_order' })

    await workOrderFor(here, order)

    expect(
      await tried(`update activities set kind = 'maintenance' where id = $1`, [order]),
    ).toEqual({ code: '23503', constraint: 'work_orders_of_a_work_order_of_their_property' })
    // Without a work order the kind may be put right.
    expect(
      (await admin.query(`update activities set kind = 'maintenance' where id = $1`, [round]))
        .rowCount,
    ).toBe(1)
  })

  it('is one per activity', async () => {
    const order = await activityIn(here, { kind: 'work_order' })

    await workOrderFor(here, order)

    expect(
      await tried(
        `insert into work_orders (tenant_id, property_id, area_id, activity_id, kind)
         values ($1, $2, $3, $4, 'fault')`,
        [tenant, here.property, here.area, order],
      ),
    ).toEqual({ code: '23505', constraint: 'work_orders_one_per_activity' })
  })

  it('carries its number once in its tenant, another tenant may carry the same, and none until it is drawn', async () => {
    const insert = (at: Place, number: string | null) =>
      activityIn(at, { kind: 'work_order' }).then((activity) =>
        admin.query(
          `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
           values ($1, $2, $3, $4, $5, 'fault')`,
          [at.tenant, at.property, at.area, activity, number],
        ),
      )

    await insert(here, 'AU-2026-9001')

    expect(await refusedBy(insert(beside, 'AU-2026-9001'))).toEqual({
      code: '23505',
      constraint: 'work_orders_number_once',
    })
    expect((await insert(elsewhere, 'AU-2026-9001')).rowCount).toBe(1)
    // A work order made on a device without a connection has none until it arrives.
    expect((await insert(here, null)).rowCount).toBe(1)
    expect((await insert(here, null)).rowCount).toBe(1)
    expect(await refusedBy(insert(here, ' AU-2026-9002'))).toEqual({
      code: '23514',
      constraint: 'work_orders_number_shaped',
    })
  })

  it('draws its number from the sequence of the work orders', async () => {
    const at = new Date()
    const drawn = await database.forTenant({ tenantId: other, userId: lead }, async (tx) => [
      await assignNumber(tx, other, 'work_order', at),
      await assignNumber(tx, other, 'work_order', at),
    ])

    expect(drawn).toEqual([
      `AU-${String(yearInGermany(at))}-0001`,
      `AU-${String(yearInGermany(at))}-0002`,
    ])
  })
})

describe('an activity', () => {
  it('names a reason when it was not performed, and only then', async () => {
    const closed = (status: string, reason: string | null) =>
      tried(
        `insert into activities (tenant_id, property_id, area_id, kind, title, status, closing_reason)
         values ($1, $2, $3, 'round', 'Rundgang Technikzentrale', $4, $5)`,
        [tenant, here.property, here.area, status, reason],
      )

    expect(await closed('not_performed', null)).toEqual({
      code: '23514',
      constraint: 'activities_closed_with_a_reason',
    })
    expect(await closed('done', 'Anlage war abgeschaltet.')).toEqual({
      code: '23514',
      constraint: 'activities_closed_with_a_reason',
    })

    const { rowCount } = await admin.query(
      `insert into activities (tenant_id, property_id, area_id, kind, title, status, closing_reason)
       values ($1, $2, $3, 'round', 'Rundgang Technikzentrale', 'not_performed', 'Anlage war abgeschaltet.')`,
      [tenant, here.property, here.area],
    )

    expect(rowCount).toBe(1)
  })

  it('is refused what the model in domain refuses', async () => {
    const row = (column: string, value: unknown) =>
      tried(
        `insert into activities (tenant_id, property_id, area_id, kind, title, ${column})
         values ($1, $2, $3, 'inspection', 'Hauptprüfung Aufzug', $4)`,
        [tenant, here.property, here.area, value],
      )

    expect(
      await tried(
        `insert into activities (tenant_id, property_id, area_id, kind, title)
         values ($1, $2, $3, 'inspection', '  ')`,
        [tenant, here.property, here.area],
      ),
    ).toEqual({ code: '23514', constraint: 'activities_title_shaped' })
    expect(await row('contractor_note', ' Aufzugsbau GmbH')).toEqual({
      code: '23514',
      constraint: 'activities_contractor_note_shaped',
    })
    expect(
      await tried(
        `insert into activities (tenant_id, property_id, area_id, kind, title, status, closing_reason)
         values ($1, $2, $3, 'round', 'Rundgang', 'not_performed', $4)`,
        [tenant, here.property, here.area, 'x'.repeat(501)],
      ),
    ).toEqual({ code: '23514', constraint: 'activities_closing_reason_shaped' })
    expect(
      await tried(
        `insert into activities (tenant_id, property_id, area_id, building_id, asset_id, kind, title)
         values ($1, $2, $3, $4, $5, 'inspection', 'Hauptprüfung Aufzug')`,
        [tenant, here.property, here.area, here.building, here.asset],
      ),
    ).toEqual({ code: '23514', constraint: 'activities_one_target' })
    // A kind the list does not know is no value of the enum at all.
    expect((await row('status', 'cancelled')).code).toBe('22P02')
  })

  it('meets a duty once, and again once the link is marked', async () => {
    const activity = await activityIn(here)
    const link = () =>
      admin.query<{ id: string }>(
        `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [tenant, here.property, here.area, activity, here.duty],
      )
    const first = await link()

    expect(await refusedBy(link())).toEqual({ code: '23505', constraint: 'activity_duties_once' })

    await admin.query('update activity_duties set deleted_at = now() where id = $1', [
      first.rows[0]?.id,
    ])

    expect((await link()).rowCount).toBe(1)
  })
})

describe('a defect', () => {
  it('is refused what the model in domain refuses', async () => {
    const row = (column: string, value: unknown) =>
      tried(
        `insert into defects (tenant_id, property_id, area_id, description, found_on, ${column})
         values ($1, $2, $3, 'Notbeleuchtung fällt aus.', '2026-10-01', $4)`,
        [tenant, here.property, here.area, value],
      )

    expect(
      await tried(
        `insert into defects (tenant_id, property_id, area_id, description, found_on)
         values ($1, $2, $3, '', '2026-10-01')`,
        [tenant, here.property, here.area],
      ),
    ).toEqual({ code: '23514', constraint: 'defects_description_shaped' })
    expect(await row('defect_class', 'probe.minor ')).toEqual({
      code: '23514',
      constraint: 'defects_class_shaped',
    })
    expect(await row('due_on', '2026-09-30')).toEqual({
      code: '23514',
      constraint: 'defects_due_after_found',
    })
    // Checked again on the day it was found or later, never without the day,
    // and what was found within its bounds (#116).
    expect(await row('checked_on', '2026-09-30')).toEqual({
      code: '23514',
      constraint: 'defects_checked_after_found',
    })
    expect(await row('status', 'verified')).toEqual({
      code: '23514',
      constraint: 'defects_verified_on_a_day',
    })
    expect(await row('check_note', ' Tür klemmt ')).toEqual({
      code: '23514',
      constraint: 'defects_check_note_shaped',
    })
    expect(
      await tried(
        `insert into defects (tenant_id, property_id, area_id, room_id, asset_id, description, found_on)
         values ($1, $2, $3, $4, $5, 'Notbeleuchtung fällt aus.', '2026-10-01')`,
        [tenant, here.property, here.area, here.room, here.asset],
      ),
    ).toEqual({ code: '23514', constraint: 'defects_one_target' })
    // On the day it was found is soon enough.
    expect(
      (
        await admin.query(
          `insert into defects (tenant_id, property_id, area_id, description, found_on, due_on)
           values ($1, $2, $3, 'Notbeleuchtung fällt aus.', '2026-10-01', '2026-10-01')`,
          [tenant, here.property, here.area],
        )
      ).rowCount,
    ).toBe(1)
  })
})

describe('the activities and defects marked deleted', () => {
  const tables = ['activities', 'activity_duties', 'work_orders', 'defects']

  it('are only ever marked: the application may not remove a row of them', async () => {
    const { rows } = await admin.query<{ table_name: string; may_delete: boolean }>(
      `select c.relname as table_name, has_table_privilege('opengewerk_app', c.oid, 'DELETE') as may_delete
         from pg_class c
        where c.relname = any($1::text[]) and c.relkind = 'r'
        order by 1`,
      [tables],
    )

    expect(rows).toEqual(
      [...tables].sort().map((table) => ({ table_name: table, may_delete: false })),
    )
  })

  async function deletedAt(table: string, id: string): Promise<string | null> {
    const { rows } = await admin.query<{ at: string | null }>(
      `select deleted_at::text as at from ${table} where id = $1`,
      [id],
    )

    return rows[0]?.at ?? null
  }

  /** Marked as the application marks it, inside the tenant and under the policies, in every area. */
  function marking(work: (tx: TenantTransaction) => Promise<unknown>) {
    return database.forTenant({ tenantId: tenant, userId: lead }, async (tx) => {
      await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
      await work(tx)
    })
  }

  /** An activity at the asset with its duty and its work order, and a defect noticed in it. */
  async function equipped(at: Place) {
    const activity = await activityIn(at, { kind: 'work_order' })
    const workOrder = await workOrderFor(at, activity)
    const { rows } = await admin.query<{ id: string }>(
      `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [at.tenant, at.property, at.area, activity, at.duty],
    )
    const defect = await defectIn(at, { foundIn: activity, setRightBy: workOrder })

    return { activity, workOrder, link: rows[0]?.id ?? '', defect }
  }

  it('takes along, with an activity, its duties and its work order, and leaves the defect noticed in it', async () => {
    const made = await equipped(here)

    await marking((tx) =>
      tx.execute(sql`update activities set deleted_at = now() where id = ${made.activity}`),
    )

    const moment = await deletedAt('activities', made.activity)

    expect(moment).not.toBeNull()
    expect(await deletedAt('activity_duties', made.link)).toBe(moment)
    expect(await deletedAt('work_orders', made.workOrder)).toBe(moment)
    expect(await deletedAt('defects', made.defect)).toBeNull()
  })

  it('takes along, with a duty, its links to the activities and nothing else', async () => {
    const at = await placeIn(tenant, here.area)
    const made = await equipped(at)

    await marking((tx) =>
      tx.execute(sql`update duties set deleted_at = now() where id = ${at.duty}`),
    )

    expect(await deletedAt('activity_duties', made.link)).toBe(await deletedAt('duties', at.duty))
    expect(await deletedAt('activities', made.activity)).toBeNull()
  })

  it('takes along, with an asset, the activities and defects at it', async () => {
    const at = await placeIn(tenant, here.area)
    const made = await equipped(at)
    const atTheBuilding = await activityIn(at, { asset: null, building: at.building })

    await marking((tx) =>
      tx.execute(sql`update assets set deleted_at = now() where id = ${at.asset}`),
    )

    const moment = await deletedAt('assets', at.asset)

    expect(await deletedAt('activities', made.activity)).toBe(moment)
    expect(await deletedAt('work_orders', made.workOrder)).toBe(moment)
    expect(await deletedAt('activity_duties', made.link)).toBe(moment)
    expect(await deletedAt('defects', made.defect)).toBe(moment)
    expect(await deletedAt('activities', atTheBuilding)).toBeNull()
  })

  it('takes along, with a building or a room, the activities and defects there', async () => {
    const at = await placeIn(tenant, here.area)
    const inTheRoom = await activityIn(at, { asset: null, room: at.annexRoom })
    const defectInTheRoom = await defectIn(at, { asset: null, room: at.annexRoom })
    const atTheBuilding = await activityIn(at, { asset: null, building: at.building })
    const defectAtTheBuilding = await defectIn(at, { asset: null, building: at.building })

    await marking((tx) =>
      tx.execute(sql`update rooms set deleted_at = now() where id = ${at.annexRoom}`),
    )

    const roomMarked = await deletedAt('rooms', at.annexRoom)

    expect(await deletedAt('activities', inTheRoom)).toBe(roomMarked)
    expect(await deletedAt('defects', defectInTheRoom)).toBe(roomMarked)
    expect(await deletedAt('activities', atTheBuilding)).toBeNull()

    await marking((tx) =>
      tx.execute(sql`update buildings set deleted_at = now() where id = ${at.building}`),
    )

    const buildingMarked = await deletedAt('buildings', at.building)

    expect(await deletedAt('activities', atTheBuilding)).toBe(buildingMarked)
    expect(await deletedAt('defects', defectAtTheBuilding)).toBe(buildingMarked)
  })

  it('takes along, with a property, every activity and defect on it', async () => {
    const at = await placeIn(tenant, here.area)
    const atTheProperty = await activityIn(at, { asset: null })
    const defectAtTheProperty = await defectIn(at, { asset: null })

    await marking((tx) =>
      tx.execute(sql`update properties set deleted_at = now() where id = ${at.property}`),
    )

    const moment = await deletedAt('properties', at.property)

    expect(await deletedAt('activities', atTheProperty)).toBe(moment)
    expect(await deletedAt('defects', defectAtTheProperty)).toBe(moment)
  })

  it('carry the stamp a device needs, in every table', async () => {
    const activity = await activityIn(here)
    const { rows } = await admin.query<{ stamped: boolean }>(
      'select change_sequence > 0 as stamped from activities where id = $1',
      [activity],
    )

    expect(rows).toEqual([{ stamped: true }])

    const { rows: triggers } = await admin.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where t.tgname = 'stamp_sync_columns' and c.relname = any($1::text[])
        order by 1`,
      [tables],
    )

    expect(triggers.map((row) => row.table_name)).toEqual([...tables].sort())
  })
})
