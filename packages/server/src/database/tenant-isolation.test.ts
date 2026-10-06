import { randomBytes, randomUUID } from 'node:crypto'

import { labelCodeFrom, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applicationRole,
  applyMigrations,
  connect,
  foundationDefinerFunctions,
  insufficientPrivilege,
  keysBetweenTenantTables,
  readDefinerFunctions,
  readPolicies,
  refusedBy,
  resetSchema,
  tableProtections,
  unprotected,
  withoutTheTenant,
} from './test-database.js'
import { writtenColumns } from './test-evidence.js'
import { inEveryArea } from './every-area.js'
import { areaBoundaryProblems } from './test-areas.js'

/**
 * Row level security is a property of the database and not of the code above
 * it, so these tests talk to a real PostgreSQL through the role the
 * application uses. A superuser walks past every policy, which is exactly why
 * the application must never be one, and why a test run as one would prove
 * nothing.
 *
 * Two kinds of question are asked. The catalogue is asked what protects each
 * table, with the questions of the foundation (ADR 0010 in the repository
 * opengewerk). And two tenants are given a row in every table, to see what
 * each of them reaches: the catalogue says what should hold, the rows say
 * whether it does.
 *
 * A tenant is what the interface calls a "Betreiber". In the database it
 * keeps the name the foundation gives it.
 */

/**
 * A tenant, and the two people working for it: one stands in for the other,
 * which is the one row of a tenant that needs two.
 */
interface Tenant {
  readonly id: TenantId
  readonly name: string
  readonly userId: string
  readonly email: string
  readonly colleagueId: string
}

const north: Tenant = {
  id: newId<'tenant'>(),
  name: 'Wohnbau Nord eG',
  userId: 'user-north',
  email: 'leitung@nord.example',
  colleagueId: 'colleague-north',
}
const south: Tenant = {
  id: newId<'tenant'>(),
  name: 'Wohnbau Süd eG',
  userId: 'user-south',
  email: 'leitung@sued.example',
  colleagueId: 'colleague-south',
}
const both = [north.id, south.id].sort()

/** One row for one table, as the columns it sets. */
interface Row {
  readonly table: string
  readonly values: Readonly<Record<string, unknown>>
}

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)

/**
 * A row for a tenant in every table of a tenant that takes rows from outside.
 *
 * In the order the keys ask for. Every value that has to be unique is made
 * anew on each call, so the same rows can be offered a second time: once to
 * fill the tables, and once by the other tenant, which is the attempt below.
 *
 * Three tables of a tenant are missing on purpose. `audit_chains` and
 * `audit_entries` are written by the trigger while the rows here go in, and
 * `sync_sequences` by the function that hands out the number of a change.
 *
 * A table that a later migration adds gets its row here. Without one the
 * tenant has nothing in it, and the tests below say so by name.
 */
function rowsOf(tenant: Tenant): readonly Row[] {
  const invitation = randomUUID()
  const area = randomUUID()
  const property = randomUUID()
  const building = randomUUID()
  const floor = randomUUID()
  const asset = randomUUID()
  const duty = randomUUID()
  const activity = randomUUID()
  const workOrder = randomUUID()
  const evidence = randomUUID()
  const document = randomUUID()
  const file = randomUUID().replaceAll('-', '').repeat(2)

  return [
    {
      table: 'tenants',
      values: { id: tenant.id, name: tenant.name },
    },
    {
      table: 'tenant_roles',
      values: {
        tenant_id: tenant.id,
        key: `lead-${randomUUID().slice(0, 8)}`,
        label: 'Leitung',
        rights: ['membership.read', 'membership.write'],
        leads: true,
        second_factor: true,
      },
    },
    {
      table: 'memberships',
      values: { tenant_id: tenant.id, user_id: tenant.userId, roles: ['lead'] },
    },
    {
      table: 'memberships',
      values: { tenant_id: tenant.id, user_id: tenant.colleagueId, roles: ['lead'] },
    },
    {
      table: 'member_passkeys',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.userId,
        passkey_id: `passkey-${randomUUID()}`,
        name: 'Schlüssel am Telefon',
      },
    },
    {
      table: 'account_corrections',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.colleagueId,
        name_before: 'Kolege',
        name_after: 'Kollege',
      },
    },
    {
      table: 'invitations',
      values: {
        id: invitation,
        tenant_id: tenant.id,
        email: `neu-${randomUUID().slice(0, 8)}@beispiel.example`,
        name: 'Neu im Haus',
        roles: ['lead'],
        token_hash: randomUUID(),
        invited_by: tenant.userId,
        expires_at: tomorrow,
      },
    },
    {
      table: 'tenant_sessions',
      values: {
        tenant_id: tenant.id,
        user_id: tenant.userId,
        session_id: `session-${randomUUID()}`,
      },
    },
    {
      table: 'sync_operations',
      values: {
        id: randomUUID(),
        tenant_id: tenant.id,
        entity: 'record',
        record_id: randomUUID(),
        outcome: 'applied',
        device_id: 'tablet',
      },
    },
    {
      table: 'sync_conflicts',
      values: {
        tenant_id: tenant.id,
        operation_id: randomUUID(),
        entity: 'record',
        record_id: randomUUID(),
        reason: 'changed_elsewhere',
        fields: ['name'],
        wanted: { name: 'wanted' },
        seen: { name: 'seen' },
        found: { name: 'found' },
        device_id: 'tablet',
        recorded_at: new Date(),
      },
    },
    {
      table: 'number_ranges',
      values: { tenant_id: tenant.id, key: 'asset', pattern: 'A-{number:5}' },
    },
    {
      table: 'secrets',
      values: {
        tenant_id: tenant.id,
        purpose: 'smtp_password',
        sealed: `sealed-${randomUUID()}`,
      },
    },
    // The files and the mail server of a tenant come with the foundation (#23).
    // A file is written through the route of the foundation (#96); nothing in
    // this application writes a mail server before its screen, the test does.
    {
      table: 'files',
      values: {
        tenant_id: tenant.id,
        sha256: file,
        size_bytes: 2048,
        media_type: 'application/pdf',
      },
    },
    {
      table: 'mail_settings',
      values: {
        tenant_id: tenant.id,
        host: 'mail.beispiel.example',
        port: 587,
        security: 'starttls',
        from_address: `technik-${tenant.id.slice(0, 8)}@beispiel.example`,
      },
    },
    // What a tenant sets for a kind of deadline and when the engine last went
    // through it come with the foundation (#24). The deadlines themselves come
    // with the duties (#25); until then only the test writes either table.
    {
      table: 'deadline_settings',
      values: {
        tenant_id: tenant.id,
        kind: 'probe.inspection',
        lead_days: 14,
        interval_months: 12,
        responsible_user_id: tenant.userId,
      },
    },
    {
      table: 'deadline_runs',
      values: { tenant_id: tenant.id, succeeded_at: new Date() },
    },
    // A first membership gives a tenant its first area, so the area here is a
    // second one beside it, under a name of its own.
    {
      table: 'areas',
      values: { id: area, tenant_id: tenant.id, name: `Bereich ${area.slice(0, 8)}` },
    },
    {
      table: 'member_areas',
      values: { tenant_id: tenant.id, user_id: tenant.userId, area_id: area },
    },
    {
      table: 'member_all_areas',
      values: { tenant_id: tenant.id, user_id: tenant.colleagueId },
    },
    // What the invitation above says about areas: the ones named, and one.
    {
      table: 'invitation_area_choices',
      values: { tenant_id: tenant.id, invitation_id: invitation, every_area: false },
    },
    {
      table: 'invitation_areas',
      values: { tenant_id: tenant.id, invitation_id: invitation, area_id: area },
    },
    {
      table: 'substitutions',
      values: {
        tenant_id: tenant.id,
        substitute_user_id: tenant.userId,
        absent_user_id: tenant.colleagueId,
        starts_on: '2026-10-05',
        ends_on: '2026-10-09',
      },
    },
    // The place, from the property to the room, in the area above.
    {
      table: 'properties',
      values: {
        id: property,
        tenant_id: tenant.id,
        area_id: area,
        name: 'Wohnanlage Nordstraße',
        street: 'Nordstraße 12',
        postal_code: '68535',
        city: 'Edingen-Neckarhausen',
        federal_state: 'DE-BW',
      },
    },
    {
      table: 'buildings',
      values: {
        id: building,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        name: 'Haus A',
        kinds: ['residential'],
      },
    },
    {
      table: 'contacts',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        family_name: 'Becker',
        role: 'Hausmeister',
      },
    },
    {
      table: 'building_closures',
      values: {
        tenant_id: tenant.id,
        building_id: building,
        property_id: property,
        area_id: area,
        starts_on: '2026-12-24',
        ends_on: '2027-01-06',
        reason: 'Weihnachtsferien',
      },
    },
    {
      table: 'floors',
      values: {
        id: floor,
        tenant_id: tenant.id,
        building_id: building,
        property_id: property,
        area_id: area,
        name: 'Erdgeschoss',
        level: 0,
      },
    },
    {
      table: 'rooms',
      values: {
        tenant_id: tenant.id,
        floor_id: floor,
        building_id: building,
        property_id: property,
        area_id: area,
        number: '0.01',
      },
    },
    {
      table: 'assets',
      values: {
        id: asset,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        building_id: building,
        kind: 'probe.elevator',
        number: 'AN-00001',
        name: 'Aufzug',
      },
    },
    {
      table: 'asset_lifecycle',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        state: 'in_service',
        valid_from: '2020-01-01',
      },
    },
    {
      table: 'asset_supplies',
      values: {
        tenant_id: tenant.id,
        asset_id: asset,
        property_id: property,
        area_id: area,
        building_id: building,
      },
    },
    // A duty from the catalogue at the asset, and a proposal dismissed there.
    {
      table: 'duties',
      values: {
        id: duty,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        kind: 'probe.elevator_main_test',
        kind_version: 1,
        counting: 'betrsichv',
        interval_months: 24,
        maximum_months: 24,
        responsible_user_id: tenant.userId,
        confirmed_by: tenant.userId,
      },
    },
    {
      table: 'duty_dismissals',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        kind: 'probe.elevator_annual_check',
        kind_version: 1,
        reason: 'Die Anlage hat keine Notrufeinrichtung.',
        dismissed_by: tenant.colleagueId,
      },
    },
    // An evidence of the duty, and the deadline the engine keeps from it.
    {
      table: 'evidence',
      values: {
        id: evidence,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        duty_id: duty,
        performed_on: '2025-03-14',
        result: 'without_defects',
        ...writtenColumns(tenant.userId, '2025-03-14', 'without_defects'),
      },
    },
    {
      table: 'deadlines',
      values: {
        tenant_id: tenant.id,
        kind: 'duty.due',
        source_id: duty,
        source_label: 'Hauptprüfung der Aufzugsanlage, Aufzug',
        anchor_on: '2025-03-14',
        due_on: '2027-03-01',
        duty_id: duty,
        property_id: property,
        area_id: area,
      },
    },
    // A work order at the asset to meet the duty, and a defect noticed in it.
    {
      table: 'activities',
      values: {
        id: activity,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        kind: 'work_order',
        title: 'Hauptprüfung Aufzug',
        responsible_user_id: tenant.userId,
      },
    },
    {
      table: 'activity_duties',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        duty_id: duty,
      },
    },
    {
      table: 'work_orders',
      values: {
        id: workOrder,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        number: 'AU-2026-0001',
        kind: 'inspection',
      },
    },
    {
      table: 'defects',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        found_in_activity_id: activity,
        description: 'Notruf im Fahrkorb ohne Verbindung.',
        found_on: '2026-10-01',
      },
    },
    // The signature on the work order, and its rejection.
    {
      table: 'activity_signatures',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        activity_id: activity,
        signed_by: tenant.userId,
        role: 'signer',
        signed_at: '2026-10-01T09:30:00Z',
        path: 'M10,10L200,300',
        page_fingerprint: 'a'.repeat(64),
      },
    },
    {
      table: 'work_order_decisions',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        work_order_id: workOrder,
        decision: 'rejected',
        reason: 'Die Notrufverbindung fehlt noch.',
        decided_by: tenant.colleagueId,
      },
    },
    // The evidence declared invalid.
    {
      table: 'evidence_voidings',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        evidence_id: evidence,
        reason: 'Der Prüfbericht gehört zu einer anderen Anlage.',
        voided_by: tenant.colleagueId,
      },
    },
    // A document at the asset, and the one version of it, which names the
    // file of the tenant above.
    {
      table: 'attachments',
      values: {
        id: document,
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        title: 'Betriebsanleitung',
        kind: 'operating_manual',
      },
    },
    {
      table: 'attachment_versions',
      values: {
        tenant_id: tenant.id,
        attachment_id: document,
        sha256: file,
        file_name: 'betriebsanleitung.pdf',
        media_type: 'application/pdf',
        size_bytes: 2048,
      },
    },
    // The label on the asset. Its code stands once in the whole instance, so
    // each tenant of the test gets one of its own.
    {
      table: 'labels',
      values: {
        tenant_id: tenant.id,
        property_id: property,
        area_id: area,
        asset_id: asset,
        code: labelCodeFrom(randomBytes(10)),
      },
    },
    // An import and what a list calls an asset kind (#100). Neither has a place.
    {
      table: 'imports',
      values: {
        tenant_id: tenant.id,
        kind: 'assets',
        file_name: 'anlagen-werkhof.xlsx',
        lines: 38,
        summary: '38 Anlagen angelegt',
      },
    },
    {
      table: 'asset_kind_names',
      values: {
        tenant_id: tenant.id,
        name: 'Feuerlöscher',
        name_key: 'feuerlöscher',
        kind: 'allgemein.other_technical_installation',
      },
    },
  ]
}

/**
 * A row in every table that belongs to the instance and to no tenant: the
 * accounts with what somebody signs in with, and who runs the instance.
 *
 * `instance_settings` holds its one row since the migration, and
 * `instance_changes` is written by the trigger while these go in.
 */
function rowsOfTheInstance(): readonly Row[] {
  const person = (tenant: Tenant): Row => ({
    table: 'auth_users',
    values: { id: tenant.userId, name: `Leitung ${tenant.name}`, email: tenant.email },
  })
  const colleague = (tenant: Tenant): Row => ({
    table: 'auth_users',
    values: {
      id: tenant.colleagueId,
      name: `Kollegium ${tenant.name}`,
      email: `kollegium-${tenant.email}`,
    },
  })

  return [
    person(north),
    person(south),
    colleague(north),
    colleague(south),
    {
      table: 'auth_accounts',
      values: {
        id: randomUUID(),
        account_id: north.userId,
        provider_id: 'credential',
        user_id: north.userId,
      },
    },
    {
      table: 'auth_passkeys',
      values: {
        id: randomUUID(),
        user_id: north.userId,
        public_key: 'public-key',
        credential_id: randomUUID(),
        counter: 0,
        device_type: 'singleDevice',
        backed_up: false,
      },
    },
    {
      table: 'auth_rate_limits',
      values: { id: randomUUID(), key: 'sign-in', count: 1, last_request: 1 },
    },
    {
      table: 'auth_sessions',
      values: {
        id: randomUUID(),
        token: randomUUID(),
        user_id: north.userId,
        expires_at: tomorrow,
      },
    },
    {
      table: 'auth_two_factors',
      values: { id: randomUUID(), user_id: north.userId, secret: 'sealed', backup_codes: 'sealed' },
    },
    {
      table: 'auth_verifications',
      values: {
        id: randomUUID(),
        identifier: 'reset-password',
        value: north.userId,
        expires_at: tomorrow,
      },
    },
    {
      table: 'instance_operators',
      values: { user_id: north.userId },
    },
  ]
}

/** The statement that puts a row in. Every value travels beside it, as a parameter. */
function insertOf(row: Row): SQL {
  const columns = Object.keys(row.values)

  return sql`insert into ${sql.identifier(row.table)} (${sql.join(
    columns.map((column) => sql.identifier(column)),
    sql`, `,
  )}) values (${sql.join(
    columns.map((column) => sql.param(row.values[column])),
    sql`, `,
  )})`
}

/** A table as the catalogue knows it. */
interface CatalogueTable {
  readonly table: string
  /** The column that says whose row it is, or nothing: then it is the instance's. */
  readonly tenantColumn: 'tenant_id' | 'id' | null
  /** What the application role may do with it, as the grants say. */
  readonly mayInsert: boolean
  readonly mayDelete: boolean
  /** A column the role may update, to try an update with. */
  readonly updatable: string | null
}

/**
 * Every table in `public`, read from the catalogue and not from a list. A
 * list is complete on the day it is written; the catalogue knows the table a
 * later migration added.
 */
async function tablesInTheCatalogue(): Promise<CatalogueTable[]> {
  const { rows } = await admin.query<{
    table_name: string
    has_tenant: boolean
    may_insert: boolean
    may_delete: boolean
    updatable: string | null
  }>(
    `select c.relname as table_name,
            exists (
              select 1 from pg_attribute a
               where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
            ) as has_tenant,
            has_table_privilege($1, c.oid, 'INSERT') as may_insert,
            has_table_privilege($1, c.oid, 'DELETE') as may_delete,
            (select a.attname from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                and has_column_privilege($1, c.oid, a.attnum, 'UPDATE')
              order by a.attnum
              limit 1) as updatable
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
      order by c.relname`,
    [applicationRole],
  )

  return rows.map((row) => ({
    table: row.table_name,
    tenantColumn: row.has_tenant ? 'tenant_id' : row.table_name === 'tenants' ? 'id' : null,
    mayInsert: row.may_insert,
    mayDelete: row.may_delete,
    updatable: row.updatable,
  }))
}

async function tablesOfATenant(): Promise<(CatalogueTable & { tenantColumn: string })[]> {
  const tables = await tablesInTheCatalogue()

  return tables.filter(
    (table): table is CatalogueTable & { tenantColumn: string } => table.tenantColumn !== null,
  )
}

/** The tenants whose rows a query came back with, each once. */
function tenantsIn(rows: readonly { tenant: string }[]): string[] {
  return [...new Set(rows.map((row) => row.tenant))].sort()
}

/**
 * Thrown at the end of a transaction that only wanted to see what a statement
 * finds: the transaction is rolled back, and what it found comes out with the
 * error.
 */
class TakenBack extends Error {
  constructor(readonly found: Readonly<Record<string, unknown>>) {
    super('Taken back on purpose')
  }
}

let admin: Pool
let database: Database

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  // The rows go in past the application: a tenant is not something its role
  // creates, and the accounts are written outside any tenant. What is asked
  // below is what the application reaches afterwards.
  const asAdmin = drizzle(admin)

  for (const row of rowsOfTheInstance()) {
    await asAdmin.execute(insertOf(row))
  }

  // The same rows on both sides, so that nothing passes by accident: if a
  // query came back with the rows of the wrong tenant, a count would not show
  // it.
  for (const tenant of [north, south]) {
    for (const row of rowsOf(tenant)) {
      await asAdmin.execute(insertOf(row))
    }

    await admin.query('select next_sync_sequence($1)', [tenant.id])
  }

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('the tables', () => {
  it('all have row level security enabled and forced, with a policy and a grant', async () => {
    // The check that keeps this working. A table added by a later migration
    // that forgets one of them is a leak nobody notices, because everything
    // still works: its rows are simply there for everyone.
    const tables = await tableProtections(admin)

    // A floor, so that a query that finds nothing cannot pass as "no table
    // unprotected": the first migration alone creates 23.
    expect(tables.length).toBeGreaterThanOrEqual(23)
    expect(unprotected(tables)).toEqual([])
  })

  /**
   * The test above asks whether a table has a policy, not what the policy
   * says. One with `using (true)`, or one that compares against the wrong
   * setting, passes it and opens the table to every tenant. This reads the
   * expression of every policy the application falls under and holds it
   * against the one comparison that is allowed: the tenant of the row against
   * the tenant of the transaction.
   */
  it('let the application reach a row only through the tenant of the transaction', async () => {
    // The exceptions are the two of the foundation, the chooser after a sign
    // in, which reads its memberships and the names of its tenants outside
    // any tenant. This application has added none of its own.
    const reading = await readPolicies(admin)

    // 13 tables carry a tenant after the first migration.
    expect(reading.tables).toBeGreaterThanOrEqual(13)
    expect(reading.violations).toEqual([])
    expect(reading.stale).toEqual([])
  })

  /**
   * A function that runs as its definer runs as the owner of the tables,
   * whoever calls it, and so walks past every policy above. Each of them was
   * opened on purpose for one question and is on the list of the foundation
   * with its reason. This application has added one: a migration that adds
   * another, or leaves one behind it meant to replace, turns this red, and
   * the place for its reason is here.
   */
  it('let a function past the policies only where a list says why', async () => {
    expect(
      await readDefinerFunctions(admin, {
        ...foundationDefinerFunctions,
        'asset_duplicate_candidates(asked_serial text, asked_mark text)':
          'an asset taken stock of in one area may stand in another already, and the policy of the areas hides it from whoever enters it; handed over are the few assets of the tenant of the transaction whose digits fit, and the server alone compares them',
        'label_state_in_tenant(asked text)':
          'a scan of a label in another area is told that it lies outside the areas of the person, not that no such label exists; one word, and the tenant is read from the transaction',
      }),
    ).toEqual({
      unexplained: [],
      stale: [],
      openToEveryRole: [],
    })
  })

  /**
   * A foreign key is checked past row level security: the database looks the
   * parent up as the owner of its table. A key on the id alone therefore
   * finds the record of any tenant, and a record of one could be hung on a
   * record of the next. Between two tables of a tenant the tenant comes first
   * on both sides.
   */
  it('run every key between two tables of a tenant over the tenant', async () => {
    const keys = await keysBetweenTenantTables(admin)

    // The passkey of a member points at the membership, the one such key of
    // the first migration.
    expect(keys.length).toBeGreaterThanOrEqual(1)
    expect(withoutTheTenant(keys)).toEqual([])
  })

  /**
   * The second line, between the areas of a tenant (ADR 0003). A table with a
   * place that lacks any part of it turns this red; that the check finds what
   * it looks for is shown in `areas.test.ts`, on tables built to lack one part
   * each.
   */
  it('draw the line between the areas wherever a row has a place', async () => {
    const { rows } = await admin.query<{ tables: number }>(
      `select count(distinct polrelid)::int as tables from pg_policy where polname = 'within_areas'`,
    )

    // A floor, so that a check that finds no table with a place cannot pass:
    // the four levels of the place carry the line since #18, the assets, their
    // life cycle and their supplies since #20, the duties and the dismissed
    // proposals since #25, the activities with their duties and work orders
    // and the defects since #26.
    expect(rows[0]?.tables).toBeGreaterThanOrEqual(13)
    expect(await areaBoundaryProblems(admin)).toEqual([])
  })

  /**
   * What is removed by marking it (ADR 0002, point 17) carries `deleted_at`,
   * and the application may not delete it either: a row that is gone cannot
   * tell a device that it went, and the triggers that mark what hangs below a
   * row answer to the mark, not to a DELETE.
   */
  it('keep a row that is removed by marking out of reach of DELETE', async () => {
    const { rows } = await admin.query<{ table_name: string; deletable: boolean }>(
      `select table_name,
              has_table_privilege('opengewerk_app', format('%I.%I', table_schema, table_name), 'DELETE')
                as deletable
         from information_schema.columns
        where table_schema = 'public' and column_name = 'deleted_at'
        order by table_name`,
    )

    // A floor: the place since #18, the technology since #20, the duties and
    // the dismissed proposals since #25, the activities with their duties and
    // work orders and the defects since #26.
    expect(rows.length).toBeGreaterThanOrEqual(13)
    expect(rows.filter((row) => row.deletable).map((row) => row.table_name)).toEqual([])
  })
})

/**
 * Every transaction below that reads or writes as a tenant does so in every
 * area of it (`inEveryArea`), so that what is seen or refused is the line
 * between the tenants and not the one between the areas, which
 * `areas.test.ts` holds.
 */
describe('a tenant', () => {
  /**
   * Table by table, and the tables come from the catalogue. A table of a
   * tenant in which one of the two has no row turns this red as well: an
   * empty table shows nobody anything, and would pass for well guarded.
   */
  it('sees its own rows in every table of a tenant, and no row of another', async () => {
    const tables = await tablesOfATenant()
    const seen: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const { table, tenantColumn } of tables) {
      const select = `select "${tenantColumn}"::text as tenant from "${table}"`
      const through = async (tenant: Tenant) => {
        const result = await inEveryArea(database, { tenantId: tenant.id }, (tx) =>
          tx.execute<{ tenant: string }>(sql.raw(select)),
        )

        return tenantsIn(result.rows)
      }
      const held = await admin.query<{ tenant: string }>(select)

      seen[table] = {
        held: tenantsIn(held.rows),
        north: await through(north),
        south: await through(south),
      }
      expected[table] = { held: both, north: [north.id], south: [south.id] }
    }

    expect(tables.length).toBeGreaterThanOrEqual(13)
    expect(seen).toEqual(expected)
  })

  /**
   * The other half of the schema, from inside a tenant: the accounts and what
   * belongs to whoever runs the instance. They hold the people of every
   * tenant, so from inside one of them they are closed altogether. The names
   * of its own people a tenant gets by asking the instance for exactly the
   * accounts its memberships name, in a transaction outside any tenant.
   */
  it('sees no row of a table that belongs to the instance', async () => {
    const tables = (await tablesInTheCatalogue()).filter((table) => table.tenantColumn === null)
    const seen: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const { table } of tables) {
      const count = `select count(*)::int as rows from "${table}"`
      const held = await admin.query<{ rows: number }>(count)
      const inside = await database.forTenant({ tenantId: north.id }, (tx) =>
        tx.execute<{ rows: number }>(sql.raw(count)),
      )

      // Whether the table holds anything at all is part of the answer: an
      // empty one would show nothing to anybody.
      seen[table] = { holdsRows: (held.rows[0]?.rows ?? 0) > 0, fromInside: inside.rows[0]?.rows }
      expected[table] = { holdsRows: true, fromInside: 0 }
    }

    // The seven tables of the accounts and the three of the instance.
    expect(tables.length).toBeGreaterThanOrEqual(10)
    expect(seen).toEqual(expected)
  })

  /**
   * And the tables of a tenant from outside any tenant, where signing in
   * happens before anybody knows which tenant is meant. A policy that
   * compares a row against a tenant that was never set matches nothing, so
   * every one of them is empty there.
   */
  it('is not seen from outside any tenant, by somebody who is nobody yet', async () => {
    const tables = await tablesOfATenant()
    const seen: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const { table } of tables) {
      const outside = await database.forInstance((tx) =>
        tx.execute<{ rows: number }>(sql.raw(`select count(*)::int as rows from "${table}"`)),
      )

      seen[table] = outside.rows[0]?.rows
      expected[table] = 0
    }

    expect(seen).toEqual(expected)
  })

  /**
   * Writing, table by table. Where the application may insert at all, a row
   * that names the other tenant is refused by the policy. Where it may not,
   * the table is written by a trigger or a function alone, and the attempt
   * ends at the missing right. Both answer with the same code, so the
   * catalogue is asked which of the two it has to be.
   */
  it('cannot put a row into another tenant, in any table', async () => {
    const tables = await tablesOfATenant()
    const offered = new Map(rowsOf(south).map((row) => [row.table, row]))
    const outcome: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const { table, mayInsert } of tables) {
      const row = offered.get(table)

      if (mayInsert && !row) {
        // A table the application writes into and no row to try it with:
        // `rowsOf` is short one entry.
        outcome[table] = 'no row to try with'
      } else if (row) {
        const refusal = await refusedBy(
          inEveryArea(database, { tenantId: north.id }, (tx) => tx.execute(insertOf(row))),
        )

        outcome[table] = refusal.code
      } else {
        outcome[table] = 'written by a trigger or a function alone'
      }

      expected[table] =
        mayInsert || row ? insufficientPrivilege : 'written by a trigger or a function alone'
    }

    expect(outcome).toEqual(expected)

    // And nothing arrived: the other tenant holds what it held.
    const held = await admin.query<{ rows: number }>(
      'select count(*)::int as rows from number_ranges where tenant_id = $1',
      [south.id],
    )

    expect(held.rows).toEqual([{ rows: 1 }])
  })

  /**
   * Changing and removing. The policy hides the rows of the other tenant from
   * an update and a delete as it hides them from a select, so both find
   * nothing to work on. Where the application may not update or delete at
   * all, the attempt ends at the missing right.
   */
  it('cannot change or remove a row of another tenant, in any table', async () => {
    const tables = await tablesOfATenant()
    const outcome: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    const asNorth = (statement: SQL) =>
      inEveryArea(database, { tenantId: north.id }, (tx) => tx.execute(statement))

    // What the catalogue says decides how an attempt is read: with the right,
    // it has to go through and find nothing; without it, it has to be refused.
    const attempt = async (permitted: boolean, statement: SQL): Promise<unknown> =>
      permitted ? (await asNorth(statement)).rowCount : (await refusedBy(asNorth(statement))).code

    for (const { table, tenantColumn, updatable, mayDelete } of tables) {
      const theirs = sql`${sql.identifier(tenantColumn)} = ${south.id}`
      const column = sql.identifier(updatable ?? tenantColumn)

      outcome[table] = {
        updated: await attempt(
          updatable !== null,
          sql`update ${sql.identifier(table)} set ${column} = ${column} where ${theirs}`,
        ),
        deleted: await attempt(
          mayDelete,
          sql`delete from ${sql.identifier(table)} where ${theirs}`,
        ),
      }
      expected[table] = {
        updated: updatable !== null ? 0 : insufficientPrivilege,
        deleted: mayDelete ? 0 : insufficientPrivilege,
      }
    }

    expect(outcome).toEqual(expected)

    // The same two statements find the rows when the tenant is the one they
    // belong to. Without this the zeros above could come from a statement
    // that matches nothing for anybody. Taken back again, so that the rows
    // stay for whichever test runs after this one.
    const own = await database
      .forTenant({ tenantId: south.id }, async (tx) => {
        const updated = await tx.execute(
          sql`update number_ranges set pattern = pattern where tenant_id = ${south.id}`,
        )
        const deleted = await tx.execute(sql`delete from secrets where tenant_id = ${south.id}`)

        throw new TakenBack({ updated: updated.rowCount, deleted: deleted.rowCount })
      })
      .catch((error: unknown) => {
        if (error instanceof TakenBack) {
          return error.found
        }

        throw error
      })

    expect(own).toEqual({ updated: 1, deleted: 1 })
  })
})
