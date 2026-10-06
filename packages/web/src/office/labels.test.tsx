import {
  type AssetDetails,
  labelBatchMost,
  printedLabelCode,
  type RoleKey,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { labelOpens } from '../app/labels.js'
import { servingCatalogue } from '../app/test-catalogue.js'
import { memberIn } from '../app/test-entry.js'
import { registerRequest, registerSearch } from './asset-addresses.js'
import { officePlaces } from './place-addresses.js'
import {
  mountOffice,
  type NamedArea,
  onA,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from './test-office.js'

/**
 * The labels in the office (#98, board "Etikett: Karte und Druck"): the card
 * at an asset and at a room, the dialog that prints many labels, and the
 * address on a label, which leads on to what the label hangs on or says why
 * it opens nothing.
 *
 * The card itself is the foundation's and tested there. Held here is what
 * this application binds it to: which labels it shows, which routes it asks,
 * and whose right making and blocking takes.
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
const store = { ...boilerRoom, id: 'r-store', number: 'E.2', name: 'Lager', use: null }
const asset = (id: string, number: string, name: string) => ({
  id,
  ...place,
  buildingId: house.id,
  roomId: boilerRoom.id,
  parentAssetId: null,
  kind: 'probe.elevator',
  number,
  name,
})
const lift = asset('a-lift', 'AN-00012', 'Aufzug Schulhaus')
const heater = asset('a-heater', 'AN-00057', 'Trinkwassererwärmer')

const label = (
  id: string,
  code: string,
  hung: { readonly assetId?: string; readonly roomId?: string },
  blockedAt: string | null = null,
) => ({
  id,
  ...place,
  assetId: hung.assetId ?? null,
  roomId: hung.roomId ?? null,
  code,
  blockedAt,
  createdAt: '2026-09-12T09:00:00.000Z',
})

const onLift = label('l-lift', '3XQ7M2K9PDH4TA6W', { assetId: lift.id })
const onBoilerRoom = label('l-room', '7M2K9PDH4TA6W3XQ', { roomId: boilerRoom.id })
const lostOnHeater = label(
  'l-lost',
  'PDH4TA6W3XQ7M2K9',
  { assetId: heater.id },
  '2026-10-01T08:00:00.000Z',
)
const fromASheet = label('l-sheet', 'TA6W3XQ7M2K9PDH4', {})

const everything = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'asset_lifecycle',
  'asset_supplies',
  'activities',
  'attachments',
  'attachment_versions',
  'labels',
] as const

const fileOf = (of: typeof lift) =>
  ({
    ...of,
    mark: null,
    manufacturer: null,
    model: null,
    serialNumber: null,
    yearBuilt: null,
    commissionedOn: null,
    warrantyEndsOn: null,
    values: {},
    meterNumber: null,
    meterUnit: null,
    lifecycle: [],
    lifecycleState: null,
    condition: 'no_duties',
    until: null,
    supplies: [],
    components: [],
    parent: null,
  }) as unknown as AssetDetails

const entry = (of: typeof lift) => ({
  id: of.id,
  propertyId: of.propertyId,
  buildingId: of.buildingId,
  roomId: of.roomId,
  parentAssetId: null,
  kind: of.kind,
  number: of.number,
  name: of.name,
  lifecycleState: null,
  condition: 'no_duties',
  until: null,
})

const files = {
  [`/assets/${lift.id}`]: fileOf(lift),
  [`/assets/${lift.id}/duties`]: [],
  [`/assets/${heater.id}`]: fileOf(heater),
  [`/assets/${heater.id}/duties`]: [],
  [`/rooms/${boilerRoom.id}/duties`]: [],
  [`/rooms/${store.id}/duties`]: [],
}

let server: TestServer
let written: Written[]

async function mount(
  at: string,
  role: RoleKey = 'technician',
  lacking: readonly string[] = [],
  further: Readonly<Record<string, unknown>> = {},
  answerToWrite: (write: Written) => WriteAnswer = () => ({ status: 200, body: { id: 'l-new' } }),
) {
  const member = memberIn(role)

  globalThis.history.replaceState(null, '', at)
  written = signedInOffice(
    role,
    [sued],
    {
      '/auth/tenants': [
        { ...member, rights: member.rights.filter((right) => !lacking.includes(right)) },
      ],
      ...servingCatalogue(),
      ...files,
      ...further,
    },
    answerToWrite,
  )

  const mountedOffice = await mountOffice(at, server, everything)

  await untilTheRightsAreKnown()

  return mountedOffice
}

function card(name = 'Etikett'): HTMLElement {
  return screen.getByRole('region', { name })
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:etiketten' }))
  URL.revokeObjectURL = () => undefined
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  server.put('floors', ground)

  for (const room of [boilerRoom, store]) {
    server.put('rooms', room)
  }

  for (const each of [lift, heater]) {
    server.put('assets', each)
  }

  for (const each of [onLift, onBoilerRoom, lostOnHeater, fromASheet]) {
    server.put('labels', each)
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.history.replaceState(null, '', '/')
})

describe('the card of the label in the file of an asset', () => {
  const at = officePlaces.asset(lift.id)

  it('shows the valid label of this asset and prints it at the route of the asset', async () => {
    await mount(at)
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    const shown = within(card())

    expect(shown.getByText(printedLabelCode(onLift.code))).toBeDefined()
    expect(shown.queryByText(printedLabelCode(onBoilerRoom.code))).toBeNull()
    expect(shown.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).toBe(
      `/assets/${lift.id}/labels/${onLift.id}/pdf?format=roll&count=1`,
    )
  })

  it('names the label that was blocked last where there is no valid one, and makes a new one at the route of the asset', async () => {
    await mount(officePlaces.asset(heater.id))
    await screen.findByRole('heading', { level: 1, name: 'Trinkwassererwärmer' })

    const shown = within(card())

    expect(shown.getByText(/Das letzte ist gesperrt und öffnet nichts mehr/)).toBeDefined()
    expect(shown.getByText(printedLabelCode(lostOnHeater.code))).toBeDefined()

    fireEvent.click(shown.getByRole('button', { name: 'Neues Etikett anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        { method: 'POST', path: `/assets/${heater.id}/labels`, body: undefined },
      ])
    })
  })

  it('blocks the label at its route, once the question is answered', async () => {
    await mount(at)
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    fireEvent.click(within(card()).getByRole('button', { name: 'Sperren' }))

    const question = within(await screen.findByRole('alertdialog'))

    expect(
      question.getByText(new RegExp(`Das Etikett ${printedLabelCode(onLift.code)} öffnet danach`)),
    ).toBeDefined()
    expect(question.getByText(/ein neues Etikett legen Sie danach an/)).toBeDefined()
    expect(written).toEqual([])

    fireEvent.click(question.getByRole('button', { name: 'Sperren' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: `/assets/${lift.id}/labels/${onLift.id}/block`,
          body: undefined,
        },
      ])
    })
  })

  it('offers neither making nor blocking to somebody who may not take assets into the register', async () => {
    await mount(at, 'technician', ['asset.record'])
    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })

    expect(within(card()).getByRole('link', { name: 'PDF öffnen' })).toBeDefined()
    expect(within(card()).queryByRole('button', { name: 'Sperren' })).toBeNull()
  })

  it('offers no new label to somebody who may not take assets into the register', async () => {
    await mount(officePlaces.asset(heater.id), 'technician', ['asset.record'])
    await screen.findByRole('heading', { level: 1, name: 'Trinkwassererwärmer' })

    expect(within(card()).queryByRole('button', { name: /Etikett anlegen/ })).toBeNull()
  })
})

describe('the card of the label on the page of a room', () => {
  it('shows the label of the door of this room, and makes and blocks one with the right to record rooms', async () => {
    await mount(officePlaces.room(boilerRoom.id))
    await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum' })

    const shown = within(card('Etikett des Raums'))

    expect(shown.getByText(printedLabelCode(onBoilerRoom.code))).toBeDefined()
    // The label of the asset that stands in the room is the asset's.
    expect(shown.queryByText(printedLabelCode(onLift.code))).toBeNull()
    expect(shown.getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).toBe(
      `/rooms/${boilerRoom.id}/labels/${onBoilerRoom.id}/pdf?format=roll&count=1`,
    )
    expect(shown.getByRole('button', { name: 'Sperren' })).toBeDefined()
  })

  it('makes a label for a room that has none, at the route of the room', async () => {
    await mount(officePlaces.room(store.id))
    await screen.findByRole('heading', { level: 1, name: 'E.2 Lager' })

    fireEvent.click(
      within(card('Etikett des Raums')).getByRole('button', { name: 'Etikett anlegen' }),
    )

    await waitFor(() => {
      expect(written).toEqual([
        { method: 'POST', path: `/rooms/${store.id}/labels`, body: undefined },
      ])
    })
  })

  it('asks for the right to record rooms and not for the one to record assets', async () => {
    await mount(officePlaces.room(store.id), 'technician', ['room.record'])
    await screen.findByRole('heading', { level: 1, name: 'E.2 Lager' })

    expect(
      within(card('Etikett des Raums')).queryByRole('button', { name: 'Etikett anlegen' }),
    ).toBeNull()
  })
})

describe('the dialog that prints labels, at the register of assets', () => {
  const filter = { buildingId: house.id }
  const at = `/anlagen?${new URLSearchParams(
    Object.entries(registerSearch(filter)).map(([name, value]) => [name, String(value)]),
  ).toString()}`
  const listing = (total: number) => ({
    [registerRequest(filter, 0)]: {
      total,
      properties: 1,
      assets: [entry(lift), entry(heater)],
    },
  })

  async function dialog() {
    fireEvent.click(await screen.findByRole('button', { name: 'Etiketten drucken' }))

    return within(await screen.findByRole('dialog', { name: 'Etiketten drucken' }))
  }

  it('prints a label for every asset the list shows, under the filter the list is narrowed by', async () => {
    await mount(at, 'technician', [], listing(2))

    const shown = await dialog()

    expect(shown.getByRole<HTMLSelectElement>('combobox', { name: 'Gedruckt wird' }).value).toBe(
      'assets',
    )
    expect(shown.getByRole('option', { name: 'Die 2 gelisteten Anlagen' })).toBeDefined()

    fireEvent.change(shown.getByLabelText('Beginnen bei'), { target: { value: '5' } })
    fireEvent.click(shown.getByRole('button', { name: 'PDF erzeugen' }))

    const link = await shown.findByRole('link', { name: 'PDF öffnen' })

    expect(link.getAttribute('href')).toBe('blob:etiketten')
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/labels/print/assets',
        body: { filter, format: 'sheet', start: 5 },
      },
    ])
  })

  it('prints a sheet of labels that hang on nothing yet, for the property the list is narrowed to', async () => {
    await mount(at, 'technician', [], listing(2))

    const shown = await dialog()

    fireEvent.change(shown.getByRole('combobox', { name: 'Gedruckt wird' }), {
      target: { value: 'blank' },
    })

    expect(shown.getByRole<HTMLSelectElement>('combobox', { name: 'Liegenschaft' }).value).toBe(
      school.id,
    )

    fireEvent.change(shown.getByLabelText('Anzahl'), { target: { value: '48' } })
    fireEvent.change(shown.getByRole('combobox', { name: 'Format' }), {
      target: { value: 'roll' },
    })
    fireEvent.click(shown.getByRole('button', { name: 'PDF erzeugen' }))

    await shown.findByRole('link', { name: 'PDF öffnen' })

    expect(written).toEqual([
      {
        method: 'POST',
        path: '/labels/print/blank',
        body: { propertyId: school.id, count: 48, format: 'roll' },
      },
    ])
  })

  it('asks for nothing while a print could not be made: more labels than ten sheets hold, or a field a sheet has not', async () => {
    await mount(at, 'technician', [], listing(labelBatchMost + 1))

    const shown = await dialog()

    expect(shown.getByRole('alert').textContent).toBe(
      'Das sind 241 Etiketten. Gedruckt werden höchstens 240 auf einmal, grenzen Sie die Liste vorher ein.',
    )
    expect(shown.getByRole<HTMLButtonElement>('button', { name: 'PDF erzeugen' }).disabled).toBe(
      true,
    )

    fireEvent.change(shown.getByRole('combobox', { name: 'Gedruckt wird' }), {
      target: { value: 'blank' },
    })
    expect(shown.queryByRole('alert')).toBeNull()

    fireEvent.change(shown.getByLabelText('Beginnen bei'), { target: { value: '25' } })
    expect(shown.getByRole('alert').textContent).toBe('Ein Bogen hat die Felder 1 bis 24.')

    fireEvent.submit(shown.getByRole('button', { name: 'PDF erzeugen' }))
    expect(written).toEqual([])
  })

  it('says what the server refused a print with', async () => {
    await mount(at, 'technician', [], listing(2), () => ({
      status: 503,
      body: { message: 'Für diese Instanz ist kein Renderer eingerichtet.' },
    }))

    const shown = await dialog()

    fireEvent.click(shown.getByRole('button', { name: 'PDF erzeugen' }))

    expect((await shown.findByRole('alert')).textContent).toBe(
      'Für diese Instanz ist kein Renderer eingerichtet.',
    )
    expect(shown.queryByRole('link', { name: 'PDF öffnen' })).toBeNull()
  })

  it('is offered to nobody who may not take assets into the register: a print makes labels', async () => {
    await mount(at, 'technician', ['asset.record'], listing(2))
    await screen.findByRole('heading', { level: 1, name: 'Anlagen' })
    await screen.findByText('Aufzug Schulhaus')

    expect(screen.queryByRole('button', { name: 'Etiketten drucken' })).toBeNull()
  })
})

describe('the dialog that prints labels, at a building', () => {
  const at = officePlaces.building(house.id)

  async function dialog() {
    fireEvent.click(await screen.findByRole('button', { name: 'Etiketten drucken' }))

    return within(await screen.findByRole('dialog', { name: 'Etiketten drucken' }))
  }

  it('prints a label for every door of the building, or for every asset in it', async () => {
    await mount(at)

    const shown = await dialog()

    expect(shown.getByRole('option', { name: 'Die 2 Räume dieses Gebäudes' })).toBeDefined()
    expect(shown.getByRole('option', { name: 'Die 2 Anlagen dieses Gebäudes' })).toBeDefined()

    fireEvent.click(shown.getByRole('button', { name: 'PDF erzeugen' }))
    await shown.findByRole('link', { name: 'PDF öffnen' })

    fireEvent.change(shown.getByRole('combobox', { name: 'Gedruckt wird' }), {
      target: { value: 'assets' },
    })
    fireEvent.click(await shown.findByRole('button', { name: 'PDF erzeugen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/labels/print/rooms',
          body: { buildingId: house.id, format: 'sheet', start: 1 },
        },
        {
          method: 'POST',
          path: '/labels/print/assets',
          body: { filter: { buildingId: house.id }, format: 'sheet', start: 1 },
        },
      ])
    })
  })

  /**
   * The page of a building draws the button for everybody and leaves it to
   * the button whether it stands there: the register offers it beside "Neue
   * Anlage", which the same right decides, so only here does the button answer
   * for itself.
   */
  it('is offered to nobody who may not take assets into the register', async () => {
    await mount(at, 'technician', ['asset.record'])
    await screen.findByRole('heading', { level: 1, name: 'Schulhaus' })

    expect(screen.queryByRole('button', { name: 'Etiketten drucken' })).toBeNull()
  })

  it('offers the doors only to somebody who may take rooms into the register', async () => {
    await mount(at, 'technician', ['room.record'])

    const shown = await dialog()

    expect(shown.queryByRole('option', { name: /Räume dieses Gebäudes/ })).toBeNull()
    expect(shown.getByRole('option', { name: 'Die 2 Anlagen dieses Gebäudes' })).toBeDefined()
  })
})

describe('the address on a label', () => {
  const landing = (code: string) => `/a/${code}`

  it('leads to the same pages the office keeps for an asset and a room', () => {
    expect(labelOpens.asset('a-1')).toBe(officePlaces.asset('a-1'))
    expect(labelOpens.room('r-1')).toBe(officePlaces.room('r-1'))
  })

  it('opens the file of the asset a valid label hangs on, and the page of the room', async () => {
    const { router } = await mount(landing(onLift.code))

    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
    expect(router.state.location.pathname).toBe(officePlaces.asset(lift.id))
  })

  it('opens the page of the room a valid label hangs on', async () => {
    const { router } = await mount(landing(onBoilerRoom.code))

    await screen.findByRole('heading', { level: 1, name: 'E.14 Heizraum' })
    expect(router.state.location.pathname).toBe(officePlaces.room(boilerRoom.id))
  })

  /**
   * The third point of the acceptance of #98: a label printed while the
   * instance lived under another address opens its asset all the same. The
   * address the page is opened under names another host than the one on the
   * label; only the path counts, as written as leniently as a scanner reads.
   */
  it('reads the code from the path alone, whatever the host and however it is written', async () => {
    const { router } = await mount(landing('3xq7-m2k9-pdh4-ta6w'))

    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
    expect(router.state.location.pathname).toBe(officePlaces.asset(lift.id))
  })

  /**
   * The first point of the acceptance of #98: a blocked label opens nothing,
   * not for the Leitung either, and the page names nothing of the asset.
   */
  it.each(['management', 'technician'] as const)(
    'opens nothing for a blocked label, for the Leitung as for anybody: %s',
    async (role) => {
      const { router } = await mount(landing(lostOnHeater.code), role)

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Etikett gesperrt' }),
      ).toBeDefined()
      expect(
        screen.getByText(
          'Dieses Etikett ist gesperrt und öffnet nichts mehr. Ein neues gibt es im Büro.',
        ),
      ).toBeDefined()
      expect(document.body.textContent).not.toContain('Trinkwassererwärmer')
      expect(router.state.location.pathname).toBe(landing(lostOnHeater.code))
    },
  )

  it('says of a label from a sheet that it hangs on no asset yet', async () => {
    await mount(landing(fromASheet.code))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Noch keiner Anlage zugeordnet' }),
    ).toBeDefined()
  })

  const unheld = '0000000000000000'

  it.each([
    ['outside', 'Außerhalb Ihrer Bereiche'],
    ['unknown', 'Kein Etikett dieses Betreibers'],
    ['blocked', 'Etikett gesperrt'],
  ] as const)(
    'asks the server about a code the device does not hold, and says what it answers without naming anything: %s',
    async (standing, title) => {
      const { router } = await mount(landing(unheld), 'technician', [], {
        [`/labels/${unheld}`]: { standing },
      })

      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeDefined()
      expect(router.state.location.pathname).toBe(landing(unheld))
    },
  )

  it('fetches a label the server calls open and opens what it hangs on', async () => {
    const fresh = label('l-fresh', unheld, { assetId: lift.id })
    const mountedOffice = mount(landing(unheld), 'technician', [], {
      [`/labels/${unheld}`]: { standing: 'open' },
    })

    // Made in the office a moment ago: on the server, not on the device yet.
    server.put('labels', fresh)

    const { router } = await mountedOffice

    await screen.findByRole('heading', { level: 1, name: 'Aufzug Schulhaus' })
    expect(router.state.location.pathname).toBe(officePlaces.asset(lift.id))
  })

  it('says that the device does not hold the label when the server cannot be asked', async () => {
    await mount(landing(unheld))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Nicht auf diesem Gerät' }),
    ).toBeDefined()
  })

  it('says of an address with no code in it that it is no label', async () => {
    await mount(landing('kein-etikett'))

    expect(await screen.findByRole('heading', { level: 1, name: 'Kein Etikett' })).toBeDefined()
  })
})
