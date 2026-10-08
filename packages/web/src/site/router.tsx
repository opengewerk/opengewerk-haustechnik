import { ConflictScreen } from '@opengewerk/platform-web/site'
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouteComponent,
} from '@tanstack/react-router'

import { SiteAssetScreen } from './screens/asset.js'
import { GiveLabelScreen } from './screens/give-label.js'
import {
  SiteBuildingScreen,
  SiteFloorScreen,
  SitePropertyScreen,
  SiteRoomScreen,
  StockStartScreen,
} from './screens/places.js'
import { ReportDefectScreen } from './screens/report-defect.js'
import { SiteScanScreen } from './screens/scan.js'
import { TakeAssetScreen } from './screens/take-asset.js'
import { TakeRoomScreen } from './screens/take-room.js'
import { SiteShell } from './shell.js'

/**
 * The routes of the entry for the work on site.
 *
 * `basepath` is what makes this a second application at `/m` rather than a
 * section of the first. The two are separate documents with separate bundles,
 * which is how the budget for the first load on site can mean anything: the
 * phone never downloads the office.
 *
 * Until the start of phase 1 arrives, with what is due today and this week,
 * the start on site is the screen of the conflicts: deciding one has to be
 * possible on the device that caused it, and it is the screen the foundation
 * brings for that.
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
    createRoute({
      getParentRoute: () => root,
      path: '/',
      beforeLoad: () => {
        throw redirect({ to: '/konflikte' })
      },
    }),
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
  ])
}

export const siteRouter = createRouter({
  routeTree: siteRoutes(),
  basepath: '/m',
  defaultPendingMs: 0,
})
