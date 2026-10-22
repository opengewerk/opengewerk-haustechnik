import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type AssetDetails,
  type AssetRegister,
  catalogueOf,
  rightsOfRoles,
  type DutyReading,
  type IsoDate,
  type Right,
  type RoleKey,
  shutDownLabel,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId, type PrintJob } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * A defect of a class that makes an asset unsafe puts its asset out of
 * service (#345, section 4.6 of the concept, decision 29 of phase 2): in the
 * file and the register of the asset, until the defect is remedied, while its
 * duties go on and no entry of its life cycle takes it back; and the report
 * of the defects as a PDF, made for the moment it is asked for, with the
 * defects of the areas of the person and nothing beyond.
 */

const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
})

const small = newId<'tenant'>() as TenantId
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

type Person = keyof typeof people & string

/** What the renderer was handed, newest last. */
const rendered: PrintJob[] = []

let admin: Pool
let database: Database
let app: INestApplication
let folder = ''

const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)

function http() {
  return request(app.getHttpServer())
}

function by(userId: Person, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** A header for the technician with exactly these rights: one that carries rights is taken at its word. */
function holding(...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId: small, roles: ['technician'], rights })
}

/** An elevator in a room of a building of a property of its own, made by the Technische Leitung. */
async function elevatorIn(
  tenantId: TenantId = small,
  area: string | null = null,
  name = 'Bürgerhaus',
) {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: `${name} Mitte`,
    street: 'Hauptstraße 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...(area === null ? {} : { areaId: area }),
  })
  const building = await made(`/properties/${property}/buildings`, { name, kinds: ['assembly'] })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
  const room = await made(`/floors/${floor}/rooms`, { number: 'E.01', name: 'Saal' })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
    roomId: room,
  })

  return { property, building, room, asset }
}

/** A defect at an asset, reported and then given a class by the Leitung. */
async function defectAt(
  asset: string,
  defectClass: string | null,
  description = 'Fangvorrichtung greift nicht',
  tenantId: TenantId = small,
): Promise<string> {
  const header = by('u-lead', tenantId)
  const id = (
    await http()
      .post('/defects')
      .set(testIdentityHeader, header)
      .send({ assetId: asset, description, foundOn: daysAgo(2) })
      .expect(201)
  ).body.id as string

  if (defectClass !== null) {
    await http()
      .patch(`/defects/${id}`)
      .set(testIdentityHeader, header)
      .send({ defectClass })
      .expect(200)
  }

  return id
}

/** Sets a defect to a status as a work order would (#117), behind the routes. */
async function standing(defect: string, status: string): Promise<void> {
  await admin.query('update defects set status = $2::defect_status where id = $1', [defect, status])
}

async function fileOf(asset: string, header: string = by('u-tech')): Promise<AssetDetails> {
  return (await http().get(`/assets/${asset}`).set(testIdentityHeader, header).expect(200)).body
}

/** The row of the register of an asset of a building. */
async function rowOf(building: string, asset: string) {
  const register = (
    await http()
      .get('/assets')
      .query({ buildingId: building })
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)
  ).body as AssetRegister

  return register.assets.find((entry) => entry.id === asset)
}

/** A duty of the operator's own at an asset, of a year, put in past the application. */
async function dutyAt(asset: string): Promise<void> {
  await admin.query(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     select tenant_id, property_id, area_id, id, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-duties'
       from assets where id = $1`,
    [asset],
  )
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A JPEG by its first bytes, with a tail no other file has. */
function jpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
    randomBytes(32),
  ])
}

/** A PDF by its first bytes. */
function pdfFile(): Buffer {
  return Buffer.from(`%PDF-1.7\n% Bericht ${randomBytes(12).toString('hex')}\n%%EOF\n`, 'utf8')
}

/** Sends the bytes of a file ahead of its version, as a device does. */
async function stored(bytes: Buffer, header: string, declared: string): Promise<void> {
  await http()
    .put(`/files/${hashOf(bytes)}`)
    .set('content-type', 'application/octet-stream')
    .set('x-media-type', declared)
    .set(testIdentityHeader, header)
    .send(bytes)
    .expect(200)
}

let recorded = Date.parse('2026-10-06T08:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(entity: string, recordId: string, values: Readonly<Record<string, unknown>>) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind: 'create',
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

/** A document at a defect with one version, filed as a device files one, with its preview where it has one. */
async function filedAt(
  property: string,
  defect: string,
  file: { bytes: Buffer; mediaType: string; preview?: Buffer },
): Promise<void> {
  const header = by('u-tech')
  const document = newId<'attachment'>()

  await stored(file.bytes, header, file.mediaType)

  if (file.preview !== undefined) {
    await stored(file.preview, header, 'image/jpeg')
  }

  const answer = await http()
    .post('/sync')
    .set(testIdentityHeader, header)
    .send({
      deviceId: 'phone',
      operations: [
        operation('attachments', document, {
          title: 'Foto des Mangels',
          propertyId: property,
          defectId: defect,
        }),
        operation('attachment_versions', newId<'attachment-version'>(), {
          attachmentId: document,
          sha256: hashOf(file.bytes),
          fileName: file.mediaType === 'application/pdf' ? 'bericht.pdf' : 'foto.jpg',
          mediaType: file.mediaType,
          sizeBytes: file.bytes.byteLength,
          previewSha256: file.preview === undefined ? null : hashOf(file.preview),
        }),
      ],
    })
    .expect(201)

  expect((answer.body.receipts as { outcome: string }[]).map((receipt) => receipt.outcome)).toEqual(
    ['applied', 'applied'],
  )
}

/** The report as somebody asks for it, and the page the renderer was handed for it. */
async function reportOf(query: Readonly<Record<string, string>>, header: string = by('u-lead')) {
  const before = rendered.length
  const answer = await http()
    .get('/defects/report/pdf')
    .query(query)
    .set(testIdentityHeader, header)

  return {
    status: answer.status,
    type: String(answer.headers['content-type'] ?? ''),
    job: rendered.length > before ? rendered.at(-1) : undefined,
  }
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
  ])

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
      ])
    }
  }

  // In the large operator the technician works in the north alone.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-tech',
    north,
  ])

  folder = mkdtempSync(join(tmpdir(), 'haustechnik-shut-down-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        files: new FileStore(folder),
        renderer: async (job) => {
          rendered.push(job)

          return new TextEncoder().encode('%PDF-1.7\n%%EOF\n')
        },
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('a defect that makes its asset unsafe', () => {
  it('puts its asset out of service in its file and its register until it is remedied, and one of another class does not', async () => {
    const { asset, building } = await elevatorIn()

    await defectAt(asset, 'allgemein.significant', 'Kabine hält nicht bündig')
    expect((await fileOf(asset)).shutDown).toBe(false)
    expect((await rowOf(building, asset))?.shutDown).toBe(false)

    const dangerous = await defectAt(asset, 'allgemein.dangerous')
    const file = await fileOf(asset)

    expect({ shutDown: file.shutDown, shutDownBy: file.shutDownBy }).toEqual({
      shutDown: true,
      shutDownBy: [
        {
          id: dangerous,
          description: 'Fangvorrichtung greift nicht',
          defectClass: 'allgemein.dangerous',
          foundOn: daysAgo(2),
          dueOn: null,
        },
      ],
    })
    expect((await rowOf(building, asset))?.shutDown).toBe(true)

    const table = await http()
      .get('/assets/table')
      .query({ buildingId: building, format: 'csv' })
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)

    expect(table.text).toContain(shutDownLabel)

    // Ordered it still waits to be set right; remedied, the asset runs again.
    await standing(dangerous, 'ordered')
    expect((await fileOf(asset)).shutDown).toBe(true)
    await standing(dangerous, 'remedied')
    expect((await fileOf(asset)).shutDown).toBe(false)
    expect((await rowOf(building, asset))?.shutDown).toBe(false)
  })

  it('leaves its duties running and its life cycle as it is, and no entry takes it back', async () => {
    const { asset } = await elevatorIn()

    await dutyAt(asset)
    await defectAt(asset, 'allgemein.dangerous')

    const duties = (
      await http().get(`/assets/${asset}/duties`).set(testIdentityHeader, by('u-tech')).expect(200)
    ).body as DutyReading[]

    expect(duties.map((duty) => duty.state)).toEqual(['never_recorded'])

    await http()
      .post(`/assets/${asset}/lifecycle`)
      .set(testIdentityHeader, by('u-site'))
      .send({ state: 'in_service', validFrom: daysAgo(30) })
      .expect(201)

    const file = await fileOf(asset)

    expect({
      lifecycleState: file.lifecycleState,
      shutDown: file.shutDown,
      condition: file.condition,
    }).toEqual({ lifecycleState: 'in_service', shutDown: true, condition: 'defect_open' })
  })

  it('puts a component out of service and not the asset it is one of, whose file says it at the component', async () => {
    const { asset } = await elevatorIn()
    const drive = (
      await http()
        .post(`/assets/${asset}/components`)
        .set(testIdentityHeader, by('u-tech'))
        .send({ kind: 'probe.elevator', name: 'Antrieb' })
        .expect(201)
    ).body as { id: string }

    await defectAt(drive.id, 'allgemein.dangerous', 'Bremse hält nicht')

    const file = await fileOf(asset)

    expect(file.shutDown).toBe(false)
    expect(file.components.map(({ id, shutDown }) => ({ id, shutDown }))).toEqual([
      { id: drive.id, shutDown: true },
    ])
    expect((await fileOf(drive.id)).shutDown).toBe(true)
  })

  it('tells whoever reads the asset and not the defects the state, and not what is wrong', async () => {
    const { asset } = await elevatorIn()

    await defectAt(asset, 'allgemein.dangerous')

    const file = await fileOf(asset, holding('location.read', 'asset.read'))

    expect({ shutDown: file.shutDown, shutDownBy: file.shutDownBy }).toEqual({
      shutDown: true,
      shutDownBy: null,
    })
  })
})

describe('out of service on the device of whoever does not see the defects (#520)', () => {
  /** What a full pull hands the device of a person with these rights, by entity. */
  async function pulled(header: string): Promise<Record<string, Record<string, unknown>[]>> {
    const answer = await http().get('/sync?since=0').set(testIdentityHeader, header).expect(200)

    return Object.fromEntries(
      (answer.body.changes as { entity: string; rows: Record<string, unknown>[] }[]).map(
        (change) => [change.entity, change.rows],
      ),
    )
  }

  it('holds the defects that put an asset out of service, by the state alone, and lets one go once it is remedied', async () => {
    const { asset } = await elevatorIn(small, null, 'Gemeindesaal')
    const dangerous = await defectAt(asset, 'allgemein.dangerous', 'Tragseil angerissen')
    const significant = await defectAt(asset, 'allgemein.significant', 'Kabine hält nicht bündig')
    // The Leitung, who sees every area, as a role of the operator's own without "Mängel ansehen".
    const header = JSON.stringify({
      userId: 'u-lead',
      tenantId: small,
      roles: ['management'],
      rights: [...rightsOfRoles(['management'])].filter((right) => right !== 'defect.read'),
    })
    const held = (await pulled(header))['defects'] ?? []

    expect(held.map((row) => row['id'])).toContain(dangerous)
    expect(held.map((row) => row['id'])).not.toContain(significant)

    // What the state needs and nothing of the defect itself.
    for (const row of held) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'assetId',
          'changeSequence',
          'defectClass',
          'deletedAt',
          'id',
          'status',
          'tenantId',
          'version',
        ].sort(),
      )
    }

    expect(JSON.stringify(held)).not.toContain('Tragseil angerissen')

    // Set right: it leaves the device, which a changed value of the defects tells it.
    const { body: before } = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, header)
      .expect(200)

    await standing(dangerous, 'remedied')

    const { body: after } = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, header)
      .expect(200)
    const valueOf = (body: { narrowed?: Record<string, string> }) => body.narrowed?.['defects']

    expect(((await pulled(header))['defects'] ?? []).map((row) => row['id'])).not.toContain(
      dangerous,
    )
    expect(valueOf(after)).toMatch(/shut-down:/)
    expect(valueOf(after)).not.toBe(valueOf(before))
  })

  it('holds the whole defect for whoever sees the defects, as before', async () => {
    const { asset } = await elevatorIn(small, null, 'Musikschule')
    const dangerous = await defectAt(asset, 'allgemein.dangerous', 'Notruf ohne Funktion')
    const held = (await pulled(by('u-lead')))['defects'] ?? []

    expect(held.find((row) => row['id'] === dangerous)).toMatchObject({
      description: 'Notruf ohne Funktion',
    })
  })
})

describe('the report of the defects', () => {
  it('prints what the list passes, with the day and the hour, the class, the mark of an unsafe one and the first photo', async () => {
    const { asset, building, property } = await elevatorIn(small, null, 'Rathaus')
    const unsafe = await defectAt(asset, 'allgemein.dangerous', 'Tragseil angerissen')
    const minor = await defectAt(asset, 'allgemein.minor', 'Taster abgegriffen')
    const preview = jpeg()

    await filedAt(property, unsafe, { bytes: jpeg(), mediaType: 'image/jpeg', preview })
    // A document that is no picture is no photo of the report.
    await filedAt(property, minor, { bytes: pdfFile(), mediaType: 'application/pdf' })

    // One of another building of the property, which the filter leaves out.
    const other = (
      await http()
        .post(`/properties/${property}/buildings`)
        .set(testIdentityHeader, by('u-duties'))
        .send({ name: 'Anbau', kinds: ['office'] })
        .expect(201)
    ).body.id as string
    const elsewhere = (
      await http()
        .post(`/buildings/${other}/assets`)
        .set(testIdentityHeader, by('u-duties'))
        .send({ kind: 'probe.elevator', name: 'Lastenaufzug' })
        .expect(201)
    ).body.id as string

    await defectAt(elsewhere, 'allgemein.minor', 'Im Anbau')

    const report = await reportOf({ buildingId: building })

    expect({ status: report.status, type: report.type }).toEqual({
      status: 200,
      type: expect.stringContaining('application/pdf') as unknown,
    })

    const html = report.job?.html ?? ''

    expect(report.job?.landscape).toBe(true)
    expect(html).toContain('Mängelbericht')
    expect(html).toMatch(/Stand \d\d\.\d\d\.\d{4}, \d\d:\d\d Uhr/)
    expect(html).toContain('Offen, Gebäude Rathaus, alle Klassen.')
    expect(html).toContain('2 Mängel; 1 setzt seine Anlage außer Betrieb.')
    expect(html).toContain('Tragseil angerissen')
    expect(html).toContain('Taster abgegriffen')
    expect(html).not.toContain('Im Anbau')
    expect(html).toContain('gefährlich<div><span class="mark">Anlage außer Betrieb</span>')
    expect(html).toContain(`data:image/jpeg;base64,${preview.toString('base64')}`)
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('Kein Foto')
    expect(report.job?.footerHtml).toMatch(/Erzeugt am \d\d\.\d\d\.\d{4} um \d\d:\d\d Uhr/)
  })

  it('holds only the defects of the areas of the person', async () => {
    const inNorth = await elevatorIn(large, north, 'Nordhaus')
    const inSouth = await elevatorIn(large, south, 'Südhaus')

    await defectAt(inNorth.asset, 'allgemein.dangerous', 'Im Norden', large)
    await defectAt(inSouth.asset, 'allgemein.dangerous', 'Im Süden', large)

    const html = (await reportOf({}, by('u-tech', large))).job?.html ?? ''

    expect(html).toContain('Im Norden')
    expect(html).not.toContain('Im Süden')
    expect(html).toContain('1 Mangel; 1 setzt seine Anlage außer Betrieb.')

    const lead = (await reportOf({}, by('u-lead', large))).job?.html ?? ''

    expect(lead).toContain('Im Norden')
    expect(lead).toContain('Im Süden')
  })

  it('is made for whoever reads the defects, and for nobody else', async () => {
    const refused = await reportOf({}, holding('location.read', 'asset.read'))

    expect({ status: refused.status, job: refused.job }).toEqual({ status: 403, job: undefined })
    expect((await reportOf({}, by('u-tech'))).status).toBe(200)
  })
})
