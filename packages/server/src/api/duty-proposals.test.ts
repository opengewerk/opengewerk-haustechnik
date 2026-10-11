import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type AuditPage,
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueOf,
  type DutyKind,
  type DutyProposals,
  type DutyScope,
  type RoleKey,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The proposals of the catalogue (#102, section 4.3 of the concept, ADR 0002,
 * point 11): worked out when they are read, for the assets in the areas of
 * the person asking, after the kind of an asset, its characteristics, the
 * kind of its building and the state of its property; a kind confirmed and
 * not ended or dismissed and not taken back is not proposed again. And the
 * batch, which confirms or dismisses one kind at many assets in one
 * transaction: all of them or none.
 *
 * The catalogue is the probe package, the main test of an elevator, at most
 * every 24 months. Beside it stand kinds made from the main test for this
 * test alone: one for schools in Baden-Württemberg, one for a lift for the
 * fire brigade with the guide of the main test, and one whose interval the
 * operator determines. In front stand the packages this build ships, the
 * package Allgemein among them, whose asset kinds no duty kind names (#61).
 */

const small = newId<'tenant'>() as TenantId
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

const mainTest = 'probe.elevator_main_test'
/** The main test for schools in Baden-Württemberg alone. */
const schoolsInBw = 'probe.school_elevator_check'
/** A check of a lift for the fire brigade, with the guide of 24 months. */
const firefighters = 'probe.firefighters_lift_check'
/** A check whose interval the operator determines. */
const unguided = 'probe.elevator_operator_check'

function withMoreKinds(bundle: CatalogueBundle): CatalogueBundle {
  return {
    ...bundle,
    packages: bundle.packages.map((pack) => {
      const main = pack.dutyKinds.find((entry) => entry.key === mainTest)

      if (main === undefined || main.definition.interval.kind === 'none') {
        return pack
      }

      const like = (
        key: string,
        label: string,
        changes: Partial<DutyKind>,
        scope: Partial<DutyScope> = {},
      ): CatalogueEntry<DutyKind> => ({
        ...main,
        key,
        definition: {
          ...main.definition,
          label,
          counting: 'from_performance',
          ...changes,
          scope: { ...main.definition.scope, ...scope },
        },
      })

      return {
        ...pack,
        dutyKinds: [
          ...pack.dutyKinds,
          like(
            schoolsInBw,
            'Prüfung der Aufzugsanlage einer Schule',
            {},
            { buildingKinds: ['school'], states: ['DE-BW'] },
          ),
          like(
            firefighters,
            'Prüfung des Feuerwehraufzugs',
            { interval: { kind: 'guide', rule: main.definition.interval.rule } },
            { conditions: [{ characteristic: 'firefighters_lift', is: true }] },
          ),
          like(unguided, 'Kontrolle der Aufzugsanlage durch den Betreiber', {
            interval: { kind: 'none' },
          }),
        ],
      }
    }),
  }
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

let numbered = 0

/** A property with a building of these kinds, in this state, and a water meter in it. */
async function placeIn(
  options: {
    readonly tenantId?: TenantId
    readonly federalState?: string
    readonly kinds?: readonly string[]
    readonly areaId?: string
  } = {},
): Promise<{ property: string; building: string; waterMeter: string }> {
  const header = by('u-duties', options.tenantId)
  const property = (
    await http()
      .post('/properties')
      .set(testIdentityHeader, header)
      .send({
        name: 'Schulzentrum Am Neckar',
        street: 'Neckarstraße 4',
        postalCode: '68535',
        city: 'Edingen-Neckarhausen',
        federalState: options.federalState ?? 'DE-BW',
        ...(options.areaId === undefined ? {} : { areaId: options.areaId }),
      })
      .expect(201)
  ).body.id as string
  const building = (
    await http()
      .post(`/properties/${property}/buildings`)
      .set(testIdentityHeader, header)
      .send({ name: 'Haus A', kinds: options.kinds ?? ['school'] })
      .expect(201)
  ).body.id as string
  numbered += 1

  const waterMeter = (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, header)
      .send({
        kind: 'probe.water_meter',
        name: 'Hauswasserzähler',
        meterNumber: `9WAT${String(numbered).padStart(7, '0')}`,
        meterUnit: 'cubic_metres',
      })
      .expect(201)
  ).body.id as string

  return { property, building, waterMeter }
}

/** An asset in a building, an elevator unless another kind is named. */
async function assetIn(
  building: string,
  more: Readonly<Record<string, unknown>> = {},
  tenantId: TenantId = small,
): Promise<string> {
  return (
    await http()
      .post(`/buildings/${building}/assets`)
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send({ kind: 'probe.elevator', name: 'Aufzug', ...more })
      .expect(201)
  ).body.id as string
}

async function proposals(
  query: string,
  userId: keyof typeof people & string = 'u-duties',
  tenantId: TenantId = small,
): Promise<DutyProposals> {
  return (
    await http()
      .get(`/duties/proposals?${query}`)
      .set(testIdentityHeader, by(userId, tenantId))
      .expect(200)
  ).body as DutyProposals
}

/** The keys of the kinds proposed for an asset. */
async function proposedFor(asset: string): Promise<string[]> {
  return (await proposals(`assetId=${asset}`)).proposals.map((proposal) => proposal.kind)
}

function confirmMany(body: object, userId: keyof typeof people & string = 'u-duties') {
  return http().post('/duties/batch').set(testIdentityHeader, by(userId)).send(body)
}

function dismissMany(body: object, userId: keyof typeof people & string = 'u-duties') {
  return http().post('/duty-dismissals/batch').set(testIdentityHeader, by(userId)).send(body)
}

/** The duties of a kind standing at these assets, as the database holds them. */
async function standing(kind: string, assets: readonly string[]): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    `select count(*) from duties
      where kind = $1 and asset_id = any($2::uuid[]) and deleted_at is null and ends_on is null`,
    [kind, assets],
  )

  return Number(rows[0]?.count)
}

/** The dismissals of a kind standing at these assets. */
async function dismissed(kind: string, assets: readonly string[]): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    `select count(*) from duty_dismissals
      where kind = $1 and asset_id = any($2::uuid[]) and deleted_at is null`,
    [kind, assets],
  )

  return Number(rows[0]?.count)
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
        catalogue: catalogueOf({
          ...probeCatalogueBundle,
          packages: [...catalogueBundle.packages, ...withMoreKinds(probeCatalogueBundle).packages],
        }),
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

describe('the proposals of the catalogue', () => {
  it('are the duty kinds whose scope takes an asset in, at a school in Baden-Württemberg', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)
    const read = await proposals(`propertyId=${place.property}`)

    expect(read.proposals.map((proposal) => [proposal.kind, proposal.asset.id])).toEqual([
      [mainTest, elevator],
      [schoolsInBw, elevator],
      // Nobody has said yet whether it is a lift for the fire brigade.
      [firefighters, elevator],
      [unguided, elevator],
    ])
    expect(read.proposals[0]?.asset).toMatchObject({
      id: elevator,
      name: 'Aufzug',
      kind: 'probe.elevator',
      propertyId: place.property,
      buildingId: place.building,
      roomId: null,
      enteredOn: dayInGermany(),
    })
    expect(read.dismissed).toEqual([])
  })

  it('leave out a kind for a building of another kind', async () => {
    const place = await placeIn({ kinds: ['office'] })
    const elevator = await assetIn(place.building)

    expect(await proposedFor(elevator)).toEqual([mainTest, firefighters, unguided])
  })

  it('take in a building of several kinds by any one of them', async () => {
    const place = await placeIn({ kinds: ['office', 'school'] })
    const elevator = await assetIn(place.building)

    expect(await proposedFor(elevator)).toContain(schoolsInBw)
  })

  it('leave out a kind for a property in another federal state', async () => {
    const place = await placeIn({ federalState: 'DE-BY' })
    const elevator = await assetIn(place.building)

    expect(await proposedFor(elevator)).toEqual([mainTest, firefighters, unguided])
  })

  it('follow a characteristic entered later at once, as nothing is kept of them', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building, { values: { firefighters_lift: false } })

    expect(await proposedFor(elevator)).not.toContain(firefighters)

    await http()
      .patch(`/assets/${elevator}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ values: { firefighters_lift: true } })
      .expect(200)

    expect(await proposedFor(elevator)).toContain(firefighters)
  })

  it('come from the package of the kind an asset of a general kind is corrected to, at once', async () => {
    const place = await placeIn()
    const unsorted = await assetIn(place.building, { kind: 'allgemein.conveying_system' })

    expect(await proposedFor(unsorted)).toEqual([])

    await http()
      .patch(`/assets/${unsorted}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ kind: 'probe.elevator' })
      .expect(200)

    expect(await proposedFor(unsorted)).toEqual([mainTest, schoolsInBw, firefighters, unguided])
  })

  it('leave out a kind confirmed at the asset, until its duty ends', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)
    const duty = await http()
      .post('/duties')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: elevator, kind: mainTest, intervalMonths: 24 })
      .expect(201)

    expect(await proposedFor(elevator)).not.toContain(mainTest)

    await http()
      .post(`/duties/${duty.body.id}/end`)
      .set(testIdentityHeader, by('u-duties'))
      .send({})
      .expect(201)

    expect(await proposedFor(elevator)).toContain(mainTest)
  })

  it('take a kind in again once its duty, confirmed by mistake, is removed, and the log keeps who removed it (#241)', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)
    const confirm = () =>
      http()
        .post('/duties')
        .set(testIdentityHeader, by('u-duties'))
        .send({ assetId: elevator, kind: mainTest, intervalMonths: 24 })
    const duty = (await confirm().expect(201)).body.id as string

    expect(await proposedFor(elevator)).not.toContain(mainTest)
    expect(await standing(mainTest, [elevator])).toBe(1)

    await http().delete(`/duties/${duty}`).set(testIdentityHeader, by('u-lead')).expect(200)

    // No duty of the kind stands at the asset any more: it is a proposal as before.
    expect(await proposedFor(elevator)).toContain(mainTest)
    expect(await standing(mainTest, [elevator])).toBe(0)

    // Who confirmed it and who removed it, the newest first.
    const log = (
      await http()
        .get(`/audit/changes?table=duties&record=${duty}`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)
    ).body as AuditPage

    expect(log.changes.map((change) => [change.operation, change.userId])).toEqual([
      ['update', 'u-lead'],
      ['insert', 'u-duties'],
    ])
    expect(log.changes[0]?.fields.map((moved) => moved.field)).toContain('deleted_at')

    // And it is confirmed anew like any proposal.
    await confirm().expect(201)
    expect(await proposedFor(elevator)).not.toContain(mainTest)
  })

  it('leave out an asset decommissioned or removed, and keep them for one out of service', async () => {
    const place = await placeIn()
    const resting = await assetIn(place.building, { name: 'Aufzug außer Betrieb' })
    const gone = await assetIn(place.building, { name: 'Aufzug stillgelegt' })
    const lifecycle = (asset: string, state: string) =>
      http()
        .post(`/assets/${asset}/lifecycle`)
        .set(testIdentityHeader, by('u-duties'))
        .send({ state, validFrom: dayInGermany() })
        .expect(201)

    await lifecycle(resting, 'out_of_service')
    await lifecycle(gone, 'decommissioned')

    expect(await proposedFor(resting)).toContain(mainTest)
    expect(await proposedFor(gone)).toEqual([])
  })

  it('are those of the areas of the person asking and of no other', async () => {
    const atNorth = await placeIn({ tenantId: large, areaId: north })
    const atSouth = await placeIn({ tenantId: large, areaId: south })
    const up = await assetIn(atNorth.building, {}, large)
    const down = await assetIn(atSouth.building, {}, large)
    const seen = async (userId: keyof typeof people & string) =>
      new Set((await proposals('', userId, large)).proposals.map((proposal) => proposal.asset.id))

    expect(await seen('u-duties')).toEqual(new Set([up, down]))
    expect(await seen('u-tech')).toEqual(new Set([up]))
    expect((await proposals(`assetId=${down}`, 'u-tech', large)).proposals).toEqual([])
  })

  it('are narrowed to an asset, a property or a duty kind, and an id that is none names nothing', async () => {
    const place = await placeIn()
    const first = await assetIn(place.building)
    const second = await assetIn(place.building)

    expect(
      (await proposals(`propertyId=${place.property}&dutyKind=${mainTest}`)).proposals.map(
        (proposal) => proposal.asset.id,
      ),
    ).toEqual([first, second])
    expect(await proposedFor(second)).toEqual([mainTest, schoolsInBw, firefighters, unguided])
    expect(await proposals('assetId=keine')).toEqual({ proposals: [], dismissed: [] })
  })

  it('are read by every role that reads duties', async () => {
    const place = await placeIn()

    await assetIn(place.building)

    for (const userId of ['u-lead', 'u-site', 'u-tech'] as const) {
      expect((await proposals(`propertyId=${place.property}`, userId)).proposals).toHaveLength(4)
    }
  })
})

describe('a dismissed proposal', () => {
  it('stays dismissed, whatever changes at its asset, until somebody takes the dismissal back', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)
    const dismissal = await http()
      .post('/duty-dismissals')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: elevator, kind: mainTest, reason: 'Die Anlage prüft der Vermieter.' })
      .expect(201)

    await http()
      .patch(`/assets/${elevator}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ name: 'Aufzug Haus A', values: { firefighters_lift: true } })
      .expect(200)

    const read = await proposals(`assetId=${elevator}`)

    expect(read.proposals.map((proposal) => proposal.kind)).not.toContain(mainTest)
    expect(read.dismissed).toEqual([
      {
        id: dismissal.body.id,
        kind: mainTest,
        kindVersion: 1,
        reason: 'Die Anlage prüft der Vermieter.',
        dismissedOn: dayInGermany(),
        asset: expect.objectContaining({ id: elevator, name: 'Aufzug Haus A' }),
      },
    ])

    await http()
      .delete(`/duty-dismissals/${dismissal.body.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    const again = await proposals(`assetId=${elevator}`)

    expect(again.proposals.map((proposal) => proposal.kind)).toContain(mainTest)
    expect(again.dismissed).toEqual([])
  })
})

describe('a batch of confirmations', () => {
  it('makes exactly as many duties as assets, each with the maximum of its kind and the people named', async () => {
    const place = await placeIn()
    const assets = [
      await assetIn(place.building),
      await assetIn(place.building),
      await assetIn(place.building),
    ]
    const answer = await confirmMany({
      kind: mainTest,
      assetIds: assets,
      responsibleUserId: 'u-site',
      performer: 'contractor',
      performerNote: 'Prüfstelle Süd',
    }).expect(201)

    expect(answer.body).toHaveLength(3)

    for (const [index, duty] of (answer.body as Record<string, unknown>[]).entries()) {
      expect(duty).toMatchObject({
        assetId: assets[index],
        kind: mainTest,
        kindVersion: 1,
        counting: 'betrsichv',
        intervalMonths: 24,
        maximumMonths: 24,
        intervalReason: null,
        responsibleUserId: 'u-site',
        performer: 'contractor',
        performerNote: 'Prüfstelle Süd',
        confirmedBy: 'u-duties',
      })
    }

    expect(await standing(mainTest, assets)).toBe(3)
    expect(
      (await proposals(`propertyId=${place.property}&dutyKind=${mainTest}`)).proposals,
    ).toEqual([])
  })

  it('makes none where one of its assets is refused, and says which', async () => {
    const place = await placeIn()
    const first = await assetIn(place.building, { name: 'Aufzug Nord' })
    const taken = await assetIn(place.building, { name: 'Aufzug Mitte' })
    const third = await assetIn(place.building, { name: 'Aufzug Süd' })

    await http()
      .post('/duty-dismissals')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: third, kind: mainTest, reason: 'Prüft der Vermieter.' })
      .expect(201)
    await http()
      .post('/duties')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: taken, kind: mainTest, intervalMonths: 12 })
      .expect(201)

    const refused = await confirmMany({ kind: mainTest, assetIds: [first, taken, third] })

    expect(refused.status).toBe(409)
    expect(refused.body.message).toMatch(
      /Aufzug Mitte: Diese Pflicht ist an der Anlage schon bestätigt\.$/,
    )
    expect(await standing(mainTest, [first, third])).toBe(0)
    // The dismissal the batch would have taken back is still there.
    expect(await dismissed(mainTest, [third])).toBe(1)

    const elsewhere = await confirmMany({ kind: mainTest, assetIds: [first, place.waterMeter] })

    expect(elsewhere.status).toBe(400)
    expect(elsewhere.body.message).toMatch(/Die Pflichtart gilt nicht für Anlagen dieser Art\.$/)
    expect(await standing(mainTest, [first])).toBe(0)
  })

  it('withdraws the dismissals at the assets it confirms', async () => {
    const place = await placeIn()
    const first = await assetIn(place.building)
    const second = await assetIn(place.building)

    await http()
      .post('/duty-dismissals')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: first, kind: mainTest, reason: 'Prüft der Vermieter.' })
      .expect(201)
    await confirmMany({ kind: mainTest, assetIds: [first, second] }).expect(201)

    expect(await dismissed(mainTest, [first])).toBe(0)
    expect(await standing(mainTest, [first, second])).toBe(2)
  })

  it('takes the guide of a kind with a guide, and stays within the maximum', async () => {
    const place = await placeIn()
    const first = await assetIn(place.building, { values: { firefighters_lift: true } })
    const second = await assetIn(place.building)
    const guided = await confirmMany({ kind: firefighters, assetIds: [first] }).expect(201)

    expect(guided.body[0]).toMatchObject({
      intervalMonths: 24,
      maximumMonths: null,
      intervalReason: null,
    })

    const longer = await confirmMany({ kind: mainTest, assetIds: [second], intervalMonths: 30 })

    expect(longer.status).toBe(400)
    expect(longer.body.message).toMatch(/Die Höchstfrist beträgt 24 Monate/)
    expect(await standing(mainTest, [second])).toBe(0)
  })

  it('needs the interval with its reason for a kind without a value', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)

    expect(
      (await confirmMany({ kind: unguided, assetIds: [elevator] }).expect(400)).body.message,
    ).toMatch(
      /Die Frist dieser Pflichtart legt der Betreiber fest; der Stapel nennt sie, mit Begründung\.$/,
    )
    expect(
      (await confirmMany({ kind: unguided, assetIds: [elevator], intervalMonths: 6 }).expect(400))
        .body.message,
    ).toMatch(/braucht eine Begründung/)

    const made = await confirmMany({
      kind: unguided,
      assetIds: [elevator],
      intervalMonths: 6,
      intervalReason: 'Gefährdungsbeurteilung Aufzüge 2026',
    }).expect(201)

    expect(made.body[0]).toMatchObject({
      intervalMonths: 6,
      intervalReason: 'Gefährdungsbeurteilung Aufzüge 2026',
    })
  })

  it('refuses an asset named twice, no asset at all and no kind', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)

    expect(
      (await confirmMany({ kind: mainTest, assetIds: [elevator, elevator] }).expect(400)).body
        .message,
    ).toBe('Eine Anlage steht zweimal im Stapel; jede bekommt genau eine Pflicht.')
    await confirmMany({ kind: mainTest, assetIds: [] }).expect(400)
    await confirmMany({ assetIds: [elevator] }).expect(400)
    expect(await standing(mainTest, [elevator])).toBe(0)
  })

  it('is for whoever keeps the register', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)

    for (const userId of ['u-site', 'u-tech'] as const) {
      await confirmMany({ kind: mainTest, assetIds: [elevator] }, userId).expect(403)
    }

    await confirmMany({ kind: mainTest, assetIds: [elevator] }, 'u-lead').expect(201)
  })
})

describe('a batch of dismissals', () => {
  it('makes exactly as many dismissals as assets, with the one reason', async () => {
    const place = await placeIn()
    const assets = [await assetIn(place.building), await assetIn(place.building)]
    const answer = await dismissMany({
      kind: mainTest,
      assetIds: assets,
      reason: 'Die Aufzüge prüft der Vermieter.',
    }).expect(201)

    expect(answer.body).toHaveLength(2)
    expect(answer.body[0]).toMatchObject({
      assetId: assets[0],
      kind: mainTest,
      kindVersion: 1,
      reason: 'Die Aufzüge prüft der Vermieter.',
      dismissedBy: 'u-duties',
    })

    const read = await proposals(`propertyId=${place.property}&dutyKind=${mainTest}`)

    expect(read.proposals).toEqual([])
    expect(read.dismissed.map((each) => each.asset.id)).toEqual(assets)
  })

  it('makes none where one of its assets is refused', async () => {
    const place = await placeIn()
    const first = await assetIn(place.building)
    const confirmed = await assetIn(place.building, { name: 'Aufzug bestätigt' })
    const already = await assetIn(place.building, { name: 'Aufzug verworfen' })

    await http()
      .post('/duties')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: confirmed, kind: mainTest, intervalMonths: 24 })
      .expect(201)
    await dismissMany({
      kind: mainTest,
      assetIds: [already],
      reason: 'Prüft der Vermieter.',
    }).expect(201)

    const once = await dismissMany({
      kind: mainTest,
      assetIds: [first, confirmed],
      reason: 'Prüft der Vermieter.',
    })

    expect(once.status).toBe(409)
    expect(once.body.message).toMatch(/Aufzug bestätigt: Diese Pflicht ist an der Anlage bestätigt/)

    const twice = await dismissMany({
      kind: mainTest,
      assetIds: [first, already],
      reason: 'Prüft der Vermieter.',
    })

    expect(twice.status).toBe(409)
    expect(twice.body.message).toMatch(/schon verworfen\.$/)
    expect(await dismissed(mainTest, [first])).toBe(0)
  })

  it('needs its reason, and is for whoever keeps the register', async () => {
    const place = await placeIn()
    const elevator = await assetIn(place.building)

    expect(
      (await dismissMany({ kind: mainTest, assetIds: [elevator] }).expect(400)).body.message,
    ).toBe('Die Begründung fehlt.')
    expect(
      (await dismissMany({ kind: mainTest, assetIds: [elevator], reason: ' ' }).expect(400)).body
        .message,
    ).toBe('Die Begründung fehlt.')

    for (const userId of ['u-site', 'u-tech'] as const) {
      await dismissMany({ kind: mainTest, assetIds: [elevator], reason: 'Nein.' }, userId).expect(
        403,
      )
    }

    expect(await dismissed(mainTest, [elevator])).toBe(0)
  })
})
