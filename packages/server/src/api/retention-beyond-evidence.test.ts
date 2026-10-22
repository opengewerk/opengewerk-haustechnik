import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  recordRetentionKinds,
  recordRetentionYears,
  type RecordRetentionProposals,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId } from '@opengewerk/platform-server'
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
import { leastState, nextEvidenceNumber } from '../database/test-evidence.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { removeAfterRetention } from '../retention/removal.js'
import { deviceScope, pullScope } from '../sync/device-scope.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * What hangs on no evidence and its own retention (#412, section 2.6 of the
 * concept, decided on 21.10.2026). An activity without evidence becomes its
 * shell six years from the end of the year it ended, a remedied defect loses
 * its content five years after it was remedied, both on the confirmation of
 * whoever leads; a task done goes a year after, the person at a reading, a
 * booking and a material three years after, on the pass of the deadlines.
 * The database counts every end and refuses every other way.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'technician',
  // Leads, and sees the southern area alone.
  'u-south': 'management',
}

const catalogue = catalogueOf(probeCatalogueBundle)

let admin: Pool
let database: Database
let app: INestApplication
const folder = mkdtempSync(join(tmpdir(), 'retention-beyond-evidence-'))

/** The places: an asset in the north, one in a building with the southern area of its own. */
const place = { property: '', north: '', south: '', assetNorth: '', assetSouth: '' }
const duty = { north: '', south: '' }

function http() {
  return request(app.getHttpServer())
}

function by(userId: string): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

async function one<T>(query: string, values: unknown[] = []): Promise<T> {
  return (await admin.query(query, values)).rows[0] as T
}

/** The entries of the change log of one record. */
async function logged(table: string, id: string): Promise<number> {
  return Number(
    (
      await admin.query<{ n: string }>(
        'select count(*) as n from audit_entries where table_name = $1 and record_id = $2',
        [table, id],
      )
    ).rows[0]?.n,
  )
}

/**
 * What the database answers a statement of a person, of nobody, or of the
 * pass of the deadlines, which says so (#542): its class, or that it wrote.
 */
async function refusalOf(
  userId: string | null | 'the pass',
  statement: ReturnType<typeof sql>,
): Promise<unknown> {
  try {
    await database.forTenant(
      userId === null || userId === 'the pass'
        ? { tenantId: tenant, reason: 'probe' }
        : { tenantId: tenant, userId },
      async (tx) => {
        await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)

        if (userId === 'the pass') {
          await tx.execute(sql`select set_config('app.deadline_run', 'on', true)`)
        }

        await tx.execute(statement)
      },
    )
  } catch (error) {
    return (
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code
    )
  }

  return 'written'
}

/**
 * An inspection at an asset, closed as not performed on a day the owner
 * writes, as for a row from before; with a note in its duty and a document.
 */
async function closedInspection(assetId: string, endedOn: string, title = 'Sichtkontrolle') {
  const { id } = await one<{ id: string }>(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             closing_reason, responsible_user_id, ended_on)
     select tenant_id, property_id, area_id, id, 'inspection', $2, 'not_performed',
            'Anlage außer Betrieb, Herr Maier informiert.', 'u-duties', $3
       from assets where id = $1
     returning id`,
    [assetId, title, endedOn],
  )

  return id
}

/** An evidence of a duty in an activity, put in past the application. */
async function evidenceOf(dutyId: string, activityId: string) {
  const number = nextEvidenceNumber()
  const state = leastState(number, '2019-03-14', 'without_defects')

  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, activity_id, performed_on, result,
                           number, origin, examiner, examiner_organisation, written_by, state, fingerprint)
     select tenant_id, property_id, area_id, id, $2, '2019-03-14', 'without_defects', $3, 'report',
            'Erika Muster', 'Prüfstelle Süd', 'u-duties', $4, $5
       from duties where id = $1`,
    [dutyId, activityId, number, JSON.stringify(state), stateFingerprint(state)],
  )
}

/** A defect at an asset, remedied on a day the owner writes, with a photo whose file nothing else names. */
async function remediedDefect(assetId: string, remediedOn: string) {
  const defect = await one<{ id: string }>(
    `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on, status,
                          remedied_on, checked_on, check_note)
     select tenant_id, property_id, area_id, id, 'Tür im Keller bei Frau Huber schleift', '2018-11-02',
            'verified', $2, $2, 'Von Herrn Maier nachgeprüft'
       from assets where id = $1
     returning id`,
    [assetId, remediedOn],
  )
  const photo = await one<{ id: string }>(
    `insert into attachments (tenant_id, property_id, area_id, defect_id, title)
     select tenant_id, property_id, area_id, id, 'Foto der Tür bei Frau Huber' from defects where id = $1
     returning id`,
    [defect.id],
  )
  const file = photo.id.replaceAll('-', '').repeat(2)

  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type)
     select tenant_id, $2, 1, 'image/jpeg' from attachments where id = $1`,
    [photo.id, file],
  )
  await admin.query(
    `insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
     select tenant_id, id, $2, 'tuer-huber.jpg', 'image/jpeg', 1 from attachments where id = $1`,
    [photo.id, file],
  )

  return { id: defect.id, photo: photo.id, file }
}

/** What a device of a person names the tasks by, at a pull. */
async function namedTasks(userId: string): Promise<string | undefined> {
  return database.forTenant({ tenantId: tenant, userId }, async (tx) => {
    const scope = pullScope(await deviceScope(tx, userId), { holds: () => true })

    return scope.narrowed?.['tasks']
  })
}

function proposals(userId: string) {
  return http().get('/settings/record-retention/proposals').set(testIdentityHeader, by(userId))
}

function emptyActivities(userId: string, activityIds: readonly string[]) {
  return http()
    .post('/settings/record-retention/activity-emptyings')
    .set(testIdentityHeader, by(userId))
    .send({ activityIds })
}

function emptyDefects(userId: string, defectIds: readonly string[]) {
  return http()
    .post('/settings/record-retention/defect-emptyings')
    .set(testIdentityHeader, by(userId))
    .send({ defectIds })
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Probe'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
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
    imports: [
      ApiModule.create(database, testIdentities, { catalogue, files: new FileStore(folder) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const made = async (
    path: string,
    body: object,
    method: 'post' | 'patch' = 'post',
    userId = 'u-duties',
  ) => {
    const answer = await http()[method](path).set(testIdentityHeader, by(userId)).send(body)

    if (answer.status >= 300) {
      throw new Error(`${path}: ${JSON.stringify(answer.body)}`)
    }

    return answer.body.id as string
  }

  place.property = await made('/properties', {
    name: 'Werkhof Nord',
    street: 'Probeweg 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  })

  const north = await made(`/properties/${place.property}/buildings`, {
    name: 'Halle 1',
    kinds: ['school'],
  })
  const south = await made(`/properties/${place.property}/buildings`, {
    name: 'Halle 2',
    kinds: ['school'],
  })

  place.north = (
    await one<{ area_id: string }>('select area_id from properties where id = $1', [place.property])
  ).area_id
  place.south = await made('/areas', { name: 'Süd' }, 'post', 'u-lead')
  await made(`/buildings/${south}`, { ownAreaId: place.south }, 'patch', 'u-lead')
  await admin.query('delete from member_all_areas where tenant_id = $1 and user_id = $2', [
    tenant,
    'u-south',
  ])
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    tenant,
    'u-south',
    place.south,
  ])

  place.assetNorth = await made(`/buildings/${north}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug Nord',
  })
  place.assetSouth = await made(`/buildings/${south}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug Süd',
  })

  const dutyAt = async (assetId: string) =>
    (
      await one<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                             counting, interval_months, confirmed_by)
         select tenant_id, property_id, area_id, id, 'Sichtkontrolle', 'own_decision', 'Hausordnung',
                'from_performance', 12, 'u-duties'
           from assets where id = $1
         returning id`,
        [assetId],
      )
    ).id

  duty.north = await dutyAt(place.assetNorth)
  duty.south = await dutyAt(place.assetSouth)

  await admin.query(`insert into stores (tenant_id, name) values ($1, 'Lager Nord')`, [tenant])
  await admin.query(
    `insert into articles (tenant_id, number, designation, unit) values ($1, 'ART-1', 'Dichtung', 'piece')`,
    [tenant],
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('an activity without evidence', () => {
  it('is proposed and becomes its shell on the confirmation of whoever leads, six years from the end of its year', async () => {
    // Ended in 2019: kept to the end of 2025, gone from 2026.
    const id = await closedInspection(place.assetNorth, '2019-05-01')
    const before = await logged('activities', id)

    const proposed = await proposals('u-lead')

    expect(proposed.status).toBe(200)
    expect(
      (proposed.body as RecordRetentionProposals).activities.find(
        (proposal) => proposal.activityId === id,
      ),
    ).toMatchObject({ endedOn: '2019-05-01', retentionEndedOn: '2026-01-01', kind: 'Prüfung' })

    const confirmed = await emptyActivities('u-lead', [id])

    expect(confirmed.status).toBe(201)
    expect(
      await one(
        'select title, closing_reason, responsible_user_id, emptied_at is not null as emptied from activities where id = $1',
        [id],
      ),
    ).toEqual({
      title: 'Gelöscht nach Ablauf der Aufbewahrung',
      closing_reason: 'Gelöscht nach Ablauf der Aufbewahrung.',
      responsible_user_id: null,
      emptied: true,
    })
    expect(
      await one(
        'select confirmed_by, years, ended_on::text from activity_emptyings where activity_id = $1',
        [id],
      ),
    ).toEqual({ confirmed_by: 'u-lead', years: 6, ended_on: '2026-01-01' })
    // The log does not copy what went; the confirmation stands in it.
    expect(await logged('activities', id)).toBe(before)
  })

  it('is neither proposed nor emptied before the end of its retention', async () => {
    // Ended in 2020: kept to the end of 2026.
    const id = await closedInspection(place.assetNorth, '2020-12-31')

    expect(
      (await proposals('u-lead')).body.activities.map(
        (proposal: { activityId: string }) => proposal.activityId,
      ),
    ).not.toContain(id)

    const refused = await emptyActivities('u-lead', [id])

    expect(refused.status).toBe(409)
    expect(refused.body.message).toBe('Die Aufbewahrung dieses Vorgangs ist nicht abgelaufen.')
    expect(await one('select emptied_at from activities where id = $1', [id])).toEqual({
      emptied_at: null,
    })
  })

  it('is emptied only by whoever leads', async () => {
    const id = await closedInspection(place.assetNorth, '2018-02-01')

    expect((await emptyActivities('u-duties', [id])).status).toBe(403)
    // Past the route, the database refuses it as well.
    expect(
      await refusalOf(
        'u-duties',
        sql`insert into activity_emptyings (tenant_id, property_id, area_id, activity_id, confirmed_by)
            select tenant_id, property_id, area_id, id, 'u-duties' from activities where id = ${id}`,
      ),
    ).toBe('HT008')
    expect(await one('select emptied_at from activities where id = $1', [id])).toEqual({
      emptied_at: null,
    })
  })

  it('is none while it has an evidence, also one in an area the person who confirms does not see', async () => {
    // In the south, with an evidence of the northern duty.
    const id = await closedInspection(place.assetSouth, '2018-02-01', 'Mit Nachweis im Norden')

    await evidenceOf(duty.north, id)

    expect(
      (await proposals('u-south')).body.activities.map(
        (proposal: { activityId: string }) => proposal.activityId,
      ),
    ).not.toContain(id)
    expect((await emptyActivities('u-south', [id])).status).toBe(409)
    expect(await one('select emptied_at from activities where id = $1', [id])).toEqual({
      emptied_at: null,
    })
  })

  it('takes its day of ending from its status, whatever the application says', async () => {
    const { id } = await one<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title)
       select tenant_id, property_id, area_id, id, 'inspection', 'Offen' from assets where id = $1
       returning id`,
      [place.assetNorth],
    )

    expect(
      await refusalOf(
        'u-duties',
        sql`update activities set ended_on = '2001-01-01' where id = ${id}`,
      ),
    ).toBe('written')
    expect(await one('select ended_on from activities where id = $1', [id])).toEqual({
      ended_on: null,
    })
    expect(
      await refusalOf(
        'u-duties',
        sql`update activities set status = 'not_performed', closing_reason = 'Entfällt.', ended_on = '2001-01-01'
             where id = ${id}`,
      ),
    ).toBe('written')
    expect(
      await one(
        `select ended_on = (now() at time zone 'Europe/Berlin')::date as today from activities where id = $1`,
        [id],
      ),
    ).toEqual({ today: true })
  })
})

describe('the deadline of the end', () => {
  it('stands with whoever leads once an activity or a defect has ended, and is done with the confirmation', async () => {
    const activity = await closedInspection(place.assetNorth, '2018-09-01', 'Mit Frist')
    const young = await closedInspection(place.assetNorth, '2026-01-02', 'Ohne Frist')
    const defect = await remediedDefect(place.assetNorth, '2019-09-01')
    const deadlineOf = async (column: string, id: string) =>
      (
        await admin.query<{ kind: string; status: string; closed_by: string | null }>(
          `select kind, status, closed_by from deadlines where ${column} = $1 and kind like '%retention_ends'`,
          [id],
        )
      ).rows

    await runDeadlinesOf({ database, catalogue, now: () => new Date() }, tenant, new Date())

    expect(await deadlineOf('activity_id', activity)).toEqual([
      { kind: 'activity.retention_ends', status: 'open', closed_by: null },
    ])
    expect(await deadlineOf('activity_id', young)).toEqual([])
    expect(await deadlineOf('defect_id', defect.id)).toEqual([
      { kind: 'defect.retention_ends', status: 'open', closed_by: null },
    ])

    expect((await emptyActivities('u-lead', [activity])).status).toBe(201)
    expect((await emptyDefects('u-lead', [defect.id])).status).toBe(201)
    expect(await deadlineOf('activity_id', activity)).toEqual([
      { kind: 'activity.retention_ends', status: 'done', closed_by: 'u-lead' },
    ])
    expect(await deadlineOf('defect_id', defect.id)).toEqual([
      { kind: 'defect.retention_ends', status: 'done', closed_by: 'u-lead' },
    ])
  })
})

describe('a remedied defect', () => {
  it('loses its content and its photos on the confirmation of whoever leads, five years after it was remedied, and keeps its row', async () => {
    const defect = await remediedDefect(place.assetNorth, '2020-03-01')
    const before = await logged('defects', defect.id)

    expect(
      (await proposals('u-lead')).body.defects.find(
        (proposal: { defectId: string }) => proposal.defectId === defect.id,
      ),
    ).toMatchObject({ remediedOn: '2020-03-01', retentionEndedOn: '2025-03-01' })
    expect((await emptyDefects('u-lead', [defect.id])).status).toBe(201)
    expect(
      await one(
        `select description, check_note, status, found_on::text, remedied_on::text, asset_id,
                emptied_at is not null as emptied
           from defects where id = $1`,
        [defect.id],
      ),
    ).toEqual({
      description: 'Gelöscht nach Ablauf der Aufbewahrung.',
      check_note: 'Gelöscht nach Ablauf der Aufbewahrung.',
      status: 'verified',
      found_on: '2018-11-02',
      remedied_on: '2020-03-01',
      asset_id: place.assetNorth,
      emptied: true,
    })
    expect(
      await one(
        `select title, deleted_at is not null as removed,
                (select count(*)::int from attachment_versions v where v.attachment_id = a.id) as versions,
                (select count(*)::int from files f where f.sha256 = $2) as files
           from attachments a where a.id = $1`,
        [defect.photo, defect.file],
      ),
    ).toEqual({
      title: 'Gelöscht nach Ablauf der Aufbewahrung',
      removed: true,
      versions: 0,
      files: 0,
    })
    expect(await logged('defects', defect.id)).toBe(before)
  })

  it('is neither proposed nor emptied before five years, nor by whoever does not lead', async () => {
    const defect = await remediedDefect(place.assetNorth, '2022-03-01')
    const old = await remediedDefect(place.assetNorth, '2019-03-01')

    expect(
      (await proposals('u-lead')).body.defects.map(
        (proposal: { defectId: string }) => proposal.defectId,
      ),
    ).not.toContain(defect.id)
    expect((await emptyDefects('u-lead', [defect.id])).status).toBe(409)
    expect((await emptyDefects('u-duties', [old.id])).status).toBe(403)
    expect(
      await refusalOf(
        'u-duties',
        sql`insert into defect_emptyings (tenant_id, property_id, area_id, defect_id, confirmed_by)
            select tenant_id, property_id, area_id, id, 'u-duties' from defects where id = ${old.id}`,
      ),
    ).toBe('HT008')
    expect(await one('select description from defects where id = $1', [old.id])).toEqual({
      description: 'Tür im Keller bei Frau Huber schleift',
    })
  })

  it('is not changed any more once emptied, and loses its content on no other way', async () => {
    const defect = await remediedDefect(place.assetNorth, '2019-06-01')
    const other = await remediedDefect(place.assetNorth, '2019-06-01')

    expect((await emptyDefects('u-lead', [defect.id])).status).toBe(201)
    expect(
      await refusalOf(
        'u-lead',
        sql`update defects set description = 'Wieder da' where id = ${defect.id}`,
      ),
    ).toBe('HT010')
    expect(
      await refusalOf('u-lead', sql`update defects set emptied_at = now() where id = ${other.id}`),
    ).toBe('HT010')
  })

  it('takes its day of being remedied from its status', async () => {
    const { id } = await one<{ id: string }>(
      `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on)
       select tenant_id, property_id, area_id, id, 'Leuchte defekt', '2026-10-01' from assets where id = $1
       returning id`,
      [place.assetNorth],
    )

    expect(
      await refusalOf(
        'u-duties',
        sql`update defects set remedied_on = '2001-01-01' where id = ${id}`,
      ),
    ).toBe('written')
    expect(await one('select remedied_on from defects where id = $1', [id])).toEqual({
      remedied_on: null,
    })
    expect(
      await refusalOf(
        'u-duties',
        sql`update defects set status = 'remedied', remedied_on = '2001-01-01' where id = ${id}`,
      ),
    ).toBe('written')
    expect(
      await one(
        `select remedied_on = (now() at time zone 'Europe/Berlin')::date as today from defects where id = $1`,
        [id],
      ),
    ).toEqual({ today: true })
  })
})

describe('the pass of the deadlines', () => {
  it('removes a task a year after it was done and keeps every other, and counts what went', async () => {
    const task = async (status: string, doneOn: string | null) =>
      (
        await one<{ id: string }>(
          `insert into tasks (tenant_id, property_id, area_id, title, due_on, assignee_user_id, status, done_on)
           select tenant_id, id, area_id, 'Schlüssel bei Frau Huber holen', '2024-01-01', 'u-site', $2, $3
             from properties where id = $1
           returning id`,
          [place.property, status, doneOn],
        )
      ).id
    const old = await task('done', '2024-05-01')
    const young = await task('done', '2026-05-01')
    const open = await task('open', null)

    await admin.query(
      `insert into deadlines (tenant_id, kind, source_id, source_label, anchor_on, due_on, meter_property_id,
                              property_id, area_id, task_id)
       select tenant_id, 'meter.due', id, 'Zähler', '2024-01-01', '2027-01-01', id, id, area_id, $2
         from properties where id = $1`,
      [place.property, old],
    )

    const named = await namedTasks('u-lead')
    const removed = await removeAfterRetention(database, tenant)

    expect(removed.task).toBe(1)
    // A device that holds every task pulls them again and lets the one go.
    expect(await namedTasks('u-lead')).not.toBe(named)
    expect(
      (await admin.query('select id from tasks where id = any($1)', [[old, young, open]])).rows
        .map((row) => row.id)
        .sort(),
    ).toEqual([young, open].sort())
    expect(
      await one('select task_id from deadlines where source_id = $1', [place.property]),
    ).toEqual({ task_id: null })
    expect(
      await one(
        `select removed_count from retention_removals where kind = 'task' order by created_at desc`,
      ),
    ).toEqual({ removed_count: 1 })
  })

  it('removes no task for a person, before its year or while open', async () => {
    const { id } = await one<{ id: string }>(
      `insert into tasks (tenant_id, property_id, area_id, title, due_on, assignee_user_id, status, done_on)
       select tenant_id, id, area_id, 'Alt', '2020-01-01', 'u-site', 'done', '2020-05-01'
         from properties where id = $1
       returning id`,
      [place.property],
    )
    const { id: young } = await one<{ id: string }>(
      `insert into tasks (tenant_id, property_id, area_id, title, due_on, assignee_user_id, status, done_on)
       select tenant_id, id, area_id, 'Jung', '2026-01-01', 'u-site', 'done', '2026-09-01'
         from properties where id = $1
       returning id`,
      [place.property],
    )

    expect(await refusalOf('u-lead', sql`delete from tasks where id = ${id}`)).toBe('HT009')
    expect(await refusalOf('the pass', sql`delete from tasks where id = ${young}`)).toBe('HT009')
    // Nobody is not yet the pass of the deadlines (#542).
    expect(await refusalOf(null, sql`delete from tasks where id = ${id}`)).toBe('HT009')
    expect(await refusalOf('the pass', sql`delete from tasks where id = ${id}`)).toBe('written')
  })

  it('lets the person at a reading go three years after it and keeps the reading', async () => {
    const meter = await one<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
       select tenant_id, property_id, area_id, building_id, 'probe.meter', 'Zähler Nord' from assets where id = $1
       returning id`,
      [place.assetNorth],
    )
    const reading = async (on: string) =>
      (
        await one<{ id: string }>(
          `insert into meter_readings (tenant_id, property_id, area_id, asset_id, key_date, read_on, value_milli,
                                       source, recorded_by)
           select tenant_id, property_id, area_id, id, $2, $2, 1000, 'by_hand', 'u-site' from assets where id = $1
           returning id`,
          [meter.id, on],
        )
      ).id
    const old = await reading('2023-01-01')
    const young = await reading('2025-01-01')
    const before = await logged('meter_readings', old)

    expect(
      await refusalOf(
        'u-lead',
        sql`update meter_readings set recorded_by = null where id = ${old}`,
      ),
    ).toBe('HT005')
    expect(
      await refusalOf(
        'the pass',
        sql`update meter_readings set recorded_by = null where id = ${young}`,
      ),
    ).toBe('HT005')
    // Nobody is not yet the pass of the deadlines (#542).
    expect(
      await refusalOf(null, sql`update meter_readings set recorded_by = null where id = ${old}`),
    ).toBe('HT005')
    // Any other column the application may not even write.
    expect(
      await refusalOf(
        null,
        sql`update meter_readings set recorded_by = null, value_milli = 2000 where id = ${old}`,
      ),
    ).toBe('42501')

    const removed = await removeAfterRetention(database, tenant)

    expect(removed.reading_person).toBe(1)
    expect(
      await one('select recorded_by, updated_by, value_milli from meter_readings where id = $1', [
        old,
      ]),
    ).toEqual({ recorded_by: null, updated_by: null, value_milli: '1000' })
    expect(await one('select recorded_by from meter_readings where id = $1', [young])).toEqual({
      recorded_by: 'u-site',
    })
    // The log does not copy the person once more.
    expect(await logged('meter_readings', old)).toBe(before)
  })

  it('lets the person at a booking and at a material go three years after it and keeps both', async () => {
    const order = await one<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title)
       select tenant_id, property_id, area_id, id, 'work_order', 'Dichtung tauschen' from assets where id = $1
       returning id`,
      [place.assetNorth],
    )
    const material = await one<{ id: string }>(
      `insert into work_order_materials (tenant_id, property_id, area_id, activity_id, activity_kind, store_id,
                                         article_id, quantity_milli, taken_at, taken_by)
       select a.tenant_id, a.property_id, a.area_id, a.id, 'work_order', s.id, r.id, 1000, '2023-02-01', 'u-site'
         from activities a, stores s, articles r where a.id = $1 and s.tenant_id = a.tenant_id and r.tenant_id = a.tenant_id
       returning id`,
      [order.id],
    )
    const booking = await one<{ id: string }>(
      `insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, booked_by, booked_at)
       select s.tenant_id, s.id, r.id, 'receipt', 5000, 'u-site', '2023-02-01'
         from stores s, articles r where s.tenant_id = $1 and r.tenant_id = $1
       returning id`,
      [tenant],
    )
    const young = await one<{ id: string }>(
      `insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, booked_by, booked_at)
       select s.tenant_id, s.id, r.id, 'receipt', 5000, 'u-site', '2025-02-01'
         from stores s, articles r where s.tenant_id = $1 and r.tenant_id = $1
       returning id`,
      [tenant],
    )

    expect(
      await refusalOf(
        'u-lead',
        sql`update stock_movements set booked_by = null where id = ${booking.id}`,
      ),
    ).toBe('HT005')
    expect(
      await refusalOf(
        'the pass',
        sql`update stock_movements set booked_by = null where id = ${young.id}`,
      ),
    ).toBe('HT005')
    // Nobody is not yet the pass of the deadlines (#542).
    expect(
      await refusalOf(
        null,
        sql`update stock_movements set booked_by = null where id = ${booking.id}`,
      ),
    ).toBe('HT005')
    expect(
      await refusalOf(
        null,
        sql`update work_order_materials set taken_by = null where id = ${material.id}`,
      ),
    ).toBe('HT005')
    expect(
      await refusalOf(
        'u-lead',
        sql`update work_order_materials set taken_by = null where id = ${material.id}`,
      ),
    ).toBe('HT005')

    const removed = await removeAfterRetention(database, tenant)

    expect(removed.booking_person).toBe(2)
    expect(
      await one('select booked_by, quantity_milli from stock_movements where id = $1', [
        booking.id,
      ]),
    ).toEqual({ booked_by: null, quantity_milli: 5000 })
    expect(
      await one('select taken_by, quantity_milli from work_order_materials where id = $1', [
        material.id,
      ]),
    ).toEqual({ taken_by: null, quantity_milli: 1000 })
    expect(await one('select booked_by from stock_movements where id = $1', [young.id])).toEqual({
      booked_by: 'u-site',
    })
  })
})

describe('the years', () => {
  it('are those of the law in the database, as the domain names them', async () => {
    const other = newId<'tenant'>()
    const years = await database.forTenant(
      { tenantId: other as TenantId, reason: 'probe' },
      async (tx) =>
        Object.fromEntries(
          await Promise.all(
            recordRetentionKinds.map(async (kind) => [
              kind,
              Number(
                (
                  await tx.execute<{ years: number }>(
                    sql`select public.record_retention_years(${kind}) as years`,
                  )
                ).rows[0]?.years,
              ),
            ]),
          ),
        ),
    )

    expect(years).toEqual(recordRetentionYears)
  })

  it('are lengthened by the operator and never shortened', async () => {
    const shortened = await http()
      .put('/settings/record-retention')
      .set(testIdentityHeader, by('u-lead'))
      .send({ activity: 2, defect: null, task: null, reading_person: null, booking_person: null })

    expect(shortened.status).toBe(400)
    expect(
      await refusalOf(
        'u-lead',
        sql`insert into record_retention_settings (tenant_id, activity_years) values (${tenant}, 2)`,
      ),
    ).toBe('23514')

    const lengthened = await http()
      .put('/settings/record-retention')
      .set(testIdentityHeader, by('u-lead'))
      .send({ activity: 10, defect: null, task: 2, reading_person: null, booking_person: null })

    expect(lengthened.status).toBe(200)
    expect(lengthened.body).toEqual({
      activity: 10,
      defect: null,
      task: 2,
      reading_person: null,
      booking_person: null,
    })

    // An activity ended in 2019 is now kept to the end of 2029.
    const id = await closedInspection(place.assetNorth, '2019-05-01', 'Länger aufbewahrt')

    expect((await emptyActivities('u-lead', [id])).status).toBe(409)

    await http().put('/settings/record-retention').set(testIdentityHeader, by('u-lead')).send({
      activity: null,
      defect: null,
      task: null,
      reading_person: null,
      booking_person: null,
    })
  })
})
