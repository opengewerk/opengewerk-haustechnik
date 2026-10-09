import { deadlinesSchema, reference } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index } from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { defects } from './defects.js'
import { duties } from './duties.js'
import { properties } from './locations.js'
import { roundPlans } from './round-plans.js'

/**
 * What a deadline of this application hangs on, beside its source: the duty,
 * the defect (#116) or the plan of a round (#113) it follows, with the
 * property and the area of that,
 * so that a deadline stays in the areas of the person who asks, like every
 * row with a place (ADR 0003).
 */
const deadlineColumns = {
  dutyId: reference<'duty'>('duty_id'),
  defectId: reference<'defect'>('defect_id'),
  roundPlanId: reference<'round_plan'>('round_plan_id'),
  /** The property whose meters are to be read, the source `meter` (#120). */
  meterPropertyId: reference<'property'>('meter_property_id'),
  propertyId: reference<'property'>('property_id').notNull(),
  areaId: reference<'area'>('area_id').notNull(),
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
    withinAreas(),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'deadlines_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.dutyId, table.propertyId],
      foreignColumns: [duties.tenantId, duties.id, duties.propertyId],
      name: 'deadlines_of_a_duty_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.defectId, table.propertyId],
      foreignColumns: [defects.tenantId, defects.id, defects.propertyId],
      name: 'deadlines_of_a_defect_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.roundPlanId, table.propertyId],
      foreignColumns: [roundPlans.tenantId, roundPlans.id, roundPlans.propertyId],
      name: 'deadlines_of_a_plan_of_their_property',
    }),
    index('deadlines_duty_idx').on(table.tenantId, table.dutyId),
    index('deadlines_defect_idx').on(table.tenantId, table.defectId),
    index('deadlines_round_plan_idx').on(table.tenantId, table.roundPlanId),
    // The meters of a property are read for the property they hang on.
    check(
      'deadlines_meters_of_their_property',
      sql`${table.meterPropertyId} is null or ${table.meterPropertyId} = ${table.propertyId}`,
    ),
    // Each follows one source: a duty, a defect, the plan of a round or the
    // meters of a property.
    check(
      'deadlines_follow_one_source',
      sql`num_nonnulls(${table.dutyId}, ${table.defectId}, ${table.roundPlanId}, ${table.meterPropertyId}) = 1`,
    ),
  ],
})
