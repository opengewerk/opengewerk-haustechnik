import { deadlineRegistry, DeadlineRegistryError } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  deadlineActions,
  deadlineKinds,
  deadlineSources,
  defectDue,
  dutyDue,
  meterDue,
  roundDue,
} from './deadlines.js'

describe('the kinds of deadline of this application', () => {
  it('pass the registry of the foundation, with the sources and actions this application has', () => {
    const registry = deadlineRegistry(deadlineKinds, {
      sources: [...deadlineSources],
      actions: [...deadlineActions],
    })

    expect(registry.kinds).toEqual([dutyDue, defectDue, roundDue, meterDue])
    expect(registry.kind('duty.due')).toBe(dutyDue)
    expect(registry.kind('defect.due')).toBe(defectDue)
    expect(registry.kind('round.due')).toBe(roundDue)
    expect(registry.kind('meter.due')).toBe(meterDue)
  })

  it('would stop the start with a source this application does not have', () => {
    expect(() =>
      deadlineRegistry([{ ...dutyDue, source: 'round' as (typeof deadlineSources)[number] }], {
        sources: [...deadlineSources],
        actions: [...deadlineActions],
      }),
    ).toThrow(DeadlineRegistryError)
  })

  it('let the duty name its due day, remind ahead of it, remind whom the duty names and make the activity', () => {
    // The source names the day (ADR 0002, point 12): the kind has no interval
    // of its own, and an operator can set none.
    expect(dutyDue).toMatchObject({
      source: 'duty',
      intervalDays: null,
      intervalMonths: null,
      leadDays: 30,
      responsible: 'source',
      actions: ['reminder', 'activity'],
    })
  })

  it('let a defect name the day it is to be set right by, remind ahead of it and remind whoever leads', () => {
    // A defect names nobody who answers for it (section 4.6 of the concept).
    expect(defectDue).toMatchObject({
      source: 'defect',
      intervalDays: null,
      intervalMonths: null,
      leadDays: 7,
      responsible: 'lead',
      actions: ['reminder'],
    })
  })

  it('let the plan of a round name its next pass, make its rounds two weeks ahead and remind nobody', () => {
    // A round is a task of the week the overview shows (section 4.5): a
    // reminder for every daily round would bury what else is due.
    expect(roundDue).toMatchObject({
      source: 'round_plan',
      intervalDays: null,
      intervalMonths: null,
      leadDays: 14,
      responsible: 'lead',
      actions: ['activity'],
    })
  })
})
