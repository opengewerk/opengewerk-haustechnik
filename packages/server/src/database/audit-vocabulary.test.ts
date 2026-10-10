import { auditValues, auditVocabulary } from '@opengewerk/haustechnik-domain'
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

  it('write every value of a list the way the office reads it, in every column the triggers watch (#80)', async () => {
    const { rows } = await admin.query<{ table: string; column: string; label: string }>(
      `select c.table_name as "table", c.column_name as "column", e.enumlabel as label
         from information_schema.columns c
         join pg_type t on t.typname = c.udt_name and t.typtype = 'e'
         join pg_enum e on e.enumtypid = t.oid
        where c.table_schema = 'public'
          and exists (select 1 from pg_trigger g join pg_class k on k.oid = g.tgrelid
                       where k.relname = c.table_name and g.tgname = 'audit_changes')
        order by 1, 2, e.enumsortorder`,
    )
    // How somebody signed in the foundation writes itself (`foundationValues`).
    const unwritten = rows
      .filter((row) => row.table !== 'tenant_sessions')
      .filter((row) => auditValues[row.table]?.[row.column]?.[row.label] === undefined)
      .map((row) => `${row.table}.${row.column}: ${row.label}`)

    expect(rows.length).toBeGreaterThan(20)
    expect(unwritten).toEqual([])
  })
})
