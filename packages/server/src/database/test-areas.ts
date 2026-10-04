import { applicationRoleName } from '@opengewerk/haustechnik-domain'
import type { Pool } from 'pg'

// The catalogue question of ADR 0003: does every table with a place carry the
// line between the areas, and does every policy that draws it ask the
// functions the way that costs a tenth of a millisecond and not twenty.
//
// Asked of the catalogue and not of a list, like the questions of the
// foundation about tenants: a list is complete on the day it is written, the
// catalogue knows the table a later migration added.

/**
 * The expression of `within_areas` as PostgreSQL writes it back, from
 * `withinAreasExpression` in the schema. Read from a database once and kept
 * here, like the comparison the foundation holds every tenant policy against.
 */
export const withinAreasAsStored =
  '(( SELECT session_sees_all_areas() AS session_sees_all_areas) OR ' +
  '(area_id = ANY (( SELECT session_areas() AS session_areas)::uuid[])))'

/**
 * Tables that carry `area_id` and no line between the areas, each with its
 * reason. The areas a person holds are what the functions of the policy read;
 * a policy that asked them there would ask itself. The areas an invitation
 * names are kept by whoever keeps who works for the tenant, as those of a
 * person are, and name no place.
 */
export const areaColumnsWithoutTheLine: Readonly<Record<string, string>> = {
  member_areas: 'the areas a person holds, read by the functions of the policy itself',
  invitation_areas: 'the areas an invitation names, kept like those of a person',
}

export interface AreaBoundaryOptions {
  /**
   * The table every place hangs under and takes its area from. `properties`
   * from the migration that brings it; a test may name tables of its own.
   */
  readonly propertyTable?: string
}

/**
 * What is missing for the line between the areas, one sentence per finding,
 * or nothing.
 *
 * - Every policy `within_areas` is restrictive, for every command and for the
 *   application role, and reads and writes through the expression of the
 *   building block. A direct call of one of the functions is named as such:
 *   it costs every row a query, and no comparison of results shows it.
 * - Every table with `area_id` has that policy, the few on the list above
 *   aside.
 * - Every table with `property_id` has `area_id` and the key over
 *   `(tenant_id, property_id, area_id)` to the property, with `ON UPDATE
 *   CASCADE`, so that a row follows its property into another area.
 * - The property table has `area_id` and a key to the areas of its tenant.
 * - A key that points at a row with an area runs over the tenant and the
 *   property, so that a row cannot hang itself on a place of another area.
 */
export async function areaBoundaryProblems(
  pool: Pool,
  { propertyTable = 'properties' }: AreaBoundaryOptions = {},
): Promise<string[]> {
  const { rows: columns } = await pool.query<{ table_name: string; column_name: string }>(
    `select c.relname as table_name, a.attname as column_name
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`,
  )
  const { rows: keys } = await pool.query<{
    table_name: string
    name: string
    target: string
    columns: string[]
    target_columns: string[]
    on_update: string
  }>(
    `select c.relname as table_name, k.conname as name, t.relname as target,
            array(select a.attname::text
                    from unnest(k.conkey) with ordinality as u(attnum, position)
                    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum
                   order by u.position) as columns,
            array(select a.attname::text
                    from unnest(k.confkey) with ordinality as u(attnum, position)
                    join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.attnum
                   order by u.position) as target_columns,
            k.confupdtype::text as on_update
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_class t on t.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public'`,
  )
  const { rows: policies } = await pool.query<{
    table_name: string
    permissive: boolean
    command: string
    roles: string[]
    using: string | null
    checking: string | null
  }>(
    `select c.relname as table_name, p.polpermissive as permissive, p.polcmd::text as command,
            array(select case when r = 0 then 'public' else r::regrole::text end
                    from unnest(p.polroles) as r) as roles,
            pg_get_expr(p.polqual, p.polrelid) as using,
            pg_get_expr(p.polwithcheck, p.polrelid) as checking
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and p.polname = 'within_areas'`,
  )

  const has = (table: string, column: string) =>
    columns.some((row) => row.table_name === table && row.column_name === column)
  const tablesWith = (column: string) =>
    [
      ...new Set(columns.filter((row) => row.column_name === column).map((row) => row.table_name)),
    ].sort()
  const problems: string[] = []

  for (const policy of policies) {
    const where = `table ${policy.table_name}, policy within_areas`

    if (policy.permissive || policy.command !== '*') {
      problems.push(`${where}: not restrictive for every command, so another policy can widen it`)
    }

    if (policy.roles.length !== 1 || policy.roles[0] !== applicationRoleName) {
      problems.push(`${where}: for ${policy.roles.join(', ')} and not for ${applicationRoleName}`)
    }

    for (const [half, expression] of [
      ['reads', policy.using],
      ['writes', policy.checking],
    ] as const) {
      if (expression === withinAreasAsStored) {
        continue
      }

      problems.push(
        callsDirectly(expression)
          ? `${where} ${half} through a direct call of the functions, which runs them for every row: ${String(expression)}`
          : `${where} ${half} through something else than the building block: ${String(expression)}`,
      )
    }
  }

  for (const table of tablesWith('area_id')) {
    if (table in areaColumnsWithoutTheLine) {
      continue
    }

    if (!policies.some((policy) => policy.table_name === table)) {
      problems.push(`table ${table}: carries area_id and no policy within_areas`)
    }
  }

  for (const table of tablesWith('property_id')) {
    if (!has(table, 'area_id')) {
      problems.push(`table ${table}: carries property_id and no area_id`)
      continue
    }

    const follows = keys.some(
      (key) =>
        key.table_name === table &&
        key.target === propertyTable &&
        sameList(key.columns, ['tenant_id', 'property_id', 'area_id']) &&
        sameList(key.target_columns, ['tenant_id', 'id', 'area_id']) &&
        key.on_update === 'c',
    )

    if (!follows) {
      problems.push(
        `table ${table}: no key over (tenant_id, property_id, area_id) to ${propertyTable} with ON UPDATE CASCADE`,
      )
    }
  }

  if (columns.some((row) => row.table_name === propertyTable)) {
    if (!has(propertyTable, 'area_id')) {
      problems.push(`table ${propertyTable}: the properties carry no area_id`)
    } else if (
      !keys.some(
        (key) =>
          key.table_name === propertyTable &&
          key.target === 'areas' &&
          sameList(key.columns, ['tenant_id', 'area_id']) &&
          sameList(key.target_columns, ['tenant_id', 'id']),
      )
    ) {
      problems.push(
        `table ${propertyTable}: no key over (tenant_id, area_id) to the areas of the tenant`,
      )
    }
  }

  const withAnArea = new Set(
    tablesWith('area_id').filter((table) => !(table in areaColumnsWithoutTheLine)),
  )

  for (const key of keys) {
    if (!withAnArea.has(key.target)) {
      continue
    }

    const property = key.target === propertyTable ? 'id' : 'property_id'
    const overTheProperty =
      maps(key, 'tenant_id', 'tenant_id') && maps(key, 'property_id', property)

    if (!overTheProperty) {
      problems.push(
        `table ${key.table_name}, key ${key.name}: points at ${key.target}, which has an area, without running over tenant_id and property_id`,
      )
    }
  }

  return problems
}

/** Whether an expression calls one of the two functions anywhere but in a sub-select. */
function callsDirectly(expression: string | null): boolean {
  const rest = (expression ?? '').replace(/SELECT session_(?:sees_all_areas|areas)\(\)/g, '')

  return /session_(?:sees_all_areas|areas)\(/.test(rest)
}

function sameList(found: readonly string[], wanted: readonly string[]): boolean {
  return (
    found.length === wanted.length && found.every((column, position) => column === wanted[position])
  )
}

/** Whether a key takes a column of its table to a column of its target. */
function maps(
  key: { readonly columns: readonly string[]; readonly target_columns: readonly string[] },
  column: string,
  target: string,
): boolean {
  return key.columns.some(
    (found, position) => found === column && key.target_columns[position] === target,
  )
}
