import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { type RoleKey, roleKeys, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assignNumber } from '../database/number-ranges.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

// The number ranges and the last backup under "Einstellungen" (#127), on the
// routes of the foundation with the rights of this application: read with
// "Einstellungen ansehen", the number ranges changed with "Einstellungen
// ändern", and section 7 of the concept gives both to the Leitung alone.

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
  auditor: 'u-auditor',
}

let admin: Pool
let database: Database
let app: INestApplication
let tenantId: TenantId

function http() {
  return request(app.getHttpServer())
}

const by = (role: RoleKey) => as(tenantId, people[role], role)

function change(role: RoleKey, key: string, body: object) {
  return http().put(`/settings/number-ranges/${key}`).set(testIdentityHeader, by(role)).send(body)
}

/** The next number of a sequence, drawn the way a new asset draws it. */
function drawn(key: 'asset' | 'work_order' | 'evidence'): Promise<string> {
  return database.forTenant({ tenantId, reason: 'test' }, (tx) =>
    assignNumber(tx, tenantId, key, new Date()),
  )
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  tenantId = newId<'tenant'>() as TenantId
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenantId, 'Nummernträger'])

  for (const role of roleKeys) {
    await admin.query(
      'insert into auth_users (id, name, email) values ($1, $2, $3) on conflict do nothing',
      [people[role], people[role], `${people[role]}@beispiel.example`],
    )
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenantId,
      people[role],
      [role],
    ])
  }

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

describe('the number ranges (#127)', () => {
  it('are seen by the Leitung and by no other role', async () => {
    const shown = await http()
      .get('/settings/number-ranges')
      .set(testIdentityHeader, by('management'))
      .expect(200)

    expect(
      (shown.body as { key: string; pattern: string }[]).map((range) => [range.key, range.pattern]),
    ).toEqual([
      ['asset', 'AN-{number:5}'],
      ['work_order', 'AU-{year}-{number:4}'],
      ['evidence', 'NW-{year}-{number:5}'],
    ])

    for (const role of ['technical_management', 'site_management', 'technician'] as const) {
      await http().get('/settings/number-ranges').set(testIdentityHeader, by(role)).expect(403)
    }
  })

  it('are changed by the Leitung and by no other role', async () => {
    for (const role of ['technical_management', 'site_management', 'technician'] as const) {
      await change(role, 'work_order', { pattern: 'A-{number}' }).expect(403)
    }

    expect(
      (await change('management', 'work_order', { pattern: 'A-{year}-{number:3}' }).expect(200))
        .body,
    ).toMatchObject({ key: 'work_order', pattern: 'A-{year}-{number:3}', nextValue: 1 })
  })

  it('never hand out a number twice, whatever the pattern becomes', async () => {
    expect(await drawn('asset')).toBe('AN-00001')
    expect(await drawn('asset')).toBe('AN-00002')

    // A new pattern goes on from the counter: the number after it is new.
    await change('management', 'asset', { pattern: 'ANL-{number:3}' }).expect(200)
    expect(await drawn('asset')).toBe('ANL-003')

    // And the counter does not go back to a number that was handed out.
    const refused = await change('management', 'asset', {
      pattern: 'AN-{number:5}',
      nextValue: 1,
    }).expect(400)

    expect((refused.body as { message: string }).message).toMatch(/kann nur steigen/)
    expect(await drawn('asset')).toBe('ANL-004')

    // Raised, it carries on from there, as when the count of a predecessor goes on.
    await change('management', 'asset', { pattern: 'AN-{number:5}', nextValue: 413 }).expect(200)
    expect(await drawn('asset')).toBe('AN-00413')
  })
})

describe('the last backup (#127)', () => {
  it('is seen by the Leitung and by no other role', async () => {
    expect(
      (await http().get('/settings/backup').set(testIdentityHeader, by('management')).expect(200))
        .body,
    ).toEqual({ state: 'unknown' })

    for (const role of ['technical_management', 'site_management', 'technician'] as const) {
      await http().get('/settings/backup').set(testIdentityHeader, by(role)).expect(403)
    }
  })
})
