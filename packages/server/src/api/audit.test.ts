import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type AuditPage,
  auditTableNamesPeople,
  missingRight,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
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
import { tableReaders } from './test-tables.js'

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

const { tableOf, refusalOf } = tableReaders(http)

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
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

  it('goes out as a table in the words of this application (#236)', async () => {
    const lea = as(tenantId, 'u-lea', 'management')
    const made = async (path: string, body: object): Promise<string> =>
      (await http().post(path).set(testIdentityHeader, lea).send(body).expect(201)).body.id
    const property = await made('/properties', {
      name: 'Rathaus Nord',
      street: 'Marktplatz 1',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
    })

    await made(`/properties/${property}/buildings`, { name: 'Altbau', kinds: ['school'] })

    for (const format of ['xlsx', 'csv'] as const) {
      const table = await tableOf('/audit/table', { table: 'buildings' }, lea, format)
      const kinds = table.find((row) => row.includes('Schule oder Hochschule'))

      expect(table[0]).toEqual([
        'Zeitpunkt',
        'Datensatz',
        'Art',
        'Änderung',
        'Feld',
        'Vorher',
        'Nachher',
        'Person',
        'Gerät',
        'Weg',
      ])
      // The kind of a building as the Leitung reads it, and not as the log keeps it.
      expect(kinds?.[1]).toBe('Altbau')
      expect(kinds?.[6]).toBe('Schule oder Hochschule')
      expect(kinds?.[7]).toBe('Lea Leitung')
      expect(table.flat()).not.toContain('school')
    }
  })

  it('is no table for whoever reads the log and may not see the staff (#236)', async () => {
    const readsTheLog = JSON.stringify({
      userId: 'u-lea',
      tenantId,
      roles: ['management'],
      rights: ['audit.read'],
    })

    expect(await refusalOf('/audit/table', {}, readsTheLog)).toEqual({
      status: 403,
      message: auditTableNamesPeople,
    })
    // The list itself is theirs to read; only the file that leaves is not.
    await http().get('/audit/changes').set(testIdentityHeader, readsTheLog).expect(200)
  })

  it('checks the chain of its tenant', async () => {
    const answer = await http()
      .get('/audit/chain')
      .set(testIdentityHeader, as(tenantId, 'u-lea', 'management'))
      .expect(200)

    expect(answer.body).toMatchObject({ brokenAt: null, problem: null })
  })
})
