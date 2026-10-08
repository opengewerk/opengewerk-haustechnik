import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { missingRight, syncEntities, type TenantId } from '@opengewerk/haustechnik-domain'
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
import { as, onDevice, testIdentities } from './test-identity.js'

// The routes a device syncs through are the foundation's, tested there with an
// application that is nobody's (ADR 0010 in the repository opengewerk). What
// is held here is the binding: that this application has them, under the two
// rights of section 7 of the concept, and that a kind of record without a
// policy does not travel. What a device sends of the records that do is in
// `sync/sync.test.ts` (#27).

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
  await resetToMigrated()
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

      expect(answer.body).toMatchObject({ changes: [], cursor: 0, hasMore: false })
      // Every kind of record is named, so that a device knows what it holds.
      expect(Object.keys(answer.body.narrowed as object).sort()).toEqual([...syncEntities].sort())
    }
  })

  it('refuses a transmission with a kind of record that does not travel, and names the operation', async () => {
    // An evidence is written on the server and never on a device (ADR 0004).
    const evidence = operation('evidence')
    const answer = await http()
      .post('/sync')
      .set(testIdentityHeader, as(tenantId, 'u-technician', 'technician'))
      .send({ deviceId: 'phone', operations: [evidence] })
      .expect(400)

    expect(answer.body).toMatchObject({
      message: 'Diese Art von Datensatz wird nicht abgeglichen: evidence',
      operationId: evidence.id,
    })
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
    // Asked as the device that sent: the list is a device's own, and a session
    // that is no device is answered without a look at the table.
    const answer = await http()
      .get('/sync/conflicts')
      .set(testIdentityHeader, onDevice(as(tenantId, 'u-technician', 'technician'), 'phone'))
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
