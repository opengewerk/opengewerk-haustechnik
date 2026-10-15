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
import { workOrderSettingWords } from './work-order-settings.js'

/**
 * "Einstellungen", "Aufträge" (#324, section 15 of the concept): whether the
 * service report names the people who did the work and the times of their
 * notes, off unless the Leitung switches it on.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

function mounted(role: RoleKey) {
  const written = signedInOffice(
    role,
    [nord],
    { '/settings/work-orders': { namesAndTimes: false } },
    () => ({ status: 200, body: { namesAndTimes: true } }),
  )

  return { written, done: mountOffice('/einstellungen/auftraege', new TestServer(), []) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the settings of the work orders', () => {
  it('are switched on by the Leitung, off until then', async () => {
    const { written, done } = mounted('management')
    const sent: Written[] = written

    await done
    await untilTheRightsAreKnown()

    const box = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: new RegExp(workOrderSettingWords.namesAndTimes),
    })

    expect(box.checked).toBe(false)
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: workOrderSettingWords.save }))

    await waitFor(() => {
      expect(sent).toEqual([
        { method: 'PUT', path: '/settings/work-orders', body: { namesAndTimes: true } },
      ])
    })
    expect(await screen.findByText(workOrderSettingWords.saved)).toBeDefined()
  })

  it('offer no change to whoever may not change the settings', async () => {
    const { written, done } = mounted('technical_management')

    await done
    await untilTheRightsAreKnown()

    const box = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: new RegExp(workOrderSettingWords.namesAndTimes),
    })

    expect(box.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: workOrderSettingWords.save })).toBeNull()
    expect(written).toEqual([])
  })
})
