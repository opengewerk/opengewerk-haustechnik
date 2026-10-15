import type { AttachmentId, AttachmentVersionId, IsoDate } from '@opengewerk/platform-domain'

import type { Document, DocumentKind } from './document.js'

/**
 * The document that bears the interval of a duty (section 4.3 of the
 * concept, #74): "Frist festlegen ... mit Begründung und Verweis auf das
 * Dokument, das sie trägt (Gefährdungsbeurteilung). Der Verweis ist
 * empfohlen und nicht verlangt; er merkt sich die Fassung des Dokuments vom
 * Tag der Bestätigung, und liegt eine neuere vor, sagt die Pflicht „Frist
 * prüfen“."
 *
 * The rules the form, the route and the page of a duty hold to: which
 * documents may bear the interval of a duty, how a duty reads the document
 * it points at, and when it says "Frist prüfen".
 */

/**
 * Where a duty hangs and what lies above it there: an asset with its room and
 * its building, a room with its building, a building, or the property alone.
 * The documents filed at any of these may bear its interval.
 */
export interface DutyPlaceChain {
  readonly propertyId: string
  readonly buildingId: string | null
  readonly roomId: string | null
  readonly assetId: string | null
}

/** What a document hangs on, as far as the rule asks. */
export type DocumentHanging = Pick<
  Document,
  'propertyId' | 'buildingId' | 'roomId' | 'assetId' | 'activityId' | 'defectId'
>

/** The sentence for a document the interval of a duty may not point at. */
export const intervalDocumentElsewhere =
  'Das Dokument, das die Frist trägt, liegt an dem, woran die Pflicht hängt, oder darüber: an ihrer Anlage, ihrem Raum, ihrem Gebäude oder ihrer Liegenschaft.'

/**
 * Whether a document may bear the interval of a duty: it lies on the same
 * property, and at the record the duty hangs on or at one above it, or at
 * the property itself. A document of an activity or of a defect is a record
 * of work done or of something found, and bears no interval.
 */
export function bearsTheIntervalOf(
  document: Readonly<Partial<Record<keyof DocumentHanging, unknown>>>,
  chain: DutyPlaceChain,
): boolean {
  const at = (field: 'buildingId' | 'roomId' | 'assetId') => {
    const value = document[field] ?? null

    return value === null || value === chain[field]
  }

  return (
    document.propertyId === chain.propertyId &&
    (document.activityId ?? null) === null &&
    (document.defectId ?? null) === null &&
    at('assetId') &&
    at('roomId') &&
    at('buildingId')
  )
}

/** What is wrong with a document as the bearer of the interval of a duty, or null. */
export function intervalDocumentProblem(
  document: Readonly<Partial<Record<keyof DocumentHanging, unknown>>>,
  chain: DutyPlaceChain,
): string | null {
  return bearsTheIntervalOf(document, chain) ? null : intervalDocumentElsewhere
}

/** A version of the document that bears an interval, as the page of the duty names it. */
export interface DutyDocumentVersion {
  readonly id: AttachmentVersionId
  /** Which version of the document it is, counted from the first. */
  readonly number: number
  /** The day it was filed, in Germany; never the time of day (section 9 of the concept). */
  readonly filedOn: IsoDate
  readonly fileName: string
  /** The day it expires or is to be reviewed, or none (#327). */
  readonly validUntil: IsoDate | null
}

/** The document that bears the interval of a duty, as the page of the duty reads it. */
export interface DutyIntervalDocument {
  readonly id: AttachmentId
  readonly title: string
  /** Its kind, which says whether its day is a review or an expiry (#327). */
  readonly kind: DocumentKind | null
  /** Taken out of the records since: the page names it and leads nowhere. */
  readonly removed: boolean
  /** The version the duty points at. */
  readonly version: DutyDocumentVersion
  /** The newest version where it is newer than that one, else null. */
  readonly newer: DutyDocumentVersion | null
}

/**
 * How a duty reads the document it points at: the version it keeps, which
 * one that is, and the newest where a newer one lies over it. The newest is
 * the one with the highest id, as the foundation orders the versions (UUIDv7,
 * minted when a version is made). Null where the version is none of the
 * document's, which the keys of the database rule out.
 */
export function intervalDocumentReading(
  document: {
    readonly id: AttachmentId
    readonly title: string
    readonly kind: DocumentKind | null
    readonly removed: boolean
  },
  versions: readonly Omit<DutyDocumentVersion, 'number'>[],
  pointedAt: AttachmentVersionId,
): DutyIntervalDocument | null {
  const ordered = [...versions].sort((left, right) => left.id.localeCompare(right.id))
  const numbered = ordered.map((version, index) => ({ ...version, number: index + 1 }))
  const version = numbered.find((each) => each.id === pointedAt)
  const newest = numbered.at(-1)

  if (version === undefined || newest === undefined) {
    return null
  }

  return {
    ...document,
    version,
    newer: newest.id === version.id ? null : newest,
  }
}

/**
 * Whether a duty says "Frist prüfen" (section 4.3): the document that bears
 * its interval has a newer version than the one it points at, or was taken
 * out of the records. A duty that has ended calls for nothing, and says it
 * no more.
 */
export function intervalToCheck(
  reading: Pick<DutyIntervalDocument, 'removed' | 'newer'> | null,
  ended: boolean,
): boolean {
  return !ended && reading !== null && (reading.removed || reading.newer !== null)
}
