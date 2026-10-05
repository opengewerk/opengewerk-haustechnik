import { addDays, type IsoDate } from '@opengewerk/platform-domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  assetConditionLabel,
  assetConditions,
  assetStandingOn,
  defectIsOpen,
} from './asset-condition.js'
import { defectStatuses } from './defect.js'
import { type DutyStanding, type DutyState, dutyStates } from './duty.js'

/** A day between 2000 and 2049, as fast-check draws it. */
const days = fc
  .integer({ min: 0, max: 50 * 365 })
  .map((offset) => addDays('2000-01-01', offset) as IsoDate)

/** A duty in a state, with an appointment where the state has one. */
function duty(state: DutyState, dueOn: IsoDate | null = '2027-03-12'): DutyStanding {
  return {
    state,
    appointment:
      state === 'never_recorded' || dueOn === null ? null : { dueOn, onTimeUntil: dueOn },
  }
}

/** The states of a duty of an asset in service, as fast-check draws them. */
const inService = fc.constantFrom<DutyState>('never_recorded', 'overdue', 'due', 'met')

const standings = fc
  .tuple(inService, days)
  .map(([state, dueOn]): DutyStanding => duty(state, dueOn))

describe('a defect', () => {
  it('is open until it was checked again, remedied or not', () => {
    expect(defectStatuses.filter(defectIsOpen)).toEqual(['found', 'ordered', 'remedied'])
  })
})

describe('the condition of an asset', () => {
  it('has a name each', () => {
    for (const condition of assetConditions) {
      expect(assetConditionLabel[condition]).not.toBe('')
    }
  })

  it('is an open defect whatever its duties say, also while it rests', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.boolean(),
        fc.array(standings, { maxLength: 5 }),
        (openDefects, resting, duties) => {
          expect(assetStandingOn({ openDefects, resting, duties })).toEqual({
            condition: 'defect_open',
            until: null,
          })
        },
      ),
    )
  })

  it('rests with an asset that is not in service, whatever its appointments say', () => {
    fc.assert(
      fc.property(fc.array(standings, { maxLength: 5 }), (duties) => {
        expect(assetStandingOn({ openDefects: 0, resting: true, duties })).toEqual({
          condition: 'resting',
          until: null,
        })
      }),
    )
  })

  it('says so of an asset nobody confirmed a duty for', () => {
    expect(assetStandingOn({ openDefects: 0, resting: false, duties: [] })).toEqual({
      condition: 'no_duties',
      until: null,
    })
  })

  it('is the loudest of its duties: never checked before overdue before due before in order', () => {
    const of = (...states: DutyState[]) =>
      assetStandingOn({ openDefects: 0, resting: false, duties: states.map((each) => duty(each)) })
        .condition

    expect(of('met', 'due', 'overdue', 'never_recorded')).toBe('never_checked')
    expect(of('met', 'due', 'overdue')).toBe('overdue')
    expect(of('met', 'due')).toBe('due')
    expect(of('met', 'met')).toBe('in_order')
  })

  it('does not depend on the order its duties come in', () => {
    fc.assert(
      fc.property(fc.array(standings, { minLength: 1, maxLength: 6 }), (duties) => {
        expect(
          assetStandingOn({ openDefects: 0, resting: false, duties: [...duties].reverse() }),
        ).toEqual(assetStandingOn({ openDefects: 0, resting: false, duties }))
      }),
    )
  })

  it('never gets better by a duty more', () => {
    fc.assert(
      fc.property(fc.array(standings, { minLength: 1, maxLength: 5 }), standings, (duties, one) => {
        const rank = (all: readonly DutyStanding[]) =>
          assetConditions.indexOf(
            assetStandingOn({ openDefects: 0, resting: false, duties: all }).condition,
          )

        expect(rank([...duties, one])).toBeLessThanOrEqual(rank(duties))
      }),
    )
  })

  it('is in order until the first day one of its duties falls due', () => {
    expect(
      assetStandingOn({
        openDefects: 0,
        resting: false,
        duties: [duty('met', '2028-09-24'), duty('met', '2027-03-12'), duty('met', '2029-01-01')],
      }),
    ).toEqual({ condition: 'in_order', until: '2027-03-12' })
  })

  it('names a day only for an asset in order', () => {
    fc.assert(
      fc.property(fc.array(standings, { minLength: 1, maxLength: 6 }), (duties) => {
        const standing = assetStandingOn({ openDefects: 0, resting: false, duties })

        expect(standing.until === null).toBe(standing.condition !== 'in_order')
      }),
    )
  })

  it('knows every state a duty can be in', () => {
    // A duty rests with its asset; one that rests alone decides nothing.
    for (const state of dutyStates) {
      expect(assetConditions).toContain(
        assetStandingOn({ openDefects: 0, resting: false, duties: [duty(state)] }).condition,
      )
    }
  })
})
