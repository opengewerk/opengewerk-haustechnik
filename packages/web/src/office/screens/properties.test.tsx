import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberIn, mountedWithItsDevice, tenantName } from '../../app/test-entry.js'
import type { SyncClient } from '../../sync/client.js'
import { officeApplication } from '../application.js'
import { officeRoutes } from '../router.js'

/**
 * The properties in the office (#85): the list with the buildings under each
 * property, the page of one, and the form a property is made, changed and
 * removed with. The device holds properties and buildings and reads them
 * without a network; what is written goes to the routes of the server, and
 * the areas are asked of it.
 */

const nord = { id: 'a-nord', name: 'Nord' }
const sued = { id: 'a-sued', name: 'Süd' }

const school = {
  id: 'p-school',
  areaId: sued.id,
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: 'Zufahrt über den Hof.\nSchlüssel beim Hausmeister.',
}
const yard = {
  id: 'p-yard',
  areaId: nord.id,
  name: 'Werkhof Nord',
  street: 'Lagerweg 12',
  postalCode: '00002',
  city: 'Beispielstadt',
  federalState: 'DE-BW',
  note: null,
}
const office = {
  id: 'p-office',
  areaId: nord.id,
  name: 'Ämter Am Probehang',
  street: 'Am Probehang 4',
  postalCode: '00001',
  city: 'Beispielstadt',
  federalState: 'DE-HE',
  note: null,
}

// The kinds of a building reach a device as the text of a list.
const schoolHouse = {
  id: 'b-house',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Schulhaus',
  kinds: '["school"]',
  yearBuilt: 1975,
}
const gym = {
  id: 'b-gym',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Sporthalle',
  kinds: '["school","assembly"]',
  yearBuilt: null,
}
const hall = {
  id: 'b-hall',
  propertyId: yard.id,
  areaId: nord.id,
  name: 'Halle 1',
  kinds: '["commercial"]',
  yearBuilt: 2009,
}

interface Written {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let server: TestServer
let answers: Map<string, unknown>
/** What was written to a route, in order. */
let written: Written[]
/** What a route answers a write with; a new property by default. */
let answerToWrite: (write: Written) => { readonly status: number; readonly body: unknown }

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Somebody signed in in one of the roles a tenant starts with, who sees these areas. */
function signedIn(role: RoleKey, areas: readonly { id: string; name: string }[] = [nord, sued]) {
  answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'person@nord.example.de', name: 'Pia Person' },
        session: { activeTenantId: 't-nord' },
      },
    ],
    ['/auth/tenants', [memberIn(role)]],
    ['/areas', areas],
  ])
}

/** The device of the test that is running, for one that has it exchange again. */
let device: SyncClient

async function mount(at: string) {
  const { router, client } = await mountedWithItsDevice({
    routeTree: officeRoutes(),
    at,
    application: officeApplication,
    server,
    entities: ['properties', 'buildings'],
  })

  device = client

  return router
}

/** The rights have arrived once the tenant stands in the header: both come with the same answer. */
async function untilTheRightsAreKnown(): Promise<void> {
  await within(screen.getByRole('banner')).findByText(tenantName)
}

/** The rows of a table as a reader meets them, cell by cell. */
function rowsOf(name: string): string[][] {
  return within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    )
}

type Device = 'phone' | 'tablet' | 'desktop'

/**
 * A window of this band: below 600 pixels a phone, below 1024 a tablet, and
 * a desktop from there. Hands back the way to another band while the screen
 * stands, as a tablet turned on its side takes it.
 */
function onA(device: Device): (next: Device) => void {
  let now = device
  const listeners = new Set<() => void>()
  const from600 = '(min-width: 37.5rem)'
  const from1024 = '(min-width: 64rem)'

  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return (now !== 'phone' && query === from600) || (now === 'desktop' && query === from1024)
    },
    media: query,
    addEventListener: (_event: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_event: string, listener: () => void) => {
      listeners.delete(listener)
    },
  }))

  return (next) => {
    now = next
    act(() => {
      for (const listener of listeners) {
        listener()
      }
    })
  }
}

/**
 * What only stands once the areas have arrived does not arrive: asked for
 * long enough that it would have. Nothing on the screen says that they are
 * there when they change nothing.
 */
async function staysAway(found: Promise<unknown>): Promise<void> {
  await expect(found).rejects.toThrow()
}

const soon = { timeout: 250 }

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  written = []
  answerToWrite = (write) => {
    const made = { ...(write.body as object), id: 'p-new', note: null }

    server.put('properties', made)

    return { status: 201, body: made }
  }

  for (const property of [school, yard, office]) {
    server.put('properties', property)
  }

  // Not in the order of their names, so that the screens have to order them.
  for (const building of [gym, hall, schoolHouse]) {
    server.put('buildings', building)
  }

  signedIn('management')
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (method === 'GET') {
      return Promise.resolve(json(answers.get(path) ?? {}, answers.has(path) ? 200 : 404))
    }

    const write = {
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }

    written.push(write)

    const answer = answerToWrite(write)

    return Promise.resolve(json(answer.body, answer.status))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  // One manager for every test of the file: a test that took the network
  // away would leave the questions of all that follow waiting for one.
  onlineManager.setOnline(true)
})

describe('the list of the properties', () => {
  it('has every property by its name with where it is, and its buildings under it', async () => {
    await mount('/liegenschaften')
    await screen.findByRole('group', { name: 'Bereich' })

    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toEqual([
      ['Ämter Am ProbehangAm Probehang 4, 00001 Beispielstadt', 'Nord'],
      ['Schulzentrum Am LindenhainAm Lindenhain 7, 00003 Musterhausen', 'Süd'],
      ['Gebäude: Schulhaus', ''],
      ['Gebäude: Sporthalle', ''],
      ['Werkhof NordLagerweg 12, 00002 Beispielstadt', 'Nord'],
      ['Gebäude: Halle 1', ''],
    ])
    // The head counts what the device holds, the foot what the table shows.
    expect(screen.getAllByText('3 Liegenschaften, 3 Gebäude')).toHaveLength(3)
    expect(
      screen.getByRole('link', { name: 'Schulzentrum Am Lindenhain' }).getAttribute('href'),
    ).toBe('/liegenschaften/p-school')
    // Below 1024 pixels only: the header has the search there is at this width.
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('counts one property as one', async () => {
    server = new TestServer()
    server.put('properties', yard)
    server.put('buildings', hall)
    await mount('/liegenschaften')

    expect(screen.getAllByText('1 Liegenschaft, 1 Gebäude').length).toBeGreaterThan(0)
  })

  it('is narrowed to an area by whoever sees more than one', async () => {
    const user = userEvent.setup()

    await mount('/liegenschaften')

    const chips = await screen.findByRole('group', { name: 'Bereich' })

    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => [chip.textContent, chip.getAttribute('aria-pressed')]),
    ).toEqual([
      ['Alle Bereiche', 'true'],
      ['Nord', 'false'],
      ['Süd', 'false'],
    ])

    await user.click(within(chips).getByRole('button', { name: 'Süd' }))

    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toEqual([
      ['Schulzentrum Am LindenhainAm Lindenhain 7, 00003 Musterhausen', 'Süd'],
      ['Gebäude: Schulhaus', ''],
      ['Gebäude: Sporthalle', ''],
    ])
    // What is left is said, and the head goes on counting all there is.
    expect(screen.getByRole('status').textContent).toBe('1 Liegenschaft, 2 Gebäude von 3')
    expect(screen.getByText('3 Liegenschaften, 3 Gebäude')).toBeTruthy()

    await user.click(within(chips).getByRole('button', { name: 'Alle Bereiche' }))

    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toHaveLength(6)
  })

  it('says nothing about areas to somebody who sees one', async () => {
    signedIn('technician', [nord])
    await mount('/liegenschaften')
    await untilTheRightsAreKnown()
    await staysAway(screen.findByRole('group', { name: 'Bereich' }, soon))

    expect(screen.queryByRole('columnheader', { name: 'Bereich' })).toBeNull()
    expect(rowsOf('Liegenschaften mit ihren Gebäuden')[0]).toEqual([
      'Ämter Am ProbehangAm Probehang 4, 00001 Beispielstadt',
    ])
  })

  it('offers a new property to whoever keeps the places', async () => {
    const user = userEvent.setup()
    const router = await mount('/liegenschaften')

    await user.click(await screen.findByRole('button', { name: 'Neue Liegenschaft' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften/neu')
    })
  })

  it('offers none to whoever only reads them', async () => {
    signedIn('technician')
    await mount('/liegenschaften')
    await untilTheRightsAreKnown()
    await screen.findByRole('group', { name: 'Bereich' })

    expect(screen.queryByRole('button', { name: 'Neue Liegenschaft' })).toBeNull()
  })

  it('is a card per property on a phone, with where it is, its area and how many buildings', async () => {
    onA('phone')
    await mount('/liegenschaften')
    await screen.findByRole('group', { name: 'Bereich' })

    expect(screen.queryByRole('table')).toBeNull()
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Ämter Am ProbehangBeispielstadt · Bereich Nord · 0 Gebäude', '/liegenschaften/p-office'],
      [
        'Schulzentrum Am LindenhainMusterhausen · Bereich Süd · 2 Gebäude',
        '/liegenschaften/p-school',
      ],
      ['Werkhof NordBeispielstadt · Bereich Nord · 1 Gebäude', '/liegenschaften/p-yard'],
    ])
  })

  it('names no area on a card to somebody who sees one', async () => {
    onA('phone')
    signedIn('technician', [nord])
    await mount('/liegenschaften')
    await untilTheRightsAreKnown()
    await staysAway(screen.findByText(/Bereich Nord/, {}, soon))

    expect(
      within(screen.getByRole('main'))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toContain('Werkhof NordBeispielstadt · 1 Gebäude')
  })

  it('narrows by what was typed only while the field stands', async () => {
    const user = userEvent.setup()
    const turnTo = onA('tablet')

    await mount('/liegenschaften')
    await user.type(screen.getByRole('searchbox'), 'sporth')

    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toHaveLength(3)

    // Turned on its side the tablet is 1024 pixels wide: the header has the
    // search there, and a field nobody sees narrows nothing.
    turnTo('desktop')

    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toHaveLength(6)

    turnTo('tablet')

    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('sporth')
    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toHaveLength(3)
  })

  it('has a search of its own below 1024 pixels, through names, places and buildings', async () => {
    const user = userEvent.setup()

    onA('tablet')
    await mount('/liegenschaften')

    const search = screen.getByRole('searchbox', { name: 'Liegenschaften durchsuchen' })

    await user.type(search, 'sporth')

    expect(rowsOf('Liegenschaften mit ihren Gebäuden').map((row) => row[0])).toEqual([
      'Schulzentrum Am LindenhainAm Lindenhain 7, 00003 Musterhausen',
      'Gebäude: Schulhaus',
      'Gebäude: Sporthalle',
    ])

    await user.clear(search)
    // Capitals and the spaces a thumb leaves around a word are not minded.
    await user.type(search, ' WERKHOF ')

    expect(rowsOf('Liegenschaften mit ihren Gebäuden').map((row) => row[0])).toEqual([
      'Werkhof NordLagerweg 12, 00002 Beispielstadt',
      'Gebäude: Halle 1',
    ])

    await user.clear(search)
    await user.type(search, '00002')

    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toHaveLength(2)

    await user.clear(search)
    await user.type(search, 'Rathaus')

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Für „Rathaus“ gibt es keinen Treffer.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('0 Liegenschaften, 0 Gebäude von 3')
  })

  it('says of an area without a property that there is none in it', async () => {
    const user = userEvent.setup()

    signedIn('management', [nord, sued, { id: 'a-west', name: 'West' }])
    await mount('/liegenschaften')
    await user.click(await screen.findByRole('button', { name: 'West' }))

    expect(screen.getByText('In diesem Bereich steht keine Liegenschaft.')).toBeTruthy()
  })

  it('shows everything again once the area that was pressed is gone', async () => {
    const user = userEvent.setup()

    signedIn('management', [nord, sued, { id: 'a-west', name: 'West' }])
    await mount('/liegenschaften')
    await user.click(await screen.findByRole('button', { name: 'West' }))

    expect(screen.queryByRole('table')).toBeNull()

    // Somebody removed the area meanwhile; the next look at the window asks again.
    answers.set('/areas', [nord, sued])
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'West' })).toBeNull()
    })
    expect(rowsOf('Liegenschaften mit ihren Gebäuden')).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Alle Bereiche' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('says before the first property what one is, and offers the first', async () => {
    server = new TestServer()
    await mount('/liegenschaften')

    expect(
      await screen.findByRole('heading', { name: 'Noch keine Liegenschaft angelegt' }),
    ).toBeTruthy()
    expect(screen.getByText('0 Liegenschaften, 0 Gebäude')).toBeTruthy()
    expect(await screen.findAllByRole('button', { name: 'Neue Liegenschaft' })).toHaveLength(2)
  })

  it('tells somebody who holds in no area that this is why there is nothing', async () => {
    server = new TestServer()
    signedIn('technician', [])
    await mount('/liegenschaften')

    expect(
      await screen.findByRole('heading', { name: 'Kein Bereich für diesen Zugang' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Noch keine Liegenschaft angelegt' })).toBeNull()
  })

  it('is lit in the navigation, on the page of a property as well', async () => {
    const router = await mount('/liegenschaften')
    const place = () =>
      within(screen.getByRole('navigation', { name: 'Hauptbereiche' })).findByRole('link', {
        name: 'Liegenschaften',
      })

    expect((await place()).getAttribute('aria-current')).toBe('page')

    await router.navigate({ to: '/liegenschaften/p-school' })
    await screen.findByRole('heading', { level: 1, name: 'Schulzentrum Am Lindenhain' })

    expect((await place()).getAttribute('aria-current')).toBe('page')
  })
})

/** The facts of a card, as a reader meets them: what each is called and what it says. */
function factsOf(card: HTMLElement): Record<string, string | null> {
  const names = [...card.querySelectorAll('dt')].map((name) => name.textContent)
  const values = [...card.querySelectorAll('dd')].map((value) => value.textContent)

  return Object.fromEntries(names.map((name, index) => [name, values[index] ?? null]))
}

describe('the page of a property', () => {
  it('says where it is and what there is to know before going there', async () => {
    await mount('/liegenschaften/p-school')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Schulzentrum Am Lindenhain' }),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((step) => [step.textContent, step.getAttribute('href')]),
    ).toEqual([['Liegenschaften', '/liegenschaften']])

    const address = screen.getByRole('region', { name: 'Anschrift' })

    expect(factsOf(address)).toEqual({
      Straße: 'Am Lindenhain 7',
      Ort: '00003 Musterhausen',
      Bundesland: 'Baden-Württemberg',
      Land: 'Deutschland',
      Notiz: 'Zufahrt über den Hof.\nSchlüssel beim Hausmeister.',
    })
    // The lines of the note stay lines.
    expect(within(address).getByText(/Zufahrt über den Hof/).className).toContain(
      'whitespace-pre-line',
    )
  })

  it('leaves the note out where there is none', async () => {
    await mount('/liegenschaften/p-office')

    expect(factsOf(screen.getByRole('region', { name: 'Anschrift' }))).toEqual({
      Straße: 'Am Probehang 4',
      Ort: '00001 Beispielstadt',
      Bundesland: 'Hessen',
      Land: 'Deutschland',
    })
  })

  it('has its buildings by name, with what each is used as and when it was built', async () => {
    await mount('/liegenschaften/p-school')

    expect(rowsOf('Gebäude der Liegenschaft')).toEqual([
      ['SchulhausSchule oder Hochschule', '1975'],
      ['SporthalleSchule oder Hochschule, Versammlungs- oder Sportstätte', ''],
    ])
  })

  it('has a box per building on a phone, and the way back to the list in place of the path', async () => {
    onA('phone')
    await mount('/liegenschaften/p-school')

    expect(screen.queryByRole('table')).toBeNull()
    expect(
      within(screen.getByRole('list', { name: 'Gebäude der Liegenschaft' }))
        .getAllByRole('listitem')
        .map((box) => box.textContent),
    ).toEqual([
      'SchulhausSchule oder Hochschule1975',
      'SporthalleSchule oder Hochschule, Versammlungs- oder Sportstätte',
    ])
    expect(
      screen
        .getAllByRole('link', { name: 'Liegenschaften' })
        .some((link) => link.className.includes('sm:hidden')),
    ).toBe(true)
  })

  it('says so where no building stands on it yet', async () => {
    await mount('/liegenschaften/p-office')

    expect(
      within(screen.getByRole('region', { name: 'Gebäude' })).getByText(
        'An dieser Liegenschaft steht noch kein Gebäude.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('names its area beside its name for whoever sees more than one', async () => {
    await mount('/liegenschaften/p-school')

    expect(await screen.findByText('Bereich Süd')).toBeTruthy()
  })

  it('names no area for whoever sees one', async () => {
    signedIn('technician', [sued])
    await mount('/liegenschaften/p-school')
    await untilTheRightsAreKnown()
    await staysAway(screen.findByText('Bereich Süd', {}, soon))
  })

  it('leads whoever keeps the places to the form, from the head and from the address', async () => {
    const user = userEvent.setup()
    const router = await mount('/liegenschaften/p-school')

    for (const which of [0, 1]) {
      await router.navigate({ to: '/liegenschaften/p-school' })

      const edits = await screen.findAllByRole('button', { name: 'Bearbeiten' })

      expect(edits).toHaveLength(2)

      await user.click(edits[which] as HTMLElement)
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/liegenschaften/p-school/bearbeiten')
      })
    }

    // The second of the two stands in the card of the address, from a tablet
    // on: on a phone it would stand right under the first.
    await router.navigate({ to: '/liegenschaften/p-school' })

    const inTheCard = within(await screen.findByRole('region', { name: 'Anschrift' })).getByRole(
      'button',
      { name: 'Bearbeiten' },
    )

    expect(inTheCard.parentElement?.className.split(' ')).toContain('max-sm:hidden')
  })

  it('leads the Leitung to the changes of this property', async () => {
    await mount('/liegenschaften/p-school')

    const changes = await screen.findByRole('link', { name: 'Änderungen' })

    expect(changes.getAttribute('href')).toBe(
      '/einstellungen/protokoll?art=properties&datensatz=p-school',
    )
  })

  it('offers whoever only reads neither the form nor the log', async () => {
    signedIn('technician')
    await mount('/liegenschaften/p-school')
    await untilTheRightsAreKnown()
    await screen.findByText('Bereich Süd')

    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Änderungen' })).toBeNull()
  })

  it('says so when the device holds no such property', async () => {
    await mount('/liegenschaften/p-gone')

    expect(screen.getByRole('heading', { level: 1, name: 'Nicht gefunden' })).toBeTruthy()
    expect(
      screen.getByText(
        'Diese Liegenschaft gibt es nicht mehr, sie liegt in einem Bereich, den dieser Zugang nicht sieht, oder dieses Gerät kennt sie noch nicht.',
      ),
    ).toBeTruthy()
  })
})

/** The options of a list of choices, as a reader meets them. */
function optionsOf(label: string): (string | null)[] {
  return within(screen.getByRole('combobox', { name: label }))
    .getAllByRole('option')
    .map((option) => option.textContent)
}

const takesAConnection =
  'Eine Liegenschaft wird mit Verbindung angelegt und geändert. Gerade ist keine da.'

describe('the form of a new property', () => {
  it('makes it at its route and opens it', async () => {
    const user = userEvent.setup()
    const router = await mount('/liegenschaften/neu')

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' Grundschule West ')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bereich' }), 'Süd')
    await user.type(
      screen.getByRole('textbox', { name: 'Straße und Hausnummer' }),
      ' Schulstraße 5 ',
    )
    await user.type(screen.getByRole('textbox', { name: 'Postleitzahl' }), ' 00004 ')
    await user.type(screen.getByRole('textbox', { name: 'Ort' }), ' Musterhausen ')
    await user.type(
      screen.getByRole('textbox', { name: 'Notiz' }),
      'Zufahrt über den Hof.{Enter}Schlüssel beim Hausmeister. ',
    )
    await user.click(screen.getByRole('button', { name: 'Liegenschaft anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften/p-new')
    })
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/properties',
        body: {
          name: 'Grundschule West',
          areaId: sued.id,
          street: 'Schulstraße 5',
          postalCode: '00004',
          city: 'Musterhausen',
          // Where most of the others lie.
          federalState: 'DE-BW',
          note: 'Zufahrt über den Hof.\nSchlüssel beim Hausmeister.',
        },
      },
    ])
    // The exchange that follows brought it down: its page stands.
    expect(await screen.findByRole('heading', { level: 1, name: 'Grundschule West' })).toBeTruthy()
  })

  it('marks every field that has to be filled in, and no other', async () => {
    await mount('/liegenschaften/neu')
    await screen.findByRole('textbox', { name: 'Name' })

    const starred = [...document.querySelectorAll('form label')]
      .filter((label) => label.parentElement?.textContent.includes('*'))
      .map((label) => label.textContent)

    expect(starred).toEqual([
      'Name',
      'Bereich',
      'Straße und Hausnummer',
      'Postleitzahl',
      'Ort',
      'Bundesland',
    ])
    expect([...document.querySelectorAll('form label')].map((label) => label.textContent)).toEqual([
      'Name',
      'Bereich',
      'Straße und Hausnummer',
      'Postleitzahl',
      'Ort',
      'Bundesland',
      'Land',
      'Notiz',
    ])
  })

  it('says under the note that a code does not belong into it', async () => {
    await mount('/liegenschaften/neu')

    const note = await screen.findByRole('textbox', { name: 'Notiz' })
    const said = document.getElementById(note.getAttribute('aria-describedby') ?? '')

    expect(said?.textContent).toBe(
      'Keine Codes oder Zugangsdaten: die Notiz liest jeder, der die Liegenschaft sieht.',
    )
    expect(note.getAttribute('placeholder')).toBe(
      'Zufahrt, Schlüssel beim Hausmeister, Besonderheiten',
    )
  })

  it('has the area chosen where the tenant has more than one', async () => {
    const user = userEvent.setup()

    await mount('/liegenschaften/neu')
    await screen.findByRole('textbox', { name: 'Name' })

    expect(optionsOf('Bereich')).toEqual(['Bitte wählen', 'Nord', 'Süd'])
    expect((screen.getByRole('combobox', { name: 'Bereich' }) as HTMLSelectElement).value).toBe('')

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Grundschule West')
    await user.type(screen.getByRole('textbox', { name: 'Straße und Hausnummer' }), 'Schulstraße 5')
    await user.type(screen.getByRole('textbox', { name: 'Postleitzahl' }), '00004')
    await user.type(screen.getByRole('textbox', { name: 'Ort' }), 'Musterhausen')
    // Past what a browser holds back itself, the form holds it back.
    document.querySelector('form')?.setAttribute('novalidate', '')
    await user.click(screen.getByRole('button', { name: 'Liegenschaft anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Der Bereich fehlt.')
    expect(written).toEqual([])
  })

  it('asks for no area where the tenant has one, and sends none', async () => {
    const user = userEvent.setup()

    signedIn('management', [nord])
    await mount('/liegenschaften/neu')

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Grundschule West')

    expect(screen.queryByRole('combobox', { name: 'Bereich' })).toBeNull()

    await user.type(screen.getByRole('textbox', { name: 'Straße und Hausnummer' }), 'Schulstraße 5')
    await user.type(screen.getByRole('textbox', { name: 'Postleitzahl' }), '00004')
    await user.type(screen.getByRole('textbox', { name: 'Ort' }), 'Musterhausen')
    await user.click(screen.getByRole('button', { name: 'Liegenschaft anlegen' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(Object.keys(written[0]?.body as object)).toEqual([
      'name',
      'street',
      'postalCode',
      'city',
      'federalState',
      'note',
    ])
    expect((written[0]?.body as { note: unknown }).note).toBeNull()
  })

  it('starts in the state most of the properties lie in', async () => {
    await mount('/liegenschaften/neu')
    await screen.findByRole('textbox', { name: 'Name' })

    const state = screen.getByRole('combobox', { name: 'Bundesland' }) as HTMLSelectElement

    expect(state.value).toBe('DE-BW')
    expect(optionsOf('Bundesland')).toHaveLength(16)
    expect(optionsOf('Bundesland').slice(0, 3)).toEqual(['Baden-Württemberg', 'Bayern', 'Berlin'])
    // One answer, as the board draws it.
    expect(optionsOf('Land')).toEqual(['Deutschland'])
  })

  it('has the state chosen while the tenant has no property', async () => {
    const user = userEvent.setup()

    server = new TestServer()
    signedIn('management', [nord])
    await mount('/liegenschaften/neu')
    await screen.findByRole('textbox', { name: 'Name' })

    expect(optionsOf('Bundesland')[0]).toBe('Bitte wählen')
    expect((screen.getByRole('combobox', { name: 'Bundesland' }) as HTMLSelectElement).value).toBe(
      '',
    )

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Grundschule West')
    await user.type(screen.getByRole('textbox', { name: 'Straße und Hausnummer' }), 'Schulstraße 5')
    await user.type(screen.getByRole('textbox', { name: 'Postleitzahl' }), '00004')
    await user.type(screen.getByRole('textbox', { name: 'Ort' }), 'Musterhausen')
    document.querySelector('form')?.setAttribute('novalidate', '')
    await user.click(screen.getByRole('button', { name: 'Liegenschaft anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Das Bundesland fehlt.')
    expect(written).toEqual([])
  })

  it('goes on asking for the state when the properties arrive after the form stands', async () => {
    // A new device: its first exchange ends after the form is open.
    server = new TestServer()
    signedIn('management', [nord])
    await mount('/liegenschaften/neu')
    await screen.findByRole('textbox', { name: 'Name' })

    server.put('properties', yard)
    server.put('properties', office)
    server.put('properties', school)
    await act(async () => {
      await device.synchronise()
    })

    // The records are there, and what the list shows is still what the form
    // holds: nothing chosen yet.
    expect(device.list('properties')).toHaveLength(3)
    expect(optionsOf('Bundesland')[0]).toBe('Bitte wählen')
    expect((screen.getByRole('combobox', { name: 'Bundesland' }) as HTMLSelectElement).value).toBe(
      '',
    )
  })

  it('holds what the model refuses before anything is sent', async () => {
    const user = userEvent.setup()

    await mount('/liegenschaften/neu')

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Grundschule West')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bereich' }), 'Süd')
    await user.type(screen.getByRole('textbox', { name: 'Straße und Hausnummer' }), 'Schulstraße 5')
    await user.type(screen.getByRole('textbox', { name: 'Postleitzahl' }), '0004')
    await user.type(screen.getByRole('textbox', { name: 'Ort' }), 'Musterhausen')
    await user.click(screen.getByRole('button', { name: 'Liegenschaft anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Die Postleitzahl hat fünf Ziffern.',
    )
    expect(written).toEqual([])
  })

  it('shows the sentence of the server when it refuses, and keeps what was typed', async () => {
    const user = userEvent.setup()
    const router = await mount('/liegenschaften/neu')

    answerToWrite = () => ({
      status: 400,
      body: { message: 'Den Bereich gibt es bei diesem Betreiber nicht.' },
    })

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Grundschule West')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bereich' }), 'Süd')
    await user.type(screen.getByRole('textbox', { name: 'Straße und Hausnummer' }), 'Schulstraße 5')
    await user.type(screen.getByRole('textbox', { name: 'Postleitzahl' }), '00004')
    await user.type(screen.getByRole('textbox', { name: 'Ort' }), 'Musterhausen')
    await user.click(screen.getByRole('button', { name: 'Liegenschaft anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Den Bereich gibt es bei diesem Betreiber nicht.',
    )
    expect(router.state.location.pathname).toBe('/liegenschaften/neu')
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Grundschule West',
    )
  })

  it('says after the fields what comes next, and leads back without a word', async () => {
    const user = userEvent.setup()
    const router = await mount('/liegenschaften/neu')

    expect(
      await screen.findByText(
        'Gebäude, Geschosse und Räume legen Sie danach in der Liegenschaft an.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Liegenschaft entfernen' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften')
    })
    expect(written).toEqual([])
  })

  it('says that it takes a connection when the one there was is gone', async () => {
    await mount('/liegenschaften/neu')

    const save = (await screen.findByRole('button', {
      name: 'Liegenschaft anlegen',
    })) as HTMLButtonElement

    expect(save.disabled).toBe(false)
    expect(screen.queryByText(takesAConnection)).toBeNull()

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(takesAConnection)).toBeTruthy()
    expect(save.disabled).toBe(true)
  })

  it('says so at once when it is opened without one, and does not wait for the areas', async () => {
    // A screen that asks for no areas, so that the form is the first to.
    const router = await mount('/konflikte')

    await untilTheRightsAreKnown()
    onlineManager.setOnline(false)
    window.dispatchEvent(new Event('offline'))
    await router.navigate({ to: '/liegenschaften/neu' })

    expect(await screen.findByText(takesAConnection)).toBeTruthy()
    expect(screen.queryByText('Wird geladen.')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  it('says so when the areas did not arrive', async () => {
    answers.delete('/areas')
    await mount('/liegenschaften/neu')

    expect(
      await screen.findByText(
        'Die Bereiche kamen nicht an. Eine Liegenschaft wird mit Verbindung angelegt und geändert.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  it('is for whoever keeps the places', async () => {
    signedIn('technician')
    await mount('/liegenschaften/neu')
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Liegenschaften anlegen darf dieser Zugang nicht.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })
})

describe('the form of a property there is', () => {
  /** A server that takes a change at the route of a record, and says what it was sent. */
  function takingChanges() {
    const changes: { entity: string; id: string; values: unknown }[] = []

    server.patch = (entity, id, values) => {
      changes.push({ entity, id, values })
      server.put(entity, { ...server.row(entity, id), ...values })

      return Promise.resolve(server.row(entity, id))
    }

    return changes
  }

  it('starts with what the property holds', async () => {
    await mount('/liegenschaften/p-school/bearbeiten')

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Schulzentrum Am Lindenhain bearbeiten',
      }),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('navigation', { name: 'Pfad' }))
        .getAllByRole('link')
        .map((step) => [step.textContent, step.getAttribute('href')]),
    ).toEqual([
      ['Liegenschaften', '/liegenschaften'],
      ['Schulzentrum Am Lindenhain', '/liegenschaften/p-school'],
    ])

    await screen.findByRole('textbox', { name: 'Name' })

    const value = (name: string) =>
      (screen.getByRole('textbox', { name }) as HTMLInputElement | HTMLTextAreaElement).value

    expect(value('Name')).toBe('Schulzentrum Am Lindenhain')
    expect(value('Straße und Hausnummer')).toBe('Am Lindenhain 7')
    expect(value('Postleitzahl')).toBe('00003')
    expect(value('Ort')).toBe('Musterhausen')
    expect(value('Notiz')).toBe('Zufahrt über den Hof.\nSchlüssel beim Hausmeister.')
    expect((screen.getByRole('combobox', { name: 'Bereich' }) as HTMLSelectElement).value).toBe(
      sued.id,
    )
    // A property that is there has an area and a state: neither is asked for anew.
    expect(optionsOf('Bereich')).toEqual(['Nord', 'Süd'])
    expect(optionsOf('Bundesland')).toHaveLength(16)
    expect(screen.queryByText(/legen Sie danach in der Liegenschaft an/)).toBeNull()
  })

  // The way back of a browser may lead from the form of one property straight
  // to the form of another. A form reads what it starts with once.
  it('starts anew for another property when only the address changes', async () => {
    const user = userEvent.setup()
    const changes = takingChanges()
    const router = await mount('/liegenschaften/p-school/bearbeiten')

    await user.type(await screen.findByRole('textbox', { name: 'Ort' }), ' am See')
    await router.navigate({ to: '/liegenschaften/p-office/bearbeiten' })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ämter Am Probehang bearbeiten' }),
    ).toBeTruthy()

    const value = (name: string) =>
      (screen.getByRole('textbox', { name }) as HTMLInputElement | HTMLTextAreaElement).value

    expect(value('Name')).toBe('Ämter Am Probehang')
    expect(value('Ort')).toBe('Beispielstadt')
    expect(value('Notiz')).toBe('')
    expect((screen.getByRole('combobox', { name: 'Bereich' }) as HTMLSelectElement).value).toBe(
      nord.id,
    )

    // And saves nothing of the property it came from.
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften/p-office')
    })
    expect(changes).toEqual([])
  })

  it('sends what was changed and nothing else, and leads back to the property', async () => {
    const user = userEvent.setup()
    const changes = takingChanges()
    const router = await mount('/liegenschaften/p-school/bearbeiten')
    const city = await screen.findByRole('textbox', { name: 'Ort' })

    await user.clear(city)
    await user.type(city, 'Beispielstadt')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bereich' }), 'Nord')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften/p-school')
    })
    expect(changes).toEqual([
      { entity: 'properties', id: 'p-school', values: { areaId: nord.id, city: 'Beispielstadt' } },
    ])
    expect(written).toEqual([])
  })

  it('takes a note away when it is emptied', async () => {
    const user = userEvent.setup()
    const changes = takingChanges()

    await mount('/liegenschaften/p-school/bearbeiten')
    await user.clear(await screen.findByRole('textbox', { name: 'Notiz' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(changes).toEqual([{ entity: 'properties', id: 'p-school', values: { note: null } }])
    })
  })

  it('takes a connection to change and to remove', async () => {
    await mount('/liegenschaften/p-school/bearbeiten')

    const save = (await screen.findByRole('button', { name: 'Speichern' })) as HTMLButtonElement
    const remove = screen.getByRole('button', {
      name: 'Liegenschaft entfernen',
    }) as HTMLButtonElement

    expect([save.disabled, remove.disabled]).toEqual([false, false])

    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(takesAConnection)).toBeTruthy()
    expect([save.disabled, remove.disabled]).toEqual([true, true])
  })

  it('removes the property after a question that says what goes with it', async () => {
    const user = userEvent.setup()
    const removed: string[] = []

    server.remove = (entity, id) => {
      removed.push(`${entity}/${id}`)
      server.put(entity, { ...server.row(entity, id), deletedAt: '2026-10-05T08:00:00.000Z' })

      return Promise.resolve(null)
    }

    const router = await mount('/liegenschaften/p-school/bearbeiten')

    await user.click(await screen.findByRole('button', { name: 'Liegenschaft entfernen' }))

    const asking = await screen.findByRole('alertdialog', {
      name: '„Schulzentrum Am Lindenhain“ entfernen?',
    })

    expect(asking.textContent).toBe(
      '„Schulzentrum Am Lindenhain“ entfernen?' +
        'Mit der Liegenschaft gehen ihre Ansprechpartner, ihre Gebäude, Geschosse und Räume, die Anlagen darin und alle Pflichten, Vorgänge und Mängel dort. ' +
        'Eine Anlage mit Nachweis wird nicht entfernt, und dann bleibt auch die Liegenschaft.' +
        'AbbrechenEntfernen',
    )
    expect(removed).toEqual([])

    await user.click(within(asking).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/liegenschaften')
    })
    expect(removed).toEqual(['properties/p-school'])
    expect(screen.queryByRole('link', { name: 'Schulzentrum Am Lindenhain' })).toBeNull()
  })

  it('leaves it where it is when the question is not answered with yes', async () => {
    const user = userEvent.setup()
    const removed: string[] = []

    server.remove = (entity, id) => {
      removed.push(`${entity}/${id}`)

      return Promise.resolve(null)
    }

    const router = await mount('/liegenschaften/p-school/bearbeiten')

    await user.click(await screen.findByRole('button', { name: 'Liegenschaft entfernen' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(removed).toEqual([])
    expect(router.state.location.pathname).toBe('/liegenschaften/p-school/bearbeiten')
  })

  it('stays and says why when the server keeps the property', async () => {
    const user = userEvent.setup()
    const sentence =
      'Eine Anlage mit Nachweis wird zurückgebaut und nicht gelöscht; ihre Nachweise bleiben bei ihr.'

    server.remove = () => Promise.reject(new RequestRefused(409, sentence))

    const router = await mount('/liegenschaften/p-school/bearbeiten')

    await user.click(await screen.findByRole('button', { name: 'Liegenschaft entfernen' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    expect((await screen.findByRole('alert')).textContent).toBe(sentence)
    expect(router.state.location.pathname).toBe('/liegenschaften/p-school/bearbeiten')
  })

  it('says so when the device holds no such property', async () => {
    await mount('/liegenschaften/p-gone/bearbeiten')

    expect(await screen.findByRole('heading', { level: 1, name: 'Nicht gefunden' })).toBeTruthy()
  })

  it('is for whoever keeps the places', async () => {
    signedIn('technician')
    await mount('/liegenschaften/p-school/bearbeiten')
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Liegenschaften ändern darf dieser Zugang nicht.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })
})
