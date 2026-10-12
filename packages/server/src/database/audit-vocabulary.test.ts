import { auditLanguage, auditValues, auditVocabulary } from '@opengewerk/haustechnik-domain'
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

  /**
   * A column that points at a record reads as the name of that record, and one
   * that holds a person as the name of that person (#259): the log showed the
   * key wherever the vocabulary did not know that a column points. Held
   * against the foreign keys of the database, so a new column of the kind
   * fails here and not on the screen of the Leitung.
   */
  it('name what every column of a watched table points at, a record or a person', async () => {
    const language = auditLanguage(auditVocabulary)
    const watched = `exists (select 1 from pg_trigger g where g.tgrelid = k.oid and g.tgname = 'audit_changes')`
    const { rows: pointing } = await admin.query<{ table: string; column: string; target: string }>(
      `select k.relname as "table", a.attname as "column", f.relname as target
         from pg_constraint c
         join pg_class k on k.oid = c.conrelid
         join pg_class f on f.oid = c.confrelid
         join pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
         join unnest(c.conkey) with ordinality as own(attnum, place) on true
         join unnest(c.confkey) with ordinality as theirs(attnum, place) on theirs.place = own.place
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = own.attnum
         join pg_attribute b on b.attrelid = c.confrelid and b.attnum = theirs.attnum
        where c.contype = 'f' and b.attname = 'id'
          and f.relname not in ('tenants', 'auth_users')
          and ${watched}
        group by 1, 2, 3
        order by 1, 2`,
    )
    const { rows: naming } = await admin.query<{ table: string; column: string }>(
      `select k.relname as "table", a.attname as "column"
         from pg_attribute a
         join pg_class k on k.oid = a.attrelid
         join pg_namespace n on n.oid = k.relnamespace and n.nspname = 'public'
        where a.attnum > 0 and not a.attisdropped and k.relkind = 'r'
          and a.attname ~ '(user_id|_by)$'
          and ${watched}
        order by 1, 2`,
    )

    expect(pointing.length).toBeGreaterThan(60)
    expect(naming.length).toBeGreaterThan(20)
    expect(
      pointing
        .filter((row) => language.referenceOf(row.column) !== row.target)
        .map((row) => `${row.table}.${row.column} points at ${row.target}`),
    ).toEqual([])
    // Who last wrote a row the trigger leaves out: the change itself says who made it.
    expect(
      naming
        .filter((row) => row.column !== 'updated_by' && !language.isPersonField(row.column))
        .map((row) => `${row.table}.${row.column}`),
    ).toEqual([])
  })
})
