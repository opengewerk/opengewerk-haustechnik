import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type AssignedToPerson,
  catalogueOf,
  type IsoDate,
  missingRight,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId, removedAddress } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { removeEndedAccounts } from '../memberships/end.js'
import { dayInGermany } from '../today.js'
import { access } from '../authentication/access.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The end of an access (sections 2.4 and 9 of the concept, #356): the period
 * after the last day and what still hangs on a person, through the routes;
 * the end and the removal as deadlines; and what the pass of the deadlines
 * does on the day after the last day and on the day the period ends.
 */

const tenant = newId<'tenant'>() as TenantId
const elsewhere = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  'u-third': { role: 'technician', name: 'Lena Vogt' },
  'u-both': { role: 'technician', name: 'Murat Yilmaz' },
}

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const inDays = (days: number): IsoDate => addDays(today, days)

let admin: Pool
let database: Database
let app: INestApplication
let property = ''
let asset = ''

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId]?.role as RoleKey)
}

async function pass(): Promise<void> {
  await runDeadlinesOf({ database, catalogue, now: () => new Date() }, tenant, new Date())
}

async function lastDay(userId: string, day: IsoDate | null, tenantId: TenantId = tenant) {
  await admin.query('update memberships set last_day = $3 where tenant_id = $1 and user_id = $2', [
    tenantId,
    userId,
    day,
  ])
}

/** An open activity at the asset, performed by one person and answered for by another. */
async function anActivity(performer: string | null, responsible: string | null): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             due_on, performer, performer_user_id, responsible_user_id)
     select tenant_id, property_id, area_id, id, 'inspection', 'Sichtprüfung', 'open', $2,
            case when $3::text is null then null else 'own_staff'::duty_performer end, $3, $4
       from assets where id = $1
     returning id`,
    [asset, inDays(20), performer, responsible],
  )

  return rows[0]?.id ?? ''
}

async function aRoundPlan(performer: string): Promise<string> {
  const { rows: templates } = await admin.query<{ id: string }>(
    `insert into round_templates (tenant_id, title)
     select tenant_id, 'Technikzentrale' from assets where id = $1 returning id`,
    [asset],
  )
  const { rows } = await admin.query<{ id: string }>(
    `insert into round_plans (tenant_id, property_id, area_id, template_id, rhythm, weekdays, starts_on,
                              performer_user_id)
     select tenant_id, property_id, area_id, $2, 'weekly', '{3}', '2026-09-01', $3 from assets where id = $1
     returning id`,
    [asset, templates[0]?.id, performer],
  )

  return rows[0]?.id ?? ''
}

async function aTask(assignee: string, createdBy: string | null): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into tasks (tenant_id, property_id, area_id, title, due_on, assignee_user_id)
     select tenant_id, property_id, area_id, 'Schlüssel abgeben', $2, $3 from assets where id = $1
     returning id`,
    [asset, inDays(5), assignee],
  )
  const id = rows[0]?.id ?? ''

  // Who made it is the server's to write, from the session; here behind it.
  await admin.query('update tasks set created_by = $2 where id = $1', [id, createdBy])

  return id
}

async function aDuty(responsible: string): Promise<string> {
  // One duty of a kind at an asset: the one of an earlier test goes.
  await admin.query('update duties set deleted_at = now() where asset_id = $1', [asset])
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, maximum_months, confirmed_by, responsible_user_id)
     select tenant_id, property_id, area_id, id, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24,
            'u-duties', $2
       from assets where id = $1
     returning id`,
    [asset, responsible],
  )

  return rows[0]?.id ?? ''
}

async function column(table: string, name: string, id: string): Promise<unknown> {
  const { rows } = await admin.query(`select ${name} as value from ${table} where id = $1`, [id])

  return rows[0]?.value
}

interface Listed {
  readonly kind: string
  readonly dueOn: IsoDate
  readonly membership?: { readonly personName: string | null }
}

async function deadlinesOf(header: string, kind: string): Promise<readonly Listed[]> {
  return (
    (await http().get(`/deadlines?kind=${kind}`).set(testIdentityHeader, header).expect(200))
      .body as {
      rows: Listed[]
    }
  ).rows
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const [id, name] of [
    [tenant, 'Wohnbau Nord eG'],
    [elsewhere, 'Wohnbau Süd eG'],
  ] as const) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [id, name])

    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [person.role],
    ])
  }

  // Somebody who works for the operator next door as well.
  await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
    elsewhere,
    'u-both',
    ['technician'],
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, by('u-duties')).send(body).expect(201)).body.id
  property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  asset = await made(`/buildings/${building}/assets`, { kind: 'probe.elevator', name: 'Aufzug' })
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the period after the end of an access (#356)', () => {
  it('is ninety days until the operator sets another, from one to 3650, set by whoever keeps the accesses', async () => {
    expect(
      (await http().get('/settings/memberships').set(testIdentityHeader, by('u-lead')).expect(200))
        .body,
    ).toEqual({ removalDays: 90, standard: true })

    const refused = await http()
      .put('/settings/memberships')
      .set(testIdentityHeader, by('u-duties'))
      .send({ removalDays: 30 })
      .expect(403)

    expect(refused.body.message).toBe(missingRight('membership.write'))

    for (const wrong of [0, 3651, 2.5, '30', null]) {
      await http()
        .put('/settings/memberships')
        .set(testIdentityHeader, by('u-lead'))
        .send({ removalDays: wrong })
        .expect(400)
    }

    expect(
      (
        await http()
          .put('/settings/memberships')
          .set(testIdentityHeader, by('u-lead'))
          .send({ removalDays: 30 })
          .expect(200)
      ).body,
    ).toEqual({ removalDays: 30, standard: false })
    expect(
      (await http().get('/settings/memberships').set(testIdentityHeader, by('u-lead')).expect(200))
        .body,
    ).toEqual({ removalDays: 30, standard: false })

    await admin.query('delete from membership_settings where tenant_id = $1', [tenant])
  })
})

describe('what still hangs on a person (#356)', () => {
  it('is counted for whoever keeps the accesses, and for nobody else', async () => {
    await anActivity('u-third', null)
    const started = await anActivity('u-site', 'u-third')
    await admin.query("update activities set status = 'started' where id = $1", [started])
    await aRoundPlan('u-third')
    await aTask('u-third', 'u-site')
    await aDuty('u-third')

    const counted = (
      await http()
        .get('/settings/memberships/u-third/assigned')
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as AssignedToPerson

    expect(counted).toEqual({
      activities: 2,
      startedActivities: 1,
      roundPlans: 1,
      tasks: 1,
      duties: 1,
      delegations: 0,
    })

    for (const userId of ['u-duties', 'u-site', 'u-tech'] as const) {
      await http()
        .get('/settings/memberships/u-third/assigned')
        .set(testIdentityHeader, by(userId))
        .expect(403)
    }

    // Whoever only looks at the accesses sets no last day, and so is not told what hangs on a person.
    const accessReader = JSON.stringify({
      userId: 'u-site',
      tenantId: tenant,
      roles: ['site_management'],
      rights: ['membership.read'],
    })
    const looking = await http()
      .get('/settings/memberships/u-third/assigned')
      .set(testIdentityHeader, accessReader)
      .expect(403)

    expect(looking.body.message).toBe(missingRight('membership.write'))

    await http()
      .get('/settings/memberships/u-nobody/assigned')
      .set(testIdentityHeader, by('u-lead'))
      .expect(404)
  })
})

describe('the end of an access (#356)', () => {
  it('is a deadline until its last day, and so is the day its data goes, named only to whoever keeps the accesses', async () => {
    await lastDay('u-tech', inDays(10))
    await pass()

    try {
      const deadlineReader = JSON.stringify({
        userId: 'u-site',
        tenantId: tenant,
        roles: ['site_management'],
        rights: ['deadline.read'],
      })

      expect(await deadlinesOf(by('u-lead'), 'membership.ends')).toEqual([
        expect.objectContaining({
          dueOn: inDays(10),
          membership: expect.objectContaining({ personName: 'Tobias Wendt' }),
        }),
      ])
      expect(await deadlinesOf(deadlineReader, 'membership.ends')).toEqual([
        expect.objectContaining({
          dueOn: inDays(10),
          membership: expect.objectContaining({ personName: null }),
        }),
      ])
      expect(await deadlinesOf(by('u-lead'), 'membership.data_removal')).toEqual([
        expect.objectContaining({ dueOn: inDays(100) }),
      ])

      // The period of the operator counts where it set one.
      await http()
        .put('/settings/memberships')
        .set(testIdentityHeader, by('u-lead'))
        .send({ removalDays: 30 })
        .expect(200)
      await pass()

      expect(await deadlinesOf(by('u-lead'), 'membership.data_removal')).toEqual([
        expect.objectContaining({ dueOn: inDays(40) }),
      ])
    } finally {
      await admin.query('delete from membership_settings where tenant_id = $1', [tenant])
      await lastDay('u-tech', null)
      await pass()
    }

    expect(await deadlinesOf(by('u-lead'), 'membership.ends')).toEqual([])
  })

  it('hands back on the day after the last day what was assigned to the person, and leaves what is done', async () => {
    const performed = await anActivity('u-tech', 'u-tech')
    const done = await anActivity('u-tech', null)
    await admin.query("update activities set status = 'done' where id = $1", [done])
    const plan = await aRoundPlan('u-tech')
    const fromTheSite = await aTask('u-tech', 'u-site')
    const fromNobody = await aTask('u-tech', null)
    const duty = await aDuty('u-tech')

    await lastDay('u-tech', inDays(0))
    await pass()

    // On the last day itself nothing moves.
    expect(await column('activities', 'performer_user_id', performed)).toBe('u-tech')

    await lastDay('u-tech', inDays(-1))
    await pass()

    expect(await column('activities', 'performer_user_id', performed)).toBeNull()
    expect(await column('activities', 'responsible_user_id', performed)).toBeNull()
    expect(await column('activities', 'performer_user_id', done)).toBe('u-tech')
    expect(await column('round_plans', 'performer_user_id', plan)).toBeNull()
    expect(await column('tasks', 'assignee_user_id', fromTheSite)).toBe('u-site')
    expect(await column('tasks', 'assignee_user_id', fromNobody)).toBe('u-lead')
    expect(await column('duties', 'responsible_user_id', duty)).toBeNull()
    expect(await deadlinesOf(by('u-lead'), 'membership.ends')).toEqual([])

    await lastDay('u-tech', null)
  })

  it('is not given to the last who leads the operator, and to a second one it is', async () => {
    const refused = await http()
      .patch('/staff/u-lead')
      .set(testIdentityHeader, by('u-lead'))
      .send({ roles: ['management'], lastDay: inDays(30), additions: { all: true, areaIds: [] } })
      .expect(409)

    expect(refused.body.message).toBe(access.sentences.lastLead)
    expect(
      (await admin.query("select last_day from memberships where user_id = 'u-lead'")).rows[0]
        ?.last_day,
    ).toBeNull()

    // With a second who leads, the first may go.
    await admin.query(
      "update memberships set roles = '{management}' where tenant_id = $1 and user_id = 'u-duties'",
      [tenant],
    )

    try {
      await http()
        .patch('/staff/u-lead')
        .set(testIdentityHeader, by('u-lead'))
        .send({ roles: ['management'], lastDay: inDays(30), additions: { all: true, areaIds: [] } })
        .expect(200)
    } finally {
      await lastDay('u-lead', null)
      await admin.query(
        "update memberships set roles = '{technical_management}' where tenant_id = $1 and user_id = 'u-duties'",
        [tenant],
      )
    }
  })

  it('is refused the day after the last day, in the office and at the sync of a device', async () => {
    await lastDay('u-tech', inDays(-1))

    try {
      const seen = await database.forTenant({ tenantId: tenant, userId: 'u-tech' }, async (tx) =>
        (await tx.execute<{ id: string }>('select id from properties')).rows.map((row) => row.id),
      )

      // The identity is refused before, by the foundation; this is the line behind it.
      expect(seen).toEqual([])
    } finally {
      await lastDay('u-tech', null)
    }
  })

  it('removes after the period the devices, the passkeys and the address, and leaves what the person signed as it was', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result, ${writtenColumnNames})
       select tenant_id, property_id, area_id, id, $2::date, 'without_defects', ${writtenPlaceholders(3)}
         from duties where asset_id = $1 limit 1
       returning id`,
      [asset, inDays(-200), ...writtenValues('u-third', inDays(-200), 'without_defects')],
    )
    const signed = rows[0]?.id ?? ''
    const before = (
      await http().get(`/evidence/${signed}`).set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as unknown

    await admin.query(
      `insert into push_subscriptions (tenant_id, user_id, entry, label, endpoint, p256dh, auth)
       values ($1, 'u-third', 'site', 'Chrome auf Android', 'https://push.example.com/u-third', 'BPublic', 'Secret')`,
      [tenant],
    )
    // The last day 91 days back: the ninety days counted from the day after it are over, and
    // a longer period of the operator holds the removal back until it is set shorter again.
    await lastDay('u-third', inDays(-91))
    await lastDay('u-both', inDays(-91))
    await http()
      .put('/settings/memberships')
      .set(testIdentityHeader, by('u-lead'))
      .send({ removalDays: 120 })
      .expect(200)
    await pass()

    expect(
      (await admin.query('select 1 from membership_removals where tenant_id = $1', [tenant]))
        .rowCount,
    ).toBe(0)

    await admin.query('delete from membership_settings where tenant_id = $1', [tenant])
    await pass()

    const removals = await admin.query<{ user_id: string; account_removed: boolean }>(
      'select user_id, account_removed from membership_removals where tenant_id = $1 order by user_id',
      [tenant],
    )

    expect(removals.rows).toEqual([
      { user_id: 'u-both', account_removed: false },
      { user_id: 'u-third', account_removed: true },
    ])

    const accounts = await admin.query<{ id: string; name: string; email: string }>(
      "select id, name, email from auth_users where id in ('u-third', 'u-both') order by id",
    )

    expect(accounts.rows).toEqual([
      { id: 'u-both', name: 'Murat Yilmaz', email: 'u-both@beispiel.example' },
      { id: 'u-third', name: 'Lena Vogt', email: removedAddress('u-third') },
    ])
    expect(
      (await admin.query("select 1 from push_subscriptions where user_id = 'u-third'")).rowCount,
    ).toBe(0)

    // What the person signed names them as it did, and a second pass removes nothing more.
    expect(
      (await http().get(`/evidence/${signed}`).set(testIdentityHeader, by('u-lead')).expect(200))
        .body,
    ).toEqual(before)

    await pass()

    expect(
      (await admin.query('select 1 from membership_removals where tenant_id = $1', [tenant]))
        .rowCount,
    ).toBe(2)
    // The removal comes after the deadlines are compared, so the next pass finds it done.
    expect(await deadlinesOf(by('u-lead'), 'membership.data_removal')).toEqual([])
  })

  it('repeats a removal that was cut off before it was written down, and finds nothing left to take', async () => {
    // As a run stopped after the data went and before the note: the access is due again.
    await admin.query(
      "delete from membership_removals where tenant_id = $1 and user_id = 'u-third'",
      [tenant],
    )
    const account = "select name, email from auth_users where id = 'u-third'"
    const before = (await admin.query(account)).rows

    await expect(removeEndedAccounts(database, tenant, today)).resolves.toBe(1)

    expect(
      (
        await admin.query(
          "select account_removed from membership_removals where tenant_id = $1 and user_id = 'u-third'",
          [tenant],
        )
      ).rows,
    ).toEqual([{ account_removed: true }])
    expect((await admin.query(account)).rows).toEqual(before)
    await expect(removeEndedAccounts(database, tenant, today)).resolves.toBe(0)
  })
})
