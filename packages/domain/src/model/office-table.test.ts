import { describe, expect, it } from 'vitest'

import type { AssetEntry } from './asset-condition.js'
import {
  addressWords,
  assetTableRow,
  byUrgency,
  conditionWords,
  dayInWords,
  placeWords,
  propertySearchText,
  searchedFor,
} from './office-table.js'
import type { PlaceToDo } from './overview.js'

// The ids are plain text here: nothing in these words reads them.
const entry = {
  id: 'a-1',
  propertyId: 'p-1',
  buildingId: 'b-1',
  roomId: null,
  parentAssetId: null,
  kind: 'fire_extinguisher',
  number: 'AN-00031',
  name: 'Feuerlöscher EG, Flur',
  condition: 'in_order',
  until: '2028-09-24',
  lifecycleState: 'in_service',
} as AssetEntry

describe('the words of a list of the office', () => {
  it('write a day as the office does', () => {
    expect(dayInWords('2028-09-24')).toBe('24.09.2028')
  })

  it('say the condition of an asset, and for one in order until when', () => {
    expect(conditionWords({ condition: 'in_order', until: '2028-09-24' })).toBe(
      'In Ordnung bis 24.09.2028',
    )
    expect(conditionWords({ condition: 'in_order', until: null })).toBe('In Ordnung')
    expect(conditionWords({ condition: 'never_checked', until: null })).toBe('Nie geprüft')
  })

  it('name a place by the parts it has', () => {
    expect(placeWords(['Werkhof Nord', 'Halle 1', null, ''])).toBe('Werkhof Nord, Halle 1')
  })
})

describe('an asset as a row of the table of the register', () => {
  it('holds what the columns of the list show', () => {
    expect(assetTableRow(entry, 'Feuerlöscher', 'Verwaltung, Haus A')).toEqual([
      'AN-00031',
      'Feuerlöscher EG, Flur',
      'Feuerlöscher',
      'Verwaltung, Haus A',
      'In Ordnung bis 24.09.2028',
      'In Betrieb',
    ])
  })

  it('leaves the life cycle empty for an asset without an entry in it', () => {
    expect(assetTableRow({ ...entry, lifecycleState: null }, 'Feuerlöscher', '')[5]).toBeNull()
  })
})

describe('the properties as a list', () => {
  const quiet: PlaceToDo = {
    overdue: 0,
    due: 0,
    neverRecorded: 0,
    openDefects: 0,
    missingReadings: 0,
  }

  it('come in the order of urgency: more overdue first, then more never recorded', () => {
    expect(byUrgency({ ...quiet, overdue: 1 }, { ...quiet, overdue: 2 })).toBeGreaterThan(0)
    expect(byUrgency({ ...quiet, neverRecorded: 3 }, { ...quiet, due: 9 })).toBeLessThan(0)
    expect(byUrgency(undefined, quiet)).toBe(0)
  })

  it('are found by their name, their address and the names of their buildings', () => {
    const property = { name: 'Rathaus', street: 'Marktplatz 1', postalCode: '00001', city: 'Süd' }

    expect(addressWords(property)).toBe('Marktplatz 1, 00001 Süd')
    expect(propertySearchText(property, ['Altbau']).includes(searchedFor(' ALTBAU '))).toBe(true)
    expect(propertySearchText(property, []).includes(searchedFor('süd'))).toBe(true)
  })
})
