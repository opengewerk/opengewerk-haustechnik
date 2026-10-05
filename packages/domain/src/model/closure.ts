import type { Id, IsoDate, Synced } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import { calendarDay, optional, type Problems } from './fields.js'
import type { BuildingId, PropertyId } from './location.js'

/**
 * The times a building is closed (section 4.1 of the concept): the holidays
 * of a school, the days between the years, a refurbishment. While a building
 * is closed no round is made for it (4.5), so that nobody is sent to a locked
 * door and no round stays open that nobody could have walked.
 *
 * A closure runs from a day to a day, both of them closed, and says on
 * request what it is for. One that was entered wrongly is removed and entered
 * again: none is changed in place, so the log of a building says in two lines
 * what stood there and what stands there now.
 *
 * Entered by whoever plans and hands out activities (section 7): a closure
 * belongs to the planning of the rounds and not to the structure of the
 * building. A device holds the closures of the buildings it holds, to read.
 */
export type BuildingClosureId = Id<'building_closure'>

export interface BuildingClosure extends Synced {
  readonly id: BuildingClosureId
  readonly buildingId: BuildingId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  /** The first day the building is closed. */
  readonly startsOn: IsoDate
  /** The last day it is closed. */
  readonly endsOn: IsoDate
  /** What it is closed for: "Weihnachtsferien". */
  readonly reason: string | null
}

/** The bounds of a closure, the same in the form, at the route and in the database. */
export const closureLimits = {
  reason: 80,
} as const

/** A day a closure has to name. Undefined is a field that was not given. */
function day(
  problems: Problems,
  closure: Readonly<Record<string, unknown>>,
  field: string,
  subject: string,
): void {
  const value = closure[field]

  if (value === undefined) {
    return
  }

  if (value === null || value === '') {
    problems[field] = `${subject} fehlt.`
  } else if (!calendarDay(value)) {
    problems[field] = `${subject} ist ein Tag, geschrieben 2026-10-03.`
  }
}

/**
 * What is wrong with a closure, one sentence per field, empty when nothing
 * is. The two days are compared as they are written: a day in ISO 8601 sorts
 * as the calendar does.
 */
export function closureProblems(closure: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  day(problems, closure, 'startsOn', 'Der erste Tag')
  day(problems, closure, 'endsOn', 'Der letzte Tag')
  optional(
    problems,
    closure,
    'reason',
    closureLimits.reason,
    `Der Anlass hat höchstens ${String(closureLimits.reason)} Zeichen.`,
  )

  const { startsOn, endsOn } = closure

  if (
    problems['startsOn'] === undefined &&
    problems['endsOn'] === undefined &&
    typeof startsOn === 'string' &&
    typeof endsOn === 'string' &&
    endsOn < startsOn
  ) {
    problems['endsOn'] = 'Der letzte Tag liegt vor dem ersten.'
  }

  return problems
}

/**
 * The closure a building is closed by on a day, or null when it is open. The
 * closures handed in are the ones that stand, those of one building; where
 * two of them cover the day, the one that began first answers, and among
 * those the one that ends last, so that the same day gets the same answer
 * whatever order the closures arrive in.
 *
 * The question the plan of a round asks before it makes one (4.5).
 */
export function closureOn<Closure extends Pick<BuildingClosure, 'startsOn' | 'endsOn'>>(
  closures: readonly Closure[],
  day: IsoDate,
): Closure | null {
  let found: Closure | null = null

  for (const closure of closures) {
    if (closure.startsOn > day || closure.endsOn < day) {
      continue
    }

    if (
      found === null ||
      closure.startsOn < found.startsOn ||
      (closure.startsOn === found.startsOn && closure.endsOn > found.endsOn)
    ) {
      found = closure
    }
  }

  return found
}
