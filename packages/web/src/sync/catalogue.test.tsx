import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '../app/application.js'
import { servingCatalogue, testCatalogue } from '../app/test-catalogue.js'
import { mountedWithItsDevice } from '../app/test-entry.js'
import { mountOffice, onA, signedInOffice } from '../office/test-office.js'
import { siteRoutes } from '../site/router.js'
import {
  catalogueAbsenceWords,
  catalogueChecksumQuery,
  catalogueKeep,
  keptCatalogue,
  unreadableCatalogueKeep,
} from './catalogue.js'
import type { SyncClient } from './client.js'

/**
 * The catalogue on a device (#90, section 2.7 of the concept): fetched from
 * the server, kept in the local store, and fetched again only from a server
 * that names another one.
 */

/** How often an address was read since the server last changed. */
let read: Map<string, number>

/** The server as it answers from now on; a second call is the server after an update. */
function serving(answers: Readonly<Record<string, unknown>>): void {
  signedInOffice('technician', [], answers)

  const answering = fetch as unknown as (path: string, init?: RequestInit) => Promise<Response>

  read = new Map()
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    read.set(path, (read.get(path) ?? 0) + 1)

    return answering(path, init)
  })
}

const packages = 'Pakete des Katalogs'

/** The office at the catalogue, once the device holds what the server sent. */
async function mount() {
  const mounted = await mountOffice('/katalog', new TestServer(), [])

  await screen.findByRole('table', { name: packages })

  return mounted
}

function kept(client: SyncClient): CatalogueBundle | null {
  return JSON.parse(client.kept(catalogueKeep) ?? 'null') as CatalogueBundle | null
}

const newer: CatalogueBundle = {
  ...testCatalogue,
  sha256: '2'.repeat(64),
  packages: testCatalogue.packages.map((entry) =>
    entry.name === 'probe' ? { ...entry, title: 'Probepaket, neu', version: '1.3.0' } : entry,
  ),
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the catalogue on a device', () => {
  it('is fetched from the server once and kept, whole', async () => {
    serving(servingCatalogue())

    const { client } = await mount()

    expect(kept(client)).toEqual(testCatalogue)
    expect(read.get('/catalogue')).toBe(1)
  })

  it('is not fetched again from a server that names the one the device holds', async () => {
    serving(servingCatalogue())

    const { client, queries } = await mount()

    await queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey })
    await waitFor(() => {
      expect(read.get('/catalogue/checksum')).toBe(2)
    })

    expect(read.get('/catalogue')).toBe(1)
    expect(kept(client)?.sha256).toBe(testCatalogue.sha256)
  })

  it('is not fetched by a device that opens with the one the server names', async () => {
    serving(servingCatalogue())

    const { client, queries } = await mountedWithItsDevice({
      routeTree: siteRoutes(),
      at: '/m/konflikte',
      basepath: '/m',
      application,
      holds: { [catalogueKeep]: JSON.stringify(testCatalogue) },
    })

    await waitFor(() => {
      expect(queries.getQueryData(catalogueChecksumQuery.queryKey)).toEqual({
        sha256: testCatalogue.sha256,
      })
    })
    // The answer has arrived; whatever follows it has had its turn after this.
    await queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey })
    await waitFor(() => {
      expect(read.get('/catalogue/checksum')).toBe(2)
    })

    expect(read.get('/catalogue')).toBeUndefined()
    expect(kept(client)).toEqual(testCatalogue)
  })

  it('is replaced by the one of a server that names another, and the screen shows it', async () => {
    serving(servingCatalogue())

    const { client, queries } = await mount()

    serving(servingCatalogue(newer))
    await queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey })

    await screen.findByRole('heading', { level: 2, name: 'Probepaket, neu, Fassung 1.3.0' })
    expect(kept(client)).toEqual(newer)
    expect(read.get('/catalogue')).toBe(1)
  })

  it('stays as it is while the server cannot be asked', async () => {
    serving(servingCatalogue())

    const { client, queries } = await mount()

    // Every question is answered with 404 from here on.
    serving({})
    await queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey })
    await waitFor(() => {
      expect(read.get('/catalogue/checksum')).toBe(1)
    })

    expect(kept(client)).toEqual(testCatalogue)
    expect(screen.getByRole('table', { name: packages })).toBeDefined()
  })

  it('is not replaced by one this build cannot read', async () => {
    serving(servingCatalogue())

    const { client, queries } = await mount()
    const unreadable = { ...newer, format: 99 }

    serving({ '/catalogue/checksum': { sha256: unreadable.sha256 }, '/catalogue': unreadable })
    await queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey })
    await waitFor(() => {
      expect(read.get('/catalogue')).toBe(1)
    })
    // The answer has arrived; whatever follows it has had its turn after this.
    await queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey })
    await waitFor(() => {
      expect(read.get('/catalogue/checksum')).toBe(2)
    })

    expect(kept(client)).toEqual(testCatalogue)
  })

  it('says on a device that holds none that a new version brings one this build cannot read (#160)', async () => {
    const unreadable = { ...newer, format: 99 }

    serving({ '/catalogue/checksum': { sha256: unreadable.sha256 }, '/catalogue': unreadable })

    const { client, queries } = await mountOffice('/katalog', new TestServer(), [])

    expect(await screen.findByText(catalogueAbsenceWords.update)).toBeDefined()
    expect(screen.queryByText(catalogueAbsenceWords.notYet)).toBeNull()
    expect(kept(client)).toBeNull()

    // The server is updated to a catalogue this build reads: it is kept, and the note goes.
    serving(servingCatalogue())
    await queries.invalidateQueries({ queryKey: catalogueChecksumQuery.queryKey })
    await screen.findByRole('table', { name: packages })

    // Kept on the device a moment after the screen shows it.
    await waitFor(() => {
      expect(kept(client)).toEqual(testCatalogue)
    })
    expect(client.kept(unreadableCatalogueKeep)).toBeNull()
  })

  it('says on a device that holds none and has not reached the server that the next connection brings it', async () => {
    signedInOffice('technician', [], {})
    await mountOffice('/katalog', new TestServer(), [])

    expect(await screen.findByText(catalogueAbsenceWords.notYet)).toBeDefined()
  })

  it('is held on site as well, where it is asked without a network', async () => {
    serving(servingCatalogue())

    const { client } = await mountedWithItsDevice({
      routeTree: siteRoutes(),
      at: '/m/konflikte',
      basepath: '/m',
      application,
    })

    await waitFor(() => {
      expect(kept(client)).toEqual(testCatalogue)
    })
  })
})

describe('what a device kept as its catalogue', () => {
  it('is nothing to ask where it kept nothing, or something this build cannot read', () => {
    expect(keptCatalogue(null)).toBeNull()
    expect(keptCatalogue('')).toBeNull()
    expect(keptCatalogue('kein JSON')).toBeNull()
    // Kept by a build that wrote another format.
    expect(keptCatalogue(JSON.stringify({ ...testCatalogue, format: 1 }))).toBeNull()
  })

  it('is the catalogue to ask, the same one for the same text', () => {
    const stored = JSON.stringify(testCatalogue)
    const catalogue = keptCatalogue(stored)

    expect(catalogue?.sha256).toBe(testCatalogue.sha256)
    expect(catalogue?.packages.map((entry) => entry.name)).toEqual(['probe', 'leer', 'fertig'])
    expect(keptCatalogue(stored)).toBe(catalogue)
  })
})
