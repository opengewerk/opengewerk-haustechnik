import { contractLimits, noticeUnits } from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { contractors } from './contractors.js'
import { buildings, optionalTrimmed, trimmed } from './locations.js'
import { kindOfItsAsset, withinLimits } from './limit-policies.js'

/**
 * The contracts of an operator with its contractors (#329, section 4.11 of
 * the concept): the firm, the term with how it renews and the notice it
 * takes, and the response time, the price and a note as words. Tenant-wide
 * and without an area like the firm (decided 15.10.2026): the policy
 * `tenant_isolation` alone, and the routes ask for the right to read them.
 * The rows travel only to the devices of whoever reads the contracts.
 *
 * One entered by mistake is marked (`deleted_at`) and never removed, so the
 * application role has no DELETE.
 */
export const contracts = pgTable(
  'contracts',
  {
    id: primaryId<'contract'>(),
    ...tenantColumn,
    contractorId: reference<'contractor'>('contractor_id').notNull(),
    title: text('title').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }),
    renewalMonths: integer('renewal_months'),
    noticeAmount: integer('notice_amount'),
    noticeUnit: text('notice_unit').$type<(typeof noticeUnits)[number]>(),
    cancelledTo: date('cancelled_to', { mode: 'string' }),
    responseTime: text('response_time'),
    price: text('price'),
    note: text('note'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('contracts_tenant_id_key').on(table.tenantId, table.id),
    // What a duty points at, so that the contract it fulfils is one of its firm.
    unique('contracts_of_their_contractor').on(table.tenantId, table.id, table.contractorId),
    foreignKey({
      columns: [table.tenantId, table.contractorId],
      foreignColumns: [contractors.tenantId, contractors.id],
      name: 'contracts_with_a_contractor',
    }),
    index('contracts_contractor_idx').on(table.tenantId, table.contractorId),
    check('contracts_title_shaped', trimmed(table.title, contractLimits.title)),
    check(
      'contracts_response_time_shaped',
      optionalTrimmed(table.responseTime, contractLimits.responseTime),
    ),
    check('contracts_price_shaped', optionalTrimmed(table.price, contractLimits.price)),
    check('contracts_note_shaped', optionalTrimmed(table.note, contractLimits.note)),
    check(
      'contracts_renewal_shaped',
      sql`${table.renewalMonths} is null or (${table.renewalMonths} between 1 and ${sql.raw(String(contractLimits.renewalMonths))} and ${table.endsOn} is not null)`,
    ),
    check(
      'contracts_notice_shaped',
      sql`(${table.noticeAmount} is null and ${table.noticeUnit} is null) or (${table.noticeAmount} between 1 and ${sql.raw(String(contractLimits.noticeAmount))} and ${table.noticeUnit} in (${sql.raw(noticeUnits.map((unit) => `'${unit}'`).join(', '))}))`,
    ),
    check(
      'contracts_term_in_order',
      sql`(${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}) and (${table.cancelledTo} is null or ${table.cancelledTo} >= ${table.startsOn})`,
    ),
  ],
)

/**
 * What a contract covers (#329): a building whole, or an asset, each a row
 * with the property and the area of what it names, under the restrictive
 * policy `within_areas`. So a contract shows what it covers only from the
 * areas of whoever reads it, as decided on 15.10.2026, and a building or an
 * asset moved to another area takes its rows along over the keys.
 *
 * Taken out again, a row is removed: it is a choice of the contract, not a
 * record, and the change log keeps that it was there.
 */
export const contractItems = pgTable(
  'contract_items',
  {
    id: primaryId<'contract-item'>(),
    ...tenantColumn,
    contractId: reference<'contract'>('contract_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    buildingId: reference<'building'>('building_id'),
    assetId: reference<'asset'>('asset_id'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsAsset(table.assetId)),
    foreignKey({
      columns: [table.tenantId, table.contractId],
      foreignColumns: [contracts.tenantId, contracts.id],
      name: 'contract_items_of_a_contract',
    }),
    // The area and the property of what the row names (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.areaId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.areaId],
      name: 'contract_items_follow_their_building',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: 'contract_items_follow_their_asset',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'contract_items_at_a_building_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'contract_items_at_an_asset_of_their_property',
    }).onUpdate('cascade'),
    // A building or an asset, never both and never neither.
    check(
      'contract_items_one_target',
      sql`num_nonnulls(${table.buildingId}, ${table.assetId}) = 1`,
    ),
    // Each once to a contract.
    uniqueIndex('contract_items_building_once')
      .on(table.tenantId, table.contractId, table.buildingId)
      .where(sql`${table.buildingId} is not null`),
    uniqueIndex('contract_items_asset_once')
      .on(table.tenantId, table.contractId, table.assetId)
      .where(sql`${table.assetId} is not null`),
    index('contract_items_building_idx').on(table.tenantId, table.buildingId),
    index('contract_items_asset_idx').on(table.tenantId, table.assetId),
  ],
)
