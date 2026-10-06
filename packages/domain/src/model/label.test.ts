import { describe, expect, it } from 'vitest'

import type { AssetId } from './asset.js'
import { labelReadingOf } from './label.js'
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
