import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'

import { checkSignedPdf, signaturesIn } from '../evidence/signed-pdf.js'
import { makeSigner, signedPdf } from '../evidence/test-signed-pdf.js'
import { instanceSignatureOf } from './check.js'
import { signPdf } from './pades.js'

/**
 * The PDF the instance signs (#457), certified and with rights since #561:
 * DocMDP `/P 2`, so that filling in and further signatures alone keep the
 * certification, and AES-256 with rights to print, copy, fill in and sign,
 * without a password to open it.
 */

const instance = makeSigner('ecdsa', 'Instanz', 'OpenGewerk Haustechnik')

async function onePage(): Promise<Uint8Array> {
  const document = await PDFDocument.create()

  document.setTitle('Nachweis NW-2026-00131')
  document.addPage([595, 842]).drawText('Prüfung der Feuerlöscher', { x: 50, y: 780, size: 14 })

  return document.save()
}

/** The encryption dictionary as the file holds it, read without decrypting. */
async function encryptionOf(file: Uint8Array): Promise<PDFDict> {
  const raw = await PDFDocument.load(file, { ignoreEncryption: true })

  return raw.context.lookup(raw.context.trailerInfo.Encrypt, PDFDict)
}

/** The bits of `/P` (ISO 32000-1, table 22), counted from one. */
function bit(permissions: number, position: number): boolean {
  return (permissions & (1 << (position - 1))) !== 0
}

describe('a PDF the instance signs', () => {
  it('opens without a password and is encrypted with AES-256 (#561)', async () => {
    const signed = await signPdf(await onePage(), instance)

    await expect(PDFDocument.load(signed)).rejects.toBeInstanceOf(EncryptedPDFError)

    const read = await PDFDocument.load(signed, { password: '' })
    const encryption = await encryptionOf(signed)

    expect(read.getPageCount()).toBe(1)
    expect(
      [
        encryption.get(PDFName.of('V')),
        encryption.get(PDFName.of('R')),
        encryption
          .lookup(PDFName.of('CF'), PDFDict)
          .lookup(PDFName.of('StdCF'), PDFDict)
          .get(PDFName.of('CFM')),
      ].map(String),
    ).toEqual(['5', '6', '/AESV3'])
  })

  it('lets a reader print, copy, fill in and sign, and neither change nor assemble it (#561)', async () => {
    const encryption = await encryptionOf(await signPdf(await onePage(), instance))
    const permissions = (encryption.get(PDFName.of('P')) as PDFNumber).asNumber()

    expect({
      print: bit(permissions, 3),
      change: bit(permissions, 4),
      copy: bit(permissions, 5),
      annotate: bit(permissions, 6),
      fillIn: bit(permissions, 9),
      assemble: bit(permissions, 11),
      printWell: bit(permissions, 12),
    }).toEqual({
      print: true,
      change: false,
      copy: true,
      annotate: false,
      fillIn: true,
      assemble: false,
      printWell: true,
    })
  })

  it('is certified with DocMDP, filling in and signing alone allowed after it (#561)', async () => {
    const read = await PDFDocument.load(await signPdf(await onePage(), instance), { password: '' })
    const permissions = read.catalog.lookup(PDFName.of('Perms'), PDFDict)
    const signature = permissions.lookup(PDFName.of('DocMDP'), PDFDict)
    const reference = signature.lookup(PDFName.of('Reference'), PDFArray).lookup(0, PDFDict)
    const parameters = reference.lookup(PDFName.of('TransformParams'), PDFDict)

    expect(permissions.get(PDFName.of('DocMDP'))).toBeInstanceOf(PDFRef)
    expect(
      [
        signature.get(PDFName.of('Type')),
        reference.get(PDFName.of('TransformMethod')),
        parameters.get(PDFName.of('P')),
        parameters.get(PDFName.of('V')),
      ].map(String),
    ).toEqual(['/Sig', '/DocMDP', '2', '/1.2'])
  })

  it('has its strings encrypted, so that a reader that decrypts them reads them as written (#561)', async () => {
    const read = await PDFDocument.load(await signPdf(await onePage(), instance), { password: '' })
    const field = read.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict)
    const name = field.lookup(PDFName.of('T'))
    const signature = field.lookup(PDFName.of('V'), PDFDict)
    const reason = signature.lookup(PDFName.of('Reason'))

    expect(
      name instanceof PDFString || name instanceof PDFHexString ? name.decodeText() : null,
    ).toBe('Signatur der Instanz')
    expect(
      reason instanceof PDFString || reason instanceof PDFHexString ? reason.decodeText() : null,
    ).toBe('Erzeugt und signiert von dieser Instanz')
    expect(read.getTitle()).toBe('Nachweis NW-2026-00131')
  })

  it('keeps the signature of the instance over the whole file, and with a higher one appended (#561)', async () => {
    const signed = await signPdf(await onePage(), instance)

    expect(signaturesIn(signed).map((found) => [found.holds, found.endsAt])).toEqual([
      [true, signed.length],
    ])

    const higher = signedPdf(signed, makeSigner('rsa'))

    expect(signaturesIn(higher).map((found) => found.holds)).toEqual([true, true])
    expect(checkSignedPdf(higher, [signed]).signer).toBe('Dr. Anna Becker, Prüfstelle Probe GmbH')
  })

  it('names the moment of the signature to "PDF prüfen", though its date is encrypted (#561)', async () => {
    const at = new Date('2026-10-22T09:30:00Z')
    const signed = await signPdf(await onePage(), instance, at)

    expect(await instanceSignatureOf(signed, [instance.certificate])).toEqual({
      state: 'unchanged',
      signedAt: '2026-10-22T09:30:00.000Z',
    })
  })
})
