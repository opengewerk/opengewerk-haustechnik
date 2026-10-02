import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import {
  type Authentication,
  authenticationParts,
  AUTHORIZATION,
  Database,
  IDENTITY_SOURCE,
  type IdentitySource,
  type InstanceSettingsCache,
  SameOriginGuard,
  TRUSTED_ORIGINS,
} from '@opengewerk/platform-server'

import { access } from '../authentication/access.js'
import { authorization, AuthorizationGuard } from './authorization.js'
import { DatabaseExceptionFilter } from './database-errors.js'

/**
 * What the module needs beyond a database and an identity source.
 *
 * The authentication is handed in only while the instance is open, and that
 * is what switches the ways in on that need no identity: the first run and
 * the redemption of a one time link. Left out, neither is registered and
 * their routes do not exist: a closed instance hands out nothing.
 */
export interface ApiOptions {
  readonly authentication?: Authentication
  /**
   * The code the first run asks for. Left out, an empty instance cannot be
   * set up at all: the first run is refused with the sentence saying how to
   * get one. Only read where the authentication is handed in, because only
   * then is there a first run.
   */
  readonly setupCode?: string | null
  /**
   * The addresses a browser may send a request that changes something from,
   * the same list the authentication gets. Left out, no browser may: a
   * request with an `Origin` is refused, one without passes, as from a test.
   */
  readonly trustedOrigins?: readonly string[]
  /**
   * The settings of the instance in memory, so that a change made in its area
   * reaches whatever reads them at once. Left out, the area reads and writes
   * the database and nothing is kept.
   */
  readonly instance?: { readonly settings: InstanceSettingsCache } | null
}

/**
 * The HTTP side of the application.
 *
 * An identity source has to be handed in; there is no default, because the
 * only one that could be written without the authentication would let
 * everybody through. An instance that is to run closed hands in a source that
 * recognises nobody.
 *
 * The guard is registered for the whole module and not per controller. Per
 * controller it would be a decision somebody has to remember on the next one;
 * this way it is the default, and a route that declares no right is refused
 * instead of waved through. `route-coverage.test.ts` walks the controllers
 * listed here, so a controller added to the list is covered without anybody
 * remembering the test.
 *
 * What is here so far is what the foundation brings: signing in, the account
 * of the person signed in, who works for a tenant, and the area of the
 * instance. An invitation is handed over as a link; sending one by mail
 * arrives with the mail server of a tenant.
 */
@Module({})
export class ApiModule {
  static create(
    database: Database,
    identities: IdentitySource,
    options: ApiOptions = {},
  ): DynamicModule {
    const { authentication, setupCode = null, trustedOrigins = [] } = options

    // The authentication is the foundation's, with the rights, the roles and
    // the words of this application.
    const signingIn = authenticationParts({
      access,
      authentication,
      setupCode,
      instanceSettings: options.instance?.settings,
    })

    return {
      module: ApiModule,
      controllers: [...signingIn.controllers],
      providers: [
        { provide: Database, useValue: database },
        ...signingIn.providers,
        { provide: TRUSTED_ORIGINS, useValue: trustedOrigins },
        { provide: IDENTITY_SOURCE, useValue: identities },
        // What a refusal says, for the guard of the foundation.
        { provide: AUTHORIZATION, useValue: authorization },
        // In this order, which is the order they run in: a form from a foreign
        // page is refused before anybody asks whose session it carries.
        { provide: APP_GUARD, useClass: SameOriginGuard },
        { provide: APP_GUARD, useClass: AuthorizationGuard },
        // A refusal of the database becomes an answer that gives nothing away
        // about a row somebody may not see.
        { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
      ],
    }
  }
}
