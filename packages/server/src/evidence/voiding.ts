import {
  type EvidenceId,
  evidenceLimits,
  type EvidenceVoidingId,
  statedReasonProblem,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'

import { evidence, evidenceVoidings } from '../database/schema/index.js'
import { EvidenceRefusal, holdTheDuty, type WritingContext } from './write.js'

/** An evidence to declare invalid, and why. */
export interface VoidingToTake {
  readonly evidenceId: EvidenceId
  readonly reason: string
}

export interface TakenVoiding {
  readonly id: EvidenceVoidingId
  /** The number of the evidence, for the sentence that confirms it. */
  readonly number: string
}

/**
 * Declares an evidence invalid (ADR 0004, point 15): a row of its own with the
 * reason, the person and the moment, at most one for an evidence, in the
 * transaction it is given. The evidence stays as it is and readable; it
 * counts no more for the due day of its duty, which counts from the evidence
 * before it. A falsely signed round is declared invalid evidence by evidence,
 * and its duties are open again.
 *
 * An evidence a correction replaced is not declared invalid: it counts no
 * more anyway, and what is wrong is the correction, which is the one to
 * declare invalid.
 */
export async function voidEvidence(
  tx: TenantTransaction,
  context: Pick<WritingContext, 'tenantId' | 'writtenBy' | 'at'>,
  input: VoidingToTake,
): Promise<TakenVoiding> {
  const problem = statedReasonProblem(
    input.reason,
    evidenceLimits.voidingReason,
    'Eine Ungültigerklärung nennt ihren Grund.',
  )

  if (problem !== undefined) {
    throw new EvidenceRefusal(problem)
  }

  const [found] = await tx
    .select({
      id: evidence.id,
      number: evidence.number,
      dutyId: evidence.dutyId,
      propertyId: evidence.propertyId,
      areaId: evidence.areaId,
    })
    .from(evidence)
    .where(and(eq(evidence.tenantId, context.tenantId), eq(evidence.id, input.evidenceId)))

  if (!found) {
    throw new EvidenceRefusal('Diesen Nachweis gibt es nicht.')
  }

  await holdTheDuty(tx, context.tenantId, found.dutyId)

  const [voided] = await tx
    .select({ id: evidenceVoidings.id })
    .from(evidenceVoidings)
    .where(
      and(
        eq(evidenceVoidings.tenantId, context.tenantId),
        eq(evidenceVoidings.evidenceId, found.id),
      ),
    )

  if (voided) {
    throw new EvidenceRefusal('Dieser Nachweis ist schon für ungültig erklärt.')
  }

  const [correction] = await tx
    .select({ number: evidence.number })
    .from(evidence)
    .where(and(eq(evidence.tenantId, context.tenantId), eq(evidence.replacesEvidenceId, found.id)))

  if (correction) {
    throw new EvidenceRefusal(
      `Dieser Nachweis ist mit ${correction.number} berichtigt; für ungültig erklärt wird dann die Berichtigung.`,
    )
  }

  const [row] = await tx
    .insert(evidenceVoidings)
    .values({
      tenantId: context.tenantId,
      propertyId: found.propertyId,
      areaId: found.areaId,
      evidenceId: found.id,
      reason: input.reason.trim(),
      voidedBy: context.writtenBy,
      voidedAt: context.at,
    })
    .returning({ id: evidenceVoidings.id })

  if (!row) {
    throw new Error('The evidence was not declared invalid')
  }

  return { id: row.id, number: found.number }
}
