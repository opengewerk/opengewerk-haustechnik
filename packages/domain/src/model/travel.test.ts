import { describe, expect, it } from 'vitest'

import {
  noTravel,
  readTravel,
  type TravelDocument,
  travelChanges,
  travelFiles,
  travelSize,
  withoutPlace,
  withPlace,
  writeTravel,
} from './travel.js'

const heater = { kind: 'asset', id: 'a-heater' } as const
const boilerRoom = { kind: 'room', id: 'r-boiler' } as const

const manual: TravelDocument = {
  assetId: 'a-heater',
  roomId: null,
  newest: { id: 'v-2', sha256: 'm2', sizeBytes: 3_400_000 },
}
const plate: TravelDocument = {
  assetId: 'a-heater',
  roomId: null,
  newest: { id: 'v-3', sha256: 'p1', sizeBytes: 820_000 },
}
const scheme: TravelDocument = {
  assetId: null,
  roomId: 'r-boiler',
  newest: { id: 'v-5', sha256: 's1', sizeBytes: 820_000 },
}
// Filed on another device and not here yet, with no version the device holds.
const onItsWay: TravelDocument = { assetId: 'a-heater', roomId: null, newest: null }

describe('documents for the road', () => {
  it('are kept per place, each once, and read back as written; anything else is nothing kept', () => {
    const keep = withPlace(withPlace(withPlace(noTravel, heater), boilerRoom), heater)

    expect(keep.places).toEqual([heater, boilerRoom])
    expect(readTravel(writeTravel({ ...keep, files: ['m2', 'm2'] }))).toEqual({
      places: [heater, boilerRoom],
      files: ['m2'],
    })
    expect(withoutPlace(keep, heater).places).toEqual([boilerRoom])
    expect(readTravel(null)).toEqual(noTravel)
    expect(readTravel('kaputt')).toEqual(noTravel)
    expect(readTravel('{"places":[{"kind":"building","id":"b-1"}],"files":[7]}')).toEqual(noTravel)
  })

  it('want the newest version of every document on the place itself', () => {
    expect(
      travelFiles([heater, boilerRoom], [manual, plate, scheme, onItsWay]).map((file) => [
        file.place.id,
        file.versionId,
      ]),
    ).toEqual([
      ['a-heater', 'v-2'],
      ['a-heater', 'v-3'],
      ['r-boiler', 'v-5'],
    ])
    // A room wants none of the documents of the assets in it.
    expect(travelFiles([boilerRoom], [manual, plate])).toEqual([])
  })

  it('fetch what the device does not hold, once, and let go of what no place wants any more', () => {
    const keep = { places: [heater], files: ['m1', 'p1'] }
    // A new version of the manual came; the plate is held already.
    const wanted = travelFiles([heater, heater], [manual, plate])
    const { fetch, forget } = travelChanges(keep, wanted, new Set(['m1', 'p1']))

    expect(fetch.map((file) => file.sha256)).toEqual(['m2'])
    expect(forget).toEqual(['m1'])
  })

  it('let go of every file of a place once the place is forgotten or its documents are gone', () => {
    const keep = { places: [], files: ['m2', 'p1'] }

    expect(travelChanges(keep, [], new Set(['m2', 'p1'])).forget).toEqual(['m2', 'p1'])
    // The documents gone from the device: removed, or out of the areas of the person.
    expect(
      travelChanges({ ...keep, places: [heater] }, travelFiles([heater], []), new Set(['m2'])),
    ).toEqual({ fetch: [], forget: ['m2', 'p1'] })
  })

  it('count the files of a place and what they take, each once', () => {
    expect(travelSize(travelFiles([heater, heater], [manual, plate]))).toEqual({
      files: 2,
      bytes: 4_220_000,
    })
  })
})
