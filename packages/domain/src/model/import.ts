import type { Id } from '@opengewerk/platform-domain'

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

/** What an import takes over: the places from the property down to the room, or assets into them. */
export const importKinds = ['structure', 'assets'] as const

export type ImportKind = (typeof importKinds)[number]

export const importKindLabel: Readonly<Record<ImportKind, string>> = {
  structure: 'Liegenschaften, Gebäude, Geschosse und Räume',
  assets: 'Anlagen',
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
