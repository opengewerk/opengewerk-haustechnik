import type { IsoDate } from '@opengewerk/platform-domain'

import { assetConditionLabel, type AssetEntry, type AssetStanding } from './asset-condition.js'
import { lifecycleStateLabel } from './asset.js'
import type { PlaceToDo } from './overview.js'

/**
 * The lists of the office as tables (#138, section 3 of the concept): "Als
 * Tabelle" gives what the list shows under its filter, in its order, under
 * its columns. The server writes the table, so that it also holds a list
 * that is read a page at a time, and reads it under the rights and in the
 * areas of the person, as it reads the list.
 *
 * What a column is called and what stands in it is said here once, for the
 * list on the screen and for the route that writes its table. A table never
 * holds more than its list: no field the list does not show, and none of the
 * stamp of the last change, which stays on the server (#157).
 */

/** A row of a table as it goes out: text, a number, or nothing. */
export type TableRow = readonly (string | number | null)[]

/** A day as the office writes it: 24.09.2028. */
export function dayInWords(day: IsoDate): string {
  const [year, month, date] = day.split('-')

  return `${date ?? ''}.${month ?? ''}.${year ?? ''}`
}

/** The condition of an asset in words: "In Ordnung bis 24.09.2028" for one in order with a day. */
export function conditionWords(standing: AssetStanding): string {
  return standing.condition === 'in_order' && standing.until !== null
    ? `${assetConditionLabel.in_order} bis ${dayInWords(standing.until)}`
    : assetConditionLabel[standing.condition]
}

/** "Schulzentrum Am Lindenhain, Schulhaus, E.14": the parts there are, in their order. */
export function placeWords(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part) => part !== null && part !== undefined && part !== '').join(', ')
}

// --- The register of assets -------------------------------------------------------------------

/** The columns of the register of assets, as the list heads them (4.2). */
export const assetTableColumns = [
  'Nummer',
  'Anlage',
  'Anlagenart',
  'Standort',
  'Zustand',
  'Lebenszyklus',
] as const

/**
 * An asset of the register as a row of its table: what its columns show.
 * The kind and the place come in as words, as the list reads them: the kind
 * from the catalogue, the place from the property, the building and the
 * room. An asset without an entry in its life cycle has an empty cell, as
 * the list shows none.
 */
export function assetTableRow(entry: AssetEntry, kind: string, place: string): TableRow {
  return [
    entry.number,
    entry.name,
    kind,
    place,
    conditionWords(entry),
    entry.lifecycleState === null ? null : lifecycleStateLabel[entry.lifecycleState],
  ]
}

// --- The properties ---------------------------------------------------------------------------

/** What each number of a place is called, in the order the list shows them (#121). */
export const toDoNumbers: readonly { readonly key: keyof PlaceToDo; readonly label: string }[] = [
  { key: 'overdue', label: 'Überfällig' },
  { key: 'due', label: 'Fällig' },
  { key: 'neverRecorded', label: 'Nie erfasst' },
  { key: 'openDefects', label: 'Offene Mängel' },
  { key: 'missingReadings', label: 'Zählerstände fehlen' },
]

/**
 * The more urgent place first: more overdue, then more never recorded, more
 * open defects, more due and more readings missing. A place without numbers
 * counts as nothing to do.
 */
export function byUrgency(left: PlaceToDo | undefined, right: PlaceToDo | undefined): number {
  for (const key of [
    'overdue',
    'neverRecorded',
    'openDefects',
    'due',
    'missingReadings',
  ] as const) {
    const difference = (right?.[key] ?? 0) - (left?.[key] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

/** Two names in the order a German list sorts them. */
export function byNameIn(left: string, right: string): number {
  return left.localeCompare(right, 'de')
}

/** Where a property is, as the list writes it under its name. */
export interface PropertyAddress {
  readonly street: string
  readonly postalCode: string
  readonly city: string
}

/** "Musterweg 1, 00001 Beispielstadt". */
export function addressWords(property: PropertyAddress): string {
  return `${property.street}, ${property.postalCode} ${property.city}`
}

/** What the search of the list finds a property by: its name, where it is, and its buildings. */
export function propertySearchText(
  property: PropertyAddress & { readonly name: string },
  buildingNames: readonly string[],
): string {
  return [property.name, property.street, property.postalCode, property.city, ...buildingNames]
    .join(' ')
    .toLocaleLowerCase('de')
}

/** What a search typed into the list looks for, as the list compares it. */
export function searchedFor(typed: string): string {
  return typed.trim().toLocaleLowerCase('de')
}

/**
 * The columns of the properties as a table. The list shows a property with
 * its address under its name and its buildings indented under it; a table
 * gives each its own column, and every row of a building names the property
 * it stands on, so that a row says where it is wherever a spreadsheet sorts
 * it. The area stands where the list shows it, for whoever sees more than
 * one, and the numbers where the person may read them.
 */
export const propertyTableColumns = {
  property: 'Liegenschaft',
  building: 'Gebäude',
  address: 'Adresse',
  area: 'Bereich',
} as const
