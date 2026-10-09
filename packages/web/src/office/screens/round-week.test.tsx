import {
  addDays,
  type IsoDate,
  type RoleKey,
  roundStateLabel,
  weekOf,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mountOffice,
  type NamedArea,
  onA,
  rowsOf,
  signedInOffice,
  untilTheRightsAreKnown,
  type WriteAnswer,
  type Written,
} from '../test-office.js'
import { roundDate, roundWords } from './round.js'
import { weekWords } from './round-week.js'

/**
 * The rounds of a week in the office (#113, section 4.5 of the concept): by
 * building, one row per plan with a chip for each pass and its state, who
 * walks them, and handing them out per plan and week or like the week
 * before. Whoever only performs reads and hands nothing out.
 */

const nord: NamedArea = { id: 'a-nord', name: 'Nord' }
const monday = weekOf(today() as IsoDate)

const station = { id: 'p-station', areaId: nord.id, name: 'Feuerwache Nord' }
const guard = { id: 'b-guard', propertyId: station.id, areaId: nord.id, name: 'Wache' }
const template = {
  id: 't-guard',
  title: 'Wache, täglicher Rundgang',
  sourceKey: null,
  sourceVersion: null,
}
const plan = {
  id: 'plan-daily',
  propertyId: station.id,
  buildingId: guard.id,
  areaId: nord.id,
  templateId: template.id,
  rhythm: 'daily',
  weekdays: '[1,2,3,4,5]',
  dayOfMonth: null,
  month: null,
  leadDays: 0,
  startsOn: '2026-07-01',
  endsOn: null,
  resting: false,
  performerUserId: null,
}
const week = {
  weekOf: monday,
  rounds: [
    { id: 'r-1', planId: plan.id, dueOn: monday, state: 'submitted', performerUserId: 'u-murat' },
    {
      id: 'r-2',
      planId: plan.id,
      dueOn: addDays(monday, 1),
      state: 'started',
      performerUserId: 'u-lena',
    },
    { id: 'r-3', planId: plan.id, dueOn: addDays(monday, 2), state: 'open', performerUserId: null },
    { id: 'r-4', planId: plan.id, dueOn: addDays(monday, 3), state: 'open', performerUserId: null },
    {
      id: 'r-5',
      planId: plan.id,
      dueOn: addDays(monday, 4),
      state: 'awaiting_countersignature',
      performerUserId: 'u-murat',
    },
  ],
  before: [
    {
      id: 'r-late',
      planId: plan.id,
      dueOn: addDays(monday, -3),
      state: 'open',
      performerUserId: 'u-murat',
    },
    {
      id: 'r-older',
      planId: plan.id,
      dueOn: addDays(monday, -7),
      state: 'started',
      performerUserId: null,
    },
  ],
}

const everything = ['properties', 'buildings', 'round_templates', 'round_plans']

let server: TestServer
let answerToWrite: (write: Written) => WriteAnswer
let written: Written[]

function signedIn(role: RoleKey) {
  written = signedInOffice(
    role,
    [nord],
    {
      [`/rounds/week?of=${monday}`]: week,
      '/rounds/people': [
        { userId: 'u-murat', name: 'Murat Yilmaz' },
        { userId: 'u-lena', name: 'Lena Vogt' },
      ],
      [`/rounds/performers?area=${nord.id}`]: [
        { userId: 'u-murat', name: 'Murat Yilmaz' },
        { userId: 'u-lena', name: 'Lena Vogt' },
      ],
    },
    (write) => answerToWrite(write),
  )
}

beforeEach(() => {
  localStorage.clear()
  server = new TestServer()
  server.put('properties', station)
  server.put('buildings', guard)
  server.put('round_templates', template)
  server.put('round_plans', plan)
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

const caption = 'Die Rundgänge der Woche nach Gebäude, mit ihren Durchgängen und wer sie geht'

describe('the rounds of a week', () => {
  it('stand by building, one row for a plan with a chip for each pass, and the numbers by state', async () => {
    await mountOffice('/rundgaenge', server, everything)
    await screen.findByRole('heading', { name: 'Rundgänge', level: 1 })

    await waitFor(() => {
      expect(rowsOf(caption)).toEqual([
        [
          'WacheFeuerwache Nord',
          'Wache, täglicher Rundgangtäglich, Montag bis Freitag',
          'MoAbgegebenDiBegonnenMiOffenDoOffenFrWartet auf Gegenzeichnung',
          'Murat Yilmaz, Lena Vogt, Alle im Bereich Nord',
          'Zuteilen',
        ],
      ])
    })

    const tiles = screen.getByRole('list', { name: 'Rundgänge der Woche nach Stand' })

    expect(
      within(tiles)
        .getAllByRole('listitem')
        .map((tile) => tile.textContent),
    ).toEqual([
      '2Offen',
      '1Begonnen',
      '1Wartet auf Gegenzeichnung',
      '1Abgegeben',
      `2Offen aus Vorwochen${weekWords.openBefore}`,
    ])
  })

  it('lead from each pass to its round', async () => {
    await mountOffice('/rundgaenge', server, everything)

    const pass = await screen.findByTitle(`Di: ${roundStateLabel.started}`)

    expect(pass.closest('a')?.getAttribute('href')).toBe('/rundgaenge/r-2')
  })

  it('list each round still open from an earlier week, to open or to close with the reason', async () => {
    answerToWrite = () => ({ status: 201, body: {} })
    await mountOffice('/rundgaenge', server, everything)
    await screen.findByRole('heading', { name: weekWords.before })

    expect(rowsOf(weekWords.beforeCaption)).toEqual([
      [
        'Wache, täglicher RundgangFeuerwache Nord, Wache',
        roundDate(addDays(monday, -3)),
        'Murat Yilmaz',
        `${weekWords.open}${weekWords.close}`,
      ],
      [
        'Wache, täglicher RundgangFeuerwache Nord, Wache',
        roundDate(addDays(monday, -7)),
        'Alle im Bereich Nord',
        `${weekWords.open}${weekWords.close}`,
      ],
    ])

    fireEvent.click(screen.getAllByRole('button', { name: weekWords.close })[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog', { name: roundWords.closeTitle })

    fireEvent.change(within(dialog).getByRole('textbox', { name: /Grund/ }), {
      target: { value: 'Die Wache war nicht besetzt.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }))

    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: '/rounds/r-late/close',
          body: { closingReason: 'Die Wache war nicht besetzt.' },
        },
      ])
    })
  })

  it('hand out the rounds of a plan nobody has begun, each to a person or to everybody in the area', async () => {
    answerToWrite = () => ({ status: 200, body: { ids: ['r-3', 'r-4'] } })
    await mountOffice('/rundgaenge', server, everything)
    await screen.findByRole('button', { name: 'Zuteilen' })

    fireEvent.click(screen.getByRole('button', { name: 'Zuteilen' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Zuteilen: Wache, täglicher Rundgang',
    })

    // The two begun or handed in say who has them and offer no choice.
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(2)
    await waitFor(() => {
      expect(within(dialog).getAllByRole('option', { name: 'Lena Vogt' })).toHaveLength(2)
    })

    const [wednesday] = within(dialog).getAllByRole('combobox')

    fireEvent.change(wednesday as HTMLElement, { target: { value: 'u-lena' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zuteilen' }))

    await waitFor(() => {
      expect(written).toHaveLength(1)
    })
    expect(written[0]).toEqual({
      method: 'PUT',
      path: '/rounds/assignment',
      body: { rounds: [{ id: 'r-3', performerUserId: 'u-lena' }] },
    })
  })

  it('are handed out like the week before, for the week that is shown', async () => {
    answerToWrite = () => ({ status: 201, body: { handedOut: 3, kept: 1 } })
    await mountOffice('/rundgaenge', server, everything)
    await screen.findByRole('button', { name: weekWords.likeLastWeek })

    fireEvent.click(screen.getByRole('button', { name: weekWords.likeLastWeek }))

    expect(await screen.findByText(weekWords.handedOut(3, 1))).toBeTruthy()
    expect(written).toEqual([
      { method: 'POST', path: '/rounds/like-last-week', body: { weekOf: monday } },
    ])
  })

  it('offer nothing to hand out to whoever only performs', async () => {
    signedIn('technician')
    await mountOffice('/rundgaenge', server, everything)
    await untilTheRightsAreKnown()
    await waitFor(() => {
      expect(rowsOf(caption)).toHaveLength(1)
    })

    expect(screen.queryByRole('button', { name: 'Zuteilen' })).toBeNull()
    expect(screen.queryByRole('button', { name: weekWords.likeLastWeek })).toBeNull()
    // What is open from before stands there to open, and is closed by whoever plans.
    expect(screen.getAllByRole('button', { name: weekWords.open })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: weekWords.close })).toBeNull()
  })

  it('stand on a phone as a card with the passes, handed out only by whoever plans', async () => {
    onA('phone')
    await mountOffice('/rundgaenge', server, everything)
    await screen.findByRole('button', { name: 'Zuteilen' })

    expect(screen.getByTitle(`Fr: ${roundStateLabel.awaiting_countersignature}`)).toBeTruthy()
    expect(screen.getByTitle(`Mo: ${roundStateLabel.submitted}`)).toBeTruthy()
  })

  it('offer nothing to hand out on a phone to whoever only performs', async () => {
    onA('phone')
    signedIn('technician')
    await mountOffice('/rundgaenge', server, everything)
    await untilTheRightsAreKnown()
    await screen.findByTitle(`Fr: ${roundStateLabel.awaiting_countersignature}`)

    expect(screen.queryByRole('button', { name: 'Zuteilen' })).toBeNull()
  })
})
