import type { IsoDate } from '@opengewerk/platform-domain'

import type { ImportKind } from './import.js'

/**
 * The tables an import of places and assets writes (#100), and of which the
 * database keeps what each import made (#174): a row of `import_records` for
 * every record, written by a trigger while the import writes.
 */
export const importedTables = ['properties', 'buildings', 'floors', 'rooms', 'assets'] as const

export type ImportedTable = (typeof importedTables)[number]

/** What a record says of where it came from, over its log: the import that made it. */
export interface ImportOrigin {
  readonly importId: string
  readonly fileName: string
  readonly importedOn: IsoDate
}

/** A record an import made, as its page lists it: what it is and what it is called. */
export interface ImportedRecord {
  readonly table: ImportedTable
  readonly id: string
  readonly title: string
}

/**
 * An import as its page reads it (#174): the file, its lines and what came of
 * them, and the records it made that are still there, in the areas of the
 * person asking, places before assets.
 */
export interface ImportReading {
  readonly id: string
  readonly kind: ImportKind
  readonly fileName: string
  readonly lines: number
  readonly summary: string
  readonly importedOn: IsoDate
  readonly records: readonly ImportedRecord[]
}
