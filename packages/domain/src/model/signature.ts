import {
  type Id,
  type IsoDate,
  longestSignaturePath,
  signaturePathIsValid,
  type Synced,
} from '@opengewerk/platform-domain'

import type { ActivityId, ActivityKind, WorkOrderId } from './activity.js'
import type { FilledAnswer } from './answer.js'
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
 * server share, and not by a moment either side stamps on its own.
 *
 * An activity with a form shows the form by key and version and every answer
 * as its row holds it (#106); one without a form has neither on its page, so
 * that a page signed before keeps its fingerprint. A defect that came of an
 * answer is not on the page: the answer is.
 *
 * A work order shows the time spent on it and its notes, each by its key and
 * its text (#118), where it has them: who wrote a note is the server's to
 * write and the further people do not stand on the page (4.8), and the
 * moment of a note is one a device stamps.
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
  readonly duties: readonly SignedDuty[]
  readonly defects: readonly {
    readonly id: string
    readonly description: string
    readonly defectClass: string | null
  }[]
  readonly form?: { readonly key: string; readonly version: number }
  readonly answers?: readonly SignedAnswer[]
  readonly durationMinutes?: number
  readonly notes?: readonly SignedNote[]
}

/** A note on a work order as the page shows it: its key and what it says. */
export interface SignedNote {
  readonly id: string
  readonly text: string
}

/**
 * A duty of the activity as the page shows it, with its result. What is said
 * with the result stands on it only where something is (#108), so that a page
 * signed before keeps its fingerprint.
 */
export interface SignedDuty {
  readonly dutyId: string
  readonly kind: string | null
  readonly label: string | null
  readonly result: EvidenceResult | null
  readonly resultReason: string | null
  readonly remark?: string
}

/** A duty as the page holds it, from a line that may say null where nothing was said. */
function signedDuty(line: Omit<SignedDuty, 'remark'> & { readonly remark?: string | null }) {
  const { dutyId, kind, label, result, resultReason, remark } = line

  return {
    dutyId,
    kind,
    label,
    result,
    resultReason,
    ...(remark === undefined || remark === null ? {} : { remark }),
  }
}

/** An answer as the page shows it: its point and what it says, as its row holds it. */
export type SignedAnswer = FilledAnswer

/** Answers in the order of their points: group, block, field, by their keys. */
function byPoint(left: SignedAnswer, right: SignedAnswer): number {
  return (
    compare(left.groupKey ?? '', right.groupKey ?? '') ||
    compare(left.blockKey ?? '', right.blockKey ?? '') ||
    compare(left.fieldKey, right.fieldKey)
  )
}

/**
 * The parts of a page, where a duty may say null for a remark it has none of,
 * and a work order for the time spent on it.
 */
export type SignedPageParts = Omit<SignedPage, 'duties' | 'durationMinutes'> & {
  readonly duties: readonly (Omit<SignedDuty, 'remark'> & { readonly remark?: string | null })[]
  readonly durationMinutes?: number | null
}

/** The page of an activity from its parts, in the order device and server share. */
export function signedPageOf(parts: SignedPageParts): SignedPage {
  return {
    activity: parts.activity,
    place: parts.place,
    duties: parts.duties.map(signedDuty).sort((left, right) => compare(left.dutyId, right.dutyId)),
    defects: [...parts.defects].sort((left, right) => compare(left.id, right.id)),
    ...(parts.form === undefined
      ? {}
      : {
          form: parts.form,
          answers: [...(parts.answers ?? [])]
            .map(({ groupKey, blockKey, fieldKey, value, result, remark, attachmentId }) => ({
              groupKey,
              blockKey,
              fieldKey,
              value,
              result,
              remark,
              attachmentId,
            }))
            .sort(byPoint),
        }),
    ...(parts.durationMinutes === undefined || parts.durationMinutes === null
      ? {}
      : { durationMinutes: parts.durationMinutes }),
    ...(parts.notes === undefined || parts.notes.length === 0
      ? {}
      : {
          notes: parts.notes
            .map(({ id, text }) => ({ id, text }))
            .sort((left, right) => compare(left.id, right.id)),
        }),
  }
}

/** A record as a device holds it: its fields by their names in the sync. */
export type HeldRecord = Readonly<Record<string, unknown>>

/** What a device holds, asked the way its store answers. */
export interface HeldRecords {
  /** The record of a kind under its id, or null. */
  readonly find: (entity: string, id: string) => HeldRecord | null
  /** The records of a kind whose field names the id. */
  readonly related: (entity: string, field: string, id: string) => readonly HeldRecord[]
}

/** A text of a record, or null for a field that says nothing or is not there. */
function heldText(record: HeldRecord | null, field: string): string | null {
  const value = record?.[field]

  return typeof value === 'string' ? value : null
}

/** Whether a record is still there and not marked. */
function live(record: HeldRecord): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

/**
 * The page of an activity as a device works it out from what it holds (#108,
 * ADR 0004, point 7), the same way the server does from its rows: the place
 * from the asset of the activity, else its room, else its building; the
 * duties with their results; the defects reported in it, not those an answer
 * makes; with a form, the answers to its points; and for a work order the
 * time spent on it and its notes. Null when the device does not hold the
 * activity.
 */
export function heldPageOf(held: HeldRecords, activityId: string): SignedPage | null {
  const activity = held.find('activities', activityId)

  if (activity === null) {
    return null
  }

  const find = (entity: string, id: string | null) => (id === null ? null : held.find(entity, id))
  const property = find('properties', heldText(activity, 'propertyId'))
  const asset = find('assets', heldText(activity, 'assetId'))
  const room = find('rooms', heldText(asset, 'roomId') ?? heldText(activity, 'roomId'))
  const building = find(
    'buildings',
    heldText(asset, 'buildingId') ??
      heldText(room, 'buildingId') ??
      heldText(activity, 'buildingId'),
  )
  const formKey = heldText(activity, 'formKey')
  const formVersion = activity['formVersion']
  const form =
    formKey === null || typeof formVersion !== 'number'
      ? null
      : { key: formKey, version: formVersion }

  return signedPageOf({
    activity: {
      id: activityId,
      kind: activity['kind'] as ActivityKind,
      title: heldText(activity, 'title') ?? '',
      performedOn: heldText(activity, 'performedOn') as IsoDate | null,
    },
    place: {
      property: {
        name: heldText(property, 'name') ?? '',
        address:
          property === null
            ? ''
            : `${heldText(property, 'street') ?? ''}, ${heldText(property, 'postalCode') ?? ''} ${heldText(property, 'city') ?? ''}`,
      },
      building:
        building === null
          ? null
          : { name: heldText(building, 'name') ?? '', shortCode: heldText(building, 'shortCode') },
      room:
        room === null ? null : { number: heldText(room, 'number'), name: heldText(room, 'name') },
      asset:
        asset === null
          ? null
          : {
              id: String(asset['id']),
              name: heldText(asset, 'name') ?? '',
              kind: heldText(asset, 'kind') ?? '',
              serialNumber: heldText(asset, 'serialNumber'),
            },
    },
    duties: held
      .related('activity_duties', 'activityId', activityId)
      .filter(live)
      .map((line) => {
        const duty = find('duties', heldText(line, 'dutyId'))

        return {
          dutyId: heldText(line, 'dutyId') ?? '',
          kind: heldText(duty, 'kind'),
          label: heldText(duty, 'label'),
          result: heldText(line, 'result') as EvidenceResult | null,
          resultReason: heldText(line, 'resultReason'),
          remark: heldText(line, 'remark'),
        }
      }),
    defects: held
      .related('defects', 'foundInActivityId', activityId)
      .filter((defect) => live(defect) && heldText(defect, 'foundInAnswerId') === null)
      .map((defect) => ({
        id: String(defect['id']),
        description: heldText(defect, 'description') ?? '',
        defectClass: heldText(defect, 'defectClass'),
      })),
    ...(form === null
      ? {}
      : {
          form,
          answers: held
            .related('activity_answers', 'activityId', activityId)
            .filter(live)
            .map((answer) => ({
              groupKey: heldText(answer, 'groupKey'),
              blockKey: heldText(answer, 'blockKey'),
              fieldKey: heldText(answer, 'fieldKey') ?? '',
              value: heldText(answer, 'value'),
              result: heldText(answer, 'result') as SignedAnswer['result'],
              remark: heldText(answer, 'remark'),
              attachmentId: heldText(answer, 'attachmentId') as SignedAnswer['attachmentId'],
            })),
        }),
    ...(activity['kind'] === 'work_order' ? heldWorkOf(held, activityId) : {}),
  })
}

/** The time spent on a work order and its notes, as a device holds them. */
function heldWorkOf(
  held: HeldRecords,
  activityId: string,
): Pick<SignedPageParts, 'durationMinutes' | 'notes'> {
  const order = held.related('work_orders', 'activityId', activityId).find(live)
  const duration = order?.['durationMinutes']

  return {
    durationMinutes: typeof duration === 'number' ? duration : null,
    notes: held
      .related('work_order_notes', 'activityId', activityId)
      .filter(live)
      .map((note) => ({ id: String(note['id']), text: heldText(note, 'text') ?? '' })),
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
