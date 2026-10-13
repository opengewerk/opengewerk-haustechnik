import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  pushOccasions,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  Database,
  invitationLinks,
  type MailTransport,
  newId,
  type OutgoingMail,
  smtpTransport,
} from '@opengewerk/platform-server'
import {
  aBrowser,
  aMailServer,
  recordingPost,
  testKey,
  testVapid,
} from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { runMailCycle } from '../mail/worker.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The mail server of an operator, the invitation by mail and push on one's
 * own devices, as this application binds the routes of the foundation (#126,
 * sections 3 and 7 of the concept).
 *
 * How the routes work is the foundation's and tested there. What is held
 * here is who may: the mail server is the Leitung's alone, push is
 * everybody's on their own devices, an invitation goes out in the words of
 * this application with its link in the message and nowhere else, and the
 * change log hands out neither the address nor the keys of a device.
 */

const operator = newId<'tenant'>() as TenantId
const neighbour = newId<'tenant'>() as TenantId
const origin = 'https://haustechnik.example.de'

const people = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-tech': 'technician',
} as const satisfies Readonly<Record<string, RoleKey>>

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication
/** The same routes on an instance that sends neither mail nor push. */
let silent: INestApplication
let north = ''

function http(on: INestApplication = app) {
  return request(on.getHttpServer())
}

function by(userId: Person, tenantId: TenantId = operator): string {
  return as(tenantId, userId, people[userId])
}

/** A transport that keeps what it was given. */
function recording() {
  const sent: OutgoingMail[] = []
  const transport: MailTransport = {
    send: (mail) => {
      sent.push(mail)

      return Promise.resolve()
    },
    verify: () => Promise.resolve(),
    close: () => undefined,
  }

  return { sent, transport }
}

function cycle(transport: MailTransport) {
  return runMailCycle({
    database,
    connect: () => transport,
    key: testKey,
    origin,
    invitationLinks: invitationLinks(database, origin),
    // A moment ahead, so that a message written by the test is due.
    now: () => new Date(Date.now() + 1_000),
  })
}

const settings = {
  host: 'mail.example.de',
  port: null,
  security: 'starttls',
  username: null,
  fromAddress: 'haustechnik@beispielstadt.example',
  signature: 'Viele Grüße\n{benutzer}',
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    operator,
    'Liegenschaften Beispielstadt',
    neighbour,
    'Wohnbau Nord eG',
  ])

  for (const tenantId of [operator, neighbour]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  north = (
    await admin.query<{ id: string }>(
      `insert into areas (tenant_id, name) values ($1, 'Nord') returning id`,
      [operator],
    )
  ).rows[0]?.id as string

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      userId === 'u-lead' ? 'Sabine Krämer' : userId,
      `${userId}@beispielstadt.example`,
    ])

    for (const tenantId of userId === 'u-lead' ? [operator, neighbour] : [operator]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  await aMailServer(admin, operator, { from: 'haustechnik@beispielstadt.example' })

  database = Database.connect(applicationDatabaseUrl())

  const catalogue = catalogueOf(probeCatalogueBundle)
  const sending = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        mail: { origin, key: testKey, connect: smtpTransport },
        push: {
          vapid: testVapid(origin),
          post: recordingPost().post,
          resolve: () => Promise.resolve(['142.250.185.74']),
        },
      }),
    ],
  }).compile()
  const quiet = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = sending.createNestApplication()
  silent = quiet.createNestApplication()
  await app.init()
  await silent.init()
})

afterAll(async () => {
  await app.close()
  await silent.close()
  await database.close()
  await admin.end()
})

describe('the mail server of an operator', () => {
  it('is seen by the Leitung, and never with its password', async () => {
    const answer = await http()
      .get('/settings/mail/server')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    expect(answer.body.server).toMatchObject({
      host: 'mail.example.de',
      fromAddress: 'haustechnik@beispielstadt.example',
      password: 'none',
    })
  })

  it('is neither seen nor set, tried or removed by anybody else', async () => {
    for (const person of ['u-duties', 'u-tech'] as const) {
      const asked = (method: 'get' | 'put' | 'post' | 'delete', path: string) =>
        http()[method](path).set(testIdentityHeader, by(person)).send(settings)

      expect((await asked('get', '/settings/mail/server').expect(403)).body.message).toBe(
        missingRight('mail.read'),
      )

      for (const [method, path] of [
        ['put', '/settings/mail/server'],
        ['post', '/settings/mail/server/check'],
        ['delete', '/settings/mail/server'],
      ] as const) {
        expect((await asked(method, path).expect(403)).body.message).toBe(
          missingRight('mail.write'),
        )
      }

      // Whether the operator sends mail at all is for whoever reads its settings.
      expect((await asked('get', '/settings/mail').expect(403)).body.message).toBe(
        missingRight('settings.read'),
      )
    }

    // Nothing was removed on the way.
    expect(
      (await http().get('/settings/mail').set(testIdentityHeader, by('u-lead')).expect(200)).body,
    ).toEqual({ configured: true, from: 'haustechnik@beispielstadt.example' })
  })

  it("is the operator's own: whoever leads next door sees none", async () => {
    const answer = await http()
      .get('/settings/mail/server')
      .set(testIdentityHeader, by('u-lead', neighbour))
      .expect(200)

    expect(answer.body.server).toBeNull()
  })

  it('takes no signature with a placeholder this application does not know', async () => {
    const answer = await http()
      .put('/settings/mail/server')
      .set(testIdentityHeader, by('u-lead'))
      .send({ ...settings, signature: 'Viele Grüße\n{briefkopf}' })
      .expect(400)

    expect(answer.body.message).toBe(
      'In der Signatur steht {briefkopf}. Möglich ist {benutzer} für den Namen dessen, der die E-Mail verschickt.',
    )
  })
})

describe('an invitation by mail', () => {
  const invitation = {
    name: 'Kai Neumann',
    email: 'k.neumann@beispielstadt.example',
    roles: ['technician'],
    send: 'mail',
  }

  it('goes out in the words of this application, with its link in the message and nowhere else', async () => {
    const made = await http()
      .post('/staff')
      .set(testIdentityHeader, by('u-lead'))
      .send({ ...invitation, additions: { all: false, areaIds: [north] } })
      .expect(201)

    // The office gets no link to pass on: the message carries it.
    expect(made.body.token ?? null).toBeNull()

    const { rows: before } = await admin.query<{ body: string; sender_name: string }>(
      'select body, sender_name from mail_outbox where invitation_id = $1',
      [made.body.id],
    )

    expect(before).toHaveLength(1)
    expect(before[0]?.sender_name).toBe('Liegenschaften Beispielstadt')
    expect(before[0]?.body).not.toMatch(/\/einladung\/[A-Za-z0-9_-]{10,}/)

    const { sent, transport } = recording()

    await cycle(transport)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: { address: 'k.neumann@beispielstadt.example', name: 'Kai Neumann' },
      from: { name: 'Liegenschaften Beispielstadt', address: 'haustechnik@beispielstadt.example' },
      subject: 'Einladung zu OpenGewerk Haustechnik: Liegenschaften Beispielstadt',
    })
    expect(sent[0]?.text).toContain(
      'Sabine Krämer hat Sie eingeladen, bei Liegenschaften Beispielstadt mit OpenGewerk Haustechnik zu arbeiten.',
    )
    expect(sent[0]?.text).toMatch(new RegExp(`${origin}/einladung/[A-Za-z0-9_-]{10,}`))
    // The mail server has no signature of its own: the operator signs with its name.
    expect(sent[0]?.text.trimEnd().endsWith('-- \nLiegenschaften Beispielstadt')).toBe(true)

    // What stays in the outbox once the message is gone holds no link that works either.
    const { rows: after } = await admin.query<{ body: string; status: string }>(
      'select body, status from mail_outbox where invitation_id = $1',
      [made.body.id],
    )

    expect(after[0]?.status).toBe('sent')
    expect(after[0]?.body).not.toMatch(/\/einladung\/[A-Za-z0-9_-]{10,}/)
  })

  it('is refused on an instance that sends no mail, and nobody is invited by it', async () => {
    const answer = await http(silent)
      .post('/staff')
      .set(testIdentityHeader, by('u-lead'))
      .send({
        ...invitation,
        email: 'l.vogt@beispielstadt.example',
        additions: { all: false, areaIds: [north] },
      })

    expect(answer.status).toBeGreaterThanOrEqual(400)
    expect(
      (await admin.query("select 1 from invitations where email = 'l.vogt@beispielstadt.example'"))
        .rowCount,
    ).toBe(0)
  })
})

describe('push on the devices of a person', () => {
  it('is for everybody who works for the operator, with the occasions of this application', async () => {
    for (const person of ['u-lead', 'u-duties', 'u-tech'] as const) {
      const answer = await http().get('/push').set(testIdentityHeader, by(person)).expect(200)

      expect(answer.body).toMatchObject({ available: true, devices: [] })
      expect(
        (answer.body.occasions as { key: string; on: boolean }[]).map((each) => each.key),
      ).toEqual([...pushOccasions])
    }
  })

  it('says so on an instance without a key, and takes no device there', async () => {
    const answer = await http(silent).get('/push').set(testIdentityHeader, by('u-tech')).expect(200)

    expect(answer.body).toMatchObject({ available: false, publicKey: null })

    await http(silent)
      .put('/push/subscription')
      .set(testIdentityHeader, by('u-tech'))
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: aBrowser().keys,
        entry: 'site',
        label: 'Chrome auf Android',
      })
      .expect((response) => {
        expect(response.status).toBeGreaterThanOrEqual(400)
      })
  })

  it('keeps the address and the keys of a device out of what the change log hands out', async () => {
    const browser = aBrowser()
    const endpoint = `https://fcm.googleapis.com/fcm/send/${newId()}`

    await http()
      .put('/push/subscription')
      .set(testIdentityHeader, by('u-tech'))
      .send({ endpoint, keys: browser.keys, entry: 'site', label: 'Chrome auf Android' })
      .expect(200)

    // Somebody else's device is nobody's to list.
    expect(
      (await http().get('/push').set(testIdentityHeader, by('u-duties')).expect(200)).body.devices,
    ).toEqual([])

    const log = await http()
      .get('/audit/changes?table=push_subscriptions')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const said = JSON.stringify(log.body)

    // The device is in the log, by what its person called it.
    expect(said).toContain('Chrome auf Android')
    expect(said).not.toContain(endpoint)
    expect(said).not.toContain(browser.keys.p256dh)
    expect(said).not.toContain(browser.keys.auth)
  })
})
