import { createHash } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityId,
  addDays,
  catalogueOf,
  type IsoDate,
  type RoleKey,
  type ServiceReportState,
  serviceReportPageOf,
  shippedRoles,
  type SyncValue,
  type TenantId,
  type Timeline,
  type WorkOrderDetails,
} from '@opengewerk/haustechnik-domain'
import { Database, type FileStorage, newId, type PrintJob } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { reportedMaterialsOf } from '../activities/materials.js'
import { pageFingerprint, pageOf } from '../activities/signing.js'
import { activities } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The service report of a work order (#324, section 4.8 of the concept): the
 * client signs on the device of whoever finishes the order, before the own
 * signature, also without a connection. The server takes it for the page the
 * device showed and from the person who leads the order only, one per order
 * until a rejection makes it invalid, and freezes it in the same transaction.
 * The PDF is made of the frozen state, without prices, and names the people
 * who did the work and the times of their notes only where the operator has
 * switched it on under "Einstellungen".
 */

const small = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  'u-other': { role: 'technician', name: 'Lena Vogt' },
}

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const inDays = (days: number): IsoDate => addDays(today, days)

/** What the renderer was handed, newest last; each answer is a PDF of its own. */
const rendered: PrintJob[] = []

/** The content addressed store, in memory. */
const kept = new Map<string, Uint8Array>()
const store: FileStorage = {
  put: (bytes) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    kept.set(sha256, bytes)

    return Promise.resolve({ sha256, sizeBytes: bytes.byteLength })
  },
  get: (sha256) => {
    const bytes = kept.get(sha256)

    return bytes === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(bytes)
  },
}

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people. */
function by(userId: keyof typeof people & string): string {
  return as(small, userId, people[userId]?.role as RoleKey)
}

let recorded = Date.parse('2026-10-05T06:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  entity: string,
  kind: 'create' | 'update',
  recordId: string,
  values: Readonly<Record<string, SyncValue>> = {},
) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind,
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

/** What became of each operation a device of somebody sends. */
async function outcomes(header: string, operations: readonly ReturnType<typeof operation>[]) {
  const answer = await http()
    .post('/sync')
    .set(testIdentityHeader, header)
    .send({ deviceId: 'phone', operations })
    .expect((answer) => {
      if (answer.status !== 201) {
        throw new Error(`${String(answer.status)} ${JSON.stringify(answer.body)}`)
      }
    })

  return (
    answer.body.receipts as { outcome: string; reason: string | null; fields: string[] }[]
  ).map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))
}

const applied = { outcome: 'applied', reason: null, fields: [] }

/** The page of an order as the server works it out now. */
async function pageNow(activityId: string) {
  return database.forTenant({ tenantId: small, userId: 'u-lead' }, async (tx) => {
    const [row] = await tx
      .select()
      .from(activities)
      .where(eq(activities.id, activityId as ActivityId))

    if (row === undefined) {
      throw new Error('No such activity')
    }

    return pageOf(tx, row)
  })
}

/**
 * The client's signature under the report of an order, as a device sends it:
 * for the page as it stands, with the name and the setting the device holds.
 */
async function reportFor(
  activityId: string,
  clientName = 'Petra Lang',
  namesAndTimes = false,
  id: string = newId<'service-report'>(),
) {
  return operation('service_reports', 'create', id, {
    activityId,
    clientName,
    path: 'M10,10L200,300',
    signedAt: new Date().toISOString(),
    deviceInfo: 'Probe-Telefon',
    pageFingerprint: stateFingerprint(
      serviceReportPageOf(
        await pageNow(activityId),
        clientName,
        namesAndTimes,
        await database.forTenant({ tenantId: small, userId: 'u-lead' }, (tx) =>
          reportedMaterialsOf(tx, activityId as ActivityId),
        ),
      ),
    ),
  })
}

/** The signature of the person who leads the order, for the page as it stands. */
async function signatureFor(activityId: string) {
  return operation('activity_signatures', 'create', newId<'activity-signature'>(), {
    activityId,
    role: 'signer',
    signedAt: new Date().toISOString(),
    deviceInfo: 'Probe-Telefon',
    path: 'M10,10L200,300',
    pageFingerprint: pageFingerprint(await pageNow(activityId)),
  })
}

/** The page of a work order, as the Leitung reads it. */
async function pageOfOrder(id: string): Promise<WorkOrderDetails> {
  return (await http().get(`/work-orders/${id}`).set(testIdentityHeader, by('u-lead')).expect(200))
    .body as WorkOrderDetails
}

/** The frozen states of the reports of an order, the first first. */
async function frozen(activityId: string): Promise<ServiceReportState[]> {
  const { rows } = await admin.query<{ state: ServiceReportState }>(
    `select r.state from service_report_records r join service_reports s on s.id = r.service_report_id
      where s.activity_id = $1 order by r.created_at, r.id`,
    [activityId],
  )

  return rows.map((row) => row.state)
}

/** Whether names and times stand on the report, as the Leitung sets it. */
function setNamesAndTimes(on: boolean, header = by('u-lead')) {
  return http()
    .put('/settings/work-orders')
    .set(testIdentityHeader, header)
    .send({ namesAndTimes: on })
}

/**
 * A work order led by Tobias Wendt with Lena Vogt, begun on site today, with
 * a note of each and the time spent; the ids of the order and its asset.
 */
async function begun(): Promise<{ readonly id: string; readonly asset: string }> {
  const header = by('u-duties')
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: 'Bürgerhaus Mitte',
    street: 'Marktplatz 2',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Bürgerhaus',
    kinds: ['school'],
  })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
  })
  const order = (
    await http()
      .post('/work-orders')
      .set(testIdentityHeader, by('u-site'))
      .send({
        title: 'Notausgangstür gängig machen',
        kind: 'other',
        measure: 'repair',
        urgency: 'normal',
        dueOn: inDays(10),
        responsibleUserId: 'u-tech',
        participantUserIds: ['u-other'],
        origin: 'hand',
        propertyId: property,
        assetId: asset,
      })
      .expect(201)
  ).body as WorkOrderDetails

  await admin.query("update activities set status = 'started', performed_on = $2 where id = $1", [
    order.id,
    today,
  ])
  expect(
    await outcomes(by('u-other'), [
      operation('work_order_notes', 'create', newId<'work-order-note'>(), {
        activityId: order.id,
        text: 'Türblatt ausgehängt, Scharniere geschmiert.',
        writtenAt: '2026-10-05T06:55:00.000Z',
      }),
    ]),
  ).toEqual([applied])
  expect(
    await outcomes(by('u-tech'), [
      operation('work_order_notes', 'create', newId<'work-order-note'>(), {
        activityId: order.id,
        text: 'Schließblech nachgestellt, Panikschloss geprüft.',
        writtenAt: '2026-10-05T07:40:00.000Z',
      }),
      operation('work_orders', 'update', order.workOrderId, { durationMinutes: 45 }),
    ]),
  ).toEqual([applied, applied])

  return { id: order.id, asset }
}

function pdfOf(report: string, header = by('u-lead')) {
  return http()
    .get(`/service-reports/${report}/pdf`)
    .set(testIdentityHeader, header)
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        done(null, Buffer.concat(chunks))
      })
    })
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [small, 'Wohnbau Nord eG'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [small, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      small,
      userId,
      [person.role],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        files: store,
        renderer: (job) => {
          rendered.push(job)

          return Promise.resolve(new TextEncoder().encode(`%PDF probe ${String(rendered.length)}`))
        },
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the settings of the work orders', () => {
  it('are off until the Leitung switches names and times on, and only the Leitung changes them', async () => {
    expect(
      (await http().get('/settings/work-orders').set(testIdentityHeader, by('u-lead')).expect(200))
        .body,
    ).toEqual({ namesAndTimes: false })

    await setNamesAndTimes(true, by('u-duties')).expect(403)
    await http().get('/settings/work-orders').set(testIdentityHeader, by('u-duties')).expect(403)
    await setNamesAndTimes(true).expect(200, { namesAndTimes: true })
    await setNamesAndTimes('ja' as unknown as boolean).expect(400)
    expect(
      (await http().get('/settings/work-orders').set(testIdentityHeader, by('u-lead')).expect(200))
        .body,
    ).toEqual({ namesAndTimes: true })
    await setNamesAndTimes(false).expect(200)
  })
})

describe('the service report of a work order', () => {
  it('is taken from the device of the person who leads the order, in their name, and frozen without names and times', async () => {
    const { id } = await begun()
    const report = newId<'service-report'>()
    // Material from the store, of an article with a price (#326): the report
    // names it, and never its price.
    const made = async (path: string, body: object): Promise<string> =>
      (await http().post(path).set(testIdentityHeader, by('u-site')).send(body).expect(201)).body
        .id as string
    const store = await made('/stores', { name: 'Hauptlager Betriebshof' })
    const article = await made('/articles', {
      number: 'A-1060',
      designation: 'Türschließer-Gleitschiene',
      unit: 'piece',
      priceCents: 1290,
    })

    expect(
      await outcomes(by('u-tech'), [
        operation('work_order_materials', 'create', newId<'work-order-material'>(), {
          activityId: id,
          storeId: store,
          articleId: article,
          quantityMilli: 2000,
          takenAt: '2026-10-05T07:10:00.000Z',
        }),
      ]),
    ).toEqual([applied])
    expect(
      await outcomes(by('u-tech'), [await reportFor(id, 'Petra Lang', false, report)]),
    ).toEqual([applied])

    const { rows } = await admin.query<{ signed_by: string; client_name: string }>(
      'select signed_by, client_name from service_reports where id = $1',
      [report],
    )

    expect(rows).toEqual([{ signed_by: 'u-tech', client_name: 'Petra Lang' }])

    const [state] = await frozen(id)

    expect(state).toMatchObject({
      workOrder: { title: 'Notausgangstür gängig machen', kind: 'other' },
      work: [
        { text: 'Türblatt ausgehängt, Scharniere geschmiert.' },
        { text: 'Schließblech nachgestellt, Panikschloss geprüft.' },
      ],
      durationMinutes: 45,
      materials: [{ quantityMilli: 2000, unit: 'piece', designation: 'Türschließer-Gleitschiene' }],
      client: { name: 'Petra Lang', path: 'M10,10L200,300', signedOn: today },
      namesAndTimes: false,
      holder: 'Tobias Wendt',
    })
    // Nobody who did the work and no time of theirs: not who wrote a note,
    // not when, not the moment of the client's signature.
    expect(state?.work.every((entry) => !('writtenBy' in entry) && !('writtenAt' in entry))).toBe(
      true,
    )
    expect(state?.client).not.toHaveProperty('signedAt')
    expect(JSON.stringify(state)).not.toContain('Lena Vogt')

    // The page of the order names the report, and the timeline of its asset.
    const page = await pageOfOrder(id)

    expect(page.serviceReports).toEqual([
      expect.objectContaining({
        id: report,
        clientName: 'Petra Lang',
        holder: 'Tobias Wendt',
        valid: true,
        voidedAt: null,
      }),
    ])

    const before = rendered.length

    await pdfOf(report).expect(200).expect('Content-Type', 'application/pdf')
    expect(rendered).toHaveLength(before + 1)

    // What the page says, without the typeface it carries.
    const html = (rendered.at(-1)?.html ?? '').replace(/<style>[\s\S]*?<\/style>/g, '')

    expect(html).toContain('Leistungsnachweis')
    expect(html).toContain('Petra Lang')
    expect(html).toContain('2 Stück Türschließer-Gleitschiene')
    expect(html).not.toContain('Lena Vogt')
    expect(html).not.toMatch(/\d{2}:\d{2}/)
    // No price, in the page or in what it was made of.
    expect(html).not.toMatch(/€|Preis|EUR|12,90/)
    expect(JSON.stringify(state)).not.toMatch(/price|preis|€|1290/i)
  })

  it('names who wrote each note and when, and the moment the client signed, once the Leitung switched it on', async () => {
    const { id } = await begun()

    await setNamesAndTimes(true).expect(200)

    try {
      // A page shown before the setting changed is not the one the server works out.
      expect(await outcomes(by('u-tech'), [await reportFor(id, 'Petra Lang', false)])).toEqual([
        { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['pageFingerprint'] },
      ])

      const report = newId<'service-report'>()

      expect(
        await outcomes(by('u-tech'), [await reportFor(id, 'Petra Lang', true, report)]),
      ).toEqual([applied])

      const [state] = await frozen(id)

      expect(state).toMatchObject({
        namesAndTimes: true,
        work: [
          { writtenBy: 'Lena Vogt', writtenAt: '2026-10-05T06:55:00.000Z' },
          { writtenBy: 'Tobias Wendt', writtenAt: '2026-10-05T07:40:00.000Z' },
        ],
      })
      expect(state?.client.signedAt).toEqual(expect.any(String))

      await pdfOf(report).expect(200)
      expect(rendered.at(-1)?.html).toContain('Lena Vogt')
    } finally {
      await setNamesAndTimes(false).expect(200)
    }
  })

  it('is taken only from the person who leads the order, for the page the server works out, and once while it counts', async () => {
    const { id } = await begun()

    // Lena Vogt works on the order and does not finish it, so she takes no report.
    expect(await outcomes(by('u-other'), [await reportFor(id)])).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['activityId'] },
    ])

    // A page shown before a note came is not the one the server works out.
    const shown = await reportFor(id)

    expect(
      await outcomes(by('u-other'), [
        operation('work_order_notes', 'create', newId<'work-order-note'>(), {
          activityId: id,
          text: 'Noch ein Wort.',
          writtenAt: '2026-10-05T08:00:00.000Z',
        }),
      ]),
    ).toEqual([applied])
    expect(await outcomes(by('u-tech'), [shown])).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['pageFingerprint'] },
    ])

    // Without the name in block letters, or without the drawing, it is not one.
    const unnamed = await reportFor(id, '   ')

    await http()
      .post('/sync')
      .set(testIdentityHeader, by('u-tech'))
      .send({ deviceId: 'phone', operations: [unnamed] })
      .expect(400)

    expect(await outcomes(by('u-tech'), [await reportFor(id)])).toEqual([applied])
    // One per order: a second one while the first counts is a conflict.
    expect(await outcomes(by('u-tech'), [await reportFor(id, 'Jonas Albrecht')])).toEqual([
      { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['activityId'] },
    ])
    expect(await frozen(id)).toHaveLength(1)
  })

  it('is no longer taken once the order is signed', async () => {
    const { id } = await begun()

    expect(await outcomes(by('u-tech'), [await signatureFor(id)])).toEqual([applied])
    expect(await outcomes(by('u-tech'), [await reportFor(id)])).toEqual([
      { outcome: 'conflict', reason: 'record_is_fixed', fields: ['status'] },
    ])
  })

  it('becomes invalid with a rejection of the order, stays readable, and a new one is taken after it', async () => {
    const { id } = await begun()
    const first = newId<'service-report'>()

    expect(await outcomes(by('u-tech'), [await reportFor(id, 'Petra Lang', false, first)])).toEqual(
      [applied],
    )
    expect(await outcomes(by('u-tech'), [await signatureFor(id)])).toEqual([applied])

    const bytes = (await pdfOf(first).expect(200)).body as Buffer
    const printed = rendered.length

    // What changes afterwards does not change the PDF: the title, the time
    // spent, the setting.
    await admin.query("update activities set title = 'Anders benannt' where id = $1", [id])
    await admin.query('update work_orders set duration_minutes = 90 where activity_id = $1', [id])
    await setNamesAndTimes(true).expect(200)
    await setNamesAndTimes(false).expect(200)
    expect(Buffer.compare((await pdfOf(first).expect(200)).body as Buffer, bytes)).toBe(0)
    expect(rendered).toHaveLength(printed)
    await admin.query(
      "update activities set title = 'Notausgangstür gängig machen' where id = $1",
      [id],
    )
    await admin.query('update work_orders set duration_minutes = 45 where activity_id = $1', [id])

    await http()
      .post(`/work-orders/${id}/decision`)
      .set(testIdentityHeader, by('u-site'))
      .send({ decision: 'rejected', reason: 'Die Tür schleift noch.' })
      .expect(201)

    const turnedBack = await pageOfOrder(id)

    expect(turnedBack.serviceReports).toEqual([
      expect.objectContaining({ id: first, valid: false, voidedAt: expect.any(String) }),
    ])

    // Printed once more, with the rejection on it.
    await pdfOf(first).expect(200)
    expect(rendered).toHaveLength(printed + 1)
    expect(rendered.at(-1)?.html).toContain('Ungültig: der Auftrag wurde am')

    // The next time the order is finished, a new one comes about.
    const second = newId<'service-report'>()

    expect(
      await outcomes(by('u-tech'), [await reportFor(id, 'Jonas Albrecht', false, second)]),
    ).toEqual([applied])
    expect((await pageOfOrder(id)).serviceReports).toEqual([
      expect.objectContaining({ id: first, valid: false }),
      expect.objectContaining({ id: second, valid: true, voidedAt: null }),
    ])
  })

  it('stands on the timeline of its asset, and on the device of the people who work on the order', async () => {
    const { id, asset } = await begun()

    expect(await outcomes(by('u-tech'), [await reportFor(id)])).toEqual([applied])

    const timeline = (
      await http()
        .get(`/overview/timeline?asset=${asset}`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as Timeline

    expect(timeline.events).toContainEqual(
      expect.objectContaining({ kind: 'service_report', subject: expect.objectContaining({ id }) }),
    )

    const pulled = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, by('u-other'))
      .expect(200)
    const changes = pulled.body.changes as { entity: string; rows: Record<string, unknown>[] }[]

    expect(
      changes
        .find((change) => change.entity === 'service_reports')
        ?.rows.map((row) => row['activityId']),
    ).toContain(id)
    expect(changes.map((change) => change.entity)).toContain('work_order_settings')
    // The frozen state does not travel.
    expect(changes.map((change) => change.entity)).not.toContain('service_report_records')
  })

  it('and its frozen state are changed and removed by no role, the owner of the tables included', async () => {
    const { id } = await begun()

    expect(await outcomes(by('u-tech'), [await reportFor(id)])).toEqual([applied])

    await expect(
      admin.query(
        "update service_reports set client_name = 'Jemand anders' where activity_id = $1",
        [id],
      ),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query('delete from service_reports where activity_id = $1', [id]),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query(
        `update service_report_records set fingerprint = repeat('0', 64)
          where service_report_id in (select id from service_reports where activity_id = $1)`,
        [id],
      ),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query(
        `delete from service_report_records
          where service_report_id in (select id from service_reports where activity_id = $1)`,
        [id],
      ),
    ).rejects.toMatchObject({ code: 'HT005' })
  })
})
