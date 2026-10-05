import type {
  AssetDetails,
  AssetDuplicate,
  CatalogueBundle,
  RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acceptedReview, servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  signedInOffice,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * An asset made and changed in the office (#88, 4.2 of the concept): the
 * form with the fields of the chosen kind, the possible duplicate that is
 * named and never refused, a component, and what is changed at the file of
 * an asset, each by whoever section 7 gives it to.
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
const gym = { id: 'b-gym', ...place, name: 'Sporthalle', kinds: '["school"]', yearBuilt: null }
const ground = { id: 'f-ground', ...place, buildingId: house.id, name: 'Erdgeschoss', level: 0 }
const upstairs = { id: 'f-up', ...place, buildingId: house.id, name: '1. Obergeschoss', level: 1 }
const boilerRoom = {
  id: 'r-boiler',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
const classroom = {
  id: 'r-class',
  ...place,
  buildingId: house.id,
  floorId: upstairs.id,
  number: '1.03',
  name: 'Klassenraum 5a',
  use: null,
}
const gymFloor = { id: 'f-gym', ...place, buildingId: gym.id, name: 'Erdgeschoss', level: 0 }
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
    values: { firefighters_lift: true, stops: 4 },
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

const twin: AssetDuplicate = {
  id: 'a-twin',
  number: 'AN-00057',
  name: 'Aufzug Sporthalle',
  kind: 'probe.elevator',
  propertyId: school.id,
  buildingId: gym.id,
  roomId: gymHall.id,
  serialNumber: 'SN-4711',
  mark: null,
  same: ['serialNumber'],
} as unknown as AssetDuplicate

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

/** A route that answers a write with the record it made or changed. */
const answering =
  (body: unknown, status = 200) =>
  (): WriteAnswer => ({ status, body })

async function mount(
  at: string,
  answers: Readonly<Record<string, unknown>> = {},
  role: RoleKey = 'technician',
  catalogue: CatalogueBundle = testCatalogue,
) {
  written = signedInOffice(role, [sued], { ...servingCatalogue(catalogue), ...answers }, (write) =>
    answerToWrite(write),
  )

  const mounted = await mountOffice(at, server, everything)

  return mounted.router
}

/** Every question a screen asks the server from here on, in order. */
function watchingReads(): string[] {
  const asked: string[] = []
  const answer = globalThis.fetch

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') {
      asked.push(path)
    }

    return answer(path, init)
  })

  return asked
}

function choice(name: string): HTMLSelectElement {
  return screen.getByRole('combobox', { name })
}

function choose(name: string, value: string): void {
  fireEvent.change(choice(name), { target: { value } })
}

function type(name: string, value: string): HTMLElement {
  const field = screen.getByLabelText(name)

  fireEvent.change(field, { target: { value } })

  return field
}

function offered(name: string): string[] {
  return [...choice(name).options].filter((option) => !option.hidden).map((each) => each.text)
}

function press(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** The form once the catalogue of the device has arrived, with its kinds. */
async function untilTheKindsAreThere(): Promise<void> {
  await waitFor(() => {
    expect(offered('Anlagenart').length).toBeGreaterThan(0)
  })
}

const duplicatesOf = (query: string) => `/assets/duplicates?${query}`

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  answerToWrite = () => ({ status: 500, body: { message: 'Nicht erwartet.' } })

  server.put('properties', school)

  for (const building of [house, gym]) {
    server.put('buildings', building)
  }

  for (const floor of [ground, upstairs, gymFloor]) {
    server.put('floors', floor)
  }

  for (const room of [boilerRoom, classroom, gymHall]) {
    server.put('rooms', room)
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the form of a new asset', () => {
  it('offers the kinds in force today by package, and the fields of the chosen kind in that version', async () => {
    // The second version of the elevator begins in the year 2999, with another name and a field more.
    const [probe, ...others] = testCatalogue.packages
    const withALaterVersion: CatalogueBundle = {
      ...testCatalogue,
      sha256: '3'.repeat(64),
      packages: [
        {
          ...(probe as CatalogueBundle['packages'][number]),
          assetKinds: (probe?.assetKinds ?? []).map((entry) =>
            entry.version === 2
              ? {
                  ...entry,
                  definition: {
                    ...entry.definition,
                    fields: [
                      ...entry.definition.fields,
                      { key: 'cabins', label: 'Kabinen', kind: 'number' as const },
                    ],
                  },
                }
              : entry,
          ),
        },
        ...others,
      ],
    }

    await mount('/anlagen/neu', {}, 'technician', withALaterVersion)
    await screen.findByRole('heading', { level: 1, name: 'Neue Anlage' })
    await untilTheKindsAreThere()

    expect(offered('Anlagenart')).toEqual([
      'Probepaket: Aufzugsanlage',
      'Probepaket: Druckerhöhungsanlage',
      'Abgenommenes Paket: Druckerhöhungsanlage',
    ])
    expect(screen.queryByText('Angaben der Anlagenart')).toBeNull()

    choose('Anlagenart', 'probe.elevator')

    expect(screen.getByText('Angaben der Anlagenart')).toBeTruthy()
    expect(offered('Feuerwehraufzug')).toEqual(['Keine Angabe', 'Ja', 'Nein'])
    expect(screen.getByRole('textbox', { name: 'Haltestellen' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Kabinen' })).toBeNull()

    // A kind without fields of its own has none in the form.
    choose('Anlagenart', 'probe.pump')

    expect(screen.queryByText('Angaben der Anlagenart')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Haltestellen' })).toBeNull()
  })

  it('shows the duty kinds the catalogue holds for the chosen kind', async () => {
    await mount('/anlagen/neu')
    await untilTheKindsAreThere()

    const duties = within(screen.getByRole('region', { name: 'Pflichten aus dem Katalog' }))

    expect(duties.getByText(/Wählen Sie eine Anlagenart/)).toBeTruthy()

    choose('Anlagenart', 'probe.elevator')

    expect(
      duties.getByRole('link', { name: 'Hauptprüfung der Aufzugsanlage' }).getAttribute('href'),
    ).toBe('/katalog/probe/pflichtarten/elevator_main_test')
    expect(duties.getByText('§ 16 der Probeverordnung · Höchstfrist 24 Monate')).toBeTruthy()
    expect(duties.getByText(/hängt von ihren Angaben, der Gebäudeart und dem Land ab/)).toBeTruthy()

    choose('Anlagenart', 'probe.pump')

    expect(duties.getByText('Für diese Anlagenart führt der Katalog keine Pflicht.')).toBeTruthy()
  })

  it('says of a general kind that the package of the asset is still missing', async () => {
    const withGeneral: CatalogueBundle = {
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
              key: 'allgemein.kg_420',
              version: 1,
              validFrom: '2015-06-01',
              definition: {
                label: 'Wärmeversorgungsanlage',
                costGroup: '420',
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
        },
      ],
    }

    await mount('/anlagen/neu', {}, 'technician', withGeneral)
    await untilTheKindsAreThere()

    choose('Anlagenart', 'probe.elevator')

    expect(screen.queryByText(/fehlt noch das Fachpaket/)).toBeNull()

    choose('Anlagenart', 'allgemein.kg_420')

    expect(
      screen.getByText(
        /Allgemeine Anlagenart der Kostengruppe 420: für diese Anlage fehlt noch das Fachpaket/,
      ),
    ).toBeTruthy()
  })

  it('starts in the building its address names, under the path of that building', async () => {
    await mount('/anlagen/neu?gebaeude=b-house')
    await untilTheKindsAreThere()

    expect(choice('Gebäude').value).toBe(house.id)
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Liegenschaften', 'Schulzentrum Am Lindenhain', 'Schulhaus'])
  })

  it('offers the floors and rooms of the chosen building, the rooms narrowed to a floor', async () => {
    await mount('/anlagen/neu')
    await untilTheKindsAreThere()

    expect(offered('Gebäude')).toEqual(['Schulhaus', 'Sporthalle'])
    expect(offered('Raum')).toEqual(['Kein Raum'])

    choose('Gebäude', house.id)

    expect(offered('Geschoss')).toEqual(['Alle Geschosse', 'Erdgeschoss', '1. Obergeschoss'])
    expect(offered('Raum')).toEqual(['Kein Raum', '1.03 Klassenraum 5a', 'E.14 Heizraum'])

    choose('Geschoss', ground.id)

    expect(offered('Raum')).toEqual(['Kein Raum', 'E.14 Heizraum'])

    // A room names its floor, and another building has neither.
    choose('Geschoss', '')
    choose('Raum', classroom.id)

    expect(choice('Geschoss').value).toBe(upstairs.id)

    choose('Gebäude', gym.id)

    expect([choice('Geschoss').value, choice('Raum').value]).toEqual(['', ''])
    expect(offered('Raum')).toEqual(['Kein Raum', 'Halle'])
  })

  it('sends what was filled in to the building, with the values of its kind, and opens the file', async () => {
    const router = await mount('/anlagen/neu')

    await untilTheKindsAreThere()
    answerToWrite = answering({ id: 'a-new' }, 201)

    choose('Anlagenart', 'probe.elevator')
    choose('Gebäude', house.id)
    choose('Raum', boilerRoom.id)
    type('Bezeichnung', ' Aufzug Mensa ')
    type('Kennzeichen', '')
    type('Hersteller', 'Beispiel Aufzüge')
    type('Typ', 'BA 630')
    type('Baujahr', '2014')
    type('In Betrieb seit', '2014-09-03')
    choose('Feuerwehraufzug', 'false')
    type('Haltestellen', '4')
    press('Anlage anlegen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/buildings/b-house/assets',
        body: {
          kind: 'probe.elevator',
          name: ' Aufzug Mensa ',
          mark: '',
          manufacturer: 'Beispiel Aufzüge',
          model: 'BA 630',
          serialNumber: '',
          yearBuilt: 2014,
          commissionedOn: '2014-09-03',
          warrantyEndsOn: null,
          values: { firefighters_lift: false, stops: 4 },
          meterNumber: null,
          meterUnit: null,
          roomId: boilerRoom.id,
        },
      },
    ])
  })

  it('says at the field what the model finds wrong, and sends nothing', async () => {
    await mount('/anlagen/neu')
    await untilTheKindsAreThere()

    choose('Anlagenart', 'probe.elevator')
    type('Baujahr', '1492')
    type('Haltestellen', 'viele')
    press('Anlage anlegen')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Bitte prüfen Sie die markierten Felder.',
    )
    expect(screen.getByText('Die Bezeichnung fehlt.')).toBeTruthy()
    expect(screen.getByText('Das Gebäude fehlt.')).toBeTruthy()
    expect(screen.getByText('Das Baujahr ist eine ganze Zahl von 1800 bis 2100.')).toBeTruthy()
    expect(screen.getByText('Haltestellen ist eine Zahl.')).toBeTruthy()
    expect(written).toEqual([])

    // Without a kind the form says that first.
    choose('Anlagenart', '')
    press('Anlage anlegen')

    expect(await screen.findByText('Die Anlagenart fehlt.')).toBeTruthy()
    expect(written).toEqual([])
  })

  it('shows what the server refuses with, and stays', async () => {
    const router = await mount('/anlagen/neu?gebaeude=b-house')

    await untilTheKindsAreThere()
    answerToWrite = answering({ message: 'Dieses Gebäude gibt es nicht oder nicht mehr.' }, 404)

    choose('Anlagenart', 'probe.pump')
    type('Bezeichnung', 'Pumpe')
    press('Anlage anlegen')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Dieses Gebäude gibt es nicht oder nicht mehr.',
    )
    expect(router.state.location.pathname).toBe('/anlagen/neu')
  })

  it('is written with a connection, and says so without one', async () => {
    await mount('/anlagen/neu?gebaeude=b-house')
    await untilTheKindsAreThere()

    const words =
      'Angelegt und geändert wird eine Anlage im Büro mit Verbindung. Gerade ist keine da.'

    expect(screen.queryByText(words)).toBeNull()

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(words)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Anlage anlegen' }).disabled).toBe(
      true,
    )
  })

  it('stands for nobody who may not take assets into the register', async () => {
    const technician = memberIn('technician')

    await mount('/anlagen/neu', {
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'asset.record') },
      ],
    })

    expect(
      await screen.findByText('Anlagen anlegen und ändern darf dieser Zugang nicht.'),
    ).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Anlagenart' })).toBeNull()
  })
})

describe('a possible duplicate', () => {
  const asked = duplicatesOf('serialNumber=SN-4711')

  async function filledIn(answers: Readonly<Record<string, unknown>>) {
    const router = await mount('/anlagen/neu?gebaeude=b-house', answers)

    await untilTheKindsAreThere()
    choose('Anlagenart', 'probe.pump')
    type('Bezeichnung', 'Pumpe')

    return router
  }

  it('is named once the field is left: at the field, and with where the other asset stands', async () => {
    await filledIn({ [asked]: [twin] })

    const field = type('Seriennummer', ' SN-4711 ')

    expect(screen.queryByRole('group', { name: 'Mögliche Dublette' })).toBeNull()

    fireEvent.blur(field)

    const found = within(await screen.findByRole('group', { name: 'Mögliche Dublette' }))

    expect(found.getByText(/Gleiche Seriennummer wie/).textContent?.replaceAll(/\s+/g, ' ')).toBe(
      'Gleiche Seriennummer wie AN-00057 Aufzug Sporthalle, Sporthalle, Halle.',
    )
    expect(
      found.getByRole('link', { name: 'AN-00057 Aufzug Sporthalle' }).getAttribute('href'),
    ).toBe('/anlagen/a-twin')
    expect(
      found.getByText('Ist es dieselbe Anlage, öffnen Sie diese, statt eine zweite anzulegen.'),
    ).toBeTruthy()
    expect(
      screen.getByText('Diese Seriennummer trägt schon AN-00057 Aufzug Sporthalle, Sporthalle.'),
    ).toBeTruthy()
    expect(screen.queryByText(/Dieses Kennzeichen trägt schon/)).toBeNull()
  })

  it('keeps the asset from being made until somebody says it is another one', async () => {
    const router = await filledIn({ [asked]: [twin] })

    answerToWrite = answering({ id: 'a-new' }, 201)
    // The field is never left: saving asks all the same.
    type('Seriennummer', 'SN-4711')
    press('Anlage anlegen')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Eine Anlage mit diesen Angaben gibt es schon. Entscheiden Sie oben, ob es dieselbe ist.',
    )
    expect(await screen.findByRole('group', { name: 'Mögliche Dublette' })).toBeTruthy()
    expect(written).toEqual([])

    // Asked again, the answer is the same: the question is not a decision.
    press('Anlage anlegen')
    await screen.findByRole('alert')

    expect(written).toEqual([])

    press('Trotzdem anlegen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-new')
    })
    expect(written.map((write) => [write.method, write.path])).toEqual([
      ['POST', '/buildings/b-house/assets'],
    ])
    expect(written[0]?.body).toMatchObject({ serialNumber: 'SN-4711' })
  })

  it('leads to the asset that is there', async () => {
    const router = await filledIn({ [asked]: [twin] })

    fireEvent.blur(type('Seriennummer', 'SN-4711'))
    await screen.findByRole('group', { name: 'Mögliche Dublette' })
    press('Zur vorhandenen Anlage')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-twin')
    })
    expect(written).toEqual([])
  })

  it('is asked about with the serial number and the mark, and is none where the server names none', async () => {
    const router = await filledIn({
      [duplicatesOf('serialNumber=SN-1&mark=K+7')]: [],
    })

    answerToWrite = answering({ id: 'a-new' }, 201)
    type('Seriennummer', 'SN-1')
    type('Kennzeichen', 'K 7')
    press('Anlage anlegen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-new')
    })
    expect(screen.queryByRole('group', { name: 'Mögliche Dublette' })).toBeNull()
  })

  it('is not asked about for an asset without a serial number and without a mark', async () => {
    const router = await filledIn({})
    const reads = watchingReads()

    answerToWrite = answering({ id: 'a-new' }, 201)
    press('Anlage anlegen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-new')
    })
    expect(reads.filter((path) => path.startsWith('/assets/duplicates'))).toEqual([])
  })

  it('stops the form where the question cannot be answered', async () => {
    // No answer for the question: the server of this test says 404.
    await filledIn({})

    type('Seriennummer', 'SN-4711')
    press('Anlage anlegen')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ob es die Anlage schon gibt, ließ sich nicht prüfen. Das beantwortet der Server, mit Verbindung.',
    )
    expect(written).toEqual([])
  })
})

describe('a new component', () => {
  const at = '/anlagen/a-lift/komponenten/neu'

  it('is made under its asset, in the building of the asset and in a room of it', async () => {
    const router = await mount(at, { '/assets/a-lift': file() })

    await screen.findByRole('heading', { level: 1, name: 'Neue Komponente' })
    await untilTheKindsAreThere()
    answerToWrite = answering({ id: 'a-part' }, 201)

    expect(screen.queryByRole('combobox', { name: 'Gebäude' })).toBeNull()
    expect(
      screen.getByText(
        'Komponente von AN-00012 Aufzug Schulhaus. Sie steht im Gebäude ihrer Anlage: Schulhaus.',
      ),
    ).toBeTruthy()
    expect(offered('Raum')).toEqual(['Kein Raum', '1.03 Klassenraum 5a', 'E.14 Heizraum'])

    choose('Anlagenart', 'probe.pump')
    choose('Raum', boilerRoom.id)
    type('Bezeichnung', 'Antrieb')
    press('Komponente anlegen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-part')
    })
    expect(written.map((write) => [write.method, write.path])).toEqual([
      ['POST', '/assets/a-lift/components'],
    ])
    expect(written[0]?.body).toMatchObject({
      kind: 'probe.pump',
      name: 'Antrieb',
      roomId: boilerRoom.id,
    })
  })
})

describe('the form of an asset that is there', () => {
  const at = '/anlagen/a-lift/bearbeiten'
  const itself = duplicatesOf('serialNumber=SN-4711&mark=A-1&except=a-lift')

  it('starts with what the asset holds and sends the whole of it to the asset, without its place', async () => {
    const router = await mount(at, { '/assets/a-lift': file(), [itself]: [] })

    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus bearbeiten' })
    await untilTheKindsAreThere()
    answerToWrite = answering({ id: 'a-lift' })

    expect(choice('Anlagenart').value).toBe('probe.elevator')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Seriennummer' }).value).toBe(
      'SN-4711',
    )
    expect(choice('Feuerwehraufzug').value).toBe('true')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Haltestellen' }).value).toBe('4')
    // Where it stands is said, and moved at its file.
    expect(screen.queryByRole('combobox', { name: 'Gebäude' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Raum' })).toBeNull()
    expect(
      screen.getByText(
        'Steht in E.14 Heizraum, Erdgeschoss, Schulhaus. Verlegt wird eine Anlage an ihrer Akte.',
      ),
    ).toBeTruthy()

    type('Typ', 'BA 630')
    type('Haltestellen', '')
    press('Speichern')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-lift')
    })
    expect(written).toEqual([
      {
        method: 'PATCH',
        path: '/assets/a-lift',
        body: {
          kind: 'probe.elevator',
          name: 'Aufzug Schulhaus',
          mark: 'A-1',
          manufacturer: 'Beispiel Aufzüge',
          model: 'BA 630',
          serialNumber: 'SN-4711',
          yearBuilt: 2012,
          commissionedOn: '2012-09-03',
          warrantyEndsOn: null,
          values: { firefighters_lift: true },
          meterNumber: null,
          meterUnit: null,
        },
      },
    ])
  })

  it('leaves out what only the kind it had carried, once the kind is corrected', async () => {
    await mount(at, { '/assets/a-lift': file(), [itself]: [] })
    await untilTheKindsAreThere()
    answerToWrite = answering({ id: 'a-lift' })

    choose('Anlagenart', 'probe.pump')
    press('Speichern')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toMatchObject({ kind: 'probe.pump', values: {} })
  })

  it('asks again only about what was changed, and never names the asset itself', async () => {
    const router = await mount(at, {
      '/assets/a-lift': file(),
      [itself]: [twin],
      [duplicatesOf('serialNumber=SN-9&mark=A-1&except=a-lift')]: [twin],
    })

    await untilTheKindsAreThere()
    answerToWrite = answering({ id: 'a-lift' })

    // It shares its serial number already, which the form says and no more.
    const found = within(await screen.findByRole('group', { name: 'Mögliche Dublette' }))

    expect(
      found.getByText('Ist es dieselbe Anlage, steht sie zweimal im Verzeichnis.'),
    ).toBeTruthy()

    type('Seriennummer', 'SN-9')
    press('Speichern')

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Eine Anlage mit diesen Angaben gibt es schon. Entscheiden Sie oben, ob es dieselbe ist.',
    )
    expect(written).toEqual([])

    type('Seriennummer', 'SN-4711')
    press('Speichern')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-lift')
    })
    expect(written.map((write) => write.method)).toEqual(['PATCH'])
  })

  it('offers removing the asset only to whoever keeps the assets, with a question first', async () => {
    await mount(at, { '/assets/a-lift': file(), [itself]: [] })
    await untilTheKindsAreThere()

    expect(screen.queryByRole('button', { name: 'Anlage entfernen' })).toBeNull()
  })

  it('removes the asset at its route and leads back to the register', async () => {
    const router = await mount(at, { '/assets/a-lift': file(), [itself]: [] }, 'site_management')

    await untilTheKindsAreThere()
    answerToWrite = answering({ id: 'a-lift' })

    press('Anlage entfernen')

    const question = within(await screen.findByRole('alertdialog'))

    expect(question.getByText('„Aufzug Schulhaus“ entfernen?')).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.click(question.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen')
    })
    expect(written).toEqual([{ method: 'DELETE', path: '/assets/a-lift', body: undefined }])
  })
})

describe('what is changed at the file of an asset', () => {
  const at = '/anlagen/a-lift'
  const answers = { '/assets/a-lift': file(), '/assets/a-lift/duties': [] }

  async function opened(role: RoleKey) {
    const router = await mount(at, answers, role)

    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    return router
  }

  const buttons = () =>
    screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)

  it('offers whoever only takes stock the form, a component and the supplies, and nothing beyond', async () => {
    await opened('technician')

    expect(buttons()).toEqual(
      expect.arrayContaining([
        'Bearbeiten',
        'Stammdaten bearbeiten',
        'Versorgung ändern',
        'Komponente hinzufügen',
      ]),
    )
    expect(screen.queryByRole('button', { name: 'Verlegen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eintragen' })).toBeNull()
    expect(screen.queryByRole('button', { name: /zurücknehmen/ })).toBeNull()
  })

  it('offers whoever keeps the assets moving it and its life cycle as well', async () => {
    await opened('site_management')

    expect(buttons()).toEqual(
      expect.arrayContaining([
        'Bearbeiten',
        'Versorgung ändern',
        'Komponente hinzufügen',
        'Verlegen',
        'Eintragen',
        'In Betrieb seit 03.09.2012 zurücknehmen',
      ]),
    )
  })

  it('offers nothing to change to somebody who only reads assets', async () => {
    const technician = memberIn('technician')

    await mount(at, {
      ...answers,
      '/auth/tenants': [
        { ...technician, rights: technician.rights.filter((right) => right !== 'asset.record') },
      ],
    })
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    for (const name of ['Bearbeiten', 'Versorgung ändern', 'Komponente hinzufügen', 'Verlegen']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('leads to the form of the asset and to the form of a component', async () => {
    const router = await opened('technician')

    press('Komponente hinzufügen')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-lift/komponenten/neu')
    })

    await router.navigate({ to: at })
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
    press('Bearbeiten')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/anlagen/a-lift/bearbeiten')
    })
  })

  it('moves the asset to another building of its property, and reads its file again', async () => {
    await opened('site_management')

    const reads = watchingReads()

    answerToWrite = answering({ id: 'a-lift' })
    press('Verlegen')

    const dialog = within(await screen.findByRole('dialog', { name: 'Aufzug Schulhaus verlegen' }))

    expect(
      dialog.getByText(
        'Eine Anlage bleibt auf ihrer Liegenschaft. Hier stehen die Gebäude von „Schulzentrum Am Lindenhain“.',
      ),
    ).toBeTruthy()
    expect(choice('Gebäude').value).toBe(house.id)
    expect(choice('Raum').value).toBe(boilerRoom.id)
    expect(dialog.getByText(/ziehen ihre Komponenten mit/)).toBeTruthy()

    choose('Gebäude', gym.id)

    expect(offered('Raum')).toEqual(['Kein Raum', 'Halle'])

    fireEvent.click(dialog.getByRole('button', { name: 'Verlegen' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      {
        method: 'PUT',
        path: '/assets/a-lift/location',
        body: { buildingId: gym.id, roomId: null },
      },
    ])
    await waitFor(() => {
      expect(reads).toEqual(expect.arrayContaining(['/assets/a-lift', '/assets/a-lift/duties']))
    })
  })

  it('shows what the server refuses a move with, and keeps the dialog open', async () => {
    await opened('site_management')

    answerToWrite = answering({ message: 'Der Raum liegt nicht in diesem Gebäude.' }, 400)
    press('Verlegen')

    const dialog = within(await screen.findByRole('dialog'))

    fireEvent.click(dialog.getByRole('button', { name: 'Verlegen' }))

    expect((await dialog.findByRole('alert')).textContent).toBe(
      'Der Raum liegt nicht in diesem Gebäude.',
    )
  })

  it('keeps what the asset supplies as one list, sent whole', async () => {
    await opened('technician')

    answerToWrite = answering([])
    press('Versorgung ändern')

    const dialog = within(
      await screen.findByRole('dialog', { name: 'Versorgungsbereich von Aufzug Schulhaus' }),
    )
    const supplied = () =>
      within(dialog.getByRole('list', { name: 'Versorgt' }))
        .getAllByRole('listitem')
        .map((item) => item.firstChild?.textContent)

    expect(supplied()).toEqual(['Schulhaus, ganzes Gebäude', 'Sporthalle, Erdgeschoss, Halle'])
    // What is supplied already is not offered a second time.
    expect(offered('Gebäude')).toEqual(['Sporthalle, ganzes Gebäude'])
    expect(offered('Raum')).toEqual([
      'Schulhaus, 1. Obergeschoss, 1.03 Klassenraum 5a',
      'Schulhaus, Erdgeschoss, E.14 Heizraum',
    ])

    fireEvent.click(dialog.getByRole('button', { name: 'Schulhaus, ganzes Gebäude entfernen' }))

    // What was taken out can be put back in, and stands among the choices again.
    expect(offered('Gebäude')).toEqual(['Schulhaus, ganzes Gebäude', 'Sporthalle, ganzes Gebäude'])

    choose('Gebäude', gym.id)
    fireEvent.click(dialog.getByRole('button', { name: 'Gebäude hinzufügen' }))
    choose('Raum', boilerRoom.id)
    fireEvent.click(dialog.getByRole('button', { name: 'Raum hinzufügen' }))

    expect(supplied()).toEqual([
      'Sporthalle, ganzes Gebäude',
      'Sporthalle, Erdgeschoss, Halle',
      'Schulhaus, Erdgeschoss, E.14 Heizraum',
    ])
    expect(written).toEqual([])

    fireEvent.click(dialog.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      {
        method: 'PUT',
        path: '/assets/a-lift/supplies',
        body: { buildingIds: [gym.id], roomIds: [gymHall.id, boilerRoom.id] },
      },
    ])
  })

  it('enters a state of the life cycle from a day on', async () => {
    await opened('site_management')

    answerToWrite = answering({ id: 'l-2' }, 201)
    press('Eintragen')

    const dialog = within(await screen.findByRole('dialog', { name: 'Lebenszyklus eintragen' }))

    // An asset that has run is taken out of service next, which rests its duties.
    expect(choice('Zustand').value).toBe('out_of_service')
    expect(dialog.getByText(/ruhen ihre Pflichten/)).toBeTruthy()

    choose('Zustand', 'decommissioned')
    type('Gilt ab', '2031-04-01')
    fireEvent.click(dialog.getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/assets/a-lift/lifecycle',
        body: { state: 'decommissioned', validFrom: '2031-04-01' },
      },
    ])
  })

  it('takes an entry of the life cycle back, with a question first', async () => {
    await opened('site_management')

    answerToWrite = answering({ id: 'l-1' })
    press('In Betrieb seit 03.09.2012 zurücknehmen')

    const question = within(await screen.findByRole('alertdialog'))

    expect(question.getByText('„In Betrieb ab 03.09.2012“ zurücknehmen?')).toBeTruthy()
    expect(written).toEqual([])

    fireEvent.click(question.getByRole('button', { name: 'Zurücknehmen' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    expect(written).toEqual([
      { method: 'DELETE', path: '/assets/a-lift/lifecycle/l-1', body: undefined },
    ])
  })
})

describe('"Neue Anlage"', () => {
  it('stands in the head of the register and of a building, and starts in the building', async () => {
    const router = await mount('/gebaeude/b-house')

    await screen.findByRole('heading', { level: 1, name: 'Schulhaus' })
    press('Neue Anlage')

    await waitFor(() => {
      expect(router.state.location.href).toBe('/anlagen/neu?gebaeude=b-house')
    })

    await router.navigate({ to: '/anlagen' })
    await screen.findByRole('heading', { level: 1, name: 'Anlagen' })
    press('Neue Anlage')

    await waitFor(() => {
      expect(router.state.location.href).toBe('/anlagen/neu')
    })
  })
})
