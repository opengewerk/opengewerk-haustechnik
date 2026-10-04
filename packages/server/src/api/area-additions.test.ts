import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  everyAreaSentence,
  type InvitationId,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { completeRoles, Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { areaAdditions } from '../areas/additions.js'
import { access, createAuthentication } from '../authentication/access.js'
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

/**
 * The areas somebody holds in, said with their role (#84, section 2.8 of the
 * concept): with the invitation, so that they hold from the first request on,
 * and with a change of roles, so that both are saved or neither.
 *
 * The routes that invite, redeem and change roles are the foundation's. What
 * is asked here is what this application writes beside them, through the seam
 * the foundation calls inside its own transaction (ADR 0010 in the repository
 * opengewerk).
 */

/** Two areas to begin with, north and south. */
const large = newId<'tenant'>() as TenantId
/** One area, the one a tenant begins with. */
const small = newId<'tenant'>() as TenantId
/** The tenant next door, with an area of its own. */
const nextDoor = newId<'tenant'>() as TenantId

let north = ''
let south = ''
let theirs = ''
let only = ''

const people = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Murat Yilmaz' },
  'u-back': { role: 'technician', name: 'Lena Vogt' },
} as const satisfies Readonly<Record<string, { role: RoleKey; name: string }>>

type Person = keyof typeof people

const password = 'ein-ordentlich-langes-passwort'
const unknownArea = 'Den Bereich gibt es bei diesem Betreiber nicht.'

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function lead(tenantId: TenantId = large): string {
  return as(tenantId, 'u-lead', 'management')
}

let counter = 0

/** An address nobody has been invited under yet. */
function fresh(): string {
  counter += 1

  return `neu-${String(counter)}@beispielstadt.example`
}

interface Invited {
  readonly id: string
  readonly token: string
  readonly email: string
}

/** Invites somebody with a role and with what the request says about areas. */
function inviting(
  role: RoleKey,
  additions: unknown,
  { email = fresh(), tenantId = large }: { email?: string; tenantId?: TenantId } = {},
) {
  const body: Record<string, unknown> = { email, name: 'Neu im Haus', roles: [role] }

  if (additions !== undefined) {
    body.additions = additions
  }

  return http().post('/staff').set(testIdentityHeader, lead(tenantId)).send(body)
}

async function invite(
  role: RoleKey,
  additions: unknown,
  options: { email?: string; tenantId?: TenantId } = {},
): Promise<Invited> {
  const answer = await inviting(role, additions, options).expect(201)

  return answer.body as Invited
}

/** Takes an invitation up as somebody new, and says who they are from then on. */
async function join(invitation: Invited): Promise<string> {
  await http().post(`/invitation/${invitation.token}`).send({ password }).expect(201)

  const { rows } = await admin.query<{ id: string }>('select id from auth_users where email = $1', [
    invitation.email,
  ])

  return rows[0]?.id ?? ''
}

/** What the open invitations of a tenant say about areas, by invitation. */
async function said(tenantId: TenantId = large) {
  const answer = await http()
    .get('/areas/invitations')
    .set(testIdentityHeader, lead(tenantId))
    .expect(200)

  return new Map(
    (answer.body as { invitationId: string; all: boolean; areaIds: string[] }[]).map((entry) => [
      entry.invitationId,
      { all: entry.all, areaIds: [...entry.areaIds].sort() },
    ]),
  )
}

/** The areas somebody holds in, as the list of who works for the tenant names them. */
async function areasOf(userId: string, tenantId: TenantId = large) {
  const answer = await http()
    .get('/areas/members')
    .set(testIdentityHeader, lead(tenantId))
    .expect(200)
  const found = (answer.body as { userId: string; all: boolean; areaIds: string[] }[]).find(
    (member) => member.userId === userId,
  )

  return found ? { all: found.all, areaIds: [...found.areaIds].sort() } : undefined
}

/** The roles somebody holds, as the database has them. */
async function rolesOf(userId: string, tenantId: TenantId = large): Promise<readonly string[]> {
  const { rows } = await admin.query<{ roles: string[] }>(
    'select roles from memberships where tenant_id = $1 and user_id = $2',
    [tenantId, userId],
  )

  return rows[0]?.roles ?? []
}

/** How many invitations there are for an address, used or not. */
async function invitationsFor(email: string): Promise<number> {
  const { rows } = await admin.query<{ found: number }>(
    'select count(*)::int as found from invitations where email = $1',
    [email],
  )

  return rows[0]?.found ?? 0
}

/** Gives somebody other roles, with what the request says about areas. */
function changing(userId: Person, roles: readonly RoleKey[], additions?: unknown) {
  return http()
    .patch(`/staff/${userId}`)
    .set(testIdentityHeader, lead())
    .send(additions === undefined ? { roles } : { roles, additions })
}

/** An area made through the API by the Leitung. */
async function areaNamed(name: string, tenantId: TenantId = large): Promise<string> {
  const created = await http()
    .post('/areas')
    .set(testIdentityHeader, lead(tenantId))
    .send({ name })
    .expect(201)

  return created.body.id as string
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    large,
    'Liegenschaften Beispielstadt',
    small,
    'Wohnbau Nord eG',
    nextDoor,
    'Hausverwaltung Nebenan',
  ])

  // The large tenant and the one next door have their areas before anybody
  // works for them, so that neither begins with the one a tenant gets with
  // its first membership. The small one begins with exactly that.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd'), ($2, 'Nebenan')
     returning id, name`,
    [large, nextDoor],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''
  theirs = rows.find((row) => row.name === 'Nebenan')?.id ?? ''

  for (const [userId, { role, name }] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      name,
      `${userId}@beispielstadt.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      large,
      userId,
      [role],
    ])
  }

  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-lead', '{management}')`,
    [small],
  )
  only =
    (await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [small]))
      .rows[0]?.id ?? ''

  // In the large tenant the Objektleitung and two of the Haustechnik work in
  // the north.
  await admin.query(
    `insert into member_areas (tenant_id, user_id, area_id)
     values ($1, 'u-site', $2), ($1, 'u-tech', $2), ($1, 'u-back', $2)`,
    [large, north],
  )

  database = Database.connect(applicationDatabaseUrl())
  // The four roles a tenant starts with, as rows: an invitation and a change
  // of roles are held against them.
  await completeRoles(database, access)

  // The real authentication behind the header that names somebody: taking an
  // invitation up hashes a password, and that is the library's.
  const authentication = createAuthentication({
    database,
    secret: 't'.repeat(64),
    trustedOrigins: [],
    rateLimited: false,
  })
  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { authentication })],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('an invitation', () => {
  it('keeps the areas it names until it is taken up', async () => {
    const invitation = await invite('technician', { all: false, areaIds: [south] })

    expect((await said()).get(invitation.id)).toEqual({ all: false, areaIds: [south] })
  })

  it('keeps every area, and none by name beside it', async () => {
    const invitation = await invite('site_management', { all: true, areaIds: [north] })

    expect((await said()).get(invitation.id)).toEqual({ all: true, areaIds: [] })
    expect(
      (
        await admin.query('select 1 from invitation_areas where invitation_id = $1', [
          invitation.id,
        ])
      ).rowCount,
    ).toBe(0)
  })

  it('keeps that it names none', async () => {
    const invitation = await invite('technician', { all: false, areaIds: [] })

    expect((await said()).get(invitation.id)).toEqual({ all: false, areaIds: [] })
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
  ])('keeps nothing where the request says %s about areas', async (_, additions) => {
    const invitation = await invite('technician', additions)

    expect((await said()).has(invitation.id)).toBe(false)
    expect(
      (
        await admin.query('select 1 from invitation_area_choices where invitation_id = $1', [
          invitation.id,
        ])
      ).rowCount,
    ).toBe(0)
  })

  it.each([
    ['without saying whether all', { areaIds: [] }, 'all fehlt: alle Bereiche oder die genannten.'],
    ['with something that is no choice', 'Nord', 'all fehlt: alle Bereiche oder die genannten.'],
    ['with an area that is no id', { all: false, areaIds: ['Nord'] }, unknownArea],
    ['with areas that are no list', { all: false, areaIds: 'alle' }, unknownArea],
  ])('is not written %s', async (_, additions, sentence) => {
    const email = fresh()
    const refused = await inviting('technician', additions, { email }).expect(400)

    expect(refused.body.message).toBe(sentence)
    expect(await invitationsFor(email)).toBe(0)
  })

  it('is not written with an area the tenant does not have, one of its neighbour included', async () => {
    for (const areaId of [newId<'area'>(), theirs]) {
      const email = fresh()
      const refused = await inviting(
        'technician',
        { all: false, areaIds: [north, areaId] },
        { email },
      ).expect(400)

      expect(refused.body.message).toBe(unknownArea)
      expect(await invitationsFor(email)).toBe(0)
    }
  })

  it.each(['management', 'technical_management'] as const)(
    'is not written with named areas for the %s, who holds in all of them',
    async (role) => {
      const email = fresh()
      const refused = await inviting(role, { all: false, areaIds: [north] }, { email }).expect(400)

      expect(refused.body.message).toBe(everyAreaSentence)
      expect(await invitationsFor(email)).toBe(0)

      const invitation = await invite(role, { all: true }, { email })

      expect((await said()).get(invitation.id)).toEqual({ all: true, areaIds: [] })
    },
  )

  it('that replaces another for the same address is the one whose areas are listed', async () => {
    const email = fresh()
    const first = await invite('technician', { all: false, areaIds: [north] }, { email })
    const second = await invite('technician', { all: false, areaIds: [south] }, { email })
    const listed = await said()

    expect(listed.has(first.id)).toBe(false)
    expect(listed.get(second.id)).toEqual({ all: false, areaIds: [south] })
  })

  it('that was called back or has run out is no longer listed', async () => {
    const calledBack = await invite('technician', { all: false, areaIds: [north] })
    const ranOut = await invite('technician', { all: false, areaIds: [north] })

    await http()
      .delete(`/staff/invitations/${calledBack.id}`)
      .set(testIdentityHeader, lead())
      .expect(200)
    await admin.query(
      `update invitations set expires_at = now() - interval '1 minute' where id = $1`,
      [ranOut.id],
    )

    const listed = await said()

    expect(listed.has(calledBack.id)).toBe(false)
    expect(listed.has(ranOut.id)).toBe(false)
  })

  it('is listed for its own tenant and no other', async () => {
    const here = await invite('technician', { all: false, areaIds: [south] })
    const there = await invite('technician', { all: false, areaIds: [only] }, { tenantId: small })

    expect((await said(large)).has(there.id)).toBe(false)
    expect((await said(small)).has(here.id)).toBe(false)
    expect((await said(small)).get(there.id)).toEqual({ all: false, areaIds: [only] })
  })

  it('loses an area that is removed and keeps that it named some', async () => {
    const passing = await areaNamed('Zeitweise')
    const invitation = await invite('technician', { all: false, areaIds: [passing, south] })

    await http().delete(`/areas/${passing}`).set(testIdentityHeader, lead()).expect(200)

    expect((await said()).get(invitation.id)).toEqual({ all: false, areaIds: [south] })
  })
})

describe('whoever takes an invitation up', () => {
  it('holds in the areas it named, from the first request on', async () => {
    const userId = await join(await invite('technician', { all: false, areaIds: [south] }))

    expect(await areasOf(userId)).toEqual({ all: false, areaIds: [south] })

    const inSight = await http()
      .get('/areas')
      .set(testIdentityHeader, as(large, userId, 'technician'))
      .expect(200)

    expect((inSight.body as { name: string }[]).map((area) => area.name)).toEqual(['Süd'])
  })

  it('holds in every area where it said so, in place of the one a new membership is given', async () => {
    // With a single area a new membership is given that one by name.
    const userId = await join(await invite('site_management', { all: true }, { tenantId: small }))

    expect(await areasOf(userId, small)).toEqual({ all: true, areaIds: [] })
  })

  it('holds in none where the only area it named was removed meanwhile', async () => {
    // In the tenant with one area, so that what a new membership is given
    // would be that area: the invitation said otherwise, and it holds.
    const passing = await areaNamed('Zeitweise', small)
    const invitation = await invite(
      'technician',
      { all: false, areaIds: [passing] },
      { tenantId: small },
    )

    await http().delete(`/areas/${passing}`).set(testIdentityHeader, lead(small)).expect(200)

    expect((await said(small)).get(invitation.id)).toEqual({ all: false, areaIds: [] })

    const userId = await join(invitation)

    expect(await areasOf(userId, small)).toEqual({ all: false, areaIds: [] })
  })

  it('begins with what a new membership is given where the invitation said nothing', async () => {
    const one = await join(await invite('technician', undefined, { tenantId: small }))
    const several = await join(await invite('technician', undefined))
    const leading = await join(await invite('technical_management', undefined))

    // The one area of a tenant that has one, none where there are more, and
    // every area for whoever answers for the duties across all of them.
    expect(await areasOf(one, small)).toEqual({ all: false, areaIds: [only] })
    expect(await areasOf(several)).toEqual({ all: false, areaIds: [] })
    expect(await areasOf(leading)).toEqual({ all: true, areaIds: [] })
  })
})

describe('a membership that is let back in by an invitation', () => {
  /** What the foundation hands on once the membership is written, for somebody who was here before. */
  function rejoining(userId: Person, roles: readonly RoleKey[], invitationId: string) {
    return database.forTenant({ tenantId: large, userId, reason: 'invitation.redeem' }, (tx) =>
      areaAdditions.joined(tx, {
        tenantId: large,
        userId,
        invitationId: invitationId as InvitationId,
        roles,
      }),
    )
  }

  it('keeps the areas it had where the invitation said nothing', async () => {
    const invitation = await invite('technician', undefined)
    const before = await areasOf('u-back')

    await rejoining('u-back', ['technician'], invitation.id)

    // Named and not empty, so that neither "none" nor "all" would pass for it.
    expect(before).toEqual({ all: false, areaIds: [north] })
    expect(await areasOf('u-back')).toEqual(before)
  })

  it('takes the areas the invitation named in place of the ones it had', async () => {
    const invitation = await invite('technician', { all: false, areaIds: [south] })

    await rejoining('u-back', ['technician'], invitation.id)

    expect(await areasOf('u-back')).toEqual({ all: false, areaIds: [south] })
  })

  it('holds in every area with roles that do, whatever was named for it before', async () => {
    const invitation = await invite('technical_management', undefined)

    await admin.query(
      `update memberships set roles = '{technical_management}' where tenant_id = $1 and user_id = 'u-back'`,
      [large],
    )
    await rejoining('u-back', ['technical_management'], invitation.id)

    expect(await areasOf('u-back')).toEqual({ all: true, areaIds: [] })
  })
})

describe('a change of roles', () => {
  it('takes the areas named with it along, in the one request', async () => {
    const changed = await changing('u-site', ['technician'], {
      all: false,
      areaIds: [south],
    }).expect(200)

    expect(changed.body.roles).toEqual(['technician'])
    expect(await areasOf('u-site')).toEqual({ all: false, areaIds: [south] })
  })

  /** A change that is refused: the roles, what is said about areas, and the sentence. */
  type Refused = readonly [
    string,
    readonly RoleKey[],
    { readonly all?: boolean; readonly areaIds: readonly ('north' | 'theirs')[] },
    string,
  ]

  const refusedChanges: readonly Refused[] = [
    [
      'named areas for roles that hold in all of them',
      ['technical_management'],
      { all: false, areaIds: ['north'] },
      everyAreaSentence,
    ],
    [
      'an area the tenant does not have',
      ['site_management'],
      { all: false, areaIds: ['theirs'] },
      unknownArea,
    ],
    [
      'something that is no choice of areas',
      ['site_management'],
      { areaIds: ['north'] },
      'all fehlt: alle Bereiche oder die genannten.',
    ],
  ]

  it.each(refusedChanges)(
    'is not written with %s, and neither are the roles',
    async (_, roles, additions, sentence) => {
      const before = { roles: await rolesOf('u-tech'), areas: await areasOf('u-tech') }
      const ids = { north, theirs }
      const refused = await changing('u-tech', roles, {
        ...additions,
        areaIds: additions.areaIds.map((name) => ids[name]),
      }).expect(400)

      expect(refused.body.message).toBe(sentence)
      // The roles were changed in the same transaction and went back with it.
      expect(before.roles).toEqual(['technician'])
      expect({ roles: await rolesOf('u-tech'), areas: await areasOf('u-tech') }).toEqual(before)
    },
  )

  it('gives every area to whoever comes to hold in all of them, with nothing said', async () => {
    expect(await areasOf('u-tech')).toEqual({ all: false, areaIds: [north] })

    await changing('u-tech', ['technical_management']).expect(200)

    expect(await areasOf('u-tech')).toEqual({ all: true, areaIds: [] })
  })

  it('leaves the areas as they are where nothing is said and the roles hold in the ones named', async () => {
    const before = await areasOf('u-site')

    await changing('u-site', ['site_management']).expect(200)

    // Named and not empty, so that neither "none" nor "all" would pass for it.
    expect([before?.all, before?.areaIds.length]).toEqual([false, 1])
    expect(await areasOf('u-site')).toEqual(before)
  })

  it('leaves every area to somebody who no longer leads, until theirs are named', async () => {
    await changing('u-duties', ['technician']).expect(200)

    expect(await areasOf('u-duties')).toEqual({ all: true, areaIds: [] })

    await changing('u-duties', ['technician'], { all: false, areaIds: [north] }).expect(200)

    expect(await areasOf('u-duties')).toEqual({ all: false, areaIds: [north] })
  })
})
