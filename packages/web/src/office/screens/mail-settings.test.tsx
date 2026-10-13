import type { RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { tenantName } from '../../app/test-entry.js'
import {
  mountOffice,
  type NamedArea,
  signedInOffice,
  untilTheRightsAreKnown,
  type Written,
} from '../test-office.js'
import { mailServerWords, mailStatusWords } from './mail-settings.js'

/**
 * "E-Mail-Einstellungen" (#126, the board of that name): the mail server of
 * the operator, which section 7 of the concept gives to the Leitung alone,
 * with a signature that knows one placeholder, and one sentence for whoever
 * reads the settings without it.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }

const kept = {
  host: 'smtp.beispielstadt.example',
  port: 587,
  security: 'starttls',
  username: 'haustechnik@beispielstadt.example',
  fromAddress: 'haustechnik@beispielstadt.example',
  signature: 'Viele Grüße\n{benutzer}\n\nHaustechnik',
  password: 'set',
  passwordSetAt: '2026-10-02T09:00:00.000Z',
}

function mounted(role: RoleKey, server: unknown = null) {
  const written = signedInOffice(
    role,
    [nord],
    {
      '/settings/mail': { configured: true, from: 'haustechnik@beispielstadt.example' },
      '/settings/mail/server': { server },
    },
    (write) => ({
      status: 200,
      body: { server: { ...kept, ...(write.body as object) }, check: { outcome: 'ready' } },
    }),
  )

  return { written, done: mountOffice('/einstellungen/e-mail', new TestServer(), []) }
}

async function theForm(): Promise<HTMLFormElement> {
  return (await screen.findByLabelText('Absenderadresse')).closest('form') as HTMLFormElement
}

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the mail server of an operator', () => {
  it('is shown to the Leitung in the words of this application, signed with the name of the operator', async () => {
    const { done } = mounted('management')

    await done
    await untilTheRightsAreKnown()

    const form = await theForm()

    expect(
      screen.getByText(
        `${mailServerWords.what} Die Angaben stehen beim E-Mail-Anbieter, meist unter „SMTP“ oder „Postausgangsserver“.`,
      ),
    ).toBeDefined()
    expect(
      within(form).getByText(
        'Von dieser Adresse gehen die E-Mails hinaus. Der Name davor ist der des Betreibers.',
      ),
    ).toBeDefined()

    // No signature written: the operator signs with its name, sent by hand or by itself.
    const previews = form.querySelectorAll('pre')

    expect([...previews].map((preview) => preview.textContent)).toEqual([
      `-- \n${tenantName}`,
      `-- \n${tenantName}`,
    ])
    expect(within(form).getByText('Von einer Person verschickt')).toBeDefined()
    expect(within(form).getByText('Automatisch verschickt')).toBeDefined()
  })

  it('reads the signature as a message carries it: with whoever sends it, and without the line where nobody does', async () => {
    const { done } = mounted('management', kept)

    await done
    await untilTheRightsAreKnown()

    const form = await theForm()

    expect([...form.querySelectorAll('pre')].map((preview) => preview.textContent)).toEqual([
      '-- \nViele Grüße\nPia Person\n\nHaustechnik',
      '-- \nViele Grüße\n\nHaustechnik',
    ])
  })

  it('goes to the server as typed, the signature with it and no password where none was typed', async () => {
    const { written, done } = mounted('management', kept)
    const sent: Written[] = written

    await done
    await untilTheRightsAreKnown()

    const form = await theForm()

    await userEvent.click(within(form).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'PUT',
          path: '/settings/mail/server',
          body: {
            host: 'smtp.beispielstadt.example',
            port: null,
            security: 'starttls',
            username: 'haustechnik@beispielstadt.example',
            fromAddress: 'haustechnik@beispielstadt.example',
            signature: 'Viele Grüße\n{benutzer}\n\nHaustechnik',
          },
        },
      ])
    })
  })

  it('names a placeholder it does not know and saves nothing with it', async () => {
    const { written, done } = mounted('management', kept)

    await done
    await untilTheRightsAreKnown()

    const form = await theForm()

    // `{{` types one brace: the letterhead is a placeholder of another application.
    await userEvent.type(within(form).getByLabelText('Signatur'), '{Enter}{{briefkopf}')

    expect(within(form).getByText('Unbekannt: {briefkopf}. Möglich ist {benutzer}.')).toBeDefined()
    expect(
      within(form).getByRole<HTMLButtonElement>('button', { name: 'Speichern' }).disabled,
    ).toBe(true)
    expect(written).toEqual([])
  })

  it('is one sentence and no form for whoever does not hold the right to see it', async () => {
    // The Technische Leitung holds neither `mail.read` nor `mail.write`.
    const { done } = mounted('technical_management', kept)

    await done
    await untilTheRightsAreKnown()

    expect(
      await screen.findByText(mailStatusWords.set('haustechnik@beispielstadt.example')),
    ).toBeDefined()
    expect(screen.queryByLabelText('Absenderadresse')).toBeNull()
    expect(screen.queryByLabelText('Passwort')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
    expect(screen.queryByText(/smtp\.beispielstadt\.example/)).toBeNull()
  })
})
