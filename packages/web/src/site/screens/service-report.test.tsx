import 'fake-indexeddb/auto'

import { serviceReportPageOf } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { fingerprintOf, pageOnDevice } from '../../app/signing.js'
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
 * The service report of a work order on site (#324), the boards "Auftrag
 * abschließen (4.8)", "Leistungsnachweis: der Auftraggeber unterschreibt" and
 * "Auftrag abschließen, Leistungsnachweis unterschrieben": a step before the
 * own signature, for the person who leads the order alone, once while it
 * counts, through the outbox and so also without a network.
 */

afterEach(afterEachSiteTest)

/** The person signed in on the device of these tests. */
const me = 'u-1'
const atTheSchool = { propertyId: school.id, areaId: school.areaId }

const order = {
  id: 'ac-order',
  ...atTheSchool,
  buildingId: null,
  roomId: null,
  assetId: heater.id,
  kind: 'work_order',
  status: 'started',
  title: 'Speicher entkalken',
  formKey: null,
  formVersion: null,
  performedOn: '2026-10-05',
  dueOn: '2026-10-01',
  responsibleUserId: me,
  performer: null,
  performerUserId: null,
}

const workOrder = {
  id: 'wo-order',
  ...atTheSchool,
  activityId: order.id,
  number: 'AU-2026-0031',
  kind: 'defect_remedy',
  urgency: 'urgent',
  originDefectId: tooCold.id,
  durationMinutes: 45,
}

/** The school with the order begun and a note on it, led by whoever the test names. */
function orderServer(activity: Readonly<Record<string, unknown>> = {}) {
  const server = schoolServer()

  server.put('activities', { ...order, ...activity })
  server.put('work_orders', workOrder)
  server.put('work_order_notes', {
    id: 'wn-1',
    ...atTheSchool,
    activityId: order.id,
    text: 'Speicher gespült, Anode getauscht.',
    writtenAt: '2026-10-05T06:55:00.000Z',
    writtenBy: me,
  })

  if (activity['responsibleUserId'] !== undefined && activity['responsibleUserId'] !== me) {
    server.put('work_order_participants', {
      id: 'wp-me',
      ...atTheSchool,
      activityId: order.id,
      userId: me,
    })
  }

  return server
}

/** A report the server took, at the moment it stamped. */
function aReport(createdAt: string) {
  return {
    id: 'sr-held',
    ...atTheSchool,
    activityId: order.id,
    clientName: 'Jonas Albrecht',
    path: 'M10,10L200,300',
    signedBy: me,
    signedAt: createdAt,
    deviceInfo: null,
    pageFingerprint: 'a'.repeat(64),
    createdAt,
  }
}

/** Signs in a pad with a finger, three points of one stroke. */
function draw(name: string) {
  const field = screen.getByRole('img', { name })

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

const clientPad = 'Feld für die Unterschrift des Auftraggebers'

describe('the service report of a work order on site', () => {
  it('is signed by the client before the own signature, with the name in block letters, for the page as the device holds it, without a network', async () => {
    const { server, client, router } = await mountSite(`/vorgaenge/${order.id}/abschliessen`, {
      server: orderServer(),
    })

    await screen.findByRole('heading', { name: 'Auftrag abschließen' })
    fireEvent.click(screen.getByRole('button', { name: 'Vom Auftraggeber unterschreiben lassen' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}/leistungsnachweis`)
    })

    expect(await screen.findByText('Speicher gespült, Anode getauscht.')).toBeDefined()
    expect(screen.getByText('0:45 Std.')).toBeDefined()
    expect(
      screen.getByText(
        'Ohne Preise. Namen und Uhrzeiten der Ausführenden stehen nicht darauf, nur der Tag.',
      ),
    ).toBeDefined()

    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Unterschrift bestätigen',
    })

    // Neither the drawing alone nor the name alone is a report.
    draw(clientPad)
    await waitFor(() => {
      expect(screen.getByRole('img', { name: clientPad })).toBeDefined()
    })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Name in Druckschrift'), {
      target: { value: '  Petra Lang ' },
    })
    await waitFor(() => {
      expect(confirm.disabled).toBe(false)
    })

    const page = pageOnDevice(client, order.id)

    goOffline(server)
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}/abschliessen`)
    })
    expect(await screen.findByText('Petra Lang')).toBeDefined()
    expect(screen.getByText('heute, mit Schriftzug')).toBeDefined()
    expect(
      screen.getByText(
        'Der Leistungsnachweis entsteht als PDF, sobald die Unterschrift übertragen ist.',
      ),
    ).toBeDefined()
    // No second one while this one counts.
    expect(
      screen.queryByRole('button', { name: 'Vom Auftraggeber unterschreiben lassen' }),
    ).toBeNull()

    goOnline(server)
    await client.synchronise()

    const report = queued(server).find((each) => each.entity === 'service_reports')

    expect(report?.values).toMatchObject({
      activityId: order.id,
      clientName: 'Petra Lang',
      pageFingerprint:
        page === null
          ? 'none'
          : await fingerprintOf(serviceReportPageOf(page, 'Petra Lang', false)),
    })
    expect(typeof report?.values['path']).toBe('string')
  })

  it('says that names and times stand on it where the operator switched it on, and its page carries that', async () => {
    const server = orderServer()

    server.put('work_order_settings', { id: 'ws-1', tenantId: 't-1', namesAndTimes: true })

    const { client } = await mountSite(`/vorgaenge/${order.id}/leistungsnachweis`, { server })

    expect(
      await screen.findByText(
        'Ohne Preise. Auf dem Leistungsnachweis steht auch, wer jede Notiz geschrieben hat und um welche Uhrzeit, und die Uhrzeit der Unterschrift.',
      ),
    ).toBeDefined()

    draw(clientPad)
    fireEvent.change(screen.getByLabelText('Name in Druckschrift'), {
      target: { value: 'Petra Lang' },
    })

    const page = pageOnDevice(client, order.id)
    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Unterschrift bestätigen',
    })

    await waitFor(() => {
      expect(confirm.disabled).toBe(false)
    })
    fireEvent.click(confirm)
    await screen.findByText('Petra Lang')
    await client.synchronise()

    expect(queued(server).find((each) => each.entity === 'service_reports')?.values).toMatchObject({
      pageFingerprint:
        page === null ? 'none' : await fingerprintOf(serviceReportPageOf(page, 'Petra Lang', true)),
    })
  })

  it('is taken by nobody but the person who leads the order', async () => {
    await mountSite(`/vorgaenge/${order.id}/leistungsnachweis`, {
      server: orderServer({ responsibleUserId: 'u-lead' }),
    })

    expect(
      await screen.findByText('Abschließen kann einen Auftrag nur, wer ihn führt.'),
    ).toBeDefined()
    expect(screen.queryByRole('img', { name: clientPad })).toBeNull()
  })

  it('is not offered a second time while one counts', async () => {
    const server = orderServer()

    server.put('service_reports', aReport('2026-10-05T07:00:00.000Z'))

    await mountSite(`/vorgaenge/${order.id}/abschliessen`, { server })

    expect(await screen.findByText('Jonas Albrecht')).toBeDefined()
    expect(screen.getByText('Der Leistungsnachweis liegt als PDF am Auftrag.')).toBeDefined()
    expect(
      screen.queryByRole('button', { name: 'Vom Auftraggeber unterschreiben lassen' }),
    ).toBeNull()
  })

  it('is offered again once the office turned the order back after the one it had', async () => {
    const turnedBack = orderServer()

    turnedBack.put('service_reports', aReport('2026-10-05T07:00:00.000Z'))
    turnedBack.put('work_order_decisions', {
      id: 'wd-back',
      ...atTheSchool,
      workOrderId: workOrder.id,
      decision: 'rejected',
      reason: 'Der Speicher tropft noch.',
      decidedBy: 'u-lead',
      decidedAt: '2026-10-05T09:00:00.000Z',
      createdAt: '2026-10-05T09:00:00.000Z',
    })

    await mountSite(`/vorgaenge/${order.id}/abschliessen`, { server: turnedBack })

    expect(
      await screen.findByRole('button', { name: 'Vom Auftraggeber unterschreiben lassen' }),
    ).toBeDefined()
    expect(screen.queryByText('Jonas Albrecht')).toBeNull()
  })

  it('at its own address says so when the order has one that counts', async () => {
    const server = orderServer()

    server.put('service_reports', aReport('2026-10-05T07:00:00.000Z'))

    await mountSite(`/vorgaenge/${order.id}/leistungsnachweis`, { server })

    expect(
      await screen.findByText('Dieser Auftrag hat schon einen Leistungsnachweis.'),
    ).toBeDefined()
  })
})
