import 'fake-indexeddb/auto'

import type { TenantChoice, TenantId } from '@opengewerk/haustechnik-domain'
import { ApplicationProvider } from '@opengewerk/platform-web'
import { openLocalStore, SyncProvider } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '../app/application.js'
import { SyncClient } from '../sync/client.js'
import { siteRoutes } from './router.js'

/**
 * The entry for the work on site as it starts: its routes, the frame of the
 * foundation around them and what this application hands in. The screens are
 * the foundation's and have their tests there (ADR 0010 in the repository
 * opengewerk).
 */

let counter = 0

const nord: TenantChoice = {
  id: 't-nord' as TenantId,
  name: 'Gebäudeverwaltung Nord',
  roles: ['technician'],
  roleLabels: ['Haustechnik'],
  rights: [],
  secondFactor: false,
}

async function mount(path: string) {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`vorort${String((counter += 1))}` as TenantId),
    transport: server,
    writer: server,
    deviceId: 'phone',
    entities: [],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const router = createRouter({
    routeTree: siteRoutes(),
    basepath: '/m',
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApplicationProvider application={application}>
        <SyncProvider client={client}>
          <RouterProvider router={router} />
        </SyncProvider>
      </ApplicationProvider>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading', { level: 1 })

  return router
}

beforeEach(() => {
  localStorage.clear()

  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-2', email: 'technik@nord.example.de', name: 'Tim Technik' },
        session: { activeTenantId: 't-nord' },
      },
    ],
    ['/auth/tenants', [nord]],
  ])

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the entry for the work on site', () => {
  /** The start is what is due today and this week (#114); on a new device nothing is. */
  it('starts at what is due today and this week', async () => {
    const router = await mount('/m/')

    // Under the base path of the entry, which the router keeps out of its own paths.
    expect(router.history.location.pathname).toBe('/m/')
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Start' })).toBeTruthy()
    expect(screen.getByText('Für heute und diese Woche liegt nichts an.')).toBeTruthy()
  })

  it('keeps the conflicts at their own address, with nothing to decide', async () => {
    await mount('/m/konflikte')

    expect(screen.getByRole('heading', { level: 1, name: 'Konflikte' })).toBeTruthy()
    expect(await screen.findByText('Keine Konflikte')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy()
  })

  it('keeps the menu in reach, with the way to the account', async () => {
    await mount('/m/konflikte')

    expect(screen.getAllByRole('button', { name: /Menü/ }).length).toBeGreaterThan(0)
  })
})
