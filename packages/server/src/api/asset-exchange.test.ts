import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type Asset,
  type AssetDetails,
  catalogueOf,
  type DutyProposals,
  exchangeReason,
  exchangeRefusals,
  type ExchangeStanding,
  type IsoDate,
  missingRight,
  type Right,
  type RoleKey,
  shippedRoles,
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
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The exchange of an asset (#89, section 4.2 of the concept): the old one is
 * removed from the day on, the new one stands where it stood with a number
 * of its own, what is open at the old one ends with it, and what was
 * recorded at it stays as it is. One step: when a part is refused, nothing
 * of it stands.
 *
 * Evidence and most duties are put in past the application, as the tests of
 * the register do. The catalogue is the probe package: an elevator with its
 * main test, and a water meter that is a measuring point.
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
  'u-other': 'technician',
}

let admin: Pool
let database: Database
let app: INestApplication

const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

/** A header for the technician with exactly these rights: one that carries rights is taken at its word. */
function holding(tenantId: TenantId, ...rights: Right[]): string {
  return JSON.stringify({ userId: 'u-tech', tenantId, roles: ['technician'], rights })
}

const elevator = { kind: 'probe.elevator', name: 'Aufzug' }
/** What the dialog says about the asset that comes. */
const successor = {
  kind: 'probe.elevator',
  name: 'Aufzug neu',
  manufacturer: 'Beispiellift',
  serialNumber: 'BL-2026-10233',
}

interface Place {
  readonly property: string
  readonly building: string
  readonly annex: string
  readonly room: string
}

/** A property with two buildings, Haus A with a room and Haus B. */
async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id

  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...extra,
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })

  return {
    property,
    building,
    annex: await made(`/properties/${property}/buildings`, { name: 'Haus B', kinds: ['office'] }),
    room: await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' }),
  }
}

/** An asset taken into the register through the route. */
async function assetIn(
  building: string,
  body: object = elevator,
  tenantId: TenantId = small,
): Promise<Asset> {
  return (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send(body)
      .expect(201)
  ).body
}

/** A component under an asset. */
async function componentOf(asset: string, name: string): Promise<Asset> {
  return (
    await http()
      .post(`/assets/${asset}/components`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ ...elevator, name })
      .expect(201)
  ).body
}

/** An entry in the life cycle of an asset, by the Objektleitung. */
async function stateOf(asset: string, state: string, validFrom: IsoDate): Promise<void> {
  await http()
    .post(`/assets/${asset}/lifecycle`)
    .set(testIdentityHeader, by('u-site'))
    .send({ state, validFrom })
    .expect(201)
}

/** An evidence of a duty on a day, put in past the application. */
async function evidenceOf(duty: string, performedOn: IsoDate): Promise<void> {
  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, 'without_defects'::evidence_result,
            ${writtenPlaceholders(3)}
       from duties where id = $1`,
    [duty, performedOn, ...writtenValues('u-duties', performedOn, 'without_defects')],
  )
}

/** A duty of the operator's own at an asset, of a year, put in past the application. */
async function ownDutyAt(
  asset: string,
  options: { readonly label?: string; readonly endsOn?: IsoDate } = {},
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note, task,
                         counting, interval_months, interval_reason, responsible_user_id, performer,
                         performer_note, confirmed_by, ends_on)
     select tenant_id, property_id, area_id, id, $2, 'manufacturer', 'Betriebsanleitung',
            'maintenance', 'from_performance', 12, 'Der Hersteller nennt ein Jahr.', 'u-tech',
            'contractor', 'Aufzugsdienst Beispiel GmbH', 'u-lead', $3::date
       from assets where id = $1
     returning id`,
    [asset, options.label ?? 'Wartung nach Hersteller', options.endsOn ?? null],
  )

  return rows[0]?.id ?? ''
}

/** The main test of the elevator from the catalogue, at most every 24 months. */
async function mainTestAt(asset: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, maximum_months, confirmed_by)
     select tenant_id, property_id, area_id, id, 'probe.elevator_main_test', 1, 'betrsichv', 24, 24,
            'u-duties'
       from assets where id = $1
     returning id`,
    [asset],
  )

  return rows[0]?.id ?? ''
}

/** An inspection for a duty, in a status, put in past the application. */
async function activityFor(duty: string, status = 'open'): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `with activity as (
       insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status, due_on)
       select tenant_id, property_id, area_id, asset_id, 'inspection', 'Hauptprüfung der Aufzugsanlage',
              $2, $3::date
         from duties where id = $1
       returning id, tenant_id, property_id, area_id
     ), line as (
       insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
       select tenant_id, property_id, area_id, id, $1 from activity
     )
     select id from activity`,
    [duty, status, addDays(today, 10)],
  )

  return rows[0]?.id ?? ''
}

/** A defect at an asset, found today through the route, or put in a status past the application. */
async function defectAt(asset: string, status = 'found'): Promise<string> {
  const defect = (
    await http()
      .post('/defects')
      .set(testIdentityHeader, by('u-site'))
      .send({ assetId: asset, description: 'Notruf ohne Funktion.', foundOn: today })
      .expect(201)
  ).body.id as string

  if (status !== 'found') {
    await admin.query(
      `update defects set status = $2::defect_status,
                          checked_on = case when $2 = 'verified' then $3::date end
        where id = $1`,
      [defect, status, today],
    )
  }

  return defect
}

/** A work order that is to set a defect right, through the route: its page is that of its activity. */
async function orderFor(defect: string): Promise<string> {
  return (
    await http()
      .post('/work-orders')
      .set(testIdentityHeader, by('u-site'))
      .send({
        title: 'Notruf instand setzen',
        kind: 'defect_remedy',
        urgency: 'urgent',
        dueOn: addDays(today, 10),
        responsibleUserId: 'u-tech',
        participantUserIds: ['u-other'],
        origin: 'defect',
        defectId: defect,
      })
      .expect(201)
  ).body.id
}

/** A document filed at a place, with one version, put in past the application. */
async function documentAt(asset: Asset, home: 'asset_id' | 'building_id'): Promise<string> {
  const sha = newId<'attachment'>().replaceAll('-', '').padEnd(64, '0')

  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type)
     values ($1, $2, 2048, 'application/pdf')`,
    [small, sha],
  )

  const { rows } = await admin.query<{ id: string }>(
    `insert into attachments (tenant_id, property_id, area_id, ${home}, title, kind)
     values ($1, $2, $3, $4, 'Betriebsanleitung', 'concept') returning id`,
    [small, asset.propertyId, asset.areaId, home === 'asset_id' ? asset.id : asset.buildingId],
  )

  await admin.query(
    `insert into attachment_versions (tenant_id, attachment_id, sha256, file_name, media_type,
                                      size_bytes)
     values ($1, $2, $3, 'anleitung.pdf', 'application/pdf', 2048)`,
    [small, rows[0]?.id, sha],
  )

  return rows[0]?.id ?? ''
}

/** An exchange as somebody sends it; the answer for the test to expect. */
function exchange(asset: string, body: object = {}, header: string = by('u-site')) {
  return http()
    .post(`/assets/${asset}/exchange`)
    .set(testIdentityHeader, header)
    .send({ on: today, asset: successor, ...body })
}

/** An exchange that is made: the new asset. */
async function exchanged(asset: string, body: object = {}, header?: string): Promise<Asset> {
  return (await exchange(asset, body, header).expect(201)).body as Asset
}

async function fileOf(asset: string, header: string = by('u-site')): Promise<AssetDetails> {
  return (await http().get(`/assets/${asset}`).set(testIdentityHeader, header).expect(200)).body
}

/** What an exchange would end at an asset, as somebody is told. */
async function standingOf(asset: string, header: string): Promise<ExchangeStanding> {
  return (await http().get(`/assets/${asset}/exchange`).set(testIdentityHeader, header).expect(200))
    .body
}

/** The keys of the duty kinds the catalogue proposes for an asset. */
async function proposedFor(asset: string): Promise<string[]> {
  const read = (
    await http()
      .get(`/duties/proposals?assetId=${asset}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
  ).body as DutyProposals

  return read.proposals.map((proposal) => proposal.kind)
}

/** The rows of a table that hang on an asset, as the database holds them. */
async function rowsAt<Row extends object>(
  table: 'duties' | 'defects' | 'activities' | 'asset_lifecycle' | 'asset_supplies',
  asset: string,
  columns: string,
  order = 'id',
): Promise<Row[]> {
  return (
    await admin.query<Row>(
      `select ${columns} from ${table} where asset_id = $1 and deleted_at is null order by ${order}`,
      [asset],
    )
  ).rows
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

  // The roles each operator starts with: a work order asks them who performs.
  for (const tenantId of [small, large]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  // The large tenant has its two areas before anybody works for it, so that
  // it does not begin with the one a tenant gets with its first membership.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [large],
  )
  const north = rows.find((row) => row.name === 'Nord')?.id ?? ''

  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
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
        catalogue: catalogueOf(probeCatalogueBundle),
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

describe('the exchange of an asset', () => {
  it('removes the old asset from the day on and puts a new one where it stood', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building, { ...elevator, roomId: place.room, mark: 'AZ-1' })

    await http()
      .put(`/assets/${old.id}/supplies`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ buildingIds: [place.annex], roomIds: [place.room] })
      .expect(200)

    const made = await exchanged(old.id, { on: daysAgo(2) })

    expect(made).toMatchObject({
      ...successor,
      propertyId: old.propertyId,
      areaId: old.areaId,
      buildingId: old.buildingId,
      roomId: place.room,
      parentAssetId: null,
      replacesAssetId: old.id,
      // What the dialog did not ask stays empty: the new asset is another one.
      mark: null,
      values: {},
    })

    const before = await fileOf(old.id)
    const after = await fileOf(made.id)

    expect(before.lifecycle.map(({ state, validFrom }) => ({ state, validFrom }))).toEqual([
      { state: 'removed', validFrom: daysAgo(2) },
    ])
    expect(before).toMatchObject({
      lifecycleState: 'removed',
      replaces: null,
      replacedBy: { id: made.id, number: made.number, name: 'Aufzug neu' },
    })
    expect(after.lifecycle.map(({ state, validFrom }) => ({ state, validFrom }))).toEqual([
      { state: 'in_service', validFrom: daysAgo(2) },
    ])
    expect(after).toMatchObject({
      lifecycleState: 'in_service',
      replaces: { id: old.id, number: old.number, name: 'Aufzug' },
      replacedBy: null,
    })

    // What the old one supplied the new one supplies, and the old one keeps its rows.
    const supplied = (file: AssetDetails) =>
      file.supplies
        .map(({ buildingId, roomId }) => ({ buildingId, roomId }))
        .sort((left, right) => String(left.roomId).localeCompare(String(right.roomId)))

    expect(supplied(after)).toEqual(
      [
        { buildingId: place.annex, roomId: null },
        { buildingId: null, roomId: place.room },
      ].sort((left, right) => String(left.roomId).localeCompare(String(right.roomId))),
    )
    expect(supplied(before)).toEqual(supplied(after))
  })

  it('puts the new asset under the asset the old one was a component of', async () => {
    const place = await placeIn()
    const plant = await assetIn(place.building)
    const drive = await componentOf(plant.id, 'Antrieb')
    const made = await exchanged(drive.id)

    expect(made.parentAssetId).toBe(plant.id)
    expect((await fileOf(plant.id)).components.map((component) => component.name)).toEqual([
      'Antrieb',
      'Aufzug neu',
    ])
  })

  it('never hands the number of the old asset out again', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const made = await exchanged(old.id)
    const next = await assetIn(place.building, { ...elevator, name: 'Aufzug Süd' })

    expect(old.number).toMatch(/^AN-\d+$/)
    expect(new Set([old.number, made.number, next.number]).size).toBe(3)
    expect((await fileOf(old.id)).number).toBe(old.number)
    expect(
      (
        await admin.query('select count(*)::int as held from assets where number = $1', [
          old.number,
        ])
      ).rows,
    ).toEqual([{ held: 1 }])
  })

  it('ends the duties of the old asset, and the catalogue proposes them anew for the new one', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const mainTest = await mainTestAt(old.id)
    const own = await ownDutyAt(old.id)
    const ended = await ownDutyAt(old.id, { label: 'Sichtprüfung', endsOn: daysAgo(30) })

    expect(await proposedFor(old.id)).not.toContain('probe.elevator_main_test')

    const made = await exchanged(old.id, { on: daysAgo(2) })
    const reason = exchangeReason(made.number ?? '')

    expect(
      await rowsAt('duties', old.id, "id, to_char(ends_on, 'YYYY-MM-DD') as ends_on, end_reason"),
    ).toEqual(
      [
        { id: mainTest, ends_on: daysAgo(2), end_reason: reason },
        { id: own, ends_on: daysAgo(2), end_reason: reason },
        // One that ended before the exchange ended for a reason of its own.
        { id: ended, ends_on: daysAgo(30), end_reason: null },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    )

    // Nothing goes to the new asset by itself: its duties are proposed, not confirmed.
    expect(await rowsAt('duties', made.id, 'id')).toEqual([])
    expect(await proposedFor(made.id)).toContain('probe.elevator_main_test')
    expect(await proposedFor(old.id)).toEqual([])
  })

  it('takes a duty of the operator own over where it is named, by whoever keeps the register of duties', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const own = await ownDutyAt(old.id)

    await ownDutyAt(old.id, { label: 'Sichtprüfung' })
    await evidenceOf(own, daysAgo(40))

    const made = await exchanged(old.id, { duties: [own] }, by('u-duties'))
    const taken = await rowsAt(
      'duties',
      made.id,
      `label, basis, source_note, task, counting, interval_months, interval_days, interval_reason,
       responsible_user_id, performer, performer_note, confirmed_by, kind, ends_on, building_id,
       room_id`,
    )

    expect(taken).toEqual([
      {
        label: 'Wartung nach Hersteller',
        basis: 'manufacturer',
        source_note: 'Betriebsanleitung',
        task: 'maintenance',
        counting: 'from_performance',
        interval_months: 12,
        interval_days: null,
        interval_reason: 'Der Hersteller nennt ein Jahr.',
        responsible_user_id: 'u-tech',
        performer: 'contractor',
        performer_note: 'Aufzugsdienst Beispiel GmbH',
        // Confirmed anew, by whoever exchanged.
        confirmed_by: 'u-duties',
        kind: null,
        ends_on: null,
        building_id: null,
        room_id: null,
      },
    ])

    // Its past stays with the old duty: the new one has no evidence.
    expect(
      (
        await admin.query(
          `select count(*)::int as held from evidence
            where duty_id in (select id from duties where asset_id = $1)`,
          [made.id],
        )
      ).rows,
    ).toEqual([{ held: 0 }])
  })

  it('leaves somebody who no longer works here out of the duty it takes over', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const own = await ownDutyAt(old.id)

    await admin.query(
      `insert into auth_users (id, name, email) values ('u-gone', 'u-gone', 'u-gone@beispiel.example')
       on conflict do nothing`,
    )
    await admin.query(
      `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-gone', '{technician}')
       on conflict do nothing`,
      [small],
    )
    await admin.query("update duties set responsible_user_id = 'u-gone' where id = $1", [own])
    await admin.query(
      "update memberships set blocked_at = now() where tenant_id = $1 and user_id = 'u-gone'",
      [small],
    )

    const made = await exchanged(old.id, { duties: [own] }, by('u-duties'))

    expect(await rowsAt('duties', made.id, 'label, responsible_user_id')).toEqual([
      { label: 'Wartung nach Hersteller', responsible_user_id: null },
    ])
  })

  it('keeps the document that bears an interval where it bears that of the new duty too', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const above = await ownDutyAt(old.id, { label: 'Nach Brandschutzkonzept' })
    const beside = await ownDutyAt(old.id, { label: 'Nach Betriebsanleitung' })
    const atBuilding = await documentAt(old, 'building_id')
    const atAsset = await documentAt(old, 'asset_id')

    for (const [duty, document] of [
      [above, atBuilding],
      [beside, atAsset],
    ]) {
      await admin.query(
        `update duties set interval_document_id = $2,
                           interval_document_version_id =
                             (select id from attachment_versions where attachment_id = $2)
          where id = $1`,
        [duty, document],
      )
    }

    const made = await exchanged(old.id, { duties: [above, beside] }, by('u-duties'))

    expect(
      await rowsAt(
        'duties',
        made.id,
        'label, interval_document_id, interval_document_version_id is not null as versioned',
        'label',
      ),
    ).toEqual([
      // Filed at the old asset, it stays with the old asset.
      { label: 'Nach Betriebsanleitung', interval_document_id: null, versioned: false },
      { label: 'Nach Brandschutzkonzept', interval_document_id: atBuilding, versioned: true },
    ])
  })

  it('takes over only a duty of the operator own that stands at the old asset', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const other = await assetIn(place.building, { ...elevator, name: 'Aufzug Süd' })
    const sentence =
      'Übernommen wird eine eigene Pflicht der Anlage, die getauscht wird, solange sie nicht geendet hat.'

    for (const duty of [
      await mainTestAt(old.id),
      await ownDutyAt(other.id),
      await ownDutyAt(old.id, { endsOn: daysAgo(30) }),
    ]) {
      const refused = await exchange(old.id, { duties: [duty] }, by('u-duties')).expect(400)

      expect(refused.body.message).toBe(sentence)
    }

    expect((await fileOf(old.id)).replacedBy).toBeNull()
  })

  it('closes what is open at the old asset, and leaves what is not', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const other = await assetIn(place.building, { ...elevator, name: 'Aufzug Süd' })
    const mainTest = await mainTestAt(old.id)
    const open = await activityFor(mainTest)
    const signed = await activityFor(await ownDutyAt(old.id), 'signed')
    const elsewhere = await activityFor(await mainTestAt(other.id))
    const ordered = await defectAt(old.id)
    const order = await orderFor(ordered)
    const found = await defectAt(old.id)
    const remedied = await defectAt(old.id, 'remedied')
    const verified = await defectAt(old.id, 'verified')
    const beside = await defectAt(other.id)

    expect(await rowsAt('defects', old.id, 'id, status::text', 'id')).toContainEqual({
      id: ordered,
      status: 'ordered',
    })

    const made = await exchanged(old.id)
    const reason = exchangeReason(made.number ?? '')
    const statusOf = async (table: string, id: string) =>
      (
        await admin.query<{ status: string }>(`select status::text from ${table} where id = $1`, [
          id,
        ])
      ).rows[0]?.status

    // An inspection and a work order, open: not performed, with the exchange as the reason.
    expect(
      (
        await admin.query(
          `select id, status::text, closing_reason from activities where id = any($1) order by id`,
          [[open, order]],
        )
      ).rows,
    ).toEqual(
      [open, order].sort().map((id) => ({ id, status: 'not_performed', closing_reason: reason })),
    )
    expect(
      (
        await admin.query(
          'select result::text, result_reason from activity_duties where activity_id = $1',
          [open],
        )
      ).rows,
    ).toEqual([{ result: 'not_performed', result_reason: reason }])
    // One somebody signed waits for what its signature makes.
    expect(await statusOf('activities', signed)).toBe('signed')
    expect(await statusOf('activities', elsewhere)).toBe('open')

    // What nobody set right yet counts as remedied, and waits to be checked again.
    expect(await statusOf('defects', found)).toBe('remedied')
    expect(await statusOf('defects', ordered)).toBe('remedied')
    expect(await statusOf('defects', remedied)).toBe('remedied')
    expect(await statusOf('defects', verified)).toBe('verified')
    expect(await statusOf('defects', beside)).toBe('found')

    // Nothing of it went to the new asset.
    expect(await rowsAt('defects', made.id, 'id')).toEqual([])
    expect(await rowsAt('activities', made.id, 'id')).toEqual([])
  })

  it('changes no evidence of the old asset, row or fingerprint', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const mainTest = await mainTestAt(old.id)
    const own = await ownDutyAt(old.id)

    await evidenceOf(mainTest, daysAgo(400))
    await evidenceOf(mainTest, daysAgo(20))
    await evidenceOf(own, daysAgo(90))
    await activityFor(mainTest)
    await defectAt(old.id)

    const evidence = async () =>
      (
        await admin.query(
          `select * from evidence
            where duty_id in (select id from duties where asset_id = $1) order by id`,
          [old.id],
        )
      ).rows
    const before = await evidence()

    expect(before).toHaveLength(3)
    expect(before.every((row) => /^[0-9a-f]{64}$/u.test(String(row.fingerprint)))).toBe(true)

    const made = await exchanged(old.id, { duties: [own] }, by('u-duties'))

    expect(await evidence()).toEqual(before)
    // And none of it is counted for the asset that came.
    expect(
      (
        await admin.query(
          `select count(*)::int as held from evidence
            where duty_id in (select id from duties where asset_id = $1)`,
          [made.id],
        )
      ).rows,
    ).toEqual([{ held: 0 }])
  })

  it('takes single components along, and leaves the others with the old asset', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const drive = await componentOf(old.id, 'Antrieb')
    const cabin = await componentOf(old.id, 'Kabine')
    const door = await componentOf(cabin.id, 'Kabinentür')
    const made = await exchanged(old.id, { components: [cabin.id] })
    const names = (file: AssetDetails) => file.components.map((component) => component.name)

    expect(names(await fileOf(made.id))).toEqual(['Kabine'])
    expect(names(await fileOf(old.id))).toEqual(['Antrieb'])
    // What hangs under a component goes where the component goes.
    expect((await fileOf(door.id)).parent?.id).toBe(cabin.id)
    // One that stays keeps its own life cycle: nothing is entered for it.
    expect((await fileOf(drive.id)).lifecycle).toEqual([])
  })

  it('leaves everything as it was when a part is refused', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const stranger = await assetIn(place.building, { ...elevator, name: 'Aufzug Süd' })
    const mainTest = await mainTestAt(old.id)
    const open = await activityFor(mainTest)
    const found = await defectAt(old.id)
    const assets = async () =>
      (
        await admin.query(
          'select id, parent_asset_id, replaces_asset_id from assets where building_id = $1 order by id',
          [place.building],
        )
      ).rows
    const before = await assets()

    // The last thing an exchange is asked: a component that is none of this asset.
    const refused = await exchange(old.id, { components: [stranger.id] }).expect(400)

    expect(refused.body.message).toBe(
      'Mitgenommen wird eine Komponente der Anlage, die getauscht wird.',
    )
    expect(await assets()).toEqual(before)
    expect(await fileOf(old.id)).toMatchObject({
      lifecycle: [],
      lifecycleState: null,
      replacedBy: null,
    })
    expect(await rowsAt('duties', old.id, 'id, ends_on, end_reason')).toEqual([
      { id: mainTest, ends_on: null, end_reason: null },
    ])
    expect(await rowsAt('activities', old.id, 'id, status::text')).toEqual([
      { id: open, status: 'open' },
    ])
    expect(await rowsAt('defects', old.id, 'id, status::text')).toEqual([
      { id: found, status: 'found' },
    ])
  })
})

describe('an exchange is refused', () => {
  it('a second time: an asset is replaced once', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)

    await exchanged(old.id, { on: daysAgo(2) })

    const refused = await exchange(old.id).expect(409)

    expect(refused.body.message).toBe(exchangeRefusals.replaced)
  })

  it('for a measuring point, and for a new asset that is one', async () => {
    const place = await placeIn()
    const waterMeter = {
      kind: 'probe.water_meter',
      name: 'Wasserzähler',
      meterNumber: '9WAT1234567',
      meterUnit: 'cubic_metres',
    }
    const meter = await assetIn(place.building, waterMeter)
    const old = await assetIn(place.building)

    expect((await exchange(meter.id).expect(400)).body.message).toBe(exchangeRefusals.meter)
    expect((await exchange(old.id, { asset: waterMeter }).expect(400)).body.message).toBe(
      exchangeRefusals.newMeter,
    )
    expect((await fileOf(old.id)).replacedBy).toBeNull()
  })

  it('on a day that is not one, lies ahead or does not fit the life cycle', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)

    await stateOf(old.id, 'in_service', daysAgo(900))
    await stateOf(old.id, 'out_of_service', daysAgo(5))

    for (const [on, status, sentence] of [
      [undefined, 400, 'Der Tag des Tauschs fehlt oder ist keiner.'],
      [
        addDays(today, 1),
        400,
        'Der Tag des Tauschs ist heute oder ein Tag davor: eingetragen wird ein Tausch, der stattgefunden hat.',
      ],
      [daysAgo(5), 409, exchangeRefusals.dayTaken],
      [daysAgo(9), 409, exchangeRefusals.laterEntry],
    ] as const) {
      const refused = await http()
        .post(`/assets/${old.id}/exchange`)
        .set(testIdentityHeader, by('u-site'))
        .send({ on, asset: successor })
        .expect(status)

      expect(refused.body.message).toBe(sentence)
    }

    // After its last entry it is exchanged, an asset out of service included.
    await exchanged(old.id, { on: daysAgo(4) })

    const gone = await assetIn(place.building, { ...elevator, name: 'Aufzug Süd' })

    await stateOf(gone.id, 'removed', daysAgo(3))
    expect((await exchange(gone.id).expect(409)).body.message).toBe(exchangeRefusals.removed)
  })

  it('without the new asset, or with one that would not be entered either', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const sent = (body: object) =>
      http().post(`/assets/${old.id}/exchange`).set(testIdentityHeader, by('u-site')).send(body)

    expect((await sent({ on: today }).expect(400)).body.message).toBe('Die neue Anlage fehlt.')
    expect(
      (await sent({ on: today, asset: { kind: 'probe.elevator' } }).expect(400)).body.message,
    ).toBe('Die Bezeichnung fehlt.')
    expect(
      (await sent({ on: today, asset: { ...successor, kind: 'probe.unknown' } }).expect(400)).body
        .message,
    ).toBe('Die Anlagenart probe.unknown kennt kein Paket des Katalogs.')
    expect(
      (await sent({ on: today, asset: { ...successor, values: { colour: 'rot' } } }).expect(400))
        .body.message,
    ).toMatch(/^Das Feld colour hat die Anlagenart/u)
    expect((await fileOf(old.id)).replacedBy).toBeNull()
  })
})

describe('who exchanges an asset', () => {
  it('is whoever keeps the assets, and nobody who only enters them', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)

    for (const header of [by('u-tech'), holding(small, 'asset.read', 'asset.record')]) {
      expect((await exchange(old.id, {}, header).expect(403)).body.message).toBe(
        missingRight('asset.write'),
      )
      expect(
        (await http().get(`/assets/${old.id}/exchange`).set(testIdentityHeader, header).expect(403))
          .body.message,
      ).toBe(missingRight('asset.write'))
    }

    expect((await fileOf(old.id)).replacedBy).toBeNull()

    await exchanged(old.id, {}, by('u-site'))
  })

  it('takes a duty of the operator own over only with the right to keep the register of duties', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const own = await ownDutyAt(old.id)

    // The Objektleitung keeps the assets, and not the register of duties.
    const refused = await exchange(old.id, { duties: [own] }, by('u-site')).expect(403)

    expect(refused.body.message).toBe(missingRight('duty.write'))
    expect((await fileOf(old.id)).replacedBy).toBeNull()
    expect(await rowsAt('duties', old.id, 'id, ends_on')).toEqual([{ id: own, ends_on: null }])

    // Without the duty it exchanges, and the duty ends with the old asset.
    const made = await exchanged(old.id, {}, by('u-site'))

    expect(await rowsAt('duties', made.id, 'id')).toEqual([])
  })

  it('exchanges none beyond their areas, and none of another tenant', async () => {
    const elsewhere = await placeIn(large, { areaId: south })
    const old = await assetIn(elsewhere.building, elevator, large)
    const missing = 'Diese Anlage gibt es nicht oder nicht mehr.'

    for (const header of [
      // Works in the north of the large tenant, with every right an exchange asks.
      holding(large, 'asset.read', 'asset.write', 'duty.write'),
      // Leads another tenant.
      by('u-lead', small),
    ]) {
      expect((await exchange(old.id, {}, header).expect(404)).body.message).toBe(missing)
      expect(
        (await http().get(`/assets/${old.id}/exchange`).set(testIdentityHeader, header).expect(404))
          .body.message,
      ).toBe(missing)
    }

    expect((await fileOf(old.id, by('u-lead', large))).replacedBy).toBeNull()
  })
})

describe('what an exchange would end', () => {
  it('is counted for whoever may exchange, and named for whoever reads it elsewhere', async () => {
    const place = await placeIn()
    const old = await assetIn(place.building)
    const other = await assetIn(place.building, { ...elevator, name: 'Aufzug Süd' })
    const mainTest = await mainTestAt(old.id)
    const own = await ownDutyAt(old.id)

    await ownDutyAt(old.id, { label: 'Sichtprüfung', endsOn: daysAgo(30) })
    await ownDutyAt(other.id)

    const open = await activityFor(mainTest)

    await activityFor(own, 'signed')

    const found = await defectAt(old.id)

    await defectAt(old.id, 'remedied')
    await defectAt(other.id)

    expect(await standingOf(old.id, by('u-duties'))).toEqual({
      duties: 2,
      ownDuties: [
        { id: own, label: 'Wartung nach Hersteller', intervalDays: null, intervalMonths: 12 },
      ],
      defects: 1,
      openDefects: [{ id: found, description: 'Notruf ohne Funktion.', status: 'found' }],
      activities: 1,
      openActivities: [
        { id: open, kind: 'inspection', title: 'Hauptprüfung der Aufzugsanlage', status: 'open' },
      ],
    })

    // Whoever may exchange and reads nothing else is told how many, and no more.
    expect(await standingOf(old.id, holding(small, 'asset.write'))).toEqual({
      duties: 2,
      ownDuties: [],
      defects: 1,
      openDefects: [],
      activities: 1,
      openActivities: [],
    })
    expect(
      await standingOf(old.id, holding(small, 'asset.write', 'duty.read', 'defect.read')),
    ).toMatchObject({
      ownDuties: [{ id: own }],
      openDefects: [{ id: found }],
      openActivities: [],
    })
  })
})
