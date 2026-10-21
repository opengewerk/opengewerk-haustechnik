import { constants, createHash, verify, X509Certificate } from 'node:crypto'

import { childrenOf, DerRefusal, type DerElement, oidOf, readElement, timeOf } from './der.js'

/**
 * Whether a file is the PDF of an evidence with a higher signature on it
 * (#341, section 2.6 of the concept; decided on 15.10.2026: only taken, the
 * signing happens outside). Checked without a connection and without a
 * library beyond `node:crypto`:
 *
 * - it is the PDF of this evidence: the file begins byte for byte with a print
 *   of it, as a signature in PAdES leaves the signed document in front and
 *   appends itself;
 * - the last signature covers the whole file: its `/ByteRange` begins at the
 *   start, leaves out exactly its own `/Contents` and ends at the last byte, so
 *   nothing was added after it;
 * - the signature is right: the digest its signed attributes name is the one
 *   over the covered bytes, and the attributes are signed with the key of the
 *   certificate it carries (RSA, RSA-PSS or ECDSA, with SHA-256, -384 or -512).
 *
 * Not checked: whether the certificate belongs to a list of trusted or
 * qualified providers. That needs the lists, and the screen says so.
 */

export class SignedPdfRefusal extends Error {}

export const signedPdfSentences = {
  notPdf: 'Abgelegt wird ein PDF.',
  notThisEvidence:
    'Diese Datei ist nicht das PDF dieses Nachweises. Signiert wird das PDF, das „PDF öffnen“ am Nachweis gibt, und die Signatur wird daran angehängt.',
  noSignature: 'In dieser Datei ist keine Signatur, die das ganze Dokument deckt.',
  changedAfter: 'Nach der Signatur wurde die Datei noch verändert.',
  digestMismatch: 'Die Signatur passt nicht zum Inhalt der Datei.',
  signatureInvalid: 'Die Signatur passt nicht zu ihrem Zertifikat.',
  unknownKind: 'Diese Art der Signatur kennt die Anwendung nicht.',
  unreadable: 'Die Signatur in dieser Datei lässt sich nicht lesen.',
  tooManySignatures: 'In dieser Datei stehen mehr Signaturen, als hier geprüft werden.',
} as const

/** What the screen says of the signature, as the certificate in the file names it. */
export interface SignedPdfFacts {
  readonly signer: string
  readonly issuer: string
  /** The moment the signature names for itself; none where it names none. */
  readonly signedAt: Date | null
  readonly validFrom: Date
  readonly validTo: Date
}

const oids = {
  signedData: '1.2.840.113549.1.7.2',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  rsa: '1.2.840.113549.1.1.1',
  rsaPss: '1.2.840.113549.1.1.10',
} as const

const digests: Readonly<Record<string, string>> = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
}

/** Signature algorithms that name their digest themselves, by what they are. */
const withDigest: Readonly<
  Record<string, { readonly kind: 'rsa' | 'ecdsa'; readonly digest: string }>
> = {
  '1.2.840.113549.1.1.11': { kind: 'rsa', digest: 'sha256' },
  '1.2.840.113549.1.1.12': { kind: 'rsa', digest: 'sha384' },
  '1.2.840.113549.1.1.13': { kind: 'rsa', digest: 'sha512' },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', digest: 'sha256' },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', digest: 'sha384' },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', digest: 'sha512' },
}

const latin1 = new TextDecoder('latin1')

function startsWith(file: Uint8Array, prefix: Uint8Array): boolean {
  if (file.length < prefix.length) {
    return false
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (file[index] !== prefix[index]) {
      return false
    }
  }

  return true
}

/** The last `/ByteRange` of the file, with where it stands. */
function lastByteRange(
  file: Uint8Array,
): { readonly at: number; readonly range: readonly number[] } | null {
  const text = latin1.decode(file)
  const pattern = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g
  let found: { at: number; range: number[] } | null = null

  for (const match of text.matchAll(pattern)) {
    found = { at: match.index, range: match.slice(1, 5).map(Number) }
  }

  return found
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '')

  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new SignedPdfRefusal(signedPdfSentences.unreadable)
  }

  return Uint8Array.from(Buffer.from(clean, 'hex'))
}

/** The value of one signed attribute, by its object identifier. */
function attribute(attributes: readonly DerElement[], oid: string): DerElement | null {
  for (const each of attributes) {
    const [type, values] = childrenOf(each)

    if (type !== undefined && values !== undefined && oidOf(type) === oid) {
      return childrenOf(values)[0] ?? null
    }
  }

  return null
}

/** The digest and salt of RSA-PSS, from its parameters, with the defaults of RFC 4055 where they are left out. */
function pssOf(parameters: DerElement | undefined): {
  readonly digest: string
  readonly saltLength: number
} {
  let digest = 'sha1'
  let saltLength = 20

  for (const field of parameters === undefined ? [] : childrenOf(parameters)) {
    const inner = childrenOf(field)[0]

    if (inner === undefined) {
      continue
    }

    if (field.tag === 0xa0) {
      const named = digests[oidOf(childrenOf(inner)[0] as DerElement)]

      if (named === undefined) {
        throw new SignedPdfRefusal(signedPdfSentences.unknownKind)
      }

      digest = named
    } else if (field.tag === 0xa2) {
      saltLength = Number.parseInt(Buffer.from(inner.contents).toString('hex') || '0', 16)
    }
  }

  return { digest, saltLength }
}

/** Whether these signed attributes carry this signature by the key of this certificate. */
function signedBy(
  certificate: X509Certificate,
  attributes: Uint8Array,
  algorithm: DerElement,
  digest: string,
  signature: Uint8Array,
): boolean {
  const [identifier, parameters] = childrenOf(algorithm)
  const oid = oidOf(identifier as DerElement)
  const key = certificate.publicKey

  try {
    if (oid === oids.rsaPss) {
      const pss = pssOf(parameters)

      return verify(
        pss.digest,
        attributes,
        { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: pss.saltLength },
        signature,
      )
    }

    if (oid === oids.rsa) {
      return verify(digest, attributes, key, signature)
    }

    const named = withDigest[oid]

    if (named === undefined) {
      throw new SignedPdfRefusal(signedPdfSentences.unknownKind)
    }

    return verify(named.digest, attributes, key, signature)
  } catch (error) {
    if (error instanceof SignedPdfRefusal) {
      throw error
    }

    return false
  }
}

/** One line of a distinguished name as `node:crypto` writes it, by its key. */
function partOf(name: string, key: string): string | null {
  const line = name.split('\n').find((each) => each.startsWith(`${key}=`))

  return line === undefined ? null : line.slice(key.length + 1)
}

function nameOf(name: string): string {
  const parts = [partOf(name, 'CN'), partOf(name, 'O')].filter((part) => part !== null)

  return parts.length === 0 ? name.replace(/\n/g, ', ') : parts.join(', ')
}

/** What the CMS signature in `/Contents` says of the bytes it covers. */
interface CmsReading {
  /** Whether the digest its signed attributes name is the one over the covered bytes. */
  readonly digestMatches: boolean
  /** The certificate whose key signed the attributes; null where none of those it carries did. */
  readonly by: X509Certificate | null
  /** The certificates it carries, the first one where it names none that signed. */
  readonly certificates: readonly X509Certificate[]
  /** The moment its signed attributes name; none where they name none. */
  readonly signedAt: Date | null
}

/**
 * Reads the CMS signature written as `hex`, over the bytes `covered` names in
 * its parts, which are hashed where they stand and never copied. Refused with
 * a sentence only where it cannot be read or is of a kind not known here; a
 * digest that does not fit and a signature by no key it carries are answers.
 */
function readCms(hex: string, covered: readonly Uint8Array[]): CmsReading {
  try {
    const info = readElement(hexToBytes(hex))
    const [type, wrapped] = childrenOf(info)

    if (type === undefined || oidOf(type) !== oids.signedData || wrapped === undefined) {
      throw new SignedPdfRefusal(signedPdfSentences.unreadable)
    }

    const signedData = childrenOf(childrenOf(wrapped)[0] as DerElement)
    const certificates = signedData
      .filter((each) => each.tag === 0xa0)
      .flatMap((each) => childrenOf(each))
      .map((each) => new X509Certificate(Buffer.from(each.whole)))
    const signerInfos = signedData.at(-1)

    if (signerInfos === undefined || signerInfos.tag !== 0x31) {
      throw new SignedPdfRefusal(signedPdfSentences.unreadable)
    }

    const signer = childrenOf(childrenOf(signerInfos)[0] as DerElement)
    const digestAlgorithm = signer[2]
    const attributes = signer[3]
    const signatureAlgorithm = signer[4]
    const signature = signer[5]

    if (
      digestAlgorithm === undefined ||
      attributes === undefined ||
      attributes.tag !== 0xa0 ||
      signatureAlgorithm === undefined ||
      signature === undefined
    ) {
      throw new SignedPdfRefusal(signedPdfSentences.unreadable)
    }

    const digest = digests[oidOf(childrenOf(digestAlgorithm)[0] as DerElement)]

    if (digest === undefined) {
      throw new SignedPdfRefusal(signedPdfSentences.unknownKind)
    }

    const listed = childrenOf(attributes)
    const named = attribute(listed, oids.messageDigest)
    // The attributes are signed as a SET, not under the tag they carry in SignerInfo.
    const asSigned = Buffer.from(attributes.whole)

    asSigned[0] = 0x31

    const time = attribute(listed, oids.signingTime)
    const hash = createHash(digest)

    for (const part of covered) {
      hash.update(part)
    }

    return {
      digestMatches: named !== null && hash.digest().equals(Buffer.from(named.contents)),
      by:
        certificates.find((certificate) =>
          signedBy(certificate, asSigned, signatureAlgorithm, digest, signature.contents),
        ) ?? null,
      certificates,
      signedAt: time === null ? null : timeOf(time),
    }
  } catch (error) {
    if (error instanceof SignedPdfRefusal) {
      throw error
    }

    if (error instanceof DerRefusal || error instanceof Error) {
      throw new SignedPdfRefusal(signedPdfSentences.unreadable)
    }

    throw error
  }
}

/**
 * The facts of the signature on `file`, which has to be one of `prints`
 * signed; refused with a sentence otherwise.
 */
export function checkSignedPdf(file: Uint8Array, prints: readonly Uint8Array[]): SignedPdfFacts {
  if (latin1.decode(file.subarray(0, 5)) !== '%PDF-') {
    throw new SignedPdfRefusal(signedPdfSentences.notPdf)
  }

  const print = prints.find((each) => file.length > each.length && startsWith(file, each))

  if (print === undefined) {
    throw new SignedPdfRefusal(signedPdfSentences.notThisEvidence)
  }

  const found = lastByteRange(file)

  // The signature is one appended to the print, not one inside it.
  if (found === null || found.at < print.length) {
    throw new SignedPdfRefusal(signedPdfSentences.noSignature)
  }

  const [start, firstLength, secondStart, secondLength] = found.range as [
    number,
    number,
    number,
    number,
  ]

  if (start !== 0 || firstLength < print.length || secondStart <= firstLength) {
    throw new SignedPdfRefusal(signedPdfSentences.noSignature)
  }

  if (secondStart + secondLength !== file.length) {
    throw new SignedPdfRefusal(signedPdfSentences.changedAfter)
  }

  // Between the two ranges stands the signature itself, `<hex>` and nothing else.
  const contents = latin1.decode(file.subarray(firstLength, secondStart))

  if (!contents.startsWith('<') || !contents.endsWith('>')) {
    throw new SignedPdfRefusal(signedPdfSentences.noSignature)
  }

  const read = readCms(contents.slice(1, -1), [
    file.subarray(0, firstLength),
    file.subarray(secondStart, secondStart + secondLength),
  ])

  if (!read.digestMatches) {
    throw new SignedPdfRefusal(signedPdfSentences.digestMismatch)
  }

  if (read.by === null) {
    throw new SignedPdfRefusal(signedPdfSentences.signatureInvalid)
  }

  return {
    signer: nameOf(read.by.subject),
    issuer: nameOf(read.by.issuer),
    signedAt: read.signedAt,
    validFrom: new Date(read.by.validFrom),
    validTo: new Date(read.by.validTo),
  }
}

/** One signature in a PDF, as it stands there. */
export interface FoundSignature {
  /** Where the bytes it covers end: the end of the file as it was signed. */
  readonly endsAt: number
  /** The certificate it was made with; null where it could not be read. */
  readonly certificate: X509Certificate | null
  /** Who that certificate names. */
  readonly signer: string | null
  /** Whether the bytes it covers are still the ones it was made over, by the key of its certificate. */
  readonly holds: boolean
  /** The moment it names, in its attributes or in its dictionary (`/M`); none where it names none. */
  readonly signedAt: Date | null
}

/** The moment `/M` of a signature dictionary names, in the stretch of text after its `/Contents`. */
function claimedMoment(text: string): Date | null {
  const found = /\/M\s*\(D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}'?\d{2}'?)?/.exec(
    text,
  )

  if (found === null) {
    return null
  }

  const [, year, month, day, hour, minute, second, zone] = found
  const offset =
    zone === undefined || zone === 'Z'
      ? 'Z'
      : `${zone.slice(0, 3)}:${zone.replace(/'/g, '').slice(3, 5)}`
  const moment = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`)

  return Number.isNaN(moment.getTime()) ? null : moment
}

/**
 * The most signatures a file is read for. A PDF signed by the instance and
 * then outside has two; a file with more than this many byte ranges is
 * refused before any is read, so that a crafted one cannot keep the server
 * hashing (finding of the security review of #507).
 */
export const mostSignatures = 16

/**
 * Every signature in `file`, in the order they stand, each read for what it
 * covers. A file that is no PDF has none; one with more than
 * `mostSignatures` byte ranges is refused with a sentence.
 */
export function signaturesIn(file: Uint8Array): readonly FoundSignature[] {
  if (latin1.decode(file.subarray(0, 5)) !== '%PDF-') {
    return []
  }

  const text = latin1.decode(file)
  const pattern = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g
  const matches: RegExpExecArray[] = []
  const found: FoundSignature[] = []

  for (const match of text.matchAll(pattern)) {
    matches.push(match)

    if (matches.length > mostSignatures) {
      throw new SignedPdfRefusal(signedPdfSentences.tooManySignatures)
    }
  }

  for (const match of matches) {
    const [start, firstLength, secondStart, secondLength] = match.slice(1, 5).map(Number) as [
      number,
      number,
      number,
      number,
    ]
    const endsAt = secondStart + secondLength
    const contents = text.slice(firstLength, secondStart)

    if (
      start !== 0 ||
      secondStart <= firstLength ||
      endsAt > file.length ||
      !contents.startsWith('<') ||
      !contents.endsWith('>')
    ) {
      continue
    }

    const moment = claimedMoment(text.slice(secondStart, Math.min(endsAt, secondStart + 2000)))

    try {
      const read = readCms(contents.slice(1, -1), [
        file.subarray(0, firstLength),
        file.subarray(secondStart, endsAt),
      ])
      const certificate = read.by ?? read.certificates[0] ?? null

      found.push({
        endsAt,
        certificate,
        signer: certificate === null ? null : nameOf(certificate.subject),
        holds: read.digestMatches && read.by !== null,
        signedAt: read.signedAt ?? moment,
      })
    } catch (error) {
      if (!(error instanceof SignedPdfRefusal)) {
        throw error
      }

      found.push({ endsAt, certificate: null, signer: null, holds: false, signedAt: moment })
    }
  }

  return found
}
