import { ConflictScreen } from '@opengewerk/platform-web/site'
import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouteComponent,
} from '@tanstack/react-router'

import { SiteAssetScreen } from './screens/asset.js'
import { SitePointScreen } from './screens/form.js'
import { GiveLabelScreen } from './screens/give-label.js'
import { RoundHandInScreen, RoundSignScreen } from './screens/hand-in.js'
import {
  SiteBuildingScreen,
  SiteFloorScreen,
  SitePropertyScreen,
  SiteRoomScreen,
  StockStartScreen,
} from './screens/places.js'
import { ReadingRoundScreen } from './screens/reading-round.js'
import { ReportDefectScreen } from './screens/report-defect.js'
import { SiteScanScreen } from './screens/scan.js'
import { TakeAssetScreen } from './screens/take-asset.js'
import { TakeRoomScreen } from './screens/take-room.js'
import { SiteActivityScreen, SiteProtocolScreen } from './screens/protocol.js'
import { SiteResultScreen } from './screens/result.js'
import { SiteStartScreen } from './screens/start.js'
import { SiteCloseOrderScreen, SiteNoteScreen } from './screens/work-order.js'
import { SiteShell } from './shell.js'

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
    at('/', SiteStartScreen),
    at('/konflikte', ConflictScreen),
    // The tab "Scannen": the label of an asset or a room, read by the camera.
    at('/scannen', SiteScanScreen),
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
    at('/vorgaenge/$activityId/ergebnis', SiteResultScreen),
    at('/vorgaenge/$activityId/mangel', ReportDefectScreen),
    at('/vorgaenge/$activityId/abgabe', RoundHandInScreen),
    at('/vorgaenge/$activityId/unterschrift', RoundSignScreen),
    // A work order: its protocol where it is an inspection or a maintenance,
    // a note on it and its finishing with the signature (#118).
    at('/vorgaenge/$activityId/protokoll', SiteProtocolScreen),
    at('/vorgaenge/$activityId/notiz', SiteNoteScreen),
    at('/vorgaenge/$activityId/abschliessen', SiteCloseOrderScreen),
    // A round of the meters of a property, also without a network (#120).
    at('/ablesung/$propertyId', ReadingRoundScreen),
  ])
}

export const siteRouter = createRouter({
  routeTree: siteRoutes(),
  basepath: '/m',
  defaultPendingMs: 0,
})
