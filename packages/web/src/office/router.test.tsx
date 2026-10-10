import 'fake-indexeddb/auto'

import type { TenantChoice, TenantId } from '@opengewerk/haustechnik-domain'
import { ApplicationProvider } from '@opengewerk/platform-web'
import { openLocalStore, SyncProvider } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../sync/client.js'
import { officeApplication } from './application.js'
import { officeRoutes } from './router.js'

/**
 * The office of this application as it starts: its routes, the frame of the
 * foundation around them and what this application hands in. The screens are
 * the foundation's and have their tests there (ADR 0010 in the repository
 * opengewerk); here is which of them this application offers where.
 */

let answers: Map<string, unknown>
let counter = 0

const nord: TenantChoice = {
  id: 't-nord' as TenantId,
  name: 'Gebäudeverwaltung Nord',
  roles: ['management'],
  roleLabels: ['Leitung'],
  rights: ['membership.read', 'membership.write', 'location.read', 'duty.read'],
  secondFactor: true,
}

async function mount(path: string) {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`office${String((counter += 1))}` as TenantId),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: [],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const router = createRouter({
    routeTree: officeRoutes(),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <ApplicationProvider application={officeApplication}>
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
  answers = new Map([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'leitung@nord.example.de', name: 'Lea Leitung' },
        session: { activeTenantId: 't-nord' },
      },
    ],
    ['/auth/tenants', [nord]],
    ['/staff', []],
    ['/staff/invitations', []],
    ['/staff/roles', []],
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

describe('the office of this application', () => {
  /**
   * The office starts at the overview (#122), which every role reads. The
   * navigation has it first, lit, over its foot.
   */
  it('starts at the overview, and names itself and the Betreiber in the header', async () => {
    const router = await mount('/')

    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()

    const header = screen.getByRole('banner')

    expect(within(header).getByRole('link', { name: 'OpenGewerk Haustechnik' })).toBeTruthy()
    expect(await within(header).findByText('Gebäudeverwaltung Nord')).toBeTruthy()

    const navigation = screen.getByRole('navigation', { name: 'Hauptbereiche' })

    expect(within(navigation).getByRole('link', { name: /Abgleich/ })).toBeTruthy()
    expect(
      (await within(navigation).findByRole('link', { name: 'Übersicht' })).getAttribute(
        'aria-current',
      ),
    ).toBe('page')
    expect(
      within(navigation).getByRole('link', { name: 'Einstellungen' }).getAttribute('aria-current'),
    ).toBeNull()
  })

  it('has the settings where they were, lit in the navigation', async () => {
    await mount('/einstellungen')

    expect(screen.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeTruthy()
    expect(
      (
        await within(screen.getByRole('navigation', { name: 'Hauptbereiche' })).findByRole('link', {
          name: 'Einstellungen',
        })
      ).getAttribute('aria-current'),
    ).toBe('page')
  })

  it('offers "Zugänge" among the settings, under the words of this application', async () => {
    await mount('/einstellungen/zugaenge')

    expect(screen.getByRole('heading', { level: 1, name: 'Zugänge' })).toBeTruthy()
    expect(await screen.findByText('Wer für diesen Betreiber arbeitet, und womit.')).toBeTruthy()
  })

  it('offers the change log among the settings, under the words of this application', async () => {
    answers.set('/auth/tenants', [{ ...nord, rights: [...nord.rights, 'audit.read'] }])
    answers.set('/audit/changes', { changes: [], next: null, titles: {}, people: {}, devices: {} })
    answers.set('/audit/people', [])
    await mount('/einstellungen/protokoll')

    expect(screen.getByRole('heading', { level: 1, name: 'Änderungsprotokoll' })).toBeTruthy()
    expect(
      await screen.findByText(
        'Jede Änderung bei diesem Betreiber, Feld für Feld: wer, wann, auf welchem Gerät und auf welchem Weg.',
      ),
    ).toBeTruthy()
    expect(await screen.findByText('Hier steht noch keine Änderung.')).toBeTruthy()
  })

  it('says to whoever is not the Leitung that the log is the Leitung’s', async () => {
    await mount('/einstellungen/protokoll')

    expect(await screen.findByText('Das Änderungsprotokoll sieht nur die Leitung.')).toBeTruthy()
  })

  it('has the log of the instance in the area of the instance', async () => {
    answers.set('/instance/access', { operator: true, secondFactor: true })
    answers.set('/instance/log', { changes: [], next: null, titles: {}, people: {}, devices: {} })
    await mount('/instanz/protokoll')

    expect(
      await screen.findByText(
        'Jede Änderung an der Instanz. Was bei einem Betreiber geändert wird, steht in dessen Änderungsprotokoll.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /Protokoll/ }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('has "Konto" and the list of the exchange with the server', async () => {
    const router = await mount('/konto')

    expect(screen.getByRole('heading', { level: 1, name: 'Konto' })).toBeTruthy()

    await router.navigate({ to: '/konflikte' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Abgleich' })).toBeTruthy()
  })
})
