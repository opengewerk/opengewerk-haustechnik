import {
  type Id,
  type IsoDate,
  stockLevel,
  stockLimits,
  type StockArticleId,
  type StockMovementKind,
  type StockUnit,
  type StoreId,
  type Synced,
} from '@opengewerk/platform-domain'

import type { ActivityId } from './activity.js'
import type { AreaId } from './area.js'
import type { Problems } from './fields.js'
import type { PropertyId } from './location.js'

/**
 * The material of a work order (sections 4.8 and 4.12 of the concept, #326):
 * what was taken from which store for it, on site and also without a
 * connection. A withdrawal hangs on its work order and lies in its area, as a
 * note does; the server books it once as a withdrawal in the store, and
 * neither the withdrawal nor its booking is changed afterwards. What is wrong,
 * a count in the store sets right (decided on 15.10.2026).
 *
 * Who takes material is whoever works on the order, the further people
 * included, under the right to do the work ("Vorgänge ausführen"); no right of
 * its own.
 */

export type WorkOrderMaterialId = Id<'work-order-material'>

export interface WorkOrderMaterial extends Synced {
  readonly id: WorkOrderMaterialId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly activityId: ActivityId
  readonly storeId: StoreId
  readonly articleId: StockArticleId
  /** Thousandths of the unit of the article, above zero. */
  readonly quantityMilli: number
  /** When it was taken, by the clock of the device. */
  readonly takenAt: Date
  /**
   * Who took it: the person signed in, which the server writes. Null three
   * years after it was taken, when the person goes and the booking stays (#412).
   */
  readonly takenBy: string | null
}

/** What is wrong with a withdrawal, one sentence per field. */
export function workOrderMaterialProblems(
  material: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}

  for (const [field, sentence] of [
    ['storeId', 'Wählen Sie das Lager.'],
    ['articleId', 'Wählen Sie den Artikel.'],
  ] as const) {
    const value = material[field]

    if (field in material && (typeof value !== 'string' || value.trim() === '')) {
      problems[field] = sentence
    }
  }

  const quantity = material['quantityMilli']

  if (
    'quantityMilli' in material &&
    !(
      typeof quantity === 'number' &&
      Number.isInteger(quantity) &&
      quantity > 0 &&
      quantity <= stockLimits.quantityMilli
    )
  ) {
    problems['quantityMilli'] = 'Entnommen wird eine Menge über null.'
  }

  const takenAt = material['takenAt']
  const moment =
    takenAt instanceof Date
      ? takenAt.getTime()
      : typeof takenAt === 'string'
        ? Date.parse(takenAt)
        : Number.NaN

  if (takenAt !== undefined && Number.isNaN(moment)) {
    problems['takenAt'] =
      'Der Zeitpunkt der Entnahme ist ein Zeitpunkt, geschrieben 2026-10-05T08:55:00Z.'
  }

  return problems
}

/** A booking of a store as a device holds it: enough to add up the stock. */
export interface HeldMovement {
  readonly storeId: string
  readonly articleId: string
  readonly kind: StockMovementKind
  readonly quantityMilli: number
  readonly createdAt: Date | string
  /** The withdrawal of a work order this booking is, or none. */
  readonly materialId: string | null
}

/** A withdrawal as a device holds it, its own not yet sent among them. */
export interface HeldMaterial {
  readonly id: string
  readonly storeId: string
  readonly articleId: string
  readonly quantityMilli: number
}

/**
 * The stock of an article in a store as a device knows it: the bookings it
 * holds, less what was taken on it whose booking it does not hold yet. A
 * withdrawal and its booking are counted once, whichever of the two the
 * device holds. Below zero it says so; that is no conflict (2.7).
 */
export function stockOnDevice(
  movements: readonly HeldMovement[],
  materials: readonly HeldMaterial[],
  storeId: string,
  articleId: string,
): number {
  const here = movements.filter(
    (movement) => movement.storeId === storeId && movement.articleId === articleId,
  )
  const booked = new Set(here.map((movement) => movement.materialId).filter(Boolean))
  const level = stockLevel(
    here.map((movement) => ({ ...movement, createdAt: new Date(movement.createdAt) })),
  )
  const pending = materials
    .filter(
      (material) =>
        material.storeId === storeId &&
        material.articleId === articleId &&
        !booked.has(material.id),
    )
    .reduce((sum, material) => sum + material.quantityMilli, 0)

  return level - pending
}

/** A withdrawal as the page of a work order in the office shows it: how much of what, from where, on which day. No person, no price. */
export interface WorkOrderMaterialLine {
  readonly id: WorkOrderMaterialId
  readonly quantityMilli: number
  readonly unit: StockUnit
  readonly articleId: StockArticleId
  readonly number: string
  readonly designation: string
  readonly storeId: StoreId
  readonly store: string
  readonly takenOn: IsoDate
}

export type StoreLabelId = Id<'store-label'>

/**
 * The label on the shelf of an article in a store (#326): an own code for an
 * article without the barcode of its manufacturer, printed like the labels of
 * assets and rooms (#98). A blocked one opens nothing.
 */
export interface StoreLabel extends Synced {
  readonly id: StoreLabelId
  readonly storeArticleId: Id<'store-article'>
  readonly code: string
  readonly blockedAt: Date | null
}
