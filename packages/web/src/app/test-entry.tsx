import 'fake-indexeddb/auto'

import { shippedRoles } from '@opengewerk/haustechnik-domain'
import type { RoleKey, TenantChoice, TenantId } from '@opengewerk/haustechnik-domain'
import { ApplicationProvider } from '@opengewerk/platform-web'
import type { InterfaceApplication } from '@opengewerk/platform-web'
import { openLocalStore, SyncProvider } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import type { AnyRoute } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

import { SyncClient } from '../sync/client.js'

/**
 * What a test of an entry stands on: somebody signed in, in one of the roles
 * a tenant starts with, and the routes of the entry around a sync client.
 */

let counter = 0

/** The tenant of every test that uses this, as the header names it. */
export const tenantName = 'Gebäudeverwaltung Nord'

/**
 * A membership in one of the roles a tenant starts with, holding what that
 * role holds as it is shipped. A test of what a role is offered asks the
 * rights of the catalogue this way, and not a list of its own.
 */
export function memberIn(role: RoleKey): TenantChoice {
  const shipped = shippedRoles.find((candidate) => candidate.key === role)

  if (!shipped) {
    throw new Error(`No role ${role} is shipped.`)
  }

  return {
    id: 't-nord' as TenantId,
    name: tenantName,
    roles: [role],
    roleLabels: [shipped.label],
    rights: [...shipped.rights],
    secondFactor: shipped.secondFactor,
  }
}

/**
 * The server as far as an entry asks it before any screen: who is signed in,
 * and as what. Every other address answers with nothing, unless the test
 * names it.
 */
export function signedInAs(
  choice: TenantChoice,
  further: Readonly<Record<string, unknown>> = {},
): void {
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'person@nord.example.de', name: 'Pia Person' },
        session: { activeTenantId: choice.id },
      },
    ],
    ['/auth/tenants', [choice]],
    ...Object.entries(further),
  ])

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

/**
 * An entry at an address: its routes, the application's words and a sync
 * client that has exchanged once. Hands back the router and the client, for a
 * test that has the device exchange again while a screen stands.
 */
export async function mountedWithItsDevice({
  routeTree,
  at,
  basepath,
  application,
  server = new TestServer(),
  entities = [],
}: {
  readonly routeTree: AnyRoute
  readonly at: string
  /** Where the entry lives, for the one that is not at the root. */
  readonly basepath?: string
  readonly application: InterfaceApplication
  /** The server the device exchanges with, for a test that puts rows on it or watches what it is sent. */
  readonly server?: TestServer
  /** The kinds of record the device keeps, for a test of a screen that reads some. */
  readonly entities?: readonly string[]
}) {
  const client = await SyncClient.start({
    store: await openLocalStore(`entry${String((counter += 1))}` as TenantId),
    transport: server,
    writer: server,
    deviceId: 'test-device',
    entities,
    onSignedOut: () => {},
  })

  await client.synchronise()

  const router = createRouter({
    routeTree,
    ...(basepath === undefined ? {} : { basepath }),
    history: createMemoryHistory({ initialEntries: [at] }),
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

  return { router, client }
}

/** An entry at an address, as `mountedWithItsDevice` mounts it, for a test that asks the router alone. */
export async function mounted(
  options: Parameters<typeof mountedWithItsDevice>[0],
): Promise<Awaited<ReturnType<typeof mountedWithItsDevice>>['router']> {
  return (await mountedWithItsDevice(options)).router
}
