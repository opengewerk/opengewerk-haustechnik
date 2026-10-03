import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { missingRight, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

// The routes a device syncs through are the foundation's, tested there with an
// application that is nobody's (ADR 0010 in the repository opengewerk). What
// is held here is the binding: that this application has them, under the two
// rights of section 7 of the concept, and that a device can send no record
// of it before the record has a policy (#27).

const tenantId = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** An operation as a device queues it, for a kind of record. */
function operation(entity: string) {
  return {
    id: newId<'operation'>(),
    entity,
    recordId: newId<'record'>(),
    kind: 'create',
    baseVersion: null,
    patches: [{ field: 'name', from: null, to: 'Heizraum' }],
    recordedAt: new Date().toISOString(),
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  await admin.query('insert into tenants (id, name) values ($1, $2)', [
    tenantId,
    'Gebäudeverwaltung Nord',
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the sync of this application', () => {
  it('hands a device of any role what has changed, which is nothing yet', async () => {
    for (const role of ['technician', 'site_management', 'technical_management'] as const) {
      const answer = await http()
        .get('/sync?since=0')
        .set(testIdentityHeader, as(tenantId, `u-${role}`, role))
        .expect(200)

      expect(answer.body).toEqual({ changes: [], cursor: 0, hasMore: false, narrowed: {} })
    }
  })

  it('refuses a transmission with a record that does not travel yet, and names the operation', async () => {
    const room = operation('rooms')
    const answer = await http()
      .post('/sync')
      .set(testIdentityHeader, as(tenantId, 'u-technician', 'technician'))
      .send({ deviceId: 'phone', operations: [room] })
      .expect(400)

    expect(answer.body).toMatchObject({
      message: 'Diese Art von Datensatz wird nicht abgeglichen: rooms',
      operationId: room.id,
    })
  })

  /**
   * The places carry the columns of the sync from their first migration (#18),
   * and the pull reads every table that has them. Until the rules of the sync
   * say what a device may do with a place and which device holds which (#27),
   * none of them travels, also not to whoever sees every area.
   */
  it('hands out no place before the places have their rules', async () => {
    await admin.query(
      `insert into auth_users (id, name, email) values ('u-lead', 'Leitung', 'leitung@nord.example')`,
    )
    // The first membership gives the tenant its area, and the Leitung every area.
    await admin.query(
      `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-lead', '{management}')`,
      [tenantId],
    )
    await admin.query(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
         from areas where tenant_id = $1`,
      [tenantId],
    )

    const answer = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, as(tenantId, 'u-lead', 'management'))
      .expect(200)

    expect(answer.body).toEqual({ changes: [], cursor: 0, hasMore: false, narrowed: {} })
  })

  it('takes an empty outbox, as a device sends one that holds nothing', async () => {
    const answer = await http()
      .post('/sync')
      .set(testIdentityHeader, as(tenantId, 'u-technician', 'technician'))
      .send({ deviceId: 'phone', operations: [] })
      .expect(201)

    expect(answer.body).toEqual({ receipts: [] })
  })

  it('has no conflicts to work through', async () => {
    const answer = await http()
      .get('/sync/conflicts')
      .set(testIdentityHeader, as(tenantId, 'u-technician', 'technician'))
      .expect(200)

    expect(answer.body).toEqual([])
  })

  /**
   * Every role has both rights, so a refusal here comes from somebody whose
   * roles give none, as a membership whose role a tenant has emptied.
   */
  it('is refused to whoever holds neither right, in the words of this application', async () => {
    const nobody = JSON.stringify({ userId: 'u-none', tenantId, roles: [], rights: [] })

    const pulled = await http().get('/sync?since=0').set(testIdentityHeader, nobody).expect(403)

    expect(pulled.body).toMatchObject({ message: missingRight('sync.read') })

    const sent = await http()
      .post('/sync')
      .set(testIdentityHeader, nobody)
      .send({ deviceId: 'phone', operations: [] })
      .expect(403)

    expect(sent.body).toMatchObject({ message: missingRight('sync.write') })
  })
})
