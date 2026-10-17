/**
 * Just enough of DER to read a CMS signature out of a PDF (#341): tag,
 * length and contents of one element, and its children where it is
 * constructed. Lengths are checked against what is there, so a file that
 * claims more than it holds is refused rather than read past its end.
 */

export interface DerElement {
  /** The whole first byte: class, constructed bit and number. */
  readonly tag: number
  /** The element as it stands in the input, header and contents. */
  readonly whole: Uint8Array
  readonly contents: Uint8Array
}

export class DerRefusal extends Error {}

export function readElement(bytes: Uint8Array, at = 0): DerElement {
  if (at + 2 > bytes.length) {
    throw new DerRefusal('DER ends before an element.')
  }

  const tag = bytes[at] as number

  // Tag numbers above 30 are not used in what is read here.
  if ((tag & 0x1f) === 0x1f) {
    throw new DerRefusal('DER with a long tag.')
  }

  let length = bytes[at + 1] as number
  let start = at + 2

  if (length & 0x80) {
    const count = length & 0x7f

    // Indefinite length is BER, not DER; four bytes of length are plenty.
    if (count === 0 || count > 4 || start + count > bytes.length) {
      throw new DerRefusal('DER with a length it cannot hold.')
    }

    length = 0

    for (let index = 0; index < count; index += 1) {
      length = length * 256 + (bytes[start + index] as number)
    }

    start += count
  }

  if (start + length > bytes.length) {
    throw new DerRefusal('DER element longer than its input.')
  }

  return {
    tag,
    whole: bytes.subarray(at, start + length),
    contents: bytes.subarray(start, start + length),
  }
}

/** The children of a constructed element, in order. */
export function childrenOf(element: DerElement): DerElement[] {
  if ((element.tag & 0x20) === 0) {
    throw new DerRefusal('DER children of a primitive element.')
  }

  const children: DerElement[] = []
  let at = 0

  while (at < element.contents.length) {
    const child = readElement(element.contents, at)

    children.push(child)
    at += child.whole.length
  }

  return children
}

/** An OBJECT IDENTIFIER in its dotted form. */
export function oidOf(element: DerElement): string {
  if (element.tag !== 0x06 || element.contents.length === 0) {
    throw new DerRefusal('DER element is no object identifier.')
  }

  const bytes = element.contents
  const first = bytes[0] as number
  const parts = [
    Math.min(2, Math.floor(first / 40)),
    first - Math.min(2, Math.floor(first / 40)) * 40,
  ]
  let value = 0

  for (let index = 1; index < bytes.length; index += 1) {
    const byte = bytes[index] as number

    value = value * 128 + (byte & 0x7f)

    if ((byte & 0x80) === 0) {
      parts.push(value)
      value = 0
    }
  }

  return parts.join('.')
}

/** UTCTime or GeneralizedTime as a moment, or null for anything else. */
export function timeOf(element: DerElement): Date | null {
  const text = new TextDecoder('latin1').decode(element.contents)
  const utc = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  const general = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)

  if (element.tag === 0x17 && utc) {
    const year = Number(utc[1])

    return new Date(
      Date.UTC(
        year < 50 ? 2000 + year : 1900 + year,
        Number(utc[2]) - 1,
        Number(utc[3]),
        Number(utc[4]),
        Number(utc[5]),
        Number(utc[6]),
      ),
    )
  }

  if (element.tag === 0x18 && general) {
    return new Date(
      Date.UTC(
        Number(general[1]),
        Number(general[2]) - 1,
        Number(general[3]),
        Number(general[4]),
        Number(general[5]),
        Number(general[6]),
      ),
    )
  }

  return null
}
