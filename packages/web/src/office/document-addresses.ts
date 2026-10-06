import {
  type DocumentHome,
  type DocumentKind,
  documentKinds,
  documentTargetFields,
} from '@opengewerk/haustechnik-domain'
import type { Crumb } from '@opengewerk/platform-web'

/**
 * Where the documents live in the office, and how the address carries what
 * the list is narrowed by (4.10 of the concept): a filter is part of the
 * address, so that a list somebody narrowed can be handed on and the way back
 * leads to it.
 *
 * A document has an address of its own under the list, by its id: the same
 * screen with that document chosen, which is where the card of an asset, a
 * room and a property and the change log lead.
 */

export const documentRegisterPlace = {
  to: '/dokumente',
  label: 'Dokumente',
} as const satisfies Crumb

export const documentPlaces = {
  document: (id: string) => `/dokumente/${id}`,
} as const

/** What the list of documents is narrowed by. */
export interface DocumentFilter {
  readonly kind?: DocumentKind
  /** The kind of record a document hangs on. */
  readonly home?: DocumentHome
}

/**
 * The word of the address for each filter. German, because the address bar is
 * something a person reads; what follows the word is the key the data model
 * has for it, the kind of a document and the field it hangs on by.
 */
export const documentFilterWords = {
  kind: 'art',
  home: 'an',
} as const satisfies Readonly<Record<keyof DocumentFilter, string>>

const homes: readonly string[] = ['propertyId', ...documentTargetFields]

/**
 * The filters an address names. A kind or a place there is none of is no
 * filter: a list that shows everything says more than an error about a word
 * in the address.
 */
export function documentFilterOf(search: Readonly<Record<string, unknown>>): DocumentFilter {
  const kind = search[documentFilterWords.kind]
  const home = search[documentFilterWords.home]

  return {
    ...(typeof kind === 'string' && (documentKinds as readonly string[]).includes(kind)
      ? { kind: kind as DocumentKind }
      : {}),
    ...(typeof home === 'string' && homes.includes(home) ? { home: home as DocumentHome } : {}),
  }
}

/** The search of the address for these filters. */
export function documentSearch(filter: DocumentFilter): Record<string, string> {
  return {
    ...(filter.kind === undefined ? {} : { [documentFilterWords.kind]: filter.kind }),
    ...(filter.home === undefined ? {} : { [documentFilterWords.home]: filter.home }),
  }
}
