import type { IsoDate, RecordState } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { endOfWeek, isOwn, longDay, shortDay, startItems, type StartHeld } from './start-items.js'

/**
 * What the start on site shows (#114): the person's own activities and those
 * given to nobody, the begun ones on top, today with what is past its day,
 * the rest of the week, and a round its plan shows ahead of its week.
 */

const me = 'u-tech'
// A Monday, so that the week has six days after it.
const monday = '2026-10-05' as IsoDate

let counter = 0

function activity(values: Readonly<Record<string, unknown>>): RecordState {
  counter += 1

  return {
    id: `ac-${String(counter)}`,
    kind: 'inspection',
    status: 'open',
    title: `Vorgang ${String(counter)}`,
    dueOn: monday,
    performer: 'own_staff',
    performerUserId: null,
    responsibleUserId: null,
    roundPlanId: null,
    deletedAt: null,
    ...values,
  }
}

function held(activities: readonly RecordState[], more: Partial<StartHeld> = {}): StartHeld {
  return { activities, plans: [], participants: [], signed: new Set(), ...more }
}

const ids = (list: readonly RecordState[]) => list.map((each) => each['id'])

describe('whose an activity is on the start', () => {
  it('is the person it is given to, and whoever takes a round given to nobody', () => {
    expect(isOwn(activity({ performerUserId: me }), me, [])).toBe(true)
    expect(isOwn(activity({ kind: 'round' }), me, [])).toBe(true)
    expect(isOwn(activity({ performerUserId: 'u-other' }), me, [])).toBe(false)
  })

  it('is not the person who only answers for it, nor anybody where a contractor performs it', () => {
    // On the device of the person who answers for it, for the office.
    expect(isOwn(activity({ responsibleUserId: me, performerUserId: 'u-other' }), me, [])).toBe(
      false,
    )
    expect(isOwn(activity({ responsibleUserId: 'u-lead' }), me, [])).toBe(false)
    expect(isOwn(activity({ responsibleUserId: me }), me, [])).toBe(true)
    expect(isOwn(activity({ performer: 'contractor' }), me, [])).toBe(false)
  })

  it('is whoever works on a work order beside the person it is given to', () => {
    const order = activity({ kind: 'work_order', responsibleUserId: 'u-lead' })
    const working = { id: 'wp-1', activityId: String(order['id']), userId: me, deletedAt: null }

    expect(isOwn(order, me, [working])).toBe(true)
    expect(isOwn(order, me, [{ ...working, userId: 'u-other' }])).toBe(false)
    expect(isOwn(order, me, [{ ...working, deletedAt: '2026-10-01T08:00:00.000Z' }])).toBe(false)
  })
})

describe('the start', () => {
  it('puts the begun ones on top whatever their day, then today with what is past it, then the week', () => {
    const begun = activity({ status: 'started', dueOn: '2026-10-08' })
    const late = activity({ dueOn: '2026-09-28' })
    const now = activity({ dueOn: monday })
    const undated = activity({ dueOn: null })
    const sunday = activity({ dueOn: '2026-10-11' })
    const wednesday = activity({ dueOn: '2026-10-07' })
    const nextWeek = activity({ dueOn: '2026-10-12' })

    const shown = startItems(
      held([begun, late, now, undated, sunday, wednesday, nextWeek]),
      me,
      monday,
    )

    expect(ids(shown.begun)).toEqual([begun['id']])
    // By day, and one without a day at the end.
    expect(ids(shown.today)).toEqual([late['id'], now['id'], undated['id']])
    expect(ids(shown.week)).toEqual([wednesday['id'], sunday['id']])
    // An inspection of the next week is not on the start yet.
    expect(shown.later).toEqual([])
  })

  it('leaves out what is signed on this device, done, not performed, removed or somebody else’s', () => {
    const signedHere = activity({ status: 'started' })
    const shown = startItems(
      held(
        [
          signedHere,
          activity({ status: 'signed' }),
          activity({ status: 'done' }),
          activity({ status: 'not_performed' }),
          activity({ deletedAt: '2026-10-01T08:00:00.000Z' }),
          activity({ performerUserId: 'u-other' }),
        ],
        { signed: new Set([String(signedHere['id'])]) },
      ),
      me,
      monday,
    )

    expect([...shown.begun, ...shown.today, ...shown.week, ...shown.later]).toEqual([])
  })

  it('shows a collective activity in the place of its parts, and a part left over from one that is done (#342)', () => {
    const collective = activity({ collectiveKind: 'probe.heater_test', performerUserId: me })
    const part = activity({
      collectiveId: collective['id'],
      performerUserId: me,
      status: 'started',
    })
    const left = activity({ collectiveId: 'ac-done', performerUserId: me })
    const done = activity({ id: 'ac-done', collectiveKind: 'probe.heater_test', status: 'done' })
    const items = startItems(held([collective, part, left, done]), me, monday)

    expect([ids(items.begun), ids(items.today)]).toEqual([[], [collective['id'], left['id']]])
  })

  it('shows a round of a later week from the lead of its daily plan, and not before', () => {
    const plan = { id: 'rp-1', rhythm: 'daily', leadDays: 7 }
    // Monday of the next week: the lead of seven days reaches it today.
    const inLead = activity({ kind: 'round', dueOn: '2026-10-12', roundPlanId: plan.id })
    // Tuesday of the next week: one day beyond the lead.
    const beyond = activity({ kind: 'round', dueOn: '2026-10-13', roundPlanId: plan.id })
    // Without a plan nothing reaches ahead of its week.
    const unplanned = activity({ kind: 'round', dueOn: '2026-10-12' })

    const shown = startItems(held([inLead, beyond, unplanned], { plans: [plan] }), me, monday)

    expect(ids(shown.later)).toEqual([inLead['id']])
    expect(ids(shown.week)).toEqual([])
  })

  it('shows a round of this week from its Monday, whatever short lead its plan has', () => {
    const plan = { id: 'rp-2', rhythm: 'daily', leadDays: 0 }
    const friday = activity({ kind: 'round', dueOn: '2026-10-09', roundPlanId: plan.id })

    expect(ids(startItems(held([friday], { plans: [plan] }), me, monday).week)).toEqual([
      friday['id'],
    ])
  })

  it('shows a round of a monthly plan from the 1st of its month, until it is signed (#394)', () => {
    const plan = { id: 'rp-3', rhythm: 'monthly', leadDays: 0, showsFromDay: null }
    const endOfOctober = activity({ kind: 'round', dueOn: '2026-10-31', roundPlanId: plan.id })
    const endOfNovember = activity({ kind: 'round', dueOn: '2026-11-30', roundPlanId: plan.id })
    const shown = startItems(held([endOfOctober, endOfNovember], { plans: [plan] }), me, monday)

    expect(ids(shown.later)).toEqual([endOfOctober['id']])
    // Past its day it stands under "Heute" until it is signed.
    expect(
      ids(startItems(held([endOfOctober], { plans: [plan] }), me, '2026-11-03' as IsoDate).today),
    ).toEqual([endOfOctober['id']])
    // From its day of the month, where the plan names one.
    expect(
      startItems(held([endOfOctober], { plans: [{ ...plan, showsFromDay: 20 }] }), me, monday)
        .later,
    ).toEqual([])
  })

  it('shows a round of a weekly plan from the day of the week it names, and one of a yearly plan from its day of the year (#394)', () => {
    const weekly = { id: 'rp-4', rhythm: 'weekly', leadDays: 0, showsFromDay: 3 }
    // Tuesday of the next week shows from the Wednesday before it, two days from now.
    const tuesday = activity({ kind: 'round', dueOn: '2026-10-13', roundPlanId: weekly.id })

    expect(startItems(held([tuesday], { plans: [weekly] }), me, monday).later).toEqual([])
    expect(
      ids(startItems(held([tuesday], { plans: [weekly] }), me, '2026-10-07' as IsoDate).later),
    ).toEqual([tuesday['id']])

    const yearly = {
      id: 'rp-5',
      rhythm: 'yearly',
      leadDays: 0,
      showsFromDay: null,
      showsFromMonth: null,
    }
    const december = activity({ kind: 'round', dueOn: '2026-12-01', roundPlanId: yearly.id })
    const nextYear = activity({ kind: 'round', dueOn: '2027-03-15', roundPlanId: yearly.id })

    expect(
      ids(startItems(held([december, nextYear], { plans: [yearly] }), me, monday).later),
    ).toEqual([december['id']])
  })
})

describe('the words of the days', () => {
  it('name the day over the start, a short day on a card and the end of the week', () => {
    expect(longDay(monday)).toBe('Montag, 5. Oktober')
    expect(shortDay('2026-10-12' as IsoDate)).toBe('12.10.')
    expect(endOfWeek(monday)).toBe('2026-10-11')
    expect(endOfWeek('2026-10-11' as IsoDate)).toBe('2026-10-11')
  })
})
