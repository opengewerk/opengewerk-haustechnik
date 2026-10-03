/**
 * A value as it may stand in a state that gets a fingerprint: what JSON says
 * without doubt. Whole numbers within the safe range, no fractions, nothing
 * undefined, no dates or other objects with a class of their own.
 */
export type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue }

/** A value that has no canonical form, with where it stands in the whole. */
export class NotCanonicalError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path}: ${reason}`)
    this.name = 'NotCanonicalError'
  }
}

/**
 * The canonical form of a value: the one text it has, whoever writes it
 * (ADR 0004, point 6). The fingerprint of an evidence is taken over this text
 * when it is written down and again whenever it is checked, so the same state
 * gives the same fingerprint in 2027 and in 2035, on the server and on a
 * device.
 *
 * JSON with the keys of every object in the order of their UTF-16 code units,
 * no space anywhere and strings escaped as `JSON.stringify` escapes them. A
 * fraction, a number out of the safe range, undefined, a date or anything
 * else is refused rather than written in some form: two engines agree on how
 * to write a whole number, not on every fraction, and a state that held one
 * would get a fingerprint nobody else can compute again.
 */
export function canonicalForm(value: unknown, path = '$'): string {
  if (value === null) {
    return 'null'
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new NotCanonicalError(
          path,
          `${String(value)} ist keine ganze Zahl im sicheren Bereich.`,
        )
      }

      // `String(-0)` is "0", so both zeros have the one form.
      return String(value)
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => canonicalForm(item, `${path}[${String(index)}]`)).join(',')}]`
      }

      const prototype: unknown = Object.getPrototypeOf(value)

      if (prototype !== Object.prototype && prototype !== null) {
        throw new NotCanonicalError(path, 'ist kein schlichtes Objekt.')
      }

      const record = value as Readonly<Record<string, unknown>>

      // The default order of `sort` is the order of the UTF-16 code units,
      // the same in every engine and independent of any locale.
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalForm(record[key], `${path}.${key}`)}`)
        .join(',')}}`
    }
    default:
      throw new NotCanonicalError(path, `${typeof value} hat keine kanonische Form.`)
  }
}
