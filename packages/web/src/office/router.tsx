// The screens of the instance, the defects and the backup stay in the entry all the
// same (#374): the shells and the overview import them, so a fetch of their own would win nothing.
import {
  InstanceLegalTextsScreen,
  InstanceLogScreen,
  InstanceMeasuresScreen,
  InstanceOperatorsScreen,
  InstanceSettingsScreen,
  InstanceTenantsScreen,
} from '@opengewerk/platform-web/instance'
import { SettingsScreen, SyncScreen } from '@opengewerk/platform-web/office'
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router'

import { dutyPlaces } from './duty-addresses.js'
import { proposalPlace, proposalPlaces } from './proposal-addresses.js'
import { importPlaces } from './import-addresses.js'
import { InstanceShell } from './instance/shell.js'
import { BackupScreen } from './screens/backup.js'
import { DefectListScreen, DefectScreen, NewDefectScreen } from './screens/defects.js'
import { dutyUpdatesPlace } from './screens/duty-updates.js'
import { OverviewScreen } from './screens/overview.js'
import { OfficeShell } from './shell.js'

// Every screen but the overview, which the office starts at, is fetched when its address
// is opened (#374): the entry of the office has a budget (`scripts/budget.js`), and most
// people open few of the screens on a day. A screen shared by several addresses is one
// chunk, fetched once; the service worker holds every chunk of its version, so a screen
// opens also after the next version came, until the page takes it over.
const ManualChapterScreen = lazyRouteComponent(
  () => import('./instance/manual.js'),
  'ManualChapterScreen',
)
const ManualScreen = lazyRouteComponent(() => import('./instance/manual.js'), 'ManualScreen')
const AccountScreen = lazyRouteComponent(() => import('./screens/account.js'), 'AccountScreen')
const ActivityListScreen = lazyRouteComponent(
  () => import('./screens/activities.js'),
  'ActivityListScreen',
)
const ActivityScreen = lazyRouteComponent(() => import('./screens/activities.js'), 'ActivityScreen')
const CollectiveComposeScreen = lazyRouteComponent(
  () => import('./screens/collectives.js'),
  'CollectiveComposeScreen',
)
// "PDF prüfen" (#457), a page of its own under the register of duties.
const PdfCheckScreen = lazyRouteComponent(() => import('./screens/pdf-check.js'), 'PdfCheckScreen')
const CollectiveReportScreen = lazyRouteComponent(
  () => import('./screens/collectives.js'),
  'CollectiveReportScreen',
)
const AreasScreen = lazyRouteComponent(() => import('./screens/areas.js'), 'AreasScreen')
const AssetFileScreen = lazyRouteComponent(() => import('./screens/asset.js'), 'AssetFileScreen')
const EditAssetScreen = lazyRouteComponent(
  () => import('./screens/asset-form.js'),
  'EditAssetScreen',
)
const NewAssetScreen = lazyRouteComponent(() => import('./screens/asset-form.js'), 'NewAssetScreen')
const NewComponentScreen = lazyRouteComponent(
  () => import('./screens/asset-form.js'),
  'NewComponentScreen',
)
const BoardScreen = lazyRouteComponent(() => import('./screens/board.js'), 'BoardScreen')
const BoardLandingScreen = lazyRouteComponent(
  () => import('./screens/board.js'),
  'BoardLandingScreen',
)
const InverterScreen = lazyRouteComponent(() => import('./screens/inverter.js'), 'InverterScreen')
const AssetRegisterScreen = lazyRouteComponent(
  () => import('./screens/assets.js'),
  'AssetRegisterScreen',
)
const EditBuildingScreen = lazyRouteComponent(
  () => import('./screens/building-form.js'),
  'EditBuildingScreen',
)
const NewBuildingScreen = lazyRouteComponent(
  () => import('./screens/building-form.js'),
  'NewBuildingScreen',
)
const BuildingScreen = lazyRouteComponent(() => import('./screens/buildings.js'), 'BuildingScreen')
const CatalogueScreen = lazyRouteComponent(
  () => import('./screens/catalogue.js'),
  'CatalogueScreen',
)
const OwnKindsListScreen = lazyRouteComponent(
  () => import('./screens/own-kinds.js'),
  'OwnKindsListScreen',
)
const OwnFieldsListScreen = lazyRouteComponent(
  () => import('./screens/own-kinds.js'),
  'OwnFieldsListScreen',
)
const OwnKindScreen = lazyRouteComponent(() => import('./screens/own-kinds.js'), 'OwnKindScreen')
const ChangeLogScreen = lazyRouteComponent(
  () => import('./screens/change-log.js'),
  'ChangeLogScreen',
)
const ImportScreen = lazyRouteComponent(() => import('./screens/import.js'), 'ImportScreen')
const DeadlineListScreen = lazyRouteComponent(
  () => import('./screens/deadlines.js'),
  'DeadlineListScreen',
)
const DeadlineSettingsScreen = lazyRouteComponent(
  () => import('./screens/deadlines.js'),
  'DeadlineSettingsScreen',
)
const MailSettingsScreen = lazyRouteComponent(
  () => import('./screens/mail-settings.js'),
  'MailSettingsScreen',
)
const DefectClassSettingsScreen = lazyRouteComponent(
  () => import('./screens/defect-classes.js'),
  'DefectClassSettingsScreen',
)
const FaultCategorySettingsScreen = lazyRouteComponent(
  () => import('./screens/fault-categories.js'),
  'FaultCategorySettingsScreen',
)
const FaultListScreen = lazyRouteComponent(
  () => import('./screens/fault-reports.js'),
  'FaultListScreen',
)
const FaultReportScreen = lazyRouteComponent(
  () => import('./screens/fault-reports.js'),
  'FaultReportScreen',
)
const FiguresScreen = lazyRouteComponent(() => import('./screens/figures.js'), 'FiguresScreen')
const DelegationListScreen = lazyRouteComponent(
  () => import('./screens/delegations.js'),
  'DelegationListScreen',
)
const DelegationScreen = lazyRouteComponent(
  () => import('./screens/delegations.js'),
  'DelegationScreen',
)
const QualificationListScreen = lazyRouteComponent(
  () => import('./screens/qualifications.js'),
  'QualificationListScreen',
)
const DocumentsScreen = lazyRouteComponent(
  () => import('./screens/documents.js'),
  'DocumentsScreen',
)
const TaskListScreen = lazyRouteComponent(() => import('./tasks.js'), 'TaskListScreen')
const DutyRegisterScreen = lazyRouteComponent(
  () => import('./screens/duties.js'),
  'DutyRegisterScreen',
)
const DutyScreen = lazyRouteComponent(() => import('./screens/duty.js'), 'DutyScreen')
const ConfirmDutyScreen = lazyRouteComponent(
  () => import('./screens/duty-confirm.js'),
  'ConfirmDutyScreen',
)
const DutyIntervalScreen = lazyRouteComponent(
  () => import('./screens/duty-confirm.js'),
  'DutyIntervalScreen',
)
const EditDutyScreen = lazyRouteComponent(() => import('./screens/duty-form.js'), 'EditDutyScreen')
const NewDutyScreen = lazyRouteComponent(() => import('./screens/duty-form.js'), 'NewDutyScreen')
const DutyKindScreen = lazyRouteComponent(() => import('./screens/duty-kind.js'), 'DutyKindScreen')
const DutyUpdatesScreen = lazyRouteComponent(
  () => import('./screens/duty-updates.js'),
  'DutyUpdatesScreen',
)
const DismissedProposalsScreen = lazyRouteComponent(
  () => import('./screens/proposals.js'),
  'DismissedProposalsScreen',
)
const ProposalsScreen = lazyRouteComponent(
  () => import('./screens/proposals.js'),
  'ProposalsScreen',
)
const EvidenceScreen = lazyRouteComponent(() => import('./screens/evidence.js'), 'EvidenceScreen')
const EditFloorScreen = lazyRouteComponent(
  () => import('./screens/floor-form.js'),
  'EditFloorScreen',
)
const NewFloorScreen = lazyRouteComponent(() => import('./screens/floor-form.js'), 'NewFloorScreen')
const FloorScreen = lazyRouteComponent(() => import('./screens/floors.js'), 'FloorScreen')
const GuideScreen = lazyRouteComponent(() => import('./screens/help.js'), 'GuideScreen')
const HelpScreen = lazyRouteComponent(() => import('./screens/help.js'), 'HelpScreen')
const LabelLandingScreen = lazyRouteComponent(
  () => import('./screens/label-landing.js'),
  'LabelLandingScreen',
)
const MeterSettingsScreen = lazyRouteComponent(
  () => import('./screens/meter-settings.js'),
  'MeterSettingsScreen',
)
const RetentionScreen = lazyRouteComponent(
  () => import('./screens/retention.js'),
  'RetentionScreen',
)
const ProcessingDescriptionsScreen = lazyRouteComponent(
  () => import('./screens/processing-descriptions.js'),
  'ProcessingDescriptionsScreen',
)
const ProcessingRecordScreen = lazyRouteComponent(
  () => import('./screens/processing-record.js'),
  'ProcessingRecordScreen',
)
const WorkOrderSettingsScreen = lazyRouteComponent(
  () => import('./screens/work-order-settings.js'),
  'WorkOrderSettingsScreen',
)
const MeterListScreen = lazyRouteComponent(() => import('./screens/meters.js'), 'MeterListScreen')
const MeterScreen = lazyRouteComponent(() => import('./screens/meters.js'), 'MeterScreen')
const NumberRangesScreen = lazyRouteComponent(
  () => import('./screens/number-ranges.js'),
  'NumberRangesScreen',
)
const EditPropertyScreen = lazyRouteComponent(
  () => import('./screens/properties.js'),
  'EditPropertyScreen',
)
const NewPropertyScreen = lazyRouteComponent(
  () => import('./screens/properties.js'),
  'NewPropertyScreen',
)
const PropertyListScreen = lazyRouteComponent(
  () => import('./screens/properties.js'),
  'PropertyListScreen',
)
const PropertyScreen = lazyRouteComponent(() => import('./screens/properties.js'), 'PropertyScreen')
const ReportScreen = lazyRouteComponent(() => import('./screens/report.js'), 'ReportScreen')
const NewTemplateScreen = lazyRouteComponent(
  () => import('./screens/round-template.js'),
  'NewTemplateScreen',
)
const TemplateScreen = lazyRouteComponent(
  () => import('./screens/round-template.js'),
  'TemplateScreen',
)
const NewPlanScreen = lazyRouteComponent(() => import('./screens/round-plans.js'), 'NewPlanScreen')
const PlanListScreen = lazyRouteComponent(
  () => import('./screens/round-plans.js'),
  'PlanListScreen',
)
const PlanScreen = lazyRouteComponent(() => import('./screens/round-plans.js'), 'PlanScreen')
const TemplateListScreen = lazyRouteComponent(
  () => import('./screens/round-templates.js'),
  'TemplateListScreen',
)
const RoundScreen = lazyRouteComponent(() => import('./screens/round.js'), 'RoundScreen')
const RoundWeekScreen = lazyRouteComponent(
  () => import('./screens/round-week.js'),
  'RoundWeekScreen',
)
const EditRoomScreen = lazyRouteComponent(() => import('./screens/room-form.js'), 'EditRoomScreen')
const NewRoomScreen = lazyRouteComponent(() => import('./screens/room-form.js'), 'NewRoomScreen')
const RoomScreen = lazyRouteComponent(() => import('./screens/rooms.js'), 'RoomScreen')
const ContractListScreen = lazyRouteComponent(
  () => import('./screens/contracts.js'),
  'ContractListScreen',
)
const ContractScreen = lazyRouteComponent(() => import('./screens/contracts.js'), 'ContractScreen')
const ContractorListScreen = lazyRouteComponent(
  () => import('./screens/contractors.js'),
  'ContractorListScreen',
)
const ContractorScreen = lazyRouteComponent(
  () => import('./screens/contractors.js'),
  'ContractorScreen',
)
const StaffScreen = lazyRouteComponent(() => import('./screens/staff.js'), 'StaffScreen')
const RolesScreen = lazyRouteComponent(() => import('./screens/roles.js'), 'RolesScreen')
const RoleScreen = lazyRouteComponent(() => import('./screens/roles.js'), 'RoleScreen')
const NewRoleScreen = lazyRouteComponent(() => import('./screens/roles.js'), 'NewRoleScreen')
const TimelineScreen = lazyRouteComponent(() => import('./timeline.js'), 'TimelineScreen')
const ArticleListScreen = lazyRouteComponent(
  () => import('./screens/stores.js'),
  'ArticleListScreen',
)
const StoreArticleScreen = lazyRouteComponent(
  () => import('./screens/stores.js'),
  'StoreArticleScreen',
)
const StoreStockScreen = lazyRouteComponent(() => import('./screens/stores.js'), 'StoreStockScreen')
const SupplierListScreen = lazyRouteComponent(
  () => import('./screens/stores.js'),
  'SupplierListScreen',
)
const NewWorkOrderScreen = lazyRouteComponent(
  () => import('./screens/work-orders.js'),
  'NewWorkOrderScreen',
)
const WorkOrderListScreen = lazyRouteComponent(
  () => import('./screens/work-orders.js'),
  'WorkOrderListScreen',
)
const WorkOrderScreen = lazyRouteComponent(
  () => import('./screens/work-orders.js'),
  'WorkOrderScreen',
)

// The imports are used when an operator moves in and seldom after: their
// screens are fetched when one is opened and are no part of the entry of the
// office, which has a budget (`scripts/budget.js`).
const importScreens = {
  structure: lazyRouteComponent(() => import('./screens/imports.js'), 'ImportStructureScreen'),
  assets: lazyRouteComponent(() => import('./screens/imports.js'), 'ImportAssetsScreen'),
  meters: lazyRouteComponent(() => import('./screens/import-history.js'), 'ImportMetersScreen'),
  templates: lazyRouteComponent(
    () => import('./screens/import-history.js'),
    'ImportTemplatesScreen',
  ),
  deadlines: lazyRouteComponent(
    () => import('./screens/import-deadlines.js'),
    'ImportDeadlinesScreen',
  ),
}
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
    // Part B of the measures and the subprocessors of the instance (#358).
    createRoute({
      getParentRoute: () => instance,
      path: '/massnahmen',
      component: InstanceMeasuresScreen,
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
    // The figures over time (#334), a view each behind a word of the address.
    createRoute({ getParentRoute: () => office, path: '/auswertungen', component: FiguresScreen }),
    // The delegations of the duties (#336): the list and the page of one.
    createRoute({
      getParentRoute: () => office,
      path: '/pflichtenuebertragungen',
      component: DelegationListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/pflichtenuebertragungen/$delegationId',
      component: DelegationScreen,
    }),
    // The qualifications of the people (#337).
    createRoute({
      getParentRoute: () => office,
      path: '/qualifikationen',
      component: QualificationListScreen,
    }),
    // A PDF laid before somebody, checked (#457), from the navigation under "Pflichten".
    createRoute({
      getParentRoute: () => office,
      path: '/pdf-pruefen',
      component: PdfCheckScreen,
    }),
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
      component: importScreens.structure,
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
      component: importScreens.assets,
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
    // A board of a low-voltage installation under its file, and a circuit of
    // it chosen beside the list (#349).
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId/verteiler/$boardId',
      component: BoardScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId/verteiler/$boardId/stromkreise/$circuitId',
      component: BoardScreen,
    }),
    // A board by its id alone, which the change log links to and which hands
    // on to the page under its asset (`boardLanding`).
    createRoute({
      getParentRoute: () => office,
      path: '/verteiler/$boardId',
      component: BoardLandingScreen,
    }),
    // An inverter of a PV installation under its file, with its strings and
    // their modules (#461).
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId/wechselrichter/$inverterId',
      component: InverterScreen,
    }),
    // The meters on a key date, narrowed by what the address names, and the
    // page of one measuring point under them, by the id of its asset (#119).
    createRoute({ getParentRoute: () => office, path: '/zaehler', component: MeterListScreen }),
    // The import of the history of the meters stands under their list, before the page of a meter (#130).
    createRoute({
      getParentRoute: () => office,
      path: importPlaces.meters,
      component: importScreens.meters,
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
      component: importScreens.deadlines,
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
    // Composing a collective activity, and the report of a contractor for
    // all of its assets (#342).
    createRoute({
      getParentRoute: () => office,
      path: '/pruefungen/sammelvorgang',
      component: CollectiveComposeScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/pruefungen/$activityId/bericht',
      component: CollectiveReportScreen,
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
      component: importScreens.templates,
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
    // The fault reports (#331): the inbox of the area and the page of one.
    createRoute({
      getParentRoute: () => office,
      path: '/stoerungen',
      component: FaultListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/stoerungen/$faultReportId',
      component: FaultReportScreen,
    }),
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
    // The stores (#325): the stock of a store, the articles, the suppliers,
    // and one article in one store.
    createRoute({ getParentRoute: () => office, path: '/lager', component: StoreStockScreen }),
    createRoute({
      getParentRoute: () => office,
      path: '/lager/artikel',
      component: ArticleListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/lager/lieferanten',
      component: SupplierListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/lager/$storeId/artikel/$articleId',
      component: StoreArticleScreen,
    }),
    // The contractors of the operator (#328): the list and one firm.
    createRoute({
      getParentRoute: () => office,
      path: '/fremdfirmen',
      component: ContractorListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/fremdfirmen/$contractorId',
      component: ContractorScreen,
    }),
    // The contracts with them (#329): the list and one contract.
    createRoute({
      getParentRoute: () => office,
      path: '/vertraege',
      component: ContractListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/vertraege/$contractId',
      component: ContractScreen,
    }),
    // The catalogue: the packages, one of them with one of its parts, and
    // the page of a duty kind under the package it comes from.
    createRoute({ getParentRoute: () => office, path: '/katalog', component: CatalogueScreen }),
    // What the operator added (#62), before the packages so that the address is no package.
    createRoute({
      getParentRoute: () => office,
      path: '/katalog/eigen',
      component: OwnKindsListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/katalog/eigen/angaben',
      component: OwnFieldsListScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/katalog/eigen/arten/$kindKey',
      component: OwnKindScreen,
    }),
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
    // The roles of the tenant and those it makes for itself (#346).
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/rollen',
      component: RolesScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/rollen/neu',
      component: NewRoleScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/rollen/$roleKey',
      component: RoleScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/fristen',
      component: DeadlineSettingsScreen,
    }),
    // The retention of the evidence and what can be deleted (#340).
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/aufbewahrung',
      component: RetentionScreen,
    }),
    // The description of the processing and the versions made (#357).
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/datenschutz',
      component: ProcessingDescriptionsScreen,
    }),
    // What the Leitung writes for the record of the processing (#358).
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/datenschutz/verzeichnis',
      component: ProcessingRecordScreen,
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
    // The categories of the fault reports (#331).
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/stoerungen',
      component: FaultCategorySettingsScreen,
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
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/protokoll/importe/$importId',
      component: ImportScreen,
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
