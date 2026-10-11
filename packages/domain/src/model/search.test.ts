import { describe, expect, it } from 'vitest'

import {
  closeness,
  holds,
  searchLimits,
  searchProblem,
  searchWordsOf,
  shownMark,
} from './search.js'

describe('the words of a search', () => {
  it('are trimmed, with a run of spaces made one, and nothing for what is no text', () => {
    expect(searchWordsOf('  AN-00058   Heiz  ')).toBe('AN-00058 Heiz')
    expect(searchWordsOf(['AN'])).toBe('')
    expect(searchWordsOf(undefined)).toBe('')
  })

  it('are asked from the fewest characters to the most', () => {
    expect(searchProblem('A')).toBe('Gesucht wird ab 2 Zeichen.')
    expect(searchProblem('AN')).toBeNull()
    expect(searchProblem('x'.repeat(searchLimits.longest))).toBeNull()
    expect(searchProblem('x'.repeat(searchLimits.longest + 1))).toBe(
      'Gesucht wird nach höchstens 100 Zeichen.',
    )
  })
})

describe('finding the words in a text', () => {
  it('finds them anywhere, regardless of case, umlauts included', () => {
    expect(holds('Heizraum', 'heiz')).toBe(true)
    expect(holds('E.14 Heizraum', 'RAUM')).toBe(true)
    expect(holds('Zählerschrank', 'ZÄHLER')).toBe(true)
    expect(holds('Heizraum', 'Kessel')).toBe(false)
    expect(holds(null, 'Heiz')).toBe(false)
  })

  it('puts a text that is the words before one that begins with them, and that before one that holds them', () => {
    expect(closeness(['AN-00058', 'Heizkessel'], 'an-00058')).toBe(0)
    expect(closeness(['AN-00058', 'Heizkessel'], 'heiz')).toBe(1)
    expect(closeness(['AN-00058', 'Heizkessel'], 'kessel')).toBe(2)
    expect(closeness(['AN-00058', null], 'Pumpe')).toBe(3)
    // The closest of the texts counts.
    expect(closeness(['Kesselhaus', 'Kessel'], 'kessel')).toBe(0)
  })
})

describe('the mark an asset shows', () => {
  const asset = { mark: 'HZ-SH-01', serialNumber: 'SN-4711', meterNumber: '13-882914' }

  it('is the one the words were found in', () => {
    expect(shownMark(asset, '4711')).toEqual({ field: 'serialNumber', value: 'SN-4711' })
    expect(shownMark(asset, '882914')).toEqual({ field: 'meterNumber', value: '13-882914' })
    expect(shownMark(asset, 'hz-sh')).toEqual({ field: 'mark', value: 'HZ-SH-01' })
  })

  it('is its mark where the words stood in the number or the name, and none without one', () => {
    expect(shownMark(asset, 'Heizkessel')).toEqual({ field: 'mark', value: 'HZ-SH-01' })
    expect(shownMark({ ...asset, mark: null }, 'Heizkessel')).toBeNull()
  })
})
