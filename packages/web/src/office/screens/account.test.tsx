import { pushOccasions, pushOccasionWords } from '@opengewerk/haustechnik-domain'
import { fakePushBrowser, forgetPushBrowser, TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
} from '../test-office.js'
import { pushWords } from './account.js'

/**
 * "Konto" with the card "Benachrichtigungen" (#126, the board "Konto:
 * Benachrichtigungen"): push on this device and the occasions of this
 * application, in its words. The card is the foundation's and tested there;
 * held here is what this application says on it and which occasions it
 * offers.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const occasions = pushOccasions.map((key) => ({ key, ...pushOccasionWords[key], on: true }))

function mounted(push: unknown) {
  fakePushBrowser({ subscribed: false })
  signedInOffice('technician', [nord], { '/push': push })

  return mountOffice('/konto', new TestServer(), [])
}

async function theCard(): Promise<HTMLElement> {
  return (await screen.findByText(pushWords.about)).closest('section') as HTMLElement
}

afterEach(() => {
  forgetPushBrowser()
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('push under "Konto"', () => {
  it('says what a message says and leaves out, and offers the occasions of this application', async () => {
    await mounted({ available: true, publicKey: 'BAAB', occasions, devices: [] })
    await untilTheRightsAreKnown()

    const card = await theCard()

    expect(
      (await within(card).findAllByRole('checkbox')).map(
        (box) => box.closest('label')?.textContent,
      ),
    ).toEqual([
      'FristenWenn eine Frist, für die Sie verantwortlich sind, erinnert.',
      'ZuteilungenWenn Ihnen ein Rundgang, eine Prüfung oder ein Auftrag zugeteilt wird.',
      'Fällige AufgabenAm Morgen des Tages, an dem eine Aufgabe für Sie fällig ist.',
      'Wartet auf Gegenzeichnung oder AbnahmeWenn ein Rundgang oder ein Auftrag in Ihren Bereichen auf Sie wartet.',
      'Zurückgewiesene AufträgeWenn ein Auftrag, den Sie unterschrieben haben, zurückgewiesen wird.',
      'Eingegangene StörungenWenn in einem Bereich, in dem Sie Störungen annehmen, eine Störung gemeldet wird.',
      'Ihre StörmeldungenWenn eine Störung, die Sie gemeldet haben, angenommen oder erledigt ist.',
    ])
    // The reminder of a deadline comes by mail whatever is ticked here, as the
    // settings of the deadlines say for its kind (#269).
    expect(
      within(card).getByText(
        'Die Anlässe gelten für jedes Gerät, auf dem Push eingeschaltet ist. Per E-Mail kommen Erinnerungen an Fristen unabhängig davon, so wie es die Einstellungen der Fristen je Art sagen.',
      ),
    ).toBeDefined()
    expect(within(card).getByRole('button', { name: 'Auf diesem Gerät einschalten' })).toBeDefined()
  })

  it('says who gets the key on an instance that has none, and offers nothing to switch on', async () => {
    await mounted({ available: false, publicKey: null, occasions, devices: [] })
    await untilTheRightsAreKnown()

    const card = await theCard()

    expect(
      await within(card).findByText(
        'Diese Instanz verschickt keine Push-Nachrichten, ihr fehlt der Schlüssel dafür. Wer die Instanz betreibt, bekommt ihn mit dem nächsten Start über „sh docker/start.sh“.',
      ),
    ).toBeDefined()
    expect(within(card).queryByRole('button', { name: 'Auf diesem Gerät einschalten' })).toBeNull()
    expect(within(card).queryByRole('checkbox')).toBeNull()
  })
})
