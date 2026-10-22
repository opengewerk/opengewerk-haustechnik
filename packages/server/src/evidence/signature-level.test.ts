import { describe, expect, it } from 'vitest'

import { statedLevelOf } from './signature-level.js'

// Certificates as far as the level reads them, written by hand: the
// TBSCertificate with its extensions in the explicit [3], and the extension
// QCStatements with the statements it carries (ETSI EN 319 412-5).

function element(tag: number, ...contents: Uint8Array[]): Uint8Array {
  const length = contents.reduce((sum, each) => sum + each.length, 0)
  const head = length < 0x80 ? [tag, length] : [tag, 0x82, Math.floor(length / 256), length % 256]

  return Uint8Array.from([...head, ...contents.flatMap((each) => [...each])])
}

function oid(dotted: string): Uint8Array {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number)
  const bytes = [first * 40 + second]

  for (const part of rest) {
    const groups = [part & 0x7f]

    for (let value = part >> 7; value > 0; value >>= 7) {
      groups.unshift((value & 0x7f) | 0x80)
    }

    bytes.push(...groups)
  }

  return element(0x06, Uint8Array.from(bytes))
}

const sequence = (...contents: Uint8Array[]) => element(0x30, ...contents)

/** A certificate with these extensions, each an id and the DER of its value. */
function certificate(extensions: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const serial = element(0x02, Uint8Array.from([1]))
  const listed = extensions.map(([id, value]) => sequence(oid(id), element(0x04, value)))
  const tbs = sequence(serial, ...(listed.length === 0 ? [] : [element(0xa3, sequence(...listed))]))

  return sequence(tbs, sequence(oid('1.2.840.10045.4.3.2')), element(0x03, Uint8Array.from([0])))
}

const qcStatements = '1.3.6.1.5.5.7.1.3'
const keyUsage = '2.5.29.15'

describe('the level a certificate states (#526)', () => {
  it('is qualified where the certificate says it is an EU qualified one', () => {
    const statements = sequence(sequence(oid('0.4.0.1862.1.4')), sequence(oid('0.4.0.1862.1.1')))

    expect(
      statedLevelOf(
        certificate([
          [keyUsage, element(0x03, Uint8Array.from([0x06, 0xc0]))],
          [qcStatements, statements],
        ]),
      ),
    ).toBe('qualified')
  })

  it('is advanced where it carries statements but not that one, none at all, or no extensions', () => {
    expect(
      statedLevelOf(certificate([[qcStatements, sequence(sequence(oid('0.4.0.1862.1.4')))]])),
    ).toBe('advanced')
    expect(
      statedLevelOf(certificate([[keyUsage, element(0x03, Uint8Array.from([0x06, 0xc0]))]])),
    ).toBe('advanced')
    expect(statedLevelOf(certificate([]))).toBe('advanced')
  })

  it('is advanced where the extension does not read', () => {
    expect(statedLevelOf(certificate([[qcStatements, Uint8Array.from([0x30, 0x05, 0x01])]]))).toBe(
      'advanced',
    )
  })
})
