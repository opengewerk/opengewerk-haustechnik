import {
  type FederalState,
  type IsoDate,
  nationwide,
  ruleDayIn,
  type RuleRecord,
  scopeOf,
} from '@opengewerk/platform-domain'

import type { Catalogue } from './catalogue.js'
import type { PlanClosure } from './round-plan.js'

/**
 * The statutory public holidays of a state (section 2.9 of the concept,
 * #200): "Gesetzliche Feiertage je Land sind Regeln wie alle anderen, mit
 * Fundstelle und Gültigkeit, damit der Plan eines Rundgangs sie auslassen
 * kann." A holiday is a rule in a unit of a day, the same day every year
 * (`month_day`) or a day counted from Easter Sunday (`days_from_easter`), and
 * the note of the rule is its name. Nothing here invents one: a state the
 * catalogue holds no holidays for has none, and a plan there is not offered
 * to leave them out.
 */
export interface Holiday {
  readonly day: IsoDate
  /** "Ostermontag", the note of its rule. */
  readonly name: string
  /** The source of its rule, "§ 1 FTG". */
  readonly source: string
}

/** The units a rule of a day is written in. */
const dayUnits: ReadonlySet<string> = new Set(['month_day', 'days_from_easter'])

type Rules = Pick<Catalogue, 'ruleSet'>

/** The rules of a day that answer for a state: its own and those of the whole country. */
function holidayRules(catalogue: Rules, state: FederalState): readonly RuleRecord[] {
  return catalogue.ruleSet
    .all()
    .filter(
      (record) =>
        dayUnits.has(record.unit) && (scopeOf(record) === state || scopeOf(record) === nationwide),
    )
}

/** Whether the catalogue holds the statutory public holidays of a state. */
export function hasHolidays(catalogue: Rules, state: FederalState): boolean {
  return holidayRules(catalogue, state).length > 0
}

/**
 * The statutory public holidays of a state from a day to a day, both of them
 * counted, in order of their days: each rule on its day of every year it is
 * in force on that day.
 */
export function holidaysBetween(
  catalogue: Rules,
  state: FederalState,
  from: IsoDate,
  until: IsoDate,
): readonly Holiday[] {
  const holidays: Holiday[] = []

  for (let year = Number(from.slice(0, 4)); year <= Number(until.slice(0, 4)); year += 1) {
    for (const rule of holidayRules(catalogue, state)) {
      const day = ruleDayIn(rule, year)

      if (
        day === null ||
        day < from ||
        day > until ||
        day < rule.validFrom ||
        (rule.validUntil !== null && day > rule.validUntil)
      ) {
        continue
      }

      holidays.push({ day, name: rule.note ?? rule.key, source: rule.source })
    }
  }

  return holidays.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name))
}

/**
 * The holidays as days a plan makes no round on (4.5): a pass on a holiday
 * is left out and not moved, as in a closure of its building, and the reason
 * says which holiday it is.
 */
export function holidayClosures(
  holidays: readonly Holiday[],
): readonly (PlanClosure & { readonly reason: string })[] {
  return holidays.map((holiday) => ({
    startsOn: holiday.day,
    endsOn: holiday.day,
    reason: `${holiday.name}, Feiertag`,
  }))
}
