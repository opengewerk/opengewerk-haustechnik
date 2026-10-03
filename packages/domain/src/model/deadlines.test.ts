import { deadlineRegistry, DeadlineRegistryError } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { deadlineActions, deadlineKinds, deadlineSources, dutyDue } from './deadlines.js'

describe('the kinds of deadline of this application', () => {
  it('pass the registry of the foundation, with the sources and actions this application has', () => {
    const registry = deadlineRegistry(deadlineKinds, {
      sources: [...deadlineSources],
      actions: [...deadlineActions],
    })

    expect(registry.kinds).toEqual([dutyDue])
    expect(registry.kind('duty.due')).toBe(dutyDue)
  })

  it('would stop the start with a source this application does not have', () => {
    expect(() =>
      deadlineRegistry([{ ...dutyDue, source: 'round' as 'duty' }], {
        sources: [...deadlineSources],
        actions: [...deadlineActions],
      }),
    ).toThrow(DeadlineRegistryError)
  })

  it('let the duty name its due day, remind ahead of it, and remind whom the duty names', () => {
    // The source names the day (ADR 0002, point 12): the kind has no interval
    // of its own, and an operator can set none.
    expect(dutyDue).toMatchObject({
      source: 'duty',
      intervalDays: null,
      intervalMonths: null,
      leadDays: 30,
      responsible: 'source',
      actions: ['reminder'],
    })
  })
})
