import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type Authentication,
  authenticationPath,
  ClosedIdentitySource,
  Database,
} from '@opengewerk/platform-server'
import { currentCode } from '@opengewerk/platform-server/testing'
import { toNodeHandler } from 'better-auth/node'
import request from 'supertest'

import { createAuthentication, SessionIdentitySource } from '../authentication/access.js'
import { ApiModule } from './api.module.js'

// A running instance of this application for a test that signs in: the module
// with the real authentication behind it, started the way an instance starts.
// The tests that name somebody in a header are faster and say more clearly
// what they are about; this is for the promises that are about the session
// itself.

/** Where an instance of a test is reached, and the origin a browser sends. */
export const testOrigin = 'https://haustechnik.example.de'

/** The code the first run of a test instance asks for. */
export const testSetupCode = 'ABCD-EFGH'

export interface TestInstanceOptions {
  /** A closed instance recognises nobody and mounts no way in. */
  readonly closed?: boolean
  /** Left out, the instance has the code every test knows. Null for one without. */
  readonly setupCode?: string | null
}

export interface TestInstance {
  readonly app: INestApplication
  readonly database: Database
  readonly authentication: Authentication
  /** A request against the instance. */
  http(): ReturnType<typeof request>
  /** A request to a route of the authentication library, as a browser on the instance sends it. */
  authenticate(path: string, cookies?: string): request.Test
  /**
   * Signs in with the password and hands back the cookies as a browser would
   * send them. An account with a second factor is asked for it by the library
   * and is not signed in by this alone.
   */
  signIn(email: string, password: string): Promise<string>
  /**
   * Gives the account of these cookies an authenticator app and confirms it,
   * and hands back the address the app was fed, from which a test computes
   * the code of the moment.
   */
  setUpSecondFactor(
    cookies: string,
    password: string,
  ): Promise<{ cookies: string; totpUri: string }>
  /** Chooses the tenant the session works for. */
  chooseTenant(cookies: string, tenantId: string): Promise<void>
  close(): Promise<void>
}

/** The cookies an answer set, the way a browser would keep them. */
export function cookiesOf(answer: { headers: Record<string, unknown> }): string {
  const raw = answer.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : []

  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

/**
 * Starts an instance on a database: the routes of the authentication library
 * in front of the body parser, everything else behind the guard.
 */
export async function testInstance(
  databaseUrl: string,
  options: TestInstanceOptions = {},
): Promise<TestInstance> {
  const { closed = false, setupCode = testSetupCode } = options
  const database = Database.connect(databaseUrl)
  const authentication = createAuthentication({
    database,
    secret: 't'.repeat(64),
    trustedOrigins: [testOrigin],
    // They count per address, and every request of a test comes from one.
    rateLimited: false,
  })

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(
        database,
        closed ? new ClosedIdentitySource() : new SessionIdentitySource(authentication, database),
        closed
          ? { trustedOrigins: [testOrigin] }
          : { authentication, setupCode, trustedOrigins: [testOrigin] },
      ),
    ],
  }).compile()

  const app = built.createNestApplication()

  if (!closed) {
    // In front of the body parser, which is the order an instance uses and
    // the order that matters: a parser in front leaves the library with an
    // empty body, and the failure reads like a wrong password.
    app.use(authenticationPath, toNodeHandler(authentication))
  }

  await app.init()

  const http = () => request(app.getHttpServer())

  const authenticate = (path: string, cookies?: string) => {
    const sending = http().post(`${authenticationPath}${path}`).set('origin', testOrigin)

    return cookies ? sending.set('cookie', cookies) : sending
  }

  return {
    app,
    database,
    authentication,
    http,
    authenticate,
    async signIn(email, password) {
      const answer = await authenticate('/sign-in/email').send({ email, password }).expect(200)

      return cookiesOf(answer)
    },
    async setUpSecondFactor(cookies, password) {
      const started = await authenticate('/two-factor/enable', cookies)
        .send({ password, method: 'totp' })
        .expect(200)
      const totpUri = (started.body as { totpURI: string }).totpURI
      const verified = await authenticate('/two-factor/verify-totp', cookies)
        .send({ code: await currentCode(totpUri) })
        .expect(200)

      return { cookies: cookiesOf(verified) || cookies, totpUri }
    },
    async chooseTenant(cookies, tenantId) {
      await http()
        .post('/auth/tenant')
        .set('cookie', cookies)
        .set('origin', testOrigin)
        .send({ tenantId })
        .expect(201)
    },
    async close() {
      await app.close()
      await database.close()
    },
  }
}
