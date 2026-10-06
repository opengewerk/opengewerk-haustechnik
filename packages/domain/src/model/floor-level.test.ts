import { describe, expect, it } from 'vitest'

import { levelOfFloorName } from './floor-level.js'

/** The levels of some names, in the order they were given. */
const levels = (names: readonly string[]) => names.map(levelOfFloorName)

describe('the level a list gives a floor by its name', () => {
  it('is nought for the ground floor, however it is written', () => {
    expect(
      levels(['EG', 'eg', 'E.G.', 'Erdgeschoss', 'Erdgeschoß', 'ERDGESCHOSS', ' Erd geschoss ']),
    ).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(levels(['Parterre', 'parterre'])).toEqual([0, 0])
  })

  it('is the count of an upper floor that stands before its word', () => {
    expect(levels(['1. OG', '2.OG', '3 og', '12. OG'])).toEqual([1, 2, 3, 12])
    expect(levels(['3. Stock', '2.Etage', '4. Obergeschoss', '1. Obergeschoß'])).toEqual([
      3, 2, 4, 1,
    ])
  })

  it('is the count of an upper floor that stands behind its word', () => {
    expect(levels(['OG 2', 'OG2', 'Obergeschoss 3', 'Etage 5', 'Stock 1'])).toEqual([2, 2, 3, 5, 1])
  })

  it('is the first for an upper floor without a count', () => {
    expect(levels(['Obergeschoss', 'OG'])).toEqual([1, 1])
  })

  it('lies below nought for a basement, by its count or by one without', () => {
    expect(levels(['UG', 'Keller', 'KG', 'Untergeschoss', 'Kellergeschoss'])).toEqual([
      -1, -1, -1, -1, -1,
    ])
    expect(levels(['2. UG', 'UG 2', '2. Untergeschoss', '3. Kellergeschoss', 'U.G.'])).toEqual([
      -2, -2, -2, -3, -1,
    ])
  })

  it('is the number of a level that is called by it', () => {
    expect(levels(['E-1', 'E0', 'E 2', 'e1'])).toEqual([-1, 0, 2, 1])
    expect(levels(['Ebene 2', 'Ebene -2', 'Ebene 0', 'EBENE 10'])).toEqual([2, -2, 0, 10])
  })

  it('is a bare number as it stands, below nought too', () => {
    expect(levels(['0', '3', '-1', ' 2 ', '-12', '100'])).toEqual([0, 3, -1, 2, -12, 100])
  })

  it('is not guessed for an attic, a mezzanine or a name that says no number', () => {
    expect(levels(['DG', 'Dachgeschoss', 'Zwischengeschoss', 'Souterrain', 'Halle'])).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
    expect(levels(['', '   '])).toEqual([null, null])
  })

  it('is not read out of a name that merely holds such a word', () => {
    expect(
      levels(['Technikgeschoss über 3. OG', 'OG 2 Zwischenebene', 'Kellerabgang', 'Ebene A']),
    ).toEqual([null, null, null, null])
  })
})

describe('what the name of a floor does not say', () => {
  it('is a level where a storey stands without its count', () => {
    expect(levels(['Etage', 'Stock', 'Stockwerk'])).toEqual([null, null, null])
  })

  it('is a level where the number has a fraction', () => {
    expect(levels(['1.5', '1.5 OG', 'E 1.5', '2,5', 'OG 1.5'])).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
  })

  it('is a level where a floor above or below the ground is numbered nought', () => {
    expect(levels(['0. OG', '0. UG', 'U0'])).toEqual([null, null, null])
  })
})

describe('more names a list gives a floor', () => {
  it('are a storey called Stockwerk with its count', () => {
    expect(levels(['2. Stockwerk', 'Stockwerk 3'])).toEqual([2, 3])
  })

  it('are U1 and U2 for the floors below the ground', () => {
    expect(levels(['U1', 'U 2', 'u3'])).toEqual([-1, -2, -3])
  })

  it('are the ground floor as a nought without a sign', () => {
    expect(Object.is(levelOfFloorName('E-0'), 0)).toBe(true)
    expect(Object.is(levelOfFloorName('Ebene -0'), 0)).toBe(true)
  })
})
