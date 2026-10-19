import { answerLimits, type AttachmentId, checkPointResults } from '@opengewerk/haustechnik-domain'
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
  foreignKey,
  index,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { attachments } from './attachments.js'
import { optionalTrimmed } from './locations.js'
import { kindOfItsActivity, withinLimits } from './limit-policies.js'

/** The answer to a check point, from the list of the form engine. */
export const checkPointResult = pgEnum('check_point_result', checkPointResults)

/** A key of a field or a group, as the form engine shapes it, at most as long as an answer allows. */
function fieldKeyShaped(column: unknown) {
  return sql`${column} ~ '^[a-z][a-z0-9_]*$' and char_length(${column}) <= ${sql.raw(String(answerLimits.key))}`
}

/**
 * The answers to the points of the form of an activity (#106, section 2.7 of
 * the concept, ADR 0006, point 7): one row per point, so that two people at
 * different points merge without noticing and two at the same point are a
 * conflict. A point is the field, and for a field of a repeating group the
 * group and the block, which the device names when it opens one; it is
 * answered once among the rows that are not marked.
 *
 * A row carries the property and the area of its activity, kept by the key
 * over `(tenant_id, property_id, area_id)` with ON UPDATE CASCADE, and the
 * policy `within_areas` (ADR 0003). A check point keeps its result, its
 * remark and a photo; a photo field the document of the photo, which hangs
 * on the same activity, as the key says; every other field its value as the
 * text of its JSON, a measured value outside its limit with a remark beside
 * it. Once the activity is signed, nothing changes an answer: the trigger
 * `answers_kept_once_signed` of the migration holds that for every role.
 */
export const activityAnswers = pgTable(
  'activity_answers',
  {
    id: primaryId<'activity-answer'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    activityId: reference<'activity'>('activity_id').notNull(),
    groupKey: text('group_key'),
    blockKey: text('block_key'),
    fieldKey: text('field_key').notNull(),
    value: text('value'),
    result: checkPointResult('result'),
    remark: text('remark'),
    attachmentId: reference<'attachment'>('attachment_id'),
    // The photos of the point after the first, in the order they were added
    // (#451). A list has no key behind each entry; the trigger
    // `answers_more_photos_at_their_activity` of the migration holds them to
    // documents of the activity, as the key below holds the first.
    moreAttachmentIds: uuid('more_attachment_ids')
      .array()
      .$type<readonly AttachmentId[]>()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    // The asset of a point for every asset of a kind the answer is about
    // (#343): one of those its round was given for the point, as the trigger
    // `answers_about_the_assets_of_their_point` of the migration holds.
    assetId: reference<'asset'>('asset_id'),
    ...timestamps,
    ...syncColumns,
  },
  // Typed, because the keys lean on the documents, which lean on the defects,
  // which lean on these answers: inferred, the type of each would wait for
  // the next.
  (table): PgTableExtraConfigValue[] => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    withinLimits(table.propertyId, kindOfItsActivity(table.activityId)),
    unique('activity_answers_tenant_id_key').on(table.tenantId, table.id),
    // What a defect that came of an answer points at: the answer, on its
    // property and in its activity.
    unique('activity_answers_place').on(
      table.tenantId,
      table.id,
      table.propertyId,
      table.activityId,
    ),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.activityId, table.areaId],
      foreignColumns: [activities.tenantId, activities.id, activities.areaId],
      name: 'activity_answers_follow_their_activity',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'activity_answers_of_an_activity_of_their_property',
    }).onUpdate('cascade'),
    // A photo is a document at the same activity, on its property.
    foreignKey({
      columns: [table.tenantId, table.attachmentId, table.propertyId, table.activityId],
      foreignColumns: [
        attachments.tenantId,
        attachments.id,
        attachments.propertyId,
        attachments.activityId,
      ],
      name: 'activity_answers_photo_at_their_activity',
    }),
    // The asset of a point for every asset is one on the property of the
    // answer (#343).
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'activity_answers_about_an_asset_of_their_property',
    }),
    index('activity_answers_activity_idx').on(table.tenantId, table.activityId),
    // One answer per point among the rows that are not marked, a point for
    // every asset once for each of its assets (#343).
    uniqueIndex('activity_answers_once')
      .on(
        table.tenantId,
        table.activityId,
        sql`coalesce(${table.groupKey}, '')`,
        sql`coalesce(${table.blockKey}, '')`,
        table.fieldKey,
        sql`coalesce(${table.assetId}::text, '')`,
      )
      .where(sql`${table.deletedAt} is null`),
    // An answer about an asset stands in no group.
    check(
      'activity_answers_asset_outside_a_group',
      sql`${table.assetId} is null or ${table.groupKey} is null`,
    ),
    check('activity_answers_field_key_shaped', fieldKeyShaped(table.fieldKey)),
    check(
      'activity_answers_group_key_shaped',
      sql`${table.groupKey} is null or (${fieldKeyShaped(table.groupKey)})`,
    ),
    check(
      'activity_answers_block_key_shaped',
      sql`${table.blockKey} is null or (${table.blockKey} ~ '^[A-Za-z0-9_-]+$' and char_length(${table.blockKey}) <= ${sql.raw(String(answerLimits.key))})`,
    ),
    // A block belongs to a group, and an answer in a group names its block.
    check(
      'activity_answers_in_a_block_of_a_group',
      sql`(${table.groupKey} is null) = (${table.blockKey} is null)`,
    ),
    check(
      'activity_answers_value_shaped',
      sql`${table.value} is null or char_length(${table.value}) between 1 and ${sql.raw(String(answerLimits.value))}`,
    ),
    check('activity_answers_remark_shaped', optionalTrimmed(table.remark, answerLimits.remark)),
    // A check point holds its result and no value; every answer says something.
    check(
      'activity_answers_value_or_result',
      sql`${table.value} is null or ${table.result} is null`,
    ),
    // More photos only beside a first one, twenty at most with it (#451).
    check(
      'activity_answers_more_photos_beside_the_first',
      sql`cardinality(${table.moreAttachmentIds}) = 0 or (${table.attachmentId} is not null and cardinality(${table.moreAttachmentIds}) < ${sql.raw(String(answerLimits.photos))})`,
    ),
    check(
      'activity_answers_say_something',
      sql`num_nonnulls(${table.value}, ${table.result}, ${table.attachmentId}) >= 1`,
    ),
  ],
)
