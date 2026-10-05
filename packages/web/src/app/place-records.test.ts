import { describe, expect, it } from 'vitest'

import { byLevel, byNumber, kindKeysOf, kindsOf, placeAbove, titleOfRoom } from './place-records.js'

/**
 * The places as a device holds them, read for a screen (#86): what a building
 * is used as, what a room is called, the order floors and rooms are listed
 * in, and what a page stands under.
 */

// What the form of a building starts from: the keys, and not their words.
describe('the kinds of a building by their keys', () => {
  it('reads the text of a list and a list alike, in the order they were chosen', () => {
    expect(kindKeysOf({ kinds: '["assembly","school"]' })).toEqual(['assembly', 'school'])
    expect(kindKeysOf({ kinds: ['assembly', 'school'] })).toEqual(['assembly', 'school'])
  })

  it('keeps a key this version does not know, so that saving does not drop it', () => {
    expect(kindKeysOf({ kinds: '["school","planetarium"]' })).toEqual(['school', 'planetarium'])
  })

  it('is empty for what is no list, and for a building that is not there', () => {
    for (const kinds of [null, undefined, 'school', '{"school":true}', 'not json', 7, '']) {
      expect([kinds, kindKeysOf({ kinds })]).toEqual([kinds, []])
    }

    expect(kindKeysOf(null)).toEqual([])
    expect(kindKeysOf(undefined)).toEqual([])
  })
})

describe('the kinds of a building in words', () => {
  it('reads the text of a list, as a device holds them', () => {
    expect(kindsOf({ kinds: '["school","assembly"]' })).toEqual([
      'Schule oder Hochschule',
      'Versammlungs- oder Sportstätte',
    ])
  })

  it('reads a list, as a route answers', () => {
    expect(kindsOf({ kinds: ['garage'] })).toEqual(['Garage'])
  })

  it('keeps the order they were chosen in', () => {
    expect(kindsOf({ kinds: '["assembly","school"]' })).toEqual([
      'Versammlungs- oder Sportstätte',
      'Schule oder Hochschule',
    ])
  })

  it('shows a kind this version does not know by its key', () => {
    expect(kindsOf({ kinds: '["school","planetarium"]' })).toEqual([
      'Schule oder Hochschule',
      'planetarium',
    ])
  })

  // `toString` is on every object and is no kind of a building.
  it('takes no word from what every object carries', () => {
    expect(kindsOf({ kinds: '["toString","constructor"]' })).toEqual(['toString', 'constructor'])
  })

  it('is empty for what is no list', () => {
    for (const kinds of [null, undefined, 'school', '{"school":true}', 'not json', 7, '']) {
      expect(kindsOf({ kinds })).toEqual([])
    }

    expect(kindsOf(null)).toEqual([])
    expect(kindsOf(undefined)).toEqual([])
    expect(kindsOf({})).toEqual([])
  })
})

describe('what a room is called in one line', () => {
  it('is its number and its name, the number first', () => {
    expect(titleOfRoom({ number: 'E.14', name: 'Heizraum' })).toBe('E.14 Heizraum')
  })

  it('is whichever of the two it has', () => {
    expect(titleOfRoom({ number: 'E.20', name: null })).toBe('E.20')
    expect(titleOfRoom({ number: null, name: 'Treppenhaus' })).toBe('Treppenhaus')
  })

  it('is empty for a room that is not there', () => {
    expect(titleOfRoom(null)).toBe('')
    expect(titleOfRoom(undefined)).toBe('')
  })
})

describe('the order of floors', () => {
  const names = (floors: readonly { name: string }[]) => floors.map((floor) => floor.name)

  it('goes from the lowest level up', () => {
    const floors = [
      { name: '1. Obergeschoss', level: 1 },
      { name: 'Untergeschoss', level: -1 },
      { name: 'Dachgeschoss', level: 10 },
      { name: 'Erdgeschoss', level: 0 },
      { name: '2. Obergeschoss', level: 2 },
    ]

    expect(names(floors.sort(byLevel))).toEqual([
      'Untergeschoss',
      'Erdgeschoss',
      '1. Obergeschoss',
      '2. Obergeschoss',
      'Dachgeschoss',
    ])
  })

  it('lists two on one level by name', () => {
    const floors = [
      { name: 'Zwischengeschoss Ost', level: 1 },
      { name: 'Äußere Galerie', level: 1 },
      { name: 'Galerie', level: 1 },
    ]

    // "Ä" beside "A", as a German reader looks for it, and not after "Z".
    expect(names(floors.sort(byLevel))).toEqual([
      'Äußere Galerie',
      'Galerie',
      'Zwischengeschoss Ost',
    ])
  })
})

describe('the order of rooms and assets', () => {
  const titles = (records: readonly { number: string | null; name: string }[]) =>
    records.map((record) => [record.number, record.name].filter(Boolean).join(' '))

  it('counts a number as a person does', () => {
    const rooms = [
      { number: 'E.10', name: 'Hausmeister' },
      { number: 'E.2', name: 'Lager' },
      { number: 'E.14', name: 'Heizraum' },
      { number: 'E.1', name: 'Windfang' },
    ]

    expect(titles(rooms.sort(byNumber))).toEqual([
      'E.1 Windfang',
      'E.2 Lager',
      'E.10 Hausmeister',
      'E.14 Heizraum',
    ])
  })

  it('lists the numbers of assets in the order they were given', () => {
    const assets = [
      { number: 'AN-00010', name: 'Heizkessel' },
      { number: 'AN-00100', name: 'Lüftung' },
      { number: 'AN-00009', name: 'Hauptwasserzähler' },
    ]

    expect(titles(assets.sort(byNumber))).toEqual([
      'AN-00009 Hauptwasserzähler',
      'AN-00010 Heizkessel',
      'AN-00100 Lüftung',
    ])
  })

  it('lists what has no number after what has one, by name', () => {
    const rooms = [
      { number: null, name: 'Treppenhaus' },
      { number: 'E.2', name: 'Lager' },
      { number: null, name: 'Aufzugsschacht' },
      { number: 'E.1', name: 'Windfang' },
    ]

    expect(titles(rooms.sort(byNumber))).toEqual([
      'E.1 Windfang',
      'E.2 Lager',
      'Aufzugsschacht',
      'Treppenhaus',
    ])
  })

  it('lists two with the same number by name', () => {
    const rooms = [
      { number: 'E.2', name: 'Lager West' },
      { number: 'E.2', name: 'Lager Ost' },
    ]

    expect(titles(rooms.sort(byNumber))).toEqual(['E.2 Lager Ost', 'E.2 Lager West'])
  })

  // Whichever of the two comes first in the list: a sort asks both ways.
  it('answers the same whichever of two it is asked about first', () => {
    const numbered = { number: 'E.2', name: 'Lager' }
    const unnumbered = { number: null, name: 'Abstellraum' }

    expect(byNumber(numbered, unnumbered)).toBeLessThan(0)
    expect(byNumber(unnumbered, numbered)).toBeGreaterThan(0)
    expect(byNumber(unnumbered, { ...unnumbered })).toBe(0)
  })
})

describe('what a page at a place stands under', () => {
  const property = { id: 'p-1', name: 'Schulzentrum Am Lindenhain' }
  const building = { id: 'b-1', name: 'Schulhaus' }
  const floor = { id: 'f-1', name: 'Erdgeschoss' }
  const room = { id: 'r-1', number: 'E.14', name: 'Heizraum' }
  const asset = { id: 's-1', name: 'Heizkessel', number: 'AN-00010' }

  it('is the property alone for the page of a building', () => {
    expect(placeAbove({ property })).toEqual({ property })
  })

  it('goes down as far as the records it is given', () => {
    expect(placeAbove({ property, building })).toEqual({ property, building })
    expect(placeAbove({ property, building, floor })).toEqual({ property, building, floor })
    expect(placeAbove({ property, building, floor, room })).toEqual({
      property,
      building,
      floor,
      room,
    })
  })

  it('names a room by what it has', () => {
    expect(
      placeAbove({ property, building, floor, room: { id: 'r-2', name: 'Treppenhaus' } }).room,
    ).toEqual({ id: 'r-2', number: null, name: 'Treppenhaus' })
  })

  // An asset in a building and in no room of it, with a component below.
  it('leaves out what is not there, and takes what is below it all the same', () => {
    expect(placeAbove({ property, building, floor: null, room: null, asset })).toEqual({
      property,
      building,
      asset: { id: 's-1', name: 'Heizkessel' },
    })
  })
})
