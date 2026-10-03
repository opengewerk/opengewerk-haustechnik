import {
  countings,
  dutyBases,
  dutyLimits,
  dutyPerformers,
  longestIntervalDays,
  longestIntervalMonths,
} from '@opengewerk/haustechnik-domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { buildings, optionalTrimmed, properties, rooms, trimmed } from './locations.js'

// The duties of an operator (section 2.3 of the concept, ADR 0002, points 10
// and 11): a duty at exactly one of an asset, a room, a building or the
// property itself, and the proposals of the catalogue the operator dismissed.
// A proposal is no record; what is kept is the decision. Every row carries the
// property and the area of the place it belongs to, kept by the key over
// `(tenant_id, property_id, area_id)` with ON UPDATE CASCADE, and the policy
// `within_areas` (ADR 0003). The rows carry the columns of the sync; which
// device holds which comes with the rules of the sync (#27).

/** How the next appointment is counted, from the list in `domain`. */
export const dutyCounting = pgEnum('duty_counting', countings)

/** Where a duty of the operator's own comes from. */
export const dutyBasis = pgEnum('duty_basis', dutyBases)

/** Who performs a duty. */
export const dutyPerformer = pgEnum('duty_performer', dutyPerformers)

/** The bounds of an interval, the same as the deadline engine's. */
function intervalBounds(days: unknown, months: unknown) {
  return sql`(${days} is null or ${days} between 1 and ${sql.raw(String(longestIntervalDays))})
    and (${months} is null or ${months} between 1 and ${sql.raw(String(longestIntervalMonths))})`
}

/**
 * A duty of an operator. One from the catalogue names its duty kind with the
 * version that was confirmed and hangs on an asset, because a duty kind is
 * proposed for the kinds of asset its scope names; whether the catalogue
 * knows the kind, the route asks. One of the operator's own has its name, its
 * basis and the source it names instead, and may hang on any of the four.
 *
 * The interval stands in days or in months. Where the kind has a maximum, the
 * maximum of the day it was confirmed stands beside it, and the database
 * refuses a longer interval: a confirmed duty does not change quietly when the
 * law does (section 2.3), and a maximum may only be shortened.
 */
export const duties = pgTable(
  'duties',
  {
    id: primaryId<'duty'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    buildingId: reference<'building'>('building_id'),
    roomId: reference<'room'>('room_id'),
    assetId: reference<'asset'>('asset_id'),
    kind: text('kind'),
    kindVersion: integer('kind_version'),
    label: text('label'),
    basis: dutyBasis('basis'),
    sourceNote: text('source_note'),
    counting: dutyCounting('counting').notNull(),
    intervalDays: integer('interval_days'),
    intervalMonths: integer('interval_months'),
    intervalReason: text('interval_reason'),
    maximumDays: integer('maximum_days'),
    maximumMonths: integer('maximum_months'),
    responsibleUserId: text('responsible_user_id'),
    performer: dutyPerformer('performer'),
    performerNote: text('performer_note'),
    confirmedBy: text('confirmed_by').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    endsOn: date('ends_on', { mode: 'string' }),
    endReason: text('end_reason'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('duties_tenant_id_key').on(table.tenantId, table.id),
    // What the evidence of a duty points at, on the property of the duty.
    unique('duties_place').on(table.tenantId, table.id, table.propertyId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'duties_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'duties_at_a_building_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'duties_at_a_room_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'duties_at_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.responsibleUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duties_responsible_works_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.confirmedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duties_confirmed_by_somebody_here',
    }),
    index('duties_property_idx').on(table.tenantId, table.propertyId),
    index('duties_asset_idx').on(table.tenantId, table.assetId),
    // A duty kind is confirmed once for an asset while that duty stands;
    // after it ended, it may be confirmed again.
    uniqueIndex('duties_kind_once')
      .on(table.tenantId, table.assetId, table.kind)
      .where(
        sql`${table.kind} is not null and ${table.deletedAt} is null and ${table.endsOn} is null`,
      ),
    // At most one of building, room and asset; none is the property itself.
    check(
      'duties_one_target',
      sql`num_nonnulls(${table.buildingId}, ${table.roomId}, ${table.assetId}) <= 1`,
    ),
    // From the catalogue, at an asset and with its version; or the operator's
    // own, with its name, its basis and its source.
    check(
      'duties_from_the_catalogue_or_own',
      sql`(${table.kind} is not null and ${table.kindVersion} is not null and ${table.assetId} is not null
          and ${table.label} is null and ${table.basis} is null and ${table.sourceNote} is null)
        or (${table.kind} is null and ${table.kindVersion} is null
          and ${table.label} is not null and ${table.basis} is not null and ${table.sourceNote} is not null)`,
    ),
    check('duties_kind_shaped', optionalTrimmed(table.kind, dutyLimits.kind)),
    check(
      'duties_kind_version_shaped',
      sql`${table.kindVersion} is null or ${table.kindVersion} >= 1`,
    ),
    check('duties_label_shaped', optionalTrimmed(table.label, dutyLimits.label)),
    check('duties_source_note_shaped', optionalTrimmed(table.sourceNote, dutyLimits.sourceNote)),
    check(
      'duties_interval_reason_shaped',
      optionalTrimmed(table.intervalReason, dutyLimits.intervalReason),
    ),
    check(
      'duties_performer_note_shaped',
      optionalTrimmed(table.performerNote, dutyLimits.performerNote),
    ),
    check('duties_end_reason_shaped', optionalTrimmed(table.endReason, dutyLimits.endReason)),
    // A reason for an end only with the day it ends.
    check('duties_end_whole', sql`${table.endReason} is null or ${table.endsOn} is not null`),
    check(
      'duties_interval_one_unit',
      sql`(${table.intervalDays} is null) <> (${table.intervalMonths} is null)`,
    ),
    check('duties_interval_in_bounds', intervalBounds(table.intervalDays, table.intervalMonths)),
    check(
      'duties_maximum_one_unit',
      sql`${table.maximumDays} is null or ${table.maximumMonths} is null`,
    ),
    check(
      'duties_maximum_in_bounds',
      sql`(${table.maximumDays} is null or ${table.maximumDays} >= 1)
      and (${table.maximumMonths} is null or ${table.maximumMonths} >= 1)`,
    ),
    // Never longer than the maximum, in the unit the maximum has.
    check(
      'duties_within_their_maximum',
      sql`(${table.maximumDays} is null or ${table.intervalDays} <= ${table.maximumDays})
        and (${table.maximumMonths} is null or ${table.intervalMonths} <= ${table.maximumMonths})`,
    ),
    // § 14 Abs. 5 BetrSichV gives the appointment as a month.
    check(
      'duties_betrsichv_in_months',
      sql`${table.counting} <> 'betrsichv' or ${table.intervalMonths} is not null`,
    ),
  ],
)

/**
 * A proposal of the catalogue the operator dismissed, with the reason and the
 * person (ADR 0002, point 11). Proposals are made for assets, so a dismissal
 * is one for an asset. Withdrawing it marks it; the proposal is there again.
 */
export const dutyDismissals = pgTable(
  'duty_dismissals',
  {
    id: primaryId<'duty-dismissal'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    assetId: reference<'asset'>('asset_id').notNull(),
    kind: text('kind').notNull(),
    kindVersion: integer('kind_version').notNull(),
    reason: text('reason').notNull(),
    dismissedBy: text('dismissed_by').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('duty_dismissals_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'duty_dismissals_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'duty_dismissals_of_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.dismissedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duty_dismissals_by_somebody_here',
    }),
    index('duty_dismissals_asset_idx').on(table.tenantId, table.assetId),
    uniqueIndex('duty_dismissals_once')
      .on(table.tenantId, table.assetId, table.kind)
      .where(sql`${table.deletedAt} is null`),
    check('duty_dismissals_kind_shaped', trimmed(table.kind, dutyLimits.kind)),
    check('duty_dismissals_kind_version_shaped', sql`${table.kindVersion} >= 1`),
    check('duty_dismissals_reason_shaped', trimmed(table.reason, dutyLimits.dismissalReason)),
  ],
)
