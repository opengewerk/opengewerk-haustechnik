import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { type AuditPage, missingRight, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
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

// The change log of a tenant is the foundation's, read and checked there with
// an application that is nobody's (ADR 0010 in the repository opengewerk).
// What is held here is the binding: that this application has the routes,
// that only the Leitung reads them, as section 7 of the concept says, and that
// the log of a tenant is told the words of this application.

const tenantId = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
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
  await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
    'u-lea',
    'Lea Leitung',
    'lea@nord.example.de',
  ])

  database = Database.connect(applicationDatabaseUrl())

  // Through the application, so that the membership is in the tenant's log
  // the way every real one is.
  await database.forTenant({ tenantId, reason: 'membership.create' }, (tx) =>
    tx.insert(memberships).values({ tenantId, userId: 'u-lea', roles: ['management'] }),
  )

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

describe('the change log of this application', () => {
  it('shows the Leitung the changes of its tenant', async () => {
    const answer = await http()
      .get('/audit/changes')
      .set(testIdentityHeader, as(tenantId, 'u-lea', 'management'))
      .expect(200)
    const page = answer.body as AuditPage
    const membership = page.changes.find((change) => change.table === 'memberships')

    expect(membership?.reason).toBe('membership.create')
    expect(page.people['u-lea']).toBe('Lea Leitung')
  })

  it('is closed to every other role, with the words of this application', async () => {
    for (const role of ['technical_management', 'site_management', 'technician'] as const) {
      const answer = await http()
        .get('/audit/changes')
        .set(testIdentityHeader, as(tenantId, `u-${role}`, role))
        .expect(403)

      expect([role, (answer.body as { message: string }).message]).toEqual([
        role,
        missingRight('audit.read'),
      ])
    }
  })

  it('checks the chain of its tenant', async () => {
    const answer = await http()
      .get('/audit/chain')
      .set(testIdentityHeader, as(tenantId, 'u-lea', 'management'))
      .expect(200)

    expect(answer.body).toMatchObject({ brokenAt: null, problem: null })
  })
})
