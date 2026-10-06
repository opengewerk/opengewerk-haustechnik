import type { Id, Label, Synced } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import type { PropertyId, RoomId } from './location.js'

/**
 * A label with a QR code (section 3 of the concept, #98): the label of the
 * foundation (ADR 0010 of the repository opengewerk), with what one hangs on
 * here.
 *
 * It hangs on an asset or on a room, never on both, and its scan opens the
 * page of that record. One that names neither comes from a sheet printed for
 * taking stock: it belongs to its property and waits to be given to an asset
 * on site. Its area is the area of its property, like that of every row with
 * a place (ADR 0003).
 *
 * The code is drawn by the server and stands once in the whole instance, over
 * every operator: the same address opens the report of a fault without an
 * account later on (section 4.7). An asset and a room have at most one valid
 * label; a lost one is blocked for good, and then a new one is made.
 */
export type LabelId = Id<'label'>

export interface PlaceLabel extends Synced, Label {
  readonly id: LabelId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly assetId: AssetId | null
  readonly roomId: RoomId | null
}

/**
 * The most labels one print makes when it prints a different label on every
 * field: ten sheets. A register with more than that is narrowed first.
 */
export const labelBatchMost = 240

/**
 * What a label says to the device that holds its row, in this order: a
 * blocked label opens nothing, whoever asks and whatever it hangs on; a valid
 * one opens its asset or its room; one from a sheet that nobody has given to
 * an asset yet says so.
 */
export type LabelReading =
  | { readonly state: 'blocked' }
  | { readonly state: 'asset'; readonly assetId: string }
  | { readonly state: 'room'; readonly roomId: string }
  | { readonly state: 'unassigned' }

/**
 * Asked of a row as the server keeps it and of one as a device holds it, so
 * the fields are read for what they say and not for their type.
 */
export function labelReadingOf(label: {
  readonly blockedAt?: unknown
  readonly assetId?: unknown
  readonly roomId?: unknown
}): LabelReading {
  if (label.blockedAt !== null && label.blockedAt !== undefined) {
    return { state: 'blocked' }
  }

  if (typeof label.assetId === 'string' && label.assetId !== '') {
    return { state: 'asset', assetId: label.assetId }
  }

  if (typeof label.roomId === 'string' && label.roomId !== '') {
    return { state: 'room', roomId: label.roomId }
  }

  return { state: 'unassigned' }
}

/**
 * What the server says about a code to the person asking, and nothing else:
 * no asset, no room, no property and no id.
 *
 * - `open`: a valid label in one of the areas of the person. Their device
 *   fetches it with the next exchange.
 * - `blocked`: a label of this operator that opens nothing any more, in
 *   whatever area: blocked, or gone with the record it hung on.
 * - `outside`: a valid label of this operator outside the areas of the person.
 * - `unknown`: everything else, a label of another operator included.
 */
export const labelStandings = ['open', 'blocked', 'outside', 'unknown'] as const

export type LabelStanding = (typeof labelStandings)[number]

/** The answer of the route that is asked about a code. */
export interface LabelStandingAnswer {
  readonly standing: LabelStanding
}
