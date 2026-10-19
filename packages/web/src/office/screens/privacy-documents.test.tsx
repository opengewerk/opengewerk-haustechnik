import type { PrivacyDocuments, ProcessingDescriptions } from '@opengewerk/haustechnik-domain'
import { processingWords } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'
import { privacyScreenWords } from './privacy-documents.js'
import { recordScreenWords } from './processing-record.js'

/**
 * "Einstellungen", "Datenschutz" with the record of the processing, the
 * measures and the deletion concept (#358): what each says of the operator
 * now, a document made now, and every one made with its PDF.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const description: ProcessingDescriptions = { facts: [], changedSinceNewest: null, versions: [] }

const documents = (partB: boolean): PrivacyDocuments => ({
  kinds: [
    {
      kind: 'record',
      facts: [
        { label: 'Verantwortlicher', value: 'Wohnbau Nord eG, Hafenweg 1' },
        { label: 'Tätigkeiten', value: '13, davon 9 bestätigt und 4 als Vorschlag der Anwendung' },
      ],
      changedSinceNewest: ['3'],
    },
    {
      kind: 'measures',
      facts: [
        { label: 'Teil A', value: 'aus der Anwendung, Fassung 0.2.0' },
        {
          label: 'Teil B',
          value: partB
            ? 'von der Verwaltung der Instanz, zuletzt geändert am 18.10.2026'
            : 'noch nicht ausgefüllt',
        },
      ],
      changedSinceNewest: null,
    },
    {
      kind: 'deletion',
      facts: [{ label: 'Angaben eines beendeten Zugangs', value: 'nach 90 Tagen entfernen' }],
      changedSinceNewest: [],
    },
  ],
  versions: [
    {
      id: 'pv-2',
      kind: 'record',
      madeAt: '2026-10-19T07:30:00.000Z',
      madeBy: 'Sabine Krämer',
      holdsFor: '0.2.0',
      changed: ['3'],
    },
    {
      id: 'pv-1',
      kind: 'deletion',
      madeAt: '2026-10-12T14:42:00.000Z',
      madeBy: 'Sabine Krämer',
      holdsFor: '0.1.7',
      changed: null,
    },
  ],
})

function mounted(partB = true) {
  const written = signedInOffice(
    'management',
    [nord],
    {
      '/settings/processing-descriptions': description,
      '/settings/privacy-documents': documents(partB),
    },
    () => ({
      status: 201,
      body: {
        id: 'pv-3',
        kind: 'measures',
        madeAt: '2026-10-19T07:31:00.000Z',
        madeBy: null,
        holdsFor: '0.2.0',
        changed: null,
      },
    }),
  )

  return { written, done: mountOffice('/einstellungen/datenschutz', new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the documents on data protection under "Datenschutz"', () => {
  it('say what each says about the operator and what changed, and a click makes the measures', async () => {
    const { written, done } = mounted()

    await done
    await untilTheRightsAreKnown()

    const record = await screen.findByRole('region', {
      name: 'Verzeichnis der Verarbeitungstätigkeiten',
    })
    const measures = screen.getByRole('region', {
      name: 'Technische und organisatorische Maßnahmen',
    })
    const deletion = screen.getByRole('region', { name: 'Löschkonzept' })

    expect(within(record).getByText('Wohnbau Nord eG, Hafenweg 1')).toBeTruthy()
    expect(within(record).getByText(processingWords.changedSince(['3']))).toBeTruthy()
    expect(within(measures).getByText(processingWords.noneYet)).toBeTruthy()
    expect(within(deletion).getByText(processingWords.unchanged)).toBeTruthy()
    expect(within(measures).queryByText(privacyScreenWords.partBMissing)).toBeNull()

    await userEvent.click(within(measures).getByRole('button', { name: processingWords.make }))

    await waitFor(() => {
      expect(written).toEqual([
        { method: 'POST', path: '/settings/privacy-documents/measures', body: undefined },
      ])
    })
  })

  it('say so while part B of the instance is missing', async () => {
    const { done } = mounted(false)

    await done
    await untilTheRightsAreKnown()

    const measures = await screen.findByRole('region', {
      name: 'Technische und organisatorische Maßnahmen',
    })

    expect(within(measures).getByText(privacyScreenWords.partBMissing)).toBeTruthy()
  })

  it('list every one made with its kind, who made it and what changed, each with its PDF', async () => {
    const { done } = mounted()

    await done
    await untilTheRightsAreKnown()

    const table = await screen.findByRole('table', {
      name: /Die erzeugten Dokumente zum Datenschutz/,
    })

    expect(within(table).getByText('Verzeichnis')).toBeTruthy()
    expect(within(table).getByText('Löschkonzept')).toBeTruthy()
    expect(within(table).getAllByText('Sabine Krämer')).toHaveLength(2)
    expect(within(table).getByText('Die erste Fassung')).toBeTruthy()
    expect(
      within(table).getByRole('button', {
        name: privacyScreenWords.pdfOf('Verzeichnis', '19.10.2026'),
      }),
    ).toBeTruthy()
  })

  it('lead from the record to the page where the Leitung keeps what it wrote', async () => {
    const { done } = mounted()

    await done
    await untilTheRightsAreKnown()

    const record = await screen.findByRole('region', {
      name: 'Verzeichnis der Verarbeitungstätigkeiten',
    })

    await userEvent.click(
      within(record).getByRole('button', { name: privacyScreenWords.keepRecord }),
    )

    // The page of the record, with its way back to "Datenschutz".
    expect(await screen.findByRole('button', { name: recordScreenWords.back })).toBeTruthy()
  })
})
