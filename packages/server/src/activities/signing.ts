import {
  type ActivityId,
  type ActivitySignatureId,
  type ActivityStatus,
  type EvidenceOrigin,
  type SignatureRole,
  type SignedPage,
  signatureLimits,
  signatureProblems,
  signaturesComplete,
  signedPageOf,
  type StatedSignature,
  validSignatures,
  type WorkOrderDecisionId,
  type WorkOrderDecisionKind,
  workOrderDecisionKinds,
  type TenantId,
  type WorkOrderId,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import {
  activities,
  activityDuties,
  activitySignatures,
  assets,
  buildings,
  defects,
  properties,
  rooms,
  duties,
  workOrderDecisions,
  workOrders,
} from '../database/schema/index.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { type WritingContext, type WrittenEvidence, writeEvidence } from '../evidence/write.js'

/** A signature as it arrives from the device. */
export interface SignatureToTake {
  /** The key the device gave it, or none for one made on the server. */
  readonly id?: ActivitySignatureId
  readonly activityId: ActivityId
  readonly role: SignatureRole
  /** The clock of the device at the moment the signature was confirmed. */
  readonly signedAt: Date
  readonly deviceInfo: string | null
  readonly path: string
  readonly pageFingerprint: string
}

/** The acceptance of a signed work order, or its rejection with the reason. */
export interface DecisionToTake {
  readonly workOrderId: WorkOrderId
  readonly decision: WorkOrderDecisionKind
  readonly reason: string | null
}

export interface TakenSignature {
  readonly id: ActivitySignatureId
  readonly status: ActivityStatus
  readonly written: readonly WrittenEvidence[]
}

export interface TakenDecision {
  readonly id: WorkOrderDecisionId
  readonly status: ActivityStatus
  readonly written: readonly WrittenEvidence[]
}

/** What a signature is checked by before it is written: what it says, without when and in whose name. */
export type SignatureToCheck = Pick<
  SignatureToTake,
  'activityId' | 'role' | 'deviceInfo' | 'path' | 'pageFingerprint'
>

/**
 * What a refusal of a signature is about, which the sync answers by (ADR
 * 0004, point 11): the signature itself, which its form asks before anything
 * is queued (`signature`); the activity it is for, gone (`activity`) or
 * closed (`closed`); the page, which is not the one the server works out
 * (`page`); or its turn among the signatures already there (`turn`).
 */
export type SigningRefusalAbout = 'signature' | 'activity' | 'closed' | 'page' | 'turn'

/** Why a signature or a decision is not taken, in a sentence for the person who gave it. */
export class SigningRefusal extends Error {
  constructor(
    sentence: string,
    readonly about: SigningRefusalAbout = 'signature',
  ) {
    super(sentence)
    this.name = 'SigningRefusal'
  }
}

/** The fingerprint of a page: SHA-256 over its canonical form, as for the state of an evidence. */
export function pageFingerprint(page: SignedPage): string {
  return stateFingerprint(page)
}

type ActivityRow = typeof activities.$inferSelect

/**
 * What an activity calls for before it is signed, and what the server holds of
 * it: the page as the device shows it, worked out from the records here
 * (ADR 0004, point 7).
 */
export async function pageOf(tx: TenantTransaction, activity: ActivityRow): Promise<SignedPage> {
  const tenantId = activity.tenantId
  const [property] = await tx
    .select()
    .from(properties)
    .where(and(eq(properties.tenantId, tenantId), eq(properties.id, activity.propertyId)))
  const asset =
    activity.assetId === null
      ? null
      : ((
          await tx
            .select()
            .from(assets)
            .where(and(eq(assets.tenantId, tenantId), eq(assets.id, activity.assetId)))
        )[0] ?? null)
  const roomId = asset?.roomId ?? activity.roomId
  const room =
    roomId === null
      ? null
      : ((
          await tx
            .select()
            .from(rooms)
            .where(and(eq(rooms.tenantId, tenantId), eq(rooms.id, roomId)))
        )[0] ?? null)
  const buildingId = asset?.buildingId ?? room?.buildingId ?? activity.buildingId
  const building =
    buildingId === null
      ? null
      : ((
          await tx
            .select()
            .from(buildings)
            .where(and(eq(buildings.tenantId, tenantId), eq(buildings.id, buildingId)))
        )[0] ?? null)
  const lines = await tx
    .select({
      dutyId: activityDuties.dutyId,
      kind: duties.kind,
      label: duties.label,
      result: activityDuties.result,
      resultReason: activityDuties.resultReason,
    })
    .from(activityDuties)
    .innerJoin(
      duties,
      and(eq(duties.tenantId, activityDuties.tenantId), eq(duties.id, activityDuties.dutyId)),
    )
    .where(
      and(
        eq(activityDuties.tenantId, tenantId),
        eq(activityDuties.activityId, activity.id),
        isNull(activityDuties.deletedAt),
      ),
    )
  const noticed = await tx
    .select({ id: defects.id, description: defects.description, defectClass: defects.defectClass })
    .from(defects)
    .where(
      and(
        eq(defects.tenantId, tenantId),
        eq(defects.foundInActivityId, activity.id),
        isNull(defects.deletedAt),
      ),
    )

  return signedPageOf({
    activity: {
      id: activity.id,
      kind: activity.kind,
      title: activity.title,
      performedOn: activity.performedOn,
    },
    place: {
      property: {
        name: property?.name ?? '',
        address: property ? `${property.street}, ${property.postalCode} ${property.city}` : '',
      },
      building: building === null ? null : { name: building.name, shortCode: building.shortCode },
      room: room === null ? null : { number: room.number, name: room.name },
      asset:
        asset === null
          ? null
          : { id: asset.id, name: asset.name, kind: asset.kind, serialNumber: asset.serialNumber },
    },
    duties: lines,
    defects: noticed,
  })
}

/**
 * A live activity of the tenant, or the refusal.
 *
 * `held` takes the row until the transaction ends, for a check that what
 * follows must not overtake (opengewerk-haustechnik#31). Two devices that
 * signed the same page without a network and send at once were each checked
 * against signatures the other had not written yet, and both wrote the
 * activity down: two evidences per duty, which nobody can change or delete.
 * Held, the second waits for the first and finds what it wrote.
 */
async function activityOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  id: ActivityId,
  held = false,
): Promise<ActivityRow> {
  const query = tx
    .select()
    .from(activities)
    .where(
      and(eq(activities.tenantId, tenantId), eq(activities.id, id), isNull(activities.deletedAt)),
    )
  const [activity] = held ? await query.for('no key update') : await query

  if (!activity) {
    throw new SigningRefusal('Diesen Vorgang gibt es nicht.', 'activity')
  }

  return activity
}

/** The signatures of an activity and the decisions on its work order, and which of them count. */
async function signaturesOf(tx: TenantTransaction, activity: ActivityRow, fingerprint: string) {
  const signatures = await tx
    .select()
    .from(activitySignatures)
    .where(
      and(
        eq(activitySignatures.tenantId, activity.tenantId),
        eq(activitySignatures.activityId, activity.id),
      ),
    )
    .orderBy(asc(activitySignatures.createdAt), asc(activitySignatures.id))
  const decisions = await tx
    .select({
      decision: workOrderDecisions.decision,
      createdAt: workOrderDecisions.createdAt,
    })
    .from(workOrderDecisions)
    .innerJoin(
      workOrders,
      and(
        eq(workOrders.tenantId, workOrderDecisions.tenantId),
        eq(workOrders.id, workOrderDecisions.workOrderId),
      ),
    )
    .where(and(eq(workOrders.tenantId, activity.tenantId), eq(workOrders.activityId, activity.id)))

  return validSignatures(signatures, decisions, fingerprint)
}

/**
 * Checks a signature before it is written (ADR 0004, points 7, 8 and 10):
 * only for the page the server works out itself, only in its turn, and only
 * once the activity says on which day it was performed and what came of each
 * of its duties. Throws the refusal and writes nothing; asked by
 * `takeSignature` and by the sync, before a signature from a device is
 * written.
 *
 * The page comes before the day and the results: a device that showed a day
 * and results the server no longer has signed another page, which is a
 * conflict about that one operation (point 11), and one that showed the page
 * as it is and signed it without them made a mistake its form asks about.
 */
export async function checkSignature(
  tx: TenantTransaction,
  tenantId: TenantId,
  input: SignatureToCheck,
): Promise<void> {
  const firstProblem = Object.values(
    signatureProblems({
      role: input.role,
      path: input.path,
      pageFingerprint: input.pageFingerprint,
      deviceInfo: input.deviceInfo,
    }),
  )[0]

  if (firstProblem !== undefined) {
    throw new SigningRefusal(firstProblem)
  }

  // Held until the signature and what follows it are written, by whichever
  // way it comes, so that a second one for the same activity waits here.
  const activity = await activityOf(tx, tenantId, input.activityId, true)

  if (activity.status === 'done' || activity.status === 'not_performed') {
    throw new SigningRefusal('Dieser Vorgang ist abgeschlossen.', 'closed')
  }

  const page = await pageOf(tx, activity)
  const fingerprint = pageFingerprint(page)

  if (input.pageFingerprint !== fingerprint) {
    throw new SigningRefusal(
      'Die Seite hat sich geändert, seit sie gezeigt wurde. Sie wird neu gezeigt und neu unterschrieben.',
      'page',
    )
  }

  if (activity.performedOn === null) {
    throw new SigningRefusal('Der Tag der Durchführung fehlt.')
  }

  if (page.duties.some((line) => line.result === null)) {
    throw new SigningRefusal(
      'Jede Pflicht des Vorgangs braucht ein Ergebnis, bevor unterschrieben wird.',
    )
  }

  const valid = await signaturesOf(tx, activity, fingerprint)
  const has = (role: SignatureRole) => valid.some((signature) => signature.role === role)

  if (input.role === 'signer' && has('signer')) {
    throw new SigningRefusal('Dieser Vorgang ist schon unterschrieben.', 'turn')
  }

  if (input.role === 'countersigner') {
    if (!activity.countersignatureRequired) {
      throw new SigningRefusal('Dieser Vorgang wird nicht gegengezeichnet.', 'turn')
    }

    if (!has('signer')) {
      throw new SigningRefusal('Gegengezeichnet wird nach der Unterschrift.', 'turn')
    }

    if (has('countersigner')) {
      throw new SigningRefusal('Dieser Vorgang ist schon gegengezeichnet.', 'turn')
    }
  }
}

/**
 * What follows a signature once it is written, in the same transaction (ADR
 * 0004, points 8 and 10): when every signature the activity calls for is
 * there, the activity is written down, one evidence per duty, and is done;
 * until then, and for a work order, which waits for its acceptance, it is
 * signed. The signatures are read with the new one among them.
 */
export async function followSignature(
  tx: TenantTransaction,
  context: WritingContext,
  activityId: ActivityId,
): Promise<Omit<TakenSignature, 'id'>> {
  const activity = await activityOf(tx, context.tenantId, activityId)
  const valid = await signaturesOf(tx, activity, pageFingerprint(await pageOf(tx, activity)))
  const complete = activity.kind !== 'work_order' && signaturesComplete(activity, valid)
  const written = complete
    ? await writeDown(
        tx,
        context,
        activity,
        valid,
        activity.kind === 'round' ? 'round_point' : 'protocol',
      )
    : []
  const status: ActivityStatus = complete ? 'done' : 'signed'

  await tx
    .update(activities)
    .set({ status })
    .where(and(eq(activities.tenantId, context.tenantId), eq(activities.id, activity.id)))

  return { status, written }
}

/**
 * Takes a signature: checked, written in the name of whoever is signed in,
 * and followed by what comes of it, all in the transaction it is given.
 */
export async function takeSignature(
  tx: TenantTransaction,
  context: WritingContext,
  input: SignatureToTake,
): Promise<TakenSignature> {
  await checkSignature(tx, context.tenantId, input)

  const activity = await activityOf(tx, context.tenantId, input.activityId)
  const [signature] = await tx
    .insert(activitySignatures)
    .values({
      ...(input.id === undefined ? {} : { id: input.id }),
      tenantId: context.tenantId,
      propertyId: activity.propertyId,
      areaId: activity.areaId,
      activityId: activity.id,
      signedBy: context.writtenBy,
      role: input.role,
      signedAt: input.signedAt,
      deviceInfo: input.deviceInfo,
      path: input.path,
      pageFingerprint: input.pageFingerprint,
    })
    .returning({ id: activitySignatures.id })

  if (!signature) {
    throw new Error('The signature was not taken')
  }

  return { id: signature.id, ...(await followSignature(tx, context, activity.id)) }
}

/**
 * Takes the acceptance of a signed work order or its rejection with the
 * reason (section 4.8 of the concept). An acceptance writes the order down,
 * one evidence per duty; a rejection leaves the signature standing and
 * invalid, and the work goes on.
 */
export async function decideWorkOrder(
  tx: TenantTransaction,
  context: WritingContext,
  input: DecisionToTake,
): Promise<TakenDecision> {
  if (!(workOrderDecisionKinds as readonly string[]).includes(input.decision)) {
    throw new SigningRefusal('Ein Auftrag wird abgenommen oder zurückgewiesen.')
  }

  const reason = input.reason?.trim() ?? ''

  if (input.decision === 'rejected' && reason === '') {
    throw new SigningRefusal('Eine Zurückweisung nennt ihren Grund.')
  }

  if (reason.length > signatureLimits.decisionReason) {
    throw new SigningRefusal(
      `Der Grund hat höchstens ${String(signatureLimits.decisionReason)} Zeichen.`,
    )
  }

  const [order] = await tx
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, context.tenantId),
        eq(workOrders.id, input.workOrderId),
        isNull(workOrders.deletedAt),
      ),
    )

  if (!order) {
    throw new SigningRefusal('Diesen Auftrag gibt es nicht.')
  }

  // Held like a signature: two acceptances at once wrote the order down twice.
  const activity = await activityOf(tx, context.tenantId, order.activityId, true)
  const valid = await signaturesOf(tx, activity, pageFingerprint(await pageOf(tx, activity)))

  if (activity.status !== 'signed' || !valid.some((signature) => signature.role === 'signer')) {
    throw new SigningRefusal('Abgenommen oder zurückgewiesen wird ein unterschriebener Auftrag.')
  }

  const [decision] = await tx
    .insert(workOrderDecisions)
    .values({
      tenantId: context.tenantId,
      propertyId: order.propertyId,
      areaId: order.areaId,
      workOrderId: order.id,
      decision: input.decision,
      reason: input.decision === 'rejected' ? reason : null,
      decidedBy: context.writtenBy,
      decidedAt: context.at,
    })
    .returning({ id: workOrderDecisions.id })

  if (!decision) {
    throw new Error('The decision was not taken')
  }

  const accepted = input.decision === 'accepted'
  const written = accepted ? await writeDown(tx, context, activity, valid, 'work_order') : []
  const status: ActivityStatus = accepted ? 'done' : 'started'

  await tx
    .update(activities)
    .set({ status })
    .where(and(eq(activities.tenantId, context.tenantId), eq(activities.id, activity.id)))

  return { id: decision.id, status, written }
}

/**
 * Writes an activity down: one evidence per duty it was to meet, with the
 * result entered for that duty, the day it was performed on, who did it and
 * the signatures that count (ADR 0002, point 14).
 */
async function writeDown(
  tx: TenantTransaction,
  context: WritingContext,
  activity: ActivityRow,
  signatures: readonly (typeof activitySignatures.$inferSelect)[],
  origin: EvidenceOrigin,
): Promise<WrittenEvidence[]> {
  const lines = await tx
    .select()
    .from(activityDuties)
    .where(
      and(
        eq(activityDuties.tenantId, context.tenantId),
        eq(activityDuties.activityId, activity.id),
        isNull(activityDuties.deletedAt),
      ),
    )
    .orderBy(asc(activityDuties.id))
  const signer = signatures.find((signature) => signature.role === 'signer')
  const stated: StatedSignature[] = signatures.map((signature) => ({
    name: context.nameOf(signature.signedBy),
    role: signature.role,
    signedAt: signature.signedAt.toISOString(),
  }))
  const written: WrittenEvidence[] = []

  for (const line of lines) {
    written.push(
      await writeEvidence(tx, context, {
        dutyId: line.dutyId,
        activityId: activity.id,
        origin,
        performedOn: activity.performedOn ?? '',
        result: line.result ?? 'not_performed',
        resultReason: line.resultReason,
        performedBy: activity.performerUserId ?? signer?.signedBy ?? context.writtenBy,
        examiner: null,
        signatures: stated,
        files: [],
      }),
    )
  }

  return written
}
