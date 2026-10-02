import {
  missingRight,
  rights,
  rightsOfRoles,
  tenantNameMaxLength,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { authenticationPath } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type TestInstance, testInstance, testOrigin, testSetupCode } from '../api/test-instance.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { addStaffMember } from './access.js'

// The way into an instance of this application, from an empty database to
// somebody at work, with a real session at every step. The mechanism is the
// foundation's and tested there in every direction. This walks it once with
// the database, the roles and the words of this application, because that is
// the first time the three meet: a migration that lacked something the
// authentication needs, or a role bound wrongly, would show here and nowhere
// before an installation.

const password = 'a password long enough for a test'
const secondFactorWall =
  'Für diese Rolle ist ein zweiter Faktor Pflicht. Bitte eine Authenticator-App ' +
  'einrichten oder mit einem Passkey anmelden.'

const firstRun = {
  setupCode: testSetupCode,
  company: 'Klinikum Musterstadt',
  name: 'Erika Beispiel',
  email: 'leitung@klinikum.example',
  password,
}

let admin: Pool
let instance: TestInstance

beforeAll(async () => {
  admin = await connect()
})

beforeEach(async () => {
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
})

afterEach(async () => {
  await instance.close()
})

afterAll(async () => {
  await admin.end()
})

/** Runs the first run through its route and says which tenant came of it. */
async function setUp(): Promise<TenantId> {
  const answer = await instance.http().post('/setup').set('origin', testOrigin).send(firstRun)

  expect(answer.status).toBe(201)

  return (answer.body as { tenantId: TenantId }).tenantId
}

describe('an instance nobody has used yet', () => {
  beforeEach(async () => {
    instance = await testInstance(applicationDatabaseUrl())
  })

  it('says that it needs setting up, and after the first run that it does not', async () => {
    expect((await instance.http().get('/setup').expect(200)).body).toEqual({ needed: true })

    await setUp()

    expect((await instance.http().get('/setup').expect(200)).body).toEqual({ needed: false })
  })

  it('is set up once and refuses a second run', async () => {
    await setUp()

    const again = await instance
      .http()
      .post('/setup')
      .set('origin', testOrigin)
      .send({ ...firstRun, company: 'Ein zweiter Betreiber', email: 'zweite@klinikum.example' })
      .expect(409)

    expect((again.body as { message: string }).message).toBe(
      'Diese Instanz ist bereits eingerichtet.',
    )

    const { rows } = await admin.query('select name from tenants')

    expect(rows).toEqual([{ name: 'Klinikum Musterstadt' }])
  })

  it('refuses a name for the tenant with the sentence of this application', async () => {
    const refused = await instance
      .http()
      .post('/setup')
      .set('origin', testOrigin)
      .send({ ...firstRun, company: 'x'.repeat(tenantNameMaxLength + 1) })
      .expect(400)

    expect((refused.body as { message: string }).message).toBe(
      `Der Name des Betreibers ist länger als ${String(tenantNameMaxLength)} Zeichen.`,
    )
    expect((await instance.http().get('/setup')).body).toEqual({ needed: true })
  })

  it('is not set up without the code from the server', async () => {
    await instance
      .http()
      .post('/setup')
      .set('origin', testOrigin)
      .send({ ...firstRun, setupCode: 'WXYZ-WXYZ' })
      .expect(403)

    expect((await instance.http().get('/setup')).body).toEqual({ needed: true })
  })
})

describe('whoever leads a tenant', () => {
  let tenantId: TenantId
  let cookies: string

  beforeEach(async () => {
    instance = await testInstance(applicationDatabaseUrl())
    tenantId = await setUp()
    cookies = await instance.signIn(firstRun.email, password)
  })

  it('is told, before choosing, what the role is called and what it may do', async () => {
    const answer = await instance.http().get('/auth/tenants').set('cookie', cookies).expect(200)

    expect(answer.body).toEqual([
      {
        id: tenantId,
        name: 'Klinikum Musterstadt',
        roles: ['management'],
        roleLabels: ['Leitung'],
        rights: [...rights],
        secondFactor: true,
      },
    ])
  })

  /**
   * Section 3 of the concept: the second factor is compulsory for whoever
   * leads. It hangs on the role and is asked at every request, so somebody
   * who signed in with the password alone gets as far as the choice of tenant
   * and no further.
   */
  it('gets nowhere in the tenant with the password alone', async () => {
    await instance.chooseTenant(cookies, tenantId)

    const refused = await instance.http().get('/staff').set('cookie', cookies).expect(403)

    expect((refused.body as { message: string }).message).toBe(secondFactorWall)
  })

  it('works once an authenticator app is set up, and is asked for its code from then on', async () => {
    await instance.chooseTenant(cookies, tenantId)

    const withSecondFactor = await instance.setUpSecondFactor(cookies, password)
    const list = await instance
      .http()
      .get('/staff')
      .set('cookie', withSecondFactor.cookies)
      .expect(200)

    expect((list.body as { email: string }[]).map((entry) => entry.email)).toEqual([firstRun.email])

    // The next sign in with the password is not one yet.
    const next = await instance
      .authenticate('/sign-in/email')
      .send({ email: firstRun.email, password })
      .expect(200)

    expect((next.body as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true)
  })
})

describe('somebody who does not lead', () => {
  it('works with the password alone, and holds what the role gives and no more', async () => {
    instance = await testInstance(applicationDatabaseUrl())

    const tenantId = await setUp()

    await addStaffMember(instance.authentication, instance.database, {
      email: 'technik@klinikum.example',
      name: 'Max Beispiel',
      password,
      tenantId,
      roles: ['technician'],
    })

    const cookies = await instance.signIn('technik@klinikum.example', password)
    const choices = await instance.http().get('/auth/tenants').set('cookie', cookies).expect(200)

    expect(choices.body).toEqual([
      {
        id: tenantId,
        name: 'Klinikum Musterstadt',
        roles: ['technician'],
        roleLabels: ['Haustechnik'],
        rights: [...rightsOfRoles(['technician'])],
        secondFactor: false,
      },
    ])

    await instance.chooseTenant(cookies, tenantId)

    // Stopped by the missing right and not by the second factor: the wall is
    // the role's, and this role has none.
    const refused = await instance.http().get('/staff').set('cookie', cookies).expect(403)

    expect((refused.body as { message: string }).message).toBe(missingRight('membership.read'))
  })
})

describe('a closed instance', () => {
  it('has no way in and recognises nobody', async () => {
    instance = await testInstance(applicationDatabaseUrl(), { closed: true })

    await instance.http().get('/setup').expect(404)
    await instance.http().post('/setup').set('origin', testOrigin).send(firstRun).expect(404)
    await instance
      .http()
      .post(`${authenticationPath}/sign-in/email`)
      .set('origin', testOrigin)
      .send({ email: firstRun.email, password })
      .expect(404)
    await instance.http().get('/staff').expect(401)

    const { rows } = await admin.query('select name from tenants')

    expect(rows).toEqual([])
  })
})
