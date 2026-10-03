import { describe, expect, it } from 'vitest'

import { defectLimits, defectProblems, defectStatuses, defectStatusLabel } from './defect.js'

describe('a defect', () => {
  it('goes from found to ordered, remedied and checked again', () => {
    expect(defectStatuses.map((status) => defectStatusLabel[status])).toEqual([
      'Festgestellt',
      'Beauftragt',
      'Behoben',
      'Nachgeprüft',
    ])
    expect(defectProblems({ status: 'closed' })).toEqual({
      status: 'Der Stand ist einer von: Festgestellt, Beauftragt, Behoben, Nachgeprüft.',
    })
  })

  it('has its description, and a class within its bounds', () => {
    expect(defectProblems({ description: '' })).toEqual({ description: 'Die Beschreibung fehlt.' })
    expect(defectProblems({ description: 'x'.repeat(defectLimits.description + 1) })).toEqual({
      description: 'Die Beschreibung hat höchstens 1000 Zeichen.',
    })
    expect(defectProblems({ defectClass: 'x'.repeat(defectLimits.defectClass + 1) })).toEqual({
      defectClass: 'Die Klasse hat höchstens 130 Zeichen.',
    })
    expect(
      defectProblems({
        description: 'Notbeleuchtung im Treppenhaus fällt aus.',
        defectClass: null,
      }),
    ).toEqual({})
  })

  it('is found on a day, and is to be set right on that day or later', () => {
    expect(defectProblems({ foundOn: null })).toEqual({
      foundOn: 'Der Tag der Feststellung ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(defectProblems({ foundOn: '2026-10-03', dueOn: '2026-10-32' })).toEqual({
      dueOn: 'Die Frist zur Beseitigung ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(defectProblems({ foundOn: '2026-10-03', dueOn: '2026-10-02' })).toEqual({
      dueOn: 'Die Frist zur Beseitigung liegt nicht vor dem Tag der Feststellung.',
    })
    expect(defectProblems({ foundOn: '2026-10-03', dueOn: '2026-10-03' })).toEqual({})
    expect(defectProblems({ foundOn: '2026-10-03', dueOn: null })).toEqual({})
    // A change of the day alone is asked about together with the row.
    expect(defectProblems({ dueOn: '2026-10-02' })).toEqual({})
  })
})
