import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  type RoleKey,
  roleKeys,
  rightsOfRoles,
  type SyncValue,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ApiModule } from '../api/api.module.js'
import { as, testIdentities } from '../api/test-identity.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { runDeadlinesOf } from './engine.js'

/**
 * The validity of a document (#327, sections 2.4, 4.3 and 4.10 of the
 * concept): the day the newest version of a document names becomes a deadline
 * in "Fristen", the expiry of a document or the review of a risk assessment.
 * A new version moves it to its own day, a version without one and the
 * document taken out let it drop. Whoever set the day answers for it; whoever
 * does not see the document does not see its deadline; it reminds after the
 * setting of its kind.
 */

const small = newId<'tenant'>() as TenantId
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
}

const catalogue = catalogueOf(probeCatalogueBundle)
const october = new Date('2026-10-05T10:00:00Z')

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

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let recorded = Date.parse('2026-10-05T08:00:00Z')

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

async function outcomes(header: string, operations: readonly ReturnType<typeof operation>[]) {
  const answer = await http()
    .post('/sync')
    .set(testIdentityHeader, header)
    .send({ deviceId: 'office', operations })
    .expect(201)

  return (answer.body.receipts as { outcome: string }[]).map((receipt) => receipt.outcome)
}

/** A version of a document with its bytes sent ahead, and the day it names or none. */
async function versionOf(header: string, document: string, validUntil: string | null) {
  const bytes = Buffer.from(`%PDF-1.7\n% Dokument ${randomBytes(12).toString('hex')}\n%%EOF\n`)

  await http()
    .put(`/files/${hashOf(bytes)}`)
    .set('content-type', 'application/octet-stream')
    .set('x-media-type', 'application/pdf')
    .set(testIdentityHeader, header)
    .send(bytes)
    .expect(200)

  return operation('attachment_versions', 'create', newId<'attachment-version'>(), {
    attachmentId: document,
    sha256: hashOf(bytes),
    fileName: 'dokument.pdf',
    mediaType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    previewSha256: null,
    ...(validUntil === null ? {} : { validUntil }),
  })
}

/** A building of a property of the tenant, in an area where it has them. */
async function buildingIn(tenantId: TenantId = small, areaId: string | null = null) {
  const header = by(tenantId === small ? 'technical_management' : 'management', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: 'Werkhof Nord',
    street: 'Am Werkhof 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...(areaId === null ? {} : { areaId }),
  })

  return {
    property,
    building: await made(`/properties/${property}/buildings`, {
      name: 'Halle 1',
      kinds: ['school'],
    }),
  }
}

/** A document at a building with its first version, filed by the Technische Leitung. */
async function filed(
  validUntil: string | null,
  kind = 'test_certificate',
  tenantId: TenantId = small,
  areaId: string | null = null,
) {
  const header = by(tenantId === small ? 'technical_management' : 'management', tenantId)
  const { property, building } = await buildingIn(tenantId, areaId)
  const document = newId<'attachment'>()

  expect(
    await outcomes(header, [
      operation('attachments', 'create', document, {
        title:
          kind === 'risk_assessment' ? 'Gefährdungsbeurteilung Werkstatt 2026' : 'Abnahme Aufzug',
        kind,
        propertyId: property,
        buildingId: building,
      }),
      await versionOf(header, document, validUntil),
    ]),
  ).toEqual(['applied', 'applied'])

  return document
}

interface Row {
  readonly kind: string
  readonly status: string
  readonly dueOn: string
  readonly remindOn: string
  readonly attachmentId?: string
  readonly follows?: string
  readonly title?: string
  readonly responsible: { readonly userId: string } | null
}

/** The open deadlines of a document, as somebody reads the list "Fristen". */
async function deadlinesOf(document: string, header = by('management')): Promise<Row[]> {
  const answer = await http()
    .get('/deadlines?limit=200')
    .set(testIdentityHeader, header)
    .expect(200)

  return (answer.body.rows as Row[]).filter((row) => row.attachmentId === document)
}

async function pass(tenantId: TenantId = small) {
  await runDeadlinesOf({ database, catalogue, now: () => october }, tenantId, october)
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

  // The Objektleitung of the large tenant sees the north alone; the Leitung
  // sees both, and files there.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    people.site_management,
    north,
  ])

  folder = mkdtempSync(join(tmpdir(), 'haustechnik-document-deadlines-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue, files: new FileStore(folder) }),
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

describe('the day of a document', () => {
  it('stands in "Fristen" with the day of the newest version, and whoever set it answers for it', async () => {
    const document = await filed('2027-03-31')

    await pass()

    expect(await deadlinesOf(document)).toEqual([
      expect.objectContaining({
        kind: 'document.expires',
        status: 'open',
        dueOn: '2027-03-31',
        remindOn: '2027-01-30',
        follows: 'document',
        title: 'Abnahme Aufzug',
        responsible: expect.objectContaining({ userId: 'u-duties' }) as unknown,
      }),
    ])
  })

  it('moves with a new version to its day, and drops with a version without one', async () => {
    const document = await filed('2027-03-31')
    const header = by('technical_management')

    await pass()
    expect(await outcomes(header, [await versionOf(header, document, '2028-03-31')])).toEqual([
      'applied',
    ])
    await pass()
    expect((await deadlinesOf(document)).map((row) => row.dueOn)).toEqual(['2028-03-31'])

    expect(await outcomes(header, [await versionOf(header, document, null)])).toEqual(['applied'])
    await pass()
    expect(await deadlinesOf(document)).toEqual([])
  })

  it('drops with the document taken out of the records', async () => {
    const document = await filed('2027-03-31')

    await pass()
    expect(await deadlinesOf(document)).toHaveLength(1)
    // Taken out as the office does it, through the sync.
    expect(
      await outcomes(by('technical_management'), [operation('attachments', 'delete', document)]),
    ).toEqual(['applied'])
    await pass()
    expect(await deadlinesOf(document)).toEqual([])
  })

  it('of a risk assessment is its review, a kind of its own', async () => {
    const document = await filed('2026-10-29', 'risk_assessment')

    await pass()
    expect(await deadlinesOf(document)).toEqual([
      expect.objectContaining({
        kind: 'risk_assessment.review',
        dueOn: '2026-10-29',
        remindOn: '2026-09-29',
        title: 'Gefährdungsbeurteilung Werkstatt 2026',
      }),
    ])
  })

  it('reminds after the setting of its kind', async () => {
    await http()
      .put('/settings/deadlines/document.expires')
      .set(testIdentityHeader, by('technical_management'))
      .send({ leadDays: 14 })
      .expect(200)

    try {
      const document = await filed('2027-03-31')

      await pass()
      expect((await deadlinesOf(document)).map((row) => row.remindOn)).toEqual(['2027-03-17'])
    } finally {
      await http()
        .put('/settings/deadlines/document.expires')
        .set(testIdentityHeader, by('technical_management'))
        .send({ leadDays: null })
        .expect(200)
    }
  })

  it('is seen by nobody who does not see the document', async () => {
    const document = await filed('2027-03-31', 'test_certificate', large, south)

    await pass(large)
    expect(await deadlinesOf(document, by('management', large))).toHaveLength(1)
    // Deadlines are read by roles that see every area; one of the operator's
    // own may read them in its areas alone, as the north here.
    const northOnly = JSON.stringify({
      userId: people.site_management,
      tenantId: large,
      roles: ['site_management'],
      rights: [...rightsOfRoles(['site_management']), 'deadline.read'],
    })

    expect(await deadlinesOf(document, northOnly)).toEqual([])

    const inTheNorth = await filed('2027-03-31', 'test_certificate', large, north)

    await pass(large)
    expect(await deadlinesOf(inTheNorth, northOnly)).toHaveLength(1)
  })

  it('takes no day that is none', async () => {
    const header = by('technical_management')
    const document = await filed(null)
    const answer = await http()
      .post('/sync')
      .set(testIdentityHeader, header)
      .send({ deviceId: 'office', operations: [await versionOf(header, document, '2027-02-30')] })

    // Refused as a whole, or the operation refused: either way nothing is laid.
    expect(
      answer.status === 400 ||
        (answer.body.receipts as { outcome: string }[]).every((each) => each.outcome !== 'applied'),
    ).toBe(true)
  })
})

describe('the documents of a contractor (#328)', () => {
  /** A firm of the large tenant, made by its Leitung. */
  async function firmOf(name: string): Promise<string> {
    return (
      await http()
        .post('/contractors')
        .set(testIdentityHeader, by('management', large))
        .send({ name })
        .expect(201)
    ).body.id as string
  }

  /** A certificate of the firm with its first version, as the office files it. */
  async function certificateOf(
    firm: string,
    validUntil: string | null,
    role: RoleKey = 'management',
    title = 'Zertifikat Fachbetrieb nach DIN 14675',
  ) {
    const header = by(role, large)
    const document = newId<'attachment'>()
    const created = operation('attachments', 'create', document, {
      title,
      kind: 'test_certificate',
      contractorId: firm,
    })
    const version = await versionOf(header, document, validUntil)
    const outcome = await outcomes(header, [created, version])

    return { document, version: version.recordId, outcome }
  }

  /** The Objektleitung of the large tenant, which sees the north alone, as one that reads deadlines. */
  const northOnly = () =>
    JSON.stringify({
      userId: people.site_management,
      tenantId: large,
      roles: ['site_management'],
      rights: [...rightsOfRoles(['site_management']), 'deadline.read'],
    })

  it('stands in "Fristen" once expired, without a place, with the firm, for whoever is in the operator', async () => {
    const firm = await firmOf('Brandschutz Beispiel GmbH')
    // Expired before the pass of 05.10.2026.
    const { document, outcome } = await certificateOf(firm, '2026-09-30')

    expect(outcome).toEqual(['applied', 'applied'])

    await pass(large)

    const [row] = (await deadlinesOf(document, by('management', large))) as (Row & {
      readonly propertyId: string | null
      readonly contractor: { readonly id: string; readonly name: string } | null
    })[]

    expect(row).toMatchObject({
      kind: 'document.expires',
      dueOn: '2026-09-30',
      follows: 'document',
      propertyId: null,
      contractor: { id: firm, name: 'Brandschutz Beispiel GmbH' },
    })
    // Whoever sees the north alone reads it, as the firm lies in no area,
    // and still none of the south.
    expect(await deadlinesOf(document, northOnly())).toHaveLength(1)

    const inTheSouth = await filed('2026-09-30', 'test_certificate', large, south)

    await pass(large)
    expect(await deadlinesOf(inTheSouth, northOnly())).toEqual([])
  })

  /**
   * The name of a firm is no secret (decided on 16.10.2026, #377): whoever
   * reads deadlines reads the deadline of a paper of a firm with its title and
   * the firm, and finds it by the name of the firm, without seeing the firms.
   * The paper itself stays with whoever sees them.
   */
  it('stands in "Fristen" with its title and the firm also for whoever reads deadlines and not the firms', async () => {
    const firm = await firmOf('Blitzschutz Beispiel GmbH')
    const title = 'Zertifikat Blitzschutzfachkraft'
    const { document } = await certificateOf(firm, '2027-03-31', 'management', title)
    const reader = JSON.stringify({
      userId: people.site_management,
      tenantId: large,
      roles: ['site_management'],
      rights: [...rightsOfRoles(['site_management']), 'deadline.read'].filter(
        (right) => right !== 'contractor.read',
      ),
    })

    await pass(large)

    expect(await deadlinesOf(document, reader)).toEqual([
      expect.objectContaining({
        title,
        contractor: { id: firm, name: 'Blitzschutz Beispiel GmbH' },
      }),
    ])

    const searched = async (words: string) =>
      (
        (
          await http()
            .get(`/deadlines?limit=200&search=${encodeURIComponent(words)}`)
            .set(testIdentityHeader, reader)
            .expect(200)
        ).body.rows as Row[]
      ).map((row) => row.attachmentId)

    expect(await searched('Blitzschutz Beispiel')).toEqual([document])

    // By the name the firm has now, too, before the next pass writes it into
    // the deadline.
    await http()
      .patch(`/contractors/${firm}`)
      .set(testIdentityHeader, by('management', large))
      .send({ name: 'Ableiter Muster GmbH' })
      .expect(200)
    expect(await searched('Ableiter Muster')).toEqual([document])
  })

  it('is filed by whoever keeps the firms, never at a place as well', async () => {
    const firm = await firmOf('Aufzug Beispiel GmbH')

    // The Haustechnik files documents but keeps no firms.
    const refused = await http()
      .post('/sync')
      .set(testIdentityHeader, by('technician', large))
      .send({
        deviceId: 'office',
        operations: [
          operation('attachments', 'create', newId<'attachment'>(), {
            title: 'Zertifikat',
            contractorId: firm,
          }),
        ],
      })

    expect(refused.status).toBe(400)
    expect(refused.body.message).toBe(missingRight('contractor.write'))

    const { property } = await buildingIn(large, north)
    const answer = await http()
      .post('/sync')
      .set(testIdentityHeader, by('management', large))
      .send({
        deviceId: 'office',
        operations: [
          operation('attachments', 'create', newId<'attachment'>(), {
            title: 'Zertifikat',
            contractorId: firm,
            propertyId: property,
          }),
        ],
      })

    // Refused as a whole, or the operation refused: either way nothing is filed.
    expect(
      answer.status === 400 ||
        (answer.body.receipts as { outcome: string }[]).every((each) => each.outcome !== 'applied'),
    ).toBe(true)
  })

  /**
   * A document of a firm lies in no area, so the policies hand it to
   * everybody in the operator. The file, the table "Dokumente" and a device
   * give it only to whoever sees the firms, whatever areas they see: a role
   * of the operator's own may read documents and not the firms.
   */
  it('goes out as a file, in the table and to a device only to whoever sees the firms', async () => {
    const firm = await firmOf('Elektro Beispiel GmbH')
    const title = 'Betriebshaftpflicht Elektro Beispiel 2027'
    const { document, version, outcome } = await certificateOf(
      firm,
      '2027-12-31',
      'management',
      title,
    )

    expect(outcome).toEqual(['applied', 'applied'])

    /** One of the people, with every right of their role save seeing the firms. */
    const withoutFirms = (role: RoleKey) =>
      JSON.stringify({
        userId: people[role],
        tenantId: large,
        roles: [role],
        rights: [...rightsOfRoles([role])].filter((right) => right !== 'contractor.read'),
      })
    const file = (header: string) =>
      http().get(`/attachments/versions/${version}/content`).set(testIdentityHeader, header)
    const table = async (header: string) =>
      (
        await http()
          .get('/attachments/table?format=csv')
          .set(testIdentityHeader, header)
          .buffer(true)
          .parse((response, done) => {
            const parts: Buffer[] = []

            response.on('data', (part: Buffer) => parts.push(part))
            response.on('end', () => {
              done(null, Buffer.concat(parts).toString('utf8'))
            })
          })
          .expect(200)
      ).body as string
    /** The documents and versions a device of the person holds, and what the answer names them by. */
    const held = async (header: string) => {
      const answer = await http().get('/sync?since=0').set(testIdentityHeader, header).expect(200)
      const changes = answer.body.changes as { entity: string; rows: { id: string }[] }[]
      const ids = (entity: string) =>
        (changes.find((change) => change.entity === entity)?.rows ?? []).map((row) => row.id)

      return {
        documents: ids('attachments'),
        versions: ids('attachment_versions'),
        narrowed: answer.body.narrowed as Readonly<Record<string, string>>,
      }
    }

    await file(by('management', large)).expect(200)
    await file(withoutFirms('management')).expect(404)
    expect(await table(by('management', large))).toContain(title)
    expect(await table(withoutFirms('management'))).not.toContain(title)

    // On the device of whoever sees every area, and of whoever sees the north alone.
    for (const role of ['management', 'site_management'] as const) {
      const theirs = await held(by(role, large))
      const not = await held(withoutFirms(role))

      expect([theirs.documents, theirs.versions]).toEqual([
        expect.arrayContaining([document]),
        expect.arrayContaining([version]),
      ])
      expect(not.documents).not.toContain(document)
      expect(not.versions).not.toContain(version)
      // Named by another value, so that a device lets them go once the right goes.
      expect([not.narrowed['attachments'], not.narrowed['attachment_versions']]).toEqual([
        `${theirs.narrowed['attachments']}:without-contractors`,
        `${theirs.narrowed['attachment_versions']}:without-contractors`,
      ])
    }
  })

  /**
   * What comes after filing a paper of a firm is keeping the firm as well,
   * though the policies let the document through for everybody in the
   * operator: the Haustechnik files documents and the Objektleitung takes them
   * out, and neither keeps the firms. Each is refused with the right it lacks.
   */
  it('is kept after filing, with a new version, a change or taken out, only by whoever keeps the firms', async () => {
    const firm = await firmOf('Dach Beispiel GmbH')
    const title = 'Zertifikat Fachbetrieb nach DIN 14675'
    const { document, outcome } = await certificateOf(firm, '2027-06-30')

    expect(outcome).toEqual(['applied', 'applied'])

    const refusal = async (role: RoleKey, sent: ReturnType<typeof operation>) => {
      const answer = await http()
        .post('/sync')
        .set(testIdentityHeader, by(role, large))
        .send({ deviceId: 'office', operations: [sent] })

      return [answer.status, answer.body.message as string]
    }
    const lacking = [400, missingRight('contractor.write')]
    const renamed = () =>
      operation('attachments', 'update', document, { title: 'Zertifikat 2028' }, { title })

    expect(
      await refusal('technician', await versionOf(by('technician', large), document, '2028-06-30')),
    ).toEqual(lacking)
    expect(await refusal('site_management', renamed())).toEqual(lacking)
    expect(await refusal('site_management', operation('attachments', 'delete', document))).toEqual(
      lacking,
    )

    // Whoever keeps the firms does all three.
    const keeper = by('technical_management', large)

    expect(
      await outcomes(keeper, [
        await versionOf(keeper, document, '2028-06-30'),
        renamed(),
        operation('attachments', 'delete', document),
      ]),
    ).toEqual(['applied', 'applied', 'applied'])
  })

  it('drops with the firm taken out of the list', async () => {
    const firm = await firmOf('Lüftung Beispiel GmbH')
    const { document } = await certificateOf(firm, '2027-03-31')

    await pass(large)
    expect(await deadlinesOf(document, by('management', large))).toHaveLength(1)

    await http()
      .delete(`/contractors/${firm}`)
      .set(testIdentityHeader, by('management', large))
      .expect(200)
    await pass(large)
    expect(await deadlinesOf(document, by('management', large))).toEqual([])
  })
})

/**
 * The papers of a contract (#329) lie in no area like those of a firm: they
 * go to a device, out as a file and into the table only for whoever reads
 * the contracts, and are kept only by whoever keeps them.
 */
describe('the papers of a contract (#329)', () => {
  it('go to a device and out as a file only to whoever reads the contracts, and are kept only by whoever keeps them', async () => {
    const lead = by('management', large)
    const firm = (
      await http()
        .post('/contractors')
        .set(testIdentityHeader, lead)
        .send({ name: 'Aufzugsdienst Beispiel GmbH' })
        .expect(201)
    ).body.id as string
    const contract = (
      await http()
        .post('/contracts')
        .set(testIdentityHeader, lead)
        .send({ contractorId: firm, title: 'Wartung der Aufzüge', startsOn: '2024-01-01' })
        .expect(201)
    ).body.id as string
    const document = newId<'attachment'>()
    const title = 'Wartungsvertrag Aufzüge'
    // Made in this order, as a device records them: the document, then its version.
    const filed = operation('attachments', 'create', document, { title, contractId: contract })
    const version = await versionOf(lead, document, null)

    // Filing one asks for the right to keep the contracts.
    const refusal = async (role: RoleKey, sent: ReturnType<typeof operation>) => {
      const answer = await http()
        .post('/sync')
        .set(testIdentityHeader, by(role, large))
        .send({ deviceId: 'office', operations: [sent] })

      return [answer.status, answer.body.message as string]
    }
    const lacking = [400, missingRight('contract.write')]

    expect(
      await refusal(
        'site_management',
        operation('attachments', 'create', newId<'attachment'>(), { title, contractId: contract }),
      ),
    ).toEqual(lacking)
    expect(await outcomes(lead, [filed, version])).toEqual(['applied', 'applied'])

    const file = (header: string) =>
      http()
        .get(`/attachments/versions/${version.recordId}/content`)
        .set(testIdentityHeader, header)
    /** The documents and versions a device of the person holds, and what the answer names them by. */
    const held = async (header: string) => {
      const answer = await http().get('/sync?since=0').set(testIdentityHeader, header).expect(200)
      const changes = answer.body.changes as { entity: string; rows: { id: string }[] }[]
      const ids = (entity: string) =>
        (changes.find((change) => change.entity === entity)?.rows ?? []).map((row) => row.id)

      return {
        contracts: ids('contracts'),
        documents: ids('attachments'),
        versions: ids('attachment_versions'),
        narrowed: answer.body.narrowed as Readonly<Record<string, string>>,
      }
    }

    // The Objektleitung reads the contracts, the Haustechnik does not.
    const reads = await held(by('site_management', large))
    const not = await held(by('technician', large))

    await file(by('site_management', large)).expect(200)
    await file(by('technician', large)).expect(404)

    // Nor does the table "Dokumente" name it for whoever does not read the contracts.
    const table = async (header: string) =>
      (
        await http()
          .get('/attachments/table?format=csv')
          .set(testIdentityHeader, header)
          .buffer(true)
          .parse((response, done) => {
            const parts: Buffer[] = []

            response.on('data', (part: Buffer) => parts.push(part))
            response.on('end', () => {
              done(null, Buffer.concat(parts).toString('utf8'))
            })
          })
          .expect(200)
      ).body as string

    expect(await table(by('site_management', large))).toContain(title)
    expect(await table(by('technician', large))).not.toContain(title)
    expect([reads.contracts, reads.documents, reads.versions]).toEqual([
      expect.arrayContaining([contract]),
      expect.arrayContaining([document]),
      expect.arrayContaining([version.recordId]),
    ])
    expect(not.contracts).not.toContain(contract)
    expect(not.documents).not.toContain(document)
    expect(not.versions).not.toContain(version.recordId)
    // Named by another value, so that a device lets them go once the right goes.
    expect([not.narrowed['contracts'], not.narrowed['attachments']]).toEqual([
      `${String(reads.narrowed['contracts'])}:without-contracts`,
      expect.stringMatching(/:without-contracts$/),
    ])

    // A new version, a change and taking it out ask for the right to keep the contracts.
    const renamed = () =>
      operation('attachments', 'update', document, { title: 'Wartungsvertrag 2027' }, { title })

    expect(
      await refusal(
        'site_management',
        await versionOf(by('site_management', large), document, null),
      ),
    ).toEqual(lacking)
    expect(await refusal('site_management', renamed())).toEqual(lacking)
    expect(await refusal('site_management', operation('attachments', 'delete', document))).toEqual(
      lacking,
    )

    const keeper = by('technical_management', large)

    expect(
      await outcomes(keeper, [
        await versionOf(keeper, document, null),
        renamed(),
        operation('attachments', 'delete', document),
      ]),
    ).toEqual(['applied', 'applied', 'applied'])
  })
})
