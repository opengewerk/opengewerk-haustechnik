import {
  checkPointResultLabel,
  type Id,
  type IsoDate,
  type TenantOwned,
} from '@opengewerk/platform-domain'

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
import { placeWords } from './office-table.js'

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

// --- A round as a table (#344) ----------------------------------------------------------------

/**
 * The columns of a round as a table (section 4.5 of the concept, #344): a row
 * per point, with the day of the signature, the round and its place, the
 * chapter and the point, the answer, the measured value against its limit
 * and the remark. Without names and times of day (decided 15.10.2026): who
 * signed stands in the PDF of the round alone.
 */
export const roundTableColumns = [
  'Tag der Unterschrift',
  'Rundgang',
  'Ort',
  'Kapitel',
  'Punkt',
  'Antwort',
  'Grenzwert',
  'Eingehalten',
  'Bemerkung',
] as const

/** The place of a round in words: property, building, room and asset as far as it names them. */
export function roundPlaceWords(place: StatedPlace): string {
  const joined = (parts: readonly (string | null)[]) =>
    parts.filter((part) => part !== null && part !== '').join(' ')

  return placeWords([
    place.property.name,
    place.building?.name,
    place.room === null ? null : joined([place.room.number, place.room.name]),
    place.asset === null ? null : joined([place.asset.number, place.asset.name]),
  ])
}

/**
 * The rows of one round as a table, read from its frozen state and never
 * from the current records, on the day it was signed. A point of a group
 * that repeats names its block: "Leuchte 2: Funktion".
 */
export function roundTableRows(state: RoundRecordState, signedOn: IsoDate): (string | null)[][] {
  const where = roundPlaceWords(state.place)

  return state.answers.map((answer) => [
    signedOn,
    state.title,
    where,
    answer.section,
    answer.group === null
      ? answer.label
      : `${answer.group.label} ${String(answer.group.block)}: ${answer.label}`,
    answer.value ?? (answer.result === null ? null : checkPointResultLabel[answer.result]),
    answer.limit?.text ?? null,
    answer.limit === null || answer.limit.within === null
      ? null
      : answer.limit.within
        ? 'ja'
        : 'nein',
    answer.remark,
  ])
}
