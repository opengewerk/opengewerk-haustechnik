import 'fake-indexeddb/auto'

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { formCatalogue, heaterDuty, round } from '../test-form.js'
import {
  afterEachSiteTest,
  goOffline,
  heater,
  house,
  mountSite,
  school,
  schoolServer,
} from '../test-site.js'

/**
 * The start on site (#114), the boards "Start: heute und diese Woche",
 * "Start ohne Netz" and "Tablet quer": what the person who holds the device
 * has to do today and this week, the begun one on top, and on a tablet held
 * across the round beside the list.
 */

const withTheForm = { answers: servingCatalogue(formCatalogue) }

const atTheSchool = { propertyId: school.id, areaId: school.areaId }

/** The round of the Heizraum, begun this Monday, two of its three points that have to be answered given. */
const begun = { ...round, status: 'started', dueOn: '2026-10-05', performedOn: '2026-10-05' }

/** A work order of the operator, past its day. */
const order = {
  id: 'ac-order',
  ...atTheSchool,
  buildingId: house.id,
  roomId: null,
  assetId: null,
  kind: 'work_order',
  status: 'open',
  title: 'Notleuchte Flur 1. OG instand setzen',
  dueOn: '2026-09-28',
  performer: 'own_staff',
  performerUserId: null,
  responsibleUserId: null,
}

/** The inspection of the heater on Wednesday. */
const inspection = {
  ...order,
  id: 'ac-heater',
  buildingId: null,
  assetId: heater.id,
  kind: 'inspection',
  title: 'Prüfung des Speichers',
  dueOn: '2026-10-07',
}

/** A round of the plan on Thursday, and one given to somebody else. */
const thursday = {
  ...order,
  id: 'ac-thursday',
  kind: 'round',
  title: 'Trinkwasser, Entnahmestellen',
  dueOn: '2026-10-08',
}
const someoneElses = {
  ...thursday,
  id: 'ac-else',
  title: 'Rundgang Sporthalle',
  performerUserId: 'u-other',
}

function startServer() {
  const server = schoolServer()

  server.put('duties', heaterDuty)

  for (const activity of [begun, order, inspection, thursday, someoneElses]) {
    server.put('activities', activity)
  }

  server.put('work_orders', {
    id: 'wo-order',
    ...atTheSchool,
    activityId: order.id,
    number: 'AU-2026-0031',
    kind: 'fault',
    urgency: 'urgent',
    originDefectId: null,
  })

  for (const [key, values] of [
    ['outlet', { value: '61000' }],
    ['door_closes', { result: 'ok' }],
  ] as const) {
    server.put('activity_answers', {
      id: `an-${key}`,
      ...atTheSchool,
      activityId: begun.id,
      groupKey: null,
      blockKey: null,
      fieldKey: key,
      value: null,
      result: null,
      remark: null,
      attachmentId: null,
      ...values,
    })
  }

  return server
}

beforeEach(() => {
  // A Monday in the morning, so that the week has its days after it.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T07:30:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
  afterEachSiteTest()
})

describe('the start on site', () => {
  it('puts the begun round on top with how far it is, then today and this week', async () => {
    await mountSite('/', { server: startServer(), ...withTheForm })

    expect(screen.getByRole('heading', { level: 1, name: 'Start' })).toBeDefined()
    expect(screen.getByText('Montag, 5. Oktober')).toBeDefined()
    expect(await screen.findByText('2 von 3 beantwortet')).toBeDefined()

    const cards = screen.getAllByRole('link').filter((link) => link.closest('main') !== null)

    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      `/m/vorgaenge/${begun.id}`,
      `/m/vorgaenge/${order.id}`,
      `/m/vorgaenge/${inspection.id}`,
      `/m/vorgaenge/${thursday.id}`,
    ])
    expect(within(cards[0] as HTMLElement).getByText('Rundgang · begonnen')).toBeDefined()

    const today = screen.getByRole('region', { name: 'Heute' })

    expect(within(today).getByText('Auftrag AU-2026-0031 · dringend')).toBeDefined()
    expect(within(today).getByText(`${school.name}, ${house.name}`)).toBeDefined()
    expect(within(today).getByText('Frist 28.09.2026, überschritten')).toBeDefined()

    const week = screen.getByRole('region', { name: 'Diese Woche' })

    expect(within(week).getByText('Prüfung · fällig 07.10.')).toBeDefined()
    expect(within(week).getByText('Schulhaus, AN-00057 Aufzug Heizraum')).toBeDefined()
    expect(within(week).getByText('Rundgang · Donnerstag')).toBeDefined()
    // Four this week; the round of somebody else is not among them.
    expect(screen.getByText('4')).toBeDefined()
    expect(screen.queryByText(someoneElses.title)).toBeNull()
  })

  it('says how many answers of the begun round are still only on this device without a network', async () => {
    const { client, server } = await mountSite('/', { server: startServer(), ...withTheForm })

    expect(await screen.findByText('2 von 3 beantwortet')).toBeDefined()

    goOffline(server)
    await client.create('activity_answers', {
      activityId: begun.id,
      fieldKey: 'heat_meter',
      value: '1284360',
    })

    expect(await screen.findByText('3 von 3 beantwortet · 1 Antwort auf dem Gerät')).toBeDefined()
  })

  it('says so where nothing is to do today and this week', async () => {
    const server = schoolServer()

    server.put('activities', { ...thursday, dueOn: '2026-10-20' })
    await mountSite('/', { server, ...withTheForm })

    expect(screen.getByText('Für heute und diese Woche liegt nichts an.')).toBeDefined()
  })
})

describe('the start on a tablet held across', () => {
  it('stands the begun round beside the list, and another one once it is chosen', async () => {
    const { router } = await mountSite('/', {
      server: startServer(),
      across: true,
      ...withTheForm,
    })

    expect(screen.getByRole('heading', { level: 1, name: 'Start' })).toBeDefined()
    expect(await screen.findByRole('heading', { level: 2, name: begun.title })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Weiter: Heizraum E.14' })).toBeDefined()

    fireEvent.click(screen.getByRole('link', { name: /Trinkwasser, Entnahmestellen/ }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${thursday.id}`)
    })
    // The list stays, with the chosen round marked, and the pane shows it.
    expect(screen.getByRole('heading', { level: 1, name: 'Start' })).toBeDefined()
    expect(
      screen
        .getByRole('link', { name: /Trinkwasser, Entnahmestellen/ })
        .getAttribute('aria-current'),
    ).toBe('page')
  })
})
