/**
 * Documents for the road (#348, section 2.7 of the concept): a device keeps
 * the files of the documents at an asset or a room somebody marked, so that
 * they open without a network. Documents do not lie on a device by
 * themselves; what does, a device decides here, from the records it holds.
 */

/** What can be marked for the road: an asset and a room (decided on 15.10.2026). */
export const travelPlaceKinds = ['asset', 'room'] as const

export type TravelPlaceKind = (typeof travelPlaceKinds)[number]

export interface TravelPlace {
  readonly kind: TravelPlaceKind
  readonly id: string
}

/**
 * What a device keeps for the road: the places marked, and the files it
 * fetched for them, by their hash. Only those it may let go again: a file
 * made on the device, or fetched for anything else, is none of them.
 */
export interface TravelKeep {
  readonly places: readonly TravelPlace[]
  readonly files: readonly string[]
}

export const noTravel: TravelKeep = { places: [], files: [] }

function isPlace(value: unknown): value is TravelPlace {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const { kind, id } = value as Record<string, unknown>

  return (travelPlaceKinds as readonly unknown[]).includes(kind) && typeof id === 'string'
}

/** What a device stored, read back; anything it cannot read is nothing kept. */
export function readTravel(stored: string | null): TravelKeep {
  if (stored === null || stored === '') {
    return noTravel
  }

  try {
    const value = JSON.parse(stored) as Record<string, unknown>
    const places = Array.isArray(value['places']) ? value['places'].filter(isPlace) : []
    const files = Array.isArray(value['files'])
      ? value['files'].filter((file): file is string => typeof file === 'string')
      : []

    return {
      places: places.map(({ kind, id }) => ({ kind, id })),
      files: [...new Set(files)],
    }
  } catch {
    return noTravel
  }
}

export function writeTravel(keep: TravelKeep): string {
  return JSON.stringify({ places: keep.places, files: keep.files })
}

export function samePlace(left: TravelPlace, right: TravelPlace): boolean {
  return left.kind === right.kind && left.id === right.id
}

export function keepsPlace(keep: TravelKeep, place: TravelPlace): boolean {
  return keep.places.some((each) => samePlace(each, place))
}

/** The keep with one more place, at the end; one marked already stays where it is. */
export function withPlace(keep: TravelKeep, place: TravelPlace): TravelKeep {
  return keepsPlace(keep, place)
    ? keep
    : { ...keep, places: [...keep.places, { kind: place.kind, id: place.id }] }
}

/** The keep without a place. Its files go with the next round of `travelChanges`. */
export function withoutPlace(keep: TravelKeep, place: TravelPlace): TravelKeep {
  return { ...keep, places: keep.places.filter((each) => !samePlace(each, place)) }
}

/** A document as the question needs it: where it hangs, and the newest version of it. */
export interface TravelDocument {
  readonly assetId: string | null
  readonly roomId: string | null
  readonly newest: {
    readonly id: string
    readonly sha256: string
    readonly sizeBytes: number
  } | null
}

/** A file a place wants on the device: the newest version of a document that hangs on it. */
export interface TravelFile {
  readonly place: TravelPlace
  readonly versionId: string
  readonly sha256: string
  readonly sizeBytes: number
}

/**
 * The files the marked places want, in the order of the places: the newest
 * version of every document that hangs on the place itself. A document at
 * an asset in a room belongs to the asset, which is marked on its own; one
 * without a version yet wants nothing. The documents are those the device
 * holds: one removed or out of the areas of the person is not among them.
 */
export function travelFiles(
  places: readonly TravelPlace[],
  documents: readonly TravelDocument[],
): TravelFile[] {
  return places.flatMap((place) =>
    documents.flatMap((document) => {
      const at = place.kind === 'asset' ? document.assetId : document.roomId

      return at === place.id && document.newest !== null
        ? [
            {
              place,
              versionId: document.newest.id,
              sha256: document.newest.sha256,
              sizeBytes: document.newest.sizeBytes,
            },
          ]
        : []
    }),
  )
}

/**
 * What a device does for the road: fetch each wanted file it does not hold,
 * once even where two places want it, and let go of each file it fetched for
 * the road that no place wants any more. A new version wants its own file,
 * and the one before goes; so does the file of a document that is removed
 * or no longer in the areas of the person.
 */
export function travelChanges(
  keep: TravelKeep,
  wanted: readonly TravelFile[],
  held: ReadonlySet<string>,
): { readonly fetch: readonly TravelFile[]; readonly forget: readonly string[] } {
  const wantedHashes = new Set(wanted.map((file) => file.sha256))
  const fetch = new Map<string, TravelFile>()

  for (const file of wanted) {
    if (!held.has(file.sha256) && !fetch.has(file.sha256)) {
      fetch.set(file.sha256, file)
    }
  }

  return {
    fetch: [...fetch.values()],
    forget: keep.files.filter((sha256) => !wantedHashes.has(sha256)),
  }
}

/** How many files a place wants and how much they take, each file counted once. */
export function travelSize(files: readonly TravelFile[]): { files: number; bytes: number } {
  const unique = new Map(files.map((file) => [file.sha256, file.sizeBytes]))

  return { files: unique.size, bytes: [...unique.values()].reduce((sum, size) => sum + size, 0) }
}
