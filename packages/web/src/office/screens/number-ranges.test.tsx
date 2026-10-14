import type { RoleKey } from '@opengewerk/haustechnik-domain'
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

/**
 * "Einstellungen", "Nummernkreise" (#127, the board of that name): how
 * assets, work orders and evidence are numbered, set by whoever may change
 * the settings, which is the Leitung.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const ranges = [
  { key: 'asset', pattern: 'AN-{number:5}', nextValue: 413, next: 'AN-00413' },
  { key: 'work_order', pattern: 'AU-{year}-{number:4}', nextValue: 35, next: 'AU-2026-0035' },
  { key: 'evidence', pattern: 'NW-{year}-{number:5}', nextValue: 153, next: 'NW-2026-00153' },
]

function mounted(role: RoleKey) {
  const written = signedInOffice(
    role,
    [nord],
    { '/settings/number-ranges': ranges },
    ({ body }) => ({
      status: 200,
      body: { key: 'asset', ...(body as object), nextValue: 413, next: 'ANL-0413' },
    }),
  )

  return { written, done: mountOffice('/einstellungen/nummernkreise', new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the number ranges', () => {
  it('show assets, work orders and evidence with what each next one is called', async () => {
    const { done } = mounted('management')

    await done
    await untilTheRightsAreKnown()

    const table = await screen.findByRole('table', { name: 'Nummernkreise' })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((each) => each.textContent),
    ).toEqual(['Kreis', 'Muster', 'Nächste Nummer', 'Die nächste heißt', 'Speichern'])
    expect(within(table).getByRole('row', { name: 'Anlagen' }).textContent).toContain(
      'Vergeben wird keine zweimal.',
    )
    expect(within(table).getByRole('row', { name: 'Nachweise' }).textContent).toContain(
      'NW-2026-00153',
    )
  })

  it('send a new pattern of the Leitung, with the next number worked out while typing', async () => {
    const { written, done } = mounted('management')

    await done
    await untilTheRightsAreKnown()

    const pattern = await screen.findByLabelText('Muster der Anlagen')

    await userEvent.clear(pattern)
    await userEvent.type(pattern, 'ANL-{{number:4}')
    expect(screen.getByRole('row', { name: 'Anlagen' }).textContent).toContain('ANL-0413')

    await userEvent.click(screen.getByRole('button', { name: 'Anlagen speichern' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'PUT',
          path: '/settings/number-ranges/asset',
          body: { pattern: 'ANL-{number:4}' },
        },
      ])
    })
    expect(await screen.findByText('Gespeichert. Die nächste Nummer heißt ANL-0413.')).toBeDefined()
  })

  it('let the next number only go up, and send nothing that goes down', async () => {
    const { written, done } = mounted('management')

    await done
    await untilTheRightsAreKnown()

    const next = await screen.findByLabelText('Nächste Nummer der Anlagen')

    await userEvent.clear(next)
    await userEvent.type(next, '12')

    expect(screen.getByText('Die nächste Nummer kann nur steigen, von 413 an.')).toBeDefined()
    expect(
      (screen.getByRole('button', { name: 'Anlagen speichern' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(written).toEqual([])
  })
})
