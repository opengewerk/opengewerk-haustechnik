import type { Id, InvitationId, IsoDate } from '@opengewerk/platform-domain'

import { calendarDay } from './fields.js'
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

/** An area as a list names it. */
export interface Area {
  readonly id: AreaId
  readonly name: string
}

/**
 * The areas a membership holds in: every area, those made later included, or
 * the ones named. Named and none is somebody who sees nothing with a place,
 * which is what the removal of an area can leave behind (section 2.8); the
 * list of who works for the tenant says so, and nobody is blocked by it.
 */
export interface MemberAreas {
  readonly userId: string
  readonly all: boolean
  readonly areaIds: readonly AreaId[]
}

/** Whether somebody with these roles holds in every area, whatever is named for them. */
export function seesEveryArea(roles: readonly string[]): boolean {
  return roles.some((role) => (rolesSeeingEveryArea as readonly string[]).includes(role))
}

/** Said to whoever names areas for a role that holds in all of them. */
export const everyAreaSentence = 'Leitung und Technische Leitung haben immer alle Bereiche.'

/**
 * What is wrong with the areas somebody with these roles is to hold in, as a
 * sentence for the screen, or null when nothing is.
 *
 * Whoever leads the tenant and whoever answers for its duties hold in every
 * area (section 7 of the concept: "alle Bereiche"), so naming areas for them
 * is refused where areas are given. The database knows no such rule (ADR 0003,
 * point 2), it is what the routes and the screens of this application hold
 * to. Everybody else holds in all of them or in the ones named, none
 * included.
 */
export function memberAreasProblem(
  roles: readonly string[],
  wanted: Pick<MemberAreas, 'all'>,
): string | null {
  return seesEveryArea(roles) && !wanted.all ? everyAreaSentence : null
}

/**
 * What an invitation says about the areas of whoever takes it up: every area,
 * or the ones named, none included (section 2.8 of the concept: the Leitung
 * invites with a role and with areas). The same two things a membership holds,
 * and the same rule: `memberAreasProblem` with the roles of the invitation.
 *
 * An invitation that says nothing about areas has none of these, and whoever
 * takes it up begins with what a new membership is given.
 */
export interface InvitationAreas {
  readonly invitationId: InvitationId
  readonly all: boolean
  readonly areaIds: readonly AreaId[]
}

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

/**
 * What is wrong with a substitution somebody enters, as a sentence for the
 * screen, or null when nothing is: both people named, both days days of the
 * calendar, the two rules above, and an end that has not passed. `today` is
 * the day in Germany, where a substitution begins and ends.
 */
export function newSubstitutionProblem(
  wanted: Readonly<Record<string, unknown>>,
  today: IsoDate,
): string | null {
  const { substitute, absent, startsOn, endsOn } = wanted

  if (typeof substitute !== 'string' || substitute === '') {
    return 'Wer vertritt, fehlt.'
  }

  if (typeof absent !== 'string' || absent === '') {
    return 'Wer vertreten wird, fehlt.'
  }

  if (!calendarDay(startsOn)) {
    return 'Der Anfang der Vertretung ist kein Tag.'
  }

  if (!calendarDay(endsOn)) {
    return 'Das Ende der Vertretung ist kein Tag.'
  }

  const problem = substitutionProblem({
    substitute,
    absent,
    startsOn: startsOn as IsoDate,
    endsOn: endsOn as IsoDate,
  })

  if (problem !== null) {
    return problem
  }

  return endsOn < today ? 'Die Vertretung liegt in der Vergangenheit.' : null
}
