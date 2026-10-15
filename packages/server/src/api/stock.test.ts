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

    // Nothing else is booked in the office: no receipt of nothing, no withdrawal,
    // no supplier at a count.
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

  it('keeps an article no longer kept readable at its bookings, and on the list while something of it lies there', async () => {
    const { store, article } = await storeWithArticle()

    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 2000 }).expect(201)
    await http().delete(`/articles/${article}`).set(testIdentityHeader, by('u-site')).expect(200)

    expect((await stockOf(store)).lines).toEqual([
      expect.objectContaining({ articleId: article, removed: true, levelMilli: 2000 }),
    ])

    const page = (
      await http()
        .get(`/stores/${store}/articles/${article}`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as StoreArticlePage

    expect(page.article.designation).toBe('Akku Notleuchte 3,6 V')
    expect(page.movements).toHaveLength(1)
    // A new booking of it is refused.
    await book(store, { articleId: article, kind: 'receipt', quantityMilli: 1000 }).expect(404)
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
