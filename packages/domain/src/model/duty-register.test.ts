import type { IsoDate } from '@opengewerk/platform-domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { type DutyState, dutyStateLabel, dutyStates } from './duty.js'
import {
  dutyHasEnded,
  type DutyEntry,
  dutyRegisterFilters,
  dutyRegisterOrder,
  dutyRegisterStateLabel,
  dutyRegisterStates,
  evidenceStandingOf,
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
      'propertyId',
      'buildingId',
      'assetKind',
      'dutyKind',
      'responsible',
    ])
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
