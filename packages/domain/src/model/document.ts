import {
  type AttachmentRecord,
  attachmentRules,
  attachmentTitleOf,
  type AttachmentVersion,
  type IsoDate,
} from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { AreaId } from './area.js'
import type { AssetId } from './asset.js'
import type { ContractorId } from './contractor.js'
import type { DefectId } from './defect.js'
import { calendarDay, oneOf, type Problems, required } from './fields.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'

/**
 * What a document is, as section 4.10 of the concept lists the kinds: the
 * manual of an asset, the certificate of an inspection, a circuit diagram,
 * what a contractor hands over when a building is finished or changed, a
 * permit, a concept, and since #327 a risk assessment (4.3). A document may
 * have none of them: a photo of a type plate is filed like any other document
 * and is none of the seven.
 */
export const documentKinds = [
  'operating_manual',
  'test_certificate',
  'circuit_diagram',
  'as_built_documentation',
  'permit',
  'concept',
  // A risk assessment (4.3, #327): a document like any other, whose date is
  // its review.
  'risk_assessment',
] as const

export type DocumentKind = (typeof documentKinds)[number]

/** What each kind is called, in the words of the concept. */
export const documentKindLabel: Readonly<Record<DocumentKind, string>> = {
  operating_manual: 'Betriebsanleitung',
  test_certificate: 'Prüfbescheinigung',
  circuit_diagram: 'Schaltplan',
  as_built_documentation: 'Revisionsunterlage',
  permit: 'Genehmigung',
  concept: 'Konzept',
  risk_assessment: 'Gefährdungsbeurteilung',
}

/**
 * A document in the records of an operator (section 4.10 of the concept,
 * #97): the file of the foundation (ADR 0010 of the repository opengewerk),
 * with what one hangs on here and what kind of document it is.
 *
 * It hangs on a contractor of the operator (section 4.11, #328), with no
 * property and no area, as the contractor has none: its certificates, its
 * insurance. Every other document hangs on its property, and at most on one
 * record there: a
 * building, a room, an asset, an activity or a defect, whose photo it is
 * (#116); none of the five is the property itself, like a duty, an activity
 * and a defect (ADR 0002, point 10). Its
 * area is the area of its property, like that of every row with a place
 * (ADR 0003). It is never moved: a document stays where it was filed.
 *
 * The bytes are in its versions. A new version is laid over the ones before
 * it, and every one of them stays readable.
 */
export interface Document extends AttachmentRecord {
  readonly propertyId: PropertyId | null
  readonly areaId: AreaId | null
  readonly contractorId: ContractorId | null
  readonly buildingId: BuildingId | null
  readonly roomId: RoomId | null
  readonly assetId: AssetId | null
  readonly activityId: ActivityId | null
  readonly defectId: DefectId | null
  readonly kind: DocumentKind | null
  /**
   * Whether it was taken over from a predecessor application (section 11 of
   * the concept, #130): an old evidence with its original file, neither
   * signed anew nor rewritten. Set by the import and by nothing else.
   */
  readonly legacy: boolean
}

/**
 * One version of a document, as the foundation keeps it. It carries no place
 * of its own: it is a part of its document and is seen by whoever sees that,
 * which the database asks of the document (ADR 0003, addendum of #97).
 *
 * Its validity is its own (4.10, #327): the day it expires, or for a risk
 * assessment the day it is to be reviewed. A new version brings its own day,
 * or none; the newest one's is the deadline of the document.
 */
export interface DocumentVersion extends AttachmentVersion {
  readonly validUntil: IsoDate | null
}

/** What the day of a version is called: the review of a risk assessment, the expiry of any other. */
export function documentDateLabel(kind: DocumentKind | null): string {
  return kind === 'risk_assessment' ? 'Wiedervorlage am' : 'Gültig bis'
}

/** The day of a version as a list says it beside the kind: "gültig bis 31.03.2027", "Wiedervorlage 29.10.2026". */
export function documentDateWords(kind: DocumentKind | null, day: string): string {
  return kind === 'risk_assessment' ? `Wiedervorlage ${day}` : `gültig bis ${day}`
}

/** What is wrong with the day of a version, or nothing: a day of the calendar, or none. */
export function documentVersionProblems(
  version: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const day = version['validUntil']

  return day === undefined || day === null || calendarDay(day)
    ? {}
    : { validUntil: 'Das Datum ist ein Tag, geschrieben 2027-03-31.' }
}

/** The bound of the name of a document, the same in the form, the sync and the database. */
export const documentLimits = { title: 120 } as const

/** What a document is called whose file name says nothing. */
export const untitledDocument = 'Dokument'

/**
 * The name a new document gets from its file: the file's own without the
 * ending, cut to what the database keeps. Somebody may say another before it
 * is filed, and correct it afterwards.
 */
export function documentTitleOf(fileName: string): string {
  return attachmentTitleOf(fileName, untitledDocument).slice(0, documentLimits.title).trim()
}

/**
 * The rules of the documents of this application, as the foundation makes
 * them from its six places and its two sentences: one object for the
 * screens and the sync. The property is always named, so "nowhere to hang"
 * is a mistake only a broken client makes.
 */
export const operatorDocuments = attachmentRules({
  homes: [
    'propertyId',
    'buildingId',
    'roomId',
    'assetId',
    'activityId',
    'defectId',
    'contractorId',
  ],
  text: {
    noHome:
      'Ein Dokument hängt an einer Liegenschaft, einem Gebäude, einem Raum, einer Anlage, einem Vorgang, einem Mangel oder einer Fremdfirma.',
    mediaType: 'Der Typ der Datei ist nicht so angegeben, wie die Ablage ihn festhält.',
  },
})

/** What a document may hang on besides its property, in the order a form asks them. */
export const documentTargetFields = [
  'assetId',
  'roomId',
  'buildingId',
  'activityId',
  'defectId',
] as const

/** One of the places a document hangs on, its property and a contractor included. */
export type DocumentHome = 'propertyId' | 'contractorId' | (typeof documentTargetFields)[number]

/** What the server answers for a document that names both a place and a contractor, or neither. */
export const documentPlaceOrContractor =
  'Ein Dokument hängt an einer Liegenschaft oder an einer Fremdfirma, nicht an beiden.'

/**
 * What is wrong with where a document hangs, or null: at a contractor it
 * names no property and nothing on one (#328), which the check in the
 * database refuses as well; otherwise it names its property.
 */
export function documentPlaceProblem(document: Readonly<Record<string, unknown>>): string | null {
  const given = (field: string) =>
    document[field] !== undefined && document[field] !== null && document[field] !== ''
  const atAContractor = given('contractorId')
  const atAPlace = given('propertyId') || documentTargetFields.some(given)

  return atAContractor === atAPlace ? documentPlaceOrContractor : null
}

/**
 * What is wrong with the record a document hangs on, or null: more than one
 * of an asset, a room, a building, an activity and a defect, which the check
 * in the database refuses as well.
 */
export function documentTargetProblem(target: Readonly<Record<string, unknown>>): string | null {
  const named = documentTargetFields.filter(
    (field) => target[field] !== undefined && target[field] !== null && target[field] !== '',
  )

  return named.length > 1
    ? 'Ein Dokument hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum, einem Gebäude, einem Vorgang oder einem Mangel.'
    : null
}

/**
 * What a document hangs on: its contractor, the one record it names besides
 * its property, or the property where it names neither.
 */
export function documentHomeOf(document: Readonly<Record<string, unknown>>): DocumentHome {
  if (document['contractorId'] !== undefined && document['contractorId'] !== null) {
    return 'contractorId'
  }

  return (
    documentTargetFields.find(
      (field) => document[field] !== undefined && document[field] !== null,
    ) ?? 'propertyId'
  )
}

/**
 * What is wrong with what is said about a document, by field: its name, which
 * it cannot be without, and its kind, one of the six or none.
 */
export function documentProblems(record: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, record, 'title', documentLimits.title, 'Die Bezeichnung')
  oneOf(problems, record, 'kind', documentKinds, 'Diese Art eines Dokuments gibt es nicht.')

  return problems
}

/** What the server answers for a document that is not there for whoever asks. */
export const documentGone =
  'Dieses Dokument gibt es nicht, oder es ist aus der Ablage entfernt worden.'
