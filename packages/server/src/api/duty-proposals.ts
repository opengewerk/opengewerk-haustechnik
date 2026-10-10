import {
  type AssetId,
  type AssetValue,
  type BuildingId,
  type BuildingKind,
  type Catalogue,
  type DismissedProposal,
  type DutyDismissalId,
  type DutyProposal,
  type DutyProposalFilter,
  type DutyProposals,
  type FederalState,
  type IsoDate,
  lifecycleStateOn,
  proposedKinds,
  type ProposedAsset,
  type PropertyId,
  type RoomId,
  statesWithoutProposals,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'

import { lifecyclesByAsset } from '../database/duty-standing.js'
import { assets, buildings, duties, dutyDismissals, properties } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { said } from './register-question.js'

/**
 * The proposals of the catalogue in the areas of the person asking (#102,
 * section 4.3 of the concept, ADR 0002, point 11), worked out on the day they
 * are read and never kept: for every asset that is still there to be looked
 * after, the duty kinds whose scope takes it in, less the kinds decided on at
 * it, a duty confirmed and not ended and a dismissal not taken back. Beside
 * them the dismissals themselves, with their reason and the day.
 *
 * The transaction is the person's, so every row read here is one of their
 * areas, whatever the address names; an asset of another area has no
 * proposal for them, as it has no row.
 */

/** The filter an address names; an id that is no id names nothing the person could see. */
export function dutyProposalFilter(query: Readonly<Record<string, unknown>>): DutyProposalFilter {
  const assetId = said(query, 'assetId')
  const propertyId = said(query, 'propertyId')
  const dutyKind = said(query, 'dutyKind')

  return {
    ...(assetId === undefined ? {} : { assetId }),
    ...(propertyId === undefined ? {} : { propertyId }),
    ...(dutyKind === undefined ? {} : { dutyKind }),
  }
}

export async function dutyProposals(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  filter: DutyProposalFilter,
): Promise<DutyProposals> {
  const nothing: DutyProposals = { proposals: [], dismissed: [] }

  if ([filter.assetId, filter.propertyId].some((id) => id !== undefined && !isUuid(id))) {
    return nothing
  }

  const atProperty = filter.propertyId === undefined ? undefined : (filter.propertyId as PropertyId)
  const atAsset = filter.assetId === undefined ? undefined : (filter.assetId as AssetId)

  const rows = await tx
    .select({
      id: assets.id,
      number: assets.number,
      name: assets.name,
      kind: assets.kind,
      propertyId: assets.propertyId,
      buildingId: assets.buildingId,
      roomId: assets.roomId,
      values: assets.values,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        atProperty === undefined ? undefined : eq(assets.propertyId, atProperty),
        atAsset === undefined ? undefined : eq(assets.id, atAsset),
      ),
    )
    .orderBy(asc(assets.number), asc(assets.name), asc(assets.id))

  if (rows.length === 0) {
    return nothing
  }

  const lives = await lifecyclesByAsset(tx, atAsset === undefined ? undefined : [atAsset])
  const kindsOf = new Map<string, readonly BuildingKind[]>(
    (
      await tx
        .select({ id: buildings.id, kinds: buildings.kinds })
        .from(buildings)
        .where(
          and(
            isNull(buildings.deletedAt),
            atProperty === undefined ? undefined : eq(buildings.propertyId, atProperty),
          ),
        )
    ).map((row) => [row.id, row.kinds]),
  )
  const stateOf = new Map<string, FederalState>(
    (
      await tx
        .select({ id: properties.id, federalState: properties.federalState })
        .from(properties)
        .where(
          and(
            isNull(properties.deletedAt),
            atProperty === undefined ? undefined : eq(properties.id, atProperty),
          ),
        )
    ).map((row) => [row.id, row.federalState]),
  )

  // A duty stands until it ends, as the database keeps one of a kind at an
  // asset (`duties_kind_once`); one ended is proposed again.
  const decided = new Map<string, Set<string>>()
  const decide = (assetId: string, kind: string) => {
    decided.set(assetId, (decided.get(assetId) ?? new Set()).add(kind))
  }

  for (const duty of await tx
    .select({ assetId: duties.assetId, kind: duties.kind })
    .from(duties)
    .where(
      and(
        isNull(duties.deletedAt),
        isNull(duties.endsOn),
        isNotNull(duties.kind),
        isNotNull(duties.assetId),
        atProperty === undefined ? undefined : eq(duties.propertyId, atProperty),
        atAsset === undefined ? undefined : eq(duties.assetId, atAsset),
      ),
    )) {
    if (duty.assetId !== null && duty.kind !== null) {
      decide(duty.assetId, duty.kind)
    }
  }

  const dismissals = await tx
    .select({
      id: dutyDismissals.id,
      assetId: dutyDismissals.assetId,
      kind: dutyDismissals.kind,
      kindVersion: dutyDismissals.kindVersion,
      reason: dutyDismissals.reason,
      createdAt: dutyDismissals.createdAt,
    })
    .from(dutyDismissals)
    .where(
      and(
        isNull(dutyDismissals.deletedAt),
        atProperty === undefined ? undefined : eq(dutyDismissals.propertyId, atProperty),
        atAsset === undefined ? undefined : eq(dutyDismissals.assetId, atAsset),
        filter.dutyKind === undefined ? undefined : eq(dutyDismissals.kind, filter.dutyKind),
      ),
    )
    .orderBy(asc(dutyDismissals.createdAt))

  for (const dismissal of dismissals) {
    decide(dismissal.assetId, dismissal.kind)
  }

  const asProposed = new Map<string, ProposedAsset>(
    rows.map((row) => [
      row.id,
      {
        id: row.id as AssetId,
        number: row.number,
        name: row.name,
        kind: row.kind,
        propertyId: row.propertyId as PropertyId,
        buildingId: row.buildingId as BuildingId,
        roomId: row.roomId as RoomId | null,
        enteredOn: dayInGermany(row.createdAt),
      },
    ]),
  )
  const proposals: DutyProposal[] = []

  for (const row of rows) {
    const state = lifecycleStateOn(lives.get(row.id) ?? [], today)
    const federalState = stateOf.get(row.propertyId)

    if ((state !== null && statesWithoutProposals.includes(state)) || federalState === undefined) {
      continue
    }

    const entries = proposedKinds(
      catalogue,
      {
        assetKind: row.kind,
        values: (row.values ?? {}) as Readonly<Record<string, AssetValue>>,
        buildingKinds: kindsOf.get(row.buildingId) ?? [],
        federalState,
      },
      today,
      decided.get(row.id) ?? new Set(),
    )

    for (const entry of entries) {
      if (filter.dutyKind === undefined || entry.key === filter.dutyKind) {
        proposals.push({ kind: entry.key, asset: asProposed.get(row.id) as ProposedAsset })
      }
    }
  }

  const dismissed: DismissedProposal[] = dismissals.flatMap((dismissal) => {
    const asset = asProposed.get(dismissal.assetId)

    return asset === undefined
      ? []
      : [
          {
            id: dismissal.id as DutyDismissalId,
            kind: dismissal.kind,
            kindVersion: dismissal.kindVersion,
            reason: dismissal.reason,
            dismissedOn: dayInGermany(dismissal.createdAt),
            asset,
          },
        ]
  })

  return { proposals, dismissed }
}
