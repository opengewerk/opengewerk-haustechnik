import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityDetails,
  catalogueOf,
  type IsoDate,
  type RoleKey,
  shippedRoles,
  type StatedRetention,
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
import { stateFingerprint } from '../evidence/fingerprint.js'
import { deviceScope, pullScope } from '../sync/device-scope.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The activity behind an evidence deleted after the end of its retention
 * (#409, section 2.6 of the concept): with its last evidence it becomes an
 * empty shell, its signatures, names and documents go, and the change log
 * does not copy them; while an evidence of it remains, it stays as it is; on
 * every other way the database refuses to empty it, and once it is a shell
 * it takes nothing new. A device that held it lets go.
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
const folder = mkdtempSync(join(tmpdir(), 'activity-emptying-'))

const ended: StatedRetention = {
  kind: 'years',
  years: 2,
  rule: 'probe_retention',
  on: '2020-01-01' as IsoDate,
}

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

async function count(table: string, column: string, id: string): Promise<number> {
  return Number(
    (
      await admin.query<{ n: string }>(`select count(*) as n from ${table} where ${column} = $1`, [
        id,
      ])
    ).rows[0]?.n,
  )
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

/** An evidence of a duty in an activity, put in past the application, whose retention ended. */
async function evidenceOf(dutyId: string, activityId: string, performedOn: string) {
  const number = nextEvidenceNumber()
  const state = {
    ...leastState(number, performedOn as IsoDate, 'without_defects'),
    retention: ended,
  }

  return (
    await one<{ id: string }>(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, activity_id, performed_on, result,
                             number, origin, examiner, examiner_organisation, written_by, state, fingerprint)
       select tenant_id, property_id, area_id, id, $2, $3, 'without_defects', $4, 'report',
              'Erika Muster', 'Prüfstelle Süd', 'u-duties', $5, $6
         from duties where id = $1
       returning id`,
      [dutyId, activityId, performedOn, number, JSON.stringify(state), stateFingerprint(state)],
    )
  ).id
}

/**
 * A work order at the northern asset with everything an activity holds: its
 * duty with a remark, an answer, a signature, a participant, a note, material,
 * the decision, a service report with its record and PDF, a briefing and a
 * permit of a contractor, a document, its PDF, and a defect found at the
 * answer; with one evidence whose retention ended.
 */
async function workOrder(title: string) {
  const { id } = await one<{ id: string }>(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status, performed_on,
                             responsible_user_id, performer, performer_user_id)
     select tenant_id, property_id, area_id, id, 'work_order', $2, 'done', '2020-03-14',
            'u-lead', 'own_staff', 'u-duties'
       from assets where id = $1
     returning id`,
    [place.assetNorth, title],
  )
  const of = `select tenant_id, property_id, area_id, id from activities where id = '${id}'`
  const order = await one<{ id: string }>(
    `insert into work_orders (tenant_id, property_id, area_id, activity_id, activity_kind, number, kind, measure, urgency)
     select tenant_id, property_id, area_id, id, 'work_order', $2, 'other', 'repair', 'normal'
       from activities where id = $1
     returning id`,
    [id, `A-409-${title.length}`],
  )

  await admin.query(
    `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result, remark)
     select tenant_id, property_id, area_id, id, $2, 'without_defects', 'Rückfrage bei Herrn Maier'
       from activities where id = $1`,
    [id, duty.north],
  )
  // The answer before the signature: after it, none changes.
  const answer = await one<{ id: string }>(
    `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, value)
     select tenant_id, property_id, area_id, id, 'note', 'Herr Maier war vor Ort' from (${of}) a
     returning id`,
  )
  const signature = await one<{ id: string }>(
    `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role, signed_at,
                                      typed_name, page_fingerprint)
     select tenant_id, property_id, area_id, id, 'u-duties', 'signer', now(), 'Jörg Albrecht', $1 from (${of}) a
     returning id`,
    ['b'.repeat(64)],
  )

  await admin.query(
    `insert into work_order_participants (tenant_id, property_id, area_id, activity_id, activity_kind, user_id)
     select tenant_id, property_id, area_id, id, 'work_order', 'u-site' from (${of}) a`,
  )
  await admin.query(
    `insert into work_order_notes (tenant_id, property_id, area_id, activity_id, activity_kind, text, written_at, written_by)
     select tenant_id, property_id, area_id, id, 'work_order', 'Schlüssel bei Frau Huber', now(), 'u-duties' from (${of}) a`,
  )
  await admin.query(
    `insert into work_order_materials (tenant_id, property_id, area_id, activity_id, activity_kind, store_id, article_id,
                                       quantity_milli, taken_at, taken_by)
     select a.tenant_id, a.property_id, a.area_id, a.id, 'work_order', s.id, r.id, 1000, now(), 'u-duties'
       from (${of}) a, stores s, articles r where s.tenant_id = a.tenant_id and r.tenant_id = a.tenant_id`,
  )
  await admin.query(
    `insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision, decided_by, decided_at)
     select tenant_id, property_id, area_id, id, 'accepted', 'u-lead', now() from work_orders where id = $1`,
    [order.id],
  )
  await admin.query(
    `insert into briefings (tenant_id, property_id, area_id, activity_id, contractor_id, person_name, subject, path,
                            signed_by, signed_at)
     select a.tenant_id, a.property_id, a.area_id, a.id, c.id, 'Karl Gast', 'Einweisung in den Keller', 'M1,1L2,2',
            'u-duties', now()
       from (${of}) a, contractors c where c.tenant_id = a.tenant_id`,
  )
  await admin.query(
    `insert into work_permits (tenant_id, property_id, area_id, activity_id, contractor_id, form_key, form_version,
                               answers, signed_by, signed_at)
     select a.tenant_id, a.property_id, a.area_id, a.id, c.id, 'probe.permit', 1, '{"wer": "Karl Gast"}', 'u-duties', now()
       from (${of}) a, contractors c where c.tenant_id = a.tenant_id`,
  )
  const report = await one<{ id: string }>(
    `insert into service_reports (tenant_id, property_id, area_id, activity_id, client_name, path, signed_by,
                                  signed_at, page_fingerprint)
     select tenant_id, property_id, area_id, id, 'Herr Maier', 'M1,1L2,2', 'u-duties', now(), $1 from (${of}) a
     returning id`,
    ['c'.repeat(64)],
  )

  await admin.query(
    `insert into service_report_records (tenant_id, property_id, area_id, service_report_id, state, fingerprint)
     select tenant_id, property_id, area_id, id, '{"client": "Herr Maier"}', $2 from service_reports where id = $1`,
    [report.id, 'd'.repeat(64)],
  )
  await admin.query(
    `insert into prints (tenant_id, property_id, area_id, service_report_id, sha256)
     select tenant_id, property_id, area_id, id, $2 from service_reports where id = $1`,
    [report.id, 'e'.repeat(64)],
  )
  await admin.query(
    `insert into prints (tenant_id, property_id, area_id, activity_id, sha256)
     select tenant_id, property_id, area_id, id, $1 from (${of}) a`,
    ['e'.repeat(64)],
  )
  const document = await one<{ id: string }>(
    `insert into attachments (tenant_id, property_id, area_id, activity_id, title)
     select tenant_id, property_id, area_id, id, 'Foto vom Keller bei Herrn Maier' from (${of}) a
     returning id`,
  )
  // A version of it, and its file, which nothing else names.
  const file = document.id.replaceAll('-', '').repeat(2)
  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type)
     select tenant_id, $2, 1, 'image/jpeg' from attachments where id = $1`,
    [document.id, file],
  )
  await admin.query(
    `insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type, size_bytes)
     select tenant_id, id, $2, 'keller-maier.jpg', 'image/jpeg', 1 from attachments where id = $1`,
    [document.id, file],
  )
  const defect = await one<{ id: string }>(
    `insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id, found_in_answer_id,
                          description, found_on, status)
     select tenant_id, property_id, area_id, asset_id, id, $2, 'Dichtung porös', '2020-03-14', 'found'
       from activities where id = $1
     returning id`,
    [id, answer.id],
  )
  const proof = await evidenceOf(duty.north, id, '2020-03-14')

  return {
    id,
    order: order.id,
    answer: answer.id,
    signature: signature.id,
    report: report.id,
    document: document.id,
    file,
    defect: defect.id,
    proof,
  }
}

/** What a transaction of a person is told when it writes this. */
async function refusalOf(userId: string, statement: ReturnType<typeof sql>): Promise<unknown> {
  try {
    await database.forTenant({ tenantId: tenant, userId }, (tx) => tx.execute(statement))
  } catch (error) {
    return (
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code
    )
  }

  return 'written'
}

function empty(userId: string, evidenceIds: readonly string[]) {
  return http()
    .post('/settings/evidence-retention/emptyings')
    .set(testIdentityHeader, by(userId))
    .send({ evidenceIds })
}

/** What a device of a person names the answers by, at a pull. */
async function namedAnswers(userId: string): Promise<string | undefined> {
  return database.forTenant({ tenantId: tenant, userId }, async (tx) => {
    const scope = pullScope(await deviceScope(tx, userId), { holds: () => true })

    return scope.narrowed?.['activity_answers']
  })
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
  // Whoever leads in the south sees the south alone.
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

  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 2048, 'application/pdf')`,
    [tenant, 'e'.repeat(64)],
  )
  await admin.query(`insert into stores (tenant_id, name) values ($1, 'Lager Nord')`, [tenant])
  await admin.query(
    `insert into articles (tenant_id, number, designation, unit) values ($1, 'ART-1', 'Dichtung', 'piece')`,
    [tenant],
  )
  await admin.query(`insert into contractors (tenant_id, name) values ($1, 'Fremdfirma Nord')`, [
    tenant,
  ])
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('the activity behind an evidence deleted after the end of its retention (#409)', () => {
  it('becomes an empty shell with its last evidence: no signature, no name, no document', async () => {
    const order = await workOrder('Pumpe tauschen, Herr Maier meldet')
    const before = {
      activity: await logged('activities', order.id),
      signature: await logged('activity_signatures', order.signature),
      answer: await logged('activity_answers', order.answer),
    }

    expect((await empty('u-lead', [order.proof]).expect(201)).body).toEqual({ emptied: 1 })

    expect(
      await one(
        `select kind, status, performed_on::text, emptied_at is not null as emptied, title, closing_reason,
                responsible_user_id, performer, performer_user_id, contractor_note, contractor_id
           from activities where id = $1`,
        [order.id],
      ),
    ).toEqual({
      kind: 'work_order',
      status: 'done',
      performed_on: '2020-03-14',
      emptied: true,
      title: 'Gelöscht nach Ablauf der Aufbewahrung',
      closing_reason: null,
      responsible_user_id: null,
      performer: 'own_staff',
      performer_user_id: null,
      contractor_note: null,
      contractor_id: null,
    })
    expect(
      await one('select result, remark from activity_duties where activity_id = $1', [order.id]),
    ).toEqual({ result: 'without_defects', remark: null })
    expect(
      await one('select number, measure from work_orders where id = $1', [order.order]),
    ).toEqual({
      number: expect.stringMatching(/^A-409-/),
      measure: 'repair',
    })

    for (const [table, column, id] of [
      ['activity_answers', 'activity_id', order.id],
      ['activity_signatures', 'activity_id', order.id],
      ['work_order_participants', 'activity_id', order.id],
      ['work_order_notes', 'activity_id', order.id],
      ['work_order_materials', 'activity_id', order.id],
      ['work_order_decisions', 'work_order_id', order.order],
      ['briefings', 'activity_id', order.id],
      ['work_permits', 'activity_id', order.id],
      ['service_reports', 'activity_id', order.id],
      ['service_report_records', 'service_report_id', order.report],
      ['prints', 'activity_id', order.id],
      ['prints', 'service_report_id', order.report],
    ] as const) {
      expect(`${table}: ${await count(table, column, id)}`).toBe(`${table}: 0`)
    }

    // Its document goes for good (opengewerk/opengewerk#658): a shell under the
    // title of the emptying, without its version and without the file nothing
    // else names.
    expect(
      await one('select title, deleted_at is not null as removed from attachments where id = $1', [
        order.document,
      ]),
    ).toEqual({ title: 'Gelöscht nach Ablauf der Aufbewahrung', removed: true })
    expect(await count('attachment_versions', 'attachment_id', order.document)).toBe(0)
    expect(
      await one('select count(*)::int as files from files where sha256 = $1', [order.file]),
    ).toEqual({ files: 0 })
    // A defect found in it keeps its own content, and loses the answer it was found at.
    expect(
      await one(
        'select description, found_in_activity_id, found_in_answer_id from defects where id = $1',
        [order.defect],
      ),
    ).toEqual({
      description: 'Dichtung porös',
      found_in_activity_id: order.id,
      found_in_answer_id: null,
    })

    // What went is not copied into the change log.
    expect(await logged('activities', order.id)).toBe(before.activity)
    expect(await logged('activity_signatures', order.signature)).toBe(before.signature)
    expect(await logged('activity_answers', order.answer)).toBe(before.answer)

    // The page says what stays of it, for every kind, and so do its list and its own page.
    const page = (
      await http().get(`/activities/${order.id}`).set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as ActivityDetails

    expect(page).toMatchObject({
      emptied: true,
      shell: { orderNumber: expect.stringMatching(/^A-409-/) },
      responsible: null,
      performerPerson: null,
    })
    expect(page.shell?.evidence.map((each) => each.id)).toEqual([order.proof])
    expect(
      (
        await http()
          .get(`/work-orders/${order.id}`)
          .set(testIdentityHeader, by('u-lead'))
          .expect(200)
      ).body,
    ).toMatchObject({ emptied: true, notes: [], signatures: [], decisions: [], materials: [] })
  })

  it('stays as it is while an evidence of it remains, and goes with the last, in every area', async () => {
    const { id: round } = await one<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, area_from_property_id, kind, title, status, performed_on)
       select tenant_id, id, area_id, id, 'round', 'Rundgang mit Herrn Maier', 'done', '2020-05-04'
         from properties where id = $1
       returning id`,
      [place.property],
    )

    await admin.query(
      `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, value)
       select tenant_id, property_id, area_id, id, 'note', 'Tür klemmt, sagt Herr Maier' from activities where id = $1`,
      [round],
    )
    await admin.query(
      `insert into round_records (tenant_id, property_id, area_id, activity_id, state, fingerprint)
       select tenant_id, property_id, area_id, id, '{"walker": "Herr Maier"}', $2 from activities where id = $1`,
      [round, 'f'.repeat(64)],
    )

    const north = await evidenceOf(duty.north, round, '2020-05-04')
    const south = await evidenceOf(duty.south, round, '2020-05-04')

    await empty('u-lead', [north]).expect(201)

    // One evidence of it remains: nothing of it goes.
    expect(await one('select emptied_at from activities where id = $1', [round])).toEqual({
      emptied_at: null,
    })
    expect(await count('activity_answers', 'activity_id', round)).toBe(1)
    expect(await count('round_records', 'activity_id', round)).toBe(1)

    // The last, confirmed by whoever leads in the south and does not see the
    // round in the north: it goes with it all the same.
    await empty('u-south', [south]).expect(201)

    expect(
      await one('select emptied_at is not null as emptied from activities where id = $1', [round]),
    ).toEqual({
      emptied: true,
    })
    expect(await count('activity_answers', 'activity_id', round)).toBe(0)
    expect(await count('round_records', 'activity_id', round)).toBe(0)
    expect(
      (await http().get(`/rounds/${round}`).set(testIdentityHeader, by('u-lead')).expect(200)).body,
    ).toMatchObject({ emptied: true })
    expect(
      (await http().get(`/rounds/${round}/pdf`).set(testIdentityHeader, by('u-lead')).expect(404))
        .body.message,
    ).toBe('Dieser Rundgang ist nach Ablauf der Aufbewahrung gelöscht; ein PDF gibt es nicht mehr.')
  })

  it('empties a collective activity with the last evidence of its parts, and its signature with it (#342)', async () => {
    const { id: collective } = await one<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, area_from_property_id, kind, title, status,
                               collective_kind)
       select tenant_id, id, area_id, id, 'inspection', 'Sichtkontrolle mit Herrn Maier', 'done', 'probe.sight_check'
         from properties where id = $1
       returning id`,
      [place.property],
    )
    const parts: string[] = []
    const duties: string[] = []

    for (const label of ['Sichtkontrolle Tür', 'Sichtkontrolle Rahmen']) {
      const { id: dutyId } = await one<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note, counting,
                             interval_months, confirmed_by)
         select tenant_id, property_id, area_id, id, $2, 'own_decision', 'Hausordnung', 'from_performance', 12,
                'u-duties'
           from assets where id = $1
         returning id`,
        [place.assetNorth, label],
      )
      const { id: part } = await one<{ id: string }>(
        `with part as (
           insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status, performed_on,
                                   collective_id)
           select tenant_id, property_id, area_id, id, 'inspection', $2, 'done', '2020-05-04', $3
             from assets where id = $1
           returning id, tenant_id, property_id, area_id
         ), line as (
           insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result)
           select tenant_id, property_id, area_id, id, $4, 'without_defects' from part
         )
         select id from part`,
        [place.assetNorth, label, collective, dutyId],
      )

      parts.push(part)
      duties.push(dutyId)
    }

    // The one signature stands at the collective activity, with the name of whoever signed.
    await admin.query(
      `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role, signed_at,
                                        typed_name, page_fingerprint)
       select tenant_id, property_id, area_id, id, 'u-site', 'signer', now(), 'u-site', $2 from activities
        where id = $1`,
      [collective, 'd'.repeat(64)],
    )

    const first = await evidenceOf(duties[0] as string, parts[0] as string, '2020-05-04')
    const second = await evidenceOf(duties[1] as string, parts[1] as string, '2020-05-04')
    const emptied = async (id: string) =>
      (
        await one<{ emptied: boolean }>(
          'select emptied_at is not null as emptied from activities where id = $1',
          [id],
        )
      ).emptied

    await empty('u-lead', [first]).expect(201)

    // The first part goes with its evidence; the collective activity waits for the last of its parts.
    expect([await emptied(parts[0] as string), await emptied(collective)]).toEqual([true, false])
    expect(await count('activity_signatures', 'activity_id', collective)).toBe(1)

    await empty('u-lead', [second]).expect(201)

    expect([await emptied(parts[1] as string), await emptied(collective)]).toEqual([true, true])
    expect(await count('activity_signatures', 'activity_id', collective)).toBe(0)
    expect(await one('select title from activities where id = $1', [collective])).toEqual({
      title: 'Gelöscht nach Ablauf der Aufbewahrung',
    })
  })

  it('is emptied on no other way, also not by the owner of the tables', async () => {
    const order = await workOrder('Heizung entlüften')
    const deleted = (table: string, column = 'activity_id', id = order.id) =>
      sql.raw(`delete from ${table} where ${column} = '${id}'`)

    expect(await refusalOf('u-lead', deleted('activity_signatures'))).toBe('HT005')
    expect(await refusalOf('u-lead', deleted('activity_answers'))).toBe('HT007')
    expect(await refusalOf('u-lead', deleted('work_order_participants'))).toBe('HT010')
    expect(await refusalOf('u-lead', deleted('work_order_notes'))).toBe('HT005')
    expect(await refusalOf('u-lead', deleted('work_order_materials'))).toBe('HT005')
    expect(
      await refusalOf('u-lead', deleted('work_order_decisions', 'work_order_id', order.order)),
    ).toBe('HT005')
    expect(await refusalOf('u-lead', deleted('briefings'))).toBe('HT005')
    expect(await refusalOf('u-lead', deleted('work_permits'))).toBe('HT005')
    expect(
      await refusalOf(
        'u-lead',
        deleted('service_report_records', 'service_report_id', order.report),
      ),
    ).toBe('HT005')
    expect(await refusalOf('u-lead', deleted('service_reports'))).toBe('HT005')
    expect(await refusalOf('u-lead', deleted('prints'))).toBe('HT005')
    expect(
      await refusalOf(
        'u-lead',
        sql.raw(`update activities set emptied_at = now(), title = 'Gelöscht nach Ablauf der Aufbewahrung',
                        responsible_user_id = null, performer_user_id = null where id = '${order.id}'`),
      ),
    ).toBe('HT010')
    // Its document goes for good with it and at no other time
    // (opengewerk/opengewerk#658), neither as a whole nor version by version.
    expect(
      await refusalOf('u-lead', sql`select purge_attachment(${order.document}::uuid, 'weg')`),
    ).toBe('OG001')
    expect(
      await refusalOf('u-lead', deleted('attachment_versions', 'attachment_id', order.document)),
    ).toBe('OG001')

    await expect(
      admin.query('delete from activity_signatures where activity_id = $1', [order.id]),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query('delete from work_order_participants where activity_id = $1', [order.id]),
    ).rejects.toMatchObject({ code: 'HT010' })
    await expect(
      admin.query('update activities set emptied_at = now() where id = $1', [order.id]),
    ).rejects.toMatchObject({ code: 'HT010' })

    expect(await count('activity_signatures', 'activity_id', order.id)).toBe(1)
    expect(await count('activity_answers', 'activity_id', order.id)).toBe(1)
    expect(await count('attachment_versions', 'attachment_id', order.document)).toBe(1)
  })

  it('takes nothing new once it is a shell, and is not changed any more', async () => {
    const order = await workOrder('Rohr dämmen')

    await empty('u-lead', [order.proof]).expect(201)

    expect(
      await refusalOf(
        'u-lead',
        sql.raw(`insert into work_order_notes (tenant_id, property_id, area_id, activity_id, activity_kind, text,
                                               written_at, written_by)
                 select tenant_id, property_id, area_id, id, 'work_order', 'Noch etwas', now(), 'u-lead'
                   from activities where id = '${order.id}'`),
      ),
    ).toBe('HT010')
    expect(
      await refusalOf(
        'u-lead',
        sql.raw(`insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, value)
                 select tenant_id, property_id, area_id, id, 'note', 'Noch etwas' from activities where id = '${order.id}'`),
      ),
    ).toBe('HT010')
    expect(
      await refusalOf(
        'u-lead',
        sql.raw(`insert into attachments (tenant_id, property_id, area_id, activity_id, title)
                 select tenant_id, property_id, area_id, id, 'Noch ein Foto' from activities where id = '${order.id}'`),
      ),
    ).toBe('HT010')
    expect(
      await refusalOf(
        'u-lead',
        sql.raw(
          `update activities set title = 'Rohr dämmen bei Herrn Maier' where id = '${order.id}'`,
        ),
      ),
    ).toBe('HT010')
    await expect(
      admin.query(`update activities set responsible_user_id = 'u-lead' where id = $1`, [order.id]),
    ).rejects.toMatchObject({ code: 'HT010' })
  })

  it('lets go on the devices that held it', async () => {
    const order = await workOrder('Ventil prüfen')
    const held = await namedAnswers('u-lead')

    await empty('u-lead', [order.proof]).expect(201)

    const after = await namedAnswers('u-lead')

    expect(after).not.toBe(held)
    expect(after).toMatch(/:emptied-[0-9a-f]{16}$/)
    // A pull of the activity itself carries the shell.
    expect(
      await database.forTenant(
        { tenantId: tenant, userId: 'u-lead' },
        async (tx) =>
          pullScope(await deviceScope(tx, 'u-lead'), { holds: () => true }).narrowed?.[
            'activities'
          ],
      ),
    ).not.toMatch(/emptied/)
  })
})
