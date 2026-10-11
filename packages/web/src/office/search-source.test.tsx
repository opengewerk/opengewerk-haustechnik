import type { SearchAnswer, SearchHit } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { act, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { officeOpens } from '../app/search.js'
import { officeHitPlace } from './search-source.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  signedInOffice,
  untilTheRightsAreKnown,
} from './test-office.js'

/**
 * The search in the header of the office (#125, board "Suche nach Name,
 * Nummer und Kennzeichen"): the field of the foundation with the sources of
 * this application. The server is asked with a network, the device without
 * one, and every hit opens on the page of what it is.
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }
const place = { propertyId: 'p-school', areaId: sued.id }
const school = {
  id: 'p-school',
  areaId: sued.id,
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const house = {
  id: 'b-house',
  ...place,
  name: 'Schulhaus',
  shortCode: 'SH',
  kinds: '["school"]',
  yearBuilt: 1975,
}
const ground = { id: 'f-ground', ...place, buildingId: house.id, name: 'Erdgeschoss', level: 0 }
const boilerRoom = {
  id: 'r-boiler',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.14',
  name: 'Heizraum',
  use: null,
}

const fromServer: SearchAnswer = {
  hits: [
    {
      kind: 'room',
      id: boilerRoom.id,
      number: 'E.14',
      name: 'Heizraum',
      property: school.name,
      building: house.name,
      floor: ground.name,
    },
    {
      kind: 'evidence',
      id: 'e-boiler',
      number: 'NW-2026-00012',
      title: 'Abgasmessung Heizkessel',
      performedOn: '2026-09-30',
      place: house.name,
    },
  ],
  more: [],
}

let server: TestServer

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('floors', ground)
  server.put('rooms', boilerRoom)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  globalThis.history.replaceState(null, '', '/')
})

async function mount(): Promise<void> {
  globalThis.history.replaceState(null, '', '/liegenschaften')
  signedInOffice('management', [sued], { '/search?q=heiz': fromServer })
  await mountOffice('/liegenschaften', server, [
    'properties',
    'buildings',
    'floors',
    'rooms',
    'assets',
    'activities',
    'work_orders',
  ])
  await untilTheRightsAreKnown()
}

describe('the search in the header of the office', () => {
  it('asks the server and opens each hit on the page of what it is', async () => {
    await mount()

    await userEvent.type(
      within(screen.getByRole('banner')).getByRole('combobox', { name: 'Suche' }),
      'heiz',
    )

    const list = await screen.findByRole('listbox', { name: 'Treffer der Suche' })
    const hits = within(list)
      .getAllByRole('option')
      .map((option) => [option.textContent, option.getAttribute('href')])

    expect(hits).toEqual([
      [
        'E.14 HeizraumSchulzentrum Am Lindenhain, Schulhaus, Erdgeschoss',
        `/raeume/${boilerRoom.id}`,
      ],
      [
        'NW-2026-00012 Abgasmessung HeizkesselNachweis vom 30.09.2026 · Schulhaus',
        '/nachweise/e-boiler',
      ],
    ])
    expect(screen.getByText('Nach Name, Nummer und Kennzeichen')).toBeDefined()
  })

  it('searches what the device holds without a network, and says so', async () => {
    await mount()
    await screen.findByRole('heading', { level: 1, name: 'Liegenschaften' })

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await userEvent.type(
      within(screen.getByRole('banner')).getByRole('combobox', { name: 'Suche' }),
      'sh',
    )

    const list = await screen.findByRole('listbox', { name: 'Treffer der Suche' })

    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.getAttribute('href')),
    ).toEqual([`/gebaeude/${house.id}`])
    expect(screen.getByText('Ohne Netz: gesucht in dem, was dieses Gerät hält.')).toBeDefined()
  })
})

describe('where a hit opens in the office', () => {
  // The entry on site leads into the office with addresses of its own (`officeOpens`), and loads
  // nothing of the office for them: they have to be the addresses of the office.
  it('is where the entry on site sends what the device does not hold', () => {
    const hits: readonly SearchHit[] = [
      { kind: 'property', id: 'p', name: '', address: '' },
      { kind: 'building', id: 'b', name: '', shortCode: null, property: '' },
      { kind: 'room', id: 'r', number: null, name: null, property: '', building: '', floor: '' },
      { kind: 'asset', id: 'a', number: null, name: '', mark: null, building: '', room: null },
      ...(['round', 'inspection', 'maintenance', 'work_order'] as const).map(
        (activityKind): SearchHit => ({
          kind: 'activity',
          id: activityKind,
          activityKind,
          number: null,
          title: '',
          status: 'open',
          place: '',
        }),
      ),
      { kind: 'evidence', id: 'e', number: '', title: '', performedOn: '2026-10-01', place: '' },
    ]

    for (const hit of hits) {
      expect(officeOpens(hit), `${hit.kind} ${hit.id}`).toBe(officeHitPlace(hit))
    }
  })
})
