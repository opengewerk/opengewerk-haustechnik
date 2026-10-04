import { describe, expect, it } from 'vitest'

import { placeTargetProblem } from './target.js'

describe('the place a record hangs on', () => {
  it('is the property, or one asset, room or building on it', () => {
    expect(placeTargetProblem({}, 'Ein Vorgang')).toBeNull()
    expect(
      placeTargetProblem({ assetId: 'a', roomId: null, buildingId: null }, 'Ein Vorgang'),
    ).toBeNull()
    expect(placeTargetProblem({ roomId: 'r' }, 'Ein Mangel')).toBeNull()
  })

  it('is never two of them, in the words of the record', () => {
    expect(placeTargetProblem({ assetId: 'a', buildingId: 'b' }, 'Ein Mangel')).toBe(
      'Ein Mangel hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum oder einem Gebäude.',
    )
  })
})
