import { addDays, type IsoDate } from '@opengewerk/platform-domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  firstOpenPass,
  isPassDay,
  type PlanCalendar,
  planProblems,
  passesBetween,
  planStateOn,
  rhythmText,
  roundStateOf,
  type Weekday,
  weekdayOf,
  weekNumberOf,
  weekOf,
} from './round-plan.js'

/** A day between 2020 and 2035: many month ends, leap years and turns of the year. */
const days = fc
  .integer({ min: 0, max: 16 * 366 })
  .map((offset) => addDays('2020-01-01' as IsoDate, offset))
/** A stretch of up to two years and a bit, from a day. */
const stretches = fc.tuple(days, fc.integer({ min: 0, max: 800 })).map(([from, length]) => ({
  from,
  until: addDays(from, length),
}))
const weekdaySets = fc
  .uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 })
  .map((list) => list as Weekday[])
const oneWeekday = fc.integer({ min: 1, max: 7 }).map((day) => day as Weekday)

/** A plan that holds from long before to long after every stretch, so only its rhythm counts. */
function plan(rhythm: Partial<PlanCalendar>): PlanCalendar {
  return {
    rhythm: 'daily',
    weekdays: null,
    dayOfMonth: null,
    month: null,
    startsOn: '2000-01-01' as IsoDate,
    endsOn: null,
    ...rhythm,
  }
}

/** Every day from a day to a day, both counted. */
function everyDay(from: IsoDate, until: IsoDate): IsoDate[] {
  const all: IsoDate[] = []

  for (let day = from; day <= until; day = addDays(day, 1)) {
    all.push(day)
  }

  return all
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

describe('the days of a week', () => {
  it('counts Monday as 1 and Sunday as 7', () => {
    expect(weekdayOf('2026-10-05' as IsoDate)).toBe(1)
    expect(weekdayOf('2026-10-11' as IsoDate)).toBe(7)
    expect(weekdayOf('2024-02-29' as IsoDate)).toBe(4)
  })

  it('finds the Monday of the week of every day, in the week before it at most six days back', () => {
    fc.assert(
      fc.property(days, (day) => {
        const monday = weekOf(day)

        expect(weekdayOf(monday)).toBe(1)
        expect(monday <= day && addDays(monday, 6) >= day).toBe(true)
      }),
    )
  })

  it('numbers the weeks as ISO 8601 does, around the turn of a year as well', () => {
    expect(weekNumberOf('2026-10-05' as IsoDate)).toBe(41)
    expect(weekNumberOf('2026-12-28' as IsoDate)).toBe(53)
    expect(weekNumberOf('2027-01-01' as IsoDate)).toBe(53)
    expect(weekNumberOf('2027-01-04' as IsoDate)).toBe(1)
    expect(weekNumberOf('2025-12-29' as IsoDate)).toBe(1)
  })
})

describe('the passes of a plan', () => {
  it('falls daily on exactly the days of the week it names, and as often in every whole week', () => {
    fc.assert(
      fc.property(weekdaySets, stretches, (chosen, { from, until }) => {
        const daily = plan({ rhythm: 'daily', weekdays: chosen })
        const passes = passesBetween(daily, from, until)

        expect(passes).toEqual(
          everyDay(from, until).filter((day) => chosen.includes(weekdayOf(day))),
        )

        for (
          let monday = weekOf(addDays(from, 6));
          addDays(monday, 6) <= until;
          monday = addDays(monday, 7)
        ) {
          const week = passes.filter((day) => day >= monday && day <= addDays(monday, 6))

          expect(week).toHaveLength(chosen.length)
        }
      }),
    )
  })

  it('falls weekly once in every week, on its day, seven days apart', () => {
    fc.assert(
      fc.property(oneWeekday, stretches, (weekday, { from, until }) => {
        const passes = passesBetween(plan({ rhythm: 'weekly', weekdays: [weekday] }), from, until)

        for (const day of passes) {
          expect(weekdayOf(day)).toBe(weekday)
        }

        passes.slice(1).forEach((day, index) => {
          expect(addDays(passes[index] as IsoDate, 7)).toBe(day)
        })

        for (
          let monday = weekOf(addDays(from, 6));
          addDays(monday, 6) <= until;
          monday = addDays(monday, 7)
        ) {
          expect(passes.filter((day) => day >= monday && day <= addDays(monday, 6))).toHaveLength(1)
        }
      }),
    )
  })

  it('falls monthly once in every month, on its day or on the last day of a shorter month', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 31 }), stretches, (dayOfMonth, { from, until }) => {
        const passes = passesBetween(plan({ rhythm: 'monthly', dayOfMonth }), from, until)
        const months = new Set(everyDay(from, until).map((day) => day.slice(0, 7)))

        for (const month of months) {
          const year = Number(month.slice(0, 4))
          const number = Number(month.slice(5, 7))
          const expected = `${month}-${String(Math.min(dayOfMonth, lastDay(year, number))).padStart(2, '0')}`
          const inMonth = passes.filter((day) => day.startsWith(month))

          expect(inMonth).toEqual(expected >= from && expected <= until ? [expected] : [])
        }
      }),
    )
  })

  it('falls yearly once in every year, the 29th of February on the 28th in a common year', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        stretches,
        (month, dayOfMonth, { from, until }) => {
          fc.pre(dayOfMonth <= lastDay(2024, month))
          const passes = passesBetween(plan({ rhythm: 'yearly', month, dayOfMonth }), from, until)
          const years = new Set(everyDay(from, until).map((day) => day.slice(0, 4)))

          for (const year of years) {
            const expected = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(dayOfMonth, lastDay(Number(year), month))).padStart(2, '0')}`

            expect(passes.filter((day) => day.startsWith(year))).toEqual(
              expected >= from && expected <= until ? [expected] : [],
            )
          }
        },
      ),
    )

    expect(
      passesBetween(
        plan({ rhythm: 'yearly', month: 2, dayOfMonth: 29 }),
        '2026-01-01' as IsoDate,
        '2028-12-31' as IsoDate,
      ),
    ).toEqual(['2026-02-28', '2027-02-28', '2028-02-29'])
  })

  it('falls on no day before its first or after its last', () => {
    fc.assert(
      fc.property(
        weekdaySets,
        stretches,
        days,
        fc.integer({ min: 0, max: 400 }),
        (chosen, { from, until }, startsOn, length) => {
          const endsOn = addDays(startsOn, length)
          const bounded = plan({ rhythm: 'daily', weekdays: chosen, startsOn, endsOn })

          for (const day of passesBetween(bounded, from, until)) {
            expect(day >= startsOn && day <= endsOn).toBe(true)
          }

          expect(passesBetween(bounded, from, until)).toEqual(
            passesBetween(plan({ rhythm: 'daily', weekdays: chosen }), from, until).filter(
              (day) => day >= startsOn && day <= endsOn,
            ),
          )
        },
      ),
    )
  })

  it('leaves out every pass while its building is closed, and moves none of them', () => {
    fc.assert(
      fc.property(
        weekdaySets,
        stretches,
        days,
        fc.integer({ min: 0, max: 60 }),
        (chosen, { from, until }, startsOn, length) => {
          const closure = { startsOn, endsOn: addDays(startsOn, length) }
          const daily = plan({ rhythm: 'daily', weekdays: chosen })

          expect(passesBetween(daily, from, until, [closure])).toEqual(
            passesBetween(daily, from, until).filter(
              (day) => day < closure.startsOn || day > closure.endsOn,
            ),
          )
        },
      ),
    )
  })

  it('makes no round in the autumn holidays of a school, and the next one after them', () => {
    const weekly = plan({ rhythm: 'weekly', weekdays: [3] })
    const holidays = { startsOn: '2026-10-26' as IsoDate, endsOn: '2026-10-30' as IsoDate }

    expect(
      passesBetween(weekly, '2026-10-19' as IsoDate, '2026-11-08' as IsoDate, [holidays]),
    ).toEqual(['2026-10-21', '2026-11-04'])
  })
})

describe('the first pass that has no round', () => {
  const weekly = plan({ rhythm: 'weekly', weekdays: [3] })

  it('is the first pass on or after the day, past every one that has its round', () => {
    expect(firstOpenPass(weekly, '2026-10-05' as IsoDate, [], new Set())).toBe('2026-10-07')
    expect(firstOpenPass(weekly, '2026-10-07' as IsoDate, [], new Set())).toBe('2026-10-07')
    expect(
      firstOpenPass(weekly, '2026-10-05' as IsoDate, [], new Set(['2026-10-07', '2026-10-14'])),
    ).toBe('2026-10-21')
  })

  it('passes over a closure and stops at the end of the plan', () => {
    const closed = [{ startsOn: '2026-10-05' as IsoDate, endsOn: '2026-10-09' as IsoDate }]

    expect(firstOpenPass(weekly, '2026-10-05' as IsoDate, closed, new Set())).toBe('2026-10-14')
    expect(
      firstOpenPass(
        { ...weekly, endsOn: '2026-10-13' as IsoDate },
        '2026-10-08' as IsoDate,
        [],
        new Set(),
      ),
    ).toBeNull()
  })

  it('agrees with the passes of the plan for any rounds already made', () => {
    fc.assert(
      fc.property(
        weekdaySets,
        days,
        fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 20 }),
        (chosen, from, offsets) => {
          const daily = plan({ rhythm: 'daily', weekdays: chosen })
          const taken = new Set<string>(offsets.map((offset) => addDays(from, offset)))
          const expected = passesBetween(daily, from, addDays(from, 60)).find(
            (day) => !taken.has(day),
          )

          expect(firstOpenPass(daily, from, [], taken)).toBe(expected)
        },
      ),
    )
  })
})

describe('what a plan reads as', () => {
  it('names its rhythm and its days', () => {
    expect(
      rhythmText({
        rhythm: 'daily',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        dayOfMonth: null,
        month: null,
      }),
    ).toBe('täglich')
    expect(
      rhythmText({ rhythm: 'daily', weekdays: [5, 1, 2, 3, 4], dayOfMonth: null, month: null }),
    ).toBe('täglich, Montag bis Freitag')
    expect(
      rhythmText({ rhythm: 'daily', weekdays: [1, 3, 5], dayOfMonth: null, month: null }),
    ).toBe('täglich, Mo, Mi, Fr')
    expect(rhythmText({ rhythm: 'weekly', weekdays: [3], dayOfMonth: null, month: null })).toBe(
      'wöchentlich, Mittwoch',
    )
    expect(rhythmText({ rhythm: 'monthly', weekdays: null, dayOfMonth: 5, month: null })).toBe(
      'monatlich, am 5.',
    )
    expect(rhythmText({ rhythm: 'yearly', weekdays: null, dayOfMonth: 1, month: 3 })).toBe(
      'jährlich, am 1. März',
    )
  })

  it('runs, rests, has not begun or has ended', () => {
    const today = '2026-10-09' as IsoDate
    const running = { startsOn: '2026-10-01' as IsoDate, endsOn: null, resting: false }

    expect(planStateOn(running, today)).toBe('running')
    expect(planStateOn({ ...running, resting: true }, today)).toBe('resting')
    expect(planStateOn({ ...running, startsOn: '2026-10-12' as IsoDate }, today)).toBe('upcoming')
    expect(planStateOn({ ...running, endsOn: '2026-10-09' as IsoDate }, today)).toBe('running')
    expect(planStateOn({ ...running, endsOn: '2026-10-08' as IsoDate, resting: true }, today)).toBe(
      'ended',
    )
  })
})

describe('what is wrong with a plan', () => {
  const weekly = {
    rhythm: 'weekly',
    weekdays: [3],
    leadDays: 1,
    startsOn: '2026-10-07',
    endsOn: null,
  }

  it('takes a plan of each rhythm with what it names', () => {
    expect(planProblems(weekly)).toEqual({})
    expect(planProblems({ ...weekly, rhythm: 'daily', weekdays: [1, 2, 3, 4, 5] })).toEqual({})
    expect(planProblems({ ...weekly, rhythm: 'monthly', weekdays: null, dayOfMonth: 31 })).toEqual(
      {},
    )
    expect(
      planProblems({ ...weekly, rhythm: 'yearly', weekdays: null, dayOfMonth: 29, month: 2 }),
    ).toEqual({})
  })

  it('needs a rhythm of its list', () => {
    expect(planProblems({ ...weekly, rhythm: null })).toEqual({ rhythm: 'Der Rhythmus fehlt.' })
    expect(planProblems({ ...weekly, rhythm: 'stündlich' })).toEqual({
      rhythm: 'Der Rhythmus ist einer von: täglich, wöchentlich, monatlich, jährlich.',
    })
  })

  it('asks of each rhythm the days it falls on, and nothing of another rhythm', () => {
    expect(planProblems({ ...weekly, rhythm: 'daily', weekdays: [] })).toEqual({
      weekdays: 'Ein täglicher Plan nennt mindestens einen Wochentag.',
    })
    expect(planProblems({ ...weekly, rhythm: 'daily', weekdays: [1, 1] })).toEqual({
      weekdays: 'Ein täglicher Plan nennt mindestens einen Wochentag.',
    })
    expect(planProblems({ ...weekly, weekdays: [3, 4] })).toEqual({
      weekdays: 'Ein wöchentlicher Plan nennt seinen Wochentag.',
    })
    expect(planProblems({ ...weekly, weekdays: [8] })).toEqual({
      weekdays: 'Ein wöchentlicher Plan nennt seinen Wochentag.',
    })
    expect(planProblems({ ...weekly, dayOfMonth: 5, month: 3 })).toEqual({
      dayOfMonth: 'Nur ein monatlicher oder jährlicher Plan nennt einen Tag.',
      month: 'Nur ein jährlicher Plan nennt einen Monat.',
    })
    expect(planProblems({ ...weekly, rhythm: 'monthly', dayOfMonth: 0 })).toEqual({
      weekdays: 'Ein monatlicher oder jährlicher Plan nennt einen Tag, keinen Wochentag.',
      dayOfMonth: 'Der Tag ist eine Zahl von 1 bis 31.',
    })
    expect(
      planProblems({ ...weekly, rhythm: 'yearly', weekdays: null, dayOfMonth: 30, month: 2 }),
    ).toEqual({
      dayOfMonth: 'Den 30. Februar gibt es nicht.',
    })
    expect(
      planProblems({ ...weekly, rhythm: 'yearly', weekdays: null, dayOfMonth: 1, month: 13 }),
    ).toEqual({
      month: 'Der Monat ist eine Zahl von 1 bis 12.',
    })
  })

  it('keeps the lead within what is made ahead, and the last day after the first', () => {
    expect(planProblems({ ...weekly, leadDays: 15 })).toEqual({
      leadDays: 'Der Vorlauf ist eine Zahl von 0 bis 14 Tagen.',
    })
    expect(planProblems({ ...weekly, leadDays: 1.5 })).toEqual({
      leadDays: 'Der Vorlauf ist eine Zahl von 0 bis 14 Tagen.',
    })
    expect(planProblems({ ...weekly, startsOn: '' })).toEqual({ startsOn: 'Der erste Tag fehlt.' })
    expect(planProblems({ ...weekly, startsOn: '07.10.2026' })).toEqual({
      startsOn: 'Der erste Tag ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(planProblems({ ...weekly, endsOn: '2026-10-06' })).toEqual({
      endsOn: 'Der letzte Tag liegt vor dem ersten.',
    })
    expect(planProblems({ ...weekly, endsOn: '2026-10-07' })).toEqual({})
  })

  it('is not asked about a field that was not given', () => {
    expect(planProblems({ leadDays: 3 })).toEqual({})
  })
})

describe('a round in the overview of the week', () => {
  it('is open, begun, waits for its countersignature, is handed in or was not performed', () => {
    expect(roundStateOf('open', false)).toBe('open')
    expect(roundStateOf('started', true)).toBe('started')
    expect(roundStateOf('signed', true)).toBe('awaiting_countersignature')
    expect(roundStateOf('signed', false)).toBe('submitted')
    expect(roundStateOf('done', false)).toBe('submitted')
    expect(roundStateOf('not_performed', false)).toBe('not_performed')
  })
})

describe('a day of a plan', () => {
  it('is no pass of a daily plan without days', () => {
    expect(isPassDay(plan({ rhythm: 'daily', weekdays: null }), '2026-10-05' as IsoDate)).toBe(
      false,
    )
  })
})
