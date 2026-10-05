import { describe, expect, it } from 'vitest'

import { closureLimits, closureOn, closureProblems } from './closure.js'

const christmas = { startsOn: '2026-12-24', endsOn: '2027-01-06', reason: 'Weihnachtsferien' }

describe('a time a building is closed', () => {
  it('runs from a day to a day and says on request what for', () => {
    expect(closureProblems(christmas)).toEqual({})
    expect(closureProblems({ ...christmas, reason: null })).toEqual({})
  })

  it('may be a single day', () => {
    expect(closureProblems({ startsOn: '2026-10-30', endsOn: '2026-10-30' })).toEqual({})
  })

  it('needs both of its days', () => {
    expect(closureProblems({ startsOn: null, endsOn: null })).toEqual({
      startsOn: 'Der erste Tag fehlt.',
      endsOn: 'Der letzte Tag fehlt.',
    })
    expect(closureProblems({ startsOn: '', endsOn: '2026-12-24' })).toEqual({
      startsOn: 'Der erste Tag fehlt.',
    })
  })

  it('is not asked about a day that was not given', () => {
    expect(closureProblems({ reason: 'Herbstferien' })).toEqual({})
  })

  it('takes a day of the calendar and nothing that only looks like one', () => {
    for (const none of ['24.12.2026', '2026-02-30', '2026-13-01', 20261224, true]) {
      expect(closureProblems({ startsOn: none, endsOn: '2027-01-06' })).toEqual({
        startsOn: 'Der erste Tag ist ein Tag, geschrieben 2026-10-03.',
      })
    }

    expect(closureProblems({ startsOn: '2026-12-24', endsOn: 'bald' })).toEqual({
      endsOn: 'Der letzte Tag ist ein Tag, geschrieben 2026-10-03.',
    })
  })

  it('does not end before it begins', () => {
    expect(closureProblems({ startsOn: '2027-01-06', endsOn: '2026-12-24' })).toEqual({
      endsOn: 'Der letzte Tag liegt vor dem ersten.',
    })
  })

  /** Written like a day and sorting before the first one, but no day of the calendar. */
  it('says one thing about a day that is none, and nothing about the order then', () => {
    expect(closureProblems({ startsOn: '2027-01-06', endsOn: '2026-02-30' })).toEqual({
      endsOn: 'Der letzte Tag ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(closureProblems({ startsOn: '2027-02-30', endsOn: '2026-12-24' })).toEqual({
      startsOn: 'Der erste Tag ist ein Tag, geschrieben 2026-10-03.',
    })
  })

  it('keeps what it is for within its bound', () => {
    expect(closureLimits.reason).toBe(80)
    expect(closureProblems({ ...christmas, reason: 'a'.repeat(80) })).toEqual({})
    expect(closureProblems({ ...christmas, reason: 'a'.repeat(81) })).toEqual({
      reason: 'Der Anlass hat höchstens 80 Zeichen.',
    })
    expect(closureProblems({ ...christmas, reason: 7 })).toEqual({
      reason: 'Der Anlass hat höchstens 80 Zeichen.',
    })
  })
})

describe('whether a building is closed on a day', () => {
  const summer = { startsOn: '2027-07-27', endsOn: '2027-09-06', reason: 'Sommerferien' }

  it('is answered by the closure that covers the day, its first and its last day included', () => {
    const closures = [christmas, summer]

    expect(closureOn(closures, '2026-12-23')).toBeNull()
    expect(closureOn(closures, '2026-12-24')).toBe(christmas)
    expect(closureOn(closures, '2026-12-31')).toBe(christmas)
    expect(closureOn(closures, '2027-01-06')).toBe(christmas)
    expect(closureOn(closures, '2027-01-07')).toBeNull()
    expect(closureOn(closures, '2027-08-01')).toBe(summer)
  })

  it('is open where no closure stands', () => {
    expect(closureOn([], '2026-12-24')).toBeNull()
  })

  it('gets the same answer whatever order two closures over the same day arrive in', () => {
    const renovation = { startsOn: '2026-12-01', endsOn: '2026-12-27', reason: 'Sanierung' }
    const longer = { startsOn: '2026-12-01', endsOn: '2027-02-28', reason: 'Sanierung, verlängert' }

    // The one that began first answers, ...
    expect(closureOn([christmas, renovation], '2026-12-25')).toBe(renovation)
    expect(closureOn([renovation, christmas], '2026-12-25')).toBe(renovation)
    // ... and of two that began on the same day, the one that ends last.
    expect(closureOn([renovation, longer], '2026-12-25')).toBe(longer)
    expect(closureOn([longer, renovation], '2026-12-25')).toBe(longer)
  })

  it('compares days as the calendar orders them, across a turn of the year', () => {
    expect(closureOn([christmas], '2027-01-01')).toBe(christmas)
    expect(closureOn([christmas], '2026-01-01')).toBeNull()
  })
})
