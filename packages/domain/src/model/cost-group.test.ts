import { describe, expect, it } from 'vitest'

import { costGroupAbove, costGroupNames, costGroupWords, inCostGroup } from './cost-group.js'

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

  it('is called by its number, and by its name where it is one of the technical installations', () => {
    expect(costGroupWords('460')).toBe('KG 460 Förderanlagen')
    expect(costGroupWords('461')).toBe('KG 461')
    expect(costGroupWords('constructor')).toBe('KG constructor')
    expect(Object.keys(costGroupNames)).toEqual([
      '410',
      '420',
      '430',
      '440',
      '450',
      '460',
      '470',
      '480',
      '490',
    ])
  })
})
