import {
  type ContractId,
  contractStanding,
  type Duty,
  type DutyContract,
  type IsoDate,
  termEnd,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { inArray } from 'drizzle-orm'

import { contracts } from './schema/index.js'

/**
 * The contracts these duties fulfil (#329), each as a duty names it: its
 * title, and the day it ended where it has ended on `today`. A contract
 * marked as removed is read as well; it can only be one no open duty named.
 *
 * The transaction is the person's. A contract lies in no area and its policy
 * is the tenant's alone, so it is read whatever areas the person sees; who
 * is shown its title is the route's to decide.
 */
export async function contractsOfDuties(
  tx: TenantTransaction,
  rows: readonly Pick<Duty, 'id' | 'contractId'>[],
  today: IsoDate,
): Promise<ReadonlyMap<string, DutyContract>> {
  const ids = [
    ...new Set(rows.flatMap((duty) => (duty.contractId === null ? [] : [duty.contractId]))),
  ]
  const read = new Map<string, DutyContract>()

  if (ids.length === 0) {
    return read
  }

  const found = await tx
    .select()
    .from(contracts)
    .where(inArray(contracts.id, ids as ContractId[]))
  const byId = new Map(
    found.map((contract) => {
      const ended = contractStanding(contract, today) === 'ended'

      return [
        contract.id as string,
        {
          id: contract.id,
          title: contract.title,
          endedOn: ended ? termEnd(contract, today) : null,
        },
      ]
    }),
  )

  for (const duty of rows) {
    const contract = duty.contractId === null ? undefined : byId.get(duty.contractId)

    if (contract !== undefined) {
      read.set(duty.id, contract)
    }
  }

  return read
}
