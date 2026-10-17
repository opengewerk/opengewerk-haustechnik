import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type EvidencePage,
  type IsoDate,
  type RoleKey,
  shippedRoles,
  type SignedPrint,
  signedPrintWords,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
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
import { signedPdfSentences } from '../evidence/signed-pdf.js'
import { makeSigner, signedPdf } from '../evidence/test-signed-pdf.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The PDF of an evidence with a higher signature (#341, section 2.6 of the
 * concept; decided on 15.10.2026: only taken, signed outside): filed at the
 * evidence by whoever enters evidence, when it is the PDF of this evidence
 * signed over the whole of it; handed out as it was filed; kept as written,
 * and gone with its evidence after the end of the retention (#340). The
 * evidence does not change by it.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-tech': 'technician',
}

const catalogue = catalogueOf(probeCatalogueBundle)

let admin: Pool
let database: Database
let app: INestApplication
const folder = mkdtempSync(join(tmpdir(), 'signed-prints-'))
const store = new FileStore(folder)

/** An evidence with its print, one of another duty with its print, and one without. */
const proof = { printed: '', other: '', unprinted: '' }
const printOf: { printed: Uint8Array; other: Uint8Array } = {
  printed: new Uint8Array(),
  other: new Uint8Array(),
}

function http() {
  return request(app.getHttpServer())
}

function by(userId: string): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

/** Bytes into the store and a row in `files`, as an upload leaves them. */
async function uploaded(bytes: Uint8Array): Promise<string> {
  const blob = await store.put(bytes)

  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, 'application/pdf')
     on conflict do nothing`,
    [tenant, blob.sha256, blob.sizeBytes],
  )

  return blob.sha256
}

async function evidenceOf(dutyId: string, performedOn: string): Promise<string> {
  const number = nextEvidenceNumber()
  const state = leastState(number, performedOn as IsoDate, 'without_defects')
  const { rows } = await admin.query<{ id: string }>(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result, number, origin,
                           examiner, examiner_organisation, written_by, state, fingerprint)
     select tenant_id, property_id, area_id, id, $2, 'without_defects', $3, 'report',
            'Erika Muster', 'Prüfstelle Süd', 'u-duties', $4, $5
       from duties where id = $1
     returning id`,
    [dutyId, performedOn, number, JSON.stringify(state), stateFingerprint(state)],
  )

  return rows[0]?.id ?? ''
}

/** A print of the evidence, as its first PDF leaves it. */
async function printed(evidenceId: string, title: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(
    Buffer.from(`%PDF-1.7\n% ${title}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`, 'latin1'),
  )
  const sha256 = await uploaded(bytes)

  await admin.query(
    `insert into prints (tenant_id, property_id, area_id, evidence_id, sha256)
     select tenant_id, property_id, area_id, id, $2 from evidence where id = $1`,
    [evidenceId, sha256],
  )

  return bytes
}

const filing = (evidenceId: string, sha256: string, userId = 'u-duties') =>
  http()
    .post(`/evidence/${evidenceId}/signed-prints`)
    .set(testIdentityHeader, by(userId))
    .send({ sha256 })

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
      userId === 'u-duties' ? 'Jörg Albrecht' : userId,
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
    imports: [ApiModule.create(database, testIdentities, { catalogue, files: store })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  const made = async (path: string, body: object): Promise<string> => {
    const answer = await http().post(path).set(testIdentityHeader, by('u-duties')).send(body)

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
  const dutyAt = async (name: string) => {
    const asset = await made(`/buildings/${building}/assets`, { kind: 'probe.elevator', name })

    return (
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
    )
  }
  const first = await dutyAt('Aufzug A')

  proof.printed = await evidenceOf(first, '2021-05-03')
  proof.other = await evidenceOf(await dutyAt('Aufzug B'), '2025-05-03')
  proof.unprinted = await evidenceOf(await dutyAt('Aufzug C'), '2025-06-03')
  printOf.printed = await printed(proof.printed, 'NW A')
  printOf.other = await printed(proof.other, 'NW B')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('a PDF with a higher signature (#341)', () => {
  it('is filed when it is the PDF of this evidence signed over the whole of it, and the evidence stays as it is', async () => {
    const before = (
      await admin.query('select state, fingerprint from evidence where id = $1', [proof.printed])
    ).rows[0]
    const signed = signedPdf(printOf.printed, makeSigner('rsa'))
    const sha256 = await uploaded(signed)

    expect((await filing(proof.printed, sha256).expect(201)).body as SignedPrint).toMatchObject({
      signer: 'Dr. Anna Becker, Prüfstelle Probe GmbH',
      issuer: 'Dr. Anna Becker, Prüfstelle Probe GmbH',
      signedAt: '2026-10-04T08:12:00.000Z',
      filedBy: 'Jörg Albrecht',
    })
    expect(
      (await admin.query('select state, fingerprint from evidence where id = $1', [proof.printed]))
        .rows[0],
    ).toEqual(before)

    const page = (
      await http()
        .get(`/evidence/${proof.printed}`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as EvidencePage

    expect(page.signedPrints).toHaveLength(1)

    const handed = await http()
      .get(`/evidence/${proof.printed}/signed-prints/${page.signedPrints[0]?.id ?? ''}`)
      .set(testIdentityHeader, by('u-tech'))
      .buffer(true)
      .parse((answer, done) => {
        const chunks: Buffer[] = []

        answer.on('data', (chunk: Buffer) => chunks.push(chunk))
        answer.on('end', () => {
          done(null, Buffer.concat(chunks))
        })
      })
      .expect(200)

    expect(Buffer.compare(handed.body as Buffer, Buffer.from(signed))).toBe(0)
    // Not at another evidence.
    await http()
      .get(`/evidence/${proof.other}/signed-prints/${page.signedPrints[0]?.id ?? ''}`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(404)
    // And the same file once.
    expect((await filing(proof.printed, sha256).expect(409)).body.message).toBe(
      signedPrintWords.twice,
    )
  })

  it('is refused when it is not the PDF of this evidence, was changed after signing, or is not there', async () => {
    const ofTheOther = await uploaded(signedPdf(printOf.other, makeSigner('ecdsa')))
    const added = await uploaded(
      new Uint8Array(
        Buffer.concat([
          Buffer.from(signedPdf(printOf.printed, makeSigner('rsa'))),
          Buffer.from('\n% danach\n', 'latin1'),
        ]),
      ),
    )

    expect((await filing(proof.printed, ofTheOther).expect(422)).body.message).toBe(
      signedPdfSentences.notThisEvidence,
    )
    expect((await filing(proof.printed, added).expect(422)).body.message).toBe(
      signedPdfSentences.changedAfter,
    )
    expect((await filing(proof.unprinted, ofTheOther).expect(409)).body.message).toBe(
      signedPrintWords.noPrint,
    )
    expect((await filing(proof.printed, 'f'.repeat(64)).expect(400)).body.message).toBe(
      signedPrintWords.missingFile,
    )
  })

  it('is filed by whoever enters evidence and by nobody else', async () => {
    const sha256 = await uploaded(signedPdf(printOf.other, makeSigner('rsa')))

    await filing(proof.other, sha256, 'u-tech').expect(403)
    await filing(proof.other, sha256, 'u-lead').expect(201)
  })

  it('is kept as written, and goes with its evidence after the end of the retention (#340)', async () => {
    const refusal = async (statement: ReturnType<typeof sql>) => {
      try {
        await database.forTenant({ tenantId: tenant, userId: 'u-lead' }, (tx) =>
          tx.execute(statement),
        )
      } catch (error) {
        return (error as { cause?: { code?: string } }).cause?.code
      }

      return 'written'
    }

    expect(
      await refusal(sql`delete from evidence_signed_prints where evidence_id = ${proof.printed}`),
    ).toBe('HT005')
    expect(
      await refusal(
        sql`update evidence_signed_prints set signer = 'Jemand' where evidence_id = ${proof.printed}`,
      ),
    ).not.toBe('written')
    await expect(
      admin.query('delete from evidence_signed_prints where evidence_id = $1', [proof.printed]),
    ).rejects.toMatchObject({ code: 'HT005' })

    // A later inspection ends the retention of the first; whoever leads confirms.
    await evidenceOf(
      (
        await admin.query<{ duty_id: string }>('select duty_id from evidence where id = $1', [
          proof.printed,
        ])
      ).rows[0]?.duty_id ?? '',
      '2022-05-03',
    )
    await http()
      .post('/settings/evidence-retention/emptyings')
      .set(testIdentityHeader, by('u-lead'))
      .send({ evidenceIds: [proof.printed] })
      .expect(201)

    expect(
      (
        await admin.query(
          'select count(*)::int as n from evidence_signed_prints where evidence_id = $1',
          [proof.printed],
        )
      ).rows[0],
    ).toEqual({ n: 0 })
    // And at the shell nothing more is filed.
    expect(
      (
        await filing(
          proof.printed,
          await uploaded(signedPdf(printOf.printed, makeSigner('rsa'))),
        ).expect(409)
      ).body.message,
    ).toBe('Dieser Nachweis ist nach Ablauf seiner Aufbewahrung gelöscht.')
  })
})
