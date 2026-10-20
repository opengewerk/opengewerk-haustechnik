import { describe, expect, it } from 'vitest'

import {
  drawingInThePrint,
  type SubjectAccess,
  subjectAccessFormat,
  subjectAccessParts,
  subjectAccessSearchParts,
  subjectAccessSources,
  subjectAccessTermProblem,
  withoutDrawings,
} from './subject-access.js'

describe('the machine-readable file of an information (#457)', () => {
  it('says that a signature is there instead of its drawing, and nothing where there is none', () => {
    const access: SubjectAccess = {
      format: subjectAccessFormat,
      version: 1,
      operator: 'Wohnbau Nord eG',
      madeAt: '2026-10-20T22:00:00.000Z',
      about: { kind: 'search', term: 'becker' },
      parts: [
        {
          key: 'clients',
          title: 'Unterschrift als Auftraggeber',
          note: null,
          columns: [
            { key: 'name', label: 'Name', kind: 'text' },
            { key: 'drawing', label: 'Schriftzug', kind: 'drawing' },
          ],
          rows: [
            { name: 'M 10 10 Becker', drawing: 'M 10 10 L 20 20' },
            { name: 'Becker', drawing: null },
          ],
        },
      ],
    }

    expect(withoutDrawings(access).parts[0]?.rows).toEqual([
      { name: 'M 10 10 Becker', drawing: drawingInThePrint },
      { name: 'Becker', drawing: null },
    ])
    // What is not a drawing stays as it is, and the information it came from too.
    expect(access.parts[0]?.rows[0]?.drawing).toBe('M 10 10 L 20 20')
  })
})

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
