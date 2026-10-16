import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type ColumnMapping,
  type MeterDetails,
  meterImportFields,
  missingRight,
  planChanged,
  planHasProblems,
  planMakesNothing,
  type Right,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  suggestedMapping,
  tableBodyType,
  tableColumns,
  type TableField,
  tableFileNameHeader,
  tableFileType,
  type TableSheet,
  templateImportFields,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The import of the history of the meters and of the templates of the rounds
 * of a predecessor application over the routes of the server (#130, second
 * part, section 11 of the concept): the preview that writes nothing, and the
 * take-over, all of it or none.
 *
 * What a plan makes of the lines of a list is `domain`'s and tested there.
 * What is held here is what the routes promise around it: whose rights they
 * take, that nobody imports past the areas they hold in, that nothing is
 * written before the take-over and nothing by one that is refused, and that
 * what was taken over says so where it is shown.
 *
 * Every test has a tenant of its own, so that what it counts is what it made.
 */

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

interface Tenant {
  readonly id: TenantId
  readonly areas: Readonly<Record<string, string>>
}

/** A tenant the four people work for, with the areas named; the Objektleitung holds in the first alone. */
async function tenantWith(...areaNames: string[]): Promise<Tenant> {
  const id = newId<'tenant'>() as TenantId

  await admin.query('insert into tenants (id, name) values ($1, $2)', [id, 'Wohnbau Nord eG'])

  for (const name of areaNames) {
    await admin.query('insert into areas (tenant_id, name) values ($1, $2)', [id, name])
  }

  for (const role of roleKeys) {
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      id,
      people[role],
      [role],
    ])
  }

  const { rows } = await admin.query<{ id: string; name: string }>(
    'select id, name from areas where tenant_id = $1 order by created_at, id',
    [id],
  )
  const areas = Object.fromEntries(rows.map((row) => [row.name, row.id]))

  if (areaNames.length > 0) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [id, people.site_management, areas[areaNames[0] ?? '']],
    )
  }

  return { id, areas: areaNames.length > 0 ? areas : { '': rows[0]?.id ?? '' } }
}

function by(role: RoleKey, tenant: Tenant): string {
  return as(tenant.id, people[role], role)
}

/** Somebody of a role with rights a role of a tenant's own could give or leave out. */
function holding(tenant: Tenant, role: RoleKey, rights: readonly Right[]): string {
  return JSON.stringify({ userId: people[role], tenantId: tenant.id, roles: [role], rights })
}

async function made(header: string, path: string, body: object): Promise<Record<string, unknown>> {
  return (await http().post(path).set(testIdentityHeader, header).send(body).expect(201))
    .body as Record<string, unknown>
}

/** A property with a building and a water meter in it, in the area named; the id of the meter. */
async function meterIn(
  tenant: Tenant,
  area = Object.keys(tenant.areas)[0] ?? '',
  meterNumber = 'W-2001',
): Promise<string> {
  const header = by('technical_management', tenant)
  const property = (
    await made(header, '/properties', {
      name: `Schulzentrum ${area} ${meterNumber}`,
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      areaId: tenant.areas[area],
    })
  )['id'] as string
  const building = (
    await made(header, `/properties/${property}/buildings`, {
      name: 'Schulhaus',
      kinds: ['school'],
    })
  )['id'] as string

  return (
    await made(header, `/buildings/${building}/assets`, {
      kind: 'probe.water_meter',
      name: 'Wasserzähler Keller',
      mark: `WZ-${meterNumber}`,
      meterNumber,
      meterUnit: 'cubic_metres',
    })
  )['id'] as string
}

/** A sheet with a header and its lines, every column given the field its name says. */
function list(
  fields: readonly TableField[],
  header: readonly string[],
  ...rows: string[][]
): { sheet: TableSheet; mapping: ColumnMapping } {
  const sheet: TableSheet = { name: '', rows: [[...header], ...rows] }

  return { sheet, mapping: suggestedMapping(tableColumns(sheet), fields) }
}

const meterHeader = [
  'Zählernummer',
  'Eintrag',
  'Tag',
  'Stand',
  'Alte Zählernummer',
  'Endstand alt',
  'Neue Zählernummer',
  'Anfangsstand neu',
  'Bis',
  'Grund',
]

const reading = (day: string, value: string, meterNumber = 'W-2001') => [
  meterNumber,
  '',
  day,
  value,
  '',
  '',
  '',
  '',
  '',
  '',
]

/** A year of a meter: two readings on the old one, its replacement, a reading on the new one, a rest. */
const history = [
  reading('31.01.2025', '4980'),
  reading('28.02.2025', '5000,5'),
  ['W-2001', 'Tausch', '15.03.2025', '', 'W-1000', '5020', 'W-2001', '0', '', ''],
  reading('31.03.2025', '12'),
  [
    'W-2001',
    'Stilllegung',
    '01.07.2025',
    '',
    '',
    '',
    '',
    '',
    '31.08.2025',
    'Sanierung der Leitung',
  ],
]

const meters = (...rows: string[][]) => list(meterImportFields, meterHeader, ...rows)

const templateHeader = [
  'Vorlage',
  'Kapitel',
  'Punkt',
  'Art',
  'Einheit',
  'Mindestens',
  'Quelle des Grenzwerts',
  'Gegenzeichnung',
]

const round = [
  ['Technikrundgang', 'Heizung', 'Kessel ohne Störung', '', '', '', '', 'ja'],
  ['Technikrundgang', 'Heizung', 'Vorlauf', 'Messwert', '°C', '55', 'Betriebsanweisung', ''],
  ['Technikrundgang', 'Wasser', 'Hauptzähler', 'Zählerstand', 'm³', '', '', ''],
]

const templates = (...rows: string[][]) => list(templateImportFields, templateHeader, ...rows)

function send(path: string, identity: string, body: unknown) {
  return http()
    .post(path)
    .set(testIdentityHeader, identity)
    .set('Content-Type', tableBodyType)
    .send(JSON.stringify(body))
}

interface Preview {
  readonly lines: number
  readonly counts: Readonly<Record<string, number>>
  readonly problems: readonly { readonly what: string; readonly lines: readonly number[] }[]
  readonly rows: readonly Readonly<Record<string, unknown>>[]
  readonly jumps?: readonly { readonly lines: readonly number[]; readonly why: string }[]
}

async function preview(path: string, identity: string, body: object): Promise<Preview> {
  return (await send(`${path}/preview`, identity, body).expect(200)).body as Preview
}

/** Takes a list over as the page does: with the counts its preview showed. */
async function taken(path: string, tenant: Tenant, body: object) {
  const identity = by('technical_management', tenant)
  const { counts } = await preview(path, identity, body)

  return send(path, identity, { ...body, fileName: 'liste.csv', expected: counts })
}

const counted = [
  'meter_readings',
  'meter_exchanges',
  'meter_pauses',
  'round_templates',
  'round_template_versions',
  'imports',
  'audit_entries',
] as const

/** How many rows the tables hold that the two imports write. */
async function rowCounts(): Promise<Record<string, number>> {
  const { rows } = await admin.query<Record<string, number>>(
    `select ${counted.map((name) => `(select count(*)::int from ${name}) as ${name}`).join(', ')}`,
  )

  return rows[0] ?? {}
}

async function rowsOf<Row>(tenant: Tenant, sql: string): Promise<Row[]> {
  return (await admin.query(sql, [tenant.id])).rows as Row[]
}

async function pageOf(tenant: Tenant, meter: string): Promise<MeterDetails> {
  return (
    await http()
      .get(`/meters/${meter}`)
      .set(testIdentityHeader, by('technical_management', tenant))
      .expect(200)
  ).body as MeterDetails
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const role of roleKeys) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      people[role],
      role === 'technical_management' ? 'Petra Lindner' : people[role],
      `${people[role]}@beispiel.example`,
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue: catalogueOf(probeCatalogueBundle) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('who imports the history of meters', () => {
  it('is whoever keeps assets and reads meters, and nobody with one of the two', async () => {
    const tenant = await tenantWith()

    await meterIn(tenant)

    const body = meters(...history)
    const paths = ['/imports/meters/preview', '/imports/meters'] as const

    // The Haustechnik reads meters and keeps no assets.
    for (const path of paths) {
      expect((await send(path, by('technician', tenant), body)).status).toBe(403)
    }

    // A role of a tenant's own that keeps assets and reads no meters.
    const withoutReadings = holding(
      tenant,
      'technical_management',
      [...rightsOfRoles(['technical_management'])].filter((right) => right !== 'reading.write'),
    )

    for (const path of paths) {
      const answer = await send(path, withoutReadings, body)

      expect([answer.status, (answer.body as { message: string }).message]).toEqual([
        403,
        missingRight('reading.write'),
      ])
    }

    const file = (identity: string) =>
      http()
        .post('/imports/meters/table')
        .set(testIdentityHeader, identity)
        .set('Content-Type', tableFileType)
        .set(tableFileNameHeader, 'liste.csv')
        .send(Buffer.from('Zählernummer;Tag;Stand\nW-2001;31.01.2025;4980\n', 'utf8'))

    expect((await file(by('technician', tenant))).status).toBe(403)
    expect((await file(withoutReadings)).status).toBe(403)
    expect((await file(by('site_management', tenant))).status).toBe(200)

    for (const role of ['management', 'technical_management', 'site_management'] as const) {
      expect(
        (await preview('/imports/meters', by(role, tenant), body)).counts,
        `the preview of the ${role}`,
      ).toEqual({ readings: 3, exchanges: 1, pauses: 1, known: 0 })
    }
  })

  it('finds no measuring point beyond the areas somebody holds in', async () => {
    const tenant = await tenantWith('Nord', 'Süd')

    await meterIn(tenant, 'Nord', 'W-2001')
    await meterIn(tenant, 'Süd', 'W-3001')

    const body = meters(reading('31.01.2025', '10'), reading('31.01.2025', '20', 'W-3001'))
    const site = await preview('/imports/meters', by('site_management', tenant), body)
    const whole = await preview('/imports/meters', by('technical_management', tenant), body)

    expect(site.problems).toEqual([
      expect.objectContaining({
        lines: [3],
        what: 'Eine Anlage mit der Zählernummer „W-3001“ gibt es in Ihren Bereichen nicht',
      }),
    ])
    expect(whole.problems).toEqual([])
    expect(whole.counts['readings']).toBe(2)

    const answer = await send('/imports/meters', by('site_management', tenant), {
      ...body,
      expected: site.counts,
    })

    expect(answer.status).toBe(422)
    expect(await rowsOf(tenant, 'select id from meter_readings where tenant_id = $1')).toEqual([])
  })
})

describe('taking the history of meters over', () => {
  it('shows what the list would make and writes nothing before it is taken over', async () => {
    const tenant = await tenantWith()

    await meterIn(tenant)

    const before = await rowCounts()
    const shown = await preview(
      '/imports/meters',
      by('technical_management', tenant),
      meters(...history),
    )

    expect(shown.lines).toBe(5)
    expect(shown.counts).toEqual({ readings: 3, exchanges: 1, pauses: 1, known: 0 })
    expect(shown.rows.map((row) => [row['line'], row['entry'], row['what']])).toEqual([
      [2, 'reading', '4.980,0 m³ zum Stichtag 01.02.2025'],
      [3, 'reading', '5.000,5 m³ zum Stichtag 01.03.2025'],
      [4, 'exchange', 'Zähler W-1000 mit 5.020,0 m³ gegen W-2001 mit 0,0 m³'],
      [5, 'reading', '12,0 m³ zum Stichtag 01.04.2025'],
      [6, 'pause', 'Ruht vom 01.07.2025 bis 31.08.2025: Sanierung der Leitung'],
    ])
    expect(await rowCounts()).toEqual(before)
  })

  it('writes the readings as taken over, the replacement and the rest, at the place of the meter', async () => {
    const tenant = await tenantWith()
    const meter = await meterIn(tenant)
    const answer = await taken('/imports/meters', tenant, meters(...history))

    expect(answer.status).toBe(201)
    expect(answer.body).toMatchObject({
      counts: { readings: 3, exchanges: 1, pauses: 1, known: 0 },
      summary: '3 Zählerstände, 1 Zählertausch und 1 Stilllegung übernommen',
    })

    const [asset] = await rowsOf<{ property_id: string; area_id: string; meter_number: string }>(
      tenant,
      'select property_id, area_id, meter_number from assets where tenant_id = $1',
    )

    expect(
      await rowsOf(
        tenant,
        `select asset_id, property_id, area_id, key_date::text, read_on::text, value_milli::int,
                source, recorded_by, jump_confirmed, corrects_id
           from meter_readings where tenant_id = $1 order by key_date`,
      ),
    ).toEqual(
      [
        ['2025-02-01', '2025-01-31', 4_980_000],
        ['2025-03-01', '2025-02-28', 5_000_500],
        ['2025-04-01', '2025-03-31', 12_000],
      ].map(([keyDate, readOn, valueMilli]) => ({
        asset_id: meter,
        property_id: asset?.property_id,
        area_id: asset?.area_id,
        key_date: keyDate,
        read_on: readOn,
        value_milli: valueMilli,
        source: 'taken_over',
        recorded_by: people.technical_management,
        jump_confirmed: false,
        corrects_id: null,
      })),
    )
    expect(
      await rowsOf(
        tenant,
        `select asset_id, area_id, exchanged_on::text, old_number, old_end_milli::int, new_number,
                new_start_milli::int
           from meter_exchanges where tenant_id = $1`,
      ),
    ).toEqual([
      {
        asset_id: meter,
        area_id: asset?.area_id,
        exchanged_on: '2025-03-15',
        old_number: 'W-1000',
        old_end_milli: 5_020_000,
        new_number: 'W-2001',
        new_start_milli: 0,
      },
    ])
    expect(
      await rowsOf(
        tenant,
        `select asset_id, starts_on::text, ends_on::text, reason from meter_pauses where tenant_id = $1`,
      ),
    ).toEqual([
      {
        asset_id: meter,
        starts_on: '2025-07-01',
        ends_on: '2025-08-31',
        reason: 'Sanierung der Leitung',
      },
    ])
    // The number at the asset is the one the last replacement put in; the import leaves it alone.
    expect(asset?.meter_number).toBe('W-2001')
    expect(
      await rowsOf(
        tenant,
        'select kind, file_name, lines, summary from imports where tenant_id = $1',
      ),
    ).toEqual([
      {
        kind: 'meters',
        file_name: 'liste.csv',
        lines: 5,
        summary: '3 Zählerstände, 1 Zählertausch und 1 Stilllegung übernommen',
      },
    ])
  })

  it('shows a reading taken over as one, with who took the list over, and counts across the replacement', async () => {
    const tenant = await tenantWith()
    const meter = await meterIn(tenant)

    await taken('/imports/meters', tenant, meters(...history)).then((answer) => {
      expect(answer.status).toBe(201)
    })

    const page = await pageOf(tenant, meter)
    const rows = page.rows.filter((row) => row.reading !== null)

    expect(rows.map((row) => [row.keyDate, row.reading?.source, row.reading?.name])).toEqual([
      ['2025-04-01', 'taken_over', 'Petra Lindner'],
      ['2025-03-01', 'taken_over', 'Petra Lindner'],
      ['2025-02-01', 'taken_over', 'Petra Lindner'],
    ])
    // Up to the first of April: 19,5 on the old meter up to 5.020, and 12 on the new one.
    expect(rows[0]?.consumption).toMatchObject({ milli: 31_500 })
    expect(page.exchanges.map((each) => each.exchangedOn)).toEqual(['2025-03-15'])
    expect(page.pauses.map((each) => each.reason)).toEqual(['Sanierung der Leitung'])
  })

  it('writes every reading, replacement and rest with its own entry in the log, beside the one of the import', async () => {
    const tenant = await tenantWith()

    await meterIn(tenant)

    const [{ head } = { head: 0 }] = await rowsOf<{ head: number }>(
      tenant,
      'select coalesce(max(sequence), 0)::int as head from audit_entries where tenant_id = $1',
    )

    expect((await taken('/imports/meters', tenant, meters(...history))).status).toBe(201)

    expect(
      await rowsOf(
        tenant,
        `select table_name, count(distinct change_id)::int as changes from audit_entries
          where tenant_id = $1 and sequence > ${String(head)}
          group by table_name order by table_name`,
      ),
    ).toEqual([
      { table_name: 'imports', changes: 1 },
      { table_name: 'meter_exchanges', changes: 1 },
      { table_name: 'meter_pauses', changes: 1 },
      { table_name: 'meter_readings', changes: 3 },
    ])
  })

  it('makes nothing of a list it took over before, and takes what came since', async () => {
    const tenant = await tenantWith()

    await meterIn(tenant)
    expect((await taken('/imports/meters', tenant, meters(...history))).status).toBe(201)

    const before = await rowCounts()
    const again = await taken('/imports/meters', tenant, meters(...history))

    expect([again.status, (again.body as { message: string }).message]).toEqual([
      422,
      planMakesNothing,
    ])
    expect(await rowCounts()).toEqual(before)

    const more = await taken(
      '/imports/meters',
      tenant,
      meters(...history, reading('30.04.2025', '30')),
    )

    expect(more.status).toBe(201)
    expect(more.body).toMatchObject({ counts: { readings: 1, exchanges: 0, pauses: 0, known: 5 } })
  })

  it('writes nothing where a line is open or the stock changed since the preview', async () => {
    const tenant = await tenantWith()
    const meter = await meterIn(tenant)
    const identity = by('technical_management', tenant)
    const before = await rowCounts()

    // A reading below the one before it.
    const open = meters(reading('31.01.2025', '4980'), reading('28.02.2025', '4000'))
    const shown = await preview('/imports/meters', identity, open)

    expect(shown.problems.map((problem) => problem.lines)).toEqual([[2], [3]])

    const refused = await send('/imports/meters', identity, { ...open, expected: shown.counts })

    expect([refused.status, (refused.body as { message: string }).message]).toEqual([
      422,
      planHasProblems,
    ])
    expect(await rowCounts()).toEqual(before)

    // Somebody enters one of the readings by hand between the preview and the take-over.
    const body = meters(reading('31.01.2025', '4980'), reading('28.02.2025', '5000'))
    const { counts } = await preview('/imports/meters', identity, body)

    await http()
      .post(`/meters/${meter}/readings`)
      .set(testIdentityHeader, identity)
      .send({ readOn: '2025-01-31', valueMilli: 4_980_000 })
      .expect(201)

    const between = await rowCounts()
    const changed = await send('/imports/meters', identity, { ...body, expected: counts })

    expect([changed.status, (changed.body as { message: string }).message]).toEqual([
      409,
      planChanged,
    ])
    expect(await rowCounts()).toEqual(between)
  })

  it('holds a reading of the list against what the measuring point holds', async () => {
    const tenant = await tenantWith()
    const meter = await meterIn(tenant)
    const identity = by('technical_management', tenant)

    await http()
      .post(`/meters/${meter}/readings`)
      .set(testIdentityHeader, identity)
      .send({ readOn: '2025-02-28', valueMilli: 5_000_000 })
      .expect(201)

    const shown = await preview(
      '/imports/meters',
      identity,
      meters(reading('31.01.2025', '5100'), reading('28.02.2025', '5001')),
    )

    expect(shown.problems.map((problem) => problem.what)).toEqual([
      expect.stringContaining('Größer als der Stand danach vom 01.03.2025, 5.000,0 m³'),
      expect.stringContaining('Für den Stichtag 01.03.2025 steht an'),
    ])
  })
})

describe('what a list of the history of meters is held against', () => {
  it('counts a reading that was corrected by the figure that counts now', async () => {
    const tenant = await tenantWith()
    const meter = await meterIn(tenant)
    const identity = by('technical_management', tenant)
    const first = (
      await http()
        .post(`/meters/${meter}/readings`)
        .set(testIdentityHeader, identity)
        .send({ readOn: '2025-01-31', valueMilli: 4_900_000 })
        .expect(201)
    ).body as MeterDetails

    await http()
      .post(`/meters/${meter}/readings`)
      .set(testIdentityHeader, identity)
      .send({
        readOn: '2025-01-31',
        valueMilli: 4_980_000,
        correctsId: first.rows.find((row) => row.reading !== null)?.reading?.id,
        correctionReason: 'Zahlendreher',
      })
      .expect(201)

    // The list names the figure the correction left: it is here already, and nothing is to clear up.
    const shown = await preview('/imports/meters', identity, meters(reading('31.01.2025', '4980')))

    expect(shown.problems).toEqual([])
    expect(shown.counts).toEqual({ readings: 0, exchanges: 0, pauses: 0, known: 1 })
  })

  it('gives a reading the key date of its measuring point where that has a day of its own', async () => {
    const tenant = await tenantWith()
    const meter = await meterIn(tenant)
    const identity = by('technical_management', tenant)

    await http()
      .put(`/meters/${meter}`)
      .set(testIdentityHeader, identity)
      .send({ keyDay: 15 })
      .expect(200)

    const shown = await preview('/imports/meters', identity, meters(reading('31.01.2025', '4980')))

    expect(shown.rows.map((row) => row['what'])).toEqual(['4.980,0 m³ zum Stichtag 15.02.2025'])
  })
})

describe('a figure of a list far above the one before', () => {
  it('is named by the preview, and taken over as confirmed by whoever takes the list over', async () => {
    const tenant = await tenantWith()

    await meterIn(tenant)

    const body = meters(reading('31.01.2025', '100'), reading('28.02.2025', '1000'))
    const shown = await preview('/imports/meters', by('technical_management', tenant), body)

    expect(shown.problems).toEqual([])
    expect(shown.jumps).toEqual([
      {
        lines: [3],
        column: 'Stand',
        why: 'Etwa zehnmal so viel wie im Vormonat. Stimmt das Komma?',
      },
    ])
    expect((await taken('/imports/meters', tenant, body)).status).toBe(201)
    expect(
      await rowsOf(
        tenant,
        'select value_milli::int, jump_confirmed from meter_readings where tenant_id = $1 order by key_date',
      ),
    ).toEqual([
      { value_milli: 100_000, jump_confirmed: false },
      { value_milli: 1_000_000, jump_confirmed: true },
    ])
  })
})

describe('who imports templates of rounds', () => {
  it('is whoever keeps the templates, from the Objektleitung up', async () => {
    const tenant = await tenantWith()
    const body = templates(...round)

    for (const path of ['/imports/templates/preview', '/imports/templates'] as const) {
      expect((await send(path, by('technician', tenant), body)).status).toBe(403)
    }

    expect(
      (
        await http()
          .post('/imports/templates/table')
          .set(testIdentityHeader, by('technician', tenant))
          .set('Content-Type', tableFileType)
          .set(tableFileNameHeader, 'vorlagen.csv')
          .send(Buffer.from('Vorlage;Punkt\nTechnikrundgang;Kessel\n', 'utf8'))
      ).status,
    ).toBe(403)

    for (const role of ['management', 'technical_management', 'site_management'] as const) {
      expect(
        (await preview('/imports/templates', by(role, tenant), body)).counts,
        `the preview of the ${role}`,
      ).toEqual({ templates: 1, chapters: 2, points: 3, known: 0 })
    }
  })
})

describe('taking templates of rounds over', () => {
  it('shows what the list would make and writes nothing before it is taken over', async () => {
    const tenant = await tenantWith()
    const before = await rowCounts()
    const shown = await preview(
      '/imports/templates',
      by('technical_management', tenant),
      templates(...round),
    )

    expect(shown.rows).toEqual([
      {
        line: 2,
        title: 'Technikrundgang',
        chapters: 2,
        points: 3,
        limits: 1,
        asksCountersignature: true,
      },
    ])
    expect(await rowCounts()).toEqual(before)
  })

  it('writes each template with its first version, as the editor would have saved it', async () => {
    const tenant = await tenantWith()
    const answer = await taken('/imports/templates', tenant, templates(...round))

    expect(answer.status).toBe(201)
    expect(answer.body).toMatchObject({
      counts: { templates: 1, chapters: 2, points: 3, known: 0 },
      summary: '1 Vorlage mit 3 Punkten übernommen',
    })
    expect(
      await rowsOf(
        tenant,
        `select t.title, t.source_key, v.form_version, v.asks_countersignature, v.definition
           from round_templates t
           join round_template_versions v on v.tenant_id = t.tenant_id and v.template_id = t.id
          where t.tenant_id = $1`,
      ),
    ).toEqual([
      {
        title: 'Technikrundgang',
        source_key: null,
        form_version: 1,
        asks_countersignature: true,
        definition: {
          title: 'Technikrundgang',
          sections: [
            {
              key: 'k1',
              title: 'Heizung',
              fields: [
                { key: 'p1', kind: 'check_point', label: 'Kessel ohne Störung' },
                {
                  key: 'p2',
                  kind: 'measurement',
                  label: 'Vorlauf',
                  required: true,
                  unit: 'degrees_celsius',
                  decimals: 1,
                  limit: {
                    kind: 'stated',
                    bound: 'at_least',
                    milli: 55_000,
                    source: 'Betriebsanweisung',
                  },
                },
              ],
            },
            {
              key: 'k2',
              title: 'Wasser',
              fields: [
                {
                  key: 'p3',
                  kind: 'meter_reading',
                  label: 'Hauptzähler',
                  required: true,
                  unit: 'cubic_metres',
                  decimals: 1,
                },
              ],
            },
          ],
        },
      },
    ])
    expect(
      await rowsOf(tenant, 'select kind, lines, summary from imports where tenant_id = $1'),
    ).toEqual([{ kind: 'templates', lines: 3, summary: '1 Vorlage mit 3 Punkten übernommen' }])
  })

  it('saves a next version of a template it took over, as of one begun in the office', async () => {
    const tenant = await tenantWith()

    expect((await taken('/imports/templates', tenant, templates(...round))).status).toBe(201)

    const [template] = await rowsOf<{ id: string; definition: { sections: unknown[] } }>(
      tenant,
      `select t.id, v.definition from round_templates t
         join round_template_versions v on v.tenant_id = t.tenant_id and v.template_id = t.id
        where t.tenant_id = $1`,
    )
    const next = await http()
      .post(`/round-templates/${template?.id ?? ''}/versions`)
      .set(testIdentityHeader, by('site_management', tenant))
      .send({
        definition: { ...template?.definition, title: 'Technikrundgang Haus A' },
        asksCountersignature: false,
        basedOn: 1,
      })

    expect([next.status, next.body]).toEqual([201, { id: template?.id, formVersion: 2 }])
  })

  it('leaves a template of that name as it is, and makes nothing of a list it took over before', async () => {
    const tenant = await tenantWith()

    expect((await taken('/imports/templates', tenant, templates(...round))).status).toBe(201)

    const before = await rowCounts()
    const again = await taken('/imports/templates', tenant, templates(...round))

    expect([again.status, (again.body as { message: string }).message]).toEqual([
      422,
      planMakesNothing,
    ])
    expect(await rowCounts()).toEqual(before)

    const more = await taken(
      '/imports/templates',
      tenant,
      templates(...round, ['Wochenrundgang', 'Außen', 'Wege frei', '', '', '', '', '']),
    )

    expect(more.status).toBe(201)
    expect(more.body).toMatchObject({ counts: { templates: 1, chapters: 1, points: 1, known: 3 } })
    expect(
      await rowsOf(tenant, 'select title from round_templates where tenant_id = $1 order by title'),
    ).toEqual([{ title: 'Technikrundgang' }, { title: 'Wochenrundgang' }])
  })

  it('writes nothing where a line is open or the stock changed since the preview', async () => {
    const tenant = await tenantWith()
    const identity = by('technical_management', tenant)
    const before = await rowCounts()
    const open = templates(...round, [
      'Wochenrundgang',
      'Außen',
      'Druck',
      'Messwert',
      '',
      '',
      '',
      '',
    ])
    const shown = await preview('/imports/templates', identity, open)

    expect(shown.problems.map((problem) => problem.lines)).toEqual([[5]])

    const refused = await send('/imports/templates', identity, { ...open, expected: shown.counts })

    expect([refused.status, (refused.body as { message: string }).message]).toEqual([
      422,
      planHasProblems,
    ])
    expect(await rowCounts()).toEqual(before)

    // Somebody begins a template of that name between the preview and the take-over.
    const body = templates(...round, ['Wochenrundgang', 'Außen', 'Wege frei', '', '', '', '', ''])
    const { counts } = await preview('/imports/templates', identity, body)

    await http()
      .post('/round-templates')
      .set(testIdentityHeader, identity)
      .send({
        definition: {
          title: 'Wochenrundgang',
          sections: [
            { key: 'k1', title: 'Außen', fields: [{ key: 'p1', kind: 'photo', label: 'Hof' }] },
          ],
        },
        asksCountersignature: false,
      })
      .expect(201)

    const between = await rowCounts()
    const changed = await send('/imports/templates', identity, { ...body, expected: counts })

    expect([changed.status, (changed.body as { message: string }).message]).toEqual([
      409,
      planChanged,
    ])
    expect(await rowCounts()).toEqual(between)
  })
})
