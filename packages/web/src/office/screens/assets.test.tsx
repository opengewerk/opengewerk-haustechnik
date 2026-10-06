import type {
  AssetDetails,
  AssetEntry,
  AssetRegister,
  DutyReading,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import { mountOffice, type NamedArea, onA, rowsOf, signedInOffice } from '../test-office.js'

/**
 * The register of assets and the file of an asset in the office (#87, 4.2 of
 * the concept): the list comes from the server a page at a time, narrowed by
 * what the address names, and the file shows an asset with its duties as they
 * stand today. The places and the catalogue are read from the device.
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
const gym = { id: 'b-gym', ...place, name: 'Sporthalle', kinds: '["school"]', yearBuilt: null }
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
const gymFloor = { id: 'f-gym', ...place, buildingId: gym.id, name: 'Erdgeschoss', level: 0 }
/** A room that has only a name. */
const gymHall = {
  id: 'r-hall',
  ...place,
  buildingId: gym.id,
  floorId: gymFloor.id,
  number: null,
  name: 'Halle',
  use: null,
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

const register = 'Anlagen mit Anlagenart, Standort, Zustand und Lebenszyklus'
const dutiesOfTheAsset = 'Pflichten dieser Anlage mit letztem Nachweis, nächstem Termin und Zustand'
const byCostGroup = 'Anlagen dieses Gebäudes, gezählt nach Kostengruppe'

/** The first page of the register without a filter, as the screen asks for it. */
const firstPage = '/assets?offset=0&limit=50'

function entry(
  id: string,
  number: string,
  name: string,
  further: Partial<AssetEntry> = {},
): AssetEntry {
  return {
    id,
    propertyId: school.id,
    buildingId: house.id,
    roomId: null,
    parentAssetId: null,
    kind: 'probe.elevator',
    number,
    name,
    lifecycleState: 'in_service',
    condition: 'in_order',
    until: '2028-09-24',
    ...further,
  } as AssetEntry
}

const lift = entry('a-lift', 'AN-00012', 'Aufzug Schulhaus')
const pump = entry('a-pump', 'AN-00057', 'Druckerhöhung', {
  kind: 'probe.pump',
  roomId: boilerRoom.id as AssetEntry['roomId'],
  condition: 'overdue',
  until: null,
})
const fan = entry('a-fan', 'AN-00099', 'Lüftung Halle', {
  propertyId: yard.id as AssetEntry['propertyId'],
  buildingId: hall.id as AssetEntry['buildingId'],
  // A kind the catalogue of this device does not know.
  kind: 'fremd.fan',
  lifecycleState: 'out_of_service',
  condition: 'resting',
  until: null,
})
const fresh = entry('a-fresh', 'AN-00100', 'Reck', {
  buildingId: gym.id as AssetEntry['buildingId'],
  roomId: gymHall.id as AssetEntry['roomId'],
  lifecycleState: null,
  condition: 'no_duties',
  until: null,
})

function page(assets: readonly AssetEntry[], total = assets.length, properties = 1): AssetRegister {
  return { total, properties, assets }
}

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

/** What stands beside the title in the head of the page. */
function head(): string {
  return screen.getByRole('heading', { level: 1 }).parentElement?.textContent ?? ''
}

/** The steps of the path over the page, each with where it leads. */
function path(): string[] {
  return within(screen.getByRole('navigation', { name: 'Pfad' }))
    .getAllByRole('link')
    .map((link) => `${link.textContent} > ${link.getAttribute('href') ?? ''}`)
}

/** Every fact of the page, by its name. */
function facts(): Readonly<Record<string, string | undefined>> {
  const values = screen.getAllByRole('definition')

  return Object.fromEntries(
    screen
      .getAllByRole('term')
      .map((term, index) => [term.textContent, values[index]?.textContent]),
  )
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()

  for (const property of [school, yard]) {
    server.put('properties', property)
  }

  for (const building of [house, gym, hall]) {
    server.put('buildings', building)
  }

  for (const floor of [ground, gymFloor]) {
    server.put('floors', floor)
  }

  for (const room of [boilerRoom, gymHall]) {
    server.put('rooms', room)
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the register of assets', () => {
  it('lists what the server names, each with its kind, its place, its condition and its life cycle', async () => {
    await mount('/anlagen', { [firstPage]: page([lift, pump, fan, fresh], 4, 2) })
    await screen.findByRole('table', { name: register })
    // The names of the kinds come with the catalogue of the device.
    await within(screen.getByRole('table', { name: register })).findByText('Druckerhöhungsanlage')

    expect(rowsOf(register)).toEqual([
      [
        'AN-00012',
        'Aufzug Schulhaus',
        'Aufzugsanlage',
        'Schulzentrum Am Lindenhain, Schulhaus',
        'In Ordnung bis 24.09.2028',
        'In Betrieb',
      ],
      [
        'AN-00057',
        'Druckerhöhung',
        'Druckerhöhungsanlage',
        'Schulzentrum Am Lindenhain, Schulhaus, E.14',
        'Überfällig',
        'In Betrieb',
      ],
      // The key of a kind no catalogue here knows, and the state it rests in.
      ['AN-00099', 'Lüftung Halle', 'fremd.fan', 'Werkhof Nord, Halle 1', 'Ruht', 'Außer Betrieb'],
      // A room without a number by its name, and no life cycle yet.
      [
        'AN-00100',
        'Reck',
        'Aufzugsanlage',
        'Schulzentrum Am Lindenhain, Sporthalle, Halle',
        'Ohne Pflichten',
        '',
      ],
    ])
    expect(head()).toContain('4 Anlagen in 2 Liegenschaften')
    expect(
      within(screen.getByRole('table', { name: register }))
        .getByRole('link', { name: 'Druckerhöhung' })
        .getAttribute('href'),
    ).toBe('/anlagen/a-pump')
  })

  it('asks the server for what the address names, filter by filter, and shows what it is narrowed by', async () => {
    await mount(
      '/anlagen?gebaeude=b-house&kostengruppe=460&art=probe.elevator&zustand=overdue&lebenszyklus=in_service',
      {
        // Only this question has an answer: any other, and no table stands.
        '/assets?buildingId=b-house&costGroup=460&kind=probe.elevator&condition=overdue&lifecycle=in_service&offset=0&limit=50':
          page([lift]),
      },
    )
    await screen.findByRole('table', { name: register })

    expect(rowsOf(register).map((row) => row[1])).toEqual(['Aufzug Schulhaus'])
    expect(
      ['Standort', 'Kostengruppe', 'Anlagenart', 'Zustand', 'Lebenszyklus'].map(
        (name) => filter(name).value,
      ),
    ).toEqual(['b:b-house', '460', 'probe.elevator', 'overdue', 'in_service'])
  })

  it('asks for a property where the address names one, and for nothing it has no word for', async () => {
    await mount('/anlagen?liegenschaft=p-yard&zustand=kaputt&lebenszyklus=none&farbe=rot', {
      '/assets?propertyId=p-yard&lifecycle=none&offset=0&limit=50': page([fan]),
    })
    await screen.findByRole('table', { name: register })

    expect(rowsOf(register).map((row) => row[1])).toEqual(['Lüftung Halle'])
    expect([
      filter('Standort').value,
      filter('Zustand').value,
      filter('Lebenszyklus').value,
    ]).toEqual(['p:p-yard', '', 'none'])
  })

  it('is narrowed by a choice, which goes into the address and to the server', async () => {
    const { router } = await mount('/anlagen', {
      [firstPage]: page([lift, pump]),
      '/assets?condition=overdue&offset=0&limit=50': page([pump]),
      '/assets?buildingId=b-house&condition=overdue&offset=0&limit=50': page([pump]),
      '/assets?propertyId=p-school&condition=overdue&offset=0&limit=50': page([pump, lift]),
      '/assets?propertyId=p-school&costGroup=460&condition=overdue&offset=0&limit=50': page([lift]),
    })
    const address = () => router.state.location.href
    const names = () => rowsOf(register).map((row) => row[1])

    await screen.findByRole('table', { name: register })
    expect(names()).toEqual(['Aufzug Schulhaus', 'Druckerhöhung'])
    // Nothing to take back while nothing narrows.
    expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).toBeNull()

    choose('Zustand', 'overdue')
    await waitFor(() => {
      expect(names()).toEqual(['Druckerhöhung'])
    })
    expect(address()).toBe('/anlagen?zustand=overdue')

    choose('Standort', 'b:b-house')
    await waitFor(() => {
      expect(address()).toBe('/anlagen?gebaeude=b-house&zustand=overdue')
    })

    // A property takes the place of the building, it does not join it.
    choose('Standort', 'p:p-school')
    await waitFor(() => {
      expect(names()).toEqual(['Druckerhöhung', 'Aufzug Schulhaus'])
    })
    expect(address()).toBe('/anlagen?liegenschaft=p-school&zustand=overdue')

    choose('Kostengruppe', '460')
    await waitFor(() => {
      expect(names()).toEqual(['Aufzug Schulhaus'])
    })
    expect(address()).toBe('/anlagen?liegenschaft=p-school&kostengruppe=460&zustand=overdue')

    // "Alle" takes a filter away again, and leaves the others.
    choose('Kostengruppe', '')
    await waitFor(() => {
      expect(address()).toBe('/anlagen?liegenschaft=p-school&zustand=overdue')
    })
    expect(names()).toEqual(['Druckerhöhung', 'Aufzug Schulhaus'])

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }))
    await waitFor(() => {
      expect(names()).toEqual(['Aufzug Schulhaus', 'Druckerhöhung'])
    })
    expect(address()).toBe('/anlagen')
  })

  it('offers the properties with their buildings, the cost groups of the kinds, the kinds, every condition and every state', async () => {
    await mount('/anlagen', { [firstPage]: page([lift]) })
    await screen.findByRole('table', { name: register })

    const choices = (name: string) =>
      within(filter(name))
        .getAllByRole('option')
        .map((option) => option.textContent)

    // Two packages call a kind the same: each says which package it is from.
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
      'Sporthalle',
      'Werkhof Nord, alle Gebäude',
      'Halle 1',
    ])
    // The groups a building is read by: 412 lies in 410, 461 in 460.
    expect(choices('Kostengruppe')).toEqual([
      'Alle',
      'KG 410 Abwasser-, Wasser-, Gasanlagen',
      'KG 460 Förderanlagen',
    ])
    expect(choices('Zustand')).toEqual([
      'Alle Zustände',
      'Mangel offen',
      'Nie geprüft',
      'Überfällig',
      'Fällig',
      'In Ordnung',
      'Ruht',
      'Ohne Pflichten',
    ])
    expect(choices('Lebenszyklus')).toEqual([
      'Alle',
      'Geplant',
      'In Betrieb',
      'Außer Betrieb',
      'Stillgelegt',
      'Zurückgebaut',
      'Ohne Angabe',
    ])
  })

  it('loads a further page where the server has more, and says how many of how many stand there', async () => {
    await mount('/anlagen', {
      [firstPage]: page([lift, pump], 3),
      '/assets?offset=2&limit=50': page([fresh], 3),
    })
    await screen.findByRole('table', { name: register })

    expect(screen.getByText('2 von 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Weitere laden' }))
    await screen.findByText('3 von 3')

    expect(rowsOf(register).map((row) => row[1])).toEqual([
      'Aufzug Schulhaus',
      'Druckerhöhung',
      'Reck',
    ])
    // Nothing further to load once everything stands there.
    expect(screen.queryByRole('button', { name: 'Weitere laden' })).toBeNull()
  })

  it('says that no asset passes, and that there is none at all', async () => {
    await mount('/anlagen?zustand=due', {
      [firstPage]: page([], 0, 0),
      '/assets?condition=due&offset=0&limit=50': page([], 0, 0),
    })

    await screen.findByText('Keine Anlage passt zu dem, wonach das Verzeichnis eingegrenzt ist.')
    expect(head()).toContain('Keine Anlage')

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }))
    await screen.findByText('Noch ist keine Anlage aufgenommen.')
  })
})

describe('the assets of a building by cost group', () => {
  const onDevice = (id: string, kind: string, name: string) => ({
    id,
    ...place,
    buildingId: house.id,
    roomId: null,
    parentAssetId: null,
    kind,
    number: null,
    name,
  })

  it('counts them by the group their kind lies in, and each count leads into the register of the building', async () => {
    for (const asset of [
      onDevice('a-1', 'probe.pump', 'Druckerhöhung 1'),
      onDevice('a-2', 'probe.elevator', 'Aufzug'),
      onDevice('a-3', 'probe.pump', 'Druckerhöhung 2'),
      onDevice('a-4', 'fremd.fan', 'Lüftung'),
    ]) {
      server.put('assets', asset)
    }

    await mount(`/gebaeude/${house.id}`, {})
    await screen.findByText('Förderanlagen')

    expect(rowsOf(byCostGroup)).toEqual([
      ['410 Abwasser-, Wasser-, Gasanlagen', '2'],
      ['460 Förderanlagen', '1'],
      // After the groups: what no catalogue of this device knows.
      ['Anlagenart nicht im Katalog', '1'],
    ])

    const leadsTo = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

    expect(leadsTo('Förderanlagen')).toBe('/anlagen?gebaeude=b-house&kostengruppe=460')
    expect(leadsTo('Abwasser-, Wasser-, Gasanlagen')).toBe(
      '/anlagen?gebaeude=b-house&kostengruppe=410',
    )
    expect(leadsTo('Anlagenart nicht im Katalog')).toBe('/anlagen?gebaeude=b-house')
    expect(leadsTo('Alle Anlagen')).toBe('/anlagen?gebaeude=b-house')
  })

  it('says so of a building no asset stands in', async () => {
    await mount(`/gebaeude/${gym.id}`, {})

    await screen.findByText('In diesem Gebäude steht noch keine Anlage.')
    expect(screen.queryByRole('table', { name: byCostGroup })).toBeNull()
  })
})

describe('the file of an asset', () => {
  function file(further: Readonly<Record<string, unknown>> = {}): AssetDetails {
    return {
      id: 'a-lift',
      ...place,
      buildingId: house.id,
      roomId: boilerRoom.id,
      parentAssetId: null,
      kind: 'probe.elevator',
      number: 'AN-00012',
      name: 'Aufzug Schulhaus',
      mark: 'A-1',
      manufacturer: 'Beispiel Aufzüge',
      model: null,
      serialNumber: 'SN-4711',
      yearBuilt: 2012,
      commissionedOn: '2012-09-03',
      warrantyEndsOn: null,
      values: { firefighters_lift: true, stops: 2021 },
      meterNumber: null,
      meterUnit: null,
      lifecycle: [{ id: 'l-1', assetId: 'a-lift', state: 'in_service', validFrom: '2012-09-03' }],
      lifecycleState: 'in_service',
      condition: 'in_order',
      until: '2027-03-12',
      supplies: [
        { id: 's-1', assetId: 'a-lift', buildingId: house.id, roomId: null },
        { id: 's-2', assetId: 'a-lift', buildingId: null, roomId: gymHall.id },
      ],
      components: [{ id: 'a-drive', number: 'AN-00013', name: 'Antrieb', kind: 'probe.pump' }],
      parent: null,
      ...further,
    } as unknown as AssetDetails
  }

  function duty(further: Readonly<Record<string, unknown>>): DutyReading {
    return {
      id: 'd-1',
      kind: null,
      kindVersion: null,
      label: 'Wartung',
      basis: 'manufacturer',
      sourceNote: 'Betriebsanleitung',
      counting: 'from_performance',
      intervalDays: null,
      intervalMonths: 12,
      endsOn: null,
      title: 'Wartung',
      state: 'met',
      appointment: { dueOn: '2027-03-12', onTimeUntil: '2027-03-12' },
      lastMetOn: '2026-03-12',
      ...further,
    } as DutyReading
  }

  const at = '/anlagen/a-lift'
  const answers = (asset: AssetDetails, duties: readonly DutyReading[] = []) => ({
    '/assets/a-lift': asset,
    '/assets/a-lift/duties': duties,
  })

  it('shows what is known about it, where it stands, what it supplies and what it consists of', async () => {
    await mount(at, answers(file()))
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
    await screen.findByText('Probepaket, Fassung 1.2.0')

    expect(head()).toContain('AN-00012')
    expect(head()).toContain('In Betrieb')
    expect(head()).toContain('In Ordnung bis 12.03.2027')
    expect(path()).toEqual([
      'Liegenschaften > /liegenschaften',
      'Schulzentrum Am Lindenhain > /liegenschaften/p-school',
      'Schulhaus > /gebaeude/b-house',
      'Erdgeschoss > /geschosse/f-ground',
      'E.14 Heizraum > /raeume/r-boiler',
    ])
    expect(facts()).toEqual({
      Anlagenart: 'Aufzugsanlage',
      Paket: 'Probepaket, Fassung 1.2.0',
      Kennzeichen: 'A-1',
      Hersteller: 'Beispiel Aufzüge',
      Seriennummer: 'SN-4711',
      // The fields of its kind, a yes and a number without a unit, written as it is.
      Feuerwehraufzug: 'Ja',
      Haltestellen: '2021',
      Baujahr: '2012',
      'In Betrieb seit': '03.09.2012',
      'Steht in': 'E.14 Heizraum, Erdgeschoss',
      Gebäude: 'Schulhaus',
      // A building as a whole, and a room of another building with that building.
      Versorgt: 'Schulhaus, ganzes GebäudeHalle, Sporthalle',
    })

    const leadsTo = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

    expect(leadsTo('Aufzugsanlage')).toBe('/katalog/probe/anlagenarten')
    expect(leadsTo('Antrieb')).toBe('/anlagen/a-drive')
    expect(leadsTo('Halle, Sporthalle')).toBe('/raeume/r-hall')
    expect(screen.getByText('AN-00013, Druckerhöhungsanlage')).toBeTruthy()
  })

  it('stands under the asset it is a component of', async () => {
    await mount(
      at,
      answers(
        file({
          roomId: null,
          parentAssetId: 'a-plant',
          parent: { id: 'a-plant', number: 'AN-00001', name: 'Förderanlage' },
          components: [],
          supplies: [],
        }),
      ),
    )
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(path().slice(-2)).toEqual([
      'Schulhaus > /gebaeude/b-house',
      'Förderanlage > /anlagen/a-plant',
    ])
    expect(facts()['Gehört zu']).toBe('Förderanlage')
    expect(facts()['Versorgt']).toBe('nur den eigenen Standort')
    expect(screen.getByText('Diese Anlage hat keine Komponenten.')).toBeTruthy()
  })

  it('lists its duties, each with its last evidence, its next appointment and its state', async () => {
    await mount(
      at,
      answers(file(), [
        duty({}),
        duty({
          id: 'd-2',
          // From the catalogue, in a version nobody accepted and nobody checked for years.
          kind: 'probe.interim_check',
          kindVersion: 1,
          label: null,
          basis: null,
          sourceNote: null,
          title: 'Zwischenprüfung',
          state: 'never_recorded',
          appointment: null,
          lastMetOn: null,
        }),
        duty({
          id: 'd-3',
          title: 'Sichtprüfung',
          label: 'Sichtprüfung',
          intervalMonths: null,
          intervalDays: 7,
          state: 'overdue',
          appointment: { dueOn: '2026-09-30', onTimeUntil: '2026-09-30' },
          lastMetOn: '2026-09-23',
        }),
      ]),
    )
    await screen.findByRole('table', { name: dutiesOfTheAsset })
    await screen.findByText('Nicht abgenommen')

    const rows = rowsOf(dutiesOfTheAsset)

    expect(rows[0]).toEqual([
      'WartungVorgabe des Herstellers, Betriebsanleitung · alle 12 Monate',
      '12.03.2026',
      '12.03.2027',
      'Erfüllt bis 12.03.2027',
    ])
    expect(rows[1]?.slice(1)).toEqual(['noch keiner', '', 'Nie erfasst'])
    expect(rows[1]?.[0]).toContain('Nicht abgenommen')
    expect(rows[1]?.[0]).toContain('Seit über einem Jahr nicht geprüft')
    expect(rows[2]).toEqual([
      'SichtprüfungVorgabe des Herstellers, Betriebsanleitung · alle 7 Tage',
      '23.09.2026',
      '30.09.2026',
      'Überfällig',
    ])
    // The name of a duty leads to its page, one from the catalogue and one of
    // the operator's own alike; from there the way goes on to its kind.
    expect(screen.getByRole('link', { name: 'Zwischenprüfung' }).getAttribute('href')).toBe(
      '/pflichten/d-2',
    )
    expect(screen.getByRole('link', { name: 'Wartung' }).getAttribute('href')).toBe(
      '/pflichten/d-1',
    )
  })

  it('keeps the past of a decommissioned asset, and shows its duties as resting', async () => {
    await mount(
      at,
      answers(
        file({
          lifecycle: [
            { id: 'l-1', assetId: 'a-lift', state: 'in_service', validFrom: '2012-09-03' },
            { id: 'l-2', assetId: 'a-lift', state: 'decommissioned', validFrom: '2026-07-01' },
            // What lies ahead does not hold today.
            { id: 'l-3', assetId: 'a-lift', state: 'removed', validFrom: '2999-01-01' },
          ],
          lifecycleState: 'decommissioned',
          condition: 'resting',
          until: null,
        }),
        [
          duty({
            state: 'dormant',
            appointment: { dueOn: '2025-03-12', onTimeUntil: '2025-03-12' },
            lastMetOn: '2024-03-12',
          }),
        ],
      ),
    )
    await screen.findByRole('table', { name: dutiesOfTheAsset })

    expect(head()).toContain('Stillgelegt')
    expect(head()).toContain('Ruht')
    // No appointment is named for a duty that rests, whatever its last evidence says.
    expect(rowsOf(dutiesOfTheAsset)).toEqual([
      [
        'WartungVorgabe des Herstellers, Betriebsanleitung · alle 12 Monate',
        '12.03.2024',
        '',
        'Ruht',
      ],
    ])
    expect(
      screen.getByText(
        'Die Anlage ist nicht in Betrieb. Ihre Pflichten ruhen, bis sie wieder in Betrieb geht, und verfallen nicht.',
      ),
    ).toBeTruthy()
    // Its life cycle whole, the newest first, and the entry of today said as such.
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => item.textContent)
        .filter((words) => /(seit|ab) \d/.test(words)),
    ).toEqual([
      'Zurückgebautab 01.01.2999',
      'Stillgelegt (heute)seit 01.07.2026',
      'In Betriebseit 03.09.2012',
    ])
  })

  it('says so of an asset without a duty and without an entry in its life cycle', async () => {
    await mount(
      at,
      answers(file({ lifecycle: [], lifecycleState: null, condition: 'no_duties', until: null })),
    )

    await screen.findByText('Für diese Anlage ist keine Pflicht bestätigt.')
    expect(
      screen.getByText('Noch kein Eintrag. Ohne Eintrag gilt die Anlage als in Betrieb.'),
    ).toBeTruthy()
    expect(head()).toContain('Ohne Pflichten')
  })

  it('shows the duties only to somebody who may read duties', async () => {
    const technician = memberIn('technician')

    await mount(at, {
      ...answers(file(), [duty({})]),
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'duty.read') },
      ],
    })
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
    await screen.findByText('Stammdaten')

    expect(screen.queryByText('Pflichten')).toBeNull()
    expect(screen.queryByRole('table', { name: dutiesOfTheAsset })).toBeNull()
  })

  it.each(['management', 'technical_management'] as const)(
    'offers a duty of the operator own in the card of the duties to whoever keeps the register, "%s", and starts at the asset',
    async (role) => {
      const { router } = await mount(at, answers(file()), role)

      await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
      fireEvent.click(await screen.findByRole('button', { name: 'Pflicht hinzufügen' }))

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/pflichten/neu')
      })
      expect(router.state.location.search).toEqual({ anlage: 'a-lift' })
    },
  )

  it.each(['site_management', 'technician'] as const)(
    'offers it to nobody else: not to "%s"',
    async (role) => {
      await mount(at, answers(file()), role)
      await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
      await screen.findByRole('heading', { level: 2, name: 'Pflichten' })

      expect(screen.queryByRole('button', { name: 'Pflicht hinzufügen' })).toBeNull()
    },
  )

  it('says so of an asset that is not there for this person', async () => {
    await mount('/anlagen/a-gone', {})

    await screen.findByRole('heading', { level: 1, name: 'Nicht gefunden' })
    expect(
      screen.getByText(
        'Diese Anlage gibt es nicht mehr, oder sie liegt in einem Bereich, den dieser Zugang nicht sieht.',
      ),
    ).toBeTruthy()
  })

  it('lights "Anlagen" in the navigation, and the log is opened from it by the Leitung', async () => {
    await mount(at, answers(file()), 'management')
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(
      within(screen.getByRole('navigation', { name: 'Hauptbereiche' }))
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') !== null)
        .map((link) => link.textContent),
    ).toEqual(['Anlagen'])
    await screen.findByRole('link', { name: /Änderungen/ })
  })
})
