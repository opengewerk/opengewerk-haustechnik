import {
  createLazyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { offered, useBuilt } from './places.js'
import type { Offer } from './places.js'

/**
 * The rule for a place in the navigation of the office and among the tabs on
 * site (#83): its screen is built, and the person holds its right.
 */

const places: readonly (Offer & { readonly label: string })[] = [
  { to: '/', label: 'Übersicht' },
  { to: '/liegenschaften', label: 'Liegenschaften', right: 'location.read' },
  { to: '/fristen', label: 'Fristen', right: 'deadline.read' },
  { to: '/katalog', label: 'Katalog' },
]

const labels = (found: readonly { readonly label: string }[]) => found.map((place) => place.label)

describe('the places somebody is offered', () => {
  it('are those whose right the person holds, in their order', () => {
    expect(labels(offered(places, ['deadline.read', 'location.read'], () => true))).toEqual([
      'Übersicht',
      'Liegenschaften',
      'Fristen',
      'Katalog',
    ])
  })

  it('leave out a place whose right the person does not hold', () => {
    expect(labels(offered(places, ['location.read'], () => true))).toEqual([
      'Übersicht',
      'Liegenschaften',
      'Katalog',
    ])
  })

  it('keep a place without a right for everybody who is signed in', () => {
    expect(labels(offered(places, [], () => true))).toEqual(['Übersicht', 'Katalog'])
  })

  it('leave out a place whose screen is not built, whatever the person holds', () => {
    const built = (to: string) => to === '/fristen' || to === '/katalog'

    expect(labels(offered(places, ['deadline.read', 'location.read'], built))).toEqual([
      'Fristen',
      'Katalog',
    ])
    expect(labels(offered(places, ['location.read'], built))).toEqual(['Katalog'])
  })
})

/** Which of some addresses the router of a test answers with a screen. */
function Built({ addresses }: { readonly addresses: readonly string[] }) {
  const built = useBuilt()

  return <p data-testid="built">{addresses.filter(built).join(' ')}</p>
}

async function builtAmong(addresses: readonly string[], basepath?: string): Promise<string[]> {
  const root = createRootRoute({ component: () => <Built addresses={addresses} /> })
  const router = createRouter({
    routeTree: root.addChildren([
      // The start of an entry before its own screen is built: it only leads on.
      createRoute({
        getParentRoute: () => root,
        path: '/',
        beforeLoad: () => {
          throw redirect({ to: '/konflikte' })
        },
      }),
      createRoute({ getParentRoute: () => root, path: '/konflikte', component: () => null }),
      createRoute({ getParentRoute: () => root, path: '/liegenschaften', component: () => null }),
      // A record under a list is a screen, and its list need not be one.
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$assetId',
        component: () => null,
      }),
      // A screen that is loaded when it is first opened.
      createRoute({ getParentRoute: () => root, path: '/katalog' }).lazy(() =>
        Promise.resolve(createLazyRoute('/katalog')({ component: () => null })),
      ),
    ]),
    ...(basepath === undefined ? {} : { basepath }),
    history: createMemoryHistory({ initialEntries: [`${basepath ?? ''}/konflikte`] }),
  })

  render(<RouterProvider router={router} />)

  const text = (await screen.findByTestId('built')).textContent

  return text === '' ? [] : text.split(' ')
}

describe('a screen answers at an address', () => {
  it('where a route has something to show, also one that is loaded when first opened', async () => {
    expect(await builtAmong(['/konflikte', '/liegenschaften', '/katalog'])).toEqual([
      '/konflikte',
      '/liegenschaften',
      '/katalog',
    ])
  })

  it('not where a route only leads on, as the start of an entry does before its screen', async () => {
    expect(await builtAmong(['/', '/konflikte'])).toEqual(['/konflikte'])
  })

  it('not where there is no route, and not at a list of which only the records are built', async () => {
    expect(await builtAmong(['/fristen', '/anlagen', '/liegenschaften'])).toEqual([
      '/liegenschaften',
    ])
  })

  // The entry on site lives under `/m`, and its places are written without it.
  it('at the address within the entry, wherever the entry lives', async () => {
    expect(await builtAmong(['/', '/liegenschaften', '/m/liegenschaften'], '/m')).toEqual([
      '/liegenschaften',
    ])
  })
})
