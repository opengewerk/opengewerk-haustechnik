/**
 * What the page "PDF prüfen" says of a PDF laid before somebody (#457,
 * section 2.6 of the concept): whether it is byte for byte a print kept here,
 * and whether it carries the signature of this instance, unchanged since.
 * The file is read, never kept.
 */

/** What a kept print is the print of: an evidence, a round, a service report, or the PDF of an evidence with a higher signature. */
export type PdfKeptKind = 'evidence' | 'round' | 'service_report' | 'signed_evidence'

export interface PdfKept {
  readonly kind: PdfKeptKind
  /** The evidence it belongs to, for its page; null for a round or a service report. */
  readonly evidenceId: string | null
  /** The round or the work order it belongs to, for its page; null for an evidence. */
  readonly activityId: string | null
  /** What it is called: the number of the evidence, the title of the round or the work order. */
  readonly title: string
  /** Since when it is kept. */
  readonly keptAt: string
}

/** The signature of this instance in the file, the latest where there are several. */
export type PdfInstanceSignature =
  | { readonly state: 'none' }
  /** It covers the whole file and holds. */
  | { readonly state: 'unchanged'; readonly signedAt: string | null }
  /** It holds, and after it only signatures by others were added, the last over the whole file. */
  | {
      readonly state: 'signed_after'
      readonly signedAt: string | null
      /** Who signed after, as their certificates name them. */
      readonly by: readonly string[]
    }
  /** What it covers changed, or something other than a signature was added after it. */
  | { readonly state: 'changed'; readonly signedAt: string | null }

export interface PdfCheck {
  /** False for a file that is no PDF; then nothing else is said of it. */
  readonly pdf: boolean
  /** The print this file is, among what the person may see; null where it is none of them. */
  readonly kept: PdfKept | null
  readonly instance: PdfInstanceSignature
}

/** The media type the page sends the file in. */
export const pdfCheckType = 'application/pdf'

export const pdfCheckWords = {
  wrongType: 'Geprüft wird ein PDF.',
  tooLarge: 'Diese Datei ist größer, als ein PDF hier sein darf.',
  empty: 'Die Datei ist leer.',
} as const
