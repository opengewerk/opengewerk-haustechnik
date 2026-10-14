import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  type RoleKey,
  shippedRoles,
  type SyncValue,
  type TaskCandidates,
  taskTitleMissing,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The tasks of an operator (#124, sections 3 and 7 of the concept): something
 * one person has to do by a day, at a place, an asset or an activity, written
 * and done through the sync in the office and on site.
 *
 * Everybody writes tasks for themselves and does their own; a task for
 * somebody else, and another's task done, asks to hand tasks out, which the
 * Objektleitung and above may, in their areas, and only to somebody who may do
 * tasks, is not shut out and sees the area of the task. A task lies in the
 * area of its property: it is seen by whoever sees its place. A device holds
 * the tasks for its person and those its person wrote; whoever sees every
 * area holds all of them.
 */

const operator = newId<'tenant'>() as TenantId
const neighbour = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  'u-other': { role: 'technician', name: 'Lena Vogt' },
  'u-south': { role: 'technician', name: 'Murat Yilmaz' },
  'u-gone': { role: 'technician', name: 'Jonas Peters' },
}
type Person = keyof typeof people & string

let admin: Pool
let database: Database
let app: INestApplication

/** An asset in the north and one in the south, with their properties. */
let northern = { property: '', asset: '' }
let southern = { property: '', asset: '' }

function http() {
  return request(app.getHttpServer())
}

function by(userId: Person, tenantId: TenantId = operator): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

let recorded = Date.parse('2026-10-11T08:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  kind: 'create' | 'update',
  recordId: string,
  values: Readonly<Record<string, SyncValue>>,
  seen: Readonly<Record<string, SyncValue>> = {},
  baseVersion: number | null = null,
) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity: 'tasks',
    recordId,
    kind,
    baseVersion,
    patches: Object.entries(values).map(([field, to]) => ({
      field,
      from: seen[field] ?? null,
      to,
    })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

type Sent = ReturnType<typeof operation>

function send(userId: Person, operations: readonly Sent[]) {
  return http()
    .post('/sync')
    .set(testIdentityHeader, by(userId))
    .send({ deviceId: `phone-${userId}`, operations })
}

/** What became of each operation, as the device reads it. */
async function outcomes(userId: Person, operations: readonly Sent[]) {
  const answer = await send(userId, operations).expect(201)

  return (
    answer.body.receipts as { outcome: string; reason: string | null; fields: string[] }[]
  ).map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))
}

const applied = { outcome: 'applied', reason: null, fields: [] }

/** A new task as a device makes it, at the asset in the north unless said otherwise. */
function newTask(over: Readonly<Record<string, SyncValue>> = {}) {
  const id = newId<'record'>()

  return {
    id,
    sent: operation('create', id, {
      title: 'Typenschild fotografieren',
      dueOn: '2026-10-20',
      assigneeUserId: 'u-tech',
      status: 'open',
      propertyId: northern.property,
      assetId: northern.asset,
      ...over,
    }),
  }
}

/** The row of a task as the database holds it, past the policies. */
async function row(id: string) {
  const { rows } = await admin.query<{
    status: string
    assignee_user_id: string
    created_by: string | null
    area_id: string
    deleted_at: Date | null
  }>('select status, assignee_user_id, created_by, area_id, deleted_at from tasks where id = $1', [
    id,
  ])

  return rows[0]
}

/** The tasks a device of a person is handed. */
async function pulled(userId: Person): Promise<string[]> {
  const answer = await http().get('/sync?since=0').set(testIdentityHeader, by(userId)).expect(200)
  const change = (answer.body.changes as { entity: string; rows: { id: string }[] }[]).find(
    (each) => each.entity === 'tasks',
  )

  return (change?.rows ?? []).map((each) => each.id).sort()
}

/** The tasks a person sees in the database, in their areas. */
async function seenBy(userId: Person): Promise<string[]> {
  const rows = await database.forTenant({ tenantId: operator, userId }, (tx) =>
    tx.execute<{ id: string }>(sql`select id from tasks order by id`),
  )

  return rows.rows.map((each) => each.id)
}

/** An asset in a building on a property of an area, made by the Technische Leitung. */
async function assetIn(area: string): Promise<{ property: string; asset: string }> {
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, by('u-duties')).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: `Schulzentrum ${area.slice(0, 4)}`,
    street: 'Hauptstraße 1',
    postalCode: '00001',
    city: 'Beispielstadt',
    federalState: 'DE-BW',
    areaId: area,
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Schulhaus',
    kinds: ['school'],
  })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
  })

  return { property, asset }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    operator,
    'Gebäudeverwaltung Süd',
    neighbour,
    'Wohnbau Nord eG',
  ])

  for (const tenantId of [operator, neighbour]) {
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
    [operator],
  )

  north = rows.find((each) => each.name === 'Nord')?.id ?? ''
  south = rows.find((each) => each.name === 'Süd')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      operator,
      userId,
      [person.role],
    ])
  }

  // Somebody who works next door and nowhere here.
  await admin.query(
    "insert into auth_users (id, name, email) values ('u-next', 'Nina Nachbar', 'n@x.example')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'u-next', '{technician}')",
    [neighbour],
  )

  // The Objektleitung and three technicians work in the north, one in the
  // south; the Leitung and the Technische Leitung see every area.
  for (const [userId, area] of [
    ['u-site', north],
    ['u-tech', north],
    ['u-other', north],
    ['u-gone', north],
    ['u-south', south],
  ] as const) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [operator, userId, area],
    )
  }

  // One technician has left.
  await admin.query("update memberships set blocked_at = now() where user_id = 'u-gone'")

  // Somebody in the north whose role lets them look at the places and do
  // nothing with tasks: a role of the operator's own, as phase 2 brings them.
  await admin.query(
    `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
     values ($1, 'reader', 'Nur lesen', '{location.read}', false, false)`,
    [operator],
  )
  await admin.query(
    "insert into auth_users (id, name, email) values ('u-plain', 'Paul Plain', 'p@x.example')",
  )
  await admin.query(
    "insert into memberships (tenant_id, user_id, roles) values ($1, 'u-plain', '{reader}')",
    [operator],
  )
  await admin.query(
    "insert into member_areas (tenant_id, user_id, area_id) values ($1, 'u-plain', $2)",
    [operator, north],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue: catalogueOf(probeCatalogueBundle) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  northern = await assetIn(north)
  southern = await assetIn(south)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a task for oneself', () => {
  it('is written by every role and done by its person, also as Haustechnik', async () => {
    const task = newTask({ assigneeUserId: 'u-other' })

    expect(await outcomes('u-other', [task.sent])).toEqual([applied])
    expect(await row(task.id)).toMatchObject({
      status: 'open',
      assignee_user_id: 'u-other',
      created_by: 'u-other',
      area_id: north,
    })

    const done = operation('update', task.id, { status: 'done' }, { status: 'open' }, 1)

    expect(await outcomes('u-other', [done])).toEqual([applied])
    expect((await row(task.id))?.status).toBe('done')
  })

  it('names who wrote it from the request, never from the device', async () => {
    const task = newTask({ assigneeUserId: 'u-tech', createdBy: 'u-lead' })

    expect(await outcomes('u-tech', [task.sent])).toEqual([
      { outcome: 'conflict', reason: 'set_by_server', fields: ['createdBy'] },
    ])
    expect(await row(task.id)).toBeUndefined()
  })

  it('changes nothing afterwards but whether it is done', async () => {
    const task = newTask()

    expect(await outcomes('u-tech', [task.sent])).toEqual([applied])

    const renamed = operation('update', task.id, { title: 'Etwas anderes' }, {}, 1)

    expect(await outcomes('u-tech', [renamed])).toEqual([
      { outcome: 'conflict', reason: 'online_only', fields: ['title'] },
    ])
  })
})

describe('a task for somebody else', () => {
  it('is handed out only by whoever may, Haustechnik is refused with the right it lacks', async () => {
    const refused = newTask({ assigneeUserId: 'u-other' })
    const answer = await send('u-tech', [refused.sent]).expect(400)

    expect(answer.body).toMatchObject({
      message: missingRight('task.assign'),
      operationId: refused.sent.id,
    })
    expect(await row(refused.id)).toBeUndefined()

    const handed = newTask({ assigneeUserId: 'u-other' })

    expect(await outcomes('u-site', [handed.sent])).toEqual([applied])
    expect(await row(handed.id)).toMatchObject({
      assignee_user_id: 'u-other',
      created_by: 'u-site',
    })
  })

  it('goes to somebody who works for the operator, is not shut out and sees the area of the task', async () => {
    const missing = { outcome: 'conflict', reason: 'record_missing', fields: ['assigneeUserId'] }
    const shutOut = newTask({ assigneeUserId: 'u-gone' })
    const nextDoor = newTask({ assigneeUserId: 'u-next' })
    const elsewhere = newTask({ assigneeUserId: 'u-south' })
    const nobody = newTask({ assigneeUserId: '' })
    const withoutTheRight = newTask({ assigneeUserId: 'u-plain' })
    const fine = newTask({
      assigneeUserId: 'u-south',
      propertyId: southern.property,
      assetId: southern.asset,
    })

    expect(
      await outcomes('u-lead', [
        shutOut.sent,
        nextDoor.sent,
        elsewhere.sent,
        nobody.sent,
        withoutTheRight.sent,
        fine.sent,
      ]),
    ).toEqual([missing, missing, missing, missing, missing, applied])

    for (const task of [shutOut, nextDoor, elsewhere, nobody, withoutTheRight]) {
      expect(await row(task.id)).toBeUndefined()
    }
  })

  it('is done by its person or by whoever hands tasks out, and by nobody else', async () => {
    const task = newTask({ assigneeUserId: 'u-tech' })

    expect(await outcomes('u-site', [task.sent])).toEqual([applied])

    const byColleague = operation('update', task.id, { status: 'done' }, { status: 'open' }, 1)
    const answer = await send('u-other', [byColleague]).expect(400)

    expect(answer.body).toMatchObject({ message: missingRight('task.assign') })
    expect((await row(task.id))?.status).toBe('open')

    // Not even by who wrote it, once it went to somebody else and they may
    // not hand tasks out: the Objektleitung wrote this one and may.
    const byPlanner = operation('update', task.id, { status: 'done' }, { status: 'open' }, 1)

    expect(await outcomes('u-site', [byPlanner])).toEqual([applied])

    const reopened = operation('update', task.id, { status: 'open' }, { status: 'done' }, 2)

    expect(await outcomes('u-tech', [reopened])).toEqual([applied])
    expect((await row(task.id))?.status).toBe('open')
  })

  it('done on two ways is no conflict: by whoever hands it out, then on the device of its person', async () => {
    // opengewerk#601. The device of its person still holds the task open and
    // ticks it off after the Objektleitung did. Both want the same, so there
    // is nothing to put in front of anybody.
    const task = newTask({ assigneeUserId: 'u-tech' })

    expect(await outcomes('u-site', [task.sent])).toEqual([applied])

    const byPlanner = operation('update', task.id, { status: 'done' }, { status: 'open' }, 1)

    expect(await outcomes('u-site', [byPlanner])).toEqual([applied])

    const onTheDevice = operation('update', task.id, { status: 'done' }, { status: 'open' }, 1)

    expect(await outcomes('u-tech', [onTheDevice])).toEqual([
      { outcome: 'skipped', reason: 'nothing_to_do', fields: [] },
    ])
    expect((await row(task.id))?.status).toBe('done')
  })
})

describe('a task out of sight', () => {
  it('is changed by nobody who does not see its area, also not by whoever hands tasks out', async () => {
    const southernTask = newTask({
      assigneeUserId: 'u-south',
      propertyId: southern.property,
      assetId: southern.asset,
    })

    expect(await outcomes('u-lead', [southernTask.sent])).toEqual([applied])

    const fromTheNorth = operation(
      'update',
      southernTask.id,
      { status: 'done' },
      { status: 'open' },
      1,
    )
    const [outcome] = await outcomes('u-site', [fromTheNorth])

    expect(outcome).toEqual({ outcome: 'conflict', reason: 'record_missing', fields: [] })
    expect((await row(southernTask.id))?.status).toBe('open')
  })
})

describe('where a task lies', () => {
  it('is the area of its property: a task at an asset is seen by whoever sees the asset', async () => {
    const northernTask = newTask({ assigneeUserId: 'u-tech' })
    const southernTask = newTask({
      assigneeUserId: 'u-south',
      propertyId: southern.property,
      assetId: southern.asset,
    })

    expect(await outcomes('u-lead', [northernTask.sent, southernTask.sent])).toEqual([
      applied,
      applied,
    ])

    expect(await seenBy('u-site')).toContain(northernTask.id)
    expect(await seenBy('u-site')).not.toContain(southernTask.id)
    expect(await seenBy('u-south')).toContain(southernTask.id)
    expect(await seenBy('u-south')).not.toContain(northernTask.id)
    expect(await seenBy('u-lead')).toEqual(
      expect.arrayContaining([northernTask.id, southernTask.id]),
    )
  })

  it('hangs on its property and on at most one record there, and says what is to be done', async () => {
    const refused = async (task: ReturnType<typeof newTask>) =>
      (await send('u-lead', [task.sent]).expect(400)).body.message as string

    expect(await refused(newTask({ roomId: newId<'room'>() }))).toBe(
      'Eine Aufgabe hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum, einem Gebäude oder einem Vorgang.',
    )
    expect(await refused(newTask({ propertyId: null, assetId: null }))).toBe(
      'Eine Aufgabe hängt an einer Liegenschaft.',
    )
    expect(await refused(newTask({ title: '   ' }))).toBe(taskTitleMissing)
    expect(await refused(newTask({ title: 'x'.repeat(201) }))).toBe(
      'Der Text einer Aufgabe hat höchstens 200 Zeichen.',
    )

    // An asset of another property is not there for this one.
    const elsewhere = newTask({ propertyId: northern.property, assetId: southern.asset })

    expect(await outcomes('u-lead', [elsewhere.sent])).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['assetId'] },
    ])
  })

  it('goes with the record it hangs on when that is removed', async () => {
    const task = newTask({ assigneeUserId: 'u-tech' })

    expect(await outcomes('u-tech', [task.sent])).toEqual([applied])
    await database.forTenant({ tenantId: operator, userId: 'u-lead' }, async (tx) => {
      await tx.execute(sql`update assets set deleted_at = now() where id = ${northern.asset}`)
    })

    expect((await row(task.id))?.deleted_at).not.toBeNull()
    await admin.query('update assets set deleted_at = null where id = $1', [northern.asset])
  })
})

describe('the tasks on a device', () => {
  it('are those for its person and those its person wrote; whoever sees every area holds all', async () => {
    const forTech = newTask({ assigneeUserId: 'u-tech' })
    const ownOfOther = newTask({ assigneeUserId: 'u-other' })

    expect(await outcomes('u-site', [forTech.sent])).toEqual([applied])
    expect(await outcomes('u-other', [ownOfOther.sent])).toEqual([applied])

    expect(await pulled('u-tech')).toContain(forTech.id)
    expect(await pulled('u-tech')).not.toContain(ownOfOther.id)
    expect(await pulled('u-site')).toContain(forTech.id)
    expect(await pulled('u-site')).not.toContain(ownOfOther.id)
    expect(await pulled('u-other')).toContain(ownOfOther.id)
    expect(await pulled('u-other')).not.toContain(forTech.id)
    expect(await pulled('u-lead')).toEqual(expect.arrayContaining([forTech.id, ownOfOther.id]))
  })
})

describe('who a task may go to', () => {
  it('is said per area to whoever hands tasks out, by name, without the shut out', async () => {
    const answer = await http()
      .get('/tasks/candidates')
      .set(testIdentityHeader, by('u-site'))
      .expect(200)

    expect((answer.body as TaskCandidates).areas).toEqual([
      {
        areaId: north,
        people: [
          { userId: 'u-other', name: 'Lena Vogt' },
          { userId: 'u-site', name: 'Petra Lindner' },
          { userId: 'u-tech', name: 'Tobias Wendt' },
          // The Leitung and the Technische Leitung see every area.
          { userId: 'u-duties', name: 'Jörg Albrecht' },
          { userId: 'u-lead', name: 'Sabine Krämer' },
        ].sort((left, right) => left.name.localeCompare(right.name, 'de')),
      },
    ])
  })

  it('is said for every area to whoever sees every area', async () => {
    const answer = await http()
      .get('/tasks/candidates')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const areas = (answer.body as TaskCandidates).areas
    const southern = areas.find((area) => area.areaId === south)

    expect(areas.map((area) => area.areaId).sort()).toEqual([north, south].sort())
    expect(southern?.people.map((person) => person.userId)).toEqual([
      'u-duties',
      'u-south',
      'u-lead',
    ])
  })

  it('is not said to whoever only writes tasks for themselves', async () => {
    const answer = await http()
      .get('/tasks/candidates')
      .set(testIdentityHeader, by('u-tech'))
      .expect(403)

    expect(answer.body).toMatchObject({ message: missingRight('task.assign') })
  })
})

/**
 * The action "Aufgabe" of the deadline engine (#242, section 2.4 of the
 * concept): when the reading of the meters of a property falls due, whoever
 * answers for the deadline gets the task to read them, one for the property
 * and its key date, and it is done once the deadline no longer waits for
 * that day. Whoever leads the operator answers for it, here the Leitung.
 */
describe('the task of a due reading', () => {
  const catalogue = catalogueOf(probeCatalogueBundle)

  /** A morning in October: the key date of the 1st is due and its lead has long begun. */
  const october = new Date('2026-10-05T10:00:00Z')
  /** A morning two days before the key date of November: its lead has begun. */
  const beforeNovember = new Date('2026-10-30T10:00:00Z')

  /** One pass of the engine over the operator at a moment. */
  function run(now: Date = october) {
    return runDeadlinesOf({ database, catalogue, now: () => now }, operator, now)
  }

  /** A water meter beside the asset of a place, in its building; its id. */
  async function meterAt(at: { asset: string }, mark: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name,
                           mark, meter_number, meter_unit)
       select tenant_id, property_id, area_id, building_id, 'probe.water_meter', $2, $3, $2, $4,
              'cubic_metres'
         from assets where id = $1
       returning id`,
      [at.asset, mark, `Wasserzähler ${mark}`, `13-${mark}`],
    )

    return (rows[0] as { id: string }).id
  }

  /** A reading of a meter for a key date, taken that day. */
  async function readingOf(meter: string, keyDate: string): Promise<void> {
    await admin.query(
      `insert into meter_readings (tenant_id, property_id, area_id, asset_id, key_date, read_on,
                                   value_milli, source, recorded_by)
       select tenant_id, property_id, area_id, id, $2, $2, 1000, 'by_hand', 'u-duties'
         from assets where id = $1`,
      [meter, keyDate],
    )
  }

  /** The tasks at a property as the database holds them, past the policies. */
  async function tasksAt(property: string) {
    const { rows } = await admin.query<{
      id: string
      title: string
      due_on: string
      status: string
      assignee_user_id: string
      created_by: string | null
    }>(
      `select id, title, due_on::text, status::text, assignee_user_id, created_by
         from tasks where property_id = $1 and deleted_at is null
        order by created_at, id`,
      [property],
    )

    return rows
  }

  /** The deadline of the meters of a property. */
  async function deadlineOf(property: string) {
    const { rows } = await admin.query<{
      id: string
      status: string
      due_on: string
      reminded_for: string | null
      task_id: string | null
    }>(
      `select id, status::text, due_on::text, reminded_for::text, task_id
         from deadlines where meter_property_id = $1`,
      [property],
    )

    return rows[0]
  }

  it('comes of the key date once its lead begins: one for whoever answers for the deadline, at the property, however often the engine runs', async () => {
    const at = await assetIn(north)

    await meterAt(at, 'WZ-61')
    await meterAt(at, 'WZ-62')
    await run()
    await run()

    const made = await tasksAt(at.property)

    // Two meters, one deadline for the property, and so one task.
    expect(made).toEqual([
      {
        id: expect.any(String),
        title: 'Zähler ablesen',
        due_on: '2026-10-01',
        status: 'open',
        assignee_user_id: 'u-lead',
        created_by: null,
      },
    ])
    expect(await deadlineOf(at.property)).toMatchObject({
      due_on: '2026-10-01',
      reminded_for: '2026-10-01',
      task_id: made[0]?.id,
    })

    // It hangs on the property and on nothing there, and lies in its area.
    const { rows: places } = await admin.query(
      `select area_id, building_id, room_id, asset_id, activity_id from tasks where id = $1`,
      [made[0]?.id],
    )

    expect(places).toEqual([
      { area_id: north, building_id: null, room_id: null, asset_id: null, activity_id: null },
    ])

    // The device of its person holds it, like any task of theirs.
    expect(await pulled('u-lead')).toContain(made[0]?.id)
  })

  it('is done once every meter there has its reading for the key date, in the pass in which the deadline moves on', async () => {
    const at = await assetIn(north)
    const first = await meterAt(at, 'WZ-63')
    const second = await meterAt(at, 'WZ-64')

    await run()
    expect((await tasksAt(at.property)).map((task) => task.status)).toEqual(['open'])

    // One meter read: the other one still holds the key date.
    await readingOf(first, '2026-10-01')
    await run()
    expect((await tasksAt(at.property)).map((task) => task.status)).toEqual(['open'])

    await readingOf(second, '2026-10-01')
    await run()
    expect(await deadlineOf(at.property)).toMatchObject({ status: 'open', due_on: '2026-11-01' })
    expect(await tasksAt(at.property)).toMatchObject([{ due_on: '2026-10-01', status: 'done' }])

    // The next key date gets a task of its own once its lead begins.
    await run(beforeNovember)
    expect(await tasksAt(at.property)).toMatchObject([
      { due_on: '2026-10-01', status: 'done' },
      { due_on: '2026-11-01', status: 'open' },
    ])
  })

  it('is done at the same moment when somebody gave it another day by hand', async () => {
    const at = await assetIn(north)
    const meter = await meterAt(at, 'WZ-65')

    await run()
    await admin.query(`update tasks set due_on = '2026-12-24' where property_id = $1`, [
      at.property,
    ])

    // Not read yet: the day somebody gave it changes nothing.
    await run()
    expect((await tasksAt(at.property)).map((task) => task.status)).toEqual(['open'])

    await readingOf(meter, '2026-10-01')
    await run()
    expect((await tasksAt(at.property)).map((task) => task.status)).toEqual(['done'])
  })

  it('is done when nothing there is to be read any more', async () => {
    const at = await assetIn(north)
    const meter = await meterAt(at, 'WZ-66')

    await run()
    expect((await tasksAt(at.property)).map((task) => task.status)).toEqual(['open'])

    await admin.query(
      `insert into meter_points (tenant_id, property_id, area_id, asset_id, lock_reason, locked_on)
       select tenant_id, property_id, area_id, id, 'Schacht überflutet', '2026-10-02'
         from assets where id = $1`,
      [meter],
    )
    await run()

    expect(await deadlineOf(at.property)).toMatchObject({ status: 'dropped' })
    expect((await tasksAt(at.property)).map((task) => task.status)).toEqual(['done'])
  })

  it('follows its deadline to an earlier day and gets no second one beside it', async () => {
    const at = await assetIn(north)
    const read = await meterAt(at, 'WZ-67')

    await readingOf(read, '2026-10-01')
    await run(beforeNovember)
    expect(await tasksAt(at.property)).toMatchObject([{ due_on: '2026-11-01', status: 'open' }])

    // A meter that was not read for October: the deadline goes back to it.
    await meterAt(at, 'WZ-68')
    await run(beforeNovember)

    expect(await deadlineOf(at.property)).toMatchObject({
      due_on: '2026-10-01',
      reminded_for: '2026-10-01',
    })
    expect(await tasksAt(at.property)).toMatchObject([{ due_on: '2026-10-01', status: 'open' }])
  })

  it('is made for nobody who does not see the area of the deadline, and the pass goes through all the same', async () => {
    const at = await assetIn(north)
    const meter = await meterAt(at, 'WZ-69')

    // Read for October, so the deadline stands before its lead begins.
    await readingOf(meter, '2026-10-01')
    await run()

    // The office names a technician of the south for the meters in the north.
    await admin.query(
      `update deadlines set responsible_user_id = 'u-south' where meter_property_id = $1`,
      [at.property],
    )
    await run(beforeNovember)

    expect(await deadlineOf(at.property)).toMatchObject({
      due_on: '2026-11-01',
      reminded_for: '2026-11-01',
      task_id: null,
    })
    expect(await tasksAt(at.property)).toEqual([])
  })

  it('is none for a defect that is due: a defect only reminds', async () => {
    const at = await assetIn(north)

    await admin.query(
      `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on, due_on)
       select tenant_id, property_id, area_id, id, 'Leck am Antrieb', '2026-10-01', '2026-10-06'
         from assets where id = $1`,
      [at.asset],
    )
    await run()

    const { rows } = await admin.query(
      `select kind, reminded_for::text from deadlines where property_id = $1`,
      [at.property],
    )

    expect(rows).toEqual([{ kind: 'defect.due', reminded_for: '2026-10-06' }])
    expect(await tasksAt(at.property)).toEqual([])
  })

  it('names a task of its own operator and of its own property only', async () => {
    const at = await assetIn(north)

    await meterAt(at, 'WZ-70')
    await run()

    const { rows: foreign } = await admin.query<{ id: string }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         select $1, (select id from areas where tenant_id = $1 limit 1), 'Nachbarhaus', 'Weg 1',
                '00002', 'Beispielstadt', 'DE-BW'
         returning id, area_id
       )
       insert into tasks (tenant_id, property_id, area_id, title, due_on, assignee_user_id)
       select $1, id, area_id, 'Zähler ablesen', '2026-10-01', 'u-next' from property
       returning id`,
      [neighbour],
    )

    await expect(
      admin.query(`update deadlines set task_id = $2 where meter_property_id = $1`, [
        at.property,
        foreign[0]?.id,
      ]),
    ).rejects.toThrow(/deadlines_with_a_task_of_their_property/)

    // Nor a task of the same operator at another property.
    const elsewhere = await assetIn(north)

    await meterAt(elsewhere, 'WZ-71')
    await run()

    const [other] = await tasksAt(elsewhere.property)

    await expect(
      admin.query(`update deadlines set task_id = $2 where meter_property_id = $1`, [
        at.property,
        other?.id,
      ]),
    ).rejects.toThrow(/deadlines_with_a_task_of_their_property/)
  })
})
