import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type ColumnMapping,
  deadlineImportFields,
  type DutyDetails,
  type EvidencePage,
  evidenceStateVersion,
  legacyNote,
  missingRight,
  planChanged,
  planHasProblems,
  planMakesNothing,
  type Right,
  rightsOfRoles,
  type RoleKey,
  roleKeys,
  suggestedMapping,
  tableBodyType,
  tableColumns,
  tableFileNameHeader,
  tableFileType,
  type TableSheet,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { runDeadlinesOf } from '../deadlines/engine.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The import of the running deadlines of a predecessor application over the
 * routes of the server (#130, section 11 of the concept): the preview that
 * writes nothing, and the take-over that confirms duties, writes the evidence
 * of the origin "Altbestand" and files the old evidence beyond it, all of it
 * or none.
 *
 * What a plan makes of the lines of a list is `domain`'s and tested there.
 * What is held here is what the routes promise around it: whose rights they
 * take, that nothing is written before the take-over and nothing by one that
 * is refused, that no deadline is due earlier or later than the list says,
 * that what was taken over is marked as such wherever it is shown, and that
 * nobody imports past the areas they hold in.
 *
 * Every test has a tenant of its own, so that what it counts is what it made.
 */

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
}

/** A day that was, counted back from today: an evidence is of a day that was. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

/** A day to come. */
function daysAhead(days: number): string {
  return daysAgo(-days)
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

interface Tenant {
  readonly id: TenantId
  readonly areas: Readonly<Record<string, string>>
}

/** A tenant the four people work for, with the areas named; the Objektleitung holds in the first alone. */
async function tenantWith(...areaNames: string[]): Promise<Tenant> {
  const id = newId<'tenant'>() as TenantId

  await admin.query('insert into tenants (id, name) values ($1, $2)', [id, 'Wohnbau Nord eG'])

  for (const name of areaNames) {
    await admin.query('insert into areas (tenant_id, name) values ($1, $2)', [id, name])
  }

  for (const role of roleKeys) {
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      id,
      people[role],
      [role],
    ])
  }

  const { rows } = await admin.query<{ id: string; name: string }>(
    'select id, name from areas where tenant_id = $1 order by created_at, id',
    [id],
  )
  const areas = Object.fromEntries(rows.map((row) => [row.name, row.id]))

  if (areaNames.length > 0) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [id, people.site_management, areas[areaNames[0] ?? '']],
    )
  }

  return { id, areas: areaNames.length > 0 ? areas : { '': rows[0]?.id ?? '' } }
}

function by(role: RoleKey, tenant: Tenant): string {
  return as(tenant.id, people[role], role)
}

/** Somebody of a role with rights a role of a tenant's own could give or leave out. */
function holding(tenant: Tenant, role: RoleKey, rights: readonly Right[]): string {
  return JSON.stringify({ userId: people[role], tenantId: tenant.id, roles: [role], rights })
}

async function made(header: string, path: string, body: object): Promise<Record<string, unknown>> {
  return (await http().post(path).set(testIdentityHeader, header).send(body).expect(201))
    .body as Record<string, unknown>
}

interface Stock {
  readonly property: string
  readonly building: string
  /** An elevator with the mark AUF-1. */
  readonly asset: string
}

/** A property with a building and an elevator in it, in the area named. */
async function stockIn(tenant: Tenant, area = Object.keys(tenant.areas)[0] ?? '', mark = 'AUF-1') {
  const header = by('technical_management', tenant)
  const property = (
    await made(header, '/properties', {
      name: `Schulzentrum ${area}`,
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      areaId: tenant.areas[area],
    })
  )['id'] as string
  const building = (
    await made(header, `/properties/${property}/buildings`, {
      name: 'Schulhaus',
      kinds: ['school'],
    })
  )['id'] as string
  const asset = (
    await made(header, `/buildings/${building}/assets`, {
      kind: 'probe.elevator',
      name: 'Aufzug Nord',
      mark,
    })
  )['id'] as string

  return { property, building, asset } satisfies Stock
}

let hashes = 0

/** A file of the tenant that went up ahead: a row of the store, by a hash nobody else has. */
async function sentAhead(tenant: Tenant, name: string, sizeBytes = 2048) {
  hashes += 1

  const sha256 = hashes.toString(16).padStart(64, 'a')

  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, $3, 'application/pdf')`,
    [tenant.id, sha256, sizeBytes],
  )

  return { name, sha256, sizeBytes, previewSha256: null }
}

const header = [
  'Kennzeichen',
  'Pflicht',
  'Letzter Nachweis',
  'Nächste Fälligkeit',
  'Vermerk',
  'Datei',
  'Grundlage',
  'Quelle',
  'Tätigkeit',
  'Frist',
]

interface Line {
  readonly mark?: string
  readonly duty?: string
  readonly performedOn?: string
  readonly nextDueOn?: string
  readonly remark?: string
  readonly file?: string
  /** A duty of the operator's own, a yearly maintenance by the word of the manufacturer. */
  readonly own?: boolean
}

function line({
  mark = 'AUF-1',
  duty = 'Hauptprüfung der Aufzugsanlage',
  performedOn = daysAgo(400),
  nextDueOn = '',
  remark = '',
  file = '',
  own = false,
}: Line = {}): string[] {
  return [
    mark,
    duty,
    performedOn,
    nextDueOn,
    remark,
    file,
    ...(own
      ? ['Hersteller', 'Betriebsanleitung, Abschnitt 7', 'Wartung', '12 Monate']
      : ['', '', '', '']),
  ]
}

/** A sheet of lines with every column given the field its name says. */
function list(...rows: string[][]): { sheet: TableSheet; mapping: ColumnMapping } {
  const sheet: TableSheet = { name: '', rows: [header, ...rows] }

  return { sheet, mapping: suggestedMapping(tableColumns(sheet), deadlineImportFields) }
}

function send(path: string, identity: string, body: unknown) {
  return http()
    .post(path)
    .set(testIdentityHeader, identity)
    .set('Content-Type', tableBodyType)
    .send(JSON.stringify(body))
}

interface Preview {
  readonly counts: Readonly<Record<string, number>>
  readonly problems: readonly { readonly what: string }[]
  readonly rows: readonly { readonly line: number; readonly dueOn: string | null }[]
  readonly files: readonly string[]
  readonly unusedFiles: number
}

async function preview(identity: string, body: object): Promise<Preview> {
  return (await send('/imports/deadlines/preview', identity, body).expect(200)).body as Preview
}

/** Takes a list over as the page does: with the counts its preview showed. */
async function taken(tenant: Tenant, body: { files?: unknown[] } & object) {
  const identity = by('technical_management', tenant)
  const { counts } = await preview(identity, body)

  return send('/imports/deadlines', identity, {
    ...body,
    fileName: 'fristen.csv',
    expected: counts,
  })
}

const counted = [
  'duties',
  'evidence',
  'attachments',
  'attachment_versions',
  'imports',
  'audit_entries',
] as const

/** How many rows the tables hold that the import writes, and how far the numbers have been drawn. */
async function rowCounts(): Promise<Record<string, number>> {
  const { rows } = await admin.query<Record<string, number>>(
    `select ${counted.map((name) => `(select count(*)::int from ${name}) as ${name}`).join(', ')},
            (select coalesce(sum(next_value), 0)::int from number_ranges) as numbers_drawn`,
  )

  return rows[0] ?? {}
}

async function rowsOf<Row>(tenant: Tenant, sql: string): Promise<Row[]> {
  return (await admin.query(sql, [tenant.id])).rows as Row[]
}

async function dutyOf(tenant: Tenant, id: string): Promise<DutyDetails> {
  return (
    await http()
      .get(`/duties/${id}`)
      .set(testIdentityHeader, by('technical_management', tenant))
      .expect(200)
  ).body as DutyDetails
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const role of roleKeys) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      people[role],
      role === 'technical_management' ? 'Petra Lindner' : people[role],
      `${people[role]}@beispiel.example`,
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue: catalogueOf(probeCatalogueBundle) }),
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

describe('who imports running deadlines', () => {
  it('is whoever keeps the register of duties and enters evidence, and nobody with one of the two', async () => {
    const tenant = await tenantWith()

    await stockIn(tenant)

    const body = list(line())
    const paths = ['/imports/deadlines/preview', '/imports/deadlines'] as const

    for (const role of ['site_management', 'technician'] as const) {
      for (const path of paths) {
        expect((await send(path, by(role, tenant), body)).status).toBe(403)
      }
    }

    // A role of a tenant's own that keeps the register and enters no evidence.
    const withoutEvidence = holding(
      tenant,
      'technical_management',
      [...rightsOfRoles(['technical_management'])].filter((right) => right !== 'evidence.write'),
    )

    for (const path of paths) {
      const answer = await send(path, withoutEvidence, body)

      expect([answer.status, (answer.body as { message: string }).message]).toEqual([
        403,
        missingRight('evidence.write'),
      ])
    }

    expect(
      (
        await http()
          .post('/imports/deadlines/table')
          .set(testIdentityHeader, withoutEvidence)
          .set('Content-Type', tableFileType)
          .set(tableFileNameHeader, 'fristen.csv')
          .send(Buffer.from('Kennzeichen;Pflicht\nAUF-1;Hauptprüfung der Aufzugsanlage\n'))
      ).status,
    ).toBe(403)

    for (const role of ['management', 'technical_management'] as const) {
      expect((await send(paths[0], by(role, tenant), body)).status).toBe(200)
    }

    expect(await rowsOf(tenant, 'select id from evidence where tenant_id = $1')).toEqual([])
  })

  it('finds no asset beyond the areas somebody holds in', async () => {
    const tenant = await tenantWith('Nord', 'Süd')

    await stockIn(tenant, 'Nord', 'AUF-1')
    await stockIn(tenant, 'Süd', 'AUF-2')

    // The Objektleitung holds in Nord alone; here with the rights of the Technische Leitung.
    const narrow = holding(tenant, 'site_management', [...rightsOfRoles(['technical_management'])])
    const seen = await preview(narrow, list(line({ mark: 'AUF-1' }), line({ mark: 'AUF-2' })))

    expect(seen.problems.map((problem) => problem.what)).toEqual([
      'Eine Anlage mit dem Kennzeichen „AUF-2“ gibt es in Ihren Bereichen nicht',
    ])
    expect(
      (
        await send('/imports/deadlines', narrow, {
          ...list(line({ mark: 'AUF-2' })),
          expected: { duties: 1, evidence: 1, documents: 0, known: 0 },
        })
      ).status,
    ).toBe(422)
    expect(await rowsOf(tenant, 'select id from duties where tenant_id = $1')).toEqual([])
  })
})

describe('the preview of a list of running deadlines', () => {
  it('says what the list would make and which files go up, and writes nothing', async () => {
    const tenant = await tenantWith()

    await stockIn(tenant)

    const before = await rowCounts()
    const seen = await preview(by('technical_management', tenant), {
      ...list(
        line({ nextDueOn: daysAhead(200), file: 'aufzug-2024.pdf' }),
        line({ performedOn: daysAgo(1100), file: 'Aufzug-2022.PDF' }),
        line({ duty: 'Wartung', own: true, performedOn: daysAgo(100) }),
      ),
      files: [{ name: 'aufzug-2024.pdf' }, { name: 'aufzug-2022.pdf' }, { name: 'plan.pdf' }],
    })

    expect(seen.problems).toEqual([])
    expect(seen.counts).toEqual({ duties: 2, evidence: 2, documents: 1, known: 0 })
    // By the names they were chosen under, and the one no line names is counted.
    expect([...seen.files].sort()).toEqual(['aufzug-2022.pdf', 'aufzug-2024.pdf'])
    expect(seen.unusedFiles).toBe(1)
    expect(await rowCounts()).toEqual(before)
  })

  it('takes no two files of one name', async () => {
    const tenant = await tenantWith()
    const answer = await send('/imports/deadlines/preview', by('technical_management', tenant), {
      ...list(line()),
      files: [{ name: 'bericht.pdf' }, { name: 'Bericht.PDF' }],
    })

    expect([answer.status, (answer.body as { message: string }).message]).toEqual([
      400,
      'Die Datei „Bericht.PDF“ ist zweimal gewählt. Eine Zeile nennt ihre Datei beim Namen, also hat jede ihren eigenen.',
    ])
  })
})

describe('taking a list of running deadlines over', () => {
  it('confirms the duty, writes the evidence as taken over and files its document, due as the list says', async () => {
    const tenant = await tenantWith()
    const { asset, property } = await stockIn(tenant)
    const report = await sentAhead(tenant, 'aufzug-2024.pdf')
    const old = await sentAhead(tenant, 'aufzug-2022.pdf', 512)
    const performedOn = daysAgo(400)
    const nextDueOn = daysAhead(200)
    const answer = await taken(tenant, {
      ...list(
        line({ performedOn, nextDueOn, remark: 'ohne prüfbare Unterschrift', file: report.name }),
        line({ performedOn: daysAgo(1100), file: old.name }),
      ),
      files: [report, old, { name: 'plan.pdf' }],
    })

    expect(answer.status).toBe(201)
    expect(answer.body).toMatchObject({
      counts: { duties: 1, evidence: 1, documents: 1, known: 0 },
      summary:
        '1 Nachweis als Altbestand übernommen, 1 Pflicht bestätigt, 1 Dokument als Altbestand abgelegt',
    })

    const [duty] = await rowsOf<Record<string, unknown>>(
      tenant,
      `select id, asset_id, property_id, kind, kind_version, counting, interval_months, maximum_months,
              confirmed_by from duties where tenant_id = $1`,
    )

    expect(duty).toMatchObject({
      asset_id: asset,
      property_id: property,
      kind: 'probe.elevator_main_test',
      kind_version: 1,
      counting: 'betrsichv',
      interval_months: 24,
      maximum_months: 24,
      confirmed_by: people.technical_management,
    })

    const [evidence] = await rowsOf<Record<string, unknown>>(
      tenant,
      `select id, duty_id, origin, performed_on::text, next_due_on::text, result, performed_by, examiner,
              activity_id, written_by, number, state from evidence where tenant_id = $1`,
    )

    expect(evidence).toMatchObject({
      duty_id: duty?.['id'],
      origin: 'legacy',
      performed_on: performedOn,
      next_due_on: nextDueOn,
      result: 'without_defects',
      // It names nobody who did it: it claims no signature it cannot show.
      performed_by: null,
      examiner: null,
      activity_id: null,
      written_by: people.technical_management,
    })
    expect(evidence?.['state']).toMatchObject({
      version: evidenceStateVersion,
      number: evidence?.['number'],
      origin: 'legacy',
      performedOn,
      nextDueOn,
      remark: 'ohne prüfbare Unterschrift',
      performer: null,
      signatures: [],
      files: [{ sha256: report.sha256, name: report.name, mediaType: 'application/pdf' }],
      writtenBy: 'Petra Lindner',
    })

    // The file of the evidence and the older one, both at the asset and marked as taken over.
    expect(
      await rowsOf(
        tenant,
        `select a.title, a.kind, a.legacy, a.asset_id, v.sha256, v.file_name, v.size_bytes::int
           from attachments a join attachment_versions v on v.attachment_id = a.id
          where a.tenant_id = $1 order by v.size_bytes desc`,
      ),
    ).toEqual([
      {
        title: 'aufzug-2024',
        kind: 'test_certificate',
        legacy: true,
        asset_id: asset,
        sha256: report.sha256,
        file_name: report.name,
        size_bytes: 2048,
      },
      {
        title: `Hauptprüfung der Aufzugsanlage vom ${daysAgo(1100).split('-').reverse().join('.')}`,
        kind: 'test_certificate',
        legacy: true,
        asset_id: asset,
        sha256: old.sha256,
        file_name: old.name,
        size_bytes: 512,
      },
    ])
    expect(
      await rowsOf(
        tenant,
        'select kind, file_name, lines, summary from imports where tenant_id = $1',
      ),
    ).toEqual([
      {
        kind: 'deadlines',
        file_name: 'fristen.csv',
        lines: 2,
        summary:
          '1 Nachweis als Altbestand übernommen, 1 Pflicht bestätigt, 1 Dokument als Altbestand abgelegt',
      },
    ])

    // No deadline is due earlier or later than the list says: under § 14 Abs. 5 BetrSichV in its month.
    const standing = await dutyOf(tenant, duty?.['id'] as string)

    expect(standing.appointment?.dueOn).toBe(`${nextDueOn.slice(0, 7)}-01`)
    expect(standing.lastMetOn).toBe(performedOn)

    // And the evidence says what it is wherever it is read.
    const page = (
      await http()
        .get(`/evidence/${evidence?.['id'] as string}`)
        .set(testIdentityHeader, by('technician', tenant))
        .expect(200)
    ).body as EvidencePage

    expect([page.state.origin, page.state.nextDueOn, page.standing]).toEqual([
      'legacy',
      nextDueOn,
      'counts',
    ])
    expect(legacyNote(page.state.files.length > 0)).toContain(
      'nicht in dieser Anwendung unterschrieben',
    )

    // The documents as a table say of both that they were taken over.
    const table = await http()
      .get('/attachments/table?format=csv')
      .set(testIdentityHeader, by('technician', tenant))
      .buffer(true)
      .parse((response, done) => {
        const parts: Buffer[] = []

        response.on('data', (part: Buffer) => parts.push(part))
        response.on('end', () => {
          done(null, Buffer.concat(parts).toString('utf8'))
        })
      })
      .expect(200)

    expect((table.body as string).split('Prüfbescheinigung, Altbestand')).toHaveLength(3)
  })

  it('takes a duty of the operator own with the day its list names, however its interval counts', async () => {
    const tenant = await tenantWith()
    const { asset } = await stockIn(tenant)
    const performedOn = daysAgo(100)
    const nextDueOn = daysAhead(31)

    expect(
      (await taken(tenant, list(line({ duty: 'Wartung', own: true, performedOn, nextDueOn }))))
        .status,
    ).toBe(201)

    const [duty] = await rowsOf<Record<string, string>>(
      tenant,
      'select id, label, basis, source_note, task, counting, interval_months from duties where tenant_id = $1',
    )

    expect(duty).toMatchObject({
      label: 'Wartung',
      basis: 'manufacturer',
      source_note: 'Betriebsanleitung, Abschnitt 7',
      task: 'maintenance',
      counting: 'from_performance',
      interval_months: 12,
    })
    // A year after the evidence it would be due in 265 days; the list says in 31.
    expect((await dutyOf(tenant, duty?.['id'] ?? '')).appointment).toEqual({
      dueOn: nextDueOn,
      onTimeUntil: nextDueOn,
    })

    // The file of the asset says the same day, and so does the evidence where it is listed.
    const identity = by('technical_management', tenant)
    const atTheAsset = (
      await http().get(`/assets/${asset}/duties`).set(testIdentityHeader, identity).expect(200)
    ).body as DutyDetails[]

    expect(atTheAsset.map((each) => each.appointment?.dueOn)).toEqual([nextDueOn])
    expect(
      (
        await http()
          .get(`/duties/${duty?.['id'] ?? ''}/evidence`)
          .set(testIdentityHeader, identity)
          .expect(200)
      ).body,
    ).toMatchObject([{ performedOn, origin: 'legacy', standing: 'counts', nextDueOn }])

    // And the deadline the engine keeps for the duty is due on the day of the list.
    const now = new Date()

    await runDeadlinesOf(
      { database, catalogue: catalogueOf(probeCatalogueBundle), now: () => now },
      tenant.id,
      now,
    )
    expect(
      await rowsOf(
        tenant,
        `select anchor_on::text, due_on::text from deadlines where tenant_id = $1 and duty_id is not null`,
      ),
    ).toEqual([{ anchor_on: performedOn, due_on: nextDueOn }])
  })

  it('writes every number of the evidence in one step, and every record with its own entry in the log', async () => {
    const tenant = await tenantWith()

    await stockIn(tenant)

    const before = await rowCounts()
    const [{ head } = { head: 0 }] = await rowsOf<{ head: number }>(
      tenant,
      'select coalesce(max(sequence), 0)::int as head from audit_entries where tenant_id = $1',
    )

    expect(
      (
        await taken(
          tenant,
          list(
            line(),
            line({ duty: 'Wartung', own: true }),
            line({ duty: 'Inspektion', own: true }),
          ),
        )
      ).status,
    ).toBe(201)

    const after = await rowCounts()

    expect([
      (after['duties'] ?? 0) - (before['duties'] ?? 0),
      (after['evidence'] ?? 0) - (before['evidence'] ?? 0),
    ]).toEqual([3, 3])
    expect(
      (
        await rowsOf<{ number: string }>(
          tenant,
          'select number from evidence where tenant_id = $1 order by number',
        )
      ).map((row) => row.number.slice(-5)),
    ).toEqual(['00001', '00002', '00003'])
    // The import once, and every duty and every evidence for itself. The counter
    // of the evidence, which this tenant had not drawn from, was made and moved
    // once for the three of them: one move per evidence would be four changes.
    expect(
      await rowsOf(
        tenant,
        `select table_name, count(distinct change_id)::int as changes from audit_entries
          where tenant_id = $1 and sequence > ${String(head)}
            and table_name in ('imports', 'duties', 'evidence', 'number_ranges')
          group by table_name order by table_name`,
      ),
    ).toEqual([
      { table_name: 'duties', changes: 3 },
      { table_name: 'evidence', changes: 3 },
      { table_name: 'imports', changes: 1 },
      { table_name: 'number_ranges', changes: 2 },
    ])
  })

  it('adds the evidence to a duty that stands and takes a dismissal back with one it confirms', async () => {
    const tenant = await tenantWith()
    const first = await stockIn(tenant)
    const second = await stockIn(tenant, undefined, 'AUF-2')
    const lead = by('technical_management', tenant)
    const standing = (
      await made(lead, '/duties', {
        assetId: first.asset,
        kind: 'probe.elevator_main_test',
        intervalMonths: 12,
      })
    )['id'] as string

    await made(lead, '/duty-dismissals', {
      assetId: second.asset,
      kind: 'probe.elevator_main_test',
      reason: 'Prüft der Vermieter.',
    })

    expect(
      (await taken(tenant, list(line({ mark: 'AUF-1' }), line({ mark: 'AUF-2' })))).status,
    ).toBe(201)
    expect(
      await rowsOf(
        tenant,
        `select d.asset_id, d.interval_months, (select count(*)::int from evidence e where e.duty_id = d.id) as evidence
           from duties d where d.tenant_id = $1 order by d.confirmed_at`,
      ),
    ).toEqual([
      // The duty that stood keeps the year it has, and got its evidence.
      { asset_id: first.asset, interval_months: 12, evidence: 1 },
      { asset_id: second.asset, interval_months: 24, evidence: 1 },
    ])
    expect((await dutyOf(tenant, standing)).lastMetOn).toBe(daysAgo(400))
    expect(
      await rowsOf(
        tenant,
        'select deleted_at is not null as withdrawn from duty_dismissals where tenant_id = $1',
      ),
    ).toEqual([{ withdrawn: true }])
  })

  it('makes nothing of a list it took over before', async () => {
    const tenant = await tenantWith()

    await stockIn(tenant)

    const file = await sentAhead(tenant, 'alt.pdf')
    const body = {
      ...list(line({ file: file.name }), line({ duty: '', performedOn: '', file: file.name })),
      files: [file],
    }

    expect((await taken(tenant, body)).status).toBe(201)

    const before = await rowCounts()
    const again = await preview(by('technical_management', tenant), body)

    expect(again.counts).toEqual({ duties: 0, evidence: 0, documents: 0, known: 2 })

    const answer = await taken(tenant, body)

    expect([answer.status, (answer.body as { message: string }).message]).toEqual([
      422,
      planMakesNothing,
    ])
    expect(await rowCounts()).toEqual(before)
  })

  it('writes nothing where a line is open, the list changed since the preview, or a file is not on the server', async () => {
    const tenant = await tenantWith()

    await stockIn(tenant)

    const identity = by('technical_management', tenant)
    const file = await sentAhead(tenant, 'bericht.pdf')
    // The file of another tenant is not on the server for this one.
    const theirs = await sentAhead(await tenantWith(), 'bericht.pdf')
    const whole = { ...list(line({ file: file.name })), files: [file] }
    const expected = { duties: 1, evidence: 1, documents: 0, known: 0 }
    const before = await rowCounts()
    const refused = async (body: object) => {
      const answer = await send('/imports/deadlines', identity, body)

      return [answer.status, (answer.body as { message: string }).message]
    }

    expect(
      await refused({
        ...list(line({ file: file.name }), line({ mark: 'AUF-9' })),
        files: [file],
        expected,
      }),
    ).toEqual([422, planHasProblems])
    expect(await refused({ ...whole, expected: { ...expected, duties: 0 } })).toEqual([
      409,
      planChanged,
    ])

    const notThere =
      'Die Datei „bericht.pdf“ ist nicht auf dem Server. Wählen Sie die Dateien noch einmal.'

    // Named without its bytes, with a hash the tenant does not hold, and with another size.
    expect(await refused({ ...whole, files: [{ name: file.name }], expected })).toEqual([
      409,
      notThere,
    ])
    expect(
      await refused({ ...whole, files: [{ ...file, sha256: 'b'.repeat(64) }], expected }),
    ).toEqual([409, notThere])
    expect(await refused({ ...whole, files: [{ ...file, sizeBytes: 4096 }], expected })).toEqual([
      409,
      notThere,
    ])

    expect(await refused({ ...whole, files: [theirs], expected })).toEqual([409, notThere])
    expect(await rowCounts()).toEqual(before)
  })

  it('takes no due day beyond the maximum of the duty', async () => {
    const tenant = await tenantWith()

    await stockIn(tenant)

    const performedOn = daysAgo(30)
    const tooLate = new Date(Date.parse(performedOn) + 800 * 86_400_000).toISOString().slice(0, 10)
    const seen = await preview(
      by('technical_management', tenant),
      list(line({ performedOn, nextDueOn: tooLate })),
    )

    expect(seen.problems).toHaveLength(1)
    expect(seen.problems[0]?.what).toContain(
      'liegt hinter der Höchstfrist der Pflicht Hauptprüfung der Aufzugsanlage',
    )
    expect(seen.counts).toEqual({ duties: 0, evidence: 0, documents: 0, known: 0 })
  })
})

describe('an evidence that was taken over', () => {
  it('keeps the due day of its list through a correction, as long as that day still lies after it', async () => {
    const tenant = await tenantWith()

    await stockIn(tenant)

    const nextDueOn = daysAhead(31)

    expect(
      (
        await taken(
          tenant,
          list(line({ duty: 'Wartung', own: true, performedOn: daysAgo(100), nextDueOn })),
        )
      ).status,
    ).toBe(201)

    const [first] = await rowsOf<{ id: string; duty_id: string }>(
      tenant,
      'select id, duty_id from evidence where tenant_id = $1',
    )
    const corrected = (
      await made(by('technical_management', tenant), `/evidence/${first?.id ?? ''}/correction`, {
        performedOn: daysAgo(90),
        result: 'with_defects',
        reason: 'Die Liste nannte den falschen Tag.',
      })
    )['id'] as string

    expect(
      await rowsOf(
        tenant,
        `select next_due_on::text, origin from evidence where tenant_id = $1 and id = '${corrected}'`,
      ),
    ).toEqual([{ next_due_on: nextDueOn, origin: 'legacy' }])
    expect((await dutyOf(tenant, first?.duty_id ?? '')).appointment?.dueOn).toBe(nextDueOn)
  })
})
