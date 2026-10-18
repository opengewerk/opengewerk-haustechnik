import type {
  IsoDate,
  StockArticle,
  StockArticleId,
  StockMovement,
  StockMovementId,
  StockMovementKind,
  StockSupplierId,
  StockUnit,
  StoreId,
} from '@opengewerk/platform-domain'

import type { WorkOrderMaterialId } from './material.js'

/**
 * The stores of an operator (section 4.12 of the concept, #325), on the
 * building block of the foundation (ADR 0011 in the repository opengewerk):
 * articles, suppliers, stores, the minimum a store keeps and the bookings the
 * stock is made of. Tenant-wide and without an area (2.8).
 *
 * What only this application adds: the price of an article, an indication
 * for the view of costs (4.16) and no part of any document.
 */

/** The most a price of one unit may be, in cents: 999.999,99 euros. */
export const articlePriceCentsMax = 99_999_999

/** An article as this application keeps it: the article of the foundation with its price. */
export interface Article extends StockArticle {
  /** The price of one unit in cents, for the view of costs; none where nobody said one. */
  readonly priceCents: number | null
}

/** What is wrong with the price of an article, as a sentence, or null. */
export function articlePriceProblem(value: unknown): string | null {
  return value === null ||
    value === undefined ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= articlePriceCentsMax)
    ? null
    : 'Der Preis ist ein Betrag ab null.'
}

/** One article in the list of a store: its stock, the minimum the store keeps, and whether it is below. */
export interface StockLine {
  readonly articleId: StockArticleId
  readonly number: string
  readonly designation: string
  readonly unit: StockUnit
  /** Where it lies in this store (#385), where somebody said so. */
  readonly bin: string | null
  readonly levelMilli: number
  readonly minimumMilli: number | null
  readonly below: boolean
  /** The article is no longer kept; its bookings stay. */
  readonly removed: boolean
}

/** The stock of a store, and how many of its articles are below their minimum. */
export interface StoreStock {
  readonly storeId: StoreId
  readonly name: string
  readonly lines: readonly StockLine[]
  readonly belowCount: number
}

/** A booking as the page of an article in a store shows it, with the stock after it. */
export interface StockMovementLine {
  readonly id: StockMovementId
  readonly kind: StockMovementKind
  readonly quantityMilli: number
  readonly levelAfterMilli: number
  readonly bookedOn: IsoDate
  readonly supplier: string | null
  readonly reason: string | null
  /** The other store of a transfer (#391): where it went, or where it came from. */
  readonly counterpartStore: { readonly id: StoreId; readonly name: string } | null
  /**
   * The work order a withdrawal was taken for (#326), with its number and
   * title where the person asking sees it, and without them where not.
   */
  readonly workOrder: {
    readonly id: string | null
    readonly number: string | null
    readonly title: string | null
  } | null
}

/** The page of one article in one store: the article, the stock, where it lies, the minimum and every booking, the newest first. */
export interface StoreArticlePage {
  readonly store: { readonly id: StoreId; readonly name: string }
  readonly article: Article
  readonly levelMilli: number
  /** Where it lies in this store (#385). */
  readonly bin: string | null
  readonly minimumMilli: number | null
  readonly below: boolean
  /** Whether the store carries the article: not once it moved to another store (#391). */
  readonly carried: boolean
  readonly movements: readonly StockMovementLine[]
}

/** A booking as the office sends it: a receipt or a count; a withdrawal comes with #326. */
export interface NewStockMovement {
  readonly articleId: StockArticleId
  readonly kind: Extract<StockMovementKind, 'receipt' | 'count' | 'write_off'>
  readonly quantityMilli: number
  readonly supplierId: StockSupplierId | null
  readonly reason: string | null
}

/**
 * A booking as this application keeps it: the one of the foundation, and for
 * a withdrawal at a work order the withdrawal it books, once (#326).
 */
export interface StoreMovement extends StockMovement {
  readonly materialId: WorkOrderMaterialId | null
}
