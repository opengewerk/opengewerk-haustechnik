import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { invitations, memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { properties } from './locations.js'

// What an access from outside is limited to beside its areas (#339, section
// 4.3 of the concept): the properties and the kinds of assets an auditor
// reads. Like the areas, the application does not hand it to the database: two
// functions read it from these tables, for the person and the tenant the
// foundation sets for every transaction, and a restrictive policy on the
// places, assets, duties, activities and documents asks them
// (`within_limits`). A route that is wrong can therefore not widen it.
//
// No row is no limit. Every membership other than an auditor's has none, and
// a transaction without a person, the runs in the background, has none either.

/** A property an access is limited to, one row each. Removed with the membership or the property. */
export const memberLimitProperties = pgTable(
  'member_limit_properties',
  {
    id: primaryId<'member-limit-property'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // Also the index the function finds the properties of a person by.
    unique('member_limit_properties_once').on(table.tenantId, table.userId, table.propertyId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'member_limit_properties_person_works_here',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
      name: 'member_limit_properties_property_of_the_tenant',
    }).onDelete('cascade'),
  ],
)

/** A kind of asset an access is limited to, by the key the catalogue gives it, one row each. */
export const memberLimitAssetKinds = pgTable(
  'member_limit_asset_kinds',
  {
    id: primaryId<'member-limit-asset-kind'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    assetKind: text('asset_kind').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('member_limit_asset_kinds_once').on(table.tenantId, table.userId, table.assetKind),
    check('member_limit_asset_kinds_key', sql`${table.assetKind} ~ '^[a-z0-9_]+\\.[a-z0-9_]+$'`),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'member_limit_asset_kinds_person_works_here',
    }).onDelete('cascade'),
  ],
)

/**
 * A property an invitation limits the membership it becomes to. Written with
 * the invitation and never changed, as `invitation_areas`: an invitation is
 * replaced, not edited.
 */
export const invitationLimitProperties = pgTable(
  'invitation_limit_properties',
  {
    id: primaryId<'invitation-limit-property'>(),
    ...tenantColumn,
    invitationId: reference<'invitation'>('invitation_id').notNull(),
    propertyId: reference<'property'>('property_id').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('invitation_limit_properties_once').on(
      table.tenantId,
      table.invitationId,
      table.propertyId,
    ),
    foreignKey({
      columns: [table.tenantId, table.invitationId],
      foreignColumns: [invitations.tenantId, invitations.id],
      name: 'invitation_limit_properties_of_an_invitation',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.propertyId],
      foreignColumns: [properties.tenantId, properties.id],
      name: 'invitation_limit_properties_property_of_the_tenant',
    }).onDelete('cascade'),
  ],
)

/** A kind of asset an invitation limits the membership it becomes to. */
export const invitationLimitAssetKinds = pgTable(
  'invitation_limit_asset_kinds',
  {
    id: primaryId<'invitation-limit-asset-kind'>(),
    ...tenantColumn,
    invitationId: reference<'invitation'>('invitation_id').notNull(),
    assetKind: text('asset_kind').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('invitation_limit_asset_kinds_once').on(
      table.tenantId,
      table.invitationId,
      table.assetKind,
    ),
    check(
      'invitation_limit_asset_kinds_key',
      sql`${table.assetKind} ~ '^[a-z0-9_]+\\.[a-z0-9_]+$'`,
    ),
    foreignKey({
      columns: [table.tenantId, table.invitationId],
      foreignColumns: [invitations.tenantId, invitations.id],
      name: 'invitation_limit_asset_kinds_of_an_invitation',
    }).onDelete('cascade'),
  ],
)
