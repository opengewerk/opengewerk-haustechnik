import { type RoleKey, taskEntity } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memberIn, mountedWithItsDevice, tenantName } from '../app/test-entry.js'
import { officeApplication } from './application.js'
import { servingTables } from './test-office.js'
import { officeRoutes } from './router.js'

/**
 * The tasks in the office (#124): the list "Aufgaben" and the card on the
 * page of a property, as this application binds the row, the list and the
 * form of the foundation. What is held here is what only this application can
 * get wrong: which tasks stand where, who is offered as the one a task goes
 * to, what a new task hangs on, and who may mark one done.
 */

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
const school = {
  ...yard,
  id: 'p-school',
  areaId: 'a-sued',
  name: 'Schulzentrum Am Lindenhain',
}
const hall = {
  id: 'b-hall',
  propertyId: yard.id,
  areaId: yard.areaId,
  name: 'Halle 1',
  kinds: ['workshop'],
}

type Row = Record<string, unknown>

function task(id: string, over: Row): Row {
  return {
    id,
    title: 'Etwas',
    dueOn: '2099-01-10',
    assigneeUserId: 'u-1',
    status: 'open',
    propertyId: yard.id,
    areaId: yard.areaId,
    buildingId: null,
    roomId: null,
    assetId: null,
    activityId: null,
    createdBy: 'u-1',
    ...over,
  }
}

/** A server that says what went out through the outbox. */
class Server extends TestServer {
  queued() {
    return this.operations().map((operation) => ({
      entity: operation.entity,
      kind: operation.kind,
      values: Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
  }
}

let server: Server
let answers: Map<string, unknown>
let asked: string[]

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
        session: { activeTenantId: 't-nord', secondFactor: memberIn(role).secondFactor },
      },
    ],
    ['/auth/tenants', [memberIn(role)]],
    [
      '/areas',
      [
        { id: 'a-nord', name: 'Nord' },
        { id: 'a-sued', name: 'Süd' },
      ],
    ],
    [
      '/tasks/candidates',
      {
        areas: [
          {
            areaId: 'a-nord',
            people: [
              { userId: 'u-1', name: 'Pia Person' },
              { userId: 'u-lena', name: 'Lena Vogt' },
            ],
          },
          { areaId: 'a-sued', people: [{ userId: 'u-murat', name: 'Murat Yilmaz' }] },
        ],
      },
    ],
  ])
}

async function mount(at: string) {
  const { client } = await mountedWithItsDevice({
    routeTree: officeRoutes(),
    at,
    application: officeApplication,
    server,
    entities: ['properties', 'buildings', 'rooms', 'assets', 'activities', taskEntity],
  })

  await within(screen.getByRole('banner')).findByText(tenantName)

  return client
}

function card(name: string) {
  return within(screen.getByRole('region', { name }))
}

function rows(name: string) {
  return card(name)
    .queryAllByRole('listitem')
    .map((item) => item.textContent)
}

beforeEach(() => {
  localStorage.clear()
  server = new Server()
  asked = []

  for (const property of [yard, school]) {
    server.put('properties', property)
  }

  server.put('buildings', hall)
  server.put(taskEntity, task('t-mine', { title: 'Plaketten bestellen', dueOn: '2020-01-01' }))
  server.put(
    taskEntity,
    task('t-hall', {
      title: 'Tor schmieren',
      buildingId: hall.id,
      assigneeUserId: 'u-lena',
      createdBy: 'u-1',
    }),
  )
  server.put(
    taskEntity,
    task('t-done', { title: 'Schon erledigt', status: 'done', assigneeUserId: 'u-lena' }),
  )

  signedIn('management')
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    asked.push(path)

    if ((init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(json(answers.get(path) ?? {}, answers.has(path) ? 200 : 404))
    }

    return Promise.resolve(json({}, 404))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.dispatchEvent(new Event('online'))
  onlineManager.setOnline(true)
})

describe('the list "Aufgaben"', () => {
  it('shows the own open tasks and those open with the others, each with what it hangs on, and no done ones', async () => {
    await mount('/aufgaben')

    await waitFor(() => {
      expect(rows('Ihre Aufgaben')).toEqual([
        'Plaketten bestellenFällig am 01.01.2020, überfällig, verantwortlich: SieLiegenschaft Werkhof NordErledigt',
      ])
    })
    await waitFor(() => {
      expect(rows('Offen bei anderen')).toEqual([
        'Tor schmierenFällig am 10.01.2099, verantwortlich: Lena VogtGebäude Halle 1, Werkhof NordErledigt',
      ])
    })
  })

  it('writes a new task at the record chosen, for somebody who sees its area', async () => {
    const client = await mount('/aufgaben')

    await userEvent.click(await screen.findByRole('button', { name: 'Aufgabe anlegen' }))
    await userEvent.type(screen.getByLabelText(/Was zu tun ist/), 'Lampen tauschen')
    await userEvent.selectOptions(screen.getByLabelText(/Woran/), `buildingId:${hall.id}`)

    const responsible = screen.getByLabelText(/Verantwortlich/) as HTMLSelectElement

    await waitFor(() => {
      expect(Array.from(responsible.options).map((option) => option.text)).toEqual([
        'Pia Person (Sie)',
        'Lena Vogt',
      ])
    })
    await userEvent.selectOptions(responsible, 'u-lena')
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Neue Aufgabe' })).getByRole('button', {
        name: 'Aufgabe anlegen',
      }),
    )
    await client.synchronise()

    expect(server.queued()).toEqual([
      {
        entity: taskEntity,
        kind: 'create',
        values: expect.objectContaining({
          title: 'Lampen tauschen',
          assigneeUserId: 'u-lena',
          status: 'open',
          propertyId: yard.id,
          buildingId: hall.id,
        }) as unknown,
      },
    ])
  })

  it('offers Haustechnik only itself, and asks nobody for the others', async () => {
    signedIn('technician')
    await mount('/aufgaben')

    await userEvent.click(await screen.findByRole('button', { name: 'Aufgabe anlegen' }))
    await userEvent.selectOptions(screen.getByLabelText(/Woran/), `propertyId:${school.id}`)

    expect(
      Array.from((screen.getByLabelText(/Verantwortlich/) as HTMLSelectElement).options).map(
        (option) => option.text,
      ),
    ).toEqual(['Pia Person (Sie)'])
    expect(asked).not.toContain('/tasks/candidates')
  })

  it('offers the property itself as what a new task hangs on only to whoever holds its area, and its buildings all the same (#310)', async () => {
    // Pia holds a hall of the school in an area of its own, not the area of the school.
    answers.set('/areas', [{ id: 'a-nord', name: 'Nord' }])
    server.put('buildings', {
      ...hall,
      id: 'b-gym',
      propertyId: school.id,
      areaId: 'a-nord',
      ownAreaId: 'a-nord',
      name: 'Turnhalle',
    })
    await mount('/aufgaben')

    await userEvent.click(await screen.findByRole('button', { name: 'Aufgabe anlegen' }))

    const places = () =>
      Array.from((screen.getByLabelText(/Woran/) as HTMLSelectElement).options).map(
        (option) => option.text,
      )

    await waitFor(() => {
      expect(places()).toContain('Gebäude Turnhalle, Schulzentrum Am Lindenhain')
    })
    await waitFor(() => {
      expect(places()).not.toContain('Liegenschaft Schulzentrum Am Lindenhain')
    })
    expect(places()).toContain('Liegenschaft Werkhof Nord')
  })

  it('lets Haustechnik mark its own task done and not the task of somebody else', async () => {
    signedIn('technician')
    const client = await mount('/aufgaben')

    await waitFor(() => {
      expect(rows('Offen bei anderen')).toHaveLength(1)
    })
    expect(card('Offen bei anderen').queryByRole('button', { name: 'Erledigt' })).toBeNull()

    await userEvent.click(card('Ihre Aufgaben').getByRole('button', { name: 'Erledigt' }))
    await client.synchronise()

    expect(server.queued()).toEqual([
      { entity: taskEntity, kind: 'update', values: { status: 'done' } },
    ])
  })
})

describe('the card "Aufgaben" on the page of a property', () => {
  it('shows every task on the property, with the record it hangs on beside the property, and writes a new one there', async () => {
    const client = await mount(`/liegenschaften/${yard.id}`)

    await waitFor(() => {
      expect(rows('Aufgaben')).toEqual([
        'Plaketten bestellenFällig am 01.01.2020, überfällig, verantwortlich: SieErledigt',
        'Tor schmierenFällig am 10.01.2099, verantwortlich: Lena VogtGebäude Halle 1, Werkhof NordErledigt',
        'Schon erledigtFällig am 10.01.2099, verantwortlich: Lena Vogt, erledigtWieder öffnen',
      ])
    })

    await userEvent.click(card('Aufgaben').getByRole('button', { name: 'Aufgabe anlegen' }))
    await userEvent.type(card('Aufgaben').getByLabelText(/Was zu tun ist/), 'Hof kehren')
    await userEvent.click(card('Aufgaben').getByRole('button', { name: 'Aufgabe anlegen' }))
    await client.synchronise()

    expect(server.queued()).toEqual([
      {
        entity: taskEntity,
        kind: 'create',
        values: expect.objectContaining({
          title: 'Hof kehren',
          assigneeUserId: 'u-1',
          propertyId: yard.id,
        }) as unknown,
      },
    ])
    expect(server.queued()[0]?.values).not.toHaveProperty('buildingId')
  })
})

describe('the tasks as a table (#236)', () => {
  it('are asked for by whoever looks at tasks', async () => {
    await mount('/aufgaben')
    await waitFor(() => {
      expect(rows('Ihre Aufgaben')).toHaveLength(1)
    })

    // After the answers of the test, which it hands every other request to.
    const tables = servingTables()

    fireEvent.click(screen.getByRole('button', { name: 'Als Tabelle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await waitFor(() => {
      expect(tables.asked).toEqual(['/tasks/table?format=csv'])
    })
  })
})
