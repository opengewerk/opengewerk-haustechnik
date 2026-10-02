import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { readMigrationIndex } from './database/migrations.js'
import {
  appliedMigrationCount,
  connect,
  ownerDatabaseUrl,
  resetSchema,
  tableNames,
} from './database/test-database.js'

// The command an installation runs before the application starts: `migrate`.
// It is the entry point itself that is loaded here, the file a container
// runs, with the environment a container would hand it. The command is the
// foundation's; what this application adds is its name and the folder its
// migrations are in, and a wrong folder is exactly the mistake that every
// other test would pass over, because they name the folder themselves.

let admin: Pool

beforeAll(async () => {
  admin = await connect()
})

beforeEach(async () => {
  await resetSchema(admin)
  // The entry point does its work when it is loaded, once. Each test loads it
  // anew.
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  // The command leaves its verdict here for the process to end with. Left
  // standing it would end the test run with it.
  process.exitCode = undefined
})

afterAll(async () => {
  await admin.end()
})

describe('the command an installation runs before the application starts', () => {
  it('brings an empty database up to date as the owner of the tables, and says so', async () => {
    const said = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const complained = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('MIGRATION_DATABASE_URL', ownerDatabaseUrl())

    await import('./migrate.js')

    expect(complained).not.toHaveBeenCalled()
    expect(said).toHaveBeenCalledWith('Die Datenbank ist auf dem aktuellen Stand.')
    expect(process.exitCode).toBeUndefined()
    expect(await appliedMigrationCount(admin)).toBe(readMigrationIndex().length)
    expect(await tableNames(admin)).toContain('tenants')
  })

  it('stops with a sentence and touches nothing when it is not told where the database is', async () => {
    const said = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const complained = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('MIGRATION_DATABASE_URL', '')

    await import('./migrate.js')

    // One sentence that names the variable, and no stack under it to bury it.
    expect(complained).toHaveBeenCalledTimes(1)
    expect(complained.mock.calls[0]?.[0]).toContain('MIGRATION_DATABASE_URL')
    expect(said).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(await tableNames(admin)).toEqual([])
  })
})
