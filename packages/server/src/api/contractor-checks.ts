import { BadRequestException } from '@nestjs/common'
import type { ContractId, ContractorId } from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { contractors, contracts } from '../database/schema/index.js'

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

/** What a route answers for a contract that is not one of the firm a duty names (#329). */
export const contractOfAnotherFirm =
  'Dieser Vertrag gibt es nicht oder nicht mehr, oder er ist keiner der gewählten Fremdfirma.'

/**
 * The contract a duty fulfils (#329): a live one of the tenant, and one of
 * the firm the duty names as it will stand, so that the duty and its contract
 * name the same firm. The key of the database holds the same.
 */
export async function checkContract(
  tx: TenantTransaction,
  contractId: unknown,
  contractorId: unknown,
): Promise<void> {
  if (!given(contractId)) {
    return
  }

  const [found] =
    typeof contractId === 'string' && isUuid(contractId)
      ? await tx
          .select({ contractorId: contracts.contractorId })
          .from(contracts)
          .where(and(eq(contracts.id, contractId as ContractId), isNull(contracts.deletedAt)))
      : []

  if (found === undefined || found.contractorId !== contractorId) {
    throw new BadRequestException(contractOfAnotherFirm)
  }
}
