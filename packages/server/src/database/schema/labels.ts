import {
  labelCodeShaped,
  labelColumns,
  labelIsValid,
  primaryId,
  readableByTheOwner,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { properties, rooms } from './locations.js'

/**
 * The name of the index that keeps a code once in the whole instance, which
 * the route that draws a code asks about when the database refuses one.
 */
export const labelCodeIndex = 'labels_code_once'

/** The indexes that keep an asset and a room to one valid label. */
export const oneValidLabelIndexes = ['labels_one_valid_per_asset', 'labels_one_valid_per_room']

/**
 * The labels with a QR code (#98, section 3 of the concept): one row for each
 * label that was made, valid or blocked. What a label is are the two columns
 * of the foundation (ADR 0010 of the repository opengewerk): its code, drawn
 * by the server, and when it was blocked.
 *
 * What it hangs on is this application's: its property always, and on it an
 * asset or a room, each under a key over the tenant and the property, or
 * neither, for a label from a sheet printed for taking stock. Its area
 * follows its property by the key with ON UPDATE CASCADE, and the restrictive
 * policy `within_areas` keeps it in the areas of the person asking (ADR 0003).
 *
 * The code stands once in the whole instance and not once per tenant, which
 * the index over the code alone holds: the address on a label names no
 * tenant, and the same address opens the report of a fault without an account
 * later on (section 4.7). An asset and a room have at most one valid label.
 *
 * `readable_by_the_owner` is for the one function that looks past the areas,
 * `label_state_in_tenant`: it says whether a code belongs to a label of the
 * tenant of the transaction and whether that opens anything, and nothing
 * else. Without it a label in another area and a label of nobody would get
 * the same answer.
 */
export const labels = pgTable(
  'labels',
  {
    id: primaryId<'label'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    assetId: reference<'asset'>('asset_id'),
    roomId: reference<'room'>('room_id'),
    ...labelColumns(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    readableByTheOwner(),
    unique('labels_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'labels_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'labels_on_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'labels_on_a_room_of_their_property',
    }),
    uniqueIndex(labelCodeIndex).on(table.code),
    // A row that names no asset stands in neither index twice: null is never
    // equal to null, so the labels of a sheet do not get in each other's way.
    uniqueIndex('labels_one_valid_per_asset')
      .on(table.tenantId, table.assetId)
      .where(labelIsValid(table.blockedAt, table.deletedAt)),
    uniqueIndex('labels_one_valid_per_room')
      .on(table.tenantId, table.roomId)
      .where(labelIsValid(table.blockedAt, table.deletedAt)),
    index('labels_property_idx').on(table.tenantId, table.propertyId),
    // An asset or a room, never both; neither is a label from a sheet.
    check('labels_hang_on_one_record', sql`num_nonnulls(${table.assetId}, ${table.roomId}) <= 1`),
    labelCodeShaped('labels_code_shaped', table.code),
  ],
)
