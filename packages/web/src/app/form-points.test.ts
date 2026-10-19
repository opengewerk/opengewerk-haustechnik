import { describe, expect, it } from 'vitest'

import { strictLimitMilli } from './form-points.js'

describe('the limit at the head of a measured value (#350)', () => {
  it('rounds an upper limit down to the places of the field, as the verdict says it', () => {
    // Zs of a B 16 A breaker: 230 V over 80 A is 2,875 Ω, shown with two places.
    expect(strictLimitMilli(2875, 2, 'at_most')).toBe(2870)
  })

  it('rounds a lower limit and one a value has to stay under up', () => {
    // At least 1,005 MΩ, shown with two places, is "≥ 1,01 MΩ".
    expect(strictLimitMilli(1005, 2, 'at_least')).toBe(1010)
    expect(strictLimitMilli(2875, 2, 'below')).toBe(2880)
  })

  it('leaves a limit that fits the places as it is', () => {
    expect(strictLimitMilli(300_000, 0, 'at_most')).toBe(300_000)
    expect(strictLimitMilli(30_000, 1, 'at_most')).toBe(30_000)
  })
})
