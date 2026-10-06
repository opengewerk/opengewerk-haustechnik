import type { DutyEntry, DutyReading, DutyRegister, RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import { mountOffice, type NamedArea, onA, rowsOf, signedInOffice } from '../test-office.js'

/**
 * The register of duties in the office and the duties of a room (#101, 4.3
 * of the concept): the list comes from the server a page at a time, narrowed
 * by what the address names; a duty nobody answers for is said above it; and
 * narrowed to one person it names no number. The places and the catalogue
 * are read from the device.
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
const yard = { ...school, id: 'p-yard', name: 'Werkhof Nord' }
const place = { propertyId: school.id, areaId: sued.id }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]', yearBuilt: 1975 }
const hall = {
  id: 'b-hall',
  propertyId: yard.id,
  areaId: sued.id,
  name: 'Halle 1',
  kinds: '["commercial"]',
  yearBuilt: 2009,
}
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

const everything = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'asset_lifecycle',
  'asset_supplies',
] as const

const register =
  'Pflichten mit Anlage oder Ort, Frist, Zuständigkeit, letztem Nachweis, nächstem Termin und Zustand'
const dutiesOfTheRoom = 'Pflichten an diesem Raum mit letztem Nachweis, nächstem Termin und Zustand'

/** The first page of the register without a filter, as the screen asks for it. */
const firstPage = '/duties/register?offset=0&limit=50'

function entry(id: string, further: Readonly<Record<string, unknown>> = {}): DutyEntry {
  return {
    id,
    kind: null,
    kindVersion: null,
    label: 'Wartung',
    basis: 'manufacturer',
    sourceNote: 'Betriebsanleitung',
    counting: 'from_performance',
    intervalDays: null,
    intervalMonths: 12,
    intervalReason: null,
    endsOn: null,
    title: 'Wartung',
    state: 'met',
    appointment: { dueOn: '2027-03-12', onTimeUntil: '2027-03-12' },
    lastMetOn: '2026-03-12',
    propertyId: school.id,
    buildingId: null,
    roomId: null,
    assetId: 'a-lift',
    responsibleUserId: 'u-roth',
    performer: 'own_staff',
    performerNote: null,
    ended: false,
    asset: {
      id: 'a-lift',
      number: 'AN-00012',
      name: 'Aufzug Schulhaus',
      kind: 'probe.elevator',
      buildingId: house.id,
      roomId: null,
    },
    responsible: { userId: 'u-roth', name: 'Dennis Roth' },
    lastEvidence: { number: 'NW-2026-00041', performedOn: '2026-03-12', origin: 'report' },
    ...further,
  } as unknown as DutyEntry
}

const maintenance = entry('d-maintenance')
/** From the catalogue, in a version nobody accepted and nobody checked for years. */
const interim = entry('d-interim', {
  kind: 'probe.interim_check',
  kindVersion: 1,
  label: null,
  basis: null,
  sourceNote: null,
  title: 'Zwischenprüfung',
  state: 'never_recorded',
  appointment: null,
  lastMetOn: null,
  lastEvidence: null,
  responsibleUserId: null,
  responsible: null,
  performer: 'contractor',
  performerNote: 'Aufzugsdienst Beispiel GmbH',
})
const mainTest = entry('d-main', {
  kind: 'probe.elevator_main_test',
  kindVersion: 1,
  label: null,
  basis: null,
  sourceNote: null,
  intervalMonths: 24,
  title: 'Hauptprüfung der Aufzugsanlage',
  state: 'overdue',
  appointment: { dueOn: '2026-09-01', onTimeUntil: '2026-11-30' },
  lastMetOn: '2024-09-15',
  lastEvidence: { number: 'NW-2024-00007', performedOn: '2024-09-15', origin: 'legacy' },
  performer: 'contractor',
  performerNote: null,
})
const atRoom = entry('d-room', {
  label: 'Heizraum frei von Brandlasten',
  title: 'Heizraum frei von Brandlasten',
  basis: 'own_decision',
  sourceNote: 'Brandschutzordnung Teil C',
  intervalMonths: 3,
  state: 'due',
  appointment: { dueOn: '2026-10-28', onTimeUntil: '2026-10-28' },
  roomId: boilerRoom.id,
  assetId: null,
  asset: null,
  performer: null,
})
const atBuilding = entry('d-building', {
  label: 'Dachrinnen reinigen',
  title: 'Dachrinnen reinigen',
  intervalMonths: null,
  intervalDays: 180,
  propertyId: yard.id,
  buildingId: hall.id,
  assetId: null,
  asset: null,
  state: 'dormant',
})
const atProperty = entry('d-property', {
  label: 'Winterdienst',
  title: 'Winterdienst',
  propertyId: yard.id,
  assetId: null,
  asset: null,
  ended: true,
  endsOn: '2026-09-05',
})

const counts = { never_recorded: 5, overdue: 3, due: 7, met: 268, dormant: 4, ended: 2 }

function page(duties: readonly DutyEntry[], further: Partial<DutyRegister> = {}): DutyRegister {
  return {
    total: duties.length,
    assets: new Set(duties.flatMap((duty) => (duty.assetId === null ? [] : [duty.assetId]))).size,
    places: duties.filter((duty) => duty.assetId === null).length,
    counts,
    withoutResponsible: 0,
    more: false,
    duties,
    people: null,
    ...further,
  }
}

const people = [
  { userId: 'u-roth', name: 'Dennis Roth' },
  { userId: 'u-lindner', name: 'Petra Lindner' },
]

let server: TestServer

async function mount(
  at: string,
  answers: Readonly<Record<string, unknown>>,
  role: RoleKey = 'technician',
) {
  signedInOffice(role, [sued], { ...servingCatalogue(), ...answers })

  return mountOffice(at, server, everything)
}

/** The choice of a filter, by the name above it. */
function filter(name: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name })
}

function choose(name: string, value: string): void {
  fireEvent.change(filter(name), { target: { value } })
}

/** The chips of the states, each with whether it is pressed. */
function chips(): string[] {
  return within(screen.getByRole('group', { name: 'Zustand' }))
    .getAllByRole('button')
    .map((chip) => `${chip.textContent}${chip.getAttribute('aria-pressed') === 'true' ? ' *' : ''}`)
}

function press(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** What stands beside the title in the head of the page. */
function head(): string {
  return screen.getByRole('heading', { level: 1 }).parentElement?.textContent ?? ''
}

const titles = () => rowsOf(register).map((row) => row[1])

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()

  for (const property of [school, yard]) {
    server.put('properties', property)
  }

  for (const building of [house, hall]) {
    server.put('buildings', building)
  }

  server.put('floors', ground)
  server.put('rooms', boilerRoom)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the register of duties', () => {
  it('lists what the server names: what a duty hangs on, its source, its interval, who answers and performs, its last evidence, its appointment and its state', async () => {
    await mount('/pflichten', {
      [firstPage]: page([interim, mainTest, atRoom, maintenance, atBuilding], {
        total: 287,
        assets: 241,
        places: 6,
      }),
    })
    await screen.findByRole('table', { name: register })
    // The source and the marks of a kind come with the catalogue of the device.
    await within(screen.getByRole('table', { name: register })).findByText('Nicht abgenommen')

    const rows = rowsOf(register)

    // From the catalogue and never recorded: nobody answers, a contractor by name.
    expect(rows[0]?.slice(2)).toEqual([
      '12 MonateOhne Vorgabe',
      'Niemand benanntAufzugsdienst Beispiel GmbH',
      'keiner',
      'keiner',
      'Nie erfasst',
    ])
    expect(rows[0]?.[0]).toBe('Aufzug SchulhausAN-00012 · Schulzentrum Am Lindenhain')
    expect(rows[0]?.[1]).toContain('ZwischenprüfungProbenorm 13015, Abschnitt 4')
    expect(rows[0]?.[1]).toContain('Seit über einem Jahr nicht geprüft')
    // An evidence taken over from a predecessor by its day, and a contractor nobody named.
    expect(rows[1]).toEqual([
      'Aufzug SchulhausAN-00012 · Schulzentrum Am Lindenhain',
      'Hauptprüfung der Aufzugsanlage§ 16 der Probeverordnung',
      '24 MonateHöchstfrist',
      'Dennis RothFremdfirma',
      '15.09.2024Altbestand',
      '01.09.2026',
      'Überfällig',
    ])
    // A duty of the operator's own at a room: nobody said who performs it.
    expect(rows[2]).toEqual([
      'E.14 HeizraumRaum · Schulzentrum Am Lindenhain',
      'Heizraum frei von BrandlastenEigene Festlegung, Brandschutzordnung Teil C',
      '3 MonateEigene Pflicht',
      'Dennis Roth',
      'NW-2026-0004112.03.2026',
      '28.10.2026',
      'Fällig',
    ])
    expect(rows[3]).toEqual([
      'Aufzug SchulhausAN-00012 · Schulzentrum Am Lindenhain',
      'WartungVorgabe des Herstellers, Betriebsanleitung',
      '12 MonateEigene Pflicht',
      'Dennis RothEigene Leute',
      'NW-2026-0004112.03.2026',
      '12.03.2027',
      'Erfüllt bis 12.03.2027',
    ])
    // At a building, counted in days, and resting: no appointment is named.
    expect(rows[4]).toEqual([
      'Halle 1Gebäude · Werkhof Nord',
      'Dachrinnen reinigenVorgabe des Herstellers, Betriebsanleitung',
      '180 TageEigene Pflicht',
      'Dennis RothEigene Leute',
      'NW-2026-0004112.03.2026',
      'keiner',
      'Ruht',
    ])
    expect(head()).toContain('287 Pflichten an 241 Anlagen und 6 Orten')
    expect(
      screen.getByText('5 von 287, geordnet nach Zustand: nie erfasst vor überfällig'),
    ).toBeTruthy()
  })

  it('leads from a row to the page of the duty and to what it hangs on', async () => {
    await mount('/pflichten', {
      [firstPage]: page([maintenance, atRoom, atBuilding]),
      '/duties/register?state=ended&offset=0&limit=50': page([atProperty]),
    })
    await screen.findByRole('table', { name: register })

    const leadsTo = (name: string) =>
      within(screen.getByRole('table', { name: register }))
        .getByRole('link', { name })
        .getAttribute('href')

    expect(leadsTo('Wartung')).toBe('/pflichten/d-maintenance')
    expect(leadsTo('Aufzug Schulhaus')).toBe('/anlagen/a-lift')
    expect(leadsTo('E.14 Heizraum')).toBe('/raeume/r-boiler')
    expect(leadsTo('Halle 1')).toBe('/gebaeude/b-hall')

    // A duty at the property itself, and one that has ended says since when.
    press('Beendet 2')
    await waitFor(() => {
      expect(rowsOf(register)).toEqual([
        [
          'Werkhof NordLiegenschaft',
          'WinterdienstVorgabe des Herstellers, Betriebsanleitung',
          '12 MonateEigene Pflicht',
          'Dennis RothEigene Leute',
          'NW-2026-0004112.03.2026',
          'keiner',
          'Beendet seit 05.09.2026',
        ],
      ])
    })
    expect(leadsTo('Werkhof Nord')).toBe('/liegenschaften/p-yard')
    expect(screen.getByText('1 von 1, das jüngste Ende zuerst')).toBeTruthy()
  })

  it('asks the server for what the address names, filter by filter, and shows what it is narrowed by', async () => {
    await mount(
      '/pflichten?zustand=overdue&gebaeude=b-house&art=probe.elevator&pflichtart=probe.elevator_main_test&verantwortlich=u-roth',
      {
        // Only this question has an answer: any other, and no table stands.
        '/duties/register?state=overdue&buildingId=b-house&assetKind=probe.elevator&dutyKind=probe.elevator_main_test&responsible=u-roth&offset=0&limit=50':
          page([mainTest], { people }),
      },
      'technical_management',
    )
    await screen.findByRole('table', { name: register })
    // The source of a kind comes with the catalogue of the device.
    await screen.findByText('§ 16 der Probeverordnung')

    expect(titles()).toEqual(['Hauptprüfung der Aufzugsanlage§ 16 der Probeverordnung'])
    expect(['Standort', 'Anlagenart', 'Verantwortlich'].map((name) => filter(name).value)).toEqual([
      'b:b-house',
      'probe.elevator',
      'u-roth',
    ])
    expect(chips().filter((chip) => chip.endsWith('*'))).toEqual(['Überfällig 3 *'])
    // The duty kind has no choice of its own: a sentence says it, and takes it away.
    expect(
      screen.getByText(/Eingegrenzt auf die Pflichtart „Hauptprüfung der Aufzugsanlage“/),
    ).toBeTruthy()
  })

  it('asks for a property where the address names one, and for nothing it has no word for', async () => {
    await mount('/pflichten?liegenschaft=p-yard&zustand=kaputt&farbe=rot', {
      '/duties/register?propertyId=p-yard&offset=0&limit=50': page([atBuilding]),
    })
    await screen.findByRole('table', { name: register })

    expect(titles()).toEqual(['Dachrinnen reinigenVorgabe des Herstellers, Betriebsanleitung'])
    expect(filter('Standort').value).toBe('p:p-yard')
    expect(chips().filter((chip) => chip.endsWith('*'))).toEqual(['Alle *'])
  })

  it('is narrowed by a state and by a choice, which go into the address and to the server', async () => {
    const { router } = await mount(
      '/pflichten',
      {
        [firstPage]: page([mainTest, maintenance], { people }),
        '/duties/register?state=overdue&offset=0&limit=50': page([mainTest], { people }),
        '/duties/register?state=overdue&buildingId=b-house&offset=0&limit=50': page([mainTest], {
          people,
        }),
        '/duties/register?state=overdue&propertyId=p-school&offset=0&limit=50': page([mainTest], {
          people,
        }),
        '/duties/register?state=overdue&propertyId=p-school&assetKind=probe.elevator&offset=0&limit=50':
          page([mainTest], { people }),
        '/duties/register?state=overdue&propertyId=p-school&assetKind=probe.elevator&responsible=u-lindner&offset=0&limit=50':
          page([], { people, total: null, assets: null, places: null, counts: null }),
        '/duties/register?propertyId=p-school&assetKind=probe.elevator&responsible=u-lindner&offset=0&limit=50':
          page([maintenance], { people, total: null, assets: null, places: null, counts: null }),
      },
      'management',
    )
    const address = () => router.state.location.href

    await screen.findByRole('table', { name: register })
    expect(titles()).toHaveLength(2)
    // Nothing to take back while nothing narrows.
    expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).toBeNull()

    press('Überfällig 3')
    await waitFor(() => {
      expect(titles()).toHaveLength(1)
    })
    expect(address()).toBe('/pflichten?zustand=overdue')

    choose('Standort', 'b:b-house')
    await waitFor(() => {
      expect(address()).toBe('/pflichten?zustand=overdue&gebaeude=b-house')
    })

    // A property takes the place of the building, it does not join it.
    choose('Standort', 'p:p-school')
    await waitFor(() => {
      expect(address()).toBe('/pflichten?zustand=overdue&liegenschaft=p-school')
    })

    choose('Anlagenart', 'probe.elevator')
    await waitFor(() => {
      expect(address()).toBe('/pflichten?zustand=overdue&liegenschaft=p-school&art=probe.elevator')
    })

    choose('Verantwortlich', 'u-lindner')
    await waitFor(() => {
      expect(address()).toBe(
        '/pflichten?zustand=overdue&liegenschaft=p-school&art=probe.elevator&verantwortlich=u-lindner',
      )
    })
    await screen.findByText('Keine Pflicht passt zu dem, wonach das Verzeichnis eingegrenzt ist.')

    // "Alle" takes the state away again, and leaves the others.
    press('Alle')
    await waitFor(() => {
      expect(address()).toBe(
        '/pflichten?liegenschaft=p-school&art=probe.elevator&verantwortlich=u-lindner',
      )
    })
    await screen.findByRole('table', { name: register })

    press('Filter zurücksetzen')
    await waitFor(() => {
      expect(address()).toBe('/pflichten')
    })
    await waitFor(() => {
      expect(titles()).toHaveLength(2)
    })
  })

  it('offers every state with how many duties are in it, the places, the asset kinds, nobody and the people the server names', async () => {
    await mount('/pflichten', { [firstPage]: page([maintenance], { people }) }, 'management')
    await screen.findByRole('table', { name: register })

    const choices = (name: string) =>
      within(filter(name))
        .getAllByRole('option')
        .map((option) => option.textContent)

    // Never recorded before overdue, and last what has ended.
    expect(chips()).toEqual([
      'Alle *',
      'Nie erfasst 5',
      'Überfällig 3',
      'Fällig 7',
      'Erfüllt 268',
      'Ruht 4',
      'Beendet 2',
    ])
    await waitFor(() => {
      expect(choices('Anlagenart')).toEqual([
        'Alle',
        'Aufzugsanlage',
        'Druckerhöhungsanlage (Abgenommenes Paket)',
        'Druckerhöhungsanlage (Probepaket)',
      ])
    })
    expect(choices('Standort')).toEqual([
      'Alle Liegenschaften',
      'Schulzentrum Am Lindenhain, alle Gebäude',
      'Schulhaus',
      'Werkhof Nord, alle Gebäude',
      'Halle 1',
    ])
    expect(choices('Verantwortlich')).toEqual([
      'Alle Personen',
      'Niemand benannt',
      'Dennis Roth',
      'Petra Lindner',
    ])
  })

  it('offers no person to somebody the server hands none: all duties, or those of nobody', async () => {
    await mount('/pflichten', {
      [firstPage]: page([maintenance]),
      '/duties/register?responsible=none&offset=0&limit=50': page([interim]),
    })
    await screen.findByRole('table', { name: register })

    expect(
      within(filter('Verantwortlich'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Alle Personen', 'Niemand benannt'])

    choose('Verantwortlich', 'none')
    await waitFor(() => {
      expect(titles()).toEqual([expect.stringContaining('Zwischenprüfung')])
    })
  })

  it('names no number where it is narrowed to one person: neither in the head, nor at a state, nor under the list', async () => {
    await mount(
      '/pflichten?verantwortlich=u-roth',
      {
        '/duties/register?responsible=u-roth&offset=0&limit=50': page([mainTest, maintenance], {
          people,
          total: null,
          assets: null,
          places: null,
          counts: null,
          more: true,
        }),
        '/duties/register?responsible=u-roth&offset=2&limit=50': page([atRoom], {
          people,
          total: null,
          assets: null,
          places: null,
          counts: null,
        }),
      },
      'technical_management',
    )
    await screen.findByRole('table', { name: register })

    expect(head()).toBe('Pflichtenverzeichnis')
    expect(chips()).toEqual([
      'Alle *',
      'Nie erfasst',
      'Überfällig',
      'Fällig',
      'Erfüllt',
      'Ruht',
      'Beendet',
    ])
    expect(screen.getByText('geordnet nach Zustand: nie erfasst vor überfällig')).toBeTruthy()
    expect(screen.queryByText(/\d von \d/)).toBeNull()

    // A further page is loaded all the same: the server says whether one follows.
    press('Weitere laden')
    await waitFor(() => {
      expect(titles()).toHaveLength(3)
    })
    expect(screen.queryByRole('button', { name: 'Weitere laden' })).toBeNull()
    expect(screen.queryByText(/\d von \d/)).toBeNull()
  })

  it('says above the list how many duties nobody answers for, and narrows to them', async () => {
    const { router } = await mount('/pflichten?zustand=met', {
      '/duties/register?state=met&offset=0&limit=50': page([maintenance], {
        withoutResponsible: 2,
      }),
      '/duties/register?responsible=none&offset=0&limit=50': page([interim], {
        withoutResponsible: 2,
      }),
    })
    await screen.findByRole('table', { name: register })

    expect(screen.getByText(/2 Pflichten haben keine verantwortliche Person\./)).toBeTruthy()

    // To all of them, whatever state the list was narrowed to.
    press('Anzeigen')
    await waitFor(() => {
      expect(router.state.location.href).toBe('/pflichten?verantwortlich=none')
    })
    await waitFor(() => {
      expect(titles()).toEqual([expect.stringContaining('Zwischenprüfung')])
    })
    // Narrowed to them, the list itself says it.
    expect(screen.queryByText(/keine verantwortliche Person/)).toBeNull()
    expect(filter('Verantwortlich').value).toBe('none')
  })

  it('says it of one duty in the singular, and nothing where every duty names somebody', async () => {
    await mount('/pflichten?zustand=due', {
      [firstPage]: page([maintenance]),
      '/duties/register?state=due&offset=0&limit=50': page([atRoom], { withoutResponsible: 1 }),
    })
    await screen.findByRole('table', { name: register })

    expect(screen.getByText(/1 Pflicht hat keine verantwortliche Person\./)).toBeTruthy()

    press('Alle')
    await waitFor(() => {
      expect(titles()).toEqual(['WartungVorgabe des Herstellers, Betriebsanleitung'])
    })
    expect(screen.queryByText(/keine verantwortliche Person/)).toBeNull()
  })

  it('loads a further page where the server says more follow, and says how many of how many stand there', async () => {
    await mount('/pflichten', {
      [firstPage]: page([mainTest, atRoom], { total: 3, more: true }),
      '/duties/register?offset=2&limit=50': page([maintenance], { total: 3 }),
    })
    await screen.findByRole('table', { name: register })

    expect(screen.getByText(/^2 von 3, /)).toBeTruthy()

    press('Weitere laden')
    await screen.findByText(/^3 von 3, /)

    expect(titles()).toHaveLength(3)
    // Nothing further to load once the server says nothing follows.
    expect(screen.queryByRole('button', { name: 'Weitere laden' })).toBeNull()
  })

  it('says that no duty passes, and that there is none at all', async () => {
    await mount('/pflichten?zustand=due', {
      [firstPage]: page([], { total: 0, assets: 0, places: 0 }),
      '/duties/register?state=due&offset=0&limit=50': page([], { total: 0, assets: 0, places: 0 }),
    })

    await screen.findByText('Keine Pflicht passt zu dem, wonach das Verzeichnis eingegrenzt ist.')
    expect(head()).toContain('Keine Pflicht')

    press('Filter zurücksetzen')
    await screen.findByText('Noch ist keine Pflicht bestätigt.')
  })

  it('says so where the server refuses a list narrowed to one person, and offers the way back', async () => {
    const written = signedInOffice('technician', [sued], servingCatalogue())
    const answer = globalThis.fetch

    // The server of this test refuses the one question, as the route does
    // for somebody who does not keep the register.
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) =>
      path.startsWith('/duties/register?responsible=u-roth')
        ? Promise.resolve(
            new Response(JSON.stringify({ message: 'Dafür fehlt ein Recht.' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        : answer(path, init),
    )

    await mountOffice('/pflichten?verantwortlich=u-roth', server, everything)

    await screen.findByText(
      'Diese Liste ist auf eine Person eingegrenzt. Das kann nur, wer das Pflichtenverzeichnis führt.',
    )
    // The filter shows that a person is named, and not who.
    expect(filter('Verantwortlich').selectedOptions[0]?.textContent).toBe('Eine Person')
    expect(screen.getByRole('button', { name: 'Filter zurücksetzen' })).toBeTruthy()
    expect(written).toEqual([])
  })

  it('says so without a connection, and lists nothing it has not been told', async () => {
    onlineManager.setOnline(false)

    await mount('/pflichten', { [firstPage]: page([maintenance]) })

    await screen.findByText(
      'Das Pflichtenverzeichnis kommt vom Server. Gerade ist keine Verbindung da.',
    )
    expect(screen.queryByRole('table', { name: register })).toBeNull()
  })

  it('stands as boxes on a phone, each the way to the page of its duty', async () => {
    onA('phone')
    await mount('/pflichten', { [firstPage]: page([interim, atRoom]) })

    const list = await screen.findByRole('list', { name: register })
    const boxes = within(list).getAllByRole('listitem')

    expect(boxes.map((box) => box.textContent)).toEqual([
      'ZwischenprüfungAufzug Schulhaus · Schulzentrum Am Lindenhain · 12 Monate · Niemand benanntNie erfasst',
      'Heizraum frei von BrandlastenE.14 Heizraum · Schulzentrum Am Lindenhain · 3 Monate · Dennis RothFällig',
    ])
    expect(within(list).getByRole('link', { name: 'Zwischenprüfung' }).getAttribute('href')).toBe(
      '/pflichten/d-interim',
    )
  })

  it('stands in the navigation for whoever reads duties, and is lit there', async () => {
    await mount('/pflichten', { [firstPage]: page([maintenance]) })
    await screen.findByRole('table', { name: register })

    expect(
      within(screen.getByRole('navigation', { name: 'Hauptbereiche' }))
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') !== null)
        .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`),
    ).toEqual(['Pflichtenverzeichnis > /pflichten'])
  })

  it('is not there for somebody who may not read duties', async () => {
    const technician = memberIn('technician')

    await mount('/liegenschaften', {
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'duty.read') },
      ],
    })
    await screen.findByRole('heading', { level: 1, name: 'Liegenschaften' })

    expect(
      within(screen.getByRole('navigation', { name: 'Hauptbereiche' })).queryByRole('link', {
        name: 'Pflichtenverzeichnis',
      }),
    ).toBeNull()
  })
})

describe('the duties of a room', () => {
  const at = `/raeume/${boilerRoom.id}`
  const reading: DutyReading = {
    id: 'd-room',
    kind: null,
    kindVersion: null,
    label: 'Heizraum frei von Brandlasten',
    basis: 'own_decision',
    sourceNote: 'Brandschutzordnung Teil C',
    counting: 'from_performance',
    intervalDays: null,
    intervalMonths: 3,
    endsOn: null,
    title: 'Heizraum frei von Brandlasten',
    state: 'due',
    appointment: { dueOn: '2026-10-28', onTimeUntil: '2026-10-28' },
    lastMetOn: '2026-07-28',
  } as DutyReading

  it('stand on the page of the room, each with its last evidence, its appointment and its state, and lead to their page', async () => {
    await mount(at, { '/rooms/r-boiler/duties': [reading] })
    await screen.findByRole('table', { name: dutiesOfTheRoom })

    expect(rowsOf(dutiesOfTheRoom)).toEqual([
      [
        'Heizraum frei von BrandlastenEigene Festlegung, Brandschutzordnung Teil C · alle 3 Monate',
        '28.07.2026',
        '28.10.2026',
        'Fällig',
      ],
    ])
    expect(
      screen.getByRole('link', { name: 'Heizraum frei von Brandlasten' }).getAttribute('href'),
    ).toBe('/pflichten/d-room')
  })

  it('say that they could not be read where the server does not answer, and the rest of the page stands', async () => {
    // No answer for the question: the server of this test says 404.
    await mount(at, {})

    await screen.findByText(
      'Die Pflichten ließen sich nicht laden. Sie kommen vom Server, mit Verbindung.',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'E.14 Heizraum' })).toBeTruthy()
  })

  it('say so of a room no duty hangs on', async () => {
    await mount(at, { '/rooms/r-boiler/duties': [] })

    await screen.findByText(
      'An diesem Raum selbst hängt keine Pflicht. Die Pflichten einer Anlage stehen in ihrer Akte.',
    )
  })

  it('say that they come from the server while there is no connection, and the rest of the page stands', async () => {
    // The room is on the device before the connection goes: the page is read from there.
    const { router } = await mount('/liegenschaften', { '/rooms/r-boiler/duties': [reading] })

    await screen.findByText('Schulzentrum Am Lindenhain')
    window.dispatchEvent(new Event('offline'))
    await act(() => router.navigate({ to: at }))

    await screen.findByText('Die Pflichten kommen vom Server. Gerade ist keine Verbindung da.')
    expect(screen.getByRole('heading', { level: 1, name: 'E.14 Heizraum' })).toBeTruthy()
    expect(screen.getByText('In diesem Raum steht noch keine Anlage.')).toBeTruthy()
    expect(screen.queryByRole('table', { name: dutiesOfTheRoom })).toBeNull()
  })

  it('are shown only to somebody who may read duties, and the server is not asked for anybody else', async () => {
    const technician = memberIn('technician')
    const asked: string[] = []

    signedInOffice('technician', [sued], {
      ...servingCatalogue(),
      '/rooms/r-boiler/duties': [reading],
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'duty.read') },
      ],
    })

    const answer = globalThis.fetch

    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      asked.push(path)

      return answer(path, init)
    })

    await mountOffice(at, server, everything)
    await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum' })
    await screen.findByText('In diesem Raum steht noch keine Anlage.')

    expect(screen.queryByText('Pflichten an diesem Raum')).toBeNull()
    expect(asked.filter((path) => path.includes('/duties'))).toEqual([])
  })
})

describe('the way to a duty of the operator own', () => {
  const room = `/raeume/${boilerRoom.id}`

  it.each(['management', 'technical_management'] as const)(
    'stands in the head of the register for whoever keeps it: "%s"',
    async (role) => {
      const { router } = await mount('/pflichten', { [firstPage]: page([maintenance]) }, role)

      await screen.findByRole('table', { name: register })
      press('Eigene Pflicht')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/pflichten/neu')
      })
      expect(router.state.location.search).toEqual({})
    },
  )

  it.each(['site_management', 'technician'] as const)(
    'stands there for nobody else: not for "%s"',
    async (role) => {
      await mount('/pflichten', { [firstPage]: page([maintenance]) }, role)
      await screen.findByRole('table', { name: register })

      expect(screen.queryByRole('button', { name: 'Eigene Pflicht' })).toBeNull()
    },
  )

  it('starts in the building the register is narrowed to', async () => {
    const { router } = await mount(
      '/pflichten?gebaeude=b-house',
      { '/duties/register?buildingId=b-house&offset=0&limit=50': page([maintenance]) },
      'management',
    )

    await screen.findByRole('table', { name: register })
    press('Eigene Pflicht')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/neu')
    })
    expect(router.state.location.search).toEqual({ gebaeude: 'b-house' })
  })

  it('starts on the property the register is narrowed to', async () => {
    const { router } = await mount(
      '/pflichten?liegenschaft=p-yard',
      { '/duties/register?propertyId=p-yard&offset=0&limit=50': page([atBuilding]) },
      'management',
    )

    await screen.findByRole('table', { name: register })
    press('Eigene Pflicht')

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ liegenschaft: 'p-yard' })
    })
  })

  it('stands in the card of the duties of a room, and starts at the room', async () => {
    const { router } = await mount(room, { '/rooms/r-boiler/duties': [] }, 'technical_management')

    await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum' })
    fireEvent.click(await screen.findByRole('button', { name: 'Pflicht hinzufügen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pflichten/neu')
    })
    expect(router.state.location.search).toEqual({ raum: 'r-boiler' })
  })

  it.each(['site_management', 'technician'] as const)(
    'stands at a room for nobody who does not keep the register: not for "%s"',
    async (role) => {
      await mount(room, { '/rooms/r-boiler/duties': [] }, role)
      await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum' })
      await screen.findByText('Pflichten an diesem Raum')

      expect(screen.queryByRole('button', { name: 'Pflicht hinzufügen' })).toBeNull()
    },
  )
})
