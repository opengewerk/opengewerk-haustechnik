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
import { ApiModule } from './api.module.js'
import { answerFor } from './database-errors.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The PV structure below a PV installation (#461): taken stock of on a device
 * through the sync, by the rights of the assets, with its place from the part
 * above it, as the electrical structure beside it (#349).
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; the technician works in the north. */
const large = newId<'tenant'>() as TenantId

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

const pvKind = 'elektro.photovoltaic_installation'

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
       values ($1, $2, 'Werkhof Nord', 'Lagerweg 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')
       returning id, tenant_id, area_id)
     insert into buildings (tenant_id, property_id, area_id, name, kinds)
     select tenant_id, id, area_id, 'Halle 1', '{commercial}' from property
     returning property_id as property, id as building`,
    [tenantId, area],
  )

  return { tenantId, area, property: rows[0]?.property ?? '', building: rows[0]?.building ?? '' }
}

type Place = Awaited<ReturnType<typeof placeIn>>

/** An asset of a kind in the building of a place, with a number nobody else has. */
async function assetIn(at: Place, kind = pvKind): Promise<string> {
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
      kind === pvKind ? 'PV-Anlage Dach' : 'Niederspannungsanlage',
    ],
  )

  return rows[0]?.id ?? ''
}

/** An inverter with two strings and a module in the first, made on a device through the sync. */
async function structureOn(asset: string, userId: Person = 'u-tech', tenantId = small) {
  const ids = {
    inverter: newId<'inverter'>() as string,
    first: newId<'pv-string'>() as string,
    second: newId<'pv-string'>() as string,
    module: newId<'pv-module'>() as string,
  }

  expect(
    await outcomes(
      userId,
      [
        operation('inverters', 'create', ids.inverter, {
          assetId: asset,
          designation: 'WR 1',
          location: 'E.02 Lager, an der Nordwand',
          manufacturer: 'Beispielwandler',
          model: 'BW 10.0',
          ratedPowerW: 10000,
          mppInputs: 2,
        }),
        operation('pv_strings', 'create', ids.second, {
          inverterId: ids.inverter,
          designation: 'String 2',
          mppInput: 2,
          position: 2,
        }),
        operation('pv_strings', 'create', ids.first, {
          inverterId: ids.inverter,
          designation: 'String 1',
          mppInput: 1,
          azimuthDeg: 180,
          tiltDeg: 30,
          position: 1,
        }),
        operation('pv_modules', 'create', ids.module, {
          pvStringId: ids.first,
          manufacturer: 'Beispielsolar',
          model: 'BS 400 M',
          ratedPowerW: 400,
          position: 1,
        }),
      ],
      tenantId,
    ),
  ).toEqual(Array.from({ length: 4 }, () => applied))

  return ids
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

    for (const tenantId of [small, large]) {
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
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
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

describe('the PV structure on a device (#461)', () => {
  it('is taken stock of by whoever takes stock of assets, every part on the place of its asset', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const made = await structureOn(asset)

    // The device named the asset of the inverter and nothing else of a place:
    // every part has the asset, the property and the area of its asset.
    const { rows } = await admin.query<{ asset: string; property: string; area: string }>(
      `select asset_id as asset, property_id as property, area_id as area
         from inverters where id = $1
       union all select asset_id, property_id, area_id from pv_strings where id = $2
       union all select asset_id, property_id, area_id from pv_modules where id = $3`,
      [made.inverter, made.first, made.module],
    )

    expect(rows).toEqual(
      Array.from({ length: 3 }, () => ({ asset, property: at.property, area: at.area })),
    )

    // Completed on site: the serial number read from the label of the module.
    expect(
      await outcomes('u-tech', [
        operation('pv_modules', 'update', made.module, { serialNumber: 'BS4-2306-1101' }),
      ]),
    ).toEqual([applied])

    const { rows: kept } = await admin.query<{ serial: string; location: string }>(
      `select m.serial_number as serial, i.location
         from pv_modules m join pv_strings s on s.id = m.pv_string_id
         join inverters i on i.id = s.inverter_id
        where m.id = $1`,
      [made.module],
    )

    expect(kept).toEqual([{ serial: 'BS4-2306-1101', location: 'E.02 Lager, an der Nordwand' }])
  })

  it('refuses the structure to whoever does not take stock of assets', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const inverter = operation('inverters', 'create', newId<'inverter'>(), {
      assetId: asset,
      designation: 'WR 2',
    })
    const answer = await send('u-reporter', [inverter]).expect(400)

    expect(answer.body).toMatchObject({
      message: missingRight('asset.record'),
      operationId: inverter.id,
    })
  })

  it('leaves marking a part deleted to whoever keeps the assets, and takes along what hangs below it', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const made = await structureOn(await assetIn(at))
    const marked = operation('inverters', 'delete', made.inverter)
    const answer = await send('u-tech', [marked]).expect(400)

    expect(answer.body).toMatchObject({
      message: missingRight('asset.write'),
      operationId: marked.id,
    })
    expect(await outcomes('u-site', [marked])).toEqual([applied])

    const { rows } = await admin.query<{ marked: boolean }>(
      `select deleted_at is not null as marked from inverters where id = $1
       union all select deleted_at is not null from pv_strings where id = $2
       union all select deleted_at is not null from pv_strings where id = $3
       union all select deleted_at is not null from pv_modules where id = $4`,
      [made.inverter, made.first, made.second, made.module],
    )

    expect(rows).toEqual(Array.from({ length: 4 }, () => ({ marked: true })))
  })

  it('hangs an inverter on a PV installation and on no other asset, as a conflict about that inverter', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const lowVoltage = await assetIn(at, 'elektro.low_voltage_installation')
    const installation = await assetIn(at)

    expect(
      await outcomes('u-tech', [
        operation('inverters', 'create', newId<'inverter'>(), {
          assetId: lowVoltage,
          designation: 'WR Keller',
        }),
        // The rest of the transmission lands.
        operation('inverters', 'create', newId<'inverter'>(), {
          assetId: installation,
          designation: 'WR 1',
        }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'record_missing', fields: ['assetId'] }, applied])
  })

  it('keeps a PV installation with inverters one, as a conflict about its kind', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)

    await structureOn(asset)

    expect(
      await outcomes('u-tech', [
        operation('assets', 'update', asset, { kind: 'probe.elevator' }, { kind: pvKind }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'record_is_fixed', fields: ['kind'] }])
  })

  it('refuses a string of another inverter as a conflict, and a figure out of bounds with its sentence', async () => {
    const at = await placeIn(small, await areaOfSmall())
    const asset = await assetIn(at)
    const one = await structureOn(asset)

    expect(
      await outcomes('u-tech', [
        operation('pv_modules', 'create', newId<'pv-module'>(), {
          pvStringId: newId<'pv-string'>(),
          ratedPowerW: 400,
        }),
      ]),
    ).toEqual([{ outcome: 'conflict', reason: 'record_missing', fields: ['pvStringId'] }])

    const answer = await send('u-tech', [
      operation('pv_modules', 'create', newId<'pv-module'>(), {
        pvStringId: one.first,
        ratedPowerW: 2500,
      }),
    ]).expect(400)

    expect(answer.body.message).toBe(
      'Die Leistung eines Moduls ist größer als 0 und höchstens 2000 Wp.',
    )
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
      ['inverters', own.inverter, theirs.inverter],
      ['pv_strings', own.first, theirs.first],
      ['pv_modules', own.module, theirs.module],
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
    const lowVoltage = await assetIn(at, 'elektro.low_voltage_installation')
    // Past the sync, where nothing asks before the trigger does.
    const refused = await admin
      .query(
        `insert into inverters (tenant_id, asset_id, property_id, area_id, designation)
         values ($1, $2, $3, $4, 'WR Keller')`,
        [small, lowVoltage, at.property, at.area],
      )
      .catch((error: unknown) => error)
    const answer = answerFor(refused)

    expect(answer.getStatus()).toBe(409)
    expect(answer.message).toBe('Ein Wechselrichter hängt nur unter einer PV-Anlage.')
  })
})
