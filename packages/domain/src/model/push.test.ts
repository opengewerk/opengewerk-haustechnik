import { describe, expect, it } from 'vitest'

import { isPushOccasion, pushEntries, pushOccasions, pushOccasionWords } from './push.js'

/**
 * The occasions a person gets as push (#126). Section 3 of the concept names
 * six occasions; the account offers five choices, because a round that waits
 * for its countersignature and a work order that waits for its acceptance
 * wait for the same person in the same way.
 */

describe('the occasions of push', () => {
  it('are these five, in the order the account lists them', () => {
    expect(pushOccasions).toEqual([
      'deadline_due',
      'assigned',
      'task_due',
      'waiting',
      'work_order_rejected',
    ])
  })

  it('have words for each, and no two share a name', () => {
    const labels = pushOccasions.map((occasion) => pushOccasionWords[occasion].label)

    expect(labels).toEqual([
      'Fristen',
      'Zuteilungen',
      'Fällige Aufgaben',
      'Wartet auf Gegenzeichnung oder Abnahme',
      'Zurückgewiesene Aufträge',
    ])
    expect(pushOccasions.filter((occasion) => pushOccasionWords[occasion].about === '')).toEqual([])
  })

  it('are told from anything else a request may name', () => {
    expect(isPushOccasion('waiting')).toBe(true)
    expect(isPushOccasion('test')).toBe(false)
    expect(isPushOccasion(null)).toBe(false)
  })
})

describe('where a device opens the application', () => {
  it('is the office or the site', () => {
    expect(pushEntries).toEqual(['office', 'site'])
  })
})
