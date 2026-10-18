import { deadlinesSchema, reference } from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, text } from 'drizzle-orm/pg-core'

import { workOrders } from './activities.js'
import { withinAreasOrNone } from './areas.js'
import { assets } from './assets.js'
import { attachments } from './attachments.js'
import { contracts } from './contracts.js'
import { defects } from './defects.js'
import { dutyDelegations } from './delegations.js'
import { evidence } from './evidence.js'
import { qualifications } from './qualifications.js'
import { duties } from './duties.js'
import { properties } from './locations.js'
import { roundPlans } from './round-plans.js'
import { tasks } from './tasks.js'
import { kindOfItsDuty, withinLimits } from './limit-policies.js'

/**
 * What a deadline of this application hangs on, beside its source: the duty,
 * the defect (#116) or the plan of a round (#113) it follows, with the
 * property and the area of that,
 * so that a deadline stays in the areas of the person who asks, like every
 * row with a place (ADR 0003).
 *
 * `taskId` is no source: it names the task the engine made of the deadline
 * (#242), so that a deadline has one task at a time, however often its due
 * day comes or moves. No source writes it, and so no pass takes it away.
 */
const deadlineColumns = {
  dutyId: reference<'duty'>('duty_id'),
  defectId: reference<'defect'>('defect_id'),
  roundPlanId: reference<'round_plan'>('round_plan_id'),
  /** The property whose meters are to be read, the source `meter` (#120). */
  meterPropertyId: reference<'property'>('meter_property_id'),
  /** The document whose newest version names a day, the sources `document` and `risk_assessment` (#327). */
  attachmentId: reference<'attachment'>('attachment_id'),
  /** The contract whose day to give notice or end it follows, the sources `contract_notice` and `contract_end` (#329). */
  contractId: reference<'contract'>('contract_id'),
  /** The asset whose warranty ends, the source `warranty` (#329). */
  warrantyAssetId: reference<'asset'>('warranty_asset_id'),
  /** The accepted work order whose warranty ends, the source `warranty` (#329). */
  warrantyOrderId: reference<'work-order'>('warranty_order_id'),
  /** The delegation of duties whose end it follows, the source `delegation` (#336). */
  delegationId: reference<'duty-delegation'>('delegation_id'),
  /** The qualification of a person whose expiry it follows, the source `qualification` (#337). */
  qualificationId: reference<'qualification'>('qualification_id'),
  /** The evidence whose retention ends, the source `evidence` (#340). */
  evidenceId: reference<'evidence'>('evidence_id'),
  /** The person whose access ends or whose data goes after it, the sources `membership` and `membership_removal` (#356). */
  memberUserId: text('member_user_id'),
  /** The task the engine made of this deadline, the action `task` (#242). */
  taskId: reference<'task'>('task_id'),
  // None for the document of a contractor (#328) and for a contract (#329), which lie in no area.
  propertyId: reference<'property'>('property_id'),
  areaId: reference<'area'>('area_id'),
}

/** The columns this application gives its deadlines, for the engine of the foundation. */
export type ApplicationDeadlineColumns = typeof deadlineColumns

/**
 * The deadlines of an operator, one per kind and source (#25, section 2.4 of
 * the concept): the table of the foundation (ADR 0010 in the repository
 * opengewerk) with the duty, its property and its area, the key over the
 * property with ON UPDATE CASCADE, and the restrictive policy `within_areas`,
 * which the comparison with the building blocks takes as this application's
 * own (`foundation.test.ts`). A pass of the engine goes through every area
 * of an operator; the routes see what the person sees.
 *
 * What an operator sets for a kind of deadline, and when the deadlines of an
 * operator were last gone through, are tables of the foundation itself
 * (`deadline_settings`, `deadline_runs`).
 */
export const { deadlineStatus, deadlines } = deadlinesSchema({
  columns: deadlineColumns,
  constraints: (table) => [
    // The deadline of a contractor's document lies in no area (#328).
    withinAreasOrNone(),
    // Within the limits of an access from outside by the duty it is of (#339).
    withinLimits(table.propertyId, kindOfItsDuty(table.dutyId)),
    // The area of what the row hangs on (ADR 0003, addendum of #306).
    foreignKey({
      columns: [table.tenantId, table.dutyId, table.areaId],
      foreignColumns: [duties.tenantId, duties.id, duties.areaId],
      name: 'deadlines_follow_their_duty',
    }).onUpdate('cascade'),
    // The end of the retention of an evidence (#340), in the area of the evidence.
    foreignKey({
      columns: [table.tenantId, table.evidenceId, table.areaId],
      foreignColumns: [evidence.tenantId, evidence.id, evidence.areaId],
      name: 'deadlines_follow_their_evidence',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.areaId],
      foreignColumns: [defects.tenantId, defects.id, defects.areaId],
      name: 'deadlines_follow_their_defect',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roundPlanId, table.areaId],
      foreignColumns: [roundPlans.tenantId, roundPlans.id, roundPlans.areaId],
      name: 'deadlines_follow_their_plan',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.meterPropertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'deadlines_of_meters_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.attachmentId, table.areaId],
      foreignColumns: [attachments.tenantId, attachments.id, attachments.areaId],
      name: 'deadlines_follow_their_document',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.attachmentId, table.propertyId],
      foreignColumns: [attachments.tenantId, attachments.id, attachments.propertyId],
      name: 'deadlines_of_a_document_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.dutyId, table.propertyId],
      foreignColumns: [duties.tenantId, duties.id, duties.propertyId],
      name: 'deadlines_of_a_duty_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.propertyId],
      foreignColumns: [defects.tenantId, defects.id, defects.propertyId],
      name: 'deadlines_of_a_defect_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.roundPlanId, table.propertyId],
      foreignColumns: [roundPlans.tenantId, roundPlans.id, roundPlans.propertyId],
      name: 'deadlines_of_a_plan_of_their_property',
    }).onUpdate('cascade'),
    // Over the tenant and the property, like every key to a row with a place:
    // a deadline cannot name a task of another operator or of another property.
    foreignKey({
      columns: [table.tenantId, table.taskId, table.propertyId],
      foreignColumns: [tasks.tenantId, tasks.id, tasks.propertyId],
      name: 'deadlines_with_a_task_of_their_property',
    }),
    index('deadlines_duty_idx').on(table.tenantId, table.dutyId),
    index('deadlines_defect_idx').on(table.tenantId, table.defectId),
    index('deadlines_round_plan_idx').on(table.tenantId, table.roundPlanId),
    index('deadlines_attachment_idx').on(table.tenantId, table.attachmentId),
    // The contract, which lies in no area, and the warranty of an asset or of a work order (#329).
    foreignKey({
      columns: [table.tenantId, table.contractId],
      foreignColumns: [contracts.tenantId, contracts.id],
      name: 'deadlines_of_a_contract',
    }),
    foreignKey({
      columns: [table.tenantId, table.delegationId],
      foreignColumns: [dutyDelegations.tenantId, dutyDelegations.id],
      name: 'deadlines_of_a_delegation',
    }),
    foreignKey({
      columns: [table.tenantId, table.qualificationId],
      foreignColumns: [qualifications.tenantId, qualifications.id],
      name: 'deadlines_of_a_qualification',
    }),
    foreignKey({
      columns: [table.tenantId, table.memberUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'deadlines_of_an_access',
    }),
    foreignKey({
      columns: [table.tenantId, table.warrantyAssetId, table.areaId],
      foreignColumns: [assets.tenantId, assets.id, assets.areaId],
      name: 'deadlines_follow_their_asset',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.warrantyAssetId, table.propertyId],
      foreignColumns: [assets.tenantId, assets.id, assets.propertyId],
      name: 'deadlines_of_an_asset_of_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.warrantyOrderId, table.areaId],
      foreignColumns: [workOrders.tenantId, workOrders.id, workOrders.areaId],
      name: 'deadlines_follow_their_work_order',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.warrantyOrderId, table.propertyId],
      foreignColumns: [workOrders.tenantId, workOrders.id, workOrders.propertyId],
      name: 'deadlines_of_a_work_order_of_their_property',
    }).onUpdate('cascade'),
    index('deadlines_contract_idx').on(table.tenantId, table.contractId),
    index('deadlines_delegation_idx').on(table.tenantId, table.delegationId),
    index('deadlines_qualification_idx').on(table.tenantId, table.qualificationId),
    index('deadlines_evidence_idx').on(table.tenantId, table.evidenceId),
    index('deadlines_member_idx').on(table.tenantId, table.memberUserId),
    index('deadlines_warranty_asset_idx').on(table.tenantId, table.warrantyAssetId),
    index('deadlines_warranty_order_idx').on(table.tenantId, table.warrantyOrderId),
    // The meters of a property are read for the property they hang on.
    check(
      'deadlines_meters_of_their_property',
      sql`${table.meterPropertyId} is null or ${table.meterPropertyId} = ${table.propertyId}`,
    ),
    // Each follows one source: a duty, a defect, the plan of a round, the
    // meters of a property, a document, a contract or a warranty.
    // Without a place only the deadline of a document, which then is a
    // contractor's (#328) or a contract's, that of a contract (#329), that
    // of a delegation of duties (#336), that of a qualification (#337) and
    // those of an access (#356).
    check(
      'deadlines_at_a_place_or_of_a_document',
      sql`(${table.areaId} is null) = (${table.propertyId} is null) and (${table.propertyId} is not null or ${table.attachmentId} is not null or ${table.contractId} is not null or ${table.delegationId} is not null or ${table.qualificationId} is not null or ${table.memberUserId} is not null) and (${table.contractId} is null or ${table.propertyId} is null) and (${table.delegationId} is null or ${table.propertyId} is null) and (${table.qualificationId} is null or ${table.propertyId} is null) and (${table.memberUserId} is null or ${table.propertyId} is null)`,
    ),
    check(
      'deadlines_follow_one_source',
      sql`num_nonnulls(${table.dutyId}, ${table.defectId}, ${table.roundPlanId}, ${table.meterPropertyId}, ${table.attachmentId}, ${table.contractId}, ${table.warrantyAssetId}, ${table.warrantyOrderId}, ${table.delegationId}, ${table.qualificationId}, ${table.evidenceId}, ${table.memberUserId}) = 1`,
    ),
  ],
})
