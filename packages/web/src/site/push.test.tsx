import { pushOccasions, pushOccasionWords } from '@opengewerk/haustechnik-domain'
import { fakePushBrowser, forgetPushBrowser } from '@opengewerk/platform-web/testing'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { afterEachSiteTest, mountSite } from './test-site.js'

/**
 * Push in the menu on site (#126, the board "Menü"): on or off on this
 * device, and the occasions of this application. The part is the
 * foundation's and tested there; held here is that the menu of this
 * application carries it, for a device on site, and stays without it on an
 * instance that sends no push.
 */

const occasions = pushOccasions.map((key) => ({ key, ...pushOccasionWords[key], on: true }))

async function theMenu(): Promise<HTMLElement> {
  await userEvent.click((await screen.findAllByRole('button', { name: /Menü/ }))[0] as HTMLElement)

  return screen.findByRole('dialog', { name: 'Menü' })
}

afterEach(() => {
  forgetPushBrowser()
  afterEachSiteTest()
})

describe('push in the menu on site', () => {
  it('is switched on for a device on site, with the occasions of this application under it', async () => {
    fakePushBrowser({ subscribed: false })

    const site = await mountSite('/', {
      answers: {
        '/push': { available: true, publicKey: 'BAAB', occasions, devices: [] },
        'PUT /push/subscription': { id: 'p-1' },
      },
    })
    const menu = await theMenu()

    expect(
      (await within(menu).findAllByRole('checkbox')).map(
        (box) => box.closest('label')?.textContent,
      ),
    ).toEqual(pushOccasions.map((key) => pushOccasionWords[key].label))
    expect(
      within(menu).getByText(
        'Kommen auch, wenn OpenGewerk Haustechnik geschlossen ist. Die Anlässe gelten für jedes Gerät, auf dem Push an ist.',
      ),
    ).toBeDefined()

    await userEvent.click(within(menu).getByRole('button', { name: 'Einschalten' }))

    await waitFor(() => {
      expect(
        site.asked.find((request) => request.path === '/push/subscription')?.body,
      ).toMatchObject({ entry: 'site' })
    })
  })

  it('stays out of the menu on an instance that sends no push', async () => {
    fakePushBrowser({ subscribed: false })

    await mountSite('/', {
      answers: { '/push': { available: false, publicKey: null, occasions, devices: [] } },
    })

    const menu = await theMenu()

    // Long enough for the answer about push to have arrived: the menu stands, and nothing is added to it.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(within(menu).queryByText('Benachrichtigungen')).toBeNull()
    expect(within(menu).queryByRole('checkbox')).toBeNull()
  })
})
