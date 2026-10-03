import { areaNameMaxLength } from '@opengewerk/haustechnik-domain'
import {
  applicationRole,
  primaryId,
  reference,
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
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// The areas of a tenant and who sees which (section 2.8 of the concept,
// ADR 0003). What a person may see is not handed to the database by the
// application: two functions of the database read it from these tables, from
// the person and the tenant the foundation sets for every transaction, and
// the policy of every table with a place asks them. A route that is wrong can
// therefore not widen anything. The functions, the defaults a new membership
// is given and the reasons for both are in the migration that brings them,
// `0002_areas`.

/**
 * The areas of a tenant. A tenant begins with one, made with its first
 * membership, and every property will name exactly one.
 *
 * Not itself bounded by area: the areas, like the catalogue and the settings,
 * belong to the whole tenant (ADR 0003, point 6). Removing one that a property
 * still names is refused by the key of the property.
 */
export const areas = pgTable(
  'areas',
  {
    id: primaryId<'area'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // What the keys of the memberships and of the properties point at, with
    // the tenant first on both sides.
    unique('areas_tenant_id_key').on(table.tenantId, table.id),
    uniqueIndex('areas_name_once').on(table.tenantId, sql`lower(${table.name})`),
    // What `areaNameProblem` asks before anything reaches this table, held
    // here for every other way in.
    check(
      'areas_name_shaped',
      sql`${table.name} = btrim(${table.name}) and char_length(${table.name}) between 1 and ${sql.raw(String(areaNameMaxLength))}`,
    ),
  ],
)

/**
 * A membership that holds in every area, now and in every area made later.
 *
 * A row of its own and no column on the membership, as ADR 0003 first had it:
 * `memberships` is a table of the foundation, and a column of this application
 * on it would be a deviation from the building blocks that every comparison
 * reports, and one the vocabulary of the change log could not name. Removed
 * with the membership.
 */
export const memberAllAreas = pgTable(
  'member_all_areas',
  {
    id: primaryId<'member-all-areas'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('member_all_areas_once').on(table.tenantId, table.userId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'member_all_areas_person_works_here',
    }).onDelete('cascade'),
  ],
)

/**
 * An area a membership holds in, one row each. What a person sees of a tenant
 * that has more than one area is the areas named here, unless a row above
 * gives them all of them.
 */
export const memberAreas = pgTable(
  'member_areas',
  {
    id: primaryId<'member-area'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    areaId: reference<'area'>('area_id').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // Also the index the functions find the areas of a person by.
    unique('member_areas_once').on(table.tenantId, table.userId, table.areaId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'member_areas_person_works_here',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.areaId],
      foreignColumns: [areas.tenantId, areas.id],
      name: 'member_areas_area_of_the_tenant',
    }).onDelete('cascade'),
  ],
)

/**
 * Who stands in for whom, from which day until which, both included. On those
 * days the substitute sees the areas of the absent person beside their own,
 * and on no other day: nothing is copied and nothing has to be cleared up
 * afterwards (ADR 0003, point 3). The day is the day in Germany, not the one
 * of the server's clock.
 *
 * The absent person's membership may be blocked meanwhile, which is the case
 * the concept names: somebody leaves, and the substitution takes over. The
 * substitute's may not; a blocked person sees nothing at all.
 */
export const substitutions = pgTable(
  'substitutions',
  {
    id: primaryId<'substitution'>(),
    ...tenantColumn,
    substituteUserId: text('substitute_user_id').notNull(),
    absentUserId: text('absent_user_id').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.substituteUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'substitutions_substitute_works_here',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.absentUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'substitutions_absent_works_here',
    }).onDelete('cascade'),
    // What `substitutionProblem` asks, held here for every other way in.
    check('substitutions_not_oneself', sql`${table.substituteUserId} <> ${table.absentUserId}`),
    check('substitutions_in_order', sql`${table.startsOn} <= ${table.endsOn}`),
    index('substitutions_substitute_idx').on(table.tenantId, table.substituteUserId),
  ],
)

/**
 * The expression of the policy below, as the migrations write it.
 *
 * The two functions are called inside a sub-select, and that is not a matter
 * of style. Called directly, PostgreSQL evaluates both for every row, STABLE
 * or not; as a sub-select they run once per statement. Measured for ADR 0003
 * the difference is a tenth of a millisecond against two hundred times that,
 * and no test that compares results can see it, so the catalogue test of the
 * areas reads the expression of every such policy and refuses a direct call.
 *
 * The cast keeps the second half an array comparison: `= any (select ...)`
 * without it would compare against the rows of a sub-select, each of them an
 * array.
 */
export const withinAreasExpression =
  '(SELECT session_sees_all_areas()) OR area_id = ANY ((SELECT session_areas())::uuid[])'

/**
 * The second policy of every table with a place, next to `tenant_isolation`
 * (ADR 0003, points 7 to 11). Restrictive, so that it is joined to the other
 * policies with AND and none of them can widen it. The same expression for
 * reading and writing: whoever has only the north can neither write a row
 * into the south nor move one out of their own sight.
 *
 * A row with a place carries `area_id` beside `property_id`, and a key over
 * `(tenant_id, property_id, area_id)` to the property with `ON UPDATE CASCADE`
 * keeps the area of every row that of its property, also when the property
 * moves to another area.
 */
export function withinAreas() {
  const inReach = sql.raw(withinAreasExpression)

  return pgPolicy('within_areas', {
    as: 'restrictive',
    for: 'all',
    to: applicationRole,
    using: inReach,
    withCheck: inReach,
  })
}
