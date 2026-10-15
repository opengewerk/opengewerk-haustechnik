import {
  type AssetKind,
  type AssetValue,
  byNameIn,
  type Catalogue,
  type KindField,
  kindFields,
  stepPlacesOf as placesOf,
  stepsOf,
} from '@opengewerk/haustechnik-domain'
import { today } from '@opengewerk/platform-web/format'

/**
 * The values of an asset between a form and the data model. A form holds
 * text, an asset holds what its kind says: a whole number of the smallest
 * step of a unit for a characteristic, a figure for a field, yes or no, the
 * value of a choice, a day. Both entries fill in the same fields, so both
 * read them here.
 *
 * What cannot be read as what the kind asks for is handed on as it was typed:
 * the model in `domain` then says the sentence, the same one the server would.
 *
 * Which fields a kind brings and how a figure counts in the steps of its
 * unit stands in `domain`, where the import of a list reads them as well
 * (#172); the screens take them from here as before.
 */
export { type KindField, kindFields, stepsOf, unitOf } from '@opengewerk/haustechnik-domain'

const figure = /^-?\d+(?:[.,]\d+)?$/

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

/**
 * The kinds of the catalogue in force today, by package and then by name:
 * "Trinkwasser: Trinkwassererwärmung", and "Allgemein: Förderanlage" for an
 * asset whose package is not there yet.
 */
export function kindChoices(
  catalogue: Catalogue,
): readonly { readonly value: string; readonly label: string }[] {
  return catalogue.contents(today()).flatMap((contents) =>
    contents.assetKinds
      .map((entry) => ({
        value: entry.key,
        label: `${contents.title}: ${entry.definition.label}`,
      }))
      .sort((left, right) => byNameIn(left.label, right.label)),
  )
}

/** The year as the model wants it: nothing, a whole number, or what was typed for the model to refuse. */
export function yearOf(typed: string): number | string | null {
  const said = typed.trim()

  return said === '' ? null : /^\d+$/.test(said) ? Number(said) : said
}

/** What a screen on site says about a general asset kind, in a line. */
export const generalKindNote =
  'Allgemeine Anlagenart: für diese Anlage fehlt noch das Fachpaket, und der Katalog schlägt für sie keine Pflichten vor.'
