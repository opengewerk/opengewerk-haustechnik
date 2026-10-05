import { describe, expect, it } from 'vitest'

import { statesOn } from './asset-records.js'

/**
 * The state every asset is in on a day, from the entries of the life cycles a
 * device holds (#86, ADR 0002, point 7).
 */

const entry = (assetId: string, state: string, validFrom: string) => ({ assetId, state, validFrom })

describe('the state of the assets on a day', () => {
  it('is the entry with the latest first day up to that day', () => {
    const states = statesOn(
      [
        // Not in the order of their days.
        entry('boiler', 'out_of_service', '2026-03-01'),
        entry('boiler', 'planned', '2019-05-01'),
        entry('boiler', 'in_service', '2020-01-01'),
      ],
      '2026-10-05',
    )

    expect([...states]).toEqual([['boiler', 'out_of_service']])
  })

  it('counts an entry from its first day on, that day included', () => {
    const entries = [
      entry('boiler', 'in_service', '2020-01-01'),
      entry('boiler', 'out_of_service', '2026-10-05'),
    ]

    expect(statesOn(entries, '2026-10-04').get('boiler')).toBe('in_service')
    expect(statesOn(entries, '2026-10-05').get('boiler')).toBe('out_of_service')
  })

  it('leaves what lies ahead for the day it begins', () => {
    const states = statesOn(
      [
        entry('boiler', 'in_service', '2020-01-01'),
        entry('boiler', 'decommissioned', '2027-01-01'),
      ],
      '2026-10-05',
    )

    expect(states.get('boiler')).toBe('in_service')
  })

  it('has nothing for an asset whose first entry lies ahead, and nothing for one without an entry', () => {
    const states = statesOn([entry('pump', 'planned', '2027-01-01')], '2026-10-05')

    expect(states.has('pump')).toBe(false)
    expect(states.has('boiler')).toBe(false)
    expect(states.size).toBe(0)
  })

  it('answers for each asset by its own entries', () => {
    const states = statesOn(
      [
        entry('boiler', 'in_service', '2020-01-01'),
        entry('meter', 'in_service', '2020-01-01'),
        entry('meter', 'removed', '2026-01-01'),
        entry('pump', 'planned', '2026-09-01'),
      ],
      '2026-10-05',
    )

    expect(Object.fromEntries(states)).toEqual({
      boiler: 'in_service',
      meter: 'removed',
      pump: 'planned',
    })
  })

  // A device may run a version behind the server: a state it has no word for
  // is passed over, and the one before it stays.
  it('passes over a state this version does not know', () => {
    const states = statesOn(
      [entry('boiler', 'in_service', '2020-01-01'), entry('boiler', 'mothballed', '2026-01-01')],
      '2026-10-05',
    )

    expect(states.get('boiler')).toBe('in_service')
  })
})
