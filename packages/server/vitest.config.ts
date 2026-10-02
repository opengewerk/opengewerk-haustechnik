import { mergeConfig } from 'vitest/config'
import { shared } from '../../vitest.shared.js'

export default mergeConfig(shared, {
  test: {
    name: 'server',
    environment: 'node',
    // The database tests share one database and empty it before they run.
    // Side by side they would pull the schema out from under each other.
    fileParallelism: false,
    // A test that talks to the real database is measured against the slowest
    // machine it runs on, not against the fastest. Vitest gives a test five
    // seconds, and building a database from its migrations has gone past that
    // on a busy CI runner in the repository the foundation comes from.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
