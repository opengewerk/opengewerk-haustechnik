import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'

/**
 * "Einstellungen", "Sicherung" (#127, the board of that name) and the strip
 * at the top of the office when the backups are behind ("Leisten im Büro"),
 * which only whoever may see the settings gets: the Leitung.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const hour = 60 * 60 * 1000

function recorded(hoursAgo: number, overdue: boolean) {
  return {
    state: 'recorded',
    finishedAt: new Date(Date.now() - hoursAgo * hour).toISOString(),
    archive: 'haustechnik-2026-10-05T0230.tar.gz',
    bytes: 18_600_000,
    encrypted: true,
    overdue,
    time: '02:30',
  }
}

function mounted(role: RoleKey, at: string, status: object) {
  signedInOffice(role, [nord], { '/settings/backup': status })

  return mountOffice(at, new TestServer(), [])
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the backup', () => {
  it('shows the last one, and says so when it is not a day old', async () => {
    await mounted('management', '/einstellungen/sicherung', recorded(3, false))
    await untilTheRightsAreKnown()

    expect(await screen.findByText('haustechnik-2026-10-05T0230.tar.gz, 18,6 MB')).toBeDefined()
    expect(screen.getByText('Die letzte Sicherung ist keine 24 Stunden alt.')).toBeDefined()
    expect(screen.getByText(/das Handbuch beschreibt, wie/)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says nothing about the day for one of yesterday morning', async () => {
    await mounted('management', '/einstellungen/sicherung', recorded(30, false))
    await untilTheRightsAreKnown()

    expect(await screen.findByText('haustechnik-2026-10-05T0230.tar.gz, 18,6 MB')).toBeDefined()
    expect(screen.queryByText('Die letzte Sicherung ist keine 24 Stunden alt.')).toBeNull()
  })
})

describe('the strip of a backup that is behind', () => {
  it('stands over the office of the Leitung and leads to the backup', async () => {
    await mounted('management', '/', recorded(60, true))
    await untilTheRightsAreKnown()

    const strip = (await screen.findByText(/und damit älter als zwei Tage/)).closest('div')

    expect(strip).not.toBeNull()
    expect(
      within(strip?.parentElement ?? document.body)
        .getByRole('link', { name: 'Ansehen' })
        .getAttribute('href'),
    ).toBe('/einstellungen/sicherung')
  })

  it('is not there for anybody who may not see the settings, who does not even ask', async () => {
    signedInOffice('technical_management', [nord], { '/settings/backup': recorded(60, true) })

    const answered = globalThis.fetch
    const asked: string[] = []

    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      asked.push(path)

      return answered(path, init)
    })
    await mountOffice('/', new TestServer(), [])
    await untilTheRightsAreKnown()

    // The office has drawn: its navigation and its first screen stand.
    await screen.findByRole('navigation', { name: 'Hauptbereiche' })
    await screen.findByRole('heading', { level: 1, name: 'Übersicht' })
    expect(asked).not.toContain('/settings/backup')
    expect(screen.queryByText(/und damit älter als zwei Tage/)).toBeNull()
  })
})
