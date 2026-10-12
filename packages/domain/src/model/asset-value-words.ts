import type { AssetValue } from './asset.js'
import {
  type AssetField,
  type Catalogue,
  type CatalogueEntry,
  type AssetKind,
  type Characteristic,
  type ChoiceOption,
  ruleValueWords,
} from './catalogue.js'

/**
 * What an asset holds beyond the fields every asset has, in words a person
 * reads (ADR 0002, point 6): the characteristics and fields of its kind, each
 * a key and a value in one column of JSON. The file of an asset writes them
 * this way, and so does the change log (#263), which holds the column as it
 * is and showed `{"stops": 5, "firefighters_lift": false}`.
 */

/** Yes or no, the label of a choice, or the value as it is. */
function plainWords(
  of: { readonly kind: string; readonly options?: readonly ChoiceOption[] },
  value: AssetValue,
): string {
  if (typeof value === 'boolean') {
    return value ? 'Ja' : 'Nein'
  }

  return of.options?.find((option) => option.value === value)?.label ?? String(value)
}

/** The value of a characteristic: a number counts in a unit of the rule engine. */
export function characteristicValueWords(of: Characteristic, value: AssetValue): string {
  return of.kind === 'number' && typeof value === 'number'
    ? ruleValueWords(value, of.unit)
    : plainWords(of, value)
}

/**
 * The value of a field of the kind: a number with the unit the field names, a
 * day as whoever reads writes a day. A number without a unit is written as it
 * is: it may be a year or a count, and "2.021" is neither.
 */
export function assetFieldValueWords(
  of: AssetField,
  value: AssetValue,
  day: (value: string) => string,
): string {
  if (of.kind === 'number' && typeof value === 'number') {
    return of.unit === undefined ? String(value) : `${value.toLocaleString('de-DE')} ${of.unit}`
  }

  return of.kind === 'date' ? day(String(value)) : plainWords(of, value)
}

/** How one key of the column is written: what it is called, and its value in words. */
interface Written {
  readonly label: string
  readonly words: (value: AssetValue, day: (value: string) => string) => string
}

/**
 * Every key the kinds of a catalogue name, each as its newest version writes
 * it. The log holds the column without the kind beside it, so a key is read
 * the way the first kind that names it reads it; kinds that share a key mean
 * the same by it.
 */
function writtenByKey(catalogue: Catalogue): ReadonlyMap<string, Written> {
  const newest = new Map<string, CatalogueEntry<AssetKind>>()

  for (const entry of catalogue.bundle.packages.flatMap((each) => each.assetKinds)) {
    const held = newest.get(entry.key)

    if (held === undefined || entry.version > held.version) {
      newest.set(entry.key, entry)
    }
  }

  const written = new Map<string, Written>()

  for (const { definition } of newest.values()) {
    for (const each of definition.characteristics) {
      if (!written.has(each.key)) {
        written.set(each.key, {
          label: each.label,
          words: (value) => characteristicValueWords(each, value),
        })
      }
    }

    for (const each of definition.fields) {
      if (!written.has(each.key)) {
        written.set(each.key, {
          label: each.label,
          words: (value, day) => assetFieldValueWords(each, value, day),
        })
      }
    }
  }

  return written
}

function isAssetValue(value: unknown): value is AssetValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * The column as a sentence, "Feuerwehraufzug: Nein, Haltestellen: 5", in the
 * order of what the keys are called. A key no kind of the catalogue names
 * stays a key with its value, an asset that holds nothing reads as an empty
 * text, and what is no such column at all is null: it stays as it is written.
 */
export function assetValuesWords(
  catalogue: Catalogue,
): (raw: string, day: (value: string) => string) => string | null {
  const written = writtenByKey(catalogue)

  return (raw, day) => {
    let held: unknown

    try {
      held = JSON.parse(raw)
    } catch {
      return null
    }

    if (typeof held !== 'object' || held === null || Array.isArray(held)) {
      return null
    }

    return Object.entries(held)
      .filter((entry): entry is [string, AssetValue] => isAssetValue(entry[1]))
      .map(([key, value]) => {
        const known = written.get(key)

        return known ? `${known.label}: ${known.words(value, day)}` : `${key}: ${String(value)}`
      })
      .sort((one, other) => one.localeCompare(other, 'de'))
      .join(', ')
  }
}
