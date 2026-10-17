import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  type DutyEvidenceEntry,
  type EmptiedEvidencePage,
  type IsoDate,
  type RetentionProposals,
  type RoleKey,
  shippedRoles,
  type StatedRetention,
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
import { runDeadlinesOf } from '../deadlines/engine.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The retention of an evidence and its end (#340, section 2.6 of the concept,
 * ADR 0004, addendum of 17.10.2026): the end by each form of the rule, as the
 * database counts it; the longer retention of the operator, never shorter;
 * the confirmation of whoever leads, which the database checks itself; the
 * empty shell with number, duty, day and result; and every other way to
 * change or remove an evidence refused as before.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
}

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()

let admin: Pool
let database: Database
let app: INestApplication
const folder = mkdtempSync(join(tmpdir(), 'retention-'))

/** One duty for each form of the rule, each at an asset of its own. */
const duty = { years: '', next: '', inUse: '', own: '' }
const asset = { inUse: '' }
/** The evidence: a first one whose retention ends, and a later one whose does not. */
const proof = {
  years1: '',
  years2: '',
  next1: '',
  nextVoided: '',
  next2: '',
  inUse1: '',
  own1: '',
  own2: '',
}

const retainedYears = (years: number): StatedRetention => ({
  kind: 'years',
  years,
  rule: 'probe_retention',
  on: '2020-01-01' as IsoDate,
})
const untilNext: StatedRetention = { kind: 'until_next_inspection', on: '2020-01-01' as IsoDate }
const whileInUse: StatedRetention = { kind: 'while_in_use', on: '2020-01-01' as IsoDate }

function http() {
  return request(app.getHttpServer())
}

function by(userId: string): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

/** An evidence of a duty on a day, with the retention its state names, put in past the application. */
async function evidenceOf(
  dutyId: string,
  performedOn: string,
  retention: StatedRetention | null,
): Promise<string> {
  const number = nextEvidenceNumber()
  const state = { ...leastState(number, performedOn as IsoDate, 'without_defects'), retention }
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

async function proposed(): Promise<{ id: string; endedOn: string; retention: string }[]> {
  const answer = (
    await http()
      .get('/settings/evidence-retention/proposals')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
  ).body as RetentionProposals

  return answer.proposals.map((each) => ({
    id: String(each.evidenceId),
    endedOn: each.endedOn,
    retention: each.retention,
  }))
}

/** What the application role is told when it writes this in a transaction of a person. */
async function refusalOf(userId: string, statement: ReturnType<typeof sql>): Promise<unknown> {
  try {
    await database.forTenant({ tenantId: tenant, userId }, (tx) => tx.execute(statement))
  } catch (error) {
    return (
      (error as { cause?: { code?: string }; code?: string }).cause?.code ??
      (error as { code?: string }).code
    )
  }

  return 'written'
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
      userId === 'u-lead' ? 'Sabine Krämer' : 'Jörg Albrecht',
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
      ApiModule.create(database, testIdentities, { catalogue, files: new FileStore(folder) }),
    ],
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
  const elevatorAt = (name: string) =>
    made(`/buildings/${building}/assets`, { kind: 'probe.elevator', name })
  const dutyAt = async (assetId: string) =>
    (
      await admin.query<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                             counting, interval_months, confirmed_by)
         select tenant_id, property_id, area_id, id, 'Sichtkontrolle', 'own_decision', 'Hausordnung',
                'from_performance', 12, 'u-duties'
           from assets where id = $1
         returning id`,
        [assetId],
      )
    ).rows[0]?.id ?? ''

  duty.years = await dutyAt(await elevatorAt('Aufzug A'))
  duty.next = await dutyAt(await elevatorAt('Aufzug B'))
  asset.inUse = await elevatorAt('Aufzug C')
  duty.inUse = await dutyAt(asset.inUse)
  duty.own = await dutyAt(await elevatorAt('Aufzug D'))

  proof.years1 = await evidenceOf(duty.years, '2020-03-14', retainedYears(2))
  proof.years2 = await evidenceOf(duty.years, '2020-01-10', retainedYears(10))
  proof.next1 = await evidenceOf(duty.next, '2021-05-03', untilNext)
  // A later one declared invalid ends nothing: the next inspection is the one that counts.
  proof.nextVoided = await evidenceOf(duty.next, '2021-09-01', untilNext)
  await admin.query(
    `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
     select tenant_id, property_id, area_id, id, 'Falsche Anlage.', 'u-lead' from evidence where id = $1`,
    [proof.nextVoided],
  )
  proof.next2 = await evidenceOf(duty.next, '2022-06-01', untilNext)
  proof.inUse1 = await evidenceOf(duty.inUse, '2022-09-09', whileInUse)
  proof.own1 = await evidenceOf(duty.own, '2021-04-01', null)
  proof.own2 = await evidenceOf(duty.own, '2023-04-01', null)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('the retention of an evidence (#340)', () => {
  it('ends by each form of its rule, and before that nothing is proposed', async () => {
    // Years from the day; until the next inspection of the duty; an own duty
    // like that; the second of each has not ended, nor has the asset in use.
    expect(await proposed()).toEqual([
      { id: proof.years1, endedOn: '2022-03-14', retention: '2 Jahre' },
      { id: proof.next1, endedOn: '2022-06-01', retention: 'Bis zur nächsten Prüfung' },
      { id: proof.nextVoided, endedOn: '2022-06-01', retention: 'Bis zur nächsten Prüfung' },
      {
        id: proof.own1,
        endedOn: '2023-04-01',
        retention: 'Bis zur nächsten Prüfung, eigene Pflicht',
      },
    ])

    // As long as the asset is used: until the day it is removed. Out of
    // service is not removed; it can come back.
    await admin.query(
      `insert into asset_lifecycle (tenant_id, property_id, area_id, asset_id, state, valid_from)
       select tenant_id, property_id, area_id, id, 'out_of_service', $2 from assets where id = $1`,
      [asset.inUse, addDays(today, -10)],
    )
    expect((await proposed()).map((each) => each.id)).not.toContain(proof.inUse1)

    await admin.query(
      `insert into asset_lifecycle (tenant_id, property_id, area_id, asset_id, state, valid_from)
       select tenant_id, property_id, area_id, id, 'removed', $2 from assets where id = $1`,
      [asset.inUse, addDays(today, -1)],
    )
    expect(await proposed()).toContainEqual({
      id: proof.inUse1,
      endedOn: addDays(today, -1),
      retention: 'Solange die Anlage verwendet wird',
    })
  })

  it('lasts longer with the setting of the operator, and never shorter', async () => {
    const set = (minimumYears: unknown) =>
      http()
        .put('/settings/evidence-retention')
        .set(testIdentityHeader, by('u-lead'))
        .send({ minimumYears })

    try {
      await set(30).expect(200)
      expect(await proposed()).toEqual([])

      // A year less than every rule: the rule counts, nothing ends sooner.
      await set(1).expect(200)
      expect((await proposed()).map((each) => each.id).sort()).toEqual(
        [proof.years1, proof.next1, proof.nextVoided, proof.own1, proof.inUse1].sort(),
      )
      expect((await proposed()).find((each) => each.id === proof.years1)).toEqual({
        id: proof.years1,
        endedOn: '2022-03-14',
        retention: '2 Jahre, mindestens 1 Jahr',
      })

      await set(0).expect(400)
      await set(51).expect(400)
      await set('drei').expect(400)
    } finally {
      await set(null).expect(200)
    }
  })

  it('is confirmed by whoever leads the operator alone, and the database checks it itself', async () => {
    const confirmation = (confirmedBy: string, evidenceId: string) =>
      sql`insert into evidence_emptyings (tenant_id, property_id, area_id, evidence_id, confirmed_by)
          select tenant_id, property_id, area_id, id, ${confirmedBy} from evidence where id = ${evidenceId}`

    // Somebody who does not lead, past every route.
    expect(await refusalOf('u-duties', confirmation('u-duties', proof.years1))).toBe('HT008')
    // Whoever leads, in the name of somebody else.
    expect(await refusalOf('u-lead', confirmation('u-duties', proof.years1))).toBe('HT008')
    // Whoever leads, before the end.
    expect(await refusalOf('u-lead', confirmation('u-lead', proof.years2))).toBe('HT008')

    // Through the route, all or nothing: one that has not ended stops the rest.
    const refused = await http()
      .post('/settings/evidence-retention/emptyings')
      .set(testIdentityHeader, by('u-lead'))
      .send({ evidenceIds: [proof.own1, proof.years2] })
      .expect(409)

    expect(refused.body.message).toBe('Die Aufbewahrung dieses Nachweises ist nicht abgelaufen.')
    expect(
      (await admin.query('select emptied_at from evidence where id = $1', [proof.own1])).rows[0],
    ).toEqual({ emptied_at: null })
  })

  it('keeps an evidence as written on every other way, also as its owner', async () => {
    const shell = sql`update evidence
                         set state = '{"version": 0}'::jsonb, emptied_at = now(), examiner = null,
                             examiner_organisation = null, written_by = null
                       where id = ${proof.years1}`

    expect(await refusalOf('u-lead', shell)).toBe('HT003')
    expect(
      await refusalOf(
        'u-lead',
        sql`update evidence set examiner = null where id = ${proof.years1}`,
      ),
    ).toBe('HT003')
    expect(
      await refusalOf('u-lead', sql`delete from evidence where id = ${proof.years1}`),
    ).not.toBe('written')
    await expect(
      admin.query('update evidence set examiner = null where id = $1', [proof.years1]),
    ).rejects.toMatchObject({ code: 'HT003' })
    await expect(
      admin.query('delete from evidence where id = $1', [proof.years1]),
    ).rejects.toMatchObject({ code: 'HT003' })

    // And with the check of the confirmation switched off by the owner, the
    // lock of the evidence still asks the end itself.
    const owner = await admin.connect()

    try {
      await owner.query('begin')
      await owner.query(
        'alter table evidence_emptyings disable trigger evidence_emptying_confirmed',
      )
      await expect(
        owner.query(
          `insert into evidence_emptyings (tenant_id, property_id, area_id, evidence_id, confirmed_by, ended_on)
           select tenant_id, property_id, area_id, id, 'u-lead', '2020-01-01' from evidence where id = $1`,
          [proof.years2],
        ),
      ).rejects.toMatchObject({ code: 'HT003' })
    } finally {
      await owner.query('rollback')
      owner.release()
    }
  })

  it('leaves the empty shell, without its print, its reasons and a line in the change log', async () => {
    // A print of the first, a declaration of invalidity of the other, and the deadlines of the end.
    const sha256 = 'a'.repeat(64)

    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 2048, 'application/pdf')`,
      [tenant, sha256],
    )
    await admin.query(
      `insert into prints (tenant_id, property_id, area_id, evidence_id, sha256)
       select tenant_id, property_id, area_id, id, $2 from evidence where id = $1`,
      [proof.years1, sha256],
    )
    await admin.query(
      `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
       select tenant_id, property_id, area_id, id, 'Der Bericht gehört zu Aufzug A, Prüfer Erika Muster.', 'u-lead'
         from evidence where id = $1`,
      [proof.next1],
    )
    await runDeadlinesOf({ database, catalogue, now: () => new Date() }, tenant, new Date())

    const deadlineOf = async (evidenceId: string) =>
      (
        await admin.query<{ kind: string; status: string; closed_by: string | null }>(
          'select kind, status, closed_by from deadlines where evidence_id = $1',
          [evidenceId],
        )
      ).rows
    const loggedOf = async (table: string, id: string) =>
      Number(
        (
          await admin.query<{ entries: string }>(
            'select count(*) as entries from audit_entries where table_name = $1 and record_id = $2',
            [table, id],
          )
        ).rows[0]?.entries,
      )

    expect(await deadlineOf(proof.years1)).toEqual([
      { kind: 'evidence.retention_ends', status: 'open', closed_by: null },
    ])
    // None for one whose end is still to come.
    expect(await deadlineOf(proof.years2)).toEqual([])

    const logged = await loggedOf('evidence', proof.years1)

    expect(
      (
        await http()
          .post('/settings/evidence-retention/emptyings')
          .set(testIdentityHeader, by('u-lead'))
          .send({ evidenceIds: [proof.years1, proof.next1] })
          .expect(201)
      ).body,
    ).toEqual({ emptied: 2 })

    const { rows } = await admin.query(
      `select state, fingerprint, emptied_at is not null as emptied, number, performed_on::text, result,
              examiner, examiner_organisation, written_by, result_reason
         from evidence where id = $1`,
      [proof.years1],
    )

    expect(rows[0]).toEqual({
      state: { version: 0 },
      fingerprint: stateFingerprint({ version: 0 } as never),
      emptied: true,
      number: expect.stringMatching(/^NW-TEST-\d{5}$/),
      performed_on: '2020-03-14',
      result: 'without_defects',
      examiner: null,
      examiner_organisation: null,
      written_by: null,
      result_reason: null,
    })
    expect(
      (
        await admin.query('select count(*)::int as n from prints where evidence_id = $1', [
          proof.years1,
        ])
      ).rows[0],
    ).toEqual({ n: 0 })
    expect(
      (
        await admin.query(
          'select reason, voided_by from evidence_voidings where evidence_id = $1',
          [proof.next1],
        )
      ).rows[0],
    ).toEqual({ reason: 'Gelöscht nach Ablauf der Aufbewahrung.', voided_by: 'u-lead' })
    expect(await deadlineOf(proof.years1)).toEqual([
      { kind: 'evidence.retention_ends', status: 'done', closed_by: 'u-lead' },
    ])
    // What went is not copied into the change log; the confirmation stands in it.
    expect(await loggedOf('evidence', proof.years1)).toBe(logged)
    expect(
      (
        await admin.query<{ id: string }>(
          'select id from evidence_emptyings where evidence_id = $1',
          [proof.years1],
        )
      ).rows.length,
    ).toBe(1)

    // Once, and nothing more is proposed of it.
    expect((await proposed()).map((each) => each.id)).not.toContain(proof.years1)
    expect(
      (
        await http()
          .post('/settings/evidence-retention/emptyings')
          .set(testIdentityHeader, by('u-lead'))
          .send({ evidenceIds: [proof.years1] })
          .expect(409)
      ).body.message,
    ).toBe('Dieser Nachweis ist schon gelöscht.')
  })

  it('says what stays of it, and hands out and takes nothing more', async () => {
    const page = (
      await http()
        .get(`/evidence/${proof.years1}`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as EmptiedEvidencePage

    expect(page).toMatchObject({
      id: proof.years1,
      dutyId: duty.years,
      performedOn: '2020-03-14',
      result: 'without_defects',
      emptied: { confirmedBy: 'Sabine Krämer', retention: '2 Jahre', endedOn: '2022-03-14' },
      voided: null,
    })
    expect(page).not.toHaveProperty('state')

    const listed = (
      await http()
        .get(`/duties/${duty.years}/evidence`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as DutyEvidenceEntry[]

    expect(listed.find((entry) => entry.id === proof.years1)).toMatchObject({ emptied: true })
    expect(listed.find((entry) => entry.id === proof.years2)).not.toHaveProperty('emptied')

    await http()
      .get(`/evidence/${proof.years1}/files/0`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(409)
    await http()
      .get(`/evidence/${proof.years1}/pdf`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(404)
    await http()
      .post(`/evidence/${proof.years1}/voiding`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ reason: 'Falscher Bericht.' })
      .expect(409)
    await http()
      .post(`/evidence/${proof.years1}/correction`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ reason: 'Tag falsch.', performedOn: '2020-03-15', result: 'without_defects' })
      .expect(409)
    // And the shell stays as it is, for every role.
    await expect(
      admin.query('delete from evidence where id = $1', [proof.years1]),
    ).rejects.toMatchObject({ code: 'HT003' })
    await expect(
      admin.query('delete from evidence_emptyings where evidence_id = $1', [proof.years1]),
    ).rejects.toMatchObject({ code: 'HT009' })
  })
})
