import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  type RoleKey,
  shippedRoles,
  type StoreArticlePage,
  type StoreStock,
  type SyncValue,
  type TenantId,
  type WorkOrderDetails,
  type WorkOrderMaterialId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId, type PrintJob } from '@opengewerk/platform-server'
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
import { bookWithdrawal } from '../activities/materials.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * Material at a work order (#326, sections 4.8 and 4.12 of the concept): taken
 * on site by whoever works on the order, also without a connection, and booked
 * by the server once in its store. Below zero the stock says so, and that is
 * no conflict. A withdrawal is changed by nobody; it stands on the order in
 * the office without a person or a price. An article without the barcode of
 * its manufacturer gets a label for its shelf.
 */

const small = newId<'tenant'>() as TenantId
const address = 'https://haustechnik.example'

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  'u-other': { role: 'technician', name: 'Lena Vogt' },
  'u-south': { role: 'technician', name: 'Murat Yilmaz' },
}

let admin: Pool
let database: Database
let app: INestApplication
let north = ''

const rendered: PrintJob[] = []
const pdf = Buffer.from('%PDF-1.7\n% Etiketten\n%%EOF\n', 'utf8')

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(small, userId, people[userId]?.role as RoleKey)
}

let recorded = Date.parse('2026-10-05T06:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  entity: string,
  recordId: string,
  values: Readonly<Record<string, SyncValue>>,
  id: string = newId<'operation'>(),
) {
  recorded += 1000

  return {
    id,
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
    .expect(201)

  return (
    answer.body.receipts as { outcome: string; reason: string | null; fields: string[] }[]
  ).map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))
}

const applied = { outcome: 'applied', reason: null, fields: [] }

async function made(path: string, body: object, header = by('u-site')): Promise<string> {
  return (
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body as {
      id: string
    }
  ).id
}

/** A store with an article and what lies there of it, received in the office. */
async function stocked(
  quantityMilli: number,
  ean: string | null = null,
): Promise<{ readonly store: string; readonly article: string }> {
  const store = await made('/stores', { name: `Lager ${newId<'store'>().slice(-6)}` })
  const article = await made('/articles', {
    number: `A-${newId<'article'>().slice(-8)}`,
    designation: 'Akku Notleuchte 3,6 V',
    unit: 'piece',
    priceCents: 890,
    ...(ean === null ? {} : { ean }),
  })

  await http()
    .post(`/stores/${store}/movements`)
    .set(testIdentityHeader, by('u-site'))
    .send({ articleId: article, kind: 'receipt', quantityMilli })
    .expect(201)

  return { store, article }
}

/** A work order in the north led by Tobias Wendt with Lena Vogt, begun today. */
async function begun(status: 'started' | 'signed' = 'started'): Promise<string> {
  const property = await made(
    '/properties',
    {
      name: 'Bürgerhaus Mitte',
      street: 'Marktplatz 2',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      areaId: north,
    },
    by('u-duties'),
  )
  const building = await made(
    `/properties/${property}/buildings`,
    { name: 'Bürgerhaus', kinds: ['school'] },
    by('u-duties'),
  )
  const asset = await made(
    `/buildings/${building}/assets`,
    { kind: 'probe.elevator', name: 'Aufzug' },
    by('u-duties'),
  )
  const order = (
    await http()
      .post('/work-orders')
      .set(testIdentityHeader, by('u-site'))
      .send({
        title: 'Notleuchte Flur instand setzen',
        kind: 'other',
        urgency: 'normal',
        dueOn: addDays(dayInGermany(), 10),
        responsibleUserId: 'u-tech',
        participantUserIds: ['u-other'],
        origin: 'hand',
        propertyId: property,
        assetId: asset,
      })
      .expect(201)
  ).body as WorkOrderDetails

  await admin.query('update activities set status = $2 where id = $1', [order.id, status])

  return order.id
}

/** A withdrawal as a device sends it. */
function taking(
  order: string,
  stock: { readonly store: string; readonly article: string },
  quantityMilli: number,
  id: string = newId<'work-order-material'>(),
  more: Readonly<Record<string, SyncValue>> = {},
) {
  return operation('work_order_materials', id, {
    activityId: order,
    storeId: stock.store,
    articleId: stock.article,
    quantityMilli,
    takenAt: '2026-10-05T07:10:00.000Z',
    ...more,
  })
}

async function levelOf(stock: { readonly store: string; readonly article: string }) {
  const answer = (
    await http()
      .get(`/stores/${stock.store}/stock`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
  ).body as StoreStock

  return answer.lines.find((line) => line.articleId === stock.article)?.levelMilli
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

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [small],
  )
  const south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''

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

  for (const [userId, area] of [
    ['u-site', north],
    ['u-tech', north],
    ['u-other', north],
    ['u-south', south],
  ] as const) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [small, userId, area],
    )
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue: catalogueOf(probeCatalogueBundle),
        trustedOrigins: [address],
        renderer: (job) => {
          rendered.push(job)

          return Promise.resolve(pdf)
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

describe('a withdrawal', () => {
  it('is taken by whoever works on the order, a further person too, and lowers the stock exactly once', async () => {
    const order = await begun()
    const stock = await stocked(6000)
    const material = newId<'work-order-material'>()
    const sent = taking(order, stock, 2000, material)

    expect(await outcomes(by('u-other'), [sent])).toEqual([applied])
    // The same operation once more, as after a lost answer, and the same
    // withdrawal in a new operation, as from a second queue.
    await outcomes(by('u-other'), [sent])
    await outcomes(by('u-other'), [taking(order, stock, 2000, material)])

    const { rows } = await admin.query<{ kind: string; booked_by: string; quantity_milli: number }>(
      'select kind, booked_by, quantity_milli from stock_movements where material_id = $1',
      [material],
    )

    expect(rows).toEqual([{ kind: 'withdrawal', booked_by: 'u-other', quantity_milli: 2000 }])
    expect(await levelOf(stock)).toBe(4000)
  })

  it('is booked once when the booking is asked for twice', async () => {
    const order = await begun()
    const stock = await stocked(6000)
    const material = newId<'work-order-material'>()

    await outcomes(by('u-tech'), [taking(order, stock, 1000, material)])
    await database.forTenant({ tenantId: small, userId: 'u-tech' }, (tx) =>
      bookWithdrawal(tx, small, material as WorkOrderMaterialId),
    )

    const { rows } = await admin.query<{ count: string }>(
      'select count(*) from stock_movements where material_id = $1',
      [material],
    )

    expect(rows[0]?.count).toBe('1')
    expect(await levelOf(stock)).toBe(5000)
  })

  it('names who took it from the request and never from the device', async () => {
    const order = await begun()
    const stock = await stocked(6000)
    const material = newId<'work-order-material'>()

    expect(
      (
        await outcomes(by('u-tech'), [taking(order, stock, 1000, undefined, { takenBy: 'u-lead' })])
      )[0]?.outcome,
    ).not.toBe('applied')
    expect(await outcomes(by('u-tech'), [taking(order, stock, 1000, material)])).toEqual([applied])

    const { rows } = await admin.query<{ taken_by: string }>(
      'select taken_by from work_order_materials where id = $1',
      [material],
    )

    expect(rows).toEqual([{ taken_by: 'u-tech' }])
  })

  it('is taken by nobody who does not see the order, and on no order that is signed', async () => {
    const order = await begun()
    const stock = await stocked(6000)

    expect(await outcomes(by('u-south'), [taking(order, stock, 1000)])).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['activityId'] },
    ])

    const signed = await begun('signed')

    expect((await outcomes(by('u-tech'), [taking(signed, stock, 1000)]))[0]?.outcome).not.toBe(
      'applied',
    )
    expect(await levelOf(stock)).toBe(6000)
  })

  it('takes nothing from an article no longer kept', async () => {
    const order = await begun()
    const stock = await stocked(6000)

    await http()
      .delete(`/articles/${stock.article}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(200)
    expect(await outcomes(by('u-tech'), [taking(order, stock, 1000)])).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['articleId'] },
    ])
  })

  it('takes more than lies there, and the stock goes below zero and says so', async () => {
    const order = await begun()
    const stock = await stocked(1000)

    expect(await outcomes(by('u-tech'), [taking(order, stock, 3000)])).toEqual([applied])
    expect(await levelOf(stock)).toBe(-2000)
  })

  it('is changed and removed by no role, the owner of the tables included', async () => {
    const order = await begun()
    const stock = await stocked(6000)
    const material = newId<'work-order-material'>()

    await outcomes(by('u-tech'), [taking(order, stock, 1000, material)])
    await expect(
      admin.query('update work_order_materials set quantity_milli = 5 where id = $1', [material]),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query('delete from work_order_materials where id = $1', [material]),
    ).rejects.toMatchObject({ code: 'HT005' })
  })
})

describe('the material of an order', () => {
  it('stands on its page in the office without a person or a price, also when the article is no longer kept', async () => {
    const order = await begun()
    const stock = await stocked(6000)

    await outcomes(by('u-tech'), [taking(order, stock, 1500)])
    // Material of another order stands on that one, not on this.
    await outcomes(by('u-tech'), [taking(await begun(), stock, 700)])
    await http()
      .delete(`/articles/${stock.article}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(200)

    const page = (
      await http().get(`/work-orders/${order}`).set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as WorkOrderDetails

    expect(page.materials).toEqual([
      expect.objectContaining({
        quantityMilli: 1500,
        unit: 'piece',
        designation: 'Akku Notleuchte 3,6 V',
        articleId: stock.article,
        storeId: stock.store,
      }),
    ])
    expect(JSON.stringify(page.materials)).not.toMatch(/u-tech|Tobias|890|price/)
  })

  it('names its work order at the booking in the store, for whoever sees the order', async () => {
    const order = await begun()
    const stock = await stocked(6000)

    await outcomes(by('u-tech'), [taking(order, stock, 1000)])

    const seen = async (header: string) =>
      (
        (
          await http()
            .get(`/stores/${stock.store}/articles/${stock.article}`)
            .set(testIdentityHeader, header)
            .expect(200)
        ).body as StoreArticlePage
      ).movements[0]?.workOrder

    expect(await seen(by('u-tech'))).toMatchObject({
      id: order,
      title: 'Notleuchte Flur instand setzen',
    })
    // In the south the order is out of sight; the booking stays, without it.
    expect(await seen(by('u-south'))).toEqual({ id: null, number: null, title: null })
  })
})

describe('the labels on the shelves of a store', () => {
  it('are printed for the articles without a barcode, each once, by whoever keeps the stores', async () => {
    const plain = await stocked(1000)
    const barcoded = await made('/articles', {
      number: `B-${newId<'article'>().slice(-8)}`,
      designation: 'Kugelhahn DN 20',
      unit: 'piece',
      ean: '4006381333931',
    })

    await http()
      .post(`/stores/${plain.store}/movements`)
      .set(testIdentityHeader, by('u-site'))
      .send({ articleId: barcoded, kind: 'receipt', quantityMilli: 1000 })
      .expect(201)

    const print = (header: string, body: object = {}) =>
      http().post(`/stores/${plain.store}/labels/print`).set(testIdentityHeader, header).send(body)

    await print(by('u-tech')).expect(403)
    await print(by('u-site')).expect(200)

    const first = rendered.at(-1)?.html ?? ''

    expect(first).toContain('Akku Notleuchte 3,6 V')
    expect(first).not.toContain('Kugelhahn DN 20')

    await print(by('u-site')).expect(200)
    await print(by('u-site'), { which: 'all' }).expect(200)
    expect(rendered.at(-1)?.html).toContain('Kugelhahn DN 20')

    const { rows } = await admin.query<{ count: string }>(
      `select count(*) from store_labels l join store_articles s on s.id = l.store_article_id
        where s.store_id = $1`,
      [plain.store],
    )

    // One for each shelf, the second print of the first reusing its label.
    expect(rows[0]?.count).toBe('2')
  })
})
