import type { AssetKind, ExpectedDemand } from './catalogue.js'
import type { DocumentKind } from './document.js'

/**
 * An expected document that says what fulfils it (#347, section 4.10 of the
 * concept): every one of a version in force does. One written before #347
 * stands only in a version that is never in force and is left out here.
 */
export interface Expectation {
  readonly key: string
  readonly label: string
  readonly kind: DocumentKind
  readonly demand: ExpectedDemand
  readonly source: string | null
}

/** The expected documents of a kind of asset that say what fulfils them, in the order of the package. */
export function expectationsOf(kind: Pick<AssetKind, 'expectedDocuments'> | null): Expectation[] {
  if (kind === null) {
    return []
  }

  return kind.expectedDocuments.flatMap((expected) =>
    expected.kind === null || expected.demand === null
      ? []
      : [
          {
            key: expected.key,
            label: expected.label,
            kind: expected.kind,
            demand: expected.demand,
            source: expected.source,
          },
        ],
  )
}

/** An expected document and the document at the asset that fulfils it, if one does. */
export interface ExpectationState<Document> {
  readonly expected: Expectation
  readonly document: Document | null
}

/**
 * Which expected documents of an asset are there (#347): one is, when a
 * document of its kind hangs on the asset itself. A box ticked by hand
 * fulfils none, and neither does a document at the room or the building of
 * the asset; the same file may lie at many assets, once at each.
 *
 * The documents are those of the asset that are not removed, in the order
 * they are shown in: the first of a kind is the one named. A document without
 * a kind, the photo of a type plate, fulfils none.
 */
export function expectedDocumentsAt<Document extends { readonly kind: DocumentKind | null }>(
  kind: Pick<AssetKind, 'expectedDocuments'> | null,
  documents: readonly Document[],
): ExpectationState<Document>[] {
  return expectationsOf(kind).map((expected) => ({
    expected,
    document: documents.find((document) => document.kind === expected.kind) ?? null,
  }))
}

/** What an asset lacks of what its kind expects, given the kinds of the documents that hang on it. */
export function lackingDocuments(
  kind: Pick<AssetKind, 'expectedDocuments'> | null,
  kindsThere: Iterable<DocumentKind | null>,
): Expectation[] {
  const there = new Set(kindsThere)

  return expectationsOf(kind).filter((expected) => !there.has(expected.kind))
}

/**
 * The filter of the register by the documents (#347): every asset that lacks
 * any of them, or one the package requires.
 */
export const documentFilters = ['missing', 'required_missing'] as const

export type DocumentFilter = (typeof documentFilters)[number]

/** What the filter says in the register. */
export const documentFilterLabel: Readonly<Record<DocumentFilter, string>> = {
  missing: 'Es fehlen welche',
  required_missing: 'Es fehlen verlangte',
}

/** Whether what an asset lacks passes the filter. */
export function lacksFor(
  filter: DocumentFilter,
  lacking: readonly Pick<Expectation, 'demand'>[],
): boolean {
  return filter === 'missing'
    ? lacking.length > 0
    : lacking.some((expected) => expected.demand === 'required')
}

/**
 * What an asset lacks, in a line: each document by its label, a required one
 * with "(verlangt)", in the order of the package. The register shows it under
 * the asset and its table in a column of its own.
 */
export function lackingWords(lacking: readonly Pick<Expectation, 'label' | 'demand'>[]): string {
  return lacking
    .map((expected) =>
      expected.demand === 'required' ? `${expected.label} (verlangt)` : expected.label,
    )
    .join(', ')
}
