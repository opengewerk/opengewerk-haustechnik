import { describe, expect, it } from 'vitest'

import {
  dismissalProblems,
  dutyInterval,
  dutyIntervalProblem,
  dutyLimits,
  dutyMaximum,
  dutyProblems,
  intervalNeedsReason,
  intervalOfRule,
  intervalWords,
} from './duty-record.js'

describe('the interval of a duty', () => {
  it('stands in days or in months, exactly one of both', () => {
    const sentence = 'Die Frist steht in Tagen oder in Monaten, genau eines von beiden.'

    expect(dutyIntervalProblem({}, 'from_performance', null)).toBe(sentence)
    expect(
      dutyIntervalProblem({ intervalDays: 30, intervalMonths: 1 }, 'from_performance', null),
    ).toBe(sentence)
    expect(dutyIntervalProblem({ intervalDays: 30 }, 'from_performance', null)).toBeNull()
    expect(dutyIntervalProblem({ intervalMonths: 12 }, 'from_due', null)).toBeNull()
  })

  it('stays within the bounds of the deadline engine', () => {
    expect(dutyIntervalProblem({ intervalDays: 0 }, 'from_performance', null)).toBe(
      'Die Frist ist eine ganze Zahl von Tagen, mindestens 1.',
    )
    expect(dutyIntervalProblem({ intervalDays: '30' }, 'from_performance', null)).toBe(
      'Die Frist ist eine ganze Zahl von Tagen, mindestens 1.',
    )
    expect(dutyIntervalProblem({ intervalMonths: 601 }, 'from_performance', null)).toBe(
      'Die Frist ist höchstens 600 Monate lang.',
    )
  })

  it('counts in months under § 14 Abs. 5 BetrSichV', () => {
    expect(dutyIntervalProblem({ intervalDays: 300 }, 'betrsichv', null)).toBe(
      'Nach § 14 Abs. 5 BetrSichV zählt die Frist in Monaten.',
    )
    expect(dutyIntervalProblem({ intervalMonths: 12 }, 'betrsichv', null)).toBeNull()
  })

  it('may shorten a maximum and never exceed it, in the unit of the maximum', () => {
    const twoYears = { months: 24 }

    expect(dutyIntervalProblem({ intervalMonths: 24 }, 'betrsichv', twoYears)).toBeNull()
    expect(dutyIntervalProblem({ intervalMonths: 12 }, 'betrsichv', twoYears)).toBeNull()
    expect(dutyIntervalProblem({ intervalMonths: 25 }, 'betrsichv', twoYears)).toBe(
      'Die Höchstfrist beträgt 24 Monate, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.',
    )
    expect(dutyIntervalProblem({ intervalDays: 300 }, 'from_due', twoYears)).toBe(
      'Die Höchstfrist dieser Pflicht zählt in Monaten, die Frist ebenso.',
    )
    expect(dutyIntervalProblem({ intervalMonths: 1 }, 'from_due', { days: 7 })).toBe(
      'Die Höchstfrist dieser Pflicht zählt in Tagen, die Frist ebenso.',
    )
    expect(dutyIntervalProblem({ intervalDays: 8 }, 'from_due', { days: 7 })).toBe(
      'Die Höchstfrist beträgt 7 Tage, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.',
    )
    expect(dutyIntervalProblem({ intervalDays: 7 }, 'from_due', { days: 7 })).toBeNull()
  })

  it('is read as the deadline engine counts it, with its maximum', () => {
    expect(dutyInterval({ intervalDays: null, intervalMonths: 12 })).toEqual({ months: 12 })
    expect(dutyInterval({ intervalDays: 7, intervalMonths: null })).toEqual({ days: 7 })
    expect(dutyMaximum({ maximumDays: null, maximumMonths: 24 })).toEqual({ months: 24 })
    expect(dutyMaximum({ maximumDays: 7, maximumMonths: null })).toEqual({ days: 7 })
    expect(dutyMaximum({ maximumDays: null, maximumMonths: null })).toBeNull()
  })

  it('comes from a rule in days, months or years, years counted as months', () => {
    expect(intervalOfRule({ value: 7, unit: 'days' })).toEqual({ days: 7 })
    expect(intervalOfRule({ value: 24, unit: 'months' })).toEqual({ months: 24 })
    expect(intervalOfRule({ value: 2, unit: 'years' })).toEqual({ months: 24 })
    expect(intervalOfRule({ value: 12, unit: 'kilowatts' })).toBeNull()
  })

  it('is said in words, one and more', () => {
    expect(intervalWords({ months: 1 })).toBe('1 Monat')
    expect(intervalWords({ months: 24 })).toBe('24 Monate')
    expect(intervalWords({ days: 1 })).toBe('1 Tag')
    expect(intervalWords({ days: 7 })).toBe('7 Tage')
  })
})

describe('the reason of an interval', () => {
  it('is needed where the kind leaves the interval to the operator', () => {
    expect(intervalNeedsReason('none', { months: 12 }, null)).toBe(true)
  })

  it('is needed for a departure from a guide, in value or in unit, and not for the guide itself', () => {
    expect(intervalNeedsReason('guide', { months: 12 }, { months: 12 })).toBe(false)
    expect(intervalNeedsReason('guide', { months: 18 }, { months: 12 })).toBe(true)
    expect(intervalNeedsReason('guide', { days: 365 }, { months: 12 })).toBe(true)
    expect(intervalNeedsReason('guide', { days: 7 }, { days: 7 })).toBe(false)
    expect(intervalNeedsReason('guide', { days: 14 }, { days: 7 })).toBe(true)
  })

  it('is not needed for a shortened maximum, nor for a duty of the operator own', () => {
    expect(intervalNeedsReason('maximum', { months: 12 }, null)).toBe(false)
    expect(intervalNeedsReason(null, { months: 12 }, null)).toBe(false)
  })
})

describe('the texts and choices of a duty', () => {
  it('are bounded, one sentence per field', () => {
    expect(
      dutyProblems({
        label: 'x'.repeat(dutyLimits.label + 1),
        sourceNote: 'x'.repeat(dutyLimits.sourceNote + 1),
        intervalReason: 'x'.repeat(dutyLimits.intervalReason + 1),
        performerNote: 'x'.repeat(dutyLimits.performerNote + 1),
        endReason: 'x'.repeat(dutyLimits.endReason + 1),
      }),
    ).toEqual({
      label: 'Die Bezeichnung hat höchstens 120 Zeichen.',
      sourceNote: 'Die Quelle hat höchstens 300 Zeichen.',
      intervalReason: 'Die Begründung der Frist hat höchstens 500 Zeichen.',
      performerNote: 'Die Angabe zur Fremdfirma hat höchstens 200 Zeichen.',
      endReason: 'Der Grund für das Ende hat höchstens 300 Zeichen.',
    })
  })

  it('take their choices from the lists, and an end that is a day', () => {
    expect(
      dutyProblems({
        basis: 'contract',
        task: 'cleaning',
        performer: 'neighbour',
        counting: 'weekly',
        endsOn: '2026-02-30',
      }),
    ).toEqual({
      basis:
        'Die Grundlage ist keine von: Vorgabe des Herstellers, Auflage aus Baugenehmigung oder Brandschutzkonzept, Forderung des Versicherers, Eigene Festlegung.',
      task: 'Die Tätigkeit ist keine von: Prüfung, Wartung, Inspektion, Funktionskontrolle, Sichtkontrolle, Probenahme.',
      performer: 'Ausgeführt wird von eigenen Leuten oder einer Fremdfirma.',
      counting:
        'Gezählt wird ab dem Tag der Durchführung, ab dem fälligen Tag oder nach § 14 Abs. 5 BetrSichV.',
      endsOn: 'Das Ende ist ein Tag, geschrieben 2026-10-03.',
    })
    expect(
      dutyProblems({
        basis: 'manufacturer',
        task: 'sampling',
        performer: 'contractor',
        counting: 'from_due',
        endsOn: '2027-12-31',
      }),
    ).toEqual({})
  })

  it('may leave out what it does not change', () => {
    expect(dutyProblems({})).toEqual({})
    expect(
      dutyProblems({ label: null, basis: null, task: null, performer: null, endsOn: null }),
    ).toEqual({})
  })
})

describe('a dismissal', () => {
  it('has its reason, within its bounds', () => {
    expect(dismissalProblems({})).toEqual({ reason: 'Die Begründung fehlt.' })
    expect(dismissalProblems({ reason: '   ' })).toEqual({ reason: 'Die Begründung fehlt.' })
    expect(dismissalProblems({ reason: 'x'.repeat(dutyLimits.dismissalReason + 1) })).toEqual({
      reason: 'Die Begründung hat höchstens 500 Zeichen.',
    })
    expect(dismissalProblems({ reason: 'Die Anlage hat keine Druckbehälter.' })).toEqual({})
  })
})
