import type { Asset } from './asset.js'

/**
 * Whether an asset may already stand in the register (section 4.2 of the
 * concept: "gleiche Seriennummer, gleiches Kennzeichen"). One rule for the
 * form in the office, the import and the device, so that all three ask the
 * same and name the same asset.
 *
 * A possible duplicate is named and never refused: two assets of one make
 * may carry the same number on purpose, and a mark is the operator's own.
 * Whoever enters the asset decides whether it is the one that is there.
 */

/** What two assets are held against each other in. */
export const duplicateFields = ['serialNumber', 'mark'] as const

export type DuplicateField = (typeof duplicateFields)[number]

export const duplicateFieldLabel: Readonly<Record<DuplicateField, string>> = {
  serialNumber: 'Seriennummer',
  mark: 'Kennzeichen',
}

/**
 * A serial number or a mark as it is compared: without its spaces and without
 * regard to capitals, because a type plate is read off as "BT 750" by one and
 * as "bt750" by the next. Punctuation stays, it may tell two numbers apart.
 * Null for nothing: two assets without a serial number have nothing in common.
 */
export function duplicateKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const key = value.replace(/\s+/gu, '').toLowerCase()

  return key === '' ? null : key
}

/** What the rule reads of an asset, as a record of a device or a row of the server. */
export type DuplicateCandidate = Readonly<Partial<Record<DuplicateField | 'id', unknown>>>

/**
 * The fields in which two assets say the same, none when they are one asset.
 * A serial number is held against a serial number and a mark against a mark,
 * never one against the other.
 */
export function sameIn(
  candidate: DuplicateCandidate,
  other: DuplicateCandidate,
): readonly DuplicateField[] {
  if (candidate.id !== undefined && candidate.id !== null && candidate.id === other.id) {
    return []
  }

  return duplicateFields.filter((field) => {
    const key = duplicateKey(candidate[field])

    return key !== null && key === duplicateKey(other[field])
  })
}

/**
 * Among the assets there are, those the candidate may be: each with the
 * fields it shares, the ones that share both first, the rest in the order
 * they came in.
 */
export function possibleDuplicates<Other extends DuplicateCandidate>(
  candidate: DuplicateCandidate,
  others: readonly Other[],
): readonly { readonly asset: Other; readonly same: readonly DuplicateField[] }[] {
  return others
    .map((asset) => ({ asset, same: sameIn(candidate, asset) }))
    .filter((found) => found.same.length > 0)
    .sort((left, right) => right.same.length - left.same.length)
}

/** "Gleiche Seriennummer", "Gleiches Kennzeichen", or both, as a sentence begins. */
export function sameWords(same: readonly DuplicateField[]): string {
  const words = {
    serialNumber: 'gleiche Seriennummer',
    mark: 'gleiches Kennzeichen',
  } as const satisfies Readonly<Record<DuplicateField, string>>
  const said = duplicateFields
    .filter((field) => same.includes(field))
    .map((field) => words[field])
    .join(' und ')

  return said.charAt(0).toUpperCase() + said.slice(1)
}

/**
 * An asset that may be the one somebody is entering, as the route answers:
 * enough to name it and to open its file, and the fields it shares.
 */
export interface AssetDuplicate extends Pick<
  Asset,
  | 'id'
  | 'number'
  | 'name'
  | 'kind'
  | 'propertyId'
  | 'buildingId'
  | 'roomId'
  | 'serialNumber'
  | 'mark'
> {
  readonly same: readonly DuplicateField[]
}

/** The package whose asset kinds stand in for a missing specialist package, one per cost group. */
export const generalPackage = 'allgemein'

/**
 * Whether an asset kind is the general one of its cost group (section 4.2):
 * the kind an asset carries until the package that describes it is there.
 * Such a kind has no duty kinds, and the asset is corrected to its own kind
 * once the package arrives.
 */
export function isGeneralKind(key: string): boolean {
  return key.startsWith(`${generalPackage}.`)
}
