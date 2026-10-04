import { roleKeys, shippedRoles } from '@opengewerk/haustechnik-domain'
import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { useWho } from '@opengewerk/platform-web/session'
import { createRootRoute, createRoute } from '@tanstack/react-router'
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '../app/application.js'
import { offered } from '../app/places.js'
import { memberIn, mounted, signedInAs, tenantName } from '../app/test-entry.js'
import { siteRoutes } from './router.js'
import { SiteShell } from './shell.js'
import { siteTabs } from './tabs.js'

/**
 * The tabs on site (#83): Start, Scannen and Aufnehmen of the board
 * "Navigation mit dem Pfad", each from the moment its screen is built and for
 * whoever holds its right, before "Konflikte" and "Menü" of the frame. One
 * test per role, against the rights the roles are shipped with.
 */

function offeredTo(role: RoleKey): string[] {
  const rights = shippedRoles.find((shipped) => shipped.key === role)?.rights ?? []

  return offered(siteTabs, rights, () => true).map((tab) => tab.label)
}

describe('the tabs of the board', () => {
  it('are Start, Scannen and Aufnehmen, each at an address of its own', () => {
    expect(siteTabs.map((tab) => [tab.label, tab.to])).toEqual([
      ['Start', '/'],
      ['Scannen', '/scannen'],
      ['Aufnehmen', '/aufnehmen'],
    ])
  })

  // Everybody of phase 1 works on site: looking at an asset and taking stock
  // are rights of the role "Haustechnik", which every other role holds too.
  it.each(roleKeys)('are all three for %s once every screen is built', (role) => {
    expect(offeredTo(role)).toEqual(['Start', 'Scannen', 'Aufnehmen'])
  })

  it('are the start alone for somebody who may neither look at an asset nor take stock', () => {
    expect(offered(siteTabs, [], () => true).map((tab) => tab.label)).toEqual(['Start'])
    expect(
      offered(siteTabs, ['location.read', 'asset.read'], () => true).map((tab) => tab.label),
    ).toEqual(['Start', 'Scannen'])
  })
})

/**
 * The places of one of the two navigations the frame draws, the rail and the
 * tabs at the bottom: a test has no width, so both stand, with the same
 * places.
 */
function places(): (string | null)[][] {
  return screen.getAllByRole('navigation', { name: 'Bereiche' }).map((navigation) => [
    ...within(navigation)
      .getAllByRole('link')
      .map((link) => link.textContent),
    ...within(navigation)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ])
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the tabs on site as the entry is built today', () => {
  /**
   * No screen of the board is built yet, so the tabs are those of the frame.
   * The first screen that arrives changes what stands here.
   */
  it.each(roleKeys)('are "Konflikte" and "Menü" alone for %s', async (role) => {
    signedInAs(memberIn(role))
    await mounted({ routeTree: siteRoutes(), at: '/m/konflikte', basepath: '/m', application })

    expect(places()).toEqual([
      ['Konflikte', 'Menü'],
      ['Konflikte', 'Menü'],
    ])
  })
})

/**
 * A screen of a test that names the tenant: the name arrives with the answer
 * that carries the rights, so whoever waits for it knows the rights are in.
 */
function Named({ title }: { readonly title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p>{useWho().tenant}</p>
    </>
  )
}

/** The entry on site with the three places of the board built, around the shell of this application. */
function siteWithItsPlaces() {
  const root = createRootRoute({ component: SiteShell })
  const screens = {
    '/': 'Start',
    '/scannen': 'Scannen',
    '/aufnehmen': 'Aufnehmen',
    '/konflikte': 'Konflikte',
  }

  return root.addChildren(
    Object.entries(screens).map(([path, title]) =>
      createRoute({
        getParentRoute: () => root,
        path,
        component: () => <Named title={title} />,
      }),
    ),
  )
}

describe('a tab whose screen is built', () => {
  it.each(roleKeys)('stands for %s before those of the frame', async (role) => {
    signedInAs(memberIn(role))
    await mounted({ routeTree: siteWithItsPlaces(), at: '/m/', basepath: '/m', application })
    await screen.findByText(tenantName)
    await screen.findAllByRole('link', { name: 'Aufnehmen' })

    expect(places()).toEqual([
      ['Start', 'Scannen', 'Aufnehmen', 'Konflikte', 'Menü'],
      ['Start', 'Scannen', 'Aufnehmen', 'Konflikte', 'Menü'],
    ])
  })

  it('does not stand for somebody without its right', async () => {
    signedInAs({ ...memberIn('technician'), rights: ['location.read', 'asset.read'] })
    await mounted({ routeTree: siteWithItsPlaces(), at: '/m/', basepath: '/m', application })
    await screen.findByText(tenantName)
    await screen.findAllByRole('link', { name: 'Scannen' })

    expect(places()).toEqual([
      ['Start', 'Scannen', 'Konflikte', 'Menü'],
      ['Start', 'Scannen', 'Konflikte', 'Menü'],
    ])
  })

  it('is lit on its own screen and on no other', async () => {
    signedInAs(memberIn('technician'))
    await mounted({ routeTree: siteWithItsPlaces(), at: '/m/scannen', basepath: '/m', application })
    await screen.findByText(tenantName)

    const lit = (await screen.findAllByRole('link', { name: 'Scannen' })).map((link) =>
      link.getAttribute('aria-current'),
    )

    expect(lit).toEqual(['page', 'page'])
    expect(
      screen
        .getAllByRole('link', { name: 'Start' })
        .map((link) => link.getAttribute('aria-current')),
    ).toEqual([null, null])
  })
})
