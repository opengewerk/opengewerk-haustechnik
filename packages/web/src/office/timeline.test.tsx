import { type Timeline, type TimelineEvent, timelinePage } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../app/test-catalogue.js'
import { mountOffice, type NamedArea, onA, signedInOffice } from './test-office.js'
import { olderPageOf } from './timeline.js'

/**
 * The timeline of a place in the office (#123, 4.1 of the concept): the
 * entries the server reads, by month, each leading to the page of what it is
 * about; narrowed to a category in the address; older entries a page at a
 * time; the newest in a card on the page of a property; and the ways to it
 * from the last activities of a building and from a room and an asset.
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

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
const place = { propertyId: school.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
const ground = { id: 'f-ground', ...place, buildingId: house.id, name: 'Erdgeschoss', level: 0 }
const boilerRoom = {
  id: 'r-boiler',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
const heater = {
  id: 'as-heater',
  ...place,
  buildingId: house.id,
  roomId: boilerRoom.id,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00057',
  name: 'Trinkwassererwärmer',
}

const everything = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const

function event(id: string, further: Partial<TimelineEvent>): TimelineEvent {
  return {
    id,
    kind: 'signed',
    day: '2026-10-01',
    at: '2026-10-01T08:00:00.000Z',
    subject: { type: 'activity', id: 'ac-round', activityKind: 'round' },
    title: 'Wöchentlicher Rundgang Schulhaus',
    number: null,
    mark: { kind: 'activity', outcome: 'with_defects' },
    ...further,
  } as TimelineEvent
}

const handedIn = event('signed:s-1', {})
const found = event('defect_found:m-1', {
  kind: 'defect_found',
  subject: { type: 'defect', id: 'm-1' },
  title: 'Warmwasser am Speicheraustritt 55,5 °C',
  mark: { kind: 'defect', status: 'found' },
})
const begun = event('started:ac-order', {
  kind: 'started',
  day: '2026-09-28',
  subject: { type: 'activity', id: 'ac-order', activityKind: 'work_order' },
  title: 'Notleuchte Flur 1. OG tauschen',
  number: 'AU-2026-0031',
  mark: { kind: 'activity', outcome: 'started' },
})
const entered = event('evidence_entered:e-118', {
  kind: 'evidence_entered',
  day: '2026-09-15',
  subject: { type: 'evidence', id: 'e-118' },
  title: 'Brandmeldeanlage',
  number: 'NW-2026-00118',
  mark: { kind: 'evidence', result: 'without_defects', voided: false },
})
const voided = event('evidence_voided:e-90', {
  kind: 'evidence_voided',
  day: '2026-09-03',
  subject: { type: 'evidence', id: 'e-90' },
  title: 'Trinkwasser, Temperaturen',
  number: 'NW-2026-00090',
  mark: { kind: 'evidence', result: 'without_defects', voided: true },
})

const timeline = (events: readonly TimelineEvent[], more = false): Timeline => ({ events, more })
const ofHouse = (query = 'offset=0&limit=30') => `/overview/timeline?building=b-house&${query}`

let server: TestServer

function mount(at: string, answers: Readonly<Record<string, unknown>>) {
  signedInOffice('management', [sued], { ...servingCatalogue(), ...answers })

  return mountOffice(at, server, everything)
}

/** The entries as a reader meets them, each with where it leads. */
function entries(): string[] {
  return within(screen.getByRole('region', { name: 'Einträge der Zeitachse' }))
    .getAllByRole('link')
    .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`)
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('floors', ground)
  server.put('rooms', boilerRoom)
  server.put('assets', heater)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the timeline of a place', () => {
  it('lists the entries by month, each with its day, what happened and to what, how it stands, and where it leads', async () => {
    await mount('/gebaeude/b-house/zeitachse', {
      [ofHouse()]: timeline([handedIn, found, begun, entered, voided]),
    })
    await screen.findByRole('region', { name: 'Einträge der Zeitachse' })

    expect(screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      'Oktober 2026',
      'September 2026',
    ])
    expect(entries()).toEqual([
      '01.10.Rundgang abgegebenWöchentlicher Rundgang SchulhausMit Mängeln > /rundgaenge/ac-round',
      '01.10.Mangel festgestelltWarmwasser am Speicheraustritt 55,5 °CFestgestellt > /maengel/m-1',
      '28.09.Auftrag begonnenAU-2026-0031 Notleuchte Flur 1. OG tauschenBegonnen > /auftraege/ac-order',
      '15.09.Nachweis eingetragenNW-2026-00118 BrandmeldeanlageOhne Mangel > /nachweise/e-118',
      '03.09.Nachweis für ungültig erklärtNW-2026-00090 Trinkwasser, TemperaturenFür ungültig erklärt > /nachweise/e-90',
    ])
  })

  it('names the place in its head, under the path to it', async () => {
    await mount('/gebaeude/b-house/zeitachse', { [ofHouse()]: timeline([handedIn]) })
    await screen.findByText('Schulhaus, alle Vorgänge über die Zeit')

    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Liegenschaften', 'Schulzentrum Am Lindenhain', 'Schulhaus'])
  })

  it('is narrowed to a category, which goes into the address and to the server', async () => {
    const { router } = await mount('/gebaeude/b-house/zeitachse', {
      [ofHouse()]: timeline([handedIn, found]),
      [ofHouse('category=defects&offset=0&limit=30')]: timeline([found]),
    })
    await screen.findByRole('region', { name: 'Einträge der Zeitachse' })

    fireEvent.click(screen.getByRole('button', { name: 'Mängel' }))
    await waitFor(() => {
      expect(entries()).toHaveLength(1)
    })
    expect(router.state.location.href).toBe('/gebaeude/b-house/zeitachse?art=defects')
    expect(screen.getByRole('button', { name: 'Mängel' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('loads older entries where the server says more follow', async () => {
    await mount('/gebaeude/b-house/zeitachse', {
      [ofHouse()]: timeline([handedIn, found], true),
      [ofHouse('offset=2&limit=30')]: timeline([begun]),
    })
    await screen.findByRole('region', { name: 'Einträge der Zeitachse' })

    fireEvent.click(screen.getByRole('button', { name: 'Ältere laden' }))
    await waitFor(() => {
      expect(entries()).toHaveLength(3)
    })
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull()
  })

  it('loads older pages up to where the timeline reaches back, and no further', () => {
    const page = (size: number, more: boolean) =>
      timeline(
        Array.from({ length: size }, () => handedIn),
        more,
      )
    const reached = Array.from({ length: timelinePage.furthest / 30 }, () => page(30, true))

    expect(olderPageOf([page(30, true)])).toBe(30)
    expect(olderPageOf([page(30, false)])).toBeNull()
    expect(olderPageOf(reached)).toBe(timelinePage.furthest)
    expect(olderPageOf([...reached, page(30, true)])).toBe('furthest')
    expect(olderPageOf([...reached, page(30, false)])).toBeNull()
  })

  it('says so where the server does not answer', async () => {
    await mount('/raeume/r-boiler/zeitachse', {})

    await screen.findByText(
      'Die Zeitachse ließ sich nicht laden. Sie kommt vom Server, mit Verbindung.',
    )
  })
})

describe('the ways to a timeline', () => {
  it('shows the newest entries on the page of a property, and leads to the whole of it', async () => {
    await mount('/liegenschaften/p-school', {
      '/overview/timeline?property=p-school&offset=0&limit=4': timeline([handedIn, begun]),
    })
    const card = await screen.findByRole('region', { name: 'Zeitachse' })

    await within(card).findByText('Rundgang abgegeben')
    expect(
      within(card)
        .getAllByRole('link')
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual([
      '01.10.2026Rundgang abgegebenWöchentlicher Rundgang SchulhausMit Mängeln > /rundgaenge/ac-round',
      '28.09.2026Auftrag begonnenAU-2026-0031 Notleuchte Flur 1. OG tauschenBegonnen > /auftraege/ac-order',
      'Ganze Zeitachse > /liegenschaften/p-school/zeitachse',
    ])
  })

  it('leads from the last activities of a building to its timeline', async () => {
    await mount('/gebaeude/b-house', {
      '/overview/buildings/b-house': {
        overdue: 0,
        due: 0,
        neverRecorded: 0,
        openDefects: null,
        missingReadings: null,
        keyDate: '2026-10-01',
        lastActivities: [],
      },
    })
    const last = await screen.findByRole('region', { name: 'Letzte Vorgänge' })

    expect(within(last).getByRole('link', { name: 'Zeitachse' }).getAttribute('href')).toBe(
      '/gebaeude/b-house/zeitachse',
    )
  })

  it('leads from a room to its timeline', async () => {
    const { router } = await mount('/raeume/r-boiler', {
      '/overview/timeline?room=r-boiler&offset=0&limit=30': timeline([found]),
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Zeitachse' }))
    await screen.findByText('E.14 Heizraum, alle Vorgänge über die Zeit')
    expect(router.state.location.pathname).toBe('/raeume/r-boiler/zeitachse')
  })

  it('has one of an asset as well, under the path to the asset', async () => {
    await mount('/anlagen/as-heater/zeitachse', {
      '/overview/timeline?asset=as-heater&offset=0&limit=30': timeline([entered]),
    })
    await screen.findByText('Trinkwassererwärmer, alle Vorgänge über die Zeit')

    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Liegenschaften',
      'Schulzentrum Am Lindenhain',
      'Schulhaus',
      'E.14 Heizraum',
      'Trinkwassererwärmer',
    ])
    await screen.findByRole('region', { name: 'Einträge der Zeitachse' })
    expect(entries()).toEqual([
      '15.09.Nachweis eingetragenNW-2026-00118 BrandmeldeanlageOhne Mangel > /nachweise/e-118',
    ])
  })
})
