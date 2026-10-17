import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type DutyDetails,
  type DutyEntry,
  intervalDocumentElsewhere,
  missingRight,
  type Right,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  type SyncValue,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId } from '@opengewerk/platform-server'
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
 * The document that bears the interval of a duty (#74, section 4.3 of the
 * concept): "Frist festlegen ... mit Begründung und Verweis auf das Dokument,
 * das sie trägt (Gefährdungsbeurteilung). Der Verweis ist empfohlen und nicht
 * verlangt; er merkt sich die Fassung des Dokuments vom Tag der Bestätigung,
 * und liegt eine neuere vor, sagt die Pflicht „Frist prüfen“."
 *
 * What is held here: which version a duty keeps, that it keeps it while
 * anything else of the duty changes, that naming the document again takes
 * the newest, which documents may bear an interval and who names one, what
 * the page and the register of the duties say, and what the database holds
 * behind the route.
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
  auditor: 'u-auditor',
}

const mainTest = 'probe.elevator_main_test'

let admin: Pool
let database: Database
let app: INestApplication
let folder = ''

function http() {
  return request(app.getHttpServer())
}

function by(role: RoleKey, tenantId: TenantId = small): string {
  return as(tenantId, people[role], role)
}

/** Somebody with the rights of a role except for some, as a role of a tenant's own could be. */
function without(role: RoleKey, ...taken: Right[]): string {
  return JSON.stringify({
    userId: people[role],
    tenantId: small,
    roles: [role],
    rights: [...rightsOfRoles([role])].filter((right) => !taken.includes(right)),
  })
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A PDF by its first bytes, with a tail no other test sends. */
function pdf(): Buffer {
  return Buffer.from(
    `%PDF-1.7\n% Gefährdungsbeurteilung ${randomBytes(12).toString('hex')}\n%%EOF\n`,
    'utf8',
  )
}

let recorded = Date.parse('2026-10-11T08:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  entity: string,
  kind: 'create' | 'delete',
  recordId: string,
  values: Readonly<Record<string, SyncValue>> = {},
) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind,
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

type Sent = ReturnType<typeof operation>

async function outcomes(header: string, operations: readonly Sent[]) {
  const answer = await http()
    .post('/sync')
    .set(testIdentityHeader, header)
    .send({ deviceId: 'office', operations })
    .expect(201)

  return (answer.body.receipts as { outcome: string }[]).map((receipt) => receipt.outcome)
}

/** The bytes of a file and the operation of its version, the bytes sent ahead unless the device keeps them. */
async function versionOf(header: string, document: string, { withoutBytes = false } = {}) {
  const bytes = pdf()
  const version = newId<'attachment-version'>()

  if (!withoutBytes) {
    await http()
      .put(`/files/${hashOf(bytes)}`)
      .set('content-type', 'application/octet-stream')
      .set('x-media-type', 'application/pdf')
      .set(testIdentityHeader, header)
      .send(bytes)
      .expect(200)
  }

  return {
    version,
    sent: operation('attachment_versions', 'create', version, {
      attachmentId: document,
      sha256: hashOf(bytes),
      fileName: 'gefaehrdungsbeurteilung.pdf',
      mediaType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      previewSha256: null,
    }),
  }
}

/** A document filed at a place with its versions, the oldest first, as a device files them. */
async function filed(
  home: Readonly<Record<string, string>>,
  { versions = 1, header = by('technical_management'), withoutBytes = false } = {},
) {
  const document = newId<'attachment'>()
  const made = operation('attachments', 'create', document, {
    title: 'Gefährdungsbeurteilung Aufzug',
    kind: 'concept',
    ...home,
  })
  const laid = []

  for (let count = 0; count < versions; count += 1) {
    laid.push(await versionOf(header, document, { withoutBytes }))
  }

  await outcomes(header, [made, ...laid.map((each) => each.sent)])

  return { document, versions: laid.map((each) => each.version) }
}

/** Another version laid over a document. */
async function laidOver(document: string, header = by('technical_management')) {
  const { version, sent } = await versionOf(header, document)

  expect(await outcomes(header, [sent])).toEqual(['applied'])

  return version
}

/** A property with a building, a floor and a room, an elevator in the room and one in the building. */
interface Place {
  readonly property: string
  readonly building: string
  readonly otherBuilding: string
  readonly room: string
  readonly otherRoom: string
  readonly asset: string
  readonly otherAsset: string
}

async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('technical_management', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id

  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...extra,
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const otherBuilding = await made(`/properties/${property}/buildings`, {
    name: 'Haus B',
    kinds: ['school'],
  })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
  const room = await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' })
  const otherRoom = await made(`/floors/${floor}/rooms`, { number: '0.02', name: 'Lager' })
  const asset = newId<'asset'>()
  const otherAsset = newId<'asset'>()

  expect(
    await outcomes(header, [
      operation('assets', 'create', asset, {
        buildingId: building,
        roomId: room,
        kind: 'probe.elevator',
        name: 'Aufzug Haus A',
      }),
      operation('assets', 'create', otherAsset, {
        buildingId: building,
        roomId: room,
        kind: 'probe.elevator',
        name: 'Lastenaufzug Haus A',
      }),
    ]),
  ).toEqual(['applied', 'applied'])

  return { property, building, otherBuilding, room, otherRoom, asset, otherAsset }
}

/** Confirms the main test at an asset, with what else the body names. */
function confirmed(asset: string, body: object = {}, header = by('technical_management')) {
  return http()
    .post('/duties')
    .set(testIdentityHeader, header)
    .send({ assetId: asset, kind: mainTest, intervalMonths: 24, ...body })
}

function changed(duty: string, body: object, header = by('technical_management')) {
  return http().patch(`/duties/${duty}`).set(testIdentityHeader, header).send(body)
}

async function pageOf(duty: string, header = by('technical_management')): Promise<DutyDetails> {
  return (await http().get(`/duties/${duty}`).set(testIdentityHeader, header).expect(200))
    .body as DutyDetails
}

async function rowOf(property: string, duty: string): Promise<DutyEntry | undefined> {
  const answer = await http()
    .get(`/duties/register?propertyId=${property}`)
    .set(testIdentityHeader, by('technical_management'))
    .expect(200)

  return (answer.body.duties as DutyEntry[]).find((row) => row.id === duty)
}

let place: Place
let elsewhere: Place
let inNorth: Place
let inSouth: Place

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

  for (const role of roleKeys) {
    const userId = people[role]

    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  // The Objektleitung of the large tenant sees the north alone.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    people.site_management,
    north,
  ])

  folder = mkdtempSync(join(tmpdir(), 'haustechnik-duty-documents-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue: catalogueOf(probeCatalogueBundle),
        files: new FileStore(folder),
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  place = await placeIn()
  elsewhere = await placeIn()
  inNorth = await placeIn(large, { areaId: north })
  inSouth = await placeIn(large, { areaId: south })
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('the document that bears the interval of a duty', () => {
  it('is kept with the newest version of the day the duty is confirmed, and the page names both', async () => {
    const { document, versions } = await filed({ propertyId: place.property }, { versions: 2 })
    const duty = (await confirmed(place.asset, { intervalDocumentId: document }).expect(201)).body

    expect(duty).toMatchObject({
      intervalDocumentId: document,
      intervalDocumentVersionId: versions[1],
    })

    const page = await pageOf(duty.id)

    expect(page.intervalDocument).toMatchObject({
      id: document,
      title: 'Gefährdungsbeurteilung Aufzug',
      removed: false,
      version: { id: versions[1], number: 2, fileName: 'gefaehrdungsbeurteilung.pdf' },
      newer: null,
    })
    expect(page.intervalDocument?.version.filedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(page.intervalToCheck).toBe(false)
    expect((await rowOf(place.property, duty.id))?.intervalToCheck).toBe(false)
  })

  it('is no more than a recommendation: a duty is confirmed without one', async () => {
    const duty = (await confirmed(place.otherAsset).expect(201)).body

    expect(duty).toMatchObject({ intervalDocumentId: null, intervalDocumentVersionId: null })
    expect(await pageOf(duty.id)).toMatchObject({
      intervalDocument: null,
      intervalToCheck: false,
    })

    await changed(duty.id, { intervalMonths: 12 }).expect(200)
  })

  it('makes the duty say "Frist prüfen" in its page and in the register once a newer version lies over the one it keeps', async () => {
    const at = await placeIn()
    const { document, versions } = await filed({ propertyId: at.property })
    const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body
    const newer = await laidOver(document)
    const page = await pageOf(duty.id)

    expect(page.intervalDocument).toMatchObject({
      version: { id: versions[0], number: 1 },
      newer: { id: newer, number: 2 },
    })
    expect(page.intervalToCheck).toBe(true)
    expect((await rowOf(at.property, duty.id))?.intervalToCheck).toBe(true)
  })

  it('keeps its version while the interval, the reason and who answers for the duty change', async () => {
    const at = await placeIn()
    const { document, versions } = await filed({ propertyId: at.property })
    const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body

    await laidOver(document)

    const after = (
      await changed(duty.id, {
        intervalMonths: 12,
        intervalReason: 'Die Gefährdungsbeurteilung verlangt die jährliche Prüfung.',
        responsibleUserId: people.site_management,
      }).expect(200)
    ).body

    expect(after).toMatchObject({
      intervalDocumentId: document,
      intervalDocumentVersionId: versions[0],
    })
    expect((await pageOf(duty.id)).intervalToCheck).toBe(true)
  })

  it('takes the newest version when the document is named again, and the duty no longer says "Frist prüfen"', async () => {
    const at = await placeIn()
    const { document } = await filed({ propertyId: at.property })
    const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body
    const newer = await laidOver(document)

    expect(
      (await changed(duty.id, { intervalDocumentId: document }).expect(200)).body,
    ).toMatchObject({ intervalDocumentId: document, intervalDocumentVersionId: newer })
    expect(await pageOf(duty.id)).toMatchObject({
      intervalDocument: { version: { id: newer, number: 2 }, newer: null },
      intervalToCheck: false,
    })
    expect((await rowOf(at.property, duty.id))?.intervalToCheck).toBe(false)
  })

  it('is let go with nothing in its place, and with an empty text', async () => {
    const at = await placeIn()
    const { document } = await filed({ propertyId: at.property })
    const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body

    expect((await changed(duty.id, { intervalDocumentId: null }).expect(200)).body).toMatchObject({
      intervalDocumentId: null,
      intervalDocumentVersionId: null,
    })

    await changed(duty.id, { intervalDocumentId: document }).expect(200)

    expect((await changed(duty.id, { intervalDocumentId: '' }).expect(200)).body).toMatchObject({
      intervalDocumentId: null,
      intervalDocumentVersionId: null,
    })
  })

  it('makes the duty say "Frist prüfen" once the document is taken out of the records, which is named again by nobody', async () => {
    const at = await placeIn()
    const { document } = await filed({ propertyId: at.property })
    const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body

    expect(
      await outcomes(by('technical_management'), [operation('attachments', 'delete', document)]),
    ).toEqual(['applied'])
    expect(await pageOf(duty.id)).toMatchObject({
      intervalDocument: { id: document, removed: true },
      intervalToCheck: true,
    })
    expect((await rowOf(at.property, duty.id))?.intervalToCheck).toBe(true)

    const refused = await changed(duty.id, { intervalDocumentId: document }).expect(404)

    expect(refused.body.message).toBe('Dieses Dokument gibt es nicht oder nicht mehr.')
  })

  it('says nothing once the duty has ended', async () => {
    const at = await placeIn()
    const { document } = await filed({ propertyId: at.property })
    const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body

    await laidOver(document)
    await http()
      .post(`/duties/${duty.id}/end`)
      .set(testIdentityHeader, by('technical_management'))
      .send({})
      .expect(201)

    expect((await pageOf(duty.id)).intervalToCheck).toBe(false)
  })
})

describe('the documents that may bear the interval of a duty', () => {
  it('are those at the asset of the duty, its room, its building and its property', async () => {
    const at = await placeIn()

    const homes: readonly Readonly<Record<string, string>>[] = [
      { propertyId: at.property, assetId: at.asset },
      { propertyId: at.property, roomId: at.room },
      { propertyId: at.property, buildingId: at.building },
      { propertyId: at.property },
    ]

    for (const home of homes) {
      const { document } = await filed(home)
      const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body

      expect([home, duty.intervalDocumentId]).toEqual([home, document])
      // Ended at once, so that the next one of the kind may be confirmed at the asset.
      await http()
        .post(`/duties/${duty.id}/end`)
        .set(testIdentityHeader, by('technical_management'))
        .send({})
        .expect(201)
    }
  })

  it('are none at another record of the property, and none of another property', async () => {
    const at = await placeIn()

    const homes: readonly Readonly<Record<string, string>>[] = [
      { propertyId: at.property, assetId: at.otherAsset },
      { propertyId: at.property, roomId: at.otherRoom },
      { propertyId: at.property, buildingId: at.otherBuilding },
      { propertyId: elsewhere.property },
    ]

    for (const home of homes) {
      const { document } = await filed(home)
      const refused = await confirmed(at.asset, { intervalDocumentId: document }).expect(400)

      expect([home, refused.body.message]).toEqual([home, intervalDocumentElsewhere])
    }

    // And the same when the duty changes.
    const duty = (await confirmed(at.asset).expect(201)).body
    const { document } = await filed({ propertyId: at.property, roomId: at.otherRoom })
    const refused = await changed(duty.id, { intervalDocumentId: document }).expect(400)

    expect(refused.body.message).toBe(intervalDocumentElsewhere)
  })

  it('are those at a room of the duty itself and above it, and none at an asset in that room', async () => {
    const at = await placeIn()
    const duty = (
      await http()
        .post('/duties')
        .set(testIdentityHeader, by('technical_management'))
        .send({
          roomId: at.room,
          label: 'Raum frei von Brandlasten',
          basis: 'own_decision',
          sourceNote: 'Brandschutzordnung Teil C',
          task: 'visual_check',
          intervalMonths: 3,
        })
        .expect(201)
    ).body
    const inTheRoom = await filed({ propertyId: at.property, roomId: at.room })
    const ofTheBuilding = await filed({ propertyId: at.property, buildingId: at.building })
    const atTheAsset = await filed({ propertyId: at.property, assetId: at.asset })

    await changed(duty.id, { intervalDocumentId: inTheRoom.document }).expect(200)
    await changed(duty.id, { intervalDocumentId: ofTheBuilding.document }).expect(200)

    const refused = await changed(duty.id, { intervalDocumentId: atTheAsset.document }).expect(400)

    expect(refused.body.message).toBe(intervalDocumentElsewhere)
  })

  it('are none whose version has not arrived yet', async () => {
    const at = await placeIn()
    const { document } = await filed({ propertyId: at.property }, { withoutBytes: true })
    const refused = await confirmed(at.asset, { intervalDocumentId: document }).expect(400)

    expect(refused.body.message).toBe(
      'Von diesem Dokument ist noch keine Fassung angekommen; die Datei ist noch unterwegs.',
    )
  })

  it('are none in an area the person does not see, as if there were none', async () => {
    const { document } = await filed(
      { propertyId: inSouth.property },
      { header: by('technical_management', large) },
    )
    // Somebody who keeps the register of the north alone, as a role of the
    // tenant's own could.
    const ofTheNorth = JSON.stringify({
      userId: people.site_management,
      tenantId: large,
      roles: ['site_management'],
      rights: [...rightsOfRoles(['site_management']), 'duty.write'],
    })
    const refused = await confirmed(
      inNorth.asset,
      { intervalDocumentId: document },
      ofTheNorth,
    ).expect(404)

    expect(refused.body.message).toBe('Dieses Dokument gibt es nicht oder nicht mehr.')
  })
})

describe('who names the document that bears an interval', () => {
  it('is whoever keeps the register and may look at documents', async () => {
    const at = await placeIn()
    const { document } = await filed({ propertyId: at.property })

    const lacking = await confirmed(
      at.asset,
      { intervalDocumentId: document },
      without('technical_management', 'document.read'),
    ).expect(403)

    expect(lacking.body.message).toBe(missingRight('document.read'))

    const duty = (await confirmed(at.asset).expect(201)).body
    const changing = await changed(
      duty.id,
      { intervalDocumentId: document },
      without('technical_management', 'document.read'),
    ).expect(403)

    expect(changing.body.message).toBe(missingRight('document.read'))

    const technician = await changed(
      duty.id,
      { intervalDocumentId: document },
      by('technician'),
    ).expect(403)

    expect(technician.body.message).toBe(missingRight('duty.write'))
    expect((await pageOf(duty.id)).intervalDocument).toBeNull()
  })

  it('is not named to whoever may not look at documents, though the duty says "Frist prüfen" to them all the same', async () => {
    const at = await placeIn()
    const { document } = await filed({ propertyId: at.property })
    const duty = (await confirmed(at.asset, { intervalDocumentId: document }).expect(201)).body

    await laidOver(document)

    expect(await pageOf(duty.id, without('technical_management', 'document.read'))).toMatchObject({
      intervalDocument: null,
      intervalToCheck: true,
    })
    expect((await pageOf(duty.id, by('technician'))).intervalDocument).toMatchObject({
      id: document,
    })
  })
})

describe('the database behind the route', () => {
  it('holds the document to the property of the duty and the version to its document, both or neither', async () => {
    const at = await placeIn()
    const ours = await filed({ propertyId: at.property })
    const theirs = await filed({ propertyId: elsewhere.property })
    const duty = (await confirmed(at.asset).expect(201)).body
    const point = (documentId: string | null, versionId: string | null) =>
      admin.query(
        `update duties set interval_document_id = $1, interval_document_version_id = $2 where id = $3`,
        [documentId, versionId, duty.id],
      )

    await expect(point(theirs.document, theirs.versions[0] ?? null)).rejects.toThrow(
      /duties_interval_document_of_their_property/,
    )
    await expect(point(ours.document, theirs.versions[0] ?? null)).rejects.toThrow(
      /duties_interval_document_version_of_it/,
    )
    await expect(point(ours.document, null)).rejects.toThrow(/duties_interval_document_whole/)
    await point(ours.document, ours.versions[0] ?? null)
  })
})
