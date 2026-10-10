import type { Id, IsoDate, TenantOwned } from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { AreaId } from './area.js'
import type {
  StatedAnswer,
  StatedDefect,
  StatedForm,
  StatedPerformer,
  StatedPlace,
  StatedSignature,
} from './evidence.js'
import type { PropertyId } from './location.js'

/**
 * The frozen state of a round as a whole (section 2.6 of the concept, #111):
 * "Mit der Unterschrift wird der Stand in einer Fassung eingefroren." An
 * evidence freezes what one duty was met with; a round may meet several
 * duties, or none, and its PDF shows the whole of it: every answer, the
 * photos, the defects that came of it and the signatures. Written once, when
 * the round is written down, and read by every output after; never the
 * current records.
 */

export type RoundRecordId = Id<'round-record'>

/** The number of the newest shape of the frozen state of a round. */
export const roundRecordVersion = 1

export interface RoundRecordState {
  readonly version: typeof roundRecordVersion
  readonly title: string
  readonly place: StatedPlace
  readonly dueOn: IsoDate | null
  readonly performedOn: IsoDate
  readonly form: StatedForm | null
  readonly answers: readonly StatedAnswer[]
  readonly performer: StatedPerformer | null
  readonly defects: readonly StatedDefect[]
  readonly signatures: readonly StatedSignature[]
  /** The evidence the round was written down with, by number and the duty each met. */
  readonly evidence: readonly { readonly number: string; readonly duty: string }[]
  readonly writtenBy: string
  /** The moment it was written down, as an ISO 8601 text in UTC. */
  readonly writtenAt: string
}

/**
 * The frozen state of a round as its row carries it, with the fingerprint
 * over it. Written once and never changed, so it has no time of a change.
 */
export interface RoundRecord extends Omit<TenantOwned, 'updatedAt'> {
  readonly id: RoundRecordId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly state: RoundRecordState
  readonly fingerprint: string
  readonly createdAt: Date
}
