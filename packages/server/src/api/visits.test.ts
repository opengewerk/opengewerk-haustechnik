import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type CatalogueEntry,
  catalogueOf,
  type ContractorVisits,
  hotWorkPermitForm,
  type IsoDate,
  type PackagedForm,
  type RoleKey,
  shippedRoles,
  type SyncValue,
  type TenantId,
  type WorkOrderDetails,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * A contractor at work at a work order (section 4.11 of the concept, #330):
 * the order names the firm of the list, whoever leads it or plans and hands
 * out work briefs a person of the firm on the device and issues the permit
 * for hot work in the form of the package Brandschutz, and the office reads
 * both at the order and at the firm. Neither is changed afterwards, the
 * database included, and a permit is read in the version of its form it was
 * made in.
 */

const small = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  'u-other': { role: 'technician', name: 'Lena Vogt' },
}

const today = dayInGermany()

/** The permit for hot work in two versions: one long in force, and the one in force from today. */
function permitVersion(
  version: number,
  validFrom: IsoDate,
  place: string,
): CatalogueEntry<PackagedForm> {
  return {
    key: hotWorkPermitForm,
    version,
    validFrom,
    definition: {
      title: 'Erlaubnisschein für feuergefährliche Arbeiten',
      sections: [
        {
          key: 'work',
          title: 'Arbeiten',
          fields: [
            { kind: 'text', key: 'place', label: place, required: true },
            {
              kind: 'choice',
              key: 'combustibles',
              label: 'Brennbares im Umkreis entfernt oder abgedeckt',
              required: true,
              options: [
                { value: 'done', label: 'Erledigt' },
                { value: 'not_needed', label: 'Entfällt' },
              ],
            },
          ],
        },
        {
          key: 'end',
          title: 'Ausführende Person',
          fields: [
            {
              kind: 'signature',
              key: 'contractor_signature',
              label: 'Unterschrift der ausführenden Person',
              required: true,
            },
          ],
        },
      ],
    },
    review: { checkedOn: today, accepted: null },
  }
}

const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: probeCatalogueBundle.packages.map((pack, index) =>
    index === 0
      ? {
          ...pack,
          forms: [
            ...pack.forms,
            permitVersion(1, '2020-01-01' as IsoDate, 'Arbeitsort'),
            permitVersion(2, today, 'Arbeitsort, so genau wie möglich'),
          ],
        }
      : pack,
  ),
})

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people. */
function by(userId: keyof typeof people & string): string {
  return as(small, userId, people[userId]?.role as RoleKey)
}

let recorded = Date.parse('2026-10-05T06:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(entity: string, recordId: string, values: Readonly<Record<string, SyncValue>>) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'create' as const,
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

/** A transmission the server refuses whole, with the sentence it gives. */
async function refused(header: string, operations: readonly ReturnType<typeof operation>[]) {
  const answer = await http()
    .post('/sync')
    .set(testIdentityHeader, header)
    .send({ deviceId: 'phone', operations })
    .expect(400)

  return String(answer.body.message)
}

const applied = { outcome: 'applied', reason: null, fields: [] }
const elsewhere = { outcome: 'conflict', reason: 'changed_elsewhere', fields: ['activityId'] }

/** A briefing as a device sends it. */
function briefingOf(
  activityId: string,
  contractorId: string,
  more: Readonly<Record<string, SyncValue>> = {},
) {
  return operation('briefings', newId<'briefing'>(), {
    activityId,
    contractorId,
    personName: 'Marco Petri',
    subject: 'Fluchtwege, Brandmeldeanlage im Heizraum, Absperrung der Gasleitung',
    path: 'M10,10L200,300',
    signedAt: new Date().toISOString(),
    deviceInfo: 'Probe-Telefon',
    ...more,
  })
}

/** The answers of a permit in the version 1, with the signature of whoever carries the work out. */
const permitAnswers = {
  place: 'Heizraum, Rücklauf Heizkreis Turnhalle',
  combustibles: 'done',
  contractor_signature: {
    name: 'Marco Petri',
    path: 'M10,10L200,300',
    signedAt: '2026-10-16T06:00:00.000Z',
  },
}

/** A permit as a device sends it. */
function permitOf(
  activityId: string,
  contractorId: string,
  more: Readonly<Record<string, SyncValue>> = {},
) {
  return operation('work_permits', newId<'work-permit'>(), {
    activityId,
    contractorId,
    formKey: hotWorkPermitForm,
    formVersion: 1,
    answers: JSON.stringify(permitAnswers),
    signedAt: new Date().toISOString(),
    deviceInfo: 'Probe-Telefon',
    ...more,
  })
}

let property = ''

/** A firm of the list, as the office makes it. */
async function firm(name: string): Promise<string> {
  return (
    await http()
      .post('/contractors')
      .set(testIdentityHeader, by('u-lead'))
      .send({ name })
      .expect(201)
  ).body.id
}

/**
 * A work order of the Objektleitung, led by Tobias Wendt and carried out by
 * a firm of the list where one is named, begun on site.
 */
async function begun(contractorId: string | null): Promise<WorkOrderDetails> {
  const order = (
    await http()
      .post('/work-orders')
      .set(testIdentityHeader, by('u-site'))
      .send({
        title: 'Undichte Lötstelle am Heizungsrücklauf instand setzen',
        kind: 'other',
        measure: 'repair',
        urgency: 'normal',
        dueOn: addDays(today, 10),
        responsibleUserId: 'u-tech',
        participantUserIds: [],
        origin: 'hand',
        propertyId: property,
        ...(contractorId === null ? {} : { contractorId }),
      })
      .expect(201)
  ).body as WorkOrderDetails

  await admin.query("update activities set status = 'started' where id = $1", [order.id])

  return order
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
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  property = (
    await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-lead'))
      .send({
        name: 'Schulzentrum Am Lindenhain',
        street: 'Lindenweg 4',
        postalCode: '68535',
        city: 'Edingen-Neckarhausen',
        federalState: 'DE-BW',
      })
      .expect(201)
  ).body.id
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a work order', () => {
  it('names the firm of the list that carries it out, which the office sets and takes back', async () => {
    const heating = await firm('Heizungsbau Beispiel GmbH')
    const order = await begun(heating)

    expect(order.contractorId).toBe(heating)

    const { rows } = await admin.query<{ performer: string; contractor_id: string | null }>(
      'select performer, contractor_id from activities where id = $1',
      [order.id],
    )

    expect(rows).toEqual([{ performer: 'contractor', contractor_id: heating }])

    const plan = {
      title: order.title,
      kind: 'other',
      measure: 'repair',
      urgency: 'normal',
      dueOn: order.dueOn,
      responsibleUserId: 'u-tech',
      participantUserIds: [],
    }
    // Left out, the firm stays; null gives the order back to the own people.
    const kept = await http()
      .put(`/work-orders/${order.id}`)
      .set(testIdentityHeader, by('u-site'))
      .send(plan)
      .expect(200)

    expect((kept.body as WorkOrderDetails).contractorId).toBe(heating)

    const own = await http()
      .put(`/work-orders/${order.id}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ ...plan, contractorId: null })
      .expect(200)

    expect((own.body as WorkOrderDetails).contractorId).toBeNull()
    expect(
      (
        await admin.query<{ performer: string }>('select performer from activities where id = $1', [
          order.id,
        ])
      ).rows,
    ).toEqual([{ performer: 'own_staff' }])

    // A firm that is not one of the list is none.
    await http()
      .put(`/work-orders/${order.id}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ ...plan, contractorId: newId<'contractor'>() })
      .expect(400)
  })
})

describe('a briefing and a permit for hot work', () => {
  it('is taken on the device of whoever leads the order or plans and hands out work, in the name of the account', async () => {
    const heating = await firm('Heizungsbau Rhein GmbH')
    const other = await firm('Brandschutz Beispiel GmbH')
    const order = await begun(heating)

    // Whoever leads the order briefs, and the server writes the account.
    expect(
      await outcomes(by('u-tech'), [briefingOf(order.id, heating), permitOf(order.id, heating)]),
    ).toEqual([applied, applied])
    // So does whoever plans and hands out work.
    expect(await outcomes(by('u-site'), [briefingOf(order.id, heating)])).toEqual([applied])

    const { rows } = await admin.query<{ signed_by: string }>(
      `select signed_by from briefings where activity_id = $1
       union all select signed_by from work_permits where activity_id = $1 order by 1`,
      [order.id],
    )

    expect(rows.map((row) => row.signed_by)).toEqual(['u-site', 'u-tech', 'u-tech'])

    // Somebody else of the Haustechnik does neither.
    expect(
      await outcomes(by('u-other'), [briefingOf(order.id, heating), permitOf(order.id, heating)]),
    ).toEqual([elsewhere, elsewhere])
    // The firm is the one the order names, which the office may have changed meanwhile.
    expect(await outcomes(by('u-tech'), [briefingOf(order.id, other)])).toEqual([elsewhere])

    // An order of the own people has nobody to brief.
    const own = await begun(null)

    expect(await outcomes(by('u-tech'), [briefingOf(own.id, heating)])).toEqual([elsewhere])

    // Without a name, a subject or a drawing it is no briefing.
    expect(await refused(by('u-tech'), [briefingOf(order.id, heating, { personName: '  ' })])).toBe(
      'Der Name der eingewiesenen Person in Druckschrift fehlt.',
    )
    expect(await refused(by('u-tech'), [briefingOf(order.id, heating, { subject: '' })])).toBe(
      'Worin die Person eingewiesen wurde, fehlt.',
    )

    // Once the order is signed, it is too late.
    await admin.query("update activities set status = 'signed' where id = $1", [order.id])

    const late = await outcomes(by('u-tech'), [briefingOf(order.id, heating)])

    expect(late[0]?.outcome).toBe('conflict')
    expect(
      (await admin.query('select id from briefings where activity_id = $1', [order.id])).rows,
    ).toHaveLength(2)
  })

  it('are changed and removed by no role, the owner of the tables included', async () => {
    const heating = await firm('Heizungsbau Neckar GmbH')
    const order = await begun(heating)

    expect(
      await outcomes(by('u-tech'), [briefingOf(order.id, heating), permitOf(order.id, heating)]),
    ).toEqual([applied, applied])

    for (const table of ['briefings', 'work_permits']) {
      await expect(
        admin.query(`update ${table} set signed_at = now() where activity_id = $1`, [order.id]),
      ).rejects.toMatchObject({ code: 'HT005' })
      await expect(
        admin.query(`delete from ${table} where activity_id = $1`, [order.id]),
      ).rejects.toMatchObject({ code: 'HT005' })
      // The application may not even ask.
      await expect(
        database.forTenant({ tenantId: small, userId: 'u-lead' }, (tx) =>
          tx.execute(`update ${table} set device_info = 'anders'`),
        ),
      ).rejects.toThrow()
    }
  })
})

describe('a permit for hot work', () => {
  it('is issued only with every field its form asks for, the signature of whoever carries the work out among them', async () => {
    const heating = await firm('Heizungsbau Main GmbH')
    const order = await begun(heating)
    const { contractor_signature: _signature, ...unsigned } = permitAnswers

    expect(
      await refused(by('u-tech'), [
        permitOf(order.id, heating, { answers: JSON.stringify(unsigned) }),
      ]),
    ).toBe('Unterschrift der ausführenden Person fehlt.')
    expect(
      await refused(by('u-tech'), [
        permitOf(order.id, heating, {
          answers: JSON.stringify({ ...permitAnswers, combustibles: 'maybe' }),
        }),
      ]),
    ).toBe('Brennbares im Umkreis entfernt oder abgedeckt: eine der angebotenen Möglichkeiten.')
    // Only the permit of the package, in a version the catalogue holds.
    expect(await refused(by('u-tech'), [permitOf(order.id, heating, { formVersion: 9 })])).toMatch(
      /^Diesen Erlaubnisschein kennt der Server nicht/,
    )
    expect(
      await refused(by('u-tech'), [
        permitOf(order.id, heating, { formKey: 'probe.water_meter_reading' }),
      ]),
    ).toMatch(/^Diesen Erlaubnisschein kennt der Server nicht/)
    expect(await outcomes(by('u-tech'), [permitOf(order.id, heating)])).toEqual([applied])
  })

  it('stays readable in the version of its form it was made in', async () => {
    const heating = await firm('Heizungsbau Rhein-Neckar GmbH')
    const order = await begun(heating)

    // Made in the version 1 on a device that held it, while the catalogue holds the version 2 from today.
    expect(catalogue.form(hotWorkPermitForm, today)?.version).toBe(2)
    expect(await outcomes(by('u-tech'), [permitOf(order.id, heating)])).toEqual([applied])

    const visits = (
      await http()
        .get(`/work-orders/${order.id}/visits`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as ContractorVisits

    expect(visits.permits).toHaveLength(1)
    expect(visits.permits[0]).toMatchObject({
      formKey: hotWorkPermitForm,
      formVersion: 1,
      signerName: 'Marco Petri',
      signedByName: 'Tobias Wendt',
      answers: permitAnswers,
    })
    expect(visits.permits[0]?.form?.version).toBe(1)
    expect(visits.permits[0]?.form?.sections[0]?.fields[0]?.label).toBe('Arbeitsort')
  })
})

describe('the briefings and permits of a firm', () => {
  it('stand at the order and at the firm for whoever sees the order', async () => {
    const heating = await firm('Heizungsbau Odenwald GmbH')
    const order = await begun(heating)

    expect(
      await outcomes(by('u-tech'), [briefingOf(order.id, heating), permitOf(order.id, heating)]),
    ).toEqual([applied, applied])

    const atOrder = (
      await http()
        .get(`/work-orders/${order.id}/visits`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as ContractorVisits

    expect(atOrder.briefings).toMatchObject([
      {
        personName: 'Marco Petri',
        contractorName: 'Heizungsbau Odenwald GmbH',
        signedByName: 'Tobias Wendt',
        orderTitle: 'Undichte Lötstelle am Heizungsrücklauf instand setzen',
      },
    ])

    const atFirm = (
      await http()
        .get(`/contractors/${heating}/visits`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as ContractorVisits

    expect(atFirm.briefings.map((briefing) => briefing.activityId)).toEqual([order.id])
    expect(atFirm.permits.map((permit) => permit.activityId)).toEqual([order.id])

    // Somebody of the Haustechnik who has nothing to do with the order sees neither.
    await http()
      .get(`/work-orders/${order.id}/visits`)
      .set(testIdentityHeader, by('u-other'))
      .expect(404)

    const notInSight = (
      await http()
        .get(`/contractors/${heating}/visits`)
        .set(testIdentityHeader, by('u-other'))
        .expect(200)
    ).body as ContractorVisits

    expect(notInSight).toEqual({ briefings: [], permits: [] })

    // On the device of whoever leads the order, and of nobody who has nothing to do with it.
    const held = async (userId: keyof typeof people & string, entity: string) => {
      const pulled = await http()
        .get('/sync?since=0')
        .set(testIdentityHeader, by(userId))
        .expect(200)
      const changes = pulled.body.changes as {
        readonly entity: string
        readonly rows: readonly Record<string, unknown>[]
      }[]

      return (
        changes.find((change) => change.entity === entity)?.rows.map((row) => row['activityId']) ??
        []
      )
    }

    expect(await held('u-tech', 'briefings')).toContain(order.id)
    expect(await held('u-tech', 'work_permits')).toContain(order.id)
    expect(await held('u-other', 'briefings')).not.toContain(order.id)
    expect(await held('u-other', 'work_permits')).not.toContain(order.id)
  })
})
