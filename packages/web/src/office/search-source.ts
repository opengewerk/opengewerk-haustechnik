import {
  type SearchHit as Found,
  type SearchKind,
  searchLimits,
} from '@opengewerk/haustechnik-domain'
import type { SearchSource } from '@opengewerk/platform-web'
import { useRights } from '@opengewerk/platform-web/session'
import { useSync } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

import {
  foundFor,
  searchFor,
  searchKindWords,
  searchRights,
  searchSentences,
} from '../app/search.js'
import { activityPlaces } from './activity-addresses.js'
import { evidencePlaces } from './duty-addresses.js'
import { officePlaces } from './place-addresses.js'
import { roundPlaces } from './round-template-addresses.js'
import { workOrderPlaces } from './work-order-addresses.js'

/** Where a hit opens in the office: the page of what it is. */
export function officeHitPlace(hit: Found): string {
  switch (hit.kind) {
    case 'property':
      return officePlaces.property(hit.id)
    case 'building':
      return officePlaces.building(hit.id)
    case 'room':
      return officePlaces.room(hit.id)
    case 'asset':
      return officePlaces.asset(hit.id)
    case 'activity':
      return hit.activityKind === 'round'
        ? roundPlaces.round(hit.id)
        : hit.activityKind === 'work_order'
          ? workOrderPlaces.order(hit.id)
          : activityPlaces.activity(hit.id)
    case 'evidence':
      return evidencePlaces.evidence(hit.id)
  }
}

/**
 * The search of the office (#125), the field in the header the foundation
 * draws (`OfficeFrame`): the server with a network, the device without one,
 * which the foot of the hits then says. A kind only for whoever may read it.
 */
export function useOfficeSearch(): SearchSource {
  const client = useSync()
  const rights = useRights()

  return useMemo(() => {
    const may = (kind: SearchKind) => rights.includes(searchRights[kind])

    return {
      key: 'office',
      placeholder: 'Liegenschaft, Anlage, Nummer …',
      about: searchSentences.about,
      shortest: searchLimits.shortest,
      kinds: searchKindWords,
      find: async (words, signal) => {
        const searched = await searchFor(client, words, may, signal)

        return foundFor(
          searched,
          (hit) => ({ to: officeHitPlace(hit) }),
          searched.onDevice ? searchSentences.officeOnDevice : null,
        )
      },
    }
  }, [client, rights])
}
