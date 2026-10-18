import {
  offerableRights,
  type Right,
  type RoleEntry,
  type RoleKey,
  shippedRoles,
  withImplied,
} from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'

/**
 * "Einstellungen", "Rollen" (#346, section 7 of the concept): the roles of
 * the tenant with what each holds, a shipped one as it stays, and a role of
 * the tenant's own made and changed with what comes with its rights, for
 * whoever keeps the accesses.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const shipped: RoleEntry[] = shippedRoles.map((role, index) => ({
  key: role.key,
  label: role.label,
  rights: [...role.rights],
  leads: role.leads,
  secondFactor: role.secondFactor,
  shipped: true,
  holders: [1, 1, 2, 3, 0, 1][index] ?? 0,
  invited: 0,
  newRights: [],
}))

const caretakerRights: Right[] = withImplied([
  'room.record',
  'asset.record',
  'reading.write',
  'duty.read',
  'activity.perform',
  'defect.report',
  'fault.report',
  'document.record',
  'task.record',
  'store.write',
  'sync.write',
  'push.write',
])

const caretaker: RoleEntry = {
  key: 'own-0123456789ab',
  label: 'Hausmeisterei',
  rights: caretakerRights,
  leads: false,
  secondFactor: false,
  shipped: false,
  holders: 2,
  invited: 0,
  newRights: ['contractor.read'],
}

const stores: RoleEntry = {
  key: 'own-ba9876543210',
  label: 'Lagerverwaltung',
  rights: ['store.read', 'store.write'],
  leads: false,
  secondFactor: true,
  shipped: false,
  holders: 0,
  invited: 0,
  newRights: [],
}

const everyRole = [...shipped, caretaker, stores]

const caption =
  'Rollen dieses Betreibers mit ihren Rechten, wie vielen Zugängen jede zugeordnet ist und ob sie einen zweiten Faktor verlangt'

let server: TestServer
let written: Written[]
let answerToWrite: (write: Written) => WriteAnswer

function mount(at: string, role: RoleKey = 'management') {
  written = signedInOffice(role, [nord], { '/roles': everyRole }, (write) => answerToWrite(write))

  return mountOffice(at, server, [])
}

/** The box of a right on the page of a role, by what it is called. */
function box(label: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: new RegExp(`^${label}`) })
}

beforeEach(() => {
  localStorage.clear()
  onA('desktop')
  server = new TestServer()
  answerToWrite = () => ({ status: 500, body: { message: 'Nicht erwartet.' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list of the roles', () => {
  it('names each role with its kind, what it holds, how many hold it and a second factor, and what is new for one of its own', async () => {
    await mount('/einstellungen/rollen')
    await screen.findByRole('table', { name: caption })

    expect(rowsOf(caption)).toEqual([
      ['Leitungführt den Betreiber', 'mitgeliefert', 'alle 50', '1', 'Pflicht', 'Ansehen'],
      ['Technische Leitung', 'mitgeliefert', '42 von 44', '1', '', 'Ansehen'],
      ['Objektleitung', 'mitgeliefert', '33 von 44', '2', '', 'Ansehen'],
      ['Haustechnik', 'mitgeliefert', '21 von 44', '3', '', 'Ansehen'],
      ['Melder', 'mitgeliefert', '4 von 44', '0', '', 'Ansehen'],
      ['Prüfer', 'mitgeliefert', '3 von 44', '1', '', 'Ansehen'],
      [
        'Hausmeisterei',
        'eigene',
        `${String(caretakerRights.length)} von 441 neues Recht`,
        '2',
        '',
        'Bearbeiten',
      ],
      ['Lagerverwaltung', 'eigene', '2 von 44', '0', 'Pflicht', 'BearbeitenEntfernen'],
    ])
    expect(
      screen.getByText(
        'Seit der letzten Änderung von „Hausmeisterei“ kam ein Recht dazu, das eine eigene Rolle nicht von selbst bekommt: Fremdfirmen ansehen.',
      ),
    ).toBeTruthy()
  })

  it('removes a role of its own nobody holds, after a question, and offers it for no other', async () => {
    answerToWrite = () => ({ status: 200, body: undefined })
    await mount('/einstellungen/rollen')
    await screen.findByRole('table', { name: caption })
    await untilTheRightsAreKnown()

    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Entfernen' }),
    )

    await waitFor(() => {
      expect(written).toEqual([{ method: 'DELETE', path: `/roles/${stores.key}`, body: undefined }])
    })
  })
})

describe('a role of the tenant’s own', () => {
  it('starts from a shipped role with what a role of its own may hold of it, and sends what comes with each right', async () => {
    answerToWrite = (write) => ({
      status: 201,
      body: {
        ...stores,
        key: 'own-new',
        label: 'Hof',
        rights: (write.body as { rights: Right[] }).rights,
      },
    })
    await mount('/einstellungen/rollen/neu?von=technician')
    await screen.findByRole('heading', { level: 1, name: 'Neue Rolle' })

    // What the Haustechnik holds, ticked.
    expect(box('Zähler ablesen').checked).toBe(true)
    expect(box('Anlagen pflegen').checked).toBe(false)

    // Whoever may care for assets sees them: the box to look at them is ticked and fixed.
    fireEvent.click(box('Anlagen pflegen'))
    expect(box('Anlagen ansehen').disabled).toBe(true)
    expect(screen.getAllByText('kommt mit „Anlagen aufnehmen“').length).toBeGreaterThan(0)

    // What stays with the Leitung stands there without a box.
    const reserved = within(screen.getByRole('list', { name: 'Bleibt der Leitung' }))

    expect(reserved.getByText('Das Änderungsprotokoll einsehen')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: /Änderungsprotokoll/ })).toBeNull()

    fireEvent.change(screen.getByLabelText(/^Bezeichnung/), { target: { value: 'Hof' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /^Zweiter Faktor Pflicht/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    const technician = shippedRoles.find((role) => role.key === 'technician')?.rights ?? []

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/roles',
          body: {
            label: 'Hof',
            rights: withImplied([
              ...offerableRights.filter((right) => technician.includes(right)),
              'asset.write',
            ]),
            secondFactor: true,
          },
        },
      ])
    })
  })

  it('sends nothing without a label', async () => {
    await mount('/einstellungen/rollen/neu')
    await screen.findByRole('heading', { level: 1, name: 'Neue Rolle' })

    fireEvent.click(box('Lager ansehen'))
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }))

    expect(await screen.findByText('Die Bezeichnung fehlt.')).toBeTruthy()
    expect(written).toEqual([])
  })

  it('is changed with its label, its rights and its second factor, marks what is new, and is not removed while held', async () => {
    answerToWrite = (write) => ({ status: 200, body: { ...caretaker, ...(write.body as object) } })
    await mount(`/einstellungen/rollen/${caretaker.key}`)
    await screen.findByRole('heading', { level: 1, name: 'Hausmeisterei' })
    await untilTheRightsAreKnown()

    expect(screen.getByRole('checkbox', { name: /^Fremdfirmen ansehen\s*neu/ })).toBeTruthy()
    expect(
      screen.getByText(
        'Entfernen geht, sobald die Rolle keinem Zugang und keiner offenen Einladung mehr zugeordnet ist. Sie ist 2 Zugängen zugeordnet.',
      ),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Entfernen' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.click(box('Fremdfirmen ansehen'))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PATCH',
          path: `/roles/${caretaker.key}`,
          body: {
            label: 'Hausmeisterei',
            rights: withImplied([...caretakerRights, 'contractor.read']),
            secondFactor: false,
          },
        },
      ])
    })
  })
})

describe('a shipped role', () => {
  it('stays as it is, read only, and leads to a role of the tenant’s own that starts from it', async () => {
    const { router } = await mount('/einstellungen/rollen/site_management')

    await screen.findByRole('heading', { level: 1, name: 'Objektleitung' })
    await untilTheRightsAreKnown()

    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(
      within(screen.getByRole('list', { name: 'Vorgänge' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Vorgänge ansehen: ja',
      'Vorgänge ausführen: ja',
      'Vorgänge planen und verteilen: ja',
      'Vorlagen der Rundgänge führen: ja',
      'Aufträge abnehmen und Rundgänge gegenzeichnen: ja',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Als eigene Rolle anlegen' }))

    await waitFor(() => {
      expect(router.state.location.href).toBe('/einstellungen/rollen/neu?von=site_management')
    })
  })
})
