import type { CatalogueBundle, OwnKindsReading } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import { ownKindWords } from '../own-kind-dialogs.js'
import { mountOffice, onA, rowsOf, signedInOffice, type Written } from '../test-office.js'
import { ownKindScreenWords } from './own-kinds.js'

/**
 * The asset kinds and fields of the operator's own in the office (#62):
 * under "Katalog" beside the packages, read by everybody from the catalogue
 * on the device, kept by the Leitung and the Technische Leitung over the
 * routes of the server.
 */

const lifting = {
  key: 'eigen.hebeanlage',
  version: 2,
  validFrom: '2000-01-01',
  definition: {
    label: 'Hebeanlage',
    costGroup: '412',
    characteristics: [],
    fields: [
      { key: 'eigen_foerdermenge', label: 'Fördermenge', kind: 'number' as const, unit: 'm³/h' },
      {
        key: 'eigen_pumpen',
        label: 'Pumpen',
        kind: 'choice' as const,
        options: [
          { value: 'o1', label: 'Einzelanlage' },
          { value: 'o2', label: 'Doppelanlage' },
        ],
      },
    ],
    expectedDocuments: [
      {
        key: 'wartung',
        label: 'Wartungsnachweis',
        kind: 'test_certificate' as const,
        demand: 'required' as const,
        source: 'DIN EN 12056-4, Abschnitt 8',
      },
    ],
    meter: null,
  },
  review: { checkedOn: '2026-10-18', accepted: null },
}

const withOwn: CatalogueBundle = {
  ...testCatalogue,
  sha256: '2'.repeat(64),
  own: {
    assetKinds: [lifting],
    fields: {
      'probe.elevator': [{ key: 'eigen_notruf', label: 'Notrufnummer', kind: 'text' }],
    },
  },
}

const reading: OwnKindsReading = {
  kinds: [
    {
      id: 'k-1',
      key: 'eigen.hebeanlage',
      label: 'Hebeanlage',
      costGroup: '412',
      expectedDocuments: lifting.definition.expectedDocuments,
      version: 2,
      changedOn: '2026-10-18',
      assets: 4,
      fields: [
        {
          id: 'f-1',
          assetKind: 'eigen.hebeanlage',
          key: 'eigen_foerdermenge',
          label: 'Fördermenge',
          sort: 'number',
          unit: 'm³/h',
          options: [],
          position: 0,
          values: 4,
        },
        {
          id: 'f-2',
          assetKind: 'eigen.hebeanlage',
          key: 'eigen_pumpen',
          label: 'Pumpen',
          sort: 'choice',
          unit: null,
          options: [
            { value: 'o1', label: 'Einzelanlage' },
            { value: 'o2', label: 'Doppelanlage' },
          ],
          position: 1,
          values: 0,
        },
      ],
    },
  ],
  fields: [
    {
      id: 'f-3',
      assetKind: 'probe.elevator',
      key: 'eigen_notruf',
      label: 'Notrufnummer',
      sort: 'text',
      unit: null,
      options: [],
      position: 0,
      values: 3,
    },
  ],
}

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

describe('what the operator added, under "Katalog"', () => {
  it('stands as a row beside the packages and is read by everybody from the catalogue on the device', async () => {
    signedInOffice('technician', [], servingCatalogue(withOwn))

    const asked = askedPaths()

    await mountOffice('/katalog/eigen', new TestServer(), [])

    const table = await screen.findByRole('table', {
      name: 'Eigene Anlagenarten mit Kostengruppe, Angaben und Unterlagen',
    })

    expect(rowsOf('Eigene Anlagenarten mit Kostengruppe, Angaben und Unterlagen')).toEqual([
      ['HebeanlageEigene Anlagenart', 'KG 412', '2', '1'],
    ])
    expect(within(table).getByRole('link', { name: 'Hebeanlage' }).getAttribute('href')).toBe(
      '/katalog/eigen/arten/hebeanlage',
    )
    // Nobody here keeps them: nothing to make, and the server is not asked.
    expect(screen.queryByRole('button', { name: ownKindWords.makeKind })).toBeNull()
    expect(asked.filter((path) => path.startsWith('/own-kinds'))).toEqual([])
  })

  it('lists the own fields at kinds of the packages with their kind', async () => {
    signedInOffice('technician', [], servingCatalogue(withOwn))
    await mountOffice('/katalog/eigen/angaben', new TestServer(), [])

    await screen.findByRole('table', {
      name: 'Eigene Angaben an Anlagenarten aus Paketen mit Sorte',
    })

    expect(rowsOf('Eigene Angaben an Anlagenarten aus Paketen mit Sorte')).toEqual([
      ['AufzugsanlageProbepaket', 'Notrufnummer', 'Text'],
    ])
  })

  it('is kept by the Leitung, with what uses each, and a kind made there opens its page', async () => {
    const written: Written[] = []

    signedInOffice(
      'management',
      [],
      { ...servingCatalogue(withOwn), '/own-kinds': reading },
      (write) => {
        written.push(write)

        return { status: 201, body: { id: 'k-2', key: 'eigen.torantrieb' } }
      },
    )
    await mountOffice('/katalog/eigen', new TestServer(), [])
    await screen.findByText('4', { selector: 'td' })

    expect(rowsOf('Eigene Anlagenarten mit Kostengruppe, Angaben und Unterlagen')).toEqual([
      ['HebeanlageEigene Anlagenart', 'KG 412', '2', '1', '4'],
    ])

    fireEvent.click(screen.getByRole('button', { name: ownKindWords.makeKind }))

    const dialog = await screen.findByRole('dialog', { name: ownKindWords.makeKind })

    fireEvent.change(within(dialog).getByLabelText(/Bezeichnung/), {
      target: { value: 'Torantrieb Tiefgarage' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Kostengruppe/), { target: { value: '461' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))

    await vi.waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/own-kinds',
          body: { label: 'Torantrieb Tiefgarage', costGroup: '461' },
        },
      ])
    })
  })

  it('takes a field at a kind of a package with its sort and its choices', async () => {
    const written: Written[] = []

    signedInOffice(
      'technical_management',
      [],
      { ...servingCatalogue(withOwn), '/own-kinds': reading },
      (write) => {
        written.push(write)

        return { status: 201, body: { id: 'f-4' } }
      },
    )
    await mountOffice('/katalog/eigen/angaben', new TestServer(), [])
    fireEvent.click(await screen.findByRole('button', { name: ownKindWords.addField }))

    const dialog = await screen.findByRole('dialog', { name: ownKindWords.addField })

    fireEvent.change(within(dialog).getByLabelText(/Anlagenart/), {
      target: { value: 'probe.elevator' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Bezeichnung/), {
      target: { value: 'Prüfplakette' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Auswahl' }))
    fireEvent.change(within(dialog).getByLabelText(/^Auswahl/), {
      target: { value: 'vorhanden\nfehlt\n\nabgelaufen' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ergänzen' }))

    await vi.waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/own-kinds/fields',
          body: {
            label: 'Prüfplakette',
            options: ['vorhanden', 'fehlt', 'abgelaufen'],
            assetKind: 'probe.elevator',
            sort: 'choice',
          },
        },
      ])
    })
  })

  it('says why it refuses, as the server says it', async () => {
    signedInOffice(
      'management',
      [],
      { ...servingCatalogue(withOwn), '/own-kinds': reading },
      () => ({
        status: 400,
        body: { message: 'Die Kostengruppe ist keine, die der Katalog kennt.' },
      }),
    )
    await mountOffice('/katalog/eigen', new TestServer(), [])
    fireEvent.click(await screen.findByRole('button', { name: ownKindWords.makeKind }))

    const dialog = await screen.findByRole('dialog', { name: ownKindWords.makeKind })

    fireEvent.change(within(dialog).getByLabelText(/Bezeichnung/), { target: { value: 'Tor' } })
    fireEvent.change(within(dialog).getByLabelText(/Kostengruppe/), { target: { value: '461' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Die Kostengruppe ist keine, die der Katalog kennt.',
    )
  })
})

describe('the page of an own kind', () => {
  it('shows its fields and documents, and that the catalogue proposes no duty for it', async () => {
    signedInOffice('technician', [], servingCatalogue(withOwn))
    await mountOffice('/katalog/eigen/arten/hebeanlage', new TestServer(), [])

    expect(await screen.findByRole('heading', { level: 1, name: 'Hebeanlage' })).toBeDefined()
    expect(rowsOf('Angaben der Anlagenart Hebeanlage')).toEqual([
      ['Fördermenge', 'Zahl', 'm³/h'],
      ['Pumpen', 'Auswahl', 'Einzelanlage, Doppelanlage'],
    ])
    expect(rowsOf('Unterlagen der Anlagenart Hebeanlage')).toEqual([
      ['Wartungsnachweis', 'Prüfbescheinigung', 'verlangtDIN EN 12056-4, Abschnitt 8'],
    ])
    expect(screen.getByText(ownKindScreenWords.duties)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
  })

  it('lets the Leitung remove a field nobody holds, and not one an asset holds, nor a kind assets carry', async () => {
    const written: Written[] = []

    signedInOffice(
      'management',
      [],
      { ...servingCatalogue(withOwn), '/own-kinds': reading },
      (write) => {
        written.push(write)

        return { status: 200, body: {} }
      },
    )
    await mountOffice('/katalog/eigen/arten/hebeanlage', new TestServer(), [])
    await screen.findByText('4 Anlagen')

    expect(
      (screen.getAllByRole('button', { name: 'Entfernen' })[0] as HTMLButtonElement).disabled,
    ).toBe(true)

    const fields = screen.getByRole('table', { name: 'Angaben der Anlagenart Hebeanlage' })
    const [flow, pumps] = within(fields).getAllByRole('row').slice(1)

    expect(within(flow as HTMLElement).queryByRole('button', { name: 'Entfernen' })).toBeNull()

    fireEvent.click(within(pumps as HTMLElement).getByRole('button', { name: 'Entfernen' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: 'Pumpen entfernen?' })).getByRole(
        'button',
        {
          name: 'Entfernen',
        },
      ),
    )

    await vi.waitFor(() => {
      expect(written).toEqual([
        { method: 'DELETE', path: '/own-kinds/fields/f-2', body: undefined },
      ])
    })
  })

  it('takes a document the kind expects, after those it has', async () => {
    const written: Written[] = []

    signedInOffice(
      'management',
      [],
      { ...servingCatalogue(withOwn), '/own-kinds': reading },
      (write) => {
        written.push(write)

        return { status: 200, body: {} }
      },
    )
    await mountOffice('/katalog/eigen/arten/hebeanlage', new TestServer(), [])
    fireEvent.click(await screen.findByRole('button', { name: ownKindWords.addDocument }))

    const dialog = await screen.findByRole('dialog', { name: ownKindWords.addDocument })

    fireEvent.change(within(dialog).getByLabelText(/Bezeichnung/), {
      target: { value: 'Betriebsanleitung' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Art des Dokuments/), {
      target: { value: 'operating_manual' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ergänzen' }))

    await vi.waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PATCH',
          path: '/own-kinds/k-1',
          body: {
            expectedDocuments: [
              ...lifting.definition.expectedDocuments,
              {
                label: 'Betriebsanleitung',
                kind: 'operating_manual',
                demand: 'recommended',
                source: null,
              },
            ],
          },
        },
      ])
    })
  })

  it('names nothing for a key that is no kind of the operator', async () => {
    signedInOffice('technician', [], servingCatalogue(withOwn))
    await mountOffice('/katalog/eigen/arten/gibt_es_nicht', new TestServer(), [])

    expect(await screen.findByRole('heading', { level: 1, name: 'Nicht im Katalog' })).toBeDefined()
  })
})
