import { type Catalogue, type CatalogueBundle, catalogueOf } from '@opengewerk/haustechnik-domain'
import { request, useSync } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

/**
 * The catalogue on a device (section 2.7 of the concept: a technician holds
 * "die Formulare und Pakete"; ADR 0005 with its addendum on #90).
 *
 * A device computes with the entries its server computes with. It fetches the
 * catalogue of the server once, keeps it in the local store of the tenant,
 * where it survives a cellar without a network, and asks for the checksum
 * from then on: only a server with another catalogue is asked for the whole
 * of it again. Nothing of the catalogue is part of the interface itself, so
 * neither entry grows with the packages.
 *
 * What the device keeps is the bundle as the server sent it. It never
 * travels back, and it goes with the local store when somebody signs out.
 */

/** The name the device keeps the catalogue of its server under. */
export const catalogueKeep = 'catalogue'

/**
 * The name the device notes under that it fetched a catalogue this build
 * cannot read (#160): its checksum, until a catalogue it can read is kept.
 */
export const unreadableCatalogueKeep = 'catalogue-unreadable'

/** What a screen says where there is no catalogue to ask. */
export const catalogueAbsenceWords = {
  notYet:
    'Der Katalog ist noch nicht auf diesem Gerät. Er kommt mit der nächsten Verbindung zum Server.',
  update:
    'Der Katalog des Servers ist in einem Format, das diese Fassung der Anwendung nicht lesen kann. Er kommt, sobald die neue Fassung übernommen ist.',
} as const

/** Which catalogue the server computes with, by its checksum. */
export const catalogueChecksumQuery = {
  queryKey: ['catalogue', 'checksum'],
  queryFn: () => request<{ readonly sha256: string }>('/catalogue/checksum'),
} as const

let lastRead: { readonly stored: string; readonly catalogue: Catalogue | null } | null = null

/**
 * The catalogue a device kept, to ask. Nothing where it kept none, and
 * nothing where it kept one this build cannot read, written by a build with
 * another format: the next exchange with the server replaces it.
 *
 * Read once for the same text, so that every screen asks the same catalogue.
 */
export function keptCatalogue(stored: string | null): Catalogue | null {
  if (stored === null || stored === '') {
    return null
  }

  if (lastRead?.stored !== stored) {
    lastRead = { stored, catalogue: readable(stored) }
  }

  return lastRead.catalogue
}

function readable(stored: string): Catalogue | null {
  try {
    return catalogueOf(JSON.parse(stored) as CatalogueBundle)
  } catch {
    return null
  }
}

/** The catalogue this device holds, or nothing until it has fetched one. */
export function useCatalogue(): Catalogue | null {
  const client = useSync()
  const read = useCallback(() => client.kept(catalogueKeep), [client])
  const stored = useSyncExternalStore(client.subscribe, read, read)

  return useMemo(() => keptCatalogue(stored), [stored])
}

/**
 * Why a device has no catalogue to ask (#160), the sentence a screen says
 * then, or nothing while it holds one: not fetched yet, which the next
 * exchange with the server mends, or fetched in a format this build cannot
 * read, which only a new version of the interface mends.
 */
export function useCatalogueAbsence(): string | null {
  const client = useSync()
  const read = useCallback(() => client.kept(unreadableCatalogueKeep), [client])
  const unreadable = useSyncExternalStore(client.subscribe, read, read)
  const catalogue = useCatalogue()

  if (catalogue !== null) {
    return null
  }

  return unreadable === null || unreadable === ''
    ? catalogueAbsenceWords.notYet
    : catalogueAbsenceWords.update
}

/**
 * Has this device hold the catalogue of its server. Called once by the frame
 * of each entry.
 *
 * The checksum is asked like every question of a screen: when the entry
 * opens, when the connection comes back and when somebody returns to the
 * page. A device that holds the catalogue the server names fetches nothing.
 * One that holds another fetches the whole, and keeps it only if this build
 * can read it: a bundle in another format does not take the place of one the
 * screens can ask.
 */
export function useKeepCatalogue(): void {
  const client = useSync()
  const held = useCatalogue()?.sha256
  const wanted = useQuery(catalogueChecksumQuery).data?.sha256
  const fetched = useQuery({
    queryKey: ['catalogue', 'whole', wanted],
    queryFn: () => request<CatalogueBundle>('/catalogue'),
    enabled: wanted !== undefined && wanted !== held,
    // The same checksum is the same catalogue, however long ago it was fetched.
    staleTime: Infinity,
  }).data

  useEffect(() => {
    if (fetched === undefined || fetched.sha256 === held) {
      return
    }

    const stored = JSON.stringify(fetched)

    // One this build cannot read leaves the one it holds standing; where it
    // holds none, the screens say that a new version is what brings one.
    if (readable(stored) !== null) {
      void client.keep(catalogueKeep, stored)
      void client.keep(unreadableCatalogueKeep, null)
    } else {
      void client.keep(unreadableCatalogueKeep, fetched.sha256)
    }
  }, [client, fetched, held])
}
