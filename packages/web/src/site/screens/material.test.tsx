import 'fake-indexeddb/auto'

import { serviceReportPageOf } from '@opengewerk/haustechnik-domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { pageOnDevice, reportPageOnDevice } from '../../app/signing.js'
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
 * Material at a work order on site (#326), the boards "Material entnehmen",
 * "Material scannen" and "mehr als im Lager": the barcode of the
 * manufacturer or the own label of a shelf, the store, how much, also without
 * a network. Below zero the stock says so and the withdrawal is taken all the
 * same. The material stands on the page the client signs, without a price.
 */

afterEach(afterEachSiteTest)

const me = 'u-1'
const atTheSchool = { propertyId: school.id, areaId: school.areaId }
const code = 'MATERA7REGA3B5XY'

const order = {
  id: 'ac-order',
  ...atTheSchool,
  buildingId: null,
  roomId: null,
  assetId: heater.id,
  kind: 'work_order',
  status: 'started',
  title: 'Notleuchte Flur instand setzen',
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
  kind: 'other',
  urgency: 'normal',
  originDefectId: null,
  durationMinutes: null,
}

const article = (id: string, designation: string, ean: string | null) => ({
  id,
  number: id.toUpperCase(),
  designation,
  description: null,
  ean,
  unit: 'piece',
  priceCents: 890,
  deletedAt: null,
})

/** The school with the order begun, two stores, two articles, a receipt, and a label on a shelf. */
function stockServer(status = 'started', receivedMilli = 3000) {
  const server = schoolServer()

  server.put('activities', { ...order, status })
  server.put('work_orders', workOrder)
  server.put('stores', { id: 'st-main', name: 'Hauptlager Betriebshof', location: null })
  server.put('stores', { id: 'st-school', name: 'Werkstatt Schulzentrum', location: null })
  server.put('articles', article('a-akku', 'Akku Notleuchte 3,6 V', '4012345678901'))
  server.put('articles', article('a-filter', 'Taschenfilter G4', null))
  server.put('store_articles', {
    id: 'sa-filter',
    storeId: 'st-school',
    articleId: 'a-filter',
    minimumMilli: null,
  })
  server.put('store_labels', { id: 'sl-1', storeArticleId: 'sa-filter', code, blockedAt: null })
  server.put('stock_movements', {
    id: 'sm-1',
    storeId: 'st-main',
    articleId: 'a-akku',
    kind: 'receipt',
    quantityMilli: receivedMilli,
    supplierId: null,
    reason: null,
    bookedBy: 'u-lead',
    bookedAt: null,
    materialId: null,
    createdAt: '2026-10-01T08:00:00.000Z',
  })

  return server
}

async function toMaterial(server = stockServer()) {
  const site = await mountSite(`/vorgaenge/${order.id}`, { server })

  await screen.findByRole('heading', { name: order.title })
  fireEvent.click(screen.getByRole('button', { name: 'Material entnehmen' }))
  await screen.findByRole('heading', { name: 'Material entnehmen' })

  return site
}

describe('material at a work order', () => {
  it('is taken by the barcode of its manufacturer without a network, says what it does to the stock, and waits to be sent', async () => {
    const { server, client, router, hold } = await toMaterial()

    goOffline(server)
    fireEvent.click(screen.getByRole('button', { name: 'Strichcode oder Etikett scannen' }))
    await screen.findByRole('heading', { name: 'Material scannen' })
    hold('4012345678901')

    expect(await screen.findByText('am Strichcode des Herstellers')).toBeDefined()
    expect(screen.getByText('A-AKKU Akku Notleuchte 3,6 V')).toBeDefined()
    fireEvent.change(screen.getByLabelText(/^Menge/), { target: { value: '2' } })
    expect(screen.getByText('Im Lager: 3 Stück, danach 1 Stück.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Entnehmen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/vorgaenge/${order.id}`)
    })

    const card = within(await screen.findByRole('list', { name: 'Material' }))

    expect(card.getByText('2 Stück Akku Notleuchte 3,6 V')).toBeDefined()
    expect(card.getByText(/noch nicht übertragen/)).toBeDefined()

    goOnline(server)
    await client.synchronise()
    expect(
      queued(server).find((each) => each.entity === 'work_order_materials')?.values,
    ).toMatchObject({
      activityId: order.id,
      storeId: 'st-main',
      articleId: 'a-akku',
      quantityMilli: 2000,
    })
  })

  it('finds a shelf by its own label, with its store', async () => {
    const { hold } = await toMaterial()

    fireEvent.click(screen.getByRole('button', { name: 'Strichcode oder Etikett scannen' }))
    await screen.findByRole('heading', { name: 'Material scannen' })
    hold(`https://haustechnik.example/a/${code}`)

    expect(await screen.findByText('am Etikett des Fachs')).toBeDefined()
    expect(screen.getByText('A-FILTER Taschenfilter G4')).toBeDefined()
    expect((screen.getByLabelText('Lager') as HTMLSelectElement).value).toBe('st-school')
  })

  it('says so for a code the stores do not know, and leaves the search', async () => {
    const { hold } = await toMaterial()

    fireEvent.click(screen.getByRole('button', { name: 'Strichcode oder Etikett scannen' }))
    await screen.findByRole('heading', { name: 'Material scannen' })
    hold('9999999999994')

    expect(
      await screen.findByText('Diesen Code kennt das Lager nicht. Bitte über die Suche wählen.'),
    ).toBeDefined()
    fireEvent.change(screen.getByLabelText('Oder suchen'), { target: { value: 'akku' } })
    fireEvent.click(screen.getByRole('button', { name: 'A-AKKU Akku Notleuchte 3,6 V' }))
    expect(screen.getByText('über die Suche')).toBeDefined()
  })

  it('takes more than lies there, and says the stock goes below zero', async () => {
    const { server, client } = await toMaterial(stockServer('started', 1000))

    fireEvent.change(screen.getByLabelText('Oder suchen'), { target: { value: 'A-AKKU' } })
    fireEvent.click(screen.getByRole('button', { name: 'A-AKKU Akku Notleuchte 3,6 V' }))
    fireEvent.change(screen.getByLabelText(/^Menge/), { target: { value: '3' } })

    expect(
      screen.getByText(
        'Entnommen wird trotzdem. Der Bestand steht danach bei -2 Stück und sagt es, bis eine Zählung ihn berichtigt.',
      ),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Entnehmen' }))
    await waitFor(async () => {
      await client.synchronise()
      expect(
        queued(server).find((each) => each.entity === 'work_order_materials')?.values,
      ).toMatchObject({ quantityMilli: 3000 })
    })
  })

  it('is not offered on an order that is signed', async () => {
    await mountSite(`/vorgaenge/${order.id}`, { server: stockServer('signed') })

    await screen.findByRole('heading', { name: order.title })
    expect(screen.queryByRole('button', { name: 'Material entnehmen' })).toBeNull()
  })

  it('stands on the page the client signs, without a price, and in its fingerprint', async () => {
    const server = stockServer()

    server.put('work_order_materials', {
      id: 'wm-1',
      ...atTheSchool,
      activityId: order.id,
      storeId: 'st-main',
      articleId: 'a-akku',
      quantityMilli: 2000,
      takenAt: '2026-10-05T07:10:00.000Z',
      takenBy: me,
    })

    const { client } = await mountSite(`/vorgaenge/${order.id}/leistungsnachweis`, { server })

    expect(await screen.findByText('2 Stück Akku Notleuchte 3,6 V')).toBeDefined()
    expect(screen.queryByText(/8,90|€/)).toBeNull()

    const page = pageOnDevice(client, order.id)

    // The page the device has the client sign carries the material, by key,
    // as the server works it out (#326).
    expect(page).not.toBeNull()
    expect(reportPageOnDevice(client, order.id, 'Petra Lang')).toEqual(
      serviceReportPageOf(page ?? (null as never), 'Petra Lang', false, [
        { id: 'wm-1', quantityMilli: 2000, unit: 'piece', designation: 'Akku Notleuchte 3,6 V' },
      ]),
    )
  })
})
