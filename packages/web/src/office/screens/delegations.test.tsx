import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fingerprintOf } from '../../app/signing.js'
import { myDelegationWords } from '../delegations-account.js'
import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'
import { delegationWords } from './delegations.js'

/**
 * "Pflichtenübertragungen" (#336, 4.3 of the concept, the boards of that
 * name): the list with the person, the areas, the scope, the period and how
 * each stands, the page of one with its signatures and the duties in its
 * scope, writing one, signing it for the operator and revoking it; and the
 * card under "Konto" where the person a delegation goes to reads it whole
 * and signs it. Only the Leitung delegates.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const sued: NamedArea = { id: 'a-sued', name: 'Süd' }

const tasks = 'Organisation der wiederkehrenden Prüfungen und Wartungen der Anlagen im Umfang.'
const powers = 'Weisungsbefugnis gegenüber den Beschäftigten der Haustechnik im Bereich.'

function entry(
  id: string,
  delegateName: string,
  further: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    delegateUserId: `u-${id}`,
    delegateName,
    areas: [nord],
    scope: 'all',
    packages: [],
    costGroups: [],
    startsOn: '2026-11-01',
    endsOn: '2028-10-31',
    lastDay: '2028-10-31',
    state: 'in_force',
    ...further,
  }
}

/** The page of a delegation as the server reads it out, with the page that is signed. */
function reading(
  id: string,
  delegateName: string,
  further: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const listed = entry(id, delegateName, further)

  return {
    ...listed,
    tasks,
    powers,
    page: {
      version: 1,
      delegateUserId: listed['delegateUserId'],
      delegateName,
      areaIds: ['a-nord'],
      scope: listed['scope'],
      packages: listed['packages'],
      costGroups: listed['costGroups'],
      tasks,
      powers,
      startsOn: listed['startsOn'],
      endsOn: listed['endsOn'],
    },
    signatures: [],
    revocation: null,
    duties: {
      total: 1,
      shown: [
        {
          dutyId: 'd-1',
          title: 'Prüfung ortsveränderlicher Geräte',
          place: 'Werkhof Nord, Halle 1',
          responsible: 'Petra Lindner',
          from: 'none',
        },
      ],
    },
    signs: null,
    ...further,
  }
}

const operatorSigned = {
  role: 'operator',
  name: 'Sabine Krämer',
  signedAt: '2026-10-17T09:12:00.000Z',
  path: 'M10,10L40,40',
  typedName: null,
}

const albrecht = reading('albrecht', 'Jörg Albrecht', {
  areas: [nord, sued],
  state: 'draft',
  signs: 'operator',
})
const lindner = reading('lindner', 'Petra Lindner', {
  scope: 'packages',
  packages: ['elektro'],
  startsOn: '2026-03-01',
  endsOn: '2028-02-29',
  lastDay: '2028-02-29',
  signatures: [operatorSigned, { ...operatorSigned, role: 'delegate', name: 'Petra Lindner' }],
})

const answers = {
  '/delegations': {
    delegations: [
      entry('albrecht', 'Jörg Albrecht', { areas: [nord, sued], state: 'waiting' }),
      entry('lindner', 'Petra Lindner', {
        scope: 'packages',
        packages: ['elektro'],
        startsOn: '2026-03-01',
        endsOn: '2028-02-29',
        lastDay: '2028-02-29',
      }),
      entry('wendt', 'Tobias Wendt', {
        areas: [sued],
        scope: 'cost_groups',
        costGroups: ['470'],
        startsOn: '2025-01-01',
        endsOn: '2025-12-31',
        lastDay: '2025-12-31',
        state: 'ended',
      }),
    ],
    duties: { withoutResponsible: 3, withoutDelegation: 1 },
  },
  '/delegations/albrecht': albrecht,
  '/delegations/lindner': lindner,
  '/duties/colleagues': [
    { userId: 'u-albrecht', name: 'Jörg Albrecht', active: true },
    { userId: 'u-gone', name: 'Gerd Fort', active: false },
  ],
}

function mounted(role: RoleKey, at: string, further: Readonly<Record<string, unknown>> = {}) {
  const written = signedInOffice(
    role,
    [nord, sued],
    { ...answers, ...further },
    (write: Written) => ({
      status: write.method === 'POST' ? 201 : 200,
      body: write.path === '/delegations' ? { ...albrecht, id: 'made' } : albrecht,
    }),
  )

  return { written, done: mountOffice(at, new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const listTable = 'Pflichtenübertragungen mit Person, Bereichen, Umfang, Zeitraum und Stand'

describe('the list of the delegations', () => {
  it('shows every delegation with its person, areas, scope, period and how it stands', async () => {
    const { done } = mounted('management', '/pflichtenuebertragungen')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: listTable })

    expect(rowsOf(listTable)).toEqual([
      [
        'Jörg Albrecht',
        'Nord, Süd',
        'Alle Pflichten',
        '01.11.2026 bis 31.10.2028',
        'Wartet auf Unterschrift',
      ],
      ['Petra Lindner', 'Nord', 'Paket elektro', '01.03.2026 bis 29.02.2028', 'In Kraft'],
      ['Tobias Wendt', 'Süd', 'Kostengruppe 470', '01.01.2025 bis 31.12.2025', 'Beendet'],
    ])
  })

  it('says how many duties have nobody, and leads to them in the register', async () => {
    const { done } = mounted('management', '/pflichtenuebertragungen')

    await done
    await screen.findByRole('table', { name: listTable })

    expect(
      screen.getByText(
        '3 Pflichten in Ihren Bereichen haben keine verantwortliche Person, 1 eine ohne Übertragung.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Im Pflichtenverzeichnis anzeigen' }).getAttribute('href'),
    ).toBe('/pflichten?verantwortlich=none')
  })

  it('writes a delegation whole, with the person, the areas, the scope, the period, the tasks and the powers', async () => {
    const user = userEvent.setup()
    const { written, done } = mounted('management', '/pflichtenuebertragungen')

    await done
    await untilTheRightsAreKnown()
    await user.click(await screen.findByRole('button', { name: 'Übertragung anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Übertragung anlegen' }))

    await waitFor(() => {
      // Whoever is shut out of the operator is offered to nobody anew.
      expect(
        dialog
          .getAllByRole('option')
          .map((option) => option.textContent)
          .filter((label) => label !== 'Bitte wählen'),
      ).toEqual(['Jörg Albrecht'])
    })
    await user.selectOptions(dialog.getByLabelText(/^Beauftragte Person/), 'u-albrecht')
    await user.click(dialog.getByRole('checkbox', { name: 'Nord' }))
    await user.click(dialog.getByRole('checkbox', { name: 'Süd' }))
    await user.type(dialog.getByLabelText(/^Beginn/), '2026-11-01')
    await user.type(dialog.getByLabelText(/^Ende/), '2028-10-31')
    await user.type(dialog.getByLabelText(/^Aufgaben/), tasks)
    await user.type(dialog.getByLabelText(/^Befugnisse/), powers)
    await user.click(dialog.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/delegations',
          body: {
            delegateUserId: 'u-albrecht',
            areaIds: ['a-nord', 'a-sued'],
            scope: 'all',
            packages: [],
            costGroups: [],
            tasks,
            powers,
            startsOn: '2026-11-01',
            endsOn: '2028-10-31',
          },
        },
      ])
    })
  })

  it('sends nothing without a person and an area, and says what is missing', async () => {
    const user = userEvent.setup()
    const { written, done } = mounted('management', '/pflichtenuebertragungen')

    await done
    await untilTheRightsAreKnown()
    await user.click(await screen.findByRole('button', { name: 'Übertragung anlegen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Übertragung anlegen' }))

    await user.click(dialog.getByRole('button', { name: 'Anlegen' }))

    expect(dialog.getByText('Wählen Sie die beauftragte Person.')).toBeTruthy()
    expect(dialog.getByText('Wählen Sie mindestens einen Bereich.')).toBeTruthy()
    expect(written).toEqual([])
  })
})

describe('the page of a delegation', () => {
  it('offers a draft to be changed, removed and signed for the operator, and nothing to revoke', async () => {
    const { done } = mounted('management', '/pflichtenuebertragungen/albrecht')

    await done
    await screen.findByRole('heading', { level: 1, name: 'Pflichtenübertragung an Jörg Albrecht' })

    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unterschreiben' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Widerrufen' })).toBeNull()
    expect(screen.getByText(delegationWords.operatorWaits)).toBeTruthy()
    expect(screen.getByText(delegationWords.delegateWaits('Jörg Albrecht'))).toBeTruthy()
  })

  it('is signed for the operator with the own name typed, for the page that was shown', async () => {
    const user = userEvent.setup()
    const { written, done } = mounted('management', '/pflichtenuebertragungen/albrecht')

    await done
    await user.click(await screen.findByRole('button', { name: 'Unterschreiben' }))
    await user.click(screen.getByRole('button', { name: 'Ohne Schriftzug unterschreiben' }))
    await user.type(screen.getByRole('textbox', { name: 'Ihr Name' }), 'Pia Person')
    await user.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'POST',
      path: '/delegations/albrecht/sign',
      body: {
        pageFingerprint: await fingerprintOf(albrecht['page'] as never),
        path: null,
        typedName: 'Pia Person',
      },
    })
  })

  it('shows a signed one with both signatures, the duties in its scope and its deadline, and changes it in no way', async () => {
    const { done } = mounted('management', '/pflichtenuebertragungen/lindner')

    await done
    await screen.findByRole('heading', { level: 1, name: 'Pflichtenübertragung an Petra Lindner' })

    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unterschreiben' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Widerrufen' })).toBeTruthy()
    expect(screen.getByText('Sabine Krämer')).toBeTruthy()
    expect(
      rowsOf('Pflichten im Umfang der Übertragung mit Ort und wer heute verantwortlich ist'),
    ).toEqual([
      ['Prüfung ortsveränderlicher GeräteWerkhof Nord, Halle 1', 'Petra Lindnerohne Übertragung'],
    ])
    expect(screen.getByText('Ende einer Pflichtenübertragung')).toBeTruthy()
  })

  it('is revoked from a day with a reason, and sends nothing without one', async () => {
    const user = userEvent.setup()
    const { written, done } = mounted('management', '/pflichtenuebertragungen/lindner')

    await done
    await user.click(await screen.findByRole('button', { name: 'Widerrufen' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Übertragung widerrufen' }))

    await user.click(dialog.getByRole('button', { name: 'Widerrufen' }))
    expect(written).toEqual([])

    await user.type(dialog.getByLabelText(/^Grund/), 'Wechsel in die Verwaltung')
    await user.click(dialog.getByRole('button', { name: 'Widerrufen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/delegations/lindner/revoke',
          body: { effectiveOn: today(), reason: 'Wechsel in die Verwaltung' },
        },
      ])
    })
  })
})

describe('the delegations under "Konto"', () => {
  const mine = [
    entry('to-me', 'Pia Person', { state: 'waiting' }),
    entry('signed', 'Pia Person', { areas: [sued], state: 'in_force' }),
  ]
  const toSign = reading('to-me', 'Pia Person', {
    state: 'waiting',
    signatures: [operatorSigned],
    signs: 'delegate',
  })

  it('lists the delegations to the person, the one waiting with the way to sign it, the signed one with its copy', async () => {
    const { done } = mounted('technician', '/konto', { '/delegations/mine': mine })

    await done

    const table = 'Ihre Pflichtenübertragungen mit Umfang, Zeitraum und Stand'

    await screen.findByRole('table', { name: table })

    expect(rowsOf(table)).toEqual([
      [
        'Pflichtenübertragung, Bereich NordAlle Pflichten · 01.11.2026 bis 31.10.2028',
        myDelegationWords.waiting,
        'Lesen und unterschreiben',
      ],
      [
        'Pflichtenübertragung, Bereich SüdAlle Pflichten · 01.11.2026 bis 31.10.2028',
        'In Kraft',
        myDelegationWords.copy,
      ],
    ])
  })

  it('is read whole and signed by the person it goes to, for the page that was shown', async () => {
    const user = userEvent.setup()
    const { written, done } = mounted('technician', '/konto', {
      '/delegations/mine': mine,
      '/delegations/to-me': toSign,
    })

    await done
    await user.click(await screen.findByRole('button', { name: 'Lesen und unterschreiben' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: 'Pflichtenübertragung unterschreiben' }),
    )

    expect(await dialog.findByText(tasks)).toBeTruthy()
    expect(dialog.getByText('Für den Betreiber unterschrieben von Sabine Krämer.')).toBeTruthy()

    await user.click(dialog.getByRole('button', { name: 'Ohne Schriftzug unterschreiben' }))
    await user.type(dialog.getByRole('textbox', { name: 'Ihr Name' }), 'Pia Person')
    await user.click(dialog.getByRole('button', { name: 'Unterschreiben' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'POST',
      path: '/delegations/to-me/sign',
      body: {
        pageFingerprint: await fingerprintOf(toSign['page'] as never),
        path: null,
        typedName: 'Pia Person',
      },
    })
  })

  it('is not there for somebody to whom nothing was delegated', async () => {
    const { done } = mounted('technician', '/konto', { '/delegations/mine': [] })

    await done
    await screen.findByRole('heading', { level: 1, name: 'Konto' })

    expect(screen.queryByRole('table', { name: /Ihre Pflichtenübertragungen/ })).toBeNull()
  })
})
