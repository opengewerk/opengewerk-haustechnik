import { numberFromPattern, patternProblem } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { defaultNumberPatterns, numberRangeKeys } from './number-range.js'

describe('the number ranges', () => {
  it('start every sequence with a pattern the foundation takes', () => {
    for (const key of numberRangeKeys) {
      expect(patternProblem(defaultNumberPatterns[key]), key).toBeNull()
    }
  })

  it('number an asset without a year, and a work order and a piece of evidence with it', () => {
    expect(numberFromPattern(defaultNumberPatterns.asset, { counter: 1, year: 2026 })).toBe(
      'AN-00001',
    )
    expect(numberFromPattern(defaultNumberPatterns.work_order, { counter: 7, year: 2026 })).toBe(
      'AU-2026-0007',
    )
    expect(numberFromPattern(defaultNumberPatterns.evidence, { counter: 12, year: 2027 })).toBe(
      'NW-2027-00012',
    )
  })
})
