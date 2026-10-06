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
    // place and the assets, so they go first, and what an invitation says
    // about areas hangs on the areas; the files, the mail server and the
    // settings of the deadlines hang on nothing of this.
    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')
    await revertMigration(admin, '0017_building_closures')
    await revertMigration(admin, '0016_contacts')
    await revertMigration(admin, '0014_invitation_areas')
    await revertMigration(admin, '0012_evidence_corrections')
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
    // installation, and so does what an invitation says about areas.
    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')
    await revertMigration(admin, '0017_building_closures')
    await revertMigration(admin, '0016_contacts')
    await revertMigration(admin, '0014_invitation_areas')
    await revertMigration(admin, '0012_evidence_corrections')
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

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')
    await revertMigration(admin, '0017_building_closures')
    await revertMigration(admin, '0016_contacts')
    await revertMigration(admin, '0012_evidence_corrections')
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

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')
    await revertMigration(admin, '0012_evidence_corrections')
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

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')
    await revertMigration(admin, '0012_evidence_corrections')
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

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')
    await revertMigration(admin, '0012_evidence_corrections')
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

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')
    await revertMigration(admin, '0012_evidence_corrections')
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

    await revertMigration(admin, '0012_evidence_corrections')
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

    await revertMigration(admin, '0012_evidence_corrections')
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
  it('loses its declarations of invalidity and what a correction replaces, and nothing else, when the update is taken back', async () => {
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
       ), duty as (
         insert into duties (tenant_id, property_id, area_id, label, basis, source_note, counting,
                             interval_months, confirmed_by)
         select $1, id, area_id, 'Zufahrt freihalten', 'authority', 'Brandschutzkonzept',
                'from_performance', 1, 'user-lead' from property
         returning id, property_id, area_id
       )
       select property_id as property, area_id as area, id as duty from duty`,
      [tenant.id],
    )
    const at = made[0] as { property: string; area: string; duty: string }
    const evidenceAt = async (
      performedOn: string,
      replaces: { readonly id: string; readonly reason: string } | null,
    ) => {
      const values = [
        tenant.id,
        at.property,
        at.area,
        at.duty,
        performedOn,
        ...writtenValues('user-lead', performedOn, 'without_defects'),
        ...(replaces === null ? [] : [replaces.id, replaces.reason]),
      ]
      const { rows } = await admin.query<{ id: string }>(
        `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                               ${writtenColumnNames}${replaces === null ? '' : ', replaces_evidence_id, replacement_reason'})
         values ($1, $2, $3, $4, $5, 'without_defects', ${writtenPlaceholders(6)}${
           replaces === null ? '' : `, $${String(values.length - 1)}, $${String(values.length)}`
         })
         returning id`,
        values,
      )

      return rows[0]?.id ?? ''
    }

    const first = await evidenceAt('2026-09-01', null)
    const correction = await evidenceAt('2026-09-02', { id: first, reason: 'Falscher Tag.' })

    await admin.query(
      `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
       values ($1, $2, $3, $4, 'Der Bericht gehört zu einer anderen Zufahrt.', 'user-lead')`,
      [tenant.id, at.property, at.area, correction],
    )

    await revertMigration(admin, '0012_evidence_corrections')

    expect((await tableNames(admin)).includes('evidence_voidings')).toBe(false)

    const { rows: columns } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'evidence'
          and column_name in ('replaces_evidence_id', 'replacement_reason')`,
    )

    expect(columns).toEqual([])

    // Both evidence stay, the correction as an evidence of its own.
    const { rows: kept } = await admin.query<{ evidence: number }>(
      'select count(*)::int as evidence from evidence where tenant_id = $1',
      [tenant.id],
    )

    expect(kept).toEqual([{ evidence: 2 }])

    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([{ table_name: 'evidence_voidings', reason: 'migration' }])
  })

  /**
   * 0013 closes the counter of the sync to every role but the application
   * (opengewerk#471). The database began with a building block that created
   * the function without a word about who may call it, which leaves it open
   * to PUBLIC; the building block says it now, and this migration is the same
   * change for a database made from the earlier one. A database in use keeps
   * working through it: the application role calls the counter before and
   * after, and taken back, the function is as open as it was.
   */
  it('closes the counter of the sync to every role but the application, and opens it again when taken back', async () => {
    await applyMigrations()

    const mayCall = async (role: string) => {
      const { rows } = await admin.query<{ may: boolean }>(
        `select has_function_privilege($1, 'next_sync_sequence(uuid)', 'execute') as may`,
        [role],
      )

      return rows[0]?.may
    }

    expect(await mayCall('public')).toBe(false)
    expect(await mayCall('opengewerk_app')).toBe(true)

    await revertMigration(admin, '0013_sync_counter_grant')

    expect(await mayCall('public')).toBe(true)
    expect(await mayCall('opengewerk_app')).toBe(true)
  })
})

/**
 * 0014 lets an invitation say in which areas whoever takes it up is to work
 * (#84). On the way forward it touches no row: an invitation from before says
 * nothing about areas, which is what it said then. Taken back, what the
 * invitations say goes, with the reason in the log of the tenant, and the
 * invitations themselves, the areas and who holds in which stay as they were.
 */
describe('an installation whose invitations name areas', () => {
  it('loses what its invitations say about areas and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: invited } = await admin.query<{ id: string }>(
      `insert into invitations (tenant_id, email, name, roles, token_hash, invited_by, expires_at)
       values ($1, 'neu@beispiel.example', 'Neu im Haus', '{technician}', $2, 'user-lead',
               now() + interval '7 days')
       returning id`,
      [tenant.id, 'c'.repeat(64)],
    )
    const invitation = invited[0]?.id

    await admin.query(
      `insert into invitation_area_choices (tenant_id, invitation_id, every_area)
       values ($1, $2, false)`,
      [tenant.id, invitation],
    )
    await admin.query(
      `insert into invitation_areas (tenant_id, invitation_id, area_id)
       select $1, $2, id from areas where tenant_id = $1`,
      [tenant.id, invitation],
    )

    await revertMigration(admin, '0014_invitation_areas')

    const left = ['invitation_area_choices', 'invitation_areas']

    expect((await tableNames(admin)).filter((table) => left.includes(table))).toEqual([])

    // The invitation stays, and so do the area and who holds in every one.
    const { rows: kept } = await admin.query<{
      invitations: number
      areas: number
      everywhere: number
    }>(
      `select (select count(*)::int from invitations where tenant_id = $1) as invitations,
              (select count(*)::int from areas where tenant_id = $1) as areas,
              (select count(*)::int from member_all_areas where tenant_id = $1) as everywhere`,
      [tenant.id],
    )

    expect(kept).toEqual([{ invitations: 1, areas: 1, everywhere: 1 }])

    // The log of the tenant says that what its invitation said went, and why.
    const { rows: removed } = await admin.query<{ table_name: string; reason: string | null }>(
      `select distinct table_name, reason from audit_entries
        where tenant_id = $1 and operation = 'delete'
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'invitation_area_choices', reason: 'migration' },
      { table_name: 'invitation_areas', reason: 'migration' },
    ])
  })
})

/**
 * 0015 gives a property a note (#85). On the way forward it touches no row.
 * Taken back, the notes go, and the log of the tenant says so with the
 * reason, because dropping a column writes nothing in any log; the property
 * and everything else it says stay.
 */
describe('an installation whose properties carry notes', () => {
  it('loses the notes and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })
    await admin.query(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state, note)
       select $1, areas.id, given.name, 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW', given.note
         from areas, (values ('Campus Nord', 'Zufahrt über den Hof.'), ('Campus Süd', null)) as given (name, note)
        where areas.tenant_id = $1`,
      [tenant.id],
    )

    await revertMigration(admin, '0015_property_note')

    const { rows: columns } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'properties' and column_name = 'note'`,
    )

    expect(columns).toEqual([])

    // Both properties stay, with what they said beside the note.
    const { rows: kept } = await admin.query<{ name: string; city: string }>(
      'select name, city from properties where tenant_id = $1 order by name',
      [tenant.id],
    )

    expect(kept).toEqual([
      { name: 'Campus Nord', city: 'Beispielstadt' },
      { name: 'Campus Süd', city: 'Beispielstadt' },
    ])

    // The log of the tenant says that the one note went, and why.
    const { rows: emptied } = await admin.query<{
      old_value: string | null
      new_value: string | null
      reason: string | null
    }>(
      `select old_value, new_value, reason from audit_entries
        where tenant_id = $1 and table_name = 'properties' and field = 'note'
          and operation = 'update'
        order by sequence`,
      [tenant.id],
    )

    expect(emptied).toEqual([
      { old_value: 'Zufahrt über den Hof.', new_value: null, reason: 'migration' },
    ])
  })
})

/**
 * 0016 brings the people to talk to at a property (#85). On the way forward
 * it touches no row. Taken back, the contacts go with their table, and the
 * log of the tenant says that they went and why, because dropping a table
 * writes nothing in any log. The trigger on the properties goes with its
 * function, so a property is marked afterwards as it was before.
 */
describe('an installation whose properties have people to talk to', () => {
  it('loses its contacts and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ id: string; area_id: string }>(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Schulzentrum', 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW'
         from areas where tenant_id = $1
       returning id, area_id`,
      [tenant.id],
    )
    const property = made[0]

    await admin.query(
      `insert into contacts (tenant_id, property_id, area_id, family_name, role)
       values ($1, $2, $3, 'Becker', 'Hausmeister'), ($1, $2, $3, 'Albers', 'Schulleitung')`,
      [tenant.id, property?.id, property?.area_id],
    )

    await revertMigration(admin, '0016_contacts')

    expect((await tableNames(admin)).filter((table) => table === 'contacts')).toEqual([])
    expect((await functionNames(admin)).filter((name) => name === 'mark_contacts_below')).toEqual(
      [],
    )

    // The property stays as it was, and marking it asks after no table that is gone.
    const { rows: kept } = await admin.query<{ name: string; version: number }>(
      'select name, version from properties where tenant_id = $1',
      [tenant.id],
    )

    expect(kept).toEqual([{ name: 'Schulzentrum', version: 1 }])
    await expect(
      admin.query('update properties set deleted_at = now() where id = $1', [property?.id]),
    ).resolves.toMatchObject({ rowCount: 1 })

    // The log of the tenant says that both contacts went, and why.
    const { rows: removed } = await admin.query<{
      table_name: string
      reason: string | null
      records: number
    }>(
      `select table_name, reason, count(distinct record_id)::int as records from audit_entries
        where tenant_id = $1 and operation = 'delete'
        group by table_name, reason`,
      [tenant.id],
    )

    expect(removed).toEqual([{ table_name: 'contacts', reason: 'migration', records: 2 }])
  })
})

/**
 * 0017 brings the times a building is closed (#86). On the way forward it
 * touches no row. Taken back, the closures go with their table, and the log
 * of the tenant says that they went and why, because dropping a table writes
 * nothing in any log. The trigger on the buildings goes with its function, so
 * a building is marked afterwards as it was before.
 */
describe('an installation whose buildings have times they are closed', () => {
  it('loses its closures and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ id: string; area_id: string }>(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Schulzentrum', 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW'
         from areas where tenant_id = $1
       returning id, area_id`,
      [tenant.id],
    )
    const property = made[0]
    const { rows: built } = await admin.query<{ id: string }>(
      `insert into buildings (tenant_id, property_id, area_id, name, kinds)
       values ($1, $2, $3, 'Schulhaus', '{school}')
       returning id`,
      [tenant.id, property?.id, property?.area_id],
    )
    const building = built[0]?.id

    await admin.query(
      `insert into building_closures (tenant_id, building_id, property_id, area_id, starts_on, ends_on, reason)
       values ($1, $2, $3, $4, '2026-12-24', '2027-01-06', 'Weihnachtsferien'),
              ($1, $2, $3, $4, '2027-07-27', '2027-09-06', 'Sommerferien')`,
      [tenant.id, building, property?.id, property?.area_id],
    )

    await revertMigration(admin, '0017_building_closures')

    expect((await tableNames(admin)).filter((table) => table === 'building_closures')).toEqual([])
    expect((await functionNames(admin)).filter((name) => name === 'mark_closures_below')).toEqual(
      [],
    )

    // The building stays as it was, and marking it asks after no table that is gone.
    const { rows: kept } = await admin.query<{ name: string; version: number }>(
      'select name, version from buildings where tenant_id = $1',
      [tenant.id],
    )

    expect(kept).toEqual([{ name: 'Schulhaus', version: 1 }])
    await expect(
      admin.query('update buildings set deleted_at = now() where id = $1', [building]),
    ).resolves.toMatchObject({ rowCount: 1 })

    // The log of the tenant says that both closures went, and why.
    const { rows: removed } = await admin.query<{
      table_name: string
      reason: string | null
      records: number
    }>(
      `select table_name, reason, count(distinct record_id)::int as records from audit_entries
        where tenant_id = $1 and operation = 'delete'
        group by table_name, reason`,
      [tenant.id],
    )

    expect(removed).toEqual([{ table_name: 'building_closures', reason: 'migration', records: 2 }])
  })
})

/**
 * 0022 brings the import from tables (#100): the list of the imports, what
 * the lists of a tenant call the asset kinds, and the condition under which
 * the log is silent about a place or an asset, which is while the import that
 * made it is written. On the way forward it touches no row. Taken back, both
 * lists go with their tables, and the log of the tenant says that they went
 * and why; the function goes, and the five triggers of the log write for
 * every record again. What the imports made stays where it is.
 */
describe('an installation that imported from tables', () => {
  /** The tables whose trigger of the log carries a condition. */
  async function quietTables(): Promise<string[]> {
    const { rows } = await admin.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and p.proname = 'record_change' and t.tgqual is not null
        order by c.relname`,
    )

    return rows.map((row) => row.table_name)
  }

  it('loses the list of its imports and the names of its asset kinds, and keeps what the imports made', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ id: string; area_id: string }>(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Schulzentrum', 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW'
         from areas where tenant_id = $1
       returning id, area_id`,
      [tenant.id],
    )
    const property = made[0]
    const { rows: built } = await admin.query<{ id: string }>(
      `insert into buildings (tenant_id, property_id, area_id, name, kinds)
       values ($1, $2, $3, 'Schulhaus', '{school}') returning id`,
      [tenant.id, property?.id, property?.area_id],
    )

    await admin.query(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
       values ($1, $2, $3, $4, 'probe.elevator', 'Aufzug')`,
      [tenant.id, property?.id, property?.area_id, built[0]?.id],
    )
    await admin.query(
      `insert into imports (tenant_id, kind, file_name, lines, summary)
       values ($1, 'structure', 'bestand.csv', 2, '1 Liegenschaft und 1 Gebäude angelegt'),
              ($1, 'assets', 'anlagen.xlsx', 1, '1 Anlage angelegt')`,
      [tenant.id],
    )
    await admin.query(
      `insert into asset_kind_names (tenant_id, name, name_key, kind)
       values ($1, 'Aufzug', 'aufzug', 'probe.elevator')`,
      [tenant.id],
    )

    expect(await quietTables()).toEqual(['assets', 'buildings', 'floors', 'properties', 'rooms'])

    await revertMigration(admin, '0022_imports')

    expect(
      (await tableNames(admin)).filter((table) => ['imports', 'asset_kind_names'].includes(table)),
    ).toEqual([])
    expect((await functionNames(admin)).filter((name) => name === 'import_writing')).toEqual([])

    // The triggers of the log are there as before the update, each without a condition.
    expect(await quietTables()).toEqual([])

    const { rows: watched } = await admin.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and p.proname = 'record_change' and t.tgname = 'audit_changes'
          and c.relname in ('assets', 'buildings', 'floors', 'properties', 'rooms')
        order by c.relname`,
    )

    expect(watched.map((row) => row.table_name)).toEqual([
      'assets',
      'buildings',
      'floors',
      'properties',
      'rooms',
    ])

    // What the imports made stays, and a change of it is logged.
    const { rows: kept } = await admin.query<{ property: string; building: string; asset: string }>(
      `select p.name as property, b.name as building, a.name as asset
         from properties p
         join buildings b on b.property_id = p.id
         join assets a on a.building_id = b.id
        where p.tenant_id = $1`,
      [tenant.id],
    )

    expect(kept).toEqual([{ property: 'Schulzentrum', building: 'Schulhaus', asset: 'Aufzug' }])

    await admin.query(`update assets set name = 'Aufzug Haus A' where tenant_id = $1`, [tenant.id])

    const { rows: renamed } = await admin.query<{ new_value: string | null }>(
      `select new_value from audit_entries
        where tenant_id = $1 and table_name = 'assets' and operation = 'update' and field = 'name'`,
      [tenant.id],
    )

    expect(renamed).toEqual([{ new_value: 'Aufzug Haus A' }])

    // The log of the tenant says that the rows of both lists went, and why.
    const { rows: removed } = await admin.query<{
      table_name: string
      reason: string | null
      records: number
    }>(
      `select table_name, reason, count(distinct record_id)::int as records from audit_entries
        where tenant_id = $1 and operation = 'delete'
        group by table_name, reason
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'asset_kind_names', reason: 'migration', records: 1 },
      { table_name: 'imports', reason: 'migration', records: 2 },
    ])
  })
})

/**
 * 0021 brings what taking stock on site writes (#99): what an asset was found
 * to be distinct from, and a label from a sheet given to an asset. On the way
 * forward it touches no row. Taken back, the lists go, and the log of the
 * tenant says so; a label that was given stays on its asset, and the function
 * that looks past the areas goes.
 */
describe('an installation that took stock on site', () => {
  it('loses what its assets were found distinct from, and keeps its labels where they hang', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ id: string; area_id: string }>(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Schulzentrum', 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW'
         from areas where tenant_id = $1
       returning id, area_id`,
      [tenant.id],
    )
    const property = made[0]
    const { rows: built } = await admin.query<{ id: string }>(
      `insert into buildings (tenant_id, property_id, area_id, name, kinds)
       values ($1, $2, $3, 'Schulhaus', '{school}') returning id`,
      [tenant.id, property?.id, property?.area_id],
    )
    const { rows: stood } = await admin.query<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, name, serial_number)
       values ($1, $2, $3, $4, 'probe.elevator', 'Aufzug', 'SN-1') returning id`,
      [tenant.id, property?.id, property?.area_id, built[0]?.id],
    )
    const { rows: second } = await admin.query<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, name, serial_number,
                           distinct_from)
       values ($1, $2, $3, $4, 'probe.elevator', 'Aufzug Süd', 'SN-1', array[$5]::uuid[])
       returning id`,
      [tenant.id, property?.id, property?.area_id, built[0]?.id, stood[0]?.id],
    )

    await admin.query(
      `insert into labels (tenant_id, property_id, area_id, asset_id, code)
       values ($1, $2, $3, null, '3XQ7M2K9PDH4TA6W')`,
      [tenant.id, property?.id, property?.area_id],
    )
    await admin.query(`update labels set asset_id = $2 where tenant_id = $1`, [
      tenant.id,
      second[0]?.id,
    ])

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')

    expect(
      (await functionNames(admin)).filter((name) =>
        ['asset_duplicate_candidates', 'keep_label_given'].includes(name),
      ),
    ).toEqual([])

    const { rows: columns } = await admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'assets' and column_name = 'distinct_from'`,
    )

    expect(columns).toEqual([])

    // The label stays on the asset it was given to.
    const { rows: hung } = await admin.query<{ asset_id: string | null }>(
      'select asset_id from labels where tenant_id = $1',
      [tenant.id],
    )

    expect(hung).toEqual([{ asset_id: second[0]?.id }])

    // The log of the tenant says that one list went, and why.
    const { rows: emptied } = await admin.query<{ reason: string | null; records: number }>(
      `select reason, count(distinct record_id)::int as records from audit_entries
        where tenant_id = $1 and table_name = 'assets' and operation = 'update'
        group by reason`,
      [tenant.id],
    )

    expect(emptied).toEqual([{ reason: 'migration', records: 1 }])
  })
})

/**
 * 0020 brings the labels with a QR code (#98). On the way forward it touches
 * no row. Taken back, the labels go with their table, and the log of the
 * tenant says that they went and why. The asset and the room they hung on
 * stay as they were, the triggers on them go with their function, so an asset
 * is marked afterwards as it was before, and the function that looks past the
 * areas goes with the table it read.
 */
describe('an installation with labels', () => {
  it('loses its labels and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ id: string; area_id: string }>(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Schulzentrum', 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW'
         from areas where tenant_id = $1
       returning id, area_id`,
      [tenant.id],
    )
    const property = made[0]
    const { rows: built } = await admin.query<{ id: string }>(
      `insert into buildings (tenant_id, property_id, area_id, name, kinds)
       values ($1, $2, $3, 'Schulhaus', '{school}') returning id`,
      [tenant.id, property?.id, property?.area_id],
    )
    const { rows: stood } = await admin.query<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, name)
       values ($1, $2, $3, $4, 'probe.elevator', 'Aufzug') returning id`,
      [tenant.id, property?.id, property?.area_id, built[0]?.id],
    )

    await admin.query(
      `insert into labels (tenant_id, property_id, area_id, asset_id, code, blocked_at)
       values ($1, $2, $3, $4, '3XQ7M2K9PDH4TA6W', now()),
              ($1, $2, $3, $4, '7M2K9PDH4TA6W3XQ', null),
              ($1, $2, $3, null, 'PDH4TA6W3XQ7M2K9', null)`,
      [tenant.id, property?.id, property?.area_id, stood[0]?.id],
    )

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')

    expect((await tableNames(admin)).filter((table) => table === 'labels')).toEqual([])
    expect(
      (await functionNames(admin)).filter((name) =>
        ['mark_labels_below', 'keep_label_blocked', 'label_state_in_tenant'].includes(name),
      ),
    ).toEqual([])

    // The asset stays as it was, and marking it asks after no table that is gone.
    const { rows: kept } = await admin.query<{ name: string; version: number }>(
      'select name, version from assets where tenant_id = $1',
      [tenant.id],
    )

    expect(kept).toEqual([{ name: 'Aufzug', version: 1 }])
    await expect(
      admin.query('update assets set deleted_at = now() where id = $1', [stood[0]?.id]),
    ).resolves.toMatchObject({ rowCount: 1 })

    // The log of the tenant says that the three labels went, and why.
    const { rows: removed } = await admin.query<{
      table_name: string
      reason: string | null
      records: number
    }>(
      `select table_name, reason, count(distinct record_id)::int as records from audit_entries
        where tenant_id = $1 and operation = 'delete'
        group by table_name, reason`,
      [tenant.id],
    )

    expect(removed).toEqual([{ table_name: 'labels', reason: 'migration', records: 3 }])
  })
})

/**
 * 0019 brings the documents with their versions (#97). On the way forward it
 * touches no row. Taken back, the documents and their versions go with their
 * tables, although a version is otherwise removed by nobody, and the log of
 * the tenant says that they went and why. The files they named stay, in the
 * store and as rows, and the triggers on the records a document hangs on go
 * with their function, so a property is marked afterwards as it was before.
 */
describe('an installation with documents', () => {
  it('loses its documents and their versions and nothing else when the update is taken back', async () => {
    await applyMigrations()

    const tenant = { id: newId<'tenant'>() }
    const file = 'c'.repeat(64)

    await admin.query('insert into tenants (id, name) values ($1, $2)', [
      tenant.id,
      'Wohnbau Nord eG',
    ])
    await members(tenant, { 'user-lead': { roles: ['management'] } })

    const { rows: made } = await admin.query<{ id: string; area_id: string }>(
      `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       select $1, id, 'Schulzentrum', 'Musterweg 1', '00001', 'Beispielstadt', 'DE-BW'
         from areas where tenant_id = $1
       returning id, area_id`,
      [tenant.id],
    )
    const property = made[0]

    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type)
       values ($1, $2, 2048, 'application/pdf')`,
      [tenant.id, file],
    )

    const { rows: filed } = await admin.query<{ id: string }>(
      `insert into attachments (tenant_id, property_id, area_id, title, kind)
       values ($1, $2, $3, 'Brandschutzkonzept', 'concept') returning id`,
      [tenant.id, property?.id, property?.area_id],
    )

    await admin.query(
      `insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type,
                                        size_bytes)
       values ($1, $2, $3, 'konzept-2019.pdf', 'application/pdf', 2048),
              ($1, $2, $3, 'konzept-2024.pdf', 'application/pdf', 2048)`,
      [tenant.id, filed[0]?.id, file],
    )

    await revertMigration(admin, '0022_imports')
    await revertMigration(admin, '0021_stock_taking')
    await revertMigration(admin, '0020_labels')
    await revertMigration(admin, '0019_documents')

    expect(
      (await tableNames(admin)).filter((table) =>
        ['attachments', 'attachment_versions'].includes(table),
      ),
    ).toEqual([])
    expect(
      (await functionNames(admin)).filter((name) =>
        [
          'mark_documents_below',
          'record_attachment_uploader',
          'attachment_version_stays_as_written',
        ].includes(name),
      ),
    ).toEqual([])

    // The file the versions named stays a file of the tenant.
    const { rows: files } = await admin.query<{ sha256: string }>(
      'select sha256 from files where tenant_id = $1',
      [tenant.id],
    )

    expect(files).toEqual([{ sha256: file }])

    // The property stays as it was, and marking it asks after no table that is gone.
    const { rows: kept } = await admin.query<{ name: string; version: number }>(
      'select name, version from properties where tenant_id = $1',
      [tenant.id],
    )

    expect(kept).toEqual([{ name: 'Schulzentrum', version: 1 }])
    await expect(
      admin.query('update properties set deleted_at = now() where id = $1', [property?.id]),
    ).resolves.toMatchObject({ rowCount: 1 })

    // The log of the tenant says that the document and both versions went, and why.
    const { rows: removed } = await admin.query<{
      table_name: string
      reason: string | null
      records: number
    }>(
      `select table_name, reason, count(distinct record_id)::int as records from audit_entries
        where tenant_id = $1 and operation = 'delete'
        group by table_name, reason
        order by table_name`,
      [tenant.id],
    )

    expect(removed).toEqual([
      { table_name: 'attachment_versions', reason: 'migration', records: 2 },
      { table_name: 'attachments', reason: 'migration', records: 1 },
    ])
  })
})
