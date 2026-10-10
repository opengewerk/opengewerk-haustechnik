import type { IsoDate } from '@opengewerk/platform-domain'

import type { ActivityKind } from './activity.js'
import type { DefectStatus } from './defect.js'
import type { EvidenceResult } from './evidence.js'
import type { ActivityOutcome } from './overview.js'

/**
 * The timeline of a place (section 4.1 of the concept, #123): what happened
 * at a property, a building, a room or an asset and at everything below it,
 * the newest first, a page at a time. The same at every place, and in the
 * file of an asset (4.2).
 *
 * Nothing is kept for it: every entry is read from what the application holds
 * anyway, the signatures, the decisions on work orders, the activities, the
 * defects and the evidence. It names no person (decision 42 of phase 1): who
 * did something stands on the page of what it was done to.
 */

/** What the timeline may be narrowed to, `Rundgänge` to `Nachweise` on the board. */
export const timelineCategories = [
  'rounds',
  'inspections',
  'defects',
  'work_orders',
  'evidence',
] as const

export type TimelineCategory = (typeof timelineCategories)[number]

export const timelineCategoryLabel: Readonly<Record<TimelineCategory, string>> = {
  rounds: 'Rundgänge',
  inspections: 'Prüfungen und Wartungen',
  defects: 'Mängel',
  work_orders: 'Aufträge',
  evidence: 'Nachweise',
}

/**
 * What happened. An activity is begun, signed (a round handed in), signed
 * again by whoever countersigns, or closed as not performed; a work order is
 * made and accepted or turned back; a defect is found and checked again; the
 * report of a contractor or an evidence taken over is entered; an evidence is
 * declared invalid. An evidence that came of a signature in the application
 * is the signature's own entry and stands no second time.
 */
export const timelineEventKinds = [
  'started',
  'signed',
  'countersigned',
  'not_performed',
  'order_made',
  'order_accepted',
  'order_rejected',
  'defect_found',
  'defect_checked',
  'evidence_entered',
  'evidence_voided',
] as const

export type TimelineEventKind = (typeof timelineEventKinds)[number]

/** What an activity is called in an entry, as short as the board has it. */
export const timelineActivityWords: Readonly<Record<ActivityKind, string>> = {
  round: 'Rundgang',
  inspection: 'Prüfung',
  maintenance: 'Wartung',
  work_order: 'Auftrag',
}

/** The words of an entry: "Rundgang abgegeben", "Prüfung unterschrieben", "Mangel festgestellt". */
export function timelineEventWords(kind: TimelineEventKind, activity: ActivityKind | null): string {
  const what = activity === null ? '' : timelineActivityWords[activity]

  switch (kind) {
    case 'started':
      return `${what} begonnen`
    case 'signed':
      return activity === 'round' ? 'Rundgang abgegeben' : `${what} unterschrieben`
    case 'countersigned':
      return `${what} gegengezeichnet`
    case 'not_performed':
      return `${what} nicht durchgeführt`
    case 'order_made':
      return 'Auftrag angelegt'
    case 'order_accepted':
      return 'Auftrag abgenommen'
    case 'order_rejected':
      return 'Auftrag zurückgewiesen'
    case 'defect_found':
      return 'Mangel festgestellt'
    case 'defect_checked':
      return 'Mangel nachgeprüft'
    case 'evidence_entered':
      return 'Nachweis eingetragen'
    case 'evidence_voided':
      return 'Nachweis für ungültig erklärt'
  }
}

/** The category an entry belongs to, for the chips over the timeline. */
export function timelineCategoryOf(
  kind: TimelineEventKind,
  activity: ActivityKind | null,
): TimelineCategory {
  if (kind === 'defect_found' || kind === 'defect_checked') {
    return 'defects'
  }

  if (kind === 'evidence_entered' || kind === 'evidence_voided') {
    return 'evidence'
  }

  switch (activity) {
    case 'round':
      return 'rounds'
    case 'work_order':
      return 'work_orders'
    default:
      return 'inspections'
  }
}

/**
 * How what an entry is about stands now, at the right of its row: what came
 * of an activity, the status of a defect, the result of an evidence and
 * whether it was declared invalid.
 */
export type TimelineMark =
  | { readonly kind: 'activity'; readonly outcome: ActivityOutcome | 'open' }
  | { readonly kind: 'defect'; readonly status: DefectStatus }
  | { readonly kind: 'evidence'; readonly result: EvidenceResult; readonly voided: boolean }

/** One entry of a timeline. */
export interface TimelineEvent {
  /** What happened and to which record: unique in a timeline. */
  readonly id: string
  readonly kind: TimelineEventKind
  /** The day it happened on, in Germany, and the moment, which orders a day. */
  readonly day: IsoDate
  readonly at: string
  /** What the entry is about, by its page: an activity of a kind, a defect or an evidence. */
  readonly subject:
    | { readonly type: 'activity'; readonly id: string; readonly activityKind: ActivityKind }
    | { readonly type: 'defect'; readonly id: string }
    | { readonly type: 'evidence'; readonly id: string }
  /** What it is: the title of the activity, what the defect is, the duty the evidence is of. */
  readonly title: string
  /** A number to name it by: of a work order or of an evidence. */
  readonly number: string | null
  readonly mark: TimelineMark
}

/** A page of a timeline, the newest first, and whether older entries follow. */
export interface Timeline {
  readonly events: readonly TimelineEvent[]
  readonly more: boolean
}

/**
 * How many entries a page of the timeline holds, the most one may ask for,
 * and how far back the pages reach. Every source is read up to the end of
 * the page asked for and the whole is sorted on the server, so a page far
 * back would have it read and sort a place's entire history at once (CWE-400,
 * Strix on #223). Older entries stand in the lists of activities, defects and
 * evidence, narrowed to the place.
 */
export const timelinePage = { size: 30, most: 100, furthest: 1500 } as const

/** The place a timeline is of: a property, a building, a room or an asset, and everything below it. */
export type TimelinePlace =
  | { readonly propertyId: string }
  | { readonly buildingId: string }
  | { readonly roomId: string }
  | { readonly assetId: string }

/** In which order two entries stand: the newer day first, then the newer moment, then by id. */
export function inTimelineOrder(
  left: Pick<TimelineEvent, 'day' | 'at' | 'id'>,
  right: Pick<TimelineEvent, 'day' | 'at' | 'id'>,
): number {
  return (
    right.day.localeCompare(left.day) ||
    right.at.localeCompare(left.at) ||
    left.id.localeCompare(right.id)
  )
}
