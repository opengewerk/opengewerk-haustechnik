import { randomUUID } from 'node:crypto'

import type { TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  insufficientPrivilege,
  ownerDatabaseUrl,
  resetSchema,
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
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
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
      expect(await asOwner('truncate evidence')).toBe(changeRefused)
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
    expect(await codeOf(admin.query('truncate evidence'))).toBe(changeRefused)

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
