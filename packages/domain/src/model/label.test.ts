import { describe, expect, it } from 'vitest'

import type { AssetId } from './asset.js'
import { labelAssignmentRefusal, labelAssignmentSentence, labelReadingOf } from './label.js'
import type { RoomId } from './location.js'

const asset = '0199c0de-0000-7000-8000-00000000000a' as AssetId
const room = '0199c0de-0000-7000-8000-00000000000b' as RoomId
const blockedAt = new Date('2026-10-01T08:00:00Z')

describe('what a label says to the device that holds it', () => {
  it('opens its asset or its room while it is valid', () => {
    expect(labelReadingOf({ blockedAt: null, assetId: asset, roomId: null })).toEqual({
      state: 'asset',
      assetId: asset,
    })
    expect(labelReadingOf({ blockedAt: null, assetId: null, roomId: room })).toEqual({
      state: 'room',
      roomId: room,
    })
  })

  it('opens nothing once it is blocked, whatever it hangs on', () => {
    expect(labelReadingOf({ blockedAt, assetId: asset, roomId: null })).toEqual({
      state: 'blocked',
    })
    expect(labelReadingOf({ blockedAt, assetId: null, roomId: room })).toEqual({
      state: 'blocked',
    })
    expect(labelReadingOf({ blockedAt, assetId: null, roomId: null })).toEqual({
      state: 'blocked',
    })
  })

  it('says that a label from a sheet has not been given to an asset yet', () => {
    expect(labelReadingOf({ blockedAt: null, assetId: null, roomId: null })).toEqual({
      state: 'unassigned',
    })
  })
})

describe('a label from a sheet that is to be given to an asset', () => {
  const property = '0199c0de-0000-7000-8000-00000000000c'
  const sheet = { blockedAt: null, assetId: null, roomId: null, propertyId: property }

  it('is given where it is free, on the property of the asset, and the asset has none', () => {
    expect(labelAssignmentRefusal(sheet, { propertyId: property }, false)).toBeNull()
  })

  it('is given to nothing once it is blocked, whatever else holds', () => {
    expect(labelAssignmentRefusal({ ...sheet, blockedAt }, { propertyId: property }, false)).toBe(
      'blocked',
    )
    expect(
      labelAssignmentRefusal({ ...sheet, blockedAt, assetId: asset }, { propertyId: 'x' }, true),
    ).toBe('blocked')
  })

  it('stays on the asset or the room it hangs on', () => {
    expect(
      labelAssignmentRefusal({ ...sheet, assetId: asset }, { propertyId: property }, false),
    ).toBe('taken')
    expect(
      labelAssignmentRefusal({ ...sheet, roomId: room }, { propertyId: property }, false),
    ).toBe('taken')
  })

  it('stays on the property it was printed for, and is given to no asset whose property is not known', () => {
    expect(labelAssignmentRefusal(sheet, { propertyId: 'another' }, false)).toBe('elsewhere')
    expect(labelAssignmentRefusal(sheet, {}, false)).toBe('elsewhere')
    expect(
      labelAssignmentRefusal({ ...sheet, propertyId: null }, { propertyId: null }, false),
    ).toBe('elsewhere')
  })

  it('is no second label for an asset that carries a valid one', () => {
    expect(labelAssignmentRefusal(sheet, { propertyId: property }, true)).toBe('labelled')
  })

  it('has a sentence for every refusal', () => {
    expect(Object.keys(labelAssignmentSentence).sort()).toEqual([
      'blocked',
      'elsewhere',
      'labelled',
      'taken',
    ])
  })
})
