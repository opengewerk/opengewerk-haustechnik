import { applicationRights } from '@opengewerk/haustechnik-domain'
import { authenticationPath, Database } from '@opengewerk/platform-server'
import { routesOf, undeclared } from '@opengewerk/platform-server/testing'
import { describe, expect, it } from 'vitest'

import { createAuthentication } from '../authentication/access.js'
import { ApiModule } from './api.module.js'
import { noIdentities } from './test-identity.js'

/**
 * Walks every route the module registers and reports the ones that declare no
 * right. Not a list kept by hand: the controllers come out of the module
 * itself, so a controller added later is included whether or not anybody
 * remembers this file. The walk is the foundation's (ADR 0010 in the
 * repository opengewerk); the lists below are this application's.
 */

const database = Database.connect('postgres://unused')

/**
 * Built, not connected. `createAuthentication` reads its configuration and
 * hands back a handle; nothing here calls it, and nothing in this file touches
 * the database either. It is needed because the first run and the redemption
 * of a link are registered only on an open instance, and a module built
 * without it would walk a routing table that is missing exactly the routes
 * worth looking at.
 */
const authentication = createAuthentication({
  database,
  secret: 'x'.repeat(64),
  trustedOrigins: ['https://haustechnik.example.de'],
})

const controllers = ApiModule.create(database, noIdentities, { authentication }).controllers ?? []

/** The same module on a closed instance, where the ways in are left out. */
const whenClosed = ApiModule.create(database, noIdentities).controllers ?? []

describe('every route', () => {
  it('is registered in the first place', () => {
    // Without this the checks below would pass on an empty list, and an empty
    // list is the one result that proves nothing.
    const routes = routesOf(controllers)

    expect(routes.length).toBeGreaterThanOrEqual(30)
    expect(routes.filter((route) => route.writes).length).toBeGreaterThanOrEqual(15)
  })

  it('declares the right it needs, writing ones above all', () => {
    expect(undeclared(routesOf(controllers)).map((route) => route.name)).toEqual([])
  })

  /**
   * A route can name a right this application does not have: a controller of
   * the foundation that asks for one the catalogue here lacks, or a typo that
   * got past the compiler through a cast. No role could ever hold it, so the
   * route would refuse everybody, the role that leads included.
   */
  it('asks for a right of the catalogue of this application', () => {
    const unknown = routesOf(controllers)
      .filter((route) => route.permission !== undefined)
      .filter((route) => !applicationRights.isRight(route.permission ?? ''))
      .map((route) => [route.name, route.permission])

    expect(unknown).toEqual([])
  })

  /**
   * The exception to the rule above, held as a list on purpose. A route
   * without a right is refused, a public one is not, so the second kind is
   * the one worth counting: adding one turns this test red, which makes it a
   * decision instead of a line in a diff nobody looked at twice.
   */
  it('that answers without an identity is the first run or a one time link', () => {
    const publicRoutes = routesOf(controllers)
      .filter((route) => route.isPublic)
      .map((route) => route.name)
      .sort()

    expect(publicRoutes).toEqual([
      'GET /invitation/:token',
      'GET /setup',
      'POST /invitation/:token',
      'POST /setup',
    ])
  })

  /**
   * The two public routes that write. Both have to be public, and for the
   * same reason: they create an account, so at the moment they run there is
   * nobody to authenticate.
   *
   * What stands in for authentication is different in each case. For the
   * first run it is the state of the data and the setup code from the server:
   * `create_first_tenant` refuses unless the instance is empty, under a lock
   * rather than after a look, so the route answers exactly once in the life
   * of an installation, and to whoever can get at the server. For the
   * redemption it is the token: random bytes somebody who leads a tenant
   * made, good once, for a limited time, and callable back.
   *
   * A third entry here would be a public route that writes for some other
   * reason, and there is no other reason.
   */
  it('that answers without an identity writes only where there is nobody to ask yet', () => {
    const writingAndPublic = routesOf(controllers)
      .filter((route) => route.isPublic && route.writes)
      .map((route) => route.name)
      .sort()

    expect(writingAndPublic).toEqual(['POST /invitation/:token', 'POST /setup'])
  })

  /**
   * Checked on the routing table rather than on a response, because "the
   * route is not there" and "the route is there and refuses" are two
   * different promises and this is the stronger one.
   */
  it('that answers without an identity does not exist on a closed instance', () => {
    const closed = routesOf(whenClosed)

    expect(closed.filter((route) => route.isPublic).map((route) => route.name)).toEqual([])
    // Who works for a tenant is behind the guard like everything else, so it
    // stays on the table and answers 401. Closing an instance is about the
    // ways in that need no identity, not about taking routes away.
    expect(closed.map((route) => route.name)).toContain('GET /staff')
  })

  /**
   * The third kind, held as a list for the same reason as the second.
   *
   * These need somebody signed in but no tenant, so they cannot ask for a
   * right: a right comes from a membership and a membership is per tenant,
   * which is exactly what has not been decided yet at this point, or, for the
   * devices, the recovery codes and the passkeys, what the account has and no
   * tenant. A new one turns this red, and it should, because the next route
   * that "only needs a session" is far more likely to be one that forgot to
   * say which tenant it means.
   */
  it('that needs a session but no tenant is one of the few around signing in', () => {
    const sessionOnly = routesOf(controllers)
      .filter((route) => route.needsSessionOnly)
      .map((route) => route.name)
      .sort()

    expect(sessionOnly).toEqual([
      'DELETE /auth/devices/:sessionId',
      'DELETE /auth/passkeys/:passkeyId',
      'GET /auth/devices',
      'GET /auth/passkeys',
      'GET /auth/recovery-codes',
      'GET /auth/tenants',
      'GET /instance/access',
      'PATCH /auth/passkeys/:passkeyId',
      'POST /auth/sign-out',
      'POST /auth/tenant',
    ])
  })

  /**
   * The fourth kind: the area of the instance, for whoever runs it. No tenant
   * and no right of a tenant come into it, so leading one opens none of
   * these. All of them live under `/instance`, and one elsewhere would be a
   * route that forgot which tenant it means.
   */
  it('that needs the administration of the instance is in the area of the instance', () => {
    const operatorRoutes = routesOf(controllers).filter((route) => route.needsOperator)

    expect(operatorRoutes.length).toBeGreaterThanOrEqual(6)
    expect(operatorRoutes.filter((route) => !/^\w+ \/instance\//.test(route.name))).toEqual([])
    // And none of them is also something else, which would open it wider.
    expect(
      operatorRoutes.filter(
        (route) => route.isPublic || route.needsSessionOnly || route.permission !== undefined,
      ),
    ).toEqual([])
  })

  /**
   * The routes of the authentication library are mounted in front of the
   * guard, because a route that hands out a session cannot ask for one. That
   * is defensible exactly as long as nothing of ours shares the prefix: a
   * controller under it would be outside the guard without anybody meaning it
   * to, and no other test here would notice.
   */
  it('of ours never lives under the path the authentication handler is mounted on', () => {
    const underneath = routesOf(controllers)
      .map((route) => route.name)
      .filter((name) => name.includes(` ${authenticationPath}`))

    expect(underneath).toEqual([])
  })

  /**
   * Who works for a tenant is where it hands out rights, and therefore the
   * last place a route should be able to forget which one it needs. Reading
   * and writing are told apart on purpose: seeing who works here is not the
   * same as deciding it.
   */
  it('about who works for a tenant asks for a membership right and says which kind', () => {
    const staff = routesOf(controllers).filter((route) => route.name.includes('/staff'))

    expect(staff.length).toBeGreaterThanOrEqual(9)

    for (const route of staff) {
      expect([route.name, route.permission]).toEqual([
        route.name,
        route.writes ? 'membership.write' : 'membership.read',
      ])
    }
  })
})
