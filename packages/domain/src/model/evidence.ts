import type { Id, IsoDate, TenantOwned } from '@opengewerk/platform-domain'

import type { ActivityId, ActivityKind } from './activity.js'
import type { AreaId } from './area.js'
import { type Counting, evidenceKindLabel, evidenceKinds } from './catalogue.js'
import type { DutyId } from './duty-record.js'
import { calendarDay, oneOf, optional, type Problems } from './fields.js'
import type { PropertyId } from './location.js'
import type { SignatureRole } from './signature.js'

/**
 * The result of a performance, in the words of section 4.4 of the concept:
 * without defects, with defects, failed, or not performed, the last always
 * with its reason.
 */
export const evidenceResults = [
  'without_defects',
  'with_defects',
  'failed',
  'not_performed',
] as const

export type EvidenceResult = (typeof evidenceResults)[number]

export const evidenceResultLabel: Readonly<Record<EvidenceResult, string>> = {
  without_defects: 'Ohne Mangel',
  with_defects: 'Mit Mängeln',
  failed: 'Nicht bestanden',
  not_performed: 'Nicht durchgeführt',
}

/**
 * Whether a duty counts as met by a performance with this result, so that its
 * next due day is counted from it: the work was done, with or without
 * defects. A failed test leaves the duty open until one is passed, and one
 * that was not performed changes nothing; the next due day moves on with the
 * evidence and never with the activity (section 4.4 of the concept).
 */
export function meetsTheDuty(result: EvidenceResult): boolean {
  return result === 'without_defects' || result === 'with_defects'
}

export type EvidenceId = Id<'evidence'>

/**
 * What an evidence came from (ADR 0004, point 2): the four ways a duty kind
 * may name, and the holdings of a predecessor application, marked as such so
 * that they claim no signature they cannot show (section 11 of the concept).
 */
export const evidenceOrigins = [...evidenceKinds, 'legacy'] as const

export type EvidenceOrigin = (typeof evidenceOrigins)[number]

export const evidenceOriginLabel: Readonly<Record<EvidenceOrigin, string>> = {
  ...evidenceKindLabel,
  legacy: 'Altbestand aus einer Vorgängeranwendung',
}

/** The origins that come from an activity and always name it. */
export const originsFromAnActivity: readonly EvidenceOrigin[] = [
  'protocol',
  'round_point',
  'work_order',
]

/** The bounds of the texts of an evidence, the same in the form, the server and the database. */
export const evidenceLimits = {
  number: 40,
  examiner: 200,
  examinerOrganisation: 200,
  resultReason: 500,
  replacementReason: 500,
  voidingReason: 500,
} as const

/**
 * The number of the newest shape of the frozen state, counted up when a field
 * comes in: 2 since a correction names the evidence it replaces (#26).
 */
export const evidenceStateVersion = 2

/** The place of an evidence in words, as it was on the day it was written down. */
export interface StatedPlace {
  readonly property: { readonly name: string; readonly address: string }
  readonly building: { readonly name: string; readonly shortCode: string | null } | null
  readonly room: { readonly number: string | null; readonly name: string | null } | null
  readonly asset: {
    readonly number: string | null
    readonly name: string
    readonly kind: string
    readonly kindLabel: string | null
    readonly serialNumber: string | null
  } | null
}

/**
 * The duty as it stood on the day it was met: its name, the duty kind and the
 * version that was confirmed, where it comes from (the source of its kind, or
 * what a duty of the operator's own names) and the interval and counting that
 * applied.
 */
export interface StatedDuty {
  readonly label: string
  readonly kind: string | null
  readonly kindVersion: number | null
  readonly source: string
  readonly interval: { readonly days: number } | { readonly months: number }
  readonly counting: Counting
}

/** Who did it: a person of the operator, or an examiner of an organisation from outside. */
export type StatedPerformer =
  { readonly person: string } | { readonly examiner: string; readonly organisation: string }

/** How long the evidence is kept, with the day the rule was read for (ADR 0004, point 17). */
export type StatedRetention =
  | { readonly kind: 'years'; readonly years: number; readonly rule: string; readonly on: IsoDate }
  | { readonly kind: 'until_next_inspection'; readonly on: IsoDate }
  | { readonly kind: 'while_in_use'; readonly on: IsoDate }

export interface StatedDefect {
  readonly description: string
  readonly defectClass: string | null
  readonly dueOn: IsoDate | null
}

export interface StatedSignature {
  readonly name: string
  readonly role: SignatureRole
  /** The moment of the signature, as an ISO 8601 text in UTC. */
  readonly signedAt: string
}

export interface StatedFile {
  readonly sha256: string
  readonly name: string
  readonly mediaType: string
}

/** The evidence a correction replaces: its number, and why it is replaced (ADR 0004, point 14). */
export interface StatedReplacement {
  readonly number: string
  readonly reason: string
}

/**
 * The frozen state of an evidence (ADR 0004, points 3 to 6): everything the
 * page said, as JSON, written by the server when the evidence is written down
 * and never again. Every output reads it and never the current records: the
 * view, the PDF, the register of evidence, an export. The answers and
 * measured values of a protocol with their limits come with the filled
 * forms of phase 1, in a later version.
 *
 * A field that comes in makes a new version; `readEvidenceState` reads every
 * version there ever was and hands out the newest shape.
 */
export interface EvidenceState {
  readonly version: typeof evidenceStateVersion
  readonly number: string
  readonly origin: EvidenceOrigin
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  /** Why it was not performed; only a result "not performed" has one. */
  readonly resultReason: string | null
  /** The evidence this one corrects, since version 2; none for one that corrects nothing. */
  readonly replaces: StatedReplacement | null
  readonly duty: StatedDuty
  readonly place: StatedPlace
  readonly activity: { readonly kind: ActivityKind; readonly title: string } | null
  readonly performer: StatedPerformer | null
  readonly defects: readonly StatedDefect[]
  readonly signatures: readonly StatedSignature[]
  readonly files: readonly StatedFile[]
  readonly retention: StatedRetention | null
  readonly writtenBy: string
  /** The moment it was written down, as an ISO 8601 text in UTC. */
  readonly writtenAt: string
}

/**
 * The frozen state as the row carries it, before it is read: an object with
 * its version. What else it says, `readEvidenceState` reads, in the shape of
 * the newest version.
 */
export interface StoredEvidenceState {
  readonly version: number
}

/** A state of a version this reader does not know, or no state at all. */
export class UnknownEvidenceStateError extends Error {
  constructor(readonly version: unknown) {
    super(`Einen Stand der Fassung ${String(version)} kennt dieser Leser nicht.`)
    this.name = 'UnknownEvidenceStateError'
  }
}

/** The first version: all of the second but the evidence a correction replaces. */
type EvidenceStateOfVersion1 = Omit<EvidenceState, 'version' | 'replaces'> & {
  readonly version: 1
}

/**
 * One reader per version that was ever written, each handing out the newest
 * shape. A version is never taken out: a state of the first version is read
 * as long as the application exists (ADR 0004, point 4).
 */
const readers: Readonly<Record<number, (stored: StoredEvidenceState) => EvidenceState>> = {
  // No evidence of the first version corrects another.
  1: (stored) => ({
    ...(stored as unknown as EvidenceStateOfVersion1),
    version: evidenceStateVersion,
    replaces: null,
  }),
  2: (stored) => stored as unknown as EvidenceState,
}

/** The versions this reader knows. */
export const readableStateVersions: readonly number[] = Object.keys(readers).map(Number)

/** The frozen state of an evidence in the newest shape, whatever version it was written in. */
export function readEvidenceState(stored: unknown): EvidenceState {
  const version =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as { version?: unknown }).version
      : undefined
  const reader = typeof version === 'number' ? readers[version] : undefined

  if (!reader) {
    throw new UnknownEvidenceStateError(version)
  }

  return reader(stored as StoredEvidenceState)
}

/**
 * An evidence (ADR 0004): which duty was met on which day, with which result,
 * at the place of the duty; its number, where it came from, who did it, who
 * wrote it down and when, its frozen state and the fingerprint over it. The
 * row is never changed and never removed, by anybody.
 */
export interface Evidence extends TenantOwned {
  readonly id: EvidenceId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly dutyId: DutyId
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  readonly resultReason: string | null
  readonly number: string
  readonly origin: EvidenceOrigin
  readonly activityId: ActivityId | null
  /** A person of the operator who did it, or an examiner with the organisation from outside. */
  readonly performedBy: string | null
  readonly examiner: string | null
  readonly examinerOrganisation: string | null
  readonly writtenBy: string
  readonly writtenAt: Date
  /** The evidence of the same duty this one corrects, with the reason; both stay. */
  readonly replacesEvidenceId: EvidenceId | null
  readonly replacementReason: string | null
  readonly state: StoredEvidenceState
  /** SHA-256 over the canonical form of the state, as 64 hexadecimal digits. */
  readonly fingerprint: string
}

export type EvidenceVoidingId = Id<'evidence_voiding'>

/**
 * An evidence declared invalid (ADR 0004, point 15): the reason, who did it
 * and when, at most one for an evidence and itself never changed. The
 * evidence stays readable and carries the note wherever it is shown.
 */
export interface EvidenceVoiding extends TenantOwned {
  readonly id: EvidenceVoidingId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly evidenceId: EvidenceId
  readonly reason: string
  readonly voidedBy: string
  readonly voidedAt: Date
}

/**
 * The evidence that counts for the due day of its duty: the ones neither
 * replaced by a correction nor declared invalid (ADR 0004, points 14 and 15).
 * A correction counts in place of the evidence it replaces, and an invalid
 * one counts no more, so the duty of a falsely signed round is open again.
 * An evidence a correction replaces stays replaced when the correction is
 * declared invalid in turn: what is wrong with both is written anew.
 */
export function standingEvidence<
  Row extends { readonly id: string; readonly replacesEvidenceId: string | null },
>(rows: readonly Row[], voided: ReadonlySet<string>): Row[] {
  const replaced = new Set(
    rows.flatMap((row) => (row.replacesEvidenceId === null ? [] : [row.replacesEvidenceId])),
  )

  return rows.filter((row) => !replaced.has(row.id) && !voided.has(row.id))
}

/** What is wrong with the reason a correction or a declaration of invalidity gives. */
export function statedReasonProblem(
  reason: unknown,
  limit: number,
  missing: string,
): string | undefined {
  if (typeof reason !== 'string' || reason.trim() === '') {
    return missing
  }

  return reason.trim().length > limit
    ? `Der Grund hat höchstens ${String(limit)} Zeichen.`
    : undefined
}

/**
 * What is wrong with what a person enters for an evidence: the day, the
 * result with its reason, and an examiner with the organisation. Undefined is
 * a field that was not given and is not asked about.
 */
export function evidenceProblems(evidence: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  oneOf(
    problems,
    evidence,
    'result',
    evidenceResults,
    `Das Ergebnis ist eines von: ${evidenceResults.map((result) => evidenceResultLabel[result]).join(', ')}.`,
  )
  optional(
    problems,
    evidence,
    'resultReason',
    evidenceLimits.resultReason,
    `Der Grund hat höchstens ${String(evidenceLimits.resultReason)} Zeichen.`,
  )
  optional(
    problems,
    evidence,
    'examiner',
    evidenceLimits.examiner,
    `Der Name des Prüfers hat höchstens ${String(evidenceLimits.examiner)} Zeichen.`,
  )
  optional(
    problems,
    evidence,
    'examinerOrganisation',
    evidenceLimits.examinerOrganisation,
    `Die Organisation hat höchstens ${String(evidenceLimits.examinerOrganisation)} Zeichen.`,
  )

  const performedOn = evidence['performedOn']

  if (performedOn !== undefined && !calendarDay(performedOn)) {
    problems['performedOn'] = 'Der Tag der Durchführung ist ein Tag, geschrieben 2026-10-03.'
  }

  const result = evidence['result']
  const reason = evidence['resultReason']
  const hasReason = typeof reason === 'string' && reason.trim() !== ''

  if (result === 'not_performed' && !hasReason && problems['resultReason'] === undefined) {
    problems['resultReason'] = 'Was nicht durchgeführt wurde, nennt den Grund.'
  } else if (
    result !== undefined &&
    result !== 'not_performed' &&
    hasReason &&
    problems['resultReason'] === undefined
  ) {
    problems['resultReason'] = 'Einen Grund nennt nur, was nicht durchgeführt wurde.'
  }

  const examiner = evidence['examiner']
  const organisation = evidence['examinerOrganisation']
  const named = (value: unknown) => typeof value === 'string' && value.trim() !== ''

  if (
    (named(examiner) || named(organisation)) &&
    !(named(examiner) && named(organisation)) &&
    problems['examiner'] === undefined &&
    problems['examinerOrganisation'] === undefined
  ) {
    problems[named(examiner) ? 'examinerOrganisation' : 'examiner'] =
      'Prüfer und Organisation stehen zusammen: wer von außen prüft, nennt beide.'
  }

  return problems
}
