import { describe, expect, it } from 'vitest'

import type { Rhythm } from './duty.js'
import {
  defectAgeBand,
  fulfilmentByPeriod,
  lastTwelveMonths,
  median,
  periodsBetween,
  replayedTerms,
  reportPeriodProblems,
  termOutcome,
} from './figures.js'

/**
 * The figures over time (#334): the terms of a duty replayed from its
 * evidence, how each turned out and in which period it counts, the periods
 * of a grid, the age of a defect and the middle of some days.
 */

const yearly: Rhythm = { counting: 'from_performance', interval: { months: 12 } }
const today = '2026-10-16'

describe('the terms of a duty', () => {
  it('are replayed from the days it was met: each met by the next performance, on time or later', () => {
    const terms = replayedTerms(yearly, ['2025-02-20', '2024-03-01', '2026-04-10'], {
      endsOn: null,
      today,
    })

    expect(terms.map((term) => [term.dueOn, term.metOn, termOutcome(term)])).toEqual([
      ['2025-03-01', '2025-02-20', 'on_time'],
      ['2026-02-20', '2026-04-10', 'late'],
    ])
  })

  it('are open where nothing met them yet, and none after the day of asking', () => {
    expect(
      replayedTerms(yearly, ['2025-01-15'], { endsOn: null, today }).map((term) => [
        term.dueOn,
        termOutcome(term),
      ]),
    ).toEqual([['2026-01-15', 'open']])
    expect(replayedTerms(yearly, ['2026-01-15'], { endsOn: null, today })).toEqual([])
  })

  it('are none for a duty never met, and none from the day the duty ends', () => {
    expect(replayedTerms(yearly, [], { endsOn: null, today })).toEqual([])
    expect(replayedTerms(yearly, ['2025-01-15'], { endsOn: '2026-01-15', today })).toEqual([])
    expect(replayedTerms(yearly, ['2025-01-15'], { endsOn: '2026-01-16', today })).toHaveLength(1)
  })

  it('count as on time on their last day and as late the day after', () => {
    const term = { dueOn: '2026-03-01', onTimeUntil: '2026-03-31' }

    expect(termOutcome({ ...term, metOn: '2026-03-31' })).toBe('on_time')
    expect(termOutcome({ ...term, metOn: '2026-04-01' })).toBe('late')
    expect(termOutcome({ ...term, metOn: null })).toBe('open')
  })
})

describe('the fulfilment per period', () => {
  const terms = [
    { dueOn: '2025-12-03', onTimeUntil: '2025-12-03', metOn: '2025-12-01' },
    { dueOn: '2026-02-20', onTimeUntil: '2026-02-20', metOn: '2026-04-10' },
    { dueOn: '2026-03-31', onTimeUntil: '2026-03-31', metOn: null },
    // Before the period, and after it: in none of its rows.
    { dueOn: '2025-03-01', onTimeUntil: '2025-03-01', metOn: '2025-02-20' },
    { dueOn: '2026-05-01', onTimeUntil: '2026-05-01', metOn: null },
  ]

  it('counts each term in the month it fell due in, with every month of the period a row', () => {
    const rows = fulfilmentByPeriod(terms, '2025-11', '2026-04', 'month')

    expect(rows.map((row) => [row.label, row.due, row.onTime, row.late, row.open])).toEqual([
      ['November 2025', 0, 0, 0, 0],
      ['Dezember 2025', 1, 1, 0, 0],
      ['Januar 2026', 0, 0, 0, 0],
      ['Februar 2026', 1, 0, 1, 0],
      ['März 2026', 1, 0, 0, 1],
      ['April 2026', 0, 0, 0, 0],
    ])
  })

  it('adds the months of a quarter and of a year', () => {
    expect(
      fulfilmentByPeriod(terms, '2025-11', '2026-04', 'quarter').map((row) => [row.label, row.due]),
    ).toEqual([
      ['4. Quartal 2025', 1],
      ['1. Quartal 2026', 2],
      ['2. Quartal 2026', 0],
    ])
    expect(
      fulfilmentByPeriod(terms, '2025-11', '2026-04', 'year').map((row) => [row.label, row.due]),
    ).toEqual([
      ['2025', 1],
      ['2026', 2],
    ])
  })
})

describe('a period', () => {
  it('goes from a month to a month, not backwards and for five years at most', () => {
    expect(reportPeriodProblems({ from: '2025-11', to: '2026-10' })).toEqual({})
    expect(reportPeriodProblems({ from: '2025-11', to: 'Oktober' })).toEqual({
      period: 'Ein Zeitraum geht von einem Monat zu einem Monat, etwa von 2025-10 bis 2026-09.',
    })
    expect(reportPeriodProblems({ from: '2026-11', to: '2026-10' })).toEqual({
      period: 'Der Zeitraum endet vor seinem Anfang.',
    })
    expect(reportPeriodProblems({ from: '2021-11', to: '2026-10' })).toEqual({})
    expect(reportPeriodProblems({ from: '2021-10', to: '2026-10' })).toEqual({
      period: 'Ein Zeitraum ist höchstens 5 Jahre lang.',
    })
  })

  it('opens as the twelve months up to the month of the day', () => {
    expect(lastTwelveMonths('2026-10-16')).toEqual({ from: '2025-11', to: '2026-10' })
    expect(lastTwelveMonths('2026-01-02')).toEqual({ from: '2025-02', to: '2026-01' })
    expect(periodsBetween('2025-11', '2026-10', 'month')).toHaveLength(12)
  })
})

describe('the age of an open defect', () => {
  it('falls in a band by the days since it was found', () => {
    expect(
      [30, 31, 90, 91, 365, 366].map((days) =>
        defectAgeBand(
          new Date(Date.parse('2026-10-16') - days * 86_400_000).toISOString().slice(0, 10),
          '2026-10-16',
        ),
      ),
    ).toEqual(['month', 'quarter', 'quarter', 'year', 'year', 'older'])
  })
})

describe('the middle of some days', () => {
  it('is the one in the middle, between the two in the middle, or none', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})
