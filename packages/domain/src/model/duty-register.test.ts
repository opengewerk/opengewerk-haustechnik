import type { IsoDate } from '@opengewerk/platform-domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { type DutyState, dutyStateLabel, dutyStates } from './duty.js'
import {
  type DutyDueWindow,
  dutyDueWindowLabel,
  dutyDueWindows,
  dutyHasEnded,
  type DutyEntry,
  dutyRegisterFilters,
  dutyRegisterOrder,
  dutyRegisterStateLabel,
  dutyRegisterStates,
  evidenceStandingOf,
  inDueWindow,
  inRegisterOrder,
  namesAPerson,
  withoutResponsible,
} from './duty-register.js'
import type { EvidenceResult } from './evidence.js'

type Ordered = Pick<DutyEntry, 'id' | 'state' | 'appointment' | 'asset' | 'title'>

/** A row of the register, as far as its order asks. */
function row(
  id: string,
  state: DutyState,
  dueOn: IsoDate | null = null,
  further: { readonly number?: string; readonly title?: string } = {},
): Ordered {
  return {
    id: id as Ordered['id'],
    state,
    appointment: dueOn === null ? null : { dueOn, onTimeUntil: dueOn },
    asset:
      further.number === undefined
        ? null
        : ({ number: further.number } as unknown as Ordered['asset']),
    title: further.title ?? 'Prüfung',
  }
}

const sorted = (rows: readonly Ordered[]) =>
  [...rows].sort(inRegisterOrder).map((entry) => entry.id)

describe('the states the register is narrowed to', () => {
  it('are every state of a duty once, and the duties that have ended', () => {
    expect([...dutyRegisterOrder].sort()).toEqual([...dutyStates].sort())
    expect(dutyRegisterStates).toEqual([...dutyRegisterOrder, 'ended'])
  })

  it('begin with never recorded, before overdue', () => {
    expect(dutyRegisterOrder.slice(0, 2)).toEqual(['never_recorded', 'overdue'])
  })

  it('are called as the states are, a met one without its day', () => {
    for (const state of dutyRegisterOrder.filter((each) => each !== 'met')) {
      expect(dutyRegisterStateLabel[state]).toBe(dutyStateLabel[state])
    }

    expect(dutyRegisterStateLabel.met).toBe('Erfüllt')
    expect(dutyRegisterStateLabel.ended).toBe('Beendet')
  })
})

describe('the order of the register', () => {
  it('puts a duty never recorded before one overdue, whatever their days', () => {
    expect(
      sorted([
        row('met', 'met', '2026-01-01'),
        row('overdue', 'overdue', '2020-01-01'),
        row('dormant', 'dormant', '2019-01-01'),
        row('never', 'never_recorded'),
        row('due', 'due', '2026-11-01'),
      ]),
    ).toEqual(['never', 'overdue', 'due', 'met', 'dormant'])
  })

  it('puts the earlier due day first within a state, and a duty without a day last', () => {
    expect(
      sorted([
        row('later', 'overdue', '2026-09-30'),
        row('none', 'dormant'),
        row('earlier', 'overdue', '2026-09-15'),
        row('resting', 'dormant', '2026-01-01'),
      ]),
    ).toEqual(['earlier', 'later', 'resting', 'none'])
  })

  it('goes by the number of the asset, then by the name, then by the id', () => {
    expect(
      sorted([
        row('c', 'never_recorded', null, { number: 'AN-00002', title: 'B' }),
        row('b', 'never_recorded', null, { number: 'AN-00001', title: 'Z' }),
        row('e', 'never_recorded', null, { number: 'AN-00002', title: 'B' }),
        row('a', 'never_recorded', null, { title: 'Z' }),
        row('d', 'never_recorded', null, { number: 'AN-00002', title: 'A' }),
      ]),
    ).toEqual(['a', 'b', 'd', 'c', 'e'])
  })

  it('never leaves two different rows undecided, so that no page repeats one', () => {
    const rows = fc.uniqueArray(
      fc.record({
        id: fc.uuid(),
        state: fc.constantFrom(...dutyStates),
        dueOn: fc.option(fc.constantFrom<IsoDate>('2026-01-01', '2026-06-01'), { nil: null }),
      }),
      { selector: (each) => each.id, minLength: 2, maxLength: 12 },
    )

    fc.assert(
      fc.property(rows, (drawn) => {
        const entries = drawn.map((each) => row(each.id, each.state, each.dueOn))

        for (const left of entries) {
          for (const right of entries) {
            if (left !== right) {
              expect(inRegisterOrder(left, right)).not.toBe(0)
            }
          }
        }
      }),
    )
  })
})

describe('a duty that ends', () => {
  it('has ended from the day it ends, and not the day before', () => {
    expect(dutyHasEnded({ endsOn: '2026-10-06' }, '2026-10-05')).toBe(false)
    expect(dutyHasEnded({ endsOn: '2026-10-06' }, '2026-10-06')).toBe(true)
    expect(dutyHasEnded({ endsOn: '2026-10-06' }, '2026-10-07')).toBe(true)
  })

  it('has not ended without a day', () => {
    expect(dutyHasEnded({ endsOn: null }, '2026-10-06')).toBe(false)
  })
})

describe('a filter of the register', () => {
  it('names a person where it names one, and none for all duties or those of nobody', () => {
    expect(namesAPerson({})).toBe(false)
    expect(namesAPerson({ responsible: withoutResponsible })).toBe(false)
    expect(namesAPerson({ responsible: 'u-roth' })).toBe(true)
  })

  it('reaches the server with the state first and the person last', () => {
    expect(dutyRegisterFilters).toEqual([
      'state',
      'due',
      'propertyId',
      'areaId',
      'buildingId',
      'assetKind',
      'dutyKind',
      'responsible',
    ])
  })
})

describe('the windows of days the register is narrowed to under "Fällig"', () => {
  const today = '2026-10-10'
  const standing = (
    state: DutyState,
    dueOn: IsoDate | null,
    ended = false,
  ): Pick<DutyEntry, 'state' | 'appointment' | 'ended'> => ({
    state,
    appointment: dueOn === null ? null : { dueOn, onTimeUntil: dueOn },
    ended,
  })
  const windows = (entry: Pick<DutyEntry, 'state' | 'appointment' | 'ended'>) =>
    dutyDueWindows.filter((window) => inDueWindow(entry, window, today))

  it('are called as the select of the register offers them', () => {
    expect(dutyDueWindows.map((window) => dutyDueWindowLabel[window])).toEqual([
      'In 30 Tagen',
      'In 90 Tagen',
      'Überfällig oder in 30 Tagen',
    ])
  })

  it('hold a duty by the day of its appointment, the last day of the window included', () => {
    expect(windows(standing('due', '2026-11-09'))).toEqual([
      'in_30_days',
      'in_90_days',
      'overdue_or_in_30_days',
    ])
    expect(windows(standing('met', '2026-11-10'))).toEqual(['in_90_days'])
    expect(windows(standing('met', '2027-01-08'))).toEqual(['in_90_days'])
    expect(windows(standing('met', '2027-01-09'))).toEqual([])
  })

  it('hold a duty whose lead time has not begun, by its day and not by its state', () => {
    expect(windows(standing('met', '2026-10-25'))).toContain('in_30_days')
  })

  it('hold a duty due within its window although its day has passed, which is not overdue', () => {
    expect(windows(standing('due', '2026-10-01'))).toEqual([
      'in_30_days',
      'in_90_days',
      'overdue_or_in_30_days',
    ])
  })

  it('leave an overdue duty out of 30 and 90 days, and hold it where the window says so', () => {
    expect(windows(standing('overdue', '2026-09-15'))).toEqual(['overdue_or_in_30_days'])
  })

  it('hold no duty that was never recorded, that rests or that has ended', () => {
    expect(windows(standing('never_recorded', null))).toEqual([])
    expect(windows(standing('dormant', '2026-10-20'))).toEqual([])
    expect(windows(standing('due', '2026-10-20', true))).toEqual([])
    expect(windows(standing('overdue', '2026-09-15', true))).toEqual([])
  })

  it('make the window of 90 days hold every duty the one of 30 holds', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...dutyStates),
        fc.integer({ min: -400, max: 400 }),
        fc.boolean(),
        (state, offset, ended) => {
          const day = new Date(Date.UTC(2026, 9, 10 + offset)).toISOString().slice(0, 10)
          const entry = standing(state, state === 'never_recorded' ? null : day, ended)
          const within = (window: DutyDueWindow) => inDueWindow(entry, window, today)

          expect(!within('in_30_days') || within('in_90_days')).toBe(true)
          expect(within('overdue_or_in_30_days')).toBe(
            within('in_30_days') || (state === 'overdue' && !ended),
          )
        },
      ),
    )
  })
})

describe('what an evidence means for the appointment of its duty', () => {
  const evidence = (
    id: string,
    result: EvidenceResult = 'without_defects',
    replacesEvidenceId: string | null = null,
  ) => ({ id, result, replacesEvidenceId })

  it('counts where it met the duty, with defects or without', () => {
    const rows = [evidence('a'), evidence('b', 'with_defects')]
    const standing = evidenceStandingOf(rows, new Set())

    expect(rows.map(standing)).toEqual(['counts', 'counts'])
  })

  it('does not count where the test failed or was not performed', () => {
    const rows = [evidence('a', 'failed'), evidence('b', 'not_performed')]
    const standing = evidenceStandingOf(rows, new Set())

    expect(rows.map(standing)).toEqual(['does_not_meet', 'does_not_meet'])
  })

  it('is replaced once a correction names it, and the correction counts', () => {
    const rows = [evidence('old'), evidence('new', 'without_defects', 'old')]
    const standing = evidenceStandingOf(rows, new Set())

    expect(rows.map(standing)).toEqual(['replaced', 'counts'])
  })

  it('is invalid once it was declared so, also where a correction replaced it', () => {
    const rows = [evidence('old'), evidence('new', 'without_defects', 'old'), evidence('alone')]
    const standing = evidenceStandingOf(rows, new Set(['old', 'alone']))

    expect(rows.map(standing)).toEqual(['voided', 'counts', 'voided'])
  })
})
