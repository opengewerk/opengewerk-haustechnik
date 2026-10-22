import { randomUUID } from 'node:crypto'

import { contactLimits, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, refusedBy, resetToMigrated } from './test-database.js'

/**
 * The people to talk to at a property in the database (#85, section 4.1 of
 * the concept): that a contact hangs on a property of its tenant and lies in
 * the area of it, or on a contractor and in no area (#328), that the contacts
 * of a marked property or firm are marked with it,
 * that a contact a moved property takes along carries the stamp a device
 * needs, and that the database refuses the texts the model in `domain`
 * refuses.
 *
 * The rows go in past the application, as the superuser, so that what refuses
 * a row is the key or the check and never a policy.
 */

const tenant: TenantId = newId<'tenant'>()
const other: TenantId = newId<'tenant'>()

let admin: Pool
let database: Database

let area = ''
let secondArea = ''
let here = ''
let beside = ''
/** A property of the other tenant, in an area of its own. */
let elsewhere = ''
/** A contractor of the tenant, and one of the other tenant (#328). */
let firm = ''
let otherFirm = ''

async function areaOf(tenantId: TenantId, name: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'insert into areas (tenant_id, name) values ($1, $2) returning id',
    [tenantId, name],
  )

  return rows[0]?.id ?? ''
}

async function propertyIn(tenantId: TenantId, areaId: string): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Schulzentrum', 'Hauptstraße 1', '00001', 'Ort', 'DE-BW')`,
    [id, tenantId, areaId],
  )

  return id
}

async function contractorOf(
  tenantId: TenantId,
  name = 'Brandschutz Beispiel GmbH',
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'insert into contractors (tenant_id, name) values ($1, $2) returning id',
    [tenantId, name],
  )

  return rows[0]?.id ?? ''
}

/** A contact at a contractor, in no area (#328). */
async function contactOf(contractor: string, familyName = 'Krämer'): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into contacts (id, tenant_id, contractor_id, family_name, role)
     select $1, tenant_id, id, $3, 'Disposition' from contractors where id = $2`,
    [id, contractor, familyName],
  )

  return id
}

/** A contact at a property, in the area the property lies in. */
async function contactAt(property: string, familyName = 'Becker'): Promise<string> {
  const id = randomUUID()

  await admin.query(
    `insert into contacts (id, tenant_id, property_id, area_id, family_name, role)
     select $1, tenant_id, id, area_id, $3, 'Hausmeister' from properties where id = $2`,
    [id, property, familyName],
  )

  return id
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    tenant,
    'Wohnbau Nord eG',
    other,
    'Wohnbau Süd eG',
  ])

  area = await areaOf(tenant, 'Nord')
  secondArea = await areaOf(tenant, 'Süd')
  here = await propertyIn(tenant, area)
  beside = await propertyIn(tenant, area)
  elsewhere = await propertyIn(other, await areaOf(other, 'Nord'))
  firm = await contractorOf(tenant)
  otherFirm = await contractorOf(other)

  // Whoever the application acts for works here: the rows of a contractor lie
  // in no area and are kept to the people of the operator (#539).
  await admin.query(
    "insert into auth_users (id, name, email) values ('user-lead', 'Leitung', 'leitung@nord.example')",
  )
  await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
    tenant,
    'user-lead',
    ['management'],
  ])

  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

/** A row put in past the application, and the key or check that refused it. */
function tried(statement: string, values: readonly unknown[]) {
  return refusedBy(admin.query(statement, [...values]))
}

/**
 * Something done as the application does it, inside the tenant and under the
 * policies, in every area: a trigger runs as whoever changes the row.
 */
function asTheApplication(statement: ReturnType<typeof sql>) {
  return database.forTenant({ tenantId: tenant, userId: 'user-lead' }, async (tx) => {
    await tx.execute(sql`select set_config('app.all_areas', 'on', true)`)
    await tx.execute(statement)
  })
}

describe('a contact in the database', () => {
  /**
   * One attempt per key of the table, read from the catalogue: a key that a
   * later migration adds without an attempt here turns this red, and so does
   * an attempt that is not refused by the key it names.
   */
  it('hangs on a property of its tenant and lies in the area of it, key by key', async () => {
    const contact = (property: string, areaId: string) =>
      tried(
        `insert into contacts (tenant_id, property_id, area_id, family_name)
         values ($1, $2, $3, 'Becker')`,
        [tenant, property, areaId],
      )
    const refused = { code: '23503', constraint: 'contacts_follow_their_property' }

    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'f'
          and c.relname = 'contacts'
          and k.conname not like '%_tenant_id_tenants_id_fk'
        order by 1`,
    )

    expect(rows.map((row) => row.name)).toEqual([
      'contacts_follow_their_property',
      'contacts_of_a_contractor',
    ])

    // In another area than its property.
    expect(await contact(here, secondArea)).toEqual(refused)
    // At a property of another tenant, whichever area it names.
    expect(await contact(elsewhere, area)).toEqual(refused)
    // At a property there is none of.
    expect(await contact(randomUUID(), area)).toEqual(refused)

    const ofAFirm = (contractor: string) =>
      tried(
        `insert into contacts (tenant_id, contractor_id, family_name) values ($1, $2, 'Krämer')`,
        [tenant, contractor],
      )
    const noSuchFirm = { code: '23503', constraint: 'contacts_of_a_contractor' }

    // At a firm of another tenant, and at one there is none of (#328).
    expect(await ofAFirm(otherFirm)).toEqual(noSuchFirm)
    expect(await ofAFirm(randomUUID())).toEqual(noSuchFirm)
  })

  /**
   * A property or a contractor, exactly one, and an area exactly with a
   * property (ADR 0003, addendum of #328): a row without an area that hangs
   * on a property would be read by everybody in the operator.
   */
  it('hangs on a property or a contractor, and lies in no area only at a contractor', async () => {
    const check = { code: '23514', constraint: 'contacts_at_a_property_or_a_contractor' }
    const attempt = (property: string | null, areaId: string | null, contractor: string | null) =>
      tried(
        `insert into contacts (tenant_id, property_id, area_id, contractor_id, family_name)
         values ($1, $2, $3, $4, 'Becker')`,
        [tenant, property, areaId, contractor],
      )

    expect({
      nothing: await attempt(null, null, null),
      'an area alone': await attempt(null, area, null),
      'a property without its area': await attempt(here, null, null),
      'a property and a firm': await attempt(here, area, firm),
      'a firm with an area': await attempt(null, area, firm),
    }).toEqual({
      nothing: check,
      'an area alone': check,
      'a property without its area': check,
      'a property and a firm': check,
      'a firm with an area': check,
    })
  })

  it('is taken at a contractor, in no area', async () => {
    const { rowCount } = await admin.query(
      `insert into contacts (tenant_id, contractor_id, family_name) values ($1, $2, 'Krämer')`,
      [tenant, firm],
    )

    expect(rowCount).toBe(1)
  })

  it('is taken when it names its property and the area of it', async () => {
    const { rowCount } = await admin.query(
      `insert into contacts (tenant_id, property_id, area_id, family_name)
       values ($1, $2, $3, 'Becker')`,
      [tenant, here, area],
    )

    expect(rowCount).toBe(1)
  })
})

describe('the contacts of a property marked deleted', () => {
  async function deletedAt(table: string, id: string): Promise<string | null> {
    const { rows } = await admin.query<{ at: string | null }>(
      `select deleted_at::text as at from ${table} where id = $1`,
      [id],
    )

    return rows[0]?.at ?? null
  }

  /**
   * Nobody asks after the caretaker of a property that is gone, and a device
   * that holds the contacts learns from the mark that it may let them go: the
   * cascades of the keys never run for a row that is only marked.
   */
  it('are marked with it at the same moment, and none of the property beside it', async () => {
    const doomed = await propertyIn(tenant, area)
    const caretaker = await contactAt(doomed, 'Becker')
    const head = await contactAt(doomed, 'Albers')
    const neighbour = await contactAt(beside)

    await asTheApplication(sql`update properties set deleted_at = now() where id = ${doomed}`)

    const moment = await deletedAt('properties', doomed)

    expect(moment).not.toBeNull()
    expect({
      caretaker: await deletedAt('contacts', caretaker),
      head: await deletedAt('contacts', head),
    }).toEqual({ caretaker: moment, head: moment })
    expect(await deletedAt('contacts', neighbour)).toBeNull()
  })

  it('keep the moment they were taken away themselves', async () => {
    const doomed = await propertyIn(tenant, area)
    const gone = await contactAt(doomed, 'Becker')
    const still = await contactAt(doomed, 'Albers')

    await asTheApplication(
      sql`update contacts set deleted_at = now() - interval '1 day' where id = ${gone}`,
    )

    const earlier = await deletedAt('contacts', gone)

    await asTheApplication(sql`update properties set deleted_at = now() where id = ${doomed}`)

    const moment = await deletedAt('properties', doomed)

    expect(earlier).not.toBeNull()
    expect(await deletedAt('contacts', gone)).toBe(earlier)
    expect(await deletedAt('contacts', still)).toBe(moment)
    expect(moment).not.toBe(earlier)
  })

  /**
   * A mark is a change like any other: the row carries a new version and a
   * later place in the order of changes, so that the next pull of a device
   * brings it.
   */
  it('reach a device as a change, with the stamp of whoever marked the property', async () => {
    const doomed = await propertyIn(tenant, area)
    const contact = await contactAt(doomed)
    const stamp = async () =>
      (
        await admin.query<{ version: number; sequence: string; updated_by: string | null }>(
          `select version, change_sequence::text as sequence, updated_by from contacts where id = $1`,
          [contact],
        )
      ).rows[0]
    const before = await stamp()

    await asTheApplication(sql`update properties set deleted_at = now() where id = ${doomed}`)

    const after = await stamp()

    expect(before?.version).toBe(1)
    expect(after?.version).toBe(2)
    expect(Number(after?.sequence)).toBeGreaterThan(Number(before?.sequence))
    expect(after?.updated_by).toBe('user-lead')
  })
})

describe('the contacts and documents of a contractor marked deleted (#328)', () => {
  /** A document of the firm, in no area, as the office files it. */
  async function documentOf(contractor: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      `insert into attachments (tenant_id, contractor_id, title)
       select tenant_id, id, 'Zertifikat' from contractors where id = $1
       returning id`,
      [contractor],
    )

    return rows[0]?.id ?? ''
  }

  async function deletedAt(table: string, id: string): Promise<string | null> {
    const { rows } = await admin.query<{ at: string | null }>(
      `select deleted_at::text as at from ${table} where id = $1`,
      [id],
    )

    return rows[0]?.at ?? null
  }

  it('are marked with it at the same moment, and none of another firm', async () => {
    const doomed = await contractorOf(tenant, 'Aufzug Beispiel GmbH')
    const person = await contactOf(doomed)
    const certificate = await documentOf(doomed)
    const neighbour = await contactOf(firm)
    const kept = await documentOf(firm)

    await asTheApplication(sql`update contractors set deleted_at = now() where id = ${doomed}`)

    const moment = await deletedAt('contractors', doomed)

    expect(moment).not.toBeNull()
    expect({
      person: await deletedAt('contacts', person),
      certificate: await deletedAt('attachments', certificate),
    }).toEqual({ person: moment, certificate: moment })
    expect({
      neighbour: await deletedAt('contacts', neighbour),
      kept: await deletedAt('attachments', kept),
    }).toEqual({ neighbour: null, kept: null })
  })
})

describe('a contact of a property moved to another area', () => {
  it('lies in the new area and carries the stamp a device needs', async () => {
    const moving = await propertyIn(tenant, area)
    const contact = await contactAt(moving)
    const read = async () =>
      (
        await admin.query<{
          area_id: string
          version: number
          sequence: string
          updated_by: string | null
        }>(
          `select area_id, version, change_sequence::text as sequence, updated_by
             from contacts where id = $1`,
          [contact],
        )
      ).rows[0]
    const before = await read()

    expect(before).toMatchObject({ area_id: area, version: 1 })
    expect(Number(before?.sequence)).toBeGreaterThan(0)

    await asTheApplication(sql`update properties set area_id = ${secondArea} where id = ${moving}`)

    const after = await read()

    expect(after).toMatchObject({ area_id: secondArea, version: 2, updated_by: 'user-lead' })
    expect(Number(after?.sequence)).toBeGreaterThan(Number(before?.sequence))
  })
})

describe('the texts of a contact in the database', () => {
  const columns = {
    given_name: contactLimits.givenName,
    family_name: contactLimits.familyName,
    role: contactLimits.role,
    phone: contactLimits.phone,
    mobile: contactLimits.mobile,
    email: contactLimits.email,
  } as const

  type Column = keyof typeof columns

  /** A contact with one text set, the family name being the one no contact does without. */
  function written(column: Column, value: string | null) {
    const texts: Record<Column, string | null> = {
      given_name: null,
      family_name: 'Becker',
      role: null,
      phone: null,
      mobile: null,
      email: null,
      [column]: value,
    }

    return admin.query(
      `insert into contacts (tenant_id, property_id, area_id, given_name, family_name, role, phone, mobile, email)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenant,
        here,
        area,
        texts.given_name,
        texts.family_name,
        texts.role,
        texts.phone,
        texts.mobile,
        texts.email,
      ],
    )
  }

  /**
   * Each a text the model in `domain` refuses or a route would never hand
   * over, and the check that refuses it here: one with a space at an edge, an
   * empty one, and one a sign too long.
   */
  it('are refused as the model refuses them, check by check', async () => {
    const refused: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}

    for (const [column, limit] of Object.entries(columns) as [Column, number][]) {
      const check = { code: '23514', constraint: `contacts_${column}_shaped` }

      refused[`${column} with a space before it`] = await refusedBy(written(column, ' Becker'))
      refused[`${column} with a space after it`] = await refusedBy(written(column, 'Becker '))
      refused[`${column} left empty`] = await refusedBy(written(column, ''))
      refused[`${column} a sign too long`] = await refusedBy(written(column, 'x'.repeat(limit + 1)))

      expected[`${column} with a space before it`] = check
      expected[`${column} with a space after it`] = check
      expected[`${column} left empty`] = check
      expected[`${column} a sign too long`] = check
    }

    expect(refused).toEqual(expected)

    // Every check of the table has its attempts above.
    const { rows } = await admin.query<{ name: string }>(
      `select k.conname as name
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
        where k.contype = 'c' and c.relname = 'contacts'
        order by 1`,
    )

    // Beside them the check of what a contact hangs on, tried above (#328).
    expect(rows.map((row) => row.name)).toEqual(
      [
        ...Object.keys(columns).map((column) => `contacts_${column}_shaped`),
        'contacts_at_a_property_or_a_contractor',
      ].sort(),
    )
  })

  it('are refused without a family name, the one text no contact does without', async () => {
    expect((await refusedBy(written('family_name', null))).code).toBe('23502')
  })

  it('are taken at their bounds, and every one but the family name may be left out', async () => {
    for (const [column, limit] of Object.entries(columns) as [Column, number][]) {
      await expect(written(column, 'x'.repeat(limit))).resolves.toMatchObject({ rowCount: 1 })
    }

    await expect(
      admin.query(
        `insert into contacts (tenant_id, property_id, area_id, family_name)
         values ($1, $2, $3, 'Becker')`,
        [tenant, here, area],
      ),
    ).resolves.toMatchObject({ rowCount: 1 })
  })
})
