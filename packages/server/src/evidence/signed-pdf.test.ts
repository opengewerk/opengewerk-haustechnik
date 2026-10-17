import { describe, expect, it } from 'vitest'

import { checkSignedPdf, signedPdfSentences } from './signed-pdf.js'
import { makeSigner, signedPdf } from './test-signed-pdf.js'

/**
 * The check of a PDF with a higher signature (#341): the PDF of this
 * evidence, signed outside, with a signature over the whole file that fits
 * its certificate; anything else is refused with a sentence.
 */

const print = new Uint8Array(
  Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  ),
)
const another = new Uint8Array(
  Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Lang (de) >>\nendobj\n%%EOF\n', 'latin1'),
)
const rsa = makeSigner('rsa')
const ecdsa = makeSigner('ecdsa', 'Erika Muster', 'Sachverständige Süd')

function refusalOf(file: Uint8Array, prints: readonly Uint8Array[] = [print]): string | null {
  try {
    checkSignedPdf(file, prints)

    return null
  } catch (error) {
    return (error as Error).message
  }
}

describe('a PDF with a higher signature', () => {
  it('is taken when it is this print, signed over the whole of it, with RSA or ECDSA', () => {
    expect(checkSignedPdf(signedPdf(print, rsa), [another, print])).toEqual({
      signer: 'Dr. Anna Becker, Prüfstelle Probe GmbH',
      issuer: 'Dr. Anna Becker, Prüfstelle Probe GmbH',
      signedAt: new Date('2026-10-04T08:12:00Z'),
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: new Date('2036-01-01T00:00:00Z'),
    })
    expect(checkSignedPdf(signedPdf(print, ecdsa), [print]).signer).toBe(
      'Erika Muster, Sachverständige Süd',
    )
  })

  it('is refused when it is not the PDF of this evidence', () => {
    expect(refusalOf(new Uint8Array(Buffer.from('Kein PDF', 'latin1')))).toBe(
      signedPdfSentences.notPdf,
    )
    expect(refusalOf(signedPdf(another, rsa))).toBe(signedPdfSentences.notThisEvidence)
    // The print itself, unsigned, is not a signed one.
    expect(refusalOf(print)).toBe(signedPdfSentences.notThisEvidence)
  })

  it('is refused without a signature that covers the whole file', () => {
    const unsigned = new Uint8Array(
      Buffer.concat([Buffer.from(print), Buffer.from('\n%%EOF\n', 'latin1')]),
    )
    const signed = signedPdf(print, rsa)
    const added = new Uint8Array(
      Buffer.concat([Buffer.from(signed), Buffer.from('\n% danach\n', 'latin1')]),
    )

    expect(refusalOf(unsigned)).toBe(signedPdfSentences.noSignature)
    expect(refusalOf(added)).toBe(signedPdfSentences.changedAfter)
  })

  it('is refused when what it covers changed, or its digest is not of it', () => {
    const signed = Buffer.from(signedPdf(print, rsa))
    const changed = Buffer.from(signed)
    const at = changed.indexOf('/Adobe.PPKLite', 0, 'latin1')

    changed[at + 1] = 'B'.charCodeAt(0)

    expect(refusalOf(new Uint8Array(changed))).toBe(signedPdfSentences.digestMismatch)
    expect(refusalOf(signedPdf(print, rsa, { digestOf: () => Buffer.alloc(32) }))).toBe(
      signedPdfSentences.digestMismatch,
    )
  })

  it('is refused when its signature is not by the key of its certificate', () => {
    const forged = { ...rsa, certificate: makeSigner('rsa').certificate }

    expect(refusalOf(signedPdf(print, forged))).toBe(signedPdfSentences.signatureInvalid)
  })
})
