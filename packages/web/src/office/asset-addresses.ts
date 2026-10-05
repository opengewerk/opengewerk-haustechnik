import {
  type AssetCondition,
  assetConditions,
  type AssetRegisterFilter,
  assetRegisterFilters,
  assetRegisterPage,
  type LifecycleState,
  lifecycleStates,
  withoutLifecycle,
} from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the register of assets lives in the office, and how its address
 * carries what it is narrowed by (4.2 of the concept): a filter is part of the
 * address, so that a list somebody narrowed can be handed on, the way back
 * leads to it, and the page of a building links to its own assets.
 *
 * The file of an asset lives under the register by its id
 * (`officePlaces.asset`).
 */

export const assetRegisterPlace = { to: '/anlagen', label: 'Anlagen' } as const satisfies Crumb

/**
 * The word of the address for each filter. German, because the address bar is
 * something a person reads; what follows the word is the key the data model
 * has for it, the id of a place, the cost group, the key of a kind.
 */
export const registerWords = {
  propertyId: 'liegenschaft',
  buildingId: 'gebaeude',
  costGroup: 'kostengruppe',
  kind: 'art',
  condition: 'zustand',
  lifecycle: 'lebenszyklus',
} as const satisfies Readonly<Record<keyof AssetRegisterFilter, string>>

/** What an address says after a word, as text: the router reads "461" as a number. */
function said(search: Readonly<Record<string, unknown>>, word: string): string | undefined {
  const value = search[word]

  if (typeof value === 'number') {
    return String(value)
  }

  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The filters an address names. A condition or a state of the life cycle
 * there is none of is no filter: the server would refuse it, and a list that
 * shows everything says more than an error about a word in the address.
 */
export function registerFilterOf(search: Readonly<Record<string, unknown>>): AssetRegisterFilter {
  const condition = said(search, registerWords.condition)
  const lifecycle = said(search, registerWords.lifecycle)
  const plain = (['propertyId', 'buildingId', 'costGroup', 'kind'] as const).flatMap((name) => {
    const value = said(search, registerWords[name])

    return value === undefined ? [] : [[name, value] as const]
  })

  return {
    ...Object.fromEntries(plain),
    ...((assetConditions as readonly (string | undefined)[]).includes(condition)
      ? { condition: condition as AssetCondition }
      : {}),
    ...(lifecycle === withoutLifecycle ||
    (lifecycleStates as readonly (string | undefined)[]).includes(lifecycle)
      ? { lifecycle: lifecycle as LifecycleState | typeof withoutLifecycle }
      : {}),
  }
}

/**
 * The search of the address for these filters. A cost group goes as the
 * number it is: the router would put a text of digits in quotation marks.
 */
export function registerSearch(filter: AssetRegisterFilter): Record<string, string | number> {
  return Object.fromEntries(
    assetRegisterFilters.flatMap((name) => {
      const value = filter[name]

      if (value === undefined) {
        return []
      }

      return [[registerWords[name], /^\d+$/.test(value) ? Number(value) : value] as const]
    }),
  )
}

/**
 * What a page of the register is asked of the server with: the filters in
 * the order the server knows them, then where the page begins and how many
 * it holds.
 */
export function registerRequest(
  filter: AssetRegisterFilter,
  offset: number,
  limit: number = assetRegisterPage.size,
): string {
  const query = new URLSearchParams()

  for (const name of assetRegisterFilters) {
    const value = filter[name]

    if (value !== undefined) {
      query.set(name, value)
    }
  }

  query.set('offset', String(offset))
  query.set('limit', String(limit))

  return `/assets?${query.toString()}`
}
