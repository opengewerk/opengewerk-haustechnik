import type {
  AssetId,
  BuildingId,
  FloorId,
  PropertyId,
  RoomId,
} from '@opengewerk/haustechnik-domain'
import { Crumbs } from '@opengewerk/platform-web/office'
import { SiteCrumbs } from '@opengewerk/platform-web/site'
import { InRouter } from '@opengewerk/platform-web/testing'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { placePath } from './place-path.js'
import type { PlaceAbove, PlaceAddresses } from './place-path.js'

/**
 * The path over a page at a place (#83, 4.1 of the concept): what the page
 * stands under and not the page itself, "auf jedem Gerät gleich". The words
 * are said once, the two entries draw them in their own type and lead to
 * their own addresses.
 */

// The page of the board "Navigation mit dem Pfad": a water heater in the
// boiler room of a school.
const boilerRoom: PlaceAbove = {
  property: { id: 'p-1' as PropertyId, name: 'Schulzentrum Am Lindenhain' },
  building: { id: 'b-1' as BuildingId, name: 'Schulhaus' },
  floor: { id: 'f-1' as FloorId, name: 'Erdgeschoss' },
  room: { id: 'r-1' as RoomId, number: 'E.14', name: 'Heizraum' },
}

const office: PlaceAddresses = {
  list: { to: '/liegenschaften', label: 'Liegenschaften' },
  property: (id) => `/liegenschaften/${id}`,
  building: (id) => `/gebaeude/${id}`,
  floor: (id) => `/geschosse/${id}`,
  room: (id) => `/raeume/${id}`,
  asset: (id) => `/anlagen/${id}`,
}

const site: PlaceAddresses = {
  property: (id) => `/orte/liegenschaft/${id}`,
  building: (id) => `/orte/gebaeude/${id}`,
  floor: (id) => `/orte/geschoss/${id}`,
  room: (id) => `/orte/raum/${id}`,
  asset: (id) => `/anlagen/${id}`,
}

const labels = (path: readonly { readonly label: string }[]) => path.map((step) => step.label)

describe('the path over a page at a place', () => {
  it('names what the page stands under, from the property down to the room', () => {
    expect(placePath(boilerRoom, site)).toEqual([
      { to: '/orte/liegenschaft/p-1', label: 'Schulzentrum Am Lindenhain' },
      { to: '/orte/gebaeude/b-1', label: 'Schulhaus' },
      { to: '/orte/geschoss/f-1', label: 'Erdgeschoss' },
      { to: '/orte/raum/r-1', label: 'E.14 Heizraum' },
    ])
  })

  it('starts at the list in an entry that has one, as the office does', () => {
    expect(placePath(boilerRoom, office)).toEqual([
      { to: '/liegenschaften', label: 'Liegenschaften' },
      { to: '/liegenschaften/p-1', label: 'Schulzentrum Am Lindenhain' },
      { to: '/gebaeude/b-1', label: 'Schulhaus' },
      { to: '/geschosse/f-1', label: 'Erdgeschoss' },
      { to: '/raeume/r-1', label: 'E.14 Heizraum' },
    ])
  })

  it('ends where the page stands: a building under its property, an asset without a room under its building', () => {
    expect(labels(placePath({ property: boilerRoom.property }, site))).toEqual([
      'Schulzentrum Am Lindenhain',
    ])

    const { property, building } = boilerRoom

    expect(labels(placePath({ property, ...(building ? { building } : {}) }, site))).toEqual([
      'Schulzentrum Am Lindenhain',
      'Schulhaus',
    ])
  })

  it('names the asset for what hangs on one: a component, a duty, a defect', () => {
    const under = { ...boilerRoom, asset: { id: 'a-57' as AssetId, name: 'Trinkwassererwärmer' } }

    expect(placePath(under, site).at(-1)).toEqual({
      to: '/anlagen/a-57',
      label: 'Trinkwassererwärmer',
    })
    expect(labels(placePath(under, office))).toEqual([
      'Liegenschaften',
      'Schulzentrum Am Lindenhain',
      'Schulhaus',
      'Erdgeschoss',
      'E.14 Heizraum',
      'Trinkwassererwärmer',
    ])
  })

  it('calls a room by its number and its name, whichever it has', () => {
    const room = (number: string | null, name: string | null) =>
      labels(placePath({ ...boilerRoom, room: { id: 'r-2' as RoomId, number, name } }, site)).at(-1)

    expect(room('E.14', null)).toBe('E.14')
    expect(room(null, 'Heizraum')).toBe('Heizraum')
  })
})

describe('the same page in the office and on site', () => {
  it('stands under the same words, each a link to the page of that place in its entry', async () => {
    // The router of a test shows what it is given once it has loaded.
    const read = async () =>
      within(await screen.findByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')])
    const { unmount } = render(
      <InRouter>
        <Crumbs items={placePath(boilerRoom, office)} />
      </InRouter>,
    )
    const inTheOffice = await read()

    unmount()
    render(
      <InRouter>
        <SiteCrumbs items={placePath(boilerRoom, site)} />
      </InRouter>,
    )

    const onSite = await read()

    expect(inTheOffice).toEqual([
      ['Liegenschaften', '/liegenschaften'],
      ['Schulzentrum Am Lindenhain', '/liegenschaften/p-1'],
      ['Schulhaus', '/gebaeude/b-1'],
      ['Erdgeschoss', '/geschosse/f-1'],
      ['E.14 Heizraum', '/raeume/r-1'],
    ])
    expect(onSite).toEqual([
      ['Schulzentrum Am Lindenhain', '/orte/liegenschaft/p-1'],
      ['Schulhaus', '/orte/gebaeude/b-1'],
      ['Erdgeschoss', '/orte/geschoss/f-1'],
      ['E.14 Heizraum', '/orte/raum/r-1'],
    ])
    // The office starts at its list, which the entry on site does not have;
    // from the property on the words are the same.
    expect(inTheOffice.slice(1).map(([label]) => label)).toEqual(onSite.map(([label]) => label))
  })
})
