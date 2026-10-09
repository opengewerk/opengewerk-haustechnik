import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'
import { meterSettingWords } from './meter-settings.js'

/**
 * "Einstellungen", "Zähler" (#120, section 4.9 of the concept: "Den
 * Stichtag stellt der Betreiber ein"): the day of the month every reading is
 * due on, set by whoever may change the settings.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

function mounted(role: RoleKey) {
  const written = signedInOffice(role, [nord], { '/settings/meters': { keyDay: 1 } }, () => ({
    status: 200,
    body: { keyDay: 15 },
  }))

  return { written, done: mountOffice('/einstellungen/zaehler', new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the key day of the meters', () => {
  it('is set by the Leitung, a day from the 1st to the 28th', async () => {
    const { written, done } = mounted('management')
    const sent: Written[] = written

    await done
    await untilTheRightsAreKnown()

    const select = await screen.findByLabelText(meterSettingWords.keyDay)

    expect(select.querySelectorAll('option')).toHaveLength(28)
    await userEvent.selectOptions(select, '15')
    await userEvent.click(screen.getByRole('button', { name: meterSettingWords.save }))

    await waitFor(() => {
      expect(sent).toEqual([{ method: 'PUT', path: '/settings/meters', body: { keyDay: 15 } }])
    })
    expect(await screen.findByText(meterSettingWords.saved)).toBeDefined()
  })
})
