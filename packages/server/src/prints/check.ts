import type { PdfInstanceSignature } from '@opengewerk/haustechnik-domain'

import { signaturesIn } from '../evidence/signed-pdf.js'

/**
 * What the signature of this instance in `file` says (#457), given every
 * certificate the instance signed with: the latest of its signatures, and
 * whether the file is still what it signed. After it may only stand
 * signatures by others that hold, the last over the whole file: a higher
 * signature appended outside (#341) leaves the PDF of the instance in front
 * and adds itself.
 */
export function instanceSignatureOf(
  file: Uint8Array,
  certificates: readonly Buffer[],
): PdfInstanceSignature {
  const found = signaturesIn(file)
  const at = found.findLastIndex(({ certificate }) =>
    certificates.some((known) => certificate !== null && known.equals(certificate.raw)),
  )
  const own = found[at]

  if (own === undefined) {
    return { state: 'none' }
  }

  const signedAt = own.signedAt?.toISOString() ?? null

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
