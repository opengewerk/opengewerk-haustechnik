import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type AuditorReadList,
  catalogueOf,
  type DutyRegister,
  type MemberLimitsOf,
  type OwnLimits,
  rightsOfRoles,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId, type TenantTransaction } from '@opengewerk/platform-server'
import { routesOf } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAuthentication } from '../authentication/access.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, noIdentities, testIdentities } from './test-identity.js'

/**
 * The auditor from outside (#339, section 4.3 of the concept): reads the
 * duties and their evidence only in the properties and kinds of assets the
 * access is limited to, which the database holds; changes nothing; every read
 * of theirs is written down, and the Leitung reads it in words; the limits go
 * with the role alone, set with the access.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-tech': 'technician',
  'u-auditor': 'auditor',
  'u-other': 'auditor',
}

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()

let admin: Pool
let database: Database
let app: INestApplication
const folder = mkdtempSync(join(tmpdir(), 'auditors-'))

/** Two properties; at the school an elevator and a water meter, at the depot an elevator. */
const place = { school: '', depot: '', schoolElevator: '', schoolMeter: '', depotElevator: '' }
const duty = { schoolElevator: '', schoolMeter: '', depotElevator: '' }
/** The firm of the elevator at the school, the one at the depot, and one no duty names. */
const firm = { lifts: '', depot: '', idle: '' }
const evidence = { schoolElevator: '', schoolMeter: '', depotElevator: '' }

function http() {
  return request(app.getHttpServer())
}

function by(userId: string): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

async function limit(userId: string, propertyIds: readonly string[], kinds: readonly string[]) {
  await admin.query('delete from member_limit_properties where user_id = $1', [userId])
  await admin.query('delete from member_limit_asset_kinds where user_id = $1', [userId])

  for (const propertyId of propertyIds) {
    await admin.query(
      'insert into member_limit_properties (tenant_id, user_id, property_id) values ($1, $2, $3)',
      [tenant, userId, propertyId],
    )
  }

  for (const kind of kinds) {
    await admin.query(
      'insert into member_limit_asset_kinds (tenant_id, user_id, asset_kind) values ($1, $2, $3)',
      [tenant, userId, kind],
    )
  }
}

async function register(userId: string): Promise<string[]> {
  return (
    (await http().get('/duties/register').set(testIdentityHeader, by(userId)).expect(200))
      .body as DutyRegister
  ).duties
    .map((entry) => String(entry.id))
    .sort()
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [
    tenant,
    'Liegenschaften Probe',
  ])

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
      userId === 'u-auditor' ? 'Dr. Frank Seidel' : userId,
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
  const address = {
    street: 'Probeweg 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  }

  place.school = await made('/properties', { name: 'Schulzentrum Am Lindenhain', ...address })
  place.depot = await made('/properties', { name: 'Werkhof Nord', ...address })

  const school = await made(`/properties/${place.school}/buildings`, {
    name: 'Schulhaus',
    kinds: ['school'],
  })
  const depot = await made(`/properties/${place.depot}/buildings`, {
    name: 'Halle 1',
    kinds: ['school'],
  })

  place.schoolElevator = await made(`/buildings/${school}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug Schulhaus',
  })
  place.schoolMeter = await made(`/buildings/${school}/assets`, {
    kind: 'probe.water_meter',
    name: 'Wasserzähler',
    meterNumber: '9WAT1234567',
    meterUnit: 'cubic_metres',
  })
  place.depotElevator = await made(`/buildings/${depot}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug Halle',
  })

  const dutyAt = async (asset: string, kind: string | null) =>
    (
      await admin.query<{ id: string }>(
        kind === null
          ? `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                                 counting, interval_months, confirmed_by)
             select tenant_id, property_id, area_id, id, 'Sichtkontrolle', 'own_decision', 'Hausordnung',
                    'from_performance', 12, 'u-duties'
               from assets where id = $1
             returning id`
          : `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                                 interval_months, maximum_months, confirmed_by)
             select tenant_id, property_id, area_id, id, $2, 1, 'betrsichv', 24, 24, 'u-duties'
               from assets where id = $1
             returning id`,
        kind === null ? [asset] : [asset, kind],
      )
    ).rows[0]?.id ?? ''

  duty.schoolElevator = await dutyAt(place.schoolElevator, 'probe.elevator_main_test')
  duty.schoolMeter = await dutyAt(place.schoolMeter, null)
  duty.depotElevator = await dutyAt(place.depotElevator, 'probe.elevator_main_test')

  for (const [key, name] of [
    ['lifts', 'Aufzugsdienst Rhein-Neckar GmbH'],
    ['depot', 'Hebetechnik Nord GmbH'],
    ['idle', 'Brandschutz Kurpfalz GmbH'],
  ] as const) {
    const { rows } = await admin.query<{ id: string }>(
      `insert into contractors (tenant_id, name, note) values ($1, $2, 'Rahmenvertrag') returning id`,
      [tenant, name],
    )

    firm[key] = rows[0]?.id ?? ''
  }

  for (const [dutyId, firmId] of [
    [duty.schoolElevator, firm.lifts],
    [duty.depotElevator, firm.depot],
  ] as const) {
    await admin.query(
      `update duties set performer = 'contractor', contractor_id = $2 where id = $1`,
      [dutyId, firmId],
    )
  }

  for (const key of ['schoolElevator', 'schoolMeter', 'depotElevator'] as const) {
    const { rows } = await admin.query<{ id: string }>(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames})
       select tenant_id, property_id, area_id, id, '2025-03-14', 'without_defects',
              ${writtenPlaceholders(2)}
         from duties where id = $1
       returning id`,
      [duty[key], ...writtenValues('u-duties', '2025-03-14', 'without_defects')],
    )

    evidence[key] = rows[0]?.id ?? ''
  }
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('an auditor from outside', () => {
  it('reads only the duties of the properties and kinds the access is limited to', async () => {
    await limit('u-auditor', [], [])
    expect(await register('u-auditor')).toEqual(
      [duty.schoolElevator, duty.schoolMeter, duty.depotElevator].sort(),
    )

    await limit('u-auditor', [place.school], [])
    expect(await register('u-auditor')).toEqual([duty.schoolElevator, duty.schoolMeter].sort())

    await limit('u-auditor', [], ['probe.elevator'])
    expect(await register('u-auditor')).toEqual([duty.schoolElevator, duty.depotElevator].sort())

    await limit('u-auditor', [place.school], ['probe.elevator'])
    expect(await register('u-auditor')).toEqual([duty.schoolElevator])

    // A proposal dismissed outside them is none either (finding of the review of #408).
    await admin.query(
      `insert into duty_dismissals (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                                    reason, dismissed_by)
       select tenant_id, property_id, area_id, id, 'probe.elevator_main_test', 1, 'Gibt es hier nicht.',
              'u-duties'
         from assets where id = $1
       on conflict do nothing`,
      [place.depotElevator],
    )
    expect(
      (await http().get('/duty-dismissals').set(testIdentityHeader, by('u-auditor')).expect(200))
        .body,
    ).toEqual([])
    expect(
      (await http().get('/duty-dismissals').set(testIdentityHeader, by('u-duties')).expect(200))
        .body,
    ).toHaveLength(1)
    // A duty outside, asked by its key, is none: the database does not hand it over.
    await http()
      .get(`/duties/${duty.depotElevator}`)
      .set(testIdentityHeader, by('u-auditor'))
      .expect(404)
    // And the limits of one auditor are not those of another, nor of anybody else.
    expect(await register('u-other')).toHaveLength(3)
    expect(await register('u-duties')).toHaveLength(3)
  })

  it('is held on every table with a property, past every route (review of #408)', async () => {
    // The limits themselves are read by the functions of the policy.
    const { rows } = await admin.query<{ table_name: string }>(
      `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'property_id'
          and t.table_type = 'BASE TABLE'
          and c.table_name not in ('member_limit_properties', 'invitation_limit_properties')
          and not exists (
            select 1 from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.table_name
               and p.policyname = 'within_limits' and p.permissive = 'RESTRICTIVE'
               and p.cmd = 'ALL')
        order by 1`,
    )

    expect(rows.map((row) => row.table_name)).toEqual([])
  })

  it('is held by the database as well, past every route', async () => {
    await limit('u-auditor', [place.school], ['probe.elevator'])

    const seen = await database.forTenant(
      { tenantId: tenant, userId: 'u-auditor' },
      async (tx) => ({
        properties: (await tx.execute<{ id: string }>('select id from properties')).rows.map(
          (row) => row.id,
        ),
        assets: (await tx.execute<{ id: string }>('select id from assets')).rows.map(
          (row) => row.id,
        ),
        duties: (await tx.execute<{ id: string }>('select id from duties')).rows.map(
          (row) => row.id,
        ),
        evidence: (await tx.execute<{ id: string }>('select id from evidence')).rows.map(
          (row) => row.id,
        ),
      }),
    )

    expect(seen).toEqual({
      properties: [place.school],
      assets: [place.schoolElevator],
      duties: [duty.schoolElevator],
      evidence: [evidence.schoolElevator],
    })
  })

  it('sees nothing after the last day of the access, without anybody doing anything', async () => {
    await limit('u-auditor', [], [])
    await admin.query("update memberships set last_day = $1 where user_id = 'u-auditor'", [
      addDays(today, -1),
    ])

    try {
      const seen = await database.forTenant({ tenantId: tenant, userId: 'u-auditor' }, async (tx) =>
        (await tx.execute<{ id: string }>('select id from duties')).rows.map((row) => row.id),
      )

      // The identity is refused before, by the foundation; this is the line behind it.
      expect(seen).toEqual([])
    } finally {
      await admin.query("update memberships set last_day = null where user_id = 'u-auditor'")
    }
  })

  it('changes nothing: every route that writes asks for a right an auditor does not hold', () => {
    const authentication = createAuthentication({
      database,
      secret: 'x'.repeat(64),
      trustedOrigins: ['https://haustechnik.example.de'],
    })
    const routes = routesOf(
      ApiModule.create(database, noIdentities, { authentication }).controllers ?? [],
    )
    const held: readonly string[] = [...rightsOfRoles(['auditor'])]
    const writing = routes.filter((route) => route.writes)

    expect(writing.length).toBeGreaterThan(50)
    expect(
      writing
        .filter((route) => route.permission !== undefined && held.includes(route.permission))
        .map((route) => route.name),
      // Signing a delegation of duties is for the person it goes to, and none goes to an auditor (below).
      // Checking a PDF (#457) is sent, not written: it keeps nothing, and the check is written down
      // as every request of an auditor.
    ).toEqual(['POST /delegations/:id/sign', 'POST /pdf-checks'])
  })

  it('is given no delegation of duties, which alone would let it sign one', async () => {
    const { rows } = await admin.query<{ id: string }>(
      'select id from areas where tenant_id = $1',
      [tenant],
    )
    const refused = await http()
      .post('/delegations')
      .set(testIdentityHeader, by('u-lead'))
      .send({
        delegateUserId: 'u-auditor',
        areaIds: rows.map((row) => row.id),
        scope: 'all',
        tasks: 'Prüfungen im Bereich.',
        powers: 'Keine.',
        startsOn: today,
        endsOn: addDays(today, 30),
      })
      .expect(400)

    expect(refused.body.message).toBe('Pflichten werden keinem Prüfer übertragen.')
  })

  it('has every read written down, and the Leitung reads them in words', async () => {
    await limit('u-auditor', [place.school], ['probe.elevator'])
    await admin.query('delete from auditor_reads')

    await http().get('/duties/register').set(testIdentityHeader, by('u-auditor')).expect(200)
    await http()
      .get(`/duties/${duty.schoolElevator}`)
      .set(testIdentityHeader, by('u-auditor'))
      .expect(200)
    await http()
      .get(`/evidence/${evidence.schoolElevator}`)
      .set(testIdentityHeader, by('u-auditor'))
      .expect(200)
    // Nobody else is written down.
    await http().get('/duties/register').set(testIdentityHeader, by('u-duties')).expect(200)
    // A register as a PDF, for a property and with the evidence after it, as
    // the interceptor writes it: the PDF itself is not made here.
    await admin.query(
      `insert into auditor_reads (tenant_id, user_id, read_at, route, path, query)
       values ($1, 'u-auditor', now() + interval '1 minute', '/duties/evidence-register/pdf',
               '/duties/evidence-register/pdf', $2)`,
      [tenant, `propertyId=${place.school}&attach=1`],
    )

    const reads = (
      await http().get('/auditor-reads').set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as AuditorReadList

    expect(reads.reads.map((read) => [read.personName, read.what, read.subject])).toEqual([
      [
        'Dr. Frank Seidel',
        'Nachweisverzeichnis als PDF',
        'Schulzentrum Am Lindenhain, mit Nachweisen und Prüfbescheinigungen',
      ],
      [
        'Dr. Frank Seidel',
        'Nachweis',
        expect.stringMatching(/^NW-\w+-\d{5}, Hauptprüfung der Aufzugsanlage, AN-\d{5}$/),
      ],
      [
        'Dr. Frank Seidel',
        'Pflicht',
        expect.stringMatching(/^Hauptprüfung der Aufzugsanlage, AN-\d{5}$/),
      ],
      ['Dr. Frank Seidel', 'Pflichtenverzeichnis', null],
    ])
    // Only for whoever administers who works here.
    await http().get('/auditor-reads').set(testIdentityHeader, by('u-duties')).expect(403)
  })

  it('holds on its device what the duties hang on, within its limits, and nothing else', async () => {
    await limit('u-auditor', [place.school], ['probe.elevator'])
    // Something the device of an auditor must not hold: a task of the operator,
    // and the work on a duty within its limits.
    await http()
      .post('/tasks')
      .set(testIdentityHeader, by('u-duties'))
      .send({ title: 'Schlüssel abholen', dueOn: today })
    await admin.query(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status, due_on)
       select tenant_id, property_id, area_id, asset_id, 'inspection', 'Hauptprüfung', 'open', $2::date
         from duties where id = $1`,
      [duty.schoolElevator, today],
    )

    const answer = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, by('u-auditor'))
      .expect(200)
    const held = Object.fromEntries(
      (answer.body.changes as { entity: string; rows: Record<string, unknown>[] }[])
        .filter((change) => change.rows.length > 0)
        .map((change) => [change.entity, change.rows.map((row) => String(row['id']))]),
    )

    expect(Object.keys(held).sort()).toEqual([
      'assets',
      'buildings',
      'contractors',
      'duties',
      'properties',
    ])
    expect(held['properties']).toEqual([place.school])
    expect(held['assets']).toEqual([place.schoolElevator])
    expect(held['duties']).toEqual([duty.schoolElevator])
    // Of the firms only the one its duty names, by its name (#474).
    expect(held['contractors']).toEqual([firm.lifts])
    // The catalogue the device needs to show them, as for every role.
    for (const path of ['/catalogue', '/catalogue/checksum']) {
      await http().get(path).set(testIdentityHeader, by('u-auditor')).expect(200)
    }
  })

  /**
   * The firms lie in no area and no limit (#474): the device of an auditor
   * holds only those the duties within its limits name, and the value of the
   * firms changes with them, so that a firm a duty comes to name is asked for
   * from the start and one no duty names any more is let go.
   */
  it('holds of the firms only those its duties name, and learns of one a duty comes to name', async () => {
    await limit('u-auditor', [place.school], ['probe.elevator'])

    const pull = async () => {
      const answer = await http()
        .get('/sync?since=0')
        .set(testIdentityHeader, by('u-auditor'))
        .expect(200)
      const changes = answer.body.changes as {
        entity: string
        rows: Record<string, unknown>[]
      }[]

      return {
        value: (answer.body.narrowed as Record<string, string>)['contractors'],
        firms: changes.find((change) => change.entity === 'contractors')?.rows ?? [],
      }
    }
    const before = await pull()

    expect(before.firms.map((row) => row['id'])).toEqual([firm.lifts])
    expect(before.firms[0]).not.toHaveProperty('note')

    // The firm of the depot, outside the limits, comes to the duty within them.
    await admin.query('update duties set contractor_id = $2 where id = $1', [
      duty.schoolElevator,
      firm.depot,
    ])

    try {
      const after = await pull()

      expect(after.value).not.toBe(before.value)
      expect(after.firms.map((row) => row['id'])).toEqual([firm.depot])
    } finally {
      await admin.query('update duties set contractor_id = $2 where id = $1', [
        duty.schoolElevator,
        firm.lifts,
      ])
    }
  })

  it('names its own limits and last day for the note above the register', async () => {
    await limit('u-auditor', [place.school], ['probe.elevator'])
    await admin.query("update memberships set last_day = $1 where user_id = 'u-auditor'", [
      addDays(today, 30),
    ])

    try {
      const own = (
        await http().get('/areas/my-limits').set(testIdentityHeader, by('u-auditor')).expect(200)
      ).body as OwnLimits

      expect(own).toEqual({
        auditor: true,
        lastDay: addDays(today, 30),
        properties: ['Schulzentrum Am Lindenhain'],
        assetKinds: ['probe.elevator'],
      })
    } finally {
      await admin.query("update memberships set last_day = null where user_id = 'u-auditor'")
    }
  })
})

describe('the limits of an access', () => {
  it('are set with the role of an auditor and go with another role', async () => {
    const limits = { propertyIds: [place.school], assetKinds: ['probe.elevator'] }

    await http()
      .patch('/staff/u-other')
      .set(testIdentityHeader, by('u-lead'))
      .send({
        roles: ['auditor'],
        lastDay: addDays(today, 30),
        additions: { all: true, areaIds: [], limits },
      })
      .expect(200)

    const held = (
      await http().get('/areas/limits').set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as MemberLimitsOf[]

    expect(held.find((each) => each.userId === 'u-other')).toEqual({ userId: 'u-other', ...limits })

    await http()
      .patch('/staff/u-other')
      .set(testIdentityHeader, by('u-lead'))
      .send({ roles: ['technician'], lastDay: null, additions: { all: true, areaIds: [] } })
      .expect(200)
    expect(
      (
        (await http().get('/areas/limits').set(testIdentityHeader, by('u-lead')).expect(200))
          .body as MemberLimitsOf[]
      ).map((each) => each.userId),
    ).not.toContain('u-other')
    await http()
      .patch('/staff/u-other')
      .set(testIdentityHeader, by('u-lead'))
      .send({
        roles: ['auditor'],
        lastDay: addDays(today, 30),
        additions: { all: true, areaIds: [] },
      })
      .expect(200)
  })

  it('are refused for a role that is not limited, and the auditor only with a last day', async () => {
    const limits = { propertyIds: [place.school], assetKinds: [] }

    expect(
      (
        await http()
          .patch('/staff/u-tech')
          .set(testIdentityHeader, by('u-lead'))
          .send({ roles: ['technician'], additions: { all: true, areaIds: [], limits } })
          .expect(400)
      ).body.message,
    ).toBe('Auf Liegenschaften oder Anlagenarten beschränkt wird nur ein Zugang als Prüfer.')
    await http()
      .post('/staff')
      .set(testIdentityHeader, by('u-lead'))
      .send({ name: 'Petra Prüf', email: 'p.pruef@pruefstelle.example', roles: ['auditor'] })
      .expect(400)
    // Nor to a property the tenant does not have.
    expect(
      (
        await http()
          .post('/staff')
          .set(testIdentityHeader, by('u-lead'))
          .send({
            name: 'Petra Prüf',
            email: 'p.pruef@pruefstelle.example',
            roles: ['auditor'],
            send: 'link',
            lastDay: addDays(today, 30),
            additions: {
              all: true,
              areaIds: [],
              limits: { propertyIds: [newId()], assetKinds: [] },
            },
          })
          .expect(400)
      ).body.message,
    ).toBe('Diese Liegenschaft gibt es nicht in den Bereichen des Zugangs.')
  })
})

describe('an auditor limited to kinds of assets (S10 of the review of phase 2)', () => {
  /**
   * Section 7 of the concept: with a limit to kinds of assets an auditor
   * "sieht nichts, was an keiner Anlage hängt". Of the places that leaves the
   * way to an asset of the kinds: its property, its building, its floor and
   * its room, and no other, which the database holds.
   */
  it('sees of the places only those on the way to an asset of its kinds', async () => {
    const made = async (path: string, body: object): Promise<string> =>
      (await http().post(path).set(testIdentityHeader, by('u-duties')).send(body).expect(201)).body
        .id
    const hall = await made('/properties', {
      name: 'Sporthalle Am Lindenhain',
      street: 'Probeweg 3',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
    })
    const building = await made(`/properties/${hall}/buildings`, {
      name: 'Halle',
      kinds: ['school'],
    })
    const ground = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
    const upper = await made(`/buildings/${building}/floors`, { name: 'Empore', level: 1 })
    const technik = await made(`/floors/${ground}/rooms`, { number: '0.01', name: 'Technik' })
    const stand = await made(`/floors/${upper}/rooms`, { number: '1.01', name: 'Tribüne' })

    await made(`/buildings/${building}/assets`, {
      kind: 'probe.water_meter',
      name: 'Wasserzähler Halle',
      roomId: technik,
      meterNumber: '9WAT7654321',
      meterUnit: 'cubic_metres',
    })
    await made(`/buildings/${building}/assets`, {
      kind: 'probe.elevator',
      name: 'Aufzug Tribüne',
      roomId: stand,
    })
    await limit('u-auditor', [], ['probe.water_meter'])

    const ids = async (tx: TenantTransaction, table: string) =>
      (await tx.execute<{ id: string }>(`select id from ${table} order by id`)).rows.map(
        (row) => row.id,
      )
    const seen = await database.forTenant(
      { tenantId: tenant, userId: 'u-auditor' },
      async (tx) => ({
        properties: await ids(tx, 'properties'),
        buildings: await ids(tx, 'buildings'),
        floors: await ids(tx, 'floors'),
        rooms: await ids(tx, 'rooms'),
      }),
    )
    const { rows: buildings } = await admin.query<{ id: string; property_id: string }>(
      'select id, property_id from buildings where tenant_id = $1',
      [tenant],
    )

    // The school with its water meter and the hall; not the depot with its elevator alone.
    expect(seen.properties).toEqual([place.school, hall].sort())
    expect(seen.buildings).toEqual(
      buildings
        .filter((each) => each.property_id === place.school || each.property_id === hall)
        .map((each) => each.id)
        .sort(),
    )
    expect(seen.floors).toEqual([ground])
    expect(seen.rooms).toEqual([technik])
  })
})
