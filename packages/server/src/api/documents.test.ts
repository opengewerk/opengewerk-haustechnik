import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  documentGone,
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
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The documents of an operator over the routes of the server (#97, section
 * 4.10 of the concept): a device sends the bytes of a file ahead, then the
 * document and its version through the sync, and the file of a version is
 * handed out by the id of the version, in the area of what the document
 * hangs on.
 *
 * The tables, the store, the routes and the checks of a version are the
 * foundation's and tested there with an application that is nobody's. What
 * is held here is what this application decides: what a document hangs on
 * and what the server derives, who files, corrects and removes one, that a
 * file at an asset is handed out only to whoever sees the asset, that an
 * older version stays to be had, and that a file which is neither a picture
 * nor a PDF is handed out to be saved.
 */

/** One area, as most tenants have it: everybody works in it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south: the Haustechnik in the north, the Objektleitung in the south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
}

let admin: Pool
let database: Database
let app: INestApplication
let folder = ''

function http() {
  return request(app.getHttpServer())
}

/** The header of somebody with one of the four roles, in one of the tenants. */
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
function pdf(words = 'Betriebsanleitung'): Buffer {
  return Buffer.from(`%PDF-1.7\n% ${words} ${randomBytes(12).toString('hex')}\n%%EOF\n`, 'utf8')
}

/** A JPEG by its first bytes. */
function jpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
    randomBytes(32),
  ])
}

let recorded = Date.parse('2026-10-06T08:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  entity: string,
  kind: 'create' | 'update' | 'delete',
  recordId: string,
  values: Readonly<Record<string, SyncValue>> = {},
  seen: Readonly<Record<string, SyncValue>> = {},
) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind,
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({
      field,
      from: seen[field] ?? null,
      to,
    })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

type Sent = ReturnType<typeof operation>

function send(header: string, operations: readonly Sent[]) {
  return http()
    .post('/sync')
    .set(testIdentityHeader, header)
    .send({ deviceId: 'phone', operations })
}

/** What became of each operation, as the device reads it. */
async function outcomes(header: string, operations: readonly Sent[]) {
  const answer = await send(header, operations).expect(201)

  return (
    answer.body.receipts as { outcome: string; reason: string | null; fields: string[] }[]
  ).map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))
}

const applied = { outcome: 'applied', reason: null, fields: [] }

/** The rows of each kind of record a device of somebody is sent. */
async function pulled(header: string) {
  const answer = await http().get('/sync?since=0').set(testIdentityHeader, header).expect(200)

  return {
    narrowed: answer.body.narrowed as Readonly<Record<string, string>>,
    rows: Object.fromEntries(
      (answer.body.changes as { entity: string; rows: Record<string, unknown>[] }[]).map(
        (change) => [change.entity, change.rows],
      ),
    ) as Readonly<Record<string, readonly Record<string, unknown>[]>>,
  }
}

async function rowOf(header: string, entity: string, id: string) {
  return (await pulled(header)).rows[entity]?.find((row) => row['id'] === id)
}

/** Sends the bytes of a file ahead of its version, as a device does. */
async function stored(bytes: Buffer, header: string, declared: string): Promise<string> {
  const sha256 = hashOf(bytes)

  await http()
    .put(`/files/${sha256}`)
    .set('content-type', 'application/octet-stream')
    .set('x-media-type', declared)
    .set(testIdentityHeader, header)
    .send(bytes)
    .expect(200)

  return sha256
}

interface Filing {
  readonly bytes?: Buffer
  readonly fileName?: string
  readonly mediaType?: string
  readonly title?: string
  readonly kind?: string | null
  /** Leaves the bytes on the device: the version arrives without its file. */
  readonly withoutBytes?: boolean
  readonly previewSha256?: string | null
}

/** The operation of a version of a document, for bytes somebody holds. */
function versionOf(document: string, bytes: Buffer, filing: Filing = {}) {
  const version = newId<'attachment-version'>()

  return {
    version,
    sent: operation('attachment_versions', 'create', version, {
      attachmentId: document,
      sha256: hashOf(bytes),
      fileName: filing.fileName ?? 'betriebsanleitung.pdf',
      mediaType: filing.mediaType ?? 'application/pdf',
      sizeBytes: bytes.byteLength,
      previewSha256: filing.previewSha256 ?? null,
    }),
  }
}

/**
 * A document with its first version, filed as a device files one: the bytes
 * ahead, then the two records in one transmission.
 */
async function filed(header: string, home: Readonly<Record<string, string>>, filing: Filing = {}) {
  const bytes = filing.bytes ?? pdf()
  const document = newId<'attachment'>()
  // In the order a device records them: the server applies a transmission by
  // the moment of each operation, and a version comes after its document.
  const made = operation('attachments', 'create', document, {
    title: filing.title ?? 'Betriebsanleitung',
    ...(filing.kind === undefined ? {} : { kind: filing.kind }),
    ...home,
  })
  const { version, sent } = versionOf(document, bytes, filing)

  if (filing.withoutBytes !== true) {
    await stored(bytes, header, filing.mediaType ?? 'application/pdf')
  }

  const result = await outcomes(header, [made, sent])

  return { document, version, bytes, outcomes: result }
}

/** The file of a version, as a browser asks for it. */
function content(version: string, header: string, which: 'content' | 'preview' = 'content') {
  return http()
    .get(`/attachments/versions/${version}/${which}`)
    .set(testIdentityHeader, header)
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        done(null, Buffer.concat(chunks))
      })
    })
}

/** A property with a building, a floor and a room, and an elevator in the room. */
interface Place {
  readonly property: string
  readonly building: string
  readonly room: string
  readonly asset: string
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
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
  const room = await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' })
  const asset = newId<'asset'>()

  expect(
    await outcomes(header, [
      operation('assets', 'create', asset, {
        buildingId: building,
        roomId: room,
        kind: 'probe.elevator',
        name: 'Aufzug Haus A',
      }),
    ]),
  ).toEqual([applied])

  return { property, building, room, asset }
}

let place: Place
let inNorth: Place
let inSouth: Place

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
  ])

  // The large tenant has its two areas before anybody works for it.
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

  await admin.query(
    'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3), ($1, $4, $5)',
    [large, people.technician, north, people.site_management, south],
  )

  folder = mkdtempSync(join(tmpdir(), 'haustechnik-documents-'))
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
  inNorth = await placeIn(large, { areaId: north })
  inSouth = await placeIn(large, { areaId: south })
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('a document filed from a device', () => {
  /**
   * The third point of the acceptance of #97, on the server: a photo taken
   * without a network arrives as its bytes, then its document and its
   * version, and hangs at its asset. The half on the device is held in
   * `packages/web/src/app/documents.test.tsx`.
   */
  it('hangs at its asset after the sync, with the property and the area the server derives and who filed it', async () => {
    const tech = by('technician', large)
    const photo = await filed(
      tech,
      { propertyId: inNorth.property, assetId: inNorth.asset },
      { bytes: jpeg(), fileName: 'typenschild.jpg', mediaType: 'image/jpeg', title: 'Typenschild' },
    )

    expect(photo.outcomes).toEqual([applied, applied])
    expect(await rowOf(tech, 'attachments', photo.document)).toMatchObject({
      title: 'Typenschild',
      kind: null,
      propertyId: inNorth.property,
      areaId: north,
      assetId: inNorth.asset,
      buildingId: null,
      roomId: null,
      activityId: null,
      deletedAt: null,
    })
    expect(await rowOf(tech, 'attachment_versions', photo.version)).toMatchObject({
      attachmentId: photo.document,
      sha256: hashOf(photo.bytes),
      fileName: 'typenschild.jpg',
      mediaType: 'image/jpeg',
      sizeBytes: photo.bytes.byteLength,
      // Written by the database from the request, whatever a device says.
      createdBy: people.technician,
    })

    const answer = await content(photo.version, tech).expect(200)

    expect(Buffer.compare(answer.body as Buffer, photo.bytes)).toBe(0)
  })

  it('hangs on a property, a building, a room or an activity as well', async () => {
    const site = by('site_management')
    const activity = newId<'activity'>()

    expect(
      await outcomes(site, [
        operation('activities', 'create', activity, {
          kind: 'work_order',
          title: 'Notleuchte tauschen',
          status: 'open',
          propertyId: place.property,
        }),
      ]),
    ).toEqual([applied])

    const homes: readonly Readonly<Record<string, string>>[] = [
      {},
      { buildingId: place.building },
      { roomId: place.room },
      { activityId: activity },
    ]

    for (const home of homes) {
      const document = await filed(site, { propertyId: place.property, ...home })

      expect([home, document.outcomes]).toEqual([home, [applied, applied]])
      expect(await rowOf(site, 'attachments', document.document)).toMatchObject({
        propertyId: place.property,
        buildingId: null,
        roomId: null,
        assetId: null,
        activityId: null,
        ...home,
      })
    }
  })

  it('waits as a conflict about its one version while the bytes have not arrived', async () => {
    const waiting = await filed(
      by('technician'),
      { propertyId: place.property, assetId: place.asset },
      { withoutBytes: true },
    )

    expect(waiting.outcomes).toEqual([
      applied,
      { outcome: 'conflict', reason: 'record_missing', fields: ['sha256'] },
    ])
  })

  it('is refused a place that is not there for the person, as a conflict about that operation', async () => {
    const tech = by('technician', large)
    const about = async (home: Readonly<Record<string, string>>) =>
      (await filed(tech, home)).outcomes[0]

    // A property of the south, which the Haustechnik of the north does not see.
    expect(await about({ propertyId: inSouth.property, assetId: inSouth.asset })).toEqual({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: ['propertyId'],
    })
    // An asset of another property under a property in sight.
    expect(await about({ propertyId: inNorth.property, assetId: inSouth.asset })).toEqual({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: ['assetId'],
    })
    // Nothing that is an id at all.
    expect(await about({ propertyId: inNorth.property, activityId: newId<'activity'>() })).toEqual({
      outcome: 'conflict',
      reason: 'record_missing',
      fields: ['activityId'],
    })
  })

  it('takes a new version only for a document in sight that is still in the records', async () => {
    const site = by('site_management', large)
    const tech = by('technician', large)
    const inTheSouth = await filed(site, { propertyId: inSouth.property, assetId: inSouth.asset })
    const bytes = pdf()

    await stored(bytes, tech, 'application/pdf')

    expect(await outcomes(tech, [versionOf(inTheSouth.document, bytes).sent])).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['attachmentId'] },
    ])

    // Taken out of the records by the Objektleitung, it takes no version any more.
    await stored(bytes, site, 'application/pdf')

    expect(await outcomes(site, [operation('attachments', 'delete', inTheSouth.document)])).toEqual(
      [applied],
    )
    expect(await outcomes(site, [versionOf(inTheSouth.document, bytes).sent])).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['attachmentId'] },
    ])
  })

  it('is told in the sentence of the form what the rules of domain refuse, with the operation named', async () => {
    const header = by('technician')
    const refusal = async (values: Readonly<Record<string, SyncValue>>) => {
      const sent = operation('attachments', 'create', newId<'attachment'>(), values)
      const answer = await send(header, [sent]).expect(400)

      expect(answer.body.operationId).toBe(sent.id)

      return answer.body.message as string
    }

    expect(
      await refusal({
        title: 'Schaltplan',
        propertyId: place.property,
        assetId: place.asset,
        roomId: place.room,
      }),
    ).toBe(
      'Ein Dokument hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum, einem Gebäude oder einem Vorgang.',
    )
    expect(await refusal({ title: 'Schaltplan' })).toBe(
      'Ein Dokument hängt an einer Liegenschaft, einem Gebäude, einem Raum, einer Anlage oder einem Vorgang.',
    )
    expect(await refusal({ title: ' ', propertyId: place.property })).toBe('Die Bezeichnung fehlt.')
    expect(await refusal({ title: 'x'.repeat(121), propertyId: place.property })).toBe(
      'Die Bezeichnung hat höchstens 120 Zeichen.',
    )
    expect(
      await refusal({ title: 'Schaltplan', kind: 'invoice', propertyId: place.property }),
    ).toBe('Diese Art eines Dokuments gibt es nicht.')
  })

  it('is given another name and another kind by whoever files, and stays where it hangs', async () => {
    const tech = by('technician')
    const document = await filed(tech, { propertyId: place.property, assetId: place.asset })

    expect(
      await outcomes(tech, [
        operation(
          'attachments',
          'update',
          document.document,
          { title: '  Betriebsanleitung Aufzug  ', kind: 'operating_manual' },
          { title: 'Betriebsanleitung', kind: null },
        ),
      ]),
    ).toEqual([applied])
    expect(await rowOf(tech, 'attachments', document.document)).toMatchObject({
      title: 'Betriebsanleitung Aufzug',
      kind: 'operating_manual',
    })

    // Moving it is nothing a device sends: asked of whoever may do most, it
    // is a conflict about that one operation.
    expect(
      await outcomes(by('management'), [
        operation(
          'attachments',
          'update',
          document.document,
          { assetId: null, roomId: place.room },
          { assetId: place.asset, roomId: null },
        ),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'online_only', fields: ['assetId', 'roomId'] }])
    expect(await rowOf(tech, 'attachments', document.document)).toMatchObject({
      assetId: place.asset,
      roomId: null,
    })
  })
})

describe('who may do what with a document', () => {
  /** Section 7 of the concept: all four roles look at documents and file them. */
  it.each(roleKeys)('"%s" files one, lays a version over it and reads both', async (role) => {
    const header = by(role)
    const document = await filed(header, { propertyId: place.property, assetId: place.asset })
    const next = pdf('Zweite Fassung')

    expect(document.outcomes).toEqual([applied, applied])

    await stored(next, header, 'application/pdf')

    const second = versionOf(document.document, next)

    expect(await outcomes(header, [second.sent])).toEqual([applied])
    await content(document.version, header).expect(200)
    await content(second.version, header).expect(200)
  })

  it('is taken out of the records from the Objektleitung on, and the Haustechnik is refused with the right named', async () => {
    const document = await filed(by('technician'), {
      propertyId: place.property,
      assetId: place.asset,
    })
    const removal = () => operation('attachments', 'delete', document.document)
    const refused = removal()
    const answer = await send(by('technician'), [refused]).expect(400)

    expect(answer.body).toMatchObject({
      message: missingRight('document.remove'),
      operationId: refused.id,
    })
    expect(await rowOf(by('technician'), 'attachments', document.document)).toMatchObject({
      deletedAt: null,
    })

    for (const role of ['site_management', 'technical_management', 'management'] as const) {
      const theirs = await filed(by(role), { propertyId: place.property, assetId: place.asset })

      expect([
        role,
        await outcomes(by(role), [operation('attachments', 'delete', theirs.document)]),
      ]).toEqual([role, [applied]])
    }
  })

  it('is filed by nobody who lacks the right, a version of one included', async () => {
    const lacking = without('technician', 'document.record')
    const document = await filed(by('technician'), {
      propertyId: place.property,
      assetId: place.asset,
    })

    for (const sent of [
      operation('attachments', 'create', newId<'attachment'>(), {
        title: 'Schaltplan',
        propertyId: place.property,
      }),
      versionOf(document.document, document.bytes).sent,
      operation('attachments', 'update', document.document, { title: 'Anders' }),
    ]) {
      const answer = await send(lacking, [sent]).expect(400)

      expect(answer.body).toMatchObject({
        message: missingRight('document.record'),
        operationId: sent.id,
      })
    }
  })

  it('is not handed out to whoever may not look at documents', async () => {
    const document = await filed(by('technician'), {
      propertyId: place.property,
      assetId: place.asset,
    })

    for (const which of ['content', 'preview'] as const) {
      const answer = await http()
        .get(`/attachments/versions/${document.version}/${which}`)
        .set(testIdentityHeader, without('management', 'document.read'))
        .expect(403)

      expect(answer.body).toMatchObject({ message: missingRight('document.read') })
    }

    await http().get(`/attachments/versions/${document.version}/content`).expect(401)
  })
})

describe('the file of a version', () => {
  /** The first point of the acceptance of #97. */
  it('is seen by whoever sees the asset its document hangs on, and by nobody else', async () => {
    const atTheSouth = await filed(by('site_management', large), {
      propertyId: inSouth.property,
      assetId: inSouth.asset,
    })

    expect(atTheSouth.outcomes).toEqual([applied, applied])

    // The Objektleitung of the south, and whoever sees every area.
    for (const role of ['site_management', 'technical_management', 'management'] as const) {
      const answer = await content(atTheSouth.version, by(role, large)).expect(200)

      expect([role, Buffer.compare(answer.body as Buffer, atTheSouth.bytes)]).toEqual([role, 0])
    }

    // The Haustechnik of the north, and somebody of another operator: both
    // are told what somebody is told who asks for a version there never was.
    const never = await http()
      .get(`/attachments/versions/${newId<'attachment-version'>()}/content`)
      .set(testIdentityHeader, by('management', large))
      .expect(404)

    expect(never.body).toMatchObject({ message: documentGone })

    for (const header of [by('technician', large), by('management', small)]) {
      const answer = await http()
        .get(`/attachments/versions/${atTheSouth.version}/content`)
        .set(testIdentityHeader, header)
        .expect(404)

      expect(answer.body).toEqual(never.body)
    }

    // Neither holds its rows on a device.
    for (const header of [by('technician', large), by('management', small)]) {
      const { rows } = await pulled(header)

      expect(rows['attachments']?.some((row) => row['id'] === atTheSouth.document) ?? false).toBe(
        false,
      )
      expect(
        rows['attachment_versions']?.some((row) => row['id'] === atTheSouth.version) ?? false,
      ).toBe(false)
    }
  })

  it('is handed out by the id of its version and never by its hash', async () => {
    const document = await filed(by('technician'), {
      propertyId: place.property,
      assetId: place.asset,
    })
    const sha256 = hashOf(document.bytes)

    for (const path of [
      `/attachments/versions/${sha256}/content`,
      `/attachments/${sha256}`,
      `/files/${sha256}`,
    ]) {
      const answer = await http().get(path).set(testIdentityHeader, by('management'))

      expect([path, answer.status]).toEqual([path, 404])
    }
  })

  it('is shown in the page as the PDF it is, and never kept by a cache', async () => {
    const document = await filed(
      by('technician'),
      { propertyId: place.property, assetId: place.asset },
      { fileName: 'Betriebsanleitung Aufzug.pdf' },
    )
    const answer = await content(document.version, by('technician')).expect(200)

    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['content-disposition']).toMatch(
      /^inline; filename="Betriebsanleitung Aufzug\.pdf"/,
    )
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(Number(answer.headers['content-length'])).toBe(document.bytes.byteLength)
  })

  /**
   * What #96 left open: a file that claims to be a picture and is a page with
   * a script. The store read its first bytes when it took the file, and the
   * route answers by that and not by what the version says.
   */
  it('that is neither a picture nor a PDF is handed out to be saved and never shown in the page', async () => {
    const page = Buffer.from(
      `<!doctype html><html><script>document.title = '${randomBytes(6).toString('hex')}'</script></html>`,
      'utf8',
    )
    const disguised = await filed(
      by('technician'),
      { propertyId: place.property, assetId: place.asset },
      { bytes: page, fileName: 'typenschild.jpg', mediaType: 'image/jpeg' },
    )

    expect(disguised.outcomes).toEqual([applied, applied])

    const answer = await content(disguised.version, by('technician')).expect(200)

    expect(answer.headers['content-disposition']).toMatch(
      /^attachment; filename="typenschild\.jpg"/,
    )
    expect(answer.headers['content-type']).not.toMatch(/^image\//)
    expect(answer.headers['content-type']).not.toMatch(/html/)
  })

  /** The second point of the acceptance of #97. */
  it('stays to be had when a newer version is laid over it', async () => {
    const tech = by('technician')
    const document = await filed(tech, { propertyId: place.property, assetId: place.asset })
    const newer = pdf('Zweite Fassung')

    await stored(newer, tech, 'application/pdf')

    const second = versionOf(document.document, newer, { fileName: 'betriebsanleitung-2.pdf' })

    expect(await outcomes(tech, [second.sent])).toEqual([applied])

    const first = await content(document.version, tech).expect(200)
    const last = await content(second.version, tech).expect(200)

    expect(Buffer.compare(first.body as Buffer, document.bytes)).toBe(0)
    expect(Buffer.compare(last.body as Buffer, newer)).toBe(0)

    // Both stand on the device as rows of their own, neither changed.
    const { rows } = await pulled(tech)
    const versions = (rows['attachment_versions'] ?? []).filter(
      (row) => row['attachmentId'] === document.document,
    )

    expect(versions.map((row) => row['id']).sort()).toEqual(
      [document.version, second.version].sort(),
    )
    expect(versions.map((row) => row['version'])).toEqual([1, 1])
  })

  it('is no longer handed out once its document is taken out of the records, and its row stays', async () => {
    const site = by('site_management')
    const document = await filed(site, { propertyId: place.property, assetId: place.asset })

    await content(document.version, site).expect(200)

    expect(await outcomes(site, [operation('attachments', 'delete', document.document)])).toEqual([
      applied,
    ])

    const answer = await http()
      .get(`/attachments/versions/${document.version}/content`)
      .set(testIdentityHeader, by('management'))
      .expect(404)

    expect(answer.body).toMatchObject({ message: documentGone })

    // Marked and never deleted: the document says since when, and the
    // version and its file are still there.
    const { rows } = await admin.query<{ gone: boolean; versions: number; files: number }>(
      `select a.deleted_at is not null as gone,
              (select count(*)::int from attachment_versions v where v.attachment_id = a.id) as versions,
              (select count(*)::int from files f
                where f.tenant_id = a.tenant_id and f.sha256 = $2) as files
         from attachments a where a.id = $1`,
      [document.document, hashOf(document.bytes)],
    )

    expect(rows).toEqual([{ gone: true, versions: 1, files: 1 }])
  })

  it('goes with the asset its document hangs on', async () => {
    const elsewhere = await placeIn()
    const document = await filed(by('technician'), {
      propertyId: elsewhere.property,
      assetId: elsewhere.asset,
    })

    await content(document.version, by('technician')).expect(200)
    await http()
      .delete(`/assets/${elsewhere.asset}`)
      .set(testIdentityHeader, by('site_management'))
      .expect((response) => {
        expect([200, 204]).toContain(response.status)
      })
    await content(document.version, by('management')).expect(404)
    expect(await rowOf(by('technician'), 'attachments', document.document)).toMatchObject({
      deletedAt: expect.any(String) as string,
    })
  })

  it('has a small picture beside it where it is a photo, handed out the same way, and none otherwise', async () => {
    const tech = by('technician', large)
    const small = jpeg()
    const previewSha256 = await stored(small, tech, 'image/jpeg')
    const photo = await filed(
      tech,
      { propertyId: inNorth.property, assetId: inNorth.asset },
      { bytes: jpeg(), fileName: 'typenschild.jpg', mediaType: 'image/jpeg', previewSha256 },
    )

    expect(photo.outcomes).toEqual([applied, applied])

    const answer = await content(photo.version, tech, 'preview').expect(200)

    expect(answer.headers['content-type']).toBe('image/jpeg')
    expect(Buffer.compare(answer.body as Buffer, small)).toBe(0)
    // Outside the area of the asset there is no picture either.
    await content(photo.version, by('site_management', large), 'preview').expect(404)

    const manual = await filed(tech, { propertyId: inNorth.property, assetId: inNorth.asset })

    await content(manual.version, tech, 'preview').expect(404)
  })
})

describe('what a device holds of the documents', () => {
  it('is the documents of its places with their versions, named with the places', async () => {
    const atTheNorth = await filed(by('technician', large), {
      propertyId: inNorth.property,
      assetId: inNorth.asset,
    })
    const { narrowed, rows } = await pulled(by('technician', large))

    expect(rows['attachments']?.map((row) => row['id'])).toContain(atTheNorth.document)
    expect(rows['attachment_versions']?.map((row) => row['id'])).toContain(atTheNorth.version)
    expect(rows['attachments']?.map((row) => row['propertyId'])).not.toContain(inSouth.property)
    // Dropped and asked again with the places, when the areas of the person change.
    expect(narrowed['attachments']).toBe(narrowed['properties'])
    expect(narrowed['attachment_versions']).toBe(narrowed['properties'])
    expect(narrowed['attachments']).toMatch(/^properties:/)
  })
})
