import type { Id, IsoDate, TenantOwned } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import type { DutyId } from './duty-record.js'
import type { PropertyId } from './location.js'

/**
 * The result of a performance, in the words of section 4.4 of the concept:
 * without defects, with defects, failed, or not performed. The evidence as a
 * frozen record comes with #26 (ADR 0004); its row with the day and the
 * result comes before it, with #25, because the next due day of a duty is
 * counted from it.
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
 * The row of an evidence as far as #25 needs it (ADR 0004, point 1): which
 * duty was met on which day, with which result, at the place of the duty. The
 * frozen state, the number, who performed it and who wrote it down, the
 * signature, a correction and a declaration of invalidity come with #26;
 * until then no route writes one, and a row is never changed.
 */
export interface Evidence extends TenantOwned {
  readonly id: EvidenceId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly dutyId: DutyId
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
}
