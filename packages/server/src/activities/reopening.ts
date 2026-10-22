import type { ActivityId, EvidenceId } from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  activities,
  defects,
  evidence,
  evidenceVoidings,
  meterReadings,
} from '../database/schema/index.js'
import { voidEvidence } from '../evidence/voiding.js'
import type { WritingContext } from '../evidence/write.js'
import { activityOf, signaturesWithTheirStanding } from './signing.js'

type ActivityRow = Awaited<ReturnType<typeof activityOf>>

/** The person who asks to open a round again, with what they may. */
export interface Reopener {
  readonly userId: string
  readonly rights: readonly string[]
}

/**
 * What opening a handed-in round again takes away (#510): the signature that
 * counts, the defects it made of the answers, the readings it wrote, and the
 * evidence written from it, which is declared invalid.
 */
export interface ReopeningLoss {
  readonly signedBy: string
  readonly signedAt: Date
  readonly defects: number
  readonly readings: number
  readonly evidence: readonly { readonly id: EvidenceId; readonly number: string }[]
}

/** Why a round is not opened again, in a sentence for the person who asked. */
export class ReopeningRefusal extends Error {
  constructor(sentence: string) {
    super(sentence)
    this.name = 'ReopeningRefusal'
  }
}

/** The reason an evidence of a round opened again is declared invalid with. */
export const reopeningReason = 'Rundgang wieder geöffnet'

const words = {
  handedIn: 'Wieder geöffnet wird ein Rundgang, der abgegeben ist.',
  countersigned:
    'Ein gegengezeichneter Rundgang wird nicht wieder geöffnet. Berichtigt oder für ungültig erklärt wird sein Nachweis.',
  ordered:
    'Ein Mangel aus diesem Rundgang hat einen Auftrag. Der Rundgang wird nicht wieder geöffnet.',
  person: 'Wieder öffnen darf, wer den Rundgang abgegeben hat, und wer Rundgänge gegenzeichnet.',
} as const

/**
 * What opening this round again would take away, or why it is not opened
 * again by this person (section 4.5 of the concept, decided on 21.10.2026):
 * a handed-in round, no collective activity and no part of one, until its
 * countersignature and while no defect from its answers has a work order;
 * by whoever gave the signature that counts, and by whoever countersigns
 * rounds. The database holds the same limits (`activity_reopened`); this
 * says them first, in the areas of the person.
 */
export async function reopeningOf(
  tx: TenantTransaction,
  round: ActivityRow,
  asking: Reopener,
): Promise<ReopeningLoss | string> {
  if (
    round.kind !== 'round' ||
    round.collectiveId !== null ||
    round.collectiveKind !== null ||
    round.emptiedAt !== null ||
    (round.status !== 'signed' && round.status !== 'done')
  ) {
    return words.handedIn
  }

  const counting = (await signaturesWithTheirStanding(tx, round)).filter(({ valid }) => valid)
  const signer = counting.find(({ signature }) => signature.role === 'signer')?.signature

  if (signer === undefined) {
    return words.handedIn
  }

  if (counting.some(({ signature }) => signature.role === 'countersigner')) {
    return words.countersigned
  }

  // Whoever countersigns rounds, also without carrying them out (S6 of the
  // review of phase 2), and whoever gave the signature while they still do.
  const signedIt = signer.signedBy === asking.userId && asking.rights.includes('activity.perform')

  if (!signedIt && !asking.rights.includes('activity.accept')) {
    return words.person
  }

  const fromAnswers = and(
    eq(defects.tenantId, round.tenantId),
    eq(defects.foundInActivityId, round.id),
    isNotNull(defects.foundInAnswerId),
    isNull(defects.deletedAt),
  )
  const [ordered] = await tx
    .select({ id: defects.id })
    .from(defects)
    .where(and(fromAnswers, isNotNull(defects.remedyWorkOrderId)))
    .limit(1)

  if (ordered !== undefined) {
    return words.ordered
  }

  const [made] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(defects)
    .where(fromAnswers)
  const [written] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.tenantId, round.tenantId),
        eq(meterReadings.activityId, round.id),
        isNull(meterReadings.deletedAt),
      ),
    )
  const replacing = alias(evidence, 'replacing')
  const counted = await tx
    .select({ id: evidence.id, number: evidence.number })
    .from(evidence)
    .where(
      and(
        eq(evidence.tenantId, round.tenantId),
        eq(evidence.activityId, round.id),
        notExists(
          tx
            .select({ id: evidenceVoidings.id })
            .from(evidenceVoidings)
            .where(eq(evidenceVoidings.evidenceId, evidence.id)),
        ),
        notExists(
          tx
            .select({ id: replacing.id })
            .from(replacing)
            .where(eq(replacing.replacesEvidenceId, evidence.id)),
        ),
      ),
    )
    .orderBy(evidence.number)

  return {
    signedBy: signer.signedBy,
    signedAt: signer.signedAt,
    defects: made?.count ?? 0,
    readings: written?.count ?? 0,
    evidence: counted,
  }
}

/**
 * Opens a handed-in round again (#510, ADR 0004, addendum of 21.10.2026):
 * every evidence written from it is declared invalid, with the reason, and
 * the round is begun again. The database checks the limits once more, takes
 * the moment, and marks removed what the signature made; the signature stays
 * as it was written and counts no more. The answers stay.
 */
export async function reopenRound(
  tx: TenantTransaction,
  context: Pick<WritingContext, 'tenantId' | 'writtenBy' | 'at'>,
  asking: Reopener,
  roundId: ActivityId,
): Promise<void> {
  const round = await activityOf(tx, context.tenantId, roundId, true)
  const loss = await reopeningOf(tx, round, asking)

  if (typeof loss === 'string') {
    throw new ReopeningRefusal(loss)
  }

  for (const each of loss.evidence) {
    await voidEvidence(tx, context, { evidenceId: each.id, reason: reopeningReason })
  }

  await tx
    .update(activities)
    .set({ status: 'started', reopenedAt: context.at, updatedAt: new Date() })
    .where(and(eq(activities.tenantId, round.tenantId), eq(activities.id, round.id)))
}
