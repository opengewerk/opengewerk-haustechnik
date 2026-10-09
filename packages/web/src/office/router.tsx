import {
  InstanceLogScreen,
  InstanceOperatorsScreen,
  InstanceSettingsScreen,
  InstanceTenantsScreen,
} from '@opengewerk/platform-web/instance'
import { AuditLogScreen, SettingsScreen, SyncScreen } from '@opengewerk/platform-web/office'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { dutyPlaces } from './duty-addresses.js'
import { importPlaces } from './import-addresses.js'
import { InstanceShell } from './instance/shell.js'
import { AccountScreen } from './screens/account.js'
import { ActivityListScreen, ActivityScreen } from './screens/activities.js'
import { AreasScreen } from './screens/areas.js'
import { AssetFileScreen } from './screens/asset.js'
import { EditAssetScreen, NewAssetScreen, NewComponentScreen } from './screens/asset-form.js'
import { AssetRegisterScreen } from './screens/assets.js'
import { EditBuildingScreen, NewBuildingScreen } from './screens/building-form.js'
import { BuildingScreen } from './screens/buildings.js'
import { CatalogueScreen } from './screens/catalogue.js'
import { DeadlineListScreen, DeadlineSettingsScreen } from './screens/deadlines.js'
import { DefectClassSettingsScreen } from './screens/defect-classes.js'
import { DefectListScreen, DefectScreen, NewDefectScreen } from './screens/defects.js'
import { DocumentsScreen } from './screens/documents.js'
import { DutyRegisterScreen } from './screens/duties.js'
import { DutyScreen } from './screens/duty.js'
import { NewDutyScreen } from './screens/duty-form.js'
import { DutyKindScreen } from './screens/duty-kind.js'
import { EvidenceScreen } from './screens/evidence.js'
import { EditFloorScreen, NewFloorScreen } from './screens/floor-form.js'
import { FloorScreen } from './screens/floors.js'
import { ImportAssetsScreen, ImportStructureScreen } from './screens/imports.js'
import { LabelLandingScreen } from './screens/label-landing.js'
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
import { RoundWeekScreen } from './screens/round-week.js'
import { EditRoomScreen, NewRoomScreen } from './screens/room-form.js'
import { RoomScreen } from './screens/rooms.js'
import { StaffScreen } from './screens/staff.js'
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
 * same entry. Until the overview is built, the office starts at the
 * properties: the first list there is, and one every role reads.
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
    createRoute({
      getParentRoute: () => instance,
      path: '/protokoll',
      component: InstanceLogScreen,
    }),
  ]

  const routes = [
    createRoute({
      getParentRoute: () => office,
      path: '/',
      beforeLoad: () => {
        throw redirect({ to: '/liegenschaften' })
      },
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
    createRoute({
      getParentRoute: () => office,
      path: '/anlagen/$assetId/komponenten/neu',
      component: NewComponentScreen,
    }),
    // The register of duties, narrowed by what its address names, and the
    // page of one duty under it. The form of a duty of the operator's own
    // stands under the register, before the page: "neu" is no id.
    createRoute({
      getParentRoute: () => office,
      path: '/pflichten',
      component: DutyRegisterScreen,
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
    createRoute({
      getParentRoute: () => office,
      path: '/rundgaenge/vorlagen/$templateId',
      component: TemplateScreen,
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
      path: '/einstellungen/maengelklassen',
      component: DefectClassSettingsScreen,
    }),
    createRoute({
      getParentRoute: () => office,
      path: '/einstellungen/protokoll',
      component: AuditLogScreen,
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
