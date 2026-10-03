import { describe, expect, it } from 'vitest'

import {
  areaNameMaxLength,
  areaNameProblem,
  rolesSeeingEveryArea,
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
