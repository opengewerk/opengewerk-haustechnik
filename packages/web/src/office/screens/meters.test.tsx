import {
  addMonths,
  type AssetId,
  type IsoDate,
  type MeterDetails,
  type MeterEntry,
  type MeterList,
  type MeterReadingId,
  type RoleKey,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { servingCatalogue, testCatalogue } from '../../app/test-catalogue.js'
import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { meterWords } from './meters.js'

/**
 * "Zähler" in the office (#119, 4.9 of the concept): the list for a key
 * date with a sub meter under its main meter, and the page of a measuring
 * point with its readings, the consumption derived from them and its
 * history. A reading is entered and corrected by every role; the exchange,
 * the pause, the lock and what only the measuring point carries are for
 * whoever takes care of assets. Locked, it takes no reading.
 */

const sued: NamedArea = { id: 'a-sued', name: 'Süd' }
const school = {
  id: 'p-school',
  areaId: sued.id,
  name: 'Schulzentrum Am Lindenhain',
  street: 'Am Lindenhain 7',
  postalCode: '00003',
  city: 'Musterhausen',
  federalState: 'DE-BW',
  note: null,
}
const house = {
  id: 'b-house',
  propertyId: school.id,
  areaId: sued.id,
  name: 'Schulhaus',
  kinds: '["school"]',
  yearBuilt: 1975,
}

const current = `${today().slice(0, 7)}-01` as IsoDate
const back = (months: number) => addMonths(current, -months)
const place = {
  propertyId: school.id,
  areaId: sued.id,
  buildingId: house.id,
  roomId: null,
} as unknown as Pick<MeterEntry, 'propertyId' | 'areaId' | 'buildingId' | 'roomId'>

const main: MeterEntry = {
  ...place,
  assetId: 'as-main' as AssetId,
  number: 'AN-00101',
  mark: 'WZ01',
  name: 'Hauptwasserzähler Schulhaus',
  medium: 'water',
  unit: 'cubic_metres',
  meterNumber: '13-882914',
  mainMeterId: null,
  lastReading: { keyDate: back(1), readOn: back(1), valueMilli: 4_812_000 },
  state: 'missing',
}
const gym: MeterEntry = {
  ...main,
  assetId: 'as-gym' as AssetId,
  number: 'AN-00102',
  mark: 'WZ02',
  name: 'Unterzähler Sporthalle',
  meterNumber: '13-901122',
  mainMeterId: main.assetId,
  lastReading: { keyDate: current, readOn: current, valueMilli: 1_204_600 },
  state: 'present',
}
const workshop: MeterEntry = {
  ...main,
  assetId: 'as-workshop' as AssetId,
  number: 'AN-00103',
  mark: null,
  name: 'Wasserzähler Werkstatt',
  meterNumber: '13-700001',
  lastReading: null,
  state: 'locked',
}

const list: MeterList = {
  keyDate: current,
  total: 3,
  properties: 1,
  counts: { missing: 1, paused: 0, locked: 1 },
  // The server lists the sub meter last; the screen puts it under its main meter.
  meters: [main, workshop, gym],
}

const line = {
  source: 'by_hand' as const,
  name: 'Tobias Wendt',
  correctsId: null,
  correctionReason: null,
  valid: true,
}
const wrong = {
  ...line,
  id: 'r-wrong' as MeterReadingId,
  keyDate: back(1),
  readOn: back(1),
  valueMilli: 4_821_000,
  valid: false,
}
const right = {
  ...line,
  id: 'r-right' as MeterReadingId,
  keyDate: back(1),
  readOn: back(1),
  valueMilli: 4_812_000,
  name: 'Jana Roth',
  correctsId: wrong.id,
  correctionReason: 'Zahlendreher',
}
const before = {
  ...line,
  id: 'r-before' as MeterReadingId,
  keyDate: back(2),
  readOn: back(2),
  valueMilli: 4_765_500,
  source: 'round' as const,
}

const details: MeterDetails = {
  ...main,
  kind: 'probe.water_meter',
  currentKeyDate: current,
  conversionFactor: null,
  controlId: 'GLT-SH-WZ01',
  mainMeter: null,
  subMeters: [{ assetId: gym.assetId, mark: gym.mark, name: gym.name }],
  note: { text: 'Schacht im Hof, Deckel schwer.', name: 'Jana Roth', on: '2026-03-12' as IsoDate },
  lock: null,
  pauses: [],
  exchanges: [],
  rows: [
    { keyDate: current, state: 'missing', reading: null, corrected: [], consumption: null },
    {
      keyDate: back(1),
      state: 'present',
      reading: right,
      corrected: [wrong],
      consumption: { kind: 'consumed', milli: 46_500, months: 1 },
    },
    {
      keyDate: back(2),
      state: 'present',
      reading: before,
      corrected: [],
      consumption: { kind: 'first' },
    },
  ],
  history: [
    {
      keyDate: back(1),
      consumption: { kind: 'consumed', milli: 46_500, months: 1 },
      previousYear: { kind: 'consumed', milli: 44_000, months: 1 },
    },
  ],
}

const locked: MeterDetails = {
  ...details,
  assetId: workshop.assetId,
  name: workshop.name,
  mark: null,
  state: 'locked',
  lock: { reason: 'Schacht nach Starkregen überflutet.', on: '2026-10-06' as IsoDate },
}

const listPath = `/meters?keyDate=${current}`
const readingsCaption =
  'Stände je Stichtag mit Verbrauch, wann und von wem abgelesen und auf welchem Weg'
const listCaption =
  'Messstellen mit Medium, Einheit, Zählernummer, letztem Stand und dem Stand zum Stichtag'

let server: TestServer
let answerToWrite: (write: Written) => WriteAnswer
let written: Written[]

function signedIn(role: RoleKey) {
  written = signedInOffice(
    role,
    [sued],
    {
      ...servingCatalogue(testCatalogue),
      [listPath]: list,
      [`${listPath}&state=missing`]: { ...list, total: 1, meters: [main] },
      [`/meters/${main.assetId}`]: details,
      [`/meters/${workshop.assetId}`]: locked,
      [`/meters?property=${school.id}`]: list,
    },
    (write) => answerToWrite(write),
  )
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  server.put('properties', school)
  server.put('buildings', house)
  answerToWrite = () => ({ status: 200, body: { id: main.assetId } })
  signedIn('management')
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

const everything = ['properties', 'buildings', 'rooms', 'assets']

describe('the list of meters', () => {
  it('shows each measuring point for the key date, a sub meter under its main meter', async () => {
    await mountOffice('/zaehler', server, everything)
    await screen.findByRole('heading', { name: meterWords.title, level: 1 })

    await waitFor(() => {
      expect(rowsOf(listCaption)).toHaveLength(3)
    })
    expect(rowsOf(listCaption)).toEqual([
      [
        'WZ01 Hauptwasserzähler SchulhausSchulzentrum Am Lindenhain, Schulhaus',
        'Wasser',
        'm³',
        '13-882914',
        `4.812,0 m³${back(1).slice(8, 10)}.${back(1).slice(5, 7)}.${back(1).slice(0, 4)}`,
        'fehlt',
      ],
      [
        '└WZ02 Unterzähler SporthalleSchulzentrum Am Lindenhain, Schulhaus',
        'Wasser',
        'm³',
        '13-901122',
        expect.stringContaining('1.204,6 m³'),
        'liegt vor',
      ],
      [
        'Wasserzähler WerkstattSchulzentrum Am Lindenhain, Schulhaus',
        'Wasser',
        'm³',
        '13-700001',
        '—',
        'Gesperrt',
      ],
    ])
    expect(screen.getByRole('button', { name: meterWords.missingCount(1) })).toBeTruthy()
    expect(screen.getByRole('button', { name: meterWords.lockedCount(1) })).toBeTruthy()
  })

  it('narrows to the meters whose reading is missing', async () => {
    await mountOffice('/zaehler', server, everything)
    fireEvent.click(await screen.findByRole('button', { name: meterWords.missingCount(1) }))

    await waitFor(() => {
      expect(rowsOf(listCaption)).toHaveLength(1)
    })
    expect(rowsOf(listCaption)[0]?.[0]).toContain('Hauptwasserzähler Schulhaus')
  })

  it('offers a new measuring point to whoever takes care of assets', async () => {
    await mountOffice('/zaehler', server, everything)

    expect(await screen.findByRole('button', { name: meterWords.newMeter })).toBeTruthy()
  })

  it('offers no new measuring point to the Haustechnik', async () => {
    signedIn('technician')
    await mountOffice('/zaehler', server, everything)
    await untilTheRightsAreKnown()
    await waitFor(() => {
      expect(rowsOf(listCaption)).toHaveLength(3)
    })

    expect(screen.queryByRole('button', { name: meterWords.newMeter })).toBeNull()
  })
})

describe('the page of a measuring point', () => {
  it('shows each key date with its reading, the consumption and who read it, a correction with the one it corrects', async () => {
    await mountOffice(`/zaehler/${main.assetId}`, server, everything)
    await screen.findByRole('heading', { name: main.name, level: 1 })

    const rows = rowsOf(readingsCaption)

    expect(rows[0]?.slice(0, 3)).toEqual([expect.any(String), 'fehlt', 'keiner'])
    expect(rows[1]?.slice(1, 5)).toEqual([
      '4.812,0 m³',
      '46,5 m³',
      expect.stringContaining('berichtigt von Jana Roth: Zahlendreher, vorher 4.821,0 m³'),
      'Von Hand',
    ])
    expect(rows[1]?.[3]).toContain('Tobias Wendt')
    expect(rows[2]?.slice(1, 3)).toEqual(['4.765,5 m³', 'erster Stand'])
    expect(rowsOf('Verbrauch je Stichtag und derselbe Stichtag ein Jahr früher')).toEqual([
      [expect.any(String), '46,5 m³', '44,0 m³', '+6 %'],
    ])
  })

  it('enters a reading in thousandths, for the day it was read', async () => {
    await mountOffice(`/zaehler/${main.assetId}`, server, everything)
    await userEvent.click(await screen.findByRole('button', { name: meterWords.enter }))
    await userEvent.type(
      screen.getByLabelText(meterWords.standAt(current), { exact: false }),
      '4.858,7',
    )
    await userEvent.click(screen.getByRole('button', { name: meterWords.save }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'POST',
      path: `/meters/${main.assetId}/readings`,
      body: { readOn: today(), valueMilli: 4_858_700 },
    })
  })

  it('says why the server took no reading', async () => {
    answerToWrite = () => ({
      status: 409,
      body: { message: 'Kleiner als der letzte Stand vom 01.09.2026, 4.812,0 m³.' },
    })
    await mountOffice(`/zaehler/${main.assetId}`, server, everything)
    await userEvent.click(await screen.findByRole('button', { name: meterWords.enter }))
    await userEvent.type(
      screen.getByLabelText(meterWords.standAt(current), { exact: false }),
      '4.000',
    )
    await userEvent.click(screen.getByRole('button', { name: meterWords.save }))

    expect(
      await screen.findByText('Kleiner als der letzte Stand vom 01.09.2026, 4.812,0 m³.'),
    ).toBeTruthy()
  })

  it('corrects a reading by a new one that names it, with the reason', async () => {
    await mountOffice(`/zaehler/${main.assetId}`, server, everything)
    await screen.findByRole('heading', { name: main.name, level: 1 })

    const table = screen.getByRole('table', { name: readingsCaption })

    await userEvent.click(
      within(table).getAllByRole('button', { name: meterWords.correct })[0] as HTMLElement,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Stand berichtigen' })

    await userEvent.type(
      within(dialog).getByLabelText('Richtiger Stand', { exact: false }),
      '4.812,4',
    )
    await userEvent.type(
      within(dialog).getByLabelText('Grund', { exact: false }),
      'Schlecht lesbar',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: meterWords.correct }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'POST',
      path: `/meters/${main.assetId}/readings`,
      body: {
        readOn: back(1),
        valueMilli: 4_812_400,
        correctsId: right.id,
        correctionReason: 'Schlecht lesbar',
      },
    })
  })

  it('exchanges the meter with the end of the old one and the start of the new one', async () => {
    await mountOffice(`/zaehler/${main.assetId}`, server, everything)
    await userEvent.click(await screen.findByRole('button', { name: meterWords.exchange }))

    const dialog = await screen.findByRole('dialog', { name: meterWords.exchange })

    await userEvent.type(within(dialog).getByLabelText('Endstand', { exact: false }), '4.839,7')
    await userEvent.type(
      within(dialog).getAllByLabelText(meterWords.meterNumber, { exact: false })[1] as HTMLElement,
      '13-920455',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tausch eintragen' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'POST',
      path: `/meters/${main.assetId}/exchanges`,
      body: {
        exchangedOn: today(),
        oldEndMilli: 4_839_700,
        newNumber: '13-920455',
        newStartMilli: 0,
      },
    })
  })

  it('lets every role read the meter, and only whoever takes care of assets exchange, rest or lock it', async () => {
    signedIn('technician')
    await mountOffice(`/zaehler/${main.assetId}`, server, everything)
    await screen.findByRole('button', { name: meterWords.enter })

    for (const label of [meterWords.exchange, meterWords.pause, meterWords.lock, meterWords.edit]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }

    expect(
      within(screen.getByRole('table', { name: readingsCaption })).getAllByRole('button', {
        name: meterWords.correct,
      }),
    ).toHaveLength(2)
  })

  it('takes no reading while it is locked, says why, still corrects one and lifts the lock for whoever takes care of assets', async () => {
    await mountOffice(`/zaehler/${workshop.assetId}`, server, everything)
    await screen.findByRole('heading', { name: workshop.name, level: 1 })

    expect(
      screen.getByText(
        meterWords.lockedBanner('2026-10-06' as IsoDate, 'Schacht nach Starkregen überflutet.'),
      ),
    ).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: meterWords.enter }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      within(screen.getByRole('table', { name: readingsCaption })).getAllByRole('button', {
        name: meterWords.correct,
      }),
    ).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: meterWords.unlock }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toMatchObject({ method: 'DELETE', path: `/meters/${workshop.assetId}/lock` })
  })
})
