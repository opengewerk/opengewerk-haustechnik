import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { auditVocabulary, type Catalogue } from '@opengewerk/haustechnik-domain'
import {
  auditLogParts,
  deadlineParts,
  type Authentication,
  authenticationParts,
  AUTHORIZATION,
  Database,
  HealthController,
  IDENTITY_SOURCE,
  type IdentitySource,
  type InstanceSettingsCache,
  SameOriginGuard,
  syncParts,
  TRUSTED_ORIGINS,
  VERSION,
} from '@opengewerk/platform-server'

import { access } from '../authentication/access.js'
import { CATALOGUE, shippedCatalogue } from '../catalogue.js'
import { deadlineRules } from '../deadlines/routes.js'
import { AssetsController, BuildingAssetsController } from './assets.controller.js'
import { authorization, AuthorizationGuard } from './authorization.js'
import { BuildingsController } from './buildings.controller.js'
import { DatabaseExceptionFilter } from './database-errors.js'
import { DutiesController, DutyDismissalsController } from './duties.controller.js'
import { FloorsController } from './floors.controller.js'
import { PropertiesController } from './properties.controller.js'
import { RoomsController } from './rooms.controller.js'
import { syncRoutesFor } from './sync-routes.js'

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
  /**
   * The version this installation runs, which the health check names. Left
   * out, there is none to name, as in a checkout.
   */
  readonly version?: string | null
  /**
   * The catalogue the routes ask which asset kinds there are (ADR 0005).
   * Left out, the one this build ships, from the packages under pakete/; a
   * test hands in the probe package.
   */
  readonly catalogue?: Catalogue
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
 * What the foundation brings: signing in, the account of the person signed
 * in, who works for a tenant, the area of the instance, the change log and the
 * sync of a device with the rules of this application. An invitation is
 * handed over as a link; sending one by mail arrives with the mail server of a
 * tenant. What this application brings: the place, from the property to the
 * room, and the technology, assets and their components.
 */
@Module({})
export class ApiModule {
  static create(
    database: Database,
    identities: IdentitySource,
    options: ApiOptions = {},
  ): DynamicModule {
    const { authentication, setupCode = null, trustedOrigins = [], version = null } = options
    const catalogue = options.catalogue ?? shippedCatalogue()

    // The authentication is the foundation's, with the rights, the roles and
    // the words of this application.
    const signingIn = authenticationParts({
      access,
      authentication,
      setupCode,
      instanceSettings: options.instance?.settings,
    })
    // The routes a device syncs through, with the rules of this application
    // and the catalogue its asset kinds come from: the bar of the sync on
    // every screen asks them.
    const syncing = syncParts({ access, routes: syncRoutesFor(catalogue, database) })
    // The change log of a tenant for its Leitung, read by the foundation in
    // the words of this application.
    const auditing = auditLogParts({ access, vocabulary: auditVocabulary })
    // The deadlines the engine keeps, and what an operator sets for a kind:
    // section 7 of the concept gives both to whoever may look after the
    // deadlines, and the routes see what the person sees.
    const deadlining = deadlineParts({
      access,
      rights: {
        read: 'deadline.read',
        write: 'deadline.write',
        settingsRead: 'deadline.read',
        settingsWrite: 'deadline.write',
      },
      rules: deadlineRules,
    })

    return {
      module: ApiModule,
      // The health check first: it answers without an identity, for the
      // container runtime and for whoever looks whether the instance is up.
      controllers: [
        HealthController,
        ...signingIn.controllers,
        ...syncing.controllers,
        ...auditing.controllers,
        ...deadlining.controllers,
        // The place: properties, buildings, floors and rooms.
        PropertiesController,
        BuildingsController,
        FloorsController,
        RoomsController,
        // The technology: assets and their components.
        BuildingAssetsController,
        AssetsController,
        // The duties of an operator and the proposals dismissed.
        DutiesController,
        DutyDismissalsController,
      ],
      providers: [
        { provide: Database, useValue: database },
        ...signingIn.providers,
        ...syncing.providers,
        ...auditing.providers,
        ...deadlining.providers,
        { provide: TRUSTED_ORIGINS, useValue: trustedOrigins },
        { provide: VERSION, useValue: version },
        { provide: CATALOGUE, useValue: catalogue },
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
