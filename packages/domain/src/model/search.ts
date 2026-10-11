import type { IsoDate } from '@opengewerk/platform-domain'

import type { ActivityKind, ActivityStatus } from './activity.js'

/**
 * The search over properties, buildings, rooms, assets and activities by
 * name, number and mark (section 3 of the concept, #125), and over the
 * evidence by its number. The office asks the server, which searches in the
 * areas of the person asking; on site the device asks the server as long as
 * it has a network, and searches what it holds without one (decision 24 of
 * phase 1). Both find the same way: the words anywhere in a text, regardless
 * of case, the closest first.
 *
 * No hit names a person: not who answers for an activity, who performs it or
 * who wrote an evidence down.
 */

/** The kinds of hits, in the order their groups stand. */
export const searchKinds = [
  'property',
  'building',
  'room',
  'asset',
  'activity',
  'evidence',
] as const

export type SearchKind = (typeof searchKinds)[number]

export const searchLimits = {
  /** The fewest characters a search is asked with. */
  shortest: 2,
  /** The most, which no name and no number of the application comes near. */
  longest: 100,
  /** The hits of a kind an answer holds; whether there are more, it says without how many. */
  perKind: 5,
} as const

/** The marks an asset is found by beside its number and its name. */
export const assetMarks = ['mark', 'serialNumber', 'meterNumber'] as const

export type AssetMark = (typeof assetMarks)[number]

export const assetMarkLabel: Readonly<Record<AssetMark, string>> = {
  mark: 'Kennzeichen',
  serialNumber: 'Seriennummer',
  meterNumber: 'Zählernummer',
}

/** A mark of an asset as a hit shows it. */
export interface ShownMark {
  readonly field: AssetMark
  readonly value: string
}

/**
 * One hit, with what its line needs and nothing more. Where it is stands as
 * the names of the places above it, from the property down.
 */
export type SearchHit =
  | {
      readonly kind: 'property'
      readonly id: string
      readonly name: string
      readonly address: string
    }
  | {
      readonly kind: 'building'
      readonly id: string
      readonly name: string
      readonly shortCode: string | null
      readonly property: string
    }
  | {
      readonly kind: 'room'
      readonly id: string
      readonly number: string | null
      readonly name: string | null
      readonly property: string
      readonly building: string
      readonly floor: string
    }
  | {
      readonly kind: 'asset'
      readonly id: string
      readonly number: string | null
      readonly name: string
      /** The mark the words were found in, else the mark the operator keeps, if there is one. */
      readonly mark: ShownMark | null
      readonly building: string
      readonly room: string | null
    }
  | {
      readonly kind: 'activity'
      readonly id: string
      readonly activityKind: ActivityKind
      /** The number of a work order; the other activities have none. */
      readonly number: string | null
      readonly title: string
      readonly status: ActivityStatus
      /** Its building, or its property where it stands at no building. */
      readonly place: string
    }
  | {
      readonly kind: 'evidence'
      readonly id: string
      readonly number: string
      /** What it proves: the duty as the evidence froze it. */
      readonly title: string
      readonly performedOn: IsoDate
      /** Its building, or its property, as the evidence froze it. */
      readonly place: string
    }

/** What the server answers to a search. */
export interface SearchAnswer {
  readonly hits: readonly SearchHit[]
  /** The kinds with more hits than the answer holds, and never how many. */
  readonly more: readonly SearchKind[]
}

/** The words of a search as they are asked: trimmed, and a run of spaces is one. */
export function searchWordsOf(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
}

/** What is wrong with the words of a search, or null when they may be asked. */
export function searchProblem(words: string): string | null {
  if (words.length < searchLimits.shortest) {
    return `Gesucht wird ab ${String(searchLimits.shortest)} Zeichen.`
  }

  if (words.length > searchLimits.longest) {
    return `Gesucht wird nach höchstens ${String(searchLimits.longest)} Zeichen.`
  }

  return null
}

function lower(text: string): string {
  return text.toLocaleLowerCase('de')
}

/** Whether a text holds the words anywhere, regardless of case, as ILIKE in the database. */
export function holds(text: string | null | undefined, words: string): boolean {
  return typeof text === 'string' && lower(text).includes(lower(words))
}

/**
 * How close the closest of the texts comes to the words: 0 when one is the
 * words, 1 when one begins with them, 2 when one holds them, 3 when none
 * does. A number found whole stands before one that only holds the words.
 */
export function closeness(texts: readonly (string | null | undefined)[], words: string): number {
  const needle = lower(words)

  return Math.min(
    3,
    ...texts.map((text) => {
      if (typeof text !== 'string') {
        return 3
      }

      const hay = lower(text)

      return hay === needle ? 0 : hay.startsWith(needle) ? 1 : hay.includes(needle) ? 2 : 3
    }),
  )
}

/** The mark an asset shows in its hit: the one the words were found in, else its mark. */
export function shownMark(
  asset: Readonly<Record<AssetMark, string | null>>,
  words: string,
): ShownMark | null {
  const found = assetMarks.find((field) => holds(asset[field], words))

  if (found !== undefined) {
    return { field: found, value: asset[found] as string }
  }

  return asset.mark === null ? null : { field: 'mark', value: asset.mark }
}
