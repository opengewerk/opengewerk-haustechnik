import {
  offlineEdits,
  offlineRules,
  type OfflineValues,
  rights,
  shippedRoles,
  syncEntities,
  syncFieldNames,
} from '@opengewerk/haustechnik-domain'
import { syncTables } from '@opengewerk/platform-server'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { operationRights, permissionFor } from '../api/sync-routes.js'
import * as schema from '../database/schema/index.js'

/**
 * The policies of the sync held against the schema (ADR 0006, point 6): a
 * table that carries the columns of the sync travels, so it has a policy, and
 * a policy names a table. What a device writes are columns of the table, each
 * with a name for a conflict, and each kind of operation asks for a right
 * the roles of section 7 of the concept give whoever does that work.
 */

const tables = syncTables(schema)

/** The tables the pull reads: those with the columns of the sync. */
const travelling = [...tables]
  .filter(([, table]) => 'changeSequence' in getTableColumns(table))
  .map(([entity]) => entity)

function rightsOf(role: string) {
  return shippedRoles.find((each) => each.key === role)?.rights ?? []
}

describe('the policies of the sync, against the schema', () => {
  it('give every table that travels a policy, and every policy a table that travels', () => {
    expect([...travelling].sort()).toEqual([...syncEntities].sort())
  })

  it('let a device write only columns its table has', () => {
    const unknown: string[] = []

    for (const [entity, edits] of Object.entries(offlineEdits)) {
      const table = tables.get(entity)
      const columns = table ? getTableColumns(table) : {}

      for (const field of [
        ...Object.keys(edits.create ?? {}),
        ...Object.keys(edits.change ?? {}),
      ]) {
        if (!(field in columns)) {
          unknown.push(`${entity}.${field}`)
        }
      }
    }

    expect(unknown).toEqual([])
  })

  it('name every field a device may write, on every kind of record', () => {
    const missing: string[] = []

    for (const entity of syncEntities) {
      const table = tables.get(entity)

      for (const field of Object.keys(table ? getTableColumns(table) : {})) {
        if (!offlineRules.isSetByServer(entity, field) && !Object.hasOwn(syncFieldNames, field)) {
          missing.push(`${entity}.${field}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})

describe('the rights of an operation', () => {
  it('name a right of the catalogue for every kind of record and every kind of operation', () => {
    expect(Object.keys(operationRights).sort()).toEqual([...syncEntities].sort())

    for (const entity of syncEntities) {
      for (const kind of ['create', 'update', 'delete'] as const) {
        expect(rights, `${entity} ${kind}`).toContain(permissionFor(entity, kind))
      }
    }
  })

  it('know no kind of record that does not travel', () => {
    expect(permissionFor('evidence', 'create')).toBeNull()
    expect(permissionFor('constructor', 'create')).toBeNull()
  })

  it('give whoever works on site what a device does there, and a work order to whoever hands one out', () => {
    const technician = rightsOf('technician')
    const site = rightsOf('site_management')
    const done: Record<string, Record<string, boolean>> = {}

    for (const [entity, edits] of Object.entries(offlineEdits)) {
      // Every field it may write, each with a value it may give.
      const asks = (kind: 'create' | 'update' | 'delete', fields = {}) =>
        permissionFor(
          entity,
          kind,
          Object.entries(fields as Readonly<Record<string, OfflineValues>>).map(
            ([field, values]) => ({
              field,
              from: null,
              to: values === true ? 'x' : (values[0] ?? null),
            }),
          ),
        )

      done[entity] = {
        ...(edits.create && {
          create: technician.includes(asks('create', edits.create) as never),
        }),
        ...(edits.change && {
          change: technician.includes(asks('update', edits.change) as never),
        }),
        ...(edits.remove && { remove: technician.includes(asks('delete') as never) }),
      }
    }

    // A fault found on site becomes a work order there, by whoever hands one out.
    expect(site).toContain(permissionFor('activities', 'create'))
    expect(site).toContain(permissionFor('work_orders', 'create'))

    expect(done).toEqual({
      rooms: { create: true, change: true },
      assets: { create: true, change: true },
      // A label from a sheet is given to an asset by whoever takes stock.
      labels: { change: true },
      asset_supplies: { create: true, remove: true },
      activities: { create: false, change: true },
      activity_duties: { change: true },
      work_orders: { create: false },
      defects: { create: true, change: true },
      activity_signatures: { create: true },
      // Filed and corrected by everybody, taken out of the records from the
      // Objektleitung on (section 7 of the concept).
      attachments: { create: true, change: true, remove: false },
      attachment_versions: { create: true },
    })
    expect(site).toContain(permissionFor('attachments', 'delete'))
  })

  it('ask for the right of the office once an operation leaves what a device may write', () => {
    const patch = (field: string, to: string) => [{ field, from: null, to }]

    expect(permissionFor('rooms', 'update', patch('name', 'Heizraum'))).toBe('room.record')
    expect(permissionFor('rooms', 'update', patch('floorId', 'f'))).toBe('location.write')
    expect(permissionFor('rooms', 'delete')).toBe('location.write')
    expect(permissionFor('assets', 'update', patch('roomId', 'r'))).toBe('asset.write')
    expect(permissionFor('activities', 'update', patch('status', 'started'))).toBe(
      'activity.perform',
    )
    expect(permissionFor('activities', 'update', patch('status', 'done'))).toBe('activity.write')
    expect(permissionFor('defects', 'update', patch('status', 'remedied'))).toBe('defect.write')
    // A document: filing it, a version and a correction are one right,
    // taking it out another, and moving it is nothing a device sends.
    expect(permissionFor('attachments', 'create', patch('title', 'Schaltplan'))).toBe(
      'document.record',
    )
    expect(permissionFor('attachments', 'update', patch('kind', 'concept'))).toBe('document.record')
    expect(permissionFor('attachments', 'delete')).toBe('document.remove')
    expect(permissionFor('attachments', 'update', patch('assetId', 'a'))).toBe('document.remove')
    expect(permissionFor('attachment_versions', 'create', patch('fileName', 'plan.pdf'))).toBe(
      'document.record',
    )
    expect(permissionFor('attachment_versions', 'delete')).toBe('document.remove')
    // A label is made and blocked at its routes: whatever an outbox says
    // about one asks for the right of those routes.
    expect(permissionFor('labels', 'create', patch('code', 'X'))).toBe('asset.record')
    expect(permissionFor('labels', 'update', patch('blockedAt', 'now'))).toBe('asset.record')
    // The signature is the work's, the countersignature the Objektleitung's.
    expect(permissionFor('activity_signatures', 'create', patch('role', 'signer'))).toBe(
      'activity.perform',
    )
    expect(permissionFor('activity_signatures', 'create', patch('role', 'countersigner'))).toBe(
      'activity.accept',
    )
  })

  it('leave a field the server writes to the merge, which answers it as set_by_server', () => {
    expect(
      permissionFor('assets', 'create', [
        { field: 'name', from: null, to: 'Aufzug' },
        { field: 'number', from: null, to: 'AN-00001' },
      ]),
    ).toBe('asset.record')
  })
})
