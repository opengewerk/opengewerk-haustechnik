import { testDatabase } from '@opengewerk/platform-server/testing'

import { migrationsFolder } from './migrations.js'
import { madeWithLists } from './schema/made.js'

// The kit is the foundation's (ADR 0010 in the repository opengewerk): an
// empty database, the migrations run the way an installation runs them, and
// the two roles to look through. Bound here to this application, so that a
// test names one module for all of it.

export * from '@opengewerk/platform-server/testing'
export { migrationsFolder }

export const {
  testDatabaseUrl,
  connect,
  ownerDatabaseUrl,
  applicationDatabaseUrl,
  resetSchema,
  applyMigrations,
  revertMigration,
  revertAllMigrations,
  migrationsFolderUpTo,
  applyFoundation,
  foundationDeviations,
} = testDatabase({
  migrationsFolder,
  // This application's own test database, next to the one of the repository
  // the foundation comes from: two suites that empty the same database pull
  // the schema out from under each other.
  defaultUrl: 'postgres://haustechnik:haustechnik@127.0.0.1:5434/haustechnik_test',
  startHint: 'docker compose -f docker/compose.test.yaml up -d',
  // The tables of the foundation with the lists of this application, so that
  // the comparison with the building blocks covers them too.
  made: madeWithLists,
})
