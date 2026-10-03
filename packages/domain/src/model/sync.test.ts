import { describe, expect, it } from 'vitest'

import { offlineRules, syncEntities, syncPolicies } from './sync.js'

// What travels between the devices and the server of this application. The
// mechanism is the foundation's (ADR 0010); the list is this application's,
// and it is empty until the first record that travels (#27).

describe('the sync of this application', () => {
  it('lets no record travel before the records exist', () => {
    expect(Object.keys(syncPolicies)).toEqual([])
    expect(syncEntities).toEqual([])
  })

  it('answers an operation on a kind of record it does not know as a conflict, not as an error', () => {
    expect(
      offlineRules.decideMerge(
        {
          id: '01929c5e-7a3b-7c00-8000-000000000001' as never,
          entity: 'rooms',
          recordId: '01929c5e-7a3b-7c00-8000-000000000002',
          kind: 'create',
          baseVersion: null,
          patches: [{ field: 'name', from: null, to: 'Heizraum' }],
          recordedAt: new Date('2026-10-03T08:00:00Z'),
          deviceId: 'probe-phone',
        },
        null,
      ),
    ).toEqual({ outcome: 'conflict', reason: 'unknown_entity', fields: [] })
  })
})
