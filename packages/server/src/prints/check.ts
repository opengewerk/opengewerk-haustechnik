import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from '@cantoo/pdf-lib'
import type { PdfInstanceSignature } from '@opengewerk/haustechnik-domain'

import { momentOfDate, signaturesIn } from '../evidence/signed-pdf.js'

/**
 * The moment `/M` of the signature that ends at `endsAt`, read from the
 * decrypted document: in a PDF of the instance since #561 it is encrypted like
 * every string but `/Contents`, and the text of the file does not show it.
 * The empty password opens such a file; null for anything that does not open
 * or names no moment.
 */
async function momentInEncrypted(file: Uint8Array, endsAt: number): Promise<Date | null> {
  try {
    const document = await PDFDocument.load(file, { password: '', updateMetadata: false })

    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Sig')) {
        continue
      }

      const range = object.lookupMaybe(PDFName.of('ByteRange'), PDFArray)
      const [, , from, length] = (range?.asArray() ?? []).map((each) =>
        each instanceof PDFNumber ? each.asNumber() : -1,
      )

      if (from !== undefined && length !== undefined && from + length === endsAt) {
        const moment = object.lookup(PDFName.of('M'))

        return moment instanceof PDFString || moment instanceof PDFHexString
          ? momentOfDate(moment.decodeText())
          : null
      }
    }
  } catch {
    // Not a PDF that opens with the empty password: no moment.
  }

  return null
}

/**
 * What the signature of this instance in `file` says (#457), given every
 * certificate the instance signed with: the latest of its signatures, and
 * whether the file is still what it signed. After it may only stand
 * signatures by others that hold, the last over the whole file: a higher
 * signature appended outside (#341) leaves the PDF of the instance in front
 * and adds itself.
 */
export async function instanceSignatureOf(
  file: Uint8Array,
  certificates: readonly Buffer[],
): Promise<PdfInstanceSignature> {
  const found = signaturesIn(file)
  const at = found.findLastIndex(({ certificate }) =>
    certificates.some((known) => certificate !== null && known.equals(certificate.raw)),
  )
  const own = found[at]

  if (own === undefined) {
    return { state: 'none' }
  }

  const signedAt =
    (own.signedAt ?? (await momentInEncrypted(file, own.endsAt)))?.toISOString() ?? null

  if (!own.holds) {
    return { state: 'changed', signedAt }
  }

  if (own.endsAt === file.length) {
    return { state: 'unchanged', signedAt }
  }

  const after = found.slice(at + 1)

  return after.length > 0 &&
    after.every((each) => each.holds) &&
    after.at(-1)?.endsAt === file.length
    ? { state: 'signed_after', signedAt, by: after.map((each) => each.signer ?? '') }
    : { state: 'changed', signedAt }
}
