import { describe, expect, it } from 'vitest'

import { evidenceResultLabel, evidenceResults, meetsTheDuty } from './evidence.js'

describe('the result of a performance', () => {
  it('meets the duty when the work was done, with or without defects, and not otherwise', () => {
    expect(evidenceResults.filter(meetsTheDuty)).toEqual(['without_defects', 'with_defects'])
  })

  it('has a name for every result, in the words of the concept', () => {
    expect(evidenceResults.map((result) => evidenceResultLabel[result])).toEqual([
      'Ohne Mangel',
      'Mit Mängeln',
      'Nicht bestanden',
      'Nicht durchgeführt',
    ])
  })
})
