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
 * "Fremdfirmen" (#328, 4.11 of the concept, the boards of that name): the
 * firms of the operator with their services and open duties, the names that
 * stand as text at duties to take over, and the page of a firm. Every role
 * looks; the Leitung and the Technische Leitung keep the firms.
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

const fire = {
  ...synced,
  id: 'c-fire',
  name: 'Brandschutz Beispiel GmbH',
  street: 'Industriestraße 12',
  postalCode: '68169',
  city: 'Mannheim',
  phone: '0621 445566',
  email: 'service@brandschutz-beispiel.example',
  services: ['450', '470'],
  note: 'Rufbereitschaft am Wochenende.',
}

const lift = {
  ...synced,
  id: 'c-lift',
  name: 'Aufzugsdienst Rhein-Neckar GmbH',
  street: null,
  postalCode: '68219',
  city: 'Mannheim',
  phone: null,
  email: null,
  services: ['460'],
  note: null,
}

const answers = {
  '/contractors': [
    { ...lift, openDuties: 3 },
    { ...fire, openDuties: 0 },
  ],
  '/contractors/names': [
    { name: 'Kälte Klima Süd', duties: 2, contractorId: null },
    { name: 'Prüfdienst Weber', duties: 1, contractorId: null },
  ],
  '/contractors/c-fire': {
    contractor: fire,
    openDuties: 0,
    openActivities: 0,
    evidence: [
      {
        id: 'e-118',
        number: 'NW-2026-00118',
        dutyTitle: 'Prüfung der Brandmeldeanlage',
        performedOn: '2026-09-15',
        result: 'without_defects',
        examinerOrganisation: 'Brandschutz Beispiel GmbH',
      },
    ],
  },
  '/contractors/c-lift': { contractor: lift, openDuties: 3, openActivities: 1, evidence: [] },
}

function mounted(role: RoleKey, at = '/fremdfirmen') {
  const written = signedInOffice(role, [nord], answers, (write: Written) => ({
    status: write.method === 'POST' ? 201 : 200,
    body: write.path === '/contractors/takeover' ? { firms: 2, duties: 3 } : { id: 'made' },
  }))

  return { written, done: mountOffice(at, new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const listTable = 'Fremdfirmen mit Ort, Leistungen und offenen Pflichten'

describe('the list of the contractors', () => {
  it('shows every firm with its place, its services and its open duties', async () => {
    const { done } = mounted('technician')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: listTable })

    expect(rowsOf(listTable)).toEqual([
      ['Aufzugsdienst Rhein-Neckar GmbH68219 Mannheim', 'KG 460', '3'],
      ['Brandschutz Beispiel GmbH68169 Mannheim', 'KG 450, KG 470', '0'],
    ])

    // Narrowed to the firms of one cost group.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Leistung' }), '470')
    expect(rowsOf(listTable).map((row) => row[1])).toEqual(['KG 450, KG 470'])
  })

  it('offers whoever only looks neither a new firm nor the names to take over', async () => {
    const { done } = mounted('site_management')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: listTable })

    expect(screen.queryByRole('button', { name: 'Fremdfirma anlegen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Namen übernehmen' })).toBeNull()
  })

  it('makes a firm with its services once each, in the order of the groups', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Fremdfirma anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Fremdfirma anlegen' }))

    await userEvent.type(dialog.getByLabelText(/^Name/), ' Elektro Kraus & Sohn ')
    await userEvent.type(dialog.getByLabelText('Ort'), 'Edingen-Neckarhausen')
    await userEvent.click(dialog.getByRole('checkbox', { name: /^KG 450/ }))
    await userEvent.click(dialog.getByRole('checkbox', { name: /^KG 440/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/contractors',
          body: {
            name: 'Elektro Kraus & Sohn',
            street: null,
            postalCode: null,
            city: 'Edingen-Neckarhausen',
            phone: null,
            email: null,
            services: ['440', '450'],
            note: null,
          },
        },
      ])
    })
  })

  it('takes the names at duties over, each as a new firm or one of the list', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()
    expect(
      await screen.findByText(
        'An 3 Pflichten steht eine Fremdfirma noch als Text: „Kälte Klima Süd“ (2 Pflichten) und „Prüfdienst Weber“ (1 Pflicht). Übernehmen Sie sie in die Liste, dann wählen die Pflichten sie aus.',
      ),
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Namen übernehmen' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: 'Namen als Fremdfirmen übernehmen' }),
    )

    await userEvent.selectOptions(
      dialog.getByRole('combobox', { name: 'Wird zu, für Prüfdienst Weber' }),
      'c-fire',
    )
    await userEvent.click(dialog.getByRole('button', { name: '2 übernehmen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/contractors/takeover',
          body: {
            items: [
              { name: 'Kälte Klima Süd', contractorId: null },
              { name: 'Prüfdienst Weber', contractorId: 'c-fire' },
            ],
          },
        },
      ])
    })
  })
})

describe('the page of a contractor', () => {
  it('shows its address, its services and the evidence of its reports with the organisation as written', async () => {
    const { done } = mounted('technician', '/fremdfirmen/c-fire')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { name: 'Brandschutz Beispiel GmbH' })

    expect(screen.getByText('Industriestraße 12')).toBeTruthy()
    expect(screen.getByText('68169 Mannheim')).toBeTruthy()
    expect(screen.getByText('Rufbereitschaft am Wochenende.')).toBeTruthy()
    expect(screen.getByText('Organisation: Brandschutz Beispiel GmbH')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'NW-2026-00118 Prüfung der Brandmeldeanlage' }),
    ).toBeTruthy()
    // Whoever only looks neither changes nor removes the firm.
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull()
  })

  it('says why a firm that open duties name cannot be removed, and offers no removal', async () => {
    const { written, done } = mounted('technical_management', '/fremdfirmen/c-lift')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: 'Aufzugsdienst Rhein-Neckar GmbH entfernen?' }),
    )

    expect(
      dialog.getByText(
        'Solange eine offene Pflicht oder ein offener Vorgang die Firma nennt, lässt sie sich nicht entfernen. 3 offene Pflichten und 1 offener Vorgang nennen sie; wählen Sie dort eine andere Firma oder die eigenen Leute.',
      ),
    ).toBeTruthy()
    expect(dialog.queryByRole('button', { name: 'Entfernen' })).toBeNull()
    expect(written).toEqual([])
  })

  it('removes a firm nothing open names, after the question', async () => {
    const { written, done } = mounted('technical_management', '/fremdfirmen/c-fire')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }))

    const asking = within(
      await screen.findByRole('alertdialog', { name: 'Brandschutz Beispiel GmbH entfernen?' }),
    )

    await userEvent.click(asking.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(written).toEqual([{ method: 'DELETE', path: '/contractors/c-fire' }])
    })
  })
})
