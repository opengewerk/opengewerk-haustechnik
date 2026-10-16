import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  type ContractTerm,
  contractProblems,
  contractStanding,
  contractTermProblems,
  noticeBy,
  noticeWords,
  termEnd,
} from './contract.js'

const day = (text: string) => text as IsoDate

/** A contract from the 1st of January 2024, a first term to the end of 2024, renewed by a year, three months' notice. */
const lifts: ContractTerm = {
  startsOn: day('2024-01-01'),
  endsOn: day('2024-12-31'),
  renewalMonths: 12,
  noticeAmount: 3,
  noticeUnit: 'months',
  cancelledTo: null,
}

describe('the term of a contract', () => {
  it('ends with the first term while that runs, and renews term by term after it', () => {
    expect(termEnd(lifts, day('2024-06-01'))).toBe('2024-12-31')
    expect(termEnd(lifts, day('2024-12-31'))).toBe('2024-12-31')
    expect(termEnd(lifts, day('2025-01-01'))).toBe('2025-12-31')
    expect(termEnd(lifts, day('2026-10-16'))).toBe('2026-12-31')
  })

  it('counts every term from the end of the first, so that the last day of a month stays the last', () => {
    const quarterly: ContractTerm = { ...lifts, endsOn: day('2025-01-31'), renewalMonths: 1 }

    expect(termEnd(quarterly, day('2025-02-15'))).toBe('2025-02-28')
    expect(termEnd(quarterly, day('2025-03-01'))).toBe('2025-03-31')
  })

  it('ends on its last day without a renewal, has no end without one, and ends where notice was given', () => {
    expect(termEnd({ ...lifts, renewalMonths: null }, day('2026-10-16'))).toBe('2024-12-31')
    expect(termEnd({ ...lifts, endsOn: null, renewalMonths: null }, day('2026-10-16'))).toBeNull()
    expect(termEnd({ ...lifts, cancelledTo: day('2026-12-31') }, day('2026-10-16'))).toBe(
      '2026-12-31',
    )
  })
})

describe('the last day to give notice', () => {
  it('lies the notice period before the end of the term that runs, in months or in weeks', () => {
    expect(noticeBy(lifts, day('2026-06-01'))).toBe('2026-09-30')
    expect(noticeBy({ ...lifts, noticeAmount: 6, noticeUnit: 'weeks' }, day('2026-06-01'))).toBe(
      '2026-11-19',
    )
  })

  it('stays the day of this term once it has passed, and moves on with the next term', () => {
    expect(noticeBy(lifts, day('2026-10-16'))).toBe('2026-09-30')
    expect(noticeBy(lifts, day('2027-01-01'))).toBe('2027-09-30')
  })

  it('is none once notice is given, without a notice period or without an end', () => {
    expect(noticeBy({ ...lifts, cancelledTo: day('2026-12-31') }, day('2026-06-01'))).toBeNull()
    expect(
      noticeBy({ ...lifts, noticeAmount: null, noticeUnit: null }, day('2026-06-01')),
    ).toBeNull()
    expect(noticeBy({ ...lifts, endsOn: null, renewalMonths: null }, day('2026-06-01'))).toBeNull()
    // Nor once it has ended.
    expect(noticeBy({ ...lifts, renewalMonths: null }, day('2025-06-01'))).toBeNull()
  })
})

describe('how a contract stands', () => {
  it('runs, renews once the day to give notice has passed, and is cancelled once notice is given', () => {
    expect(contractStanding(lifts, day('2026-06-01'))).toBe('running')
    expect(contractStanding(lifts, day('2026-10-16'))).toBe('renews')
    expect(contractStanding({ ...lifts, cancelledTo: day('2026-12-31') }, day('2026-10-16'))).toBe(
      'cancelled',
    )
  })

  it('has ended after its last day, without a renewal or with notice given, and begins later before its first', () => {
    expect(contractStanding({ ...lifts, renewalMonths: null }, day('2025-01-01'))).toBe('ended')
    expect(contractStanding({ ...lifts, cancelledTo: day('2026-12-31') }, day('2027-01-01'))).toBe(
      'ended',
    )
    expect(contractStanding(lifts, day('2023-12-01'))).toBe('upcoming')
  })

  it('runs for good without an end, and renews unseen without a notice period', () => {
    expect(
      contractStanding({ ...lifts, endsOn: null, renewalMonths: null }, day('2030-01-01')),
    ).toBe('running')
    expect(
      contractStanding({ ...lifts, noticeAmount: null, noticeUnit: null }, day('2026-10-16')),
    ).toBe('running')
  })
})

describe('the fields of a contract', () => {
  it('want a title, days written as days, and whole numbers in their bounds', () => {
    expect(
      contractProblems({
        title: ' ',
        startsOn: '01.01.2024',
        endsOn: '2024-02-30',
        renewalMonths: 0,
        noticeAmount: 1.5,
        noticeUnit: 'days',
        price: 'x'.repeat(121),
      }),
    ).toEqual({
      title: 'Die Bezeichnung fehlt.',
      startsOn: 'Der Beginn ist ein Tag, geschrieben 2026-10-03.',
      endsOn: 'Das Ende der Laufzeit ist ein Tag, geschrieben 2026-10-03.',
      renewalMonths: 'Die Verlängerung ist eine ganze Zahl von 1 bis 120 Monaten.',
      noticeAmount: 'Die Kündigungsfrist ist eine ganze Zahl von 1 bis 99.',
      noticeUnit: 'Die Kündigungsfrist zählt in Wochen oder Monaten.',
      price: 'Der Preis hat höchstens 120 Zeichen.',
    })
    expect(contractProblems({ title: 'Wartung der Aufzüge', startsOn: '2024-01-01' })).toEqual({})
  })

  it('say together no end before the beginning, no renewal without an end and no notice without its unit', () => {
    expect(
      contractTermProblems({
        startsOn: day('2024-01-01'),
        endsOn: day('2023-12-31'),
        renewalMonths: null,
        noticeAmount: 3,
        noticeUnit: null,
        cancelledTo: day('2023-06-30'),
      }),
    ).toEqual({
      endsOn: 'Das Ende der Laufzeit liegt nicht vor dem Beginn.',
      noticeAmount: 'Eine Kündigungsfrist hat eine Zahl und ihre Einheit.',
      cancelledTo: 'Gekündigt wird ein Vertrag nicht zu einem Tag vor seinem Beginn.',
    })
    expect(contractTermProblems({ ...lifts, endsOn: null })).toEqual({
      renewalMonths: 'Verlängern kann sich nur ein Vertrag mit einem Ende der Laufzeit.',
    })
    expect(contractTermProblems(lifts)).toEqual({})
  })

  it('say a notice period in words', () => {
    expect(noticeWords(lifts)).toBe('3 Monate')
    expect(noticeWords({ noticeAmount: 1, noticeUnit: 'weeks' })).toBe('1 Woche')
    expect(noticeWords({ noticeAmount: null, noticeUnit: null })).toBeNull()
  })
})
