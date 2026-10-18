import {
  labelCodeFromScan,
  type RecordState,
  type ReportedMaterial,
  type StockMovementKind,
  type StockUnit,
  stockOnDevice,
} from '@opengewerk/haustechnik-domain'
import { maybeText, text } from '@opengewerk/platform-web/sync'

import type { SyncClient } from '../sync/client.js'

/**
 * Material at a work order on this device (#326): what was taken for an
 * order, the stock of an article as the device knows it, and what a scanned
 * code is. The device holds the whole stock of the operator, its articles,
 * stores, bookings and the labels on the shelves, so all of it answers
 * without a network as well.
 */

type Lister = Pick<SyncClient, 'list'>

function live(record: RecordState): boolean {
  return record['deletedAt'] === null || record['deletedAt'] === undefined
}

function amountOf(record: RecordState, field: string): number {
  const value = record[field]

  return typeof value === 'number' ? value : Number(value ?? 0)
}

/** The material of an order as the page of its service report shows it: by key, without a price. */
export function materialsOnDevice(client: Lister, activityId: string): ReportedMaterial[] {
  const articles = new Map(
    client.list('articles').map((article) => [String(article['id']), article]),
  )

  return client
    .list('work_order_materials')
    .filter((material) => material['activityId'] === activityId && live(material))
    .flatMap((material) => {
      const article = articles.get(text(material, 'articleId'))

      return article === undefined
        ? []
        : [
            {
              id: String(material['id']),
              quantityMilli: amountOf(material, 'quantityMilli'),
              unit: text(article, 'unit') as StockUnit,
              designation: text(article, 'designation'),
            },
          ]
    })
}

/** The stock of an article in a store as this device knows it, its own withdrawals not yet sent included. */
export function stockOnThisDevice(client: Lister, storeId: string, articleId: string): number {
  return stockOnDevice(
    client.list('stock_movements').map((movement) => ({
      storeId: text(movement, 'storeId'),
      articleId: text(movement, 'articleId'),
      kind: text(movement, 'kind') as StockMovementKind,
      quantityMilli: amountOf(movement, 'quantityMilli'),
      createdAt: text(movement, 'createdAt'),
      materialId: maybeText(movement, 'materialId'),
    })),
    client
      .list('work_order_materials')
      .filter(live)
      .map((material) => ({
        id: String(material['id']),
        storeId: text(material, 'storeId'),
        articleId: text(material, 'articleId'),
        quantityMilli: amountOf(material, 'quantityMilli'),
      })),
    storeId,
    articleId,
  )
}

/** What a scanned code is: an article by the barcode of its manufacturer, or a shelf by its own label. */
export type ScannedArticle =
  | { readonly by: 'ean'; readonly articleId: string }
  | { readonly by: 'label'; readonly articleId: string; readonly storeId: string }

/** The article a code read by the camera names on this device, or null where it names none. */
export function articleOfCode(client: Lister, read: string): ScannedArticle | null {
  const said = read.trim()
  const byEan = client
    .list('articles')
    .find((article) => live(article) && maybeText(article, 'ean') === said)

  if (byEan !== undefined) {
    return { by: 'ean', articleId: String(byEan['id']) }
  }

  const code = labelCodeFromScan(said)
  const label =
    code === null
      ? undefined
      : client
          .list('store_labels')
          .find(
            (each) =>
              text(each, 'code') === code && live(each) && maybeText(each, 'blockedAt') === null,
          )
  const shelf =
    label === undefined
      ? undefined
      : client
          .list('store_articles')
          .find((each) => String(each['id']) === text(label, 'storeArticleId'))
  const article =
    shelf === undefined
      ? undefined
      : client
          .list('articles')
          .find((each) => String(each['id']) === text(shelf, 'articleId') && live(each))

  return shelf === undefined || article === undefined
    ? null
    : { by: 'label', articleId: String(article['id']), storeId: text(shelf, 'storeId') }
}
