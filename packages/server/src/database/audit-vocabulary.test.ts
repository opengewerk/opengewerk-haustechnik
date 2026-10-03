import { auditVocabulary } from '@opengewerk/haustechnik-domain'
import { auditVocabularyGaps } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyMigrations, connect, resetSchema } from './test-database.js'

/**
 * The words of the change log against this database. The Leitung reads
 * "Zugang, Rollen" and never `memberships.roles`: every table a trigger of
 * the log watches has a name, every column of it has one, and the rules that
 * walk the log only name columns that exist. The foundation asks the
 * catalogue (ADR 0010 in the repository opengewerk); a table this application
 * adds fails here until its vocabulary names it and every column of it.
 */

let admin: Pool

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
})

afterAll(async () => {
  await admin.end()
})

describe('the words of the change log', () => {
  it('name every table and column the triggers watch, through columns that exist', async () => {
    expect(await auditVocabularyGaps(admin, auditVocabulary)).toEqual([])
  })
})
