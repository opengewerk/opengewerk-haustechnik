import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { canonicalForm, NotCanonicalError } from './canonical.js'

/** A value that has a canonical form: JSON with whole numbers only. */
const canonical = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.string({ unit: 'binary' }),
    fc.maxSafeInteger(),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string({ unit: 'binary' }), tie('value'), { maxKeys: 4 }),
  ),
})).value

/** The same object with its keys in another order, at every depth. */
function shuffled(value: unknown, seed: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => shuffled(item, seed + index))
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    const rotated = entries.map((_, index) => entries[(index + seed) % entries.length])

    return Object.fromEntries(
      rotated.map((entry) => [entry?.[0], shuffled(entry?.[1], seed + 1)] as const),
    )
  }

  return value
}

describe('the canonical form', () => {
  it('orders the keys of every object by their code units, without any space', () => {
    expect(canonicalForm({ b: 1, a: { d: [2, { z: null, y: true }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":true,"z":null}]},"b":1}',
    )
    // Code units, not a dictionary: capitals before small letters, umlauts after z.
    expect(canonicalForm({ ä: 1, z: 2, a: 3, B: 4 })).toBe('{"B":4,"a":3,"z":2,"ä":1}')
  })

  it('writes strings as JSON writes them and keeps arrays in their order', () => {
    expect(canonicalForm(['Prüfung "A"', 'Zeile\nzwei', '\\', 3, 1])).toBe(
      '["Prüfung \\"A\\"","Zeile\\nzwei","\\\\",3,1]',
    )
    expect(canonicalForm(-0)).toBe('0')
  })

  it('is the same whatever order the keys were put in', () => {
    fc.assert(
      fc.property(canonical, fc.nat(), (value, seed) => {
        expect(canonicalForm(shuffled(value, seed))).toBe(canonicalForm(value))
      }),
    )
  })

  it('reads back as the value it was written from', () => {
    fc.assert(
      fc.property(canonical, (value) => {
        const written = canonicalForm(value)

        expect(canonicalForm(JSON.parse(written))).toBe(written)
      }),
    )
  })

  it('refuses what JSON cannot say without doubt, and says where it stands', () => {
    const refused = (value: unknown) => {
      try {
        canonicalForm(value)
      } catch (error) {
        return error instanceof NotCanonicalError ? error.message : `other: ${String(error)}`
      }

      return 'accepted'
    }

    expect(refused({ value: 1.5 })).toBe('$.value: 1.5 ist keine ganze Zahl im sicheren Bereich.')
    expect(refused([Number.NaN])).toBe('$[0]: NaN ist keine ganze Zahl im sicheren Bereich.')
    expect(refused(Number.POSITIVE_INFINITY)).toBe(
      '$: Infinity ist keine ganze Zahl im sicheren Bereich.',
    )
    expect(refused(2 ** 53)).toBe('$: 9007199254740992 ist keine ganze Zahl im sicheren Bereich.')
    expect(refused({ missing: undefined })).toBe('$.missing: undefined hat keine kanonische Form.')
    expect(refused({ on: new Date(0) })).toBe('$.on: ist kein schlichtes Objekt.')
    expect(refused(new Map())).toBe('$: ist kein schlichtes Objekt.')
    expect(refused(10n)).toBe('$: bigint hat keine kanonische Form.')
    expect(refused(Object.create(null) as unknown)).toBe('accepted')
  })
})
