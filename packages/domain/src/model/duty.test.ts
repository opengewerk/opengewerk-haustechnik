import {
  addDays,
  addMonths,
  type DeadlineInterval,
  type IsoDate,
} from '@opengewerk/platform-domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { lifecycleStates } from './asset.js'
import { recurringCountings } from './catalogue.js'
import {
  type Appointment,
  dutyStateOn,
  dutyStates,
  nextAppointment,
  onceAppointment,
  restsOn,
  type Rhythm,
  takenOverFrom,
  withinCeiling,
} from './duty.js'

/** A day between 2000 and 2049, as fast-check draws it. */
const days = fc
  .integer({ min: 0, max: 50 * 365 })
  .map((offset) => addDays('2000-01-01', offset) as IsoDate)

const monthly = fc.integer({ min: 1, max: 72 }).map((months): DeadlineInterval => ({ months }))
const daily = fc.integer({ min: 1, max: 730 }).map((count) => ({ days: count }))

/** A rhythm of any counting, with an interval it takes. */
const rhythms = fc.constantFrom(...recurringCountings).chain((counting) =>
  (counting === 'betrsichv' ? monthly : fc.oneof(monthly, daily)).map((interval): Rhythm => ({
    counting,
    interval,
  })),
)

describe('the next appointment of a duty', () => {
  it('is none before the duty was ever met', () => {
    fc.assert(
      fc.property(rhythms, (rhythm) => {
        expect(nextAppointment(rhythm, [])).toBeNull()
      }),
    )
  })

  it('does not depend on the order the days come in', () => {
    fc.assert(
      fc.property(rhythms, fc.array(days, { minLength: 1, maxLength: 8 }), (rhythm, performed) => {
        expect(nextAppointment(rhythm, [...performed].reverse())).toEqual(
          nextAppointment(rhythm, [...performed].sort()),
        )
      }),
    )
  })

  describe('counted from the day it was done', () => {
    const yearly: Rhythm = { counting: 'from_performance', interval: { months: 12 } }

    it('lies one interval after the last time it was done, and is on time on that day only', () => {
      expect(nextAppointment(yearly, ['2025-03-14', '2026-02-20'])).toEqual({
        dueOn: '2027-02-20',
        onTimeUntil: '2027-02-20',
      })
      expect(
        nextAppointment({ counting: 'from_performance', interval: { days: 90 } }, ['2026-01-10']),
      ).toEqual({ dueOn: '2026-04-10', onTimeUntil: '2026-04-10' })
    })

    it('starts over with every time it was done, early or late', () => {
      fc.assert(
        fc.property(
          fc.oneof(monthly, daily),
          fc.array(days, { minLength: 1, maxLength: 8 }),
          (interval, performed) => {
            const last = [...performed].sort().at(-1) as IsoDate
            const dueOn =
              'days' in interval ? addDays(last, interval.days) : addMonths(last, interval.months)

            expect(nextAppointment({ counting: 'from_performance', interval }, performed)).toEqual({
              dueOn,
              onTimeUntil: dueOn,
            })
          },
        ),
      )
    })
  })

  describe('counted from the day it was due', () => {
    const yearly: Rhythm = { counting: 'from_due', interval: { months: 12 } }

    it('keeps its rhythm when it was done at most a twelfth of the interval early, or late (#77)', () => {
      // First on 10 March 2025, due on 10 March 2026: the twelfth of those 365
      // days is 30, so from 8 February on a performance meets it. Done then
      // and late in April, the next stays on 10 March.
      expect(nextAppointment(yearly, ['2025-03-10', '2026-02-08'])?.dueOn).toBe('2027-03-10')
      expect(nextAppointment(yearly, ['2025-03-10', '2026-04-20'])?.dueOn).toBe('2027-03-10')
    })

    it('counts the interval anew from a day earlier than that (#77)', () => {
      expect(nextAppointment(yearly, ['2025-03-10', '2026-02-07'])?.dueOn).toBe('2027-02-07')
      // A second time soon after the open appointment was met is far early for the next one.
      expect(nextAppointment(yearly, ['2025-03-10', '2026-03-10', '2026-04-01'])?.dueOn).toBe(
        '2027-04-01',
      )
    })

    it('reckons the twelfth of two years as two months, and of a month as two days', () => {
      const twoYears: Rhythm = { counting: 'from_due', interval: { months: 24 } }
      const monthly: Rhythm = { counting: 'from_due', interval: { months: 1 } }

      // 731 days from 10 March 2025 to 10 March 2027: the twelfth is 60.
      expect(nextAppointment(twoYears, ['2025-03-10', '2027-01-09'])?.dueOn).toBe('2029-03-10')
      expect(nextAppointment(twoYears, ['2025-03-10', '2027-01-08'])?.dueOn).toBe('2029-01-08')
      // 31 days from 10 March to 10 April: the twelfth is 2.
      expect(nextAppointment(monthly, ['2026-03-10', '2026-04-08'])?.dueOn).toBe('2026-05-10')
      expect(nextAppointment(monthly, ['2026-03-10', '2026-04-07'])?.dueOn).toBe('2026-05-07')
    })

    it('leaves appointments behind that were missed, instead of being overdue when it was done', () => {
      // Due on 10 March 2026 and on 10 March 2027, done only in May 2027.
      expect(nextAppointment(yearly, ['2025-03-10', '2027-05-02'])?.dueOn).toBe('2028-03-10')
    })

    it('does not drift at the end of a month', () => {
      expect(
        nextAppointment({ counting: 'from_due', interval: { months: 1 } }, [
          '2026-01-31',
          '2026-02-27',
          '2026-03-30',
        ])?.dueOn,
      ).toBe('2026-04-30')
    })

    it('lies after the last time it was done, never much more than the interval after it (#77)', () => {
      fc.assert(
        fc.property(
          daily,
          fc.array(days, { minLength: 1, maxLength: 8 }),
          (interval, performed) => {
            const sorted = [...performed].sort()
            const appointment = nextAppointment(
              { counting: 'from_due', interval },
              sorted,
            ) as Appointment
            const last = sorted.at(-1) as IsoDate
            const after = (Date.parse(appointment.dueOn) - Date.parse(last)) / 86_400_000

            expect(after).toBeGreaterThan(0)
            expect(after).toBeLessThanOrEqual(interval.days + Math.floor(interval.days / 12))
            expect(appointment.onTimeUntil).toBe(appointment.dueOn)
          },
        ),
      )
    })
  })

  describe('counted under § 14 Abs. 5 BetrSichV', () => {
    const twoYears: Rhythm = { counting: 'betrsichv', interval: { months: 24 } }
    const fourYears: Rhythm = { counting: 'betrsichv', interval: { months: 48 } }

    it('is due in a month and on time until two months after it', () => {
      expect(nextAppointment(twoYears, ['2026-03-14'])).toEqual({
        dueOn: '2028-03-01',
        onTimeUntil: '2028-05-31',
      })
    })

    it('counts on from the due month of the last, also after a test within the two months', () => {
      expect(nextAppointment(twoYears, ['2026-03-14', '2028-03-28'])?.dueOn).toBe('2030-03-01')
      expect(nextAppointment(twoYears, ['2026-03-14', '2028-05-30'])?.dueOn).toBe('2030-03-01')
    })

    it('counts from the month of a test that came before the due month', () => {
      expect(nextAppointment(twoYears, ['2026-03-14', '2028-02-10'])?.dueOn).toBe('2030-02-01')
    })

    it('counts so for an interval of more than two years only for a test more than two months early', () => {
      expect(nextAppointment(fourYears, ['2026-03-14', '2030-01-20'])?.dueOn).toBe('2034-03-01')
      expect(nextAppointment(fourYears, ['2026-03-14', '2029-12-20'])?.dueOn).toBe('2033-12-01')
    })

    it('counts from the month of the test where the equipment was out of service when it was due', () => {
      const resting: Rhythm = {
        ...twoYears,
        outOfServiceOn: (day) => day >= '2028-01-01' && day < '2028-09-01',
      }

      expect(nextAppointment(resting, ['2026-03-14', '2028-09-12'])?.dueOn).toBe('2030-09-01')
      // In service when it was due: the due month again.
      expect(nextAppointment(twoYears, ['2026-03-14', '2028-09-12'])?.dueOn).toBe('2030-03-01')
    })

    it('is a first day of a month, with the margin to the end of the month two after', () => {
      fc.assert(
        fc.property(
          monthly,
          fc.array(days, { minLength: 1, maxLength: 8 }),
          (interval, performed) => {
            const appointment = nextAppointment(
              { counting: 'betrsichv', interval },
              performed,
            ) as Appointment

            expect(appointment.dueOn.slice(8)).toBe('01')
            expect(appointment.onTimeUntil).toBe(addDays(addMonths(appointment.dueOn, 3), -1))
          },
        ),
      )
    })

    it('takes no interval in days', () => {
      expect(() =>
        nextAppointment({ counting: 'betrsichv', interval: { days: 365 } }, ['2026-03-14']),
      ).toThrow('Nach § 14 Abs. 5 BetrSichV zählt eine Frist in Monaten, nicht in Tagen.')
    })
  })

  describe('where a regulation shortens the maximum from a day (#139)', () => {
    /** Two years until the end of 2026, one from the first day of 2027. */
    const maximum = (day: IsoDate): DeadlineInterval =>
      day < '2027-01-01' ? { months: 24 } : { months: 12 }
    const asked = (
      counting: Rhythm['counting'],
      today: IsoDate,
      interval: DeadlineInterval = { months: 24 },
    ): Rhythm => ({ counting, interval, ceiling: { on: maximum, today } })

    it('counts with the shorter maximum from its day, and with the interval of the duty until then', () => {
      expect(nextAppointment(asked('from_performance', '2026-12-31'), ['2026-06-10'])?.dueOn).toBe(
        '2028-06-10',
      )
      expect(nextAppointment(asked('from_performance', '2027-01-01'), ['2026-06-10'])?.dueOn).toBe(
        '2027-06-10',
      )
    })

    it('leaves an interval within the maximum alone', () => {
      expect(
        nextAppointment(asked('from_performance', '2027-01-01', { months: 6 }), ['2026-06-10'])
          ?.dueOn,
      ).toBe('2026-12-10')
    })

    it('judges an appointment that was met by the maximum of the day it was met, under § 14 Abs. 5 BetrSichV', () => {
      // Tested in 2021, two months late in 2023 and on time in 2025, each time under two years.
      const performed = ['2021-03-10', '2023-05-20', '2025-03-12']

      expect(nextAppointment(asked('betrsichv', '2026-12-31'), performed)?.dueOn).toBe('2027-03-01')
      // One year after the last due month, and not a year after a due month the
      // new maximum would have named for 2023.
      expect(nextAppointment(asked('betrsichv', '2027-01-01'), performed)?.dueOn).toBe('2026-03-01')
    })

    it('counts on from the last appointment that was met, where it counts from the day it was due', () => {
      const performed = ['2023-06-15', '2025-06-10']

      expect(nextAppointment(asked('from_due', '2026-12-31'), performed)?.dueOn).toBe('2027-06-15')
      expect(nextAppointment(asked('from_due', '2027-01-01'), performed)?.dueOn).toBe('2026-06-15')
    })

    it('takes a maximum in another unit as the interval wherever the interval may lie beyond it', () => {
      expect(withinCeiling({ months: 6 }, null)).toEqual({ months: 6 })
      expect(withinCeiling({ months: 6 }, { days: 186 })).toEqual({ months: 6 })
      expect(withinCeiling({ months: 6 }, { days: 180 })).toEqual({ days: 180 })
      expect(withinCeiling({ days: 168 }, { months: 6 })).toEqual({ days: 168 })
      expect(withinCeiling({ days: 180 }, { months: 6 })).toEqual({ months: 6 })
      // § 14 Abs. 5 BetrSichV counts in months: a maximum in days as whole months, rounded down.
      expect(
        nextAppointment(
          {
            counting: 'betrsichv',
            interval: { months: 24 },
            ceiling: { on: () => ({ days: 400 }), today: '2027-01-01' },
          },
          ['2026-03-14'],
        )?.dueOn,
      ).toBe('2027-03-01')
    })

    it('changes nothing where no maximum is shorter than the interval', () => {
      fc.assert(
        fc.property(
          rhythms,
          fc.array(days, { minLength: 1, maxLength: 8 }),
          days,
          (rhythm, performed, today) => {
            const plain = nextAppointment(rhythm, performed)

            expect(
              nextAppointment(
                { ...rhythm, ceiling: { on: () => rhythm.interval, today } },
                performed,
              ),
            ).toEqual(plain)
            expect(
              nextAppointment({ ...rhythm, ceiling: { on: () => null, today } }, performed),
            ).toEqual(plain)
          },
        ),
      )
    })
  })

  describe('where a list named the appointment its evidence was taken over with (#130)', () => {
    /** Tested on 14.09.2025, and the list says: due again on 30.09.2026. */
    const takenOver = { performedOn: '2025-09-14', dueOn: '2026-09-30' } as const
    const yearly = (counting: Rhythm['counting']): Rhythm => ({
      counting,
      interval: { months: 12 },
      takenOver,
    })

    it('is due on the day the list names, and not one interval after the evidence', () => {
      for (const counting of ['from_performance', 'from_due'] as const) {
        expect(nextAppointment(yearly(counting), ['2025-09-14'])).toEqual({
          dueOn: '2026-09-30',
          onTimeUntil: '2026-09-30',
        })
      }
    })

    it('is due in the month the list names under § 14 Abs. 5 BetrSichV, on time until two months after', () => {
      expect(nextAppointment(yearly('betrsichv'), ['2025-09-14'])).toEqual({
        dueOn: '2026-09-01',
        onTimeUntil: '2026-11-30',
      })
    })

    it('no longer counts what was done before that evidence', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...recurringCountings),
          fc.array(days, { maxLength: 6 }),
          (counting, performed) => {
            const before = performed.filter((day) => day <= takenOver.performedOn)

            expect(nextAppointment(yearly(counting), before)).toEqual(
              nextAppointment(yearly(counting), []),
            )
          },
        ),
      )
    })

    it('starts over with what is done after it, where the duty counts from the day it was done', () => {
      expect(nextAppointment(yearly('from_performance'), ['2025-09-14', '2026-08-03'])?.dueOn).toBe(
        '2027-08-03',
      )
    })

    it('keeps the rhythm of the day the list names, where the duty counts from the day it was due', () => {
      // On time, a few days early and late: the next lies a year after the day of the list.
      for (const done of ['2026-09-30', '2026-09-05', '2026-11-20']) {
        expect(nextAppointment(yearly('from_due'), ['2025-09-14', done])?.dueOn).toBe('2027-09-30')
      }

      // More than a twelfth of the year early: the year counts anew from that day.
      expect(nextAppointment(yearly('from_due'), ['2025-09-14', '2026-06-01'])?.dueOn).toBe(
        '2027-06-01',
      )
    })

    it('counts on from the month the list names under § 14 Abs. 5 BetrSichV', () => {
      expect(nextAppointment(yearly('betrsichv'), ['2025-09-14', '2026-10-20'])?.dueOn).toBe(
        '2027-09-01',
      )
      // A test before the due month begins the year with its own month.
      expect(nextAppointment(yearly('betrsichv'), ['2025-09-14', '2026-07-08'])?.dueOn).toBe(
        '2027-07-01',
      )
    })

    it('holds an interval of more than two years to its due month for a test within the two months before it', () => {
      const fourYears: Rhythm = {
        counting: 'betrsichv',
        interval: { months: 48 },
        takenOver: { performedOn: '2022-09-14', dueOn: '2026-09-30' },
      }

      // A month before the due month: the four years count on from the month of the list.
      expect(nextAppointment(fourYears, ['2022-09-14', '2026-08-10'])?.dueOn).toBe('2030-09-01')
      // More than two months before it: they count from the month of the test.
      expect(nextAppointment(fourYears, ['2022-09-14', '2026-06-10'])?.dueOn).toBe('2030-06-01')
    })

    it('is cut short to the maximum of a regulation, counted from the day of the evidence', () => {
      const within = (counting: Rhythm['counting'], dueOn: IsoDate): Rhythm => ({
        counting,
        interval: { months: 12 },
        ceiling: { on: () => ({ months: 12 }), today: '2026-01-10' },
        takenOver: { performedOn: '2025-09-14', dueOn },
      })

      // The list names a day beyond the year the regulation allows.
      expect(nextAppointment(within('from_performance', '2026-12-31'), [])?.dueOn).toBe(
        '2026-09-14',
      )
      expect(nextAppointment(within('from_due', '2026-12-31'), [])?.dueOn).toBe('2026-09-14')
      expect(nextAppointment(within('betrsichv', '2026-12-31'), [])?.dueOn).toBe('2026-09-01')
      // A day within it stands as the list names it, and so does any day of the due month.
      expect(nextAppointment(within('from_performance', '2026-06-30'), [])?.dueOn).toBe(
        '2026-06-30',
      )
      expect(nextAppointment(within('betrsichv', '2026-09-30'), [])?.dueOn).toBe('2026-09-01')
    })

    it('judges the maximum on the day the appointment was met, once it was', () => {
      /** One year from 2027 on, none before. */
      const rhythm: Rhythm = {
        counting: 'from_due',
        interval: { months: 24 },
        ceiling: {
          on: (day) => (day < '2027-01-01' ? null : { months: 12 }),
          today: '2027-06-01',
        },
        takenOver: { performedOn: '2025-09-14', dueOn: '2026-12-15' },
      }

      // Met in 2026, when nothing cut it short: the rhythm goes on from the day of the list.
      expect(nextAppointment(rhythm, ['2026-12-10'])?.dueOn).toBe('2027-12-15')
      // Still open in 2027: the year of the regulation counts from the evidence.
      expect(nextAppointment(rhythm, [])?.dueOn).toBe('2026-09-14')
    })

    it('is that of the latest evidence that names one, among those a duty was met by', () => {
      expect(takenOverFrom([])).toBeNull()
      expect(takenOverFrom([{ performedOn: '2025-09-14', nextDueOn: null }])).toBeNull()
      expect(
        takenOverFrom([
          { performedOn: '2022-09-20', nextDueOn: '2024-09-30' },
          { performedOn: '2024-09-14', nextDueOn: '2026-09-30' },
          // Done here since: it names none, and the counting goes on from the one before it.
          { performedOn: '2026-08-03', nextDueOn: null },
        ]),
      ).toEqual({ performedOn: '2024-09-14', dueOn: '2026-09-30' })
    })

    it('changes nothing where no list named an appointment', () => {
      fc.assert(
        fc.property(rhythms, fc.array(days, { maxLength: 8 }), (rhythm, performed) => {
          expect(nextAppointment({ ...rhythm, takenOver: null }, performed)).toEqual(
            nextAppointment(rhythm, performed),
          )
        }),
      )
    })

    it('never lies before the day the list names without something done since, nor after it', () => {
      fc.assert(
        fc.property(
          rhythms,
          days,
          fc.integer({ min: 1, max: 2000 }),
          (rhythm, performedOn, ahead) => {
            const dueOn = addDays(performedOn, ahead)
            const appointment = nextAppointment({ ...rhythm, takenOver: { performedOn, dueOn } }, [
              performedOn,
            ]) as Appointment

            expect(appointment.dueOn).toBe(
              rhythm.counting === 'betrsichv' ? `${dueOn.slice(0, 7)}-01` : dueOn,
            )
            expect(appointment.onTimeUntil >= dueOn).toBe(true)
          },
        ),
      )
    })
  })
})

describe('the state of a duty', () => {
  const appointment: Appointment = { dueOn: '2027-03-01', onTimeUntil: '2027-05-31' }
  const on = (day: IsoDate, resting = false) =>
    dutyStateOn({ appointment, resting, leadDays: 30, on: day }).state

  it('was never recorded without an appointment, which is not overdue', () => {
    expect(
      dutyStateOn({ appointment: null, resting: false, leadDays: 30, on: '2030-01-01' }).state,
    ).toBe('never_recorded')
  })

  it('is met until the lead before its due day, then due, then overdue past the last day on time', () => {
    expect(on('2026-12-01')).toBe('met')
    expect(on('2027-01-29')).toBe('met')
    expect(on('2027-01-30')).toBe('due')
    expect(on('2027-03-01')).toBe('due')
    expect(on('2027-05-31')).toBe('due')
    expect(on('2027-06-01')).toBe('overdue')
  })

  it('rests while its asset is out of service, whatever its appointment, and comes back after', () => {
    expect(on('2027-06-01', true)).toBe('dormant')
    expect(
      dutyStateOn({ appointment: null, resting: true, leadDays: 30, on: '2027-06-01' }).state,
    ).toBe('dormant')
    expect(on('2027-06-01')).toBe('overdue')
  })

  it('names its appointment in every state', () => {
    expect(dutyStateOn({ appointment, resting: true, leadDays: 0, on: '2027-01-01' })).toEqual({
      state: 'dormant',
      appointment,
    })
  })

  it('only ever moves on from met to due to overdue as the days pass', () => {
    const order = ['met', 'due', 'overdue']

    fc.assert(
      fc.property(
        rhythms,
        fc.array(days, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 400 }),
        fc.array(days, { minLength: 2, maxLength: 12 }),
        (rhythm, performed, leadDays, looked) => {
          const next = nextAppointment(rhythm, performed)
          const states = [...looked]
            .sort()
            .map(
              (day) => dutyStateOn({ appointment: next, resting: false, leadDays, on: day }).state,
            )

          for (const [index, state] of states.entries()) {
            expect(dutyStates).toContain(state)
            expect(order.indexOf(state)).toBeGreaterThanOrEqual(
              order.indexOf(states[index - 1] ?? 'met'),
            )
          }
        },
      ),
    )
  })
})

describe('a duty that falls due once (#439)', () => {
  const dueOn: IsoDate = '2027-09-30'
  const appointment = (performances: readonly IsoDate[], countedFrom: IsoDate | null = null) =>
    onceAppointment({ dueOn, countedFrom }, performances)
  const state = (day: IsoDate, performances: readonly IsoDate[] = [], resting = false) =>
    dutyStateOn({
      appointment: appointment(performances),
      resting,
      leadDays: 30,
      on: day,
      once: true,
    }).state

  it('is due on its day until an evidence met it, early or late, and then has no appointment for good', () => {
    expect(appointment([])).toEqual({ dueOn, onTimeUntil: dueOn })
    expect(appointment(['2027-06-14'])).toBeNull()
    expect(appointment(['2028-02-01'])).toBeNull()
  })

  it('counts no evidence from before the day it is counted from', () => {
    expect(appointment(['2026-11-20'], '2026-12-01')).toEqual({ dueOn, onTimeUntil: dueOn })
    expect(appointment(['2026-11-20', '2026-12-01'], '2026-12-01')).toBeNull()
  })

  it('is outstanding until the lead before its day, then due, then overdue, and met for good once done', () => {
    expect(state('2026-10-18')).toBe('outstanding')
    expect(state('2027-08-30')).toBe('outstanding')
    expect(state('2027-08-31')).toBe('due')
    expect(state('2027-09-30')).toBe('due')
    expect(state('2027-10-01')).toBe('overdue')
    expect(state('2027-10-01', ['2027-06-14'])).toBe('met')
    expect(state('2040-01-01', ['2027-06-14'])).toBe('met')
  })

  it('rests with its asset like any duty', () => {
    expect(state('2027-10-01', [], true)).toBe('dormant')
  })
})

describe('whether the duties of an asset rest', () => {
  it('rests in every state of the life cycle but in service, and not without one', () => {
    expect(lifecycleStates.filter((state) => !restsOn(state))).toEqual(['in_service'])
    expect(restsOn(null)).toBe(false)
  })
})
