/**
 * The longest name a tenant may have. It stands in the top bar and in the
 * list somebody who works for several tenants chooses from, so it is the
 * short name the organisation goes by.
 */
export const tenantNameMaxLength = 120

/**
 * What is wrong with a name for a tenant, as a sentence for the screen, or
 * null when nothing is.
 *
 * A tenant is called "Betreiber" where a person reads it (ADR 0001, point
 * 11). The first run of an instance and every later way a tenant comes into
 * being ask this one question, so that no name comes in through one door that
 * another would refuse. Surrounding spaces do not count: the name is stored
 * trimmed.
 */
export function tenantNameProblem(name: string): string | null {
  const trimmed = name.trim()

  if (trimmed === '') {
    return 'Der Name des Betreibers fehlt.'
  }

  if (trimmed.length > tenantNameMaxLength) {
    return `Der Name des Betreibers ist länger als ${String(tenantNameMaxLength)} Zeichen.`
  }

  return null
}
