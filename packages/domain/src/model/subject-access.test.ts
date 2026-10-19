import { describe, expect, it } from 'vitest'

import {
  subjectAccessParts,
  subjectAccessSearchParts,
  subjectAccessSources,
  subjectAccessTermProblem,
} from './subject-access.js'

describe('the information about a person (#355)', () => {
  it('reads each field of a person in one part only', () => {
    const sources = subjectAccessSources()

    expect(new Set(sources).size).toBe(sources.length)
  })

  it('has a column of its own for every value a row of a part holds', () => {
    for (const part of [
      ...Object.values(subjectAccessParts),
      ...Object.values(subjectAccessSearchParts),
    ]) {
      const keys = part.columns.map((column) => column.key)

      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('searches for three characters at least, and says why not in words', () => {
    expect(subjectAccessTermProblem('Kel')).toBeNull()
    expect(subjectAccessTermProblem('  Keller  ')).toBeNull()
    expect(subjectAccessTermProblem('Ke')).toBe(
      'Gesucht wird nach mindestens 3 und höchstens 200 Zeichen.',
    )
    expect(subjectAccessTermProblem('  K  ')).not.toBeNull()
    expect(subjectAccessTermProblem('x'.repeat(201))).not.toBeNull()
    expect(subjectAccessTermProblem(undefined)).toBe(
      'Gesucht wird nach einem Namen oder einer E-Mail-Adresse.',
    )
  })
})
