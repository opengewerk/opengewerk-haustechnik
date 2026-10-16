import { PDFDocument, type PDFImage } from '@cantoo/pdf-lib'

// The register of evidence with its evidence behind it (#338, decided by
// Moritz on 15.10.2026): the list, then for every row with evidence the PDF
// the evidence keeps and the files it rests on, in one document, and every
// row names the page its evidence begins on. The PDFs behind the list are
// taken over page by page as they are kept, never printed anew, so that an
// inspection reads the same file the evidence hands out (ADR 0004).

/** What follows the list for one row: the print of its evidence and the files it rests on. */
export interface EvidenceAttachment<Key> {
  readonly key: Key
  readonly print: Uint8Array
  readonly files: readonly { readonly mediaType: string; readonly bytes: Uint8Array }[]
}

/** Where the evidence begins and how long the whole is, for the list to say. */
export interface AttachedPages<Key> {
  /** The page each row's evidence begins on, counted through the whole document. */
  readonly pages: ReadonlyMap<Key, number>
  /** The first page after the list. */
  readonly from: number
  readonly total: number
  /** The files that could not be taken over: encrypted, broken, or of a type no page shows. */
  readonly unattached: number
}

/** A4 upright in points, for a picture a report came as. */
const a4 = { width: 595.28, height: 841.89 } as const
const margin = 36

type Part =
  | { readonly kind: 'pdf'; readonly document: PDFDocument }
  | { readonly kind: 'image'; readonly image: PDFImage }

async function readPdf(bytes: Uint8Array): Promise<PDFDocument | null> {
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false })

    return document.getPageCount() === 0 ? null : document
  } catch {
    // Encrypted or not a PDF after all: the evidence still hands it out.
    return null
  }
}

/** A picture as an image of the whole document; null where it cannot be read. */
async function readImage(
  whole: PDFDocument,
  file: { readonly mediaType: string; readonly bytes: Uint8Array },
): Promise<PDFImage | null> {
  try {
    return file.mediaType === 'image/png'
      ? await whole.embedPng(file.bytes)
      : await whole.embedJpg(file.bytes)
  } catch {
    return null
  }
}

/** The pages one attachment takes, and how many of its files could not be read. */
async function partsOf(
  whole: PDFDocument,
  attachment: EvidenceAttachment<unknown>,
): Promise<{ readonly parts: readonly Part[]; readonly unattached: number }> {
  const parts: Part[] = []
  let unattached = 0
  const print = await readPdf(attachment.print)

  if (print === null) {
    unattached += 1
  } else {
    parts.push({ kind: 'pdf', document: print })
  }

  for (const file of attachment.files) {
    if (file.mediaType === 'application/pdf') {
      const document = await readPdf(file.bytes)

      if (document === null) {
        unattached += 1
      } else {
        parts.push({ kind: 'pdf', document })
      }
    } else if (file.mediaType === 'image/jpeg' || file.mediaType === 'image/png') {
      const image = await readImage(whole, file)

      if (image === null) {
        unattached += 1
      } else {
        parts.push({ kind: 'image', image })
      }
    } else {
      unattached += 1
    }
  }

  return { parts, unattached }
}

function pagesOf(parts: readonly Part[]): number {
  return parts.reduce(
    (sum, part) => sum + (part.kind === 'pdf' ? part.document.getPageCount() : 1),
    0,
  )
}

/**
 * The list and what follows it as one PDF. The list is made by `list`, which
 * is told where each row's evidence begins; it is made again while the number
 * of its own pages changes, which the page numbers it prints can cause.
 */
export async function withEvidenceBehind<Key>(
  attachments: readonly EvidenceAttachment<Key>[],
  list: (attached: AttachedPages<Key>) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const whole = await PDFDocument.create()
  const read: { readonly key: Key; readonly parts: readonly Part[] }[] = []
  let unattached = 0

  for (const attachment of attachments) {
    const part = await partsOf(whole, attachment)

    read.push({ key: attachment.key, parts: part.parts })
    unattached += part.unattached
  }

  const behind = read.reduce((sum, each) => sum + pagesOf(each.parts), 0)
  const placed = (listPages: number): AttachedPages<Key> => {
    const pages = new Map<Key, number>()
    let next = listPages + 1

    for (const each of read) {
      if (each.parts.length > 0) {
        pages.set(each.key, next)
        next += pagesOf(each.parts)
      }
    }

    return { pages, from: listPages + 1, total: listPages + behind, unattached }
  }

  let listPages = 1
  let made = await PDFDocument.load(await list(placed(listPages)))

  // Longer numbers can push the list onto another page; three rounds settle it.
  for (let round = 0; round < 3 && made.getPageCount() !== listPages; round += 1) {
    listPages = made.getPageCount()
    made = await PDFDocument.load(await list(placed(listPages)))
  }

  for (const page of await whole.copyPages(made, made.getPageIndices())) {
    whole.addPage(page)
  }

  for (const each of read) {
    for (const part of each.parts) {
      if (part.kind === 'pdf') {
        for (const page of await whole.copyPages(part.document, part.document.getPageIndices())) {
          whole.addPage(page)
        }
      } else {
        const { image } = part
        const scaled = image.scaleToFit(a4.width - 2 * margin, a4.height - 2 * margin)
        const page = whole.addPage([a4.width, a4.height])

        page.drawImage(image, {
          x: (a4.width - scaled.width) / 2,
          y: (a4.height - scaled.height) / 2,
          width: scaled.width,
          height: scaled.height,
        })
      }
    }
  }

  return whole.save()
}
