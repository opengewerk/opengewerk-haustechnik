import { createHash, generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

/**
 * A PDF signed the way a signing tool outside does it (#341), made in a
 * test: a key pair and a self-signed certificate for it, and the signature
 * appended to a print as an incremental update in PAdES form, with a
 * `/ByteRange` over everything but its own `/Contents`. Nothing of it is
 * stored in the repository; each run makes its own.
 */

// --- DER, as far as a certificate and a CMS signature need it ------------------------------

function length(size: number): Buffer {
  if (size < 0x80) {
    return Buffer.from([size])
  }

  const bytes: number[] = []

  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256)
  }

  return Buffer.from([0x80 | bytes.length, ...bytes])
}

export function element(tag: number, ...contents: readonly Buffer[]): Buffer {
  const body = Buffer.concat(contents)

  return Buffer.concat([Buffer.from([tag]), length(body.length), body])
}

const sequence = (...contents: readonly Buffer[]) => element(0x30, ...contents)
const set = (...contents: readonly Buffer[]) => element(0x31, ...contents)
const octets = (bytes: Buffer) => element(0x04, bytes)
const integer = (value: number) => element(0x02, Buffer.from([value]))
const utf8 = (text: string) => element(0x0c, Buffer.from(text, 'utf8'))
const utcTime = (at: Date) =>
  element(
    0x17,
    Buffer.from(
      `${at.toISOString().slice(2, 4)}${at.toISOString().slice(5, 7)}${at.toISOString().slice(8, 10)}` +
        `${at.toISOString().slice(11, 13)}${at.toISOString().slice(14, 16)}${at.toISOString().slice(17, 19)}Z`,
      'latin1',
    ),
  )

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number)
  const bytes = [(parts[0] as number) * 40 + (parts[1] as number)]

  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f]

    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128)) {
      chunk.unshift((rest & 0x7f) | 0x80)
    }

    bytes.push(...chunk)
  }

  return element(0x06, Buffer.from(bytes))
}

const name = (common: string, organisation: string) =>
  sequence(
    set(sequence(oid('2.5.4.10'), utf8(organisation))),
    set(sequence(oid('2.5.4.3'), utf8(common))),
  )

// --- Who signs ---------------------------------------------------------------------------

export interface Signer {
  readonly privateKey: KeyObject
  readonly certificate: Buffer
  /** The algorithm identifier of a signature by this key with SHA-256. */
  readonly algorithm: Buffer
}

/** A key pair and a certificate signed by itself, RSA or ECDSA on P-256. */
export function makeSigner(
  kind: 'rsa' | 'ecdsa',
  common = 'Dr. Anna Becker',
  organisation = 'Prüfstelle Probe GmbH',
): Signer {
  const { privateKey, publicKey } =
    kind === 'rsa'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const algorithm =
    kind === 'rsa'
      ? sequence(oid('1.2.840.113549.1.1.11'), element(0x05))
      : sequence(oid('1.2.840.10045.4.3.2'))
  const subject = name(common, organisation)
  const tbs = sequence(
    element(0xa0, integer(2)),
    integer(7),
    algorithm,
    subject,
    sequence(utcTime(new Date('2026-01-01T00:00:00Z')), utcTime(new Date('2036-01-01T00:00:00Z'))),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
  )
  const signature = sign('sha256', tbs, privateKey)

  return {
    privateKey,
    certificate: sequence(tbs, algorithm, element(0x03, Buffer.from([0]), signature)),
    algorithm,
  }
}

// --- The signature on a PDF ---------------------------------------------------------------

/** Room for the signature in `/Contents`, in hexadecimal digits. */
const room = 16384

/**
 * The print with a signature appended: an incremental update with a
 * signature dictionary whose `/ByteRange` covers the whole file but its
 * `/Contents`, and a CMS signature over that range in it.
 */
export function signedPdf(
  print: Uint8Array,
  signer: Signer,
  options: { readonly digestOf?: (covered: Buffer) => Buffer; readonly at?: Date } = {},
): Uint8Array {
  const head = Buffer.from(
    '\n99 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 ########## ########## ##########] /Contents <',
    'latin1',
  )
  const tail = Buffer.from('> >>\nendobj\n%%EOF\n', 'latin1')
  const before = Buffer.concat([Buffer.from(print), head])
  const firstLength = before.length - 1
  const secondStart = before.length + room + 1
  const total = secondStart + tail.length - 1
  const range = `0 ${String(firstLength).padStart(10)} ${String(secondStart).padStart(10)} ${String(total - secondStart).padStart(10)}`
  const withRange = Buffer.from(
    before.toString('latin1').replace('0 ########## ########## ##########', range),
    'latin1',
  )
  const placeholder = Buffer.alloc(room, '0')
  const whole = Buffer.concat([withRange, placeholder, tail])
  const covered = Buffer.concat([whole.subarray(0, firstLength), whole.subarray(secondStart)])
  const digest = options.digestOf?.(covered) ?? createHash('sha256').update(covered).digest()
  const attributes = [
    sequence(oid('1.2.840.113549.1.9.3'), set(oid('1.2.840.113549.1.7.1'))),
    sequence(
      oid('1.2.840.113549.1.9.5'),
      set(utcTime(options.at ?? new Date('2026-10-04T08:12:00Z'))),
    ),
    sequence(oid('1.2.840.113549.1.9.4'), set(octets(digest))),
  ]
  const signedAttributes = set(...attributes)
  const signature = sign('sha256', signedAttributes, signer.privateKey)
  const sha256 = sequence(oid('2.16.840.1.101.3.4.2.1'))
  const signerInfo = sequence(
    integer(1),
    sequence(name('Dr. Anna Becker', 'Prüfstelle Probe GmbH'), integer(7)),
    sha256,
    element(0xa0, ...attributes),
    signer.algorithm,
    octets(signature),
  )
  const cms = sequence(
    oid('1.2.840.113549.1.7.2'),
    element(
      0xa0,
      sequence(
        integer(1),
        set(sha256),
        sequence(oid('1.2.840.113549.1.7.1')),
        element(0xa0, signer.certificate),
        set(signerInfo),
      ),
    ),
  )
  const hex = Buffer.from(cms.toString('hex').padEnd(room, '0'), 'latin1')

  hex.copy(whole, firstLength + 1)

  return new Uint8Array(whole)
}
