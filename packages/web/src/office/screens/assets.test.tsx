import {
  type AssetDetails,
  type AssetEntry,
  type AssetRegister,
  assetTableColumns,
  type CatalogueBundle,
  type DutyReading,
  type RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acceptedReview, servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  servingTables,
  signedInOffice,
  type WriteAnswer,
} from '../test-office.js'

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
  'attachments',
  'attachment_versions',
] as const

const register = 'Anlagen mit Anlagenart, Standort, Zustand und Lebenszyklus'
const dutiesOfTheAsset = 'Pflichten dieser Anlage mit letztem Nachweis, nächstem Termin und Zustand'
const byCostGroup = 'Anlagen dieses Gebäudes, gezählt nach Kostengruppe'
const evidenceOfTheAsset =
  'Nachweise dieser Anlage mit Pflicht, Tag, Ergebnis und Bedeutung für die Frist'

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
    lacking: [],
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

/**
 * The catalogue with the package that stands in for a missing specialist
 * package, here with the general kind of one cost group: 460 has a name by
 * it, and 410 goes by its number alone (#163).
 */
const withGeneralKind: CatalogueBundle = {
  ...testCatalogue,
  sha256: '2'.repeat(64),
  packages: [
    ...testCatalogue.packages,
    {
      name: 'allgemein',
      title: 'Allgemein',
      version: '1.0.0',
      minimumCore: '0.1.0',
      assetKinds: [
        {
          key: 'allgemein.conveying_system',
          version: 1,
          validFrom: '2018-12-01',
          definition: {
            label: 'Förderanlage',
            costGroup: '460',
            characteristics: [],
            fields: [],
            expectedDocuments: [],
            meter: null,
          },
          review: acceptedReview,
        },
      ],
      dutyKinds: [],
      forms: [],
      roundTemplates: [],
      rules: [],
      defectClasses: [],
      qualifications: [],
    },
  ],
}

let server: TestServer

async function mount(
  at: string,
  answers: Readonly<Record<string, unknown>>,
  role: RoleKey = 'technician',
  catalogue: CatalogueBundle = testCatalogue,
) {
  signedInOffice(role, [sued], { ...servingCatalogue(catalogue), ...answers })

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
  vi.restoreAllMocks()
})

describe('the register of assets', () => {
  it('says of an asset a defect puts out of service so where its life cycle stands (#345)', async () => {
    const stopped = entry('a-stop', 'AN-00058', 'Aufzug Turnhalle', {
      condition: 'defect_open',
      until: null,
      shutDown: true,
    })

    await mount('/anlagen', { [firstPage]: page([lift, stopped]) })
    await screen.findByRole('table', { name: register })

    expect(rowsOf(register).map((row) => row.at(-1))).toEqual([
      'In Betrieb',
      'Außer Betrieb durch Mangel',
    ])
  })

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

  it('names under an asset what it lacks of the documents its kind expects, and is narrowed by them (#347)', async () => {
    const lacking = entry('a-lift', 'AN-00012', 'Aufzug Schulhaus', {
      lacking: [
        { key: 'emergency_plan', label: 'Notfallplan', demand: 'required' },
        {
          key: 'declaration_of_conformity',
          label: 'EG-Konformitätserklärung',
          demand: 'recommended',
        },
      ],
    })
    const { router } = await mount('/anlagen?unterlagen=missing', {
      '/assets?documents=missing&offset=0&limit=50': page([lacking, pump]),
      '/assets?documents=required_missing&offset=0&limit=50': page([lacking]),
    })

    await screen.findByRole('table', { name: register })

    const cell = within(screen.getByRole('table', { name: register }))
      .getByRole('link', { name: 'Aufzug Schulhaus' })
      .closest('td')

    expect(cell?.textContent).toBe(
      'Aufzug SchulhausEs fehlt: Notfallplan (verlangt), EG-Konformitätserklärung',
    )
    expect(within(cell as HTMLElement).getByText('Notfallplan (verlangt)').className).toContain(
      'text-conflict',
    )
    // An asset that lacks nothing says nothing of it.
    expect(rowsOf(register).map((row) => row[1])).toEqual([
      'Aufzug SchulhausEs fehlt: Notfallplan (verlangt), EG-Konformitätserklärung',
      'Druckerhöhung',
    ])
    expect(filter('Unterlagen').value).toBe('missing')
    expect([...filter('Unterlagen').options].map((option) => option.text)).toEqual([
      'Alle',
      'Es fehlen welche',
      'Es fehlen verlangte',
    ])

    choose('Unterlagen', 'required_missing')
    await waitFor(() => {
      expect(router.state.location.href).toBe('/anlagen?unterlagen=required_missing')
    })
    await waitFor(() => {
      expect(rowsOf(register)).toHaveLength(1)
    })
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

  it('names a cost group by its number and by the general asset kind the catalogue has for it (#163)', async () => {
    await mount('/anlagen', { [firstPage]: page([lift]) }, 'technician', withGeneralKind)
    await screen.findByRole('table', { name: register })

    const choices = () =>
      within(filter('Kostengruppe'))
        .getAllByRole('option')
        .map((option) => option.textContent)

    // What the general kind of 460 is called stands behind the number; 410
    // has none in this catalogue, and the elevator of 461 names no group.
    await waitFor(() => {
      expect(choices()).toEqual(['Alle', 'KG 410', 'KG 460 Förderanlage'])
    })
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
    // The groups a building is read by: 412 lies in 410, 461 in 460. This
    // catalogue has no general asset kind, so each goes by its number alone.
    expect(choices('Kostengruppe')).toEqual(['Alle', 'KG 410', 'KG 460'])
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

  it('gives what it shows as a table, whole and under the filter of its address (#138)', async () => {
    await mount('/anlagen?gebaeude=b-house&zustand=overdue', {
      '/assets?buildingId=b-house&condition=overdue&offset=0&limit=50': page([lift], 51),
    })
    await screen.findByRole('table', { name: register })

    // After the answers of the test, which it hands every other request to.
    const tables = servingTables()

    fireEvent.click(screen.getByRole('button', { name: 'Als Tabelle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }))

    await waitFor(() => {
      expect(tables.saved).toEqual(['Liste für heute.csv'])
    })
    expect(tables.asked).toEqual(['/assets/table?buildingId=b-house&condition=overdue&format=xlsx'])
  })

  it('heads its table with the columns its table goes out with', async () => {
    await mount('/anlagen', { [firstPage]: page([lift]) })
    await screen.findByRole('table', { name: register })

    expect(
      within(screen.getByRole('table', { name: register }))
        .getAllByRole('columnheader')
        .map((heading) => heading.textContent),
    ).toEqual([...assetTableColumns])
  })
})

describe('the kind of many assets, corrected in one step (#351)', () => {
  const older = entry('a-old', 'AN-00140', 'Aufzug Altbau', {
    kind: 'allgemein.conveying_system',
    condition: 'no_duties',
    until: null,
  })
  const goods = entry('a-goods', 'AN-00141', 'Lastenaufzug', {
    kind: 'allgemein.conveying_system',
    condition: 'no_duties',
    until: null,
  })
  /** The catalogue with the general kind, and a measuring point beside it. */
  const withMeter: CatalogueBundle = {
    ...withGeneralKind,
    packages: [
      ...withGeneralKind.packages,
      {
        name: 'messstellen',
        title: 'Messstellen',
        version: '1.0.0',
        minimumCore: '0.1.0',
        assetKinds: [
          {
            key: 'messstellen.water_meter',
            version: 1,
            validFrom: '2015-01-01',
            definition: {
              label: 'Wasserzähler',
              costGroup: '410',
              characteristics: [],
              fields: [],
              expectedDocuments: [],
              meter: { medium: 'water', units: ['cubic_metres'] },
            },
            review: acceptedReview,
          },
        ],
        dutyKinds: [],
        forms: [],
        roundTemplates: [],
        rules: [],
        defectClasses: [],
        qualifications: [],
      },
    ],
  }
  const newKind = 'Neue Anlagenart'

  /** The register with "Anlagenart berichtigen" pressed, and what the screen writes. */
  async function correcting(answer: WriteAnswer) {
    const written = signedInOffice(
      'technician',
      [sued],
      { ...servingCatalogue(withMeter), [firstPage]: page([older, goods, lift]) },
      () => answer,
    )

    await mountOffice('/anlagen', server, everything)
    // The names of the kinds come with the catalogue of the device.
    await within(await screen.findByRole('table', { name: register })).findAllByText('Förderanlage')
    fireEvent.click(screen.getByRole('button', { name: 'Anlagenart berichtigen' }))

    return written
  }

  it('puts a box in front of every row and sends the chosen assets with their new kind in one step', async () => {
    const written = await correcting({ status: 200, body: [] })

    fireEvent.click(screen.getByRole('checkbox', { name: 'AN-00140 Aufzug Altbau auswählen' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'AN-00141 Lastenaufzug auswählen' }))

    expect(screen.getAllByText('2 von 3 ausgewählt')).toHaveLength(2)
    expect(screen.getByText(/^Heute Förderanlage \(KG 460\)\./u)).toBeTruthy()

    // The kinds of the catalogue, and no measuring point: a meter needs its number and unit.
    const offered = within(screen.getByRole('combobox', { name: newKind }))
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(offered).toContain('Probepaket: Aufzugsanlage')
    expect(offered).not.toContain('Messstellen: Wasserzähler')

    fireEvent.change(screen.getByRole('combobox', { name: newKind }), {
      target: { value: 'probe.elevator' },
    })
    fireEvent.click(screen.getByRole('button', { name: '2 Anlagen berichtigen' }))

    expect(await screen.findByText('2 Anlagen berichtigt.')).toBeTruthy()
    expect(written).toEqual([
      {
        method: 'PUT',
        path: '/assets/kind',
        body: { kind: 'probe.elevator', assetIds: ['a-old', 'a-goods'] },
      },
    ])
    // Done, the boxes are gone again.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('asks for the new kind first, and says what the server refuses', async () => {
    const refusal =
      'AN-00012 Aufzug Schulhaus: Das Feld stops hat die Anlagenart Förderanlage nicht.'
    const written = await correcting({ status: 400, body: { message: refusal } })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Alle 3 geladenen auswählen' }))
    fireEvent.click(screen.getByRole('button', { name: '3 Anlagen berichtigen' }))

    expect(screen.getByText('Die neue Anlagenart fehlt.')).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.change(screen.getByRole('combobox', { name: newKind }), {
      target: { value: 'allgemein.conveying_system' },
    })
    fireEvent.click(screen.getByRole('button', { name: '3 Anlagen berichtigen' }))

    expect(await screen.findByText(refusal)).toBeTruthy()
    expect(written.map((write) => write.body)).toEqual([
      { kind: 'allgemein.conveying_system', assetIds: ['a-old', 'a-goods', 'a-lift'] },
    ])
    // Nothing is corrected, and the choice stays for a second try.
    expect(screen.getAllByText('3 von 3 ausgewählt')).toHaveLength(2)
  })

  it('is offered to whoever takes stock of assets, from the width of a tablet on', async () => {
    const technician = memberIn('technician')

    signedInOffice('technician', [sued], {
      ...servingCatalogue(withMeter),
      [firstPage]: page([older]),
      // A role of the operator's own that reads assets and does not take stock of them (#346).
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'asset.record') },
      ],
    })
    await mountOffice('/anlagen', server, everything)
    await screen.findByRole('table', { name: register })

    expect(screen.queryByRole('button', { name: 'Anlagenart berichtigen' })).toBeNull()
  })

  it('is not offered on a phone, where the register stands as cards', async () => {
    onA('phone')
    signedInOffice('technician', [sued], {
      ...servingCatalogue(withMeter),
      [firstPage]: page([older]),
    })
    await mountOffice('/anlagen', server, everything)
    await screen.findByText('Aufzug Altbau')

    expect(screen.queryByRole('button', { name: 'Anlagenart berichtigen' })).toBeNull()
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

    await mount(`/gebaeude/${house.id}`, {}, 'technician', withGeneralKind)
    await screen.findByText('Förderanlage')

    // A group goes by what the general asset kind of the catalogue is called
    // (#163); 410 has none here and stands as a cost group with its number.
    expect(rowsOf(byCostGroup)).toEqual([
      ['410 Kostengruppe', '2'],
      ['460 Förderanlage', '1'],
      // After the groups: what no catalogue of this device knows.
      ['Anlagenart nicht im Katalog', '1'],
    ])

    const leadsTo = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

    expect(leadsTo('Förderanlage')).toBe('/anlagen?gebaeude=b-house&kostengruppe=460')
    expect(leadsTo('Kostengruppe')).toBe('/anlagen?gebaeude=b-house&kostengruppe=410')
    // The count of a group leads where its name leads, and says what it counts.
    expect(leadsTo('1 Anlage, KG 460 Förderanlage')).toBe(
      '/anlagen?gebaeude=b-house&kostengruppe=460',
    )
    expect(leadsTo('2 Anlagen, KG 410')).toBe('/anlagen?gebaeude=b-house&kostengruppe=410')
    expect(leadsTo('1 Anlage, Anlagenart nicht im Katalog')).toBe('/anlagen?gebaeude=b-house')
    expect(leadsTo('Anlagenart nicht im Katalog')).toBe('/anlagen?gebaeude=b-house')
    expect(leadsTo('Alle Anlagen')).toBe('/anlagen?gebaeude=b-house')
  })

  it('say with the stock how many lack documents their kind expects, and lead to them in the register (#347)', async () => {
    for (const asset of [
      onDevice('a-1', 'probe.elevator', 'Aufzug Nord'),
      onDevice('a-2', 'probe.elevator', 'Aufzug Süd'),
      onDevice('a-3', 'probe.pump', 'Druckerhöhung'),
      onDevice('a-4', 'probe.elevator', 'Aufzug Ost'),
    ]) {
      server.put('assets', asset)
    }

    const filed = (id: string, assetId: string, kind: string) => ({
      id,
      ...place,
      buildingId: null,
      roomId: null,
      assetId,
      activityId: null,
      defectId: null,
      title: id,
      kind,
    })

    // The first has both, the second lacks the emergency plan, which is
    // required, the fourth the manual, which is recommended. A pump expects nothing.
    server.put('attachments', filed('d-1', 'a-1', 'operating_manual'))
    server.put('attachments', filed('d-2', 'a-1', 'concept'))
    server.put('attachments', filed('d-3', 'a-2', 'operating_manual'))
    server.put('attachments', filed('d-4', 'a-4', 'concept'))
    // Filed without a network, its file never came: it fulfils nothing (#516).
    server.put('attachments', filed('d-5', 'a-2', 'concept'))

    for (const [order, document] of ['d-1', 'd-2', 'd-3', 'd-4'].entries()) {
      server.put('attachment_versions', {
        id: `00000000-0000-7000-8000-00000000004${String(order)}`,
        attachmentId: document,
        sha256: String(order).padEnd(64, 'b'),
        fileName: `${document}.pdf`,
        mediaType: 'application/pdf',
        sizeBytes: 1000,
        previewSha256: null,
        createdBy: 'u-kraemer',
        createdAt: '2026-10-01T09:00:00.000Z',
      })
    }

    await mount(`/gebaeude/${house.id}`, {})

    const line = await screen.findByText(/Unterlagen fehlen an/)

    expect(line.textContent).toBe('Unterlagen fehlen an 2 Anlagen, an einer davon verlangte.')
    expect(within(line).getByRole('link', { name: '2 Anlagen' }).getAttribute('href')).toBe(
      '/anlagen?gebaeude=b-house&unterlagen=missing',
    )
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
      distinctFromAssets: [],
      distinctFromElsewhere: 0,
      replacesAssetId: null,
      replaces: null,
      replacedBy: null,
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
      lastEvidence: {
        id: 'e-41',
        number: 'NW-2026-00041',
        performedOn: '2026-03-12',
        origin: 'report',
      },
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
    // Held against nothing when it was entered, the file says nothing about it.
    expect(facts()['Keine Dublette von']).toBeUndefined()
  })

  it('says which assets it was found to be another than, by number and name (#171)', async () => {
    await mount(
      at,
      answers(
        file({
          distinctFromAssets: [
            { id: 'a-twin', number: 'AN-00057', name: 'Aufzug Sporthalle', removed: false },
            { id: 'a-gone', number: 'AN-00031', name: 'Aufzug Altbau', removed: true },
          ],
          distinctFromElsewhere: 1,
        }),
      ),
    )
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(facts()['Keine Dublette von']?.replaceAll(/\s+/g, ' ')).toBe(
      'AN-00057 Aufzug Sporthalle' +
        'AN-00031 Aufzug Altbau (entfernt)' +
        'eine weitere Anlage außerhalb Ihrer Bereiche' +
        'Beim Anlegen als mögliche Dublette gezeigt.',
    )
    // The one that is there leads to its file, the one that was removed has none.
    expect(
      screen.getByRole('link', { name: 'AN-00057 Aufzug Sporthalle' }).getAttribute('href'),
    ).toBe('/anlagen/a-twin')
    expect(screen.queryByRole('link', { name: /Aufzug Altbau/ })).toBeNull()
  })

  it('counts what it was held against beyond the areas of whoever reads, and names none of it', async () => {
    await mount(at, answers(file({ distinctFromElsewhere: 2 })))
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(facts()['Keine Dublette von']?.replaceAll(/\s+/g, ' ')).toBe(
      '2 Anlagen außerhalb Ihrer Bereiche' + 'Beim Anlegen als mögliche Dublette gezeigt.',
    )
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
          lastEvidence: null,
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
          // Taken over from an earlier application: named by its day.
          lastEvidence: {
            id: 'e-9',
            number: 'NW-2026-00009',
            performedOn: '2026-09-23',
            origin: 'legacy',
          },
        }),
      ]),
    )
    await screen.findByRole('table', { name: dutiesOfTheAsset })
    await screen.findByText('Nicht abgenommen')

    const rows = rowsOf(dutiesOfTheAsset)

    expect(rows[0]).toEqual([
      'WartungVorgabe des Herstellers, Betriebsanleitung · alle 12 Monate',
      // The number of the last evidence leads to its page, its day under it.
      'NW-2026-0004112.03.2026',
      '12.03.2027',
      'Erfüllt bis 12.03.2027',
    ])
    expect(rows[1]?.slice(1)).toEqual(['noch keiner', '', 'Nie erfasst'])
    expect(rows[1]?.[0]).toContain('Nicht abgenommen')
    expect(rows[1]?.[0]).toContain('Seit über einem Jahr nicht geprüft')
    expect(rows[2]).toEqual([
      'SichtprüfungVorgabe des Herstellers, Betriebsanleitung · alle 7 Tage',
      '23.09.2026Altbestand',
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
    expect(screen.getByRole('link', { name: 'NW-2026-00041' }).getAttribute('href')).toBe(
      '/nachweise/e-41',
    )
    expect(screen.getByRole('link', { name: '23.09.2026' }).getAttribute('href')).toBe(
      '/nachweise/e-9',
    )
  })

  it('lists the evidence of its duties with the duty and what each means for the appointment', async () => {
    const entry = (id: string, further: object) => ({
      id,
      dutyId: 'd-1',
      dutyTitle: 'Wartung',
      number: `NW-2026-${id}`,
      result: 'without_defects',
      origin: 'protocol',
      standing: 'counts',
      ...further,
    })

    await mount(at, {
      ...answers(file()),
      '/assets/a-lift/evidence': [
        entry('00131', { performedOn: '2026-10-01', result: 'with_defects' }),
        entry('00127', {
          dutyId: 'd-3',
          dutyTitle: 'Sichtprüfung',
          performedOn: '2026-09-24',
          origin: 'round_point',
          standing: 'voided',
        }),
      ],
    })
    await screen.findByRole('table', { name: evidenceOfTheAsset })

    expect(rowsOf(evidenceOfTheAsset)).toEqual([
      ['NW-2026-00131', 'Wartung', '01.10.2026', 'Mit Mängeln', 'Zählt'],
      ['NW-2026-00127', 'Sichtprüfung', '24.09.2026', 'Ohne Mangel', 'Für ungültig erklärt'],
    ])
    expect(screen.getByRole('link', { name: 'NW-2026-00127' }).getAttribute('href')).toBe(
      '/nachweise/00127',
    )
  })

  it('says under its duties how many proposals of the catalogue are open and dismissed, with the way to them (#102)', async () => {
    const proposed = { kind: 'probe.elevator_main_test', asset: { id: 'a-lift' } }

    await mount(at, {
      ...answers(file()),
      '/duties/proposals?assetId=a-lift': {
        proposals: [proposed, { ...proposed, kind: 'probe.interim_check' }],
        dismissed: [{ id: 'dm-1', kind: 'probe.other', asset: { id: 'a-lift' } }],
      },
    })

    expect((await screen.findByRole('link', { name: '2 offene' })).getAttribute('href')).toBe(
      '/pflichten/vorschlaege?anlage=a-lift',
    )
    expect(screen.getByRole('link', { name: '1 verworfener Vorschlag' }).getAttribute('href')).toBe(
      '/pflichten/vorschlaege/verworfen?anlage=a-lift',
    )
    expect(screen.getByText(/^Vorschläge aus dem Katalog:/)).toBeTruthy()
  })

  it('gives out the book of the asset with its life cycle, as a PDF with the evidence behind it or as a table (#437)', async () => {
    await mount(at, {
      ...answers(file()),
      '/assets/a-lift/evidence': [
        {
          id: 'e-131',
          dutyId: 'd-1',
          dutyTitle: 'Wartung',
          number: 'NW-2026-00131',
          performedOn: '2026-10-01',
          result: 'without_defects',
          origin: 'protocol',
          standing: 'counts',
        },
      ],
    })
    await screen.findByRole('table', { name: evidenceOfTheAsset })

    const tables = servingTables()
    const open = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Anlagenbuch' }))

      return within(await screen.findByRole('dialog', { name: 'Anlagenbuch' }))
    }
    const first = await open()

    expect(
      first.getByText(
        '2 Einträge vom 03.09.2012 bis 01.10.2026: 1 Nachweis und 1 Eintrag des Lebenszyklus.',
      ),
    ).toBeTruthy()
    fireEvent.click(first.getByRole('button', { name: 'Ausgeben' }))
    await waitFor(() => {
      expect(tables.asked).toEqual(['/assets/a-lift/book/pdf?attach=1'])
    })

    const table = await open()

    fireEvent.click(table.getByRole('radio', { name: 'Excel (.xlsx)' }))
    fireEvent.click(table.getByRole('button', { name: 'Ausgeben' }))
    await waitFor(() => {
      expect(tables.asked.at(-1)).toBe('/assets/a-lift/book/table?format=xlsx')
    })
  })

  it('says so of an asset without evidence', async () => {
    await mount(at, { ...answers(file()), '/assets/a-lift/evidence': [] })

    expect(
      await screen.findByText('Für diese Anlage ist noch kein Nachweis festgehalten.'),
    ).toBeTruthy()
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
            lastEvidence: {
              id: 'e-3',
              number: 'NW-2024-00003',
              performedOn: '2024-03-12',
              origin: 'report',
            },
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
        'NW-2024-0000312.03.2024',
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

    // The card, and not the group of the navigation, which holds "Prüfungen".
    expect(screen.queryByRole('heading', { name: 'Pflichten' })).toBeNull()
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

  // A defect of a class that makes it unsafe puts it out of service (#345).
  const unsafe = {
    id: 'df-1',
    description: 'Fangvorrichtung greift nicht',
    defectClass: 'probe.severe',
    foundOn: '2026-10-15',
    dueOn: '2026-10-18',
  }

  it('says in its head that a defect puts it out of service, names the defect first, and that no entry takes it back (#345)', async () => {
    await mount(
      at,
      answers(
        file({
          shutDown: true,
          shutDownBy: [unsafe],
          components: [
            {
              id: 'a-drive',
              number: 'AN-00013',
              name: 'Antrieb',
              kind: 'probe.pump',
              lifecycleState: null,
              shutDown: false,
            },
          ],
        }),
      ),
    )
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
    // The word of the class comes with the catalogue of the device.
    await screen.findByText('Probepaket, Fassung 1.2.0')

    // Over the state of its life cycle, which says "In Betrieb".
    expect(head()).toContain('Außer Betrieb durch Mangel')
    expect(head()).not.toContain('In Betrieb')

    const named = await screen.findByRole('link', { name: 'Fangvorrichtung greift nicht' })

    expect(named.getAttribute('href')).toBe('/maengel/df-1')
    expect(named.parentElement?.textContent).toBe(
      'Außer Betrieb durch Mangel: Fangvorrichtung greift nicht, schwer, festgestellt am 15.10.2026. ' +
        'Die Anlage bleibt außer Betrieb, bis der Mangel behoben ist, also bis zur Unterschrift unter seinem Auftrag. ' +
        'Ihre Pflichten laufen weiter.',
    )
    expect(
      within(screen.getByRole('region', { name: 'Lebenszyklus' })).getByText(
        'Außer Betrieb durch Mangel gilt, solange ein Mangel sie unsicher macht. Ein Eintrag hier ändert das nicht.',
      ),
    ).toBeTruthy()
  })

  it('tells whoever does not read the defects the state, and not what is wrong (#345)', async () => {
    await mount(at, answers(file({ shutDown: true, shutDownBy: null })))
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(head()).toContain('Außer Betrieb durch Mangel')
    expect(
      screen.getByText(
        'Ein Mangel macht die Anlage unsicher. Sie bleibt außer Betrieb, bis er behoben ist. Ihre Pflichten laufen weiter.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Fangvorrichtung greift nicht' })).toBeNull()
  })

  it('says it at a component a defect puts out of service, and not in its own head (#345)', async () => {
    await mount(
      at,
      answers(
        file({
          shutDown: false,
          shutDownBy: [],
          components: [
            {
              id: 'a-drive',
              number: 'AN-00013',
              name: 'Antrieb',
              kind: 'probe.pump',
              lifecycleState: 'in_service',
              shutDown: true,
            },
          ],
        }),
      ),
    )
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(head()).not.toContain('Außer Betrieb durch Mangel')
    expect(
      within(screen.getByRole('region', { name: 'Komponenten' })).getByText(
        'Außer Betrieb durch Mangel',
      ),
    ).toBeTruthy()
  })

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
