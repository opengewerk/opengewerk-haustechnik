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
 * "Lager" (#325, 4.12 of the concept, the boards of that name): the stock of
 * a store with its minimums, a receipt and a count, the articles and one
 * article in one store. Every role looks; whoever keeps the stores books.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const stores = [
  { id: 's-main', name: 'Hauptlager Betriebshof', location: null, belowCount: 1 },
  { id: 's-school', name: 'Werkstatt Schulzentrum', location: null, belowCount: 0 },
]

const lines = [
  {
    articleId: 'r-akku',
    number: 'A-1002',
    designation: 'Akku Notleuchte 3,6 V',
    unit: 'piece',
    levelMilli: 3000,
    minimumMilli: 10_000,
    below: true,
    removed: false,
  },
  {
    articleId: 'r-cable',
    number: 'A-1020',
    designation: 'Mantelleitung NYM-J 3×1,5',
    unit: 'metre',
    levelMilli: 85_500,
    minimumMilli: null,
    below: false,
    removed: false,
  },
]

const article = {
  id: 'r-akku',
  number: 'A-1002',
  designation: 'Akku Notleuchte 3,6 V',
  description: null,
  ean: '4012345678901',
  unit: 'piece',
  priceCents: 890,
  deletedAt: null,
}

const cable = {
  ...article,
  id: 'r-cable',
  number: 'A-1020',
  designation: 'Mantelleitung NYM-J 3×1,5',
  ean: null,
  unit: 'metre',
  priceCents: null,
}

const answers = {
  '/stores': stores,
  '/stores/s-main/stock': { storeId: 's-main', name: stores[0]?.name, lines, belowCount: 1 },
  '/stores/s-main/stock?below=1': {
    storeId: 's-main',
    name: stores[0]?.name,
    lines: [lines[0]],
    belowCount: 1,
  },
  '/articles': [article, cable],
  '/suppliers': [{ id: 'p-elektro', name: 'Elektro-Großhandel Beispiel GmbH' }],
  '/stores/s-main/articles/r-akku': {
    store: { id: 's-main', name: 'Hauptlager Betriebshof' },
    article,
    levelMilli: 3000,
    minimumMilli: 10_000,
    below: true,
    movements: [
      {
        id: 'm-3',
        kind: 'withdrawal',
        quantityMilli: 2000,
        levelAfterMilli: 3000,
        bookedOn: '2026-10-13',
        supplier: null,
        reason: null,
        workOrder: { id: 'ac-1', number: 'AU-2026-0031', title: 'Notleuchte Flur instand setzen' },
      },
      {
        id: 'm-2',
        kind: 'count',
        quantityMilli: 5000,
        levelAfterMilli: 5000,
        bookedOn: '2026-10-01',
        supplier: null,
        reason: 'Inventur, ein Akku defekt ausgesondert',
        workOrder: null,
      },
      {
        id: 'm-1',
        kind: 'receipt',
        quantityMilli: 6000,
        levelAfterMilli: 6000,
        bookedOn: '2026-09-22',
        supplier: 'Elektro-Großhandel Beispiel GmbH',
        reason: 'Lieferschein 4690-11',
        workOrder: null,
      },
    ],
  },
}

function mounted(role: RoleKey, at = '/lager') {
  const written = signedInOffice(role, [nord], answers, (write: Written) => ({
    status: write.method === 'POST' ? 201 : 200,
    body: { id: 'made', levelMilli: 23_000, words: '23 Stück', minimumMilli: 12_000 },
  }))

  return { written, done: mountOffice(at, new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

/** The stock with one line taken below zero on site (#326). */
const negative = {
  storeId: 's-main',
  name: 'Hauptlager Betriebshof',
  lines: [{ ...lines[1], levelMilli: -2000 }],
  belowCount: 0,
}

const stockTable =
  'Bestand im Lager Hauptlager Betriebshof mit Nummer, Artikel, Einheit, Bestand und Mindestbestand'

describe('the stock of a store', () => {
  it('shows every article with its stock and minimum, and says which are below it', async () => {
    const { done } = mounted('technician')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: stockTable })

    expect(rowsOf(stockTable)).toEqual([
      ['A-1002', 'Akku Notleuchte 3,6 V', 'Stück', '3', '10', 'unter Mindestbestand'],
      ['A-1020', 'Mantelleitung NYM-J 3×1,5', 'm', '85,5', 'keiner', ''],
    ])
    expect(screen.getByRole('checkbox', { name: 'Nur unter Mindestbestand (1)' })).toBeDefined()
  })

  it('offers the Haustechnik, which only looks, no booking and no new store', async () => {
    const looking = mounted('technician')

    await looking.done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: stockTable })

    expect(screen.queryByRole('button', { name: 'Wareneingang' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Zählung' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lager anlegen' })).toBeNull()
  })

  it('narrows to what is below its minimum, the list to order from', async () => {
    const { done } = mounted('site_management', '/lager?lager=s-main&unter=1')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: stockTable })

    expect(rowsOf(stockTable).map((row) => row[0])).toEqual(['A-1002'])
  })

  it('books a receipt in thousandths of the unit, with its supplier and note', async () => {
    const { written, done } = mounted('site_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Wareneingang' }))

    const dialog = await screen.findByRole('dialog', { name: 'Wareneingang' })

    // A barcode of the manufacturer chooses its article at once.
    await userEvent.type(within(dialog).getByLabelText('Suchen'), '4012345678901')
    expect((within(dialog).getByLabelText(/^Artikel/) as HTMLSelectElement).value).toBe('r-akku')
    await userEvent.type(within(dialog).getByLabelText(/^Menge/), '20')
    await userEvent.selectOptions(within(dialog).getByLabelText('Lieferant'), 'p-elektro')
    await userEvent.type(within(dialog).getByLabelText('Bemerkung'), 'Lieferschein 4711-23')
    expect(within(dialog).getByText(/steigt von 3 Stück auf 23 Stück/)).toBeDefined()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eingang buchen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/stores/s-main/movements',
          body: {
            articleId: 'r-akku',
            kind: 'receipt',
            quantityMilli: 20_000,
            supplierId: 'p-elektro',
            reason: 'Lieferschein 4711-23',
          },
        },
      ])
    })
  })

  it('books a count only with its reason, and names no supplier at it', async () => {
    const { written, done } = mounted('site_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Zählung' }))

    const dialog = await screen.findByRole('dialog', { name: 'Zählung' })

    await userEvent.selectOptions(within(dialog).getByLabelText(/^Artikel/), 'r-cable')
    await userEvent.type(within(dialog).getByLabelText(/^Gezählter Bestand/), '80,25')
    expect(
      within(dialog).getByText('Gebucht steht 85,5 m. Die Zählung berichtigt um -5,25.'),
    ).toBeDefined()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zählung buchen' }))
    expect(written).toEqual([])

    await userEvent.type(within(dialog).getByLabelText(/^Grund/), 'Inventur Oktober')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zählung buchen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/stores/s-main/movements',
          body: {
            articleId: 'r-cable',
            kind: 'count',
            quantityMilli: 80_250,
            supplierId: null,
            reason: 'Inventur Oktober',
          },
        },
      ])
    })
  })
})

describe('the stock below zero and the labels of the shelves', () => {
  it('says a stock below zero, which two devices without a network can bring', async () => {
    signedInOffice('technician', [nord], { ...answers, '/stores/s-main/stock': negative })
    await mountOffice('/lager', new TestServer(), [])
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: stockTable })

    expect(rowsOf(stockTable)).toEqual([
      ['A-1020', 'Mantelleitung NYM-J 3×1,5', 'm', '-2', 'keiner', 'negativ, bitte zählen'],
    ])
  })

  it('prints the labels for the shelves without a barcode, for whoever keeps the stores', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:etiketten' }))
    URL.revokeObjectURL = () => undefined

    const { written, done } = mounted('site_management')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Etiketten drucken' }))

    const dialog = await screen.findByRole('dialog', { name: 'Etiketten drucken' })

    // The cable has no barcode; the battery has one.
    expect(
      within(dialog).getByRole('option', { name: 'Die 1 Artikel dieses Lagers ohne EAN' }),
    ).toBeDefined()
    await userEvent.click(within(dialog).getByRole('button', { name: 'PDF erzeugen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/stores/s-main/labels/print',
          body: { which: 'withoutEan', format: 'sheet', start: 1 },
        },
      ])
    })
    expect(await within(dialog).findByRole('link', { name: 'PDF öffnen' })).toBeDefined()
  })

  it('offers no labels to the Haustechnik, which only looks', async () => {
    const { done } = mounted('technician')

    await done
    await untilTheRightsAreKnown()
    await screen.findByRole('table', { name: stockTable })
    expect(screen.queryByRole('button', { name: 'Etiketten drucken' })).toBeNull()
  })
})

describe('an article', () => {
  it('is made with its price in cents, and not with a barcode whose check digit is wrong', async () => {
    const { written, done } = mounted('site_management', '/lager/artikel')

    await done
    await untilTheRightsAreKnown()
    await userEvent.click(await screen.findByRole('button', { name: 'Artikel anlegen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Artikel anlegen' })

    await userEvent.type(within(dialog).getByLabelText(/^Nummer/), 'A-1050')
    await userEvent.type(within(dialog).getByLabelText(/^Bezeichnung/), 'Lüfterklappe DN 125')
    await userEvent.type(within(dialog).getByLabelText('EAN'), '4006381333932')
    await userEvent.type(within(dialog).getByLabelText(/^Preis/), '23,80')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))
    expect(written).toEqual([])

    await userEvent.clear(within(dialog).getByLabelText('EAN'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/articles',
          body: {
            number: 'A-1050',
            designation: 'Lüfterklappe DN 125',
            ean: null,
            unit: 'piece',
            priceCents: 2380,
            description: null,
          },
        },
      ])
    })
  })

  it('in a store shows every booking with what it changed and the stock after it', async () => {
    const { done } = mounted('technician', '/lager/s-main/artikel/r-akku')

    await done
    await untilTheRightsAreKnown()

    const name = 'Buchungen mit Tag, Art, Menge, Bestand danach und Anlass'

    await screen.findByRole('table', { name })
    expect(rowsOf(name)).toEqual([
      ['13.10.2026', 'Entnahme', '−2', '3', 'AU-2026-0031 Notleuchte Flur instand setzen'],
      ['01.10.2026', 'Zählung', '−1', '5', 'Inventur, ein Akku defekt ausgesondert'],
      [
        '22.09.2026',
        'Eingang',
        '+6',
        '6',
        'Elektro-Großhandel Beispiel GmbH, Lieferschein 4690-11',
      ],
    ])
    // Looking, the Haustechnik changes no minimum.
    expect((screen.getByLabelText(/^Mindestbestand/) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })

  it('in a store keeps the minimum whoever keeps the stores sets', async () => {
    const { written, done } = mounted('site_management', '/lager/s-main/artikel/r-akku')

    await done
    await untilTheRightsAreKnown()

    const minimum = await screen.findByLabelText(/^Mindestbestand/)

    await userEvent.clear(minimum)
    await userEvent.type(minimum, '12')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/stores/s-main/articles/r-akku/minimum',
          body: { minimumMilli: 12_000 },
        },
      ])
    })
  })
})
