import 'fake-indexeddb/auto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { ApplicationProvider } from '@opengewerk/platform-web'
import { type CodeReader, type Scanning, ScanningContext } from '@opengewerk/platform-web/site'
import { openLocalStore, SyncProvider } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '../../app/application.js'
import { SyncClient } from '../../sync/client.js'
import { SiteScanScreen } from './scan.js'

/**
 * The tab "Scannen" on site (#98, boards "Scannen" and "Etikett gesperrt,
 * fremd, außerhalb"): the camera reads the label of an asset or a room and
 * the screen says what it found, from the rows of the device where it holds
 * the label, also without a network, and from the one word of the server
 * where it does not.
 */

const place = { propertyId: 'p-school', areaId: 'a-sued' }
const house = { id: 'b-house', ...place, name: 'Schulhaus', kinds: '["school"]' }
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
const lift = {
  id: 'a-lift',
  ...place,
  buildingId: house.id,
  roomId: boilerRoom.id,
  parentAssetId: null,
  kind: 'probe.elevator',
  number: 'AN-00012',
  name: 'Aufzug Schulhaus',
}

const label = (
  id: string,
  code: string,
  hung: { readonly assetId?: string; readonly roomId?: string },
  blockedAt: string | null = null,
) => ({ id, ...place, assetId: hung.assetId ?? null, roomId: hung.roomId ?? null, code, blockedAt })

const onLift = label('l-lift', '3XQ7M2K9PDH4TA6W', { assetId: lift.id })
const onBoilerRoom = label('l-room', '7M2K9PDH4TA6W3XQ', { roomId: boilerRoom.id })
const lost = label('l-lost', 'PDH4TA6W3XQ7M2K9', { assetId: lift.id }, '2026-10-01T08:00:00.000Z')
const fromASheet = label('l-sheet', 'TA6W3XQ7M2K9PDH4', {})
const unheld = '0000000000000000'

let server: TestServer
let counter = 0

/** What the camera sees now; a test holds a label in front of it by setting this. */
let seen: string | null = null

const reader: CodeReader = { read: () => Promise.resolve(seen) }

function camera(): Promise<MediaStream> {
  const stream = new MediaStream()

  stream.getTracks = () => [{ stop: () => undefined } as unknown as MediaStreamTrack]

  return Promise.resolve(stream)
}

/** What the server was asked about a code, and what it answers. */
let asked: string[] = []
let standing: string | null = null

async function mount(scanning: Partial<Scanning> = {}) {
  const client = await SyncClient.start({
    store: await openLocalStore(`scannen${String((counter += 1))}` as TenantId),
    transport: server,
    writer: server,
    deviceId: 'phone',
    entities: ['buildings', 'floors', 'rooms', 'assets', 'labels'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: SiteScanScreen }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApplicationProvider application={application}>
        <SyncProvider client={client}>
          <ScanningContext.Provider
            value={{
              openReader: () => Promise.resolve(reader),
              openCamera: camera,
              interval: 5,
              ...scanning,
            }}
          >
            <RouterProvider router={router} />
          </ScanningContext.Provider>
        </SyncProvider>
      </ApplicationProvider>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading', { level: 1, name: 'Scannen' })
}

/** Holds a code in front of the camera. */
function scan(read: string): void {
  seen = read
}

function offline(): void {
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

beforeEach(() => {
  localStorage.clear()
  seen = null
  asked = []
  standing = null
  server = new TestServer()
  server.put('buildings', house)
  server.put('floors', ground)
  server.put('rooms', boilerRoom)
  server.put('assets', lift)

  for (const each of [onLift, onBoilerRoom, lost, fromASheet]) {
    server.put('labels', each)
  }

  vi.stubGlobal('fetch', (path: string) => {
    asked.push(path)

    return Promise.resolve(
      standing === null
        ? new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ standing }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
})

describe('a label the device holds', () => {
  it('names the asset it hangs on with its number and its place, and leads to its page on site', async () => {
    await mount()
    scan(`https://haustechnik.example/a/${onLift.code}`)

    const found = await screen.findByRole('link', { name: /Erkannt/ })

    expect(found.textContent).toBe('ErkanntAN-00012 Aufzug SchulhausSchulhaus, E.14 Heizraum')
    expect(found.getAttribute('href')).toBe('/anlagen/a-lift')
    // Asked of the rows on the device, and of nobody else.
    expect(asked).toEqual([])
  })

  it('names the room it hangs on with its building and floor, and leads to its page on site', async () => {
    await mount()
    scan(`https://haustechnik.example/a/${onBoilerRoom.code}`)

    const found = await screen.findByRole('link', { name: /Erkannt/ })

    expect(found.textContent).toBe('ErkanntE.14 HeizraumSchulhaus, Erdgeschoss')
    expect(found.getAttribute('href')).toBe('/raeume/r-boiler')
  })

  /**
   * The third point of the acceptance of #98, on site: only the path of the
   * address on a label counts, so one printed while the instance lived under
   * another address opens its asset all the same. And without a network: the
   * device holds the label.
   */
  it('is read from a label of an earlier address of the instance, and without a network', async () => {
    await mount()
    offline()
    scan(`https://alte-adresse.example.org/a/${onLift.code}`)

    const found = await screen.findByRole('link', { name: /Erkannt/ })

    expect(found.getAttribute('href')).toBe('/anlagen/a-lift')
    expect(asked).toEqual([])
  })

  /** The first point of the acceptance of #98, on site. */
  it('opens nothing once it is blocked, and names nothing of what it hung on', async () => {
    await mount()
    scan(`https://haustechnik.example/a/${lost.code}`)

    expect(await screen.findByRole('heading', { level: 2, name: 'Etikett gesperrt' })).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe(
      'Etikett gesperrtDieses Etikett ist gesperrt und öffnet nichts mehr. Ein neues gibt es im Büro.',
    )
    expect(screen.queryByRole('link', { name: /Erkannt/ })).toBeNull()
    expect(document.body.textContent).not.toContain('Aufzug')
  })

  it('says of a label from a sheet that it hangs on no asset yet', async () => {
    await mount()
    scan(`https://haustechnik.example/a/${fromASheet.code}`)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Noch keiner Anlage zugeordnet' }),
    ).toBeDefined()
  })
})

describe('a label the device does not hold', () => {
  it.each([
    ['outside', 'Außerhalb Ihrer Bereiche'],
    ['unknown', 'Kein Etikett dieses Betreibers'],
    ['blocked', 'Etikett gesperrt'],
  ] as const)(
    'is asked of the server, which says one word, and the screen names nothing: %s',
    async (word, title) => {
      standing = word
      await mount()
      scan(`https://haustechnik.example/a/${unheld}`)

      expect(await screen.findByRole('heading', { level: 2, name: title })).toBeDefined()
      expect(asked).toEqual([`/labels/${unheld}`])
      expect(screen.queryByRole('link', { name: /Erkannt/ })).toBeNull()
    },
  )

  it('is fetched once the server calls it open, and named from the device then', async () => {
    standing = 'open'
    await mount()
    // Made in the office a moment ago: on the server, not on the device yet.
    server.put('labels', label('l-fresh', unheld, { assetId: lift.id }))
    scan(`https://haustechnik.example/a/${unheld}`)

    const found = await screen.findByRole('link', { name: /Erkannt/ })

    expect(found.getAttribute('href')).toBe('/anlagen/a-lift')
  })

  it('says without a network that the device does not hold it, and asks nobody', async () => {
    await mount()
    offline()
    scan(`https://haustechnik.example/a/${unheld}`)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Nicht auf diesem Gerät' }),
    ).toBeDefined()
    expect(asked).toEqual([])
  })
})

describe('the camera', () => {
  it('says of a code that is no label of this application that it is none', async () => {
    await mount()
    scan('https://example.org/produkt/4711')

    expect(await screen.findByRole('heading', { level: 2, name: 'Kein Etikett' })).toBeDefined()
    expect(asked).toEqual([])
  })

  it('looks again after "Erneut scannen"', async () => {
    await mount()
    scan(`https://haustechnik.example/a/${lost.code}`)
    await screen.findByRole('heading', { level: 2, name: 'Etikett gesperrt' })

    seen = null
    fireEvent.click(screen.getByRole('button', { name: 'Erneut scannen' }))

    expect(await screen.findByLabelText('Bild der Kamera')).toBeDefined()

    scan(`https://haustechnik.example/a/${onLift.code}`)
    expect(await screen.findByRole('link', { name: /Erkannt/ })).toBeDefined()
  })

  it('says so when it cannot be opened, and names the way without it', async () => {
    await mount({ openCamera: () => Promise.reject(new Error('NotAllowedError')) })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Ohne Kamera geht es über die Suche im Büro.',
      )
    })
  })
})
