import { BadRequestException } from '@nestjs/common'
import type { ContractorId } from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { contractors } from '../database/schema/index.js'

/** Whether a field was given a value: not left out and not emptied. */
function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/**
 * The firm out of the list a duty, an activity or a report names (#328):
 * one of the tenant that is not removed. One of another tenant and one that
 * is not there are answered alike; the policies decide which rows there are.
 */
export async function checkContractor(tx: TenantTransaction, contractorId: unknown): Promise<void> {
  if (!given(contractorId)) {
    return
  }

  const [found] =
    typeof contractorId === 'string' && isUuid(contractorId)
      ? await tx
          .select({ id: contractors.id })
          .from(contractors)
          .where(
            and(eq(contractors.id, contractorId as ContractorId), isNull(contractors.deletedAt)),
          )
      : []

  if (found === undefined) {
    throw new BadRequestException(
      'Diese Fremdfirma gibt es nicht oder nicht mehr. Wählen Sie eine aus der Liste.',
    )
  }
}

/**
 * A firm out of the list and a note on one belong to what a contractor
 * performs; the sentence says what that is, a duty or an activity.
 */
export function checkPerformer(
  performer: unknown,
  note: unknown,
  contractorId: unknown,
  sentence: string,
): void {
  if ((given(note) || given(contractorId)) && performer !== 'contractor') {
    throw new BadRequestException(sentence)
  }
}
