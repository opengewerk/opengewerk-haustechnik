import type { Id, IsoDate, Synced } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import type { AssetKind } from './catalogue.js'
import { calendarDay, optional, type Problems, required, wholeFromTo } from './fields.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'
import { type MeterUnit, meterUnits, meterUnitSymbol } from './meter.js'

/**
 * The technology, the other half of the data model (section 2.2 of the
 * concept, ADR 0002, points 4 to 9): the asset with its one place, the
 * components under it, its kind from the catalogue, its life cycle as a list
 * of entries and its number. A component is an asset under an asset, in the
 * same building, and everything that holds for an asset holds for it.
 */
export type AssetId = Id<'asset'>
export type AssetSupplyId = Id<'asset-supply'>
export type LifecycleEntryId = Id<'lifecycle-entry'>

/**
 * The states of a life cycle, each from a day on (section 2.2). A state is a
 * period and not a switch: a decommissioned asset does not disappear from the
 * past, and its duties rest instead of lapsing.
 */
export const lifecycleStates = [
  'planned',
  'in_service',
  'out_of_service',
  'decommissioned',
  'removed',
] as const

export type LifecycleState = (typeof lifecycleStates)[number]

export const lifecycleStateLabel: Readonly<Record<LifecycleState, string>> = {
  planned: 'Geplant',
  in_service: 'In Betrieb',
  out_of_service: 'Außer Betrieb',
  decommissioned: 'Stillgelegt',
  removed: 'Zurückgebaut',
}

/**
 * A value an asset carries for a characteristic or a field of its kind: a
 * whole number for a characteristic with a unit, a figure, a text, a day, yes
 * or no, or the value of a choice.
 */
export type AssetValue = string | number | boolean

/**
 * An asset: exactly one place, the building and on request the room, a kind
 * from the catalogue, and what is known about it. The number comes from the
 * server and is never handed out again; an asset made on a device without a
 * connection has none until the server has seen it (ADR 0002, point 8). The
 * mark is the one the operator keeps himself.
 */
export interface Asset extends Synced {
  readonly id: AssetId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly buildingId: BuildingId
  readonly roomId: RoomId | null
  readonly parentAssetId: AssetId | null
  readonly kind: string
  readonly number: string | null
  readonly name: string
  readonly mark: string | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  readonly yearBuilt: number | null
  readonly commissionedOn: IsoDate | null
  readonly warrantyEndsOn: IsoDate | null
  readonly values: Readonly<Record<string, AssetValue>>
  readonly meterNumber: string | null
  readonly meterUnit: MeterUnit | null
}

/**
 * A room or a building an asset supplies without standing there: the
 * ventilation plant on the roof supplies the wards below it. One of the two,
 * on the property of the asset.
 */
export interface AssetSupply extends Synced {
  readonly id: AssetSupplyId
  readonly assetId: AssetId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly buildingId: BuildingId | null
  readonly roomId: RoomId | null
}

/**
 * What is wrong with what an asset supplies, or null: an entry names a
 * building or a room, never both and never neither, as the check in the
 * database holds it.
 */
export function supplyPlaceProblem(supply: Readonly<Record<string, unknown>>): string | null {
  const given = (value: unknown) => value !== undefined && value !== null

  return given(supply['buildingId']) === given(supply['roomId'])
    ? 'Ein Eintrag versorgt genau ein Gebäude oder einen Raum.'
    : null
}

/** One entry of a life cycle: the state an asset is in from a day on. */
export interface LifecycleEntry extends Synced {
  readonly id: LifecycleEntryId
  readonly assetId: AssetId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly state: LifecycleState
  readonly validFrom: IsoDate
}

/** The bounds of the fields of an asset, the same in the form, the sync and the database. */
export const assetLimits = {
  kind: 130,
  name: 120,
  mark: 60,
  manufacturer: 120,
  model: 120,
  serialNumber: 80,
  meterNumber: 60,
  textValue: 500,
  earliestYearBuilt: 1800,
  latestYearBuilt: 2100,
} as const

/**
 * The state of an asset on a day: the entry with the latest first day up to
 * that day, and none before the first entry (ADR 0002, point 7). On a day
 * exactly one state applies; two entries beginning on the same day would make
 * that a guess, and the database refuses them.
 */
export function lifecycleStateOn(
  entries: readonly Pick<LifecycleEntry, 'state' | 'validFrom'>[],
  on: IsoDate,
): LifecycleState | null {
  let latest: Pick<LifecycleEntry, 'state' | 'validFrom'> | null = null

  for (const entry of entries) {
    // ISO dates sort the same way as the days they name.
    if (entry.validFrom > on) {
      continue
    }

    if (latest !== null && entry.validFrom === latest.validFrom) {
      throw new Error(`Zwei Einträge im Lebenszyklus beginnen am ${entry.validFrom}.`)
    }

    if (latest === null || entry.validFrom > latest.validFrom) {
      latest = entry
    }
  }

  return latest?.state ?? null
}

/** A day the record may leave empty. */
function optionalDay(
  problems: Problems,
  record: Readonly<Record<string, unknown>>,
  field: string,
  subject: string,
): void {
  const value = record[field]

  if (value !== undefined && value !== null && !calendarDay(value)) {
    problems[field] = `${subject} ist ein Tag, geschrieben 2026-10-03.`
  }
}

/**
 * What is wrong with an asset, one sentence per field, empty when nothing is.
 * Whether its kind is one the catalogue knows, and whether its values and its
 * meter fit that kind, are questions for `assetValueProblems` and
 * `meterProblems`, which take the kind.
 */
export function assetProblems(asset: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, asset, 'kind', assetLimits.kind, 'Die Anlagenart')
  required(problems, asset, 'name', assetLimits.name, 'Die Bezeichnung')
  optional(
    problems,
    asset,
    'mark',
    assetLimits.mark,
    `Das Kennzeichen hat höchstens ${String(assetLimits.mark)} Zeichen.`,
  )
  optional(
    problems,
    asset,
    'manufacturer',
    assetLimits.manufacturer,
    `Der Hersteller hat höchstens ${String(assetLimits.manufacturer)} Zeichen.`,
  )
  optional(
    problems,
    asset,
    'model',
    assetLimits.model,
    `Der Typ hat höchstens ${String(assetLimits.model)} Zeichen.`,
  )
  optional(
    problems,
    asset,
    'serialNumber',
    assetLimits.serialNumber,
    `Die Seriennummer hat höchstens ${String(assetLimits.serialNumber)} Zeichen.`,
  )
  optional(
    problems,
    asset,
    'meterNumber',
    assetLimits.meterNumber,
    `Die Zählernummer hat höchstens ${String(assetLimits.meterNumber)} Zeichen.`,
  )

  const year = asset['yearBuilt']

  if (
    year !== undefined &&
    year !== null &&
    !wholeFromTo(year, assetLimits.earliestYearBuilt, assetLimits.latestYearBuilt)
  ) {
    problems['yearBuilt'] =
      `Das Baujahr ist eine ganze Zahl von ${String(assetLimits.earliestYearBuilt)} bis ${String(assetLimits.latestYearBuilt)}.`
  }

  optionalDay(problems, asset, 'commissionedOn', 'Die Inbetriebnahme')
  optionalDay(problems, asset, 'warrantyEndsOn', 'Das Ende der Gewährleistung')

  const unit = asset['meterUnit']

  if (unit !== undefined && unit !== null && !(meterUnits as readonly unknown[]).includes(unit)) {
    problems['meterUnit'] =
      `Die Einheit ist keine von ${meterUnits.map((each) => meterUnitSymbol[each]).join(', ')}.`
  }

  return problems
}

/**
 * What is wrong with the values of an asset against its kind (ADR 0002,
 * point 6): a value for a characteristic or a field the kind does not have,
 * or one of the wrong sort. A value may be left out; an asset taken stock of
 * on site is seldom complete on the first day.
 */
export function assetValueProblems(kind: AssetKind, values: unknown): Readonly<Problems> {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return { values: 'Die Angaben zur Anlagenart stehen als Feld und Wert.' }
  }

  const problems: Problems = {}

  for (const [key, value] of Object.entries(values as Readonly<Record<string, unknown>>)) {
    const field = `values.${key}`
    const characteristic = kind.characteristics.find((each) => each.key === key)
    const assetField = kind.fields.find((each) => each.key === key)
    const described = characteristic ?? assetField

    if (!described) {
      problems[field] = `Das Feld ${key} hat die Anlagenart ${kind.label} nicht.`
      continue
    }

    switch (described.kind) {
      case 'number':
        if (characteristic && !Number.isInteger(value)) {
          problems[field] = `${described.label} ist eine ganze Zahl.`
        } else if (!characteristic && (typeof value !== 'number' || !Number.isFinite(value))) {
          problems[field] = `${described.label} ist eine Zahl.`
        }
        break
      case 'flag':
        if (typeof value !== 'boolean') {
          problems[field] = `${described.label} ist ja oder nein.`
        }
        break
      case 'choice':
        if (!described.options.some((option) => option.value === value)) {
          problems[field] =
            `${described.label} ist eine von ${described.options.map((option) => option.label).join(', ')}.`
        }
        break
      case 'text':
        if (typeof value !== 'string' || value.trim() === '') {
          problems[field] = `${described.label} ist ein Text, der nicht leer ist.`
        } else if (value.trim().length > assetLimits.textValue) {
          problems[field] =
            `${described.label} hat höchstens ${String(assetLimits.textValue)} Zeichen.`
        }
        break
      case 'date':
        if (!calendarDay(value)) {
          problems[field] = `${described.label} ist ein Tag, geschrieben 2026-10-03.`
        }
        break
    }
  }

  return problems
}

/**
 * A meter has its number and a unit its kind counts in; an asset of a kind
 * that is no measuring point has neither (ADR 0002, point 9).
 */
export function meterProblems(
  kind: AssetKind,
  asset: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}
  const number = asset['meterNumber']
  const unit = asset['meterUnit']
  const given = (value: unknown) => value !== undefined && value !== null

  if (kind.meter === null) {
    if (given(number)) {
      problems['meterNumber'] = 'Eine Zählernummer hat nur eine Messstelle.'
    }

    if (given(unit)) {
      problems['meterUnit'] = 'Eine Einheit hat nur eine Messstelle.'
    }

    return problems
  }

  if (typeof number !== 'string' || number.trim() === '') {
    problems['meterNumber'] = 'Die Zählernummer fehlt.'
  }

  if (!kind.meter.units.some((each) => each === unit)) {
    problems['meterUnit'] =
      `Ein Zähler dieser Art zählt in ${kind.meter.units.map((each) => meterUnitSymbol[each]).join(' oder ')}.`
  }

  return problems
}

/** What is wrong with an entry of a life cycle. */
export function lifecycleEntryProblems(
  entry: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}
  const state = entry['state']

  if (!(lifecycleStates as readonly unknown[]).includes(state)) {
    problems['state'] =
      `Der Zustand ist einer von ${lifecycleStates.map((each) => lifecycleStateLabel[each]).join(', ')}.`
  }

  if (!calendarDay(entry['validFrom'])) {
    problems['validFrom'] = 'Der Tag, ab dem der Zustand gilt, fehlt oder ist keiner.'
  }

  return problems
}
