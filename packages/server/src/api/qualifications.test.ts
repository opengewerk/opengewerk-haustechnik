import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityCandidates,
  addDays,
  type CatalogueBundle,
  catalogueOf,
  type IsoDate,
  missingRight,
  type QualificationEntry,
  type QualificationKindChoice,
  type QualificationList,
  rightsOfRoles,
  type RoleKey,
  shippedRoles,
  type TenantId,
  type WorkOrderCandidates,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inEveryArea } from '../database/every-area.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { qualificationSource } from '../deadlines/sources.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The qualifications of the people who work for the operator (#337, section
 * 4.3 of the concept): looked at by the Leitung, the Technische Leitung and
 * the Objektleitung, kept by the Leitung and the Technische Leitung, the own
 * ones under "Konto" for everybody who works on activities, their expiry a
 * deadline, and the note at the choice of a performer.
 *
 * The probe package asks for no kind a person holds, so the catalogue here
 * gives its main test of an elevator one: a person who carries it out is a
 * "Sachkundiger für Aufzüge".
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  'u-other': { role: 'technician', name: 'Murat Yilmaz' },
  'u-third': { role: 'technician', name: 'Lena Vogt' },
  'u-gone': { role: 'technician', name: 'Gerd Fort' },
}

const liftExpert = 'probe.lift_expert'
const bundle: CatalogueBundle = {
  ...probeCatalogueBundle,
  packages: probeCatalogueBundle.packages.map((pack) =>
    pack.name === 'probe'
      ? {
          ...pack,
          qualifications: [
            {
              qualification: {
                key: liftExpert,
                label: 'Sachkundiger für Aufzüge',
                level: 'skilled_person',
                requiredFor: ['probe.elevator_main_test'],
              },
              review: { checkedOn: '2026-10-17', accepted: null },
            },
          ],
        }
      : pack,
  ),
}
const catalogue = catalogueOf(bundle)
const today = dayInGermany()
const inDays = (days: number): IsoDate => addDays(today, days)

let admin: Pool
let database: Database
let app: INestApplication
let activity = ''
let property = ''
const folder = mkdtempSync(join(tmpdir(), 'qualifications-'))

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId]?.role as RoleKey)
}

async function entered(
  further: Readonly<Record<string, unknown>> = {},
  status = 201,
): Promise<QualificationEntry> {
  return (
    await http()
      .post('/qualifications')
      .set(testIdentityHeader, by('u-duties'))
      .send({ userId: 'u-tech', kind: liftExpert, validUntil: inDays(365), ...further })
      .expect(status)
  ).body as QualificationEntry
}

async function listOf(header: string, path = '/qualifications'): Promise<QualificationList> {
  return (await http().get(path).set(testIdentityHeader, header).expect(200))
    .body as QualificationList
}

async function cleared(): Promise<void> {
  await admin.query(
    'update qualifications set deleted_at = now() where tenant_id = $1 and deleted_at is null',
    [tenant],
  )
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [person.role],
    ])
  }

  await admin.query("update memberships set blocked_at = now() where user_id = 'u-gone'")

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue, files: new FileStore(folder) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  // An elevator with its main test and an open inspection for it.
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, by('u-duties')).send(body).expect(201)).body.id
  property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
  })
  const { rows: duties } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, maximum_months, confirmed_by)
     select tenant_id, property_id, area_id, id, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24,
            'u-duties'
       from assets where id = $1
     returning id`,
    [asset],
  )
  const { rows } = await admin.query<{ id: string }>(
    `with activity as (
       insert into activities (tenant_id, property_id, area_id, building_id, asset_id, kind, title,
                               status, due_on)
       select tenant_id, property_id, area_id, building_id, asset_id, 'inspection',
              'Hauptprüfung der Aufzugsanlage', 'open', $2
         from duties where id = $1
       returning id, tenant_id, property_id, area_id
     ), line as (
       insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       select tenant_id, property_id, area_id, id, $1 from activity
     )
     select id from activity`,
    [duties[0]?.id, inDays(20)],
  )

  activity = rows[0]?.id ?? ''
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('the qualifications', () => {
  it('are looked at by the Leitung, the Technische Leitung and the Objektleitung, and kept by the Leitung and the Technische Leitung', async () => {
    for (const userId of ['u-lead', 'u-duties', 'u-site'] as const) {
      await http().get('/qualifications').set(testIdentityHeader, by(userId)).expect(200)
      await http().get('/qualifications/kinds').set(testIdentityHeader, by(userId)).expect(200)
    }

    expect(
      (await http().get('/qualifications').set(testIdentityHeader, by('u-tech')).expect(403)).body
        .message,
    ).toBe(missingRight('qualification.read'))

    for (const userId of ['u-site', 'u-tech'] as const) {
      expect(
        (
          await http()
            .post('/qualifications')
            .set(testIdentityHeader, by(userId))
            .send({ userId: 'u-tech', kind: liftExpert })
            .expect(403)
        ).body.message,
      ).toBe(missingRight('qualification.write'))
      await http()
        .post('/qualifications/kinds')
        .set(testIdentityHeader, by(userId))
        .send({ label: 'Hygieneschulung', level: 'instructed_person' })
        .expect(403)
    }

    const made = await entered()

    await http()
      .patch(`/qualifications/${made.id}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ validUntil: inDays(10) })
      .expect(403)
    await http()
      .delete(`/qualifications/${made.id}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(403)
    await http()
      .delete(`/qualifications/${made.id}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
  })

  it('name a person who works here and exactly one kind, of the packages or of the operator own', async () => {
    await cleared()
    await entered({ userId: 'u-gone' }, 400)
    await entered({ userId: 'u-nobody' }, 400)
    await entered({ kind: 'probe.unknown' }, 400)
    await entered({ kind: 'own:00000000-0000-7000-8000-000000000000' }, 400)

    const kinds = (await http().get('/qualifications/kinds').set(testIdentityHeader, by('u-lead')))
      .body as QualificationKindChoice[]

    expect(kinds.map((kind) => [kind.key, kind.origin, kind.requiredFor])).toEqual([
      [liftExpert, 'Paket Probepaket', 1],
    ])

    const own = (
      await http()
        .post('/qualifications/kinds')
        .set(testIdentityHeader, by('u-lead'))
        .send({ label: 'Hygieneschulung Trinkwasser', level: 'instructed_person' })
        .expect(201)
    ).body as QualificationKindChoice

    await http()
      .post('/qualifications/kinds')
      .set(testIdentityHeader, by('u-lead'))
      .send({ label: 'hygieneschulung trinkwasser', level: 'instructed_person' })
      .expect(409)

    const held = await entered({ kind: own.key, validUntil: null })

    expect([held.kind.label, held.kind.origin, held.standing]).toEqual([
      'Hygieneschulung Trinkwasser',
      'Eigene Art',
      'valid',
    ])
    // An own kind a qualification names stays.
    await http()
      .delete(`/qualifications/kinds/${own.key.slice('own:'.length)}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(409)
  })

  it('stand valid, ending soon and run out by their last day, and the list counts what ran out', async () => {
    await cleared()
    await entered({ userId: 'u-tech', validUntil: inDays(-1) })
    await entered({ userId: 'u-other', validUntil: inDays(30) })
    await entered({ userId: 'u-third', validUntil: null })

    const list = await listOf(by('u-site'))

    expect(list.qualifications.map((each) => [each.personName, each.standing])).toEqual([
      ['Lena Vogt', 'valid'],
      ['Murat Yilmaz', 'expiring'],
      ['Tobias Wendt', 'expired'],
    ])
    expect([list.expired, list.expiring, list.leadDays]).toEqual([1, 1, 60])
  })

  it('are a deadline at their last day, named by their kind, and none once taken out', async () => {
    await cleared()

    const ending = await entered({ validUntil: inDays(30) })
    const gone = await entered({ userId: 'u-other', validUntil: inDays(40) })

    await entered({ userId: 'u-third', validUntil: null })
    await http()
      .delete(`/qualifications/${gone.id}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    const expected = await inEveryArea(database, { tenantId: tenant, userId: 'u-lead' }, (tx) =>
      qualificationSource({ today: () => today, catalogue })(tx),
    )

    expect(expected.map((each) => [each.sourceId, each.sourceLabel, each.anchorOn])).toEqual([
      [ending.id, 'Sachkundiger für Aufzüge', inDays(30)],
    ])
  })

  it('name the person at their deadline only for whoever looks at qualifications, also in the table', async () => {
    await cleared()
    await entered({ validUntil: inDays(30) })
    await runDeadlinesOf({ database, catalogue, now: () => new Date() }, tenant, new Date())

    const holding = (...rights: string[]) =>
      JSON.stringify({ userId: 'u-lead', tenantId: tenant, roles: ['management'], rights })
    const named = async (...rights: string[]) =>
      (
        (
          await http()
            .get('/deadlines?kind=qualification.expires')
            .set(testIdentityHeader, holding('deadline.read', ...rights))
            .expect(200)
        ).body as { rows: { qualification: { personName: string | null } }[] }
      ).rows.map((row) => row.qualification.personName)
    const table = async (...rights: string[]) =>
      (
        await http()
          .get('/deadlines/table?format=csv&kind=qualification.expires')
          .set(testIdentityHeader, holding('deadline.read', ...rights))
          .expect(200)
      ).text

    expect(await named()).toEqual([null])
    expect(await named('qualification.read')).toEqual(['Tobias Wendt'])
    expect(await table()).not.toContain('Tobias Wendt')
    expect(await table('qualification.read')).toContain('Sachkundiger für Aufzüge, Tobias Wendt')
  })

  it('take as a certificate only a PDF or an image the operator keeps, and no other file of it', async () => {
    await cleared()

    // A file of the operator that came another way, a table of a document for one.
    const other = createHash('sha256').update('eine Tabelle').digest('hex')

    await admin.query(
      'insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, $4)',
      [tenant, other, 12, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    )

    const refusal = (answer: object) => (answer as { message: string }).message

    expect(refusal(await entered({ certificateSha256: other }, 400))).toBe(
      'Ein Nachweis ist ein PDF oder ein Bild.',
    )
    expect(
      refusal(
        await entered(
          { certificateSha256: createHash('sha256').update('fehlt').digest('hex') },
          400,
        ),
      ),
    ).toBe('Der Nachweis wird zuerst hochgeladen und dann mit seiner Prüfsumme genannt.')

    const held = await entered()

    await http()
      .patch(`/qualifications/${held.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ certificateSha256: other })
      .expect(400)
    expect(
      (await listOf(by('u-lead'))).qualifications.find((each) => each.id === held.id)
        ?.hasCertificate,
    ).toBe(false)
  })

  it('hand the own ones to the person, and the certificate to the person and whoever looks at them', async () => {
    await cleared()

    const bytes = Buffer.from('%PDF-1.4\n% Bestellung\n')
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    await http()
      .put(`/qualifications/certificates/${sha256}`)
      .set(testIdentityHeader, by('u-duties'))
      .set('Content-Type', 'application/octet-stream')
      .set('X-Media-Type', 'application/pdf')
      .send(bytes)
      .expect(200)

    const mine = await entered({ certificateSha256: sha256 })
    const theirs = await entered({ userId: 'u-other', certificateSha256: sha256 })

    expect(
      (await listOf(by('u-tech'), '/qualifications/mine')).qualifications.map((each) => each.id),
    ).toEqual([mine.id])
    expect(mine.hasCertificate).toBe(true)
    await http()
      .get(`/qualifications/${mine.id}/certificate`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)
    await http()
      .get(`/qualifications/${theirs.id}/certificate`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(403)
    await http()
      .get(`/qualifications/${theirs.id}/certificate`)
      .set(testIdentityHeader, by('u-site'))
      .expect(200)
  })

  it('reach the device of their own person and of nobody else, also of whoever sees everything', async () => {
    await cleared()

    const mine = await entered()

    await entered({ userId: 'u-other' })

    const pulled = async (userId: keyof typeof people & string) =>
      (
        (await http().get('/sync?since=0').set(testIdentityHeader, by(userId)).expect(200))
          .body as {
          changes: { entity: string; rows: { id: string; deletedAt: unknown }[] }[]
        }
      ).changes
        .filter((change) => change.entity === 'qualifications')
        // Those taken out by the tests before stand as taken out.
        .flatMap((change) =>
          change.rows.filter((row) => row.deletedAt === null).map((row) => row.id),
        )

    expect(await pulled('u-tech')).toEqual([mine.id])
    expect(await pulled('u-lead')).toEqual([])
  })

  it('note at the choice of a performer what of the kind the duties ask for is missing or ran out, for whoever looks at them', async () => {
    await cleared()
    await entered({ userId: 'u-tech', validUntil: inDays(100) })
    await entered({ userId: 'u-other', validUntil: inDays(-3) })

    const offered = (
      await http()
        .get(`/activities/${activity}/candidates`)
        .set(testIdentityHeader, by('u-site'))
        .expect(200)
    ).body as ActivityCandidates

    expect(offered.hints).toEqual({
      'u-other': { kindLabel: 'Sachkundiger für Aufzüge', check: 'expired', expiredOn: inDays(-3) },
      'u-third': { kindLabel: 'Sachkundiger für Aufzüge', check: 'missing', expiredOn: null },
      'u-site': { kindLabel: 'Sachkundiger für Aufzüge', check: 'missing', expiredOn: null },
      'u-duties': { kindLabel: 'Sachkundiger für Aufzüge', check: 'missing', expiredOn: null },
      'u-lead': { kindLabel: 'Sachkundiger für Aufzüge', check: 'missing', expiredOn: null },
    })
    // The same for a work order made for the duty, and nothing without a duty.
    const forOrder = (
      await http()
        .get(`/work-orders/candidates?property=${property}&order=${activity}`)
        .set(testIdentityHeader, by('u-site'))
        .expect(200)
    ).body as WorkOrderCandidates

    expect(forOrder.hints?.['u-other']?.check).toBe('expired')
    expect(forOrder.hints?.['u-tech']).toBeUndefined()

    const plain = (
      await http()
        .get(`/work-orders/candidates?property=${property}`)
        .set(testIdentityHeader, by('u-site'))
        .expect(200)
    ).body as WorkOrderCandidates

    expect(plain.hints).toEqual({})
    // Whoever plans without looking at qualifications is told nothing of them.
    const planning = [...rightsOfRoles(['site_management'])].filter(
      (right) => right !== 'qualification.read',
    )
    const blind = (
      await http()
        .get(`/activities/${activity}/candidates`)
        .set(
          testIdentityHeader,
          JSON.stringify({
            userId: 'u-site',
            tenantId: tenant,
            roles: ['site_management'],
            rights: planning,
          }),
        )
        .expect(200)
    ).body as ActivityCandidates

    expect(blind.hints).toEqual({})
  })
})
