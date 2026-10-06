import {
  attachmentEntity,
  attachmentVersionEntity,
  type DocumentHome,
  documentHomeOf,
  type DocumentKind,
  documentKindLabel,
  documentProblems,
  documentTargetProblem,
  documentTitleOf,
  isPicture,
  operatorDocuments,
  type RecordState,
  untitledDocument,
} from '@opengewerk/haustechnik-domain'
import {
  addVersion,
  prepareVersion,
  type ShrinkPicture,
} from '@opengewerk/platform-web/attachments'
import { date, fileSize } from '@opengewerk/platform-web/format'
import { count, maybeText, refusalFor, type SyncClient, text } from '@opengewerk/platform-web/sync'

import { titleOfRoom } from './place-records.js'

// The documents of an operator on a device (#97, section 4.10 of the concept),
// for both entries: what becomes of a chosen file is the foundation's (ADR
// 0010 of the repository opengewerk), a photo made smaller, the bytes kept on
// the device and sent ahead of the two records. What is this application's is
// in here: what a document hangs on, its name and its kind, and the words for
// both.
//
// A document is filed through the outbox, in the office as on site: the bytes
// wait on the device with the two records and go up ahead of them at the next
// exchange, so a photo taken in a cellar hangs at its asset once the device
// has a network again.

/** Where a new document hangs: its property, and on request one record there. */
export interface DocumentPlace {
  readonly propertyId: string
  readonly buildingId?: string | null
  readonly roomId?: string | null
  readonly assetId?: string | null
  readonly activityId?: string | null
}

/** What somebody says about a document they file. */
export interface DocumentFiling {
  /** Its name; left out, the name of its file without the ending. */
  readonly title?: string
  readonly kind?: DocumentKind | null
  /** Keeps a photo at its full size instead of making it smaller. */
  readonly keepOriginal?: boolean
  /** How a picture is made smaller, where a test has no canvas that draws. */
  readonly shrink?: ShrinkPicture
}

/** What the foundation is told about a file of this application. */
function optionsOf(filing: DocumentFiling) {
  return {
    untitled: untitledDocument,
    ...(filing.keepOriginal === undefined ? {} : { keepOriginal: filing.keepOriginal }),
    ...(filing.shrink === undefined ? {} : { shrink: filing.shrink }),
  }
}

/**
 * A new document at a place, with its first version, through the outbox. The
 * sentence to show, or null when both are queued.
 *
 * Asked what the server will ask before anything is kept: where it hangs,
 * its name and its kind. The name is the one somebody typed, or the name of
 * the file.
 */
export async function fileDocument(
  client: SyncClient,
  place: DocumentPlace,
  file: File,
  filing: DocumentFiling = {},
): Promise<string | null> {
  const title = (filing.title ?? documentTitleOf(file.name)).trim()
  const kind = filing.kind ?? null
  const problem =
    operatorDocuments.homeProblem(place) ??
    documentTargetProblem({ ...place }) ??
    Object.values(documentProblems({ title, kind }))[0]

  if (problem !== undefined) {
    return problem
  }

  const prepared = await prepareVersion(client, file, optionsOf(filing))

  if ('problem' in prepared) {
    return prepared.problem
  }

  const made = await client.create(attachmentEntity, {
    ...operatorDocuments.homesOf(place),
    title,
    ...(kind === null ? {} : { kind }),
  })

  if (made.outcome === 'refused') {
    return refusalFor(made)
  }

  const version = await client.create(attachmentVersionEntity, {
    attachmentId: made.id,
    ...prepared,
  })

  return version.outcome === 'refused' ? refusalFor(version) : null
}

/** A new version of a document, laid over the ones before it. */
export function fileVersion(
  client: SyncClient,
  documentId: string,
  file: File,
  filing: Pick<DocumentFiling, 'keepOriginal' | 'shrink'> = {},
): Promise<string | null> {
  return addVersion(client, documentId, file, optionsOf(filing))
}

/** What a document is called where it has no kind: a picture is a photo. */
export const documentWords = {
  photo: 'Foto',
  noKind: 'Ohne Art',
  onItsWay: 'Die Datei ist noch unterwegs.',
  notSentYet: 'noch nicht übertragen',
} as const

/** Whether a version is still on this device alone, waiting for a network. */
export function isWaiting(client: SyncClient, version: RecordState): boolean {
  return client.isPending(attachmentVersionEntity, String(version['id']))
}

/**
 * The day a version was filed, or that it has not gone up yet. The day and
 * never the time of day: the moment of somebody's work is shown by no screen
 * but the change log (section 9 of the concept).
 */
export function filedOn(client: SyncClient, version: RecordState): string {
  return isWaiting(client, version)
    ? documentWords.notSentYet
    : date(maybeText(version, 'createdAt'))
}

/**
 * The line under the name of a document: its file, the size, which version
 * it is where there is more than one, and the day it was filed.
 */
export function versionWords(client: SyncClient, version: RecordState, versions: number): string {
  return [
    text(version, 'fileName'),
    fileSize(count(version, 'sizeBytes')),
    versions > 1 ? `Fassung ${String(versions)}` : null,
    filedOn(client, version),
  ]
    .filter((part) => part !== null && part !== '')
    .join(', ')
}

/**
 * The kind of a document as a list says it: its kind, or "Foto" for a picture
 * without one, which is what a photo of a type plate is.
 */
export function kindWordsOf(document: RecordState, newest: RecordState | undefined): string {
  const kind = maybeText(document, 'kind')

  if (kind !== null && Object.hasOwn(documentKindLabel, kind)) {
    return documentKindLabel[kind as DocumentKind]
  }

  return newest !== undefined && isPicture(text(newest, 'mediaType'))
    ? documentWords.photo
    : documentWords.noKind
}

/** What a kind of place a document can hang on is called. */
export const documentHomeLabel: Readonly<Record<DocumentHome, string>> = {
  propertyId: 'Liegenschaft',
  buildingId: 'Gebäude',
  roomId: 'Raum',
  assetId: 'Anlage',
  activityId: 'Vorgang',
}

/** The records a device holds that a document may name. */
export interface DocumentSurroundings {
  readonly properties: readonly RecordState[]
  readonly buildings: readonly RecordState[]
  readonly rooms: readonly RecordState[]
  readonly assets: readonly RecordState[]
  readonly activities: readonly RecordState[]
}

/** What a document hangs on, as a list names it, and the kind of place it is. */
export interface HangsOn {
  readonly home: DocumentHome
  /** The id of the record it hangs on. */
  readonly id: string
  /** "AN-00057 Trinkwassererwärmer", "Gebäude Halle 1, Werkhof Nord". */
  readonly words: string
}

function byId(records: readonly RecordState[], id: unknown): RecordState | null {
  return records.find((record) => record['id'] === id) ?? null
}

/**
 * What a document hangs on, in words: an asset by its number and name, a
 * room, a building and an activity by what they are called with their
 * property behind, the property by its name. A record this device does not
 * hold, an activity of somebody else, is named by its kind alone.
 */
export function hangsOn(document: RecordState, around: DocumentSurroundings): HangsOn {
  const home = documentHomeOf(document)
  const id = String(document[home])
  const property = maybeText(byId(around.properties, document['propertyId']), 'name')
  const within = (words: string | null) =>
    [words ?? documentHomeLabel[home], property].filter(Boolean).join(', ')

  switch (home) {
    case 'assetId': {
      const asset = byId(around.assets, id)

      return {
        home,
        id,
        words: asset
          ? [maybeText(asset, 'number'), text(asset, 'name')].filter(Boolean).join(' ')
          : within(null),
      }
    }

    case 'roomId': {
      const room = byId(around.rooms, id)

      return { home, id, words: within(room ? `Raum ${titleOfRoom(room)}` : null) }
    }

    case 'buildingId': {
      const building = byId(around.buildings, id)

      return {
        home,
        id,
        words: within(building ? `Gebäude ${text(building, 'name')}` : null),
      }
    }

    case 'activityId':
      return { home, id, words: within(maybeText(byId(around.activities, id), 'title')) }

    case 'propertyId':
      return { home, id, words: `Liegenschaft ${property ?? ''}`.trim() }
  }
}

const homes = ['assetId', 'roomId', 'buildingId', 'activityId'] as const

/**
 * The documents filed at one record: those that name it, or for a property
 * alone those of the property that hang on nothing else there.
 */
export function documentsAt(
  documents: readonly RecordState[],
  place: DocumentPlace,
): readonly RecordState[] {
  const home = homes.find((field) => place[field] !== undefined && place[field] !== null)

  return documents.filter((document) =>
    home === undefined
      ? document['propertyId'] === place.propertyId &&
        homes.every((field) => document[field] === null || document[field] === undefined)
      : document[home] === place[home],
  )
}

/**
 * The documents with their versions, the one changed last first: a document
 * counts by its newest version, whose id is minted when it is made, on a
 * device as much as on the server.
 */
export function newestFirst(
  documents: readonly RecordState[],
  versions: ReadonlyMap<string, readonly RecordState[]>,
): readonly RecordState[] {
  const stamp = (document: RecordState) =>
    String(versions.get(String(document['id']))?.[0]?.['id'] ?? document['id'])

  return [...documents].sort((left, right) => stamp(right).localeCompare(stamp(left)))
}
