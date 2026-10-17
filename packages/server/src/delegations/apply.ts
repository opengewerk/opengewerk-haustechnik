import {
  type Catalogue,
  delegationCovers,
  delegationInForce,
  type DutyDelegationId,
  type DutyId,
  type IsoDate,
  nextResponsible,
  type Responsible,
  packageOfKind,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'

import { assets, duties } from '../database/schema/index.js'
import { type HeldDelegation, heldDelegations, standingOf, termsOf } from './reading.js'

/**
 * Who answers for each duty once the delegations that hold today are applied
 * (#336, `nextResponsible` in `domain`): the person of the one delegation
 * that covers a duty, nobody where the delegation it came from no longer
 * does, and otherwise what the duty says. Stored at the duty, so that the
 * register, the overview and the Lagebild count it as they count everything
 * else; worked out again after a delegation comes into force or is revoked,
 * after a duty is added, and every day in the pass of the deadlines, which
 * is when a delegation begins and ends.
 *
 * It works on the duties the transaction sees: in a route those of whoever
 * asked, and the person who signs a delegation into force sees every area
 * it names; in the pass of the deadlines every area. Duties that ended are
 * left as they are. Returns how many changed.
 */
export async function applyDelegations(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  onlyDuties?: readonly string[],
): Promise<number> {
  if (onlyDuties !== undefined && onlyDuties.length === 0) {
    return 0
  }

  const inForce = (await heldDelegations(tx))
    .filter((held) => delegationInForce(standingOf(held), today))
    .map((held) => ({
      id: held.delegation.id as string,
      delegateUserId: held.delegation.delegateUserId,
      terms: termsOf(held),
    }))
  const rows = await tx
    .select({
      id: duties.id,
      areaId: duties.areaId,
      kind: duties.kind,
      assetKind: assets.kind,
      responsibleUserId: duties.responsibleUserId,
      responsibleDelegationId: duties.responsibleDelegationId,
    })
    .from(duties)
    .leftJoin(assets, eq(assets.id, duties.assetId))
    .where(
      and(
        isNull(duties.deletedAt),
        or(isNull(duties.endsOn), gt(duties.endsOn, today)),
        onlyDuties === undefined ? undefined : inArray(duties.id, onlyDuties as DutyId[]),
      ),
    )
  let changed = 0

  for (const row of rows) {
    const scope = {
      areaId: row.areaId as string,
      packageName: packageOfKind(row.kind),
      costGroup:
        row.assetKind === null
          ? null
          : (catalogue.assetKind(row.assetKind, today)?.definition.costGroup ?? null),
    }
    const next = nextResponsible(
      { userId: row.responsibleUserId, delegationId: row.responsibleDelegationId },
      inForce.filter((each) => delegationCovers(each.terms, scope)),
    )

    if (
      next.userId !== row.responsibleUserId ||
      next.delegationId !== row.responsibleDelegationId
    ) {
      await tx
        .update(duties)
        .set({
          responsibleUserId: next.userId,
          responsibleDelegationId: next.delegationId as DutyDelegationId | null,
        })
        .where(eq(duties.id, row.id))
      changed += 1
    }
  }

  return changed
}

/** The delegations that cover a duty today, in the order they were written. */
export async function coveringOf(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  duty: { readonly areaId: string; readonly kind: string | null; readonly assetId: string | null },
): Promise<HeldDelegation[]> {
  const [asset] =
    duty.assetId === null
      ? []
      : await tx
          .select({ kind: assets.kind })
          .from(assets)
          .where(eq(assets.id, duty.assetId as never))
  const scope = {
    areaId: duty.areaId,
    packageName: packageOfKind(duty.kind),
    costGroup:
      asset === undefined
        ? null
        : (catalogue.assetKind(asset.kind, today)?.definition.costGroup ?? null),
  }

  return (await heldDelegations(tx))
    .filter((held) => delegationInForce(standingOf(held), today))
    .filter((held) => delegationCovers(termsOf(held), scope))
    .sort(
      (left, right) => left.delegation.createdAt.getTime() - right.delegation.createdAt.getTime(),
    )
}

/**
 * Who may be named to answer for a duty, as the office chooses at it (#336):
 * covered by no delegation, anybody, then without a delegation; covered by
 * one, its person and nobody else; covered by several, one of their persons,
 * which is the choice "entscheidet das Büro an der Pflicht". A sentence where
 * the choice is not one of these.
 */
export async function chosenResponsible(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  duty: { readonly areaId: string; readonly kind: string | null; readonly assetId: string | null },
  chosen: string | null,
): Promise<Responsible | string> {
  const covering = await coveringOf(tx, catalogue, today, duty)
  const [only] = covering

  if (only === undefined) {
    return { userId: chosen, delegationId: null }
  }

  const theirs = covering.find((held) => held.delegation.delegateUserId === chosen)

  if (theirs !== undefined) {
    return { userId: chosen, delegationId: theirs.delegation.id }
  }

  return covering.length === 1
    ? `Für diese Pflicht ist verantwortlich, wen die Pflichtenübertragung nennt: ${only.delegation.delegateName}. Ändern lässt sich das nur mit der Übertragung.`
    : `Mehrere Pflichtenübertragungen decken diese Pflicht. Verantwortlich ist eine ihrer beauftragten Personen: ${covering
        .map((held) => held.delegation.delegateName)
        .join(', ')}.`
}
