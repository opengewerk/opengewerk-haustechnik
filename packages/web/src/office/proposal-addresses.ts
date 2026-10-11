import { type DutyProposalFilter, dutyProposalFilters } from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the proposals of the catalogue live in the office (#102, 4.3 of the
 * concept), under the register of duties: the list grouped by duty kind, the
 * proposals dismissed beside it, and the form that confirms one. What the
 * list is narrowed to stands in the address, so that the file of an asset and
 * the page of a duty kind lead to their own proposals.
 */

export const proposalPlace = {
  to: '/pflichten/vorschlaege',
  label: 'Vorschläge',
} as const satisfies Crumb

export const proposalPlaces = {
  dismissed: '/pflichten/vorschlaege/verworfen',
  /** The form of one proposal, by its asset and its duty kind: before the page of a duty, as "bestaetigen" is no id. */
  confirm: '/pflichten/bestaetigen',
} as const

/** What the proposals are narrowed to: what the route narrows to, and the package of a kind. */
export interface ProposalFilter extends DutyProposalFilter {
  readonly package?: string
}

/** The word of the address for each part, German as the address bar is read. */
export const proposalWords = {
  assetId: 'anlage',
  propertyId: 'liegenschaft',
  dutyKind: 'pflichtart',
  package: 'paket',
} as const satisfies Readonly<Record<keyof ProposalFilter, string>>

const proposalParts = ['assetId', 'propertyId', 'dutyKind', 'package'] as const

/** What an address says after a word, as text. */
function said(search: Readonly<Record<string, unknown>>, word: string): string | undefined {
  const value = search[word]

  if (typeof value === 'number') {
    return String(value)
  }

  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The filter an address names. */
export function proposalFilterOf(search: Readonly<Record<string, unknown>>): ProposalFilter {
  return Object.fromEntries(
    proposalParts.flatMap((part) => {
      const value = said(search, proposalWords[part])

      return value === undefined ? [] : [[part, value] as const]
    }),
  )
}

/** The search of the address for a filter. */
export function proposalSearch(filter: ProposalFilter): Record<string, string> {
  return Object.fromEntries(
    proposalParts.flatMap((part) => {
      const value = filter[part]

      return value === undefined ? [] : [[proposalWords[part], value] as const]
    }),
  )
}

/** What the route is asked: the parts it narrows to, in the order it knows them. The package is the screen's. */
export function proposalRequest(filter: ProposalFilter): string {
  const query = new URLSearchParams()

  for (const part of dutyProposalFilters) {
    const value = filter[part]

    if (value !== undefined) {
      query.set(part, value)
    }
  }

  const asked = query.toString()

  return asked === '' ? '/duties/proposals' : `/duties/proposals?${asked}`
}

/**
 * Where the proposals are read as a table (#236): what the route narrows
 * to, the package the list is narrowed to on the screen, and which of the
 * two lists, the open ones unless the dismissed are asked for.
 */
export function proposalTableRequest(filter: ProposalFilter, list: 'open' | 'dismissed'): string {
  const [path = '', query = ''] = proposalRequest(filter).split('?')
  const asked = new URLSearchParams(query)

  if (filter.package !== undefined) {
    asked.set('package', filter.package)
  }

  if (list === 'dismissed') {
    asked.set('list', list)
  }

  const rest = asked.toString()

  return `${path}/table${rest === '' ? '' : `?${rest}`}`
}

/** The search of the form that confirms the proposal of a duty kind for an asset. */
export function confirmSearch(assetId: string, dutyKind: string): Record<string, string> {
  return { [proposalWords.assetId]: assetId, [proposalWords.dutyKind]: dutyKind }
}

// The package a duty kind belongs to is said once, for the list and its table (#236).
export { packageOf } from '@opengewerk/haustechnik-domain'
