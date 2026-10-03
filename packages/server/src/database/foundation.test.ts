import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, foundationDeviations } from './test-database.js'

// The first migration of this application was put together from the building
// blocks of the foundation and is frozen since, like every migration. The
// blocks are not: a correction of the foundation changes them, and reaches a
// database of this application only through a migration of its own.
//
// This holds the two against each other, a database built from the blocks as
// they are today and this one after every migration. A deviation means the
// foundation has moved on and this application owes its database a migration
// that follows.

let admin: Pool

beforeAll(async () => {
  admin = await connect()
})

afterAll(async () => {
  await admin.end()
})

describe('the foundation in this database', () => {
  it('is what its building blocks say, after every migration', async () => {
    // One thing of its own hangs on a table of the foundation: the trigger
    // that gives a new membership its areas (ADR 0003, migration 0002).
    expect(await foundationDeviations(admin, { triggers: ['memberships.default_areas'] })).toEqual(
      [],
    )
  })
})
