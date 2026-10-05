import { describe, expect, it } from 'vitest'

import {
  buildingKindLabel,
  buildingKinds,
  buildingProblems,
  floorProblems,
  locationLimits,
  propertyProblems,
  roomProblems,
  roomTitle,
} from './location.js'

const property = {
  name: 'Wohnanlage Nordstraße',
  street: 'Nordstraße 12',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  federalState: 'DE-BW',
}

describe('a property', () => {
  it('is fine with a name, an address and a federal state', () => {
    expect(propertyProblems(property)).toEqual({})
  })

  it('names every field that is missing', () => {
    expect(
      propertyProblems({ name: ' ', street: null, postalCode: '', city: '', federalState: null }),
    ).toEqual({
      name: 'Der Name fehlt.',
      street: 'Die Straße fehlt.',
      postalCode: 'Die Postleitzahl hat fünf Ziffern.',
      city: 'Der Ort fehlt.',
      federalState: 'Das Bundesland fehlt.',
    })
  })

  it('takes a federal state only as one of the sixteen, and a postal code of five digits', () => {
    expect(propertyProblems({ ...property, federalState: 'DE' })).toEqual({
      federalState: 'Das Bundesland ist keines der sechzehn Länder.',
    })
    expect(propertyProblems({ ...property, postalCode: '6853' })).toEqual({
      postalCode: 'Die Postleitzahl hat fünf Ziffern.',
    })
  })

  it('may be as long as the limits and no longer, spaces around a text not counted', () => {
    expect(propertyProblems({ ...property, name: ` ${'x'.repeat(locationLimits.name)} ` })).toEqual(
      {},
    )
    expect(propertyProblems({ ...property, name: 'x'.repeat(locationLimits.name + 1) })).toEqual({
      name: `Der Name hat höchstens ${String(locationLimits.name)} Zeichen.`,
    })
    expect(propertyProblems({ ...property, city: 'x'.repeat(locationLimits.city + 1) })).toEqual({
      city: `Der Ort hat höchstens ${String(locationLimits.city)} Zeichen.`,
    })
  })

  it('leaves a field alone that a change does not name', () => {
    expect(propertyProblems({ name: 'Neuer Name' })).toEqual({})
  })

  it('may carry a note, of some length and with its line breaks, or none', () => {
    const sentence = `Die Notiz hat höchstens ${String(locationLimits.propertyNote)} Zeichen.`

    expect(propertyProblems({ ...property, note: null })).toEqual({})
    expect(
      propertyProblems({ ...property, note: 'Zufahrt über den Hof.\nSchlüssel beim Hausmeister.' }),
    ).toEqual({})
    expect(
      propertyProblems({ ...property, note: 'x'.repeat(locationLimits.propertyNote) }),
    ).toEqual({})
    expect(
      propertyProblems({ ...property, note: 'x'.repeat(locationLimits.propertyNote + 1) }),
    ).toEqual({ note: sentence })
    // Not a text at all is not a note either.
    expect(propertyProblems({ ...property, note: 7 })).toEqual({ note: sentence })
  })
})

describe('the kinds of a building', () => {
  it('each have words', () => {
    expect(Object.keys(buildingKindLabel).sort()).toEqual([...buildingKinds].sort())
  })

  it('are one or several, each once, and only known ones', () => {
    const building = { name: 'Haus A', kinds: ['school', 'assembly'] }

    expect(buildingProblems(building)).toEqual({})
    expect(buildingProblems({ ...building, kinds: [] })).toEqual({
      kinds: 'Ein Gebäude hat mindestens eine Gebäudeart.',
    })
    expect(buildingProblems({ ...building, kinds: ['school', 'castle'] })).toEqual({
      kinds: 'Eine der Gebäudearten gibt es nicht.',
    })
    expect(buildingProblems({ ...building, kinds: ['school', 'school'] })).toEqual({
      kinds: 'Eine Gebäudeart steht doppelt.',
    })
  })
})

describe('a building', () => {
  const building = { name: 'Haus A', shortCode: 'A', kinds: ['office'], yearBuilt: 1972 }

  it('is fine with a name and a kind, a short code and a year built if it has them', () => {
    expect(buildingProblems(building)).toEqual({})
    expect(buildingProblems({ ...building, shortCode: null, yearBuilt: null })).toEqual({})
  })

  it('has a year built within the bounds, as a whole number', () => {
    const sentence = `Das Baujahr ist eine ganze Zahl von ${String(locationLimits.earliestYearBuilt)} bis ${String(locationLimits.latestYearBuilt)}.`

    expect(buildingProblems({ ...building, yearBuilt: locationLimits.earliestYearBuilt })).toEqual(
      {},
    )
    expect(buildingProblems({ ...building, yearBuilt: locationLimits.latestYearBuilt })).toEqual({})
    expect(
      buildingProblems({ ...building, yearBuilt: locationLimits.latestYearBuilt + 1 }),
    ).toEqual({
      yearBuilt: sentence,
    })
    expect(buildingProblems({ ...building, yearBuilt: 1972.5 })).toEqual({ yearBuilt: sentence })
  })

  it('has a short code of a few letters', () => {
    expect(
      buildingProblems({ ...building, shortCode: 'x'.repeat(locationLimits.shortCode + 1) }),
    ).toEqual({
      shortCode: `Das Kürzel hat höchstens ${String(locationLimits.shortCode)} Zeichen.`,
    })
  })
})

describe('a floor', () => {
  it('has a name and a level, the ground floor at nought', () => {
    expect(floorProblems({ name: 'Erdgeschoss', level: 0 })).toEqual({})
    expect(floorProblems({ name: '2. Untergeschoss', level: -2 })).toEqual({})
    expect(floorProblems({ name: '', level: 1.5 })).toEqual({
      name: 'Die Bezeichnung fehlt.',
      level:
        `Die Ebene ist eine ganze Zahl von ${String(locationLimits.lowestLevel)} bis ${String(locationLimits.highestLevel)}: ` +
        '0 ist das Erdgeschoss, darunter liegen die Untergeschosse.',
    })
  })
})

describe('a room', () => {
  it('has a number or a name, or both', () => {
    expect(roomProblems({ number: '1.023', name: null, use: null })).toEqual({})
    expect(roomProblems({ number: null, name: 'Treppenhaus Nord', use: null })).toEqual({})
    expect(roomProblems({ number: ' ', name: null, use: 'Verkehrsfläche' })).toEqual({
      number: 'Ein Raum hat eine Nummer oder eine Bezeichnung.',
    })
  })

  it('keeps its texts within their bounds', () => {
    expect(
      roomProblems({
        number: 'x'.repeat(locationLimits.roomNumber + 1),
        name: 'Büro',
        use: 'x'.repeat(locationLimits.roomUse + 1),
      }),
    ).toEqual({
      number: `Die Raumnummer hat höchstens ${String(locationLimits.roomNumber)} Zeichen.`,
      use: `Die Nutzung hat höchstens ${String(locationLimits.roomUse)} Zeichen.`,
    })
  })

  it('leaves the pair alone when a change names only one of the two', () => {
    expect(roomProblems({ number: '' })).toEqual({})
  })
})

describe('what a room is called in one line', () => {
  it('is its number and its name, the number first', () => {
    expect(roomTitle({ number: 'E.14', name: 'Heizraum' })).toBe('E.14 Heizraum')
  })

  it('is the one of the two it has', () => {
    expect(roomTitle({ number: 'E.14', name: null })).toBe('E.14')
    expect(roomTitle({ number: null, name: 'Treppenhaus Nord' })).toBe('Treppenhaus Nord')
  })

  it('leaves out one that is blank, and is empty for a room with neither', () => {
    expect(roomTitle({ number: '  ', name: 'Heizraum' })).toBe('Heizraum')
    expect(roomTitle({ number: null, name: null })).toBe('')
  })
})
