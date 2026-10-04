import {
  type Id,
  type IsoDate,
  longestSignaturePath,
  signaturePathIsValid,
  type Synced,
} from '@opengewerk/platform-domain'

import type { ActivityId, ActivityKind, WorkOrderId } from './activity.js'
import type { AreaId } from './area.js'
import type { EvidenceResult } from './evidence.js'
import { oneOf, type Problems } from './fields.js'
import type { PropertyId } from './location.js'

/**
 * Who a signature is given as (ADR 0004, points 7 and 8): the person who did
 * the work signs, and where a template asks for it the site management
 * countersigns (section 4.5 of the concept). Each has its own moment, and an
 * evidence that calls for both comes about with the second.
 */
export const signatureRoles = ['signer', 'countersigner'] as const

export type SignatureRole = (typeof signatureRoles)[number]

export const signatureRoleLabel: Readonly<Record<SignatureRole, string>> = {
  signer: 'Unterschrift',
  countersigner: 'Gegenzeichnung',
}

export type ActivitySignatureId = Id<'activity-signature'>
export type WorkOrderDecisionId = Id<'work-order-decision'>

/** The bounds of what a signature carries, the same on the device, the server and the database. */
export const signatureLimits = {
  deviceInfo: 500,
  decisionReason: 500,
} as const

/**
 * A signature on an activity (ADR 0004, point 7): a simple electronic
 * signature, bound to the account that is signed in, with the moment and the
 * device, the drawing, and the fingerprint of the page that was shown. It is
 * made on the device, also without a connection, and written once; nothing
 * changes or removes it, and a work order that is turned back leaves it
 * standing and no longer valid (section 4.8 of the concept).
 */
export interface ActivitySignature extends Synced {
  readonly id: ActivitySignatureId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly signedBy: string
  readonly role: SignatureRole
  /** The clock of the device at the moment the signature was confirmed. */
  readonly signedAt: Date
  readonly deviceInfo: string | null
  /** The drawing, as a path in the units of `signatureBox` of the foundation. */
  readonly path: string
  /** SHA-256 over the canonical form of the page that was shown, 64 hexadecimal digits. */
  readonly pageFingerprint: string
}

/** How a work order is taken back by whoever handed it out (section 4.8 of the concept). */
export const workOrderDecisionKinds = ['accepted', 'rejected'] as const

export type WorkOrderDecisionKind = (typeof workOrderDecisionKinds)[number]

export const workOrderDecisionLabel: Readonly<Record<WorkOrderDecisionKind, string>> = {
  accepted: 'Abgenommen',
  rejected: 'Zurückgewiesen',
}

/**
 * The acceptance of a signed work order or its rejection with the reason. A
 * rejection leaves the signature standing and makes it invalid; the work goes
 * on, and the order is signed again. Written once, like a signature.
 */
export interface WorkOrderDecision extends Synced {
  readonly id: WorkOrderDecisionId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly workOrderId: WorkOrderId
  readonly decision: WorkOrderDecisionKind
  readonly reason: string | null
  readonly decidedBy: string
  readonly decidedAt: Date
}

/**
 * The signatures that are valid (ADR 0004, points 7 and 8, section 4.8 of
 * the concept): those given for the page as it is now, and that no rejection
 * of the work order came after. A signature for another page does not count,
 * because something changed between showing and signing; a rejection makes
 * the signature before it invalid and leaves it standing. Both stay readable.
 *
 * Which came after which is told by the moment the server took each in
 * (`createdAt`) and not by the clock of a device, which may be wrong; the
 * server takes a decision only on a work order whose signature it holds.
 */
export function validSignatures<
  Signature extends Pick<ActivitySignature, 'pageFingerprint' | 'createdAt'>,
>(
  signatures: readonly Signature[],
  decisions: readonly Pick<WorkOrderDecision, 'decision' | 'createdAt'>[],
  pageFingerprint: string,
): Signature[] {
  const rejections = decisions
    .filter((decision) => decision.decision === 'rejected')
    .map((decision) => decision.createdAt.getTime())
  const lastRejection = rejections.length === 0 ? null : Math.max(...rejections)

  return signatures.filter(
    (signature) =>
      signature.pageFingerprint === pageFingerprint &&
      (lastRejection === null || signature.createdAt.getTime() > lastRejection),
  )
}

/**
 * Whether an activity has every signature it calls for: the signature, and
 * the countersignature where its template asks for one. A work order needs
 * its acceptance beside it before it comes to an evidence.
 */
export function signaturesComplete(
  activity: { readonly countersignatureRequired: boolean },
  valid: readonly Pick<ActivitySignature, 'role'>[],
): boolean {
  const has = (role: SignatureRole) => valid.some((signature) => signature.role === role)

  return has('signer') && (!activity.countersignatureRequired || has('countersigner'))
}

/**
 * What a person sees on the device before signing an activity, and so what
 * the signature is about (ADR 0004, point 7). The device builds it from what
 * it holds and the server from what it holds, with `signedPageOf`, and the
 * fingerprint of both has to be the same.
 *
 * It holds what is said and seen on site, and nothing the server or the
 * office adds afterwards: no number drawn by the server, no due day of a
 * class, no interval, no name out of the catalogue, whose version on the
 * device may be older. Its lists are ordered by their keys, which device and
 * server share, and not by a moment either side stamps on its own. When the
 * answers of a protocol come with the filled forms of phase 1, they come in
 * only where there are some, so that a page signed before keeps its
 * fingerprint.
 */
export interface SignedPage {
  readonly activity: {
    readonly id: string
    readonly kind: ActivityKind
    readonly title: string
    readonly performedOn: IsoDate | null
  }
  readonly place: {
    readonly property: { readonly name: string; readonly address: string }
    readonly building: { readonly name: string; readonly shortCode: string | null } | null
    readonly room: { readonly number: string | null; readonly name: string | null } | null
    readonly asset: {
      readonly id: string
      readonly name: string
      readonly kind: string
      readonly serialNumber: string | null
    } | null
  }
  readonly duties: readonly {
    readonly dutyId: string
    readonly kind: string | null
    readonly label: string | null
    readonly result: EvidenceResult | null
    readonly resultReason: string | null
  }[]
  readonly defects: readonly {
    readonly id: string
    readonly description: string
    readonly defectClass: string | null
  }[]
}

/** The page of an activity from its parts, in the order device and server share. */
export function signedPageOf(parts: SignedPage): SignedPage {
  return {
    activity: parts.activity,
    place: parts.place,
    duties: [...parts.duties].sort((left, right) => compare(left.dutyId, right.dutyId)),
    defects: [...parts.defects].sort((left, right) => compare(left.id, right.id)),
  }
}

/** Code units, the same in every engine. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** What is wrong with a signature as it arrives, one sentence per field. */
export function signatureProblems(
  signature: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  oneOf(problems, signature, 'role', signatureRoles, 'Unterschrieben wird oder gegengezeichnet.')

  const path = signature['path']

  if (path !== undefined && (typeof path !== 'string' || !signaturePathIsValid(path))) {
    problems['path'] =
      `Die Unterschrift ist ein Linienzug im Feld, höchstens ${String(longestSignaturePath)} Zeichen.`
  }

  const fingerprint = signature['pageFingerprint']

  if (
    fingerprint !== undefined &&
    (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint))
  ) {
    problems['pageFingerprint'] = 'Der Fingerabdruck der Seite sind 64 hexadezimale Ziffern.'
  }

  const deviceInfo = signature['deviceInfo']

  if (
    deviceInfo !== undefined &&
    deviceInfo !== null &&
    (typeof deviceInfo !== 'string' || deviceInfo.length > signatureLimits.deviceInfo)
  ) {
    problems['deviceInfo'] =
      `Die Angabe zum Gerät hat höchstens ${String(signatureLimits.deviceInfo)} Zeichen.`
  }

  return problems
}
