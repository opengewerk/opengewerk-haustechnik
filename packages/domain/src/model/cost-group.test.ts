import { describe, expect, it } from 'vitest'

import type { AssetKind, CatalogueEntry } from './catalogue.js'
import { costGroupAbove, costGroupName, costGroupWords, inCostGroup } from './cost-group.js'

function kind(key: string, label: string, costGroup: string): CatalogueEntry<AssetKind> {
  return {
    key,
    version: 1,
    validFrom: '2018-12-01',
    definition: {
      label,
      costGroup,
      characteristics: [],
      fields: [],
      expectedDocuments: [],
      meter: null,
    },
    review: { checkedOn: '2026-10-05', accepted: null },
  }
}

// A specialist kind stands before the general one of its group, and a second
// specialist kind names the group itself: neither gives the group its name.
const kinds = [
  kind('probe.escalator', 'Fahrtreppe', '460'),
  kind('probe.elevator', 'Aufzugsanlage', '461'),
  kind('allgemein.conveying_system', 'Förderanlage', '460'),
  kind('allgemein.heat_supply', 'Anlage der Wärmeversorgung', '420'),
]

describe('a cost group of DIN 276', () => {
  it('lies in the group of the second level that begins like it', () => {
    expect(['461', '460', '412', '499'].map(costGroupAbove)).toEqual(['460', '460', '410', '490'])
  })

  it('holds the groups below it, and one that ends in no zero holds itself alone', () => {
    const lying = (group: string) =>
      ['412', '460', '461', '469', '470', '540'].filter((each) => inCostGroup(each, group))

    expect(lying('460')).toEqual(['460', '461', '469'])
    expect(lying('400')).toEqual(['412', '460', '461', '469', '470'])
    expect(lying('461')).toEqual(['461'])
    expect(lying('999')).toEqual([])
    // A group of nothing but zeros is none, and holds nothing.
    expect(lying('000')).toEqual([])
    expect(lying('')).toEqual([])
  })

  it('goes by its number, and behind it by what the general asset kind of exactly this group is called (#163)', () => {
    expect(costGroupWords('460', kinds)).toBe('KG 460 Förderanlage')
    expect(costGroupWords('420', kinds)).toBe('KG 420 Anlage der Wärmeversorgung')
    expect(costGroupName('460', kinds)).toBe('Förderanlage')

    // 461 lies in 460 and is not 460: the general kind names its own group alone.
    expect(costGroupWords('461', kinds)).toBe('KG 461')
    expect(costGroupName('461', kinds)).toBeNull()
    // A group no general kind stands for, and a catalogue without any.
    expect(costGroupWords('430', kinds)).toBe('KG 430')
    expect(costGroupWords('460', [])).toBe('KG 460')
    expect(costGroupWords('460', kinds.slice(0, 2))).toBe('KG 460')
    expect(costGroupWords('constructor', kinds)).toBe('KG constructor')
  })
})
