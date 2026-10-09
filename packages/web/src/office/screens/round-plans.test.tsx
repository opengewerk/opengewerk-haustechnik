import { addDays, type IsoDate, type RoleKey, weekdayOf } from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { dayWords, planWords } from './round-plans.js'

/**
 * The plans of the rounds in the office (#113, section 4.5 of the concept):
 * the list, a new plan with the days its rhythm names, the next passes
 * without the days the building is closed, and a plan that runs, rests and
 * ends. Made and changed by whoever plans; whoever only performs reads.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const on = today() as IsoDate

const station = { id: 'p-station', areaId: nord.id, name: 'Feuerwache Nord' }
const guard = { id: 'b-guard', propertyId: station.id, areaId: nord.id, name: 'Wache' }
const template = {
  id: 't-guard',
  title: 'Wache, täglicher Rundgang',
  sourceKey: null,
  sourceVersion: null,
}
const version = {
  id: 'v-1',
  templateId: template.id,
  formVersion: 5,
  definition: JSON.stringify({ title: template.title, sections: [] }),
  asksCountersignature: false,
  createdAt: '2026-07-01T08:00:00.000Z',
}
const daily = {
  id: 'plan-daily',
  propertyId: station.id,
  buildingId: guard.id,
  areaId: nord.id,
  templateId: template.id,
  rhythm: 'daily',
  // A list travels as its text, as on a device.
  weekdays: '[1,2,3,4,5]',
  dayOfMonth: null,
  month: null,
  leadDays: 0,
  startsOn: '2026-07-01',
  endsOn: null,
  resting: false,
  performerUserId: null,
}
const weekly = {
  ...daily,
  id: 'plan-weekly',
  rhythm: 'weekly',
  weekdays: '[3]',
  resting: true,
  performerUserId: 'u-tobias',
}
/** A closure of the building from the day after tomorrow for a week. */
const closure = {
  id: 'c-works',
  buildingId: guard.id,
  propertyId: station.id,
  areaId: nord.id,
  startsOn: addDays(on, 2),
  endsOn: addDays(on, 8),
  reason: 'Sanierung',
}

const everything = [
  'properties',
  'buildings',
  'building_closures',
  'activities',
  'round_templates',
  'round_template_versions',
  'round_plans',
]

let server: TestServer
let answerToWrite: (write: Written) => WriteAnswer
let written: Written[]

function signedIn(role: RoleKey) {
  written = signedInOffice(
    role,
    [nord],
    {
      '/rounds/people': [{ userId: 'u-tobias', name: 'Tobias Wendt' }],
      [`/rounds/performers?area=${nord.id}`]: [
        { userId: 'u-tobias', name: 'Tobias Wendt' },
        { userId: 'u-lena', name: 'Lena Vogt' },
      ],
    },
    (write) => answerToWrite(write),
  )
}

function choose(name: string, value: string): void {
  fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } })
}

function type(name: string, value: string): void {
  fireEvent.change(screen.getByLabelText(name), { target: { value } })
}

function press(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  server.put('properties', station)
  server.put('buildings', guard)
  server.put('building_closures', closure)
  server.put('round_templates', template)
  server.put('round_template_versions', version)
  server.put('round_plans', daily)
  server.put('round_plans', weekly)
  answerToWrite = () => ({
    status: 500,
    body: { message: 'Dieser Test hat keinen Schreibzugriff erwartet.' },
  })
  signedIn('site_management')
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the list of the plans', () => {
  it('lists each plan with its rhythm, its place, who walks it, its next pass and whether it runs', async () => {
    await mountOffice('/rundgaenge/plaene', server, everything)
    await screen.findByRole('heading', { name: 'Pläne', level: 1 })

    await waitFor(() => {
      expect(
        rowsOf('Pläne der Rundgänge mit Ort, Zuständigkeit, nächstem Durchgang und Stand'),
      ).toHaveLength(2)
    })

    const rows = rowsOf('Pläne der Rundgänge mit Ort, Zuständigkeit, nächstem Durchgang und Stand')
    const running = rows.find((row) => row[0]?.includes('täglich, Montag bis Freitag'))
    const resting = rows.find((row) => row[0]?.includes('wöchentlich, Mittwoch'))

    expect(running?.slice(1, 3)).toEqual(['WacheFeuerwache Nord', 'Alle im Bereich Nord'])
    expect(running?.[4]).toBe('Läuft')
    expect(resting?.slice(2)).toEqual(['Tobias Wendt', 'keiner', 'Ruht'])
    expect(screen.getByRole('button', { name: 'Neuer Plan' })).toBeTruthy()
  })
})

describe('a new plan', () => {
  it('sends the days its rhythm names, the place and the person, and nothing of another rhythm', async () => {
    answerToWrite = () => {
      server.put('round_plans', { ...daily, id: 'plan-new' })

      return { status: 201, body: { id: 'plan-new' } }
    }
    await mountOffice('/rundgaenge/plaene/neu', server, everything)
    await screen.findByRole('button', { name: 'Plan anlegen' })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Feuerwache Nord, Wache' })).toBeTruthy()
    })
    choose('Vorlage', template.id)
    choose('Ort', `b:${guard.id}`)
    fireEvent.click(screen.getByRole('radio', { name: 'täglich' }))
    // Monday to Friday stand pressed; Monday goes, Saturday comes.
    press('Montag')
    press('Samstag')
    type('Vorlauf', '1')
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Lena Vogt' })).toBeTruthy()
    })
    choose('Person', 'u-lena')
    press('Plan anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'POST',
      path: '/round-plans',
      body: {
        rhythm: 'daily',
        weekdays: [2, 3, 4, 5, 6],
        dayOfMonth: null,
        month: null,
        leadDays: 1,
        startsOn: on,
        endsOn: null,
        performerUserId: 'u-lena',
        templateId: template.id,
        propertyId: station.id,
        buildingId: guard.id,
      },
    })
  })

  it('sends a yearly plan with its day and month, and no days of the week', async () => {
    answerToWrite = () => ({ status: 201, body: { id: 'plan-new' } })
    await mountOffice('/rundgaenge/plaene/neu', server, everything)
    await screen.findByRole('button', { name: 'Plan anlegen' })

    choose('Vorlage', template.id)
    choose('Ort', `p:${station.id}`)
    fireEvent.click(screen.getByRole('radio', { name: 'jährlich' }))
    type('Tag', '29')
    choose('Monat', '2')
    fireEvent.click(screen.getByRole('radio', { name: 'Alle im Bereich' }))
    press('Plan anlegen')

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]?.body).toMatchObject({
      rhythm: 'yearly',
      weekdays: null,
      dayOfMonth: 29,
      month: 2,
      performerUserId: null,
      propertyId: station.id,
      buildingId: null,
    })
  })

  it('says what is missing and sends nothing', async () => {
    await mountOffice('/rundgaenge/plaene/neu', server, everything)
    await screen.findByRole('button', { name: 'Plan anlegen' })

    fireEvent.click(screen.getByRole('radio', { name: 'täglich' }))

    for (const day of ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag']) {
      press(day)
    }

    type('Vorlauf', '15')
    press('Plan anlegen')

    expect(await screen.findByText(planWords.noTemplate)).toBeTruthy()
    expect(screen.getByText(planWords.noPlace)).toBeTruthy()
    expect(screen.getByText(planWords.noPerson)).toBeTruthy()
    expect(screen.getByText('Ein täglicher Plan nennt mindestens einen Wochentag.')).toBeTruthy()
    expect(screen.getByText('Der Vorlauf ist eine Zahl von 0 bis 14 Tagen.')).toBeTruthy()
    expect(written).toEqual([])
  })
})

describe('a plan that runs', () => {
  it('shows its next passes, and the days its building is closed without a round', async () => {
    await mountOffice(`/rundgaenge/plaene/${daily.id}`, server, everything)
    await screen.findByRole('button', { name: 'Speichern' })

    const expected: string[][] = []

    for (let day = on; expected.length < 5; day = addDays(day, 1)) {
      if (weekdayOf(day) <= 5) {
        const closed = day >= closure.startsOn && day <= closure.endsOn

        expected.push([dayWords(day), closed ? 'Sanierung, geschlossen' : 'Alle im Bereich Nord'])
      }
    }

    await waitFor(() => {
      expect(rowsOf('Die nächsten Durchgänge des Plans mit der Person, die sie geht')).toEqual(
        expected,
      )
    })
  })

  it('rests, runs again and ends on a day', async () => {
    answerToWrite = () => ({ status: 200, body: { id: daily.id } })
    await mountOffice(`/rundgaenge/plaene/${daily.id}`, server, everything)
    await screen.findByRole('button', { name: 'Speichern' })

    press('Ruhen lassen')
    await waitFor(() => {
      expect(written).toHaveLength(1)
      expect((screen.getByRole('button', { name: 'Beenden' }) as HTMLButtonElement).disabled).toBe(
        false,
      )
    })
    press('Beenden')

    const dialog = await screen.findByRole('dialog', { name: 'Plan beenden' })

    fireEvent.change(within(dialog).getByLabelText('Letzter Durchgang am'), {
      target: { value: addDays(on, 3) },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Beenden' }))

    await waitFor(() => {
      expect(written).toHaveLength(2)
    })
    expect(written).toEqual([
      { method: 'PATCH', path: `/round-plans/${daily.id}`, body: { resting: true } },
      { method: 'PATCH', path: `/round-plans/${daily.id}`, body: { endsOn: addDays(on, 3) } },
    ])
  })

  it('offers no new plan to whoever only performs', async () => {
    signedIn('technician')
    await mountOffice('/rundgaenge/plaene', server, everything)
    await untilTheRightsAreKnown()
    await waitFor(() => {
      expect(
        rowsOf('Pläne der Rundgänge mit Ort, Zuständigkeit, nächstem Durchgang und Stand'),
      ).toHaveLength(2)
    })

    expect(screen.queryByRole('button', { name: 'Neuer Plan' })).toBeNull()
  })

  it('offers nothing to change, rest or end to whoever only performs', async () => {
    signedIn('technician')
    await mountOffice(`/rundgaenge/plaene/${daily.id}`, server, everything)
    await untilTheRightsAreKnown()
    await screen.findByRole('heading', { name: template.title, level: 1 })

    for (const name of ['Speichern', 'Ruhen lassen', 'Beenden']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    // The fieldset of the form holds every field shut.
    expect(screen.getByRole('combobox', { name: 'Vorlage' }).closest('fieldset')?.disabled).toBe(
      true,
    )
  })
})
