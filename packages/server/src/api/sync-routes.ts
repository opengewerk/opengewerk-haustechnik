import {
  type Catalogue,
  type Identity,
  offlineEditRefusal,
  offlineRules,
  type Operation,
  type OperationKind,
  type Right,
} from '@opengewerk/haustechnik-domain'
import type { SyncRoutes } from '@opengewerk/platform-server'

import { syncFor } from '../sync/sync.js'
import { answerFor } from './database-errors.js'

// The routes a device syncs through are the foundation's (ADR 0010 in the
// repository opengewerk): reading an outbox, refusing one over an operation
// and naming it, the pull and the conflicts. What this application hands them
// is in here: its sync, the right each operation asks for, and its words for
// a refusal of the database.

/**
 * The rights an operation on a kind of record asks for (section 7 of the
 * concept): what making one takes, what a change within the fields a device
 * may write without a connection takes, and what removing one takes where a
 * device may remove it at all. Everything else asks for the right the routes
 * of the office ask for it, so that the answer to an operation a device may
 * not send is the conflict `online_only` about that one operation and not a
 * transmission refused over a missing right.
 */
interface OperationRights {
  readonly create?: Right
  readonly change?: Right
  readonly remove?: Right
  readonly otherwise: Right
}

/**
 * Per kind of record. Taking stock on site is "aufnehmen" and the work on an
 * activity "ausführen"; the structure of the properties, the life cycle and
 * the moving of an asset, the register of duties and the plan of an activity
 * are what the office does, with a connection (ADR 0006, point 6). A work
 * order made on site is one handed out, which the Objektleitung does; a
 * defect is reported by whoever finds it.
 */
export const operationRights: Readonly<Record<string, OperationRights>> = {
  properties: { otherwise: 'location.write' },
  buildings: { otherwise: 'location.write' },
  floors: { otherwise: 'location.write' },
  rooms: { create: 'room.record', change: 'room.record', otherwise: 'location.write' },
  assets: { create: 'asset.record', change: 'asset.record', otherwise: 'asset.write' },
  asset_lifecycle: { otherwise: 'asset.write' },
  asset_supplies: { create: 'asset.record', remove: 'asset.record', otherwise: 'asset.record' },
  duties: { otherwise: 'duty.write' },
  duty_dismissals: { otherwise: 'duty.write' },
  activities: { create: 'activity.write', change: 'activity.perform', otherwise: 'activity.write' },
  activity_duties: { change: 'activity.perform', otherwise: 'activity.write' },
  work_orders: { create: 'activity.write', otherwise: 'activity.write' },
  defects: { create: 'defect.report', change: 'defect.report', otherwise: 'defect.write' },
  activity_signatures: { otherwise: 'activity.perform' },
  work_order_decisions: { otherwise: 'activity.accept' },
}

/**
 * What an operation needs beyond the right to sync at all, or nothing for an
 * entity this application does not sync, which refuses the transmission with
 * the operation named.
 *
 * Sending a queue is a different way in, not a different thing to do: whoever
 * may not change a room's floor at its route may not change it through an
 * outbox either. The narrowest right that covers the operation, which is the
 * narrow one of its kind when the operation stays within what a device may
 * write without a connection, and the right of the office otherwise.
 */
export function permissionFor(
  entity: string,
  kind: OperationKind,
  patches: Operation['patches'] = [],
): Right | null {
  const rights = Object.hasOwn(operationRights, entity) ? operationRights[entity] : undefined

  if (!rights) {
    return null
  }

  const narrow =
    kind === 'create' ? rights.create : kind === 'delete' ? rights.remove : rights.change
  // A field the server writes is answered by the merge, as `set_by_server`
  // about this one operation; counted here, it would ask the right of the
  // office and refuse the whole transmission of whoever lacks it.
  const written = patches.filter((patch) => !offlineRules.isSetByServer(entity, patch.field))
  const offline = offlineEditRefusal({ entity, kind, patches: written }) === null

  return narrow && offline ? narrow : rights.otherwise
}

/**
 * The routes of the sync of this application, with the catalogue the asset
 * kinds come from. Every device holds everything of its tenant that its
 * person sees in the database, by area; the choice per device by what the
 * person works on arrives with the second part of #27 (ADR 0006, point 1).
 */
export function syncRoutesFor(catalogue: Catalogue): SyncRoutes<Identity, Right> {
  return { sync: syncFor(catalogue), permissionFor, answerFor }
}
