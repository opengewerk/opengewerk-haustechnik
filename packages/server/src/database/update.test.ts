import { rmSync } from 'node:fs'

import { firstAreaName, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from './migrations.js'
import { numberRanges } from './schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  enumValues,
  functionNames,
  migrationsFolderUpTo,
  ownerDatabaseUrl,
  refusedBy,
  resetSchema,
  revertMigration,
  tableNames,
} from './test-database.js'
import { writtenColumnNames, writtenPlaceholders, writtenValues } from './test-evidence.js'

// What an update does to a database that has been in use. The tests beside
// this one migrate an empty database, and an empty database forgives a
// migration almost anything: a statement that fails on a table with rows in
// it, or quietly takes some of them along, passes there. Here a database
// stands on an earlier release with rows of a tenant in it, and the update
// runs over that.

let admin: Pool
const folders: string[] = []

/** A folder built for one test, removed again after it. */
function kept(folder: string): string {
  folders.push(folder)

  return folder
}

/** A tenant with counters that have been drawn from, put in past the application. */
async function tenantWithCounters(
  counters: Readonly<Record<string, number>>,
): Promise<{ id: TenantId }> {
  const tenant = { id: newId<'tenant'>() }

  await admin.query('insert into tenants (id, name) values ($1, $2)', [
    tenant.id,
    'Wohnbau Nord eG',
  ])

  for (const [key, nextValue] of Object.entries(counters)) {
    await admin.query(
      'insert into number_ranges (tenant_id, key, pattern, next_value) values ($1, $2, $3, $4)',
      [tenant.id, key, `${key}-{number:4}`, nextValue],
    )
  }

  return tenant
}

/** The counters of a tenant as the database holds them, by sequence. */
async function countersOf(tenant: { id: TenantId }): Promise<Record<string, number>> {
  const { rows } = await admin.query<{ key: string; next_value: number }>(
    'select key::text as key, next_value from number_ranges where tenant_id = $1',
    [tenant.id],
  )

  return Object.fromEntries(rows.map((row) => [row.key, row.next_value]))
}

async function sequences(): Promise<string[] | undefined> {
  return (await enumValues(admin)).get('number_range_key')
}

beforeAll(async () => {
  admin = await connect()
})

beforeEach(async () => {
  await resetSchema(admin)
})

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

afterAll(async () => {
  await admin.end()
})

/**
 * The first migration created the sequences for assets and evidence and left
 * the one for work orders out, which the concept names with them. The second
 * adds it. An installation that began on the first has counters by then.
 */
describe('an installation that began on the first migration', () => {
  it('takes the sequence for work orders with the update and keeps its counters', async () => {
    await runMigrations(ownerDatabaseUrl(), kept(migrationsFolderUpTo(1)))

    const tenant = await tenantWithCounters({ asset: 42, evidence: 7 })

    expect(await sequences()).toEqual(['asset', 'evidence'])

    // The update: every migration this application carries, over what is there.
    await runMigrations(ownerDatabaseUrl())

    // In the order of the list in the code, not appended at the end.
    expect(await sequences()).toEqual(['asset', 'work_order', 'evidence'])
    expect(await countersOf(tenant)).toEqual({ asset: 42, evidence: 7 })

    // And the new sequence is one the application can start a counter in,
    // once the update is through.
    await allowApplicationLogin(admin)
    const database = Database.connect(applicationDatabaseUrl())

    try {
      await database.forTenant({ tenantId: tenant.id }, (tx) =>
        tx
          .insert(numberRanges)
          .values({ tenantId: tenant.id, key: 'work_order', pattern: 'WO-{number:4}' }),
      )
    } finally {
      await database.close()
    }

    expect(await countersOf(tenant)).toEqual({ asset: 42, evidence: 7, work_order: 1 })
  })

  /**
   * PostgreSQL does not take a value out of an enum, so the rollback makes
   * the type anew, and a rollback that rebuilds a type under a table with
   * rows in it is exactly the kind that works on an empty database only.
   */
  it('loses the counter of the work orders and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = await tenantWithCounters({ asset: 42, work_order: 7, evidence: 3 })

    // Back to the first migration, in the reverse order of the way forward.
    // The evidence and the deadlines hang on the duties, the duties on the
    // place and the assets, so they go first; the files, the mail server and
    // the settings of the deadlines hang on nothing of this.
    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')
    await revertMigration(admin, '0009_activities_and_defects')
    await revertMigration(admin, '0008_evidence_and_deadlines')
    await revertMigration(admin, '0007_duties')
    await revertMigration(admin, '0004_assets')
    await revertMigration(admin, '0003_places')
    await revertMigration(admin, '0002_areas')
    await revertMigration(admin, '0001_work_order_numbers')

    expect(await sequences()).toEqual(['asset', 'evidence'])
    expect(await countersOf(tenant)).toEqual({ asset: 42, evidence: 3 })

    // The log of the tenant says that the counter went, and why.
    const { rows: removed } = await admin.query<{ operation: string; reason: string | null }>(
      `select distinct operation::text as operation, reason
         from audit_entries
        where tenant_id = $1 and table_name = 'number_ranges' and operation = 'delete'`,
      [tenant.id],
    )

    expect(removed).toEqual([{ operation: 'delete', reason: 'migration' }])

    // And the column is a column of the type again: it refuses what the type
    // no longer knows, rather than having turned into free text on the way.
    const refusal = await refusedBy(
      admin.query('insert into number_ranges (tenant_id, key, pattern) values ($1, $2, $3)', [
        tenant.id,
        'work_order',
        'WO-{number:4}',
      ]),
    )

    // invalid_text_representation: not a value of the enum.
    expect(refusal.code).toBe('22P02')
  })
})

/** Accounts for the given people, and their memberships in a tenant, put in past the application. */
async function members(
  tenant: { id: TenantId },
  people: Readonly<Record<string, { roles: readonly string[]; blocked?: boolean }>>,
): Promise<void> {
  for (const [userId, { roles, blocked = false }] of Object.entries(people)) {
    await admin.query(
      'insert into auth_users (id, name, email) values ($1, $1, $2) on conflict do nothing',
      [userId, `${userId}@beispiel.example`],
    )
    await admin.query(
      `insert into memberships (tenant_id, user_id, roles, blocked_at)
       values ($1, $2, $3, case when $4 then now() end)`,
      [tenant.id, userId, roles, blocked],
    )
  }
}

/** Who sees which area of a tenant: every area, or the names of theirs. */
async function areasOf(tenant: { id: TenantId }): Promise<Record<string, unknown>> {
  const { rows: areas } = await admin.query<{ name: string }>(
    'select name from areas where tenant_id = $1 order by name',
    [tenant.id],
  )
  const { rows: every } = await admin.query<{ user_id: string }>(
    'select user_id from member_all_areas where tenant_id = $1 order by user_id',
    [tenant.id],
  )
  const { rows: named } = await admin.query<{ user_id: string; name: string }>(
    `select m.user_id, a.name from member_areas m join areas a on a.id = m.area_id
      where m.tenant_id = $1 order by m.user_id, a.name`,
    [tenant.id],
  )

  return {
    areas: areas.map((row) => row.name),
    everyArea: every.map((row) => row.user_id),
    named: named.map((row) => `${row.user_id}: ${row.name}`),
  }
}

/**
 * Before the areas, every membership saw everything its tenant had. The
 * update gives each membership the areas it would have been given had it been
 * made afterwards: whoever leads and the technical management every area, the
 * others the one area a tenant begins with. Nobody who worked before sees
 * less after it, and the log of the tenant says why its areas came.
 */
describe('an installation from before the areas', () => {
  it('gives every membership there its areas with the update, and the log says why', async () => {
    await runMigrations(ownerDatabaseUrl(), kept(migrationsFolderUpTo(2)))

    const staffed = { id: newId<'tenant'>() }
    const empty = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
      staffed.id,
      'Wohnbau Nord eG',
      empty.id,
      'Wohnbau Süd eG',
    ])
    await members(staffed, {
      'user-lead': { roles: ['management'] },
      'user-duties': { roles: ['technical_management'] },
      'user-site': { roles: ['technician'] },
      // A blocked membership keeps what it would have had, for the day it is let back in.
      'user-gone': { roles: ['technician'], blocked: true },
    })

    await runMigrations(ownerDatabaseUrl())

    expect(await areasOf(staffed)).toEqual({
      areas: [firstAreaName],
      everyArea: ['user-duties', 'user-lead'],
      named: [`user-gone: ${firstAreaName}`, `user-site: ${firstAreaName}`],
    })
    // A tenant nobody works for gets its first area with its first member.
    expect(await areasOf(empty)).toEqual({ areas: [], everyArea: [], named: [] })

    const { rows: logged } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and table_name in ('areas', 'member_all_areas', 'member_areas')
        order by table_name`,
      [staffed.id],
    )

    expect(logged).toEqual([
      { table_name: 'areas', reason: 'migration' },
      { table_name: 'member_all_areas', reason: 'migration' },
      { table_name: 'member_areas', reason: 'migration' },
    ])

    // And a membership made after the update gets its areas from the
    // database, whichever version of the application writes it.
    await members(staffed, { 'user-new': { roles: ['technician'] } })

    expect((await areasOf(staffed))['named']).toContain(`user-new: ${firstAreaName}`)
  })

  it('loses the areas and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, {
      'user-lead': { roles: ['management'] },
      'user-site': { roles: ['technician'] },
    })

    // The places hang on the areas and go first, as on the way back of an
    // installation.
    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')
    await revertMigration(admin, '0009_activities_and_defects')
    await revertMigration(admin, '0008_evidence_and_deadlines')
    await revertMigration(admin, '0007_duties')
    await revertMigration(admin, '0004_assets')
    await revertMigration(admin, '0003_places')
    await revertMigration(admin, '0002_areas')

    const left = ['areas', 'member_all_areas', 'member_areas', 'substitutions']

    expect((await tableNames(admin)).filter((table) => left.includes(table))).toEqual([])
    expect((await functionNames(admin)).filter((name) => name.includes('area'))).toEqual([])

    const { rows: people } = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from memberships where tenant_id = $1',
      [tenant.id],
    )

    expect(people).toEqual([{ rows: 2 }])

    // The log of the tenant says that its areas went, and why.
    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'areas', reason: 'migration' },
      { table_name: 'member_all_areas', reason: 'migration' },
      { table_name: 'member_areas', reason: 'migration' },
    ])

    // A membership made afterwards is just a membership again.
    await members(tenant, { 'user-new': { roles: ['technician'] } })
  })
})

/**
 * The places hang on the areas and on nothing else yet. Taking their
 * migration back takes every place with it, says so in the log of the tenant,
 * and leaves the areas and who works where as they were.
 */
describe('an installation with places', () => {
  it('loses its places and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })
    await admin.query(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
         from areas where tenant_id = $1`,
      [tenant.id],
    )

    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')
    await revertMigration(admin, '0009_activities_and_defects')
    await revertMigration(admin, '0008_evidence_and_deadlines')
    await revertMigration(admin, '0007_duties')
    await revertMigration(admin, '0004_assets')
    await revertMigration(admin, '0003_places')

    const places = ['properties', 'buildings', 'floors', 'rooms']

    expect((await tableNames(admin)).filter((table) => places.includes(table))).toEqual([])
    expect(
      [...(await enumValues(admin)).keys()].filter((name) =>
        ['building_kind', 'federal_state'].includes(name),
      ),
    ).toEqual([])
    expect(
      (await functionNames(admin)).filter((name) =>
        ['each_once', 'mark_places_below'].includes(name),
      ),
    ).toEqual([])
    expect(await areasOf(tenant)).toEqual({
      areas: [firstAreaName],
      everyArea: ['user-lead'],
      named: [],
    })

    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([{ table_name: 'properties', reason: 'migration' }])
  })
})

/**
 * The assets hang on the places and on nothing else yet. Taking their
 * migration back takes every asset with its life cycle and supplies along,
 * says so in the log of the tenant, and leaves the places as they were,
 * without the key of a room in its building that came for the assets.
 */
describe('an installation with assets', () => {
  it('loses its assets and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: place } = await admin.query<{ property: string; building: string; area: string }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
           from areas where tenant_id = $1
         returning id, area_id
       ), building as (
         insert into buildings (tenant_id, property_id, area_id, name, kinds)
         select $1, id, area_id, 'Haus A', '{school}' from property
         returning id, property_id, area_id
       )
       select property_id as property, id as building, area_id as area from building`,
      [tenant.id],
    )
    const at = place[0] as { property: string; building: string; area: string }
    const { rows: made } = await admin.query<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
       values ($1, $2, $3, $4, 'probe.elevator', 'AN-00001', 'Aufzug')
       returning id`,
      [tenant.id, at.property, at.area, at.building],
    )
    const asset = made[0]?.id

    await admin.query(
      `insert into asset_lifecycle (tenant_id, asset_id, property_id, area_id, state, valid_from)
       values ($1, $2, $3, $4, 'in_service', '2020-01-01')`,
      [tenant.id, asset, at.property, at.area],
    )
    await admin.query(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
       values ($1, $2, $3, $4, $5)`,
      [tenant.id, asset, at.property, at.area, at.building],
    )

    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')
    await revertMigration(admin, '0009_activities_and_defects')
    await revertMigration(admin, '0008_evidence_and_deadlines')
    await revertMigration(admin, '0007_duties')
    await revertMigration(admin, '0004_assets')

    const technology = ['assets', 'asset_lifecycle', 'asset_supplies']

    expect((await tableNames(admin)).filter((table) => technology.includes(table))).toEqual([])
    expect(
      [...(await enumValues(admin)).keys()].filter((name) =>
        ['lifecycle_state', 'meter_unit'].includes(name),
      ),
    ).toEqual([])
    expect(
      (await functionNames(admin)).filter((name) =>
        [
          'asset_hangs_not_under_itself',
          'asset_stays_on_its_property',
          'mark_assets_below',
        ].includes(name),
      ),
    ).toEqual([])

    const { rows: keys } = await admin.query<{ conname: string }>(
      `select conname from pg_constraint where conname = 'rooms_in_their_building'`,
    )

    expect(keys).toEqual([])

    const { rows: places } = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from buildings where tenant_id = $1',
      [tenant.id],
    )

    expect(places).toEqual([{ rows: 1 }])

    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'asset_lifecycle', reason: 'migration' },
      { table_name: 'asset_supplies', reason: 'migration' },
      { table_name: 'assets', reason: 'migration' },
    ])
  })

  it('loses its duties and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ property: string; area: string; asset: string }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
           from areas where tenant_id = $1
         returning id, area_id
       ), building as (
         insert into buildings (tenant_id, property_id, area_id, name, kinds)
         select $1, id, area_id, 'Haus A', '{school}' from property
         returning id, property_id, area_id
       ), asset as (
         insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
         select $1, property_id, area_id, id, 'probe.elevator', 'AN-00001', 'Aufzug' from building
         returning id, property_id, area_id
       )
       select property_id as property, area_id as area, id as asset from asset`,
      [tenant.id],
    )
    const at = made[0] as { property: string; area: string; asset: string }

    await admin.query(
      `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                           interval_months, maximum_months, confirmed_by)
       values ($1, $2, $3, $4, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24, 'user-lead')`,
      [tenant.id, at.property, at.area, at.asset],
    )
    await admin.query(
      `insert into duty_dismissals (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                                    reason, dismissed_by)
       values ($1, $2, $3, $4, 'probe.elevator_annual_check', 1, 'Keine Notrufeinrichtung.',
               'user-lead')`,
      [tenant.id, at.property, at.area, at.asset],
    )

    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')
    await revertMigration(admin, '0009_activities_and_defects')
    await revertMigration(admin, '0008_evidence_and_deadlines')
    await revertMigration(admin, '0007_duties')

    expect(
      (await tableNames(admin)).filter((table) => ['duties', 'duty_dismissals'].includes(table)),
    ).toEqual([])
    expect(
      [...(await enumValues(admin)).keys()].filter((name) =>
        ['duty_basis', 'duty_counting', 'duty_performer'].includes(name),
      ),
    ).toEqual([])
    expect((await functionNames(admin)).filter((name) => name === 'mark_duties_below')).toEqual([])

    const { rows: triggers } = await admin.query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname = 'duties_follow_deletion'`,
    )

    expect(triggers).toEqual([])

    // The asset stays, and can be marked as before.
    await admin.query('update assets set deleted_at = now() where id = $1', [at.asset])

    const { rows: assets } = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from assets where tenant_id = $1',
      [tenant.id],
    )

    expect(assets).toEqual([{ rows: 1 }])

    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'duties', reason: 'migration' },
      { table_name: 'duty_dismissals', reason: 'migration' },
    ])
  })

  it('loses its evidence and deadlines and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ property: string; area: string; duty: string }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
           from areas where tenant_id = $1
         returning id, area_id
       ), building as (
         insert into buildings (tenant_id, property_id, area_id, name, kinds)
         select $1, id, area_id, 'Haus A', '{school}' from property
         returning id, property_id, area_id
       ), duty as (
         insert into duties (tenant_id, property_id, area_id, building_id, label, basis,
                             source_note, counting, interval_months, confirmed_by)
         select $1, property_id, area_id, id, 'Dachrinnen reinigen', 'insurer', 'Vertrag 4711',
                'from_performance', 12, 'user-lead' from building
         returning id, property_id, area_id
       )
       select property_id as property, area_id as area, id as duty from duty`,
      [tenant.id],
    )
    const at = made[0] as { property: string; area: string; duty: string }

    await admin.query(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       values ($1, $2, $3, $4, '2025-11-03', 'without_defects', ${writtenPlaceholders(5)})`,
      [
        tenant.id,
        at.property,
        at.area,
        at.duty,
        ...writtenValues('user-lead', '2025-11-03', 'without_defects'),
      ],
    )
    await admin.query(
      `insert into deadlines (tenant_id, kind, source_id, source_label, anchor_on, due_on, duty_id,
                              property_id, area_id)
       values ($1, 'duty.due', $2, 'Dachrinnen reinigen, Haus A', '2025-11-03', '2026-11-03', $2,
               $3, $4)`,
      [tenant.id, at.duty, at.property, at.area],
    )

    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')
    await revertMigration(admin, '0009_activities_and_defects')
    await revertMigration(admin, '0008_evidence_and_deadlines')

    expect(
      (await tableNames(admin)).filter((table) => ['deadlines', 'evidence'].includes(table)),
    ).toEqual([])
    expect(
      [...(await enumValues(admin)).keys()].filter((name) =>
        ['deadline_status', 'evidence_result'].includes(name),
      ),
    ).toEqual([])

    // The duty stays, and can be marked as before.
    await admin.query('update duties set deleted_at = now() where id = $1', [at.duty])

    const { rows: duties } = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from duties where tenant_id = $1',
      [tenant.id],
    )

    expect(duties).toEqual([{ rows: 1 }])

    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'deadlines', reason: 'migration' },
      { table_name: 'evidence', reason: 'migration' },
    ])
  })
  it('loses its activities and defects and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{
      property: string
      area: string
      asset: string
      duty: string
    }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
           from areas where tenant_id = $1
         returning id, area_id
       ), building as (
         insert into buildings (tenant_id, property_id, area_id, name, kinds)
         select $1, id, area_id, 'Haus A', '{school}' from property
         returning id, property_id, area_id
       ), asset as (
         insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
         select $1, property_id, area_id, id, 'probe.elevator', 'AN-00001', 'Aufzug' from building
         returning id, property_id, area_id
       ), duty as (
         insert into duties (tenant_id, property_id, area_id, asset_id, label, basis,
                             source_note, counting, interval_months, confirmed_by)
         select $1, property_id, area_id, id, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
                'from_performance', 12, 'user-lead' from asset
         returning id, property_id, area_id, asset_id
       )
       select property_id as property, area_id as area, asset_id as asset, id as duty from duty`,
      [tenant.id],
    )
    const at = made[0] as { property: string; area: string; asset: string; duty: string }
    const { rows: activity } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title)
       values ($1, $2, $3, $4, 'work_order', 'Sichtprüfung Aufzug') returning id`,
      [tenant.id, at.property, at.area, at.asset],
    )
    const activityId = activity[0]?.id

    await admin.query(
      `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       values ($1, $2, $3, $4, $5)`,
      [tenant.id, at.property, at.area, activityId, at.duty],
    )
    await admin.query(
      `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
       values ($1, $2, $3, $4, 'AU-2026-0001', 'inspection')`,
      [tenant.id, at.property, at.area, activityId],
    )
    await admin.query(
      `insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                            description, found_on)
       values ($1, $2, $3, $4, $5, 'Notruf im Fahrkorb ohne Verbindung.', '2026-10-01')`,
      [tenant.id, at.property, at.area, at.asset, activityId],
    )

    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')
    await revertMigration(admin, '0009_activities_and_defects')

    const gone = ['activities', 'activity_duties', 'work_orders', 'defects']

    expect((await tableNames(admin)).filter((table) => gone.includes(table))).toEqual([])
    expect(
      [...(await enumValues(admin)).keys()].filter((name) =>
        ['activity_kind', 'activity_status', 'work_order_kind', 'defect_status'].includes(name),
      ),
    ).toEqual([])

    // The asset and its duty stay, and can be marked as before.
    await admin.query('update assets set deleted_at = now() where id = $1', [at.asset])

    const { rows: kept } = await admin.query<{ assets: number; duties: number }>(
      `select (select count(*)::int from assets where tenant_id = $1) as assets,
              (select count(*)::int from duties where tenant_id = $1 and deleted_at is not null)
                as duties`,
      [tenant.id],
    )

    expect(kept).toEqual([{ assets: 1, duties: 1 }])

    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'activities', reason: 'migration' },
      { table_name: 'activity_duties', reason: 'migration' },
      { table_name: 'defects', reason: 'migration' },
      { table_name: 'work_orders', reason: 'migration' },
    ])
  })
  it('loses the written form of its evidence and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{
      property: string
      area: string
      asset: string
      duty: string
    }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
           from areas where tenant_id = $1
         returning id, area_id
       ), building as (
         insert into buildings (tenant_id, property_id, area_id, name, kinds)
         select $1, id, area_id, 'Haus A', '{school}' from property
         returning id, property_id, area_id
       ), asset as (
         insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
         select $1, property_id, area_id, id, 'probe.elevator', 'AN-00001', 'Aufzug' from building
         returning id, property_id, area_id
       ), duty as (
         insert into duties (tenant_id, property_id, area_id, asset_id, label, basis,
                             source_note, counting, interval_months, confirmed_by)
         select $1, property_id, area_id, id, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
                'from_performance', 12, 'user-lead' from asset
         returning id, property_id, area_id, asset_id
       )
       select property_id as property, area_id as area, asset_id as asset, id as duty from duty`,
      [tenant.id],
    )
    const at = made[0] as { property: string; area: string; asset: string; duty: string }

    await admin.query(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       values ($1, $2, $3, $4, '2025-11-03', 'without_defects', ${writtenPlaceholders(5)})`,
      [
        tenant.id,
        at.property,
        at.area,
        at.duty,
        ...writtenValues('user-lead', '2025-11-03', 'without_defects'),
      ],
    )

    await revertMigration(admin, '0011_signatures')
    await revertMigration(admin, '0010_evidence_written')

    const { rows: columns } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'evidence'
        order by ordinal_position`,
    )

    expect(columns.map((row) => row.column_name)).toEqual([
      'id',
      'tenant_id',
      'property_id',
      'area_id',
      'duty_id',
      'performed_on',
      'result',
      'created_at',
      'updated_at',
    ])
    expect([...(await enumValues(admin)).keys()].includes('evidence_origin')).toBe(false)

    // The row stays, as 0008 knows it, and the locks of 0010 have gone with it:
    // the asset can be marked again.
    await admin.query('update assets set deleted_at = now() where id = $1', [at.asset])

    const { rows: kept } = await admin.query<{ evidence: number; marked: number }>(
      `select (select count(*)::int from evidence where tenant_id = $1) as evidence,
              (select count(*)::int from assets where tenant_id = $1 and deleted_at is not null)
                as marked`,
      [tenant.id],
    )

    expect(kept).toEqual([{ evidence: 1, marked: 1 }])

    const { rows: removed } = await admin.query<{ table_name: string }>(
      `select distinct table_name from audit_entries
        where tenant_id = $1 and operation = 'delete'`,
      [tenant.id],
    )

    expect(removed).toEqual([])
  })
  it('loses its signatures and decisions and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ activity: string; order: string }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         select $1, id, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW'
           from areas where tenant_id = $1
         returning id, area_id
       ), duty as (
         insert into duties (tenant_id, property_id, area_id, label, basis, source_note, counting,
                             interval_months, confirmed_by)
         select $1, id, area_id, 'Zufahrt freihalten', 'authority', 'Brandschutzkonzept',
                'from_performance', 1, 'user-lead' from property
         returning id, property_id, area_id
       ), activity as (
         insert into activities (tenant_id, property_id, area_id, kind, title, performed_on)
         select $1, property_id, area_id, 'work_order', 'Zufahrt räumen', '2026-10-01' from duty
         returning id, property_id, area_id
       ), line as (
         insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result)
         select $1, a.property_id, a.area_id, a.id, d.id, 'without_defects' from activity a, duty d
       ), work_order as (
         insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
         select $1, property_id, area_id, id, 'AU-2026-0001', 'other' from activity
         returning id
       )
       select a.id as activity, w.id as order from activity a, work_order w`,
      [tenant.id],
    )
    const at = made[0] as { activity: string; order: string }

    await admin.query(
      `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                        signed_at, path, page_fingerprint)
       select tenant_id, property_id, area_id, id, 'user-lead', 'signer', now(), 'M10,10L200,300',
              repeat('a', 64)
         from activities where id = $1`,
      [at.activity],
    )
    await admin.query(
      `insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision,
                                         reason, decided_by)
       select tenant_id, property_id, area_id, id, 'rejected', 'Noch nicht geräumt.', 'user-lead'
         from work_orders where id = $1`,
      [at.order],
    )

    await revertMigration(admin, '0011_signatures')

    expect(
      (await tableNames(admin)).filter((table) =>
        ['activity_signatures', 'work_order_decisions'].includes(table),
      ),
    ).toEqual([])
    expect(
      [...(await enumValues(admin)).keys()].filter((name) =>
        ['signature_role', 'work_order_decision'].includes(name),
      ),
    ).toEqual([])

    const { rows: columns } = await admin.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and column_name in ('performed_on', 'countersignature_required', 'result', 'result_reason')
          and table_name in ('activities', 'activity_duties')`,
    )

    expect(columns).toEqual([])

    // The activity, its duty and its work order stay.
    const { rows: kept } = await admin.query<{ activities: number; orders: number }>(
      `select (select count(*)::int from activities where tenant_id = $1) as activities,
              (select count(*)::int from work_orders where tenant_id = $1) as orders`,
      [tenant.id],
    )

    expect(kept).toEqual([{ activities: 1, orders: 1 }])

    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'activity_signatures', reason: 'migration' },
      { table_name: 'work_order_decisions', reason: 'migration' },
    ])
  })
})
