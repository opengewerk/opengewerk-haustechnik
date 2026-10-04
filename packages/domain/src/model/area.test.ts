import { describe, expect, it } from 'vitest'

import {
  areaNameMaxLength,
  areaNameProblem,
  everyAreaSentence,
  memberAreasProblem,
  newSubstitutionProblem,
  rolesSeeingEveryArea,
  seesEveryArea,
  substitutionProblem,
} from './area.js'
import { roleKeys, shippedRoles } from './rights.js'

describe('the name of an area', () => {
  it('is fine when there is one', () => {
    expect(areaNameProblem('Nord')).toBeNull()
    expect(areaNameProblem('  Liegenschaften im Süden  ')).toBeNull()
  })

  it('is missing when it is empty or only spaces', () => {
    expect(areaNameProblem('')).toBe('Der Name des Bereichs fehlt.')
    expect(areaNameProblem('   ')).toBe('Der Name des Bereichs fehlt.')
  })

  it('may be as long as the limit and no longer, spaces around it not counted', () => {
    expect(areaNameProblem('x'.repeat(areaNameMaxLength))).toBeNull()
    expect(areaNameProblem(` ${'x'.repeat(areaNameMaxLength)} `)).toBeNull()
    expect(areaNameProblem('x'.repeat(areaNameMaxLength + 1))).toBe(
      `Der Name des Bereichs ist länger als ${String(areaNameMaxLength)} Zeichen.`,
    )
  })
})

describe('the roles that see every area from the start', () => {
  it('are whoever leads and whoever answers for the duties across the tenant', () => {
    expect(rolesSeeingEveryArea).toEqual(['management', 'technical_management'])
  })

  it('are roles the tenant begins with, among them every role that leads', () => {
    // A key that names no role would give nobody anything, and whoever leads
    // a tenant hands out the areas, so must see them all from the start.
    expect(rolesSeeingEveryArea.every((key) => roleKeys.includes(key))).toBe(true)
    expect(
      shippedRoles
        .filter((role) => role.leads)
        .every((role) => rolesSeeingEveryArea.includes(role.key)),
    ).toBe(true)
  })
})

describe('a substitution', () => {
  const substitution = {
    substitute: 'user-south',
    absent: 'user-north',
    startsOn: '2026-10-05',
    endsOn: '2026-10-09',
  }

  it('is fine for somebody else and for at least one day', () => {
    expect(substitutionProblem(substitution)).toBeNull()
    expect(substitutionProblem({ ...substitution, endsOn: '2026-10-05' })).toBeNull()
  })

  it('is not one for oneself', () => {
    expect(substitutionProblem({ ...substitution, absent: 'user-south' })).toBe(
      'Niemand vertritt sich selbst.',
    )
  })

  it('does not end before it begins', () => {
    expect(substitutionProblem({ ...substitution, endsOn: '2026-10-04' })).toBe(
      'Die Vertretung endet, bevor sie beginnt.',
    )
  })
})

describe('the areas somebody is given', () => {
  it('are all of them for whoever leads and whoever answers for the duties, whatever else they are', () => {
    expect(seesEveryArea(['management'])).toBe(true)
    expect(seesEveryArea(['technician', 'technical_management'])).toBe(true)
    expect(seesEveryArea(['site_management'])).toBe(false)
    expect(seesEveryArea(['technician'])).toBe(false)
    expect(seesEveryArea([])).toBe(false)
  })

  it('cannot be named for a role that holds in every area', () => {
    expect(memberAreasProblem(['management'], { all: false })).toBe(everyAreaSentence)
    expect(memberAreasProblem(['technical_management'], { all: false })).toBe(everyAreaSentence)
    expect(memberAreasProblem(['management'], { all: true })).toBeNull()
  })

  it('are all of them or the ones named for everybody else', () => {
    expect(memberAreasProblem(['site_management'], { all: false })).toBeNull()
    expect(memberAreasProblem(['site_management'], { all: true })).toBeNull()
    expect(memberAreasProblem(['technician'], { all: false })).toBeNull()
  })

  // The sentence names the roles by what a tenant reads; a role added to the
  // list has to be added to the sentence.
  it('are refused with a sentence that names every role the list names', () => {
    for (const key of rolesSeeingEveryArea) {
      const label = shippedRoles.find((role) => role.key === key)?.label ?? key

      expect(everyAreaSentence).toContain(label)
    }
  })
})

describe('a substitution somebody enters', () => {
  const today = '2026-10-05'
  const wanted = {
    substitute: 'user-south',
    absent: 'user-north',
    startsOn: '2026-10-12',
    endsOn: '2026-10-23',
  }

  it('is fine for two people and days that have not passed', () => {
    expect(newSubstitutionProblem(wanted, today)).toBeNull()
    // Begun before today and still running, and one for today alone.
    expect(newSubstitutionProblem({ ...wanted, startsOn: '2026-10-01' }, today)).toBeNull()
    expect(newSubstitutionProblem({ ...wanted, startsOn: today, endsOn: today }, today)).toBeNull()
  })

  it('names both people', () => {
    expect(newSubstitutionProblem({ ...wanted, substitute: '' }, today)).toBe(
      'Wer vertritt, fehlt.',
    )
    expect(newSubstitutionProblem({ ...wanted, substitute: undefined }, today)).toBe(
      'Wer vertritt, fehlt.',
    )
    expect(newSubstitutionProblem({ ...wanted, absent: 7 }, today)).toBe(
      'Wer vertreten wird, fehlt.',
    )
  })

  it('begins and ends on a day of the calendar', () => {
    expect(newSubstitutionProblem({ ...wanted, startsOn: '12.10.2026' }, today)).toBe(
      'Der Anfang der Vertretung ist kein Tag.',
    )
    expect(newSubstitutionProblem({ ...wanted, endsOn: '2026-02-30' }, today)).toBe(
      'Das Ende der Vertretung ist kein Tag.',
    )
    expect(newSubstitutionProblem({ ...wanted, endsOn: null }, today)).toBe(
      'Das Ende der Vertretung ist kein Tag.',
    )
  })

  it('holds to what every substitution holds to', () => {
    expect(newSubstitutionProblem({ ...wanted, absent: 'user-south' }, today)).toBe(
      'Niemand vertritt sich selbst.',
    )
    expect(newSubstitutionProblem({ ...wanted, endsOn: '2026-10-11' }, today)).toBe(
      'Die Vertretung endet, bevor sie beginnt.',
    )
  })

  it('does not lie wholly in the past', () => {
    expect(
      newSubstitutionProblem({ ...wanted, startsOn: '2026-09-28', endsOn: '2026-10-04' }, today),
    ).toBe('Die Vertretung liegt in der Vergangenheit.')
  })
})
