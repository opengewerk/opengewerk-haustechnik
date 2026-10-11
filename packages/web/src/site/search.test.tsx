import 'fake-indexeddb/auto'

import type { SearchAnswer } from '@opengewerk/haustechnik-domain'
import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { officeOpens } from '../app/search.js'
import { siteHitPlace } from './search-source.js'
import {
  afterEachSiteTest,
  boilerRoom,
  goOffline,
  heater,
  house,
  mountSite,
  school,
} from './test-site.js'

/**
 * The search on site (#125), the boards "Suche vor Ort, mit Netz" and "ohne
 * Netz": over the start, and while words stand in it the hits in place of
 * the list. With a network the server is asked and finds in the own areas
 * also what the device does not hold, which opens in the office; without one
 * the device searches what it holds (decision 24 of phase 1).
 */

afterEach(() => {
  afterEachSiteTest()
})

/** What the server finds for "Aufzug": an asset the device holds, an order and an evidence it does not. */
const fromServer: SearchAnswer = {
  hits: [
    {
      kind: 'asset',
      id: heater.id,
      number: heater.number,
      name: heater.name,
      mark: null,
      building: house.name,
      room: 'E.14 Heizraum',
    },
    {
      kind: 'activity',
      id: 'ac-closed',
      activityKind: 'work_order',
      number: 'AU-2026-0019',
      title: 'Aufzug Mensa tauschen',
      status: 'done',
      place: 'Mensa',
    },
    {
      kind: 'evidence',
      id: 'e-lift',
      number: 'NW-2026-00012',
      title: 'Hauptprüfung der Aufzugsanlage',
      performedOn: '2026-09-30',
      place: house.name,
    },
  ],
  more: [],
}

function hitLinks(): { readonly name: string; readonly href: string | null }[] {
  return within(screen.getByRole('region', { name: 'Treffer der Suche' }))
    .getAllByRole('link')
    .map((link) => ({ name: link.textContent, href: link.getAttribute('href') }))
}

describe('the search on site', () => {
  it('asks the server with a network, opens here what the device holds and the rest in the office', async () => {
    await mountSite('/', { answers: { '/search?q=Aufzug': fromServer } })

    await userEvent.type(await screen.findByRole('searchbox', { name: 'Suche' }), 'Aufzug')

    await within(await screen.findByRole('region', { name: 'Treffer der Suche' })).findByRole(
      'link',
      { name: /Mensa tauschen/ },
    )

    expect(hitLinks()).toEqual([
      {
        name: 'AN-00057 Aufzug HeizraumSchulhaus, E.14 Heizraum',
        href: `/m/anlagen/${heater.id}`,
      },
      {
        name: 'AU-2026-0019 Aufzug Mensa tauschenAuftrag · Mensa · erledigtÖffnet im Büro',
        href: '/auftraege/ac-closed',
      },
      {
        name: 'NW-2026-00012 Hauptprüfung der AufzugsanlageNachweis vom 30.09.2026 · SchulhausÖffnet im Büro',
        href: '/nachweise/e-lift',
      },
    ])
    expect(
      screen.getByText(
        'Gesucht auf dem Server, in Ihren Bereichen. Was dieses Gerät nicht hält, öffnet im Büro.',
      ),
    ).toBeDefined()
    // The list of the start steps aside while the hits stand.
    expect(screen.queryByText('Für heute und diese Woche liegt nichts an.')).toBeNull()
  })

  it('searches what the device holds without a network, and asks nobody', async () => {
    const { asked, server } = await mountSite('/')

    await screen.findByText('Für heute und diese Woche liegt nichts an.')
    goOffline(server)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Suche' }), 'heiz')

    await within(await screen.findByRole('region', { name: 'Treffer der Suche' })).findAllByRole(
      'link',
    )

    expect(hitLinks().map((link) => link.href)).toEqual([
      `/m/raeume/${boilerRoom.id}`,
      `/m/anlagen/${heater.id}`,
    ])
    expect(screen.getByText('Ohne Netz sucht das Gerät in dem, was es hält.')).toBeDefined()
    expect(asked.map((each) => each.path).filter((path) => path.startsWith('/search'))).toEqual([])
  })
})

describe('where a hit opens on site', () => {
  it('opens its page here where the device holds it, and in the office where it does not', async () => {
    const { client } = await mountSite('/')

    await screen.findByText('Für heute und diese Woche liegt nichts an.')

    expect(
      siteHitPlace(client, { kind: 'property', id: school.id, name: school.name, address: '' }),
    ).toEqual({
      to: `/liegenschaften/${school.id}`,
    })
    expect(
      siteHitPlace(client, {
        kind: 'room',
        id: boilerRoom.id,
        number: 'E.14',
        name: 'Heizraum',
        property: school.name,
        building: house.name,
        floor: 'Erdgeschoss',
      }),
    ).toEqual({ to: `/raeume/${boilerRoom.id}` })

    const notHeld = {
      kind: 'asset',
      id: 'a-elsewhere',
      number: 'AN-00999',
      name: 'Aufzug Rathaus',
      mark: null,
      building: 'Rathaus',
      room: null,
    } as const

    expect(siteHitPlace(client, notHeld)).toEqual({
      to: officeOpens(notHeld),
      away: 'Öffnet im Büro',
    })
  })
})
