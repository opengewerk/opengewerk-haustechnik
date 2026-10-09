import 'fake-indexeddb/auto'

import type { RoleKey, TenantId } from '@opengewerk/haustechnik-domain'
import { ApplicationProvider } from '@opengewerk/platform-web'
import { useRights } from '@opengewerk/platform-web/session'
import { type CodeReader, type Scanning, ScanningContext } from '@opengewerk/platform-web/site'
import { openLocalStore, SyncProvider } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import { application } from '../app/application.js'
import { servingCatalogue } from '../app/test-catalogue.js'
import { memberIn } from '../app/test-entry.js'
import { SyncClient } from '../sync/client.js'
import { siteRoutes } from './router.js'

/**
 * What the tests of the screens on site share (#99): a small school with a
 * boiler room, a device that holds it, the entry on site around one screen,
 * a camera that sees what a test holds in front of it, and a server that
 * remembers what it was asked at its routes.
 */

const place = { propertyId: 'p-school', areaId: 'a-sued' }

export const school = {
  id: 'p-school',
  areaId: 'a-sued',
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  note: 'Zufahrt über den Lehrerparkplatz.',
}
export const hall = {
  id: 'p-hall',
  areaId: 'a-sued',
  name: 'Sporthalle Süd',
  street: 'Südring 2',
  postalCode: '00003',
  city: 'Musterhausen',
  note: null,
}
export const house = {
  id: 'b-house',
  ...place,
  name: 'Schulhaus',
  shortCode: 'SH',
  kinds: '["school"]',
}
export const gym = {
  id: 'b-gym',
  propertyId: hall.id,
  areaId: 'a-sued',
  name: 'Sporthalle',
  shortCode: null,
  kinds: '["school"]',
}
export const ground = {
  id: 'f-ground',
  ...place,
  buildingId: house.id,
  name: 'Erdgeschoss',
  level: 0,
}
export const upper = {
  id: 'f-upper',
  ...place,
  buildingId: house.id,
  name: '1. Obergeschoss',
  level: 1,
}
export const boilerRoom = {
  id: 'r-boiler',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.14',
  name: 'Heizraum',
  use: 'Haustechnik',
}
export const storeRoom = {
  id: 'r-store',
  ...place,
  buildingId: house.id,
  floorId: ground.id,
  number: 'E.15',
  name: 'Lager',
  use: null,
}

const asset = {
  ...place,
  buildingId: house.id,
  roomId: null as string | null,
  parentAssetId: null as string | null,
  kind: 'probe.elevator',
  mark: null,
  manufacturer: null as string | null,
  model: null as string | null,
  serialNumber: null as string | null,
  yearBuilt: null as number | null,
  values: '{}',
}

export const heater = {
  ...asset,
  id: 'a-heater',
  roomId: boilerRoom.id,
  number: 'AN-00057',
  name: 'Aufzug Heizraum',
  manufacturer: 'Beispielhub',
  model: 'SW 750',
  serialNumber: 'BT-750-22-0193',
  yearBuilt: 2019,
  values: '{"firefighters_lift":true,"stops":4}',
}
export const pump = {
  ...asset,
  id: 'a-pump',
  roomId: boilerRoom.id,
  parentAssetId: heater.id,
  kind: 'probe.pump',
  number: 'AN-00059',
  name: 'Zirkulationspumpe',
}
export const rod = { ...asset, id: 'a-rod', number: 'AN-00046', name: 'Blitzschutzanlage' }
export const board = {
  ...asset,
  id: 'a-board',
  roomId: storeRoom.id,
  number: 'AN-00041',
  name: 'Unterverteilung UV-EG',
}
export const supply = {
  id: 's-board',
  ...place,
  assetId: board.id,
  buildingId: null,
  roomId: boilerRoom.id,
}
export const tooCold = {
  id: 'd-cold',
  ...place,
  assetId: heater.id,
  roomId: null,
  buildingId: null,
  description: 'Warmwasser am Speicheraustritt 55,5 °C',
  defectClass: null,
  foundOn: '2026-10-01',
  dueOn: '2026-10-19',
  status: 'found',
}
export const setRight = { ...tooCold, id: 'd-done', description: 'Dichtung tropft', status: 'done' }
export const caretaker = {
  id: 'c-becker',
  ...place,
  givenName: 'Klaus',
  familyName: 'Becker',
  role: 'Hausmeister',
  phone: '0000 4471',
  email: null,
}

const label = (id: string, code: string, more: object = {}) => ({
  id,
  ...place,
  assetId: null as string | null,
  roomId: null as string | null,
  code,
  blockedAt: null as string | null,
  ...more,
})

export const onHeater = label('l-heater', '3XQ7M2K9PDH4TA6W', { assetId: heater.id })
export const fromASheet = label('l-sheet', 'TA6W3XQ7M2K9PDH4')
export const blockedSheet = label('l-blocked', 'PDH4TA6W3XQ7M2K9', {
  blockedAt: '2026-10-01T08:00:00.000Z',
})
export const sheetOfTheHall = label('l-hall', '7M2K9PDH4TA6W3XQ', { propertyId: hall.id })

/** The address a label carries, as a camera reads it. */
export const addressOf = (code: string) => `https://haustechnik.example.de/a/${code}`

/** A server that holds the school, as a device of its area is sent it. */
export function schoolServer(): TestServer {
  const server = new TestServer()

  for (const [entity, rows] of Object.entries({
    properties: [school, hall],
    buildings: [house, gym],
    floors: [ground, upper],
    rooms: [boilerRoom, storeRoom],
    assets: [heater, pump, rod, board],
    asset_supplies: [supply],
    defects: [tooCold, setRight],
    contacts: [caretaker],
    labels: [onHeater, fromASheet, blockedSheet, sheetOfTheHall],
  })) {
    for (const row of rows) {
      server.put(entity, row)
    }
  }

  return server
}

/** What a route was asked with, past the sync. */
export interface Asked {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

export interface Site {
  readonly server: TestServer
  readonly client: SyncClient
  /** Where the entry stands, without its base path. */
  readonly router: {
    readonly state: { readonly location: { readonly pathname: string } }
    readonly navigate: (options: { readonly to: string }) => Promise<void>
  }
  /** Every request past the sync, in the order it was made. */
  readonly asked: Asked[]
  /** How often the camera was opened. */
  readonly cameraOpened: () => number
  /** Holds a code in front of the camera. */
  readonly hold: (read: string | null) => void
}

let counter = 0

/**
 * What the person may do, written where a test can wait for it: the rights
 * arrive with an answer of the server, after the first screen stands, and a
 * button that asks for one is not there before.
 */
function RightsProbe() {
  return <output data-testid="rights">{useRights().join(' ')}</output>
}

/**
 * The entry on site at an address under `/m`, for somebody in a role, on a
 * device that has exchanged once. `rights` narrows what the role holds;
 * `answers` is what the routes past the sync say, by "METHOD path" or by the
 * path alone.
 */
export async function mountSite(
  at: string,
  {
    server = schoolServer(),
    role = 'technician',
    rights,
    answers = {},
    scanning = {},
    store,
  }: {
    readonly server?: TestServer
    readonly role?: RoleKey
    readonly rights?: readonly string[]
    readonly answers?: Readonly<Record<string, unknown>>
    readonly scanning?: Partial<Scanning>
    /** The name of the store on the device, to open one a test opened before, as a page opened again does. */
    readonly store?: string
  } = {},
): Promise<Site> {
  const member = memberIn(role)
  const choice = rights === undefined ? member : { ...member, rights: [...rights] }
  const asked: Asked[] = []
  const known: Readonly<Record<string, unknown>> = {
    '/api/auth/get-session': {
      user: { id: 'u-1', email: 'person@nord.example.de', name: 'Pia Person' },
      session: { activeTenantId: choice.id },
    },
    '/auth/tenants': [choice],
    ...servingCatalogue(),
    ...answers,
  }

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    // Without a network a request gets no answer at all, as the sync gets none.
    if (server.offline) {
      return Promise.reject(new TypeError('Failed to fetch'))
    }

    const method = init?.method ?? 'GET'
    const answer = known[`${method} ${path}`] ?? (method === 'GET' ? known[path] : undefined)

    if (!(path in known) || method !== 'GET') {
      asked.push({
        method,
        path,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      })
    }

    return Promise.resolve(
      new Response(JSON.stringify(answer ?? {}), {
        status: answer === undefined ? 404 : 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  const client = await SyncClient.start({
    store: await openLocalStore((store ?? `site${String((counter += 1))}`) as TenantId),
    transport: server,
    writer: server,
    deviceId: 'phone',
    entities: [
      'properties',
      'buildings',
      'floors',
      'rooms',
      'assets',
      'asset_supplies',
      'contacts',
      'duties',
      'activities',
      'activity_duties',
      'activity_answers',
      'activity_signatures',
      'defects',
      'labels',
      'attachments',
      'attachment_versions',
      'round_templates',
      'round_template_versions',
      'round_plans',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  let seen: string | null = null
  let opened = 0
  const reader: CodeReader = { read: () => Promise.resolve(seen) }
  const camera = () => {
    opened += 1

    // What a `<video>` of the test takes as its source.
    const stream = new MediaStream()

    stream.getTracks = () => [{ stop: () => undefined } as unknown as MediaStreamTrack]

    return Promise.resolve(stream)
  }
  const router = createRouter({
    routeTree: siteRoutes(),
    basepath: '/m',
    history: createMemoryHistory({ initialEntries: [`/m${at}`] }),
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
            <RightsProbe />
          </ScanningContext.Provider>
        </SyncProvider>
      </ApplicationProvider>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => {
    if (screen.getByTestId('rights').textContent !== choice.rights.join(' ')) {
      throw new Error('The rights have not arrived yet.')
    }
  })

  return {
    server,
    client,
    router,
    asked,
    cameraOpened: () => opened,
    hold: (read) => {
      seen = read
    },
  }
}

/**
 * Takes the connection away, as a cellar does: the server is out of reach,
 * for the sync and for every other request, and the browser says so.
 */
export function goOffline(server: TestServer): void {
  server.offline = true
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

/** Gives the connection back; the device starts its exchange by itself. */
export function goOnline(server: TestServer): void {
  server.offline = false
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
}

/** What every test of a screen on site puts back afterwards. */
export function afterEachSiteTest(): void {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
}

/** What the device queued, as entity, kind and the fields with their new values. */
export function queued(server: TestServer) {
  return server.operations().map((operation) => ({
    entity: operation.entity,
    kind: operation.kind,
    values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
  }))
}
