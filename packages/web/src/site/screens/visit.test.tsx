import 'fake-indexeddb/auto'

import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { servingCatalogue, testCatalogue, unacceptedReview } from '../../app/test-catalogue.js'
import {
  afterEachSiteTest,
  goOffline,
  goOnline,
  heater,
  mountSite,
  queued,
  school,
  schoolServer,
} from '../test-site.js'

/**
 * A contractor at work at a work order on site (#330), the boards "Auftrag
 * einer Fremdfirma", "Einweisung" and "Erlaubnisschein": the card on the
 * order, a briefing with the drawing of whoever was briefed and the permit
 * for hot work in the form of the package Brandschutz, for whoever leads the
 * order or plans and hands out work, through the outbox and so also without
 * a network.
 */

afterEach(afterEachSiteTest)

/** The person signed in on the device of these tests. */
const me = 'u-1'
const atTheSchool = { propertyId: school.id, areaId: school.areaId }
const heating = { id: 'c-heating', name: 'Heizungsbau Beispiel GmbH', deletedAt: null }

const order = {
  id: 'ac-order',
  ...atTheSchool,
  buildingId: null,
  roomId: null,
  assetId: heater.id,
  kind: 'work_order',
  status: 'started',
  title: 'Undichte Lötstelle am Heizungsrücklauf instand setzen',
  formKey: null,
  formVersion: null,
  performedOn: null,
  dueOn: '2026-10-20',
  responsibleUserId: me,
  performer: 'contractor',
  performerUserId: null,
  contractorId: heating.id,
}

const workOrder = {
  id: 'wo-order',
  ...atTheSchool,
  activityId: order.id,
  number: 'AU-2026-0034',
  kind: 'other',
  urgency: 'normal',
  originDefectId: null,
  durationMinutes: null,
}

/** The catalogue with the permit for hot work of the package Brandschutz in it. */
const withPermit: CatalogueBundle = {
  ...testCatalogue,
  sha256: 'with-the-permit',
  packages: testCatalogue.packages.map((pack, index) =>
    index === 0
      ? {
          ...pack,
          forms: [
            ...pack.forms,
            {
              key: 'brandschutz.hot_work_permit',
              version: 1,
              validFrom: '2020-01-01',
              review: unacceptedReview,
              definition: {
                title: 'Erlaubnisschein für feuergefährliche Arbeiten',
                sections: [
                  {
                    key: 'work',
                    title: 'Arbeiten',
                    fields: [
                      { kind: 'text', key: 'place', label: 'Arbeitsort', required: true },
                      {
                        kind: 'choice',
                        key: 'combustibles',
                        label: 'Brennbares im Umkreis entfernt oder abgedeckt',
                        required: true,
                        options: [
                          { value: 'done', label: 'Erledigt' },
                          { value: 'not_needed', label: 'Entfällt' },
                        ],
                      },
                    ],
                  },
                  {
                    key: 'end',
                    title: 'Ausführende Person',
                    fields: [
                      {
                        kind: 'signature',
                        key: 'contractor_signature',
                        label: 'Unterschrift der ausführenden Person',
                        required: true,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }
      : pack,
  ),
}

/** The school with the order of the firm begun, led by whoever the test names. */
function orderServer(activity: Readonly<Record<string, unknown>> = {}) {
  const server = schoolServer()

  server.put('contractors', heating)
  server.put('activities', { ...order, ...activity })
  server.put('work_orders', workOrder)

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

describe('a firm at work at a work order on site', () => {
  it('offers the briefing and the permit to whoever leads the order', async () => {
    await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer(),
      answers: servingCatalogue(withPermit),
    })

    await screen.findByRole('heading', { name: 'Fremdfirma vor Ort' })
    expect(screen.getByText('Heizungsbau Beispiel GmbH')).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Einweisen' })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Erlaubnisschein ausstellen' })).toBeDefined()
  })

  it('offers neither to somebody else of the Haustechnik who works on the order', async () => {
    await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer({ responsibleUserId: 'u-2' }),
      answers: servingCatalogue(withPermit),
    })
    await screen.findByRole('heading', { name: 'Fremdfirma vor Ort' })
    expect(
      screen.getByText(
        'Einweisen und einen Erlaubnisschein ausstellen kann, wer den Auftrag führt oder Arbeit plant und verteilt.',
      ),
    ).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Einweisen' })).toBeNull()
  })

  it('offers both to the Objektleitung, which plans and hands out work', async () => {
    await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer({ responsibleUserId: 'u-2' }),
      role: 'site_management',
      answers: servingCatalogue(withPermit),
    })
    expect(await screen.findByRole('button', { name: 'Einweisen' })).toBeDefined()
  })

  it('shows no such card on an order of the own people', async () => {
    await mountSite(`/vorgaenge/${order.id}`, {
      server: orderServer({ performer: 'own_staff', contractorId: null }),
      answers: servingCatalogue(withPermit),
    })
    await screen.findByRole('heading', { name: 'Auftrag' })
    expect(screen.queryByRole('heading', { name: 'Fremdfirma vor Ort' })).toBeNull()
  })

  it('takes a briefing with the name, what it was about and the drawing, also without a network', async () => {
    const { server, client, router } = await mountSite(`/vorgaenge/${order.id}/einweisung`, {
      server: orderServer(),
    })

    await screen.findByRole('heading', { name: 'Einweisung' })

    const confirm = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Einweisung bestätigen',
    })

    fireEvent.change(screen.getByLabelText('Name in Druckschrift'), {
      target: { value: ' Marco Petri ' },
    })
    fireEvent.change(screen.getByLabelText('Worin eingewiesen'), {
      target: { value: 'Fluchtwege, Brandmeldeanlage im Heizraum' },
    })
    // Without the drawing it is no briefing.
    expect(confirm.disabled).toBe(true)
    draw('Unterschrift der eingewiesenen Person')
    await waitFor(() => {
      expect(confirm.disabled).toBe(false)
    })

    goOffline(server)
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}`)
    })
    expect(await screen.findByText('Marco Petri eingewiesen')).toBeDefined()

    goOnline(server)
    await client.synchronise()

    expect(queued(server).find((each) => each.entity === 'briefings')?.values).toMatchObject({
      activityId: order.id,
      contractorId: heating.id,
      personName: 'Marco Petri',
      subject: 'Fluchtwege, Brandmeldeanlage im Heizraum',
    })
  })

  it('issues a permit in the version of its form once every field is answered, the signature of whoever carries the work out among them', async () => {
    const { server, client, router } = await mountSite(`/vorgaenge/${order.id}/erlaubnisschein`, {
      server: orderServer(),
      answers: servingCatalogue(withPermit),
    })

    await screen.findByText('Formular aus dem Paket Brandschutz, Fassung 1')

    const grant = screen.getByRole<HTMLButtonElement>('button', { name: 'Erlaubnis erteilen' })

    fireEvent.change(screen.getByLabelText('Arbeitsort'), { target: { value: 'Heizraum' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Erledigt' }))
    fireEvent.change(screen.getByLabelText('Name in Druckschrift'), {
      target: { value: 'Marco Petri' },
    })
    // Without the signature of whoever carries the work out, no permit.
    expect(grant.disabled).toBe(true)
    draw('Unterschrift der ausführenden Person')
    await waitFor(() => {
      expect(grant.disabled).toBe(false)
    })

    fireEvent.click(grant)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}`)
    })
    await client.synchronise()

    const permit = queued(server).find((each) => each.entity === 'work_permits')?.values

    expect(permit).toMatchObject({
      activityId: order.id,
      contractorId: heating.id,
      formKey: 'brandschutz.hot_work_permit',
      formVersion: 1,
    })
    expect(JSON.parse(String(permit?.['answers']))).toMatchObject({
      place: 'Heizraum',
      combustibles: 'done',
      contractor_signature: { name: 'Marco Petri' },
    })
  })
})
