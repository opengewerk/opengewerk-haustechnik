import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  leadingRights,
  missingRight,
  offerableRights,
  type RoleEntry,
  type RoleKey,
  shippedRoles,
  type TenantId,
  withImplied,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addStaffMember } from '../authentication/access.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'
import { type TestInstance, testInstance } from './test-instance.js'

/**
 * The roles of a tenant and those it makes for itself (#346, section 7 of the
 * concept): listed for whoever looks at the accesses, made, changed and
 * removed by whoever keeps them, a shipped role left as it is, no right of
 * the Leitung in a role of the tenant's own, nothing across tenants, and a
 * change that holds at the next request of everybody with the role.
 */

const north = newId<'tenant'>() as TenantId
const south = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-tech': 'technician',
}

type Person = keyof typeof people & string

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: Person, tenantId: TenantId = north): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

/** A role of the tenant's own made through the route by the Leitung; its entry. */
async function made(
  body: object,
  tenantId: TenantId = north,
  status = 201,
): Promise<RoleEntry & { message?: string }> {
  return (
    await http()
      .post('/roles')
      .set(testIdentityHeader, by('u-lead', tenantId))
      .send(body)
      .expect(status)
  ).body
}

async function listOf(tenantId: TenantId = north): Promise<RoleEntry[]> {
  return (await http().get('/roles').set(testIdentityHeader, by('u-lead', tenantId)).expect(200))
    .body
}

async function rowOf(tenantId: TenantId, key: string) {
  const { rows } = await admin.query<{
    label: string
    rights: string[]
    leads: boolean
    second_factor: boolean
    offered_rights: string[]
  }>(
    `select label, rights, leads, second_factor, offered_rights from tenant_roles
      where tenant_id = $1 and key = $2`,
    [tenantId, key],
  )

  return rows[0]
}

beforeAll(async () => {
  admin = await connect()
})

beforeEach(async () => {
  await resetToMigrated()

  for (const [tenantId, name] of [
    [north, 'Wohnbau Nord eG'],
    [south, 'Gebäudeverwaltung Süd'],
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

  for (const [userId, role] of Object.entries(people)) {
    await admin.query(
      'insert into auth_users (id, name, email) values ($1, $2, $3) on conflict do nothing',
      [userId, userId, `${userId}@beispiel.example`],
    )

    for (const tenantId of [north, south]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterEach(async () => {
  await app.close()
  await database.close()
})

describe('the roles of a tenant', () => {
  it('are listed for whoever looks at the accesses, with how many hold each, and for nobody else', async () => {
    const roles = await listOf()

    expect(roles.map((role) => [role.key, role.shipped, role.holders, role.leads])).toEqual([
      ['management', true, 1, true],
      ['technical_management', true, 1, false],
      ['site_management', true, 0, false],
      ['technician', true, 1, false],
      ['reporter', true, 0, false],
      ['auditor', true, 0, false],
    ])
    expect(roles.every((role) => role.newRights.length === 0)).toBe(true)

    const refused = await http().get('/roles').set(testIdentityHeader, by('u-duties')).expect(403)

    expect(refused.body.message).toBe(missingRight('membership.read'))
  })

  it('makes a role of its own with what comes with its rights, for whoever keeps the accesses only', async () => {
    const role = await made({
      label: '  Hausmeisterei ',
      rights: ['asset.write', 'store.write'],
      secondFactor: true,
    })

    expect(role.key).toMatch(/^own-[0-9a-f]{12}$/)
    expect(role).toMatchObject({
      label: 'Hausmeisterei',
      rights: withImplied(['asset.write', 'store.write']),
      leads: false,
      secondFactor: true,
      shipped: false,
      holders: 0,
      invited: 0,
      newRights: [],
    })
    expect(await rowOf(north, role.key)).toEqual({
      label: 'Hausmeisterei',
      rights: ['asset.read', 'asset.write', 'store.read', 'store.write'],
      leads: false,
      second_factor: true,
      offered_rights: [...offerableRights],
    })
    expect((await listOf()).at(-1)?.key).toBe(role.key)

    const refused = await http()
      .post('/roles')
      .set(testIdentityHeader, by('u-duties'))
      .send({ label: 'Lager', rights: ['store.read'] })
      .expect(403)

    expect(refused.body.message).toBe(missingRight('membership.write'))

    // Two roles of a tenant are not called the same, whatever the case.
    for (const label of ['hausmeisterei', 'Leitung']) {
      expect((await made({ label, rights: ['store.read'] }, north, 409)).message).toBe(
        `Eine Rolle „${label}“ gibt es bei diesem Betreiber schon.`,
      )
    }
  })

  it('gives a role of its own no right that stays with the Leitung, and never lets it lead', async () => {
    for (const right of leadingRights) {
      await made({ label: `Mit ${right}`, rights: ['store.read', right] }, north, 400)
    }

    expect(
      (await made({ label: 'Führend', rights: ['store.read'], leads: true }, north, 400)).message,
    ).toBe('Unbekannte Angaben: leads.')

    const role = await made({ label: 'Lager', rights: ['store.read'] })

    await http()
      .patch(`/roles/${role.key}`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ rights: ['store.read', 'audit.read'] })
      .expect(400)
      .expect((answer) => {
        expect(answer.body.message).toBe('„Das Änderungsprotokoll einsehen“ bleibt der Leitung.')
      })

    const row = await rowOf(north, role.key)

    expect({ rights: row?.rights, leads: row?.leads }).toEqual({
      rights: ['store.read'],
      leads: false,
    })
  })

  it('changes a role of its own, which leaves what is new for it behind, and leaves a shipped role as it is', async () => {
    const role = await made({ label: 'Lager', rights: ['store.read'] })

    // A right a later version brought: the role was saved before there was one.
    await admin.query(
      `update tenant_roles set offered_rights = array_remove(offered_rights, 'contractor.read')
        where tenant_id = $1 and key = $2`,
      [north, role.key],
    )
    expect((await listOf()).find((each) => each.key === role.key)?.newRights).toEqual([
      'contractor.read',
    ])

    const changed = (
      await http()
        .patch(`/roles/${role.key}`)
        .set(testIdentityHeader, by('u-lead'))
        .send({ label: 'Lagerverwaltung', rights: ['store.write'], secondFactor: true })
        .expect(200)
    ).body as RoleEntry

    expect(changed).toMatchObject({
      label: 'Lagerverwaltung',
      rights: ['store.read', 'store.write'],
      secondFactor: true,
      newRights: [],
    })

    for (const key of ['technician', 'management']) {
      await http()
        .patch(`/roles/${key}`)
        .set(testIdentityHeader, by('u-lead'))
        .send({ rights: ['store.read'] })
        .expect(409)
        .expect((answer) => {
          expect(answer.body.message).toBe(
            'Eine mitgelieferte Rolle bleibt, wie sie ist. Eine eigene Rolle kann von ihr ausgehen und dann anders zugeschnitten werden.',
          )
        })
      await http().delete(`/roles/${key}`).set(testIdentityHeader, by('u-lead')).expect(409)
    }

    expect((await rowOf(north, 'technician'))?.rights).toEqual([
      ...(shippedRoles.find((each) => each.key === 'technician')?.rights ?? []),
    ])
  })

  it('removes a role of its own only once no membership and no open invitation names it', async () => {
    const role = await made({ label: 'Lager', rights: ['store.read'] })
    const remove = () => http().delete(`/roles/${role.key}`).set(testIdentityHeader, by('u-lead'))

    await admin.query(
      `update memberships set roles = array_append(roles, $3) where tenant_id = $1 and user_id = $2`,
      [north, 'u-tech', role.key],
    )
    expect((await remove().expect(409)).body.message).toBe(
      'Die Rolle ist noch 1 Zugang zugeordnet. Erst eine andere Rolle geben, dann entfernen.',
    )
    expect((await listOf()).find((each) => each.key === role.key)?.holders).toBe(1)

    await admin.query(
      `update memberships set roles = array_remove(roles, $3) where tenant_id = $1 and user_id = $2`,
      [north, 'u-tech', role.key],
    )
    await admin.query(
      `insert into invitations (tenant_id, email, name, roles, token_hash, invited_by, expires_at)
       values ($1, 'neu@beispiel.example', 'Neu', $2, 'hash-of-a-token', 'u-lead', now() + interval '7 days')`,
      [north, [role.key]],
    )
    expect((await remove().expect(409)).body.message).toBe(
      'Die Rolle ist noch 1 offenen Einladung zugeordnet. Erst eine andere Rolle geben, dann entfernen.',
    )

    // An invitation that ran out names it no longer.
    await admin.query(
      `update invitations set expires_at = now() - interval '1 day' where tenant_id = $1`,
      [north],
    )
    await remove().expect(200)
    expect(await rowOf(north, role.key)).toBeUndefined()
    await remove().expect(404)
  })

  it('is not to be seen, changed or given in another tenant', async () => {
    const role = await made({ label: 'Lager', rights: ['store.read'] })

    expect((await listOf(south)).map((each) => each.key)).not.toContain(role.key)
    await http()
      .patch(`/roles/${role.key}`)
      .set(testIdentityHeader, by('u-lead', south))
      .send({ label: 'Fremd' })
      .expect(404)
    await http()
      .delete(`/roles/${role.key}`)
      .set(testIdentityHeader, by('u-lead', south))
      .expect(404)

    // Nor given to somebody there: the roles of a membership are those the tenant has a row for.
    await http()
      .patch('/staff/u-tech')
      .set(testIdentityHeader, by('u-lead', south))
      .send({ roles: [role.key] })
      .expect(400)

    expect((await rowOf(north, role.key))?.label).toBe('Lager')
    expect(await rowOf(south, role.key)).toBeUndefined()
  })

  it('with every right a role of its own may hold changes no evidence, replaces no signature and skips no acceptance', async () => {
    const role = await made({ label: 'Alles, was geht', rights: [...offerableRights] })

    expect([...role.rights].sort()).toEqual([...offerableRights].sort())
    expect(
      role.rights.every((right) =>
        (shippedRoles.find((each) => each.leads)?.rights ?? []).includes(right as never),
      ),
    ).toBe(true)

    await admin.query(`update memberships set roles = $3 where tenant_id = $1 and user_id = $2`, [
      north,
      'u-tech',
      [role.key],
    ])

    // Whatever a route does for such a role, the database refuses each of these to the application.
    // A signature and a decision go only with the last evidence of their activity, which a trigger
    // holds for every role (`activity-emptying.test.ts`).
    for (const statement of [
      `update evidence set result = 'failed'`,
      'delete from evidence',
      'update activity_signatures set signed_at = now()',
      `update work_order_decisions set decision = 'accepted'`,
    ]) {
      await expect(
        database.forTenant({ tenantId: north, userId: 'u-tech' }, (tx) => tx.execute(statement)),
      ).rejects.toMatchObject({ cause: { code: '42501' } })
    }

    // Removing evidence after its retention is confirmed by whoever leads, and such a role never does (#340).
    const { rows } = await database.forTenant({ tenantId: north, userId: 'u-tech' }, (tx) =>
      tx.execute<{ leads: boolean }>('select public.session_leads() as leads'),
    )

    expect(rows).toEqual([{ leads: false }])
  })
})

describe('a change of a role', () => {
  let instance: TestInstance | null = null

  afterEach(async () => {
    await instance?.close()
    instance = null
  })

  it('holds at the next request of everybody with the role', async () => {
    // Real sessions on the same database, whose rights are read from the rows on every request.
    instance = await testInstance(applicationDatabaseUrl())

    const password = 'a password long enough for a test'
    const tenantId = north

    // The Leitung makes the role through the route, as the screen does.
    const header = by('u-lead')
    const role = (
      await http()
        .post('/roles')
        .set(testIdentityHeader, header)
        .send({ label: 'Pforte', rights: ['location.read', 'sync.read'] })
        .expect(201)
    ).body as RoleEntry

    await addStaffMember(instance.authentication, instance.database, {
      email: 'pforte@klinikum.example',
      name: 'Paul Pforte',
      password,
      tenantId,
      roles: [role.key as RoleKey],
    })

    const cookies = await instance.signIn('pforte@klinikum.example', password)

    await instance.chooseTenant(cookies, tenantId)
    await instance.http().get('/properties').set('cookie', cookies).expect(200)

    const refused = await instance.http().get('/assets').set('cookie', cookies).expect(403)

    expect(refused.body.message).toBe(missingRight('asset.read'))

    // The Leitung gives the role the assets, and the same session reads them at its next request.
    await http()
      .patch(`/roles/${role.key}`)
      .set(testIdentityHeader, header)
      .send({ rights: ['location.read', 'asset.read', 'sync.read'] })
      .expect(200)
    await instance.http().get('/assets').set('cookie', cookies).expect(200)

    // And takes the places away again.
    await http()
      .patch(`/roles/${role.key}`)
      .set(testIdentityHeader, header)
      .send({ rights: ['asset.read', 'sync.read'] })
      .expect(200)
    await instance.http().get('/properties').set('cookie', cookies).expect(403)
  })
})
