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
 * The expression of `within_areas` for a table whose rows may lie in no area,
 * as PostgreSQL writes it back, from `withinAreasOrNoneExpression` in the
 * schema (ADR 0003, addendum of #328).
 */
export const withinAreasOrNoneAsStored =
  '((area_id IS NULL) OR ( SELECT session_sees_all_areas() AS session_sees_all_areas) OR ' +
  '(area_id = ANY (( SELECT session_areas() AS session_areas)::uuid[])))'

/** What a check has to say of a row in no area: it has an area exactly when it has a property. */
export const noAreaWithoutAProperty = '((area_id IS NULL) = (property_id IS NULL))'

/** A table whose rows may lie in no area, and the check that holds which. */
export interface RowsInNoArea {
  /** The check that says a row is without an area exactly when it is without a property. */
  readonly check: string
  readonly reason: string
}

/**
 * Tables whose rows may be without a property and without an area, exactly
 * when they hang on something of the whole operator (ADR 0003, addendum of
 * #328, decided by Moritz on 16.10.2026). Their policies let such a row
 * through for whoever is in the operator, by `withinAreasOrNoneAsStored`, and
 * the check named here holds that no row with a property is among them.
 */
export const rowsInNoArea: Readonly<Record<string, RowsInNoArea>> = {
  contacts: {
    check: 'contacts_at_a_property_or_a_contractor',
    reason: 'the people of a contractor, which lies in no area',
  },
  attachments: {
    check: 'attachments_at_a_place_or_a_contractor',
    reason: 'the documents of a contractor, its certificates and its insurance',
  },
  deadlines: {
    check: 'deadlines_at_a_place_or_of_a_document',
    reason: 'the deadline of a document of a contractor',
  },
}

/** The expression `within_areas` reads and writes through on a table, as PostgreSQL writes it back. */
function withinAreasOf(table: string): string {
  return Object.hasOwn(rowsInNoArea, table) ? withinAreasOrNoneAsStored : withinAreasAsStored
}

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
  // A delegation of duties names areas and lies in none (#336); the Leitung and the person it goes to read it whole.
  duty_delegation_areas: 'the areas a delegation of duties names, read with the delegation',
}

/**
 * Tables that carry `property_id` and no area, each with its reason: the
 * properties an access from outside is limited to (#339) are what the
 * functions of `within_limits` read, and name a person, not a place.
 */
export const propertyColumnsWithoutAnArea: Readonly<Record<string, string>> = {
  member_limit_properties:
    'the properties an access is limited to, read by the functions of within_limits',
  invitation_limit_properties:
    'the properties an invitation limits to, kept like those of an access',
}

/**
 * The expression of `within_areas_of_their_file` as PostgreSQL writes it
 * back, from `withinAreasOfTheirFileExpression` in the schema. Read from a
 * database once and kept here, like the one above.
 */
export const withinAreasOfTheirFileAsStored =
  '(EXISTS ( SELECT 1\n   FROM attachments\n' +
  '  WHERE ((attachments.tenant_id = attachment_versions.tenant_id) AND ' +
  '(attachments.id = attachment_versions.attachment_id))))'

/** A table that takes the line between the areas from the row its rows are a part of. */
export interface LineThroughARow {
  /** The key by which a row names the row it is a part of. */
  readonly key: string
  /** The table that row is in, which carries the area. */
  readonly target: string
  /** The restrictive policy that asks that row, and its expression as PostgreSQL writes it back. */
  readonly policy: string
  readonly stored: string
  readonly reason: string
}

/**
 * Tables whose rows are a part of a row with a place, are written once and
 * never changed, and so carry no area of their own: an area on such a row
 * could not follow its property into another area. Each draws the line by a
 * restrictive policy that asks the row it is a part of, and the key by which
 * it names that row is the one key onto a row with an area that does not run
 * over the property (ADR 0003, addendum of #97).
 */
export const linesThroughARow: Readonly<Record<string, LineThroughARow>> = {
  attachment_versions: {
    key: 'attachment_versions_attachment_in_tenant',
    target: 'attachments',
    policy: 'within_areas_of_their_file',
    stored: withinAreasOfTheirFileAsStored,
    reason: 'a version of a document, kept as written by a trigger of the foundation',
  },
}

/**
 * Keys of the electrical structure (#349) and the PV structure (#461) onto
 * the part above a row, each
 * with its reason: the keys of the foundation over the tenant and the id
 * (`electricalSchema`, ADR 0014 in the repository opengewerk), which an
 * application cannot change, and the keys of this application that keep a
 * part on the asset of the part above it. Neither runs over the property.
 * What draws the line instead is the asset: the row and the part it points
 * at each hang on an asset of their property over their own keys, and the
 * row on the same asset as the part above it, so that both lie where that
 * asset lies. The catalogue asks that of every key named here.
 */
export const keysWithinAnAsset: Readonly<Record<string, string>> = {
  board_sections_board_in_tenant: 'a section on its board, by the key of the foundation',
  board_sections_on_a_board_of_their_asset: 'a section on the asset of its board',
  circuits_board_in_tenant: 'a circuit on its board, by the key of the foundation',
  circuits_section_belongs_to_board:
    'a circuit in a section of its own board, by the key of the foundation',
  circuits_on_a_board_of_their_asset: 'a circuit on the asset of its board',
  equipment_circuit_in_tenant: 'a piece of equipment on its circuit, by the key of the foundation',
  equipment_on_a_circuit_of_their_asset: 'a piece of equipment on the asset of its circuit',
  // Not a part of the structure, but held the same way (#350).
  defects_on_a_circuit_of_their_asset: 'a defect on a circuit of the asset it is at',
  // The PV structure, as the electrical one (#461).
  pv_strings_inverter_in_tenant: 'a string on its inverter, by the key of the foundation',
  pv_strings_on_an_inverter_of_their_asset: 'a string on the asset of its inverter',
  pv_modules_string_in_tenant: 'a module on its string, by the key of the foundation',
  pv_modules_on_a_string_of_their_asset: 'a module on the asset of its string',
}

/**
 * The expression of `within_areas_or_a_building` on a table, as PostgreSQL
 * writes it back, from `withinAreasOrABuildingExpression` in the schema
 * (ADR 0003, addendum of #306).
 */
function withinAreasOrABuildingAsStored(table: string, propertyColumn: string): string {
  return (
    (Object.hasOwn(rowsInNoArea, table) ? '((area_id IS NULL) OR ' : '(') +
    '( SELECT session_sees_all_areas() AS session_sees_all_areas) OR ' +
    '(area_id = ANY (( SELECT session_areas() AS session_areas)::uuid[])) OR ' +
    '(EXISTS ( SELECT 1\n   FROM buildings\n' +
    `  WHERE ((buildings.tenant_id = ${table}.tenant_id) AND ` +
    `(buildings.property_id = ${table}.${propertyColumn}) AND (buildings.deleted_at IS NULL)))))`
  )
}

/** A table that is read also by whoever sees a building on its property. */
export interface LineThroughABuilding {
  /** The policy that reads, for SELECT alone. */
  readonly policy: string
  /** How it reads, as PostgreSQL writes it back. */
  readonly reads: string
  readonly reason: string
}

/**
 * The policies with which such a table writes, one for each command, as
 * `pg_policy` names the command, and which of their halves ask
 * `within_areas`: the rows a statement finds, the rows it leaves, or both.
 */
export const writesWithinAreas = [
  { policy: 'within_areas_insert', command: 'a', finds: false, leaves: true },
  { policy: 'within_areas_update', command: 'w', finds: true, leaves: true },
  { policy: 'within_areas_delete', command: 'd', finds: true, leaves: false },
] as const

/**
 * The trigger that puts a building only on a property whose area the person
 * holds, as PostgreSQL writes it back (ADR 0003, addendum of #306): without
 * it, a building of an area of its own would open any property to read.
 */
const buildingsOnAPropertyInReach =
  'CREATE TRIGGER buildings_on_a_property_in_reach BEFORE INSERT OR UPDATE OF property_id ON public.buildings ' +
  'FOR EACH ROW EXECUTE FUNCTION building_on_a_property_in_reach()'

/**
 * Tables that are read also by whoever holds only the area of a building on
 * their property (section 2.8 of the concept, ADR 0003, addendum of #306):
 * they draw the line with `within_areas_or_a_building` in place of
 * `within_areas`, which reads like it and lets a row through besides whose
 * property has a building the person sees, and with the policies of
 * `writesWithinAreas`, which write like it. A policy for every command would
 * lend what it lets be read to UPDATE and DELETE as well.
 */
export const linesThroughABuilding: Readonly<Record<string, LineThroughABuilding>> = {
  properties: {
    policy: 'within_areas_or_a_building',
    reads: withinAreasOrABuildingAsStored('properties', 'id'),
    reason: 'the property a building stands on, with its address and its note',
  },
  contacts: {
    policy: 'within_areas_or_a_building',
    reads: withinAreasOrABuildingAsStored('contacts', 'property_id'),
    reason: 'the people to talk to at the property a building stands on',
  },
}

/**
 * Tables whose rows follow exactly one of several rows with an area, held by
 * a check, so that one of the keys of their area holds for every row though
 * none of their columns is required (ADR 0003, addendum of #306). The check
 * is named in the reason.
 */
export const areaOfOneSource: Readonly<Record<string, string>> = {
  deadlines:
    'a deadline follows one source, a duty, a defect, a plan, the meters of a property, a document, a contract or a warranty (deadlines_follow_one_source)',
  // What a contract covers (#329).
  contract_items: 'an item covers one building or one asset (contract_items_one_target)',
  prints: 'a print is of one record, evidence or an activity (prints_of_one_record)',
}

/** The check of `area_from_property_id` on a table, as PostgreSQL writes it back. */
function areaFromThePropertyAsStored(carriers: readonly string[]): string {
  return (
    'CHECK ((NOT (area_from_property_id IS DISTINCT FROM\nCASE\n' +
    `    WHEN (num_nonnulls(${carriers.join(', ')}) = 0) THEN property_id\n` +
    '    ELSE NULL::uuid\nEND)))'
  )
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
 * - Every table with `area_id` and `property_id` keeps its area by a key
 *   onto what it hangs on (ADR 0003, addendum of #306): over `(tenant_id,
 *   <the column that names it>, area_id)` to `(tenant_id, id, area_id)` of a
 *   table with an area, with `ON UPDATE CASCADE`, so that a row follows what
 *   it hangs on into another area. Every key that holds `area_id` to a table
 *   with an area is such a key, and a table has at least one.
 * - One of them holds for every row: its column is required, or the table is
 *   on the list `areaOfOneSource`, or it carries `area_from_property_id` with
 *   a key over it to the property, the trigger `area_from_the_property`, which
 *   knows every other column a key of its area runs over, and the check of
 *   the column, written for those columns.
 * - The property table has `area_id` and a key to the areas of its tenant.
 * - A key that points at a row with an area runs over the tenant and the
 *   property, or holds the area itself, so that a row cannot hang itself on a
 *   place of another area.
 * - A table on the list `linesThroughABuilding` draws the line in place of
 *   `within_areas` with its policy for reading, restrictive, for SELECT alone
 *   and the application role, with the expression of the building block, and
 *   with the policies of `writesWithinAreas` for writing, each restrictive,
 *   for its command alone and the application role, with the expression of
 *   `within_areas`. While there is such a table, `buildings` carries the
 *   trigger that puts a building only on a property in reach.
 * - The one exception is a table on the list `linesThroughARow`: its key onto
 *   the row it is a part of is let through, and in exchange it has the
 *   restrictive policy that asks that row, for every command, for the
 *   application role and with the expression of the building block.
 */
export async function areaBoundaryProblems(
  pool: Pool,
  { propertyTable = 'properties' }: AreaBoundaryOptions = {},
): Promise<string[]> {
  const { rows: columns } = await pool.query<{
    table_name: string
    column_name: string
    required: boolean
  }>(
    `select c.relname as table_name, a.attname as column_name, a.attnotnull as required
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
  const { rows: checks } = await pool.query<{
    table_name: string
    name: string
    definition: string
  }>(
    `select c.relname as table_name, k.conname as name, pg_get_constraintdef(k.oid) as definition
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'c' and n.nspname = 'public'`,
  )
  const { rows: triggers } = await pool.query<{ table_name: string; carriers: string[] }>(
    `select c.relname as table_name,
            array(select argument from unnest(string_to_array(encode(t.tgargs, 'escape'), '\\000'))
                    as argument where argument <> '') as carriers
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and t.tgname = 'area_from_the_property'`,
  )
  const { rows: throughPolicies } = await pool.query<{
    table_name: string
    name: string
    permissive: boolean
    command: string
    roles: string[]
    using: string | null
    checking: string | null
  }>(
    `select c.relname as table_name, p.polname as name, p.polpermissive as permissive,
            p.polcmd::text as command,
            array(select case when r = 0 then 'public' else r::regrole::text end
                    from unnest(p.polroles) as r) as roles,
            pg_get_expr(p.polqual, p.polrelid) as using,
            pg_get_expr(p.polwithcheck, p.polrelid) as checking
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and p.polname = any ($1::text[])`,
    [
      [
        ...Object.values(linesThroughARow).map((through) => through.policy),
        ...Object.values(linesThroughABuilding).map((through) => through.policy),
        ...writesWithinAreas.map((writes) => writes.policy),
      ],
    ],
  )

  const has = (table: string, column: string) =>
    columns.some((row) => row.table_name === table && row.column_name === column)
  const required = (table: string, column: string) =>
    columns.some((row) => row.table_name === table && row.column_name === column && row.required)
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
      if (expression === withinAreasOf(policy.table_name)) {
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
    if (table in areaColumnsWithoutTheLine || table in linesThroughABuilding) {
      continue
    }

    if (!policies.some((policy) => policy.table_name === table)) {
      problems.push(`table ${table}: carries area_id and no policy within_areas`)
    }
  }

  const withAnArea = new Set(
    tablesWith('area_id').filter((table) => !(table in areaColumnsWithoutTheLine)),
  )
  // A key that holds the area of its row to the row it hangs on.
  const holdsTheArea = (key: (typeof keys)[number]) =>
    withAnArea.has(key.target) && maps(key, 'area_id', 'area_id')
  // A table whose rows hang on an asset of their property, over the tenant.
  const onAnAsset = (table: string) =>
    keys.some(
      (key) =>
        key.table_name === table &&
        key.target === 'assets' &&
        maps(key, 'tenant_id', 'tenant_id') &&
        maps(key, 'asset_id', 'id') &&
        maps(key, 'property_id', 'property_id'),
    )
  // A key between two such rows, where the row carries the asset of the part
  // above it by another key over the tenant and the asset.
  const onOneAsset = (key: (typeof keys)[number]) =>
    onAnAsset(key.table_name) &&
    onAnAsset(key.target) &&
    keys.some(
      (other) =>
        other.table_name === key.table_name &&
        other.target !== 'assets' &&
        maps(other, 'tenant_id', 'tenant_id') &&
        maps(other, 'asset_id', 'asset_id'),
    )

  for (const table of tablesWith('property_id')) {
    if (table in propertyColumnsWithoutAnArea) {
      continue
    }

    if (!has(table, 'area_id')) {
      problems.push(`table ${table}: carries property_id and no area_id`)
      continue
    }

    const ofTheArea = keys.filter((key) => key.table_name === table && holdsTheArea(key))
    const following = ofTheArea.filter(
      (key) =>
        key.columns.length === 3 &&
        key.columns[0] === 'tenant_id' &&
        key.columns[2] === 'area_id' &&
        sameList(key.target_columns, ['tenant_id', 'id', 'area_id']) &&
        key.on_update === 'c',
    )

    for (const key of ofTheArea.filter((found) => !following.includes(found))) {
      problems.push(
        `table ${table}, key ${key.name}: holds area_id to ${key.target} without running over (tenant_id, a column, area_id) to (tenant_id, id, area_id) with ON UPDATE CASCADE`,
      )
    }

    if (following.length === 0) {
      problems.push(
        `table ${table}: no key that keeps its area with what it hangs on, over (tenant_id, a column, area_id) with ON UPDATE CASCADE`,
      )
      continue
    }

    const through = (key: (typeof keys)[number]) => key.columns[1] ?? ''

    if (
      following.some((key) => required(table, through(key))) ||
      Object.hasOwn(areaOfOneSource, table)
    ) {
      continue
    }

    // A row in no area follows nothing; every other has its property, whose key holds (#328).
    if (Object.hasOwn(rowsInNoArea, table) && !has(table, 'area_from_property_id')) {
      continue
    }

    const own = following.find(
      (key) => through(key) === 'area_from_property_id' && key.target === propertyTable,
    )
    const others = following.filter((key) => key !== own).map(through)

    if (!has(table, 'area_from_property_id')) {
      problems.push(
        `table ${table}: none of the keys of its area holds for every row, and it carries no area_from_property_id`,
      )
      continue
    }

    if (own === undefined) {
      problems.push(
        `table ${table}: carries area_from_property_id and no key over it to ${propertyTable} with ON UPDATE CASCADE`,
      )
    }

    const trigger = triggers.find((found) => found.table_name === table)

    if (trigger === undefined) {
      problems.push(
        `table ${table}: carries area_from_property_id and no trigger area_from_the_property`,
      )
      continue
    }

    for (const column of others.filter((found) => !trigger.carriers.includes(found))) {
      problems.push(
        `table ${table}: the trigger area_from_the_property does not know ${column}, over which a key keeps the area`,
      )
    }

    // A column the trigger knows that no key of the area runs over is a choice
    // of the row itself, the own area of a building: its check holds the
    // choice and the area together, and is the table's own.
    if (trigger.carriers.some((column) => !others.includes(column))) {
      const named = `${table}_area_own_or_of_the_property`

      if (!checks.some((found) => found.table_name === table && found.name === named)) {
        problems.push(`table ${table}: no check ${named}`)
      }

      continue
    }

    const check = checks.find(
      (found) => found.table_name === table && found.name === `${table}_area_from_the_property`,
    )

    if (check?.definition !== areaFromThePropertyAsStored(trigger.carriers)) {
      problems.push(
        `table ${table}: no check ${table}_area_from_the_property for the columns the trigger knows: ${String(check?.definition)}`,
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

  for (const key of keys) {
    if (!withAnArea.has(key.target) || holdsTheArea(key)) {
      continue
    }

    const property = key.target === propertyTable ? 'id' : 'property_id'
    const overTheProperty =
      maps(key, 'tenant_id', 'tenant_id') && maps(key, 'property_id', property)

    const through = Object.hasOwn(linesThroughARow, key.table_name)
      ? linesThroughARow[key.table_name]
      : undefined

    // The key of a row onto the row it is a part of; its policy is asked below.
    if (through?.key === key.name && through.target === key.target) {
      continue
    }

    // A key within the electrical structure, between two rows on one asset.
    if (Object.hasOwn(keysWithinAnAsset, key.name) && onOneAsset(key)) {
      continue
    }

    if (!overTheProperty) {
      problems.push(
        `table ${key.table_name}, key ${key.name}: points at ${key.target}, which has an area, without running over tenant_id and property_id`,
      )
    }
  }

  for (const [table, through] of Object.entries(linesThroughARow)) {
    if (!columns.some((row) => row.table_name === table)) {
      continue
    }

    const where = `table ${table}, policy ${through.policy}`
    const policy = throughPolicies.find(
      (found) => found.table_name === table && found.name === through.policy,
    )

    if (!policy) {
      problems.push(
        `table ${table}: its rows are a part of ${through.target} and it has no policy ${through.policy}`,
      )
      continue
    }

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
      if (expression !== through.stored) {
        problems.push(
          `${where} ${half} through something else than the building block: ${String(expression)}`,
        )
      }
    }
  }

  for (const [table, through] of Object.entries(linesThroughABuilding)) {
    if (!columns.some((row) => row.table_name === table)) {
      continue
    }

    // The wide policy reads and nothing else; each way of writing has its
    // own, as narrow as `within_areas`.
    const wanted = [
      { policy: through.policy, command: 'r', using: through.reads, checking: null },
      ...writesWithinAreas.map((writes) => ({
        policy: writes.policy,
        command: writes.command,
        using: writes.finds ? withinAreasOf(table) : null,
        checking: writes.leaves ? withinAreasOf(table) : null,
      })),
    ]

    for (const want of wanted) {
      const where = `table ${table}, policy ${want.policy}`
      const policy = throughPolicies.find(
        (found) => found.table_name === table && found.name === want.policy,
      )

      if (!policy) {
        problems.push(`table ${table}: is read over a building and has no policy ${want.policy}`)
        continue
      }

      if (policy.permissive || policy.command !== want.command) {
        problems.push(
          `${where}: not restrictive for ${want.command} alone, so it widens or is widened by another command`,
        )
      }

      if (policy.roles.length !== 1 || policy.roles[0] !== applicationRoleName) {
        problems.push(`${where}: for ${policy.roles.join(', ')} and not for ${applicationRoleName}`)
      }

      for (const [half, expression, expected] of [
        ['reads', policy.using, want.using],
        ['writes', policy.checking, want.checking],
      ] as const) {
        if (expression !== expected) {
          problems.push(
            `${where} ${half} through something else than the building block: ${String(expression)}`,
          )
        }
      }
    }
  }

  // A table whose rows may lie in no area holds by a check that only a row
  // without a property is among them (ADR 0003, addendum of #328).
  for (const [table, inNoArea] of Object.entries(rowsInNoArea)) {
    if (!columns.some((row) => row.table_name === table)) {
      continue
    }

    const check = checks.find(
      (found) => found.table_name === table && found.name === inNoArea.check,
    )

    if (!check?.definition.includes(noAreaWithoutAProperty)) {
      problems.push(
        `table ${table}: its rows may lie in no area and no check ${inNoArea.check} says ${noAreaWithoutAProperty}: ${String(check?.definition)}`,
      )
    }
  }

  // Whoever holds the area of a building reads the property it stands on,
  // so a building goes onto a property only for whoever holds its area.
  if (Object.keys(linesThroughABuilding).some((table) => has(table, 'area_id'))) {
    const { rows: placing } = await pool.query<{ definition: string }>(
      `select pg_get_triggerdef(t.oid) as definition
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'buildings'
          and t.tgname = 'buildings_on_a_property_in_reach'`,
    )

    if (placing[0]?.definition !== buildingsOnAPropertyInReach) {
      problems.push(
        `table buildings: puts a building on a property without asking whether its area is held, so a building opens a property to read: ${String(placing[0]?.definition)}`,
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

/**
 * The line a building moves to another property along (#307, ADR 0002,
 * addendum of 15.10.2026). Every key over `property_id` onto another table
 * than the properties either follows what a row hangs on with ON UPDATE
 * CASCADE, so that a moved building takes the row along, or names something
 * else and does not follow, with a sentence in `holding` for a move it holds
 * up. What a row hangs on are the targets of the keys it keeps its area by,
 * over (tenant_id, a column, area_id), and a room its floor and an asset its
 * room, the levels of its place.
 */
export async function buildingMoveProblems(
  pool: Pool,
  holding: Readonly<Record<string, string>>,
): Promise<string[]> {
  const { rows: keys } = await pool.query<{
    table_name: string
    name: string
    target: string
    follows: boolean
    columns: string[]
  }>(
    `select c.relname as table_name, k.conname as name, t.relname as target,
            k.confupdtype = 'c' as follows,
            array(select a.attname::text from unnest(k.conkey) with ordinality as x(attnum, n)
                    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.attnum
                   order by x.n) as columns
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_class t on t.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public'`,
  )
  const hangsOn = new Set([
    ...keys
      .filter(
        (key) =>
          key.columns.length === 3 &&
          key.columns[0] === 'tenant_id' &&
          key.columns[2] === 'area_id' &&
          key.target !== 'properties' &&
          key.target !== 'areas',
      )
      .map((key) => `${key.table_name}.${key.columns[1] ?? ''}`),
    'rooms.floor_id',
    'assets.room_id',
  ])
  const overTheProperty = keys.filter(
    (key) => key.columns.includes('property_id') && key.target !== 'properties',
  )
  const problems: string[] = []

  for (const key of overTheProperty) {
    const where = `table ${key.table_name}, key ${key.name}`
    const carrier = key.columns[1] ?? ''

    if (hangsOn.has(`${key.table_name}.${carrier}`)) {
      if (!key.follows) {
        problems.push(
          `${where}: holds a row to the ${carrier} it hangs on without ON UPDATE CASCADE, so a moved building leaves it behind`,
        )
      }

      continue
    }

    if (key.follows) {
      problems.push(
        `${where}: follows ${carrier} with ON UPDATE CASCADE, which the row does not hang on, so a moved building takes along what is not in it`,
      )
    }

    if (!(key.name in holding)) {
      problems.push(
        `${where}: names ${carrier}, which the row does not hang on, and has no sentence for a move it holds up`,
      )
    }
  }

  for (const name of Object.keys(holding)) {
    if (!overTheProperty.some((key) => key.name === name && !key.follows)) {
      problems.push(`sentence for ${name}: no such key over the property that holds a move up`)
    }
  }

  return problems
}
