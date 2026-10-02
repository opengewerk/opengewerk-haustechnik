import { describe, expect, it } from 'vitest'

import { tenantNameMaxLength, tenantNameProblem } from './tenant.js'

/**
 * The name of a tenant, asked at the first run of an instance and wherever a
 * further tenant comes into being. Every door refuses the same names with the
 * same sentence.
 */
describe('the name of a tenant', () => {
  it('is fine when there is one', () => {
    expect(tenantNameProblem('Stadtwerke Musterstadt')).toBeNull()
    expect(tenantNameProblem('  Stadtwerke Musterstadt  ')).toBeNull()
  })

  it('is missing when it is empty or only spaces', () => {
    expect(tenantNameProblem('')).toBe('Der Name des Betreibers fehlt.')
    expect(tenantNameProblem('   ')).toBe('Der Name des Betreibers fehlt.')
  })

  it('may be as long as the limit and no longer, spaces around it not counted', () => {
    expect(tenantNameProblem('x'.repeat(tenantNameMaxLength))).toBeNull()
    expect(tenantNameProblem(` ${'x'.repeat(tenantNameMaxLength)} `)).toBeNull()
    expect(tenantNameProblem('x'.repeat(tenantNameMaxLength + 1))).toBe(
      `Der Name des Betreibers ist länger als ${String(tenantNameMaxLength)} Zeichen.`,
    )
  })
})
