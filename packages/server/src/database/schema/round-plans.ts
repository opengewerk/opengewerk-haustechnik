import { planLimits, planRhythms, type Weekday } from '@opengewerk/haustechnik-domain'
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
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { withinAreas } from './areas.js'
import { buildings, properties } from './locations.js'
import { roundTemplates } from './round-templates.js'

/** How often a plan falls due, from the list in `domain`. */
export const roundPlanRhythm = pgEnum('round_plan_rhythm', planRhythms)

/**
 * The plans of the rounds of an operator (#113, section 4.5 of the concept):
 * the template, the place, the rhythm, the person or the area, the lead. The
 * deadline engine makes a round for every pass, once (`round.due`).
 *
 * A plan lies at a property or at a building there, in the area of the
 * property, like every row with a place: the key over the building names the
 * property as well, and the key over the property the area, with ON UPDATE
 * CASCADE (ADR 0002, ADR 0003). The policy `within_areas` lets through the
 * areas of the person asking.
 *
 * What a rhythm names it has, and what it does not name it leaves empty: a
 * daily plan its days of the week, a weekly plan its one day, a monthly plan
 * the day of the month, a yearly plan the day and the month. The days of the
 * week are counted as ISO 8601 does, Monday 1 to Sunday 7; that each stands
 * once is asked by the route, since a check cannot look into an array.
 *
 * The rows travel to a device, to read. No plan is deleted: one ends on a
 * day or rests, and the rounds it made stay. A building or a property that is
 * marked takes its plans along, by a trigger of the migration.
 */
export const roundPlans = pgTable(
  'round_plans',
  {
    id: primaryId<'round_plan'>(),
    ...tenantColumn,
    propertyId: reference<'property'>('property_id').notNull(),
    buildingId: reference<'building'>('building_id'),
    areaId: reference<'area'>('area_id').notNull(),
    templateId: reference<'round_template'>('template_id').notNull(),
    rhythm: roundPlanRhythm('rhythm').notNull(),
    weekdays: smallint('weekdays').array().$type<readonly Weekday[]>(),
    dayOfMonth: smallint('day_of_month'),
    month: smallint('month'),
    leadDays: smallint('lead_days').notNull().default(0),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }),
    resting: boolean('resting').notNull().default(false),
    skipHolidays: boolean('skip_holidays').notNull().default(false),
    performerUserId: text('performer_user_id'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    withinAreas(),
    // What a round and a deadline of a plan point at: a plan on their property.
    unique('round_plans_place').on(table.tenantId, table.id, table.propertyId),
    foreignKey({
      columns: [table.tenantId, table.propertyId, table.areaId],
      foreignColumns: [properties.tenantId, properties.id, properties.areaId],
      name: 'round_plans_follow_their_property',
    }).onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId, table.buildingId, table.propertyId],
      foreignColumns: [buildings.tenantId, buildings.id, buildings.propertyId],
      name: 'round_plans_at_a_building_of_their_property',
    }),
    foreignKey({
      columns: [table.tenantId, table.templateId],
      foreignColumns: [roundTemplates.tenantId, roundTemplates.id],
      name: 'round_plans_of_a_template',
    }),
    foreignKey({
      columns: [table.tenantId, table.performerUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'round_plans_performer_works_here',
    }),
    index('round_plans_property_idx').on(table.tenantId, table.propertyId),
    // What `planProblems` asks of each rhythm. A check that comes to NULL
    // holds, so an empty field has to make it false.
    check(
      'round_plans_days_of_their_rhythm',
      sql`coalesce(case ${table.rhythm}
        when 'daily' then cardinality(${table.weekdays}) between 1 and 7 and ${table.dayOfMonth} is null and ${table.month} is null
        when 'weekly' then cardinality(${table.weekdays}) = 1 and ${table.dayOfMonth} is null and ${table.month} is null
        when 'monthly' then ${table.weekdays} is null and ${table.dayOfMonth} between 1 and 31 and ${table.month} is null
        else ${table.weekdays} is null and ${table.month} between 1 and 12 and ${table.dayOfMonth} between 1 and (case when ${table.month} = 2 then 29 when ${table.month} in (4, 6, 9, 11) then 30 else 31 end)
      end, false)`,
    ),
    check(
      'round_plans_weekdays_shaped',
      sql`${table.weekdays} is null or (${table.weekdays} <@ '{1,2,3,4,5,6,7}'::smallint[] and array_position(${table.weekdays}, null) is null)`,
    ),
    check(
      'round_plans_lead',
      sql`${table.leadDays} between 0 and ${sql.raw(String(planLimits.leadDays))}`,
    ),
    check(
      'round_plans_in_order',
      sql`${table.endsOn} is null or ${table.startsOn} <= ${table.endsOn}`,
    ),
  ],
)
