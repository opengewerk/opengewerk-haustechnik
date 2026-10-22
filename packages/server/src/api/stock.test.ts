import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type Article,
  catalogueOf,
  type RoleKey,
  shippedRoles,
  type StoreArticlePage,
  type StoreStock,
  type TenantId,
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
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The stores of the operator (#325, section 4.12 of the concept): articles,
 * suppliers and stores on the building block of the foundation, the stock as
 * the sum of its bookings, a receipt and a count with its reason, the minimum
 * and the list of what is below it. Tenant-wide and without an area; looking
 * at the stores is for every role, keeping them for the Leitung, the
 * Technische Leitung and the Objektleitung.
 */

const small = newId<'tenant'>() as TenantId
const other = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

async function made(path: string, body: object, header = by('u-site')): Promise<{ id: string }> {
  return (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body as {
    id: string
  }
}

async function stockOf(store: string, query = '', header = by('u-tech')): Promise<StoreStock> {
  return (
    await http().get(`/stores/${store}/stock${query}`).set(testIdentityHeader, header).expect(200)
  ).body as StoreStock
}

function book(store: string, body: object, header = by('u-site')) {
  return http().post(`/stores/${store}/movements`).set(testIdentityHeader, header).send(body)
}

/** A store with an article in it, both new. */
async function storeWithArticle(): Promise<{ readonly store: string; readonly article: string }> {
  const store = await made('/stores', { name: `Lager ${newId<'store'>().slice(-6)}` })
  const article = await made('/articles', {
    number: `A-${newId<'article'>().slice(-8)}`,
    designation: 'Akku Notleuchte 3,6 V',
    unit: 'piece',
    priceCents: 890,
  })

  return { store: store.id, article: article.id }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const [tenantId, name] of [
    [small, 'Wohnbau Nord eG'],
    [other, 'Gebäudeverwaltung Süd'],
  ] as const) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenantId, name])

    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, other]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
      ])
    }
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue: catalogueOf(probeCatalogueBundle) }),
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

describe('who keeps the stores', () => {
  it('every role looks at them, and only the Leitung, the Technische Leitung and the Objektleitung keep them', async () => {
    const { store, article } = await storeWithArticle()

    for (const userId of ['u-lead', 'u-duties', 'u-site', 'u-tech'] as const) {
      await http().get('/stores').set(testIdentityHeader, by(userId)).expect(200)
      await http().get('/articles').set(testIdentityHeader, by(userId)).expect(200)
      await http().get('/suppliers').set(testIdentityHeader, by(userId)).expect(200)
    }

    // The Haustechnik looks and keeps nothing.
    await http()
      .post('/articles')
      .set(testIdentityHeader, by('u-tech'))
      .send({ number: 'A-9', designation: 'x', unit: 'piece' })
      .expect(403)
    await http()
      .post('/suppliers')
      .set(testIdentityHeader, by('u-tech'))
      .send({ name: 'x' })
      .expect(403)
    await http()
      .post('/stores')
      .set(testIdentityHeader, by('u-tech'))
      .send({ name: 'x' })
      .expect(403)
    await book(
      store,
      { articleId: article, kind: 'receipt', quantityMilli: 1000 },
      by('u-tech'),
    ).expect(403)
    await http()
      .put(`/stores/${store}/articles/${article}/minimum`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ minimumMilli: 1000 })
      .expect(403)

    for (const userId of ['u-lead', 'u-duties', 'u-site'] as const) {
      await book(
        store,
        { articleId: article, kind: 'receipt', quantityMilli: 1000 },
        by(userId),
      ).expect(201)
    }
  })

  it('another operator sees neither the articles nor the stores of this one', async () => {
    const { store, article } = await storeWithArticle()
    const theirs = (
      await http().get('/articles').set(testIdentityHeader, by('u-lead', other)).expect(200)
    ).body as Article[]

    expect(theirs.map((each) => each.id)).not.toContain(article)
    expect(
      (
        (await http().get('/stores').set(testIdentityHeader, by('u-lead', other)).expect(200))
          .body as { id: string }[]
      ).map((each) => each.id),
    ).not.toContain(store)
    await http()
      .get(`/stores/${store}/stock`)
      .set(testIdentityHeader, by('u-lead', other))
      .expect(404)
    await book(
      store,
      { articleId: article, kind: 'receipt', quantityMilli: 1000 },
      by('u-lead', other),
    ).expect(404)
  })
})

describe('the stock of a store', () => {
  it('is the sum of its bookings: a receipt adds, and a count sets it to what was found, with its reason', async () => {
    const { store, article } = await storeWithArticle()
    const supplier = await made('/suppliers', { name: 'Elektro-Großhandel Beispiel GmbH' })

    await book(store, {
      articleId: article,
      kind: 'receipt',
      quantityMilli: 6000,
      supplierId: supplier.id,
      reason: 'Lieferschein 4690-11',
    }).expect(201)
    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 4500 }).expect(201)
    expect((await stockOf(store)).lines).toEqual([
      expect.objectContaining({ articleId: article, levelMilli: 10_500 }),
    ])

    // A count names its reason, and corrects the stock to what was found.
    const unreasoned = await book(store, {
      articleId: article,
      kind: 'count',
      quantityMilli: 9000,
    }).expect(400)

    // The sentence of the rule, not only the check of the database behind it.
    expect((unreasoned.body as { message: string }).message).toBe('Eine Zählung nennt ihren Grund.')
    await book(store, {
      articleId: article,
      kind: 'count',
      quantityMilli: 9000,
      reason: 'Inventur, ein Akku defekt ausgesondert',
    }).expect(201)
    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 1000 }).expect(201)
    expect((await stockOf(store)).lines[0]?.levelMilli).toBe(10_000)

    // Nothing else is booked in the office: no receipt of nothing, no withdrawal
    // (a write-off is what the office takes away, #430), no supplier at a count.
    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 0 }).expect(400)
    await book(store, { articleId: article, kind: 'withdrawal', quantityMilli: 1000 }).expect(400)
    await book(store, {
      articleId: article,
      kind: 'count',
      quantityMilli: 1000,
      reason: 'Inventur',
      supplierId: supplier.id,
    }).expect(400)

    const page = (
      await http()
        .get(`/stores/${store}/articles/${article}`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as StoreArticlePage

    expect(page.levelMilli).toBe(10_000)
    expect(page.movements.map((each) => [each.kind, each.levelAfterMilli])).toEqual([
      ['receipt', 10_000],
      ['count', 9000],
      ['receipt', 10_500],
      ['receipt', 6000],
    ])
    expect(page.movements.at(-1)).toMatchObject({
      supplier: 'Elektro-Großhandel Beispiel GmbH',
      reason: 'Lieferschein 4690-11',
    })
  })

  it('keeps on a booking who booked, from the request and never from the body, and names them on no page', async () => {
    const { store, article } = await storeWithArticle()

    await book(store, {
      articleId: article,
      kind: 'receipt',
      quantityMilli: 1000,
      bookedBy: 'u-lead',
    }).expect(201)

    const { rows } = await admin.query<{ booked_by: string }>(
      'select booked_by from stock_movements where article_id = $1',
      [article],
    )

    expect(rows.map((row) => row.booked_by)).toEqual(['u-site'])

    const page = await http()
      .get(`/stores/${store}/articles/${article}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const stock = await http()
      .get(`/stores/${store}/stock`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    for (const answer of [page.text, stock.text]) {
      expect(answer).not.toContain('u-site')
      expect(answer).not.toContain('Petra Lindner')
    }
  })

  it('says below its minimum, narrows to those, and hands them out as the list to order from', async () => {
    const { store, article } = await storeWithArticle()
    const second = await made('/articles', {
      number: `B-${newId<'article'>().slice(-8)}`,
      designation: 'Kugelhahn DN 20',
      unit: 'piece',
    })

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 3000 }).expect(201)
    await book(store, { articleId: second.id, kind: 'receipt', quantityMilli: 4000 }).expect(201)
    await http()
      .put(`/stores/${store}/articles/${article}/minimum`)
      .set(testIdentityHeader, by('u-site'))
      .send({ minimumMilli: 10_000 })
      .expect(200)
    await http()
      .put(`/stores/${store}/articles/${article}/minimum`)
      .set(testIdentityHeader, by('u-site'))
      .send({ minimumMilli: -1 })
      .expect(400)

    const stock = await stockOf(store)

    expect(stock.belowCount).toBe(1)
    expect(stock.lines.find((line) => line.articleId === article)).toMatchObject({
      below: true,
      minimumMilli: 10_000,
    })
    expect(stock.lines.find((line) => line.articleId === second.id)?.below).toBe(false)
    expect((await stockOf(store, '?below=1')).lines.map((line) => line.articleId)).toEqual([
      article,
    ])

    const table = await http()
      .get(`/stores/${store}/stock/table?format=csv&below=1`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)

    expect(table.text).toContain('Akku Notleuchte 3,6 V')
    expect(table.text).not.toContain('Kugelhahn DN 20')
  })

  it('removes an article only once nothing of it lies anywhere, and keeps it readable at its bookings (#391)', async () => {
    const { store, article } = await storeWithArticle()

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 2000 }).expect(201)

    const refused = await http()
      .delete(`/articles/${article}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(409)

    expect((refused.body as { message: string }).message).toMatch(
      /^Der Artikel hat noch Bestand: 2 Stück in „Lager .+“\. Erst eine Zählung auf null, dann lässt er sich entfernen\.$/,
    )

    await book(store, {
      articleId: article,
      kind: 'count',
      quantityMilli: 0,
      reason: 'Ausgesondert',
    }).expect(201)
    await http().delete(`/articles/${article}`).set(testIdentityHeader, by('u-site')).expect(200)

    // Removed and with nothing there, it leaves the list of the store.
    expect((await stockOf(store)).lines).toEqual([])

    const page = (
      await http()
        .get(`/stores/${store}/articles/${article}`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as StoreArticlePage

    expect(page.article.designation).toBe('Akku Notleuchte 3,6 V')
    expect(page.movements).toHaveLength(2)
    // A new booking of it is refused.
    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 1000 }).expect(404)
  })

  it('removes a supplier only for whoever keeps the stores, and keeps it readable at its bookings (#391, #530)', async () => {
    const { store, article } = await storeWithArticle()
    const supplier = await made('/suppliers', { name: 'Leuchten Kurpfalz GmbH' })

    await book(store, {
      articleId: article,
      kind: 'receipt',
      quantityMilli: 3000,
      supplierId: supplier.id,
    }).expect(201)
    await http()
      .delete(`/suppliers/${supplier.id}`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(403)
    await http()
      .delete(`/suppliers/${supplier.id}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(200)

    const listed = (
      await http().get('/suppliers').set(testIdentityHeader, by('u-site')).expect(200)
    ).body as { readonly id: string }[]

    expect(listed.map((each) => each.id)).not.toContain(supplier.id)

    const page = (
      await http()
        .get(`/stores/${store}/articles/${article}`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as StoreArticlePage

    expect(page.movements.map((each) => each.supplier)).toEqual(['Leuchten Kurpfalz GmbH'])
    // A new receipt from it is refused.
    await book(store, {
      articleId: article,
      kind: 'receipt',
      quantityMilli: 1000,
      supplierId: supplier.id,
    }).expect(404)
  })
})

describe('an article', () => {
  it('has a number once per operator, however it is written, and a barcode with its check digit', async () => {
    const number = `C-${newId<'article'>().slice(-8)}`

    await made('/articles', { number, designation: 'Thermostatkopf', unit: 'piece' })
    await http()
      .post('/articles')
      .set(testIdentityHeader, by('u-site'))
      .send({ number: number.toLowerCase(), designation: 'Zweiter', unit: 'piece' })
      .expect(409)
    await http()
      .post('/articles')
      .set(testIdentityHeader, by('u-site'))
      .send({
        number: `${number}-2`,
        designation: 'Falsche EAN',
        unit: 'piece',
        ean: '4006381333932',
      })
      .expect(400)
    await http()
      .post('/articles')
      .set(testIdentityHeader, by('u-site'))
      .send({ number: `${number}-3`, designation: 'Ohne Einheit', unit: 'hour' })
      .expect(400)
    await http()
      .post('/articles')
      .set(testIdentityHeader, by('u-site'))
      .send({ number: `${number}-4`, designation: 'Preis', unit: 'piece', priceCents: -5 })
      .expect(400)

    // The list as a table, for whoever looks at the stores.
    const table = await http()
      .get('/articles/table?format=csv')
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)

    expect(table.text).toContain(number)
    expect(table.text).not.toContain('Falsche EAN')
  })
})

describe('a booking', () => {
  it('is changed and removed by no role, the owner of the tables included', async () => {
    const { store, article } = await storeWithArticle()

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 1000 }).expect(201)
    await expect(
      admin.query('update stock_movements set quantity_milli = 5000 where article_id = $1', [
        article,
      ]),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query('delete from stock_movements where article_id = $1', [article]),
    ).rejects.toMatchObject({ code: 'HT005' })
  })
})

describe('a store and an article that go (#391)', () => {
  function moved(store: string, article: string, body: object, header = by('u-site')) {
    return http()
      .post(`/stores/${store}/articles/${article}/move`)
      .set(testIdentityHeader, header)
      .send(body)
  }

  async function pageOf(store: string, article: string): Promise<StoreArticlePage> {
    return (
      await http()
        .get(`/stores/${store}/articles/${article}`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as StoreArticlePage
  }

  function minimum(store: string, article: string, minimumMilli: number) {
    return http()
      .put(`/stores/${store}/articles/${article}/minimum`)
      .set(testIdentityHeader, by('u-site'))
      .send({ minimumMilli })
      .expect(200)
  }

  it('removes a store only while it carries no article, and only for whoever keeps the stores', async () => {
    const { store, article } = await storeWithArticle()
    const empty = await made('/stores', { name: `Lager ${newId<'store'>().slice(-6)}` })

    await http().delete(`/stores/${empty.id}`).set(testIdentityHeader, by('u-tech')).expect(403)
    await http().delete(`/stores/${empty.id}`).set(testIdentityHeader, by('u-site')).expect(200)
    await http().get(`/stores/${empty.id}/stock`).set(testIdentityHeader, by('u-tech')).expect(404)

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 1000 }).expect(201)

    const refused = await http()
      .delete(`/stores/${store}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(409)

    expect((refused.body as { message: string }).message).toBe(
      'Das Lager führt noch 1 Artikel. Ziehen Sie sie zuerst in ein anderes Lager um oder entfernen Sie sie; einen Artikel mit Bestand bringt eine Zählung auf null.',
    )
  })

  it('moves an article with its stock as a transfer, and joins it where the other store carries it, keeping its minimum there', async () => {
    const { store, article } = await storeWithArticle()
    const target = await made('/stores', { name: `Werkstatt ${newId<'store'>().slice(-6)}` })

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 3000 }).expect(201)
    await minimum(store, article, 10_000)
    await book(target.id, { articleId: article, kind: 'receipt', quantityMilli: 2000 }).expect(201)
    await minimum(target.id, article, 4000)

    await moved(store, article, { toStoreId: target.id }, by('u-tech')).expect(403)

    const answer = await moved(store, article, {
      toStoreId: target.id,
      reason: 'Im falschen Lager angelegt',
    }).expect(201)

    expect(answer.body).toEqual({ storeId: target.id, articleId: article })
    expect((await stockOf(store)).lines).toEqual([])
    expect((await stockOf(target.id)).lines).toEqual([
      expect.objectContaining({ articleId: article, levelMilli: 5000, minimumMilli: 4000 }),
    ])

    const here = await pageOf(store, article)
    const there = await pageOf(target.id, article)

    expect(here.carried).toBe(false)
    expect(here.levelMilli).toBe(0)
    expect(here.movements[0]).toMatchObject({
      kind: 'transfer_out',
      quantityMilli: 3000,
      levelAfterMilli: 0,
      reason: 'Im falschen Lager angelegt',
      counterpartStore: { id: target.id },
    })
    expect(there.carried).toBe(true)
    expect(there.movements[0]).toMatchObject({
      kind: 'transfer_in',
      quantityMilli: 3000,
      levelAfterMilli: 5000,
      counterpartStore: { id: store },
    })

    // Gone from here, it does not move from here a second time.
    await moved(store, article, { toStoreId: target.id }).expect(404)

    // A booking in the store it left brings its line back.
    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 1000 }).expect(201)
    expect((await stockOf(store)).lines).toEqual([
      expect.objectContaining({ articleId: article, levelMilli: 1000 }),
    ])
  })

  it('moves an article without bookings with its minimum and books nothing', async () => {
    const { store, article } = await storeWithArticle()
    const target = await made('/stores', { name: `Werkstatt ${newId<'store'>().slice(-6)}` })

    await minimum(store, article, 6000)
    await moved(store, article, { toStoreId: target.id }).expect(201)

    expect((await stockOf(target.id)).lines).toEqual([
      expect.objectContaining({ articleId: article, levelMilli: 0, minimumMilli: 6000 }),
    ])

    const { rows } = await admin.query<{ count: string }>(
      'select count(*) from stock_movements where article_id = $1',
      [article],
    )

    expect(rows[0]?.count).toBe('0')
  })

  it('moves only an article the store carries, into another live store, and none with a stock below zero', async () => {
    const { store, article } = await storeWithArticle()
    const target = await made('/stores', { name: `Werkstatt ${newId<'store'>().slice(-6)}` })

    expect((await moved(store, article, { toStoreId: target.id }).expect(404)).body).toMatchObject({
      message: 'Dieses Lager führt den Artikel nicht.',
    })

    await minimum(store, article, 1000)
    await moved(store, article, { toStoreId: store }).expect(400)
    await moved(store, article, { toStoreId: newId<'store'>() }).expect(404)

    // More went out than lay there, as two devices without a network can make it.
    await admin.query(
      `insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, booked_by, counterpart_store_id)
       values ($1, $2, $3, 'transfer_out', 1000, 'u-tech', $4)`,
      [small, store, article, target.id],
    )
    expect((await moved(store, article, { toStoreId: target.id }).expect(409)).body).toMatchObject({
      message:
        'Der Bestand hier ist negativ. Erst eine Zählung, dann lässt sich der Artikel umziehen.',
    })
  })

  it('takes a transfer only with the other store, which the database holds as well', async () => {
    const { store, article } = await storeWithArticle()

    await expect(
      admin.query(
        `insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, booked_by)
         values ($1, $2, $3, 'transfer_in', 1000, 'u-tech')`,
        [small, store, article],
      ),
    ).rejects.toThrow(/stock_movements_transfer_names_its_store/)
    await expect(
      admin.query(
        `insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, booked_by, counterpart_store_id)
         values ($1, $2, $3, 'transfer_in', 1000, 'u-tech', $2)`,
        [small, store, article],
      ),
    ).rejects.toThrow(/stock_movements_transfer_elsewhere/)
  })
})

describe('where an article lies in a store (#385)', () => {
  function placed(store: string, article: string, bin: unknown, header = by('u-site')) {
    return http()
      .put(`/stores/${store}/articles/${article}/bin`)
      .set(testIdentityHeader, header)
      .send({ bin })
  }

  async function binIn(store: string, article: string): Promise<string | null | undefined> {
    return (await stockOf(store)).lines.find((line) => line.articleId === article)?.bin
  }

  it('is kept by whoever keeps the stores, for one store, and stands in the stock, its table and the page', async () => {
    const { store, article } = await storeWithArticle()
    const other = await made('/stores', { name: `Werkstatt ${newId<'store'>().slice(-6)}` })

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 3000 }).expect(201)
    await book(other.id, { articleId: article, kind: 'receipt', quantityMilli: 1000 }).expect(201)
    await placed(store, article, 'Regal 3, Fach 1', by('u-tech')).expect(403)
    await placed(store, article, 'x'.repeat(201)).expect(400)
    await placed(store, article, 3).expect(400)

    const kept = await placed(store, article, '  Regal 3, Fach 1  ').expect(200)

    expect(kept.body).toEqual({ bin: 'Regal 3, Fach 1' })
    expect(await binIn(store, article)).toBe('Regal 3, Fach 1')
    expect(await binIn(other.id, article)).toBeNull()

    const page = await http()
      .get(`/stores/${store}/articles/${article}`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)

    expect((page.body as StoreArticlePage).bin).toBe('Regal 3, Fach 1')

    const table = await http()
      .get(`/stores/${store}/stock/table?format=csv`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)

    expect(table.text).toContain('Lagerplatz')
    expect(table.text).toContain('Regal 3, Fach 1')

    await placed(store, article, ' ').expect(200)

    expect(await binIn(store, article)).toBeNull()
  })

  it('stays in its store when the article moves, and the store it reaches keeps its own', async () => {
    const { store, article } = await storeWithArticle()
    const fresh = await made('/stores', { name: `Werkstatt ${newId<'store'>().slice(-6)}` })
    const carrying = await made('/stores', { name: `Keller ${newId<'store'>().slice(-6)}` })

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 2000 }).expect(201)
    await placed(store, article, 'Regal 3').expect(200)
    await http()
      .post(`/stores/${store}/articles/${article}/move`)
      .set(testIdentityHeader, by('u-site'))
      .send({ toStoreId: fresh.id })
      .expect(201)

    expect(await binIn(fresh.id, article)).toBeNull()

    await placed(carrying.id, article, 'Werkbank').expect(200)
    await placed(fresh.id, article, 'Regal 9').expect(200)
    await http()
      .post(`/stores/${fresh.id}/articles/${article}/move`)
      .set(testIdentityHeader, by('u-site'))
      .send({ toStoreId: carrying.id })
      .expect(201)

    expect(await binIn(carrying.id, article)).toBe('Werkbank')
  })
})

describe('a write-off (#430)', () => {
  it('takes stock away for something without a work order, with its reason, for whoever keeps the stores', async () => {
    const { store, article } = await storeWithArticle()
    const writtenOff = (quantityMilli: number, reason?: string, header = by('u-site')) =>
      book(
        store,
        { articleId: article, kind: 'write_off', quantityMilli, ...(reason ? { reason } : {}) },
        header,
      )

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 3000 }).expect(201)
    await writtenOff(2000, 'Für das Foyer', by('u-tech')).expect(403)

    const unreasoned = await writtenOff(2000).expect(400)

    expect((unreasoned.body as { message: string }).message).toBe(
      'Eine Ausbuchung nennt ihren Grund.',
    )
    await writtenOff(0, 'Für das Foyer').expect(400)

    const booked = await writtenOff(2000, '  Zwei Akkus für das Foyer  ').expect(201)

    expect(booked.body).toMatchObject({ levelMilli: 1000 })

    // More than lies there is written off all the same, and the stock says so.
    await writtenOff(3000, 'Defekt ausgesondert').expect(201)

    expect(
      (await stockOf(store)).lines.find((line) => line.articleId === article)?.levelMilli,
    ).toBe(-2000)

    const page = (
      await http()
        .get(`/stores/${store}/articles/${article}`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as StoreArticlePage

    expect(page.movements[1]).toMatchObject({
      kind: 'write_off',
      quantityMilli: 2000,
      levelAfterMilli: 1000,
      reason: 'Zwei Akkus für das Foyer',
      workOrder: null,
    })
  })

  it('names its reason in the database too', async () => {
    const { store, article } = await storeWithArticle()

    await expect(
      admin.query(
        `insert into stock_movements (tenant_id, store_id, article_id, kind, quantity_milli, booked_by)
         values ($1, $2, $3, 'write_off', 1000, 'u-tech')`,
        [small, store, article],
      ),
    ).rejects.toThrow(/stock_movements_write_off_with_a_reason/)
  })
})
