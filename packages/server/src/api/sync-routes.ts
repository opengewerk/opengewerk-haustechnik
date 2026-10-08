import {
  type Catalogue,
  type Identity,
  offlineEditRefusal,
  offlineRules,
  type Operation,
  type OperationKind,
  type Right,
} from '@opengewerk/haustechnik-domain'
import { BadRequestException, type HttpException } from '@nestjs/common'
import {
  accountsOf,
  type Database,
  type FoundIdentity,
  type SyncRoutes,
} from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'

import { SigningRefusal } from '../activities/signing.js'
import { EvidenceRefusal } from '../evidence/write.js'
import { deviceScope, pullScope } from '../sync/device-scope.js'
import type { Sender } from '../sync/signatures.js'
import { syncFor } from '../sync/sync.js'
import { answerFor as answerForTheDatabase } from './database-errors.js'

// The routes a device syncs through are the foundation's (ADR 0010 in the
// repository opengewerk): reading an outbox, refusing one over an operation
// and naming it, the pull and the conflicts. What this application hands them
// is in here: its sync, the right each operation asks for, its words for a
// refusal, what a device holds, and whoever sent a transmission, with the
// names an evidence freezes.

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
  /** What making one takes, by what it says where that decides. */
  readonly create?: Right | ((patches: Operation['patches']) => Right)
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
  // The people to talk to at a property are kept by whoever keeps the
  // properties, with a connection.
  contacts: { otherwise: 'location.write' },
  // The times a building is closed belong to the planning of the rounds.
  building_closures: { otherwise: 'activity.write' },
  rooms: { create: 'room.record', change: 'room.record', otherwise: 'location.write' },
  assets: { create: 'asset.record', change: 'asset.record', otherwise: 'asset.write' },
  asset_lifecycle: { otherwise: 'asset.write' },
  asset_supplies: { create: 'asset.record', remove: 'asset.record', otherwise: 'asset.record' },
  duties: { otherwise: 'duty.write' },
  duty_dismissals: { otherwise: 'duty.write' },
  activities: { create: 'activity.write', change: 'activity.perform', otherwise: 'activity.write' },
  activity_duties: { change: 'activity.perform', otherwise: 'activity.write' },
  // An answer to a point of the form is the work on the activity (#106).
  activity_answers: {
    create: 'activity.perform',
    change: 'activity.perform',
    remove: 'activity.perform',
    otherwise: 'activity.write',
  },
  work_orders: { create: 'activity.write', otherwise: 'activity.write' },
  defects: { create: 'defect.report', change: 'defect.report', otherwise: 'defect.write' },
  // The signature is the work's, the countersignature the Objektleitung's,
  // who accepts work orders and countersigns rounds (ADR 0004, addendum on the
  // signature, point 7).
  activity_signatures: {
    create: (patches) =>
      patches.some((patch) => patch.field === 'role' && patch.to === 'countersigner')
        ? 'activity.accept'
        : 'activity.perform',
    otherwise: 'activity.perform',
  },
  work_order_decisions: { otherwise: 'activity.accept' },
  // Filing a document and correcting its name and its kind is "ablegen"; so
  // is a new version, which is filed like a first one. Taking a document out
  // of the records is a right of its own, from the Objektleitung on (section
  // 7 of the concept), and what a device may not send at all asks for it too.
  attachments: {
    create: 'document.record',
    change: 'document.record',
    remove: 'document.remove',
    otherwise: 'document.remove',
  },
  attachment_versions: { create: 'document.record', otherwise: 'document.remove' },
  // A label is made and blocked at its routes, with a connection, by whoever
  // takes assets into the register, and the same right gives one from a sheet
  // to an asset on site.
  labels: { change: 'asset.record', otherwise: 'asset.record' },
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

  const creating = typeof rights.create === 'function' ? rights.create(patches) : rights.create
  const narrow = kind === 'create' ? creating : kind === 'delete' ? rights.remove : rights.change
  // A field the server writes is answered by the merge, as `set_by_server`
  // about this one operation; counted here, it would ask the right of the
  // office and refuse the whole transmission of whoever lacks it.
  const written = patches.filter((patch) => !offlineRules.isSetByServer(entity, patch.field))
  const offline = offlineEditRefusal({ entity, kind, patches: written }) === null

  return narrow && offline ? narrow : rights.otherwise
}

/**
 * The answer to what refuses a transmission over an operation: a signature or
 * an evidence that cannot be written refuses it with its sentence, naming the
 * operation, so that a device shows that one entry and a person can throw it
 * away (a kind of duty that takes no protocol, which the catalogue says and a
 * device does not foresee); a refusal of the database in the words of this
 * application.
 */
export function answerFor(error: unknown): HttpException {
  return error instanceof SigningRefusal || error instanceof EvidenceRefusal
    ? new BadRequestException(error.message)
    : answerForTheDatabase(error)
}

/** What stands for a person whose account is not there any more. */
const unknownAccount = 'Unbekanntes Konto'

/**
 * Whoever sent a transmission, read before its transaction: with a signature
 * in it, the names of the people of the operator, which an evidence freezes.
 * Accounts are read on the instance and never inside a tenant (`accountsOf`),
 * and only for the people a membership here names; the memberships first, in
 * the tenant, then their accounts. A transmission without a signature reads
 * nothing.
 */
async function senderOf(
  database: Database,
  identity: FoundIdentity<Identity>,
  operations: readonly Operation[],
): Promise<Sender> {
  if (!operations.some((operation) => operation.entity === 'activity_signatures')) {
    return { ...identity, nameOf: () => unknownAccount }
  }

  const members = await database.forTenant(
    { tenantId: identity.tenantId, userId: identity.userId, reason: 'sync' },
    (tx) => tx.select({ userId: memberships.userId }).from(memberships),
  )
  const accounts = await accountsOf(
    database,
    members.map((member) => member.userId),
    identity.userId,
  )

  return {
    ...identity,
    nameOf: (userId) => accounts.get(userId)?.name ?? unknownAccount,
  }
}

/**
 * The routes of the sync of this application, with the catalogue the asset
 * and duty kinds come from. A device holds what its person sees, by area, and
 * of that the part ADR 0006 gives it (`deviceScope`): the whole operator for
 * whoever sees every area, the places, their own activities and the open
 * defects for anybody else.
 */
export function syncRoutesFor(
  catalogue: Catalogue,
  database: Database,
): SyncRoutes<Identity, Right, Sender> {
  return {
    sync: syncFor(catalogue),
    permissionFor,
    answerFor,
    scope: async ({ tx, identity }) => pullScope(await deviceScope(tx, identity.userId)),
    senderOf: (identity, operations) => senderOf(database, identity, operations),
  }
}
