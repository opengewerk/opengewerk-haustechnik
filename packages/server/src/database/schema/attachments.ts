import { documentKinds, documentLimits } from '@opengewerk/haustechnik-domain'
import { applicationRole, attachmentsSchema, reference } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, pgEnum, pgPolicy, unique } from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { areaFromPropertyColumn, areaFromTheProperty, withinAreas } from './areas.js'
import { assets } from './assets.js'
import { defects } from './defects.js'
import { buildings, properties, rooms, trimmed } from './locations.js'

/** What kind of document a file is, from the list in `domain`; none for a photo. */
export const documentKind = pgEnum('document_kind', documentKinds)

/**
 * What a document of this application hangs on and what it is: its property
 * with the area of that property, at most one record there, a building, a
 * room, an asset, an activity or a defect, and its kind.
 *
 * `legacy` marks a document taken over from a predecessor application
 * (section 11 of the concept, #130): an old evidence with its original file,
 * neither signed anew nor rewritten. Only the import of the server sets it;
 * no route and no device does.
 */
const documentPlace = {
  propertyId: reference<'property'>('property_id').notNull(),
  areaId: reference<'area'>('area_id').notNull(),
  areaFromPropertyId: areaFromPropertyColumn(),
  buildingId: reference<'building'>('building_id'),
  roomId: reference<'room'>('room_id'),
  assetId: reference<'asset'>('asset_id'),
  activityId: reference<'activity'>('activity_id'),
  defectId: reference<'defect'>('defect_id'),
  kind: documentKind('kind'),
  legacy: boolean('legacy').notNull().default(false),
}

/** The columns this application gives its documents, for the routes of the foundation. */
export type DocumentPlaceColumns = typeof documentPlace

/**
 * The expression of the policy of the versions, as the migration writes it: a
 * version is in reach of whoever its document is in reach of. The sub-select
 * reads `attachments` under the policies of that table, so the tenant and the
 * areas of the person asking decide, the same as for the document itself.
 */
export const withinAreasOfTheirFileExpression =
  'EXISTS (SELECT 1 FROM attachments WHERE attachments.tenant_id = attachment_versions.tenant_id AND attachments.id = attachment_versions.attachment_id)'

/**
 * The line between the areas for a version of a document (ADR 0003, addendum
 * of #97). Restrictive, like `within_areas`, so that no other policy widens
 * it, and the same for reading and writing: a version is added only to a
 * document the person sees.
 *
 * A version carries no area of its own. It is written once and nothing
 * changes it afterwards, which a trigger of the foundation holds against
 * everybody; an area on the row could therefore not follow its property into
 * another area, and the move of a property would be refused over its
 * documents. So the version asks its document, whose area does follow.
 */
function withinAreasOfTheirFile() {
  const inReach = sql.raw(withinAreasOfTheirFileExpression)

  return pgPolicy('within_areas_of_their_file', {
    as: 'restrictive',
    for: 'all',
    to: applicationRole,
    using: inReach,
    withCheck: inReach,
  })
}

/**
 * The documents of an operator and their versions (#97, section 4.10 of the
 * concept): the two tables of the foundation (ADR 0010 in the repository
 * opengewerk), with what a document hangs on here.
 *
 * A document hangs on its property always and on at most one record there,
 * which the check says; every such key runs over the tenant and the
 * property, so that a document cannot hang on a record of another property or
 * of another area (ADR 0003). Its area follows its property by the key with
 * ON UPDATE CASCADE, and the restrictive policy `within_areas` keeps it in
 * the areas of the person asking. The comparison with the building blocks
 * takes the columns, keys, checks, indexes and both policies as this
 * application's own (`foundation.test.ts`).
 *
 * The rows travel to a device. Deleting marks a document, and a record that
 * is marked takes its documents along, by a trigger of the migration; the
 * versions and their bytes stay.
 */
export const { attachments, attachmentVersions } = attachmentsSchema({
  columns: documentPlace,
  constraints: (table) => [
    withinAreas(),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.areaId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.areaId],
      name: 'attachments_follow_their_building',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.areaId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.areaId],
      name: 'attachments_follow_their_room',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: 'attachments_follow_their_asset',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'attachments_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.areaId],
      foreignColumns: [defects.tenantId, defects.id, defects.areaId],
      name: 'attachments_follow_their_defect',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.areaFromPropertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'attachments_follow_their_property',
    }).onUpdate('cascade'),
    areaFromTheProperty('attachments_area_from_the_property', table, [
      table.buildingId,
      table.roomId,
      table.assetId,
      table.activityId,
      table.defectId,
    ]),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'attachments_at_a_building_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'attachments_at_a_room_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'attachments_at_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'attachments_at_an_activity_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.propertyId],
      foreignColumns: [defects.tenantId, defects.id, defects.propertyId],
      name: 'attachments_at_a_defect_of_their_property',
    }),
    // What the document that bears the interval of a duty points at: a
    // document of the duty's property (#74).
    unique('attachments_on_their_property').on(table.tenantId, table.id, table.propertyId),
    // What the photo of an answer points at: a document at its activity (#106).
    unique('attachments_at_their_activity').on(
      table.tenantId,
      table.id,
      table.propertyId,
      table.activityId,
    ),
    index('attachments_property_idx').on(table.tenantId, table.propertyId),
    index('attachments_asset_idx').on(table.tenantId, table.assetId),
    index('attachments_activity_idx').on(table.tenantId, table.activityId),
    index('attachments_defect_idx').on(table.tenantId, table.defectId),
    // What `documentTargetProblem` asks: the property, or one record on it.
    check(
      'attachments_hang_on_one_record',
      sql`num_nonnulls(${table.buildingId}, ${table.roomId}, ${table.assetId}, ${table.activityId}, ${table.defectId}) <= 1`,
    ),
    // What `documentProblems` asks of the name, held here for every other way in.
    check('attachments_title_shaped', trimmed(table.title, documentLimits.title)),
  ],
  versionConstraints: (table) => [
    withinAreasOfTheirFile(),
    // What a duty points at beside its document: a version of that document (#74).
    unique('attachment_versions_of_their_document').on(
      table.tenantId,
      table.id,
      table.attachmentId,
    ),
  ],
})
