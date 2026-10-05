import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  applicationRights,
  missingRight,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { type Authentication, Database, rolesHeld } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { as, testIdentities } from '../api/test-identity.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
  testIdentityHeader,
} from '../database/test-database.js'
import { access, addStaffMember, createAuthentication, setUpInstance } from './access.js'

// The roles of a tenant are rows (ADR 0010 in the repository opengewerk), and
// the mechanism around them is the foundation's, tested there with an
// application that is nobody's. What is tested here is what only this
// application can get wrong: that a tenant of it starts with its four roles,
// that the rows say what the code says, and that the routes of the foundation
// answer each of the four the way section 7 of the concept says they do.
//
// Against a real database, built from the migrations of this application.
// Whoever asks is named in a header here; the test beside this one signs in.

const password = 'a password long enough for a test'

let admin: Pool
let database: Database
let authentication: Authentication
let app: INestApplication

/** The tenant of a test and the one who leads it, as the first run leaves them. */
let tenantId: TenantId
let leadId: string

beforeAll(async () => {
  admin = await connect()
})

beforeEach(async () => {
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  database = Database.connect(applicationDatabaseUrl())
  authentication = createAuthentication({
    database,
    secret: 's'.repeat(64),
    trustedOrigins: ['https://haustechnik.example.de'],
    rateLimited: false,
  })

  const firstRun = await setUpInstance(authentication, database, {
    company: 'Klinikum Musterstadt',
    name: 'Erika Beispiel',
    email: 'leitung@klinikum.example',
    password,
  })

  tenantId = firstRun.tenantId
  leadId = firstRun.userId

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

afterAll(async () => {
  await admin.end()
})

/** A request as somebody with these roles, for the tenant of the test. */
function asking(userId: string, ...roles: RoleKey[]) {
  const header = as(tenantId, userId, ...roles)

  return {
    get: (path: string) => request(app.getHttpServer()).get(path).set(testIdentityHeader, header),
    post: (path: string, body: object) =>
      request(app.getHttpServer()).post(path).set(testIdentityHeader, header).send(body),
    patch: (path: string, body: object) =>
      request(app.getHttpServer()).patch(path).set(testIdentityHeader, header).send(body),
    put: (path: string) => request(app.getHttpServer()).put(path).set(testIdentityHeader, header),
  }
}

/** Somebody else who works for the tenant, put in the way the command does it. */
async function member(email: string, ...roles: RoleKey[]): Promise<string> {
  const { userId } = await addStaffMember(authentication, database, {
    email,
    name: email,
    password,
    tenantId,
    roles,
  })

  return userId
}

async function rolesOfMembership(userId: string): Promise<{ roles: string[]; blocked: boolean }> {
  const { rows } = await admin.query<{ roles: string[]; blocked: boolean }>(
    'select roles, blocked_at is not null as blocked from memberships where tenant_id = $1 and user_id = $2',
    [tenantId, userId],
  )

  if (!rows[0]) {
    throw new Error(`No membership of ${userId}.`)
  }

  return rows[0]
}

describe('a tenant that the first run brought into being', () => {
  it('has the four roles of this application as rows of its own', async () => {
    const { rows } = await admin.query(
      `select key, label, rights, leads, second_factor as "secondFactor"
         from tenant_roles where tenant_id = $1 order by id`,
      [tenantId],
    )

    expect(rows).toEqual(
      shippedRoles.map((role) => ({
        key: role.key,
        label: role.label,
        rights: [...role.rights],
        leads: role.leads,
        secondFactor: role.secondFactor,
      })),
    )
  })

  it('is led by its first account, which also belongs to the administration of the instance', async () => {
    expect(await rolesOfMembership(leadId)).toEqual({ roles: ['management'], blocked: false })

    const { rows } = await admin.query('select user_id from instance_operators')

    expect(rows).toEqual([{ user_id: leadId }])
  })

  /**
   * What somebody may do is read from the rows on every request and not from
   * the code. For a tenant that has the roles it started with, both say the
   * same; this is the test that holds one against the other, and what makes
   * it honest that the tests around it name a role in a header and take the
   * rights from the code.
   */
  it.each(roleKeys)(
    'holds for "%s" in its rows what the code says the role may do',
    async (key) => {
      const held = await database.forTenant({ tenantId }, (tx) => rolesHeld(tx, tenantId, [key]))

      expect(held.map((role) => role.key)).toEqual([key])
      expect(applicationRights.sumOf(held).rights).toEqual([...rightsOfRoles([key])])
    },
  )

  it('lists its roles for whoever gives one out, under the names its people know them by', async () => {
    const answer = await asking(leadId, 'management').get('/staff/roles').expect(200)

    expect(answer.body).toEqual(
      shippedRoles.map((role) => ({
        key: role.key,
        label: role.label,
        rights: [...role.rights],
        leads: role.leads,
        secondFactor: role.secondFactor,
      })),
    )
  })
})

describe('who works for a tenant', () => {
  it('is for "Leitung" to see and to decide', async () => {
    const list = await asking(leadId, 'management').get('/staff').expect(200)

    expect(
      (list.body as { email: string; roles: string[] }[]).map(({ email, roles }) => ({
        email,
        roles,
      })),
    ).toEqual([{ email: 'leitung@klinikum.example', roles: ['management'] }])

    const invited = await asking(leadId, 'management')
      .post('/staff', {
        email: 'technik@klinikum.example',
        name: 'Max Beispiel',
        roles: ['technician'],
      })
      .expect(201)

    // Handed over as a link: this application sends no mail yet.
    expect(typeof (invited.body as { token: unknown }).token).toBe('string')
  })

  /**
   * Somebody who can hand out roles can hand themselves the one that leads,
   * so the rights about who works for a tenant stay with that role alone.
   * Each of the other three is refused both ways, in the words of this
   * application: what the access may not do, and who gives out the roles.
   */
  it.each(roleKeys.filter((key) => key !== 'management'))(
    'is not for "%s" to see or to decide',
    async (key) => {
      const userId = await member(`${key}@klinikum.example`, key)

      const reading = await asking(userId, key).get('/staff').expect(403)

      expect((reading.body as { message: string }).message).toBe(missingRight('membership.read'))

      const writing = await asking(userId, key)
        .post('/staff', { email: 'neu@klinikum.example', name: 'Neu', roles: ['technician'] })
        .expect(403)

      expect((writing.body as { message: string }).message).toBe(missingRight('membership.write'))

      // And it has not happened: the refusal came before anything was written.
      const { rows } = await admin.query('select email from invitations where tenant_id = $1', [
        tenantId,
      ])

      expect(rows).toEqual([])
    },
  )

  it('is decided among the roles the tenant has, and a key it has no row for is refused by name', async () => {
    const userId = await member('technik@klinikum.example', 'technician')

    const refused = await asking(leadId, 'management')
      .patch(`/staff/${userId}`, { roles: ['owner'] })
      .expect(400)

    expect((refused.body as { message: string }).message).toBe(
      'Unbekannte Rollen: owner. Es gibt management, technical_management, site_management, technician.',
    )
    expect(await rolesOfMembership(userId)).toEqual({ roles: ['technician'], blocked: false })

    await asking(leadId, 'management')
      .patch(`/staff/${userId}`, { roles: ['site_management'] })
      .expect(200)

    expect(await rolesOfMembership(userId)).toEqual({ roles: ['site_management'], blocked: false })
  })
})

/**
 * Whoever decides who works for a tenant puts the name and the address of an
 * account right (opengewerk-haustechnik#84). The route and its rules are the
 * foundation's and tested there. Here: that the database of this application
 * has the table the route writes into, with the trigger that puts a
 * correction into the log of the tenant, and that a refusal comes in the
 * words of this application.
 */
describe('the name and the address of an account', () => {
  async function accountOf(userId: string): Promise<{ name: string; email: string }> {
    const { rows } = await admin.query<{ name: string; email: string }>(
      'select name, email from auth_users where id = $1',
      [userId],
    )

    if (!rows[0]) {
      throw new Error(`No account ${userId}.`)
    }

    return rows[0]
  }

  /** What the tenant wrote down about corrections, the oldest first. */
  async function corrections(): Promise<unknown[]> {
    const { rows } = await admin.query(
      `select user_id, name_before, name_after, email_before, email_after
         from account_corrections
        where tenant_id = $1
        order by created_at, id`,
      [tenantId],
    )

    return rows
  }

  it('are put right by "Leitung", and the correction stands in the log of the tenant', async () => {
    const userId = await member('technik@klinikum.example', 'technician')

    const answer = await asking(leadId, 'management')
      .patch(`/staff/${userId}/account`, { name: 'Max Beispiel' })
      .expect(200)

    const corrected = { name: 'Max Beispiel', email: 'technik@klinikum.example' }

    expect(answer.body).toEqual({ userId, ...corrected })
    expect(await accountOf(userId)).toEqual(corrected)
    expect(await corrections()).toEqual([
      {
        user_id: userId,
        name_before: 'technik@klinikum.example',
        name_after: 'Max Beispiel',
        email_before: null,
        email_after: null,
      },
    ])

    // The row reached the log of the tenant, with the right it was made under.
    const { rows } = await admin.query(
      `select field, new_value, reason
         from audit_entries
        where tenant_id = $1 and table_name = 'account_corrections'
          and field in ('name_before', 'name_after')
        order by field`,
      [tenantId],
    )

    expect(rows).toEqual([
      { field: 'name_after', new_value: 'Max Beispiel', reason: 'membership.write' },
      { field: 'name_before', new_value: 'technik@klinikum.example', reason: 'membership.write' },
    ])
  })

  it.each(roleKeys.filter((key) => key !== 'management'))(
    'are not for "%s" to put right',
    async (key) => {
      const userId = await member('technik@klinikum.example', 'technician')
      const asker = await member(`${key}@klinikum.example`, key)

      const refused = await asking(asker, key)
        .patch(`/staff/${userId}/account`, { name: 'Max Beispiel' })
        .expect(403)

      expect((refused.body as { message: string }).message).toBe(missingRight('membership.write'))
      expect(await accountOf(userId)).toEqual({
        name: 'technik@klinikum.example',
        email: 'technik@klinikum.example',
      })
      expect(await corrections()).toEqual([])
    },
  )

  /**
   * The first account of an instance belongs to its administration as well,
   * so it is not this tenant's alone, and neither is one that works for a
   * second tenant. One sentence for both.
   */
  it('stay with the person where the account is not this tenant’s alone', async () => {
    const refused = await asking(leadId, 'management')
      .patch(`/staff/${leadId}/account`, { name: 'Erika Anders' })
      .expect(409)

    expect((refused.body as { message: string }).message).toBe(access.sentences.accountNotOnlyHere)
    expect(await accountOf(leadId)).toEqual({
      name: 'Erika Beispiel',
      email: 'leitung@klinikum.example',
    })
    expect(await corrections()).toEqual([])
  })
})

describe('the last one who leads a tenant', () => {
  it('is not given a lesser role, by anybody and not by themselves', async () => {
    const refused = await asking(leadId, 'management')
      .patch(`/staff/${leadId}`, { roles: ['technical_management'] })
      .expect(409)

    expect((refused.body as { message: string }).message).toBe(access.sentences.lastLead)
    expect(await rolesOfMembership(leadId)).toEqual({ roles: ['management'], blocked: false })
  })

  it('is not shut out', async () => {
    const refused = await asking(leadId, 'management').put(`/staff/${leadId}/block`).expect(409)

    expect((refused.body as { message: string }).message).toBe(access.sentences.lastLead)
    expect(await rolesOfMembership(leadId)).toEqual({ roles: ['management'], blocked: false })
  })

  /**
   * The other three roles do not count, however much they may do: leading is
   * a flag of the role and not what its rights add up to.
   */
  it('stays the last one beside somebody with every other role', async () => {
    await member(
      'alles-andere@klinikum.example',
      'technical_management',
      'site_management',
      'technician',
    )

    await asking(leadId, 'management')
      .patch(`/staff/${leadId}`, { roles: ['technical_management'] })
      .expect(409)
  })

  it('may step down once somebody else leads as well', async () => {
    await member('zweite-leitung@klinikum.example', 'management')

    await asking(leadId, 'management')
      .patch(`/staff/${leadId}`, { roles: ['technical_management'] })
      .expect(200)

    expect(await rolesOfMembership(leadId)).toEqual({
      roles: ['technical_management'],
      blocked: false,
    })
  })
})
