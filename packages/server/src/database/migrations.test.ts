import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { Database, MigrationHistoryError } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { isPgEnum } from 'drizzle-orm/pg-core'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { readMigrationIndex, runMigrations } from './migrations.js'
import * as schema from './schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applicationRole,
  applyMigrations,
  appliedMigrationCount,
  changeMigration,
  connect,
  enumNames,
  enumValues,
  functionNames,
  migrationsFolder,
  migrationsFolderUpTo,
  ownerDatabaseUrl,
  ownerRole,
  readCatalogue,
  resetSchema,
  revertAllMigrations,
  tableNames,
} from './test-database.js'

// The migrations of this application, run the way an installation runs them:
// by the runner of the foundation, as the owner of the tables, against a real
// PostgreSQL. How the runner behaves with any folder is held in the
// foundation. What is held here is this stream: that an empty database is
// ready after it, that it can be taken back, and that nobody corrects a file
// in it that has already run somewhere.

/**
 * What the first migration creates, and it is frozen like the migration: the
 * tables every application of the organisation carries, with the two this
 * application makes from lists of its own.
 */
const tablesOfTheFoundation = [
  // The log of a tenant, with the head of its chain.
  'audit_chains',
  'audit_entries',
  // Accounts, sessions and what somebody signs in with. They belong to the
  // instance and to no tenant.
  'auth_accounts',
  'auth_passkeys',
  'auth_rate_limits',
  'auth_sessions',
  'auth_two_factors',
  'auth_users',
  'auth_verifications',
  // Who runs the instance, its settings, and the log of both.
  'instance_changes',
  'instance_operators',
  'instance_settings',
  // Who works for a tenant, who was asked to, and what a tenant sees of the
  // passkeys of its people.
  'invitations',
  'member_passkeys',
  'memberships',
  // The counters of the numbers that run without holes, with the sequences
  // of this application.
  'number_ranges',
  // What a tenant hands over to be kept sealed, with the purposes of this
  // application.
  'secrets',
  // What a device sent, what could not be taken, and the number a change
  // travels under.
  'sync_conflicts',
  'sync_operations',
  'sync_sequences',
  // The roles of a tenant as rows, what a tenant sees of a sign in, and the
  // tenants themselves.
  'tenant_roles',
  'tenant_sessions',
  'tenants',
]

let admin: Pool
const folders: string[] = []

/** A folder built for one test, removed again after it. */
function kept(folder: string): string {
  folders.push(folder)

  return folder
}

async function failure(run: Promise<void>): Promise<unknown> {
  try {
    await run
  } catch (error) {
    return error
  }

  return undefined
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

describe('the first migration', () => {
  it('creates the foundation in an empty database, and nothing beside it', async () => {
    expect(await tableNames(admin)).toEqual([])

    // The first migration alone, the way the first release carried it. Its
    // tables are the same on the day the hundredth migration is merged.
    await runMigrations(ownerDatabaseUrl(), kept(migrationsFolderUpTo(1)))

    // The list above is grouped to be read; the database answers by name.
    expect(await tableNames(admin)).toEqual([...tablesOfTheFoundation].sort())
  })
})

describe('the migration run', () => {
  it('leaves an empty database ready, and a second run does nothing', async () => {
    await runMigrations(ownerDatabaseUrl())

    const carried = readMigrationIndex().length

    expect(carried).toBeGreaterThanOrEqual(1)
    expect(await appliedMigrationCount(admin)).toBe(carried)
    expect(await tableNames(admin)).toEqual(expect.arrayContaining(tablesOfTheFoundation))

    // Ready means that the application gets in and gets its first question
    // answered: whether anybody has set this instance up yet. It asks as the
    // role the policies are written for, outside any tenant.
    await allowApplicationLogin(admin)
    const database = Database.connect(applicationDatabaseUrl())

    try {
      const answer = await database.forInstance((tx) =>
        tx.execute<{ empty: boolean; settings: string }>(
          sql`select instance_is_empty() as empty,
                     (select count(*) from instance_settings) as settings`,
        ),
      )

      // Nobody is there yet, and the one row of settings the instance reads
      // at every start is.
      expect(answer.rows).toEqual([{ empty: true, settings: '1' }])
    } finally {
      await database.close()
    }

    // In front of every start, not only of an update: a database that is
    // current is left exactly as it stands.
    const before = await readCatalogue(admin)

    await runMigrations(ownerDatabaseUrl())

    expect(await appliedMigrationCount(admin)).toBe(carried)
    expect(await readCatalogue(admin)).toEqual(before)
  })

  /**
   * Row level security never applies to a superuser, and not to a role that
   * may bypass it either. A schema created by one would let every policy pass
   * untested, FORCE included, and an application connected as one would walk
   * past them all. The first installation would be the first place the
   * policies are tried.
   *
   * Asked of the way every test of this package migrates, `applyMigrations`,
   * and of the two roles as the database has them afterwards.
   */
  it('is run by the tests as the owner of the tables, and neither role walks past a policy', async () => {
    await applyMigrations()

    const { rows: owners } = await admin.query<{ owner: string }>(
      `select distinct tableowner as owner from pg_tables where schemaname = 'public'`,
    )
    const { rows: roles } = await admin.query<{
      role: string
      superuser: boolean
      bypasses: boolean
    }>(
      `select rolname as role, rolsuper as superuser, rolbypassrls as bypasses
         from pg_roles
        where rolname = any ($1::text[])
        order by rolname`,
      [[ownerRole, applicationRole]],
    )

    expect(owners).toEqual([{ owner: ownerRole }])
    expect(roles).toEqual(
      [applicationRole, ownerRole].sort().map((role) => ({
        role,
        superuser: false,
        bypasses: false,
      })),
    )
  })

  it('refuses a migration that was changed after it had run', async () => {
    await runMigrations(ownerDatabaseUrl())

    const carried = readMigrationIndex()
    const first = carried[0]

    if (!first) {
      throw new Error('This application carries no migration to change')
    }

    // Every file as the image carries it, and one of them corrected in place,
    // the way somebody would who fixes a merged migration instead of writing
    // a new one.
    const changed = kept(migrationsFolderUpTo(carried.length))
    changeMigration(changed, first.tag, 'CREATE TABLE "smuggled" ("id" uuid PRIMARY KEY);')

    const error = await failure(runMigrations(ownerDatabaseUrl(), changed))

    expect(error).toBeInstanceOf(MigrationHistoryError)
    expect((error as Error).message).toContain(first.tag)

    // Without the refusal this would go through without a word: the runner
    // compares timestamps, finds nothing newer and does nothing. Whoever made
    // the change would take it for applied.
    expect(await tableNames(admin)).not.toContain('smuggled')
    expect(await appliedMigrationCount(admin)).toBe(carried.length)
  })

  /**
   * All pending migrations share one transaction. A failure in the last of
   * them leaves the database on the state before the update and not somewhere
   * in the middle of it, which is why an update that stops needs no restore.
   */
  it('takes every pending migration back when the last of them fails', async () => {
    const carried = readMigrationIndex().length
    const broken = kept(
      migrationsFolderUpTo(
        carried,
        { tag: '9998_first_step', sql: 'CREATE TABLE "warranties" ("id" uuid PRIMARY KEY);' },
        { tag: '9999_second_step', sql: 'SELECT 1 / 0;' },
      ),
    )

    // An empty database first: the migrations of this application are among
    // the pending ones, and go with the rest.
    const fromNothing = await failure(runMigrations(ownerDatabaseUrl(), broken))

    expect(fromNothing).toBeDefined()
    expect(fromNothing).not.toBeInstanceOf(MigrationHistoryError)
    expect(await tableNames(admin)).toEqual([])

    // And an installation that is current: it stays where it was.
    await runMigrations(ownerDatabaseUrl())
    const before = await readCatalogue(admin)

    const fromCurrent = await failure(runMigrations(ownerDatabaseUrl(), broken))

    expect(fromCurrent).toBeDefined()
    expect(await tableNames(admin)).not.toContain('warranties')
    expect(await appliedMigrationCount(admin)).toBe(carried)
    expect(await readCatalogue(admin)).toEqual(before)
  })

  it('can be taken back to an empty database, and run forward again', async () => {
    await applyMigrations()

    expect(await functionNames(admin)).toContain('verify_audit_chain')

    await revertAllMigrations(admin)

    // What the database says, not a list somebody kept by hand. This is what
    // catches a rollback that forgot a table, a type or a function. The
    // function fails loudest and latest: most are created without OR REPLACE,
    // so one left behind makes the next run forward stop at "already exists".
    expect(await tableNames(admin)).toEqual([])
    expect(await enumNames(admin)).toEqual([])
    expect(await functionNames(admin)).toEqual([])

    await applyMigrations()

    expect(await tableNames(admin)).toEqual(expect.arrayContaining(tablesOfTheFoundation))
  })

  /**
   * The schema declares an enum from a list in `domain`, and the database
   * learns of a change to that list only through a migration. Nothing forces
   * the two together: a value added to the list without the file typechecks,
   * lints and passes every test that does not use it, and the first thing to
   * notice is an insert an installation refuses. The order counts as well,
   * it decides what sorting by such a column does.
   */
  it('leaves every enum in the database saying what the code says', async () => {
    await applyMigrations()

    const inTheDatabase = await enumValues(admin)
    const declared = Object.values(schema).filter((entry) => isPgEnum(entry))

    // The four of the foundation and the two made from the lists of this
    // application. A floor, so that a filter that finds nothing cannot pass.
    expect(declared.length).toBeGreaterThanOrEqual(6)

    for (const entry of declared) {
      expect({ [entry.enumName]: inTheDatabase.get(entry.enumName) }).toEqual({
        [entry.enumName]: [...entry.enumValues],
      })
    }

    // And the other way round, for a type a migration created and nothing
    // declares any more.
    expect([...inTheDatabase.keys()].sort()).toEqual(declared.map((entry) => entry.enumName).sort())
  })
})

describe('the migrations in this repository', () => {
  const index = readMigrationIndex()

  it('have a rollback file each', () => {
    for (const migration of index) {
      const path = join(migrationsFolder, 'down', `${migration.tag}.sql`)

      expect(
        () => readFileSync(path, 'utf8'),
        `${migration.tag} has no rollback file`,
      ).not.toThrow()
    }
  })

  it('have timestamps that only ever increase', () => {
    // The runner compares against the newest applied migration and nothing
    // else. One arriving with an older timestamp is skipped, and the check
    // that catches it runs on somebody's installation. Here it costs a line.
    const timestamps = index.map((migration) => migration.when)

    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right))
    expect(new Set(timestamps).size).toBe(timestamps.length)
  })

  it('hold nothing that cannot run inside a transaction', () => {
    // Every pending migration shares one transaction, which is what leaves a
    // failed update on the state before it. CREATE INDEX CONCURRENTLY and
    // VACUUM refuse to run in one and would take that away.
    for (const migration of index) {
      const text = readFileSync(join(migrationsFolder, `${migration.tag}.sql`), 'utf8')

      expect(text, `${migration.tag} uses CONCURRENTLY`).not.toMatch(/\bconcurrently\b/i)
      expect(text, `${migration.tag} uses VACUUM`).not.toMatch(/\bvacuum\b/i)
    }
  })
})
