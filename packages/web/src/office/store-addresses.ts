import type {
  Article,
  StockSupplier,
  Store,
  StoreArticlePage,
  StoreStock,
} from '@opengewerk/haustechnik-domain'
import { request } from '@opengewerk/platform-web/sync'

/**
 * Where the stores of the operator stand in the office (#325, 4.12 of the
 * concept): the stock of a store, chosen in the address, the articles, the
 * suppliers, and one article in one store. Everything comes from the routes
 * of the server, with a connection: the stock is the sum of its bookings,
 * and the server adds them up.
 */
export const storePlaces = {
  stock: '/lager',
  articles: '/lager/artikel',
  suppliers: '/lager/lieferanten',
  article: (storeId: string, articleId: string) => `/lager/${storeId}/artikel/${articleId}`,
} as const

/** What the address of the stock says: the store, and whether only what is below its minimum. */
export interface StockAddress {
  readonly lager?: string
  readonly unter?: '1'
}

export function stockAddressOf(search: Readonly<Record<string, unknown>>): StockAddress {
  const lager = search['lager']

  return {
    ...(typeof lager === 'string' && lager !== '' ? { lager } : {}),
    ...(search['unter'] === '1' || search['unter'] === 1 ? { unter: '1' as const } : {}),
  }
}

/** Every key the stores are read under, so that a booking has all of them read again. */
export const storeKey = ['stores'] as const

export type ListedStore = Store & { readonly belowCount: number }

export const storeListQuery = {
  queryKey: [...storeKey, 'list'],
  queryFn: () => request<ListedStore[]>('/stores'),
} as const

export function stockQuery(storeId: string, onlyBelow: boolean) {
  return {
    queryKey: [...storeKey, 'stock', storeId, onlyBelow],
    queryFn: () =>
      request<StoreStock>(
        `/stores/${encodeURIComponent(storeId)}/stock${onlyBelow ? '?below=1' : ''}`,
      ),
  } as const
}

export function articleListQuery(search: string) {
  return {
    queryKey: [...storeKey, 'articles', search],
    queryFn: () =>
      request<Article[]>(
        search === '' ? '/articles' : `/articles?search=${encodeURIComponent(search)}`,
      ),
  } as const
}

export const supplierListQuery = {
  queryKey: [...storeKey, 'suppliers'],
  queryFn: () => request<StockSupplier[]>('/suppliers'),
} as const

export function storeArticleQuery(storeId: string, articleId: string) {
  return {
    queryKey: [...storeKey, 'article', storeId, articleId],
    queryFn: () =>
      request<StoreArticlePage>(
        `/stores/${encodeURIComponent(storeId)}/articles/${encodeURIComponent(articleId)}`,
      ),
  } as const
}
