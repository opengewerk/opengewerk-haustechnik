import type { Id, TableField } from '@opengewerk/platform-domain'

import { duplicateKey } from './asset-duplicate.js'
import type { BuildingId, PropertyId } from './location.js'

/**
 * What every import from a table has in common (#100, section 11 of the
 * concept): a plan before anything is written, and one line in the log
 * after.
 *
 * A table is taken over whole or not at all. So an import is a plan first:
 * what its lines would make, which of them cannot be read, and which name
 * something that is there already. The plan is worked out from the table and
 * from what the person importing can see, it writes nothing, and the page
 * shows it as the preview. Taking over works the plan out again inside the
 * transaction that writes, and writes only a plan without a problem.
 */

export type ImportId = Id<'import'>

/**
 * What an import takes over: the places from the property down to the room,
 * assets into them, the running deadlines of a predecessor application with
 * its old evidence, the history of its meters, or the templates of its
 * rounds (#130).
 */
export const importKinds = ['structure', 'assets', 'deadlines', 'meters', 'templates'] as const

export type ImportKind = (typeof importKinds)[number]

export const importKindLabel: Readonly<Record<ImportKind, string>> = {
  structure: 'Liegenschaften, Gebäude, Geschosse und Räume',
  assets: 'Anlagen',
  deadlines: 'Laufende Fristen und alte Nachweise',
  meters: 'Zählerstände, Zählertausche und Stilllegungen',
  templates: 'Vorlagen der Rundgänge',
}

/**
 * An import as the tenant keeps it: the file, how many of its lines were
 * read and what came of them in words. It is written once, in the
 * transaction that writes its records, and never changed; it is what the
 * change log shows of the import, one entry in the place of one for every
 * record (migration 0022).
 */
export interface Import {
  readonly id: ImportId
  readonly tenantId: Id<'tenant'>
  readonly kind: ImportKind
  readonly fileName: string
  readonly lines: number
  readonly summary: string
  readonly createdAt: Date
}

export const importLimits = { fileName: 200, summary: 500 } as const

/** Something in a table that has to be put right before any of it is taken over. */
export interface ImportProblem {
  /** The lines of the file it is about. */
  readonly lines: readonly number[]
  readonly what: string
  /** What to do about it. */
  readonly next: string
}

/** What to do about a line that says too little or something that cannot be. */
export const correctTheFile = 'In der Datei berichtigen und neu hochladen'

/**
 * The problems of a table while a plan is worked out. The same thing wrong
 * in many lines is one problem with all of them, so that a column that is
 * empty all the way down is one line of the preview and not four hundred.
 */
export class ImportProblems {
  private readonly found = new Map<string, { lines: number[]; what: string; next: string }>()

  /** How often something was found, for a caller that asks whether a line added anything. */
  added = 0

  add(line: number | readonly number[], what: string, next: string = correctTheFile): void {
    this.added += 1

    const key = `${what}\u0000${next}`
    const known = this.found.get(key) ?? { lines: [], what, next }

    known.lines.push(...(typeof line === 'number' ? [line] : line))
    this.found.set(key, known)
  }

  /** A sentence of the model about a record, as a line of the preview: without its full stop, behind what it is about. */
  addSentence(line: number, about: string, sentence: string, next: string = correctTheFile): void {
    this.add(line, `${about}: ${sentence.replace(/\.$/, '')}`, next)
  }

  /** In the order of the lines they were first found in. */
  list(): ImportProblem[] {
    return [...this.found.values()]
      .map((problem) => ({ ...problem, lines: [...new Set(problem.lines)].sort((a, b) => a - b) }))
      .sort((one, other) => (one.lines[0] ?? 0) - (other.lines[0] ?? 0))
  }
}

/**
 * Something a table says that is not taken over, and that holds nothing
 * back (#172): what a column holds in a line it does not apply to. It is
 * said so that nobody finds out at the asset, weeks later.
 */
export interface ImportNote {
  /** The lines of the file it is about. */
  readonly lines: readonly number[]
  /** The column it stands in, as the file calls it. */
  readonly column: string
  readonly why: string
}

/** The notes of a table while a plan is worked out; the same about many lines is one note with all of them. */
export class ImportNotes {
  private readonly found = new Map<string, { lines: number[]; column: string; why: string }>()

  add(line: number, column: string, why: string): void {
    const key = `${column}\u0000${why}`
    const known = this.found.get(key) ?? { lines: [], column, why }

    known.lines.push(line)
    this.found.set(key, known)
  }

  /** In the order of the lines they were first found in. */
  list(): ImportNote[] {
    return [...this.found.values()]
      .map((note) => ({ ...note, lines: [...new Set(note.lines)].sort((a, b) => a - b) }))
      .sort((one, other) => (one.lines[0] ?? 0) - (other.lines[0] ?? 0))
  }
}

/** How a name is compared with another: without its spaces and in lower case, as a serial number is. */
export function nameKey(name: string): string {
  return name.replace(/\s+/gu, '').toLowerCase()
}

/** A count with its noun: "1 Raum", "396 Räume". */
export function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString('de-DE')} ${count === 1 ? one : many}`
}

/** Parts as a sentence lists them: "a", "a und b", "a, b und c". */
export function listed(parts: readonly string[]): string {
  return parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1] ?? ''}`
}

/**
 * Whether two plans come to the same: what a page saw in the preview against
 * what the take-over would write now. Between the two somebody else may have
 * made the building a line names, and then the page is told to look again
 * instead of getting something other than it was shown.
 */
export function sameCounts(expected: unknown, counts: Readonly<Record<string, number>>): boolean {
  return (
    typeof expected === 'object' &&
    expected !== null &&
    Object.entries(counts).every(
      ([key, count]) => (expected as Readonly<Record<string, unknown>>)[key] === count,
    )
  )
}

/** What a route says when the plan is no longer the one that was shown. */
export const planChanged =
  'Der Bestand hat sich seit der Vorschau geändert. Sehen Sie die Vorschau noch einmal an.'

/** What a route says to a table with problems; the preview has said which. */
export const planHasProblems =
  'Die Tabelle hat Zeilen, die vor der Übernahme zu klären sind. Es wurde nichts übernommen.'

/** What a route says to a table that would make nothing. */
export const planMakesNothing = 'In der Tabelle steht nichts, was es nicht schon gibt.'

/**
 * A property and a building chosen for every line that names none (#173): a
 * list for one house often names it only in the name of its file. A line
 * that names one goes first; the choice fills only what is empty.
 */
export interface ChosenPlace {
  readonly propertyId: PropertyId | null
  readonly buildingId: BuildingId | null
}

/** The choice out of what came over the wire: what is no id is left out, and no building without its property. */
export function chosenPlaceOf(value: unknown): ChosenPlace {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Readonly<
    Record<string, unknown>
  >
  const id = (key: string) =>
    typeof given[key] === 'string' && given[key] !== '' ? given[key] : null
  const propertyId = id('propertyId') as PropertyId | null

  return {
    propertyId,
    buildingId: propertyId === null ? null : (id('buildingId') as BuildingId | null),
  }
}

/** The fields of a table, with no column needed for what is chosen for all lines. */
export function fieldsWithChoice(
  fields: readonly TableField[],
  chosen: ChosenPlace,
): readonly TableField[] {
  const filled = new Set([
    ...(chosen.propertyId === null ? [] : ['property']),
    ...(chosen.buildingId === null ? [] : ['building']),
  ])

  return fields.map((field) => (filled.has(field.key) ? { ...field, required: false } : field))
}

/** What a line says whose chosen property or building is gone or out of sight. */
export const chosenPlaceGone = 'Die gewählte Liegenschaft gibt es nicht mehr'
export const chosenBuildingGone = 'Das gewählte Gebäude gibt es nicht mehr'
export const chooseAgain = 'Im ersten Schritt neu wählen'

/** Items by a key of theirs; an item whose key is null stands in no group. */
export function grouped<Item>(
  items: readonly Item[],
  key: (item: Item) => string | null,
): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()

  for (const item of items) {
    const group = key(item)

    if (group !== null) {
      groups.set(group, [...(groups.get(group) ?? []), item])
    }
  }

  return groups
}

/** An asset in a few words, for a line of the preview: its number, else its name. */
export function assetWords(asset: {
  readonly number: string | null
  readonly name: string
}): string {
  return asset.number ?? asset.name
}

/** A way a line names its asset: the field of the table, the word for it and the assets by it. */
export interface AssetNaming<Asset> {
  readonly field: string
  readonly word: string
  /** The article the word takes behind "mit". */
  readonly article: 'dem' | 'der'
  /** The assets by `duplicateKey` of what the field holds. */
  readonly index: ReadonlyMap<string, readonly Asset[]>
}

/**
 * The asset a line names (#130): by its number here, its mark, its serial
 * number, or whatever else a list may name one by. Whatever of them a line
 * gives has to mean the same asset, and one only; a mark that several assets
 * carry names none of them.
 */
export function namedAsset<Asset extends { readonly number: string | null; readonly name: string }>(
  line: number,
  cell: (field: string) => string,
  namings: readonly AssetNaming<Asset>[],
  problems: ImportProblems,
  missing: string,
): Asset | null {
  const given = namings.flatMap(({ field, word, article, index }) => {
    const key = duplicateKey(cell(field))

    return key === null ? [] : [{ word, article, value: cell(field), found: index.get(key) ?? [] }]
  })

  if (given.length === 0) {
    problems.add(line, missing)

    return null
  }

  for (const each of given) {
    if (each.found.length === 0) {
      problems.add(
        line,
        `Eine Anlage mit ${each.article} ${each.word} „${each.value}“ gibt es in Ihren Bereichen nicht`,
        'Die Anlagen zuerst importieren oder die Datei berichtigen',
      )

      return null
    }
  }

  const common = (given[0]?.found ?? []).filter((asset) =>
    given.every((each) => each.found.includes(asset)),
  )

  if (common.length === 0) {
    problems.add(
      line,
      `${listed(given.map((each) => `${each.word} „${each.value}“`))} gehören zu verschiedenen Anlagen`,
    )

    return null
  }

  if (common.length > 1) {
    problems.add(
      line,
      `${listed(given.map((each) => `${each.word} „${each.value}“`))} ${given.length === 1 ? 'trägt' : 'tragen'} mehr als eine Anlage: ${listed(common.map(assetWords))}`,
      'Die Anlagennummer nennen und neu hochladen',
    )

    return null
  }

  return common[0] ?? null
}
