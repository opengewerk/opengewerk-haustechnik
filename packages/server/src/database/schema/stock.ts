import { articlePriceCentsMax } from '@opengewerk/haustechnik-domain'
import { stockSchema } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { check, integer } from 'drizzle-orm/pg-core'

/**
 * The stores of the operator (#325, section 4.12 of the concept), made with
 * the factory of the foundation (ADR 0011 in the repository opengewerk):
 * articles, suppliers, stores, the minimum a store keeps and the bookings.
 * Tenant-wide and without an area (2.8), held by every device.
 *
 * Of its own this application adds the price of an article, an indication
 * for the view of costs (4.16). A booking is written once: the migration
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
})
