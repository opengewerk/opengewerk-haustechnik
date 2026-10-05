import {
  type AssetField,
  type AssetKind,
  type AssetValue,
  type Characteristic,
  ruleUnitEntry,
} from '@opengewerk/haustechnik-domain'

/**
 * The values of an asset between a form and the data model. A form holds
 * text, an asset holds what its kind says: a whole number of the smallest
 * step of a unit for a characteristic, a figure for a field, yes or no, the
 * value of a choice, a day. Both entries fill in the same fields, so both
 * read them here.
 *
 * What cannot be read as what the kind asks for is handed on as it was typed:
 * the model in `domain` then says the sentence, the same one the server would.
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

/** How many decimal places a person types of a figure: those of its unit for a characteristic. */
function placesOf(entry: KindField): number | null {
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

const figure = /^-?\d+(?:[.,]\d+)?$/

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

/** A whole number of steps as a person reads it: 600 tenths are "60,0". */
function typedSteps(value: number, places: number): string {
  if (places === 0 || !Number.isInteger(value)) {
    return String(value).replace('.', ',')
  }

  const digits = String(Math.abs(value)).padStart(places + 1, '0')

  return `${value < 0 ? '-' : ''}${digits.slice(0, -places)},${digits.slice(-places)}`
}

/** What a field of the kind shows for the value an asset holds. */
function typedOf(entry: KindField, value: AssetValue | undefined): string {
  if (value === undefined) {
    return ''
  }

  if (typeof value === 'number') {
    const places = placesOf(entry)

    return places === null ? String(value).replace('.', ',') : typedSteps(value, places)
  }

  return String(value)
}

/** The fields of a kind as text, from the values of an asset; a field without a value is empty. */
export function typedValues(
  kind: AssetKind,
  values: Readonly<Record<string, AssetValue>>,
): Record<string, string> {
  return Object.fromEntries(
    kindFields(kind).map((entry) => [entry.field.key, typedOf(entry, values[entry.field.key])]),
  )
}

/**
 * The values of an asset from what was typed into the fields of its kind. An
 * empty field is no value. What a field of another kind held is left out: an
 * asset whose kind was corrected does not keep what only the wrong one had.
 */
export function valuesOf(
  kind: AssetKind,
  typed: Readonly<Record<string, string>>,
): Record<string, AssetValue> {
  const values: Record<string, AssetValue> = {}

  for (const entry of kindFields(kind)) {
    const said = (typed[entry.field.key] ?? '').trim()

    if (said === '') {
      continue
    }

    switch (entry.field.kind) {
      case 'number': {
        const places = placesOf(entry)

        values[entry.field.key] = !figure.test(said)
          ? said
          : places === null
            ? Number(said.replace(',', '.'))
            : stepsOf(said, places)
        break
      }
      case 'flag':
        values[entry.field.key] = said === 'true' ? true : said === 'false' ? false : said
        break
      default:
        values[entry.field.key] = said
    }
  }

  return values
}
