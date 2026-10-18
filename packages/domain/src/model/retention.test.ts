import { describe, expect, it } from 'vitest'

import { retentionInWords, retentionSettingsProblem } from './retention.js'

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

describe('the retention of an evidence in words', () => {
  it('names the years after the use of its asset where it states them (#437)', () => {
    expect(
      retentionInWords(
        {
          kind: 'while_in_use',
          on: '2026-10-02',
          yearsAfter: 5,
          rule: 'raumluft.cooling_book_retention',
        },
        null,
      ),
    ).toBe('Solange die Anlage verwendet wird und 5 Jahre danach')
    expect(
      retentionInWords({ kind: 'while_in_use', on: '2026-10-02', yearsAfter: null, rule: null }, 2),
    ).toBe('Solange die Anlage verwendet wird, mindestens 2 Jahre')
  })
})
