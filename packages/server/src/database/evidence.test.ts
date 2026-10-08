import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  insufficientPrivilege,
  ownerDatabaseUrl,
  resetToMigrated,
} from './test-database.js'
import { writtenColumns } from './test-evidence.js'

/**
 * An evidence in the database (ADR 0004, points 1, 12 and 13): no role
 * changes or removes one, neither the application nor the owner of the
 * tables nor a superuser, each with a test of its own; the one change that
 * comes through is the area that follows a property; the rules of the row and
 * its keys hold what `domain` and the server ask; and an asset with an
 * evidence is not marked deleted, by itself or with its place.
 */

const tenant = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const changeRefused = 'HT003'
const assetRefused = 'HT004'
const voidingRefused = 'HT006'

/** A property with a building, an asset in it, a duty at the asset and an activity to meet it. */
interface Place {
  readonly property: string
  readonly area: string
  readonly building: string
  readonly asset: string
  readonly duty: string
  readonly activity: string
}

let admin: Pool
let owner: Pool
let database: Database
let here: Place
let beside: Place
let secondArea = ''
let numbers = 0

async function placeIn(area: string): Promise<Place> {
  const property = randomUUID()
  const building = randomUUID()
  const asset = randomUUID()
  const duty = randomUUID()
  const activity = randomUUID()

  numbers += 1
  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenant, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus A', '{school}')`,
    [building, tenant, property, area],
  )
  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, 'probe.elevator', $6, 'Aufzug')`,
    [asset, tenant, property, area, building, `AN-${String(numbers).padStart(5, '0')}`],
  )
  await admin.query(
    `insert into duties (id, tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     values ($1, $2, $3, $4, $5, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
             'from_performance', 12, $6)`,
    [duty, tenant, property, area, asset, lead],
  )
  await admin.query(
    `insert into activities (id, tenant_id, property_id, area_id, asset_id, kind, title)
     values ($1, $2, $3, $4, $5, 'inspection', 'Sichtprüfung Aufzug')`,
    [activity, tenant, property, area, asset],
  )
  await admin.query(
    `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
     values ($1, $2, $3, $4, $5)`,
    [tenant, property, area, activity, duty],
  )

  return { property, area, building, asset, duty, activity }
}

/** The columns of an evidence of a report at a place, which a test changes where it wants. */
function rowAt(at: Place): Record<string, unknown> {
  return {
    tenant_id: tenant,
    property_id: at.property,
    area_id: at.area,
    duty_id: at.duty,
    performed_on: '2026-09-30',
    result: 'without_defects',
    ...writtenColumns(lead, '2026-09-30', 'without_defects'),
  }
}

/** A row put in past the application, as the superuser. */
async function written(values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values)
  const { rows } = await admin.query<{ id: string }>(
    `insert into evidence (${columns.join(', ')})
     values (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')}) returning id`,
    Object.values(values),
  )

  return rows[0]?.id ?? ''
}

/** The key or check that refused a row, or that it was accepted. */
async function triedRow(
  values: Record<string, unknown>,
): Promise<{ code?: string; constraint?: string } | 'accepted'> {
  try {
    await written(values)

    return 'accepted'
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string }

    return { code, constraint }
  }
}

/** The code of the error a statement of the application ends with, or null when it goes through. */
async function refusalOf(
  work: (tx: TenantTransaction) => Promise<unknown>,
): Promise<string | null> {
  try {
    await database.forTenant({ tenantId: tenant, userId: lead }, async (tx) => {
      await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
      await work(tx)
    })

    return null
  } catch (error) {
    return (error as { cause?: { code?: string } }).cause?.code ?? 'unknown'
  }
}

/** The code of the error a statement ends with, or null when it goes through. */
async function codeOf(pending: Promise<unknown>): Promise<string | null> {
  try {
    await pending

    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  owner = new Pool({ connectionString: ownerDatabaseUrl() })

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  // The areas come before the first membership, so that the operator does not
  // begin with the one area a tenant gets with its first membership.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [tenant],
  )
  const north = rows.find((row) => row.name === 'Nord')?.id ?? ''

  secondArea = rows.find((row) => row.name === 'Süd')?.id ?? ''
  await admin.query(
    `insert into auth_users (id, name, email) values ($1, $1, 'lead@beispiel.example')`,
    [lead],
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, $2, '{management}')`,
    [tenant, lead],
  )

  here = await placeIn(north)
  beside = await placeIn(north)
  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await owner.end()
  await admin.end()
})

describe('an evidence', () => {
  it('is added by the application, which changes and removes none', async () => {
    const values = rowAt(here)
    const columns = Object.keys(values)

    expect(
      await refusalOf((tx) =>
        tx.execute(
          sql`insert into evidence (${sql.join(
            columns.map((column) => sql.identifier(column)),
            sql`, `,
          )}) values (${sql.join(
            columns.map((column) => sql.param(values[column])),
            sql`, `,
          )})`,
        ),
      ),
    ).toBeNull()

    // Not even a row of its own, in an area it sees.
    expect(
      await refusalOf((tx) =>
        tx.execute(sql`update evidence set result = 'failed' where tenant_id = ${tenant}`),
      ),
    ).toBe(insufficientPrivilege)
    expect(
      await refusalOf((tx) => tx.execute(sql`delete from evidence where tenant_id = ${tenant}`)),
    ).toBe(insufficientPrivilege)
    expect(await refusalOf((tx) => tx.execute(sql`truncate evidence`))).toBe(insufficientPrivilege)
  })

  it('is changed and removed by nobody, not by the owner of the tables', async () => {
    const id = await written(rowAt(here))
    const client = await owner.connect()

    // The owner may switch FORCE off for its own table, and then reaches the
    // rows; the trigger stands in the way all the same.
    const asOwner = async (statement: string, values: readonly unknown[] = []) => {
      await client.query('begin')

      try {
        await client.query('alter table evidence no force row level security')

        return await codeOf(client.query(statement, [...values]))
      } finally {
        await client.query('rollback')
      }
    }

    try {
      expect(await asOwner(`update evidence set result = 'failed' where id = $1`, [id])).toBe(
        changeRefused,
      )
      expect(await asOwner('delete from evidence where id = $1', [id])).toBe(changeRefused)
      // With CASCADE, past the key of the declarations of invalidity, which
      // refuses a plain truncate before any trigger is asked.
      expect(await asOwner('truncate evidence cascade')).toBe(changeRefused)
    } finally {
      client.release()
    }

    // Without FORCE switched off the owner sees no row, and changes none.
    expect(
      (await owner.query(`update evidence set result = 'failed' where id = $1`, [id])).rowCount,
    ).toBe(0)
  })

  it('is changed and removed by nobody, not by a superuser', async () => {
    const id = await written(rowAt(here))

    expect(
      await codeOf(admin.query(`update evidence set result = 'failed' where id = $1`, [id])),
    ).toBe(changeRefused)
    expect(
      await codeOf(admin.query(`update evidence set state = '{"version": 1}' where id = $1`, [id])),
    ).toBe(changeRefused)
    expect(await codeOf(admin.query('delete from evidence where id = $1', [id]))).toBe(
      changeRefused,
    )
    expect(await codeOf(admin.query('truncate evidence cascade'))).toBe(changeRefused)

    const { rows } = await admin.query<{ result: string }>(
      'select result from evidence where id = $1',
      [id],
    )

    expect(rows).toEqual([{ result: 'without_defects' }])
  })

  it('follows its property into another area, and that is the one change it takes', async () => {
    const at = await placeIn(here.area)
    const id = await written(rowAt(at))
    const areaOf = async () =>
      (
        await admin.query<{ area: string }>('select area_id as area from evidence where id = $1', [
          id,
        ])
      ).rows[0]?.area

    await admin.query('update properties set area_id = $1 where id = $2', [secondArea, at.property])

    expect(await areaOf()).toBe(secondArea)

    // The same column, changed by a statement and not by the key, is refused,
    // and so is a statement that names the area the row already has.
    expect(
      await codeOf(admin.query('update evidence set area_id = $1 where id = $2', [here.area, id])),
    ).toBe(changeRefused)
    expect(
      await codeOf(admin.query('update evidence set area_id = area_id where id = $1', [id])),
    ).toBe(changeRefused)

    await admin.query('update properties set area_id = $1 where id = $2', [here.area, at.property])

    expect(await areaOf()).toBe(here.area)
  })

  it('takes no other change from a trigger, which runs a level deeper as the key does', async () => {
    const at = await placeIn(here.area)

    await written(rowAt(at))
    // A trigger of somebody's making that moves the evidence with its property
    // and rewrites its result on the way: one level deeper, like the key, with
    // the area changed as the key would change it, and something else besides.
    // Its name begins with a capital so that it fires before the trigger of
    // the key, whose name begins with "RI_": by then the area is still the old.
    await admin.query(`
      create function probe_rewrite_evidence() returns trigger language plpgsql as $$
      begin
        update evidence set area_id = new.area_id, result = 'failed' where property_id = new.id;
        return null;
      end;
      $$`)
    await admin.query(`
      create trigger "A_probe_rewrite_evidence" after update of area_id on properties
        for each row execute function probe_rewrite_evidence()`)

    try {
      expect(
        await codeOf(
          admin.query('update properties set area_id = $1 where id = $2', [
            secondArea,
            at.property,
          ]),
        ),
      ).toBe(changeRefused)
    } finally {
      await admin.query('drop trigger "A_probe_rewrite_evidence" on properties')
      await admin.query('drop function probe_rewrite_evidence()')
    }
  })

  it('carries its number once in its tenant', async () => {
    const first = rowAt(here)

    await written(first)

    expect(await triedRow({ ...rowAt(beside), number: first['number'] })).toEqual({
      code: '23505',
      constraint: 'evidence_number_once',
    })
  })

  it('is refused what the model in domain and the server refuse, check by check', async () => {
    const report = rowAt(here)
    const itself = randomUUID()
    const byNobody = { ...report, examiner: null, examiner_organisation: null }
    const checks: Record<string, Record<string, unknown>> = {
      evidence_number_shaped: { ...report, number: ' NW-2026-00001' },
      evidence_result_reason_shaped: {
        ...report,
        result: 'not_performed',
        result_reason: 'x'.repeat(501),
      },
      evidence_not_performed_with_a_reason: { ...report, result: 'not_performed' },
      evidence_examiner_shaped: { ...report, examiner: ' Erika Muster' },
      evidence_examiner_organisation_shaped: { ...report, examiner_organisation: '' },
      evidence_examiner_with_organisation: { ...report, examiner_organisation: null },
      evidence_report_by_an_examiner: { ...byNobody, performed_by: lead },
      evidence_performed_by_somebody: {
        ...byNobody,
        origin: 'protocol',
        activity_id: here.activity,
      },
      evidence_performed_by_one: { ...report, performed_by: lead },
      evidence_activity_as_its_origin_says: { ...byNobody, origin: 'protocol', performed_by: lead },
      evidence_state_shaped: { ...report, state: '[1]' },
      evidence_fingerprint_shaped: { ...report, fingerprint: 'abc' },
      evidence_replacement_with_a_reason: { ...report, replacement_reason: 'Falscher Tag.' },
      evidence_replacement_reason_shaped: {
        ...report,
        replaces_evidence_id: randomUUID(),
        replacement_reason: 'Falscher Tag. ',
      },
      evidence_not_its_own_replacement: {
        ...report,
        id: itself,
        replaces_evidence_id: itself,
        replacement_reason: 'Falscher Tag.',
      },
    }
    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [check, values] of Object.entries(checks)) {
      refused[check] = await triedRow(values)
      expected[check] = { code: '23514', constraint: check }
    }

    expect(refused).toEqual(expected)

    // The other halves of the two checks with two halves.
    expect(
      await triedRow({ ...report, result: 'failed', result_reason: 'Anlage war abgeschaltet.' }),
    ).toEqual({ code: '23514', constraint: 'evidence_not_performed_with_a_reason' })
    expect(await triedRow({ ...report, origin: 'legacy', activity_id: here.activity })).toEqual({
      code: '23514',
      constraint: 'evidence_activity_as_its_origin_says',
    })
    expect(await triedRow({ ...report, state: '{"number": "NW-2026-00001"}' })).toEqual({
      code: '23514',
      constraint: 'evidence_state_shaped',
    })
    expect(await triedRow({ ...report, replaces_evidence_id: randomUUID() })).toEqual({
      code: '23514',
      constraint: 'evidence_replacement_with_a_reason',
    })

    // And the rows they let through, each with a number of its own.
    expect(await written({ ...byNobody, origin: 'legacy' })).not.toBe('')
    expect(
      await written({
        ...rowAt(here),
        examiner: null,
        examiner_organisation: null,
        origin: 'protocol',
        activity_id: here.activity,
        performed_by: lead,
        result: 'not_performed',
        result_reason: 'Anlage war abgeschaltet.',
      }),
    ).not.toBe('')
  })

  /**
   * One attempt per key, read from the catalogue: a key that a later
   * migration adds without an attempt here turns this red, and so does an
   * attempt that is not refused by the key it names.
   */
  it('hangs on its duty, its activity and the people here, key by key', async () => {
    const report = rowAt(here)
    const elsewhere = await written(rowAt(beside))
    const attempts: Record<string, Record<string, unknown>> = {
      evidence_follows_its_property: { ...report, area_id: secondArea },
      evidence_of_a_duty_of_its_property: { ...report, duty_id: beside.duty },
      evidence_from_an_activity_of_its_property: { ...report, activity_id: beside.activity },
      evidence_performed_by_somebody_here: {
        ...report,
        origin: 'protocol',
        activity_id: here.activity,
        examiner: null,
        examiner_organisation: null,
        performed_by: 'u-nobody',
      },
      evidence_written_by_somebody_here: { ...report, written_by: 'u-nobody' },
      evidence_replaces_one_of_its_duty: {
        ...report,
        replaces_evidence_id: elsewhere,
        replacement_reason: 'Falscher Tag.',
      },
    }
    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f' and c.relname = 'evidence'
          and k.conname not like '%_tenant_id_tenants_id_fk'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual(Object.keys(attempts).sort())

    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [key, values] of Object.entries(attempts)) {
      refused[key] = await triedRow(values)
      expected[key] = { code: '23503', constraint: key }
    }

    expect(refused).toEqual(expected)
  })

  it('is corrected by another of its duty, once, and both stay', async () => {
    const at = await placeIn(here.area)
    const first = await written(rowAt(at))
    const correction = await written({
      ...rowAt(at),
      performed_on: '2026-09-29',
      replaces_evidence_id: first,
      replacement_reason: 'Der Prüfbericht nennt den 29. September.',
    })

    expect(
      await triedRow({ ...rowAt(at), replaces_evidence_id: first, replacement_reason: 'Doppelt.' }),
    ).toEqual({ code: '23505', constraint: 'evidence_replaced_once' })

    // The correction is corrected in turn, and all three stay as they were.
    await written({
      ...rowAt(at),
      replaces_evidence_id: correction,
      replacement_reason: 'Doch der 30. September.',
    })

    const { rows } = await admin.query<{ count: number }>(
      'select count(*)::int as count from evidence where property_id = $1',
      [at.property],
    )

    expect(rows).toEqual([{ count: 3 }])
  })
})

/** The columns of a declaration of invalidity, of a new evidence at a place. */
async function voidingAt(at: Place): Promise<Record<string, unknown>> {
  return {
    tenant_id: tenant,
    property_id: at.property,
    area_id: at.area,
    evidence_id: await written(rowAt(at)),
    reason: 'Der Rundgang wurde nicht gegangen.',
    voided_by: lead,
  }
}

/** A declaration of invalidity put in past the application, as the superuser. */
async function voided(values: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(values)
  const { rows } = await admin.query<{ id: string }>(
    `insert into evidence_voidings (${columns.join(', ')})
     values (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')}) returning id`,
    Object.values(values),
  )

  return rows[0]?.id ?? ''
}

/** The key or check that refused a declaration of invalidity, or that it was accepted. */
async function triedVoiding(
  values: Record<string, unknown>,
): Promise<{ code?: string; constraint?: string } | 'accepted'> {
  try {
    await voided(values)

    return 'accepted'
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string }

    return { code, constraint }
  }
}

describe('a declaration of invalidity', () => {
  it('is added by the application, which changes and removes none', async () => {
    const values = await voidingAt(here)
    const columns = Object.keys(values)

    expect(
      await refusalOf((tx) =>
        tx.execute(
          sql`insert into evidence_voidings (${sql.join(
            columns.map((column) => sql.identifier(column)),
            sql`, `,
          )}) values (${sql.join(
            columns.map((column) => sql.param(values[column])),
            sql`, `,
          )})`,
        ),
      ),
    ).toBeNull()
    expect(
      await refusalOf((tx) =>
        tx.execute(sql`update evidence_voidings set reason = 'Doch.' where tenant_id = ${tenant}`),
      ),
    ).toBe(insufficientPrivilege)
    expect(
      await refusalOf((tx) =>
        tx.execute(sql`delete from evidence_voidings where tenant_id = ${tenant}`),
      ),
    ).toBe(insufficientPrivilege)
    expect(await refusalOf((tx) => tx.execute(sql`truncate evidence_voidings`))).toBe(
      insufficientPrivilege,
    )
  })

  it('is changed and removed by nobody, not by the owner of the tables', async () => {
    const id = await voided(await voidingAt(here))
    const client = await owner.connect()
    const asOwner = async (statement: string, values: readonly unknown[] = []) => {
      await client.query('begin')

      try {
        await client.query('alter table evidence_voidings no force row level security')

        return await codeOf(client.query(statement, [...values]))
      } finally {
        await client.query('rollback')
      }
    }

    try {
      expect(
        await asOwner(`update evidence_voidings set reason = 'Doch.' where id = $1`, [id]),
      ).toBe(voidingRefused)
      expect(await asOwner('delete from evidence_voidings where id = $1', [id])).toBe(
        voidingRefused,
      )
      expect(await asOwner('truncate evidence_voidings')).toBe(voidingRefused)
    } finally {
      client.release()
    }
  })

  it('is changed and removed by nobody, not by a superuser', async () => {
    const id = await voided(await voidingAt(here))

    expect(
      await codeOf(
        admin.query(`update evidence_voidings set reason = 'Doch.' where id = $1`, [id]),
      ),
    ).toBe(voidingRefused)
    expect(await codeOf(admin.query('delete from evidence_voidings where id = $1', [id]))).toBe(
      voidingRefused,
    )
    expect(await codeOf(admin.query('truncate evidence_voidings'))).toBe(voidingRefused)
  })

  it('follows its property into another area, and takes no other change that way', async () => {
    const at = await placeIn(here.area)
    const id = await voided(await voidingAt(at))
    const areaOf = async () =>
      (
        await admin.query<{ area: string }>(
          'select area_id as area from evidence_voidings where id = $1',
          [id],
        )
      ).rows[0]?.area

    await admin.query('update properties set area_id = $1 where id = $2', [secondArea, at.property])

    expect(await areaOf()).toBe(secondArea)
    expect(
      await codeOf(
        admin.query('update evidence_voidings set area_id = $1 where id = $2', [here.area, id]),
      ),
    ).toBe(voidingRefused)

    // A trigger of somebody's making, a level deeper like the key, that moves
    // the row with its property and changes the reason besides.
    await admin.query(`
      create function probe_rewrite_voiding() returns trigger language plpgsql as $$
      begin
        update evidence_voidings set area_id = new.area_id, reason = 'Doch.'
         where property_id = new.id;
        return null;
      end;
      $$`)
    await admin.query(`
      create trigger "A_probe_rewrite_voiding" after update of area_id on properties
        for each row execute function probe_rewrite_voiding()`)

    try {
      expect(
        await codeOf(
          admin.query('update properties set area_id = $1 where id = $2', [here.area, at.property]),
        ),
      ).toBe(voidingRefused)
    } finally {
      await admin.query('drop trigger "A_probe_rewrite_voiding" on properties')
      await admin.query('drop function probe_rewrite_voiding()')
    }

    await admin.query('update properties set area_id = $1 where id = $2', [here.area, at.property])

    expect(await areaOf()).toBe(here.area)
  })

  it('stands once for an evidence, with its reason', async () => {
    const values = await voidingAt(here)

    await voided(values)

    expect(await triedVoiding({ ...values, reason: 'Noch einmal.' })).toEqual({
      code: '23505',
      constraint: 'evidence_voided_once',
    })

    for (const reason of ['', ' Nicht gegangen.', 'x'.repeat(501)]) {
      expect(await triedVoiding({ ...(await voidingAt(here)), reason })).toEqual({
        code: '23514',
        constraint: 'evidence_voidings_reason_shaped',
      })
    }
  })

  it('hangs on an evidence of its property and on somebody here, key by key', async () => {
    const values = await voidingAt(here)
    const attempts: Record<string, Record<string, unknown>> = {
      evidence_voidings_follow_their_property: { ...values, area_id: secondArea },
      evidence_voidings_of_an_evidence_of_their_property: {
        ...values,
        evidence_id: await written(rowAt(beside)),
      },
      evidence_voidings_by_somebody_here: { ...values, voided_by: 'u-nobody' },
    }
    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f' and c.relname = 'evidence_voidings'
          and k.conname not like '%_tenant_id_tenants_id_fk'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual(Object.keys(attempts).sort())

    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [key, attempt] of Object.entries(attempts)) {
      refused[key] = await triedVoiding(attempt)
      expected[key] = { code: '23503', constraint: key }
    }

    expect(refused).toEqual(expected)
  })
})

describe('an asset with an evidence', () => {
  /** Marks a row as the application does, in every area. */
  function marked(table: string, id: string) {
    return refusalOf((tx) =>
      tx.execute(sql`update ${sql.identifier(table)} set deleted_at = now() where id = ${id}`),
    )
  }

  it('is not marked deleted, neither by itself nor with its building or its property', async () => {
    const at = await placeIn(here.area)

    await written(rowAt(at))

    expect(await marked('assets', at.asset)).toBe(assetRefused)
    expect(await marked('buildings', at.building)).toBe(assetRefused)
    expect(await marked('properties', at.property)).toBe(assetRefused)
    // Nor by a superuser.
    expect(
      await codeOf(admin.query('update assets set deleted_at = now() where id = $1', [at.asset])),
    ).toBe(assetRefused)
  })

  it('stays, while an asset without one is marked, and a duty with one may be', async () => {
    const at = await placeIn(here.area)
    const without = await placeIn(here.area)

    await written(rowAt(at))

    // A duty with an evidence is marked; the evidence keeps its reference
    // (ADR 0004, point 13), and the asset still has its evidence.
    expect(await marked('duties', at.duty)).toBeNull()
    expect(await marked('assets', at.asset)).toBe(assetRefused)
    expect(await marked('assets', without.asset)).toBeNull()
  })

  it('keeps the asset it hangs under as well, through a component', async () => {
    const at = await placeIn(here.area)
    const component = randomUUID()
    const duty = randomUUID()

    numbers += 1
    await admin.query(
      `insert into assets (id, tenant_id, property_id, area_id, building_id, parent_asset_id, kind,
                           number, name)
       values ($1, $2, $3, $4, $5, $6, 'probe.elevator', $7, 'Antrieb')`,
      [
        component,
        tenant,
        at.property,
        at.area,
        at.building,
        at.asset,
        `AN-${String(numbers).padStart(5, '0')}`,
      ],
    )
    await admin.query(
      `insert into duties (id, tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                           counting, interval_months, confirmed_by)
       values ($1, $2, $3, $4, $5, 'Sichtprüfung des Antriebs', 'manufacturer',
               'Betriebsanleitung', 'from_performance', 12, $6)`,
      [duty, tenant, at.property, at.area, component, lead],
    )
    await written({ ...rowAt(at), duty_id: duty })

    expect(await marked('assets', at.asset)).toBe(assetRefused)
  })
})
