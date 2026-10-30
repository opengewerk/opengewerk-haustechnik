import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  auditLanguage,
  auditVocabulary,
  catalogueOf,
  drawingInThePrint,
  missingRight,
  type RoleKey,
  shippedRoles,
  type SubjectAccess,
  type SubjectAccessChoice,
  type SubjectAccessMatch,
  subjectAccessNeedsEveryArea,
  subjectAccessParts,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId, type PrintJob } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { insertOf, rowsOf, rowsOfTheInstance, type Tenant } from '../database/test-tenant-rows.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The information about a person (#355, section 3 of the concept): made by
 * the Leitung that sees every area, about a person with an access as a PDF
 * or JSON, with every part a module holds about that person and nothing about
 * another, and about a person without one by a search for a name or address.
 *
 * The tenant is filled as the test of the isolation fills one: a row in every
 * table, every column that points at a person naming its Leitung or its
 * colleague, often both in one row. The information is about each of them in
 * turn; a third person shares some of those rows as well, and nothing of the
 * one it is not about may come along.
 */

const north: Tenant = {
  id: newId<'tenant'>(),
  name: 'Wohnbau <Nord> eG',
  userId: 'user-north',
  email: 'leitung@nord.example',
  colleagueId: 'colleague-north',
}
const south: Tenant = {
  id: newId<'tenant'>(),
  name: 'Wohnbau Süd eG',
  userId: 'user-south',
  email: 'leitung@sued.example',
  colleagueId: 'colleague-south',
}

/** The other person, who shares rows with the colleague and must not appear in her information. */
const other = { id: 'other-north', name: 'Bettina Anders', email: 'b.anders@nord.example' }

const catalogue = catalogueOf(probeCatalogueBundle)
const rendered: PrintJob[] = []

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: string, role: RoleKey = 'management', tenantId: TenantId = north.id): string {
  return as(tenantId, userId, role)
}

/** The information about a person of the north as JSON, asked by its Leitung. */
async function about(userId: string): Promise<SubjectAccess> {
  const answer = await http()
    .get(`/settings/subject-access/people/${userId}?format=json`)
    .set(testIdentityHeader, by(north.userId))
    .expect(200)

  return JSON.parse(answer.text) as SubjectAccess
}

/** The three people of the north as their values stand in a file: id, name and address, each as a JSON string. */
const people = {
  [north.userId]: [north.userId, `Leitung ${north.name}`, north.email],
  [north.colleagueId]: [north.colleagueId, `Kollegium ${north.name}`, `kollegium-${north.email}`],
  [other.id]: [other.id, other.name, other.email],
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  const asAdmin = drizzle(admin)

  for (const row of rowsOfTheInstance(north, south)) {
    await asAdmin.execute(insertOf(row))
  }

  for (const tenant of [north, south]) {
    for (const row of rowsOf(tenant)) {
      if (row.table !== 'audit_redactions') {
        await asAdmin.execute(insertOf(row))
      }
    }

    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenant.id, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  // The Leitung of the north sees every area; the colleague leads, so that
  // she blacks out a value of the log below.
  await admin.query('insert into member_all_areas (tenant_id, user_id) values ($1, $2)', [
    north.id,
    north.userId,
  ])
  await admin.query(
    `update memberships set roles = '{management}' where tenant_id = $1 and user_id in ($2, $3)`,
    [north.id, north.userId, north.colleagueId],
  )

  // The other person, beside the colleague in rows of the north.
  await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
    other.id,
    other.name,
    other.email,
  ])
  await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
    north.id,
    other.id,
    ['technician'],
  ])
  await admin.query(
    'update duties set confirmed_by = $2, confirmed_at = now() where tenant_id = $1',
    [north.id, other.id],
  )
  await admin.query('update tasks set created_by = $2 where tenant_id = $1', [north.id, other.id])
  await admin.query('update substitutions set substitute_user_id = $2 where tenant_id = $1', [
    north.id,
    other.id,
  ])

  // Who filed a version of a document and who changed a row last, the
  // database writes from the session; the rows above went in without one.
  for (const [table, column] of [
    ['attachment_versions', 'created_by'],
    ['duties', 'updated_by'],
  ] as const) {
    await admin.query(`alter table ${table} disable trigger user`)

    try {
      await admin.query(`update ${table} set ${column} = $2 where tenant_id = $1`, [
        north.id,
        north.colleagueId,
      ])
    } finally {
      await admin.query(`alter table ${table} enable trigger user`)
    }
  }

  database = Database.connect(applicationDatabaseUrl())

  // A change by the other person and a redaction by the colleague, through the application.
  await database.forTenant({ tenantId: north.id, userId: other.id, reason: 'task.write' }, (tx) =>
    tx.execute(sql`update tasks set title = title || ' (geprüft)' where tenant_id = ${north.id}`),
  )
  await database.forTenant(
    { tenantId: north.id, userId: north.colleagueId, reason: 'audit.redact' },
    (tx) =>
      tx.execute(sql`insert into audit_redactions (tenant_id, entry_id, side, reason, redacted_by)
        select tenant_id, id, 'new', 'Auskunft der Person', ${north.colleagueId}
          from audit_entries
         where tenant_id = ${north.id} and new_value is not null and table_name = 'processing_descriptions'
         order by sequence desc limit 1`),
  )

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        renderer: (job) => {
          rendered.push(job)

          return Promise.resolve(new TextEncoder().encode('%PDF-1.7 probe'))
        },
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

describe('the information about a person with an access (#355)', () => {
  it('holds what every module holds about the person', async () => {
    const lead = await about(north.userId)
    const colleague = await about(north.colleagueId)

    expect(colleague.about).toEqual({
      kind: 'account',
      name: `Kollegium ${north.name}`,
      email: `kollegium-${north.email}`,
    })
    expect(colleague.operator).toBe(north.name)
    expect(colleague.parts.map((part) => part.key)).toEqual(Object.keys(subjectAccessParts))

    // Every part that reads a field of appendix B finds one of the two there,
    // since every such column of the tenant names one of them.
    const empty = Object.entries(subjectAccessParts)
      .filter(([, part]) => part.sources.length > 0)
      .map(([key]) => key)
      .filter((key) =>
        [lead, colleague].every(
          (access) => (access.parts.find((part) => part.key === key)?.rows.length ?? 0) === 0,
        ),
      )

    expect(empty).toEqual([])
  })

  it('says nothing about another person, not where they share a row', async () => {
    for (const userId of [north.userId, north.colleagueId]) {
      const text = JSON.stringify(await about(userId))

      for (const [someone, values] of Object.entries(people)) {
        for (const value of someone === userId ? [] : values) {
          expect(text).not.toContain(JSON.stringify(value))
        }
      }

      expect(text).not.toContain(south.colleagueId)
    }
  })

  it('is printed with every value escaped and the drawing of the signatures', async () => {
    rendered.length = 0

    const answer = await http()
      .get(`/settings/subject-access/people/${north.userId}?format=pdf`)
      .set(testIdentityHeader, by(north.userId))
      .expect(200)

    expect(answer.headers['content-type']).toBe('application/pdf')
    expect(answer.headers['cache-control']).toBe('no-store')

    const job = rendered[0]

    expect(job?.html).toContain('Auskunft über Leitung Wohnbau &lt;Nord&gt; eG')
    expect(job?.html).not.toContain('<Nord>')
    expect(job?.html).toContain('<svg')
    expect(job?.html).not.toContain(other.name)
  })

  /**
   * Section 3.22 of the processing description: the information is not kept,
   * and that it was made is held nowhere (#355, #530), neither as a print nor
   * as a line of the change log.
   */
  it('keeps no print of itself and writes no line of the change log', async () => {
    const counted = async () =>
      (
        await admin.query<{ prints: number; entries: number }>(
          `select (select count(*)::int from prints) as prints,
                  (select count(*)::int from audit_entries) as entries`,
        )
      ).rows[0]
    const before = await counted()

    for (const format of ['pdf', 'json'] as const) {
      await http()
        .get(`/settings/subject-access/people/${north.userId}?format=${format}`)
        .set(testIdentityHeader, by(north.userId))
        .expect(200)
    }

    await http()
      .get('/settings/subject-access/matches/file?term=becker&format=json')
      .set(testIdentityHeader, by(north.userId))
      .expect(200)

    expect(await counted()).toEqual(before)
  })

  /**
   * A file any editor changes holds no signature (#457): the machine-readable
   * file says that a drawing is there, and the PDF draws it.
   */
  it('holds no drawing of a signature in the machine-readable file, only that one is there', async () => {
    const found = await http()
      .get('/settings/subject-access/matches/file?term=becker&format=json')
      .set(testIdentityHeader, by(north.userId))
      .expect(200)
    const files = [await about(north.userId), JSON.parse(found.text) as SubjectAccess]
    const drawings = files.flatMap((file) =>
      file.parts.flatMap((part) =>
        part.columns
          .filter((column) => column.kind === 'drawing')
          .flatMap((column) => part.rows.map((row) => row[column.key])),
      ),
    )

    expect(drawings).toContain(drawingInThePrint)
    expect(drawings.filter((value) => value !== null && value !== drawingInThePrint)).toEqual([])

    // Nor anywhere else in the file: no string in it is the path of a signature.
    const strings = [...found.text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? '')

    expect(strings.filter((value) => /^M\s*-?\d/.test(value))).toEqual([])
  })

  it('is made only by the Leitung, of a person of this operator, by a Leitung that sees every area', async () => {
    for (const role of ['technical_management', 'site_management', 'technician'] as const) {
      const refused = await http()
        .get(`/settings/subject-access/people/${north.colleagueId}?format=json`)
        .set(testIdentityHeader, by(north.userId, role))
        .expect(403)

      expect(refused.body.message).toBe(missingRight('membership.read'))
      await http()
        .get('/settings/subject-access?')
        .set(testIdentityHeader, by(north.userId, role))
        .expect(403)
      await http()
        .get('/settings/subject-access/matches?term=Becker')
        .set(testIdentityHeader, by(north.userId, role))
        .expect(403)
      await http()
        .get('/settings/subject-access/matches/file?term=Becker&format=json')
        .set(testIdentityHeader, by(north.userId, role))
        .expect(403)
    }

    // A person of the south is no person of the north, and a file is a PDF or JSON.
    await http()
      .get(`/settings/subject-access/people/${south.colleagueId}?format=json`)
      .set(testIdentityHeader, by(north.userId))
      .expect(404)
    await http()
      .get(`/settings/subject-access/people/${north.colleagueId}?format=xlsx`)
      .set(testIdentityHeader, by(north.userId))
      .expect(400)

    // The Leitung of the south does not see every area, so it gets no information at all.
    const partial = await http()
      .get(`/settings/subject-access/people/${south.colleagueId}?format=json`)
      .set(testIdentityHeader, by(south.userId, 'management', south.id))
      .expect(403)

    expect(partial.body.message).toBe(subjectAccessNeedsEveryArea)

    const searching = await http()
      .get('/settings/subject-access/matches?term=Becker')
      .set(testIdentityHeader, by(south.userId, 'management', south.id))
      .expect(403)

    expect(searching.body.message).toBe(subjectAccessNeedsEveryArea)

    const choice = (
      await http()
        .get('/settings/subject-access')
        .set(testIdentityHeader, by(north.userId))
        .expect(200)
    ).body as SubjectAccessChoice

    expect(choice.everyArea).toBe(true)
    expect(choice.people.map((person) => person.userId)).toContain(north.colleagueId)
    expect(choice.people.map((person) => person.userId)).not.toContain(south.colleagueId)
  })

  /**
   * Since migration 0095 a session holds whether it carries a second factor
   * (#481), and the information names it for each session here (#482).
   */
  it('names for each session here whether it carries a second factor', async () => {
    const withTheApp = 'session-482-app'
    const withThePassword = 'session-482-password'

    await admin.query(
      `insert into auth_sessions (id, token, user_id, expires_at, active_tenant_id, sign_in_method,
                                  second_factor, user_agent)
       values ($1, $1, $3, now() + interval '1 hour', $4, 'password', true, 'Probe mit App'),
              ($2, $2, $3, now() + interval '1 hour', $4, 'password', false, 'Probe mit Passwort')`,
      [withTheApp, withThePassword, north.colleagueId, north.id],
    )

    try {
      const sessions =
        (await about(north.colleagueId)).parts.find((part) => part.key === 'sessions')?.rows ?? []

      expect(
        sessions
          .filter((row) => row['what'] === 'Sitzung')
          .map((row) => [row['device'], row['secondFactor']])
          .sort(),
      ).toEqual([
        ['Probe mit App', true],
        ['Probe mit Passwort', false],
      ])
      // A sign in the operator writes down is no session, and says nothing of it.
      expect(
        sessions.filter((row) => row['what'] !== 'Sitzung').map((row) => row['secondFactor']),
      ).toEqual(sessions.filter((row) => row['what'] !== 'Sitzung').map(() => null))
    } finally {
      await admin.query('delete from auth_sessions where id = any($1)', [
        [withTheApp, withThePassword],
      ])
    }
  })

  /**
   * A passkey belongs to the account, and the account may work for another
   * operator too (#474): the information names the passkeys this operator
   * knows, live or removed, and not one it does not know, nor when that was
   * used.
   */
  it('names the passkeys this operator knows of the person, and no other', async () => {
    const known = 'passkey-known-474'
    const elsewhere = 'passkey-elsewhere-474'
    const gone = 'passkey-gone-474'

    await admin.query(
      `insert into auth_passkeys (id, name, user_id, public_key, credential_id, counter, device_type,
                                  backed_up, last_used_at)
       values ($1, 'Laptop Büro', $3, 'public-key', $1, 0, 'singleDevice', false, '2026-10-01T08:00:00Z'),
              ($2, 'Telefon bei einem anderen Betreiber', $3, 'public-key', $2, 0, 'singleDevice', false,
               '2026-10-02T09:00:00Z')`,
      [known, elsewhere, north.colleagueId],
    )
    await admin.query(
      `insert into member_passkeys (tenant_id, user_id, passkey_id, name, removed_at)
       values ($1, $2, $3, 'Laptop Büro', null), ($1, $2, $4, 'Alter Schlüssel', now())`,
      [north.id, north.colleagueId, known, gone],
    )

    try {
      const access = await about(north.colleagueId)
      const passkeys = access.parts.find((part) => part.key === 'passkeys')?.rows ?? []

      // A moment as the database writes it, read as a moment.
      const moment = (value: unknown) =>
        value === null ? null : new Date(String(value)).toISOString()

      expect(
        passkeys
          .map((row) => ({
            name: row['name'],
            created: typeof row['createdAt'] === 'string',
            lastUsedAt: moment(row['lastUsedAt']),
            here: row['here'],
          }))
          .sort((left, right) => String(left.name).localeCompare(String(right.name))),
      ).toEqual([
        { name: 'Alter Schlüssel', created: true, lastUsedAt: null, here: false },
        { name: 'Laptop Büro', created: true, lastUsedAt: '2026-10-01T08:00:00.000Z', here: true },
      ])

      const file = JSON.stringify(access)

      expect(file).not.toContain('Telefon bei einem anderen Betreiber')
      // Nor when the passkey only another operator knows was used.
      expect(file).not.toMatch(/2026-10-02[ T]09:00/)
    } finally {
      await admin.query('delete from member_passkeys where passkey_id = any($1)', [[known, gone]])
      await admin.query('delete from auth_passkeys where id = any($1)', [[known, elsewhere]])
    }
  })

  /**
   * Who stored a file is held for that person alone, and whose change met
   * another state and whose password was set anew name the person too (#360):
   * the Leitung finds each in the information about the person, without the
   * values of the conflict, and none in the information about anybody else.
   */
  it('names the files, conflicts, new passwords and second factors of the person, nobody else', async () => {
    const sha256 = 'c0ffee'.repeat(10) + 'beef'
    const conflictId = newId()
    const language = auditLanguage(auditVocabulary)

    await admin.query(
      `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 4321, 'image/jpeg')`,
      [north.id, sha256],
    )
    await admin.query('insert into file_uploads (tenant_id, sha256, user_id) values ($1, $2, $3)', [
      north.id,
      sha256,
      north.colleagueId,
    ])
    await admin.query(
      `insert into sync_conflicts (id, tenant_id, operation_id, entity, record_id, reason, fields, wanted,
                                   seen, found, device_id, user_id, recorded_at)
       values ($1, $2, $3, 'assets', $4, 'changed_elsewhere', '{name,meterUnit}', '{"name": "wanted-360"}', '{}', '{}',
               'phone-of-the-colleague', $5, '2026-10-03T10:00:00Z')`,
      [conflictId, north.id, newId(), newId(), north.colleagueId],
    )
    await admin.query(
      `insert into password_resets (tenant_id, user_id, reset_at) values ($1, $2, '2026-10-04T07:00:00Z')`,
      [north.id, north.colleagueId],
    )
    await admin.query(
      `insert into second_factor_changes (tenant_id, user_id, changed_at) values ($1, $2, '2026-10-04T08:00:00Z')`,
      [north.id, north.colleagueId],
    )

    try {
      const colleague = await about(north.colleagueId)
      const lead = await about(north.userId)
      const rowsIn = (access: SubjectAccess, key: string) =>
        access.parts.find((part) => part.key === key)?.rows ?? []

      expect(rowsIn(colleague, 'uploads').filter((row) => row['size'] === 4321)).toEqual([
        { at: expect.any(String) as unknown, type: 'image/jpeg', size: 4321 },
      ])
      expect(
        rowsIn(colleague, 'conflicts')
          .filter((row) => row['device'] === 'phone-of-the-colleague')
          .map((row) => ({ ...row, at: new Date(String(row['at'])).toISOString() })),
      ).toEqual([
        {
          at: '2026-10-03T10:00:00.000Z',
          record: language.tableLabel('assets'),
          fields: `${language.fieldName('assets', 'name')}, ${language.fieldName('assets', 'meter_unit')}`,
          device: 'phone-of-the-colleague',
          resolvedAt: null,
        },
      ])
      expect(JSON.stringify(colleague)).not.toContain('wanted-360')

      const newPasswords = (access: SubjectAccess) =>
        rowsIn(access, 'sessions')
          .filter((row) => row['what'] === 'Passwort neu gesetzt')
          .map((row) => new Date(String(row['at'])).toISOString())

      expect(newPasswords(colleague)).toEqual(['2026-10-04T07:00:00.000Z'])
      expect(newPasswords(lead)).not.toContain('2026-10-04T07:00:00.000Z')

      // The app set up on the account, or its second factor taken away (#591).
      const secondFactors = (access: SubjectAccess) =>
        rowsIn(access, 'sessions')
          .filter((row) => row['what'] === 'Zweiter Faktor eingerichtet oder zurückgesetzt')
          .map((row) => new Date(String(row['at'])).toISOString())

      expect(secondFactors(colleague)).toEqual(['2026-10-04T08:00:00.000Z'])
      expect(secondFactors(lead)).not.toContain('2026-10-04T08:00:00.000Z')
      expect(rowsIn(lead, 'uploads').some((row) => row['size'] === 4321)).toBe(false)
      expect(JSON.stringify(lead)).not.toContain('phone-of-the-colleague')
    } finally {
      await admin.query('delete from sync_conflicts where id = $1', [conflictId])
      await admin.query('delete from password_resets where user_id = $1', [north.colleagueId])
      await admin.query('delete from second_factor_changes where user_id = $1', [north.colleagueId])
      await admin.query('delete from file_uploads where sha256 = $1', [sha256])
      // The lock on files lets a row go only while it is named as the one
      // being taken (opengewerk/opengewerk#658); the test names it the same way.
      const sweeping = await admin.connect()

      try {
        await sweeping.query('begin')
        await sweeping.query(`select set_config('app.taking_file', $1, true)`, [
          `${north.id}/${sha256}`,
        ])
        await sweeping.query('delete from files where sha256 = $1', [sha256])
        await sweeping.query('commit')
      } finally {
        sweeping.release()
      }
    }
  })
})

describe('the information about a person without an access (#355)', () => {
  it('finds a name or an address, and gives what it found as a file', async () => {
    const matches = (
      await http()
        .get('/settings/subject-access/matches?term=becker')
        .set(testIdentityHeader, by(north.userId))
        .expect(200)
    ).body as SubjectAccessMatch[]

    expect(matches.map((match) => match.part)).toContain('contacts')

    const answer = await http()
      .get('/settings/subject-access/matches/file?term=becker&format=json')
      .set(testIdentityHeader, by(north.userId))
      .expect(200)
    const access = JSON.parse(answer.text) as SubjectAccess

    expect(access.about).toEqual({ kind: 'search', term: 'becker' })
    expect(access.parts.find((part) => part.key === 'contacts')?.rows.length).toBeGreaterThan(0)
  })

  it('gives both numbers of a contact it found (#428)', async () => {
    await admin.query(
      `update contacts set phone = '0000 4471', mobile = '0000 4479'
        where tenant_id = $1 and family_name ilike '%becker%'`,
      [north.id],
    )

    const answer = await http()
      .get('/settings/subject-access/matches/file?term=becker&format=json')
      .set(testIdentityHeader, by(north.userId))
      .expect(200)
    const rows =
      (JSON.parse(answer.text) as SubjectAccess).parts.find((part) => part.key === 'contacts')
        ?.rows ?? []

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.map((row) => [row['phone'], row['mobile']])).toEqual(
      rows.map(() => ['0000 4471', '0000 4479']),
    )
  })

  it('takes a short search or a pattern of its own as nothing to find', async () => {
    await http()
      .get('/settings/subject-access/matches?term=be')
      .set(testIdentityHeader, by(north.userId))
      .expect(400)

    const everything = (
      await http()
        .get(`/settings/subject-access/matches?term=${encodeURIComponent('%%%')}`)
        .set(testIdentityHeader, by(north.userId))
        .expect(200)
    ).body as SubjectAccessMatch[]

    expect(everything).toEqual([])
  })

  it('finds nothing of another operator', async () => {
    const theirs = (
      await http()
        .get('/settings/subject-access/matches?term=becker')
        .set(testIdentityHeader, by(north.userId))
        .expect(200)
    ).body as SubjectAccessMatch[]
    const { rows } = await admin.query<{ count: number }>(
      `select count(*)::int as count from contacts where tenant_id = $1 and family_name ilike '%becker%'`,
      [north.id],
    )

    expect(theirs.filter((match) => match.part === 'contacts')).toHaveLength(rows[0]?.count ?? -1)
  })
})
