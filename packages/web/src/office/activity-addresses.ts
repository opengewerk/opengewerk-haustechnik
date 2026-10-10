import {
  type ActivityListFilter,
  activityListPage,
  type ActivityListState,
  activityListStates,
  type DueActivityKind,
  dueActivityKinds,
} from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the inspections and the maintenance live in the office (4.4 of the
 * concept, #105), and how the address of the list carries what it is
 * narrowed by, so that a list somebody narrowed can be handed on and the way
 * back leads to it. The page of an activity lives under the list by its id.
 */

export const activityListPlace = { to: '/pruefungen', label: 'Prüfungen' } as const satisfies Crumb

export const activityPlaces = {
  activity: (id: string) => `/pruefungen/${id}`,
} as const

/**
 * What the address of the list is narrowed by: the state, the kind, the
 * property and the area. The search is typed into the list and stays there,
 * as in the list "Fristen".
 */
export interface ActivityListAddress extends Omit<ActivityListFilter, 'search'> {
  readonly state?: ActivityListState
}

/**
 * The word of the address for each filter, German because the address bar is
 * something a person reads; after it the key the data model has.
 */
export const activityListWords = {
  state: 'stand',
  kind: 'art',
  propertyId: 'liegenschaft',
  areaId: 'bereich',
} as const satisfies Readonly<Record<keyof ActivityListAddress, string>>

/** The filters of the address in the order the server reads them, the search last. */
const filterOrder = ['state', 'kind', 'propertyId', 'areaId'] as const

/** The name the server knows each filter by. */
const serverNames = {
  state: 'state',
  kind: 'kind',
  propertyId: 'property',
  areaId: 'area',
} as const satisfies Readonly<Record<keyof ActivityListAddress, string>>

/** What an address says after a word, as text: the router reads digits as a number. */
function said(search: Readonly<Record<string, unknown>>, word: string): string | undefined {
  const value = search[word]

  if (typeof value === 'number') {
    return String(value)
  }

  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * The filters an address names. A state or a kind there is none of is no
 * filter: the server would refuse it, and a list that shows what is open
 * says more than an error about a word in the address.
 */
export function activityFilterOf(search: Readonly<Record<string, unknown>>): ActivityListAddress {
  const state = said(search, activityListWords.state)
  const kind = said(search, activityListWords.kind)
  const propertyId = said(search, activityListWords.propertyId)
  const areaId = said(search, activityListWords.areaId)

  return {
    ...((activityListStates as readonly (string | undefined)[]).includes(state)
      ? { state: state as ActivityListState }
      : {}),
    ...((dueActivityKinds as readonly (string | undefined)[]).includes(kind)
      ? { kind: kind as DueActivityKind }
      : {}),
    ...(propertyId === undefined ? {} : { propertyId }),
    ...(areaId === undefined ? {} : { areaId }),
  }
}

/** The search of the address for these filters. */
export function activitySearch(filter: ActivityListAddress): Record<string, string> {
  return Object.fromEntries(
    filterOrder.flatMap((name) => {
      const value = filter[name]

      return value === undefined ? [] : [[activityListWords[name], value] as const]
    }),
  )
}

/**
 * What a page of the list is asked of the server with: the filters in the
 * order the server knows them and the search, then where the page begins and
 * how many it holds. `/activities?state=done&kind=maintenance&offset=50&limit=50`.
 */
export function activityListRequest(
  filter: ActivityListAddress,
  search: string,
  offset: number,
  limit: number = activityListPage.size,
): string {
  const query = new URLSearchParams()

  for (const name of filterOrder) {
    const value = filter[name]

    if (value !== undefined) {
      query.set(serverNames[name], value)
    }
  }

  if (search.trim() !== '') {
    query.set('search', search.trim())
  }

  query.set('offset', String(offset))
  query.set('limit', String(limit))

  return `/activities?${query.toString()}`
}
