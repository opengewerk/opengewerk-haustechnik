import 'fake-indexeddb/auto'

import { addMonths, type IsoDate, keyDateFor } from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { servingCatalogue } from '../../app/test-catalogue.js'
import { formCatalogue, round } from '../test-form.js'
import {
  afterEachSiteTest,
  boilerRoom,
  goOffline,
  goOnline,
  house,
  mountSite,
  queued,
  school,
  schoolServer,
} from '../test-site.js'

/**
 * The meters on site (#120, section 4.9 of the concept): a round of the
 * meters of a property, with the reading of the month before beside each,
 * saved on the device as it is typed, also without a network; the start,
 * which names the properties whose readings are due; and a reading as a
 * point of a round. A figure below the reading before is not taken, one that
 * jumps once the person keeps it.
 */

afterEach(afterEachSiteTest)

const day = today() as IsoDate
const keyDate = keyDateFor(day)
const before = addMonths(keyDate, -1)
const germanDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

const meter = {
  id: 'a-meter',
  propertyId: school.id,
  areaId: school.areaId,
  buildingId: house.id,
  roomId: boilerRoom.id,
  parentAssetId: null,
  kind: 'probe.water_meter',
  number: 'AN-00101',
  mark: 'WZ-01',
  name: 'Hauptwasserzähler Schulhaus',
  meterNumber: '13-882914',
  meterUnit: 'cubic_metres',
  values: '{}',
}
const sub = {
  ...meter,
  id: 'a-sub',
  number: 'AN-00102',
  mark: 'WZ-02',
  name: 'Unterzähler Mensa',
  meterNumber: '13-990127',
}
const locked = {
  ...meter,
  id: 'a-locked',
  number: 'AN-00103',
  mark: 'WZ-05',
  name: 'Wasser Werkstatt',
  meterNumber: '13-551876',
}

function reading(id: string, assetId: string, on: IsoDate, valueMilli: number) {
  return {
    id,
    propertyId: school.id,
    areaId: school.areaId,
    assetId,
    keyDate: on,
    readOn: on,
    valueMilli,
    source: 'by_hand',
    activityId: null,
    correctsId: null,
    correctionReason: null,
    jumpConfirmed: false,
    recordedBy: 'u-lead',
  }
}

/** The school with three meters, one locked, and the readings of the month before. */
function meterServer() {
  const server = schoolServer()

  for (const each of [meter, sub, locked]) {
    server.put('assets', each)
  }

  server.put('meter_readings', reading('r-1', meter.id, before, 4_812_000))
  server.put('meter_readings', reading('r-0', meter.id, addMonths(before, -1), 4_765_500))
  server.put('meter_readings', reading('r-2', sub.id, before, 1_188_900))
  server.put('meter_points', {
    id: 'mp-locked',
    propertyId: school.id,
    areaId: school.areaId,
    assetId: locked.id,
    conversionFactor: null,
    mainMeterId: null,
    controlId: null,
    keyDay: null,
    note: null,
    noteBy: null,
    notedOn: null,
    lockReason: 'Schacht überflutet',
    lockedOn: before,
  })

  return server
}

/** Types a figure into the box of a meter on the round and leaves the box. */
function typeInto(card: HTMLElement, figure: string) {
  const box = within(card).getByRole('textbox', { name: /Stand/ })

  fireEvent.change(box, { target: { value: figure } })
  fireEvent.blur(box)
}

describe('a round of the meters', () => {
  it('shows the meters of a property with the reading of the month before, and leaves out a locked one', async () => {
    await mountSite(`/ablesung/${school.id}`, { server: meterServer() })

    const card = await screen.findByRole('region', { name: 'WZ-01 Hauptwasserzähler Schulhaus' })

    expect(within(card).getByText('Schulhaus, E.14 Heizraum')).toBeDefined()
    expect(within(card).getByText(`Vormonat: 4.812,0 m³ am ${germanDay(before)}`)).toBeDefined()
    expect(screen.getByRole('region', { name: 'WZ-02 Unterzähler Mensa' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'WZ-05 Wasser Werkstatt' })).toBeNull()
    expect(screen.getByText('0 von 2 Zählern abgelesen')).toBeDefined()
    expect(screen.getByText(`${school.name}, Stichtag ${germanDay(keyDate)}`)).toBeDefined()
  })

  it('saves each reading on the device as it is typed, without a network, for the day it is read', async () => {
    const server = meterServer()
    const { client } = await mountSite(`/ablesung/${school.id}`, { server })
    const card = await screen.findByRole('region', { name: 'WZ-01 Hauptwasserzähler Schulhaus' })

    goOffline(server)
    typeInto(card, '4.858,7')

    expect(await within(card).findByText('gesichert')).toBeDefined()
    expect(screen.getByText('1 von 2 Zählern abgelesen')).toBeDefined()

    goOnline(server)
    await client.synchronise()

    expect(queued(server).filter((each) => each.entity === 'meter_readings')).toEqual([
      {
        entity: 'meter_readings',
        kind: 'create',
        values: { assetId: meter.id, readOn: day, valueMilli: 4_858_700, jumpConfirmed: false },
      },
    ])
  })

  it('takes no figure below the reading before, and one that jumps once it is kept', async () => {
    const server = meterServer()
    const { client } = await mountSite(`/ablesung/${school.id}`, { server })
    const card = await screen.findByRole('region', { name: 'WZ-01 Hauptwasserzähler Schulhaus' })

    typeInto(card, '4.000')

    expect((await within(card).findByRole('alert')).textContent).toBe(
      `Kleiner als der letzte Stand vom ${germanDay(before)}, 4.812,0 m³. Wurde der Zähler getauscht, dann über „Zählertausch“.`,
    )

    typeInto(card, '48.120')

    expect(
      await within(card).findByText('Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?'),
    ).toBeDefined()
    expect(client.list('meter_readings')).toHaveLength(3)

    fireEvent.click(within(card).getByRole('button', { name: 'So übernehmen' }))

    await waitFor(() => {
      expect(queued(server).filter((each) => each.entity === 'meter_readings')).toEqual([
        {
          entity: 'meter_readings',
          kind: 'create',
          values: { assetId: meter.id, readOn: day, valueMilli: 48_120_000, jumpConfirmed: true },
        },
      ])
    })
  })
})

describe('the start on site', () => {
  it('names each property whose readings are due, and leads to its round', async () => {
    const { router } = await mountSite('/', { server: meterServer() })

    const card = await screen.findByRole('link', { name: /Ablesung · Stichtag/ })

    expect(within(card).getByText(school.name)).toBeDefined()
    expect(within(card).getByText('2 Zähler')).toBeDefined()

    fireEvent.click(card)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/ablesung/${school.id}`)
    })
  })

  it('names no reading to whoever may not read meters', async () => {
    await mountSite('/', { server: meterServer(), rights: ['activity.read'] })
    await screen.findByRole('heading', { name: 'Start' })

    expect(screen.queryByRole('link', { name: /Ablesung · Stichtag/ })).toBeNull()
  })
})

describe('a reading as a point of a round', () => {
  const template = '0192f0c4-7b4e-7000-8000-0000000000c9'

  function roundServer() {
    const server = meterServer()

    server.put('round_template_versions', {
      id: 'v-1',
      templateId: template,
      formVersion: 1,
      asksCountersignature: false,
      definition: JSON.stringify({
        title: 'Technikzentrale',
        sections: [
          {
            key: 'k1',
            title: 'Heizraum E.14',
            fields: [
              {
                kind: 'meter_reading',
                key: 'z1',
                label: 'Hauptwasserzähler Schulhaus',
                unit: 'cubic_metres',
                decimals: 1,
                required: true,
                about: { kind: 'asset', id: meter.id },
              },
            ],
          },
        ],
      }),
    })
    server.put('activities', { ...round, formKey: `template-${template}`, formVersion: 1 })

    return server
  }

  it('shows the reading of the month before and the meter, and keeps the figure as the answer', async () => {
    const server = roundServer()
    const { client } = await mountSite(`/vorgaenge/${round.id}/punkte/z1`, {
      server,
      answers: servingCatalogue(formCatalogue),
    })

    await screen.findByRole('heading', { name: 'Hauptwasserzähler Schulhaus', level: 2 })
    expect(screen.getByText('Raum E.14 Heizraum')).toBeDefined()
    expect(screen.getByText(`4.812,0 m³ am ${germanDay(before)}`)).toBeDefined()
    expect(screen.getByText('13-882914, WZ-01 Hauptwasserzähler Schulhaus')).toBeDefined()

    const box = screen.getByRole('textbox', { name: 'Zählerstand in m³' })

    fireEvent.change(box, { target: { value: '4.000' } })
    fireEvent.blur(box)
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Kleiner als der letzte Stand/)
    expect(client.list('activity_answers')).toEqual([])

    fireEvent.change(box, { target: { value: '4.858,7' } })
    fireEvent.blur(box)
    await waitFor(() => {
      expect(client.list('activity_answers')).toMatchObject([{ fieldKey: 'z1', value: '4858700' }])
    })

    // The figure below the reading before never left the device.
    await client.synchronise()
    expect(
      queued(server)
        .filter((each) => each.entity === 'activity_answers')
        .map((each) => each.values['value'])
        .filter((value) => value !== undefined),
    ).toEqual(['4858700'])
  })
})
