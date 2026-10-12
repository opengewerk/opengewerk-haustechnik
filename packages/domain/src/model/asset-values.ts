import { type AssetField, type AssetKind, type Characteristic, ruleUnitEntry } from './catalogue.js'

/**
 * The fields an asset kind brings beyond those every asset has, as whoever
 * writes into them needs them: a form in the office or on site, and a column
 * of a list (#172). An asset holds what its kind says: a whole number of the
 * smallest step of a unit for a characteristic, a figure for a field, yes or
 * no, the value of a choice, a day. A form and a list read a figure here, so
 * both come to the same number.
 */

/** One of the fields a kind brings, a characteristic or a field of its own. */
export type KindField =
  | { readonly of: 'characteristic'; readonly field: Characteristic }
  | { readonly of: 'field'; readonly field: AssetField }

/** The fields of a kind in the order a form shows them: what a duty may ask about first. */
export function kindFields(kind: AssetKind): readonly KindField[] {
  return [
    ...kind.characteristics.map((field) => ({ of: 'characteristic', field }) as const),
    ...kind.fields.map((field) => ({ of: 'field', field }) as const),
  ]
}

/**
 * How many decimal places a person writes of a figure: those of its unit for
 * a characteristic. A field of its own is compared with nothing and takes a
 * figure as it is written, which is null here.
 */
export function stepPlacesOf(entry: KindField): number | null {
  return entry.of === 'characteristic' && entry.field.kind === 'number'
    ? ruleUnitEntry(entry.field.unit).places
    : null
}

/** What stands behind the field of a figure, "kW" or "l", or nothing. */
export function unitOf(entry: KindField): string | undefined {
  if (entry.field.kind !== 'number') {
    return undefined
  }

  const unit =
    entry.of === 'characteristic' ? ruleUnitEntry(entry.field.unit).symbol : entry.field.unit

  return unit === undefined || unit === '' ? undefined : unit
}

/**
 * A figure as it is typed in German, "7,5" as well as "7.5", in whole steps
 * of so many decimal places: "60,0" in tenths is 600. Worked out on the
 * digits, because 0.07 times 100 is not 7 in a computer. A figure with more
 * places than the unit has is no whole number of steps, and is handed back as
 * the fraction it is.
 */
export function stepsOf(typed: string, places: number): number {
  const [whole = '', fraction = ''] = typed.replace('-', '').split(/[.,]/)
  const sign = typed.startsWith('-') ? -1 : 1

  if (fraction.length > places && /[1-9]/.test(fraction.slice(places))) {
    return sign * Number(`${whole}${fraction.slice(0, places)}.${fraction.slice(places)}`)
  }

  return sign * Number(`${whole}${fraction.slice(0, places).padEnd(places, '0')}`)
}
