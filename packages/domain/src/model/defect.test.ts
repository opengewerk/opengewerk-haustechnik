import { describe, expect, it } from 'vitest'

import type { CatalogueDefectClass } from './catalogue.js'
import {
  awaitsRemedy,
  defaultDueOn,
  defectChangeRefusal,
  defectCheckProblems,
  defectCheckRefusal,
  defectClassChoices,
  defectLimits,
  defectProblems,
  defectStatuses,
  defectStatusLabel,
  defectTermProblem,
  isOverdue,
  statusAfterCheck,
} from './defect.js'

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

/** A class of a package as the catalogue hands it out. */
function defectClass(key: string, label: string): CatalogueDefectClass {
  return {
    defectClass: { key, label, unsafe: false, source: null },
    review: { checkedOn: '2026-10-01', accepted: null },
  }
}

describe('the classes a defect may take', () => {
  const general = [
    defectClass('allgemein.minor', 'gering'),
    defectClass('allgemein.significant', 'erheblich'),
  ]
  const electrical = [defectClass('elektro.e1', 'Stufe 1')]
  const catalogue = {
    defectClasses: (name: string) =>
      name === 'allgemein' ? general : name === 'elektro' ? electrical : [],
  }

  it('are the general ones for a defect found by hand or in a round', () => {
    expect(defectClassChoices(catalogue, [])).toEqual(general)
    expect(defectClassChoices(catalogue, [null])).toEqual(general)
  })

  it('are those of the packages of the duty kinds for a defect found in a test', () => {
    expect(defectClassChoices(catalogue, ['elektro.dguv-v3', 'elektro.vde-0100'])).toEqual(
      electrical,
    )
  })

  it('are the general ones where the packages of the test name none', () => {
    expect(defectClassChoices(catalogue, ['heizung.abgas'])).toEqual(general)
  })
})

describe('the day a defect is to be set right by', () => {
  it('is the default of its class, counted from the day it was found', () => {
    expect(defaultDueOn('2026-10-05', 14)).toBe('2026-10-19')
    expect(defaultDueOn('2026-10-05', null)).toBeNull()
  })

  it('takes a default of whole days from one to ten years', () => {
    expect(defectTermProblem(1)).toBeNull()
    expect(defectTermProblem(3650)).toBeNull()

    for (const days of [0, 3651, 1.5, '14', null]) {
      expect(defectTermProblem(days)).toBe('Die Vorgabe ist eine ganze Zahl von 1 bis 3650 Tagen.')
    }
  })

  it('asks for something while the defect is found or ordered, and is past once that day is', () => {
    expect(defectStatuses.filter(awaitsRemedy)).toEqual(['found', 'ordered'])
    expect(isOverdue({ status: 'ordered', dueOn: '2026-10-07' }, '2026-10-08')).toBe(true)
    expect(isOverdue({ status: 'found', dueOn: '2026-10-08' }, '2026-10-08')).toBe(false)
    expect(isOverdue({ status: 'remedied', dueOn: '2026-10-01' }, '2026-10-08')).toBe(false)
    expect(isOverdue({ status: 'found', dueOn: null }, '2026-10-08')).toBe(false)
  })

  it('is not found on a day after today, where a route knows today', () => {
    expect(defectProblems({ foundOn: '2026-10-09' }, '2026-10-08')).toEqual({
      foundOn: 'Der Tag der Feststellung liegt nicht in der Zukunft.',
    })
    expect(defectProblems({ foundOn: '2026-10-08' }, '2026-10-08')).toEqual({})
  })
})

describe('checking a defect again', () => {
  const today = '2026-10-08'

  it('is a step only from remedied', () => {
    expect(defectCheckRefusal('remedied')).toBeNull()

    for (const status of ['found', 'ordered', 'verified'] as const) {
      expect(defectCheckRefusal(status)).toBe(
        'Nachprüfen lässt sich nur ein Mangel, der behoben ist.',
      )
    }
  })

  it('leaves it checked again, or found once more to be ordered anew', () => {
    expect(statusAfterCheck).toEqual({ verified: 'verified', not_remedied: 'found' })
  })

  it('says how it came out, on a day neither after today nor before the defect was found', () => {
    const check = { outcome: 'verified', checkedOn: today, note: null }

    expect(defectCheckProblems(check, '2026-10-01', today)).toEqual({})
    expect(defectCheckProblems({ ...check, outcome: 'maybe' }, '2026-10-01', today)).toEqual({
      outcome: 'Sagen Sie, ob der Mangel behoben ist.',
    })
    expect(defectCheckProblems({ ...check, checkedOn: '2026-10-09' }, '2026-10-01', today)).toEqual(
      { checkedOn: 'Der Tag der Nachprüfung liegt nicht in der Zukunft.' },
    )
    expect(defectCheckProblems({ ...check, checkedOn: '2026-09-30' }, '2026-10-01', today)).toEqual(
      { checkedOn: 'Der Tag der Nachprüfung liegt nicht vor dem Tag der Feststellung.' },
    )
    expect(defectCheckProblems({ ...check, checkedOn: '8.10.2026' }, '2026-10-01', today)).toEqual({
      checkedOn: 'Der Tag der Nachprüfung ist ein Tag, geschrieben 2026-10-03.',
    })
  })

  it('says what was found where the defect was not set right, within its bounds', () => {
    const check = { outcome: 'not_remedied', checkedOn: today }

    expect(defectCheckProblems({ ...check, note: ' ' }, '2026-10-01', today)).toEqual({
      note: 'Sagen Sie, was Sie vorgefunden haben.',
    })
    expect(
      defectCheckProblems({ ...check, note: 'Tür klemmt weiter' }, '2026-10-01', today),
    ).toEqual({})
    expect(
      defectCheckProblems(
        { ...check, note: 'x'.repeat(defectLimits.checkNote + 1) },
        '2026-10-01',
        today,
      ),
    ).toEqual({ note: 'Die Bemerkung hat höchstens 1000 Zeichen.' })
  })

  it('leaves a defect done that was checked again: it changes no more', () => {
    expect(defectChangeRefusal('verified')).toBe(
      'Ein nachgeprüfter Mangel ist erledigt und ändert sich nicht mehr.',
    )

    for (const status of ['found', 'ordered', 'remedied'] as const) {
      expect(defectChangeRefusal(status)).toBeNull()
    }
  })
})
