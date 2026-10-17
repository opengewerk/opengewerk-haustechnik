import type { IsoDate } from '@opengewerk/platform-domain'

import type { EvidenceId, StatedRetention } from './evidence.js'

/**
 * How long the evidence of an operator stays beyond the rule of its package
 * (section 2.6 of the concept, #340): a number of years from the day it was
 * performed. The later of the two ends counts, so the setting lengthens and
 * never shortens; nothing set is the rule alone.
 */
export interface RetentionSettings {
  readonly minimumYears: number | null
}

export const retentionLimits = {
  minimumYears: { min: 1, max: 50 },
} as const

/** What is wrong with a longer retention as a form sends it, or nothing. */
export function retentionSettingsProblem(said: unknown): string | null {
  if (said === null) {
    return null
  }

  const { min, max } = retentionLimits.minimumYears

  return Number.isInteger(said) && (said as number) >= min && (said as number) <= max
    ? null
    : `Mindestens aufbewahren heißt ${String(min)} bis ${String(max)} Jahre, oder leer.`
}

/**
 * The retention of an evidence in words, as the proposals and an emptied
 * evidence say it: the form of its rule and the longer retention of the
 * operator, where there is one. An evidence of an own duty has no rule of a
 * package and stays until the next inspection, as the database counts it.
 */
export function retentionInWords(
  retention: StatedRetention | null,
  minimumYears: number | null,
): string {
  const rule =
    retention === null
      ? 'Bis zur nächsten Prüfung, eigene Pflicht'
      : retention.kind === 'years'
        ? `${String(retention.years)} ${retention.years === 1 ? 'Jahr' : 'Jahre'}`
        : retention.kind === 'until_next_inspection'
          ? 'Bis zur nächsten Prüfung'
          : 'Solange die Anlage verwendet wird'

  return minimumYears === null
    ? rule
    : `${rule}, mindestens ${String(minimumYears)} ${minimumYears === 1 ? 'Jahr' : 'Jahre'}`
}

/**
 * An evidence whose retention has ended, as the run proposes it for deletion
 * (#340): which, of which duty and asset, by which rule and since when. No
 * person: who did it is what goes.
 */
export interface RetentionProposal {
  readonly evidenceId: EvidenceId
  readonly number: string
  readonly performedOn: IsoDate
  readonly dutyTitle: string
  readonly asset: { readonly number: string | null; readonly name: string } | null
  readonly propertyName: string
  readonly retention: string
  readonly endedOn: IsoDate
}

export interface RetentionProposals {
  readonly proposals: readonly RetentionProposal[]
  /** Whether the person who asks leads the operator, and so may confirm. */
  readonly mayConfirm: boolean
  /** Whether more are proposed than the page shows; they follow once these are gone. */
  readonly more: boolean
}

/** As many as one confirmation takes, and the page shows. */
export const retentionProposalPage = 200

export interface EvidenceEmptyings {
  readonly evidenceIds: readonly EvidenceId[]
}

export const retentionSentences = {
  notLeading: 'Löschen bestätigt nur, wer den Betreiber führt.',
  notEnded: 'Die Aufbewahrung dieses Nachweises ist nicht abgelaufen.',
  nothingChosen: 'Kein Nachweis ausgewählt.',
  tooMany: `Höchstens ${String(retentionProposalPage)} Nachweise auf einmal.`,
  emptied: 'Dieser Nachweis ist nach Ablauf seiner Aufbewahrung gelöscht.',
  /** What a shell is called where a line names an evidence by its duty. */
  emptiedTitle: 'Gelöscht nach Ablauf der Aufbewahrung',
} as const

/** What stays of an evidence after the end of its retention, and why (decided on 15.10.2026). */
export interface EmptiedEvidence {
  /** The moment of the confirmation, as an ISO 8601 text in UTC. */
  readonly at: string
  /** The name of whoever confirmed it, read from the instance. */
  readonly confirmedBy: string
  readonly retention: string
  readonly endedOn: IsoDate
}
