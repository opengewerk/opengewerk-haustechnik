import { keptByTheServer, type Operation } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  offlineEditRefusal,
  offlineEdits,
  offlineRules,
  syncEntities,
  syncEntityNames,
  syncFieldNames,
  syncPolicies,
} from './sync.js'

// What travels between the devices and the server of this application, and
// what a device may do with it without a network (ADR 0006, point 6). The
// mechanism is the foundation's (ADR 0010); the list is this application's.

function operation(
  entity: string,
  kind: Operation['kind'],
  values: Readonly<Record<string, string | number | boolean | null>> = {},
): Operation {
  return {
    id: '01929c5e-7a3b-7c00-8000-000000000001' as Operation['id'],
    entity,
    recordId: '01929c5e-7a3b-7c00-8000-000000000002',
    kind,
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date('2026-10-04T08:00:00Z'),
    deviceId: 'probe-phone',
  }
}

describe('the policies of the sync', () => {
  it('hold the table of ADR 0006: who may create and change what without a connection', () => {
    const table = Object.fromEntries(
      syncEntities.map((entity) => {
        const policy = syncPolicies[entity]

        return [entity, [policy?.create, policy?.change]]
      }),
    )

    expect(table).toEqual({
      properties: [false, 'never'],
      buildings: [false, 'never'],
      floors: [false, 'never'],
      // Kept with the property they hang on (addendum of 05.10.2026).
      contacts: [false, 'never'],
      // Entered by whoever plans the rounds, with a connection (second
      // addendum of 05.10.2026).
      building_closures: [false, 'never'],
      // The templates of the rounds and their versions, kept in the office (#112).
      round_templates: [false, 'never'],
      round_template_versions: [false, 'never'],
      // The plans of the rounds, kept by whoever plans (#113).
      round_plans: [false, 'never'],
      rooms: [true, 'merge'],
      assets: [true, 'merge'],
      asset_lifecycle: [false, 'never'],
      asset_supplies: [true, 'merge'],
      duties: [false, 'never'],
      duty_dismissals: [false, 'never'],
      activities: [true, 'merge'],
      activity_duties: [false, 'merge'],
      // "Antwort eines Punkts: ja, ja bis zur Unterschrift" (#106).
      activity_answers: [true, 'merge'],
      // The time spent on an order is said on site, until the signature (#118).
      work_orders: [true, 'merge'],
      defects: [true, 'merge'],
      activity_signatures: [true, 'never'],
      work_order_decisions: [false, 'never'],
      // Who works on an order is handed out in the office (addendum of 08.10.2026, #73).
      work_order_participants: [false, 'never'],
      // "Notiz an einem Vorgang: ja, nie" (#118).
      work_order_notes: [true, 'never'],
      // Filed in the office and on site, a photo also without a connection
      // (addendum of 06.10.2026); a version is made and never changed.
      attachments: [true, 'merge'],
      attachment_versions: [true, 'never'],
      // Made and blocked in the office; a device reads them for a scan.
      labels: [false, 'merge'],
    })
  })

  it('reserve what the server works out: the area of every row, the numbers, and a place that follows', () => {
    for (const entity of syncEntities) {
      const policy = syncPolicies[entity]

      // A version of a document carries no area: it is a part of its
      // document and is seen with it (ADR 0003, addendum of #97).
      if (entity !== 'attachment_versions' && (policy?.create || policy?.change === 'merge')) {
        expect(policy.reserved, entity).toContain('areaId')
      }
    }

    expect(syncPolicies['attachment_versions']?.reserved).toEqual(['createdBy'])

    expect(syncPolicies['assets']?.reserved).toEqual(
      expect.arrayContaining(['number', 'propertyId']),
    )
    expect(syncPolicies['work_orders']?.reserved).toEqual(
      expect.arrayContaining(['number', 'activityKind', 'propertyId']),
    )
    expect(syncPolicies['rooms']?.reserved).toEqual(
      expect.arrayContaining(['buildingId', 'propertyId']),
    )
  })

  it('leave the property to a device where a record names its place itself', () => {
    // An activity and a defect hang on the property itself or on one place
    // there (ADR 0002, point 10); which property, only the device knows.
    expect(syncPolicies['activities']?.reserved).not.toContain('propertyId')
    expect(syncPolicies['defects']?.reserved).not.toContain('propertyId')
    // The form an activity is filled in, the day of the protocol it took as its
    // template (#108), the plan that made a round (#113), and the answer a
    // defect came of (#106).
    expect(syncPolicies['activities']?.reserved).toEqual(
      expect.arrayContaining(['formKey', 'formVersion', 'templateOn', 'roundPlanId']),
    )
    expect(syncPolicies['defects']?.reserved).toContain('foundInAnswerId')
  })

  it('let a device give a label from a sheet to an asset while it is not blocked, and nothing else about a label', () => {
    expect(syncPolicies['labels']).toEqual({
      create: false,
      change: 'merge',
      onlyWhile: { field: 'blockedAt', values: [null] },
      reserved: ['code', 'propertyId', 'areaId'],
    })
    expect(offlineEdits['labels']).toEqual({ change: { assetId: true } })
  })

  it('keep a result to the time before the signature, and a signed activity to the office', () => {
    expect(syncPolicies['activities']?.onlyWhile).toEqual({
      field: 'status',
      values: ['open', 'started'],
    })
    expect(syncPolicies['activity_duties']?.gateFrom).toMatchObject({
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: ['open', 'started'],
    })
  })

  it('take an answer, a change of it and its removal while the work goes on, and none once signed', () => {
    expect(syncPolicies['activity_answers']?.reserved).toEqual(['propertyId', 'areaId'])

    const given = {
      ...operation('activity_answers', 'create'),
      patches: [{ field: 'activityId', from: null, to: 'a' }],
    }
    const changed = {
      ...operation('activity_answers', 'update'),
      patches: [{ field: 'remark', from: null, to: 'Lose.' }],
    }
    const row = { id: 'r', activityId: 'a', remark: null, version: 1, deletedAt: null }

    for (const [status, outcome] of [
      ['open', 'apply'],
      ['started', 'apply'],
      ['signed', 'conflict'],
      ['done', 'conflict'],
      ['not_performed', 'conflict'],
    ] as const) {
      const activity = { id: 'a', status, deletedAt: null }

      expect(offlineRules.decideMerge(given, null, activity).outcome, status).toBe(outcome)
      expect(offlineRules.decideMerge(changed, row, activity).outcome, status).toBe(outcome)
    }

    expect(
      offlineEditRefusal(operation('activity_answers', 'update', { fieldKey: 'other' })),
    ).toEqual(['fieldKey'])
    expect(offlineEditRefusal(operation('activity_answers', 'delete'))).toBeNull()
  })

  it('take a signature while the work goes on and once signed, in the name of whoever is signed in', () => {
    // The countersignature comes after the signature (ADR 0004, point 8).
    expect(syncPolicies['activity_signatures']?.gateFrom).toEqual({
      reference: 'activityId',
      entity: 'activities',
      field: 'status',
      values: ['open', 'started', 'signed'],
    })
    expect(syncPolicies['activity_signatures']?.reserved).toEqual(
      expect.arrayContaining(['propertyId', 'areaId', 'signedBy']),
    )

    const signature = {
      ...operation('activity_signatures', 'create'),
      patches: [{ field: 'activityId', from: null, to: 'a' }],
    }

    for (const [status, outcome] of [
      ['started', 'apply'],
      ['signed', 'apply'],
      ['done', 'conflict'],
      ['not_performed', 'conflict'],
    ] as const) {
      expect(
        offlineRules.decideMerge(signature, null, { id: 'a', status, deletedAt: null }).outcome,
        status,
      ).toBe(outcome)
    }
  })

  it('let a device change an activity it made before the server has answered', () => {
    // What the device holds of it: the create, with the state it named.
    const created = { id: 'a', status: 'open', deletedAt: null }

    expect(
      offlineRules.decideMerge(
        {
          ...operation('activities', 'update'),
          patches: [{ field: 'status', from: 'open', to: 'started' }],
        },
        created,
      ),
    ).toMatchObject({ outcome: 'apply' })
  })
})

describe('what a device writes without a connection', () => {
  it('names fields only of records it may create or change, and none the server writes', () => {
    for (const [entity, edits] of Object.entries(offlineEdits)) {
      const policy = syncPolicies[entity]

      expect(policy, entity).toBeDefined()

      if (edits.create) {
        expect(policy?.create, `${entity} create`).toBe(true)
      }

      if (edits.change || edits.remove) {
        expect(policy?.change, `${entity} change`).toBe('merge')
      }

      for (const field of [
        ...Object.keys(edits.create ?? {}),
        ...Object.keys(edits.change ?? {}),
      ]) {
        expect(policy?.reserved ?? [], `${entity}.${field}`).not.toContain(field)
        expect(keptByTheServer, `${entity}.${field}`).not.toContain(field)
      }
    }
  })

  it('takes a room on its floor and its name, and leaves moving and removing it to the office', () => {
    expect(
      offlineEditRefusal(operation('rooms', 'create', { floorId: 'f', number: '0.12' })),
    ).toBeNull()
    expect(offlineEditRefusal(operation('rooms', 'update', { name: 'Heizraum' }))).toBeNull()
    expect(offlineEditRefusal(operation('rooms', 'update', { floorId: 'f' }))).toEqual(['floorId'])
    expect(offlineEditRefusal(operation('rooms', 'delete'))).toEqual([])
  })

  it('takes an asset with what is known about it, and leaves moving it to the office', () => {
    expect(
      offlineEditRefusal(
        operation('assets', 'create', {
          buildingId: 'b',
          kind: 'probe.elevator',
          name: 'Aufzug Haus A',
          values: '{"stops":4}',
        }),
      ),
    ).toBeNull()
    expect(offlineEditRefusal(operation('assets', 'update', { serialNumber: 'X-1' }))).toBeNull()
    expect(
      offlineEditRefusal(operation('assets', 'update', { roomId: 'r', buildingId: 'b' })),
    ).toEqual(['roomId', 'buildingId'])
  })

  it('adds and takes away what an asset supplies, and changes no entry in place', () => {
    expect(
      offlineEditRefusal(operation('asset_supplies', 'create', { assetId: 'a', roomId: 'r' })),
    ).toBeNull()
    expect(offlineEditRefusal(operation('asset_supplies', 'delete'))).toBeNull()
    expect(offlineEditRefusal(operation('asset_supplies', 'update', { roomId: 'r' }))).toEqual([
      'roomId',
    ])
  })

  it('makes a work order on site and nothing planned, and takes its progress and no plan', () => {
    expect(
      offlineEditRefusal(
        operation('activities', 'create', {
          kind: 'work_order',
          title: 'Heizung kalt',
          status: 'open',
          propertyId: 'p',
          roomId: 'r',
        }),
      ),
    ).toBeNull()
    expect(offlineEditRefusal(operation('activities', 'create', { kind: 'round' }))).toEqual([
      'kind',
    ])
    expect(
      offlineEditRefusal(
        operation('activities', 'update', { status: 'started', performedOn: '2026-10-04' }),
      ),
    ).toBeNull()
    expect(
      offlineEditRefusal(
        operation('activities', 'update', { status: 'done', dueOn: '2026-10-09' }),
      ),
    ).toEqual(['status', 'dueOn'])
    expect(
      offlineEditRefusal(operation('activities', 'update', { responsibleUserId: 'u' })),
    ).toEqual(['responsibleUserId'])
  })

  it('takes the result of a duty, a fault and a defect with its remark, and no status of a defect', () => {
    expect(
      offlineEditRefusal(operation('activity_duties', 'update', { result: 'passed' })),
    ).toBeNull()
    expect(offlineEditRefusal(operation('activity_duties', 'update', { dutyId: 'd' }))).toEqual([
      'dutyId',
    ])
    expect(
      offlineEditRefusal(operation('work_orders', 'create', { activityId: 'a', kind: 'fault' })),
    ).toBeNull()
    expect(
      offlineEditRefusal(operation('work_orders', 'create', { activityId: 'a', kind: 'other' })),
    ).toEqual(['kind'])
    expect(
      offlineEditRefusal(
        operation('defects', 'create', {
          description: 'Tür schließt nicht',
          foundOn: '2026-10-04',
          propertyId: 'p',
        }),
      ),
    ).toBeNull()
    expect(
      offlineEditRefusal(operation('defects', 'update', { description: 'Tür klemmt' })),
    ).toBeNull()
    expect(offlineEditRefusal(operation('defects', 'update', { status: 'remedied' }))).toEqual([
      'status',
    ])
  })

  it('leaves a record without an entry to its policy', () => {
    expect(offlineEditRefusal(operation('properties', 'update', { name: 'Campus' }))).toBeNull()
    expect(offlineEditRefusal(operation('constructor', 'create', { name: 'x' }))).toBeNull()
  })
})

describe('the names of the sync', () => {
  it('name every kind of record a device exchanges', () => {
    expect(syncEntities.filter((entity) => !Object.hasOwn(syncEntityNames, entity))).toEqual([])
  })

  it('name every field a device may write without a connection', () => {
    const fields = Object.values(offlineEdits).flatMap((edits) => [
      ...Object.keys(edits.create ?? {}),
      ...Object.keys(edits.change ?? {}),
    ])

    expect(fields.filter((field) => !Object.hasOwn(syncFieldNames, field))).toEqual([])
  })
})
