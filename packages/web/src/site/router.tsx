import { useRight } from '@opengewerk/platform-web/session'
import { ConflictScreen } from '@opengewerk/platform-web/site'
import { maybeText, useRecord } from '@opengewerk/platform-web/sync'
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouteComponent,
  useParams,
} from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

import { SiteAssetScreen } from './screens/asset.js'
import { SitePointScreen } from './screens/form.js'
import {
  SiteBuildingScreen,
  SiteFloorScreen,
  SitePropertyScreen,
  SiteRoomScreen,
  StockStartScreen,
} from './screens/places.js'
import { SiteScanScreen } from './screens/scan.js'
import { SiteActivityScreen, SiteProtocolScreen } from './screens/protocol.js'
import { SiteResultScreen } from './screens/result.js'
import { SiteStartScreen } from './screens/start.js'
import { SiteMaterialScreen } from './screens/material.js'
import { SiteBriefingScreen, SiteWorkPermitScreen } from './screens/visit.js'
import {
  SiteCloseOrderScreen,
  SiteNoteScreen,
  SiteServiceReportScreen,
} from './screens/work-order.js'
import { SiteGuideScreen, SiteHelpScreen, SiteScreenHelpScreen } from './help.js'
import {
  FaultPlaceScreen,
  FaultReportedScreen,
  OwnReportScreen,
  ReportFaultScreen,
  ReporterScanScreen,
  ReporterStartScreen,
} from './reporting.js'
import { SiteShell } from './shell.js'
import { MyTasksScreen } from './tasks.js'
import { TravelScreen } from './travel.js'

// What only taking stock needs, the forms of the tab "Aufnehmen", the label an asset is
// given and the pages of the electrical structure (#349), is fetched when its address is
// opened: the entry on site has a budget of 300 kB (`scripts/budget.js`, ADR 0004), and only
// whoever takes stock opens these, on few days. The service worker holds every chunk of its
// version, so they open without a network as well.
const GiveLabelScreen = lazyRouteComponent(
  () => import('./screens/give-label.js'),
  'GiveLabelScreen',
)
const TakeAssetScreen = lazyRouteComponent(
  () => import('./screens/take-asset.js'),
  'TakeAssetScreen',
)
const TakeRoomScreen = lazyRouteComponent(() => import('./screens/take-room.js'), 'TakeRoomScreen')
const SiteBoardFormScreen = lazyRouteComponent(
  () => import('./screens/boards.js'),
  'SiteBoardFormScreen',
)
const SiteBoardScreen = lazyRouteComponent(() => import('./screens/boards.js'), 'SiteBoardScreen')
const SiteCircuitFormScreen = lazyRouteComponent(
  () => import('./screens/boards.js'),
  'SiteCircuitFormScreen',
)
const SiteCircuitScreen = lazyRouteComponent(
  () => import('./screens/boards.js'),
  'SiteCircuitScreen',
)
const SiteEquipmentFormScreen = lazyRouteComponent(
  () => import('./screens/boards.js'),
  'SiteEquipmentFormScreen',
)
// The handing in of a round with its signature, the signature of a collective
// activity, the round of the meters, the label scanned in a round and a
// defect reported on its own are fetched with
// their address as well (#350): with the measurements per circuit the entry
// on site passed its budget, and each of them is a screen of its own that
// nothing else in the entry draws.
const RoundHandInScreen = lazyRouteComponent(
  () => import('./screens/hand-in.js'),
  'RoundHandInScreen',
)
const RoundSignScreen = lazy(async () => ({
  default: (await import('./screens/hand-in.js')).RoundSignScreen,
}))
const SiteCollectiveSignScreen = lazy(async () => ({
  default: (await import('./screens/collective.js')).SiteCollectiveSignScreen,
}))
const ReadingRoundScreen = lazyRouteComponent(
  () => import('./screens/reading-round.js'),
  'ReadingRoundScreen',
)
const RoundScanScreen = lazyRouteComponent(
  () => import('./screens/round-scan.js'),
  'RoundScanScreen',
)
const ReportDefectScreen = lazyRouteComponent(
  () => import('./screens/report-defect.js'),
  'ReportDefectScreen',
)
// The block of a circuit in a protocol that measures every circuit (#350).
const SiteCircuitBlockScreen = lazyRouteComponent(
  () => import('./screens/protocol-circuits.js'),
  'SiteCircuitBlockScreen',
)
const SiteSectionFormScreen = lazyRouteComponent(
  () => import('./screens/boards.js'),
  'SiteSectionFormScreen',
)

/**
 * The routes of the entry for the work on site.
 *
 * `basepath` is what makes this a second application at `/m` rather than a
 * section of the first. The two are separate documents with separate bundles,
 * which is how the budget for the first load on site can mean anything: the
 * phone never downloads the office.
 *
 * The start is what is due today and this week for the person who holds the
 * device (#114); the conflicts stand at the address the foundation gives
 * them, among its tabs.
 *
 * A screen the board has among the tabs lives at the address its tab names
 * (`tabs.tsx`). Its route here is all it takes: the tab stands from then on,
 * for whoever holds its right.
 *
 * The places have the words of the office in their addresses (`places.ts`):
 * a property, a building, a floor, a room and an asset each have a plain page
 * that leads to what lies below it (#99, 4.1 of the concept), and taking
 * stock lives under the tab "Aufnehmen", each form under the place it takes
 * something into.
 *
 * A function and not a value, so that a test builds a tree of its own for a
 * router with a history of its own.
 */
export function siteRoutes() {
  const root = createRootRoute({ component: SiteShell })
  const at = (path: string, component: RouteComponent) =>
    createRoute({ getParentRoute: () => root, path, component })

  return root.addChildren([
    at('/', StartForTheRole),
    at('/konflikte', ConflictScreen),
    // The tab "Scannen": the label of an asset or a room, read by the camera;
    // for whoever only reports, the place to report at (#331).
    at('/scannen', ScanForTheRole),
    // The tab "Aufnehmen": where, and then a room on a floor or an asset in a
    // building, on request in one of its rooms.
    at('/aufnehmen', StockStartScreen),
    at('/aufnehmen/gebaeude/$buildingId', TakeAssetScreen),
    at('/aufnehmen/raum/$roomId', TakeAssetScreen),
    at('/aufnehmen/geschoss/$floorId', TakeRoomScreen),
    // The plain pages of the places, and the label an asset is given.
    at('/liegenschaften/$propertyId', SitePropertyScreen),
    at('/gebaeude/$buildingId', SiteBuildingScreen),
    at('/geschosse/$floorId', SiteFloorScreen),
    at('/raeume/$roomId', SiteRoomScreen),
    at('/anlagen/$assetId', SiteAssetScreen),
    at('/anlagen/$assetId/etikett', GiveLabelScreen),
    // The electrical structure of a low-voltage installation (#349): a board,
    // a circuit of it, and the forms that add and change them, also without
    // a network.
    at('/anlagen/$assetId/verteiler/neu', SiteBoardFormScreen),
    at('/anlagen/$assetId/verteiler/$boardId', SiteBoardScreen),
    at('/anlagen/$assetId/verteiler/$boardId/bearbeiten', SiteBoardFormScreen),
    at('/anlagen/$assetId/verteiler/$boardId/felder/neu', SiteSectionFormScreen),
    at('/anlagen/$assetId/verteiler/$boardId/felder/$sectionId/bearbeiten', SiteSectionFormScreen),
    at('/anlagen/$assetId/verteiler/$boardId/stromkreise/neu', SiteCircuitFormScreen),
    at('/anlagen/$assetId/verteiler/$boardId/stromkreise/$circuitId', SiteCircuitScreen),
    at(
      '/anlagen/$assetId/verteiler/$boardId/stromkreise/$circuitId/bearbeiten',
      SiteCircuitFormScreen,
    ),
    at(
      '/anlagen/$assetId/verteiler/$boardId/stromkreise/$circuitId/betriebsmittel/neu',
      SiteEquipmentFormScreen,
    ),
    at(
      '/anlagen/$assetId/verteiler/$boardId/stromkreise/$circuitId/betriebsmittel/$equipmentId/bearbeiten',
      SiteEquipmentFormScreen,
    ),
    // A defect reported at an asset or a room, also without a network (#116).
    at('/anlagen/$assetId/mangel', ReportDefectScreen),
    at('/raeume/$roomId/mangel', ReportDefectScreen),
    // An activity: a round point by point (#107), the protocol of an
    // inspection or a maintenance as a list, its result with the signature
    // and a defect reported in it (#108), the handing in of a round and its
    // signature (#114), and a work order with its notes (#118), also without
    // a network.
    at('/vorgaenge/$activityId', SiteActivityScreen),
    at('/vorgaenge/$activityId/punkte/$pointKey', SitePointScreen),
    // The block of a circuit with its points (#350).
    at('/vorgaenge/$activityId/stromkreise/$circuitId', SiteCircuitBlockScreen),
    at('/vorgaenge/$activityId/ergebnis', SiteResultScreen),
    at('/vorgaenge/$activityId/mangel', ReportDefectScreen),
    at('/vorgaenge/$activityId/abgabe', RoundHandInScreen),
    at('/vorgaenge/$activityId/unterschrift', SignForTheKind),
    // A work order: its protocol where it is an inspection or a maintenance,
    // a note on it and its finishing with the signature (#118).
    at('/vorgaenge/$activityId/protokoll', SiteProtocolScreen),
    at('/vorgaenge/$activityId/notiz', SiteNoteScreen),
    at('/vorgaenge/$activityId/abschliessen', SiteCloseOrderScreen),
    at('/vorgaenge/$activityId/leistungsnachweis', SiteServiceReportScreen),
    // Material from the stores for a work order, by scan or search (#326).
    at('/vorgaenge/$activityId/material', SiteMaterialScreen),
    // The label of an asset scanned in a round opens its point (#343).
    at('/vorgaenge/$activityId/scannen', RoundScanScreen),
    // A contractor at work: a briefing and the permit for hot work (#330).
    at('/vorgaenge/$activityId/einweisung', SiteBriefingScreen),
    at('/vorgaenge/$activityId/erlaubnisschein', SiteWorkPermitScreen),
    // A round of the meters of a property, also without a network (#120).
    at('/ablesung/$propertyId', ReadingRoundScreen),
    // The tasks of the person holding the device, from the menu (#124).
    at('/aufgaben', MyTasksScreen),
    // The documents this device keeps for the road, from the menu (#348).
    at('/unterwegs', TravelScreen),
    // Reporting a fault and the own reports (#331): the start of a Melder,
    // from the menu for every other role that reports.
    at('/meldungen', ReporterStartScreen),
    at('/meldungen/$faultReportId', OwnReportScreen),
    at('/stoerung', ReportFaultScreen),
    at('/stoerung/ort', FaultPlaceScreen),
    at('/stoerung/gemeldet', FaultReportedScreen),
    // The help, from the menu (#131): a text for each screen and the quick
    // guides, read without a network.
    at('/hilfe', SiteHelpScreen),
    at('/hilfe/bildschirm/$screen', SiteScreenHelpScreen),
    at('/hilfe/$guide', SiteGuideScreen),
  ])
}

/**
 * The start for the role (#331): what is due this week for whoever sees the
 * places, the own reports for whoever only reports, a Melder.
 */
function StartForTheRole() {
  const seesPlaces = useRight('location.read')
  const reports = useRight('fault.report')

  return !seesPlaces && reports ? <ReporterStartScreen /> : <SiteStartScreen />
}

/**
 * The signature of a round after it is handed in (#114), and the one
 * signature of a collective activity under the list of its assets (#342).
 */
function SignForTheKind() {
  const { activityId } = useParams({ strict: false }) as { activityId: string }
  const activity = useRecord('activities', activityId)

  return maybeText(activity, 'collectiveKind') === null ? (
    <Suspense fallback={null}>
      <RoundSignScreen />
    </Suspense>
  ) : (
    <Suspense fallback={null}>
      <SiteCollectiveSignScreen />
    </Suspense>
  )
}

/** The scan for the role: an asset or a room opens for whoever sees the assets, the place to report at for a Melder. */
function ScanForTheRole() {
  const seesAssets = useRight('asset.read')
  const reports = useRight('fault.report')

  return !seesAssets && reports ? <ReporterScanScreen /> : <SiteScanScreen />
}

export const siteRouter = createRouter({
  routeTree: siteRoutes(),
  basepath: '/m',
  defaultPendingMs: 0,
})
