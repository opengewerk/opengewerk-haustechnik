import type { ActivityId, Catalogue, Identity, SignatureRole } from '@opengewerk/haustechnik-domain'
import type {
  FoundIdentity,
  SyncCheck,
  SyncCheckContext,
  SyncRefusal,
} from '@opengewerk/platform-server'

import {
  checkSignature,
  followSignature,
  SigningRefusal,
  type SigningRefusalAbout,
} from '../activities/signing.js'

// A signature given on a device, also without a connection (ADR 0004, points
// 10 and 11). It travels as a record of its own, and the server checks it
// before the database does, as `takeSignature` checks one given over a
// route; once it is written, the server writes what comes of it in the same
// transaction, the evidence when every signature the activity calls for is
// there. What the device signed is never moved onto another page: a server
// whose page is another one answers with a conflict about that one operation.

/**
 * Whoever sent a transmission, as this application's sync is told it: the
 * identity of the request, and the names of the people of the operator, which
 * an evidence freezes. Accounts are read on the instance and never inside a
 * tenant, so the names are read before the transaction (`senderOf` in
 * `api/sync-routes.ts`).
 */
export type Sender = FoundIdentity<Identity> & {
  /** The name of a person of the operator; read for a transmission with a signature in it. */
  readonly nameOf: (userId: string) => string
}

/**
 * The answer to a refusal of a signature from a device, by what it is about:
 * a signature of another shape, or one for a page without its day, a result
 * or the answer to a point, is a mistake its form asks about before anything
 * is queued, and
 * refuses the transmission with its sentence; an activity gone or closed, a
 * page that is not the one the server works out and a signature out of its
 * turn are what changed while the device was away, a conflict about this one
 * operation (point 11).
 */
const answers: Readonly<Record<SigningRefusalAbout, (sentence: string) => SyncRefusal>> = {
  signature: (sentence) => ({ kind: 'client', message: sentence }),
  activity: () => ({ kind: 'conflict', reason: 'record_missing', fields: ['activityId'] }),
  closed: () => ({ kind: 'conflict', reason: 'record_is_fixed', fields: ['activityId'] }),
  page: () => ({ kind: 'conflict', reason: 'changed_elsewhere', fields: ['pageFingerprint'] }),
  turn: () => ({ kind: 'conflict', reason: 'changed_elsewhere', fields: ['role'] }),
}

/**
 * A signature from a device, checked against the activity as the server holds
 * it, with the catalogue the form of the activity comes from: a point without
 * its answer is a mistake the form asks about, like a missing result.
 */
export function signed(catalogue: Catalogue): SyncCheck<Sender> {
  return async ({ tx, tenantId, operation, values }) => {
    if (operation.entity !== 'activity_signatures' || operation.kind !== 'create') {
      return null
    }

    try {
      await checkSignature(
        tx,
        tenantId,
        {
          activityId: values['activityId'] as ActivityId,
          role: values['role'] as SignatureRole,
          deviceInfo: (values['deviceInfo'] ?? null) as string | null,
          path: String(values['path'] ?? ''),
          pageFingerprint: String(values['pageFingerprint'] ?? ''),
        },
        catalogue,
      )

      return null
    } catch (error) {
      if (error instanceof SigningRefusal) {
        return answers[error.about](error.message)
      }

      throw error
    }
  }
}

/**
 * What follows a signature from a device once it is written, with the
 * catalogue the kinds of duty come from: the activity written down when every
 * signature it calls for is there, and its state, in the name of whoever sent
 * the signature.
 */
export function followed(
  catalogue: Catalogue,
): (context: SyncCheckContext<Sender>) => Promise<void> {
  return async ({ tx, tenantId, operation, values, sender }) => {
    if (operation.entity !== 'activity_signatures' || operation.kind !== 'create') {
      return
    }

    await followSignature(
      tx,
      { tenantId, writtenBy: sender.userId, at: new Date(), catalogue, nameOf: sender.nameOf },
      values['activityId'] as ActivityId,
    )
  }
}
