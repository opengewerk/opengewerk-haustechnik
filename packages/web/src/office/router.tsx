import {
  InstanceOperatorsScreen,
  InstanceSettingsScreen,
  InstanceTenantsScreen,
} from '@opengewerk/platform-web/instance'
import { SettingsScreen, SyncScreen } from '@opengewerk/platform-web/office'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { InstanceShell } from './instance/shell.js'
import { AccountScreen } from './screens/account.js'
import { StaffScreen } from './screens/staff.js'
import { OfficeShell } from './shell.js'

/**
 * The routes of the office, written out rather than generated from file
 * names: the tree is small enough to read in one screen, and generated
 * routing needs a plugin that writes a file into the repository.
 *
 * The paths are German because the address bar is something a person reads.
 * The settings all live under `/einstellungen`, so that the one entry in the
 * navigation stays lit on every one of them. Until the records of phase 1
 * have their lists, the start of the office is the overview of the settings.
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
  ]

  const routes = [
    createRoute({
      getParentRoute: () => office,
      path: '/',
      beforeLoad: () => {
        throw redirect({ to: '/einstellungen' })
      },
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
      path: '/einstellungen/zugaenge',
      component: StaffScreen,
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
