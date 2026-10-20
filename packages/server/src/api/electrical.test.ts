import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  type RoleKey,
  type SyncValue,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId, type PrintJob } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { answerFor } from './database-errors.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The electrical structure below a low-voltage installation (#349): taken
 * stock of on a device through the sync, by the rights of the assets, with
 * its place from the part above it, and printed as the circuit chart for the
 * door of a board, under the right to read the assets and in the areas of
 * whoever asks.
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; the technician works in the north. */
const large = newId<'tenant'>() as TenantId
/** Another operator altogether. */
const other = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-site': 'site_management',
  'u-tech': 'technician',
  // Sends what it reports and reads no asset.
  'u-reporter': 'reporter',
}

type Person = keyof typeof people & string

/** The packages of the application beside the one of the tests. */
const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
})

/** What the renderer was handed, newest last. */
const rendered: PrintJob[] = []

let admin: Pool
let database: Database
let app: INestApplication
let north = ''
let south = ''
let numbers = 0

function http() {
  return request(app.getHttpServer())
}

function by(userId: Person, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

let recorded = Date.parse('2026-10-19T08:00:00Z')

/** An operation as a device queues it, each recorded after the one before. */
function operation(
  entity: string,
  kind: 'create' | 'update' | 'delete',
  recordId: string,
  values: Readonly<Record<string, SyncValue>> = {},
  seen: Readonly<Record<string, SyncValue>> = {},
) {
  recorded += 1000

  return {
    id: newId<'operation'>(),
    entity,
    recordId,
    kind,
    baseVersion: null,
    patches: Object.entries(values).map(([field, to]) => ({
      field,
      from: seen[field] ?? null,
      to,
    })),
    recordedAt: new Date(recorded).toISOString(),
  }
}

type Sent = ReturnType<typeof operation>

function send(userId: Person, operations: readonly Sent[], tenantId = small) {
  return http()
    .post('/sync')
    .set(testIdentityHeader, by(userId, tenantId))
    .send({ deviceId: 'phone', operations })
}

/** What became of each operation, as the device reads it. */
async function outcomes(userId: Person, operations: readonly Sent[], tenantId = small) {
  const answer = await send(userId, operations, tenantId).expect(201)

  return (
    answer.body.receipts as { outcome: string; reason: string | null; fields: string[] }[]
  ).map(({ outcome, reason, fields }) => ({ outcome, reason, fields }))
}

const applied = { outcome: 'applied', reason: null, fields: [] }

/** A property with a building in an area, put in past the application. */
async function placeIn(tenantId: TenantId, area: string) {
  const { rows } = await admin.query<{ property: string; building: string }>(
    `with property as (
       insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
       values ($1, $2, 'Schulzentrum Am Neckar', 'Neckarstraße 4', '68535', 'Edingen-Neckarhausen', 'DE-BW')
       returning id, tenant_id, area_id)
     insert into buildings (tenant_id, property_id, area_id, name, kinds)
     select tenant_id, id, area_id, 'Haus A', '{school}' from property
     returning property_id as property, id as building`,
    [tenantId, area],
  )

  return { tenantId, area, property: rows[0]?.property ?? '', building: rows[0]?.building ?? '' }
}

type Place = Awaited<ReturnType<typeof placeIn>>

/** An asset of a kind in the building of a place, with a number nobody else has. */
async function assetIn(at: Place, kind = 'elektro.low_voltage_installation'): Promise<string> {
  numbers += 1

  const { rows } = await admin.query<{ id: string }>(
    `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      at.tenantId,
      at.property,
      at.area,
      at.building,
      kind,
      `AN-${String(numbers).padStart(5, '0')}`,
      kind === 'probe.elevator' ? 'Aufzug' : 'Niederspannungsanlage',
    ],
  )

  return rows[0]?.id ?? ''
}

/**
 * A board with two sections and a circuit in each, a circuit on the board
 * directly and a piece of equipment, made on a device through the sync.
 */
async function structureOn(asset: string, userId: Person = 'u-tech', tenantId = small) {
  const ids = {
    board: newId<'distribution-board'>() as string,
    first: newId<'board-section'>() as string,
    second: newId<'board-section'>() as string,
    light: newId<'circuit'>() as string,
    socket: newId<'circuit'>() as string,
    direct: newId<'circuit'>() as string,
    lamp: newId<'equipment'>() as string,
  }

  expect(
    await outcomes(
      userId,
      [
        operation('distribution_boards', 'create', ids.board, {
          assetId: asset,
          kind: 'main_distribution',
          designation: 'HV',
          location: 'Keller',
        }),
        operation('board_sections', 'create', ids.second, {
          distributionBoardId: ids.board,
          designation: 'Feld 2',
          position: 2,
        }),
        operation('board_sections', 'create', ids.first, {
          distributionBoardId: ids.board,
          designation: 'Feld 1',
          position: 1,
        }),
        operation('circuits', 'create', ids.socket, {
          distributionBoardId: ids.board,
          boardSectionId: ids.second,
          designation: 'F7',
          consumer: 'Steckdosen Flur',
          overcurrentDevice: 'circuit_breaker',
          tripCharacteristic: 'b',
          ratedCurrentMilli: 16000,
        }),
        operation('circuits', 'create', ids.light, {
          distributionBoardId: ids.board,
          boardSectionId: ids.first,
          designation: 'F1',
          consumer: 'Licht Treppenhaus',
          overcurrentDevice: 'circuit_breaker',
          tripCharacteristic: 'b',
          ratedCurrentMilli: 10000,
        }),
        operation('circuits', 'create', ids.direct, {
          distributionBoardId: ids.board,
          designation: 'Q0',
          consumer: 'Zuleitung UV Haus B',
        }),
        operation('equipment', 'create', ids.lamp, {
          circuitId: ids.light,
          designation: 'Leuchte Treppe',
        }),
      ],
      tenantId,
    ),
  ).toEqual(Array.from({ length: 7 }, () => applied))

  return ids
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
    other,
    'Liegenschaften Probe',
  ])

  // The large operator has its two areas before anybody works for it.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      userId,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large, other]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

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
        renderer: async (job) => {
          rendered.push(job)

          return new TextEncoder().encode('%PDF-1.7\n%%EOF\n')
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

/** The one area of the small operator, which it got with its first membership. */
async function areaOfSmall(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [
    small,
  ])

  return rows[0]?.id ?? ''
}

describe('the electrical structure on a device (#349)', () => {
  it('is taken stock of by whoever takes stock of assets, every part on the place of its asset', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const made = await structureOn(asset)

    // The device named the asset of the board and nothing else of a place:
    // every part has the asset, the property and the area of its asset.
    const { rows } = await admin.query<{ asset: string; property: string; area: string }>(
      `select asset_id as asset, property_id as property, area_id as area
         from distribution_boards where id = $1
       union all select asset_id, property_id, area_id from board_sections where id = $2
       union all select asset_id, property_id, area_id from circuits where id = $3
       union all select asset_id, property_id, area_id from equipment where id = $4`,
      [made.board, made.first, made.light, made.lamp],
    )

    expect(rows).toEqual(
      Array.from({ length: 4 }, () => ({ asset, property: at.property, area: at.area })),
    )

    // Completed on site, and moved to the other section of its board.
    expect(
      await outcomes('u-tech', [
        operation(
          'circuits',
          'update',
          made.light,
          { ratedCurrentMilli: 13000, boardSectionId: made.second },
          { ratedCurrentMilli: 10000, boardSectionId: made.first },
        ),
      ]),
    ).toEqual([applied])
  })

  it('refuses the structure to whoever does not take stock of assets', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const board = operation('distribution_boards', 'create', newId<'distribution-board'>(), {
      assetId: asset,
      kind: 'sub_distribution',
      designation: 'UV 1',
    })
    const answer = await send('u-reporter', [board]).expect(400)

    expect(answer.body).toMatchObject({
      message: missingRight('asset.record'),
      operationId: board.id,
    })
  })

  it('leaves marking a part deleted to whoever keeps the assets, and takes along what hangs below it', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const made = await structureOn(await assetIn(at))
    const marked = operation('distribution_boards', 'delete', made.board)
    const answer = await send('u-tech', [marked]).expect(400)

    expect(answer.body).toMatchObject({
      message: missingRight('asset.write'),
      operationId: marked.id,
    })
    expect(await outcomes('u-site', [marked])).toEqual([applied])

    const { rows } = await admin.query<{ marked: boolean }>(
      `select deleted_at is not null as marked from distribution_boards where id = $1
       union all select deleted_at is not null from board_sections where id = $2
       union all select deleted_at is not null from circuits where id = $3
       union all select deleted_at is not null from equipment where id = $4`,
      [made.board, made.first, made.light, made.lamp],
    )

    expect(rows).toEqual(Array.from({ length: 4 }, () => ({ marked: true })))
  })

  it('hangs a board on a low-voltage installation and on no other asset, as a conflict about that board', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const elevator = await assetIn(at, 'probe.elevator')
    const installation = await assetIn(at)

    expect(
      await outcomes('u-tech', [
        operation('distribution_boards', 'create', newId<'distribution-board'>(), {
          assetId: elevator,
          kind: 'sub_distribution',
          designation: 'UV Aufzug',
        }),
        // The rest of the transmission lands.
        operation('distribution_boards', 'create', newId<'distribution-board'>(), {
          assetId: installation,
          kind: 'sub_distribution',
          designation: 'UV 1',
        }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'record_missing', fields: ['assetId'] }, applied])
  })

  /**
   * A board stands in a building of its installation (#495): the one it stands
   * in, one it supplies, or, from a device that names none, the one of the
   * asset. Another building, or a room of another building, is a conflict
   * about that board, and the rest of the transmission lands.
   */
  it('stands in a building of its installation, and in another only as a conflict about that board', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const installation = await assetIn(at)
    const buildingOn = async (name: string) => {
      const { rows } = await admin.query<{ id: string }>(
        `insert into buildings (tenant_id, property_id, area_id, name, kinds)
         values ($1, $2, $3, $4, '{school}') returning id`,
        [small, at.property, at.area, name],
      )

      return rows[0]?.id ?? ''
    }
    const supplied = await buildingOn('Haus B')
    const other = await buildingOn('Haus C')

    await admin.query(
      `insert into asset_supplies (tenant_id, asset_id, property_id, area_id, building_id)
       values ($1, $2, $3, $4, $5)`,
      [small, installation, at.property, at.area, supplied],
    )

    const inB = newId<'distribution-board'>()
    const before = newId<'distribution-board'>()
    const board = (building: string | undefined, designation: string) => ({
      assetId: installation,
      ...(building === undefined ? {} : { buildingId: building }),
      kind: 'sub_distribution',
      designation,
    })

    expect(
      await outcomes('u-tech', [
        operation('distribution_boards', 'create', inB, board(supplied, 'UV Haus B')),
        operation(
          'distribution_boards',
          'create',
          newId<'distribution-board'>(),
          board(other, 'UV Haus C'),
        ),
        operation('distribution_boards', 'create', before, board(undefined, 'UV von vorher')),
      ]),
    ).toEqual([
      applied,
      { outcome: 'conflict', reason: 'record_missing', fields: ['buildingId'] },
      applied,
    ])

    const { rows } = await admin.query<{ id: string; building: string }>(
      'select id, building_id as building from distribution_boards where id = any($1)',
      [[inB, before]],
    )

    expect(Object.fromEntries(rows.map((row) => [row.id, row.building]))).toEqual({
      [inB]: supplied,
      [before]: at.building,
    })

    // Moved afterwards: to the building it does not supply, no; nor into a
    // room of another building than the one it stands in.
    const { rows: room } = await admin.query<{ id: string }>(
      `with floor as (
         insert into floors (tenant_id, property_id, area_id, building_id, name, level)
         values ($1, $2, $3, $4, 'EG', 0) returning id, tenant_id, property_id, area_id, building_id)
       insert into rooms (tenant_id, property_id, area_id, building_id, floor_id, name)
       select tenant_id, property_id, area_id, building_id, id, 'Technik' from floor returning id`,
      [small, at.property, at.area, other],
    )

    expect(
      await outcomes('u-tech', [
        operation(
          'distribution_boards',
          'update',
          inB,
          { buildingId: other },
          { buildingId: supplied },
        ),
        operation('distribution_boards', 'update', inB, { roomId: room[0]?.id }, { roomId: null }),
      ]),
    ).toEqual([
      { outcome: 'conflict', reason: 'record_missing', fields: ['buildingId'] },
      { outcome: 'conflict', reason: 'record_missing', fields: ['roomId'] },
    ])
  })

  it('keeps a low-voltage installation with boards one, as a conflict about its kind', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)

    await structureOn(asset)

    expect(
      await outcomes('u-tech', [
        operation(
          'assets',
          'update',
          asset,
          { kind: 'probe.elevator' },
          { kind: 'elektro.low_voltage_installation' },
        ),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'record_is_fixed', fields: ['kind'] }])
  })

  it('refuses a section of another board as a conflict, and a figure out of bounds with its sentence', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const one = await structureOn(asset)
    const two = await structureOn(asset)

    expect(
      await outcomes('u-tech', [
        operation('circuits', 'create', newId<'circuit'>(), {
          distributionBoardId: one.board,
          boardSectionId: two.first,
          designation: 'F9',
        }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'record_missing', fields: ['boardSectionId'] }])

    const answer = await send('u-tech', [
      operation('circuits', 'create', newId<'circuit'>(), {
        distributionBoardId: one.board,
        designation: 'F10',
        overcurrentDevice: 'fuse_d0',
        tripCharacteristic: 'b',
      }),
    ]).expect(400)

    expect(answer.body.message).toMatch(/Charakteristik|Auslöse|passt/)
  })

  it('travels to the devices of the area its asset lies in and to no other', async () => {
    const inNorth = await placeIn(large, north)
    const inSouth = await placeIn(large, south)
    const own = await structureOn(await assetIn(inNorth), 'u-lead', large)
    const theirs = await structureOn(await assetIn(inSouth), 'u-lead', large)
    const answer = await http()
      .get('/sync?since=0')
      .set(testIdentityHeader, by('u-tech', large))
      .expect(200)
    const held = Object.fromEntries(
      (answer.body.changes as { entity: string; rows: { id: string }[] }[]).map((change) => [
        change.entity,
        change.rows.map((row) => row.id),
      ]),
    )

    for (const [entity, mine, others] of [
      ['distribution_boards', own.board, theirs.board],
      ['board_sections', own.first, theirs.first],
      ['circuits', own.light, theirs.light],
      ['equipment', own.lamp, theirs.lamp],
    ] as const) {
      expect(held[entity], entity).toContain(mine)
      expect(held[entity], entity).not.toContain(others)
      // Named like the places, so that a device lets the structure go with
      // the area of its asset.
      expect(answer.body.narrowed[entity], entity).toBe(answer.body.narrowed['properties'])
    }
  })

  it('is refused by the database on any other way in, as a conflict with its sentence', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const elevator = await assetIn(at, 'probe.elevator')
    // Past the sync, where nothing asks before the trigger does.
    const refused = await admin
      .query(
        `insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation)
         values ($1, $2, $3, $4, 'sub_distribution', 'UV Aufzug')`,
        [small, elevator, at.property, at.area],
      )
      .catch((error: unknown) => error)
    const answer = answerFor(refused)

    expect(answer.getStatus()).toBe(409)
    expect(answer.message).toBe('Ein Verteiler hängt nur unter einer Niederspannungsanlage.')
  })
})

describe('the circuit chart of a low-voltage installation (#349)', () => {
  /** The chart as the renderer was handed it. */
  async function chartOf(asset: string, header: string, query: Record<string, string> = {}) {
    const before = rendered.length
    const answer = await http()
      .get(`/assets/${asset}/circuit-chart`)
      .query(query)
      .set(testIdentityHeader, header)
      .expect(200)

    expect(answer.headers['content-type']).toContain('application/pdf')
    expect(rendered.length).toBe(before + 1)

    return { html: rendered.at(-1)?.html ?? '', disposition: answer.headers['content-disposition'] }
  }

  it('prints every board on a page of its own, its circuits by section in the order of the board, without what is marked', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const main = await structureOn(asset)
    const sub = await structureOn(asset)
    const gone = await structureOn(asset)

    expect(
      await outcomes('u-tech', [
        operation(
          'distribution_boards',
          'update',
          sub.board,
          { designation: 'UV 1', position: 1 },
          { designation: 'HV', position: 0 },
        ),
      ]),
    ).toEqual([applied])
    expect(
      await outcomes('u-site', [
        operation('distribution_boards', 'delete', gone.board),
        operation('circuits', 'delete', main.socket),
      ]),
    ).toEqual([applied, applied])

    const { html, disposition } = await chartOf(asset, by('u-tech'))

    // Two boards, two pages: the third is marked, and with it all it held.
    expect(html.match(/<section class="board">/g)).toHaveLength(2)
    expect(html).toContain('Wohnbau Nord eG')
    expect(html).toContain('Schulzentrum Am Neckar, Neckarstraße 4, 68535 Edingen-Neckarhausen')
    expect(html.indexOf('Hauptverteilung HV')).toBeLessThan(html.indexOf('Hauptverteilung UV 1'))

    const first = html.slice(0, html.indexOf('Hauptverteilung UV 1'))

    // The circuits on the board directly first, then the sections by their place.
    expect(first.indexOf('Ohne Feld')).toBeLessThan(first.indexOf('Feld 1'))
    expect(first.indexOf('Feld 1')).toBeLessThan(first.indexOf('Feld 2'))
    expect(first).toContain('Licht Treppenhaus')
    expect(first).not.toContain('Steckdosen Flur')
    expect(disposition).toContain(encodeURIComponent('Stromkreisverzeichnis AN-'))
  })

  it('narrows to the board whose door it is for, and finds no board of another asset', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const main = await structureOn(asset)
    const elsewhere = await structureOn(await assetIn(at))

    const { html, disposition } = await chartOf(asset, by('u-tech'), { board: main.board })

    expect(html.match(/<section class="board">/g)).toHaveLength(1)
    expect(disposition).toContain(encodeURIComponent('Stromkreisverzeichnis HV'))

    await http()
      .get(`/assets/${asset}/circuit-chart`)
      .query({ board: elsewhere.board })
      .set(testIdentityHeader, by('u-tech'))
      .expect(404)
  })

  it('finds no asset of another area or another operator, and is refused to whoever does not read assets', async () => {
    const inSouth = await placeIn(large, south)
    const theirs = await assetIn(inSouth)
    const ofAnother = await assetIn(await placeIn(other, await areaOf(other)))

    await structureOn(theirs, 'u-lead', large)

    await http()
      .get(`/assets/${theirs}/circuit-chart`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(404)
    await http()
      .get(`/assets/${ofAnother}/circuit-chart`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(404)
    await http()
      .get(`/assets/${theirs}/circuit-chart`)
      .set(testIdentityHeader, by('u-reporter', large))
      .expect(403)
    await chartOf(theirs, by('u-lead', large))
  })
})

/** The first area of an operator. */
async function areaOf(tenantId: TenantId): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    'select id from areas where tenant_id = $1 order by name limit 1',
    [tenantId],
  )

  return rows[0]?.id ?? ''
}
