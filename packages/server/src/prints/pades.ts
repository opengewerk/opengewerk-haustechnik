import { randomBytes } from 'node:crypto'

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from '@cantoo/pdf-lib'
import { signDetached, type SigningKey } from '@opengewerk/platform-server'

/**
 * The signature of the instance in a PDF (#457, section 2.6 of the concept):
 * PAdES, as a signing tool outside writes it and as `evidence/signed-pdf.ts`
 * reads it. The PDF gets an invisible signature field on its first page and
 * a signature dictionary whose `/ByteRange` covers the whole file but its own
 * `/Contents`; there stands the CMS signature of the instance over those
 * bytes. A program that checks signatures shows it as broken once a byte of
 * the file changes, and "PDF prüfen" says so in any case.
 *
 * Since #561 the signature certifies the document (DocMDP, `/P 2`): after it,
 * filling in fields and further signatures are allowed, as a higher signature
 * outside (#341) is, and every other change breaks the certification. The
 * file carries rights as well, encrypted with AES-256 under an owner password
 * made for it and kept nowhere, and without a password to open it: printing,
 * copying, filling in and signing, and neither changing nor assembling. A
 * program that heeds rights or certifications refuses to edit it; the bytes
 * themselves can be changed by whoever has the file, which the signature
 * shows.
 *
 * The file is written anew, not appended to: the instance signs a PDF when it
 * makes it, and nothing stands before the signature that was signed already.
 * It is encrypted first and signed after, as ISO 32000-1, 7.6.1 has it: the
 * `/Contents` of the signature stays as it is, every other string and stream
 * is encrypted.
 */

/** Room for the signature in `/Contents`, in bytes; the file holds twice as many hexadecimal digits. */
const room = 4096

/** What stands in `/ByteRange` until the place of `/Contents` is known, as long as the longest number. */
const unknown = '**********'

export class PdfSigningError extends Error {}

/**
 * What a program that heeds rights lets a reader do with a PDF of the
 * instance (#561): print, copy, fill in and sign; not change, annotate or
 * assemble.
 */
const rights = {
  printing: 'highResolution',
  modifying: false,
  copying: true,
  annotating: false,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: false,
} as const

/** The signature dictionary and the field that shows it, on the first page and in the form of the document. */
function placeholderIn(document: PDFDocument, at: Date): PDFRef {
  const { context } = document
  const range = PDFArray.withContext(context)

  range.push(PDFNumber.of(0))
  range.push(PDFName.of(unknown))
  range.push(PDFName.of(unknown))
  range.push(PDFName.of(unknown))

  const signature = context.register(
    context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'ETSI.CAdES.detached',
      ByteRange: range,
      Contents: PDFHexString.of('0'.repeat(room * 2)),
      M: PDFString.fromDate(at),
      Reason: PDFHexString.fromText('Erzeugt und signiert von dieser Instanz'),
      // A certifying signature (#561): after it, filling in and signing only.
      Reference: [
        {
          Type: 'SigRef',
          TransformMethod: 'DocMDP',
          TransformParams: { Type: 'TransformParams', P: 2, V: '1.2' },
        },
      ],
    }),
  )
  const page = document.getPage(0)
  const field = context.register(
    context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: [0, 0, 0, 0],
      V: signature,
      T: PDFString.of('Signatur der Instanz'),
      // Print and Locked: shown on paper as on screen, and nobody moves it.
      F: 132,
      P: page.ref,
    }),
  )
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)

  if (annotations) {
    annotations.push(field)
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([field]))
  }

  const form = document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)

  if (form) {
    const fields = form.lookupMaybe(PDFName.of('Fields'), PDFArray)

    if (fields) {
      fields.push(field)
    } else {
      form.set(PDFName.of('Fields'), context.obj([field]))
    }

    form.set(PDFName.of('SigFlags'), PDFNumber.of(3))
  } else {
    document.catalog.set(PDFName.of('AcroForm'), context.obj({ SigFlags: 3, Fields: [field] }))
  }

  document.catalog.set(PDFName.of('Perms'), context.obj({ DocMDP: signature }))

  return signature
}

/**
 * Every string of the document encrypted for its object, as a reader that
 * decrypts it expects: the library encrypts the streams as it writes them, and
 * leaves the strings as they are. Not the encryption dictionary, and not the
 * `/Contents` of the signature, which stands in the file as it is.
 */
function encryptStrings(document: PDFDocument, signature: PDFRef): void {
  const { context } = document
  const security = context.security

  if (security === undefined) {
    throw new PdfSigningError('The PDF is not encrypted.')
  }

  const encryption = context.trailerInfo.Encrypt

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (encryption instanceof PDFRef && ref === encryption) {
      continue
    }

    const encrypt = security.getEncryptFn(ref.objectNumber, ref.generationNumber)
    const sealed = (value: PDFString | PDFHexString): PDFHexString =>
      PDFHexString.of(Buffer.from(encrypt(value.asBytes())).toString('hex'))
    const walk = (value: PDFObject, inSignature: boolean): PDFObject => {
      if (value instanceof PDFString || value instanceof PDFHexString) {
        return sealed(value)
      }

      if (value instanceof PDFArray) {
        for (let index = 0; index < value.size(); index += 1) {
          value.set(index, walk(value.get(index), false))
        }

        return value
      }

      if (value instanceof PDFDict) {
        for (const [key, entry] of value.entries()) {
          if (!(inSignature && key === PDFName.of('Contents'))) {
            value.set(key, walk(entry, false))
          }
        }

        return value
      }

      if (value instanceof PDFStream || value instanceof PDFRawStream) {
        walk(value.dict, false)
      }

      return value
    }

    walk(object, ref === signature)
  }
}

/** The PDF `bytes` signed by the instance with `key`, at the moment `at`. */
export async function signPdf(
  bytes: Uint8Array,
  key: SigningKey,
  at: Date = new Date(),
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false })
  const signatureRef = placeholderIn(document, at)

  document.encrypt({
    algorithm: 'AES-256',
    userPassword: '',
    // Made for this file and kept nowhere: nobody lifts the rights with it.
    ownerPassword: randomBytes(32).toString('base64url'),
    permissions: rights,
  })
  encryptStrings(document, signatureRef)

  // Without object streams, so that the dictionary stands in the file as written.
  const file = Buffer.from(await document.save({ useObjectStreams: false }))
  const text = file.toString('latin1')
  const range = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/.exec(text)
  const contentsStart = text.indexOf(`<${'0'.repeat(room * 2)}>`)

  if (range === null || contentsStart < 0 || contentsStart < range.index) {
    throw new PdfSigningError('The placeholder of the signature is not in the PDF as written.')
  }

  const contentsEnd = contentsStart + room * 2 + 2
  const numbers = `/ByteRange [0 ${String(contentsStart)} ${String(contentsEnd)} ${String(file.length - contentsEnd)}`
  const written = range[0]

  if (numbers.length + 1 > written.length) {
    throw new PdfSigningError('The PDF is too long for the room of its byte range.')
  }

  file.write(`${numbers.padEnd(written.length - 1, ' ')}]`, range.index, 'latin1')

  const covered = Buffer.concat([file.subarray(0, contentsStart), file.subarray(contentsEnd)])
  const signature = signDetached(key, covered).toString('hex')

  if (signature.length > room * 2) {
    throw new PdfSigningError('The signature is larger than the room kept for it.')
  }

  file.write(signature, contentsStart + 1, 'latin1')

  return new Uint8Array(file)
}
