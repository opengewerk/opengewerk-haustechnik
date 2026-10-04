import {
  type FederalState,
  type IsoDate,
  type RuleRecord,
  type RuleUnit,
  ruleSet,
} from '@opengewerk/platform-domain'

import type { FormDefinition } from './forms.js'
import type { BuildingKind } from './location.js'
import type { MeterKind } from './meter.js'

/**
 * The catalogue: what the packages under `pakete/` say, as the build of
 * @opengewerk/haustechnik-catalogue hands it on (ADR 0005). Duties are data,
 * no code and no free text (Leitentscheidung 3): which asset kinds there are,
 * which duty kinds apply to them, by which rule their interval runs, and who
 * has checked each entry against its source.
 *
 * Everything here reads a catalogue that has been checked when it was built.
 * The checks themselves, what a contribution without code can get wrong, are
 * in the loader; what is left for this module is the logic over the
 * catalogue, which server and device compute alike (ADR 0005, point 5).
 */

/** What a duty kind has somebody do (section 2.3 of the concept). */
export const dutyTasks = [
  'inspection',
  'maintenance',
  'condition_assessment',
  'function_check',
  'visual_check',
  'sampling',
] as const

export type DutyTask = (typeof dutyTasks)[number]

/**
 * The tasks in the words of the concept. An inspection in the sense of
 * DIN 31051 is not a test: a test is `inspection`, as ADR 0002 names it, and
 * the assessment of the condition gets a key of its own.
 */
export const dutyTaskLabel: Readonly<Record<DutyTask, string>> = {
  inspection: 'Prüfung',
  maintenance: 'Wartung',
  condition_assessment: 'Inspektion',
  function_check: 'Funktionskontrolle',
  visual_check: 'Sichtkontrolle',
  sampling: 'Probenahme',
}

/**
 * Where a duty or a limit comes from. It decides what a package may say about
 * it (section 5 of the concept): of state law the interval and the
 * qualification, of a private standard the reference and nothing it cannot
 * say in its own words.
 */
export const catalogueOrigins = [
  'state_law',
  'insurer_and_committee_rules',
  'private_standard',
] as const

export type CatalogueOrigin = (typeof catalogueOrigins)[number]

export const catalogueOriginLabel: Readonly<Record<CatalogueOrigin, string>> = {
  state_law: 'Staatliches Recht',
  insurer_and_committee_rules:
    'Regelwerk der Unfallversicherungsträger und der staatlichen Ausschüsse',
  private_standard: 'Private Norm oder Richtlinie',
}

/** How binding a duty kind is (section 2.3 of the concept). */
export const dutyBindingnesses = ['statute', 'technical_rule', 'manufacturer'] as const

export type DutyBindingness = (typeof dutyBindingnesses)[number]

export const dutyBindingnessLabel: Readonly<Record<DutyBindingness, string>> = {
  statute: 'Gesetz oder Verordnung',
  technical_rule: 'Technische Regel',
  manufacturer: 'Vorgabe des Herstellers',
}

/**
 * What the interval of a duty kind is: a maximum the operator may only
 * shorten, a guide the operator sets and justifies a departure from, or no
 * value at all, which the operator determines himself, in the risk assessment
 * for instance.
 */
export const intervalKinds = ['maximum', 'guide', 'none'] as const

export type IntervalKind = (typeof intervalKinds)[number]

export const intervalKindLabel: Readonly<Record<IntervalKind, string>> = {
  maximum: 'Höchstfrist',
  guide: 'Richtwert',
  none: 'Ohne Vorgabe',
}

/** The units the rule of an interval may be counted in. */
export const intervalUnits = ['days', 'months', 'years'] as const satisfies readonly RuleUnit[]

/**
 * How the next due day of a duty is counted from what was done (section 4.4
 * of the concept, #25): from the day it was done, from the day it was due, or
 * as § 14 Abs. 5 BetrSichV counts the inspections of the work equipment in
 * its annexes 2 and 3, the lifts among them, due in a month and on time until
 * two months after it. A field with fixed values and no expression in a
 * language of its own (ADR 0005, point 14); `nextAppointment` does the
 * counting.
 */
export const countings = ['from_performance', 'from_due', 'betrsichv'] as const

export type Counting = (typeof countings)[number]

export const countingLabel: Readonly<Record<Counting, string>> = {
  from_performance: 'Ab dem Tag der Durchführung',
  from_due: 'Ab dem fälligen Tag',
  betrsichv: 'Nach § 14 Abs. 5 BetrSichV',
}

/** The units a counting takes its interval in: § 14 Abs. 5 BetrSichV knows months and years only. */
export const countingUnits: Readonly<Record<Counting, readonly RuleUnit[]>> = {
  from_performance: intervalUnits,
  from_due: intervalUnits,
  betrsichv: ['months', 'years'],
}

/** Who may carry out the task, from the instructed employee to the accredited laboratory. */
export const qualificationLevels = [
  'instructed_person',
  'skilled_person',
  'competent_person',
  'approved_body',
  'certified_expert',
  'accredited_laboratory',
] as const

export type QualificationLevel = (typeof qualificationLevels)[number]

export const qualificationLevelLabel: Readonly<Record<QualificationLevel, string>> = {
  instructed_person: 'Unterwiesene Person',
  skilled_person: 'Fachkraft',
  competent_person: 'Zur Prüfung befähigte Person',
  approved_body: 'Zugelassene Überwachungsstelle',
  certified_expert: 'Prüfsachverständiger',
  accredited_laboratory: 'Akkreditiertes Labor',
}

/** What may be the evidence that a duty was met, the four ways of section 2.6 of the concept. */
export const evidenceKinds = ['protocol', 'report', 'round_point', 'work_order'] as const

export type EvidenceKind = (typeof evidenceKinds)[number]

export const evidenceKindLabel: Readonly<Record<EvidenceKind, string>> = {
  protocol: 'Unterschriebenes Protokoll',
  report: 'Bericht einer Fremdfirma oder Prüforganisation',
  round_point: 'Punkt eines Rundgangs',
  work_order: 'Abgenommener Arbeitsauftrag',
}

/** How long the evidence of a duty is kept, the three forms of section 2.6 of the concept. */
export const retentionKinds = ['years', 'until_next_inspection', 'while_in_use'] as const

export type RetentionKind = (typeof retentionKinds)[number]

export const retentionKindLabel: Readonly<Record<RetentionKind, string>> = {
  years: 'Eine Zahl von Jahren',
  until_next_inspection: 'Mindestens bis zur nächsten Prüfung',
  while_in_use: 'Solange die Anlage verwendet wird',
}

export interface ChoiceOption {
  readonly value: string
  readonly label: string
}

/**
 * A characteristic of an asset, which the scope of a duty kind may ask about:
 * a charge, an output, a volume, whether there is a leak detection system. A
 * number is a whole number in a unit of the rule engine, like the value of a
 * rule, so that it compares exactly with the threshold it is held against.
 */
export type Characteristic =
  | {
      readonly key: string
      readonly label: string
      readonly kind: 'number'
      readonly unit: RuleUnit
    }
  | { readonly key: string; readonly label: string; readonly kind: 'flag' }
  | {
      readonly key: string
      readonly label: string
      readonly kind: 'choice'
      readonly options: readonly ChoiceOption[]
    }

/** A field an asset of the kind carries beyond those every asset has. No duty asks about it. */
export type AssetField =
  | { readonly key: string; readonly label: string; readonly kind: 'text' }
  | {
      readonly key: string
      readonly label: string
      readonly kind: 'number'
      /** As it is shown, "kg" or "l"; a field is compared with nothing. */
      readonly unit?: string
    }
  | { readonly key: string; readonly label: string; readonly kind: 'date' }
  | { readonly key: string; readonly label: string; readonly kind: 'flag' }
  | {
      readonly key: string
      readonly label: string
      readonly kind: 'choice'
      readonly options: readonly ChoiceOption[]
    }

/** A document an asset of the kind is expected to have (section 4.10 of the concept). */
export interface ExpectedDocument {
  readonly key: string
  readonly label: string
}

/**
 * An asset kind: its cost group after DIN 276, its characteristics, fields
 * and expected documents, and for a measuring point its medium and the units
 * a meter of the kind counts in (ADR 0002, point 9).
 */
export interface AssetKind {
  readonly label: string
  readonly costGroup: string
  readonly characteristics: readonly Characteristic[]
  readonly fields: readonly AssetField[]
  readonly expectedDocuments: readonly ExpectedDocument[]
  readonly meter: MeterKind | null
}

/**
 * The interval of a duty kind, as the key of a rule and never as a number:
 * for a test of 2027 the interval of 2027 still applies in 2030. A private
 * standard names one only with the note that the legal review bears it.
 */
export type DutyInterval =
  | {
      readonly kind: 'maximum' | 'guide'
      readonly rule: string
      readonly legalClearance?: string
    }
  | { readonly kind: 'none' }

/**
 * One condition of a scope, on a characteristic of the asset. A threshold is
 * a rule, because a threshold changes with the law like an interval does.
 */
export type ScopeCondition =
  | { readonly characteristic: string; readonly atLeast: string }
  | { readonly characteristic: string; readonly below: string }
  | { readonly characteristic: string; readonly is: boolean }
  | { readonly characteristic: string; readonly oneOf: readonly string[] }

/**
 * For which assets a duty kind comes into question: a list of conditions, not
 * an expression in a language of its own (ADR 0005, point 14). An empty list
 * of building kinds or states means every one.
 */
export interface DutyScope {
  readonly assetKinds: readonly string[]
  readonly conditions: readonly ScopeCondition[]
  readonly buildingKinds: readonly BuildingKind[]
  readonly states: readonly FederalState[]
}

export type Retention =
  | { readonly kind: 'years'; readonly rule: string }
  | { readonly kind: 'until_next_inspection' }
  | { readonly kind: 'while_in_use' }

/** A duty kind, the same for every operator (section 2.3 of the concept). */
export interface DutyKind {
  readonly label: string
  /** The duty in the words of the package, never in those of its source. */
  readonly description: string
  readonly task: DutyTask
  readonly origin: CatalogueOrigin
  readonly bindingness: DutyBindingness
  readonly source: string
  readonly interval: DutyInterval
  /** How the next due day is counted from what was done. */
  readonly counting: Counting
  readonly qualification: { readonly level: QualificationLevel; readonly note?: string }
  readonly evidence: { readonly kinds: readonly EvidenceKind[]; readonly form?: string }
  readonly retention: Retention
  readonly scope: DutyScope
}

/**
 * A form or a round template of a package: its title and its sections, read
 * whole and checked by the form engine (opengewerk-haustechnik#28). Key and
 * version are those of its entry.
 */
export type PackagedForm = Pick<FormDefinition, 'title' | 'sections'>

/** A rule of a package: a record of the rule engine with where it comes from. */
export interface CatalogueRuleRecord extends RuleRecord {
  readonly origin: CatalogueOrigin
}

export interface CatalogueAcceptance {
  readonly by: string
  readonly on: IsoDate
}

/**
 * Whether somebody may rely on an entry: the day it was last checked against
 * its source, and who accepted it with expertise and when. It stands beside
 * the entry and not in it, so that it changes without the entry changing
 * (ADR 0005, point 9). Every entry the catalogue hands out comes with it.
 */
export interface CatalogueReview {
  readonly checkedOn: IsoDate
  readonly accepted: CatalogueAcceptance | null
}

/**
 * One version of an entry. The key is the one by which everything outside
 * its package names it, `<package>.<key>`, and so are the references in its
 * definition.
 */
export interface CatalogueEntry<Definition> {
  readonly key: string
  readonly version: number
  readonly validFrom: IsoDate
  readonly definition: Definition
  readonly review: CatalogueReview
}

export interface CatalogueRule {
  readonly record: CatalogueRuleRecord
  readonly review: CatalogueReview
}

export interface CataloguePackage {
  readonly name: string
  readonly title: string
  readonly version: string
  readonly minimumCore: string
  readonly assetKinds: readonly CatalogueEntry<AssetKind>[]
  readonly dutyKinds: readonly CatalogueEntry<DutyKind>[]
  readonly forms: readonly CatalogueEntry<PackagedForm>[]
  readonly roundTemplates: readonly CatalogueEntry<PackagedForm>[]
  readonly rules: readonly CatalogueRule[]
}

/** The shape of the bundle, counted up when it changes so that an old bundle is not misread. */
export const catalogueFormat = 2

/**
 * What the build writes and server and interface load. The checksum is taken
 * over everything else in it, so that two places can tell whether they hold
 * the same catalogue.
 */
export interface CatalogueBundle {
  readonly format: typeof catalogueFormat
  readonly sha256: string
  readonly packages: readonly CataloguePackage[]
}

/**
 * The questions the catalogue answers. Every one that depends on time names a
 * day, and a day before an entry or a rule begins has no answer.
 */
export interface Catalogue {
  readonly sha256: string
  readonly packages: readonly Pick<CataloguePackage, 'name' | 'title' | 'version'>[]
  /** The version of an asset kind in force on a day. */
  readonly assetKind: (key: string, on: IsoDate) => CatalogueEntry<AssetKind> | null
  readonly assetKinds: (on: IsoDate) => readonly CatalogueEntry<AssetKind>[]
  /** The version of a duty kind in force on a day. */
  readonly dutyKind: (key: string, on: IsoDate) => CatalogueEntry<DutyKind> | null
  /** One version of a duty kind, the one a confirmed duty names (ADR 0005, point 10). */
  readonly dutyKindVersion: (key: string, version: number) => CatalogueEntry<DutyKind> | null
  readonly dutyKinds: (on: IsoDate) => readonly CatalogueEntry<DutyKind>[]
  /** The rule in force on a day, for a federal state or, without one, for the whole country. */
  readonly rule: (key: string, on: IsoDate, state?: FederalState) => CatalogueRule | null
  /** The rule of the interval of a duty kind on a day, or nothing for one without a value. */
  readonly interval: (dutyKind: DutyKind, on: IsoDate, state?: FederalState) => CatalogueRule | null
  /** How long the evidence is kept, with the rule of the years where it has one. */
  readonly retention: (
    dutyKind: DutyKind,
    on: IsoDate,
    state?: FederalState,
  ) =>
    | { readonly kind: 'years'; readonly rule: CatalogueRule }
    | { readonly kind: 'until_next_inspection' }
    | { readonly kind: 'while_in_use' }
    | null
}

/** The versions of each key, ordered by version. */
function versionsByKey<Definition>(
  entries: readonly CatalogueEntry<Definition>[],
): ReadonlyMap<string, readonly CatalogueEntry<Definition>[]> {
  const grouped = new Map<string, CatalogueEntry<Definition>[]>()

  for (const entry of entries) {
    grouped.set(entry.key, [...(grouped.get(entry.key) ?? []), entry])
  }

  for (const versions of grouped.values()) {
    versions.sort((left, right) => left.version - right.version)
  }

  return grouped
}

/**
 * The highest version whose first day has come. The loader makes sure that a
 * later version never begins before an earlier one, so the first from the
 * top that has begun is the one.
 */
function inForce<Definition>(
  versions: readonly CatalogueEntry<Definition>[] | undefined,
  on: IsoDate,
): CatalogueEntry<Definition> | null {
  // ISO dates sort the same way as the days they name.
  return [...(versions ?? [])].reverse().find((entry) => entry.validFrom <= on) ?? null
}

/**
 * The catalogue to ask, from a bundle the build wrote. It refuses a bundle in
 * another format, and the rules the way the rule engine does: two records of
 * one key on the same day are no catalogue anybody can answer from.
 */
export function catalogueOf(bundle: CatalogueBundle): Catalogue {
  if (bundle.format !== catalogueFormat) {
    throw new Error(
      `Der Katalog hat das Format ${String(bundle.format)}, gelesen wird ${String(catalogueFormat)}.`,
    )
  }

  const assetKinds = versionsByKey(bundle.packages.flatMap((entry) => entry.assetKinds))
  const dutyKinds = versionsByKey(bundle.packages.flatMap((entry) => entry.dutyKinds))
  const rules = bundle.packages.flatMap((entry) => entry.rules)
  const reviews = new Map<RuleRecord, CatalogueReview>(
    rules.map((rule) => [rule.record, rule.review]),
  )
  const records = ruleSet(rules.map((rule) => rule.record))

  const rule = (key: string, on: IsoDate, state?: FederalState): CatalogueRule | null => {
    const record = records.at(key, on, state)
    const review = record ? reviews.get(record) : undefined

    // The rule set hands back the very records it was built from, so every
    // record it finds has its review.
    return record && review ? { record: record as CatalogueRuleRecord, review } : null
  }

  const everyKey = <Definition>(
    grouped: ReadonlyMap<string, readonly CatalogueEntry<Definition>[]>,
    on: IsoDate,
  ): CatalogueEntry<Definition>[] =>
    [...grouped.values()]
      .map((versions) => inForce(versions, on))
      .filter((entry): entry is CatalogueEntry<Definition> => entry !== null)

  return {
    sha256: bundle.sha256,
    packages: bundle.packages.map(({ name, title, version }) => ({ name, title, version })),
    assetKind: (key, on) => inForce(assetKinds.get(key), on),
    assetKinds: (on) => everyKey(assetKinds, on),
    dutyKind: (key, on) => inForce(dutyKinds.get(key), on),
    dutyKindVersion: (key, version) =>
      dutyKinds.get(key)?.find((entry) => entry.version === version) ?? null,
    dutyKinds: (on) => everyKey(dutyKinds, on),
    rule,
    interval: (dutyKind, on, state) =>
      dutyKind.interval.kind === 'none' ? null : rule(dutyKind.interval.rule, on, state),
    retention: (dutyKind, on, state) => {
      if (dutyKind.retention.kind !== 'years') {
        return { kind: dutyKind.retention.kind }
      }

      const years = rule(dutyKind.retention.rule, on, state)

      return years ? { kind: 'years', rule: years } : null
    },
  }
}

/** The same day one year earlier; the twenty ninth of February becomes the twenty eighth. */
function yearBefore(on: IsoDate): IsoDate {
  const [year, month, day] = on.split('-').map(Number) as [number, number, number]
  const sameDay = new Date(Date.UTC(year - 1, month - 1, day))
  const shifted = sameDay.getUTCMonth() !== month - 1
  const result = shifted ? new Date(Date.UTC(year - 1, month - 1, day - 1)) : sameDay

  return result.toISOString().slice(0, 10)
}

/** What a reader has to be told about an entry. */
export interface ReviewMarks {
  /** Nobody with expertise has accepted it yet, and nobody should rely on it unseen. */
  readonly unaccepted: boolean
  /** Its last check against the source lies more than a year back (ADR 0005, point 13). */
  readonly checkedLongAgo: boolean
}

export function reviewMarks(review: CatalogueReview, today: IsoDate): ReviewMarks {
  return {
    unaccepted: review.accepted === null,
    checkedLongAgo: review.checkedOn < yearBefore(today),
  }
}
