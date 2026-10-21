import { type DynamicModule, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import {
  auditValueWordsWith,
  auditVocabulary,
  type Catalogue,
  numberRangeKeys,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  attachmentParts,
  auditLogParts,
  type Authentication,
  authenticationParts,
  AUTHORIZATION,
  backupStatusParts,
  contactParts,
  Database,
  deadlineParts,
  fileParts,
  type FileStorage,
  HealthController,
  IDENTITY_SOURCE,
  type IdentitySource,
  type InstanceSettingsCache,
  MAIL,
  type MailContext,
  mailSettingsParts,
  numberRangeParts,
  PUSH,
  type PushContext,
  RENDERER,
  type Renderer,
  rendererFor,
  SameOriginGuard,
  StampInterceptor,
  syncParts,
  TRUSTED_ORIGINS,
  pushParts,
  VERSION,
} from '@opengewerk/platform-server'

import { AuditorReadsInterceptor } from '../limits/auditor-reads.js'
import { tenantCatalogue } from '../own-kinds/catalogue.js'
import { access } from '../authentication/access.js'
import { CATALOGUE, shippedCatalogue } from '../catalogue.js'
import { changeNumberRange, numberRangesOf } from '../database/number-ranges.js'
import { deadlineRulesFor } from '../deadlines/routes.js'
import { namedByImports } from '../imports/first-values.js'
import { accountMessages } from '../mail/account-messages.js'
import { mailServersOfOperators } from '../mail/server-settings.js'
import { invitationMailing } from '../notifications/invitation-mail.js'
import { pushRules } from '../notifications/push.js'
import { ActivitiesController } from './activities.controller.js'
import { CollectivesController } from './collectives.controller.js'
import { AuditorReadsController } from './auditor-reads.controller.js'
import { AreasController, SubstitutionsController } from './areas.controller.js'
import { RolesController } from './roles.controller.js'
import { AssetsController, BuildingAssetsController } from './assets.controller.js'
import { attachmentRights, attachmentRoutes } from './attachment-routes.js'
import { authorization, AuthorizationGuard } from './authorization.js'
import { BuildingsController } from './buildings.controller.js'
import { BuildingClosuresController } from './closures.controller.js'
import { contactRights, contactRoutes } from './contact-routes.js'
import { DatabaseExceptionFilter } from './database-errors.js'
import { DefectClassSettingsController, DefectsController } from './defects.controller.js'
import { CircuitChartController } from './circuit-chart.controller.js'
import { AssetEvidenceController, EvidenceController } from './evidence.controller.js'
import { CatalogueController } from './catalogue.controller.js'
import { DocumentsController } from './documents.controller.js'
import {
  DutiesController,
  DutyDismissalsController,
  RoomDutiesController,
} from './duties.controller.js'
import { FloorsController } from './floors.controller.js'
import { ImportOriginController } from './import-origin.controller.js'
import { OwnKindsController } from './own-kinds.controller.js'
import { ImportsController } from './imports.controller.js'
import {
  AssetLabelsController,
  FreeLabelsController,
  LabelsController,
  RoomLabelsController,
  StoreLabelsController,
} from './labels.controller.js'
import { OverviewController } from './overview.controller.js'
import { PropertiesController } from './properties.controller.js'
import { DutyReportController } from './report.controller.js'
import { RoomsController } from './rooms.controller.js'
import { RoundPlansController } from './round-plans.controller.js'
import { RoundTemplatesController } from './round-templates.controller.js'
import { RoundsController } from './rounds.controller.js'
import { SearchController } from './search.controller.js'
import { TasksController } from './tasks.controller.js'
import { syncRoutesFor } from './sync-routes.js'
import { MeterSettingsController, MetersController } from './meters.controller.js'
import { EvidenceRetentionController } from './retention.controller.js'
import { RecordRetentionController } from './record-retention.controller.js'
import { MembershipEndController } from './membership-end.controller.js'
import { PrivacyDocumentsController } from './privacy-documents.controller.js'
import { ProcessingDescriptionsController } from './processing-descriptions.controller.js'
import { ProcessingRecordController } from './processing-record.controller.js'
import { SubjectAccessController } from './subject-access.controller.js'
import {
  EvidencePrintController,
  Printer,
  RoundPrintController,
  ServiceReportPrintController,
} from './prints.controller.js'
import { ArticlesController, StoresController, SuppliersController } from './stock.controller.js'
import { ContractorsController } from './contractors.controller.js'
import { ContractsController } from './contracts.controller.js'
import {
  FaultCategorySettingsController,
  FaultReportSettingsController,
  FaultReportsController,
} from './fault-reports.controller.js'
import { DelegationsController } from './delegations.controller.js'
import { QualificationsController } from './qualifications.controller.js'
import { FiguresController } from './figures.controller.js'
import { OutsideReportsController } from './outside-reports.controller.js'
import { OUTSIDE_REPORTS, OutsideReports } from '../faults/outside-gate.js'
import { WorkOrderSettingsController, WorkOrdersController } from './work-orders.controller.js'

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
  /**
   * What the routes around mail need (#126). Left out, the instance sends
   * none: the mail server of an operator can be read and removed but neither
   * set nor tried, an invitation is handed over as a link, and the mail
   * server of the instance takes no entry.
   */
  readonly mail?: MailContext | null
  /**
   * What push needs (#126). Left out, the instance sends no push: "Konto"
   * says so, and no device subscribes.
   */
  readonly push?: PushContext | null
  /**
   * Where the backups record their last run (`BACKUP_STATUS_PATH`, #127).
   * Left out, the office is told that nothing is known about backups, which
   * is the truth on a machine that makes none.
   */
  readonly backupStatus?: string | null
  /**
   * What stands between the page of a label and a machine (#332): the limits
   * per address and per label, the form with its least time, and the slips
   * for photos. Left out, the routes of that page stand wherever the
   * authentication is handed in, with the clock of the machine, and on a
   * closed instance not; a test hands in one with a clock of its own.
   */
  readonly outside?: OutsideReports | null
  /**
   * Whether the legal texts of the instance are handed out to anybody (#129).
   * Left out, they are wherever the authentication is handed in, and on a
   * closed instance not; the preview, which signs everybody in without it,
   * says yes, so that the page of the texts shows there.
   */
  readonly legalTexts?: boolean
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
 * handed over as a link, or goes out by mail where the tenant has set up its
 * mail server (#126); that mail server and push on one's own devices are on
 * routes of the foundation as well. The people to talk to at a property are on routes of the foundation
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
      mail = null,
      push = null,
      backupStatus = null,
    } = options
    // The page of a label for somebody without an account (#332) is the one
    // place of this application nobody signs in to; it stands where an
    // instance takes sign ins at all.
    const outside =
      options.outside === undefined
        ? authentication === undefined
          ? null
          : new OutsideReports()
        : options.outside
    const catalogue = options.catalogue ?? shippedCatalogue()

    // The authentication is the foundation's, with the rights, the roles and
    // the words of this application.
    const signingIn = authenticationParts({
      access,
      authentication,
      setupCode,
      // An invitation by mail goes out the way every mail of an operator does.
      invitationMailing: invitationMailing(database, mail),
      instanceSettings: options.instance?.settings,
      legalTexts: options.legalTexts,
      // The words of the mails to an account, for the area of the instance:
      // it tells the lead of every operator of a new mail server in them (#360).
      accountMessages,
    })
    // The routes a device syncs through, with the rules of this application
    // and the catalogue its asset kinds come from: the bar of the sync on
    // every screen asks them.
    const syncing = syncParts({ access, routes: syncRoutesFor(catalogue, database) })
    // The change log of a tenant for its Leitung, read by the foundation in
    // the words of this application, the keys of its catalogue among them: a
    // duty from the catalogue is named by its kind (#245).
    const auditing = auditLogParts({
      access,
      vocabulary: auditVocabulary,
      words: auditValueWordsWith(catalogue),
      // A record an import made is called what the import made it (#422).
      firstValues: namedByImports,
      // The table of the log names what an operator made itself, its own
      // asset kinds and fields, as the page does (#426).
      tenantWords: async (tx) => auditValueWordsWith(await tenantCatalogue(tx, catalogue)),
    })
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
      // Whose qualification runs out, by the name of the account (#337).
      rules: deadlineRulesFor(catalogue, async (userIds) => {
        const accounts = await accountsOf(database, userIds, '')

        return new Map([...accounts].map(([userId, account]) => [userId, account.name]))
      }),
    })

    // The mail server of an operator, set up by whoever may write in its name
    // (#126, section 7 of the concept); whether it sends at all, for whoever
    // reads the settings.
    const mailing = mailSettingsParts({
      access,
      rights: { status: 'settings.read', read: 'mail.read', write: 'mail.write' },
      servers: mailServersOfOperators,
    })
    // How assets, work orders and evidence are numbered, and when the last
    // backup ran (#127): both under "Einstellungen", read by whoever reads the
    // settings, and the number ranges changed by whoever writes them, which
    // section 7 of the concept gives to the Leitung alone.
    const numbering = numberRangeParts({
      access,
      read: 'settings.read',
      write: 'settings.write',
      keys: numberRangeKeys,
      store: { numberRangesOf, changeNumberRange },
    })
    const backingUp = backupStatusParts({ access, read: 'settings.read', directory: backupStatus })
    // Push on one's own devices, and which occasions come as push.
    const pushing = pushParts({ access, rights: { write: 'push.write' }, rules: pushRules })

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
        ...mailing.controllers,
        ...pushing.controllers,
        ...numbering.controllers,
        ...backingUp.controllers,
        // The areas of a tenant, who holds in which, and who stands in for whom.
        AreasController,
        // The roles of the tenant and those it makes for itself (#346).
        RolesController,
        SubstitutionsController,
        // The place: properties, buildings, floors and rooms, and the times a
        // building is closed.
        PropertiesController,
        BuildingsController,
        BuildingClosuresController,
        FloorsController,
        RoomsController,
        // The technology: assets and their components, and the circuit chart
        // of the electrical structure below a low-voltage installation (#349).
        BuildingAssetsController,
        AssetsController,
        CircuitChartController,
        // The labels with a QR code on assets and rooms: made, blocked and
        // printed, and what a code is for whoever scans it.
        AssetLabelsController,
        RoomLabelsController,
        LabelsController,
        FreeLabelsController,
        StoreLabelsController,
        // The list of the documents as a table; the documents themselves
        // are the foundation's.
        DocumentsController,
        // The duties of an operator and the proposals dismissed.
        DutiesController,
        RoomDutiesController,
        DutyDismissalsController,
        // The overview of the operator's responsibility, the start page of
        // the office.
        OverviewController,
        // The inspections and the maintenance that came of the due days.
        ActivitiesController,
        // Collective activities: composing one, and the report of a
        // contractor for all of its assets (#342).
        CollectivesController,
        // The work orders: the list, the page, a new one, its change and
        // its acceptance.
        WorkOrdersController,
        WorkOrderSettingsController,
        ArticlesController,
        SuppliersController,
        ContractorsController,
        ContractsController,
        StoresController,
        MetersController,
        // The templates of the rounds: a new one and a new version of one.
        RoundTemplatesController,
        // The plans of the rounds, and the rounds they made: the overview of
        // a week and who walks each round.
        RoundPlansController,
        RoundsController,
        // The page of an evidence with the files it rests on, its correction
        // and its declaration of invalidity, the evidence of an asset, and the
        // report of a contractor that becomes the evidence of a duty.
        EvidenceController,
        AssetEvidenceController,
        DutyReportController,
        // The defects, their register and their further way, and the
        // default of each class under the settings.
        DefectsController,
        DefectClassSettingsController,
        // The fault reports, the inbox of the area, and their categories under
        // the settings (#331).
        FaultReportsController,
        FaultCategorySettingsController,
        FaultReportSettingsController,
        FiguresController,
        DelegationsController,
        QualificationsController,
        // Every read of an auditor from outside, for the Leitung (#339).
        AuditorReadsController,
        ...(outside === null ? [] : [OutsideReportsController]),
        MeterSettingsController,
        // The retention of the evidence and the confirmation of its end (#340).
        EvidenceRetentionController,
        RecordRetentionController,
        MembershipEndController,
        ProcessingDescriptionsController,
        PrivacyDocumentsController,
        ProcessingRecordController,
        // The information about a person (#355).
        SubjectAccessController,
        EvidencePrintController,
        RoundPrintController,
        ServiceReportPrintController,
        // The catalogue of this server, for the devices that work with it.
        CatalogueController,
        // The import of places and assets from tables.
        ImportsController,
        ImportOriginController,
        OwnKindsController,
        // The search by name, number and mark (#125).
        SearchController,
        // Who a task may go to (#124); the tasks themselves travel through the sync.
        TasksController,
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
        ...mailing.providers,
        ...pushing.providers,
        ...backingUp.providers,
        // What sends: null on a closed instance, and for push without a key.
        { provide: MAIL, useValue: mail },
        { provide: PUSH, useValue: push },
        // What prints a page, for the routes that hand out a PDF.
        { provide: RENDERER, useValue: renderer },
        Printer,
        { provide: TRUSTED_ORIGINS, useValue: trustedOrigins },
        { provide: VERSION, useValue: version },
        { provide: CATALOGUE, useValue: catalogue },
        { provide: OUTSIDE_REPORTS, useValue: outside },
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
        // No answer says when a record last changed, who changed it or from
        // which device: that stays on the row and in the change log, which
        // only the Leitung reads (section 9 of the concept).
        { provide: APP_INTERCEPTOR, useClass: StampInterceptor },
        // Every request of an auditor from outside is written down before it is served (#339).
        { provide: APP_INTERCEPTOR, useClass: AuditorReadsInterceptor },
      ],
    }
  }
}
