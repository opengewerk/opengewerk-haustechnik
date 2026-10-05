import { contactLimits, type RoleKey } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberIn, mountedWithItsDevice, tenantName } from '../app/test-entry.js'
import { officeApplication } from './application.js'
import { officeRoutes } from './router.js'

/**
 * The people to talk to at a property, on its page in the office (#85): the
 * card of the foundation as this application binds it. What is held here is
 * what only this application can get wrong: that the card stands on the page
 * with the contacts of this property, its words, who may keep a contact, and
 * that one is made, corrected and taken away at the routes of the server,
 * with a connection.
 */

const school = {
  id: 'p-school',
  areaId: 'a-sued',
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const yard = {
  id: 'p-yard',
  areaId: 'a-nord',
  name: 'Werkhof Nord',
  street: 'Lagerweg 12',
  postalCode: '00002',
  city: 'Beispielstadt',
  federalState: 'DE-BW',
  note: null,
}

type Row = Record<string, unknown>

function contact(id: string, propertyId: string, over: Row): Row {
  return {
    id,
    propertyId,
    areaId: propertyId === school.id ? school.areaId : yard.areaId,
    givenName: null,
    familyName: 'Ohne',
    role: null,
    phone: null,
    email: null,
    ...over,
  }
}

const caretaker = contact('k-becker', school.id, {
  givenName: 'Klaus',
  familyName: 'Becker',
  role: 'Hausmeister',
  phone: '0000 4471',
  email: 'hausmeister@schulzentrum.example',
})
const head = contact('k-hartmann', school.id, {
  givenName: 'Ines',
  familyName: 'Hartmann',
  role: 'Schulleitung',
  phone: '0000 4400',
})
const foreman = contact('k-albers', yard.id, { familyName: 'Albers', role: 'Hofmeister' })

/** A property nobody is entered at. */
const depot = { ...yard, id: 'p-depot', name: 'Depot Süd' }

const takesAConnection = 'Ansprechpartner werden mit Verbindung gepflegt. Gerade ist keine da.'

/** A server that takes what comes straight at a route for a contact, and keeps what it was sent. */
class Server extends TestServer {
  readonly patched: { readonly path: string; readonly values: Row }[] = []
  readonly removed: string[] = []

  override patch(entity: string, id: string, values: Readonly<Row>) {
    this.patched.push({ path: `${entity}/${id}`, values: { ...values } })
    this.put(entity, { ...this.row(entity, id), ...values })

    return Promise.resolve(undefined)
  }

  override remove(entity: string, id: string) {
    this.removed.push(`${entity}/${id}`)
    this.put(entity, { ...this.row(entity, id), deletedAt: '2026-10-05T08:00:00.000Z' })

    return Promise.resolve(undefined)
  }
}

interface Written {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let server: Server
let answers: Map<string, unknown>
/** What was written to a route past the sync client, in order. */
let written: Written[]
/** What the route of the contacts answers a new one with. */
let answerToNew: (write: Written) => { readonly status: number; readonly body: unknown }

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Somebody signed in in one of the roles a tenant starts with. */
function signedIn(role: RoleKey) {
  answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'person@nord.example.de', name: 'Pia Person' },
        session: { activeTenantId: 't-nord' },
      },
    ],
    ['/auth/tenants', [memberIn(role)]],
    ['/areas', [{ id: 'a-sued', name: 'Süd' }]],
  ])
}

async function mount(at = `/liegenschaften/${school.id}`) {
  const { client } = await mountedWithItsDevice({
    routeTree: officeRoutes(),
    at,
    application: officeApplication,
    server,
    entities: ['properties', 'buildings', 'contacts'],
  })

  return client
}

/** The rights have arrived once the tenant stands in the header: both come with the same answer. */
async function untilTheRightsAreKnown(): Promise<void> {
  await within(screen.getByRole('banner')).findByText(tenantName)
}

function card() {
  return within(screen.getByRole('region', { name: 'Ansprechpartner' }))
}

function people() {
  return card()
    .queryAllByRole('listitem')
    .map((item) => item.textContent)
}

beforeEach(() => {
  localStorage.clear()
  server = new Server()
  written = []
  answerToNew = (write) => {
    const made = contact('k-new', school.id, write.body as Row)

    server.put('contacts', made)

    return { status: 201, body: made }
  }

  for (const property of [school, yard, depot]) {
    server.put('properties', property)
  }

  // Not in the order of their names, so that the card has to order them.
  for (const one of [head, foreman, caretaker]) {
    server.put('contacts', one)
  }

  signedIn('management')
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (method === 'GET') {
      return Promise.resolve(json(answers.get(path) ?? {}, answers.has(path) ? 200 : 404))
    }

    const write = {
      method,
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }

    written.push(write)

    const answer = answerToNew(write)

    return Promise.resolve(json(answer.body, answer.status))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  // One manager for every test of the file: a test that took the network
  // away would leave the questions of all that follow waiting for one.
  window.dispatchEvent(new Event('online'))
  onlineManager.setOnline(true)
})

describe('the people to talk to on the page of a property', () => {
  it('are those of this property, by name, each with what they are and how to reach them in one line', async () => {
    await mount()

    expect(people()).toEqual([
      'Klaus BeckerHausmeister · 0000 4471 · hausmeister@schulzentrum.example',
      'Ines HartmannSchulleitung · 0000 4400',
    ])
    // To tap: the number dials, the address writes.
    expect(card().getByRole('link', { name: '0000 4471' }).getAttribute('href')).toBe(
      'tel:00004471',
    )
    expect(
      card().getByRole('link', { name: 'hausmeister@schulzentrum.example' }).getAttribute('href'),
    ).toBe('mailto:hausmeister@schulzentrum.example')
  })

  it('stand under the address, before the buildings, as the board has the page', async () => {
    await mount()

    // The cards of the page in the order a reader moving from heading to heading meets them.
    expect(screen.getAllByRole('heading', { level: 2 }).map((title) => title.textContent)).toEqual([
      'Anschrift',
      'Ansprechpartner',
      'Gebäude',
    ])
  })

  it('are nobody of another property', async () => {
    await mount(`/liegenschaften/${yard.id}`)

    expect(people()).toEqual(['AlbersHofmeister'])
  })

  it('say so while nobody is entered', async () => {
    await mount(`/liegenschaften/${depot.id}`)

    expect(
      card().getByText('An dieser Liegenschaft ist noch kein Ansprechpartner eingetragen.'),
    ).toBeTruthy()
    expect(people()).toEqual([])
  })
})

describe('whoever keeps the properties', () => {
  it.each(['management', 'technical_management'] as const)(
    'is offered a new contact and a pencil at each, as %s',
    async (role) => {
      signedIn(role)
      await mount()

      expect(await card().findByRole('button', { name: 'Hinzufügen' })).toBeTruthy()
      expect(card().getByRole('button', { name: 'Klaus Becker bearbeiten' })).toBeTruthy()
      expect(card().getByRole('button', { name: 'Ines Hartmann bearbeiten' })).toBeTruthy()
    },
  )

  it.each(['site_management', 'technician'] as const)(
    'is nobody who only reads them: %s sees the people, and neither button nor pencil',
    async (role) => {
      signedIn(role)
      await mount()
      await untilTheRightsAreKnown()

      expect(people()).toHaveLength(2)
      expect(card().queryByRole('button')).toBeNull()
    },
  )

  it('adds one at the route of the contacts, at this property, and it stands in the card', async () => {
    const user = userEvent.setup()

    await mount()
    await user.click(await card().findByRole('button', { name: 'Hinzufügen' }))

    // What somebody is at a property is called a Funktion here, with examples of a property.
    expect(card().getByLabelText(/Funktion/)).toBeTruthy()
    expect(card().getByText('Zum Beispiel Hausmeister, Schulleitung oder Verwaltung.')).toBeTruthy()

    await user.type(card().getByLabelText(/Vorname/), ' Tobias ')
    await user.type(card().getByLabelText(/Nachname/), 'Wendt')
    await user.type(card().getByLabelText(/Funktion/), 'Haustechnik')
    await user.type(card().getByLabelText(/Telefon/), '0000 4410')
    await user.click(card().getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/contacts',
          body: {
            propertyId: school.id,
            givenName: 'Tobias',
            familyName: 'Wendt',
            role: 'Haustechnik',
            phone: '0000 4410',
            email: null,
          },
        },
      ])
    })
    // Not through the outbox: the device queued nothing.
    expect(server.operations()).toEqual([])
    await waitFor(() => {
      expect(people()).toContain('Tobias WendtHaustechnik · 0000 4410')
    })
    // The form is gone, the button is back.
    expect(card().queryByLabelText(/Nachname/)).toBeNull()
    expect(card().getByRole('button', { name: 'Hinzufügen' })).toBeTruthy()
  })

  it('is held by the rules of this application before anything is sent', async () => {
    const user = userEvent.setup()

    await mount()
    await user.click(await card().findByRole('button', { name: 'Hinzufügen' }))
    // Spaces get past the browser, which only asks that the field is not empty.
    await user.type(card().getByLabelText(/Nachname/), '   ')
    await user.click(card().getByRole('button', { name: 'Hinzufügen' }))

    expect((await card().findByRole('alert')).textContent).toBe('Der Nachname fehlt.')

    await user.type(card().getByLabelText(/Nachname/), 'Wendt')
    // Pasted, as a text of this length is: typing it key by key proves nothing more.
    await user.click(card().getByLabelText(/Funktion/))
    await user.paste('x'.repeat(contactLimits.role + 1))
    await user.click(card().getByRole('button', { name: 'Hinzufügen' }))

    await waitFor(() => {
      expect(card().getByRole('alert').textContent).toBe('Die Funktion hat höchstens 80 Zeichen.')
    })
    expect(written).toEqual([])
  })

  it('shows the sentence of the server when it refuses a new one, and keeps what was typed', async () => {
    const user = userEvent.setup()

    answerToNew = () => ({
      status: 422,
      body: { message: 'Diese Liegenschaft gibt es nicht oder nicht mehr.' },
    })
    await mount()
    await user.click(await card().findByRole('button', { name: 'Hinzufügen' }))
    await user.type(card().getByLabelText(/Nachname/), 'Wendt')
    await user.click(card().getByRole('button', { name: 'Hinzufügen' }))

    expect(
      await card().findByText('Diese Liegenschaft gibt es nicht oder nicht mehr.'),
    ).toBeTruthy()
    expect((card().getByLabelText(/Nachname/) as HTMLInputElement).value).toBe('Wendt')
    expect(people()).toHaveLength(2)
  })

  it('is told before filling it in that a new one takes a connection, and cannot send it without', async () => {
    const user = userEvent.setup()

    await mount()
    await user.click(await card().findByRole('button', { name: 'Hinzufügen' }))

    const add = card().getByRole('button', { name: 'Hinzufügen' }) as HTMLButtonElement

    expect(add.disabled).toBe(false)
    expect(card().queryByText(takesAConnection)).toBeNull()

    window.dispatchEvent(new Event('offline'))

    expect(await card().findByText(takesAConnection)).toBeTruthy()
    expect(add.disabled).toBe(true)
  })

  it('corrects one at its route, sending what was changed and nothing else', async () => {
    const user = userEvent.setup()

    await mount()
    await user.click(await card().findByRole('button', { name: 'Ines Hartmann bearbeiten' }))

    const phone = card().getByLabelText(/Telefon/)

    await user.clear(phone)
    await user.type(phone, '0000 4401')
    await user.click(card().getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(server.patched).toEqual([
        { path: 'contacts/k-hartmann', values: { phone: '0000 4401' } },
      ])
    })
    await waitFor(() => {
      expect(people()).toContain('Ines HartmannSchulleitung · 0000 4401')
    })
    expect(server.operations()).toEqual([])
    expect(written).toEqual([])
  })

  it('takes a connection to correct one and to take one away', async () => {
    const user = userEvent.setup()

    await mount()
    await user.click(await card().findByRole('button', { name: 'Klaus Becker bearbeiten' }))

    const save = card().getByRole('button', { name: 'Speichern' }) as HTMLButtonElement
    const remove = card().getByRole('button', { name: 'Entfernen' }) as HTMLButtonElement

    expect([save.disabled, remove.disabled]).toEqual([false, false])

    window.dispatchEvent(new Event('offline'))

    expect(await card().findByText(takesAConnection)).toBeTruthy()
    expect([save.disabled, remove.disabled]).toEqual([true, true])
  })

  it('takes one away after a question that says where it will be missing', async () => {
    const user = userEvent.setup()

    await mount()
    await user.click(await card().findByRole('button', { name: 'Klaus Becker bearbeiten' }))
    await user.click(card().getByRole('button', { name: 'Entfernen' }))

    const asking = await screen.findByRole('alertdialog', { name: 'Klaus Becker entfernen?' })

    expect(asking.textContent).toBe(
      'Klaus Becker entfernen?' +
        'Danach steht der Ansprechpartner an dieser Liegenschaft nicht mehr, auch nicht auf den Geräten vor Ort.' +
        'AbbrechenEntfernen',
    )
    expect(server.removed).toEqual([])

    await user.click(within(asking).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(server.removed).toEqual(['contacts/k-becker'])
    })
    await waitFor(() => {
      expect(people()).toEqual(['Ines HartmannSchulleitung · 0000 4400'])
    })
  })
})
