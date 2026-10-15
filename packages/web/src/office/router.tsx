import {
  InstanceLegalTextsScreen,
  InstanceLogScreen,
  InstanceOperatorsScreen,
  InstanceSettingsScreen,
  InstanceTenantsScreen,
} from '@opengewerk/platform-web/instance'
import { SettingsScreen, SyncScreen } from '@opengewerk/platform-web/office'
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'

import { dutyPlaces } from './duty-addresses.js'
import { proposalPlace, proposalPlaces } from './proposal-addresses.js'
import { importPlaces } from './import-addresses.js'
import { ManualChapterScreen, ManualScreen } from './instance/manual.js'
import { InstanceShell } from './instance/shell.js'
import { AccountScreen } from './screens/account.js'
import { ActivityListScreen, ActivityScreen } from './screens/activities.js'
import { AreasScreen } from './screens/areas.js'
import { AssetFileScreen } from './screens/asset.js'
import { EditAssetScreen, NewAssetScreen, NewComponentScreen } from './screens/asset-form.js'
import { AssetRegisterScreen } from './screens/assets.js'
import { BackupScreen } from './screens/backup.js'
import { EditBuildingScreen, NewBuildingScreen } from './screens/building-form.js'
import { BuildingScreen } from './screens/buildings.js'
import { CatalogueScreen } from './screens/catalogue.js'
import { ChangeLogScreen } from './screens/change-log.js'
import { DeadlineListScreen, DeadlineSettingsScreen } from './screens/deadlines.js'
import { MailSettingsScreen } from './screens/mail-settings.js'
import { DefectClassSettingsScreen } from './screens/defect-classes.js'
import { DefectListScreen, DefectScreen, NewDefectScreen } from './screens/defects.js'
import { DocumentsScreen } from './screens/documents.js'
import { TaskListScreen } from './tasks.js'
import { DutyRegisterScreen } from './screens/duties.js'
import { DutyScreen } from './screens/duty.js'
import { ConfirmDutyScreen, DutyIntervalScreen } from './screens/duty-confirm.js'
import { EditDutyScreen, NewDutyScreen } from './screens/duty-form.js'
import { DutyKindScreen } from './screens/duty-kind.js'
import { dutyUpdatesPlace, DutyUpdatesScreen } from './screens/duty-updates.js'
import { DismissedProposalsScreen, ProposalsScreen } from './screens/proposals.js'
import { EvidenceScreen } from './screens/evidence.js'
import { EditFloorScreen, NewFloorScreen } from './screens/floor-form.js'
import { FloorScreen } from './screens/floors.js'
import { GuideScreen, HelpScreen } from './screens/help.js'
import { ImportDeadlinesScreen } from './screens/import-deadlines.js'
import { ImportMetersScreen, ImportTemplatesScreen } from './screens/import-history.js'
import { ImportAssetsScreen, ImportStructureScreen } from './screens/imports.js'
import { LabelLandingScreen } from './screens/label-landing.js'
import { MeterSettingsScreen } from './screens/meter-settings.js'
import { WorkOrderSettingsScreen } from './screens/work-order-settings.js'
import { MeterListScreen, MeterScreen } from './screens/meters.js'
import { NumberRangesScreen } from './screens/number-ranges.js'
import { OverviewScreen } from './screens/overview.js'
import {
  EditPropertyScreen,
  NewPropertyScreen,
  PropertyListScreen,
  PropertyScreen,
} from './screens/properties.js'
import { ReportScreen } from './screens/report.js'
import { NewTemplateScreen, TemplateScreen } from './screens/round-template.js'
import { NewPlanScreen, PlanListScreen, PlanScreen } from './screens/round-plans.js'
import { TemplateListScreen } from './screens/round-templates.js'
import { RoundScreen } from './screens/round.js'
import { RoundWeekScreen } from './screens/round-week.js'
import { EditRoomScreen, NewRoomScreen } from './screens/room-form.js'
import { RoomScreen } from './screens/rooms.js'
import { StaffScreen } from './screens/staff.js'
import { TimelineScreen } from './timeline.js'
import { NewWorkOrderScreen, WorkOrderListScreen, WorkOrderScreen } from './screens/work-orders.js'
import { OfficeShell } from './shell.js'

/**
 * The routes of the office, written out rather than generated from file
 * names: the tree is small enough to read in one screen, and generated
 * routing needs a plugin that writes a file into the repository.
 *
 * The paths are German because the address bar is something a person reads.
 * The settings all live under `/einstellungen`, so that the one entry in the
 * navigation stays lit on every one of them, and everything about one
 * property under `/liegenschaften`. A building, a floor and a room live at
 * an address of their own, by their id (`place-addresses.ts`), and light the
 * same entry. The office starts at the overview (#122).
 *
 * A screen the board has in the navigation lives at the address its place
 * names (`navigation.tsx`). Its route here is all it takes: the place stands
 * in the navigation from then on, for whoever holds its right.
 *
 * Two frames under the root: the office of the tenant, and the area of the
 * instance under `/instanz`, with a navigation and a header of its own,
 * because nothing in it belongs to a tenant.
 *
 * A function and not a value, so that a test builds a tree of its own for a
 * router with a history of its own.
 */
export function officeRoutes() {
  const root = createRootRoute({ component: Outlet })

  const office = createRoute({
    getParentRoute: () => root,
    id: 'office',
    component: OfficeShell,
  })

  const instance = createRoute({
    getParentRoute: () => root,
    path: '/instanz',
    component: InstanceShell,
  })

  const instanceRoutes = [
    createRoute({ getParentRoute: () => instance, path: '/', component: InstanceTenantsScreen }),
    createRoute({
      getParentRoute: () => instance,
      path: '/einstellungen',
      component: InstanceSettingsScreen,
    }),
    createRoute({
      getParentRoute: () => instance,
      path: '/verwaltung',
      component: InstanceOperatorsScreen,
    }),
    // Impressum and Datenschutzhinweise of the instance (#129).
    createRoute({
      getParentRoute: () => instance,
      path: '/rechtstexte',
      component: InstanceLegalTextsScreen,
    }),
    createRoute({
      getParentRoute: () => instance,
      path: '/protokoll',
      component: InstanceLogScreen,
    }),
    // The manual for whoever runs the instance (#131).
    createRoute({ getParentRoute: () => instance, path: '/handbuch', component: ManualScreen }),
    createRoute({
      getParentRoute: () => instance,
      path: '/handbuch/$chapter',
      component: ManualChapterScreen,
    }),
  ]

  const routes = [
    createRoute({ getParentRoute: () => office, path: '/', component: OverviewScreen }),
    createRoute({
      getParentRoute: () => office,
      path: '/liegenschaften',
      component: PropertyListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/liegenschaften/neu',
      component: NewPropertyScreen,
    }),
    // The import of places from a table, under the list it fills (#100).
    createRoute({
      getParentRoute: () => office,
      path: importPlaces.structure,
      component: ImportStructureScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/liegenschaften/$propertyId',
      component: PropertyScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/liegenschaften/$propertyId/bearbeiten',
      component: EditPropertyScreen,
    }),
    // The timeline of the place (#123).
    createRoute({
      getParentRoute: () => office,
      path: '/liegenschaften/$propertyId/zeitachse',
      component: TimelineScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/liegenschaften/$propertyId/gebaeude/neu',
      component: NewBuildingScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/gebaeude/$buildingId',
      component: BuildingScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/gebaeude/$buildingId/bearbeiten',
      component: EditBuildingScreen,
    }),
    // The timeline of the place (#123).
    createRoute({
      getParentRoute: () => office,
      path: '/gebaeude/$buildingId/zeitachse',
      component: TimelineScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/gebaeude/$buildingId/geschosse/neu',
      component: NewFloorScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/geschosse/$floorId',
      component: FloorScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/geschosse/$floorId/bearbeiten',
      component: EditFloorScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/geschosse/$floorId/raeume/neu',
      component: NewRoomScreen,
    }),
    createRoute({ getParentRoute: () => office, path: '/raeume/$roomId', component: RoomScreen }),
    createRoute({
      getParentRoute: () => office,
      path: '/raeume/$roomId/bearbeiten',
      component: EditRoomScreen,
    }),
    // The timeline of the place (#123).
    createRoute({
      getParentRoute: () => office,
      path: '/raeume/$roomId/zeitachse',
      component: TimelineScreen,
    }),
    // The register of assets, narrowed by what its address names, and the
    // file of one asset under it. The form of a new asset stands under the
    // register, before the file: "neu" is no id.
    createRoute({ getParentRoute: () => office, path: '/anlagen', component: AssetRegisterScreen }),
    createRoute({ getParentRoute: () => office, path: '/anlagen/neu', component: NewAssetScreen }),
    createRoute({
      getParentRoute: () => office,
      path: importPlaces.assets,
      component: ImportAssetsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId',
      component: AssetFileScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId/bearbeiten',
      component: EditAssetScreen,
    }),
    // The timeline of the place (#123).
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId/zeitachse',
      component: TimelineScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId/komponenten/neu',
      component: NewComponentScreen,
    }),
    // The meters on a key date, narrowed by what the address names, and the
    // page of one measuring point under them, by the id of its asset (#119).
    createRoute({ getParentRoute: () => office, path: '/zaehler', component: MeterListScreen }),
    // The import of the history of the meters stands under their list, before the page of a meter (#130).
    createRoute({
      getParentRoute: () => office,
      path: importPlaces.meters,
      component: ImportMetersScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/zaehler/$meterId',
      component: MeterScreen,
    }),
    // The register of duties, narrowed by what its address names, and the
    // page of one duty under it. The form of a duty of the operator's own
    // stands under the register, before the page: "neu" is no id. Over a duty
    // there is, it stands under its page (#178).
    createRoute({
      getParentRoute: () => office,
      path: '/pflichten',
      component: DutyRegisterScreen,
    }),
    // The import of running deadlines stands under the register, before the page of a duty (#130).
    createRoute({
      getParentRoute: () => office,
      path: importPlaces.deadlines,
      component: ImportDeadlinesScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/fristen',
      component: DeadlineListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: dutyPlaces.new,
      component: NewDutyScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/pflichten/$dutyId',
      component: DutyScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/pflichten/$dutyId/bearbeiten',
      component: EditDutyScreen,
    }),
    // The proposals of the catalogue under the register, the ones dismissed
    // beside them, the form that confirms one, and the interval of a duty
    // from the catalogue under its page (#102). Static words before the page
    // of a duty, as "vorschlaege" and "bestaetigen" are no ids.
    createRoute({
      getParentRoute: () => office,
      path: proposalPlace.to,
      component: ProposalsScreen,
    }),
    // What a new version of a package changes for the duties that are
    // confirmed (#139), before the page of a duty like the proposals.
    createRoute({
      getParentRoute: () => office,
      path: dutyUpdatesPlace,
      component: DutyUpdatesScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: proposalPlaces.dismissed,
      component: DismissedProposalsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: proposalPlaces.confirm,
      component: ConfirmDutyScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/pflichten/$dutyId/frist',
      component: DutyIntervalScreen,
    }),
    // The inspections and the maintenance that came of the due days, narrowed
    // by what the address names, and the page of one under them.
    createRoute({
      getParentRoute: () => office,
      path: '/pruefungen',
      component: ActivityListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/pruefungen/$activityId',
      component: ActivityScreen,
    }),
    // The overview of the week (#113), and under it the templates of the
    // rounds (#112): the list, a new one, empty or taken over from a package,
    // and one template by its id; and the plans (#113): the list, a new one
    // and one plan by its id.
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge',
      component: RoundWeekScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/plaene',
      component: PlanListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/plaene/neu',
      component: NewPlanScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/plaene/$planId',
      component: PlanScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/vorlagen',
      component: TemplateListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/vorlagen/neu',
      component: NewTemplateScreen,
    }),
    // The import of templates stands under their list, before the page of a template (#130).
    createRoute({
      getParentRoute: () => office,
      path: importPlaces.templates,
      component: ImportTemplatesScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/vorlagen/$templateId',
      component: TemplateScreen,
    }),
    // One round by the id of its activity (#115): what was signed, the
    // countersignature, and closing one of a past day with the reason.
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/$roundId',
      component: RoundScreen,
    }),
    // The work orders (#117): the list, a new one, and the page of one by the
    // id of its activity.
    createRoute({
      getParentRoute: () => office,
      path: '/auftraege',
      component: WorkOrderListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/auftraege/neu',
      component: NewWorkOrderScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/auftraege/$orderId',
      component: WorkOrderScreen,
    }),
    // The page of an evidence, opened from its duty, the file of its asset
    // and the register, and the report of a contractor that becomes the
    // evidence of a duty, by the id of the duty.
    createRoute({
      getParentRoute: () => office,
      path: '/nachweise/bericht/$dutyId',
      component: ReportScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/nachweise/$evidenceId',
      component: EvidenceScreen,
    }),
    // The documents, narrowed by what the address names, and the same list
    // with one document chosen under it, by its id.
    // The defects (#116): the list, reporting one by hand, and the page of one.
    createRoute({
      getParentRoute: () => office,
      path: '/maengel',
      component: DefectListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/maengel/neu',
      component: NewDefectScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/maengel/$defectId',
      component: DefectScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/dokumente',
      component: DocumentsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/dokumente/$documentId',
      component: DocumentsScreen,
    }),
    // The tasks of the person and the open ones of the others on this device (#124).
    createRoute({ getParentRoute: () => office, path: '/aufgaben', component: TaskListScreen }),
    // The catalogue: the packages, one of them with one of its parts, and
    // the page of a duty kind under the package it comes from.
    createRoute({ getParentRoute: () => office, path: '/katalog', component: CatalogueScreen }),
    createRoute({
      getParentRoute: () => office,
      path: '/katalog/$packageName',
      component: CatalogueScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/katalog/$packageName/$part',
      component: CatalogueScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/katalog/$packageName/pflichtarten/$dutyKey',
      component: DutyKindScreen,
    }),
    // The address on a label with a QR code: it leads on to the asset or the
    // room the label hangs on, or says why it opens nothing.
    createRoute({
      getParentRoute: () => office,
      path: '/a/$code',
      component: LabelLandingScreen,
    }),
    // The quick guides to the core flows (#131); the help of a single page
    // stands beside it, behind the question mark of the header.
    createRoute({ getParentRoute: () => office, path: '/hilfe', component: HelpScreen }),
    createRoute({ getParentRoute: () => office, path: '/hilfe/$guide', component: GuideScreen }),
    createRoute({ getParentRoute: () => office, path: '/konflikte', component: SyncScreen }),
    createRoute({ getParentRoute: () => office, path: '/konto', component: AccountScreen }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen',
      component: SettingsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/bereiche',
      component: AreasScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/zugaenge',
      component: StaffScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/fristen',
      component: DeadlineSettingsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/e-mail',
      component: MailSettingsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/maengelklassen',
      component: DefectClassSettingsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/zaehler',
      component: MeterSettingsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/auftraege',
      component: WorkOrderSettingsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/nummernkreise',
      component: NumberRangesScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/sicherung',
      component: BackupScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/protokoll',
      component: ChangeLogScreen,
    }),
  ]

  return root.addChildren([office.addChildren(routes), instance.addChildren(instanceRoutes)])
}

export const officeRouter = createRouter({
  routeTree: officeRoutes(),
  // Everything a screen reads comes out of the sync client or a query that
  // is asked once. There is nothing to wait for between routes, so there is
  // nothing to show while waiting.
  defaultPendingMs: 0,
})
