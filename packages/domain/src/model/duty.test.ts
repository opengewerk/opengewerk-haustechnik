import {
  addDays,
  addMonths,
  type DeadlineInterval,
  type IsoDate,
} from '@opengewerk/platform-domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { lifecycleStates } from './asset.js'
import { countings } from './catalogue.js'
import {
  type Appointment,
  dutyStateOn,
  dutyStates,
  nextAppointment,
  restsOn,
  type Rhythm,
} from './duty.js'

/** A day between 2000 and 2049, as fast-check draws it. */
const days = fc
  .integer({ min: 0, max: 50 * 365 })
  .map((offset) => addDays('2000-01-01', offset) as IsoDate)

const monthly = fc.integer({ min: 1, max: 72 }).map((months): DeadlineInterval => ({ months }))
const daily = fc.integer({ min: 1, max: 730 }).map((count) => ({ days: count }))

/** A rhythm of any counting, with an interval it takes. */
const rhythms = fc.constantFrom(...countings).chain((counting) =>
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

describe('whether the duties of an asset rest', () => {
  it('rests in every state of the life cycle but in service, and not without one', () => {
    expect(lifecycleStates.filter((state) => !restsOn(state))).toEqual(['in_service'])
    expect(restsOn(null)).toBe(false)
  })
})
