import { describe, expect, it } from 'vitest'

import { byNameIn, byNumberIn } from './name-order.js'

describe('names in the order of a German list (#322)', () => {
  it('sorts the house numbers of a street by their value', () => {
    expect(
      [
        'Musterstraße 1',
        'Musterstraße 10',
        'Musterstraße 11',
        'Musterstraße 20',
        'Musterstraße 4',
        'Musterstraße 5',
        'Musterstraße 9',
      ].sort(byNameIn),
    ).toEqual([
      'Musterstraße 1',
      'Musterstraße 4',
      'Musterstraße 5',
      'Musterstraße 9',
      'Musterstraße 10',
      'Musterstraße 11',
      'Musterstraße 20',
    ])
  })

  it('puts a number with an addition after its number and before the next', () => {
    expect(
      ['Weg 8', 'Weg 3', 'Weg 2.1', 'Weg 4a', 'Weg 2', 'Weg 4', 'Weg 6'].sort(byNameIn),
    ).toEqual(['Weg 2', 'Weg 2.1', 'Weg 3', 'Weg 4', 'Weg 4a', 'Weg 6', 'Weg 8'])
  })

  it('still sorts words as German does, an umlaut beside its vowel', () => {
    expect(['Zentrale', 'Ölheizung', 'Anbau', 'Obergeschoss'].sort(byNameIn)).toEqual([
      'Anbau',
      'Obergeschoss',
      'Ölheizung',
      'Zentrale',
    ])
  })
})

describe('rooms by their number (#322)', () => {
  it('counts the numbers by their value, then a room with only a name', () => {
    const rooms = [
      { number: 'E.10', name: 'Lager' },
      { number: null, name: 'Flur' },
      { number: 'E.2', name: 'Büro' },
      { number: 'E.2', name: 'Archiv' },
      { number: null, name: 'Aufzug' },
      { number: 'E.9', name: null },
    ]

    expect([...rooms].sort(byNumberIn)).toEqual([
      { number: 'E.2', name: 'Archiv' },
      { number: 'E.2', name: 'Büro' },
      { number: 'E.9', name: null },
      { number: 'E.10', name: 'Lager' },
      { number: null, name: 'Aufzug' },
      { number: null, name: 'Flur' },
    ])
  })
})
