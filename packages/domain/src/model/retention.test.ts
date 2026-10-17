import { describe, expect, it } from 'vitest'

import { retentionSettingsProblem } from './retention.js'

/** The longer retention of an operator (#340): a whole number of years from 1 to 50, or none. */
describe('the longer retention of an operator', () => {
  it('is a whole number of years from 1 to 50, or nothing for the rule alone', () => {
    expect(retentionSettingsProblem(null)).toBeNull()
    expect(retentionSettingsProblem(1)).toBeNull()
    expect(retentionSettingsProblem(50)).toBeNull()

    for (const wrong of [0, 51, 1.5, -3, '3', undefined]) {
      expect(retentionSettingsProblem(wrong)).toBe(
        'Mindestens aufbewahren heißt 1 bis 50 Jahre, oder leer.',
      )
    }
  })
})
