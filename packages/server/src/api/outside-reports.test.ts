import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  closedLabelSentence,
  type FaultReportEntry,
  type FaultReportPage,
  labelCodeFrom,
  missingRight,
  type OutsideLabelPage,
  type OutsideReportReceipt,
  type RoleKey,
  shippedRoles,
  staleFormSentence,
  type TenantId,
  tooManyReportsSentence,
  type WorkOrderDetails,
} from '@opengewerk/haustechnik-domain'
import {
  Database,
  FileStore,
  type MailTransport,
  newId,
  type OutgoingMail,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { aMailServer, testKey } from '@opengewerk/platform-server/testing'
import { inArray, sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { inLabelArea } from '../database/label-area.js'
import { faultReports } from '../database/schema/index.js'
import { OutsideReports } from '../faults/outside-gate.js'
import { answerOutsideReports } from '../notifications/outside-answers.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The page of a label for somebody without an account (#332, section 4.7 of
 * the concept): closed alike for every label that takes no report, the room
 * on the label and nothing else for one that does, a report in the inbox of
 * the area that names nobody, the limits per address and per label, the
 * form with its least time and the field nobody sees, a photo by its bytes,
 * and the address for the answer in no log and gone once the report is done.
 */

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const operator = newId<'tenant'>() as TenantId
const neighbour = newId<'tenant'>() as TenantId

const people = {
  'u-lead': ['management', null],
  'u-site': ['site_management', 'north'],
  'u-site-south': ['site_management', 'south'],
  'u-tech': ['technician', 'north'],
} as const satisfies Readonly<Record<string, readonly [RoleKey, 'north' | 'south' | null]>>

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication
let folder = ''
const area = { north: '', south: '' }
/** The clock of the gate: a test moves it instead of waiting. */
let clock = Date.parse('2026-10-16T08:00:00.000Z')

/** The gate of the page, on the clock of the test. */
const gate = new OutsideReports(() => clock)

function http() {
  return request(app.getHttpServer())
}

function by(person: Person): string {
  return as(operator, person, people[person][0])
}

async function one<Row>(text: string, values: readonly unknown[]): Promise<Row> {
  const { rows } = await admin.query(text, [...values])

  return rows[0] as Row
}

interface Place {
  readonly property: string
  readonly building: string
  readonly room: string
  readonly asset: string
  /** An asset that stands in no room. */
  readonly loose: string
}

let north: Place
let south: Place

/** A property in an area, a building, a room, an asset in it and one in no room. */
async function placeIn(where: 'north' | 'south'): Promise<Place> {
  const areaId = area[where]
  const header = by('u-lead')
  const property = (
    await http()
      .post('/properties')
      .set(testIdentityHeader, header)
      .send({
        name: `Schulzentrum ${newId<'property'>().slice(0, 6)}`,
        street: 'Am Lindenhain 7',
        postalCode: '68535',
        city: 'Edingen-Neckarhausen',
        federalState: 'DE-BW',
        areaId,
      })
      .expect(201)
  ).body.id as string
  const building = (
    await http()
      .post(`/properties/${property}/buildings`)
      .set(testIdentityHeader, header)
      .send({ name: 'Schulhaus', kinds: ['school'] })
      .expect(201)
  ).body.id as string
  const floor = await one<{ id: string }>(
    `insert into floors (tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, '2. Obergeschoss', 2) returning id`,
    [operator, building, property, areaId],
  )
  const room = await one<{ id: string }>(
    `insert into rooms (tenant_id, floor_id, building_id, property_id, area_id, number, name)
     values ($1, $2, $3, $4, $5, '2.05', 'Lehrerzimmer') returning id`,
    [operator, floor.id, building, property, areaId],
  )
  const asset = (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, header)
      .send({ kind: 'probe.elevator', name: 'Personenaufzug', roomId: room.id })
      .expect(201)
  ).body.id as string
  const loose = (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, header)
      .send({ kind: 'probe.elevator', name: 'Lastenaufzug Hof' })
      .expect(201)
  ).body.id as string

  return { property, building, room: room.id, asset, loose }
}

/** A new label on what is named, valid unless it says otherwise; its code. */
async function labelOn(
  place: Place,
  where: 'north' | 'south',
  on: { readonly asset?: string; readonly room?: string },
  blocked = false,
): Promise<string> {
  const code = labelCodeFrom(randomBytes(10))

  // A room and an asset have one valid label: the one before is blocked, as a new print does.
  if (!blocked && (on.asset !== undefined || on.room !== undefined)) {
    await admin.query(
      `update labels set blocked_at = now()
        where tenant_id = $1 and blocked_at is null and (asset_id = $2 or room_id = $3)`,
      [operator, on.asset ?? null, on.room ?? null],
    )
  }

  await admin.query(
    `insert into labels (tenant_id, property_id, area_id, asset_id, room_id, code, blocked_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      operator,
      place.property,
      area[where],
      on.asset ?? null,
      on.room ?? null,
      code,
      blocked ? new Date() : null,
    ],
  )

  return code
}

/** An address of the internet a request comes from, behind the proxy of the instance. */
function from(address: string) {
  return { 'x-forwarded-for': address }
}

let addresses = 0

/** A new address, so that a test does not run into the limit of another. */
function anAddress(): string {
  addresses += 1

  return `198.51.100.${String(addresses)}`
}

function opened(code: string, address = anAddress()) {
  return http().get(`/fault-reports/by-label/${code}`).set(from(address))
}

function sent(code: string, body: object, address = anAddress()) {
  return http().post(`/fault-reports/by-label/${code}`).set(from(address)).send(body)
}

/** The page of an open label, and the clock moved on as far as a person reads it. */
async function filledIn(code: string): Promise<{ form: string; categoryId: string }> {
  const page = (await opened(code).expect(200)).body as OutsideLabelPage

  if (!page.open) {
    throw new Error('The label is closed')
  }

  clock += 5_000

  return { form: page.form, categoryId: page.categories[0]?.id ?? '' }
}

/** A report over a label that is taken; its id, found in the database. */
async function reportedOver(
  code: string,
  over: object = {},
): Promise<{ readonly id: string; readonly receipt: OutsideReportReceipt }> {
  const form = await filledIn(code)
  const description = `Heizkörper bleibt kalt ${randomBytes(4).toString('hex')}`
  const receipt = (await sent(code, { ...form, description, ...over }).expect(201))
    .body as OutsideReportReceipt
  const row = await one<{ id: string }>('select id from fault_reports where description = $1', [
    description,
  ])

  return { id: row.id, receipt }
}

function switched(on: boolean, person: Person = 'u-lead') {
  return http()
    .put('/settings/fault-reports')
    .set(testIdentityHeader, by(person))
    .send({ openByLabel: on })
}

/** A picture as a phone sends it: one pixel of PNG. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function photoOf(code: string, slip: string, bytes: Buffer) {
  return http()
    .put(`/fault-reports/by-label/${code}/photo/${slip}`)
    .set('content-type', 'application/octet-stream')
    .send(bytes)
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    operator,
    'Liegenschaften Beispielstadt',
    neighbour,
    'Wohnbau Nord eG',
  ])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [operator, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [operator],
  )

  area.north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  area.south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, [role, sees]] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@beispielstadt.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      operator,
      userId,
      [role],
    ])

    if (sees !== null) {
      await admin.query(
        'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
        [operator, userId, area[sees]],
      )
    }
  }

  database = Database.connect(applicationDatabaseUrl())
  folder = mkdtempSync(join(tmpdir(), 'haustechnik-outside-'))

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        files: new FileStore(folder),
        outside: gate,
      }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  north = await placeIn('north')
  south = await placeIn('south')

  // The categories the first start proposes, written by the settings.
  await http().get('/settings/fault-categories').set(testIdentityHeader, by('u-lead')).expect(200)
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('the page of a label without an account', () => {
  it('is shipped off, and switched by whoever changes the settings alone', async () => {
    expect(
      (
        await http()
          .get('/settings/fault-reports')
          .set(testIdentityHeader, by('u-lead'))
          .expect(200)
      ).body,
    ).toEqual({ openByLabel: false })

    const code = await labelOn(north, 'north', { room: north.room })

    expect((await opened(code).expect(200)).body).toEqual({ open: false })
    expect((await switched(true, 'u-site').expect(403)).body.message).toBe(
      missingRight('settings.write'),
    )
    await switched(true).expect(200)
    expect((await opened(code).expect(200)).body).toMatchObject({ open: true })
  })

  it('says the same of a label that is unknown, blocked, on nothing or of an operator with the page off', async () => {
    await switched(true).expect(200)

    const blocked = await labelOn(north, 'north', { room: north.room }, true)
    const onNothing = await labelOn(north, 'north', {})
    const unknown = labelCodeFrom(randomBytes(10))
    const elsewhere = labelCodeFrom(randomBytes(10))

    // A label of an operator that has the page off: the neighbour has no setting at all.
    await admin.query(`insert into areas (id, tenant_id, name) values ($1, $2, 'Alles')`, [
      newId<'area'>(),
      neighbour,
    ])

    // One after the other: supertest opens a server per request.
    const answers: unknown[] = []

    for (const code of [blocked, onNothing, unknown, elsewhere, 'kein-code']) {
      answers.push((await opened(code).expect(200)).body)
    }

    expect(answers).toEqual(answers.map(() => ({ open: false })))

    // Sent to all the same, each answers alike: no page ever handed out a form for it.
    const refused: (readonly [number, unknown])[] = []

    for (const code of [blocked, onNothing, unknown, elsewhere]) {
      const answer = await sent(code, { form: 'x', categoryId: 'x', description: 'Tür klemmt.' })

      refused.push([answer.status, answer.body])
    }

    expect(refused).toEqual(
      refused.map(() => [
        400,
        { message: staleFormSentence, error: 'Bad Request', statusCode: 400 },
      ]),
    )

    // A page handed out, and switched off before the report: closed.
    const open = await labelOn(north, 'north', { room: north.room })
    const form = await filledIn(open)

    await switched(false).expect(200)
    expect(
      (await sent(open, { ...form, description: 'Tür klemmt.' }).expect(404)).body.message,
    ).toBe(closedLabelSentence)
    await switched(true).expect(200)
  })

  it('names the room on the label and nothing else: for an asset the room it stands in, none where it stands in no room', async () => {
    await switched(true).expect(200)

    const atTheRoom = (
      await opened(await labelOn(north, 'north', { room: north.room })).expect(200)
    ).body as OutsideLabelPage
    const atTheAsset = (
      await opened(await labelOn(north, 'north', { asset: north.asset })).expect(200)
    ).body as OutsideLabelPage
    const loose = (await opened(await labelOn(north, 'north', { asset: north.loose })).expect(200))
      .body as OutsideLabelPage

    expect(atTheRoom).toMatchObject({ open: true, room: '2.05 Lehrerzimmer' })
    expect(atTheAsset).toMatchObject({ open: true, room: '2.05 Lehrerzimmer' })
    expect(loose).toMatchObject({ open: true, room: null })

    for (const page of [atTheRoom, atTheAsset, loose]) {
      const said = JSON.stringify(page)

      for (const hidden of [
        'Schulzentrum',
        'Schulhaus',
        'Personenaufzug',
        'Lastenaufzug',
        'Beispielstadt',
        north.room,
      ]) {
        expect(said.toLowerCase()).not.toContain(hidden.toLowerCase())
      }

      expect(Object.keys(page).sort()).toEqual(['categories', 'form', 'open', 'room'])
    }
  })

  it('puts a report into the inbox of the area, naming nobody, and the log says why and no person', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { asset: north.asset })
    const { id } = await reportedOver(code)
    const row = await one<{
      reported_by: string | null
      reported_outside: boolean
      area_id: string
      asset_id: string | null
      room_id: string | null
    }>(
      'select reported_by, reported_outside, area_id, asset_id, room_id from fault_reports where id = $1',
      [id],
    )

    expect(row).toEqual({
      reported_by: null,
      reported_outside: true,
      area_id: area.north,
      asset_id: north.asset,
      room_id: null,
    })

    const inNorth = (
      await http().get('/fault-reports?state=all').set(testIdentityHeader, by('u-site')).expect(200)
    ).body as FaultReportEntry[]
    const inSouth = (
      await http()
        .get('/fault-reports?state=all')
        .set(testIdentityHeader, by('u-site-south'))
        .expect(200)
    ).body as FaultReportEntry[]

    expect(inNorth.find((entry) => entry.id === id)).toMatchObject({ outside: true })
    expect(inSouth.some((entry) => entry.id === id)).toBe(false)

    const { rows: logged } = await admin.query<{ user_id: string | null; reason: string | null }>(
      `select distinct user_id, reason from audit_entries where table_name = 'fault_reports' and record_id = $1`,
      [id],
    )

    expect(logged).toEqual([{ user_id: null, reason: 'report.outside' }])
  })

  it('keeps the address for the answer out of the log and out of every answer of the office', async () => {
    await switched(true).expect(200)

    const address = `melder-${randomBytes(3).toString('hex')}@beispiel.example`
    const code = await labelOn(north, 'north', { room: north.room })
    const { id } = await reportedOver(code, { contact: address })
    const { rows: kept } = await admin.query<{ address: string; area_id: string }>(
      'select address, area_id from fault_report_contacts where fault_report_id = $1',
      [id],
    )

    expect(kept).toEqual([{ address, area_id: area.north }])

    const { rows: logged } = await admin.query(
      `select 1 from audit_entries where old_value like $1 or new_value like $1`,
      [`%${address}%`],
    )

    expect(logged).toEqual([])

    const page = (
      await http().get(`/fault-reports/${id}`).set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as FaultReportPage

    expect(page).toMatchObject({ outside: true, answersByMail: true })
    expect(JSON.stringify(page)).not.toContain(address)

    const list = await http()
      .get('/fault-reports?state=all')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    expect(JSON.stringify(list.body)).not.toContain(address)
    expect(
      (
        await sent(code, {
          ...(await filledIn(code)),
          description: 'Licht',
          contact: 'kein@',
        }).expect(400)
      ).body.message,
    ).toBe('Das sieht nicht nach einer E-Mail-Adresse aus.')
  })

  it('answers a machine as it answers a report and keeps nothing: the field nobody sees, and a form sent too soon', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { room: north.room })
    const before = await one<{ n: number }>('select count(*)::int as n from fault_reports', [])
    const form = await filledIn(code)
    const trapped = await sent(code, {
      ...form,
      description: 'Tür klemmt.',
      website: 'https://spam.example',
    }).expect(201)

    expect(trapped.body).toEqual({ photo: null })

    const page = (await opened(code).expect(200)).body as OutsideLabelPage

    if (!page.open) {
      throw new Error('The label is closed')
    }

    clock += 1_000

    const early = await sent(code, {
      form: page.form,
      categoryId: form.categoryId,
      description: 'Tür klemmt.',
    }).expect(201)

    expect(early.body).toEqual({ photo: null })
    expect((await one<{ n: number }>('select count(*)::int as n from fault_reports', [])).n).toBe(
      before.n,
    )

    // The form of one label is no form for another.
    const another = await labelOn(north, 'north', { asset: north.asset })

    expect(
      (await sent(another, { ...form, description: 'Tür klemmt.' }).expect(400)).body.message,
    ).toBe(staleFormSentence)

    // A form older than a day, one changed by hand, and none: stale.
    clock += 25 * 3_600_000

    for (const stale of [page.form, `${page.form}x`, undefined]) {
      expect(
        (
          await sent(code, {
            form: stale,
            categoryId: form.categoryId,
            description: 'Tür.',
          }).expect(400)
        ).body.message,
      ).toBe(staleFormSentence)
    }
  })

  it('takes five requests an hour from an address, whatever becomes of them and over whatever code', async () => {
    await switched(true).expect(200)

    const address = anAddress()
    // Answered and kept nowhere, and counted against the address all the same.
    const machine = { website: 'x' }

    for (let index = 0; index < 5; index += 1) {
      const code =
        index % 2 === 0
          ? await labelOn(north, 'north', { room: north.room })
          : labelCodeFrom(randomBytes(10))

      await sent(code, machine, address).expect(201)
    }

    const code = await labelOn(north, 'north', { room: north.room })

    expect((await sent(code, machine, address).expect(429)).body.message).toBe(
      tooManyReportsSentence,
    )

    // An hour later the address is taken again.
    clock += 3_600_001
    await sent(code, machine, address).expect(201)
  })

  it('takes ten reports an hour over a label, and counts none that fails at the field nobody sees, the form or its fields (#472)', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { room: north.room })
    const reportsOver = async () =>
      (
        await one<{ n: number }>(
          'select count(*)::int as n from fault_reports f join labels l on l.room_id = f.room_id where l.code = $1',
          [code],
        )
      ).n
    const before = await reportsOver()

    // Each from an address of its own, so that only the label could refuse.
    for (let round = 0; round < 2; round += 1) {
      const early = (await opened(code).expect(200)).body as OutsideLabelPage

      if (!early.open) {
        throw new Error('The label is closed')
      }

      // Sent at once, faster than a person reads the page.
      await sent(code, {
        form: early.form,
        categoryId: early.categories[0]?.id,
        description: 'Tür klemmt.',
      }).expect(201)

      const form = await filledIn(code)

      await sent(code, { ...form, description: 'Tür klemmt.', website: 'x' }).expect(201)
      await sent(code, { categoryId: form.categoryId, description: 'Tür klemmt.' }).expect(400)
      await sent(code, { ...form, form: `${form.form}x`, description: 'Tür klemmt.' }).expect(400)
      await sent(code, form).expect(400)
      await sent(code, { ...form, description: ' ' }).expect(400)
      await sent(code, { ...form, categoryId: 'nichts', description: 'Tür klemmt.' }).expect(400)
      await sent(code, {
        ...form,
        categoryId: newId<'fault-category'>(),
        description: 'Tür klemmt.',
      }).expect(400)
    }

    expect(await reportsOver()).toBe(before)

    for (let index = 0; index < 10; index += 1) {
      await reportedOver(code)
    }

    const form = await filledIn(code)

    expect(
      (await sent(code, { ...form, description: 'Tür klemmt.' }).expect(429)).body.message,
    ).toBe(tooManyReportsSentence)
    // A label that has had its ten turns away every request, the machine's as well.
    expect((await sent(code, { website: 'x' }).expect(429)).body.message).toBe(
      tooManyReportsSentence,
    )
    expect(await reportsOver()).toBe(before + 10)

    // An hour later the label takes reports again.
    clock += 3_600_001
    await reportedOver(code)
  })

  it('opens sixty pages an hour for an address', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { room: north.room })
    const address = anAddress()

    for (let index = 0; index < 60; index += 1) {
      await opened(code, address).expect(200)
    }

    expect((await opened(code, address).expect(429)).body.message).toBe(tooManyReportsSentence)
  })

  it('takes the photo of a report once, a picture by its bytes, and none without a report', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { room: north.room })
    const { id, receipt } = await reportedOver(code, { photo: true })

    expect(receipt.photo).toEqual(expect.any(String))
    await photoOf(code, receipt.photo ?? '', png).expect(204)

    const row = await one<{ photo_sha256: string | null }>(
      'select photo_sha256 from fault_reports where id = $1',
      [id],
    )

    expect(row.photo_sha256).toMatch(/^[0-9a-f]{64}$/)
    // Once only, and not without a slip.
    await photoOf(code, receipt.photo ?? '', png).expect(404)
    await photoOf(code, 'erfunden', png).expect(404)

    const text = await reportedOver(code, { photo: true })

    expect(
      (await photoOf(code, text.receipt.photo ?? '', Buffer.from('kein Bild')).expect(422)).body
        .message,
    ).toBe('Ein Foto ist ein Bild als JPEG, PNG oder WebP. Die Meldung selbst ist angekommen.')
    // A slip for another label opens nothing here.
    const other = await reportedOver(code, { photo: true })

    await photoOf(
      await labelOn(north, 'north', { room: north.room }),
      other.receipt.photo ?? '',
      png,
    ).expect(404)
  })

  it('turns away a report that comes to be written after another took the last of its label (#472)', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { room: north.room })

    for (let index = 0; index < 9; index += 1) {
      await reportedOver(code)
    }

    // Both passed the door at nine; the other one is written a moment sooner.
    const take = gate.takeLabel.bind(gate)
    const raced = vi.spyOn(gate, 'takeLabel').mockImplementationOnce((label) => {
      take(label)

      return take(label)
    })
    const form = await filledIn(code)
    const description = `Tür klemmt ${randomBytes(4).toString('hex')}`

    try {
      expect((await sent(code, { ...form, description }).expect(429)).body.message).toBe(
        tooManyReportsSentence,
      )
    } finally {
      raced.mockRestore()
    }

    expect(
      await one<{ n: number }>(
        'select count(*)::int as n from fault_reports where description = $1',
        [description],
      ),
    ).toEqual({ n: 0 })
  })

  it('refuses a report without a description, one left out as one left empty, and keeps nothing (#472)', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { room: north.room })
    const form = await filledIn(code)
    const before = await one<{ n: number }>('select count(*)::int as n from fault_reports', [])

    for (const description of [undefined, null, '  ']) {
      expect((await sent(code, { ...form, description }).expect(400)).body.message).toBe(
        'Die Beschreibung fehlt.',
      )
    }

    expect(await one<{ n: number }>('select count(*)::int as n from fault_reports', [])).toEqual(
      before,
    )
  })

  it('takes a category of this operator that is still offered, and nothing else', async () => {
    await switched(true).expect(200)

    const code = await labelOn(north, 'north', { room: north.room })
    const form = await filledIn(code)
    const missing = 'Diese Kategorie gibt es nicht mehr. Laden Sie die Seite neu.'

    for (const categoryId of [newId<'fault-category'>(), 'nichts']) {
      expect(
        (await sent(code, { ...form, categoryId, description: 'Tür klemmt.' }).expect(400)).body
          .message,
      ).toBe(missing)
    }
  })
})

describe('the area of a label', () => {
  it('is all a report without a person sees, and nothing more for a person signed in', async () => {
    await switched(true).expect(200)

    const inNorth = (await reportedOver(await labelOn(north, 'north', { room: north.room }))).id
    const inSouth = (await reportedOver(await labelOn(south, 'south', { room: south.room }))).id
    const ids = [inNorth, inSouth] as never[]
    const seen = async (tx: TenantTransaction) =>
      (
        await tx
          .select({ id: faultReports.id })
          .from(faultReports)
          .where(inArray(faultReports.id, ids))
      ).map((row) => row.id as string)

    expect(await inLabelArea(database, { tenantId: operator, areaId: area.north }, seen)).toEqual([
      inNorth,
    ])
    // A person keeps the own areas: with somebody set, the setting counts for nothing.
    expect(
      await database.forTenant({ tenantId: operator, userId: 'u-site-south' }, async (tx) => {
        await tx.execute(sql`select set_config('app.label_area', ${area.north}, true)`)

        return seen(tx)
      }),
    ).toEqual([inSouth])
  })
})

describe('the answer by mail', () => {
  function recording() {
    const mails: OutgoingMail[] = []
    const transport: MailTransport = {
      send: (mail) => {
        mails.push(mail)

        return Promise.resolve()
      },
      verify: () => Promise.resolve(),
      close: () => undefined,
    }

    return { mails, transport }
  }

  function accept(id: string) {
    return http()
      .post('/work-orders')
      .set(testIdentityHeader, by('u-site'))
      .send({
        origin: 'fault',
        faultReportId: id,
        title: 'Heizung, 2.05 Lehrerzimmer',
        kind: 'fault',
        urgency: 'urgent',
        dueOn: addDays(today, 2),
        responsibleUserId: 'u-tech',
        participantUserIds: [],
      })
  }

  async function signed(order: WorkOrderDetails): Promise<void> {
    await admin.query(
      `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                        signed_at, path, page_fingerprint)
       values ($1, $2, $3, $4, 'u-tech', 'signer', now(), 'M10,10L200,300', $5)`,
      [operator, north.property, area.north, order.id, 'b'.repeat(64)],
    )
    await admin.query("update activities set status = 'signed' where id = $1", [order.id])
  }

  async function contactOf(id: string): Promise<{ accepted_mailed_at: Date | null } | undefined> {
    const { rows } = await admin.query<{ accepted_mailed_at: Date | null }>(
      'select accepted_mailed_at from fault_report_contacts where fault_report_id = $1',
      [id],
    )

    return rows[0]
  }

  it('goes out when the report is accepted and when it is done, and the address goes with the second', async () => {
    await switched(true).expect(200)
    await aMailServer(admin, operator, { from: 'haustechnik@beispielstadt.example' })

    const address = 'antwort@beispiel.example'
    const code = await labelOn(north, 'north', { room: north.room })
    const { id } = await reportedOver(code, { contact: address })
    const { mails, transport } = recording()
    const job = { database, connect: () => transport, key: testKey }

    // Received: nothing to say yet.
    expect(await answerOutsideReports(job)).toBe(0)

    const order = (await accept(id).expect(201)).body as WorkOrderDetails

    expect(await answerOutsideReports(job)).toBe(1)
    expect(await answerOutsideReports(job)).toBe(0)
    expect((await contactOf(id))?.accepted_mailed_at).not.toBeNull()

    await signed(order)

    expect(await answerOutsideReports(job)).toBe(1)
    expect(await contactOf(id)).toBeUndefined()
    expect(mails.map((mail) => [mail.to.address, mail.subject])).toEqual([
      [address, 'Ihre Störmeldung ist angenommen'],
      [address, 'Ihre Störmeldung ist erledigt'],
    ])
    expect(mails[0]?.from).toEqual({
      name: 'Liegenschaften Beispielstadt',
      address: 'haustechnik@beispielstadt.example',
    })
    expect(mails[1]?.text).toContain('2.05 Lehrerzimmer')
  })

  it('removes the address of a rejected report without a mail', async () => {
    await switched(true).expect(200)
    await aMailServer(admin, operator, { from: 'haustechnik@beispielstadt.example' })

    const { id } = await reportedOver(await labelOn(north, 'north', { room: north.room }), {
      contact: 'abgelehnt@beispiel.example',
    })
    const { mails, transport } = recording()

    await http()
      .post(`/fault-reports/${id}/reject`)
      .set(testIdentityHeader, by('u-site'))
      .send({ reason: 'Gehört zum Bauunterhalt der Stadt.' })
      .expect(201)

    expect(await answerOutsideReports({ database, connect: () => transport, key: testKey })).toBe(0)
    expect(mails).toEqual([])
    expect(await contactOf(id)).toBeUndefined()
  })
})
