import {
  type DutyRegisterFilter,
  dutyRegisterFilters,
  dutyRegisterPage,
  type DutyRegisterState,
  dutyRegisterStates,
} from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the register of duties lives in the office, and how its address
 * carries what it is narrowed by (4.3 of the concept): a filter is part of the
 * address, so that a list somebody narrowed can be handed on, the way back
 * leads to it, and the catalogue links to the duties of a duty kind.
 *
 * The page of a duty lives under the register by its id.
 */

export const dutyRegisterPlace = {
  to: '/pflichten',
  label: 'Pflichtenverzeichnis',
} as const satisfies Crumb

export const dutyPlaces = {
  duty: (id: string) => `/pflichten/${id}`,
} as const

/**
 * The word of the address for each filter. German, because the address bar is
 * something a person reads; what follows the word is the key the data model
 * has for it: a state, the id of a place, the key of a kind, the id of an
 * account.
 */
export const dutyRegisterWords = {
  state: 'zustand',
  propertyId: 'liegenschaft',
  buildingId: 'gebaeude',
  assetKind: 'art',
  dutyKind: 'pflichtart',
  responsible: 'verantwortlich',
} as const satisfies Readonly<Record<keyof DutyRegisterFilter, string>>

/** What an address says after a word, as text: the router reads digits as a number. */
function said(search: Readonly<Record<string, unknown>>, word: string): string | undefined {
  const value = search[word]

  if (typeof value === 'number') {
    return String(value)
  }

  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The filters an address names. A state there is none of is no filter: the
 * server would refuse it, and a list that shows everything says more than an
 * error about a word in the address.
 */
export function dutyFilterOf(search: Readonly<Record<string, unknown>>): DutyRegisterFilter {
  const state = said(search, dutyRegisterWords.state)
  const plain = (
    ['propertyId', 'buildingId', 'assetKind', 'dutyKind', 'responsible'] as const
  ).flatMap((name) => {
    const value = said(search, dutyRegisterWords[name])

    return value === undefined ? [] : [[name, value] as const]
  })

  return {
    ...((dutyRegisterStates as readonly (string | undefined)[]).includes(state)
      ? { state: state as DutyRegisterState }
      : {}),
    ...Object.fromEntries(plain),
  }
}

/** The search of the address for these filters, in the order the server reads them. */
export function dutySearch(filter: DutyRegisterFilter): Record<string, string> {
  return Object.fromEntries(
    dutyRegisterFilters.flatMap((name) => {
      const value = filter[name]

      return value === undefined ? [] : [[dutyRegisterWords[name], value] as const]
    }),
  )
}

/**
 * What a page of the register is asked of the server with: the filters in
 * the order the server knows them, then where the page begins and how many
 * it holds.
 */
export function dutyRegisterRequest(
  filter: DutyRegisterFilter,
  offset: number,
  limit: number = dutyRegisterPage.size,
): string {
  const query = new URLSearchParams()

  for (const name of dutyRegisterFilters) {
    const value = filter[name]

    if (value !== undefined) {
      query.set(name, value)
    }
  }

  query.set('offset', String(offset))
  query.set('limit', String(limit))

  return `/duties/register?${query.toString()}`
}
