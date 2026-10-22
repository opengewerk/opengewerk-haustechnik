import type {
  ActivityId,
  Catalogue,
  ContractorId,
  Identity,
  ServiceReportId,
  SignatureRole,
  WorkOrderMaterialId,
} from '@opengewerk/haustechnik-domain'
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
import { bookWithdrawal } from '../activities/materials.js'
import { checkServiceReport, freezeServiceReport } from '../activities/service-reports.js'
import { checkBriefing, checkWorkPermit } from '../activities/visits.js'

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
  // The office gave the order to somebody else while the device was away.
  person: () => ({ kind: 'conflict', reason: 'changed_elsewhere', fields: ['activityId'] }),
}

/**
 * A signature from a device, checked against the activity as the server holds
 * it, with the catalogue the form of the activity comes from: a point without
 * its answer is a mistake the form asks about, like a missing result.
 */
export function signed(catalogue: Catalogue): SyncCheck<Sender> {
  return async ({ tx, tenantId, operation, values, sender }) => {
    if (operation.entity !== 'activity_signatures' || operation.kind !== 'create') {
      return null
    }

    try {
      await checkSignature(
        tx,
        tenantId,
        {
          signedBy: sender.userId,
          accountName: sender.nameOf(sender.userId),
          activityId: values['activityId'] as ActivityId,
          role: values['role'] as SignatureRole,
          signedAt: new Date(String(values['signedAt'] ?? '')),
          deviceInfo: (values['deviceInfo'] ?? null) as string | null,
          path: (values['path'] ?? null) as string | null,
          typedName: (values['typedName'] ?? null) as string | null,
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
 * The client's signature under a service report from a device (#324),
 * checked against the work order as the server holds it, as a signature is:
 * a report of another shape is a mistake its form asks about, and what
 * changed while the device was away is a conflict about this one operation.
 */
export const reported: SyncCheck<Sender> = async ({ tx, tenantId, operation, values, sender }) => {
  if (operation.entity !== 'service_reports' || operation.kind !== 'create') {
    return null
  }

  try {
    await checkServiceReport(tx, tenantId, {
      signedBy: sender.userId,
      activityId: values['activityId'] as ActivityId,
      clientName: String(values['clientName'] ?? ''),
      path: (values['path'] ?? null) as string | null,
      signedAt: new Date(String(values['signedAt'] ?? '')),
      deviceInfo: (values['deviceInfo'] ?? null) as string | null,
      pageFingerprint: String(values['pageFingerprint'] ?? ''),
    })

    return null
  } catch (error) {
    if (error instanceof SigningRefusal) {
      // A report out of its turn is one for an order that has one already:
      // the conflict is about the order, a report has no role.
      return error.about === 'turn'
        ? { kind: 'conflict', reason: 'changed_elsewhere', fields: ['activityId'] }
        : answers[error.about](error.message)
    }

    throw error
  }
}

/** A value of JSON as a device sends it, as text: read out of it, or left as it came where it is none. */
function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/**
 * A briefing or a permit for hot work from a device (#330), checked against
 * the work order as the server holds it, with the catalogue the form of a
 * permit comes from: one of another shape or with a field left empty is a
 * mistake its form asks about, and what changed while the device was away,
 * the order closed or given to another firm or person, is a conflict about
 * this one operation.
 */
export function visited(catalogue: Catalogue): SyncCheck<Sender> {
  return async ({ tx, tenantId, operation, values, sender }) => {
    if (
      (operation.entity !== 'briefings' && operation.entity !== 'work_permits') ||
      operation.kind !== 'create'
    ) {
      return null
    }

    const shared = {
      signedBy: sender.userId,
      rights: sender.rights,
      activityId: values['activityId'] as ActivityId,
      contractorId: values['contractorId'] as ContractorId,
      signedAt: new Date(String(values['signedAt'] ?? '')),
      deviceInfo: (values['deviceInfo'] ?? null) as string | null,
    }

    try {
      await (operation.entity === 'briefings'
        ? checkBriefing(tx, tenantId, {
            ...shared,
            personName: String(values['personName'] ?? ''),
            subject: String(values['subject'] ?? ''),
            path: (values['path'] ?? null) as string | null,
            pageFingerprint: values['pageFingerprint'],
          })
        : checkWorkPermit(tx, tenantId, catalogue, {
            ...shared,
            formKey: String(values['formKey'] ?? ''),
            formVersion: Number(values['formVersion']),
            answers: jsonOf(values['answers']),
          }))

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
    if (operation.kind !== 'create') {
      return
    }

    // A service report is frozen the moment it is written (#324).
    if (operation.entity === 'service_reports') {
      await freezeServiceReport(
        tx,
        { tenantId, writtenBy: sender.userId, at: new Date(), catalogue, nameOf: sender.nameOf },
        operation.recordId as ServiceReportId,
      )

      return
    }

    // Material taken for a work order is booked in its store at once (#326).
    if (operation.entity === 'work_order_materials') {
      await bookWithdrawal(tx, tenantId, operation.recordId as WorkOrderMaterialId)

      return
    }

    if (operation.entity !== 'activity_signatures') {
      return
    }

    await followSignature(
      tx,
      { tenantId, writtenBy: sender.userId, at: new Date(), catalogue, nameOf: sender.nameOf },
      values['activityId'] as ActivityId,
    )
  }
}
