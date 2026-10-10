import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type AssetEvidenceEntry,
  catalogueOf,
  type DutyDetails,
  type EvidencePage,
  type EvidenceState,
  type IsoDate,
  type RoundRecordState,
  missingRight,
  type Right,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { createHash } from 'node:crypto'

import {
  Database,
  type FileStorage,
  newId,
  type PrintJob,
  RendererUnavailableError,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { noRenderer } from './prints.controller.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The page of an evidence, its correction and its declaration of invalidity,
 * and the evidence of an asset (#109, 2.6 of the concept, ADR 0004, points 14
 * to 16): the page reads the frozen state; a correction is a new evidence
 * that names the old one, which stays as it was; an evidence declared
 * invalid counts no more, and its duty is due as if it had never been; the
 * Haustechnik may do neither; and a correction and a declaration of the same
 * evidence at the same moment do not both go through.
 *
 * Evidence is put in past the application, as the tests of the register do:
 * the ways it comes about have their own tests.
 */

/** One area, as most tenants have it. */
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

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** A header for the technician with exactly these rights: one that carries rights is taken at its word. */
function holding(...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId: small, roles: ['technician'], rights })
}

/** The file a report rests on, as its frozen state names it. */
const report = { sha256: 'a'.repeat(64), name: 'pruefbericht.pdf', mediaType: 'application/pdf' }

/** What the renderer was handed, newest last; each answer is a PDF of its own. */
const rendered: PrintJob[] = []
let renderer: (job: PrintJob) => Promise<Uint8Array> = (job) => {
  rendered.push(job)

  return Promise.resolve(new TextEncoder().encode(`%PDF probe ${String(rendered.length)}`))
}

/** The content addressed store, in memory. */
const kept = new Map<string, Uint8Array>()
const store: FileStorage = {
  put: (bytes) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    kept.set(sha256, bytes)

    return Promise.resolve({ sha256, sizeBytes: bytes.byteLength })
  },
  get: (sha256) => {
    const bytes = kept.get(sha256)

    return bytes === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(bytes)
  },
}

/** An asset in a building of a property of its own, with a duty of a year at it. */
async function assetWithDuty(
  tenantId: TenantId = small,
  area: string | null = null,
): Promise<{ readonly asset: string; readonly duty: string }> {
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
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
  })

  return { asset, duty: await dutyAt(asset) }
}

/** A duty of the operator's own at an asset, of a year and counted from the day it was done. */
async function dutyAt(asset: string, label = 'Sichtprüfung'): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     select tenant_id, property_id, area_id, id, $2, 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-duties'
       from assets where id = $1
     returning id`,
    [asset, label],
  )

  return rows[0]?.id ?? ''
}

interface Put {
  readonly origin?: 'report' | 'legacy'
  readonly performedBy?: string
  readonly signed?: boolean
  /** What was said with the result, since the fourth version of the state (#108). */
  readonly remark?: string
}

/**
 * An evidence of a duty on a day, put in past the application: a report of an
 * examiner with its file and, on request, a signature, or one taken over
 * from an earlier application with a person of the operator. Answers its id
 * and its state.
 */
async function evidenceOf(
  duty: string,
  performedOn: IsoDate,
  put: Put = {},
): Promise<{ readonly id: string; readonly state: EvidenceState }> {
  const number = nextEvidenceNumber()
  const origin = put.origin ?? 'report'
  const state: EvidenceState = {
    ...leastState(number, performedOn, 'without_defects'),
    origin,
    remark: put.remark ?? null,
    performer:
      put.performedBy === undefined
        ? { examiner: 'Erika Muster', organisation: 'Prüfstelle Süd' }
        : { person: people[put.performedBy]?.name ?? '' },
    signatures:
      put.signed === true
        ? [
            {
              name: 'Erika Muster',
              role: 'signer',
              signedAt: '2026-10-01T07:42:00.000Z',
              path: null,
              way: 'drawing',
              receivedAt: null,
            },
          ]
        : [],
    files: [report],
  }
  const { rows } = await admin.query<{ id: string }>(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           number, origin, performed_by, examiner, examiner_organisation,
                           written_by, state, fingerprint)
     select tenant_id, property_id, area_id, id, $2::date, 'without_defects', $3,
            $4::evidence_origin, $5, $6, $7, 'u-duties', $8, $9
       from duties where id = $1
     returning id`,
    [
      duty,
      performedOn,
      number,
      origin,
      put.performedBy ?? null,
      put.performedBy === undefined ? 'Erika Muster' : null,
      put.performedBy === undefined ? 'Prüfstelle Süd' : null,
      JSON.stringify(state),
      stateFingerprint(state),
    ],
  )

  return { id: rows[0]?.id ?? '', state }
}

/** The page of an evidence, as the Leitung reads it. */
async function pageOf(evidence: string): Promise<EvidencePage> {
  return (
    await http().get(`/evidence/${evidence}`).set(testIdentityHeader, by('u-lead')).expect(200)
  ).body as EvidencePage
}

/** The page of a duty, with its appointment and the last day it was met. */
async function dutyPage(duty: string): Promise<DutyDetails> {
  return (await http().get(`/duties/${duty}`).set(testIdentityHeader, by('u-lead')).expect(200))
    .body as DutyDetails
}

/** A row of the evidence as the database holds it, to see that nothing changed it. */
async function rowOf(evidence: string): Promise<unknown> {
  const { rows } = await admin.query('select * from evidence where id = $1', [evidence])

  return rows[0]
}

/** A correction a day ago by the Objektleitung, as a report names its examiner. */
const corrected = {
  reason: 'Im Bericht steht ein anderer Tag der Prüfung.',
  performedOn: daysAgo(1),
  result: 'with_defects',
  examiner: 'Klaus Berger',
  examinerOrganisation: 'Brandschutz Beispiel GmbH',
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

  // In the large tenant the technician works in the north.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-tech',
    north,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        files: store,
        renderer: (job) => renderer(job),
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
})

describe('the page of an evidence', () => {
  it('reads the frozen state with the fingerprint over it, for every role that sees evidence', async () => {
    const { asset, duty } = await assetWithDuty()
    const { id, state } = await evidenceOf(duty, daysAgo(20), { signed: true })

    for (const userId of Object.keys(people)) {
      const page = (
        await http().get(`/evidence/${id}`).set(testIdentityHeader, by(userId)).expect(200)
      ).body as EvidencePage

      expect(page).toMatchObject({
        id,
        number: state.number,
        dutyId: duty,
        state,
        fingerprint: stateFingerprint(state),
        standing: 'counts',
        replaces: null,
        replacedBy: null,
        voiding: null,
      })
      expect(page.place.assetId).toBe(asset)
    }
  })

  it('is not there beyond the areas of the person asking, in another tenant or for no id', async () => {
    const { duty } = await assetWithDuty(large, south)
    const { id } = await evidenceOf(duty, daysAgo(20))

    await http().get(`/evidence/${id}`).set(testIdentityHeader, by('u-lead', large)).expect(200)
    await http().get(`/evidence/${id}`).set(testIdentityHeader, by('u-tech', large)).expect(404)
    await http().get(`/evidence/${id}`).set(testIdentityHeader, by('u-lead')).expect(404)
    await http().get('/evidence/no-id').set(testIdentityHeader, by('u-lead')).expect(404)
    expect(
      (
        await http()
          .get(`/evidence/${id}`)
          .set(testIdentityHeader, holding('duty.read', 'asset.read'))
          .expect(403)
      ).body.message,
    ).toBe(missingRight('evidence.read'))
    await http()
      .post(`/evidence/${id}/voiding`)
      .set(testIdentityHeader, by('u-site', large))
      .send({ reason: 'Falsches Gebäude.' })
      .expect(404)
  })
})

describe('a correction', () => {
  it('is a new evidence of the duty that names the old one, which stays as it was', async () => {
    const { duty } = await assetWithDuty()
    const old = await evidenceOf(duty, daysAgo(2), { signed: true })
    const before = await rowOf(old.id)
    const made = (
      await http()
        .post(`/evidence/${old.id}/correction`)
        .set(testIdentityHeader, by('u-site'))
        .send(corrected)
        .expect(201)
    ).body as { id: string; number: string }
    const page = await pageOf(made.id)

    expect(page.dutyId).toBe(duty)
    expect(page.state).toMatchObject({
      number: made.number,
      origin: 'report',
      performedOn: corrected.performedOn,
      result: 'with_defects',
      replaces: { number: old.state.number, reason: corrected.reason },
      performer: { examiner: 'Klaus Berger', organisation: 'Brandschutz Beispiel GmbH' },
      // The signature was given to the page of the old evidence and stays there.
      signatures: [],
      files: [report],
      writtenBy: 'Dennis Roth',
    })
    expect(page.replaces).toEqual({ id: old.id, number: old.state.number })
    expect(page.standing).toBe('counts')

    const oldPage = await pageOf(old.id)

    expect(oldPage.standing).toBe('replaced')
    expect(oldPage.replacedBy).toEqual(made)
    expect(oldPage.state).toEqual(old.state)
    expect(await rowOf(old.id)).toEqual(before)
    // The appointment counts from the corrected day.
    expect((await dutyPage(duty)).lastMetOn).toBe(corrected.performedOn)
  })

  it('takes who performed it and what was said with the result from the evidence it replaces, where that is no report', async () => {
    const { duty } = await assetWithDuty()
    const old = await evidenceOf(duty, daysAgo(40), {
      origin: 'legacy',
      performedBy: 'u-tech',
      remark: 'Filter gespült.',
    })
    const header = by('u-duties')
    const plain = { reason: 'Falscher Tag übernommen.', performedOn: daysAgo(41), result: 'failed' }

    expect(
      (
        await http()
          .post(`/evidence/${old.id}/correction`)
          .set(testIdentityHeader, header)
          .send({ ...plain, examiner: 'Klaus Berger', examinerOrganisation: 'Prüfstelle' })
          .expect(400)
      ).body.message,
    ).toBe('Prüfer und Organisation nennt nur ein Bericht.')

    const made = (
      await http()
        .post(`/evidence/${old.id}/correction`)
        .set(testIdentityHeader, header)
        .send(plain)
        .expect(201)
    ).body as { id: string }
    const { rows } = await admin.query<{ performed_by: string | null; examiner: string | null }>(
      'select performed_by, examiner from evidence where id = $1',
      [made.id],
    )

    expect(rows[0]).toEqual({ performed_by: 'u-tech', examiner: null })
    expect((await pageOf(made.id)).state).toMatchObject({
      origin: 'legacy',
      result: 'failed',
      performer: { person: 'Tobias Wendt' },
      remark: 'Filter gespült.',
    })
  })

  it('says what is missing, and a day to come is refused', async () => {
    const { duty } = await assetWithDuty()
    const old = await evidenceOf(duty, daysAgo(5))
    const refused = async (body: object) =>
      (
        await http()
          .post(`/evidence/${old.id}/correction`)
          .set(testIdentityHeader, by('u-site'))
          .send(body)
          .expect(400)
      ).body.message as string

    expect(await refused({ ...corrected, reason: ' ' })).toBe(
      'Eine Berichtigung nennt ihren Grund.',
    )
    expect(await refused({ ...corrected, performedOn: addDays(today, 1) })).toBe(
      'Ein Nachweis gilt für einen Tag, der schon war.',
    )
    expect(await refused({ ...corrected, examiner: '' })).toBe(
      'Prüfer und Organisation stehen zusammen: wer von außen prüft, nennt beide.',
    )
    expect(await refused({ ...corrected, examiner: '', examinerOrganisation: '' })).toBe(
      'Ein Bericht nennt den Prüfer.',
    )
    expect(await refused({ ...corrected, result: 'not_performed', resultReason: null })).toBe(
      'Was nicht durchgeführt wurde, nennt den Grund.',
    )
    expect((await pageOf(old.id)).standing).toBe('counts')
  })

  it('is refused for an evidence corrected or declared invalid before, with a sentence', async () => {
    const { duty } = await assetWithDuty()
    const once = await evidenceOf(duty, daysAgo(30))
    const voided = await evidenceOf(duty, daysAgo(10))
    const correct = (id: string) =>
      http().post(`/evidence/${id}/correction`).set(testIdentityHeader, by('u-site'))
    const first = (await correct(once.id).send(corrected).expect(201)).body as { number: string }

    expect((await correct(once.id).send(corrected).expect(409)).body.message).toBe(
      `Dieser Nachweis ist schon berichtigt, mit ${first.number}; berichtigt wird dann die Berichtigung.`,
    )

    await http()
      .post(`/evidence/${voided.id}/voiding`)
      .set(testIdentityHeader, by('u-site'))
      .send({ reason: 'Falsches Gebäude.' })
      .expect(201)

    expect((await correct(voided.id).send(corrected).expect(409)).body.message).toBe(
      'Ein für ungültig erklärter Nachweis wird nicht berichtigt.',
    )
  })
})

describe('a declaration of invalidity', () => {
  it('names the person and the reason, and the duty is due as if the evidence had never been', async () => {
    const { asset, duty } = await assetWithDuty()
    const earlier = daysAgo(400)
    const later = daysAgo(100)

    await evidenceOf(duty, earlier)

    const wrong = await evidenceOf(duty, later)
    // The same duty at the same asset, met only on the earlier day.
    const twin = await dutyAt(asset, 'Zwilling')

    await evidenceOf(twin, earlier)

    // And a duty whose only evidence is declared invalid, beside one never met.
    const lone = await dutyAt(asset, 'Einzeln')
    const never = await dutyAt(asset, 'Nie')
    const only = await evidenceOf(lone, later)

    expect((await dutyPage(duty)).lastMetOn).toBe(later)

    const before = await rowOf(wrong.id)

    for (const id of [wrong.id, only.id]) {
      expect(
        (
          await http()
            .post(`/evidence/${id}/voiding`)
            .set(testIdentityHeader, by('u-duties'))
            .send({ reason: 'Die Werte gehören zur Mensa.' })
            .expect(201)
        ).body,
      ).toEqual({ id, number: expect.any(String) as string })
    }

    const page = await pageOf(wrong.id)

    expect(page.standing).toBe('voided')
    expect(page.voiding).toEqual({
      reason: 'Die Werte gehören zur Mensa.',
      voidedBy: 'Jörg Albrecht',
      voidedAt: expect.any(String) as string,
    })
    expect(page.state).toEqual(wrong.state)
    expect(await rowOf(wrong.id)).toEqual(before)

    const met = await dutyPage(duty)
    const asTwin = await dutyPage(twin)

    expect(met.lastMetOn).toBe(earlier)
    expect([met.state, met.appointment]).toEqual([asTwin.state, asTwin.appointment])

    const alone = await dutyPage(lone)
    const asNever = await dutyPage(never)

    expect(alone.lastMetOn).toBeNull()
    expect([alone.state, alone.appointment]).toEqual([asNever.state, asNever.appointment])
  })

  it('is refused a second time and for an evidence a correction replaced', async () => {
    const { duty } = await assetWithDuty()
    const once = await evidenceOf(duty, daysAgo(30))
    const replaced = await evidenceOf(duty, daysAgo(60))
    const declare = (id: string) =>
      http()
        .post(`/evidence/${id}/voiding`)
        .set(testIdentityHeader, by('u-site'))
        .send({ reason: 'Falsches Gebäude.' })

    await declare(once.id).expect(201)

    expect((await declare(once.id).expect(409)).body.message).toBe(
      'Dieser Nachweis ist schon für ungültig erklärt.',
    )

    const correction = (
      await http()
        .post(`/evidence/${replaced.id}/correction`)
        .set(testIdentityHeader, by('u-site'))
        .send(corrected)
        .expect(201)
    ).body as { number: string }

    expect((await declare(replaced.id).expect(409)).body.message).toBe(
      `Dieser Nachweis ist mit ${correction.number} berichtigt; für ungültig erklärt wird dann die Berichtigung.`,
    )
    expect(
      (
        await http()
          .post(`/evidence/${once.id}/voiding`)
          .set(testIdentityHeader, by('u-site'))
          .send({ reason: '' })
          .expect(400)
      ).body.message,
    ).toBe('Eine Ungültigerklärung nennt ihren Grund.')
  })
})

describe('who corrects and declares invalid', () => {
  it.each([
    ['u-lead', 201],
    ['u-duties', 201],
    ['u-site', 201],
    ['u-tech', 403],
  ] as const)(
    'answers %s with %i: correcting and declaring invalid is for whoever enters evidence',
    async (userId, status) => {
      const { duty } = await assetWithDuty()
      const toCorrect = await evidenceOf(duty, daysAgo(50))
      const toVoid = await evidenceOf(duty, daysAgo(20))
      const header = by(userId)
      const answers = [
        await http()
          .post(`/evidence/${toCorrect.id}/correction`)
          .set(testIdentityHeader, header)
          .send(corrected)
          .expect(status),
        await http()
          .post(`/evidence/${toVoid.id}/voiding`)
          .set(testIdentityHeader, header)
          .send({ reason: 'Falsches Gebäude.' })
          .expect(status),
      ]
      const { rows } = await admin.query<{ corrections: number; voidings: number }>(
        `select (select count(*)::int from evidence where replaces_evidence_id = $1) as corrections,
              (select count(*)::int from evidence_voidings where evidence_id = $2) as voidings`,
        [toCorrect.id, toVoid.id],
      )

      expect(rows[0]).toEqual(
        status === 201 ? { corrections: 1, voidings: 1 } : { corrections: 0, voidings: 0 },
      )

      if (status === 403) {
        for (const answer of answers) {
          expect(answer.body.message).toBe(missingRight('evidence.write'))
        }
      }
    },
  )
})

describe('a correction and a declaration of invalidity at the same moment', () => {
  type Answer = { status: number; body: { message?: string } }

  /** Until this many requests wait for a lock, or `done` says one of them has answered. */
  async function waitingFor(count: number, done: () => boolean = () => false): Promise<void> {
    for (let tries = 0; tries < 400 && !done(); tries += 1) {
      const { rows } = await admin.query<{ waiting: number }>(
        `select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
      )

      if ((rows[0]?.waiting ?? 0) >= count) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  /**
   * A third connection holds a row while the first request comes up against
   * it, then sends the second, and lets go once the second waits as well or
   * has answered. Both requests have to meet at the check for a test to show
   * anything, and two that merely start together meet only when the timing
   * allows.
   */
  async function whileHeld(
    hold: string,
    values: readonly unknown[],
    first: () => Promise<Answer>,
    second: () => Promise<Answer>,
  ): Promise<[Answer, Answer]> {
    const holder = await admin.connect()

    try {
      await holder.query('begin')
      await holder.query(hold, [...values])

      const one = first()

      await waitingFor(1)

      let answered = false
      const two = second().then((answer) => {
        answered = true

        return answer
      })

      await waitingFor(2, () => answered)
      await holder.query('commit')

      return [await one, await two]
    } finally {
      holder.release()
    }
  }

  const correcting = (id: string) => () =>
    http()
      .post(`/evidence/${id}/correction`)
      .set(testIdentityHeader, by('u-site'))
      .send(corrected)
      .then((answer): Answer => answer)
  const declaring = (id: string) => () =>
    http()
      .post(`/evidence/${id}/voiding`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ reason: 'Falsches Gebäude.' })
      .then((answer): Answer => answer)

  /** How many corrections and declarations of invalidity name this evidence. */
  async function takenOf(id: string): Promise<number> {
    const { rows } = await admin.query<{ taken: number }>(
      `select (select count(*)::int from evidence where replaces_evidence_id = $1)
            + (select count(*)::int from evidence_voidings where evidence_id = $1) as taken`,
      [id],
    )

    return rows[0]?.taken ?? 0
  }

  it('do not both go through: the second waits for the first and finds it done', async () => {
    const { duty } = await assetWithDuty()
    const { id } = await evidenceOf(duty, daysAgo(30))
    const answers = await whileHeld(
      'select id from duties where id = $1 for update',
      [duty],
      correcting(id),
      declaring(id),
    )

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409])
    expect(answers.find((answer) => answer.status === 409)?.body.message).toMatch(
      /^(Ein für ungültig erklärter Nachweis wird nicht berichtigt\.|Dieser Nachweis ist mit .+ berichtigt; für ungültig erklärt wird dann die Berichtigung\.)$/,
    )
    expect(await takenOf(id)).toBe(1)
  })

  it('a declaration waits for a correction that is being written, and finds it', async () => {
    const { duty } = await assetWithDuty()
    const { id } = await evidenceOf(duty, daysAgo(30))
    const other = await evidenceOf(duty, daysAgo(60))

    // The counter of the evidence exists once one evidence was numbered.
    await correcting(other.id)()

    // The correction has checked and waits for its number.
    const [correction, declaration] = await whileHeld(
      `select key from number_ranges where tenant_id = $1 and key = 'evidence' for update`,
      [small],
      correcting(id),
      declaring(id),
    )

    expect([correction.status, declaration.status]).toEqual([201, 409])
    expect(declaration.body.message).toMatch(
      /^Dieser Nachweis ist mit .+ berichtigt; für ungültig erklärt wird dann die Berichtigung\.$/,
    )
    expect(await takenOf(id)).toBe(1)
  })

  it('a correction waits for a declaration that is being written, and finds it', async () => {
    const { duty } = await assetWithDuty()
    const { id } = await evidenceOf(duty, daysAgo(30))
    // The declaration has checked and waits to name the evidence: whatever
    // names it waits until the row is let go.
    const [declaration, correction] = await whileHeld(
      'select id from evidence where id = $1 for update',
      [id],
      declaring(id),
      correcting(id),
    )

    expect([declaration.status, correction.status]).toEqual([201, 409])
    expect(correction.body.message).toBe(
      'Ein für ungültig erklärter Nachweis wird nicht berichtigt.',
    )
    expect(await takenOf(id)).toBe(1)
  })
})

describe('the evidence of an asset', () => {
  it('lists the evidence of every duty at the asset with its duty, the newest first', async () => {
    const { asset, duty } = await assetWithDuty()
    const other = await dutyAt(asset, 'Hauptprüfung')
    const old = await evidenceOf(duty, daysAgo(300))
    const newer = await evidenceOf(other, daysAgo(10))
    const elsewhere = await assetWithDuty()

    await evidenceOf(elsewhere.duty, daysAgo(5))
    await http()
      .post(`/evidence/${old.id}/voiding`)
      .set(testIdentityHeader, by('u-site'))
      .send({ reason: 'Falsches Gebäude.' })
      .expect(201)

    const listed = (
      await http()
        .get(`/assets/${asset}/evidence`)
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
    ).body as AssetEvidenceEntry[]

    expect(listed).toEqual([
      {
        id: newer.id,
        dutyId: other,
        dutyTitle: 'Hauptprüfung',
        number: newer.state.number,
        performedOn: daysAgo(10),
        result: 'without_defects',
        origin: 'report',
        standing: 'counts',
      },
      {
        id: old.id,
        dutyId: duty,
        dutyTitle: 'Sichtprüfung',
        number: old.state.number,
        performedOn: daysAgo(300),
        result: 'without_defects',
        origin: 'report',
        standing: 'voided',
      },
    ])
  })

  it('is for whoever sees evidence, and not beyond the areas of the person asking', async () => {
    const { asset } = await assetWithDuty()

    expect(
      (
        await http()
          .get(`/assets/${asset}/evidence`)
          .set(testIdentityHeader, holding('asset.read', 'duty.read'))
          .expect(403)
      ).body.message,
    ).toBe(missingRight('evidence.read'))

    const southern = await assetWithDuty(large, south)

    await http()
      .get(`/assets/${southern.asset}/evidence`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(404)
  })
})

describe('the PDF of an evidence (#111)', () => {
  function pdfOf(evidence: string, header = by('u-lead')) {
    return http()
      .get(`/evidence/${evidence}/pdf`)
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

  it('is made from the frozen state the first time, and the same bytes every time after, whatever changed', async () => {
    const { asset, duty } = await assetWithDuty()
    const { id, state } = await evidenceOf(duty, daysAgo(3), { signed: true })
    const before = rendered.length
    const first = await pdfOf(id).expect(200).expect('Content-Type', 'application/pdf')

    expect(rendered).toHaveLength(before + 1)
    expect(rendered.at(-1)?.html).toContain(`Nachweis ${state.number}`)
    expect(rendered.at(-1)?.footerHtml).toContain(stateFingerprint(state))

    // The asset is renamed and the account changes its name: the PDF stays.
    await admin.query(`update assets set name = 'Aufzug umbenannt' where id = $1`, [asset])

    const second = await pdfOf(id).expect(200)

    expect(rendered).toHaveLength(before + 1)
    expect(Buffer.compare(first.body as Buffer, second.body as Buffer)).toBe(0)
  })

  it('is printed once more with the declaration once the evidence is declared invalid', async () => {
    const { duty } = await assetWithDuty()
    const { id } = await evidenceOf(duty, daysAgo(3))

    await pdfOf(id).expect(200)
    await admin.query(
      `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
       select tenant_id, property_id, area_id, id, 'Falsche Anlage geprüft.', 'u-lead'
         from evidence where id = $1`,
      [id],
    )

    const before = rendered.length

    await pdfOf(id).expect(200)
    expect(rendered).toHaveLength(before + 1)
    expect(rendered.at(-1)?.html).toContain('Für ungültig erklärt am')
    expect(rendered.at(-1)?.html).toContain('Falsche Anlage geprüft.')
  })

  it('marks the holdings of a predecessor, and prints an older state as it was frozen', async () => {
    const { duty } = await assetWithDuty()
    const { id } = await evidenceOf(duty, daysAgo(3), { origin: 'legacy', performedBy: 'u-site' })

    await pdfOf(id).expect(200)
    expect(rendered.at(-1)?.html).toContain('Altbestand aus einer Vorgängeranwendung')

    // A state of the fourth version kept no drawing of its signature.
    const older = { ...leastState(nextEvidenceNumber(), daysAgo(2), 'without_defects'), version: 4 }
    const signed = {
      ...older,
      signatures: [{ name: 'Erika Muster', role: 'signer', signedAt: '2026-10-01T07:42:00.000Z' }],
    }
    const { rows } = await admin.query<{ id: string }>(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             number, origin, examiner, examiner_organisation, written_by, state,
                             fingerprint)
       select tenant_id, property_id, area_id, id, $2::date, 'without_defects', $3, 'report',
              'Erika Muster', 'Prüfstelle Süd', 'u-duties', $4, $5
         from duties where id = $1
       returning id`,
      [duty, daysAgo(2), signed.number, JSON.stringify(signed), stateFingerprint(signed)],
    )

    await pdfOf(rows[0]?.id ?? '').expect(200)
    expect(rendered.at(-1)?.html).toContain('Ohne Zeichnung eingefroren')
  })

  it('says that no PDF is made where the instance has no renderer, and is made once there is one', async () => {
    const { duty } = await assetWithDuty()
    const { id } = await evidenceOf(duty, daysAgo(3))
    const working = renderer

    renderer = () => Promise.reject(new RendererUnavailableError('Kein Renderer.'))

    try {
      await http()
        .get(`/evidence/${id}/pdf`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(503, new RegExp(noRenderer.slice(0, 40)))
    } finally {
      renderer = working
    }

    await pdfOf(id).expect(200)
  })

  it('is for whoever sees the evidence, in their areas', async () => {
    const { duty } = await assetWithDuty(large, south)
    const { id } = await evidenceOf(duty, daysAgo(3))

    await pdfOf(id, by('u-tech', large)).expect(404)
  })
})

describe('the PDF of a round (#111)', () => {
  /** A round written down with its frozen state, put in past the application. */
  async function roundAt(
    asset: string,
    evidence: readonly string[],
    performer: string | null = null,
  ): Promise<string> {
    const { rows } = await admin.query<{
      id: string
      property_id: string
      area_id: string
      tenant_id: string
    }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                               performed_on, performer, performer_user_id)
       select tenant_id, property_id, area_id, id, 'round', 'Technikzentrale Schulhaus', 'done',
              $2::date, case when $3::text is null then null else 'own_staff'::duty_performer end, $3
         from assets where id = $1
       returning id, property_id, area_id, tenant_id`,
      [asset, daysAgo(1), performer],
    )
    const round = rows[0]
    // Of the type of a frozen round, so that a new field of it cannot be left out here (#79).
    const state: RoundRecordState = {
      version: 1,
      title: 'Technikzentrale Schulhaus',
      place: {
        property: {
          name: 'Schulzentrum Am Neckar',
          address: 'Neckarstraße 4, 68535 Edingen-Neckarhausen',
        },
        building: { name: 'Haus A', shortCode: null },
        room: null,
        asset: null,
      },
      dueOn: daysAgo(1),
      performedOn: daysAgo(1),
      form: { key: 'template-x', version: 3, title: 'Technikzentrale Schulhaus' },
      answers: [
        {
          section: 'Heizraum E.14',
          label: 'Tür schließt selbsttätig',
          group: null,
          kind: 'check_point',
          value: null,
          result: 'not_ok',
          remark: 'Türschließer ohne Funktion.',
          limit: null,
          photo: null,
        },
      ],
      performer: { person: 'Tobias Wendt' },
      defects: [],
      signatures: [
        {
          name: 'Tobias Wendt',
          role: 'signer',
          signedAt: '2026-10-05T05:38:00.000Z',
          path: 'M10,10L200,80',
          way: 'drawing',
          receivedAt: '2026-10-05T05:38:20.000Z',
        },
      ],
      evidence: evidence.map((number) => ({ number, duty: 'Sichtprüfung' })),
      writtenBy: 'Tobias Wendt',
      writtenAt: '2026-10-05T05:38:30.000Z',
    }

    await admin.query(
      `insert into round_records (tenant_id, property_id, area_id, activity_id, state, fingerprint)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        round?.tenant_id,
        round?.property_id,
        round?.area_id,
        round?.id,
        JSON.stringify(state),
        stateFingerprint(state),
      ],
    )

    return round?.id ?? ''
  }

  it('is made from the frozen state of the round, also of one that meets no duty', async () => {
    const { asset } = await assetWithDuty()
    const round = await roundAt(asset, [])

    await http().get(`/rounds/${round}/pdf`).set(testIdentityHeader, by('u-tech')).expect(200)
    expect(rendered.at(-1)?.html).toContain('Rundgang Technikzentrale Schulhaus')
    expect(rendered.at(-1)?.html).toContain('Dieser Rundgang erfüllt keine Pflicht.')
    expect(rendered.at(-1)?.html).toContain('nicht in Ordnung')
    expect(rendered.at(-1)?.html).toContain('M10,10L200,80')
  })

  it('is for the house technicians only of a round given to them or to nobody, as its page', async () => {
    const { asset } = await assetWithDuty()
    const theirs = await roundAt(asset, [], 'u-tech')
    const another = await roundAt(asset, [], 'u-site')

    await http().get(`/rounds/${theirs}/pdf`).set(testIdentityHeader, by('u-tech')).expect(200)
    await http()
      .get(`/rounds/${another}/pdf`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(404, /nicht in Ihren Bereichen/)
    await http().get(`/rounds/${another}/pdf`).set(testIdentityHeader, by('u-site')).expect(200)
  })

  it('is none for a round not written down yet, which says when there is one', async () => {
    const { asset } = await assetWithDuty()
    const { rows } = await admin.query<{ id: string }>(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status)
       select tenant_id, property_id, area_id, id, 'round', 'Offener Rundgang', 'open'
         from assets where id = $1
       returning id`,
      [asset],
    )

    await http()
      .get(`/rounds/${rows[0]?.id ?? ''}/pdf`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(404, /sobald der Rundgang abgeschlossen ist/)
  })

  it('keeps a frozen state and its PDF as they were, also in the database', async () => {
    const { asset } = await assetWithDuty()
    const round = await roundAt(asset, ['NW-1'])

    await http().get(`/rounds/${round}/pdf`).set(testIdentityHeader, by('u-tech')).expect(200)
    await expect(
      admin.query(`update round_records set fingerprint = $2 where activity_id = $1`, [
        round,
        'f'.repeat(64),
      ]),
    ).rejects.toThrow(/nicht geändert und nicht gelöscht/)
    await expect(admin.query('delete from prints where activity_id = $1', [round])).rejects.toThrow(
      /nicht geändert und nicht gelöscht/,
    )
  })
})
