import {
  type DefectRegisterFilter,
  defectRegisterPage,
  type DefectRegisterState,
  defectRegisterStates,
  type DefectSummary,
} from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Where the defects live in the office (4.6 of the concept, #116), and how the
 * address of the list carries what it is narrowed by, so that a list somebody
 * narrowed can be handed on and the way back leads to it. The page of a
 * defect lives under the list by its id, and so does reporting one by hand,
 * which an asset, a room, a building or a property hands its place to.
 */

export const defectListPlace = { to: '/maengel', label: 'Mängel' } as const satisfies Crumb

/** How many defects are open and over their deadline, for the number beside the navigation. */
export const defectSummaryQuery = {
  queryKey: ['defects', 'summary'],
  queryFn: () => request<DefectSummary>('/defects/summary'),
} as const

/** What reporting a defect by hand starts at, by the record the way there came from. */
export interface DefectStart {
  readonly assetId?: string
  readonly roomId?: string
  readonly buildingId?: string
  readonly propertyId?: string
}

export const defectPlaces = {
  defect: (id: string) => `/maengel/${id}`,
  report: '/maengel/neu',
} as const

/** The words of the address for where a defect by hand starts. */
export const defectStartWords = {
  assetId: 'anlage',
  roomId: 'raum',
  buildingId: 'gebaeude',
  propertyId: 'liegenschaft',
} as const satisfies Readonly<Record<keyof DefectStart, string>>

/** The search of the address that starts a defect by hand at a record. */
export function defectStartSearch(start: DefectStart): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(defectStartWords) as (keyof DefectStart)[]).flatMap((name) => {
      const value = start[name]

      return value === undefined ? [] : [[defectStartWords[name], value] as const]
    }),
  )
}

/** Where a defect by hand starts, as its address says; the first of the four that is named. */
export function defectStartOf(search: Readonly<Record<string, unknown>>): DefectStart {
  for (const name of Object.keys(defectStartWords) as (keyof DefectStart)[]) {
    const value = said(search, defectStartWords[name])

    if (value !== undefined) {
      return { [name]: value }
    }
  }

  return {}
}

/**
 * What the address of the list is narrowed by: the list, the property, the
 * area, the building the Lagebild leads in with (#121) and the class.
 */
export type DefectListAddress = Pick<
  DefectRegisterFilter,
  'state' | 'propertyId' | 'areaId' | 'buildingId' | 'defectClass'
>

/**
 * The word of the address for each filter, German because the address bar is
 * something a person reads; after it the key the data model has.
 */
export const defectListWords = {
  state: 'liste',
  propertyId: 'liegenschaft',
  areaId: 'bereich',
  buildingId: 'gebaeude',
  defectClass: 'klasse',
} as const satisfies Readonly<Record<keyof DefectListAddress, string>>

/** The filters of the address in the order the server reads them. */
const filterOrder = ['state', 'propertyId', 'areaId', 'buildingId', 'defectClass'] as const

/** What an address says after a word, as text: the router reads digits as a number. */
function said(search: Readonly<Record<string, unknown>>, word: string): string | undefined {
  const value = search[word]

  if (typeof value === 'number') {
    return String(value)
  }

  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * The filters an address names. A list there is none of is no filter: the
 * server would refuse it, and a list that shows what is open says more than
 * an error about a word in the address.
 */
export function defectFilterOf(search: Readonly<Record<string, unknown>>): DefectListAddress {
  const state = said(search, defectListWords.state)
  const propertyId = said(search, defectListWords.propertyId)
  const areaId = said(search, defectListWords.areaId)
  const buildingId = said(search, defectListWords.buildingId)
  const defectClass = said(search, defectListWords.defectClass)

  return {
    ...((defectRegisterStates as readonly (string | undefined)[]).includes(state)
      ? { state: state as DefectRegisterState }
      : {}),
    ...(propertyId === undefined ? {} : { propertyId }),
    ...(areaId === undefined ? {} : { areaId }),
    ...(buildingId === undefined ? {} : { buildingId }),
    ...(defectClass === undefined ? {} : { defectClass }),
  }
}

/** The search of the address for these filters. */
export function defectSearch(filter: DefectListAddress): Record<string, string> {
  return Object.fromEntries(
    filterOrder.flatMap((name) => {
      const value = filter[name]

      return value === undefined ? [] : [[defectListWords[name], value] as const]
    }),
  )
}

/**
 * What a page of the register is asked of the server with: the filters in
 * the order the server knows them, then where the page begins and how many
 * it holds. `/defects?state=overdue&propertyId=…&offset=50&limit=50`.
 */
export function defectRegisterRequest(
  filter: DefectRegisterFilter,
  offset: number,
  limit: number = defectRegisterPage.size,
): string {
  const query = new URLSearchParams()

  for (const name of [
    'state',
    'propertyId',
    'areaId',
    'buildingId',
    'roomId',
    'assetId',
    'defectClass',
  ] as const) {
    const value = filter[name]

    if (value !== undefined) {
      query.set(name, value)
    }
  }

  if (offset > 0) {
    query.set('offset', String(offset))
  }

  if (limit !== defectRegisterPage.size) {
    query.set('limit', String(limit))
  }

  const asked = query.toString()

  return asked === '' ? '/defects' : `/defects?${asked}`
}
