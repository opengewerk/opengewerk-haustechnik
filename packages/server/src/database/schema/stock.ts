import { articlePriceCentsMax, stockLimits } from '@opengewerk/haustechnik-domain'
import {
  labelCodeShaped,
  labelColumns,
  labelIsValid,
  primaryId,
  reference,
  stockSchema,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  type PgTableExtraConfigValue,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { activities, activityKind } from './activities.js'
import { withinAreas } from './areas.js'
import { kindOfItsActivity, withinLimits } from './limit-policies.js'

/**
 * The stores of the operator (#325, section 4.12 of the concept), made with
 * the factory of the foundation (ADR 0011 in the repository opengewerk):
 * articles, suppliers, stores, the minimum a store keeps and the bookings.
 * Tenant-wide and without an area (2.8), held by every device.
 *
 * Of its own this application adds the price of an article, an indication
 * for the view of costs (4.16), and to a booking the withdrawal at a work
 * order it books (#326): a booking of the kind "withdrawal" books exactly one,
 * and one withdrawal is booked once. A booking is written once: the migration
 * holds it with a trigger, and the application may read and add one only.
 */
export const { articles, suppliers, stores, storeArticles, stockMovements } = stockSchema({
  articles: {
    columns: { priceCents: integer('price_cents') },
    constraints: (table) => [
      check(
        'articles_price_from_zero',
        sql`${table.priceCents} is null or ${table.priceCents} between 0 and ${sql.raw(String(articlePriceCentsMax))}`,
      ),
    ],
  },
  movements: {
    columns: { materialId: reference<'work-order-material'>('material_id') },
    // Typed, because the withdrawal it names is made of the stores in turn.
    constraints: (table): PgTableExtraConfigValue[] => [
      // A withdrawal is booked once, and only a withdrawal at a work order
      // is one: the office books receipts and counts. No key onto the
      // withdrawal: it lies in the area of its order, and the booking is
      // read tenant-wide; the server writes both in one transaction.
      uniqueIndex('stock_movements_book_a_material_once')
        .on(table.tenantId, table.materialId)
        .where(sql`${table.materialId} is not null`),
      check(
        'stock_movements_a_withdrawal_books_a_material',
        sql`(${table.kind} = 'withdrawal') = (${table.materialId} is not null)`,
      ),
    ],
  },
})

/**
 * Material taken for a work order (#326): which store, which article, how
 * much, when by the clock of the device and who, which the server writes. It
 * hangs on its work order and lies in its area, as a note does, and travels
 * with it to the devices that hold the order. Never changed or removed; the
 * server books it once as a withdrawal in its store.
 */
export const workOrderMaterials = pgTable(
  'work_order_materials',
  {
    id: primaryId<'work-order-material'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    activityKind: activityKind('activity_kind')
      .notNull()
      .default('work_order')
      .$type<'work_order'>(),
    storeId: reference<'store'>('store_id').notNull(),
    articleId: reference<'article'>('article_id').notNull(),
    quantityMilli: integer('quantity_milli').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    // Null three years after it was taken (#412), as at a booking.
    takenBy: text('taken_by'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsActivity(table.activityId)),
    unique('work_order_materials_tenant_id_key').on(table.tenantId, table.id),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'work_order_materials_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId, table.activityKind],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId, activities.kind],
      name: 'work_order_materials_of_a_work_order_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.storeId],
      foreignColumns: [stores.tenantId, stores.id],
      name: 'work_order_materials_from_a_store_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
      name: 'work_order_materials_of_an_article_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.takenBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'work_order_materials_taken_by_somebody_here',
    }),
    index('work_order_materials_activity_idx').on(table.tenantId, table.activityId),
    check('work_order_materials_of_a_work_order', sql`${table.activityKind} = 'work_order'`),
    check(
      'work_order_materials_quantity_above_zero',
      sql`${table.quantityMilli} between 1 and ${sql.raw(String(stockLimits.quantityMilli))}`,
    ),
  ],
)

/**
 * The label on the shelf of an article in a store (#326), printed like the
 * labels of assets and rooms (#98): for an article without the barcode of its
 * manufacturer, read on site like one. One that still opens something per
 * shelf. Made and blocked in the office; tenant-wide like the stores.
 */
export const storeLabels = pgTable(
  'store_labels',
  {
    id: primaryId<'store-label'>(),
    ...tenantColumn,
    storeArticleId: reference<'store-article'>('store_article_id').notNull(),
    ...labelColumns(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('store_labels_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.storeArticleId],
      foreignColumns: [storeArticles.tenantId, storeArticles.id],
      name: 'store_labels_on_a_shelf_here',
    }),
    uniqueIndex('store_labels_code_once').on(table.code),
    uniqueIndex('store_labels_one_valid_per_shelf')
      .on(table.tenantId, table.storeArticleId)
      .where(labelIsValid(table.blockedAt, table.deletedAt)),
    labelCodeShaped('store_labels_code_shaped', table.code),
  ],
)
