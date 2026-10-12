import {
  type ColumnMapping,
  columnLetters,
  dayOfCell,
  type TableColumn,
  tableColumns,
  type TableField,
  type TableSheet,
} from '@opengewerk/platform-domain'

import type { AssetValue } from './asset.js'
import { type KindField, kindFields, stepPlacesOf, stepsOf, unitOf } from './asset-values.js'
import type { AssetKind, ChoiceOption } from './catalogue.js'
import { nameKey } from './import.js'

/**
 * What only an asset kind has, read from a list (#172, sections 4.2 and 11
 * of the concept): the extinguishing agent of a fire extinguisher, the rated
 * output of a heater.
 *
 * Such a field hangs on the asset kind, and which kind a line means stands
 * only after its words were given one. So the columns the first step left
 * out are given to fields a second time, once for each asset kind: the
 * column "Füllmenge kg" is the charge of a fire extinguisher and nothing to
 * a lift. A column serves the kinds it was given to. What it holds in a line
 * of another kind is not taken over and is named in the preview, and holds
 * nothing back (decided on 11.10.2026): a list keeps such a column for a
 * part of its lines.
 *
 * A cell is read as a list writes it and then held against its field by the
 * rule a form is held against (`assetValueProblems`). Nothing is guessed: a
 * figure with a point could be a fraction or a thousand, so it is none.
 */

/** Which column each field of an asset kind is read from, by the key of the kind. */
export type KindColumns = Readonly<Record<string, ColumnMapping>>

/** The columns that hold what only an asset kind has, with the sheet they are read from. */
export interface KindCells {
  readonly sheet: TableSheet
  readonly columns: KindColumns
}

/** The columns the first step gave no field: what is left for the fields of the asset kinds. */
export function freeColumns(sheet: TableSheet, mapping: ColumnMapping): readonly TableColumn[] {
  const taken = new Set(Object.values(mapping))

  return tableColumns(sheet).filter((column) => !taken.has(column.index))
}

/**
 * The fields of a kind as a column can be given them, called what a list
 * calls them: a figure by its name alone or with its unit behind it,
 * "Füllmenge", "Füllmenge kg" and "Füllmenge in kg".
 */
export function kindColumnFields(kind: AssetKind): readonly TableField[] {
  return kindFields(kind).map((entry) => {
    const { key, label } = entry.field
    const unit = unitOf(entry)

    return unit === undefined
      ? { key, label }
      : { key, label, names: [`${label} ${unit}`, `${label} in ${unit}`] }
  })
}

/** The most options a hint spells out; a choice among more names how many more there are. */
const optionsNamed = 6

function optionWords(options: readonly ChoiceOption[]): string {
  const named = options.slice(0, optionsNamed).map((option) => option.label)
  const more = options.length - named.length

  return more > 0 ? `${named.join(', ')} und ${String(more)} weitere` : named.join(', ')
}

/** What a column for a field holds, in a few words, for whoever gives it one. */
export function cellHint(entry: KindField): string {
  const { field } = entry

  switch (field.kind) {
    case 'number': {
      const unit = unitOf(entry)

      return unit === undefined ? 'Zahl' : `Zahl in ${unit}`
    }
    case 'flag':
      return 'ja oder nein'
    case 'choice':
      return `Auswahl: ${optionWords(field.options)}`
    case 'date':
      return 'Tag'
    case 'text':
      return 'Text'
  }
}

/** What a cell holds for a field: the value as an asset keeps it, or the sentence about a cell that cannot be read. */
export type CellValue = { readonly value: AssetValue } | { readonly problem: string }

/**
 * The figure a cell begins with, as a list writes it: "7,5" or "1200". What
 * stands behind it, as in "6 kg", is cut off by the length of the figure and
 * not matched. An expression that takes the rest as well tries a run of
 * spaces before a line break once for every space in it, and a cell is
 * whatever a request sends.
 */
const figure = /^-?\d+(?:,\d+)?/

/** A unit as it is compared: "m3" is "m³" to whoever typed it. */
const unitKey = (unit: string) => nameKey(unit).replace('²', '2').replace('³', '3')

/**
 * The value a cell holds for a field of a kind. A choice is read by the
 * label of its option or by its value, a day as a list or a program writes
 * it, yes and no as "ja" and "nein", which is also what a cell of a
 * workbook that holds one of the two arrives as. What is none of these is
 * handed on as it stands, and the rule of the asset says the sentence a
 * form would get.
 *
 * A figure is the exception. It is written with a comma and without a point
 * between the thousands, alone or with the unit of its field behind it:
 * "1.200" may be a thousand and two hundred or one and a fifth, and "7500 W"
 * is no figure in kW. Neither is worked out; the sentence says how a figure
 * stands.
 */
export function cellValue(entry: KindField, cell: string): CellValue {
  const { field } = entry

  switch (field.kind) {
    case 'number': {
      const unit = unitOf(entry)
      const places = stepPlacesOf(entry)
      const [digits] = figure.exec(cell) ?? []
      const behind = digits === undefined ? '' : cell.slice(digits.length).trim()

      if (
        digits === undefined ||
        (behind !== '' && (unit === undefined || unitKey(behind) !== unitKey(unit)))
      ) {
        return {
          problem:
            `${field.label} ist eine Zahl${unit === undefined ? '' : ` in ${unit}`}, ` +
            `geschrieben mit Komma und ohne Tausenderpunkt wie ${places === 0 ? '1200' : '1200 oder 7,5'}, ` +
            `und nicht „${cell}“.`,
        }
      }

      return { value: places === null ? Number(digits.replace(',', '.')) : stepsOf(digits, places) }
    }
    case 'flag': {
      const said = nameKey(cell)

      return { value: said === 'ja' ? true : said === 'nein' ? false : cell }
    }
    case 'choice': {
      const said = nameKey(cell)
      const option =
        field.options.find((each) => nameKey(each.label) === said) ??
        field.options.find((each) => nameKey(each.value) === said)

      return { value: option?.value ?? cell }
    }
    case 'date':
      return { value: dayOfCell(cell) ?? cell }
    case 'text':
      return { value: cell }
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Why what came over the wire is no choice of columns for the fields of
 * asset kinds, or null. A request that names none has none. Every kind is
 * one of the catalogue and every field one of its kind; a column is one of
 * the sheet that the first step left free, and within a kind it is one field
 * and no second. Two kinds may read the same column: a rated output is one
 * for a heater and for a pump.
 */
export function kindColumnsProblem(
  value: unknown,
  kindOf: (key: string) => AssetKind | null,
  mapping: ColumnMapping,
  sheet: TableSheet,
): string | null {
  if (value === undefined) {
    return null
  }

  const shape =
    'Die Felder einer Anlagenart stehen als Anlagenart mit ihren Feldern und deren Spalten.'

  if (!isRecord(value)) {
    return shape
  }

  const columns = new Set(tableColumns(sheet).map((column) => column.index))
  const everyAsset = new Set(Object.values(mapping))

  for (const [kindKey, fields] of Object.entries(value)) {
    const kind = kindOf(kindKey)

    if (kind === null) {
      return `Die Anlagenart ${kindKey} kennt kein Paket des Katalogs.`
    }

    if (!isRecord(fields)) {
      return shape
    }

    const known = new Map(kindFields(kind).map((entry) => [entry.field.key, entry.field.label]))
    const taken = new Set<number>()

    for (const [fieldKey, index] of Object.entries(fields)) {
      const label = known.get(fieldKey)

      if (label === undefined) {
        return `Das Feld ${fieldKey} hat die Anlagenart ${kind.label} nicht.`
      }

      if (typeof index !== 'number' || !columns.has(index)) {
        return `Die Spalte für „${label}“ gibt es in der Datei nicht.`
      }

      if (everyAsset.has(index)) {
        return `Die Spalte ${columnLetters(index)} ist schon im ersten Schritt einem Feld zugeordnet.`
      }

      if (taken.has(index)) {
        return `Die Spalte ${columnLetters(index)} ist zwei Feldern der Anlagenart ${kind.label} zugeordnet.`
      }

      taken.add(index)
    }
  }

  return null
}
