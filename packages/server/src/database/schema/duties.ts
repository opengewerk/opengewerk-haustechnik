import {
  countings,
  dutyBases,
  dutyLimits,
  dutyPerformers,
  dutyTasks,
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
  type PgTableExtraConfigValue,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { areaFromPropertyColumn, areaFromTheProperty, withinAreas } from './areas.js'
import { assets } from './assets.js'
import { attachments, attachmentVersions } from './attachments.js'
import { contracts } from './contracts.js'
import { contractors } from './contractors.js'
import { dutyDelegations } from './delegations.js'
import { kindOfItsAsset, withinLimits } from './limit-policies.js'
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

/** What a duty of the operator's own has somebody do, from the list of the catalogue. */
export const dutyTask = pgEnum('duty_task', dutyTasks)

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
 *
 * A new version of a package does not change a confirmed duty quietly either
 * (ADR 0005, point 10, #139). Beside the maximum stands the guide of the day
 * the duty was confirmed, so that a guide corrected later is noticed, and
 * what the catalogue said when the operator left the duty as it is: the
 * newest version of its kind, the value of the rule of its interval, and the
 * reason. Who decided and when, the log of changes says.
 *
 * The document that bears the interval, on request (section 4.3, #74): a
 * document of the same property, with the version of the day the reference
 * was set, both or neither. The keys hold that the document is one of the
 * property of the duty and that the version is one of that document; which
 * records of the property the document may hang on, the route asks.
 */
export const duties = pgTable(
  'duties',
  {
    id: primaryId<'duty'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    areaFromPropertyId: areaFromPropertyColumn(),
    buildingId: reference<'building'>('building_id'),
    roomId: reference<'room'>('room_id'),
    assetId: reference<'asset'>('asset_id'),
    kind: text('kind'),
    kindVersion: integer('kind_version'),
    label: text('label'),
    basis: dutyBasis('basis'),
    sourceNote: text('source_note'),
    task: dutyTask('task'),
    counting: dutyCounting('counting').notNull(),
    intervalDays: integer('interval_days'),
    intervalMonths: integer('interval_months'),
    intervalReason: text('interval_reason'),
    intervalDocumentId: reference<'attachment'>('interval_document_id'),
    intervalDocumentVersionId: reference<'attachment-version'>('interval_document_version_id'),
    maximumDays: integer('maximum_days'),
    maximumMonths: integer('maximum_months'),
    guideDays: integer('guide_days'),
    guideMonths: integer('guide_months'),
    keptVersion: integer('kept_version'),
    keptDays: integer('kept_days'),
    keptMonths: integer('kept_months'),
    keptReason: text('kept_reason'),
    responsibleUserId: text('responsible_user_id'),
    /** The delegation the one who answers comes from (#336); none: without a delegation, or nobody. */
    responsibleDelegationId: reference<'duty-delegation'>('responsible_delegation_id'),
    performer: dutyPerformer('performer'),
    performerNote: text('performer_note'),
    contractorId: reference<'contractor'>('contractor_id'),
    // The contract of that firm the duty fulfils (#329).
    contractId: reference<'contract'>('contract_id'),
    confirmedBy: text('confirmed_by').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    endsOn: date('ends_on', { mode: 'string' }),
    endReason: text('end_reason'),
    ...timestamps,
    ...syncColumns,
  },
  // Typed, because the keys onto the documents close a circle: a document may
  // hang on an activity, and an activity names its duties.
  (table): PgTableExtraConfigValue[] => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    // Only the properties and kinds an access from outside is limited to (#339).
    withinLimits(table.propertyId, kindOfItsAsset(table.assetId)),
    unique('duties_tenant_id_key').on(table.tenantId, table.id),
    // What a row that hangs on it points at for its area (ADR 0003, addendum of #306).
    unique('duties_area_key').on(table.tenantId, table.id, table.areaId),
    // What the evidence of a duty points at, on the property of the duty.
    unique('duties_place').on(table.tenantId, table.id, table.propertyId),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.areaId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.areaId],
      name: 'duties_follow_their_building',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.areaId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.areaId],
      name: 'duties_follow_their_room',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: 'duties_follow_their_asset',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.areaFromPropertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'duties_follow_their_property',
    }).onUpdate('cascade'),
    areaFromTheProperty('duties_area_from_the_property', table, [
      table.buildingId,
      table.roomId,
      table.assetId,
    ]),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'duties_at_a_building_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roomId, table.propertyId],
      foreignColumns: [rooms.tenantId, rooms.id, rooms.propertyId],
      name: 'duties_at_a_room_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'duties_at_an_asset_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.responsibleUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duties_responsible_works_here',
    }),
    // The person who answers from a delegation is the one it goes to (#336).
    foreignKey({
      columns: [table.tenantId, table.responsibleDelegationId, table.responsibleUserId],
      foreignColumns: [
        dutyDelegations.tenantId,
        dutyDelegations.id,
        dutyDelegations.delegateUserId,
      ],
      name: 'duties_responsible_from_their_delegation',
    }),
    check(
      'duties_delegation_names_a_person',
      sql`${table.responsibleDelegationId} is null or ${table.responsibleUserId} is not null`,
    ),
    foreignKey({
      columns: [table.tenantId, table.confirmedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'duties_confirmed_by_somebody_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.intervalDocumentId, table.propertyId],
      foreignColumns: [attachments.tenantId, attachments.id, attachments.propertyId],
      name: 'duties_interval_document_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.intervalDocumentVersionId, table.intervalDocumentId],
      foreignColumns: [
        attachmentVersions.tenantId,
        attachmentVersions.id,
        attachmentVersions.attachmentId,
      ],
      name: 'duties_interval_document_version_of_it',
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
    // What it has somebody do, a duty from the catalogue takes from its kind.
    // One of the operator's own names it; the route asks for it, and a row
    // from before the column has none.
    check('duties_task_of_their_own', sql`${table.kind} is null or ${table.task} is null`),
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
    // The firm out of the list of the operator (#328), which lies in no area.
    foreignKey({
      columns: [table.tenantId, table.contractorId],
      foreignColumns: [contractors.tenantId, contractors.id],
      name: 'duties_name_their_contractor',
    }),
    index('duties_contractor_idx').on(table.tenantId, table.contractorId),
    index('duties_delegation_idx').on(table.tenantId, table.responsibleDelegationId),
    // A firm out of the list only where a contractor carries the duty out.
    check(
      'duties_contractor_for_a_contractor',
      sql`${table.contractorId} is null or ${table.performer} = 'contractor'`,
    ),
    // A contract of the firm that carries the duty out (#329): over the firm, so
    // that it is one of the firm. A contract named by a duty keeps its firm.
    foreignKey({
      columns: [table.tenantId, table.contractId, table.contractorId],
      foreignColumns: [contracts.tenantId, contracts.id, contracts.contractorId],
      name: 'duties_on_a_contract_of_their_contractor',
    }),
    index('duties_contract_idx').on(table.tenantId, table.contractId),
    check(
      'duties_contract_with_its_contractor',
      sql`${table.contractId} is null or ${table.contractorId} is not null`,
    ),
    // A reason for an end only with the day it ends.
    check('duties_end_whole', sql`${table.endReason} is null or ${table.endsOn} is not null`),
    // The document and its version come together, or neither.
    check(
      'duties_interval_document_whole',
      sql`(${table.intervalDocumentId} is null) = (${table.intervalDocumentVersionId} is null)`,
    ),
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
    check('duties_guide_one_unit', sql`${table.guideDays} is null or ${table.guideMonths} is null`),
    check(
      'duties_guide_in_bounds',
      sql`(${table.guideDays} is null or ${table.guideDays} >= 1)
      and (${table.guideMonths} is null or ${table.guideMonths} >= 1)`,
    ),
    // A maximum or a guide, never both: a kind names one kind of interval.
    check(
      'duties_maximum_or_guide',
      sql`num_nonnulls(${table.maximumDays}, ${table.maximumMonths}) = 0
        or num_nonnulls(${table.guideDays}, ${table.guideMonths}) = 0`,
    ),
    // Left as it is: against a version of its kind, with the reason, and the
    // value of the rule only beside both.
    check(
      'duties_kept_whole',
      sql`(${table.keptVersion} is null) = (${table.keptReason} is null)
        and (${table.keptVersion} is not null or num_nonnulls(${table.keptDays}, ${table.keptMonths}) = 0)`,
    ),
    check(
      'duties_kept_from_the_catalogue',
      sql`${table.keptVersion} is null or ${table.kind} is not null`,
    ),
    check(
      'duties_kept_version_shaped',
      sql`${table.keptVersion} is null or ${table.keptVersion} >= 1`,
    ),
    check('duties_kept_one_unit', sql`${table.keptDays} is null or ${table.keptMonths} is null`),
    check(
      'duties_kept_in_bounds',
      sql`(${table.keptDays} is null or ${table.keptDays} >= 1)
      and (${table.keptMonths} is null or ${table.keptMonths} >= 1)`,
    ),
    check('duties_kept_reason_shaped', optionalTrimmed(table.keptReason, dutyLimits.keptReason)),
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
    withinLimits(table.propertyId, kindOfItsAsset(table.assetId)),
    unique('duty_dismissals_tenant_id_key').on(table.tenantId, table.id),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.assetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: 'duty_dismissals_follow_their_asset',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.assetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'duty_dismissals_of_an_asset_of_their_property',
    }).onUpdate('cascade'),
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
