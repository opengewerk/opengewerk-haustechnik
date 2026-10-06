import type { IsoDate } from '@opengewerk/platform-domain'

import type { Asset, AssetSupply, LifecycleEntry, LifecycleState } from './asset.js'
import type { DefectStatus } from './defect.js'
import type { Appointment, DutyStanding, DutyState } from './duty.js'
import type { Duty } from './duty-record.js'

/**
 * The condition of an asset on a day (section 2.2 of the concept, ADR 0002,
 * point 16): what its duties and its defects say about it, taken together.
 * Derived on every reading from the duties, the evidence and the defects, and
 * never stored: a stored one would have to be kept up and would be wrong
 * between two runs.
 *
 * The concept lists five, from the one that calls for nothing to the one that
 * calls loudest: in order, due, overdue, never checked, defect open. Where
 * several hold, the loudest is the condition, so the list here begins with
 * it. Two more stand for an asset the five say nothing about: one whose
 * duties rest because it is not in service, and one nobody has confirmed a
 * duty for.
 */
export const assetConditions = [
  'defect_open',
  'never_checked',
  'overdue',
  'due',
  'in_order',
  'resting',
  'no_duties',
] as const

export type AssetCondition = (typeof assetConditions)[number]

export const assetConditionLabel: Readonly<Record<AssetCondition, string>> = {
  defect_open: 'Mangel offen',
  never_checked: 'Nie geprüft',
  overdue: 'Überfällig',
  due: 'Fällig',
  in_order: 'In Ordnung',
  resting: 'Ruht',
  no_duties: 'Ohne Pflichten',
}

/**
 * Whether a defect is still open: until it was checked again. "Behoben" comes
 * from the work order and is not the end, checking it again is a step of its
 * own (section 4.6 of the concept).
 */
export function defectIsOpen(status: DefectStatus): boolean {
  return status !== 'verified'
}

/** The condition of an asset on a day, and for one in order the day that ends. */
export interface AssetStanding {
  readonly condition: AssetCondition
  /** For an asset in order: the first day one of its duties falls due. */
  readonly until: IsoDate | null
}

/**
 * The condition of an asset on a day, from what holds on that day: how many
 * of its defects are open, whether its duties rest, and the state of each of
 * its duties that has not ended.
 *
 * An open defect is the condition whatever else holds, also at an asset out
 * of service: it may be the reason it is. Then an asset that rests rests,
 * whatever its appointments say, as each of its duties does. Among the duties
 * of an asset in service the loudest decides, and one never recorded is
 * louder than one overdue, because nobody knows since when it has been due.
 */
export function assetStandingOn(asset: {
  readonly openDefects: number
  readonly resting: boolean
  readonly duties: readonly DutyStanding[]
}): AssetStanding {
  const plain = (condition: AssetCondition): AssetStanding => ({ condition, until: null })

  if (asset.openDefects > 0) {
    return plain('defect_open')
  }

  if (asset.resting) {
    return plain('resting')
  }

  if (asset.duties.length === 0) {
    return plain('no_duties')
  }

  const has = (state: DutyState) => asset.duties.some((duty) => duty.state === state)

  if (has('never_recorded')) {
    return plain('never_checked')
  }

  if (has('overdue')) {
    return plain('overdue')
  }

  if (has('due')) {
    return plain('due')
  }

  // ISO dates sort the same way as the days they name.
  const first = asset.duties
    .flatMap((duty) => (duty.appointment === null ? [] : [duty.appointment.dueOn]))
    .sort()
    .at(0)

  return { condition: 'in_order', until: first ?? null }
}

/** The value of the filter for an asset whose life cycle has no entry up to today. */
export const withoutLifecycle = 'none'

/**
 * What the register of assets is asked for. Every part narrows, and two
 * together give what passes both.
 */
export interface AssetRegisterFilter {
  readonly propertyId?: string
  readonly buildingId?: string
  /** A cost group after DIN 276 the group of the kind of an asset lies in (`inCostGroup`). */
  readonly costGroup?: string
  /** The key of an asset kind, `<package>.<key>`. */
  readonly kind?: string
  readonly condition?: AssetCondition
  /** A state of the life cycle today, or `none` for an asset without an entry up to today. */
  readonly lifecycle?: LifecycleState | typeof withoutLifecycle
}

/** The names of the filters as an address carries them to the server. */
export const assetRegisterFilters = [
  'propertyId',
  'buildingId',
  'costGroup',
  'kind',
  'condition',
  'lifecycle',
] as const satisfies readonly (keyof AssetRegisterFilter)[]

/** How many assets a page of the register holds, and the most a page may be asked for. */
export const assetRegisterPage = { size: 50, most: 200 } as const

/** An asset as the register lists it: what a row shows, and nothing of its file. */
export interface AssetEntry
  extends
    Pick<
      Asset,
      'id' | 'propertyId' | 'buildingId' | 'roomId' | 'parentAssetId' | 'kind' | 'number' | 'name'
    >,
    AssetStanding {
  readonly lifecycleState: LifecycleState | null
}

/** A page of the register, with how much there is behind it. */
export interface AssetRegister {
  /** How many assets pass the filters, in the areas of the person asking. */
  readonly total: number
  /** On how many properties they stand. */
  readonly properties: number
  readonly assets: readonly AssetEntry[]
}

/**
 * An asset as its file reads it: with its life cycle, the state of it today,
 * its condition, what it supplies and the components under it.
 */
export interface AssetDetails extends Asset, AssetStanding {
  readonly lifecycle: readonly LifecycleEntry[]
  readonly lifecycleState: LifecycleState | null
  readonly supplies: readonly AssetSupply[]
  readonly components: readonly Pick<Asset, 'id' | 'number' | 'name' | 'kind'>[]
  /** The asset it is a component of. */
  readonly parent: Pick<Asset, 'id' | 'number' | 'name'> | null
}

/**
 * A duty as the file of an asset reads it: what it is called, by its own name
 * or by its kind in the version that was confirmed, and how it stands today.
 */
export interface DutyReading extends Pick<
  Duty,
  | 'id'
  | 'kind'
  | 'kindVersion'
  | 'label'
  | 'basis'
  | 'sourceNote'
  | 'task'
  | 'counting'
  | 'intervalDays'
  | 'intervalMonths'
  | 'endsOn'
> {
  readonly title: string
  readonly state: DutyState
  readonly appointment: Appointment | null
  /** The last day an evidence that stands met it. */
  readonly lastMetOn: IsoDate | null
}
