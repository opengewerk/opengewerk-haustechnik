import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  assetImportFields,
  type AuditPage,
  catalogueOf,
  type ColumnMapping,
  importLimits,
  missingRight,
  planChanged,
  planHasProblems,
  planMakesNothing,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  structureFields,
  suggestedMapping,
  tableBodyType,
  tableColumns,
  type TableField,
  tableFileNameHeader,
  tableFileType,
  type TableSheet,
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
 * The import of places and assets from tables over the routes of the server
 * (#100, sections 3 and 11 of the concept): the file read into a table, the
 * preview that writes nothing, and the take-over that writes all of it or
 * none.
 *
 * What a plan makes of the lines of a table is `domain`'s and tested there,
 * how a file becomes a table is the foundation's. What is held here is what
 * the routes promise around both: whose right each takes, that nothing is
 * written before the take-over and nothing by one that is refused, that an
 * import is one change in the log of its tenant, that a possible duplicate
 * waits for an answer, and that nobody imports past the areas they hold in.
 *
 * Every test has a tenant of its own, so that what it counts is what it made.
 */

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

interface Tenant {
  readonly id: TenantId
  /** The area of a tenant with one, and the first of a tenant with several. */
  readonly area: string
  /** Every area by its name. */
  readonly areas: Readonly<Record<string, string>>
}

/**
 * A tenant the four people work for. With areas named it has those before
 * anybody works for it, and the Objektleitung and the Haustechnik hold in the
 * first of them alone; without, it has the one area a tenant begins with.
 */
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
  const area = areas[areaNames[0] ?? ''] ?? rows[0]?.id ?? ''

  if (areaNames.length > 0) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $4), ($1, $3, $4)',
      [id, people.site_management, people.technician, area],
    )
  }

  return { id, area, areas }
}

/** The header of somebody with one of the four roles. */
function by(role: RoleKey, tenant: Tenant): string {
  return as(tenant.id, people[role], role)
}

/**
 * Somebody of the Objektleitung who also keeps places, as a role of a
 * tenant's own could let them. What they see the database reads from their
 * membership: in a tenant with several areas that is the first of them.
 */
function narrow(tenant: Tenant): string {
  return JSON.stringify({
    userId: people.site_management,
    tenantId: tenant.id,
    roles: ['site_management'],
    rights: [...rightsOfRoles(['site_management']), 'location.write'],
  })
}

function post(path: string, header: string, body: object = {}) {
  return http().post(path).set(testIdentityHeader, header).send(body)
}

/** A sheet with what was decided about it, as a page sends it. */
function sendTable(path: string, header: string, body: unknown) {
  return http()
    .post(path)
    .set(testIdentityHeader, header)
    .set('Content-Type', tableBodyType)
    .send(JSON.stringify(body))
}

/** The bytes of a file somebody chose, with its name in the header. */
function sendFile(path: string, header: string, bytes: Buffer, name: string) {
  return http()
    .post(path)
    .set(testIdentityHeader, header)
    .set('Content-Type', tableFileType)
    .set(tableFileNameHeader, encodeURIComponent(name))
    .send(bytes)
}

interface Sent {
  readonly sheet: TableSheet
  readonly mapping: ColumnMapping
}

/** A sheet under its header, with every column given the field its name says. */
function table(
  fields: readonly TableField[],
  header: readonly string[],
  ...rows: readonly (readonly string[])[]
): Sent {
  const sheet: TableSheet = { name: '', rows: [header, ...rows] }

  return { sheet, mapping: suggestedMapping(tableColumns(sheet), fields) }
}

const placeHeader = [
  'Liegenschaft',
  'Straße',
  'PLZ',
  'Ort',
  'Gebäude',
  'Geschoss',
  'Raum-Nr.',
  'Raumbezeichnung',
]

/** A line of a list of places: the property with its address, and what lies in it as far as named. */
function placeLine(property: string, building = '', floor = '', number = '', name = ''): string[] {
  return [
    property,
    'Neckarstraße 4',
    '68535',
    'Edingen-Neckarhausen',
    building,
    floor,
    number,
    name,
  ]
}

/** What the first step of the import of places says where the file says nothing. */
function defaultsIn(areaId: string) {
  return { areaId, federalState: 'DE-BW', buildingKinds: ['school'] }
}

const assetHeader = [
  'Liegenschaft',
  'Gebäude',
  'Raum',
  'Anlagenart',
  'Bezeichnung',
  'Seriennummer',
  'Kennzeichen',
]

const school = 'Schulzentrum Am Neckar'

/** A line of a list of assets in the school house, an elevator unless it says otherwise. */
function assetLine(
  name: string,
  {
    serial = '',
    mark = '',
    room = '',
    kind = 'Aufzug',
    building = 'Schulhaus',
    property = school,
  } = {},
): string[] {
  return [property, building, room, kind, name, serial, mark]
}

async function made(header: string, path: string, body: object): Promise<Record<string, unknown>> {
  return (await post(path, header, body).expect(201)).body as Record<string, unknown>
}

interface Place {
  readonly property: string
  readonly building: string
  readonly floor: string
  readonly room: string
}

/** A property with a building, a floor and a room, typed in by whoever keeps the places. */
async function placeIn(
  tenant: Tenant,
  { property = school, building = 'Schulhaus', areaId = tenant.area } = {},
): Promise<Place> {
  const header = by('technical_management', tenant)
  const propertyId = (
    await made(header, '/properties', {
      name: property,
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      areaId,
    })
  )['id'] as string
  const buildingId = (
    await made(header, `/properties/${propertyId}/buildings`, { name: building, kinds: ['school'] })
  )['id'] as string
  const floorId = (
    await made(header, `/buildings/${buildingId}/floors`, { name: 'Erdgeschoss', level: 0 })
  )['id'] as string
  const roomId = (
    await made(header, `/floors/${floorId}/rooms`, { number: 'E.14', name: 'Technik' })
  )['id'] as string

  return { property: propertyId, building: buildingId, floor: floorId, room: roomId }
}

/** An elevator in a building, typed in by whoever keeps the assets. */
async function assetIn(tenant: Tenant, building: string, values: object) {
  return made(by('technical_management', tenant), `/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    ...values,
  })
}

/** Says once what the lists of a tenant call an elevator. */
async function elevatorsNamed(tenant: Tenant, name = 'Aufzug'): Promise<void> {
  await http()
    .put('/imports/asset-kinds')
    .set(testIdentityHeader, by('site_management', tenant))
    .send({ names: [{ name, kind: 'probe.elevator' }] })
    .expect(200)
}

const counted = [
  'properties',
  'buildings',
  'floors',
  'rooms',
  'assets',
  'imports',
  'asset_kind_names',
  'audit_entries',
  'files',
] as const

/**
 * How many rows the tables hold that an import could touch, over every
 * tenant, and how far the numbers of every tenant have been drawn.
 */
async function rowCounts(): Promise<Record<string, number>> {
  const { rows } = await admin.query<Record<string, number>>(
    `select ${counted.map((name) => `(select count(*)::int from ${name}) as ${name}`).join(', ')},
            (select coalesce(sum(next_value), 0)::int from number_ranges) as numbers_drawn`,
  )

  return rows[0] ?? {}
}

/** Where the log of a tenant ends. */
async function logHead(tenant: Tenant): Promise<number> {
  const { rows } = await admin.query<{ head: number }>(
    'select coalesce(max(sequence), 0)::int as head from audit_entries where tenant_id = $1',
    [tenant.id],
  )

  return rows[0]?.head ?? 0
}

interface Logged {
  readonly change_id: string
  readonly table_name: string
  readonly operation: string
  readonly field: string
  readonly new_value: string | null
  readonly user_id: string | null
}

/** What the log of a tenant says after a place in it. */
async function loggedAfter(tenant: Tenant, head: number): Promise<Logged[]> {
  const { rows } = await admin.query<Logged>(
    `select change_id, table_name, operation::text as operation, field, new_value, user_id
       from audit_entries where tenant_id = $1 and sequence > $2 order by sequence`,
    [tenant.id, head],
  )

  return rows
}

/** The changes among entries, each as its table and what was done. */
function changesOf(entries: readonly Logged[]): string[] {
  return [
    ...new Map(
      entries.map((entry) => [entry.change_id, `${entry.table_name} ${entry.operation}`]),
    ).values(),
  ]
}

/** The rows of a table in a tenant, and how many of them carry what the sync stamps on a new row. */
async function stamped(tenant: Tenant, name: string) {
  const { rows } = await admin.query<{ rows: number; stamped: number }>(
    `select count(*)::int as rows,
            count(*) filter (where version = 1 and change_sequence > 0)::int as stamped
       from ${name} where tenant_id = $1`,
    [tenant.id],
  )

  return rows[0]
}

interface Refusal {
  readonly message: string
}

interface Taken {
  readonly id: string
  readonly counts: Readonly<Record<string, number>>
  readonly summary: string
}

interface StructurePreview {
  readonly lines: number
  readonly counts: Readonly<Record<string, number>>
  readonly problems: readonly { lines: number[]; what: string; next: string }[]
  readonly moreProblems: number
  readonly known: readonly {
    lines: number[]
    inFile: string
    existing: string
    table: string
    id: string
  }[]
  readonly moreKnown: number
}

interface AssetsPreview {
  readonly lines: number
  readonly counts: Readonly<Record<string, number>>
  readonly problems: readonly { lines: number[]; what: string; next: string }[]
  readonly moreProblems: number
  readonly duplicates: readonly {
    line: number
    name: string
    same: string
    of: readonly Record<string, unknown>[]
    decision: string | null
  }[]
}

async function structurePreview(header: string, body: unknown): Promise<StructurePreview> {
  return (await sendTable('/imports/structure/preview', header, body).expect(200))
    .body as StructurePreview
}

async function assetsPreview(header: string, body: unknown): Promise<AssetsPreview> {
  return (await sendTable('/imports/assets/preview', header, body).expect(200))
    .body as AssetsPreview
}

/** The assets of a tenant as the register would list them: by their number. */
async function assetsOf(tenant: Tenant) {
  const { rows } = await admin.query<{
    number: string | null
    name: string
    kind: string
    serial_number: string | null
    room_id: string | null
  }>(
    `select number, name, kind, serial_number, room_id from assets
      where tenant_id = $1 and deleted_at is null order by number`,
    [tenant.id],
  )

  return rows
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const role of roleKeys) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      people[role],
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

/** A school with two houses of two floors and twelve rooms each: 48 lines, one for every room. */
function schoolLines(): string[][] {
  const lines: string[][] = []

  for (const building of ['Schulhaus', 'Turnhalle']) {
    for (const floor of ['EG', '1. OG']) {
      for (let room = 1; room <= 12; room += 1) {
        lines.push(placeLine(school, building, floor, `${floor.charAt(0)}.${String(room)}`))
      }
    }
  }

  return lines
}

describe('the acceptance of the import from tables (#100)', () => {
  it('acceptance 1, "Eine Datei mit einer fehlerhaften Zeile ändert nichts": a table with one bad line is refused whole, and every table counts what it counted', async () => {
    const tenant = await tenantWith()

    await placeIn(tenant, { property: 'Rathaus' })
    await elevatorsNamed(tenant)

    const before = await rowCounts()

    // Three lines that could be taken over, and one that names a room without its building.
    const places = {
      ...table(
        structureFields,
        placeHeader,
        placeLine(school, 'Schulhaus', 'EG', 'E.01'),
        placeLine(school, 'Schulhaus', 'EG', 'E.02'),
        placeLine(school, 'Turnhalle'),
        placeLine(school, '', '', 'E.03'),
      ),
      defaults: defaultsIn(tenant.area),
    }
    const keeper = by('technical_management', tenant)
    const seen = await structurePreview(keeper, places)

    expect(seen.problems).toEqual([
      { lines: [5], what: 'Das Gebäude fehlt', next: 'In der Datei berichtigen und neu hochladen' },
    ])

    const refused = await sendTable('/imports/structure', keeper, {
      ...places,
      fileName: 'bestand.csv',
      expected: seen.counts,
    }).expect(422)

    expect((refused.body as Refusal).message).toBe(planHasProblems)
    expect(await rowCounts()).toEqual(before)

    // Two assets that could be made, and one in a building that is not there.
    const listed = table(
      assetImportFields,
      assetHeader,
      assetLine('Aufzug Nord', { property: 'Rathaus' }),
      assetLine('Aufzug Süd', { property: 'Rathaus' }),
      assetLine('Aufzug Halle', { property: 'Rathaus', building: 'Turnhalle' }),
    )
    const shown = await assetsPreview(keeper, listed)

    expect(shown.problems).toEqual([
      {
        lines: [4],
        what: 'Das Gebäude „Turnhalle“ gibt es in der Liegenschaft Rathaus nicht',
        next: 'Gebäude anlegen oder die Datei berichtigen',
      },
    ])

    const turnedAway = await sendTable('/imports/assets', keeper, {
      ...listed,
      fileName: 'anlagen.csv',
      expected: shown.counts,
    }).expect(422)

    expect((turnedAway.body as Refusal).message).toBe(planHasProblems)
    expect(await rowCounts()).toEqual(before)
  })

  it('acceptance 2, "Ein Import steht als ein Eintrag im Änderungsprotokoll und nicht als tausend": the places of an import are one change, the row of the import', async () => {
    const tenant = await tenantWith()
    const keeper = by('technical_management', tenant)
    const places = {
      ...table(structureFields, placeHeader, ...schoolLines()),
      defaults: defaultsIn(tenant.area),
    }
    const seen = await structurePreview(keeper, places)

    expect(seen.counts).toEqual({ properties: 1, buildings: 2, floors: 4, rooms: 48, known: 0 })

    const head = await logHead(tenant)
    const taken = (
      await sendTable('/imports/structure', keeper, {
        ...places,
        fileName: 'bestand-schulzentrum.csv',
        expected: seen.counts,
      }).expect(201)
    ).body as Taken

    expect(taken).toEqual({
      id: expect.any(String) as string,
      counts: seen.counts,
      summary: '1 Liegenschaft, 2 Gebäude, 4 Geschosse und 48 Räume angelegt',
    })

    // 55 records were made, and the log of the tenant grew by one change:
    // the row of the import, written by whoever imported.
    const logged = await loggedAfter(tenant, head)

    expect(changesOf(logged)).toEqual(['imports insert'])
    expect(new Set(logged.map((entry) => entry.user_id))).toEqual(
      new Set([people.technical_management]),
    )
    expect(Object.fromEntries(logged.map((entry) => [entry.field, entry.new_value]))).toMatchObject(
      {
        id: taken.id,
        kind: 'structure',
        file_name: 'bestand-schulzentrum.csv',
        lines: '48',
        summary: taken.summary,
      },
    )

    // The row says the same.
    const { rows: kept } = await admin.query(
      'select kind, file_name, lines, summary from imports where tenant_id = $1',
      [tenant.id],
    )

    expect(kept).toEqual([
      {
        kind: 'structure',
        file_name: 'bestand-schulzentrum.csv',
        lines: 48,
        summary: taken.summary,
      },
    ])

    // The records are there, and each carries what a device learns of it by.
    expect(await stamped(tenant, 'properties')).toEqual({ rows: 1, stamped: 1 })
    expect(await stamped(tenant, 'buildings')).toEqual({ rows: 2, stamped: 2 })
    expect(await stamped(tenant, 'floors')).toEqual({ rows: 4, stamped: 4 })
    expect(await stamped(tenant, 'rooms')).toEqual({ rows: 48, stamped: 48 })

    // The Leitung reads it as one change, called by the name of the file.
    const page = (
      await http()
        .get('/audit/changes')
        .set(testIdentityHeader, by('management', tenant))
        .expect(200)
    ).body as AuditPage
    const imported = page.changes.filter((change) => change.table === 'imports')

    expect(imported.map((change) => [change.operation, change.userId])).toEqual([
      ['insert', people.technical_management],
    ])
    expect(page.titles[imported[0]?.recordId ?? '']).toMatchObject({
      table: 'imports',
      title: 'bestand-schulzentrum.csv',
    })
    expect(
      page.changes.filter((change) =>
        ['properties', 'buildings', 'floors', 'rooms'].includes(change.table),
      ),
    ).toEqual([])

    // The silence ends with the import: a place typed in afterwards is in the log as always.
    const after = await logHead(tenant)

    await placeIn(tenant, { property: 'Rathaus' })

    expect(changesOf(await loggedAfter(tenant, after))).toEqual([
      'properties insert',
      'buildings insert',
      'floors insert',
      'rooms insert',
    ])
  })

  it('acceptance 2 for assets: the assets of an import write no entry, its row is the one change that names it, and the counter of their numbers moves once', async () => {
    const tenant = await tenantWith()
    const keeper = by('site_management', tenant)
    const place = await placeIn(tenant)

    await elevatorsNamed(tenant)

    const listed = table(
      assetImportFields,
      assetHeader,
      ...['Nord', 'Süd', 'Ost', 'West', 'Mitte'].map((where, at) =>
        assetLine(`Aufzug ${where}`, { serial: `SN-${String(at + 1)}`, room: 'E.14' }),
      ),
    )
    const shown = await assetsPreview(keeper, listed)

    expect(shown.counts).toEqual({ assets: 5, skipped: 0, undecided: 0 })

    const head = await logHead(tenant)
    const taken = (
      await sendTable('/imports/assets', keeper, {
        ...listed,
        fileName: 'anlagen-schulzentrum.xlsx',
        expected: shown.counts,
      }).expect(201)
    ).body as Taken

    expect(taken).toEqual({
      id: expect.any(String) as string,
      counts: shown.counts,
      summary: '5 Anlagen angelegt',
    })

    const logged = await loggedAfter(tenant, head)
    const ofTheImport = logged.filter((entry) => entry.table_name === 'imports')

    expect(changesOf(ofTheImport)).toEqual(['imports insert'])
    expect(
      Object.fromEntries(ofTheImport.map((entry) => [entry.field, entry.new_value])),
    ).toMatchObject({
      id: taken.id,
      kind: 'assets',
      file_name: 'anlagen-schulzentrum.xlsx',
      lines: '5',
      summary: '5 Anlagen angelegt',
    })
    expect(logged.filter((entry) => entry.table_name === 'assets')).toEqual([])
    // Beside the row of the import the log holds the counter the numbers of
    // the assets were drawn from, and nothing else. The counter is a record
    // of its own: it is made with its first use, and then it moves once, by
    // five, because the numbers of an import are drawn in one step. Drawn
    // one by one, as for an asset typed into the form, they would be five
    // changes, and a thousand for a list of a thousand.
    expect(changesOf(logged)).toEqual([
      'imports insert',
      'number_ranges insert',
      'number_ranges update',
    ])
    expect(
      logged
        .filter((entry) => entry.table_name === 'number_ranges' && entry.operation === 'update')
        .filter((entry) => entry.field === 'next_value')
        .map((entry) => entry.new_value),
    ).toEqual(['6'])

    expect(await stamped(tenant, 'assets')).toEqual({ rows: 5, stamped: 5 })

    // A device hears of every asset the import made, with its next pull.
    const pulled = (
      await http()
        .get('/sync?since=0')
        .set(testIdentityHeader, by('technician', tenant))
        .expect(200)
    ).body as { changes: { entity: string; rows: Record<string, unknown>[] }[] }
    const heard = pulled.changes.find((change) => change.entity === 'assets')?.rows ?? []

    expect(heard.map((row) => row['name']).sort()).toEqual([
      'Aufzug Mitte',
      'Aufzug Nord',
      'Aufzug Ost',
      'Aufzug Süd',
      'Aufzug West',
    ])
    expect(new Set(heard.map((row) => row['roomId']))).toEqual(new Set([place.room]))

    // The Leitung reads the import as one change, called by its file, and no asset beside it.
    const page = (
      await http()
        .get('/audit/changes')
        .set(testIdentityHeader, by('management', tenant))
        .expect(200)
    ).body as AuditPage
    const imported = page.changes.filter((change) => change.table === 'imports')

    expect(imported).toHaveLength(1)
    expect(page.titles[imported[0]?.recordId ?? '']?.title).toBe('anlagen-schulzentrum.xlsx')
    expect(page.changes.filter((change) => change.table === 'assets')).toEqual([])
  })

  it('acceptance 3, "Eine Dublette wird in der Vorschau genannt und weder still übernommen noch still verworfen": the preview names it, and the take-over waits for the answer', async () => {
    const tenant = await tenantWith()
    const keeper = by('site_management', tenant)
    const place = await placeIn(tenant)
    const there = await assetIn(tenant, place.building, {
      name: 'Aufzug Altbau',
      serialNumber: 'SN-4711',
    })

    await elevatorsNamed(tenant)

    // The second line carries the serial number of the asset that is there, typed differently.
    const listed = table(
      assetImportFields,
      assetHeader,
      assetLine('Aufzug Neubau', { serial: 'SN-0815' }),
      assetLine('Aufzug Altbau Haus A', { serial: 'sn - 4711' }),
    )
    const shown = await assetsPreview(keeper, listed)

    expect(shown.duplicates).toEqual([
      {
        line: 3,
        name: 'Aufzug Altbau Haus A',
        same: 'Gleiche Seriennummer',
        of: [{ id: there['id'], number: there['number'], name: 'Aufzug Altbau' }],
        decision: null,
      },
    ])
    expect(shown.counts).toEqual({ assets: 1, skipped: 0, undecided: 1 })
    expect(shown.problems).toEqual([])

    // Without an answer nothing is taken over, the line that is no duplicate included.
    const before = await rowCounts()
    const waiting = await sendTable('/imports/assets', keeper, {
      ...listed,
      fileName: 'anlagen.csv',
      expected: shown.counts,
    }).expect(422)

    expect((waiting.body as Refusal).message).toBe(
      'Zu einer möglichen Dublette fehlt die Entscheidung. Es wurde nichts übernommen.',
    )
    expect(await rowCounts()).toEqual(before)

    // Left out because somebody said so: the asset is not made, and the import says that a line was left out.
    const decided = await assetsPreview(keeper, { ...listed, decisions: { 3: 'skip' } })

    expect(decided.duplicates.map((duplicate) => duplicate.decision)).toEqual(['skip'])
    expect(decided.counts).toEqual({ assets: 1, skipped: 1, undecided: 0 })

    const left = (
      await sendTable('/imports/assets', keeper, {
        ...listed,
        decisions: { 3: 'skip' },
        fileName: 'anlagen.csv',
        expected: decided.counts,
      }).expect(201)
    ).body as Taken

    expect(left.counts).toEqual({ assets: 1, skipped: 1, undecided: 0 })
    expect(left.summary).toBe('1 Anlage angelegt, 1 Zeile als Dublette nicht angelegt')
    expect((await assetsOf(tenant)).map((asset) => asset.name)).toEqual([
      'Aufzug Altbau',
      'Aufzug Neubau',
    ])

    const { rows: kept } = await admin.query<{ summary: string }>(
      'select summary from imports where id = $1',
      [left.id],
    )

    expect(kept).toEqual([{ summary: left.summary }])
  })

  it('acceptance 3, the other answer: a duplicate somebody takes all the same is made', async () => {
    const tenant = await tenantWith()
    const keeper = by('site_management', tenant)
    const place = await placeIn(tenant)

    await assetIn(tenant, place.building, { name: 'Aufzug Altbau', mark: 'AKS 461-01' })
    await elevatorsNamed(tenant)

    // The same mark as the asset that is there, and the line after it carries it once more.
    const listed = table(
      assetImportFields,
      assetHeader,
      assetLine('Aufzug Altbau Haus A', { mark: 'aks461-01' }),
      assetLine('Aufzug Altbau Haus B', { mark: 'AKS 461-01' }),
    )
    const shown = await assetsPreview(keeper, listed)

    expect(shown.duplicates.map((duplicate) => [duplicate.line, duplicate.same])).toEqual([
      [2, 'Gleiches Kennzeichen'],
      [3, 'Gleiches Kennzeichen'],
    ])
    // The second of them is also held against the line before it.
    expect(shown.duplicates[1]?.of).toContainEqual({ line: 2 })
    expect(shown.counts).toEqual({ assets: 0, skipped: 0, undecided: 2 })

    // One answer is not both.
    await sendTable('/imports/assets', keeper, {
      ...listed,
      decisions: { 2: 'take' },
      expected: { assets: 1, skipped: 0, undecided: 1 },
    }).expect(422)

    const taken = (
      await sendTable('/imports/assets', keeper, {
        ...listed,
        decisions: { 2: 'take', 3: 'take' },
        fileName: 'anlagen.csv',
        expected: { assets: 2, skipped: 0, undecided: 0 },
      }).expect(201)
    ).body as Taken

    expect(taken.summary).toBe('2 Anlagen angelegt')
    expect((await assetsOf(tenant)).map((asset) => asset.name)).toEqual([
      'Aufzug Altbau',
      'Aufzug Altbau Haus A',
      'Aufzug Altbau Haus B',
    ])
  })

  it('acceptance 4, "Wer nur einen Bereich sieht, importiert nicht in einen anderen": places go into no area but theirs, and a property beyond it is not found', async () => {
    const tenant = await tenantWith('Nord', 'Süd')
    const north = tenant.areas['Nord'] ?? ''
    const south = tenant.areas['Süd'] ?? ''
    const inSouth = await placeIn(tenant, {
      property: 'Werkhof Süd',
      building: 'Halle',
      areaId: south,
    })

    await placeIn(tenant, { property: 'Rathaus Nord', building: 'Altbau', areaId: north })

    const southBefore = await admin.query(
      'select version, updated_at from properties where id = $1',
      [inSouth.property],
    )
    const before = await rowCounts()

    // New properties into the area they do not hold in: said by the preview
    // already, and refused by the take-over.
    const fresh = table(structureFields, placeHeader, placeLine('Bauhof', 'Lager', 'EG', '0.01'))
    const intoSouth = {
      ...fresh,
      defaults: defaultsIn(south),
      fileName: 'bauhof.csv',
      expected: { properties: 1, buildings: 1, floors: 1, rooms: 1, known: 0 },
    }
    const sentence =
      'Den Bereich für neue Liegenschaften gibt es bei diesem Betreiber nicht, oder Sie sehen ihn nicht.'

    for (const path of ['/imports/structure/preview', '/imports/structure']) {
      const answer = await sendTable(path, narrow(tenant), intoSouth).expect(400)

      expect([path, (answer.body as Refusal).message]).toEqual([path, sentence])
    }

    // An area that is nobody's is refused in the same words.
    const nowhere = await sendTable('/imports/structure', narrow(tenant), {
      ...intoSouth,
      defaults: defaultsIn(newId<'area'>()),
    }).expect(400)

    expect((nowhere.body as Refusal).message).toBe(sentence)
    expect(await rowCounts()).toEqual(before)

    // Whoever holds in every area takes the same table over into the south.
    await sendTable('/imports/structure', by('technical_management', tenant), intoSouth).expect(201)

    // A line that names the property in the south does not find it for them:
    // what it makes is a property of that name in their own area, and the one
    // in the south gets nothing and stays as it was.
    const named = {
      ...table(structureFields, placeHeader, placeLine('Werkhof Süd', 'Lager', 'EG', '0.01')),
      defaults: defaultsIn(north),
    }
    const seen = await structurePreview(narrow(tenant), named)

    expect(seen.known).toEqual([])
    expect(seen.counts).toEqual({ properties: 1, buildings: 1, floors: 1, rooms: 1, known: 0 })

    // Whoever sees the south finds the property there, and would add to it.
    expect((await structurePreview(by('technical_management', tenant), named)).counts).toEqual({
      properties: 0,
      buildings: 1,
      floors: 1,
      rooms: 1,
      known: 0,
    })

    const taken = (
      await sendTable('/imports/structure', narrow(tenant), {
        ...named,
        fileName: 'werkhof.csv',
        expected: seen.counts,
      }).expect(201)
    ).body as Taken
    const { rows: written } = await admin.query<{ area_id: string; rows: number }>(
      `select area_id, count(*)::int as rows from (
         select area_id, created_at, tenant_id from properties
         union all select area_id, created_at, tenant_id from buildings
         union all select area_id, created_at, tenant_id from floors
         union all select area_id, created_at, tenant_id from rooms
       ) made
       where tenant_id = $1 and created_at >= (select created_at from imports where id = $2)
       group by area_id`,
      [tenant.id, taken.id],
    )

    expect(written).toEqual([{ area_id: north, rows: 4 }])
    expect(
      (
        await admin.query('select name from buildings where property_id = $1 order by name', [
          inSouth.property,
        ])
      ).rows,
    ).toEqual([{ name: 'Halle' }])
    expect(
      (
        await admin.query('select version, updated_at from properties where id = $1', [
          inSouth.property,
        ])
      ).rows,
    ).toEqual(southBefore.rows)
  })

  it('acceptance 4 for assets: a line that names a building in an area that is not theirs finds no such place, and an asset there is no duplicate for them', async () => {
    const tenant = await tenantWith('Nord', 'Süd')
    const site = by('site_management', tenant)

    await placeIn(tenant, {
      property: 'Werkhof Süd',
      building: 'Halle',
      areaId: tenant.areas['Süd'] ?? '',
    })
    await placeIn(tenant, {
      property: 'Rathaus Nord',
      building: 'Altbau',
      areaId: tenant.areas['Nord'] ?? '',
    })
    await elevatorsNamed(tenant)

    const listed = {
      ...table(
        assetImportFields,
        assetHeader,
        assetLine('Aufzug Halle', { property: 'Werkhof Süd', building: 'Halle', serial: 'SN-1' }),
      ),
      fileName: 'halle.csv',
      expected: { assets: 1, skipped: 0, undecided: 0 },
    }
    const before = await rowCounts()
    const shown = await assetsPreview(site, listed)

    expect(shown.problems).toEqual([
      {
        lines: [2],
        what: 'Die Liegenschaft „Werkhof Süd“ gibt es nicht',
        next: 'Liegenschaft anlegen oder die Datei berichtigen',
      },
    ])
    expect(shown.counts).toEqual({ assets: 0, skipped: 0, undecided: 0 })

    const refused = await sendTable('/imports/assets', site, listed).expect(422)

    expect((refused.body as Refusal).message).toBe(planHasProblems)
    expect(await rowCounts()).toEqual(before)

    // The same line is an asset for whoever sees the south.
    await sendTable('/imports/assets', by('technical_management', tenant), listed).expect(201)

    // And that asset is no duplicate for somebody who does not see it: a line
    // of theirs with its serial number is named to nobody but whoever sees both.
    const sameNumber = table(
      assetImportFields,
      assetHeader,
      assetLine('Aufzug Altbau', { property: 'Rathaus Nord', building: 'Altbau', serial: 'SN-1' }),
    )

    expect((await assetsPreview(site, sameNumber)).duplicates).toEqual([])
    expect(
      (await assetsPreview(by('technical_management', tenant), sameNumber)).duplicates,
    ).toHaveLength(1)
  })
})

describe('the rights to the import', () => {
  const csv = Buffer.from('Liegenschaft;Gebäude\nSchulzentrum;Schulhaus\n', 'utf8')

  it('leave the places to whoever keeps places, on every route of their import', async () => {
    const tenant = await tenantWith()
    const places = {
      ...table(structureFields, placeHeader, placeLine(school, 'Schulhaus')),
      defaults: defaultsIn(tenant.area),
    }

    for (const role of ['site_management', 'technician'] as const) {
      const header = by(role, tenant)
      const answers = [
        await sendFile('/imports/structure/table', header, csv, 'bestand.csv'),
        await sendTable('/imports/structure/preview', header, places),
        await sendTable('/imports/structure', header, {
          ...places,
          fileName: 'bestand.csv',
          expected: { properties: 1, buildings: 1, floors: 0, rooms: 0, known: 0 },
        }),
      ]

      expect(
        answers.map((answer) => [role, answer.status, (answer.body as Refusal).message]),
      ).toEqual(answers.map(() => [role, 403, missingRight('location.write')]))
    }

    expect(await stamped(tenant, 'properties')).toEqual({ rows: 0, stamped: 0 })

    // The Technische Leitung and the Leitung keep places.
    for (const role of ['technical_management', 'management'] as const) {
      await sendTable('/imports/structure/preview', by(role, tenant), places).expect(200)
    }
  })

  it('leave the assets and what a list calls their kinds to whoever keeps assets', async () => {
    const tenant = await tenantWith()

    await placeIn(tenant)
    await elevatorsNamed(tenant)

    const listed = table(assetImportFields, assetHeader, assetLine('Aufzug Nord'))
    const header = by('technician', tenant)
    const answers = [
      await sendFile('/imports/assets/table', header, csv, 'anlagen.csv'),
      await sendTable('/imports/assets/preview', header, listed),
      await sendTable('/imports/assets', header, {
        ...listed,
        fileName: 'anlagen.csv',
        expected: { assets: 1, skipped: 0, undecided: 0 },
      }),
      await http().get('/imports/asset-kinds').set(testIdentityHeader, header),
      await http()
        .put('/imports/asset-kinds')
        .set(testIdentityHeader, header)
        .send({ names: [{ name: 'Lift', kind: 'probe.elevator' }] }),
    ]

    expect(answers.map((answer) => [answer.status, (answer.body as Refusal).message])).toEqual(
      answers.map(() => [403, missingRight('asset.write')]),
    )
    expect(await assetsOf(tenant)).toEqual([])
    expect(
      (await admin.query('select name from asset_kind_names where tenant_id = $1', [tenant.id]))
        .rows,
    ).toEqual([{ name: 'Aufzug' }])

    // From the Objektleitung on, somebody keeps assets.
    for (const role of ['site_management', 'technical_management', 'management'] as const) {
      await sendTable('/imports/assets/preview', by(role, tenant), listed).expect(200)
    }
  })
})

describe('reading a file', () => {
  it('answers with the table in it, and keeps neither the file nor a word about it', async () => {
    const tenant = await tenantWith()
    const before = await rowCounts()
    const bytes = Buffer.from(
      'Liegenschaft;Gebäude;Raum-Nr.\nSchulzentrum Am Neckar;Schulhaus;E.14\n',
      'utf8',
    )

    for (const [path, role] of [
      ['/imports/structure/table', 'technical_management'],
      ['/imports/assets/table', 'site_management'],
    ] as const) {
      const answer = await sendFile(
        path,
        by(role, tenant),
        bytes,
        'Bestand Schulzentrum.csv',
      ).expect(200)

      expect(answer.body).toEqual({
        name: 'Bestand Schulzentrum.csv',
        sheets: [
          {
            name: '',
            rows: [
              ['Liegenschaft', 'Gebäude', 'Raum-Nr.'],
              ['Schulzentrum Am Neckar', 'Schulhaus', 'E.14'],
            ],
          },
        ],
      })
    }

    expect(await rowCounts()).toEqual(before)
  })

  it('takes bytes and nothing a form could send', async () => {
    const tenant = await tenantWith()

    for (const [path, role] of [
      ['/imports/structure/table', 'technical_management'],
      ['/imports/assets/table', 'site_management'],
    ] as const) {
      const answer = await http()
        .post(path)
        .set(testIdentityHeader, by(role, tenant))
        .send({ sheet: { name: '', rows: [['Liegenschaft']] } })
        .expect(415)

      expect((answer.body as Refusal).message).toBe(
        'Eine Tabelle wird als application/octet-stream geschickt, mit ihrem Namen im Kopf X-File-Name.',
      )
    }
  })

  it('says what to do with a file that is no table', async () => {
    const tenant = await tenantWith()
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x0d])
    const answer = await sendFile(
      '/imports/structure/table',
      by('technical_management', tenant),
      picture,
      'bestand.png',
    ).expect(422)

    expect((answer.body as Refusal).message).toMatch(/weder eine Arbeitsmappe \(\.xlsx\) noch/)
  })
})

describe('a preview', () => {
  it('writes nothing at all, whatever it would make', async () => {
    const tenant = await tenantWith()

    await placeIn(tenant)
    await elevatorsNamed(tenant)

    const before = await rowCounts()
    const seen = await structurePreview(by('technical_management', tenant), {
      ...table(structureFields, placeHeader, ...schoolLines()),
      defaults: defaultsIn(tenant.area),
    })

    // The school and its school house are there, with one room of the 48.
    expect(seen.lines).toBe(48)
    expect(seen.counts).toEqual({ properties: 0, buildings: 1, floors: 4, rooms: 48, known: 0 })

    const shown = await assetsPreview(
      by('site_management', tenant),
      table(assetImportFields, assetHeader, assetLine('Aufzug Nord'), assetLine('Aufzug Süd')),
    )

    expect(shown.lines).toBe(2)
    expect(shown.counts).toEqual({ assets: 2, skipped: 0, undecided: 0 })
    expect(await rowCounts()).toEqual(before)
  })

  it('names what is there already, with the lines and where its page is', async () => {
    const tenant = await tenantWith()
    const place = await placeIn(tenant)
    const seen = await structurePreview(by('technical_management', tenant), {
      ...table(
        structureFields,
        placeHeader,
        placeLine(school, 'Schulhaus', 'Erdgeschoss', 'e.14'),
        placeLine(school, 'Schulhaus', 'Erdgeschoss', 'E.15'),
        placeLine('schulzentrum am neckar', 'SCHULHAUS'),
      ),
      defaults: defaultsIn(tenant.area),
    })

    expect(seen.counts).toEqual({ properties: 0, buildings: 0, floors: 0, rooms: 1, known: 2 })
    expect(seen.known).toEqual([
      {
        lines: [2],
        inFile: `${school}, Schulhaus, Erdgeschoss, E.14`,
        existing: 'Raum E.14',
        table: 'rooms',
        id: place.room,
      },
      {
        lines: [4],
        inFile: `${school}, Schulhaus`,
        existing: 'Schulhaus',
        table: 'buildings',
        id: place.building,
      },
    ])
    expect([seen.moreKnown, seen.moreProblems]).toEqual([0, 0])
  })

  it('is refused, as the take-over is, for what is no table with a choice of its columns', async () => {
    const tenant = await tenantWith()
    const sheet: TableSheet = {
      name: '',
      rows: [
        ['Liegenschaft', 'Gebäude'],
        [school, 'Schulhaus'],
      ],
    }
    const wrong: readonly (readonly [body: object, sentence: string])[] = [
      [
        { sheet: 'Liegenschaft;Gebäude', mapping: { property: 0 } },
        'Die Tabelle steht als Blatt mit einem Namen und Zeilen aus Zellen.',
      ],
      [
        { sheet, mapping: { property: 0, owner: 1 } },
        'Das Feld owner gibt es in dieser Tabelle nicht.',
      ],
      [
        { sheet, mapping: { property: 7 } },
        'Die Spalte für „Liegenschaft“ gibt es in der Datei nicht.',
      ],
      [{ sheet, mapping: { building: 1 } }, 'Für „Liegenschaft“ ist keine Spalte gewählt.'],
    ]
    const before = await rowCounts()

    for (const [path, role] of [
      ['/imports/structure/preview', 'technical_management'],
      ['/imports/structure', 'technical_management'],
      ['/imports/assets/preview', 'site_management'],
      ['/imports/assets', 'site_management'],
    ] as const) {
      for (const [body, sentence] of wrong) {
        const answer = await sendTable(path, by(role, tenant), body).expect(400)

        expect([path, (answer.body as Refusal).message]).toEqual([path, sentence])
      }

      // And under the type of every other route it is not read at all.
      const typed = await http()
        .post(path)
        .set(testIdentityHeader, by(role, tenant))
        .send({ sheet, mapping: { property: 0 } })
        .expect(415)

      expect((typed.body as Refusal).message).toBe(
        'Eine Tabelle mit ihrer Zuordnung wird als application/x.table+json geschickt.',
      )
    }

    // The assets need four columns, and say which is missing first.
    const missing = await sendTable('/imports/assets/preview', by('site_management', tenant), {
      sheet,
      mapping: { property: 0, building: 1 },
    }).expect(400)

    expect((missing.body as Refusal).message).toBe('Für „Anlagenart“ ist keine Spalte gewählt.')
    expect(await rowCounts()).toEqual(before)
  })
})

describe('taking a table over', () => {
  it('is refused when the stock is no longer what the preview counted, and writes nothing', async () => {
    const tenant = await tenantWith()
    const keeper = by('technical_management', tenant)
    const places = {
      ...table(structureFields, placeHeader, placeLine(school, 'Schulhaus', 'EG', 'E.01')),
      defaults: defaultsIn(tenant.area),
    }
    const seen = await structurePreview(keeper, places)

    expect(seen.counts).toEqual({ properties: 1, buildings: 1, floors: 1, rooms: 1, known: 0 })

    // Between the preview and the press somebody types the school in.
    const place = await placeIn(tenant)
    const before = await rowCounts()
    const late = await sendTable('/imports/structure', keeper, {
      ...places,
      fileName: 'bestand.csv',
      expected: seen.counts,
    }).expect(409)

    expect((late.body as Refusal).message).toBe(planChanged)
    expect(await rowCounts()).toEqual(before)

    // The assets: a line was left out as the duplicate of an asset that is gone by the press.
    const there = await assetIn(tenant, place.building, {
      name: 'Aufzug Altbau',
      serialNumber: 'SN-1',
    })

    await elevatorsNamed(tenant)

    const listed = {
      ...table(
        assetImportFields,
        assetHeader,
        assetLine('Aufzug Neubau', { serial: 'SN-2' }),
        assetLine('Aufzug Altbau', { serial: 'SN-1' }),
      ),
      decisions: { 3: 'skip' },
    }
    const shown = await assetsPreview(by('site_management', tenant), listed)

    expect(shown.counts).toEqual({ assets: 1, skipped: 1, undecided: 0 })

    await http()
      .delete(`/assets/${String(there['id'])}`)
      .set(testIdentityHeader, keeper)
      .expect(200)

    const counts = await rowCounts()
    const stale = await sendTable('/imports/assets', by('site_management', tenant), {
      ...listed,
      fileName: 'anlagen.csv',
      expected: shown.counts,
    }).expect(409)

    expect((stale.body as Refusal).message).toBe(planChanged)
    expect(await rowCounts()).toEqual(counts)

    // Without what the preview counted nothing is taken over either.
    await sendTable('/imports/assets', by('site_management', tenant), listed).expect(409)
    expect(await rowCounts()).toEqual(counts)
  })

  it('is refused for a table that makes nothing', async () => {
    const tenant = await tenantWith()
    const keeper = by('technical_management', tenant)
    const place = await placeIn(tenant)
    const places = {
      ...table(structureFields, placeHeader, placeLine(school, 'Schulhaus', 'Erdgeschoss', 'E.14')),
      defaults: defaultsIn(tenant.area),
    }
    const before = await rowCounts()
    const known = await sendTable('/imports/structure', keeper, {
      ...places,
      fileName: 'bestand.csv',
      expected: { properties: 0, buildings: 0, floors: 0, rooms: 0, known: 1 },
    }).expect(422)

    expect((known.body as Refusal).message).toBe(planMakesNothing)
    expect(await rowCounts()).toEqual(before)

    // Assets of which every line was left out as a duplicate.
    await assetIn(tenant, place.building, { name: 'Aufzug Altbau', serialNumber: 'SN-1' })
    await elevatorsNamed(tenant)

    const counts = await rowCounts()
    const nothing = await sendTable('/imports/assets', by('site_management', tenant), {
      ...table(assetImportFields, assetHeader, assetLine('Aufzug Altbau', { serial: 'SN-1' })),
      decisions: { 2: 'skip' },
      fileName: 'anlagen.csv',
      expected: { assets: 0, skipped: 1, undecided: 0 },
    }).expect(422)

    expect((nothing.body as Refusal).message).toBe(planMakesNothing)
    expect(await rowCounts()).toEqual(counts)
  })

  it('writes all of it or none: an import that fails on its last record leaves no place, no row and no entry', async () => {
    const tenant = await tenantWith()
    const keeper = by('technical_management', tenant)

    // A database that refuses one room, which no rule of the model would: the
    // rows before it are written by then, the row of the import first of all.
    await admin.query(
      `create function refuse_for_the_test() returns trigger language plpgsql as
       $$ begin raise exception 'refused for the test'; end $$`,
    )
    await admin.query(
      `create trigger refuse_for_the_test before insert on rooms
       for each row when (new.number = 'E.99') execute function refuse_for_the_test()`,
    )
    await admin.query(
      `create trigger refuse_for_the_test before insert on assets
       for each row when (new.name = 'Aufzug Bruch') execute function refuse_for_the_test()`,
    )

    try {
      const before = await rowCounts()

      await sendTable('/imports/structure', keeper, {
        ...table(
          structureFields,
          placeHeader,
          placeLine(school, 'Schulhaus', 'EG', 'E.01'),
          placeLine(school, 'Schulhaus', 'EG', 'E.99'),
        ),
        defaults: defaultsIn(tenant.area),
        fileName: 'bestand.csv',
        expected: { properties: 1, buildings: 1, floors: 1, rooms: 2, known: 0 },
      }).expect(500)

      expect(await rowCounts()).toEqual(before)

      // The assets: the numbers drawn for them go back with everything else,
      // and the next asset gets the number after the last one that is there.
      const place = await placeIn(tenant)
      const first = await assetIn(tenant, place.building, { name: 'Aufzug Altbau' })

      await elevatorsNamed(tenant)

      const counts = await rowCounts()

      await sendTable('/imports/assets', by('site_management', tenant), {
        ...table(
          assetImportFields,
          assetHeader,
          assetLine('Aufzug Nord'),
          assetLine('Aufzug Süd'),
          assetLine('Aufzug Bruch'),
        ),
        fileName: 'anlagen.csv',
        expected: { assets: 3, skipped: 0, undecided: 0 },
      }).expect(500)

      expect(await rowCounts()).toEqual(counts)

      const next = await assetIn(tenant, place.building, { name: 'Aufzug Neubau' })

      expect([first['number'], next['number']]).toEqual(['AN-00001', 'AN-00002'])
    } finally {
      await admin.query('drop trigger refuse_for_the_test on rooms')
      await admin.query('drop trigger refuse_for_the_test on assets')
      await admin.query('drop function refuse_for_the_test()')
    }
  })

  it('keeps the name of the file as the log shows it, and calls a table without one what it is', async () => {
    const tenant = await tenantWith()
    const keeper = by('technical_management', tenant)
    const places = (property: string) => ({
      ...table(structureFields, placeHeader, placeLine(property)),
      defaults: defaultsIn(tenant.area),
      expected: { properties: 1, buildings: 0, floors: 0, rooms: 0, known: 0 },
    })

    await sendTable('/imports/structure', keeper, places('Rathaus')).expect(201)
    await sendTable('/imports/structure', keeper, {
      ...places('Bauhof'),
      fileName: `  ${'Liegenschaften '.repeat(20)}.csv`,
    }).expect(201)
    await sendTable('/imports/structure', keeper, { ...places('Werkhof'), fileName: 4711 }).expect(
      201,
    )
    // A name that is cut where a space stands: what is kept ends with its last letter.
    await sendTable('/imports/structure', keeper, {
      ...places('Klärwerk'),
      fileName: `${'a'.repeat(importLimits.fileName - 1)} b.csv`,
    }).expect(201)

    const { rows } = await admin.query<{ file_name: string; summary: string }>(
      'select file_name, summary from imports where tenant_id = $1 order by created_at, id',
      [tenant.id],
    )

    expect(rows.map((row) => row.summary)).toEqual([
      '1 Liegenschaft angelegt',
      '1 Liegenschaft angelegt',
      '1 Liegenschaft angelegt',
      '1 Liegenschaft angelegt',
    ])
    expect(rows.map((row) => row.file_name)).toEqual([
      'Tabelle ohne Namen',
      'Liegenschaften '.repeat(20).slice(0, importLimits.fileName),
      'Tabelle ohne Namen',
      'a'.repeat(importLimits.fileName - 1),
    ])
    expect(rows[1]?.file_name).toHaveLength(importLimits.fileName)
  })
})

describe('the assets of an import', () => {
  it('get their numbers in the order of the lines, after the last number of the tenant', async () => {
    const tenant = await tenantWith()
    const place = await placeIn(tenant)
    const first = await assetIn(tenant, place.building, { name: 'Aufzug Altbau' })

    await elevatorsNamed(tenant)

    expect(first['number']).toBe('AN-00001')

    // Not in the order of their names, so that the order of the lines is what shows.
    await sendTable('/imports/assets', by('site_management', tenant), {
      ...table(
        assetImportFields,
        assetHeader,
        assetLine('Aufzug Süd'),
        assetLine('Aufzug Nord'),
        assetLine('Aufzug West'),
        assetLine('Aufzug Ost'),
      ),
      fileName: 'anlagen.csv',
      expected: { assets: 4, skipped: 0, undecided: 0 },
    }).expect(201)

    expect((await assetsOf(tenant)).map((asset) => [asset.number, asset.name])).toEqual([
      ['AN-00001', 'Aufzug Altbau'],
      ['AN-00002', 'Aufzug Süd'],
      ['AN-00003', 'Aufzug Nord'],
      ['AN-00004', 'Aufzug West'],
      ['AN-00005', 'Aufzug Ost'],
    ])

    // An import that is refused draws none: the next asset gets the next number.
    await sendTable('/imports/assets', by('site_management', tenant), {
      ...table(assetImportFields, assetHeader, assetLine('Aufzug Hof', { building: 'Turnhalle' })),
      fileName: 'anlagen.csv',
      expected: { assets: 0, skipped: 0, undecided: 0 },
    }).expect(422)

    expect((await assetIn(tenant, place.building, { name: 'Aufzug Neubau' }))['number']).toBe(
      'AN-00006',
    )
  })

  it('stand where their line says, with what the line says about them', async () => {
    const tenant = await tenantWith()
    const place = await placeIn(tenant)

    await elevatorsNamed(tenant)

    const listed = table(
      assetImportFields,
      [...assetHeader, 'Hersteller', 'Typ', 'Baujahr', 'Inbetriebnahme', 'Gewährleistung bis'],
      [
        ...assetLine('Aufzug Nord', { room: 'e.14', serial: 'SN-1', mark: 'AKS 461-01' }),
        'Schindler',
        '3300',
        '2019',
        '02.10.2019',
        '2024-10-01',
      ],
      [...assetLine('Aufzug Süd'), '', '', '', '', ''],
    )

    await sendTable('/imports/assets', by('site_management', tenant), {
      ...listed,
      fileName: 'anlagen.csv',
      expected: { assets: 2, skipped: 0, undecided: 0 },
    }).expect(201)

    const { rows } = await admin.query(
      `select name, kind, property_id, area_id, building_id, room_id, parent_asset_id, mark,
              manufacturer, model, serial_number, year_built, commissioned_on::text,
              warranty_ends_on::text, "values"
         from assets where tenant_id = $1 order by number`,
      [tenant.id],
    )

    expect(rows).toEqual([
      {
        name: 'Aufzug Nord',
        kind: 'probe.elevator',
        property_id: place.property,
        area_id: tenant.area,
        building_id: place.building,
        room_id: place.room,
        parent_asset_id: null,
        mark: 'AKS 461-01',
        manufacturer: 'Schindler',
        model: '3300',
        serial_number: 'SN-1',
        year_built: 2019,
        commissioned_on: '2019-10-02',
        warranty_ends_on: '2024-10-01',
        values: {},
      },
      {
        name: 'Aufzug Süd',
        kind: 'probe.elevator',
        property_id: place.property,
        area_id: tenant.area,
        building_id: place.building,
        room_id: null,
        parent_asset_id: null,
        mark: null,
        manufacturer: null,
        model: null,
        serial_number: null,
        year_built: null,
        commissioned_on: null,
        warranty_ends_on: null,
        values: {},
      },
    ])
  })
})

describe('what the lists of a tenant call the asset kinds', () => {
  interface Names {
    readonly names: readonly { name: string; kind: string }[]
  }

  function keep(tenant: Tenant, names: unknown) {
    return http()
      .put('/imports/asset-kinds')
      .set(testIdentityHeader, by('site_management', tenant))
      .send({ names } as object)
  }

  async function keptBy(tenant: Tenant): Promise<Names['names']> {
    return (
      (
        await http()
          .get('/imports/asset-kinds')
          .set(testIdentityHeader, by('site_management', tenant))
          .expect(200)
      ).body as Names
    ).names
  }

  it('is kept once, read back by name, and belongs to the tenant that said it', async () => {
    const tenant = await tenantWith()
    const nextDoor = await tenantWith()

    expect(await keptBy(tenant)).toEqual([])

    const answer = await keep(tenant, [
      { name: 'WW-Speicher', kind: 'probe.water_meter' },
      { name: '  Aufzug ', kind: 'probe.elevator' },
    ]).expect(200)

    expect((answer.body as Names).names).toEqual([
      { name: 'Aufzug', kind: 'probe.elevator' },
      { name: 'WW-Speicher', kind: 'probe.water_meter' },
    ])
    expect(await keptBy(tenant)).toEqual((answer.body as Names).names)
    expect(await keptBy(nextDoor)).toEqual([])
  })

  it('corrects a word that is saved again, however it is written, and leaves the others', async () => {
    const tenant = await tenantWith()

    await keep(tenant, [
      { name: 'WW-Speicher', kind: 'probe.water_meter' },
      { name: 'Aufzug', kind: 'probe.elevator' },
    ]).expect(200)

    const corrected = await keep(tenant, [{ name: 'ww speicher', kind: 'probe.elevator' }]).expect(
      200,
    )

    // One row for the word, as it was first written, with the kind it means now.
    expect((corrected.body as Names).names).toEqual([
      { name: 'Aufzug', kind: 'probe.elevator' },
      { name: 'WW-Speicher', kind: 'probe.elevator' },
    ])

    const { rows } = await admin.query(
      'select name, name_key, kind from asset_kind_names where tenant_id = $1 order by name',
      [tenant.id],
    )

    expect(rows).toEqual([
      { name: 'Aufzug', name_key: 'aufzug', kind: 'probe.elevator' },
      { name: 'WW-Speicher', name_key: 'wwspeicher', kind: 'probe.elevator' },
    ])

    // A word named twice in one request is one word: the last of them counts.
    await keep(tenant, [
      { name: 'Lift', kind: 'probe.water_meter' },
      { name: 'LIFT', kind: 'probe.elevator' },
    ]).expect(200)

    expect(await keptBy(tenant)).toContainEqual({ name: 'LIFT', kind: 'probe.elevator' })
    expect(await keptBy(tenant)).toHaveLength(3)
  })

  it('is refused for a kind no package of the catalogue knows, and for what is no list of words', async () => {
    const tenant = await tenantWith()
    const wrong: readonly (readonly [names: unknown, sentence: string])[] = [
      [
        [{ name: 'Aufzug', kind: 'probe.escalator' }],
        'Die Anlagenart für „Aufzug“ kennt kein Paket des Katalogs.',
      ],
      ['Aufzug', 'Die Zuordnung steht als Liste von Bezeichnungen mit ihrer Anlagenart.'],
      [
        [{ name: ' - ', kind: 'probe.elevator' }],
        'Eine Bezeichnung ist ein Text mit höchstens 120 Zeichen, der nicht leer ist.',
      ],
    ]

    for (const [names, sentence] of wrong) {
      expect(((await keep(tenant, names).expect(400)).body as Refusal).message).toBe(sentence)
    }

    expect(await keptBy(tenant)).toEqual([])
  })

  it('gives the assets of an import their kind, and leaves a word nobody gave one to the step that does', async () => {
    const tenant = await tenantWith()

    await placeIn(tenant)
    await keep(tenant, [
      { name: 'Personenaufzug', kind: 'probe.elevator' },
      { name: 'Wasseruhr', kind: 'probe.water_meter' },
    ]).expect(200)

    const header = [...assetHeader, 'Zählernummer', 'Einheit']
    const listed = table(
      assetImportFields,
      header,
      [...assetLine('Aufzug Nord', { kind: 'personen-aufzug' }), '', ''],
      [...assetLine('Zähler Keller', { kind: 'WASSERUHR' }), 'WZ-0042', 'm³'],
    )
    const keeper = by('site_management', tenant)

    expect((await assetsPreview(keeper, listed)).problems).toEqual([])

    await sendTable('/imports/assets', keeper, {
      ...listed,
      fileName: 'anlagen.csv',
      expected: { assets: 2, skipped: 0, undecided: 0 },
    }).expect(201)

    expect((await assetsOf(tenant)).map((asset) => [asset.name, asset.kind])).toEqual([
      ['Aufzug Nord', 'probe.elevator'],
      ['Zähler Keller', 'probe.water_meter'],
    ])

    // A word that was given no kind is a problem of its lines, and nothing is guessed.
    const unknown = await assetsPreview(
      keeper,
      table(assetImportFields, header, [
        ...assetLine('Rolltreppe Foyer', { kind: 'Fahrtreppe' }),
        '',
        '',
      ]),
    )

    expect(unknown.problems).toEqual([
      {
        lines: [2],
        what: 'Die Anlagenart „Fahrtreppe“ ist keiner Anlagenart des Katalogs zugeordnet',
        next: 'Im Schritt „Anlagenarten“ zuordnen',
      },
    ])
    expect(unknown.counts).toEqual({ assets: 0, skipped: 0, undecided: 0 })
  })
})
