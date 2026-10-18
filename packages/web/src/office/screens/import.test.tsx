import type { ImportedRecord, ImportReading } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { importOriginWords } from '../import-origin.js'
import { mountOffice, onA, rowsOf, signedInOffice } from '../test-office.js'
import { importPageWords } from './import.js'

/**
 * Where a record came from (#174): the line over the log of a record an
 * import made, and the page of the import with every record it made that is
 * still there. Both are read from the change log, so the Leitung alone reads
 * them.
 */

const importId = 'i-1'
const origin = {
  importId,
  fileName: 'bestand-schulzentrum.xlsx',
  importedOn: '2026-10-12',
}

function reading(records: readonly ImportedRecord[]): ImportReading {
  return {
    id: importId,
    kind: 'assets',
    fileName: 'bestand-schulzentrum.xlsx',
    lines: 58,
    summary: '3 Anlagen angelegt',
    importedOn: '2026-10-12',
    records,
  }
}

const made: readonly ImportedRecord[] = [
  { table: 'properties', id: 'p-1', title: 'Schulzentrum Am Lindenhain' },
  { table: 'rooms', id: 'r-1', title: 'Schulhaus, E.14 Heizraum' },
  { table: 'assets', id: 'a-1', title: 'AN-00057 Trinkwassererwärmer' },
]

/** Every request the office asks, by its path. */
function askedPaths(): string[] {
  const asked: string[] = []
  const served = globalThis.fetch

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    asked.push(path)

    return served(path, init)
  })

  return asked
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the log of a record an import made', () => {
  it('says first which import made it, with its day and file, and leads to it', async () => {
    signedInOffice('management', [], {
      '/audit/people': [],
      [`/imports/origins/assets/a-1`]: origin,
    })
    await mountOffice('/einstellungen/protokoll?art=assets&datensatz=a-1', new TestServer(), [])

    const lead = await screen.findByText(/Angelegt mit dem Import vom/)

    expect(lead.textContent).toBe(
      'Angelegt mit dem Import vom 12.10.2026, Datei bestand-schulzentrum.xlsx.',
    )
    expect(screen.getByRole('link', { name: importOriginWords.link }).getAttribute('href')).toBe(
      '/einstellungen/protokoll/importe/i-1',
    )
  })

  it('says nothing of a record made by hand, and does not ask for a table no import writes', async () => {
    signedInOffice('management', [], {
      '/audit/people': [],
      '/imports/origins/assets/a-2': null,
    })

    const asked = askedPaths()

    await mountOffice('/einstellungen/protokoll?art=assets&datensatz=a-2', new TestServer(), [])
    await screen.findByRole('heading', { level: 1, name: 'Änderungsprotokoll' })
    await vi.waitFor(() => {
      expect(asked).toContain('/imports/origins/assets/a-2')
    })

    expect(screen.queryByText(/Angelegt mit dem Import/)).toBeNull()

    asked.length = 0
    await mountOffice('/einstellungen/protokoll?art=duties&datensatz=d-1', new TestServer(), [])
    await screen.findAllByRole('heading', { level: 1, name: 'Änderungsprotokoll' })

    expect(asked.filter((path) => path.startsWith('/imports/'))).toEqual([])
  })
})

describe('the page of an import', () => {
  it('names the file, its lines and what came of them, and every record it made with its page', async () => {
    signedInOffice('management', [], { '/imports/i-1/made': reading(made) })
    await mountOffice('/einstellungen/protokoll/importe/i-1', new TestServer(), [])

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Import vom 12.10.2026' }),
    ).toBeTruthy()
    expect(screen.getByText('bestand-schulzentrum.xlsx')).toBeTruthy()
    expect(screen.getByText('58')).toBeTruthy()
    expect(screen.getByText('3 Anlagen angelegt')).toBeTruthy()
    expect(rowsOf(importPageWords.caption)).toEqual([
      ['Liegenschaft', 'Schulzentrum Am Lindenhain'],
      ['Raum', 'Schulhaus, E.14 Heizraum'],
      ['Anlage', 'AN-00057 Trinkwassererwärmer'],
    ])
    expect(
      screen
        .getAllByRole('link', { name: 'AN-00057 Trinkwassererwärmer' })[0]
        ?.getAttribute('href'),
    ).toBe('/anlagen/a-1')
    expect(
      screen.getAllByRole('link', { name: 'Schulzentrum Am Lindenhain' })[0]?.getAttribute('href'),
    ).toBe('/liegenschaften/p-1')
    expect(screen.getByText(importPageWords.note)).toBeTruthy()
  })

  it('shows fifty records at first and fifty more with each press', async () => {
    const many = Array.from({ length: 55 }, (_, at) => ({
      table: 'rooms' as const,
      id: `r-${String(at)}`,
      title: `Schulhaus, Raum ${String(at).padStart(2, '0')}`,
    }))

    signedInOffice('management', [], { '/imports/i-1/made': reading(many) })
    await mountOffice('/einstellungen/protokoll/importe/i-1', new TestServer(), [])
    await screen.findByRole('heading', { level: 1, name: 'Import vom 12.10.2026' })

    expect(rowsOf(importPageWords.caption)).toHaveLength(50)
    expect(screen.getByText(importPageWords.of(50, 55))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: importPageWords.more }))

    expect(rowsOf(importPageWords.caption)).toHaveLength(55)
    expect(screen.queryByRole('button', { name: importPageWords.more })).toBeNull()
  })

  it('says why nothing stands there, where it made no place and no asset', async () => {
    signedInOffice('management', [], { '/imports/i-1/made': reading([]) })
    await mountOffice('/einstellungen/protokoll/importe/i-1', new TestServer(), [])

    expect(await screen.findByText(importPageWords.nothing)).toBeTruthy()
    expect(screen.queryByRole('table', { name: importPageWords.caption })).toBeNull()
  })

  it('is not asked for without the right to read the log', async () => {
    signedInOffice('technical_management', [], { '/imports/i-1/made': reading(made) })

    const asked = askedPaths()

    await mountOffice('/einstellungen/protokoll/importe/i-1', new TestServer(), [])

    expect(await screen.findByText(importPageWords.onlyFor)).toBeTruthy()
    expect(screen.queryByText('AN-00057 Trinkwassererwärmer')).toBeNull()
    expect(asked).not.toContain('/imports/i-1/made')
  })
})
