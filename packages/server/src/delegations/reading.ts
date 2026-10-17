import {
  type DelegationPage,
  delegationPageOf,
  type DelegationRole,
  type DelegationStanding,
  type DelegationTerms,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { inArray, type SQL } from 'drizzle-orm'

import {
  dutyDelegationAreas,
  dutyDelegationRevocations,
  dutyDelegations,
  dutyDelegationSignatures,
} from '../database/schema/index.js'

/**
 * A delegation of duties as it is read (#336): its row, the areas it names,
 * the signatures under it and a revocation. Tenant-wide like the tables:
 * whoever reads it reads it whole; the routes decide who may.
 */
export interface HeldDelegation {
  readonly delegation: typeof dutyDelegations.$inferSelect
  readonly areaIds: readonly string[]
  readonly signatures: readonly (typeof dutyDelegationSignatures.$inferSelect)[]
  readonly revocation: typeof dutyDelegationRevocations.$inferSelect | null
}

/** The delegations a condition names, or every one, with what hangs on them. */
export async function heldDelegations(
  tx: TenantTransaction,
  where?: SQL,
): Promise<HeldDelegation[]> {
  const rows = await tx.select().from(dutyDelegations).where(where)

  if (rows.length === 0) {
    return []
  }

  const ids = rows.map((row) => row.id)
  const areas = await tx
    .select()
    .from(dutyDelegationAreas)
    .where(inArray(dutyDelegationAreas.delegationId, ids))
  const signatures = await tx
    .select()
    .from(dutyDelegationSignatures)
    .where(inArray(dutyDelegationSignatures.delegationId, ids))
  const revocations = await tx
    .select()
    .from(dutyDelegationRevocations)
    .where(inArray(dutyDelegationRevocations.delegationId, ids))

  return rows.map((delegation) => ({
    delegation,
    areaIds: areas
      .filter((area) => area.delegationId === delegation.id)
      .map((area) => area.areaId as string)
      .sort(),
    signatures: signatures.filter((signature) => signature.delegationId === delegation.id),
    revocation: revocations.find((revocation) => revocation.delegationId === delegation.id) ?? null,
  }))
}

/** What the state of a delegation is worked out from. */
export function standingOf(held: HeldDelegation): DelegationStanding {
  return {
    startsOn: held.delegation.startsOn as IsoDate,
    endsOn: held.delegation.endsOn as IsoDate,
    signedBy: held.signatures.map((signature) => signature.role as DelegationRole),
    revokedTo: (held.revocation?.effectiveOn ?? null) as IsoDate | null,
  }
}

/** The terms a delegation says. */
export function termsOf(held: HeldDelegation): DelegationTerms & { readonly delegateName: string } {
  const { delegation } = held

  return {
    delegateUserId: delegation.delegateUserId,
    delegateName: delegation.delegateName,
    areaIds: held.areaIds,
    scope: delegation.scope,
    packages: [...delegation.packages].sort(),
    costGroups: [...delegation.costGroups].sort(),
    tasks: delegation.tasks,
    powers: delegation.powers,
    startsOn: delegation.startsOn as IsoDate,
    endsOn: delegation.endsOn as IsoDate,
  }
}

/** The page both sign, as the server works it out from what it holds. */
export function pageOf(held: HeldDelegation): DelegationPage {
  return delegationPageOf(termsOf(held))
}
