import { describe, expect, it } from 'vitest'

import { correctionProblems } from './evidence-page.js'

const today = '2026-10-08'

/** A correction of a report that nothing is wrong with. */
const sound = {
  reason: 'Im Bericht steht ein anderer Tag.',
  performedOn: '2026-10-01',
  result: 'with_defects',
  resultReason: null,
  examiner: 'Klaus Berger',
  examinerOrganisation: 'Brandschutz Beispiel GmbH',
}

/** The same correction for an evidence that is no report: it names no examiner. */
const ofAPerson = { ...sound, examiner: null, examinerOrganisation: null }

describe('a correction of an evidence', () => {
  it('is sound with a reason, a past day, a result and, for a report, the examiner', () => {
    expect(correctionProblems(sound, 'report', today)).toEqual({})
    expect(correctionProblems(ofAPerson, 'round_point', today)).toEqual({})
    expect(correctionProblems({ ...sound, performedOn: today }, 'report', today)).toEqual({})
  })

  it('says why: a correction without a reason is none', () => {
    expect(correctionProblems({ ...sound, reason: '  ' }, 'report', today)).toEqual({
      reason: 'Eine Berichtigung nennt ihren Grund.',
    })
    expect(correctionProblems({ ...sound, reason: 'x'.repeat(501) }, 'report', today)).toEqual({
      reason: 'Der Grund hat höchstens 500 Zeichen.',
    })
  })

  it('states the whole day and result, and the day lies in the past', () => {
    expect(
      correctionProblems({ ...sound, performedOn: undefined, result: undefined }, 'report', today),
    ).toEqual({
      performedOn: 'Der Tag der Durchführung fehlt.',
      result: 'Das Ergebnis fehlt.',
    })
    expect(correctionProblems({ ...sound, performedOn: '2026-10-09' }, 'report', today)).toEqual({
      performedOn: 'Ein Nachweis gilt für einen Tag, der schon war.',
    })
    expect(
      correctionProblems({ ...sound, result: 'not_performed' }, 'report', today).resultReason,
    ).toBe('Was nicht durchgeführt wurde, nennt den Grund.')
  })

  it('names the examiner of a report, and only of a report', () => {
    expect(
      correctionProblems({ ...sound, examiner: null, examinerOrganisation: null }, 'report', today),
    ).toEqual({
      examiner: 'Ein Bericht nennt den Prüfer.',
      examinerOrganisation: 'Ein Bericht nennt die Organisation des Prüfers.',
    })
    expect(correctionProblems(sound, 'protocol', today)).toEqual({
      examiner: 'Prüfer und Organisation nennt nur ein Bericht.',
    })
    expect(correctionProblems({ ...ofAPerson, examiner: 'Klaus Berger' }, 'legacy', today)).toEqual(
      { examiner: 'Prüfer und Organisation nennt nur ein Bericht.' },
    )
    expect(correctionProblems({ ...sound, examiner: null }, 'report', today)).toEqual({
      examiner: 'Prüfer und Organisation stehen zusammen: wer von außen prüft, nennt beide.',
    })
  })
})
