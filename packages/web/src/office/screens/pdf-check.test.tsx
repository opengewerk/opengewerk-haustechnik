import type { PdfCheck, RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'
import { pdfCheckScreenWords } from './pdf-check.js'

/**
 * "PDF prüfen" (#457, board `HT-Buero-PDF-Pruefen`): reached from the
 * register of duties by whoever sees the evidence, it sends the file chosen
 * as it is and says what came back: the print it is, and whether the
 * signature of the instance still holds.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const kept: PdfCheck = {
  pdf: true,
  kept: {
    kind: 'evidence',
    evidenceId: 'e-1',
    activityId: null,
    title: 'NW-2026-00412',
    keptAt: '2026-10-03T12:22:00.000Z',
  },
  instance: { state: 'unchanged', signedAt: '2026-10-03T12:22:00.000Z' },
}

function mounted(role: RoleKey, answer: PdfCheck, at = '/pflichten/pdf-pruefen') {
  const written = signedInOffice(
    role,
    [nord],
    { '/duties': { duties: [], more: false } },
    (write) =>
      write.method === 'POST' && write.path === '/pdf-checks'
        ? { status: 200, body: answer }
        : { status: 500, body: {} },
  )

  return { written, done: mountOffice(at, new TestServer(), ['duty']) }
}

async function choose(name: string): Promise<void> {
  const file = new File(['%PDF-1.7 Probe'], name, { type: 'application/pdf' })

  await userEvent.upload(await screen.findByLabelText(pdfCheckScreenWords.choose), file)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checking a PDF', () => {
  it('sends the file chosen and names the print it is, unchanged since the instance signed it', async () => {
    const { written, done } = mounted('technical_management', kept)
    const sent: Written[] = written

    await done
    await choose('nachweis.pdf')

    const result = within(await screen.findByRole('status'))

    expect(sent.map((write) => [write.method, write.path])).toEqual([['POST', '/pdf-checks']])
    expect(
      result.getByText(/Diese Datei ist Byte für Byte der Druck von Nachweis NW-2026-00412/),
    ).toBeTruthy()
    expect(result.getByRole('link', { name: 'Nachweis öffnen' }).getAttribute('href')).toBe(
      '/nachweise/e-1',
    )
    expect(result.getByText(/Seitdem unverändert\./)).toBeTruthy()
  })

  it('says a file was changed after the signature, and that it is no print kept', async () => {
    mounted('technical_management', {
      pdf: true,
      kept: null,
      instance: { state: 'changed', signedAt: '2026-10-14T07:05:00.000Z' },
    })
    await choose('bearbeitet.pdf')

    const result = within(await screen.findByRole('status'))

    expect(result.getByText(pdfCheckScreenWords.notKeptTitle)).toBeTruthy()
    expect(result.getByText(pdfCheckScreenWords.changedTitle)).toBeTruthy()
  })

  it('names who signed after the instance', async () => {
    mounted('technical_management', {
      ...kept,
      instance: {
        state: 'signed_after',
        signedAt: '2026-10-03T12:22:00.000Z',
        by: ['Dr. Anna Becker, Prüfstelle Probe GmbH'],
      },
    })
    await choose('qualifiziert.pdf')

    expect(
      within(await screen.findByRole('status')).getByText(
        /danach signiert von Dr\. Anna Becker, Prüfstelle Probe GmbH\. Seitdem unverändert\./,
      ),
    ).toBeTruthy()
  })
})

describe('the way to it', () => {
  it('is a button beside the register of evidence, for whoever sees the evidence', async () => {
    const { done } = mounted('technical_management', kept, '/pflichten')

    await done
    await untilTheRightsAreKnown()

    expect(await screen.findByRole('button', { name: 'PDF prüfen' })).toBeTruthy()
  })
})
