import { ConflictScreen } from '@opengewerk/platform-web/site'
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'

import { SiteShell } from './shell.js'

/**
 * The routes of the entry for the work on site.
 *
 * `basepath` is what makes this a second application at `/m` rather than a
 * section of the first. The two are separate documents with separate bundles,
 * which is how the budget for the first load on site can mean anything: the
 * phone never downloads the office.
 *
 * Until the places of phase 1 arrive, the start on site is the screen of the
 * conflicts: deciding one has to be possible on the device that caused it,
 * and it is the screen the foundation brings for that.
 *
 * A screen the board has among the tabs lives at the address its tab names
 * (`tabs.tsx`). Its route here is all it takes: the tab stands from then on,
 * for whoever holds its right.
 *
 * A function and not a value, so that a test builds a tree of its own for a
 * router with a history of its own.
 */
export function siteRoutes() {
  const root = createRootRoute({ component: SiteShell })

  return root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/',
      beforeLoad: () => {
        throw redirect({ to: '/konflikte' })
      },
    }),
    createRoute({ getParentRoute: () => root, path: '/konflikte', component: ConflictScreen }),
  ])
}

export const siteRouter = createRouter({
  routeTree: siteRoutes(),
  basepath: '/m',
  defaultPendingMs: 0,
})
