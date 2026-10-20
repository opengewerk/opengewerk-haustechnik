import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HttpException, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type BuildingSituation,
  catalogueOf,
  type DefectReading,
  type FaultCategory,
  type FaultLabelAnswer,
  type FaultReportEntry,
  type FaultReportPage,
  labelCodeFrom,
  missingRight,
  type OwnFaultReport,
  proposedFaultCategories,
  type RoleKey,
  shippedRoles,
  type TenantId,
  type WorkOrderDetails,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId, UploadLimits } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { faultReports } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The fault reports with an account (#331, section 4.7 of the concept): the
 * Melder reports at a building, a room or an asset of its areas and sees its
 * own reports and nothing behind them; whoever accepts faults in the area
 * accepts a report as a work order of the kind "Störung", merges it with
 * another of the same building or rejects it with the reason. A report names
 * nobody in the inbox.
 */

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()
const operator = newId<'tenant'>() as TenantId

/** Who works here, with the one role each holds and the area each sees; the Leitung sees every area. */
const people = {
  'u-lead': ['management', null],
  'u-duties': ['technical_management', null],
  'u-site': ['site_management', 'north'],
  'u-site-south': ['site_management', 'south'],
  'u-tech': ['technician', 'north'],
  'u-melder': ['reporter', 'north'],
  'u-melder-2': ['reporter', 'north'],
} as const satisfies Readonly<Record<string, readonly [RoleKey, 'north' | 'south' | null]>>

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication
let folder = ''
const area = { north: '', south: '' }

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
  readonly otherRoom: string
  readonly asset: string
}

/** A property in an area with a building, two rooms on a floor and an asset in the first room. */
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
  const otherRoom = await one<{ id: string }>(
    `insert into rooms (tenant_id, floor_id, building_id, property_id, area_id, number, name)
     values ($1, $2, $3, $4, $5, '2.10', 'Sekretariat') returning id`,
    [operator, floor.id, building, property, areaId],
  )
  const asset = (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, header)
      .send({ kind: 'probe.elevator', name: 'Personenaufzug', roomId: room.id })
      .expect(201)
  ).body.id as string

  return { property, building, room: room.id, otherRoom: otherRoom.id, asset }
}

async function categories(person: Person = 'u-melder'): Promise<FaultCategory[]> {
  return (
    await http().get('/fault-reports/categories').set(testIdentityHeader, by(person)).expect(200)
  ).body as FaultCategory[]
}

function send(person: Person, body: object) {
  return http().post('/fault-reports').set(testIdentityHeader, by(person)).send(body)
}

/** A report that is taken, at a room unless the body names another place; its id. */
async function reported(
  person: Person,
  place: Partial<Record<'buildingId' | 'roomId' | 'assetId', string>>,
  description = 'Der Heizkörper unter dem Fenster bleibt kalt.',
): Promise<string> {
  const [category] = await categories()

  return (await send(person, { categoryId: category?.id, description, ...place }).expect(201)).body
    .id as string
}

async function mine(person: Person): Promise<OwnFaultReport[]> {
  return (await http().get('/fault-reports/mine').set(testIdentityHeader, by(person)).expect(200))
    .body as OwnFaultReport[]
}

async function inbox(person: Person, state = 'all'): Promise<FaultReportEntry[]> {
  return (
    await http()
      .get(`/fault-reports?state=${state}`)
      .set(testIdentityHeader, by(person))
      .expect(200)
  ).body as FaultReportEntry[]
}

async function page(id: string, person: Person = 'u-lead'): Promise<FaultReportPage> {
  return (await http().get(`/fault-reports/${id}`).set(testIdentityHeader, by(person)).expect(200))
    .body as FaultReportPage
}

function decide(id: string, way: 'merge' | 'reject', person: Person, body: object) {
  return http().post(`/fault-reports/${id}/${way}`).set(testIdentityHeader, by(person)).send(body)
}

/** Accepting a report: its work order, as the office sends it. */
function accept(id: string, person: Person = 'u-site', over: object = {}) {
  return http()
    .post('/work-orders')
    .set(testIdentityHeader, by(person))
    .send({
      origin: 'fault',
      faultReportId: id,
      title: 'Heizung und Lüftung, 2.05 Lehrerzimmer',
      kind: 'fault',
      urgency: 'urgent',
      dueOn: addDays(today, 2),
      responsibleUserId: 'u-tech',
      participantUserIds: [],
      ...over,
    })
}

/** A picture as a phone sends it: one pixel of PNG. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function photo(person: Person, bytes: Buffer, declared: string) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  return {
    sha256,
    answer: http()
      .put(`/fault-reports/photos/${sha256}`)
      .set('content-type', 'application/octet-stream')
      .set('x-media-type', declared)
      .set(testIdentityHeader, by(person))
      .send(bytes),
  }
}

let north: Place
let south: Place

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [
    operator,
    'Liegenschaften Beispielstadt',
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

    // The Leitung and the Technische Leitung see every area from the moment
    // the membership is written; the others see the area they are given.
    if (sees !== null) {
      await admin.query(
        'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
        [operator, userId, area[sees]],
      )
    }
  }

  database = Database.connect(applicationDatabaseUrl())
  // The photos go into a store of their own for the run.
  folder = mkdtempSync(join(tmpdir(), 'haustechnik-faults-'))

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue, files: new FileStore(folder) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  north = await placeIn('north')
  south = await placeIn('south')
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('reporting a fault', () => {
  it('is at a building, a room or an asset of the own areas, and the Melder sees its own reports and no others', async () => {
    const own = await reported('u-melder', { roomId: north.room })
    const atTheBuilding = await reported('u-melder', { buildingId: north.building })
    const other = await reported('u-melder-2', { roomId: north.otherRoom })
    const ownList = await mine('u-melder')

    expect(ownList.map((each) => each.id)).toEqual(expect.arrayContaining([own, atTheBuilding]))
    expect(ownList.map((each) => each.id)).not.toContain(other)
    expect((await mine('u-melder-2')).map((each) => each.id)).toEqual([other])
    expect(ownList.find((each) => each.id === own)).toMatchObject({
      state: 'received',
      words: { building: 'Schulhaus', room: '2.05 Lehrerzimmer' },
    })

    // A room of another area is not there for the Melder of the north.
    const [category] = await categories()

    expect(
      (
        await send('u-melder', {
          categoryId: category?.id,
          description: 'Kalt.',
          roomId: south.room,
        }).expect(404)
      ).body.message,
    ).toBe('Diesen Raum gibt es nicht oder nicht in Ihren Bereichen.')
  })

  it('names exactly one place and a category that is still offered', async () => {
    const [category, removed] = await categories()

    expect(
      (
        await send('u-melder', {
          categoryId: category?.id,
          description: 'Kalt.',
          roomId: north.room,
          assetId: north.asset,
        }).expect(400)
      ).body.message,
    ).toBe('Eine Störung hängt an genau einem: einem Gebäude, einem Raum oder einer Anlage.')
    expect(
      (await send('u-melder', { categoryId: category?.id, description: 'Kalt.' }).expect(400)).body
        .message,
    ).toBe('Eine Störung hängt an genau einem: einem Gebäude, einem Raum oder einer Anlage.')

    await http()
      .delete(`/settings/fault-categories/${removed?.id ?? ''}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    expect((await categories()).map((each) => each.id)).not.toContain(removed?.id)
    expect(
      (
        await send('u-melder', {
          categoryId: removed?.id,
          description: 'Kalt.',
          roomId: north.room,
        }).expect(400)
      ).body.message,
    ).toBe('Diese Kategorie gibt es nicht oder nicht mehr.')
  })

  it('needs a description, one left out as one left empty, and keeps nothing without it (#472)', async () => {
    const [category] = await categories()
    const counted = () => one<{ n: number }>('select count(*)::int as n from fault_reports', [])
    const before = await counted()

    for (const description of [undefined, null, '  ']) {
      expect(
        (
          await send('u-melder', {
            categoryId: category?.id,
            roomId: north.room,
            description,
          }).expect(400)
        ).body.message,
      ).toBe('Die Beschreibung fehlt.')
    }

    expect(await counted()).toEqual(before)
  })

  it('shows the Melder nothing behind its report: no work order, no asset, no defect, no inbox', async () => {
    const id = await reported('u-melder', { assetId: north.asset })

    await accept(id).expect(201)

    const shown = (await mine('u-melder')).find((each) => each.id === id)

    expect(Object.keys(shown ?? {}).sort()).toEqual([
      'acceptedAt',
      'category',
      'description',
      'doneAt',
      'hasPhoto',
      'id',
      'receivedAt',
      'rejectionReason',
      'state',
      'words',
    ])
    expect(shown?.state).toBe('accepted')
    // The room the asset stands in, never the asset.
    expect(JSON.stringify(shown)).not.toContain('Personenaufzug')

    for (const path of [
      '/fault-reports',
      `/fault-reports/${id}`,
      `/assets/${north.asset}`,
      '/work-orders',
      '/defects',
      '/properties',
    ]) {
      expect([
        path,
        (await http().get(path).set(testIdentityHeader, by('u-melder'))).status,
      ]).toEqual([path, 403])
    }
  })

  it('leaves the device of a Melder empty: the exchange gives it nothing of the operator', async () => {
    await reported('u-melder', { roomId: north.room })

    const answer = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, by('u-melder'))
      .expect(200)
    const changes = answer.body.changes as { entity: string; rows: unknown[] }[]

    expect(
      changes.filter((change) => change.rows.length > 0).map((change) => change.entity),
    ).toEqual([])

    // Whoever does the work in the same area has the places on the device.
    const worker = (
      await http().get('/sync?since=0').set(testIdentityHeader, by('u-tech')).expect(200)
    ).body.changes as { entity: string; rows: unknown[] }[]

    expect(worker.find((change) => change.entity === 'rooms')?.rows.length ?? 0).toBeGreaterThan(0)
  })

  it('reads a label as the room it hangs in, by names only, and says the word of every scan otherwise', async () => {
    const code = labelCodeFrom(randomBytes(10))
    const blocked = labelCodeFrom(randomBytes(10))
    const away = labelCodeFrom(randomBytes(10))

    await admin.query(
      `insert into labels (tenant_id, property_id, area_id, asset_id, code, blocked_at)
       values ($1, $2, $3, $4, $5, null), ($1, $2, $3, $4, $6, now()), ($1, $7, $8, $9, $10, null)`,
      [
        operator,
        north.property,
        area.north,
        north.asset,
        code,
        blocked,
        south.property,
        area.south,
        south.asset,
        away,
      ],
    )

    const read = (
      await http()
        .get(`/fault-reports/label/${code}`)
        .set(testIdentityHeader, by('u-melder'))
        .expect(200)
    ).body as FaultLabelAnswer

    expect(read).toEqual({
      standing: 'open',
      place: { buildingId: north.building, roomId: null, assetId: north.asset },
      words: {
        property: expect.stringMatching(/^Schulzentrum /) as unknown,
        building: 'Schulhaus',
        room: '2.05 Lehrerzimmer',
      },
    })
    expect(JSON.stringify(read)).not.toContain('Personenaufzug')

    for (const [label, standing] of [
      [blocked, 'blocked'],
      [away, 'outside'],
      [labelCodeFrom(randomBytes(10)), 'unknown'],
    ] as const) {
      expect(
        (
          await http()
            .get(`/fault-reports/label/${label}`)
            .set(testIdentityHeader, by('u-melder'))
            .expect(200)
        ).body,
      ).toEqual({ standing })
    }
  })

  it('takes a picture as its photo and nothing else, and hands it to the person who reported it alone', async () => {
    const text = photo('u-melder', Buffer.from('kein Bild'), 'image/png')

    expect((await text.answer.expect(400)).body.message).toBe(
      'Zu einer Störung gehört ein Foto, also ein Bild als JPEG, PNG, WebP oder HEIC.',
    )

    const picture = photo('u-melder', png, 'image/png')

    await picture.answer.expect(200)

    const [category] = await categories()
    const id = (
      await send('u-melder', {
        categoryId: category?.id,
        description: 'Wasser tropft von der Decke.',
        roomId: north.room,
        photoSha256: picture.sha256,
      }).expect(201)
    ).body.id as string

    const own = await http()
      .get(`/fault-reports/mine/${id}/photo`)
      .set(testIdentityHeader, by('u-melder'))
      .expect(200)

    expect(own.headers['content-type']).toBe('image/png')
    await http()
      .get(`/fault-reports/mine/${id}/photo`)
      .set(testIdentityHeader, by('u-melder-2'))
      .expect(404)
    await http().get(`/fault-reports/${id}/photo`).set(testIdentityHeader, by('u-site')).expect(200)
  })

  it('takes as the photo of a report only one the person sent, and asks the limits before it keeps one (#360)', async () => {
    // Sent by another Melder: its hash names nothing the first may hang on a
    // report, and is answered like a photo never sent.
    const theirs = photo('u-melder-2', Buffer.concat([png, Buffer.from('zweites')]), 'image/png')

    await theirs.answer.expect(200)

    const [category] = await categories()

    expect(
      (
        await send('u-melder', {
          categoryId: category?.id,
          description: 'Die Tür klemmt.',
          roomId: north.room,
          photoSha256: theirs.sha256,
        }).expect(400)
      ).body.message,
    ).toBe('Das Foto ist nicht angekommen. Nehmen Sie es noch einmal auf.')

    // Past what an hour allows: refused before anything is kept.
    const limits = vi
      .spyOn(UploadLimits.prototype, 'admit')
      .mockRejectedValueOnce(new HttpException('Für diese Stunde ist es genug.', 429))
    const over = photo('u-melder', Buffer.concat([png, Buffer.from('drittes')]), 'image/png')

    try {
      await over.answer.expect(429)
      expect(limits).toHaveBeenCalledTimes(1)
      expect(
        (await admin.query('select 1 from files where sha256 = $1', [over.sha256])).rows,
      ).toEqual([])
    } finally {
      limits.mockRestore()
    }
  })
})

describe('the inbox', () => {
  it('names nobody: neither the list nor the page of a report carries who reported it', async () => {
    const id = await reported('u-melder', { roomId: north.room })

    expect(JSON.stringify(await inbox('u-site'))).not.toContain('u-melder')
    expect(JSON.stringify(await page(id, 'u-site'))).not.toContain('u-melder')
  })

  it('holds the reports of the own areas, and a report of another area is not there to decide on', async () => {
    const inTheSouth = await reported('u-lead', { roomId: south.room })

    expect((await inbox('u-site')).map((each) => each.id)).not.toContain(inTheSouth)
    expect((await inbox('u-site-south')).map((each) => each.id)).toContain(inTheSouth)

    // The table itself, not only the inbox: the joins onto the places would
    // hide a report of another area even without the policy of the table.
    const seen = await database.forTenant({ tenantId: operator, userId: 'u-site' }, (tx) =>
      tx.select({ id: faultReports.id }).from(faultReports),
    )

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.map((row) => row.id)).not.toContain(inTheSouth)
    await http()
      .get(`/fault-reports/${inTheSouth}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(404)
    await decide(inTheSouth, 'reject', 'u-site', { reason: 'Nicht bei uns.' }).expect(404)
    await accept(inTheSouth).expect(404)
  })

  it('is for whoever accepts faults: the Haustechnik and the Melder are refused', async () => {
    const id = await reported('u-melder', { roomId: north.room })

    for (const person of ['u-lead', 'u-duties', 'u-site'] as const) {
      await http().get('/fault-reports').set(testIdentityHeader, by(person)).expect(200)
    }

    for (const person of ['u-tech', 'u-melder'] as const) {
      expect(
        (await http().get('/fault-reports').set(testIdentityHeader, by(person)).expect(403)).body
          .message,
      ).toBe(missingRight('fault.accept'))
      await decide(id, 'reject', person, { reason: 'Nein.' }).expect(403)
      await decide(id, 'merge', person, { intoId: id }).expect(403)
      await http()
        .post(`/fault-reports/${id}/defect`)
        .set(testIdentityHeader, by(person))
        .expect(403)
    }
  })
})

describe('accepting a report', () => {
  it('makes a work order of the kind "Störung" at its place, and the report and the order name each other', async () => {
    const id = await reported('u-melder', { roomId: north.room })
    const order = (await accept(id).expect(201)).body as WorkOrderDetails
    const shown = await page(id, 'u-site')

    expect(order).toMatchObject({
      kind: 'fault',
      roomId: north.room,
      origin: { kind: 'fault', faultReportId: id },
    })
    expect(shown).toMatchObject({ state: 'accepted', workOrder: { activityId: order.id } })
    expect((await mine('u-melder')).find((each) => each.id === id)?.state).toBe('accepted')

    // Once: a report that is accepted is accepted.
    expect((await accept(id).expect(409)).body.message).toBe(
      'Ein Auftrag entsteht aus einer Meldung im Eingang. Diese ist schon angenommen, zusammengeführt, abgelehnt oder erledigt.',
    )
  })

  it('is for whoever accepts faults and plans the work, and as a work order of the kind "Störung" only', async () => {
    const id = await reported('u-melder', { roomId: north.room })

    expect((await accept(id, 'u-tech').expect(403)).body.message).toBe(
      missingRight('activity.write'),
    )
    expect(
      (await accept(id, 'u-site', { kind: 'other', measure: 'repair' }).expect(400)).body.message,
    ).toBe('Ein Auftrag aus einer Störmeldung ist einer der Art „Störung“.')
    expect((await page(id)).state).toBe('received')
  })

  it('is done with the signature under its order, and back in the inbox when the order is not performed', async () => {
    const done = await reported('u-melder', { roomId: north.room })
    const back = await reported('u-melder', { roomId: north.otherRoom })
    const first = (await accept(done).expect(201)).body as WorkOrderDetails
    const second = (await accept(back).expect(201)).body as WorkOrderDetails

    await admin.query(
      `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                        signed_at, path, page_fingerprint)
       values ($1, $2, $3, $4, 'u-tech', 'signer', now(), 'M10,10L200,300', $5)`,
      [operator, north.property, area.north, first.id, 'b'.repeat(64)],
    )
    await admin.query("update activities set status = 'signed' where id = $1", [first.id])
    await http()
      .post(`/work-orders/${second.id}/close`)
      .set(testIdentityHeader, by('u-site'))
      .send({ closingReason: 'Doppelt angelegt.' })
      .expect(201)

    const own = await mine('u-melder')

    expect(own.find((each) => each.id === done)).toMatchObject({ state: 'done' })
    expect(own.find((each) => each.id === done)?.doneAt).not.toBeNull()
    expect(own.find((each) => each.id === back)?.state).toBe('received')
    expect((await inbox('u-site', 'done')).map((each) => each.id)).toContain(done)
    expect((await inbox('u-site', 'received')).map((each) => each.id)).toContain(back)

    // Back in the inbox it is accepted again, with a new order.
    await accept(back).expect(201)
    expect((await page(back)).state).toBe('accepted')
  })
})

describe('merging and rejecting', () => {
  it('puts a report under another of the same building, takes along what went into it, and the reporter hears what that one hears', async () => {
    const first = await reported('u-melder', { roomId: north.room })
    const second = await reported('u-melder-2', { roomId: north.room })
    const third = await reported('u-melder', { roomId: north.otherRoom })

    await decide(third, 'merge', 'u-site', { intoId: second }).expect(201)
    await decide(second, 'merge', 'u-site', { intoId: first }).expect(201)

    expect((await page(third)).mergedInto?.id).toBe(first)
    expect((await page(first)).merged.map((each) => each.id).sort()).toEqual([second, third].sort())

    await accept(first).expect(201)

    expect((await mine('u-melder-2')).find((each) => each.id === second)?.state).toBe('accepted')
    expect((await mine('u-melder')).find((each) => each.id === third)?.state).toBe('accepted')
  })

  it('merges only a report in the inbox, with one of the same building that is neither done nor rejected', async () => {
    const here = await reported('u-melder', { roomId: north.room })
    const elsewhere = await reported('u-lead', { roomId: south.room })
    const accepted = await reported('u-melder', { roomId: north.room })

    await accept(accepted).expect(201)

    expect(
      (await decide(here, 'merge', 'u-lead', { intoId: elsewhere }).expect(409)).body.message,
    ).toBe('Zusammengeführt wird nur mit einer Meldung aus demselben Gebäude.')
    expect(
      (await decide(accepted, 'merge', 'u-lead', { intoId: here }).expect(409)).body.message,
    ).toBe('Zusammenführen lässt sich nur eine Meldung, die noch im Eingang steht.')
    expect((await decide(here, 'merge', 'u-lead', { intoId: here }).expect(409)).body.message).toBe(
      'Eine Meldung lässt sich nicht mit sich selbst zusammenführen.',
    )
    expect((await page(here)).state).toBe('received')
  })

  it('rejects with the reason, which the person who reported reads, and a rejected report stays rejected', async () => {
    const id = await reported('u-melder', { roomId: north.room })

    expect((await decide(id, 'reject', 'u-site', { reason: ' ' }).expect(400)).body.message).toBe(
      'Der Grund fehlt.',
    )

    await decide(id, 'reject', 'u-site', { reason: 'Gehört zum Bauunterhalt der Stadt.' }).expect(
      201,
    )

    expect((await mine('u-melder')).find((each) => each.id === id)).toMatchObject({
      state: 'rejected',
      rejectionReason: 'Gehört zum Bauunterhalt der Stadt.',
    })
    await decide(id, 'reject', 'u-site', { reason: 'Noch einmal.' }).expect(409)
    await accept(id).expect(409)
  })
})

describe('a defect from a report', () => {
  it('stands at the place of the report, names it as its origin, and comes once', async () => {
    const id = await reported(
      'u-melder',
      { assetId: north.asset },
      'Der Aufzug ruckelt beim Anfahren.',
    )
    const { defectId } = (
      await http()
        .post(`/fault-reports/${id}/defect`)
        .set(testIdentityHeader, by('u-site'))
        .expect(201)
    ).body as { defectId: string }
    const defect = (
      await http().get(`/defects/${defectId}`).set(testIdentityHeader, by('u-site')).expect(200)
    ).body as DefectReading

    expect(defect).toMatchObject({
      description: 'Der Aufzug ruckelt beim Anfahren.',
      origin: { kind: 'fault', faultReportId: id },
      place: { asset: { id: north.asset } },
      foundOn: today,
    })
    expect((await page(id)).defectId).toBe(defectId)
    await http()
      .post(`/fault-reports/${id}/defect`)
      .set(testIdentityHeader, by('u-site'))
      .expect(409)
  })
})

describe('the Lagebild of a building', () => {
  it('counts its open faults for whoever accepts them, and for nobody else', async () => {
    const place = await placeIn('north')
    const open = await reported('u-melder', { roomId: place.room })
    const accepted = await reported('u-melder', { roomId: place.room })
    const rejected = await reported('u-melder', { roomId: place.room })

    await reported('u-melder', { roomId: place.room }).then((merged) =>
      decide(merged, 'merge', 'u-site', { intoId: open }).expect(201),
    )
    await accept(accepted).expect(201)
    await decide(rejected, 'reject', 'u-site', { reason: 'Kein Fall für uns.' }).expect(201)

    const situation = (who: Person) =>
      http()
        .get(`/overview/buildings/${place.building}`)
        .set(testIdentityHeader, by(who))
        .expect(200)
        .then((answer) => answer.body as BuildingSituation)

    expect((await situation('u-site')).openFaults).toBe(2)
    expect((await situation('u-tech')).openFaults).toBeNull()
  })
})

describe('the categories', () => {
  it('are proposed at the first start and kept by whoever changes the settings', async () => {
    const listed = (person: Person) =>
      http().get('/settings/fault-categories').set(testIdentityHeader, by(person))

    expect(
      ((await listed('u-lead').expect(200)).body as FaultCategory[]).length,
    ).toBeLessThanOrEqual(proposedFaultCategories.length)
    await listed('u-site').expect(403)
    await http()
      .post('/settings/fault-categories')
      .set(testIdentityHeader, by('u-duties'))
      .send({ name: 'Beleuchtung' })
      .expect(403)

    const added = (
      await http()
        .post('/settings/fault-categories')
        .set(testIdentityHeader, by('u-lead'))
        .send({ name: 'Beleuchtung' })
        .expect(201)
    ).body as FaultCategory[]
    const lighting = added.find((each) => each.name === 'Beleuchtung')

    expect(lighting).toBeDefined()
    expect(
      (
        await http()
          .post('/settings/fault-categories')
          .set(testIdentityHeader, by('u-lead'))
          .send({ name: 'beleuchtung' })
          .expect(409)
      ).body.message,
    ).toBe('Eine Kategorie mit diesem Namen gibt es schon.')

    await http()
      .put(`/settings/fault-categories/${lighting?.id ?? ''}`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ name: 'Licht und Beleuchtung' })
      .expect(200)

    expect((await categories()).map((each) => each.name)).toContain('Licht und Beleuchtung')
  })
})
