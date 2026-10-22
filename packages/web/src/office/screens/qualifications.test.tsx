import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { qualificationNote } from '../qualification-note.js'
import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'

/**
 * "Qualifikationen" (#337, 4.3 of the concept, the boards of that name):
 * the list with person, kind, until when and how each stands, entering one,
 * the kinds, the own ones under "Konto", and the note when a person lacks
 * the kind a duty asks for.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

function entry(
  id: string,
  personName: string,
  label: string,
  further: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    userId: `u-${id}`,
    personName,
    kind: { key: 'elektro.electrically_skilled_person', label, origin: 'Paket Elektro' },
    validUntil: '2027-03-31',
    note: null,
    hasCertificate: false,
    standing: 'valid',
    version: 1,
    ...further,
  }
}

const list = {
  qualifications: [
    entry('vogt', 'Lena Vogt', 'Elektrotechnisch unterwiesene Person', {
      validUntil: '2026-09-15',
      standing: 'expired',
    }),
    entry('yilmaz', 'Murat Yilmaz', 'Elektrofachkraft', { hasCertificate: true }),
    entry('wendt', 'Tobias Wendt', 'Hygieneschulung Trinkwasser', {
      kind: { key: 'own:k-1', label: 'Hygieneschulung Trinkwasser', origin: 'Eigene Art' },
      validUntil: null,
    }),
  ],
  expired: 1,
  expiring: 0,
  leadDays: 60,
}

const kinds = [
  {
    key: 'elektro.electrically_skilled_person',
    label: 'Elektrofachkraft',
    level: 'skilled_person',
    origin: 'Paket Elektro',
    requiredFor: 3,
    unaccepted: true,
  },
  {
    key: 'own:k-1',
    label: 'Hygieneschulung Trinkwasser',
    level: 'instructed_person',
    origin: 'Eigene Art',
    requiredFor: 0,
    unaccepted: false,
  },
]

const answers = {
  '/qualifications': list,
  '/qualifications/kinds': kinds,
  '/duties/colleagues': [
    { userId: 'u-yilmaz', name: 'Murat Yilmaz', active: true },
    { userId: 'u-gone', name: 'Gerd Fort', active: false },
  ],
}

function mounted(role: RoleKey, at: string, further: Readonly<Record<string, unknown>> = {}) {
  const written = signedInOffice(role, [nord], { ...answers, ...further }, (write: Written) => ({
    status: write.method === 'POST' ? 201 : 200,
    body: entry('made', 'Murat Yilmaz', 'Elektrofachkraft'),
  }))

  return { written, done: mountOffice(at, new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const listTable = 'Qualifikationen mit Person, Art, gültig bis und Stand'

describe('the list of the qualifications', () => {
  it('shows every qualification with its person, its kind, until when it holds and how it stands, and counts what ran out', async () => {
    const { done } = mounted('site_management', '/qualifikationen')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: listTable })

    expect(rowsOf(listTable).map((row) => row.slice(0, 4))).toEqual([
      [
        'Lena Vogt',
        'Elektrotechnisch unterwiesene PersonPaket Elektro',
        '15.09.2026',
        'Abgelaufen',
      ],
      ['Murat Yilmaz', 'ElektrofachkraftPaket Elektro', '31.03.2027', 'Gültig'],
      ['Tobias Wendt', 'Hygieneschulung TrinkwasserEigene Art', 'ohne Ablauf', 'Gültig'],
    ])
    expect(screen.getByText('Eine Qualifikation ist abgelaufen.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Nachweis' })).toHaveLength(1)
  })

  it('offers to enter and change one only to whoever keeps them', async () => {
    for (const [role, offered] of [
      ['technical_management', true],
      ['site_management', false],
    ] as const) {
      const { done } = mounted(role, '/qualifikationen')

      await done
      await untilTheRightsAreKnown()
      await screen.findByRole('table', { name: listTable })

      expect(screen.queryByRole('button', { name: 'Qualifikation eintragen' }) !== null).toBe(
        offered,
      )
      expect(screen.queryAllByRole('button', { name: /bearbeiten$/ }).length > 0).toBe(offered)
      document.body.innerHTML = ''
    }
  })

  it('enters one with its person, its kind, its last day and a note', async () => {
    const user = userEvent.setup()
    const { written, done } = mounted('management', '/qualifikationen')

    await done
    await untilTheRightsAreKnown()
    await user.click(await screen.findByRole('button', { name: 'Qualifikation eintragen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Qualifikation eintragen' }))

    await waitFor(() => {
      expect(
        dialog
          .getAllByRole('option')
          .map((option) => option.textContent)
          .filter((label) => label !== 'Bitte wählen'),
      ).toEqual(['Murat Yilmaz', 'Elektrofachkraft', 'Hygieneschulung Trinkwasser'])
    })
    await user.selectOptions(dialog.getByLabelText(/^Person/), 'u-yilmaz')
    await user.selectOptions(
      dialog.getByLabelText(/^Qualifikation/),
      'elektro.electrically_skilled_person',
    )
    await user.type(dialog.getByLabelText(/^Gültig bis/), '2027-03-31')
    await user.type(dialog.getByLabelText(/^Notiz/), 'Bestellung durch die Leitung')
    await user.click(dialog.getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/qualifications',
          body: {
            userId: 'u-yilmaz',
            kind: 'elektro.electrically_skilled_person',
            validUntil: '2027-03-31',
            note: 'Bestellung durch die Leitung',
          },
        },
      ])
    })
  })

  it('sends nothing without a person and a kind, and says what is missing', async () => {
    const user = userEvent.setup()
    const { written, done } = mounted('management', '/qualifikationen')

    await done
    await untilTheRightsAreKnown()
    await user.click(await screen.findByRole('button', { name: 'Qualifikation eintragen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Qualifikation eintragen' }))

    await user.click(dialog.getByRole('button', { name: 'Eintragen' }))

    expect(dialog.getByText('Wählen Sie die Person.')).toBeTruthy()
    expect(dialog.getByText('Wählen Sie die Art der Qualifikation.')).toBeTruthy()
    expect(written).toEqual([])
  })
})

describe('the qualifications under "Konto"', () => {
  it('lists the own ones with until when and how each stands', async () => {
    const { done } = mounted('technician', '/konto', {
      '/qualifications/mine': {
        qualifications: [list.qualifications[1]],
        expired: 0,
        expiring: 0,
        leadDays: 60,
      },
    })

    await done

    const table = 'Ihre Qualifikationen mit gültig bis und Stand'

    await screen.findByRole('table', { name: table })

    expect(rowsOf(table)).toEqual([
      ['ElektrofachkraftPaket Elektro', '31.03.2027', 'Gültig', 'Nachweis'],
    ])
  })

  it('lists them for somebody whose role reads no activity, as their own data (#543)', async () => {
    const { done } = mounted('auditor', '/konto', {
      '/qualifications/mine': {
        qualifications: [list.qualifications[1]],
        expired: 0,
        expiring: 0,
        leadDays: 60,
      },
    })

    await done

    const table = 'Ihre Qualifikationen mit gültig bis und Stand'

    await screen.findByRole('table', { name: table })

    expect(rowsOf(table)).toHaveLength(1)
  })
})

describe('the note on a qualification', () => {
  it('says what is asked for, and that it is missing or ran out on its day, and that saving goes on', () => {
    expect(
      qualificationNote(
        { kindLabel: 'Elektrofachkraft', check: 'missing', expiredOn: null },
        'Lena Vogt',
      ),
    ).toBe(
      'Gefordert ist „Elektrofachkraft“. Lena Vogt hat sie nicht. Sie können trotzdem speichern.',
    )
    expect(
      qualificationNote(
        { kindLabel: 'Elektrofachkraft', check: 'expired', expiredOn: '2026-09-15' },
        'Lena Vogt',
      ),
    ).toBe(
      'Gefordert ist „Elektrofachkraft“. Bei Lena Vogt ist sie am 15.09.2026 abgelaufen. Sie können trotzdem speichern.',
    )
  })
})
