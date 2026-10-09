import {
  type WorkOrderKind,
  workOrderKinds,
  type WorkOrderListFilter,
  workOrderListPage,
  type WorkOrderListState,
  workOrderListStates,
} from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the work orders live in the office (4.8 of the concept, #117), and how
 * the address of the list carries what it is narrowed by, so that a list
 * somebody narrowed can be handed on and the way back leads to it. The page
 * of an order lives under the list by the id of its activity, and so does a
 * new one, which a defect, a duty or an asset hands what it starts from.
 */

export const workOrderListPlace = { to: '/auftraege', label: 'Aufträge' } as const satisfies Crumb

export const workOrderPlaces = {
  order: (activityId: string) => `/auftraege/${activityId}`,
  new: '/auftraege/neu',
} as const

/** What the address of the list is narrowed by: the state, the kind and the area. */
export interface WorkOrderListAddress extends Omit<WorkOrderListFilter, 'search'> {
  readonly state?: WorkOrderListState
}

/** The word of the address for each filter, German because the address bar is read by a person. */
export const workOrderListWords = {
  state: 'stand',
  kind: 'art',
  areaId: 'bereich',
} as const satisfies Readonly<Record<keyof WorkOrderListAddress, string>>

/** The filters in the order the server reads them, the search last. */
const filterOrder = ['state', 'kind', 'areaId'] as const

/** The name the server knows each filter by. */
const serverNames = {
  state: 'state',
  kind: 'kind',
  areaId: 'area',
} as const satisfies Readonly<Record<keyof WorkOrderListAddress, string>>

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
 * filter: a list that shows what is open says more than an error about a
 * word in the address.
 */
export function workOrderFilterOf(search: Readonly<Record<string, unknown>>): WorkOrderListAddress {
  const state = said(search, workOrderListWords.state)
  const kind = said(search, workOrderListWords.kind)
  const areaId = said(search, workOrderListWords.areaId)

  return {
    ...((workOrderListStates as readonly (string | undefined)[]).includes(state)
      ? { state: state as WorkOrderListState }
      : {}),
    ...((workOrderKinds as readonly (string | undefined)[]).includes(kind)
      ? { kind: kind as WorkOrderKind }
      : {}),
    ...(areaId === undefined ? {} : { areaId }),
  }
}

/** The search of the address for these filters. */
export function workOrderSearch(filter: WorkOrderListAddress): Record<string, string> {
  return Object.fromEntries(
    filterOrder.flatMap((name) => {
      const value = filter[name]

      return value === undefined ? [] : [[workOrderListWords[name], value] as const]
    }),
  )
}

/**
 * What a page of the list is asked of the server with: the filters in the
 * order the server knows them and the search, then where the page begins and
 * how many it holds. `/work-orders?state=waiting&area=…&offset=0&limit=50`.
 * An asset asks for its own orders with `assetId`, which no address names.
 */
export function workOrderListRequest(
  filter: WorkOrderListAddress & { readonly assetId?: string },
  search: string,
  offset: number,
  limit: number = workOrderListPage.size,
): string {
  const query = new URLSearchParams()

  for (const name of filterOrder) {
    const value = filter[name]

    if (value !== undefined) {
      query.set(serverNames[name], value)
    }
  }

  if (filter.assetId !== undefined) {
    query.set('asset', filter.assetId)
  }

  if (search.trim() !== '') {
    query.set('search', search.trim())
  }

  query.set('offset', String(offset))
  query.set('limit', String(limit))

  return `/work-orders?${query.toString()}`
}

/** What a new work order starts from, by the record the way there came from. */
export interface WorkOrderStart {
  readonly defectId?: string
  readonly dutyId?: string
  readonly assetId?: string
}

/** The words of the address for where a new work order starts. */
export const workOrderStartWords = {
  defectId: 'mangel',
  dutyId: 'pflicht',
  assetId: 'anlage',
} as const satisfies Readonly<Record<keyof WorkOrderStart, string>>

/** The search of the address that starts a new work order at a record. */
export function workOrderStartSearch(start: WorkOrderStart): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(workOrderStartWords) as (keyof WorkOrderStart)[]).flatMap((name) => {
      const value = start[name]

      return value === undefined ? [] : [[workOrderStartWords[name], value] as const]
    }),
  )
}

/** Where a new work order starts, as its address says; the first of the three that is named. */
export function workOrderStartOf(search: Readonly<Record<string, unknown>>): WorkOrderStart {
  for (const name of Object.keys(workOrderStartWords) as (keyof WorkOrderStart)[]) {
    const value = said(search, workOrderStartWords[name])

    if (value !== undefined) {
      return { [name]: value }
    }
  }

  return {}
}
