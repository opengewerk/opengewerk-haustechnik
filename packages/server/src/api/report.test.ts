import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  addMonths,
  type CatalogueBundle,
  catalogueOf,
  type DutyDetails,
  type EvidencePage,
  type IsoDate,
  missingRight,
  type RoleKey,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The report of a contractor entered in the office (#110, section 4.4 of the
 * concept): it becomes the evidence of its duty with the examiner, the
 * organisation, the day, the result and the file as it arrived; the next due
 * day counts from the day of the test; an inspection open for the duty is
 * settled by it; and whoever only performs may not enter one. The file is a
 * document at the asset, and the evidence hands it out itself.
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

/** A duty kind of the probe that takes a protocol and no report. */
const protocolOnly = 'probe.elevator_protocol_only'

/** The probe with the main test once more, as a kind that takes a protocol only. */
function withAProtocolOnlyKind(bundle: CatalogueBundle): CatalogueBundle {
  return {
    ...bundle,
    packages: bundle.packages.map((pack) => {
      const main = pack.dutyKinds.find((entry) => entry.key === 'probe.elevator_main_test')

      return main === undefined
        ? pack
        : {
            ...pack,
            dutyKinds: [
              ...pack.dutyKinds,
              {
                ...main,
                key: protocolOnly,
                definition: { ...main.definition, evidence: { kinds: ['protocol'] } },
              },
            ],
          }
    }),
  }
}

let admin: Pool
let database: Database
let app: INestApplication
let folder = ''

const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the operators. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** A PDF by its first bytes, a different one for every word. */
function pdf(word = 'Prüfbericht'): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${word}\n%%EOF\n`, 'utf8')
}

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Sends the bytes of a file ahead of the report, as the office does. */
async function sent(bytes: Buffer, header: string = by('u-site')): Promise<string> {
  const sha256 = hashOf(bytes)

  await http()
    .put(`/files/${sha256}`)
    .set('content-type', 'application/octet-stream')
    .set('x-media-type', 'application/pdf')
    .set(testIdentityHeader, header)
    .send(bytes)
    .expect(200)

  return sha256
}

/** An elevator in a building of a property of its own, made by the Technische Leitung. */
async function elevatorIn(tenantId: TenantId = small, area: string | null = null) {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...(area === null ? {} : { areaId: area }),
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })

  return made(`/buildings/${building}/assets`, { kind: 'probe.elevator', name: 'Aufzug' })
}

/** A duty of the operator's own at the asset, every 12 months from the day it was done. */
async function ownDutyAt(asset: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, performer, performer_note, confirmed_by)
     select tenant_id, property_id, area_id, id, 'Sichtprüfung', 'manufacturer',
            'Betriebsanleitung', 'from_performance', 12, 'contractor',
            'Brandschutz Beispiel GmbH', 'u-duties'
       from assets where id = $1
     returning id`,
    [asset],
  )

  return rows[0]?.id ?? ''
}

/** A duty of a kind from the catalogue at the asset, at most every 24 months. */
async function kindAt(asset: string, kind: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, maximum_months, confirmed_by)
     select tenant_id, property_id, area_id, id, $2, 1, 'betrsichv', 24, 24, 'u-duties'
       from assets where id = $1
     returning id`,
    [asset, kind],
  )

  return rows[0]?.id ?? ''
}

/** An activity that is to meet the duty, at its place, as the engine makes one. */
async function activityFor(duty: string, status = 'open'): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `with activity as (
       insert into activities (tenant_id, property_id, area_id, building_id, room_id, asset_id, kind,
                               title, status, due_on, responsible_user_id, performer,
                               contractor_note, performed_on)
       select tenant_id, property_id, area_id, building_id, room_id, asset_id, 'inspection',
              'Sichtprüfung', $2::activity_status, $3, 'u-duties', 'contractor',
              'Eine andere Firma',
              case when $2::activity_status in ('signed', 'done') then $3::date - 2 end
         from duties where id = $1
       returning id, tenant_id, property_id, area_id
     ), line as (
       insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       select tenant_id, property_id, area_id, id, $1 from activity
     )
     select id from activity`,
    [duty, status, daysAgo(1)],
  )

  return rows[0]?.id ?? ''
}

interface Entered {
  readonly sha256: string
  readonly sizeBytes: number
  readonly fileName?: string
  readonly performedOn?: IsoDate
  readonly result?: string
  readonly resultReason?: string | null
  readonly defects?: readonly object[]
}

/** What the office sends for a report, with defects found by the examiner. */
function reportOf(entered: Entered) {
  return {
    performedOn: entered.performedOn ?? daysAgo(6),
    result: entered.result ?? 'with_defects',
    resultReason: entered.resultReason ?? null,
    examiner: 'Klaus Berger',
    examinerOrganisation: 'Brandschutz Beispiel GmbH',
    file: {
      sha256: entered.sha256,
      fileName: entered.fileName ?? 'bericht-2026-10.pdf',
      sizeBytes: entered.sizeBytes,
      previewSha256: null,
    },
    defects: entered.defects ?? [
      {
        description: 'Wandhalterung locker',
        defectClass: 'allgemein.minor',
        dueOn: addDays(today, 8),
      },
    ],
  }
}

/** A report of a fresh file, entered for the duty by somebody; the answer of the route. */
async function entered(
  duty: string,
  header: string = by('u-site'),
  changes: Partial<Entered> = {},
  word = newId<'file'>(),
) {
  const bytes = pdf(word)
  const sha256 = await sent(bytes, header)

  return http()
    .post(`/duties/${duty}/report`)
    .set(testIdentityHeader, header)
    .send(reportOf({ sha256, sizeBytes: bytes.length, ...changes }))
}

async function pageOf(evidence: string, header: string = by('u-lead')): Promise<EvidencePage> {
  return (await http().get(`/evidence/${evidence}`).set(testIdentityHeader, header).expect(200))
    .body as EvidencePage
}

async function dutyOf(duty: string): Promise<DutyDetails> {
  return (await http().get(`/duties/${duty}`).set(testIdentityHeader, by('u-lead')).expect(200))
    .body as DutyDetails
}

/** How many rows of evidence, documents and defects the operator holds. */
async function written(): Promise<{ evidence: number; documents: number; defects: number }> {
  const { rows } = await admin.query<{ evidence: number; documents: number; defects: number }>(
    `select (select count(*)::int from evidence) as evidence,
            (select count(*)::int from attachments) as documents,
            (select count(*)::int from defects) as defects`,
  )

  return rows[0] ?? { evidence: -1, documents: -1, defects: -1 }
}

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

  // In the large operator the Objektleitung looks after the south and the
  // technician works in the north.
  await admin.query(
    'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3), ($1, $4, $5)',
    [large, 'u-site', south, 'u-tech', north],
  )

  folder = mkdtempSync(join(tmpdir(), 'haustechnik-reports-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        // The packages this build ships stand in front: the general one
        // brings the classes of a defect (#61).
        catalogue: catalogueOf({
          ...probeCatalogueBundle,
          packages: [
            ...catalogueBundle.packages,
            ...withAProtocolOnlyKind(probeCatalogueBundle).packages,
          ],
        }),
        files: new FileStore(folder),
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

describe('the report of a contractor', () => {
  it('becomes an evidence with the examiner, the organisation, the day, the result and the file as it arrived', async () => {
    const asset = await elevatorIn()
    const duty = await ownDutyAt(asset)
    const bytes = pdf('Feuerlöscher')
    const sha256 = await sent(bytes)
    const answer = await http()
      .post(`/duties/${duty}/report`)
      .set(testIdentityHeader, by('u-site'))
      .send(reportOf({ sha256, sizeBytes: bytes.length, fileName: 'bericht-2026-10.pdf' }))
      .expect(201)
    const { state } = await pageOf(answer.body.id)

    expect(answer.body.number).toBe(state.number)
    expect(state).toMatchObject({
      origin: 'report',
      performedOn: daysAgo(6),
      result: 'with_defects',
      resultReason: null,
      activity: null,
      performer: { examiner: 'Klaus Berger', organisation: 'Brandschutz Beispiel GmbH' },
      defects: [
        {
          description: 'Wandhalterung locker',
          defectClass: 'allgemein.minor',
          dueOn: addDays(today, 8),
        },
      ],
      signatures: [],
      files: [{ sha256, name: 'bericht-2026-10.pdf', mediaType: 'application/pdf' }],
      writtenBy: 'Dennis Roth',
    })

    // The file lies at the evidence, as it was sent, for whoever sees the evidence.
    for (const userId of Object.keys(people)) {
      const file = await http()
        .get(`/evidence/${answer.body.id}/files/0`)
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

      expect(file.headers['content-type']).toBe('application/pdf')
      expect(file.headers['content-disposition']).toContain('bericht-2026-10.pdf')
      expect(Buffer.compare(file.body as Buffer, bytes)).toBe(0)
    }

    // And it is a certificate among the documents of the asset, filed by the person.
    const { rows: documents } = await admin.query(
      `select a.title, a.kind, a.asset_id, v.sha256, v.file_name, v.media_type, v.size_bytes,
              v.created_by
         from attachments a join attachment_versions v on v.attachment_id = a.id
        where a.asset_id = $1`,
      [asset],
    )

    expect(documents).toEqual([
      {
        title: 'bericht-2026-10',
        kind: 'test_certificate',
        asset_id: asset,
        sha256,
        file_name: 'bericht-2026-10.pdf',
        media_type: 'application/pdf',
        size_bytes: String(bytes.length),
        created_by: 'u-site',
      },
    ])

    // The defect is found at the asset, on the day of the test.
    const { rows: found } = await admin.query(
      `select asset_id, found_in_activity_id, description, defect_class, found_on::text, due_on::text,
              status
         from defects where asset_id = $1`,
      [asset],
    )

    expect(found).toEqual([
      {
        asset_id: asset,
        found_in_activity_id: null,
        description: 'Wandhalterung locker',
        defect_class: 'allgemein.minor',
        found_on: daysAgo(6),
        due_on: addDays(today, 8),
        status: 'found',
      },
    ])
  })

  it('moves the next due day on from the day of the test, not from the day it was entered', async () => {
    const duty = await ownDutyAt(await elevatorIn())

    expect((await dutyOf(duty)).appointment).toBeNull()

    await entered(duty, by('u-duties'), { performedOn: daysAgo(40) }).then((answer) =>
      expect(answer.status).toBe(201),
    )

    const after = await dutyOf(duty)

    expect(after.lastMetOn).toBe(daysAgo(40))
    expect(after.appointment?.dueOn).toBe(addMonths(daysAgo(40), 12))
    expect(after.appointment?.dueOn).not.toBe(addMonths(today, 12))
  })

  it('leaves the due day where it was for a test that failed or was not performed', async () => {
    const failing = await ownDutyAt(await elevatorIn())

    await entered(failing, by('u-lead'), { performedOn: daysAgo(3), result: 'failed' }).then(
      (answer) => expect(answer.status).toBe(201),
    )
    expect((await dutyOf(failing)).appointment).toBeNull()

    const missed = await ownDutyAt(await elevatorIn())

    await entered(missed, by('u-lead'), {
      result: 'not_performed',
      resultReason: 'Der Raum war verschlossen.',
      defects: [],
    }).then((answer) => expect(answer.status).toBe(201))
    expect((await dutyOf(missed)).appointment).toBeNull()
  })

  it('settles the inspection open for its duty, done by the contractor on the day of the test', async () => {
    const asset = await elevatorIn()
    const duty = await ownDutyAt(asset)
    const activity = await activityFor(duty)
    const answer = await entered(duty)

    expect(answer.status).toBe(201)

    const { state } = await pageOf(answer.body.id)

    expect(state.activity).toEqual({ kind: 'inspection', title: 'Sichtprüfung' })

    const { rows } = await admin.query(
      `select a.status, a.performed_on::text, a.performer, a.performer_user_id, a.contractor_note,
              a.closing_reason, d.result, d.result_reason,
              (select activity_id from evidence where id = $2) as evidence_activity,
              (select found_in_activity_id from defects where asset_id = a.asset_id) as defect_activity
         from activities a join activity_duties d on d.activity_id = a.id
        where a.id = $1`,
      [activity, answer.body.id],
    )

    expect(rows).toEqual([
      {
        status: 'done',
        performed_on: daysAgo(6),
        performer: 'contractor',
        performer_user_id: null,
        contractor_note: 'Brandschutz Beispiel GmbH',
        closing_reason: null,
        result: 'with_defects',
        result_reason: null,
        evidence_activity: activity,
        defect_activity: activity,
      },
    ])
  })

  it('closes the inspection with the reason where the test was not performed', async () => {
    const duty = await ownDutyAt(await elevatorIn())
    const activity = await activityFor(duty)

    await entered(duty, by('u-site'), {
      result: 'not_performed',
      resultReason: 'Der Raum war verschlossen.',
      defects: [],
    }).then((answer) => expect(answer.status).toBe(201))

    const { rows } = await admin.query(
      `select a.status, a.closing_reason, d.result, d.result_reason
         from activities a join activity_duties d on d.activity_id = a.id where a.id = $1`,
      [activity],
    )

    expect(rows).toEqual([
      {
        status: 'not_performed',
        closing_reason: 'Der Raum war verschlossen.',
        result: 'not_performed',
        result_reason: 'Der Raum war verschlossen.',
      },
    ])
  })

  it('takes no inspection from whoever began it, nor one that waits for its evidence, and writes nothing then', async () => {
    for (const [status, sentence] of [
      [
        'started',
        'Für diese Pflicht hat jemand eine Prüfung begonnen. Ein Bericht erledigt nur eine, die noch offen ist.',
      ],
      [
        'signed',
        'Für diese Pflicht ist eine Prüfung unterschrieben und wartet auf ihren Nachweis.',
      ],
    ] as const) {
      const duty = await ownDutyAt(await elevatorIn())
      const activity = await activityFor(duty, status)
      const before = await written()
      const answer = await entered(duty)

      expect(answer.status).toBe(409)
      expect(answer.body.message).toBe(sentence)
      expect(await written()).toEqual(before)

      const { rows } = await admin.query('select status from activities where id = $1', [activity])

      expect(rows).toEqual([{ status }])
    }
  })

  it('is written without an inspection where none is open, and leaves one that is done as it was', async () => {
    const duty = await ownDutyAt(await elevatorIn())
    const done = await activityFor(duty, 'done')
    const answer = await entered(duty)

    expect(answer.status).toBe(201)
    expect((await pageOf(answer.body.id)).state.activity).toBeNull()

    const { rows } = await admin.query(
      `select a.status, a.contractor_note, d.result,
              (select activity_id from evidence where id = $2) as evidence_activity
         from activities a join activity_duties d on d.activity_id = a.id where a.id = $1`,
      [done, answer.body.id],
    )

    expect(rows).toEqual([
      {
        status: 'done',
        contractor_note: 'Eine andere Firma',
        result: null,
        evidence_activity: null,
      },
    ])
  })

  it('is not for whoever only performs, and not for a duty outside the areas of the person', async () => {
    const duty = await ownDutyAt(await elevatorIn())
    const before = await written()
    const refused = await entered(duty, by('u-tech'))

    expect(refused.status).toBe(403)
    expect(refused.body.message).toBe(missingRight('evidence.write'))

    const northern = await ownDutyAt(await elevatorIn(large, north))
    const elsewhere = await entered(northern, by('u-site', large))

    expect(elsewhere.status).toBe(404)
    expect(elsewhere.body.message).toBe('Diese Pflicht gibt es nicht oder nicht mehr.')
    expect(await written()).toEqual(before)
  })

  it('is refused where the duty kind takes no report, where the file did not arrive and where its size is another', async () => {
    const asset = await elevatorIn()
    const before = await written()
    const protocol = await entered(await kindAt(asset, protocolOnly))

    expect(protocol.status).toBe(409)
    expect(protocol.body.message).toBe(
      'Diese Pflichtart nimmt als Nachweis: Unterschriebenes Protokoll.',
    )

    const duty = await ownDutyAt(asset)
    const missing = await http()
      .post(`/duties/${duty}/report`)
      .set(testIdentityHeader, by('u-site'))
      .send(reportOf({ sha256: hashOf(pdf('nie geschickt')), sizeBytes: 10 }))

    expect(missing.status).toBe(409)
    expect(missing.body.message).toBe('Die Datei des Berichts ist nicht auf dem Server.')

    const bytes = pdf('Größe')
    const other = await http()
      .post(`/duties/${duty}/report`)
      .set(testIdentityHeader, by('u-site'))
      .send(reportOf({ sha256: await sent(bytes), sizeBytes: bytes.length + 1 }))

    expect(other.status).toBe(409)
    expect(other.body.message).toBe(
      'Die Größe der Datei passt nicht zu der, die auf dem Server liegt.',
    )
    expect(await written()).toEqual(before)
  })

  it('is refused with the first sentence of what is wrong, a class the catalogue does not know among it', async () => {
    const duty = await ownDutyAt(await elevatorIn())
    const without = await http()
      .post(`/duties/${duty}/report`)
      .set(testIdentityHeader, by('u-site'))
      .send({ ...reportOf({ sha256: 'b'.repeat(64), sizeBytes: 1 }), examiner: ' ' })

    expect(without.status).toBe(400)
    expect(without.body.message).toBe('Ein Bericht nennt den Prüfer.')

    const unknown = await entered(duty, by('u-site'), {
      defects: [{ description: 'Schild fehlt', defectClass: 'allgemein.unknown', dueOn: null }],
    })

    expect(unknown.status).toBe(400)
    expect(unknown.body.message).toBe('Diese Klasse kennt der Katalog nicht.')
  })
})

describe('two reports of one duty', () => {
  it('stand in line at the duty: the second waits for whoever holds it', async () => {
    const duty = await ownDutyAt(await elevatorIn())
    const bytes = pdf('Sperre')
    const sha256 = await sent(bytes)
    const holder = await admin.connect()
    let answered = false

    // As a correction or another report holds it, which a key of the
    // evidence to its duty does not wait for.
    await holder.query('begin')
    await holder.query('select id from duties where id = $1 for no key update', [duty])

    const answer = http()
      .post(`/duties/${duty}/report`)
      .set(testIdentityHeader, by('u-site'))
      .send(reportOf({ sha256, sizeBytes: bytes.length }))
      .then((response) => {
        answered = true

        return response
      })

    try {
      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(answered).toBe(false)
    } finally {
      // Let go whatever happened, so that no later test runs in this transaction.
      await holder.query('commit')
      holder.release()
    }

    expect((await answer).status).toBe(201)
  })
})

describe('the file of an evidence', () => {
  it('stays with the evidence once its document is taken out of the filing, and is nothing by another place', async () => {
    const asset = await elevatorIn()
    const answer = await entered(await ownDutyAt(asset))
    const { rows } = await admin.query<{ id: string; version: string }>(
      `select a.id, v.id as version
         from attachments a join attachment_versions v on v.attachment_id = a.id
        where a.asset_id = $1`,
      [asset],
    )
    const document = rows[0]

    await admin.query('update attachments set deleted_at = now() where id = $1', [document?.id])

    await http()
      .get(`/attachments/versions/${String(document?.version)}/content`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(404)
    await http()
      .get(`/evidence/${answer.body.id}/files/0`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    for (const position of ['1', 'x', '-1', '0.0']) {
      expect(
        (
          await http()
            .get(`/evidence/${answer.body.id}/files/${position}`)
            .set(testIdentityHeader, by('u-lead'))
            .expect(404)
        ).body.message,
      ).toBe('Diese Datei gibt es an diesem Nachweis nicht.')
    }
  })

  it('is handed out to nobody who does not see the evidence', async () => {
    const answer = await entered(
      await ownDutyAt(await elevatorIn(large, north)),
      by('u-lead', large),
    )

    expect(answer.status).toBe(201)

    await http()
      .get(`/evidence/${answer.body.id}/files/0`)
      .set(testIdentityHeader, by('u-site', large))
      .expect(404)
    await http()
      .get(`/evidence/${answer.body.id}/files/0`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(404)
    await http()
      .get(`/evidence/${answer.body.id}/files/0`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(200)
  })

  it('and the defects of a report stay with its correction', async () => {
    const answer = await entered(await ownDutyAt(await elevatorIn()))
    const corrected = await http()
      .post(`/evidence/${answer.body.id}/correction`)
      .set(testIdentityHeader, by('u-site'))
      .send({
        reason: 'Im Bericht steht ein anderer Tag.',
        performedOn: daysAgo(7),
        result: 'with_defects',
        examiner: 'Klaus Berger',
        examinerOrganisation: 'Brandschutz Beispiel GmbH',
      })
      .expect(201)
    const before = (await pageOf(answer.body.id)).state
    const after = (await pageOf(corrected.body.id)).state

    expect(after.defects).toEqual(before.defects)
    expect(after.files).toEqual(before.files)
    expect(after.performedOn).toBe(daysAgo(7))
  })
})
