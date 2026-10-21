import type { IsoDate } from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { DefectId } from './defect.js'
import { type Problems } from './fields.js'

/**
 * What hangs on no evidence and has a retention of its own (#412, section
 * 2.6 of the concept, decided on 21.10.2026): an activity without evidence,
 * a defect after it was remedied, a task done, the person at a meter reading
 * and the person at a booking in a store.
 */
export const recordRetentionKinds = [
  'activity',
  'defect',
  'task',
  'reading_person',
  'booking_person',
] as const

export type RecordRetentionKind = (typeof recordRetentionKinds)[number]

/**
 * The years each kind stays at least, as long as the law that may apply to it:
 * an activity six from the end of the year it ended (section 257 HGB, section
 * 147 AO), a defect five from the day it was remedied (section 634a BGB), the
 * person at a reading and a booking three (section 195 BGB). A task has no law
 * of its own and stays a year. An operator lengthens them and never shortens.
 */
export const recordRetentionYears: Readonly<Record<RecordRetentionKind, number>> = {
  activity: 6,
  defect: 5,
  task: 1,
  reading_person: 3,
  booking_person: 3,
}

/** The most years a setting takes. */
export const recordRetentionMaxYears = 50

/** The years an operator set per kind; null is the years of the law. */
export type RecordRetentionSettings = Readonly<Record<RecordRetentionKind, number | null>>

/** What each kind is called where the office names it. */
export const recordRetentionLabels: Readonly<Record<RecordRetentionKind, string>> = {
  activity: 'Vorgang ohne Nachweis',
  defect: 'Mangel nach Beseitigung',
  task: 'Erledigte Aufgabe',
  reading_person: 'Person am Zählerstand',
  booking_person: 'Person an der Buchung im Lager',
}

/** From when each kind counts, as the office says it. */
export const recordRetentionFrom: Readonly<Record<RecordRetentionKind, string>> = {
  activity: 'ab Ende des Jahres, in dem er endete',
  defect: 'ab dem Tag der Beseitigung',
  task: 'ab der Erledigung',
  reading_person: 'ab der Ablesung',
  booking_person: 'ab der Buchung',
}

/** What is wrong with each year a form sends, by kind, or nothing. */
export function recordRetentionProblems(said: Readonly<Record<string, unknown>>): Problems {
  const problems: Record<string, string> = {}

  for (const kind of recordRetentionKinds) {
    const value = said[kind]

    if (value === null || value === undefined) {
      continue
    }

    const least = recordRetentionYears[kind]

    if (
      !Number.isInteger(value) ||
      (value as number) < least ||
      (value as number) > recordRetentionMaxYears
    ) {
      problems[kind] =
        `${recordRetentionLabels[kind]}: ${String(least)} bis ${String(recordRetentionMaxYears)} Jahre, oder leer für ${String(least)}.`
    }
  }

  return problems
}

/** The years that count for a kind: what the operator set, or the law. */
export function recordRetentionYearsOf(
  settings: RecordRetentionSettings | null,
  kind: RecordRetentionKind,
): number {
  return settings?.[kind] ?? recordRetentionYears[kind]
}

/** An activity without evidence whose retention has ended, as the run proposes it. No person. */
export interface ActivityRetentionProposal {
  readonly activityId: ActivityId
  readonly kind: string
  readonly title: string
  readonly endedOn: IsoDate
  readonly place: string
  readonly retentionEndedOn: IsoDate
}

/** A remedied defect whose retention has ended, as the run proposes it. No person. */
export interface DefectRetentionProposal {
  readonly defectId: DefectId
  readonly foundOn: IsoDate
  readonly remediedOn: IsoDate
  readonly description: string
  readonly place: string
  readonly retentionEndedOn: IsoDate
}

/** What the run proposes beside the evidence, and whether the person who asks may confirm it. */
export interface RecordRetentionProposals {
  readonly activities: readonly ActivityRetentionProposal[]
  readonly defects: readonly DefectRetentionProposal[]
  /** Whether the person who asks leads the operator, and so may confirm. */
  readonly mayConfirm: boolean
  /** Whether more are proposed than the page shows; they follow once these are gone. */
  readonly more: boolean
}

export const recordRetentionSentences = {
  activityNotEnded: 'Die Aufbewahrung dieses Vorgangs ist nicht abgelaufen.',
  defectNotEnded: 'Die Aufbewahrung dieses Mangels ist nicht abgelaufen.',
  nothingChosen: 'Nichts ausgewählt.',
  /** What a defect says after its content went. */
  emptiedDefect: 'Gelöscht nach Ablauf der Aufbewahrung.',
} as const
