import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { auditVocabulary, type Catalogue } from '@opengewerk/haustechnik-domain'
import {
  attachmentParts,
  auditLogParts,
  contactParts,
  deadlineParts,
  type Authentication,
  authenticationParts,
  AUTHORIZATION,
  Database,
  fileParts,
  type FileStorage,
  HealthController,
  IDENTITY_SOURCE,
  type IdentitySource,
  type InstanceSettingsCache,
  RENDERER,
  type Renderer,
  rendererFor,
  SameOriginGuard,
  syncParts,
  TRUSTED_ORIGINS,
  VERSION,
} from '@opengewerk/platform-server'

import { access } from '../authentication/access.js'
import { CATALOGUE, shippedCatalogue } from '../catalogue.js'
import { deadlineRules } from '../deadlines/routes.js'
import { AreasController, SubstitutionsController } from './areas.controller.js'
import { AssetsController, BuildingAssetsController } from './assets.controller.js'
import { attachmentRights, attachmentRoutes } from './attachment-routes.js'
import { authorization, AuthorizationGuard } from './authorization.js'
import { BuildingsController } from './buildings.controller.js'
import { BuildingClosuresController } from './closures.controller.js'
import { contactRights, contactRoutes } from './contact-routes.js'
import { DatabaseExceptionFilter } from './database-errors.js'
import { CatalogueController } from './catalogue.controller.js'
import {
  DutiesController,
  DutyDismissalsController,
  RoomDutiesController,
} from './duties.controller.js'
import { FloorsController } from './floors.controller.js'
import { ImportsController } from './imports.controller.js'
import {
  AssetLabelsController,
  LabelsController,
  RoomLabelsController,
} from './labels.controller.js'
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
   * The catalogue the routes ask which asset kinds there are, and the one
   * the devices fetch (ADR 0005). Left out, the one this build ships, from
   * the packages under pakete/; a test hands in the probe package.
   */
  readonly catalogue?: Catalogue
  /**
   * Where the bytes of a file are kept, under the hash of what is in them.
   * Left out, the route that takes them refuses every file with the sentence
   * saying that no store is set up, which is what a test that never touches a
   * file wants: nothing is written into a directory nobody chose.
   */
  readonly files?: FileStorage
  /**
   * What turns a page into a PDF. Left out, it is the renderer of an instance
   * that has none set up, and whoever asks for a PDF gets the sentence saying
   * so instead of a crash.
   */
  readonly renderer?: Renderer
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
 * tenant. The people to talk to at a property are on routes of the foundation
 * as well, with the rights of the property. The bytes of a file go into the
 * store through the route of the foundation, under the right this application
 * names for filing a document, and the renderer is handed to whatever prints;
 * the records that name a file and the pages that are printed are this
 * application's and come with the documents, the labels and the evidence; a
 * label is printed on the page of the foundation, with the lines of this
 * application. What
 * this application brings: the areas of a tenant, the place, from the property
 * to the room, the technology, assets and their components, and the catalogue
 * a device fetches.
 */
@Module({})
export class ApiModule {
  static create(
    database: Database,
    identities: IdentitySource,
    options: ApiOptions = {},
  ): DynamicModule {
    const {
      authentication,
      setupCode = null,
      trustedOrigins = [],
      version = null,
      files,
      renderer = rendererFor({ url: undefined, token: undefined }),
    } = options
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

    // The people to talk to at a property, on the routes of the foundation,
    // with the rights of the property.
    const contacting = contactParts({ access, rights: contactRights, routes: contactRoutes })

    // The bytes of a file, sent ahead of the record that names them: a device
    // that took a photo without a network holds both and sends the bytes
    // first. Whoever may file a document may send them (section 7 of the
    // concept). Nothing here hands a file out by its hash: reading goes
    // through the record that names it, in the area of that record.
    const storing = fileParts({ access, upload: 'document.record', store: files })

    // The documents of an operator, handed out by version to whoever may look
    // at documents, out of the store above: found under the policies of the
    // document, so in the tenant and the areas of the person asking.
    const filing = attachmentParts({
      access,
      rights: attachmentRights,
      routes: attachmentRoutes,
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
        ...contacting.controllers,
        ...storing.controllers,
        ...filing.controllers,
        // The areas of a tenant, who holds in which, and who stands in for whom.
        AreasController,
        SubstitutionsController,
        // The place: properties, buildings, floors and rooms, and the times a
        // building is closed.
        PropertiesController,
        BuildingsController,
        BuildingClosuresController,
        FloorsController,
        RoomsController,
        // The technology: assets and their components.
        BuildingAssetsController,
        AssetsController,
        // The labels with a QR code on assets and rooms: made, blocked and
        // printed, and what a code is for whoever scans it.
        AssetLabelsController,
        RoomLabelsController,
        LabelsController,
        // The duties of an operator and the proposals dismissed.
        DutiesController,
        RoomDutiesController,
        DutyDismissalsController,
        // The catalogue of this server, for the devices that work with it.
        CatalogueController,
        // The import of places and assets from tables.
        ImportsController,
      ],
      providers: [
        { provide: Database, useValue: database },
        ...signingIn.providers,
        ...syncing.providers,
        ...auditing.providers,
        ...deadlining.providers,
        ...contacting.providers,
        ...storing.providers,
        ...filing.providers,
        // What prints a page, for the routes that hand out a PDF.
        { provide: RENDERER, useValue: renderer },
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
