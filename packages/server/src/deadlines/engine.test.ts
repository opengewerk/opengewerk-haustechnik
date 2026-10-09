import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import { catalogueOf, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
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
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           ${writtenColumnNames})
     values ($1, $2, $3, $4, $5, $6, ${writtenPlaceholders(7)})`,
    [
      at.tenantId,
      at.property,
      at.area,
      dutyId,
      performedOn,
      result,
      ...writtenValues('u-duties', performedOn, result),
    ],
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
  await resetToMigrated()

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

  it('keeps the deadline of a duty of the operator own at a building as that of one from the catalogue, and reminds for both', async () => {
    const at = await placeIn(small)
    const fromTheCatalogue = await mainTestAt(at)
    const { rows } = await admin.query<{ id: string }>(
      `insert into duties (tenant_id, property_id, area_id, building_id, label, basis, source_note, task,
                           counting, interval_months, responsible_user_id, confirmed_by)
       values ($1, $2, $3, $4, 'Prüfung der Blitzschutzanlage', 'authority', 'Baugenehmigung, Auflage 7',
               'inspection', 'betrsichv', 24, 'u-site', 'u-duties')
       returning id`,
      [small, at.property, at.area, at.building],
    )
    const own = (rows[0] as { id: string }).id
    /** What a deadline says beyond which duty it belongs to. */
    const told = async (dutyId: string) =>
      (await deadlinesOf(dutyId)).map(
        ({
          kind,
          status,
          anchor_on,
          due_on,
          natural_user_id,
          property_id,
          area_id,
          reminded_for,
        }) => ({
          kind,
          status,
          anchor_on,
          due_on,
          natural_user_id,
          property_id,
          area_id,
          reminded_for,
        }),
      )

    // Both met on the same day, both due on 2026-11-01, within the lead.
    for (const duty of [fromTheCatalogue, own]) {
      await evidenceOf(at, duty, '2024-11-20')
    }

    expect((await run(small)).reminded).toBe(2)
    expect(await told(own)).toEqual([
      {
        kind: 'duty.due',
        status: 'open',
        anchor_on: '2024-11-20',
        due_on: '2026-11-01',
        natural_user_id: 'u-site',
        property_id: at.property,
        area_id: at.area,
        reminded_for: '2026-11-01',
      },
    ])
    expect(await told(own)).toEqual(await told(fromTheCatalogue))
    expect(await deadlinesOf(own)).toMatchObject([
      { source_label: 'Prüfung der Blitzschutzanlage, Haus A' },
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

/** The activities that are to meet a duty, as the tables keep them, the oldest first. */
async function activitiesOf(dutyId: string) {
  const { rows } = await admin.query<Record<string, unknown>>(
    `select a.kind, a.title, a.status, a.due_on::text, a.responsible_user_id, a.performer,
            a.performer_user_id, a.contractor_note, a.property_id, a.area_id, a.building_id,
            a.room_id, a.asset_id, d.property_id as line_property_id, d.area_id as line_area_id
       from activities a
       join activity_duties d on d.tenant_id = a.tenant_id and d.activity_id = a.id
      where d.duty_id = $1
      order by a.id`,
    [dutyId],
  )

  return rows
}

describe('the activity of a due day', () => {
  it('comes of the due day once its lead begins, once however often the engine runs, and leaves the due day as it is', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    // Due on 2026-11-01, thirty days of lead before it.
    await evidenceOf(at, duty, '2024-11-20')
    await run(small, new Date('2026-10-01T10:00:00Z'))

    expect(await activitiesOf(duty)).toEqual([])

    await run(small)
    await run(small)
    await runDeadlineCycle({ database, catalogue, now: () => october })

    expect(await activitiesOf(duty)).toEqual([
      {
        kind: 'inspection',
        title: 'Hauptprüfung der Aufzugsanlage',
        status: 'open',
        due_on: '2026-11-01',
        responsible_user_id: 'u-site',
        performer: null,
        performer_user_id: null,
        contractor_note: null,
        property_id: at.property,
        area_id: at.area,
        building_id: null,
        room_id: null,
        asset_id: at.elevator,
        line_property_id: at.property,
        line_area_id: at.area,
      },
    ])

    // Planned and not performed, it stays due on its day and becomes overdue.
    await run(small, new Date('2026-11-20T10:00:00Z'))

    expect(await deadlinesOf(duty)).toMatchObject([
      { status: 'open', due_on: '2026-11-01', reminded_for: '2026-11-01' },
    ])
    expect(await activitiesOf(duty)).toHaveLength(1)
  })

  it('is filled in the form its duty kind takes as evidence, in the version in force that day', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)
    // The main test of the probe package, taking a protocol in the reading form.
    const withAForm = catalogueOf({
      ...probeCatalogueBundle,
      packages: probeCatalogueBundle.packages.map((pack) => ({
        ...pack,
        dutyKinds: pack.dutyKinds.map((entry) =>
          entry.key === 'probe.elevator_main_test'
            ? {
                ...entry,
                definition: {
                  ...entry.definition,
                  evidence: { kinds: ['protocol', 'report'], form: 'probe.water_meter_reading' },
                },
              }
            : entry,
        ),
      })),
    })

    await evidenceOf(at, duty, '2024-11-20')
    await runDeadlinesOf({ database, catalogue: withAForm, now: () => october }, small, october)

    const { rows } = await admin.query<{ form_key: string | null; form_version: number | null }>(
      `select a.form_key, a.form_version from activities a
         join activity_duties d on d.activity_id = a.id
        where d.duty_id = $1`,
      [duty],
    )

    expect(rows).toEqual([{ form_key: 'probe.water_meter_reading', form_version: 1 }])

    // Without a form named by its kind, an activity has none.
    const other = await placeIn(small)
    const plain = await mainTestAt(other)

    await evidenceOf(other, plain, '2024-11-20')
    await run(small)

    const { rows: none } = await admin.query<{ form_key: string | null }>(
      `select a.form_key from activities a join activity_duties d on d.activity_id = a.id
        where d.duty_id = $1`,
      [plain],
    )

    expect(none).toEqual([{ form_key: null }])
  })

  it('takes the last protocol of its asset in the same form as its template: what carries, and the day of it', async () => {
    // The main test taking a protocol in a form of its own: the car carries, a check point and a remark do not.
    const elevatorProtocol = {
      title: 'Protokoll der Hauptprüfung',
      sections: [
        {
          key: 'car',
          title: 'Fahrkorb',
          fields: [
            { kind: 'text' as const, key: 'car', label: 'Fahrkorb', carry: true },
            { kind: 'check_point' as const, key: 'brakes', label: 'Bremsen' },
            { kind: 'text' as const, key: 'noticed', label: 'Sonst aufgefallen' },
          ],
        },
      ],
    }
    const review = probeCatalogueBundle.packages[0]?.forms[0]?.review

    if (review === undefined) {
      throw new Error('The probe package has a form with its review.')
    }

    const withATemplate = catalogueOf({
      ...probeCatalogueBundle,
      packages: probeCatalogueBundle.packages.map((pack, index) => ({
        ...pack,
        forms:
          index === 0
            ? [
                ...pack.forms,
                {
                  key: 'probe.elevator_protocol',
                  version: 1,
                  validFrom: '2018-01-01',
                  definition: elevatorProtocol,
                  review,
                },
              ]
            : pack.forms,
        dutyKinds: pack.dutyKinds.map((entry) =>
          entry.key === 'probe.elevator_main_test'
            ? {
                ...entry,
                definition: {
                  ...entry.definition,
                  evidence: { kinds: ['protocol', 'report'], form: 'probe.elevator_protocol' },
                },
              }
            : entry,
        ),
      })),
    })
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    /** A protocol of an elevator, written down on a day unless said otherwise, in a form, with what was said. */
    async function protocolOn(
      day: string,
      form: string,
      said: readonly [string, string][],
      { elevator = at, status = 'done' }: { elevator?: typeof at; status?: string } = {},
    ) {
      const { rows } = await admin.query<{ id: string }>(
        `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                                 performed_on, form_key, form_version)
         values ($1, $2, $3, $4, 'inspection', 'Hauptprüfung', 'started', $5, $6, 1)
         returning id`,
        [small, elevator.property, elevator.area, elevator.elevator, day, form],
      )
      const id = rows[0]?.id

      for (const [field, value] of said) {
        await admin.query(
          `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key,
                                         ${field === 'brakes' ? 'result' : 'value'})
           values ($1, $2, $3, $4, $5, $6)`,
          [small, elevator.property, elevator.area, id, field, value],
        )
      }

      await admin.query('update activities set status = $2 where id = $1', [id, status])
    }

    await protocolOn('2022-11-03', 'probe.elevator_protocol', [['car', '"Fahrkorb alt"']])
    await protocolOn('2024-11-20', 'probe.elevator_protocol', [
      ['car', '"Fahrkorb A, 8 Personen"'],
      ['brakes', 'ok'],
      ['noticed', '"Nichts"'],
    ])
    await protocolOn('2025-03-01', 'probe.water_meter_reading', [['reading', '1234567']])
    // Begun and not written down: no template, however late.
    await protocolOn('2025-06-02', 'probe.elevator_protocol', [['car', '"Fahrkorb halb"']], {
      status: 'started',
    })
    await evidenceOf(at, duty, '2024-11-20')
    await runDeadlinesOf({ database, catalogue: withATemplate, now: () => october }, small, october)

    const { rows } = await admin.query<{ template_on: string | null; id: string }>(
      `select a.template_on::text, a.id from activities a
         join activity_duties d on d.activity_id = a.id
        where d.duty_id = $1`,
      [duty],
    )
    const { rows: answers } = await admin.query<{ field_key: string; value: string | null }>(
      'select field_key, value from activity_answers where activity_id = $1',
      [rows[0]?.id],
    )

    expect(rows.map((row) => row.template_on)).toEqual(['2024-11-20'])
    expect(answers).toEqual([{ field_key: 'car', value: '"Fahrkorb A, 8 Personen"' }])

    // Where the asset has no protocol in the form, or one of which nothing carries, the
    // activity names no template.
    const other = await placeIn(small)
    const first = await mainTestAt(other)

    await protocolOn('2024-11-20', 'probe.elevator_protocol', [['brakes', 'ok']], {
      elevator: other,
    })

    await evidenceOf(other, first, '2024-11-20')
    await runDeadlinesOf({ database, catalogue: withATemplate, now: () => october }, small, october)

    const { rows: none } = await admin.query<{ template_on: string | null; answers: number }>(
      `select a.template_on::text,
              (select count(*)::int from activity_answers x where x.activity_id = a.id) as answers
         from activities a join activity_duties d on d.activity_id = a.id
        where d.duty_id = $1`,
      [first],
    )

    expect(none).toEqual([{ template_on: null, answers: 0 }])
  })

  it('gives a duty with an activity under way no second one when its due day moves', async () => {
    const at = await placeIn(small)
    const duty = await mainTestAt(at)

    await evidenceOf(at, duty, '2024-11-20')
    await run(small)

    // A shorter interval moves the due day to 2025-11-01, and the lead of
    // the new day has long begun.
    await admin.query('update duties set interval_months = 12 where id = $1', [duty])
    await run(small)

    expect(await deadlinesOf(duty)).toMatchObject([
      { due_on: '2025-11-01', reminded_for: '2025-11-01' },
    ])
    expect(await activitiesOf(duty)).toMatchObject([{ due_on: '2026-11-01', status: 'open' }])
  })

  it('makes a maintenance of a maintenance and an inspection of a visual check, and takes the contractor of the duty', async () => {
    const at = await placeIn(small)
    const ownDuty = async (task: string, performer: string | null, note: string | null) => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, building_id, label, basis, source_note, task,
                             counting, interval_months, responsible_user_id, performer, performer_note,
                             confirmed_by)
         values ($1, $2, $3, $4, $5, 'manufacturer', 'Betriebsanleitung', $6, 'from_performance', 12,
                 'u-site', $7, $8, 'u-duties')
         returning id`,
        [small, at.property, at.area, at.building, `Pflicht ${task}`, task, performer, note],
      )

      return (rows[0] as { id: string }).id
    }
    const maintenance = await ownDuty('maintenance', 'contractor', 'Aufzug Beispiel GmbH')
    const check = await ownDuty('visual_check', 'own_staff', null)

    // Both met a year ago, both due within the lead.
    for (const duty of [maintenance, check]) {
      await evidenceOf(at, duty, '2025-10-20')
    }

    await run(small)

    expect(await activitiesOf(maintenance)).toMatchObject([
      {
        kind: 'maintenance',
        title: 'Pflicht maintenance',
        performer: 'contractor',
        contractor_note: 'Aufzug Beispiel GmbH',
        building_id: at.building,
        asset_id: null,
      },
    ])
    expect(await activitiesOf(check)).toMatchObject([
      { kind: 'inspection', performer: 'own_staff', contractor_note: null },
    ])
  })
})

describe('the deadline of the meters of a property (#120)', () => {
  /** A water meter in the building of a place; its id. */
  async function meterAt(at: Place, mark: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name,
                           mark, meter_number, meter_unit)
       values ($1, $2, $3, $4, 'probe.water_meter', $5, $6, $5, $7, 'cubic_metres')
       returning id`,
      [at.tenantId, at.property, at.area, at.building, mark, `Wasserzähler ${mark}`, `13-${mark}`],
    )

    return (rows[0] as { id: string }).id
  }

  async function readingOf(at: Place, meter: string, keyDate: string): Promise<void> {
    await admin.query(
      `insert into meter_readings (tenant_id, property_id, area_id, asset_id, key_date, read_on,
                                   value_milli, source, recorded_by)
       values ($1, $2, $3, $4, $5, $5, 1000, 'by_hand', 'u-duties')`,
      [at.tenantId, at.property, at.area, meter, keyDate],
    )
  }

  async function meterDeadlinesOf(property: string) {
    const { rows } = await admin.query<Record<string, unknown>>(
      `select kind, status, source_id, due_on::text, property_id
         from deadlines where meter_property_id = $1`,
      [property],
    )

    return rows
  }

  it('is due on the earliest key date there without a reading, once for the property, and moves on with the readings', async () => {
    const at = await placeIn(small)
    const first = await meterAt(at, 'WZ-51')
    const second = await meterAt(at, 'WZ-52')

    await run(small)
    expect(await meterDeadlinesOf(at.property)).toEqual([
      {
        kind: 'meter.due',
        status: 'open',
        source_id: at.property,
        due_on: '2026-10-01',
        property_id: at.property,
      },
    ])

    // One meter read: the other one still holds the key date.
    await readingOf(at, first, '2026-10-01')
    await run(small)
    expect((await meterDeadlinesOf(at.property)).map((row) => row['due_on'])).toEqual([
      '2026-10-01',
    ])

    // Both read: the next key date.
    await readingOf(at, second, '2026-10-01')
    await run(small)
    expect((await meterDeadlinesOf(at.property)).map((row) => row['due_on'])).toEqual([
      '2026-11-01',
    ])
  })

  it('leaves out a locked meter and a key date a meter rests on', async () => {
    const at = await placeIn(small)
    const locked = await meterAt(at, 'WZ-53')
    const resting = await meterAt(at, 'WZ-54')

    await admin.query(
      `insert into meter_points (tenant_id, property_id, area_id, asset_id, lock_reason, locked_on)
       values ($1, $2, $3, $4, 'Schacht überflutet', '2026-10-02')`,
      [at.tenantId, at.property, at.area, locked],
    )
    await admin.query(
      `insert into meter_pauses (tenant_id, property_id, area_id, asset_id, starts_on, ends_on, reason)
       values ($1, $2, $3, $4, '2026-09-20', '2026-11-10', 'Haus leer')`,
      [at.tenantId, at.property, at.area, resting],
    )

    await run(small)
    expect((await meterDeadlinesOf(at.property)).map((row) => row['due_on'])).toEqual([
      '2026-12-01',
    ])
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
