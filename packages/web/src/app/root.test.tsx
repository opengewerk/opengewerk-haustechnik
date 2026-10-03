import 'fake-indexeddb/auto'

import type { TenantChoice, TenantId } from '@opengewerk/haustechnik-domain'
import {
  forgetSignIn,
  rememberAccount,
  rememberTenants,
  useWho,
} from '@opengewerk/platform-web/session'
import { openLocalStore, useSyncStatus } from '@opengewerk/platform-web/sync'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { officeApplication } from '../office/application.js'
import { application } from './application.js'
import { Root } from './root.js'

/**
 * The top of both entries: this application over the gate of the foundation
 * (ADR 0010 in the repository opengewerk).
 *
 * The gate itself is tested in the foundation, with an application that
 * belongs to nobody. What is held here is what this application asks of it:
 * that the entry for the work on site opens without a network on a device
 * that was signed in before, in the tenant it was signed in to, with its
 * sync client started on the store of that tenant.
 */

const account = {
  userId: 'u-1',
  email: 'technik@nord.example.de',
  name: 'Tim Technik',
  twoFactorEnabled: false,
  signInMethod: 'password' as const,
}

let counter = 0

/** A tenant whose store is on this device already, from an earlier day with a network. */
async function tenantOnTheDevice(): Promise<TenantId> {
  const tenantId = `haustechnik${String((counter += 1))}` as TenantId

  await openLocalStore(tenantId)

  return tenantId
}

/** What stands behind the gate: the tenant by name, and whether the sync is up. */
function Behind() {
  const { tenant } = useWho()
  const { pending } = useSyncStatus()

  return (
    <>
      <p>Hinter dem Tor</p>
      {tenant ? <p>Arbeitet für {tenant}</p> : null}
      <p>{`Im Postausgang: ${String(pending)}`}</p>
    </>
  )
}

function start(entry: 'office' | 'site') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Root entry={entry} application={entry === 'office' ? officeApplication : application}>
        <Behind />
      </Root>
    </QueryClientProvider>,
  )
}

/** A network that is not there: every request fails before any answer. */
function noNetwork() {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
}

beforeEach(() => {
  forgetSignIn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('starting this application without a network', () => {
  it('opens the entry on site in the tenant it was last signed in to', async () => {
    const tenantId = await tenantOnTheDevice()
    const kept: TenantChoice = {
      id: tenantId,
      name: 'Gebäudeverwaltung Nord',
      roles: ['technician'],
      roleLabels: ['Haustechnik'],
      rights: [],
      secondFactor: false,
    }

    rememberAccount({ ...account, tenantId })
    rememberTenants([kept])
    noNetwork()
    start('site')

    expect(await screen.findByText('Hinter dem Tor')).toBeTruthy()
    expect(await screen.findByText('Arbeitet für Gebäudeverwaltung Nord')).toBeTruthy()
    expect(screen.getByText('Im Postausgang: 0')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Anmelden' })).toBeNull()
  })

  it('says on a device that was never signed in that the first sign in needs a connection', async () => {
    noNetwork()
    start('site')

    expect(await screen.findByRole('heading', { level: 1, name: 'Keine Verbindung' })).toBeTruthy()
    expect(screen.queryByText('Hinter dem Tor')).toBeNull()
  })
})
