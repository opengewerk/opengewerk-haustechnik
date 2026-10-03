import { describe, expect, it } from 'vitest'

import { records } from './records.js'

/**
 * What a conflict says about a record of this application (#27): the names
 * of the records and fields from `domain`, the name a record goes by, and
 * the words of a value of a list.
 */
describe('the words of a conflict', () => {
  it('name a kind of record and a field, and show a name nobody knows as it is', () => {
    expect(records.entityLabel('activity_duties')).toBe('Pflicht eines Vorgangs')
    expect(records.fieldLabel('floorId')).toBe('Geschoss')
    expect(records.entityLabel('constructor')).toBe('constructor')
    expect(records.fieldLabel('toString')).toBe('toString')
  })

  it('name a record by its first field that says something, and by its kind without one', () => {
    expect(records.titleOf('rooms', { number: null, name: 'Heizraum' })).toBe('Heizraum')
    expect(records.titleOf('rooms', { number: '0.12', name: 'Heizraum' })).toBe('0.12')
    expect(records.titleOf('rooms', { number: ' ', name: 'Heizraum' })).toBe('Heizraum')
    expect(records.titleOf('work_orders', { number: null })).toBe('Arbeitsauftrag')
    expect(records.titleOf('defects', null)).toBe('Mangel')
  })

  it('write the value of a list in its words, the kinds of a building out of their text', () => {
    expect(records.valueText('status', 'started')).toBe('Begonnen')
    expect(records.valueText('status', 'remedied')).toBe('Behoben')
    expect(records.valueText('kind', 'fault')).toBe('Störung')
    expect(records.valueText('kind', 'probe.elevator')).toBeNull()
    expect(records.valueText('kinds', '["school","office"]')).toBe(
      'Schule oder Hochschule, Büro- und Verwaltungsgebäude',
    )
    expect(records.valueText('title', 'Rundgang')).toBeNull()
    expect(records.valueText('status', 4)).toBeNull()
  })
})
