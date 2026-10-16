import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'

/**
 * "Verträge" (#329, 4.11 of the concept, the boards of that name): the
 * contracts with the firms, what each covers, its term, the last day to give
 * notice and how it stands, and the page of a contract. The Leitung, the
 * Technische Leitung and the Objektleitung read them; the Leitung and the
 * Technische Leitung keep them.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const synced = {
  version: 1,
  updatedBy: null,
  deviceId: null,
  deletedAt: null,
  changeSequence: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
}

const lifts = {
  ...synced,
  id: 'k-lifts',
  contractorId: 'c-lift',
  title: 'Wartung der Aufzüge',
  startsOn: '2024-01-01',
  endsOn: '2024-12-31',
  renewalMonths: 12,
  noticeAmount: 3,
  noticeUnit: 'months',
  cancelledTo: null,
  responseTime: '4 Stunden bei Personeneinschluss',
  price: '4.800 € netto im Jahr',
  note: null,
  contractorName: 'Aufzugsdienst Rhein-Neckar GmbH',
  buildings: 1,
  assets: 2,
  runsUntil: '2026-12-31',
  noticeBy: '2026-09-30',
  standing: 'renews',
}

const water = {
  ...synced,
  id: 'k-water',
  contractorId: 'c-water',
  title: 'Untersuchung des Trinkwassers',
  startsOn: '2025-01-01',
  endsOn: null,
  renewalMonths: null,
  noticeAmount: null,
  noticeUnit: null,
  cancelledTo: null,
  responseTime: null,
  price: null,
  note: null,
  contractorName: 'Wasserlabor Beispielstadt',
  buildings: 3,
  assets: 0,
  runsUntil: null,
  noticeBy: null,
  standing: 'running',
}

const answers = {
  '/contracts': [lifts, water],
  '/contractors': [
    {
      ...synced,
      id: 'c-lift',
      name: 'Aufzugsdienst Rhein-Neckar GmbH',
      services: ['460'],
      openDuties: 0,
    },
  ],
  '/contracts/k-lifts': {
    contract: lifts,
    items: [
      {
        id: 'i-1',
        kind: 'building',
        buildingId: 'b-a',
        assetId: null,
        name: 'Haus A',
        where: 'Verwaltung Am Probehang',
      },
      {
        id: 'i-2',
        kind: 'asset',
        buildingId: null,
        assetId: 'as-71',
        name: 'AN-00071 Personenaufzug Haus B',
        where: 'Verwaltung Am Probehang, Haus B',
      },
    ],
    duties: [],
  },
}

function mounted(role: RoleKey, at = '/vertraege') {
  const written = signedInOffice(role, [nord], answers, (write: Written) => ({
    status: write.method === 'POST' ? 201 : 200,
    body: { id: 'made' },
  }))

  return { written, done: mountOffice(at, new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const listTable = 'Verträge mit Firma, Erfasstem, Laufzeit, Kündigung und Stand'

describe('the list of the contracts', () => {
  it('shows every contract with its firm, what it covers, its term, the day to give notice and how it stands', async () => {
    const { done } = mounted('site_management')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: listTable })

    expect(rowsOf(listTable)).toEqual([
      [
        'Wartung der AufzügeAufzugsdienst Rhein-Neckar GmbH',
        '1 Gebäude, 2 Anlagen',
        'bis 31.12.2026, verlängert sich um 12 Monate',
        '30.09.2026',
        'Verlängert sich',
      ],
      [
        'Untersuchung des TrinkwassersWasserlabor Beispielstadt',
        '3 Gebäude',
        'unbefristet',
        'keine',
        'Läuft',
      ],
    ])
  })

  it('offers a new contract only to whoever keeps the contracts', async () => {
    for (const [role, offered] of [
      ['technical_management', true],
      ['site_management', false],
    ] as const) {
      const { done } = mounted(role)

      await done
      await untilTheRightsAreKnown()
      await screen.findByRole('table', { name: listTable })

      expect(screen.queryByRole('button', { name: 'Vertrag anlegen' }) !== null).toBe(offered)
      document.body.innerHTML = ''
    }
  })

  it('makes a contract with its term, its renewal and its notice', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Vertrag anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Vertrag anlegen' }))

    await userEvent.type(dialog.getByLabelText(/^Bezeichnung/), 'Wartung der Lüftung')
    await userEvent.selectOptions(dialog.getByLabelText(/^Fremdfirma/), 'c-lift')
    await userEvent.type(dialog.getByLabelText(/^Beginn/), '2026-01-01')
    await userEvent.type(dialog.getByLabelText(/^Ende der Laufzeit/), '2026-12-31')
    await userEvent.type(dialog.getByLabelText(/^Verlängert sich um/), '12')
    await userEvent.type(dialog.getByLabelText(/^Kündigungsfrist/), '6')
    await userEvent.selectOptions(dialog.getByLabelText(/^Einheit/), 'weeks')
    await userEvent.click(dialog.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/contracts',
          body: {
            title: 'Wartung der Lüftung',
            contractorId: 'c-lift',
            startsOn: '2026-01-01',
            endsOn: '2026-12-31',
            renewalMonths: 12,
            noticeAmount: 6,
            noticeUnit: 'weeks',
            cancelledTo: null,
            responseTime: null,
            price: null,
            note: null,
          },
        },
      ])
    })
  })

  it('refuses a renewal without an end in the form, in the words of the server', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Vertrag anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Vertrag anlegen' }))

    await userEvent.type(dialog.getByLabelText(/^Bezeichnung/), 'Wartung der Lüftung')
    await userEvent.selectOptions(dialog.getByLabelText(/^Fremdfirma/), 'c-lift')
    await userEvent.type(dialog.getByLabelText(/^Beginn/), '2026-01-01')
    await userEvent.type(dialog.getByLabelText(/^Verlängert sich um/), '12')
    await userEvent.click(dialog.getByRole('button', { name: 'Anlegen' }))

    expect(
      await dialog.findByText('Verlängern kann sich nur ein Vertrag mit einem Ende der Laufzeit.'),
    ).toBeTruthy()
    expect(written).toEqual([])
  })
})

describe('the page of a contract', () => {
  it('shows its term, what it covers and its firm, and offers changes only to whoever keeps the contracts', async () => {
    for (const [role, keeps] of [
      ['technical_management', true],
      ['site_management', false],
    ] as const) {
      const { done } = mounted(role, '/vertraege/k-lifts')

      await done
      await untilTheRightsAreKnown()
      await screen.findByRole('heading', { name: 'Wartung der Aufzüge' })

      expect(await screen.findByText('30.09.2026')).toBeTruthy()
      expect(rowsOf('Gebäude und Anlagen, die dieser Vertrag erfasst')).toEqual(
        keeps
          ? [
              ['Haus AGebäude', 'ganzes Gebäude', 'Entfernen'],
              [
                'AN-00071 Personenaufzug Haus BAnlage',
                'Verwaltung Am Probehang, Haus B',
                'Entfernen',
              ],
            ]
          : [
              ['Haus AGebäude', 'ganzes Gebäude'],
              ['AN-00071 Personenaufzug Haus BAnlage', 'Verwaltung Am Probehang, Haus B'],
            ],
      )

      for (const name of ['Bearbeiten', 'Entfernen', 'Erfassen']) {
        expect(screen.queryAllByRole('button', { name }).length > 0).toBe(keeps)
      }

      document.body.innerHTML = ''
    }
  })
})
