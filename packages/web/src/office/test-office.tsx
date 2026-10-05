import type { RoleKey } from '@opengewerk/haustechnik-domain'
import type { TestServer } from '@opengewerk/platform-web/testing'
import { act, screen, within } from '@testing-library/react'
import { vi } from 'vitest'

import { memberIn, mountedWithItsDevice, tenantName } from '../app/test-entry.js'
import { officeApplication } from './application.js'
import { officeRoutes } from './router.js'

/**
 * What a test of a screen of the office stands on: somebody signed in in one
 * of the roles a tenant starts with, the areas the server names for them, a
 * window of a band, and the office mounted at an address around a device.
 */

export interface NamedArea {
  readonly id: string
  readonly name: string
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * The server as far as a screen that only reads asks it: who is signed in, as
 * what, and the areas they see. Every other question is answered with 404,
 * unless the test names it.
 */
export function signedInOffice(
  role: RoleKey,
  areas: readonly NamedArea[],
  further: Readonly<Record<string, unknown>> = {},
): void {
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'person@nord.example.de', name: 'Pia Person' },
        session: { activeTenantId: 't-nord' },
      },
    ],
    ['/auth/tenants', [memberIn(role)]],
    ['/areas', areas],
    ...Object.entries(further),
  ])

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(json(answers.get(path) ?? {}, answers.has(path) ? 200 : 404)),
  )
}

/** The office at an address, around a device that holds these kinds of record. */
export function mountOffice(at: string, server: TestServer, entities: readonly string[]) {
  return mountedWithItsDevice({
    routeTree: officeRoutes(),
    at,
    application: officeApplication,
    server,
    entities,
  })
}

/** The rights have arrived once the tenant stands in the header: both come with the same answer. */
export async function untilTheRightsAreKnown(): Promise<void> {
  await within(screen.getByRole('banner')).findByText(tenantName)
}

/** The rows of a table as a reader meets them, cell by cell. */
export function rowsOf(name: string): string[][] {
  return within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    )
}

export type Device = 'phone' | 'tablet' | 'desktop'

/**
 * A window of this band: below 600 pixels a phone, below 1024 a tablet, and
 * a desktop from there. Hands back the way to another band while the screen
 * stands, as a tablet turned on its side takes it.
 */
export function onA(device: Device): (next: Device) => void {
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
