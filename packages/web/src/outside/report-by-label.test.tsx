import {
  addressConfirmedSentence,
  closedLabelSentence,
  confirmationGoneSentence,
  confirmationPath,
  type OutsideLabelPage,
  outsideReportRules,
  tooManyReportsSentence,
} from '@opengewerk/haustechnik-domain'
import { ApplicationProvider } from '@opengewerk/platform-web'
import { fromTheGallery } from '@opengewerk/platform-web/forms'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '../app/application.js'
import { outsideWords, ReportByLabel, signedOutPage } from './report-by-label.js'

/**
 * The page of a label for somebody without an account (#332), the boards
 * "HT-Tor-Stoerung-…": closed with the one sentence for every reason, open
 * with the room, the categories, an address for the answer and the field
 * nobody sees, and the answer once the report is in.
 */

const code = '3XQ7M2K9PDH4TA6W'

const open: OutsideLabelPage = {
  open: true,
  room: '2.05 Lehrerzimmer',
  categories: [
    { id: 'c-heat' as never, name: 'Heizung und Lüftung' },
    { id: 'c-water' as never, name: 'Sanitär' },
  ],
  form: '1792137600000.signed',
}

interface Asked {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let asked: Asked[] = []

/** An accessible name that holds the label of a field, whatever a star or a hint adds to it. */
function named(label: string) {
  return (name: string) => name.includes(label)
}

/** A server that answers each path and method with what the test says. */
function serverAnswers(
  answer: (path: string, method: string) => { status: number; body: unknown },
) {
  asked = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    asked.push({
      path,
      method,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
    })

    const { status, body } = answer(path, method)

    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
    )
  })
}

function shown() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationProvider application={application}>
        <ReportByLabel code={code} />
      </ApplicationProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the address of a label before the sign in', () => {
  it('is the page of the label, and the sign in where it is asked for or for any other address', () => {
    expect(signedOutPage(new URL(`https://haustechnik.example/a/${code}`))).not.toBeNull()
    expect(signedOutPage(new URL(`https://haustechnik.example/a/${code}?anmelden=`))).toBeNull()
    expect(signedOutPage(new URL('https://haustechnik.example/liegenschaften'))).toBeNull()
    expect(signedOutPage(new URL('https://haustechnik.example/'))).toBeNull()
  })
})

describe('the page of a label without an account', () => {
  it('says only that it takes a sign in where the label opens nothing, and leads there', async () => {
    serverAnswers(() => ({ status: 200, body: { open: false } }))

    const assign = vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})

    shown()

    expect(await screen.findByRole('heading', { name: outsideWords.closed })).toBeTruthy()
    expect(screen.getByText(closedLabelSentence)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: outsideWords.signIn }))

    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\?anmelden=?$/))
  })

  it('names the room, offers the categories and asks no name, with the way to the privacy notice', async () => {
    serverAnswers(() => ({ status: 200, body: open }))
    shown()

    expect(await screen.findByRole('heading', { name: outsideWords.report })).toBeTruthy()
    expect(screen.getByText('2.05 Lehrerzimmer')).toBeTruthy()
    expect(
      within(screen.getByRole('combobox', { name: named(outsideWords.category) }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([outsideWords.choose, 'Heizung und Lüftung', 'Sanitär'])
    expect(screen.getByRole('link', { name: outsideWords.privacy }).getAttribute('href')).toBe(
      '/rechtliches/datenschutz',
    )
    // The field nobody sees is out of what a reader hears and out of the tab order.
    expect(screen.queryByRole('textbox', { name: outsideWords.trap })).toBeNull()
    expect(document.querySelector('input[name="website"]')?.getAttribute('tabindex')).toBe('-1')
    expect(screen.queryByRole('textbox', { name: /Name/ })).toBeNull()
  })

  it('sends the report with the form it was handed and the field nobody sees, and says it arrived', async () => {
    serverAnswers((_, method) =>
      method === 'POST' ? { status: 201, body: { photo: null } } : { status: 200, body: open },
    )
    shown()

    await screen.findByRole('heading', { name: outsideWords.report })
    fireEvent.change(screen.getByRole('combobox', { name: named(outsideWords.category) }), {
      target: { value: 'c-water' },
    })
    await userEvent.type(
      screen.getByRole('textbox', { name: named(outsideWords.description) }),
      'Spülung läuft ständig.',
    )
    await userEvent.type(
      screen.getByRole('textbox', { name: named(outsideWords.contact) }),
      'melder@beispiel.example',
    )
    await userEvent.click(screen.getByRole('button', { name: outsideWords.send }))

    expect(await screen.findByRole('heading', { name: outsideWords.done })).toBeTruthy()
    expect(screen.getByText(outsideWords.thanksWithAddress)).toBeTruthy()
    expect(asked.find((each) => each.method === 'POST')).toEqual({
      path: `/fault-reports/by-label/${code}`,
      method: 'POST',
      body: {
        categoryId: 'c-water',
        description: 'Spülung läuft ständig.',
        contact: 'melder@beispiel.example',
        photo: false,
        form: open.form,
        website: '',
      },
    })
  })

  it('checks the address before it sends, and says what the server says when it refuses', async () => {
    serverAnswers((_, method) =>
      method === 'POST'
        ? { status: 429, body: { message: tooManyReportsSentence } }
        : { status: 200, body: open },
    )
    shown()

    await screen.findByRole('heading', { name: outsideWords.report })
    fireEvent.change(screen.getByRole('combobox', { name: named(outsideWords.category) }), {
      target: { value: 'c-heat' },
    })
    await userEvent.type(
      screen.getByRole('textbox', { name: named(outsideWords.description) }),
      'Heizkörper kalt.',
    )
    await userEvent.type(
      screen.getByRole('textbox', { name: named(outsideWords.contact) }),
      'kein@',
    )
    await userEvent.click(screen.getByRole('button', { name: outsideWords.send }))

    expect(await screen.findByText('Das sieht nicht nach einer E-Mail-Adresse aus.')).toBeTruthy()
    expect(asked.some((each) => each.method === 'POST')).toBe(false)

    await userEvent.clear(screen.getByRole('textbox', { name: named(outsideWords.contact) }))
    await userEvent.click(screen.getByRole('button', { name: outsideWords.send }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(tooManyReportsSentence)
    })
  })

  it('offers at the camera and in the gallery only the pictures the server takes, and sends one from the gallery', async () => {
    serverAnswers((_, method) =>
      method === 'POST'
        ? { status: 201, body: { photo: 'slip-1' } }
        : method === 'PUT'
          ? { status: 204, body: null }
          : { status: 200, body: open },
    )
    shown()

    await screen.findByRole('heading', { name: outsideWords.report })

    const camera = screen.getByLabelText(outsideWords.photo, { selector: 'input' })
    const gallery = screen.getByLabelText(fromTheGallery(outsideWords.photo), { selector: 'input' })

    expect(camera.getAttribute('accept')).toBe(outsideReportRules.photoTypes.join(','))
    expect(gallery.getAttribute('accept')).toBe(outsideReportRules.photoTypes.join(','))

    fireEvent.change(screen.getByRole('combobox', { name: named(outsideWords.category) }), {
      target: { value: 'c-heat' },
    })
    await userEvent.type(
      screen.getByRole('textbox', { name: named(outsideWords.description) }),
      'Heizkörper kalt.',
    )
    await userEvent.upload(
      gallery,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'heizung.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(screen.getByRole('button', { name: outsideWords.send }))

    expect(await screen.findByRole('heading', { name: outsideWords.done })).toBeTruthy()
    expect(asked.find((each) => each.method === 'POST')?.body).toMatchObject({ photo: true })
    expect(asked.find((each) => each.method === 'PUT')?.path).toBe(
      `/fault-reports/by-label/${code}/photo/slip-1`,
    )
  })

  it('sends the photo after the report with the slip its answer carried', async () => {
    serverAnswers((_, method) =>
      method === 'POST'
        ? { status: 201, body: { photo: 'slip-1' } }
        : method === 'PUT'
          ? { status: 204, body: null }
          : { status: 200, body: open },
    )
    shown()

    await screen.findByRole('heading', { name: outsideWords.report })
    fireEvent.change(screen.getByRole('combobox', { name: named(outsideWords.category) }), {
      target: { value: 'c-heat' },
    })
    await userEvent.type(
      screen.getByRole('textbox', { name: named(outsideWords.description) }),
      'Heizkörper kalt.',
    )
    await userEvent.upload(
      screen.getByLabelText(outsideWords.photo, { selector: 'input' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'heizung.jpg', { type: 'image/jpeg' }),
    )
    await userEvent.click(screen.getByRole('button', { name: outsideWords.send }))

    expect(await screen.findByRole('heading', { name: outsideWords.done })).toBeTruthy()
    expect(screen.getByText(outsideWords.thanks)).toBeTruthy()
    expect(asked.find((each) => each.method === 'POST')?.body).toMatchObject({ photo: true })
    expect(asked.find((each) => each.method === 'PUT')?.path).toBe(
      `/fault-reports/by-label/${code}/photo/slip-1`,
    )
  })
})

describe('the link that confirms an address (S12 of the review of phase 2)', () => {
  const secret = 'A'.repeat(43)

  function opened() {
    const page = signedOutPage(new URL(`https://haustechnik.example${confirmationPath}#${secret}`))

    return render(
      <QueryClientProvider client={new QueryClient()}>
        <ApplicationProvider application={application}>{page}</ApplicationProvider>
      </QueryClientProvider>,
    )
  }

  it('hands the secret from behind the hash sign to the server once and says the address is confirmed', async () => {
    serverAnswers(() => ({ status: 200, body: { confirmed: true } }))

    const replaced = vi.spyOn(globalThis.history, 'replaceState')

    opened()

    expect(await screen.findByRole('heading', { name: outsideWords.confirmed })).toBeTruthy()
    expect(screen.getByText(addressConfirmedSentence)).toBeTruthy()
    expect(asked).toEqual([
      {
        path: expect.stringContaining('/fault-reports/by-label/address/confirmation') as string,
        method: 'POST',
        body: { link: secret },
      },
    ])
    // The secret does not stay in the address.
    expect(replaced).toHaveBeenCalledWith(null, '', confirmationPath)
  })

  it('says alike of every link that confirms nothing', async () => {
    serverAnswers(() => ({ status: 404, body: { message: confirmationGoneSentence } }))
    opened()

    expect(await screen.findByRole('heading', { name: outsideWords.notConfirmed })).toBeTruthy()
    expect(screen.getByText(confirmationGoneSentence)).toBeTruthy()
  })
})
