import {
  readTravel,
  type RecordState,
  type TravelDocument,
  travelChanges,
  travelFiles,
  type TravelKeep,
  type TravelPlace,
  withoutPlace,
  withPlace,
  writeTravel,
} from '@opengewerk/haustechnik-domain'
import {
  holdVersion,
  useVersions,
  versionsByAttachment,
} from '@opengewerk/platform-web/attachments'
import { maybeText, useRecords, useSync } from '@opengewerk/platform-web/sync'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import type { SyncClient } from './client.js'

/**
 * Documents for the road (#348, 2.7 of the concept): which places this
 * device keeps the files of, and which files it fetched for them. Kept in the
 * local store of the tenant like the catalogue, so it goes with the store
 * when somebody signs out, the files with it. A device holds one person's
 * session at a time, and signing out takes the store, so the list needs no
 * owner.
 */
export const travelKeep = 'travel'

/** The documents a device holds, as the question of the road needs them. */
export function travelDocumentsOf(
  documents: readonly RecordState[],
  versions: ReadonlyMap<string, readonly RecordState[]>,
): TravelDocument[] {
  return documents.map((document) => {
    const newest = versions.get(String(document['id']))?.[0]

    return {
      assetId: maybeText(document, 'assetId') ?? null,
      roomId: maybeText(document, 'roomId') ?? null,
      newest:
        newest === undefined
          ? null
          : {
              id: String(newest['id']),
              sha256: String(newest['sha256']),
              sizeBytes: Number(newest['sizeBytes'] ?? 0),
            },
    }
  })
}

/**
 * One round of the road: what the marked places want is fetched where the
 * device does not hold it, and what was fetched for them and no place wants
 * any more goes. Read from the client at the moment it runs, so a round that
 * follows an exchange works on what the exchange brought. Without a network
 * nothing is fetched, and the next round tries again.
 *
 * A file made on the device that still waits for its upload is not let go;
 * it stays on the list, and a later round lets it go once it is up.
 */
export async function keepForTheRoad(client: SyncClient): Promise<void> {
  const before = readTravel(client.kept(travelKeep))
  const wanted = travelFiles(
    before.places,
    travelDocumentsOf(
      client.list('attachments'),
      versionsByAttachment(client.list('attachment_versions')),
    ),
  )
  const held = new Set<string>()

  for (const sha256 of new Set(wanted.map((file) => file.sha256))) {
    if (await client.readFile(sha256)) {
      held.add(sha256)
    }
  }

  const { fetch, forget } = travelChanges(before, wanted, held)

  for (const file of fetch) {
    const version = client.get('attachment_versions', file.versionId)

    if (version !== null && (await holdVersion(client, version))) {
      held.add(file.sha256)
    }
  }

  const staying: string[] = []

  for (const sha256 of forget) {
    if (!(await client.forgetFile(sha256)) && (await client.readFile(sha256))) {
      staying.push(sha256)
    }
  }

  // Against the places as they are now: one marked during the round has its
  // files with the next, one forgotten lets go of them then.
  const now = readTravel(client.kept(travelKeep))
  const next: TravelKeep = {
    places: now.places,
    files: [
      ...new Set([
        ...wanted.map((file) => file.sha256).filter((sha256) => held.has(sha256)),
        ...staying,
      ]),
    ],
  }

  if (writeTravel(next) !== writeTravel(now)) {
    await client.keep(travelKeep, writeTravel(next))
  }
}

/** What this device keeps for the road, as a screen subscribes to it. */
export function useTravelKeep(): TravelKeep {
  const client = useSync()
  const read = useCallback(() => client.kept(travelKeep), [client])
  const stored = useSyncExternalStore(client.subscribe, read, read)

  return useMemo(() => readTravel(stored), [stored])
}

/** The documents this device holds, as the road reads them. */
export function useTravelDocuments(): TravelDocument[] {
  const documents = useRecords('attachments')
  const versions = useVersions()

  return useMemo(() => travelDocumentsOf(documents, versions), [documents, versions])
}

/** Marks a place for the road, or forgets it; the files follow with the round after. */
export async function markForTheRoad(
  client: SyncClient,
  place: TravelPlace,
  marked: boolean,
): Promise<void> {
  const keep = readTravel(client.kept(travelKeep))

  await client.keep(
    travelKeep,
    writeTravel(marked ? withPlace(keep, place) : withoutPlace(keep, place)),
  )
}

/**
 * Has this device keep the files of the marked places: a round whenever the
 * places change and whenever an exchange brings documents or versions, one
 * at a time. Called once by the frame on site.
 */
export function useKeepForTheRoad(): void {
  const client = useSync()
  const keep = useTravelKeep()
  const documents = useRecords('attachments')
  const versions = useRecords('attachment_versions')
  const running = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    if (running.current) {
      again.current = true

      return
    }

    running.current = true

    void (async () => {
      try {
        do {
          again.current = false
          await keepForTheRoad(client)
        } while (again.current)
      } finally {
        running.current = false
      }
    })()
  }, [client, keep, documents, versions])
}
