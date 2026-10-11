import type { FederalState, IsoDate } from '@opengewerk/platform-domain'

import type { AssetId, AssetValue, LifecycleState } from './asset.js'
import type { Catalogue, CatalogueEntry, DutyKind, DutyScope, ScopeCondition } from './catalogue.js'
import type { DutyDismissalId } from './duty-record.js'
import type { BuildingId, BuildingKind, PropertyId, RoomId } from './location.js'

/**
 * The proposals of the catalogue (sections 2.3 and 4.3 of the concept, ADR
 * 0002, point 11): which duty kinds come into question for an asset, after
 * its kind, its characteristics, the kinds of its building and the federal
 * state of its property, on a day. "Das System schlägt vor, der Betreiber
 * entscheidet" (Leitentscheidung 4): what is kept is the decision, a
 * confirmed duty or a dismissal with its reason, and never the proposal.
 *
 * A proposal is worked out each time it is read. An asset whose kind is
 * corrected, or whose characteristics are entered later, has its proposals
 * of the new kind and the new values on the next reading; nothing has to run
 * for that, and nothing stale is left behind.
 */

/** What a proposal asks of an asset and of the place it stands at. */
export interface ProposalSubject {
  readonly assetKind: string
  readonly values: Readonly<Record<string, AssetValue>>
  readonly buildingKinds: readonly BuildingKind[]
  readonly federalState: FederalState
}

/**
 * The states of a life cycle in which an asset is no longer there to be
 * looked after: nothing is proposed for one decommissioned or removed. An
 * asset out of service keeps its proposals, as its duties rest and return.
 */
export const statesWithoutProposals: readonly LifecycleState[] = ['decommissioned', 'removed']

/**
 * Whether one condition of a scope holds for the values of an asset. A
 * threshold is the value of its rule on the day, in the federal state, and a
 * characteristic is held in the steps of the unit of that rule, so the two
 * compare without a conversion.
 *
 * A characteristic nobody has entered yet, and a threshold without a value
 * on the day, count as met: a proposal too many is dismissed, one too few is
 * noticed by nobody (Leitentscheidung 4, as ADR 0002 says it of building kinds).
 */
export function conditionHolds(
  catalogue: Pick<Catalogue, 'rule'>,
  condition: ScopeCondition,
  values: Readonly<Record<string, AssetValue>>,
  on: IsoDate,
  state: FederalState,
): boolean {
  const value = values[condition.characteristic]

  if (value === undefined || value === null) {
    return true
  }

  if ('is' in condition) {
    return typeof value !== 'boolean' || value === condition.is
  }

  if ('oneOf' in condition) {
    return typeof value !== 'string' || condition.oneOf.includes(value)
  }

  const threshold = catalogue.rule(
    'atLeast' in condition ? condition.atLeast : condition.below,
    on,
    state,
  )

  if (threshold === null || typeof value !== 'number') {
    return true
  }

  return 'atLeast' in condition ? value >= threshold.record.value : value < threshold.record.value
}

/**
 * Whether the scope of a duty kind takes in an asset (ADR 0005, point 14): its
 * kind is named, every condition holds, its building is of a kind the scope
 * names, and its property lies in a state the scope names. An empty list of
 * building kinds or states names every one; a building of several kinds is
 * taken in by any of them.
 */
export function scopeApplies(
  catalogue: Pick<Catalogue, 'rule'>,
  scope: DutyScope,
  subject: ProposalSubject,
  on: IsoDate,
): boolean {
  return (
    scope.assetKinds.includes(subject.assetKind) &&
    (scope.buildingKinds.length === 0 ||
      scope.buildingKinds.some((kind) => subject.buildingKinds.includes(kind))) &&
    (scope.states.length === 0 || scope.states.includes(subject.federalState)) &&
    scope.conditions.every((condition) =>
      conditionHolds(catalogue, condition, subject.values, on, subject.federalState),
    )
  )
}

/**
 * The duty kinds the catalogue proposes for an asset on a day, in the order
 * of the catalogue. A kind decided on already is not proposed again: one
 * confirmed at the asset and not ended, and one dismissed and not taken back.
 */
export function proposedKinds(
  catalogue: Pick<Catalogue, 'dutyKinds' | 'rule'>,
  subject: ProposalSubject,
  on: IsoDate,
  decided: ReadonlySet<string>,
): readonly CatalogueEntry<DutyKind>[] {
  return catalogue
    .dutyKinds(on)
    .filter(
      (entry) =>
        !decided.has(entry.key) && scopeApplies(catalogue, entry.definition.scope, subject, on),
    )
}

/** The package a duty kind belongs to, the part of its key before the dot. */
export function packageOf(dutyKind: string): string {
  return dutyKind.slice(0, dutyKind.indexOf('.'))
}

/** An asset as a proposal names it, with what the office shows of it in a row. */
export interface ProposedAsset {
  readonly id: AssetId
  readonly number: string | null
  readonly name: string
  readonly kind: string
  readonly propertyId: PropertyId
  readonly buildingId: BuildingId
  readonly roomId: RoomId | null
  /** The day it was entered, "angelegt am". */
  readonly enteredOn: IsoDate
}

/** One open proposal: a duty kind of the catalogue, by its key, for an asset. */
export interface DutyProposal {
  readonly kind: string
  readonly asset: ProposedAsset
}

/** A proposal dismissed with its reason, which taking it back opens again. */
export interface DismissedProposal {
  readonly id: DutyDismissalId
  readonly kind: string
  readonly kindVersion: number
  readonly reason: string
  readonly dismissedOn: IsoDate
  readonly asset: ProposedAsset
}

/** The proposals in the areas of the person asking, and the ones dismissed beside them. */
export interface DutyProposals {
  readonly proposals: readonly DutyProposal[]
  readonly dismissed: readonly DismissedProposal[]
}

/** What the proposals may be narrowed to, each a part of the address of the route. */
export interface DutyProposalFilter {
  readonly assetId?: string
  readonly propertyId?: string
  readonly dutyKind?: string
}

export const dutyProposalFilters = [
  'assetId',
  'propertyId',
  'dutyKind',
] as const satisfies readonly (keyof DutyProposalFilter)[]

/**
 * A batch confirms or dismisses one duty kind for many assets of a kind at
 * once (section 4.3: "auch im Stapel für viele gleichartige Anlagen"), in one
 * transaction: all of them or none.
 */
export const proposalBatch = { most: 500 } as const

/** What is wrong with the assets of a batch, or null: a list of distinct ids, at least one and not too many. */
export function batchAssetsProblem(assetIds: unknown): string | null {
  if (!Array.isArray(assetIds) || assetIds.length === 0) {
    return 'Ein Stapel nennt mindestens eine Anlage.'
  }

  if (assetIds.length > proposalBatch.most) {
    return `Ein Stapel nennt höchstens ${String(proposalBatch.most)} Anlagen.`
  }

  if (!assetIds.every((id) => typeof id === 'string' && id !== '')) {
    return 'Eine Anlage im Stapel ist nicht genannt.'
  }

  return new Set(assetIds).size === assetIds.length
    ? null
    : 'Eine Anlage steht zweimal im Stapel; jede bekommt genau eine Pflicht.'
}
