import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PDFDocument } from '@cantoo/pdf-lib'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type IsoDate,
  type PdfCheck,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import {
  Database,
  FileStore,
  newId,
  SecretKey,
  type SigningContext,
} from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { leastState, nextEvidenceNumber } from '../database/test-evidence.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { signaturesIn, signedPdfSentences } from '../evidence/signed-pdf.js'
import { makeSigner, signedPdf } from '../evidence/test-signed-pdf.js'
import { signPdf } from '../prints/pades.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The signature of the instance in the PDFs with a signature in them, and
 * "PDF prüfen" (#457, section 2.6 of the concept): the print of an evidence
 * is kept signed, a change after the signature shows, a higher signature
 * appended outside (#341) still files and leaves the signature of the
 * instance standing, and the check names a kept print only to whoever sees
 * it, under the right to see the evidence, without keeping the file.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-reporter': 'reporter',
  'u-south': 'technical_management',
  // Kept with a role in the database; the header of the test gives it nothing but the right to see the evidence.
  'u-evidence': 'technician',
}

const catalogue = catalogueOf(probeCatalogueBundle)
const signing: SigningContext = {
  key: SecretKey.from('p'.repeat(64)),
  subject: { commonName: 'haustechnik.example', organisation: 'OpenGewerk Haustechnik' },
}

let admin: Pool
let database: Database
let app: INestApplication
const folder = mkdtempSync(join(tmpdir(), 'pdf-checks-'))
const store = new FileStore(folder)
const proof = {
  evidence: '',
  number: '',
  property: '',
  asset: '',
  area: '',
  print: new Uint8Array() as Uint8Array,
}

let pages = 0

/** A page the renderer makes: a real PDF, as Chromium hands one back, each a file of its own. */
async function page(): Promise<Uint8Array> {
  const document = await PDFDocument.create()

  pages += 1
  document.setTitle(`Probe ${String(pages)}`)

  document.addPage([595, 842]).drawText('Nachweis', { x: 50, y: 780, size: 18 })

  return document.save()
}

function http() {
  return request(app.getHttpServer())
}

function by(userId: string): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

/** The bytes a route hands out, as a PDF program gets them. */
async function bytesOf(path: string, userId = 'u-duties'): Promise<Uint8Array> {
  const answer = await http()
    .get(path)
    .set(testIdentityHeader, by(userId))
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = []

      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        done(null, Buffer.concat(chunks))
      })
    })
    .expect(200)

  return new Uint8Array(answer.body as Buffer)
}

/** Who signed a PDF and whether each signature still holds, in the order they stand. */
function signed(bytes: Uint8Array): { signer: string | null; holds: boolean }[] {
  return signaturesIn(bytes).map(({ signer, holds }) => ({ signer, holds }))
}

const byTheInstance = [{ signer: 'haustechnik.example, OpenGewerk Haustechnik', holds: true }]

async function checked(bytes: Uint8Array, userId = 'u-duties'): Promise<PdfCheck> {
  const answer = await http()
    .post('/pdf-checks')
    .set(testIdentityHeader, by(userId))
    .set('content-type', 'application/pdf')
    .send(Buffer.from(bytes))
    .expect(200)

  return answer.body as PdfCheck
}

/** The file with one byte changed inside what the signature of the instance covers. */
function changed(bytes: Uint8Array): Uint8Array {
  const copy = Buffer.from(bytes)
  const at = copy.indexOf('Nachweis')

  copy[at >= 0 ? at : 20] = 0x58

  return new Uint8Array(copy)
}

async function filesKept(): Promise<number> {
  const { rows } = await admin.query<{ count: string }>('select count(*) from files')

  return Number(rows[0]?.count ?? 0)
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Probe'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      userId,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [role],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        files: store,
        renderer: () => page(),
        signing,
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const made = async (path: string, body: object, userId = 'u-duties'): Promise<string> => {
    const answer = await http().post(path).set(testIdentityHeader, by(userId)).send(body)

    if (answer.status !== 201) {
      throw new Error(`${path}: ${JSON.stringify(answer.body)}`)
    }

    return answer.body.id
  }
  const property = await made('/properties', {
    name: 'Werkhof Nord',
    street: 'Probeweg 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Halle 1',
    kinds: ['school'],
  })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug A',
  })

  proof.asset = asset
  proof.property = property
  proof.area =
    (
      await admin.query<{ area_id: string }>('select area_id from properties where id = $1', [
        property,
      ])
    ).rows[0]?.area_id ?? ''
  const duty =
    (
      await admin.query<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                             counting, interval_months, confirmed_by)
         select tenant_id, property_id, area_id, id, 'Sichtkontrolle', 'own_decision', 'Hausordnung',
                'from_performance', 12, 'u-duties'
           from assets where id = $1
         returning id`,
        [asset],
      )
    ).rows[0]?.id ?? ''

  proof.number = nextEvidenceNumber()

  const state = leastState(proof.number, '2026-10-02' as IsoDate, 'without_defects')

  proof.evidence =
    (
      await admin.query<{ id: string }>(
        `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result, number, origin,
                               examiner, examiner_organisation, written_by, state, fingerprint)
         select tenant_id, property_id, area_id, id, '2026-10-02', 'without_defects', $2, 'report',
                'Erika Muster', 'Prüfstelle Süd', 'u-duties', $3, $4
           from duties where id = $1
         returning id`,
        [duty, proof.number, JSON.stringify(state), stateFingerprint(state)],
      )
    ).rows[0]?.id ?? ''

  // Whoever works in the south sees nothing of the north, where the evidence is.
  const south = await made('/areas', { name: 'Süd' }, 'u-lead')

  await admin.query('delete from member_all_areas where tenant_id = $1 and user_id = $2', [
    tenant,
    'u-south',
  ])
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    tenant,
    'u-south',
    south,
  ])

  proof.print = await bytesOf(`/evidence/${proof.evidence}/pdf`)
}, 60_000)

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('the print of an evidence', () => {
  it('is kept signed by the instance, over the whole of the file', async () => {
    const { rows } = await admin.query<{ sha256: string }>(
      'select sha256 from prints where evidence_id = $1',
      [proof.evidence],
    )
    const [signature] = signaturesIn(proof.print)

    expect(rows.map((row) => row.sha256)).toEqual([
      createHash('sha256').update(proof.print).digest('hex'),
    ])
    expect(signaturesIn(proof.print)).toHaveLength(1)
    expect(signature).toMatchObject({ holds: true, endsAt: proof.print.length })
    expect(signature?.signer).toBe('haustechnik.example, OpenGewerk Haustechnik')
  })

  it('takes a higher signature appended outside, and keeps the signature of the instance standing', async () => {
    const outside = signedPdf(proof.print, makeSigner('ecdsa'))
    const blob = await store.put(outside)

    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, 'application/pdf')`,
      [tenant, blob.sha256, blob.sizeBytes],
    )
    await http()
      .post(`/evidence/${proof.evidence}/signed-prints`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ sha256: blob.sha256 })
      .expect(201)

    expect(await checked(outside)).toEqual({
      pdf: true,
      kept: expect.objectContaining({ kind: 'signed_evidence', title: proof.number }),
      instance: expect.objectContaining({
        state: 'signed_after',
        by: ['Dr. Anna Becker, Prüfstelle Probe GmbH'],
      }),
    })
  })
})

describe('the PDFs of the day with a signature in them', () => {
  it('are signed by the instance: the book of an asset with its evidence behind, and not the book alone', async () => {
    expect(signed(await bytesOf(`/assets/${proof.asset}/book/pdf?attach=1`))).toEqual(byTheInstance)
    expect(signed(await bytesOf(`/assets/${proof.asset}/book/pdf`))).toEqual([])
  })

  it('are signed by the instance: the register of evidence with the evidence behind, and not the register alone', async () => {
    const register = `/duties/evidence-register/pdf?propertyId=${proof.property}`

    expect(signed(await bytesOf(`${register}&attach=1`))).toEqual(byTheInstance)
    expect(signed(await bytesOf(register))).toEqual([])
  })

  it('are signed by the instance: a delegation of duties', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into duty_delegations (tenant_id, delegate_user_id, delegate_name, scope, tasks, powers, starts_on, ends_on)
       values ($1, 'u-duties', 'Jörg Albrecht', 'all', 'Aufgaben.', 'Befugnisse.', '2026-11-01', '2027-10-31')
       returning id`,
      [tenant],
    )
    const delegation = rows[0]?.id ?? ''

    await admin.query(
      'insert into duty_delegation_areas (tenant_id, delegation_id, area_id) values ($1, $2, $3)',
      [tenant, delegation, proof.area],
    )

    expect(signed(await bytesOf(`/delegations/${delegation}/pdf`, 'u-lead'))).toEqual(byTheInstance)
  })

  it('are signed by the instance: the information about a person', async () => {
    expect(
      signed(await bytesOf('/settings/subject-access/people/u-duties?format=pdf', 'u-lead')),
    ).toEqual(byTheInstance)
  })
})

describe('checking a PDF', () => {
  it('names the print it is and says it is unchanged since the instance signed it, and keeps nothing', async () => {
    const before = await filesKept()

    expect(await checked(proof.print)).toEqual({
      pdf: true,
      kept: {
        kind: 'evidence',
        evidenceId: proof.evidence,
        activityId: null,
        title: proof.number,
        keptAt: expect.any(String),
      },
      instance: { state: 'unchanged', signedAt: expect.any(String) },
    })
    expect(await filesKept()).toBe(before)
  })

  it('says a file changed after the signature of the instance, and names no print for it', async () => {
    expect(await checked(changed(proof.print))).toEqual({
      pdf: true,
      kept: null,
      instance: { state: 'changed', signedAt: expect.any(String) },
    })
  })

  it('says a file had something added after the signature, without a signature over it', async () => {
    const added = Buffer.concat([Buffer.from(proof.print), Buffer.from('\n% nachgetragen\n')])
    const notHolding = signedPdf(proof.print, makeSigner('ecdsa'), {
      digestOf: () => Buffer.alloc(32),
    })

    expect((await checked(added)).instance).toMatchObject({ state: 'changed' })
    expect((await checked(notHolding)).instance).toMatchObject({ state: 'changed' })
  })

  it('names a round only to whoever sees the activities', async () => {
    const bytes = await page()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const { rows } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title)
       select tenant_id, property_id, area_id, id, 'inspection', 'Rundgang Halle 1'
         from assets where id = $1
       returning id`,
      [proof.asset],
    )
    const activity = rows[0]?.id ?? ''

    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, 'application/pdf')`,
      [tenant, sha256, bytes.length],
    )
    await admin.query(
      `insert into prints (tenant_id, property_id, area_id, activity_id, sha256)
       select tenant_id, property_id, area_id, id, $2 from activities where id = $1`,
      [activity, sha256],
    )

    expect((await checked(bytes)).kept).toMatchObject({
      kind: 'round',
      activityId: activity,
      title: 'Rundgang Halle 1',
    })

    const evidenceOnly = await http()
      .post('/pdf-checks')
      .set(
        testIdentityHeader,
        JSON.stringify({
          userId: 'u-evidence',
          tenantId: tenant,
          roles: [],
          rights: ['evidence.read'],
        }),
      )
      .set('content-type', 'application/pdf')
      .send(Buffer.from(bytes))
      .expect(200)

    expect((evidenceOnly.body as PdfCheck).kept).toBeNull()
  })

  it('knows no signature of another instance, nor a file without one', async () => {
    const elsewhere = await signPdf(await page(), makeSigner('ecdsa'))

    expect((await checked(elsewhere)).instance).toEqual({ state: 'none' })
    expect(await checked(await page())).toEqual({
      pdf: true,
      kept: null,
      instance: { state: 'none' },
    })
  })

  it('names no print to whoever does not see its area', async () => {
    expect(await checked(proof.print, 'u-south')).toEqual({
      pdf: true,
      kept: null,
      instance: { state: 'unchanged', signedAt: expect.any(String) },
    })
  })

  // Finding of the security review of #507: every byte range used to cost a
  // copy of the whole file, and a crafted file kept the server busy for minutes.
  it('refuses at once a file with more signatures than are checked', async () => {
    const crafted = Buffer.concat([
      Buffer.from('%PDF-<>', 'latin1'),
      Buffer.from(`/ByteRange [0 5 7 1000000]\n`.repeat(60_000), 'latin1'),
    ])
    const started = Date.now()
    const answer = await http()
      .post('/pdf-checks')
      .set(testIdentityHeader, by('u-duties'))
      .set('content-type', 'application/pdf')
      .send(crafted)
      .expect(422)

    expect((answer.body as { message: string }).message).toBe(signedPdfSentences.tooManySignatures)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('is refused without the right to see the evidence, and for a file sent as anything but a PDF', async () => {
    await http()
      .post('/pdf-checks')
      .set(testIdentityHeader, by('u-reporter'))
      .set('content-type', 'application/pdf')
      .send(Buffer.from(proof.print))
      .expect(403)
    await http()
      .post('/pdf-checks')
      .set(testIdentityHeader, by('u-duties'))
      .set('content-type', 'application/json')
      .send({ pdf: 'nein' })
      .expect(415)

    expect(await checked(new TextEncoder().encode('Kein PDF, nur Text'))).toEqual({
      pdf: false,
      kept: null,
      instance: { state: 'none' },
    })
  })
})
