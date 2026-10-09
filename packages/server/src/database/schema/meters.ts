import { meterLimits, meterReadingSources } from '@opengewerk/haustechnik-domain'
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
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { activities } from './activities.js'
import { withinAreas } from './areas.js'
import { assets } from './assets.js'
import { optionalTrimmed, properties, trimmed } from './locations.js'

// What a measuring point holds beside its asset (section 4.9 of the concept,
// #119): what only a measuring point carries, its readings, the replacements
// of its meter and the periods it rests. A measuring point is an asset whose
// kind is a meter (ADR 0002, point 9); every row here hangs on that asset, on
// its property, and carries the property and the area of its place, kept by
// the key over `(tenant_id, property_id, area_id)` with ON UPDATE CASCADE, and
// the policy `within_areas` (ADR 0003). A figure is kept in thousandths of the
// unit of the meter, as a whole number; consumption is never kept.

/** How a reading came, from the list in `domain`. */
export const meterReadingSource = pgEnum('meter_reading_source', meterReadingSources)

/** A figure in thousandths of a unit, held exactly by a number of JavaScript. */
const figure = (name: string) => bigint(name, { mode: 'number' })

/** A figure from 0 to the largest one a measuring point takes. */
const figureShaped = (column: unknown) =>
  sql`${column} between 0 and ${sql.raw(String(meterLimits.valueMilli))}`

/**
 * What only a measuring point carries, one row per asset, made the first
 * time something of it is said: the factor its register is multiplied with,
 * the main meter it counts under, on the same property, its id in the
 * building management system, a note with who wrote it and since when, and a
 * lock with its reason and since when.
 */
export const meterPoints = pgTable(
  'meter_points',
  {
    id: primaryId<'meter-point'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    assetId: reference<'asset'>('asset_id').notNull(),
    conversionFactor: integer('conversion_factor'),
    mainMeterId: reference<'asset'>('main_meter_id'),
    controlId: text('control_id'),
    note: text('note'),
    noteBy: text('note_by'),
    notedOn: date('noted_on', { mode: 'string' }),
    lockReason: text('lock_reason'),
    lockedOn: date('locked_on', { mode: 'string' }),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('meter_points_tenant_id_key').on(table.tenantId, table.id),
    unique('meter_points_one_per_asset').on(table.tenantId, table.assetId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'meter_points_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'meter_points_of_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.mainMeterId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'meter_points_under_a_meter_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.noteBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'meter_points_noted_by_somebody_here',
    }),
    index('meter_points_main_meter_idx').on(table.tenantId, table.mainMeterId),
    check(
      'meter_points_factor_shaped',
      sql`${table.conversionFactor} is null or ${table.conversionFactor} between 1 and ${sql.raw(String(meterLimits.factor))}`,
    ),
    check(
      'meter_points_control_id_shaped',
      optionalTrimmed(table.controlId, meterLimits.controlId),
    ),
    check('meter_points_note_shaped', optionalTrimmed(table.note, meterLimits.note)),
    check('meter_points_lock_reason_shaped', optionalTrimmed(table.lockReason, meterLimits.reason)),
    // A note with who wrote it and since when, or none of the three.
    check(
      'meter_points_note_whole',
      sql`(${table.note} is null) = (${table.noteBy} is null) and (${table.note} is null) = (${table.notedOn} is null)`,
    ),
    // A lock with its reason and since when, or neither.
    check(
      'meter_points_lock_whole',
      sql`(${table.lockReason} is null) = (${table.lockedOn} is null)`,
    ),
    check(
      'meter_points_not_their_own_main_meter',
      sql`${table.mainMeterId} is distinct from ${table.assetId}`,
    ),
  ],
)

/**
 * A reading of a measuring point, written once: for a key date, the first of
 * a month, read on a day, with the figure, how it came, the round or the
 * protocol it came of, and who entered it, which the server writes. A
 * correction is a reading of its own for the same key date that names the
 * one it corrects and the reason; one reading of a key date is not a
 * correction, and a reading is corrected once.
 *
 * The callback of the constraints is typed by hand: the table points at
 * itself, and in such a circle TypeScript cannot infer its type (TS7022).
 */
export const meterReadings = pgTable(
  'meter_readings',
  {
    id: primaryId<'meter-reading'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    assetId: reference<'asset'>('asset_id').notNull(),
    keyDate: date('key_date', { mode: 'string' }).notNull(),
    readOn: date('read_on', { mode: 'string' }).notNull(),
    valueMilli: figure('value_milli').notNull(),
    source: meterReadingSource('source').notNull(),
    activityId: reference<'activity'>('activity_id'),
    correctsId: reference<'meter-reading'>('corrects_id'),
    correctionReason: text('correction_reason'),
    recordedBy: text('recorded_by').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table): PgTableExtraConfigValue[] => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('meter_readings_tenant_id_key').on(table.tenantId, table.id),
    // What a correction points at: a reading of the same property.
    unique('meter_readings_place').on(table.tenantId, table.id, table.propertyId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'meter_readings_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'meter_readings_of_an_asset_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.activityId, table.propertyId],
      foreignColumns: [activities.tenantId, activities.id, activities.propertyId],
      name: 'meter_readings_of_an_activity_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.correctsId, table.propertyId],
      foreignColumns: [table.tenantId, table.id, table.propertyId],
      name: 'meter_readings_correct_a_reading_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'meter_readings_recorded_by_somebody_here',
    }),
    index('meter_readings_asset_idx').on(table.tenantId, table.assetId, table.keyDate),
    // One reading for a key date that corrects nothing; the others correct.
    uniqueIndex('meter_readings_one_per_key_date')
      .on(table.tenantId, table.assetId, table.keyDate)
      .where(sql`${table.correctsId} is null and ${table.deletedAt} is null`),
    // A reading is corrected once; a second correction corrects the first.
    uniqueIndex('meter_readings_corrected_once')
      .on(table.tenantId, table.correctsId)
      .where(sql`${table.correctsId} is not null`),
    check('meter_readings_on_a_key_date', sql`extract(day from ${table.keyDate}) = 1`),
    check('meter_readings_value_shaped', figureShaped(table.valueMilli)),
    check(
      'meter_readings_correction_reason_shaped',
      optionalTrimmed(table.correctionReason, meterLimits.reason),
    ),
    // A correction names its reason, and only a correction has one.
    check(
      'meter_readings_corrected_with_a_reason',
      sql`(${table.correctsId} is null) = (${table.correctionReason} is null)`,
    ),
    check(
      'meter_readings_not_their_own_correction',
      sql`${table.correctsId} is distinct from ${table.id}`,
    ),
  ],
)

/**
 * The meter of a measuring point replaced on a day: the number and the last
 * figure of the old one, the number and the first figure of the new one.
 * Written once, one a day; the asset takes the number of the new meter in
 * the same transaction.
 */
export const meterExchanges = pgTable(
  'meter_exchanges',
  {
    id: primaryId<'meter-exchange'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    assetId: reference<'asset'>('asset_id').notNull(),
    exchangedOn: date('exchanged_on', { mode: 'string' }).notNull(),
    oldNumber: text('old_number').notNull(),
    oldEndMilli: figure('old_end_milli').notNull(),
    newNumber: text('new_number').notNull(),
    newStartMilli: figure('new_start_milli').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('meter_exchanges_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'meter_exchanges_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'meter_exchanges_of_an_asset_of_their_property',
    }),
    uniqueIndex('meter_exchanges_once_a_day').on(table.tenantId, table.assetId, table.exchangedOn),
    check('meter_exchanges_old_number_shaped', trimmed(table.oldNumber, meterLimits.meterNumber)),
    check('meter_exchanges_new_number_shaped', trimmed(table.newNumber, meterLimits.meterNumber)),
    check('meter_exchanges_old_end_shaped', figureShaped(table.oldEndMilli)),
    check('meter_exchanges_new_start_shaped', figureShaped(table.newStartMilli)),
  ],
)

/**
 * A period a measuring point rests, from a day and on request to a day, with
 * its reason. One without an end rests until somebody ends it. No reading is
 * asked for a key date in it, and a time that lies in it altogether has no
 * consumption.
 */
export const meterPauses = pgTable(
  'meter_pauses',
  {
    id: primaryId<'meter-pause'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    assetId: reference<'asset'>('asset_id').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }),
    reason: text('reason').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    unique('meter_pauses_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'meter_pauses_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'meter_pauses_of_an_asset_of_their_property',
    }),
    index('meter_pauses_asset_idx').on(table.tenantId, table.assetId),
    check('meter_pauses_reason_shaped', trimmed(table.reason, meterLimits.reason)),
    check(
      'meter_pauses_end_after_start',
      sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`,
    ),
  ],
)
