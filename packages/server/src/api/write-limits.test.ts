import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import { catalogueOf, shippedRoles, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, WriteLimits } from '@opengewerk/platform-server'
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
 * The budget of writing at the routes of the application (#590, B5 of the
 * security audit of the repository opengewerk): every request that changes
 * something with a JSON body counts for its account, whichever route it goes
 * to and whichever operator it works for. With a budget of three requests an
 * hour, so that the test does not have to send a hundred megabytes.
 */

const small = newId<'tenant'>() as TenantId
const other = newId<'tenant'>() as TenantId

let admin: Pool
let database: Database
let app: INestApplication

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

  await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
    'u-duties',
    'Jörg Albrecht',
    'u-duties@beispiel.example',
  ])

  for (const tenantId of [small, other]) {
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenantId,
      'u-duties',
      ['technical_management'],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue: catalogueOf(probeCatalogueBundle),
        writeLimits: new WriteLimits({ accountBytesPerHour: 3000, leastCountedBytes: 1000 }),
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

describe('the budget of writing', () => {
  it('counts what an account changes for every operator, refuses what is over, and lets it read', async () => {
    const firm = (tenantId: TenantId, name: string) =>
      request(app.getHttpServer())
        .post('/contractors')
        .set(testIdentityHeader, as(tenantId, 'u-duties', 'technical_management'))
        .send({ name })

    await firm(small, 'Elektro Kraus & Sohn').expect(201)
    await firm(other, 'Aufzugsdienst Rhein-Neckar GmbH').expect(201)
    await firm(small, 'Heizungsbau Beispiel GmbH').expect(201)

    const refused = await firm(other, 'Sanitär Lindner KG').expect(429)

    expect(String((refused.body as { message: string }).message)).toMatch(
      /in spätestens einer Stunde speichern/,
    )

    await request(app.getHttpServer())
      .get('/contractors')
      .set(testIdentityHeader, as(other, 'u-duties', 'technical_management'))
      .expect(200)

    const { rows } = await admin.query<{ name: string }>(
      'select name from contractors order by name',
    )

    expect(rows.map((row) => row.name)).toEqual([
      'Aufzugsdienst Rhein-Neckar GmbH',
      'Elektro Kraus & Sohn',
      'Heizungsbau Beispiel GmbH',
    ])
  })
})
