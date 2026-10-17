import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  type ConsumptionMeter,
  consumptionInMonths,
  isMediumKey,
  mediumKeyLabel,
  mediumKeyOf,
  periodsWithMonths,
  readBy,
  restOf,
  sumFactorOf,
} from './consumption-figures.js'

const today = '2026-10-17' as IsoDate

/** A measuring point read on the 1st with these figures, in whole units. */
function meter(
  figures: Readonly<Record<string, number>>,
  further: Partial<ConsumptionMeter['input']> & { readonly sumFactor?: number } = {},
): ConsumptionMeter {
  return {
    keyDay: 1,
    sumFactor: further.sumFactor ?? 1,
    since: '2020-01-01' as IsoDate,
    input: {
      readings: Object.entries(figures).map(([keyDate, value]) => ({
        keyDate: keyDate as IsoDate,
        readOn: keyDate as IsoDate,
        valueMilli: value * 1000,
      })),
      exchanges: further.exchanges ?? [],
      pauses: further.pauses ?? [],
      conversionFactor: further.conversionFactor ?? null,
    },
  }
}

describe('the consumption of a measuring point in some months', () => {
  it('sums what it consumed up to each key date in the months, with its factor and in kilowatt hours', () => {
    const read = { '2026-01-01': 100, '2026-02-01': 130, '2026-03-01': 170, '2026-04-01': 220 }

    expect(consumptionInMonths(meter(read), '2026-02', '2026-04', today)).toBe(120_000)
    expect(consumptionInMonths(meter(read), '2026-03', '2026-03', today)).toBe(40_000)
    expect(
      consumptionInMonths(meter(read, { conversionFactor: 40 }), '2026-03', '2026-03', today),
    ).toBe(1_600_000)
    expect(
      consumptionInMonths(
        meter(read, { sumFactor: sumFactorOf('megawatt_hours') }),
        '2026-03',
        '2026-03',
        today,
      ),
    ).toBe(40_000_000)
  })

  it('is a gap where a key date has no reading, and no estimate', () => {
    const read = { '2026-01-01': 100, '2026-02-01': 130, '2026-04-01': 220 }

    // March has no reading, and April reaches back over it.
    expect(consumptionInMonths(meter(read), '2026-03', '2026-03', today)).toBeNull()
    expect(consumptionInMonths(meter(read), '2026-04', '2026-04', today)).toBeNull()
    // Over both, the reading of April accounts for March.
    expect(consumptionInMonths(meter(read), '2026-02', '2026-04', today)).toBe(120_000)
    expect(consumptionInMonths(meter(read), '2026-03', '2026-04', today)).toBe(90_000)
  })

  it('counts across a replacement on both meters', () => {
    const replaced = meter(
      { '2026-01-01': 1000, '2026-02-01': 15 },
      {
        exchanges: [
          { exchangedOn: '2026-01-20' as IsoDate, oldEndMilli: 1040_000, newStartMilli: 0 },
        ],
      },
    )

    // 40 on the old meter up to its last figure, 15 on the new one from zero.
    expect(consumptionInMonths(replaced, '2026-02', '2026-02', today)).toBe(55_000)
  })

  it('counts nothing while the point rests, and has no gap there', () => {
    const rests = meter(
      { '2026-01-01': 100, '2026-04-01': 100, '2026-05-01': 120 },
      { pauses: [{ startsOn: '2026-01-01' as IsoDate, endsOn: '2026-03-31' as IsoDate }] },
    )

    expect(consumptionInMonths(rests, '2026-02', '2026-04', today)).toBe(0)
    expect(consumptionInMonths(rests, '2026-02', '2026-05', today)).toBe(20_000)

    const resting = meter(
      { '2026-01-01': 100 },
      { pauses: [{ startsOn: '2026-01-15' as IsoDate, endsOn: null }] },
    )

    // Resting from the 15th of January: the month up to February ran in part, so February is a gap; whole months count nothing.
    expect(consumptionInMonths(resting, '2026-02', '2026-02', today)).toBeNull()
    expect(consumptionInMonths(resting, '2026-03', '2026-06', today)).toBe(0)
  })

  it('counts nothing before its first reading, or before it was taken in without one, and for a key date not due yet', () => {
    const read = { '2026-06-01': 10, '2026-07-01': 25 }

    expect(consumptionInMonths(meter(read), '2026-01', '2026-07', today)).toBe(15_000)
    expect(consumptionInMonths(meter(read), '2025-01', '2025-12', today)).toBe(0)

    // Taken in on the 10th of May and never read: a gap from June on, nothing before.
    const unread = { ...meter({}), since: '2026-05-10' as IsoDate }

    expect(consumptionInMonths(unread, '2026-01', '2026-05', today)).toBe(0)
    expect(consumptionInMonths(unread, '2026-05', '2026-06', today)).toBeNull()
    expect([
      readBy(unread, '2026-06'),
      readBy(meter(read), '2026-06'),
      readBy(meter(read), '2026-05'),
    ]).toEqual([false, true, false])

    const late = { ...meter({ '2026-08-20': 10, '2026-09-20': 40 }), keyDay: 20 }

    // The key date of October has not come; that is no gap.
    expect(consumptionInMonths(late, '2026-09', '2026-10', today)).toBe(30_000)
  })
})

describe('the rest of a main meter', () => {
  it('is what it measured without its sub-meters, or a gap where one of them has one', () => {
    expect(restOf(100_000, [30_000, 20_000])).toBe(50_000)
    expect(restOf(100_000, [])).toBe(100_000)
    expect(restOf(100_000, [30_000, null])).toBeNull()
    expect(restOf(null, [30_000])).toBeNull()
  })
})

describe('what can be summed', () => {
  it('is a medium in a unit, megawatt hours as kilowatt hours', () => {
    expect(mediumKeyOf('heat', 'megawatt_hours')).toBe('heat:kilowatt_hours')
    expect(mediumKeyLabel(mediumKeyOf('gas', 'cubic_metres'))).toBe('Gas (m³)')
    expect(isMediumKey('electricity:kilowatt_hours')).toBe(true)
    expect(isMediumKey('electricity:megawatt_hours')).toBe(false)
    expect(isMediumKey('steam:kilowatt_hours')).toBe(false)
  })
})

describe('the periods of the course', () => {
  it('know their first and their last month, cut to the months asked', () => {
    expect(periodsWithMonths('2026-02', '2026-07', 'quarter')).toEqual([
      { key: '2026-Q1', label: '1. Quartal 2026', from: '2026-02', to: '2026-03' },
      { key: '2026-Q2', label: '2. Quartal 2026', from: '2026-04', to: '2026-06' },
      { key: '2026-Q3', label: '3. Quartal 2026', from: '2026-07', to: '2026-07' },
    ])
  })
})
