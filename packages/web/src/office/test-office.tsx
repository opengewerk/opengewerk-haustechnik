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

/** What a screen wrote to a route. */
export interface Written {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

/** What a route answers a write with. */
export interface WriteAnswer {
  readonly status: number
  readonly body: unknown
}

/**
 * The server as far as a screen of the office asks it: who is signed in, as
 * what, and the areas they see. Every other question is answered with 404,
 * unless the test names it.
 *
 * What a screen writes to a route is kept in the order it came, and answered
 * by the test; without an answer of its own a write is one nobody expected,
 * and is refused. Handed back is what was written.
 */
export function signedInOffice(
  role: RoleKey,
  areas: readonly NamedArea[],
  further: Readonly<Record<string, unknown>> = {},
  answerToWrite: (write: Written) => WriteAnswer = () => ({
    status: 500,
    body: { message: 'Dieser Test hat keinen Schreibzugriff erwartet.' },
  }),
): Written[] {
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
  const written: Written[] = []

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

  return written
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

/**
 * The PDF as the server hands it out, or the sentence it refuses it with;
 * every other request goes to the answers of the test. Hands back the
 * addresses asked for and what was opened in a tab.
 */
export function servingPdf(refusal: string | null = null): { asked: string[]; opened: unknown[] } {
  const answered = globalThis.fetch
  const asked: string[] = []
  const opened: unknown[] = []

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    if (!path.endsWith('/pdf')) {
      return answered(path, init)
    }

    asked.push(path)

    return Promise.resolve(
      refusal === null
        ? new Response(new Blob(['%PDF probe'], { type: 'application/pdf' }), { status: 200 })
        : new Response(JSON.stringify({ message: refusal }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
    )
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:probe' }))
  vi.stubGlobal('open', (address: string) => {
    opened.push(address)

    return {}
  })

  return { asked, opened }
}

export const noRenderer =
  'Auf dieser Instanz ist kein Dienst eingerichtet, der PDFs erzeugt. Der eingefrorene Stand bleibt unverändert; das PDF entsteht, sobald der Dienst läuft.'
