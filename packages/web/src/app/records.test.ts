import { type SyncConflict, syncEntities, syncPolicies } from '@opengewerk/haustechnik-domain'
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
    expect(records.titleOf('meter_readings', { readOn: '2026-10-10' })).toBe(
      'Zählerstand vom 10.10.2026',
    )
    // A document by its name, a version by its file, as a conflict about a
    // file that never arrived names it.
    expect(records.titleOf('attachments', { title: 'Schaltplan Heizraum' })).toBe(
      'Schaltplan Heizraum',
    )
    expect(records.titleOf('attachment_versions', { fileName: 'schaltplan.pdf' })).toBe(
      'schaltplan.pdf',
    )
    expect(records.titleOf('attachment_versions', null)).toBe('Fassung eines Dokuments')
    expect(records.entityLabel('attachments')).toBe('Dokument')
    expect(records.fieldLabel('sha256')).toBe('Prüfsumme')
  })

  it('write the value of a list in its words, the kinds of a building out of their text', () => {
    expect(records.valueText('status', 'started')).toBe('Begonnen')
    expect(records.valueText('status', 'remedied')).toBe('Behoben')
    expect(records.valueText('kind', 'fault')).toBe('Störung')
    expect(records.valueText('kind', 'circuit_diagram')).toBe('Schaltplan')
    expect(records.valueText('kind', 'probe.elevator')).toBeNull()
    expect(records.valueText('kinds', '["school","office"]')).toBe(
      'Schule oder Hochschule, Büro- und Verwaltungsgebäude',
    )
    expect(records.valueText('title', 'Rundgang')).toBeNull()
    expect(records.valueText('status', 4)).toBeNull()
  })
})

describe('a conflict about a record nobody changes', () => {
  it('says what to do instead of offering the version of the device, for every kind a device makes (#79)', () => {
    const neverChanged = syncEntities.filter(
      (entity) => syncPolicies[entity]?.create === true && syncPolicies[entity].change === 'never',
    )
    const at = new Date('2026-10-10T08:00:00.000Z')
    const answered = (entity: string) => {
      const conflict = {
        id: `c-${entity}`,
        operationId: `op-${entity}`,
        entity,
        recordId: 'r-1',
        reason: 'changed_elsewhere',
        fields: [],
        wanted: {},
        seen: {},
        found: {},
        deviceId: 'phone',
        recordedAt: at,
        resolvedAt: null,
        createdAt: at,
        updatedAt: at,
      } as unknown as SyncConflict

      return (
        Object.hasOwn(records.settledElsewhere, entity) ||
        records.ownDecision?.(conflict, [conflict]) !== undefined
      )
    }

    expect([...neverChanged].sort()).toEqual([
      'activity_signatures',
      'attachment_versions',
      'meter_readings',
      'work_order_notes',
    ])
    expect(neverChanged.filter((entity) => !answered(entity))).toEqual([])
  })
})
