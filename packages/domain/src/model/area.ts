import type { Id, IsoDate } from '@opengewerk/platform-domain'

import type { RoleKey } from './rights.js'

/**
 * An area bundles properties within one tenant (section 2.8 of the concept,
 * Leitentscheidung 8). Whoever answers for the properties in the north sees
 * and works on those and not the ones in the south, and their device holds
 * none of the south. The database draws that line (ADR 0003): a row with a
 * place carries its area, and a policy lets through the areas of the person
 * asking and no others.
 */
export type AreaId = Id<'area'>

/** The longest name of an area. It stands beside a property wherever one is listed. */
export const areaNameMaxLength = 120

/**
 * The area a tenant begins with. The database makes it with the first
 * membership of a tenant, so a small tenant has it from the first moment and
 * never sees the word "Bereich" do anything.
 */
export const firstAreaName = 'Alle Liegenschaften'

/**
 * What is wrong with a name for an area, as a sentence for the screen, or null
 * when nothing is. Surrounding spaces do not count: the name is stored
 * trimmed, and the database refuses one that is not.
 */
export function areaNameProblem(name: string): string | null {
  const trimmed = name.trim()

  if (trimmed === '') {
    return 'Der Name des Bereichs fehlt.'
  }

  if (trimmed.length > areaNameMaxLength) {
    return `Der Name des Bereichs ist länger als ${String(areaNameMaxLength)} Zeichen.`
  }

  return null
}

/**
 * The roles that see every area from the moment a membership is made with
 * them: whoever leads the tenant and whoever answers for its duties across
 * every area (section 7 of the concept). Everybody else sees the areas named
 * for them; while a tenant has a single area that is the one, with more it is
 * none until somebody names one, which is the direction a mistake has to fail
 * in.
 *
 * A default when a membership is made and no rule of the database (ADR 0003,
 * point 2): the areas of anybody may be widened or narrowed afterwards. The
 * database applies the same list in the function that gives a new membership
 * its areas, and a test of the server holds the two together.
 */
export const rolesSeeingEveryArea: readonly RoleKey[] = ['management', 'technical_management']

/**
 * A substitution: for a stretch of days somebody takes over the areas of
 * somebody else, both days included (section 2.8 of the concept). People are
 * named by the id of their account, as a membership names them.
 */
export interface Substitution {
  readonly substitute: string
  readonly absent: string
  readonly startsOn: IsoDate
  readonly endsOn: IsoDate
}

/**
 * What is wrong with a substitution, as a sentence for the screen, or null
 * when nothing is. The database holds the same two rules for every other way
 * in.
 */
export function substitutionProblem(substitution: Substitution): string | null {
  if (substitution.substitute === substitution.absent) {
    return 'Niemand vertritt sich selbst.'
  }

  // Both are days written as ISO 8601, which sort as they read.
  if (substitution.endsOn < substitution.startsOn) {
    return 'Die Vertretung endet, bevor sie beginnt.'
  }

  return null
}
