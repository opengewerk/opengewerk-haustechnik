import type { ProcessingDescriptions, RoleKey } from '@opengewerk/haustechnik-domain'
import { processingWords } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { memberIn } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'

/**
 * "Einstellungen", "Datenschutz" (#357, section 9 of the concept): what the
 * description of the processing says about the operator, a description made
 * now, and every one made with its PDF, for the Leitung.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const facts = [
  {
    label: 'Rollen',
    value:
      'mitgeliefert: Leitung (1 Zugang), Haustechnik (3 Zugänge); eigene: Hausmeisterei (2 Zugänge)',
  },
  { label: 'Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis', value: 'aus' },
]

const read = (made: boolean): ProcessingDescriptions => ({
  facts,
  changedSinceNewest: made ? ['2'] : null,
  versions: made
    ? [
        {
          id: 'pd-2',
          madeAt: '2026-10-12T14:40:00.000Z',
          madeBy: 'Sabine Krämer',
          holdsFor: '0.1.7',
          changed: ['4', '7'],
        },
        {
          id: 'pd-1',
          madeAt: '2026-09-02T07:15:00.000Z',
          madeBy: 'Sabine Krämer',
          holdsFor: '0.1.6',
          changed: null,
        },
      ]
    : [],
})

function mounted(role: RoleKey, made: boolean, at = '/einstellungen/datenschutz') {
  const written = signedInOffice(
    role,
    [nord],
    { '/settings/processing-descriptions': read(made) },
    () => ({
      status: 201,
      body: {
        id: 'pd-3',
        madeAt: '2026-10-19T07:12:00.000Z',
        madeBy: null,
        holdsFor: '0.1.7',
        changed: ['2'],
      },
    }),
  )

  return { written, done: mountOffice(at, new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the description of the processing under "Datenschutz"', () => {
  it('says what it says about the operator and what changed, and a click makes one', async () => {
    const { written, done } = mounted('management', true)

    await done
    await untilTheRightsAreKnown()

    const panel = await screen.findByRole('region', { name: processingWords.card })

    expect(within(panel).getByText(facts[0]?.value ?? '')).toBeTruthy()
    expect(within(panel).getByText(processingWords.changedSince(['2']))).toBeTruthy()

    await userEvent.click(within(panel).getByRole('button', { name: processingWords.make }))

    await waitFor(() => {
      expect(written).toEqual([
        { method: 'POST', path: '/settings/processing-descriptions', body: undefined },
      ])
    })
    expect(await within(panel).findByText(processingWords.made)).toBeTruthy()
  })

  it('lists every one made with who made it and what changed, each with its PDF', async () => {
    const { done } = mounted('management', true)

    await done
    await untilTheRightsAreKnown()

    const table = await screen.findByRole('table', {
      name: /Die erzeugten Verfahrensbeschreibungen/,
    })

    expect(within(table).getAllByText('Sabine Krämer')).toHaveLength(2)
    expect(within(table).getByText('Abschnitte 4 und 7')).toBeTruthy()
    expect(within(table).getByText('Die erste Fassung')).toBeTruthy()
    expect(
      within(table).getByRole('button', { name: processingWords.pdfOf('12.10.2026') }),
    ).toBeTruthy()
  })

  it('says before the first that there is none yet', async () => {
    const { done } = mounted('management', false)

    await done
    await untilTheRightsAreKnown()

    expect(await screen.findByText(processingWords.noneYet)).toBeTruthy()
    expect(screen.getByText(processingWords.versionsEmpty)).toBeTruthy()
  })

  it("is not offered to a role of the operator's own that reads and changes the settings", async () => {
    // Of the shipped roles only the Leitung reads the settings; a role of the operator's own may, and
    // the right to make the description stays with the Leitung all the same.
    const own = { ...memberIn('site_management'), rights: ['settings.read', 'settings.write'] }

    signedInOffice('site_management', [nord], {
      '/auth/tenants': [own],
      '/settings/processing-descriptions': read(true),
    })
    await mountOffice('/einstellungen', new TestServer(), [])
    await untilTheRightsAreKnown()

    expect(await screen.findByText('Aufbewahrung')).toBeTruthy()
    expect(screen.queryByText('Datenschutz')).toBeNull()
  })
})
