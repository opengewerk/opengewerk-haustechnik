import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type AuditPage,
  missingRight,
  type Right,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, dispositionFor, FileStore, newId } from '@opengewerk/platform-server'
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
 * The file store of the foundation, bound to this application
 * (opengewerk-haustechnik#96): the bytes of a file go in through
 * `PUT /files/:sha256`, under the right to file a document, into the folder
 * the instance was given, with a row that makes them a file of the tenant.
 *
 * The route, the store and the look at the first bytes are the foundation's
 * and tested there. What is held here is what this application decides and
 * what it relies on: who may send a file, that it lands in the store handed
 * in, that it belongs to the tenant that sent it, that nothing hands it out by
 * its hash, and that a file which is neither a picture nor a PDF is recorded
 * as a download whatever it claims to be.
 */

/** One area, as most tenants have it: everybody works in it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; the Haustechnik works in the north only. */
const large = newId<'tenant'>() as TenantId

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

/** Bytes no other test sends: text with a random tail. */
function text(words = 'Wartungsbericht Aufzug'): Buffer {
  return Buffer.from(`${words} ${randomBytes(12).toString('hex')}`, 'utf8')
}

/** Where the store keeps a file: two levels of folders from its hash. */
function placeOf(sha256: string): string {
  return join(folder, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
}

interface Sending {
  /** The type the browser gave the file. */
  readonly declared?: string
  /** The hash in the address, where it is not the one of the bytes. */
  readonly sha256?: string
  /** The type of the body, where it is not bytes. */
  readonly contentType?: string
}

/** Sends the bytes of a file as a device does, as somebody or as nobody. */
function send(bytes: Buffer, header: string | null, sending: Sending = {}): request.Test {
  const sent = http()
    .put(`/files/${sending.sha256 ?? hashOf(bytes)}`)
    .set('content-type', sending.contentType ?? 'application/octet-stream')
    .set('x-media-type', sending.declared ?? 'text/plain')

  return (header === null ? sent : sent.set(testIdentityHeader, header)).send(bytes)
}

/** The rows that make these bytes a file, whoever may see them. */
async function rowsOf(sha256: string) {
  const { rows } = await admin.query<{
    id: string
    tenant_id: string
    size_bytes: number
    media_type: string
  }>(
    `select id, tenant_id, size_bytes::int as size_bytes, media_type
       from files where sha256 = $1 order by tenant_id`,
    [sha256],
  )

  return rows
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

  // The large tenant has its two areas before anybody works for it, so that
  // it does not begin with the one a tenant gets with its first membership.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )
  const north = rows.find((row) => row.name === 'Nord')?.id ?? ''

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

  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    people.technician,
    north,
  ])

  folder = mkdtempSync(join(tmpdir(), 'haustechnik-files-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { files: new FileStore(folder) })],
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

describe('the bytes of a file', () => {
  /**
   * Section 7 of the concept: all four roles file documents, a photo taken on
   * site among them.
   */
  it.each(roleKeys)('are taken from "%s", who may file a document', async (role) => {
    const bytes = text()
    const answer = await send(bytes, by(role)).expect(200)

    expect(answer.body).toEqual({
      sha256: hashOf(bytes),
      sizeBytes: bytes.byteLength,
      mediaType: 'text/plain',
    })
  })

  /**
   * The right is one a role of a tenant's own can lack. Sending changes alone
   * opens the store to nobody: what a file is stored for decides who may
   * store one.
   */
  it('are refused from somebody who may not file a document, and nothing is kept', async () => {
    const bytes = text()
    const answer = await send(bytes, without('technician', 'document.record')).expect(403)

    expect(answer.body.message).toBe(missingRight('document.record'))
    expect(existsSync(placeOf(hashOf(bytes)))).toBe(false)
    expect(await rowsOf(hashOf(bytes))).toEqual([])
  })

  it('are refused from somebody who is not signed in, and nothing is kept', async () => {
    const bytes = text()

    await send(bytes, null).expect(401)

    expect(existsSync(placeOf(hashOf(bytes)))).toBe(false)
    expect(await rowsOf(hashOf(bytes))).toEqual([])
  })

  it('lie in the store the instance was given, under their hash, and are a file of the tenant', async () => {
    const bytes = text()
    const sha256 = hashOf(bytes)

    await send(bytes, by('technician')).expect(200)

    expect(readFileSync(placeOf(sha256)).equals(bytes)).toBe(true)
    expect(await rowsOf(sha256)).toEqual([
      expect.objectContaining({
        tenant_id: small,
        size_bytes: bytes.byteLength,
        media_type: 'text/plain',
      }),
    ])
  })

  /**
   * A device that lost the answer to its last upload sends the file again,
   * and somebody else may file the same report: the same bytes are one file.
   */
  it('sent twice are one file and one row', async () => {
    const bytes = text()

    await send(bytes, by('technician')).expect(200)
    await send(bytes, by('site_management'), { declared: 'application/pdf' }).expect(200)

    expect((await rowsOf(hashOf(bytes))).map((row) => row.media_type)).toEqual(['text/plain'])
  })

  it('are refused where they are not what the hash in the address says', async () => {
    const bytes = text()
    const claimed = hashOf(text('etwas anderes'))

    await send(bytes, by('technician'), { sha256: claimed }).expect(422)

    expect(existsSync(placeOf(claimed))).toBe(false)
    expect(existsSync(placeOf(hashOf(bytes)))).toBe(false)
    expect(await rowsOf(claimed)).toEqual([])
  })

  /** A form on a foreign page can send text and JSON, and never plain bytes. */
  it('are taken as bytes only, not as what a form can send', async () => {
    const bytes = text()

    await send(bytes, by('technician'), { contentType: 'text/plain' }).expect(415)

    expect(await rowsOf(hashOf(bytes))).toEqual([])
  })
})

describe('a file of a tenant', () => {
  /**
   * The store is shared by every tenant of the instance, the row is not: each
   * tenant reaches the bytes through a row of its own.
   */
  it('is no file of another tenant that sends the same bytes', async () => {
    const bytes = text()
    const sha256 = hashOf(bytes)

    await send(bytes, by('technician')).expect(200)

    expect((await rowsOf(sha256)).map((row) => row.tenant_id)).toEqual([small])

    await send(bytes, by('site_management', large)).expect(200)

    expect((await rowsOf(sha256)).map((row) => row.tenant_id).sort()).toEqual([small, large].sort())
  })

  /**
   * The bytes belong to the tenant and to no area. The area is the one of the
   * record that names them, and that record decides who reads the file.
   */
  it('is taken from somebody who sees one area of the tenant only', async () => {
    const bytes = text()

    await send(bytes, by('technician', large)).expect(200)

    expect((await rowsOf(hashOf(bytes))).map((row) => row.tenant_id)).toEqual([large])
  })

  /**
   * A hash on its own opens nothing. Reading goes through the record that
   * names a file, in the area of that record, and comes with the documents.
   */
  it('is handed out by no route under its hash, not even to "Leitung"', async () => {
    const bytes = text()

    await send(bytes, by('management')).expect(200)

    await http()
      .get(`/files/${hashOf(bytes)}`)
      .set(testIdentityHeader, by('management'))
      .expect(404)
  })

  it('stands in the change log of the tenant with who sent it', async () => {
    const bytes = text()

    await send(bytes, by('technician')).expect(200)

    const [row] = await rowsOf(hashOf(bytes))
    const answer = await http()
      .get('/audit/changes?table=files')
      .set(testIdentityHeader, by('management'))
      .expect(200)
    const { changes } = answer.body as AuditPage

    expect(changes.find((change) => change.recordId === row?.id)?.userId).toBe(people.technician)
  })
})

describe('a file that is neither a picture nor a PDF by its first bytes', () => {
  const page = '<!doctype html><script>alert(1)</script>'
  const drawing = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

  /**
   * What the bytes show decides, never the name or the type a browser gave:
   * a page that calls itself a picture would otherwise be put in front of a
   * browser under the address of this application. It is recorded as a plain
   * byte stream, and the header a file is handed out with follows from the
   * recorded type alone.
   */
  it.each([
    ['a page that calls itself a picture', page, 'image/png'],
    ['a page that calls itself a PDF', page, 'application/pdf'],
    ['a page that says what it is', page, 'text/html'],
    ['a drawing that can carry a script', drawing, 'image/svg+xml'],
  ])('is recorded as a download: %s', async (_, content, declared) => {
    const bytes = text(content)
    const answer = await send(bytes, by('technician'), { declared }).expect(200)

    expect(answer.body.mediaType).toBe('application/octet-stream')
    expect((await rowsOf(hashOf(bytes))).map((row) => row.media_type)).toEqual([
      'application/octet-stream',
    ])
    expect(dispositionFor(String(answer.body.mediaType), 'bild.png')).toMatch(/^attachment;/)
  })

  it('is a download as well where it is a kind of file this application knows', async () => {
    const bytes = text('Raum;Anlage;Befund')
    const answer = await send(bytes, by('technician'), { declared: 'text/csv' }).expect(200)

    expect(answer.body.mediaType).toBe('text/csv')
    expect(dispositionFor(String(answer.body.mediaType), 'liste.csv')).toMatch(/^attachment;/)
  })
})

describe('a file that is a picture or a PDF by its first bytes', () => {
  /** The other way round: the bytes decide here too, whatever the file was called. */
  it.each([
    ['a PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    ['a PDF', Buffer.from('%PDF-1.7\n', 'latin1'), 'application/pdf'],
  ])('is shown in place, whatever it was declared as: %s', async (_, head, recognised) => {
    const bytes = Buffer.concat([head, randomBytes(16)])
    const answer = await send(bytes, by('technician'), { declared: 'text/plain' }).expect(200)

    expect(answer.body.mediaType).toBe(recognised)
    expect(dispositionFor(String(answer.body.mediaType), 'foto')).toMatch(/^inline;/)
  })
})
