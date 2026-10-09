import 'fake-indexeddb/auto'

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { fingerprintOf, pageOnDevice } from '../../app/signing.js'
import { heaterDuty, lineOf } from '../test-form.js'
import {
  afterEachSiteTest,
  goOffline,
  goOnline,
  heater,
  mountSite,
  queued,
  school,
  schoolServer,
  tooCold,
} from '../test-site.js'

/**
 * A work order on site (#118), the boards "Auftrag (4.8)", "Notiz (4.8)" and
 * "Auftrag abschließen (4.8)": notes as entries of their own, which nothing
 * changes once saved, the time spent, and the finishing with the signature,
 * which stands for the person who leads the order alone. All of it goes
 * through the outbox, also without a network.
 */

afterEach(afterEachSiteTest)

/** The person signed in on the device of these tests. */
const me = 'u-1'

const order = {
  id: 'ac-order',
  propertyId: school.id,
  areaId: school.areaId,
  buildingId: null,
  roomId: null,
  assetId: heater.id,
  kind: 'work_order',
  status: 'open',
  title: 'Speicher entkalken',
  formKey: null,
  formVersion: null,
  performedOn: null,
  dueOn: '2026-10-01',
  responsibleUserId: me,
  performer: null,
  performerUserId: null,
}

const workOrder = {
  id: 'wo-order',
  propertyId: school.id,
  areaId: school.areaId,
  activityId: order.id,
  number: 'AU-2026-0031',
  kind: 'defect_remedy',
  urgency: 'urgent',
  originDefectId: tooCold.id,
  durationMinutes: null,
}

/** The school with the order, led by whoever the test names; the person signed in works on it beside. */
function orderServer(
  activity: Readonly<Record<string, unknown>> = {},
  further: Readonly<Record<string, unknown>> = {},
) {
  const server = schoolServer()

  server.put('activities', { ...order, ...activity })
  server.put('work_orders', { ...workOrder, ...further })

  if (activity['responsibleUserId'] !== undefined && activity['responsibleUserId'] !== me) {
    server.put('work_order_participants', {
      id: 'wp-me',
      propertyId: school.id,
      areaId: school.areaId,
      activityId: order.id,
      userId: me,
    })
  }

  return server
}

/** Signs in the pad with a finger, three points of one stroke. */
function draw() {
  const field = screen.getByRole('img', { name: 'Feld für die Unterschrift' })

  Object.assign(field, {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 500,
      height: 200,
      right: 500,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setPointerCapture: () => undefined,
  })
  fireEvent.pointerDown(field, { pointerId: 1, clientX: 50, clientY: 150 })
  fireEvent.pointerMove(field, { pointerId: 1, clientX: 120, clientY: 60 })
  fireEvent.pointerMove(field, { pointerId: 1, clientX: 200, clientY: 140 })
  fireEvent.pointerUp(field, { pointerId: 1, clientX: 200, clientY: 140 })
}

describe('a work order on site', () => {
  it('names where it is, what it came of and who leads it, and offers the finishing to that person', async () => {
    await mountSite(`/vorgaenge/${order.id}`, { server: orderServer() })

    expect(await screen.findByRole('heading', { name: 'Speicher entkalken' })).toBeDefined()
    expect(screen.getByText('AU-2026-0031')).toBeDefined()
    expect(screen.getByText('Mangelbeseitigung · dringend')).toBeDefined()
    expect(screen.getByText('Frist 01.10.2026, überschritten')).toBeDefined()
    expect(
      screen.getByText('Mangel vom 01.10.2026: Warmwasser am Speicheraustritt 55,5 °C'),
    ).toBeDefined()
    expect(screen.getByText('Pia Person, Sie')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeDefined()
    expect(screen.getByText('Nur Sie als verantwortliche Person schließen ab.')).toBeDefined()
  })

  it('offers a further person notes, photos and the time spent, and not the finishing', async () => {
    await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer({ responsibleUserId: 'u-lead' }),
    })

    await screen.findByRole('heading', { name: 'Speicher entkalken' })
    expect(screen.getByRole('button', { name: 'Notiz schreiben' })).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'Dauer' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Abschließen' })).toBeNull()
    expect(screen.getByText('Abschließen kann einen Auftrag nur, wer ihn führt.')).toBeDefined()
  })

  it('offers the finishing to nobody while nobody leads it', async () => {
    await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer({ responsibleUserId: null }),
    })

    await screen.findByRole('heading', { name: 'Speicher entkalken' })
    expect(screen.queryByRole('button', { name: 'Abschließen' })).toBeNull()
    expect(
      screen.getByText(
        'Diesen Auftrag führt noch niemand. Abschließen kann ihn, wem das Büro ihn gibt.',
      ),
    ).toBeDefined()
  })

  it('takes a note as an entry of its own, without a network, which nothing changes afterwards', async () => {
    const { server, client, router } = await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer({ responsibleUserId: 'u-lead' }),
    })

    await screen.findByRole('heading', { name: 'Speicher entkalken' })
    goOffline(server)
    fireEvent.click(screen.getByRole('button', { name: 'Notiz schreiben' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Notiz' }), {
      target: { value: '  Speicher entleert, Kalk ausgespült.  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}`)
    })

    const notes = await screen.findByRole('list', { name: 'Notizen' })

    expect(within(notes).getByText('Speicher entleert, Kalk ausgespült.')).toBeDefined()
    expect(within(notes).getByText(/noch nicht übertragen/)).toBeDefined()
    // A note is an entry and nothing to tap: no way leads to changing it.
    expect(within(notes).queryByRole('button')).toBeNull()
    expect(within(notes).queryByRole('link')).toBeNull()

    // Nor does the device change or remove it.
    const note = client.list('work_order_notes')[0]

    expect(
      (await client.update('work_order_notes', String(note?.['id']), { text: 'x' })).outcome,
    ).toBe('refused')
    expect((await client.remove('work_order_notes', String(note?.['id']))).outcome).toBe('refused')

    goOnline(server)
    await client.synchronise()

    const written = queued(server).filter((each) => each.entity === 'work_order_notes')

    expect(written).toEqual([
      {
        entity: 'work_order_notes',
        kind: 'create',
        values: {
          activityId: order.id,
          text: 'Speicher entleert, Kalk ausgespült.',
          writtenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      },
    ])
    // The first of the work begins the order, with its day.
    expect(queued(server).find((each) => each.entity === 'activities')?.values).toMatchObject({
      status: 'started',
    })
  })

  it('takes the time spent as hours and minutes, and says how it is written when it is not', async () => {
    const { server } = await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer({ responsibleUserId: 'u-lead' }),
    })
    const field = await screen.findByRole('textbox', { name: 'Dauer' })

    fireEvent.change(field, { target: { value: '1,5' } })
    fireEvent.blur(field)
    expect(
      await screen.findByText(
        'Die Dauer sind Stunden und Minuten, etwa 0:45 oder 2:30, höchstens 9999:59.',
      ),
    ).toBeDefined()
    expect(queued(server).some((each) => each.entity === 'work_orders')).toBe(false)

    fireEvent.change(field, { target: { value: '0:45' } })
    fireEvent.blur(field)

    await waitFor(() => {
      expect(queued(server).find((each) => each.entity === 'work_orders')).toEqual({
        entity: 'work_orders',
        kind: 'update',
        values: { durationMinutes: 45 },
      })
    })
  })

  it('is finished by the person who leads it, with the signature for the page as the device holds it', async () => {
    const { server, client, router } = await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer(
        { status: 'started', performedOn: '2026-10-05' },
        { durationMinutes: 45 },
      ),
    })

    await screen.findByRole('heading', { name: 'Speicher entkalken' })
    fireEvent.click(screen.getByRole('button', { name: 'Abschließen' }))
    expect(await screen.findByRole('heading', { name: 'Auftrag abschließen' })).toBeDefined()
    expect(screen.getByText('0:45 Std.')).toBeDefined()
    expect(screen.getByText(/Der Mangel steht mit der Unterschrift auf „Behoben“./)).toBeDefined()

    const sign = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Abschließen und unterschreiben',
    })

    expect(sign.disabled).toBe(true)
    draw()
    await waitFor(() => {
      expect(sign.disabled).toBe(false)
    })

    const page = pageOnDevice(client, order.id)

    // In a cellar: the signature waits on the device, and the order with it.
    goOffline(server)
    fireEvent.click(sign)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}`)
    })
    expect(await screen.findByText('Wartet auf Abnahme')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Notiz schreiben' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Abschließen' })).toBeNull()

    goOnline(server)
    await client.synchronise()

    const signature = queued(server).find((each) => each.entity === 'activity_signatures')

    expect(signature?.values).toMatchObject({
      activityId: order.id,
      role: 'signer',
      pageFingerprint: page === null ? 'none' : await fingerprintOf(page),
    })
    expect(page?.durationMinutes).toBe(45)
  })

  it('is finished by nobody else, also not at the address of the finishing', async () => {
    await mountSite(`/vorgaenge/${order.id}/abschliessen`, {
      server: orderServer({ responsibleUserId: 'u-lead', status: 'started' }),
    })

    expect(
      await screen.findByText('Abschließen kann einen Auftrag nur, wer ihn führt.'),
    ).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Feld für die Unterschrift' })).toBeNull()
  })

  it('with duties is finished with its result, which offers the signature to the person who leads it alone', async () => {
    const server = orderServer({ responsibleUserId: 'u-lead', status: 'started' })

    server.put('duties', heaterDuty)
    server.put('activity_duties', lineOf(order.id))

    await mountSite(`/vorgaenge/${order.id}/ergebnis`, { server })

    expect(
      await screen.findByText('Abschließen kann einen Auftrag nur, wer ihn führt.'),
    ).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Feld für die Unterschrift' })).toBeNull()
  })

  it('with duties leads the person who leads it from its page to its result', async () => {
    const server = orderServer({ status: 'started' })

    server.put('duties', heaterDuty)
    server.put('activity_duties', lineOf(order.id))

    const { router } = await mountSite(`/vorgaenge/${order.id}`, { server })

    await screen.findByRole('heading', { name: 'Speicher entkalken' })
    fireEvent.click(screen.getByRole('button', { name: 'Abschließen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}/ergebnis`)
    })
    expect(await screen.findByRole('img', { name: 'Feld für die Unterschrift' })).toBeDefined()
  })

  it('is open again once the office turned it back, with the reason, and is finished anew', async () => {
    const server = orderServer({ status: 'started', performedOn: '2026-10-05' })
    const atTheSchool = { propertyId: school.id, areaId: school.areaId }

    server.put('duties', heaterDuty)
    server.put('activity_duties', lineOf(order.id))
    server.put('activity_signatures', {
      id: 'sg-old',
      ...atTheSchool,
      activityId: order.id,
      signedBy: me,
      role: 'signer',
      signedAt: '2026-10-05T07:00:00.000Z',
      deviceInfo: null,
      path: 'M10,10L200,300',
      pageFingerprint: 'a'.repeat(64),
    })
    server.put('work_order_decisions', {
      id: 'wd-back',
      ...atTheSchool,
      workOrderId: workOrder.id,
      decision: 'rejected',
      reason: 'Der Speicher tropft noch.',
      decidedBy: 'u-lead',
      decidedAt: '2026-10-05T09:00:00.000Z',
    })

    const { router } = await mountSite(`/vorgaenge/${order.id}`, { server })

    await screen.findByRole('heading', { name: 'Speicher entkalken' })
    expect(screen.getByText('Im Büro zurückgewiesen: Der Speicher tropft noch.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Notiz schreiben' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Abschließen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}/ergebnis`)
    })
    // The signature turned back counts no more, so the result takes a new one.
    expect(await screen.findByRole('img', { name: 'Feld für die Unterschrift' })).toBeDefined()
  })
})
