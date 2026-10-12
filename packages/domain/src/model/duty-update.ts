import type { DeadlineInterval, FederalState, IsoDate } from '@opengewerk/platform-domain'

import {
  type Catalogue,
  type CatalogueEntry,
  countingLabel,
  type DutyKind,
  intervalKindLabel,
  qualificationLevelLabel,
} from './catalogue.js'
import { sameInterval, withinCeiling } from './duty.js'
import { type ProposalSubject, scopeApplies } from './duty-proposal.js'
import {
  type Duty,
  type DutyId,
  dutyInterval,
  dutyIntervalProblem,
  dutyLimits,
  dutyMaximum,
  intervalNeedsReason,
  intervalOfRule,
  intervalWords,
} from './duty-record.js'
import type { DutyAsset } from './duty-register.js'
import { type Problems, required } from './fields.js'
import type { PropertyId } from './location.js'
import { dayInWords } from './office-table.js'

/**
 * What a new version of a package means for a duty that is confirmed
 * (section 2.3 of the concept, ADR 0005, point 10, #139). A confirmed duty
 * carries what it was confirmed with: the version of its kind, its counting
 * and the value the rule of its interval had. Where the catalogue says
 * something else now, or will from a day it names already, the duty does not
 * change quietly: it is reported, and the operator takes the new version over
 * or leaves the duty as it is, with a reason.
 *
 * One thing applies without anybody deciding (Moritz, 11.10.2026): a maximum
 * a regulation shortens counts from its day, because the operator overrides
 * no regulation. That is the ceiling of `nextAppointment`; the duty itself
 * stays as it was confirmed and says that it is cut short.
 *
 * Nothing here is stored: an update is worked out each time it is read, from
 * the duty and the catalogue of the server.
 */

/**
 * The maximum the catalogue sets for the interval of a duty kind on a day, in
 * a federal state: that of the version in force on the day, whichever the
 * duty names. Nothing for a duty of the operator's own, for a kind with a
 * guide or without a value, and for a day its rule does not answer.
 */
export function ceilingOf(
  catalogue: Pick<Catalogue, 'dutyKind' | 'interval'>,
  kind: string | null,
  state: FederalState,
): (day: IsoDate) => DeadlineInterval | null {
  return (day) => {
    const entry = kind === null ? null : catalogue.dutyKind(kind, day)

    if (entry === null || entry.definition.interval.kind !== 'maximum') {
      return null
    }

    const rule = catalogue.interval(entry.definition, day, state)

    return rule === null ? null : intervalOfRule(rule.record)
  }
}

/**
 * The interval a duty counts with on a day where a regulation cuts it short,
 * or nothing where its own interval is within the maximum of the day.
 */
export function cutShortTo(
  duty: Pick<Duty, 'intervalDays' | 'intervalMonths'>,
  ceiling: DeadlineInterval | null,
): DeadlineInterval | null {
  const own = dutyInterval(duty)
  const inForce = withinCeiling(own, ceiling)

  return sameInterval(own, inForce) ? null : inForce
}

/** What an update is worked out from: what the duty carries of the catalogue, and what was decided about it. */
export type UpdatedDuty = Pick<
  Duty,
  | 'kind'
  | 'kindVersion'
  | 'counting'
  | 'intervalDays'
  | 'intervalMonths'
  | 'intervalReason'
  | 'maximumDays'
  | 'maximumMonths'
  | 'guideDays'
  | 'guideMonths'
  | 'keptVersion'
  | 'keptDays'
  | 'keptMonths'
  | 'confirmedAt'
>

/** What reads differently in the newest version, in the order a person asks. */
export const dutyUpdateFields = [
  'label',
  'interval',
  'intervalKind',
  'counting',
  'qualification',
  'source',
] as const

export type DutyUpdateField = (typeof dutyUpdateFields)[number]

export const dutyUpdateFieldLabel: Readonly<Record<DutyUpdateField, string>> = {
  label: 'Bezeichnung',
  source: 'Fundstelle',
  intervalKind: 'Art der Frist',
  interval: 'Frist der Vorschrift',
  counting: 'Zählweise',
  qualification: 'Qualifikation',
}

/** One thing that changes, in words: what the duty carries, and what the catalogue says. */
export interface DutyUpdateChange {
  readonly field: DutyUpdateField
  readonly held: string
  readonly newest: string
}

/**
 * Why a duty kind no longer comes into question for a duty: the catalogue of
 * this server does not know the kind or the version the duty names, or the
 * newest version no longer takes the asset in. Either is reported, and
 * nothing is removed; ending a duty stays a decision of the operator.
 */
export const dutyLapses = ['gone', 'out_of_scope'] as const

export type DutyLapse = (typeof dutyLapses)[number]

export const dutyLapseWords: Readonly<Record<DutyLapse, string>> = {
  gone: 'Der Katalog kennt diese Pflichtart nicht mehr.',
  out_of_scope: 'Nach der neuen Fassung gilt die Pflichtart für diese Anlage nicht mehr.',
}

/** What the catalogue says differently about a confirmed duty. */
export interface DutyUpdate {
  /** The version the duty names, and the newest of its kind, or nothing where the catalogue lost the kind. */
  readonly held: number
  readonly newest: number | null
  /** The day the newest version applies from, where it is another than the one the duty names. */
  readonly from: IsoDate | null
  readonly changes: readonly DutyUpdateChange[]
  /**
   * The maximum of the catalogue where it is shorter than the one the duty
   * carries, and the day it applies from: from that day it holds for the
   * duty, taken over or not.
   */
  readonly maximum: { readonly interval: DeadlineInterval; readonly from: IsoDate } | null
  /**
   * That maximum where it is shorter than the interval of the duty as well:
   * from its day the duty counts with it, and cannot be left as it is.
   */
  readonly shorter: { readonly interval: DeadlineInterval; readonly from: IsoDate } | null
  readonly lapse: DutyLapse | null
  /**
   * Whether the newest version can be taken over, and the interval the duty
   * has afterwards: its own, the new maximum where it lay beyond, or the new
   * guide where it followed the old one.
   */
  readonly adoptable: boolean
  readonly becomes: DeadlineInterval | null
  /** Why it cannot be taken over, in a sentence, or null. */
  readonly obstacle: string | null
  /** Leaving it as it is needs an interval within the new maximum. */
  readonly keepable: boolean
}

/** What a duty is held against: a version of its kind and the value of the rule of its interval. */
interface Stand {
  readonly version: number
  readonly rule: DeadlineInterval | null
}

function sameRule(left: DeadlineInterval | null, right: DeadlineInterval | null): boolean {
  return left === null || right === null ? left === right : sameInterval(left, right)
}

function sameStand(left: Stand, right: Stand): boolean {
  return left.version === right.version && sameRule(left.rule, right.rule)
}

function later(left: IsoDate, right: IsoDate): IsoDate {
  return left > right ? left : right
}

function inOneUnit(left: DeadlineInterval, right: DeadlineInterval): boolean {
  return 'days' in left === 'days' in right
}

function intervalOf(days: number | null, months: number | null): DeadlineInterval | null {
  if (months !== null) {
    return { months }
  }

  return days === null ? null : { days }
}

/**
 * The value of the rule a duty carries: the maximum kept beside it, or its
 * guide. A duty with a guide from before it carried one is held against the
 * guide of the day it was confirmed.
 */
function carriedRule(
  catalogue: Pick<Catalogue, 'interval'>,
  duty: UpdatedDuty,
  held: CatalogueEntry<DutyKind>,
  state: FederalState,
): DeadlineInterval | null {
  switch (held.definition.interval.kind) {
    case 'maximum':
      return dutyMaximum(duty)
    case 'guide': {
      const own = intervalOf(duty.guideDays, duty.guideMonths)

      if (own !== null) {
        return own
      }

      const confirmedOn = duty.confirmedAt.toISOString().slice(0, 10)
      const rule = catalogue.interval(held.definition, confirmedOn, state)

      return rule === null ? null : intervalOfRule(rule.record)
    }
    case 'none':
      return null
  }
}

/**
 * The last word of the catalogue on the interval of a duty kind in a state:
 * the value of its rule on the latest day the catalogue names, a version or a
 * record to come included, and the day that value applies from.
 */
function lastWord(
  catalogue: Pick<Catalogue, 'interval' | 'ruleRecords'>,
  held: CatalogueEntry<DutyKind>,
  newest: CatalogueEntry<DutyKind>,
  state: FederalState,
  today: IsoDate,
): { readonly rule: DeadlineInterval | null; readonly from: IsoDate | null } {
  const interval = newest.definition.interval

  if (interval.kind === 'none') {
    return { rule: null, from: null }
  }

  const horizon = catalogue
    .ruleRecords(interval.rule)
    .map((entry) => entry.record.validFrom)
    .reduce(later, later(today, newest.validFrom))
  const found = catalogue.interval(newest.definition, horizon, state)

  if (found === null) {
    return { rule: null, from: null }
  }

  // Under the version the duty names the same rule applied already; under
  // another, the value counts from the day the newest version begins.
  const before = held.definition.interval
  const sameRuleAsHeld =
    before.kind !== 'none' && before.kind === interval.kind && before.rule === interval.rule

  return {
    rule: intervalOfRule(found.record),
    from: sameRuleAsHeld ? found.record.validFrom : later(found.record.validFrom, newest.validFrom),
  }
}

function ruleWords(rule: DeadlineInterval | null, kind: DutyKind['interval']['kind']): string {
  if (kind === 'none') {
    return 'legt der Betreiber fest'
  }

  return rule === null ? 'ohne Wert' : intervalWords(rule)
}

function qualificationWords(kind: DutyKind): string {
  const level = qualificationLevelLabel[kind.qualification.level]

  return kind.qualification.note === undefined ? level : `${level}, ${kind.qualification.note}`
}

/** Where a duty stands: the state its rules are read in, and its asset as the scope of a kind asks about it. */
export interface UpdatePlace {
  readonly state: FederalState
  /** Nothing where nobody asks whether the kind still takes the asset in. */
  readonly subject: ProposalSubject | null
}

/** What both the update and taking it over read from the catalogue. */
interface Reading {
  readonly held: CatalogueEntry<DutyKind>
  readonly newest: CatalogueEntry<DutyKind>
  readonly carried: Stand
  readonly target: Stand
  readonly ruleFrom: IsoDate | null
}

type UpdateCatalogue = Pick<
  Catalogue,
  'dutyKindVersion' | 'newestDutyKind' | 'interval' | 'ruleRecords' | 'rule'
>

function readingOf(
  catalogue: UpdateCatalogue,
  duty: UpdatedDuty,
  state: FederalState,
  today: IsoDate,
): Reading | null {
  if (duty.kind === null || duty.kindVersion === null) {
    return null
  }

  const held = catalogue.dutyKindVersion(duty.kind, duty.kindVersion)
  const newest = catalogue.newestDutyKind(duty.kind)

  if (held === null || newest === null) {
    return null
  }

  const last = lastWord(catalogue, held, newest, state, today)

  return {
    held,
    newest,
    carried: { version: held.version, rule: carriedRule(catalogue, duty, held, state) },
    target: { version: newest.version, rule: last.rule },
    ruleFrom: last.from,
  }
}

/**
 * What the catalogue says differently about a confirmed duty, or nothing: for
 * a duty of the operator's own, for one that carries what the catalogue says,
 * and for one the operator left as it is against exactly this.
 */
export function dutyUpdate(
  catalogue: UpdateCatalogue,
  duty: UpdatedDuty,
  place: UpdatePlace,
  today: IsoDate,
): DutyUpdate | null {
  if (duty.kind === null || duty.kindVersion === null) {
    return null
  }

  const reading = readingOf(catalogue, duty, place.state, today)

  if (reading === null) {
    return {
      held: duty.kindVersion,
      newest: null,
      from: null,
      changes: [],
      maximum: null,
      shorter: null,
      lapse: 'gone',
      adoptable: false,
      becomes: null,
      obstacle: dutyLapseWords.gone,
      keepable: false,
    }
  }

  const { held, newest, carried, target, ruleFrom } = reading
  const kept =
    duty.keptVersion === null
      ? null
      : { version: duty.keptVersion, rule: intervalOf(duty.keptDays, duty.keptMonths) }

  if (sameStand(carried, target) || (kept !== null && sameStand(kept, target))) {
    return null
  }

  const before = held.definition
  const after = newest.definition
  const changes: DutyUpdateChange[] = []
  const say = (field: DutyUpdateField, was: string, is: string) => {
    if (was !== is) {
      changes.push({ field, held: was, newest: is })
    }
  }

  say('label', before.label, after.label)
  say(
    'interval',
    ruleWords(carried.rule, before.interval.kind),
    ruleWords(target.rule, after.interval.kind),
  )
  say(
    'intervalKind',
    intervalKindLabel[before.interval.kind],
    intervalKindLabel[after.interval.kind],
  )
  say('counting', countingLabel[duty.counting], countingLabel[after.counting])
  say('qualification', qualificationWords(before), qualificationWords(after))
  say('source', before.source, after.source)

  const another = newest.version !== held.version
  const tighter =
    before.interval.kind === 'maximum' &&
    after.interval.kind === 'maximum' &&
    carried.rule !== null &&
    target.rule !== null &&
    ruleFrom !== null &&
    !sameInterval(withinCeiling(carried.rule, target.rule), carried.rule)
      ? { interval: target.rule, from: ruleFrom }
      : null
  const cut =
    after.interval.kind === 'maximum' && ruleFrom !== null ? cutShortTo(duty, target.rule) : null
  const outOfScope =
    another &&
    place.subject !== null &&
    !scopeApplies(catalogue, after.scope, place.subject, later(today, newest.validFrom))

  const taken = outOfScope ? null : adoption(catalogue, duty, place.state, today)
  const becomes =
    taken !== null && 'values' in taken
      ? intervalOf(taken.values.intervalDays, taken.values.intervalMonths)
      : null

  return {
    held: held.version,
    newest: newest.version,
    from: another ? newest.validFrom : null,
    changes,
    maximum: tighter,
    shorter: cut === null || ruleFrom === null ? null : { interval: cut, from: ruleFrom },
    lapse: outOfScope ? 'out_of_scope' : null,
    adoptable: becomes !== null,
    becomes,
    obstacle: outOfScope
      ? dutyLapseWords.out_of_scope
      : taken !== null && 'problem' in taken
        ? taken.problem
        : null,
    keepable: cut === null,
  }
}

/** What taking the newest version over writes to a duty. */
export interface AdoptedValues {
  readonly kindVersion: number
  readonly counting: Duty['counting']
  readonly intervalDays: number | null
  readonly intervalMonths: number | null
  readonly maximumDays: number | null
  readonly maximumMonths: number | null
  readonly guideDays: number | null
  readonly guideMonths: number | null
  readonly keptVersion: null
  readonly keptDays: null
  readonly keptMonths: null
  readonly keptReason: null
}

function inColumns(interval: DeadlineInterval | null): {
  readonly days: number | null
  readonly months: number | null
} {
  return {
    days: interval !== null && 'days' in interval ? interval.days : null,
    months: interval !== null && 'months' in interval ? interval.months : null,
  }
}

/**
 * Taking the newest version over: the duty names it, counts as it says and
 * carries the value of its rule. The interval stays where it may: within a
 * new maximum it is left alone, beyond it it becomes the maximum, and a duty
 * that followed its guide follows the new one. What the newest version will
 * not take, an interval in the wrong unit or one that now needs its reason,
 * is said in a sentence instead, and nothing is written.
 */
export function adoption(
  catalogue: UpdateCatalogue,
  duty: UpdatedDuty,
  state: FederalState,
  today: IsoDate,
): { readonly values: AdoptedValues } | { readonly problem: string } {
  const reading = readingOf(catalogue, duty, state, today)

  if (reading === null) {
    return { problem: dutyLapseWords.gone }
  }

  const { held, newest, carried, target } = reading
  const kind = newest.definition.interval.kind
  const own = dutyInterval(duty)
  let interval = own

  if (kind === 'maximum' && target.rule !== null) {
    interval = inOneUnit(own, target.rule) ? withinCeiling(own, target.rule) : target.rule
  }

  if (kind === 'guide' && target.rule !== null) {
    const followed =
      held.definition.interval.kind === 'guide' &&
      carried.rule !== null &&
      sameInterval(own, carried.rule)

    interval = followed ? target.rule : own
  }

  const maximum = kind === 'maximum' ? target.rule : null
  const guide = kind === 'guide' ? target.rule : null
  const columns = inColumns(interval)
  const problem = dutyIntervalProblem(
    { intervalDays: columns.days, intervalMonths: columns.months },
    newest.definition.counting,
    maximum,
  )

  if (problem !== null) {
    return { problem }
  }

  if (intervalNeedsReason(kind, interval, guide) && duty.intervalReason === null) {
    return {
      problem:
        'Die neue Fassung verlangt eine Begründung der Frist. Tragen Sie sie an der Pflicht unter „Frist festlegen“ ein und übernehmen Sie danach.',
    }
  }

  return {
    values: {
      kindVersion: newest.version,
      counting: newest.definition.counting,
      intervalDays: columns.days,
      intervalMonths: columns.months,
      maximumDays: inColumns(maximum).days,
      maximumMonths: inColumns(maximum).months,
      guideDays: inColumns(guide).days,
      guideMonths: inColumns(guide).months,
      keptVersion: null,
      keptDays: null,
      keptMonths: null,
      keptReason: null,
    },
  }
}

/** What leaving a duty as it is writes to it: what the catalogue said, and why the duty stays. */
export interface KeptValues {
  readonly keptVersion: number
  readonly keptDays: number | null
  readonly keptMonths: number | null
  readonly keptReason: string
}

/**
 * Leaving a duty as it is, with the reason: what is kept is what the
 * catalogue said on that day, so that the duty is reported again when it says
 * something else. Refused where a new maximum is shorter than the interval of
 * the duty: the operator overrides no regulation, such a duty is taken over.
 */
export function keeping(
  catalogue: UpdateCatalogue,
  duty: UpdatedDuty,
  place: UpdatePlace,
  reason: string,
  today: IsoDate,
): { readonly values: KeptValues } | { readonly problem: string } {
  const update = dutyUpdate(catalogue, duty, place, today)
  const reading = readingOf(catalogue, duty, place.state, today)

  if (update === null) {
    return {
      problem: 'Für diese Pflicht sagt der Katalog nichts Neues; es gibt nichts zu entscheiden.',
    }
  }

  if (reading === null) {
    return { problem: dutyLapseWords.gone }
  }

  if (!update.keepable) {
    return {
      problem:
        'Die neue Höchstfrist ist kürzer als die Frist dieser Pflicht. Sie lässt sich nicht so lassen, sondern wird übernommen; eine Höchstfrist lässt sich nur verkürzen.',
    }
  }

  const columns = inColumns(reading.target.rule)

  return {
    values: {
      keptVersion: reading.target.version,
      keptDays: columns.days,
      keptMonths: columns.months,
      keptReason: reason,
    },
  }
}

/** What is wrong with the reason for leaving duties as they are: it is there, and not too long. */
export function keepingProblems(values: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(
    problems,
    { reason: values['reason'] ?? null },
    'reason',
    dutyLimits.keptReason,
    'Die Begründung',
  )

  return problems
}

/** A duty the catalogue says something new about, as the office lists it. */
export interface DutyUpdateEntry {
  readonly id: DutyId
  readonly kind: string
  /** The duty by the title of its kind in the version it names. */
  readonly title: string
  readonly propertyId: PropertyId
  readonly asset: DutyAsset | null
  readonly intervalDays: number | null
  readonly intervalMonths: number | null
  readonly update: DutyUpdate
}

/** The duties in the areas of the person asking that the catalogue says something new about. */
export interface DutyUpdates {
  readonly entries: readonly DutyUpdateEntry[]
}

/** Many duties decided at once, like a batch of proposals: all of them or none. */
export const updateBatch = { most: 500 } as const

/** What is wrong with the duties of a batch, or null: a list of distinct ids, at least one and not too many. */
export function batchDutiesProblem(dutyIds: unknown): string | null {
  if (!Array.isArray(dutyIds) || dutyIds.length === 0) {
    return 'Ein Stapel nennt mindestens eine Pflicht.'
  }

  if (dutyIds.length > updateBatch.most) {
    return `Ein Stapel nennt höchstens ${String(updateBatch.most)} Pflichten.`
  }

  if (!dutyIds.every((id) => typeof id === 'string' && id !== '')) {
    return 'Eine Pflicht im Stapel ist nicht genannt.'
  }

  return new Set(dutyIds).size === dutyIds.length ? null : 'Eine Pflicht steht zweimal im Stapel.'
}

function dutiesWords(count: number): string {
  return count === 1 ? '1 Pflicht' : `${count.toLocaleString('de-DE')} Pflichten`
}

/**
 * The sentence that announces what a package changes, in the words of the
 * board: "Für 3 Pflichten gilt ab dem 01.01.2027 eine kürzere Höchstfrist"
 * where that is what the catalogue says of every one of them from one day,
 * and that something changes otherwise. A day that has come reads "seit dem".
 * A shorter maximum holds from its day whoever decides what, and the sentence
 * says so.
 */
export function updatesSentence(
  packageTitle: string,
  updates: readonly DutyUpdate[],
  today: IsoDate,
): string {
  const days = new Set(updates.map((update) => update.maximum?.from ?? null))
  const [day] = [...days]
  const lead = `Neue Fassung des Pakets ${packageTitle}: Für ${dutiesWords(updates.length)}`

  if (days.size !== 1 || day === undefined || day === null) {
    return `${lead} ändert sich etwas.`
  }

  return day <= today
    ? `${lead} gilt seit dem ${dayInWords(day)} eine kürzere Höchstfrist, auch ohne Übernahme.`
    : `${lead} gilt ab dem ${dayInWords(day)} eine kürzere Höchstfrist, von diesem Tag an auch ohne Übernahme.`
}
