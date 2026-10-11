import {
  type SearchHit as Found,
  type SearchKind,
  searchLimits,
} from '@opengewerk/haustechnik-domain'
import type { SearchSource } from '@opengewerk/platform-web'
import { useRights } from '@opengewerk/platform-web/session'
import { type SyncClient, useSync } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

import {
  foundFor,
  officeOpens,
  searchFor,
  searchKindWords,
  searchRights,
  searchSentences,
} from '../app/search.js'
import { siteForms, sitePlaces } from './places.js'

/** The kind of row on the device a hit is, where the device can hold one. */
const heldAs: Readonly<Partial<Record<SearchKind, string>>> = {
  property: 'properties',
  building: 'buildings',
  room: 'rooms',
  asset: 'assets',
  activity: 'activities',
}

/**
 * Where a hit opens on site: its page here, where the device holds it, so
 * that it stands without a network as well. What the device does not hold,
 * an evidence always, opens in the office with a plain link, and says so.
 */
export function siteHitPlace(
  client: SyncClient,
  hit: Found,
): { readonly to: string; readonly away?: string } {
  const entity = heldAs[hit.kind]

  if (entity === undefined || client.get(entity, hit.id) === null) {
    return { to: officeOpens(hit), away: searchSentences.inTheOffice }
  }

  switch (hit.kind) {
    case 'property':
      return { to: sitePlaces.property(hit.id) }
    case 'building':
      return { to: sitePlaces.building(hit.id) }
    case 'room':
      return { to: sitePlaces.room(hit.id) }
    case 'asset':
      return { to: sitePlaces.asset(hit.id) }
    default:
      return { to: siteForms.form(hit.id) }
  }
}

/**
 * The search on site (#125), the boards "Suche vor Ort": with a network the
 * server is asked and finds in the own areas also what the device does not
 * hold; without one the device searches what it holds (decision 24 of phase
 * 1). The sentence under the hits says which it was.
 */
export function useSiteSearch(): SearchSource {
  const client = useSync()
  const rights = useRights()

  return useMemo(() => {
    const may = (kind: SearchKind) => rights.includes(searchRights[kind])

    return {
      key: 'site',
      placeholder: 'Raum, Anlage, Auftrag, Nummer …',
      about: searchSentences.about,
      shortest: searchLimits.shortest,
      kinds: searchKindWords,
      find: async (words, signal) => {
        const searched = await searchFor(client, words, may, signal)

        return foundFor(
          searched,
          (hit) => siteHitPlace(client, hit),
          searched.onDevice ? searchSentences.siteOnDevice : searchSentences.siteOnServer,
        )
      },
    }
  }, [client, rights])
}
