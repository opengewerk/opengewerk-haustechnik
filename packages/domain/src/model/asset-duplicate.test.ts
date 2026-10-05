import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  duplicateKey,
  isGeneralKind,
  possibleDuplicates,
  sameIn,
  sameWords,
} from './asset-duplicate.js'

const heater = { id: 'a-1', serialNumber: 'BT-750-22-0193', mark: 'TW-01' }

describe('how a serial number or a mark is compared', () => {
  it('ignores spaces and capitals, and keeps punctuation', () => {
    expect(duplicateKey(' BT 750-22 ')).toBe('bt750-22')
    expect(duplicateKey('bt750-22')).toBe('bt750-22')
    expect(duplicateKey('BT75022')).not.toBe(duplicateKey('BT-750-22'))
  })

  it('has nothing to compare where nothing is said', () => {
    expect(duplicateKey(null)).toBeNull()
    expect(duplicateKey(undefined)).toBeNull()
    expect(duplicateKey('   ')).toBeNull()
    expect(duplicateKey(4711)).toBeNull()
  })
})

describe('a possible duplicate', () => {
  it('is an asset with the same serial number, however it was typed', () => {
    expect(sameIn({ serialNumber: 'bt-750-22-0193' }, heater)).toEqual(['serialNumber'])
    expect(sameIn({ serialNumber: ' BT -750-22- 0193' }, heater)).toEqual(['serialNumber'])
  })

  it('is an asset with the same mark', () => {
    expect(sameIn({ mark: 'tw-01' }, heater)).toEqual(['mark'])
  })

  it('names both fields when both are the same', () => {
    expect(sameIn({ serialNumber: 'BT-750-22-0193', mark: 'TW-01' }, heater)).toEqual([
      'serialNumber',
      'mark',
    ])
  })

  it('is never the asset itself', () => {
    expect(sameIn(heater, heater)).toEqual([])
    expect(sameIn({ ...heater, id: 'a-2' }, heater)).toEqual(['serialNumber', 'mark'])
  })

  it('is found among assets nobody has given an id yet, the rows of an import', () => {
    expect(sameIn({ serialNumber: 'X-1' }, { serialNumber: 'x-1' })).toEqual(['serialNumber'])
    expect(possibleDuplicates({ mark: 'K 1' }, [{ mark: 'k1' }, { mark: 'k2' }])).toEqual([
      { asset: { mark: 'k1' }, same: ['mark'] },
    ])
  })

  it('is not an asset that merely lacks the same things', () => {
    expect(sameIn({ serialNumber: null, mark: '' }, { id: 'a-3', serialNumber: null })).toEqual([])
    expect(sameIn({}, { id: 'a-3', serialNumber: '  ', mark: null })).toEqual([])
  })

  it('never holds a serial number against a mark', () => {
    expect(sameIn({ serialNumber: 'TW-01' }, heater)).toEqual([])
    expect(sameIn({ mark: 'BT-750-22-0193' }, heater)).toEqual([])
  })

  it('is found among the others, the one that shares both first', () => {
    const others = [
      { id: 'a-4', serialNumber: 'X-1', mark: null },
      { id: 'a-5', serialNumber: null, mark: 'tw-01' },
      heater,
    ]

    expect(possibleDuplicates({ serialNumber: 'BT-750-22-0193', mark: 'TW-01' }, others)).toEqual([
      { asset: heater, same: ['serialNumber', 'mark'] },
      { asset: others[1], same: ['mark'] },
    ])
    expect(possibleDuplicates({ serialNumber: 'Y-9' }, others)).toEqual([])
  })

  it('is one in both directions, and only ever one of the others', () => {
    const text = fc.option(fc.constantFrom('A 1', 'a1', 'A-1', 'B2', ' b2 ', ''), { nil: null })
    const asset = fc.record({ id: fc.constantFrom('1', '2', '3'), serialNumber: text, mark: text })

    fc.assert(
      fc.property(asset, fc.array(asset, { maxLength: 6 }), (candidate, others) => {
        const found = possibleDuplicates(candidate, others)

        for (const { asset: other, same } of found) {
          expect(others).toContain(other)
          expect(other.id).not.toBe(candidate.id)
          expect(sameIn(other, candidate)).toEqual(same)
        }
      }),
    )
  })
})

describe('the words for what two assets share', () => {
  it('begin a sentence', () => {
    expect(sameWords(['serialNumber'])).toBe('Gleiche Seriennummer')
    expect(sameWords(['mark'])).toBe('Gleiches Kennzeichen')
    expect(sameWords(['mark', 'serialNumber'])).toBe(
      'Gleiche Seriennummer und gleiches Kennzeichen',
    )
  })
})

describe('the general asset kind of a cost group', () => {
  it('is one of the package that stands in for a missing one', () => {
    expect(isGeneralKind('allgemein.kg_420')).toBe(true)
    expect(isGeneralKind('probe.elevator')).toBe(false)
    expect(isGeneralKind('allgemeines.kg_420')).toBe(false)
  })
})
