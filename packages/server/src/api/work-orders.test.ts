import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityId,
  addDays,
  catalogueOf,
  type IsoDate,
  missingRight,
  type RoleKey,
  shippedRoles,
  type TenantId,
  type WorkOrderCandidates,
  type WorkOrderDetails,
  type WorkOrderList,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { pageFingerprint, pageOf, takeSignature } from '../activities/signing.js'
import { activities } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The work orders in the office (#117, #73, section 4.8 of the concept): the
 * list "Aufträge", the page of an order, a new one from a defect, from the
 * due day of a duty or by hand, its change, and its acceptance or rejection.
 *
 * Whoever plans and hands out work makes an order and names the person who
 * leads it and the further people, among those who perform and see its
 * area. Whoever only performs sees the orders given to them, worked on by
 * them or given to nobody, in the office as on their device. The defect an
 * order comes of follows the order: ordered, set right with the signature,
 * ordered again when the order is turned back. An accepted order for a due
 * day writes the evidence of its duty.
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
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

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const inDays = (days: number): IsoDate => addDays(today, days)

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the operators. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** A property with a building and an elevator in it, made by the Technische Leitung; the ids of the asset and the property. */
async function elevatorIn(
  tenantId: TenantId = small,
  area: string | null = null,
): Promise<{ readonly asset: string; readonly property: string }> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: 'Bürgerhaus Mitte',
    street: 'Marktplatz 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...(area === null ? {} : { areaId: area }),
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Bürgerhaus',
    kinds: ['school'],
  })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
  })

  return { asset, property }
}

/** A defect at an asset, reported in the office. */
async function defectAt(asset: string, tenantId: TenantId = small): Promise<string> {
  return (
    await http()
      .post('/defects')
      .set(testIdentityHeader, by('u-site', tenantId))
      .send({ assetId: asset, description: 'Notausgangstür klemmt.', foundOn: today })
      .expect(201)
  ).body.id
}

/** The main test of the elevator from the catalogue, at most every 24 months. */
async function mainTestAt(asset: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, maximum_months, confirmed_by)
     select tenant_id, property_id, area_id, id, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24,
            'u-duties'
       from assets where id = $1
     returning id`,
    [asset],
  )

  return rows[0]?.id ?? ''
}

/** A duty of the operator's own at an asset, which takes every way of evidence, every month. */
async function ownDutyAt(asset: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     select tenant_id, property_id, area_id, id, 'Türen im Fluchtweg prüfen', 'own_decision',
            'Hausordnung', 'from_performance', 1, 'u-duties'
       from assets where id = $1
     returning id`,
    [asset],
  )

  return rows[0]?.id ?? ''
}

/** What every new order of these tests says, beside where it comes from. */
const plan = {
  title: 'Notausgangstür gängig machen',
  kind: 'defect_remedy',
  urgency: 'urgent',
  dueOn: inDays(10),
  responsibleUserId: 'u-tech',
  participantUserIds: ['u-other'],
}

/** A new work order, as somebody sends it; the answer for the test to expect. */
function order(header: string, body: object) {
  return http().post('/work-orders').set(testIdentityHeader, header).send(body)
}

/** A new work order that is made: its page. */
async function made(body: object, header: string = by('u-site')): Promise<WorkOrderDetails> {
  return (await order(header, body).expect(201)).body as WorkOrderDetails
}

/** The page of a work order, as somebody reads it. */
async function pageOfOrder(id: string, header: string = by('u-lead')): Promise<WorkOrderDetails> {
  return (await http().get(`/work-orders/${id}`).set(testIdentityHeader, header).expect(200))
    .body as WorkOrderDetails
}

/** A page of the list, as somebody asks it. */
async function listed(header: string, address = ''): Promise<WorkOrderList> {
  return (await http().get(`/work-orders${address}`).set(testIdentityHeader, header).expect(200))
    .body as WorkOrderList
}

/** How a defect stands, and the order it names. */
async function defectRow(
  id: string,
): Promise<{ readonly status: string; readonly remedy_work_order_id: string | null }> {
  const { rows } = await admin.query<{ status: string; remedy_work_order_id: string | null }>(
    'select status, remedy_work_order_id from defects where id = $1',
    [id],
  )

  return rows[0] ?? { status: 'none', remedy_work_order_id: null }
}

/**
 * The work on an order done and signed by the person who leads it, as the
 * device does it: the day it was performed, then the signature for the page
 * the server works out.
 */
async function signed(
  activityId: string,
  userId = 'u-tech',
  tenantId: TenantId = small,
): Promise<void> {
  await admin.query("update activities set status = 'started', performed_on = $2 where id = $1", [
    activityId,
    today,
  ])
  await database.forTenant({ tenantId, userId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(activities)
      .where(eq(activities.id, activityId as ActivityId))

    if (row === undefined) {
      throw new Error('No such activity')
    }

    await takeSignature(
      tx,
      {
        tenantId,
        writtenBy: userId,
        at: new Date(),
        catalogue,
        nameOf: (id) => people[id]?.name ?? 'Unbekanntes Konto',
      },
      {
        activityId: row.id,
        role: 'signer',
        signedAt: new Date(),
        deviceInfo: 'Probe-Telefon',
        path: 'M10,10L200,300',
        pageFingerprint: pageFingerprint(await pageOf(tx, row)),
      },
    )
  })
}

/** A decision on an order, as somebody sends it. */
function decide(id: string, header: string, body: object) {
  return http().post(`/work-orders/${id}/decision`).set(testIdentityHeader, header).send(body)
}

/** The rows of a kind of record a device of somebody is sent. */
async function pulled(header: string, entity: string): Promise<Record<string, unknown>[]> {
  const answer = await http().get('/sync?since=0').set(testIdentityHeader, header).expect(200)
  const change = (
    answer.body.changes as { entity: string; rows: Record<string, unknown>[] }[]
  ).find((each) => each.entity === entity)

  return change?.rows ?? []
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

  // The roles each operator starts with, which say who may plan and who
  // performs, as the rows of a real operator do.
  for (const tenantId of [small, large]) {
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
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
      ])
    }
  }

  // In the large operator the Objektleitung and two technicians work in the
  // north, the third technician in the south.
  for (const [userId, area] of [
    ['u-site', north],
    ['u-tech', north],
    ['u-other', north],
    ['u-gone', north],
    ['u-south', south],
  ] as const) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [large, userId, area],
    )
  }

  // One technician has left both operators.
  await admin.query("update memberships set blocked_at = now() where user_id = 'u-gone'")

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a new work order', () => {
  it('from a defect takes its place, draws a number, and orders the defect', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)
    const page = await made({ ...plan, origin: 'defect', defectId: defect })

    expect(page).toMatchObject({
      number: expect.stringMatching(/^AU-\d{4}-\d{4}$/),
      title: 'Notausgangstür gängig machen',
      kind: 'defect_remedy',
      urgency: 'urgent',
      status: 'open',
      rejected: false,
      dueOn: inDays(10),
      assetId: asset,
      responsible: { userId: 'u-tech', name: 'Tobias Wendt' },
      participants: [{ userId: 'u-other', name: 'Lena Vogt' }],
      origin: { kind: 'defect', defectId: defect, description: 'Notausgangstür klemmt.' },
      signatures: [],
      decisions: [],
    })
    expect(await defectRow(defect)).toEqual({
      status: 'ordered',
      remedy_work_order_id: page.workOrderId,
    })

    // The defect is ordered: a second order of it is refused, and nothing is made.
    await order(by('u-site'), { ...plan, origin: 'defect', defectId: defect }).expect(
      409,
      /Ein Auftrag entsteht aus einem festgestellten Mangel/,
    )
    expect(
      (
        await admin.query(
          'select count(*)::int as n from work_orders where origin_defect_id = $1',
          [defect],
        )
      ).rows[0].n,
    ).toBe(1)
  })

  it('for the due day of a duty meets the duty, and none beside one under way', async () => {
    const { asset } = await elevatorIn()
    const duty = await ownDutyAt(asset)
    const page = await made({ ...plan, kind: 'inspection', origin: 'duty', dutyId: duty })

    expect(page).toMatchObject({
      kind: 'inspection',
      assetId: asset,
      origin: { kind: 'duty', dutyId: duty },
    })

    const { rows } = await admin.query<{ duty_id: string }>(
      'select duty_id from activity_duties where activity_id = $1',
      [page.id],
    )

    expect(rows).toEqual([{ duty_id: duty }])

    // The order is under way for the duty: neither a second order nor an
    // inspection by hand comes beside it.
    await order(by('u-site'), { ...plan, origin: 'duty', dutyId: duty }).expect(
      409,
      /Für diese Pflicht läuft schon ein Vorgang/,
    )
    await http()
      .post('/activities')
      .set(testIdentityHeader, by('u-site'))
      .send({ dutyId: duty })
      .expect(409)
  })

  it('for the due day of a duty whose kind takes no work order as its evidence is refused', async () => {
    const { asset } = await elevatorIn()
    const duty = await mainTestAt(asset)

    await order(by('u-site'), { ...plan, origin: 'duty', dutyId: duty }).expect(
      409,
      /Diese Pflichtart nimmt als Nachweis: Bericht einer Fremdfirma oder Prüforganisation. Ein Auftrag erfüllt sie nicht./,
    )
    expect(
      (
        await admin.query('select count(*)::int as n from activity_duties where duty_id = $1', [
          duty,
        ])
      ).rows[0].n,
    ).toBe(0)
  })

  it('by hand hangs on the place it names, on the property it names', async () => {
    const { asset, property } = await elevatorIn()
    const page = await made({ ...plan, kind: 'other', origin: 'hand', propertyId: property })

    expect(page).toMatchObject({
      propertyId: property,
      assetId: null,
      origin: { kind: 'hand' },
    })

    const elsewhere = await elevatorIn()

    await order(by('u-site'), {
      ...plan,
      origin: 'hand',
      propertyId: elsewhere.property,
      assetId: asset,
    }).expect(400, /Die Liegenschaft ist nicht die, auf der das Genannte steht/)
  })

  it('is made by whoever plans and hands out work, and not by whoever only performs', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)
    const refused = await order(by('u-tech'), {
      ...plan,
      origin: 'defect',
      defectId: defect,
    }).expect(403)

    expect(refused.body.message).toBe(missingRight('activity.write'))
    expect(await defectRow(defect)).toEqual({ status: 'found', remedy_work_order_id: null })
  })

  it('is led and worked on by people who perform and see its area, and nobody twice', async () => {
    const { asset } = await elevatorIn(large, north)
    const defect = await defectAt(asset, large)
    const send = (body: object) =>
      order(by('u-site', large), { ...plan, origin: 'defect', defectId: defect, ...body })

    // Somebody of the south, somebody who left, and the Objektleitung, who
    // performs as well and leads it.
    for (const responsibleUserId of ['u-south', 'u-gone']) {
      await send({ responsibleUserId }).expect(
        400,
        /Den Auftrag führt, wer Vorgänge ausführt und den Bereich sieht/,
      )
    }

    for (const participantUserIds of [['u-south'], ['u-gone']]) {
      await send({ participantUserIds }).expect(
        400,
        /Beteiligt ist, wer Vorgänge ausführt und den Bereich sieht/,
      )
    }

    await send({ participantUserIds: ['u-tech'] }).expect(
      400,
      /Wer den Auftrag führt, steht nicht noch einmal unter den Beteiligten/,
    )
    expect(await defectRow(defect)).toEqual({ status: 'found', remedy_work_order_id: null })

    const page = (await send({ responsibleUserId: 'u-site', participantUserIds: [] }).expect(201))
      .body as WorkOrderDetails

    expect(page.responsible?.userId).toBe('u-site')
  })

  it('offers the people who perform and see the area of the property', async () => {
    const { property } = await elevatorIn(large, north)
    const offered = (
      await http()
        .get(`/work-orders/candidates?property=${property}`)
        .set(testIdentityHeader, by('u-site', large))
        .expect(200)
    ).body as WorkOrderCandidates
    const names = offered.people.map((person) => person.userId)

    expect(names).toContain('u-tech')
    expect(names).toContain('u-other')
    expect(names).not.toContain('u-south')
    expect(names).not.toContain('u-gone')
    await http()
      .get(`/work-orders/candidates?property=${property}`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(403)
  })
})

describe('who sees a work order', () => {
  it('whoever only performs sees what they lead, work on, or what is given to nobody, in the office and on the device', async () => {
    const { asset } = await elevatorIn(large, north)
    const theirs = await made(
      { ...plan, origin: 'defect', defectId: await defectAt(asset, large) },
      by('u-site', large),
    )
    const other = await made(
      {
        ...plan,
        origin: 'defect',
        defectId: await defectAt(asset, large),
        responsibleUserId: 'u-site',
        participantUserIds: [],
      },
      by('u-site', large),
    )

    // Lena Vogt works on the first and has nothing to do with the second.
    const lena = by('u-other', large)
    const shown = (await listed(lena, '?state=all')).orders.map((each) => each.id)

    expect(shown).toContain(theirs.id)
    expect(shown).not.toContain(other.id)
    await pageOfOrder(theirs.id, lena)
    await http().get(`/work-orders/${other.id}`).set(testIdentityHeader, lena).expect(404)

    const held = (await pulled(lena, 'activities')).map((row) => row['id'])

    expect(held).toContain(theirs.id)
    expect(held).not.toContain(other.id)
    expect((await pulled(lena, 'work_order_participants')).map((row) => row['userId'])).toEqual([
      'u-other',
    ])
  })

  it('a further person taken off the order no longer sees it', async () => {
    const { asset } = await elevatorIn(large, north)
    const page = await made(
      { ...plan, origin: 'defect', defectId: await defectAt(asset, large) },
      by('u-site', large),
    )

    await http()
      .put(`/work-orders/${page.id}`)
      .set(testIdentityHeader, by('u-site', large))
      .send({ ...plan, participantUserIds: [] })
      .expect(200)

    const lena = by('u-other', large)

    await http().get(`/work-orders/${page.id}`).set(testIdentityHeader, lena).expect(404)
    expect((await pulled(lena, 'activities')).map((row) => row['id'])).not.toContain(page.id)
    expect(
      (
        await admin.query(
          'select deleted_at is not null as marked from work_order_participants where activity_id = $1',
          [page.id],
        )
      ).rows,
    ).toEqual([{ marked: true }])
  })
})

describe('the list "Aufträge"', () => {
  it('holds the open orders, those waiting and those accepted, narrowed by kind, area, asset and a search', async () => {
    const one = await elevatorIn(large, north)
    const two = await elevatorIn(large, south)
    const lead = by('u-lead', large)
    const remedy = await made(
      { ...plan, origin: 'defect', defectId: await defectAt(one.asset, large) },
      by('u-site', large),
    )
    const other = await made(
      {
        ...plan,
        kind: 'other',
        origin: 'hand',
        propertyId: two.property,
        responsibleUserId: 'u-south',
        participantUserIds: [],
      },
      lead,
    )

    await signed(remedy.id, 'u-tech', large)

    const open = await listed(lead, `?area=${north}`)

    expect(open.orders.map((each) => each.id)).toContain(remedy.id)
    expect(open.orders.map((each) => each.id)).not.toContain(other.id)
    expect(open.waiting).toBeGreaterThanOrEqual(1)

    const waiting = await listed(lead, '?state=waiting')

    expect(waiting.orders.every((each) => each.status === 'signed')).toBe(true)
    expect(waiting.orders.map((each) => each.id)).toContain(remedy.id)

    const kinds = await listed(lead, '?kind=other')

    expect(kinds.orders.map((each) => each.id)).toContain(other.id)
    expect(kinds.orders.map((each) => each.id)).not.toContain(remedy.id)

    const atTheAsset = await listed(lead, `?state=all&asset=${one.asset}`)

    expect(atTheAsset.orders.map((each) => each.id)).toEqual([remedy.id])

    const searched = await listed(lead, `?state=all&search=${String(remedy.number)}`)

    expect(searched.orders.map((each) => each.id)).toEqual([remedy.id])
    await http()
      .get('/work-orders?state=late')
      .set(testIdentityHeader, lead)
      .expect(400, /Der Stand ist einer von/)
  })
})

describe('changing a work order', () => {
  it('changes what it is, how urgent, the day and the people until it is signed', async () => {
    const { asset } = await elevatorIn()
    const page = await made({ ...plan, origin: 'defect', defectId: await defectAt(asset) })
    const change = (body: object) =>
      http()
        .put(`/work-orders/${page.id}`)
        .set(testIdentityHeader, by('u-site'))
        .send({ ...plan, ...body })
    const changed = (
      await change({
        title: 'Türschließer tauschen',
        kind: 'other',
        urgency: 'immediate',
        dueOn: inDays(2),
        responsibleUserId: 'u-other',
        participantUserIds: ['u-tech'],
      }).expect(200)
    ).body as WorkOrderDetails

    expect(changed).toMatchObject({
      title: 'Türschließer tauschen',
      kind: 'other',
      urgency: 'immediate',
      dueOn: inDays(2),
      responsible: { userId: 'u-other' },
      participants: [{ userId: 'u-tech' }],
    })

    await signed(page.id, 'u-other')
    await change({ responsibleUserId: 'u-other', participantUserIds: ['u-tech'] }).expect(
      409,
      /Geändert wird ein Auftrag, solange er offen oder begonnen ist/,
    )
    await http()
      .put(`/work-orders/${page.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .send(plan)
      .expect(403)
  })
})

describe('the defect of a work order follows it', () => {
  it('is set right with the signature, ordered again when the order is turned back, and set right with the next', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)
    const page = await made({ ...plan, origin: 'defect', defectId: defect })

    await signed(page.id)
    expect((await defectRow(defect)).status).toBe('remedied')

    const turned = (
      await decide(page.id, by('u-site'), {
        decision: 'rejected',
        reason: 'Die Tür schleift noch.',
      }).expect(201)
    ).body as WorkOrderDetails

    expect(turned).toMatchObject({
      status: 'started',
      rejected: true,
      signatures: [{ name: 'Tobias Wendt', role: 'signer', valid: false }],
      decisions: [
        { decision: 'rejected', reason: 'Die Tür schleift noch.', name: 'Petra Lindner' },
      ],
    })
    expect(await defectRow(defect)).toEqual({
      status: 'ordered',
      remedy_work_order_id: page.workOrderId,
    })
    // The list says so as well, until the order is signed anew.
    expect(
      (await listed(by('u-lead'), '?state=all')).orders.find((each) => each.id === page.id),
    ).toMatchObject({ status: 'started', rejected: true })

    await signed(page.id)
    expect((await defectRow(defect)).status).toBe('remedied')

    const accepted = (await decide(page.id, by('u-site'), { decision: 'accepted' }).expect(201))
      .body as WorkOrderDetails

    expect(accepted).toMatchObject({ status: 'done', rejected: false })
    expect(accepted.signatures.map((signature) => signature.valid)).toEqual([false, true])
    expect((await defectRow(defect)).status).toBe('remedied')
  })
})

describe('closing a work order with the reason', () => {
  it('is for whoever plans, before its signature, and finds its defect again', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)
    const page = await made({ ...plan, origin: 'defect', defectId: defect })
    const close = (header: string, body: object) =>
      http().post(`/work-orders/${page.id}/close`).set(testIdentityHeader, header).send(body)
    const reason = 'Doppelt angelegt.'

    const refused = await close(by('u-tech'), { closingReason: reason }).expect(403)

    expect(refused.body.message).toBe(missingRight('activity.write'))
    await close(by('u-site'), {}).expect(
      400,
      /Ein Vorgang, der nicht durchgeführt wurde, nennt den Grund/,
    )
    expect((await pageOfOrder(page.id)).status).toBe('open')

    const closed = (await close(by('u-site'), { closingReason: reason }).expect(201))
      .body as WorkOrderDetails

    expect(closed).toMatchObject({ status: 'not_performed', closingReason: reason })
    // The defect waits for a new order, and still names the old one until it gets it.
    expect(await defectRow(defect)).toEqual({
      status: 'found',
      remedy_work_order_id: page.workOrderId,
    })
    await close(by('u-site'), { closingReason: reason }).expect(
      409,
      /Geschlossen wird ein Auftrag, solange er offen oder begonnen ist/,
    )
    await made({ ...plan, origin: 'defect', defectId: defect })
  })

  it('leaves the due day of its duty as it is and gives the duty the reason', async () => {
    const { asset } = await elevatorIn()
    const duty = await ownDutyAt(asset)
    const page = await made({ ...plan, kind: 'inspection', origin: 'duty', dutyId: duty })

    await http()
      .post(`/work-orders/${page.id}/close`)
      .set(testIdentityHeader, by('u-site'))
      .send({ closingReason: 'Die Anlage ist stillgelegt.' })
      .expect(201)

    const { rows } = await admin.query<{ result: string; result_reason: string }>(
      'select result, result_reason from activity_duties where activity_id = $1',
      [page.id],
    )

    expect(rows).toEqual([
      { result: 'not_performed', result_reason: 'Die Anlage ist stillgelegt.' },
    ])
    expect(
      (await admin.query('select count(*)::int as n from evidence where duty_id = $1', [duty]))
        .rows[0].n,
    ).toBe(0)
    // Nothing runs for the duty any more: a new order for its due day can be made.
    await made({ ...plan, kind: 'inspection', origin: 'duty', dutyId: duty })
  })

  it('is not taken once the order is signed', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)
    const page = await made({ ...plan, origin: 'defect', defectId: defect })

    await signed(page.id)
    await http()
      .post(`/work-orders/${page.id}/close`)
      .set(testIdentityHeader, by('u-site'))
      .send({ closingReason: 'Zu spät.' })
      .expect(409)
    expect((await defectRow(defect)).status).toBe('remedied')
  })
})

describe('a defect found not set right', () => {
  it('waits for a new order, whatever becomes of the old one', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)
    const page = await made({ ...plan, origin: 'defect', defectId: defect })

    await signed(page.id)
    await http()
      .post(`/defects/${defect}/check`)
      .set(testIdentityHeader, by('u-site'))
      .send({ outcome: 'not_remedied', checkedOn: today, note: 'Die Tür klemmt weiter.' })
      .expect(201)
    expect((await defectRow(defect)).status).toBe('found')

    await decide(page.id, by('u-site'), {
      decision: 'rejected',
      reason: 'Die Tür klemmt weiter.',
    }).expect(201)
    expect(await defectRow(defect)).toEqual({
      status: 'found',
      remedy_work_order_id: page.workOrderId,
    })
  })
})

describe('the acceptance of a work order', () => {
  it('is for whoever accepts work orders, of a signed order, and a rejection names its reason', async () => {
    const { asset } = await elevatorIn()
    const page = await made({ ...plan, origin: 'defect', defectId: await defectAt(asset) })

    await decide(page.id, by('u-site'), { decision: 'accepted' }).expect(
      409,
      /Abgenommen oder zurückgewiesen wird ein unterschriebener Auftrag/,
    )
    await signed(page.id)

    const refused = await decide(page.id, by('u-tech'), { decision: 'accepted' }).expect(403)

    expect(refused.body.message).toBe(missingRight('activity.accept'))
    await decide(page.id, by('u-site'), { decision: 'rejected' }).expect(
      400,
      /Eine Zurückweisung nennt ihren Grund/,
    )
    await decide(page.id, by('u-site'), { decision: 'later' }).expect(
      400,
      /Ein Auftrag wird abgenommen oder zurückgewiesen/,
    )
    expect((await pageOfOrder(page.id)).status).toBe('signed')
  })

  it('of an order for a due day writes the evidence of its duty', async () => {
    const { asset } = await elevatorIn()
    const duty = await ownDutyAt(asset)
    const page = await made({ ...plan, kind: 'inspection', origin: 'duty', dutyId: duty })

    // What came of the duty, entered on site before the signature.
    await admin.query(
      "update activity_duties set result = 'without_defects' where activity_id = $1",
      [page.id],
    )
    await signed(page.id)
    expect(
      (await admin.query('select count(*)::int as n from evidence where duty_id = $1', [duty]))
        .rows[0].n,
    ).toBe(0)

    await decide(page.id, by('u-site'), { decision: 'accepted' }).expect(201)

    const { rows } = await admin.query<{ origin: string; activity_id: string }>(
      'select origin, activity_id from evidence where duty_id = $1',
      [duty],
    )

    expect(rows).toEqual([{ origin: 'work_order', activity_id: page.id }])
  })
})
