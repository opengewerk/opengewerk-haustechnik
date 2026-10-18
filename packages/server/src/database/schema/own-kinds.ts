import {
  type ExpectedDocument,
  type OwnFieldSort,
  ownFieldSorts,
  ownKindLimits,
} from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  readableByTheOwner,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import type { ChoiceOption } from '@opengewerk/haustechnik-domain'
import { sql } from 'drizzle-orm'
import { check, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

import { optionalTrimmed, trimmed } from './locations.js'

/**
 * The asset kinds of an operator's own (#62, section 4.2 of the concept): a
 * kind no package describes, under `eigen.<key>`, with its label, its cost
 * group and the documents an asset of it is expected to have. Its fields
 * stand in `own_asset_fields`, as those at a kind of a package do.
 *
 * Tenant-wide and without an area, like the catalogue it stands in; no row
 * travels as a record: the server hands the kinds to a device with the
 * catalogue. A kind is removed by marking it, and only while no asset carries
 * it, so that no asset names a kind nobody knows. Its key stays taken.
 */
export const ownAssetKinds = pgTable(
  'own_asset_kinds',
  {
    id: primaryId<'own_asset_kind'>(),
    ...tenantColumn,
    key: text('key').notNull(),
    label: text('label').notNull(),
    costGroup: text('cost_group').notNull(),
    expectedDocuments: jsonb('expected_documents')
      .$type<readonly ExpectedDocument[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Counted up with every change, as the version of a kind of a package. */
    revision: integer('revision').notNull().default(1),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // For the one function that counts what uses them past the areas (`own_kind_uses`).
    readableByTheOwner(),
    unique('own_asset_kinds_key_once').on(table.tenantId, table.key),
    check(
      'own_asset_kinds_key_shaped',
      sql`${table.key} ~ '^eigen\\.[a-z0-9]+(_[a-z0-9]+)*$' and char_length(${table.key}) <= 60`,
    ),
    check('own_asset_kinds_label_shaped', trimmed(table.label, ownKindLimits.label)),
    check('own_asset_kinds_cost_group_shaped', sql`${table.costGroup} ~ '^[0-9]{3}$'`),
    check(
      'own_asset_kinds_documents_listed',
      sql`jsonb_typeof(${table.expectedDocuments}) = 'array'`,
    ),
    check('own_asset_kinds_revision_counted', sql`${table.revision} >= 1`),
  ],
)

/**
 * The fields of an operator's own (#62, section 2.5 of the concept): at one of
 * its kinds or at a kind of a package, the same thing either way (decided on
 * 15.10.2026). Its key begins with `eigen_`, so its value stands in the
 * values of an asset beside those of the package without meeting one. Its
 * sort stays once an asset holds a value of it, and it is removed, by
 * marking, only while none does.
 */
export const ownAssetFields = pgTable(
  'own_asset_fields',
  {
    id: primaryId<'own_asset_field'>(),
    ...tenantColumn,
    assetKind: text('asset_kind').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    sort: text('sort').$type<OwnFieldSort>().notNull(),
    unit: text('unit'),
    options: jsonb('options')
      .$type<readonly ChoiceOption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    position: integer('position').notNull().default(0),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // For the one function that counts what uses them past the areas (`own_kind_uses`).
    readableByTheOwner(),
    unique('own_asset_fields_key_once').on(table.tenantId, table.key),
    check('own_asset_fields_kind_shaped', trimmed(table.assetKind, 120)),
    check(
      'own_asset_fields_key_shaped',
      sql`${table.key} ~ '^eigen_[a-z0-9]+(_[a-z0-9]+)*$' and char_length(${table.key}) <= 60`,
    ),
    check('own_asset_fields_label_shaped', trimmed(table.label, ownKindLimits.label)),
    check(
      'own_asset_fields_sort_known',
      sql.raw(`"sort" in (${ownFieldSorts.map((sort) => `'${sort}'`).join(', ')})`),
    ),
    check('own_asset_fields_unit_shaped', optionalTrimmed(table.unit, ownKindLimits.unit)),
    check(
      'own_asset_fields_unit_of_a_number',
      sql`${table.unit} is null or ${table.sort} = 'number'`,
    ),
    check('own_asset_fields_options_listed', sql`jsonb_typeof(${table.options}) = 'array'`),
  ],
)
