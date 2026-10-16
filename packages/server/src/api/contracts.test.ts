import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type AssetContract,
  catalogueOf,
  type Contract,
  type ContractEntry,
  type ContractPage,
  type DutyDetails,
  type OrderWarranty,
  type RoleKey,
  roleKeys,
  rightsOfRoles,
  shippedRoles,
  type TenantId,
  type WorkOrderDetails,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The contracts with the contractors and the warranty (#329, section 4.11 of
 * the concept): the Leitung, the Technische Leitung and the Objektleitung
 * read the contracts, the Leitung and the Technische Leitung keep them
 * (decided 15.10.2026). A contract lies in no area, what it covers in the
 * areas of the reader. The last day to give notice, the end of a contract and
 * the end of a warranty are deadlines; a duty whose contract has ended says
 * so.
 */

const small = newId<'tenant'>() as TenantId
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
}

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(role: RoleKey, tenantId: TenantId = small): string {
  return as(tenantId, people[role], role)
}

async function made(path: string, body: object, header = by('technical_management')) {
  return (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body
    .id as string
}

/** A property with a building and an asset in it, in an area of the large tenant where one is named. */
async function placeIn(tenantId: TenantId = small, areaId: string | null = null) {
  const header = by('management', tenantId)
  const property = await made(
    '/properties',
    {
      name: `Liegenschaft ${newId<'property'>().slice(0, 6)}`,
      street: 'Am Werkhof 1',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      ...(areaId === null ? {} : { areaId }),
    },
    header,
  )
  const building = await made(
    `/properties/${property}/buildings`,
    { name: 'Haus A', kinds: ['school'] },
    header,
  )
  const asset = await made(
    `/buildings/${building}/assets`,
    { kind: 'probe.elevator', name: 'Personenaufzug' },
    header,
  )

  return { property, building, asset }
}

async function firm(name: string, tenantId: TenantId = small): Promise<string> {
  return made('/contractors', { name }, by('management', tenantId))
}

const lifts = {
  title: 'Wartung der Aufzüge',
  startsOn: '2024-01-01',
  endsOn: '2024-12-31',
  renewalMonths: 12,
  noticeAmount: 3,
  noticeUnit: 'months',
  responseTime: '4 Stunden bei Personeneinschluss',
  price: '4.800 € netto im Jahr',
}

async function contract(
  contractorId: string,
  body: object = lifts,
  header = by('technical_management'),
): Promise<Contract> {
  return (
    await http()
      .post('/contracts')
      .set(testIdentityHeader, header)
      .send({ ...body, contractorId })
      .expect(201)
  ).body as Contract
}

function cover(contractId: string, body: object, header = by('technical_management')) {
  return http().post(`/contracts/${contractId}/items`).set(testIdentityHeader, header).send(body)
}

async function atAsset(asset: string, header = by('management')): Promise<AssetContract[]> {
  return (
    await http().get(`/contracts/at-asset/${asset}`).set(testIdentityHeader, header).expect(200)
  ).body as AssetContract[]
}

interface Row {
  readonly kind: string
  readonly dueOn: string
  readonly follows?: string
  readonly contract?: { readonly id: string; readonly title: string }
  readonly contractor?: { readonly id: string; readonly name: string }
  readonly workOrder?: { readonly id: string } | null
  readonly asset?: { readonly id: string } | null
  readonly sourceLabel: string
}

async function deadlines(tenantId: TenantId = small, header = by('management', tenantId)) {
  await runDeadlinesOf({ database, catalogue }, tenantId, new Date())

  return (await http().get('/deadlines?limit=200').set(testIdentityHeader, header).expect(200)).body
    .rows as Row[]
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

  // The roles as a tenant holds them, which say who performs activities.
  for (const tenantId of [small, large]) {
    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  for (const role of roleKeys) {
    const userId = people[role]

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

  // The Objektleitung of the large tenant sees the north alone.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    people.site_management,
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

describe('who keeps the contracts', () => {
  it('is the Leitung and the Technische Leitung; the Objektleitung reads them, the Haustechnik not', async () => {
    const contractorId = await firm('Aufzugsdienst Rhein-Neckar GmbH')
    const kept = await contract(contractorId, lifts, by('management'))

    await contract(
      contractorId,
      { ...lifts, title: 'Wartung Lastenaufzug' },
      by('technical_management'),
    )

    for (const role of ['site_management', 'technician'] as const) {
      await http()
        .post('/contracts')
        .set(testIdentityHeader, by(role))
        .send({ ...lifts, contractorId })
        .expect(403)
      await http()
        .patch(`/contracts/${kept.id}`)
        .set(testIdentityHeader, by(role))
        .send({ price: '1 €' })
        .expect(403)
      await http().delete(`/contracts/${kept.id}`).set(testIdentityHeader, by(role)).expect(403)
      expect((await cover(kept.id, { assetId: (await placeIn()).asset }, by(role))).status).toBe(
        403,
      )
    }

    for (const role of ['management', 'technical_management', 'site_management'] as const) {
      const listed = (await http().get('/contracts').set(testIdentityHeader, by(role)).expect(200))
        .body as ContractEntry[]

      expect(listed.map((each) => each.id)).toContain(kept.id)
    }

    await http().get('/contracts').set(testIdentityHeader, by('technician')).expect(403)
    await http().get(`/contracts/${kept.id}`).set(testIdentityHeader, by('technician')).expect(403)
  })

  it('are the tenant own: another tenant neither sees nor changes one', async () => {
    const kept = await contract(await firm('Wasserlabor Beispielstadt'))

    await http()
      .get(`/contracts/${kept.id}`)
      .set(testIdentityHeader, by('management', large))
      .expect(404)
    await http()
      .patch(`/contracts/${kept.id}`)
      .set(testIdentityHeader, by('management', large))
      .send({ price: '1 €' })
      .expect(404)
    // Nor is it a contract with a firm of another tenant.
    await http()
      .post('/contracts')
      .set(testIdentityHeader, by('management', large))
      .send({ ...lifts, contractorId: await firm('Fremd GmbH') })
      .expect(400)
  })
})

describe('a contract', () => {
  it('runs, renews and says how it stands, with its last day to give notice', async () => {
    const kept = await contract(await firm('Heizungsbau Beispiel GmbH'), {
      ...lifts,
      startsOn: addDays(today, -400),
      endsOn: addDays(today, 100),
    })
    const page = (
      await http()
        .get(`/contracts/${kept.id}`)
        .set(testIdentityHeader, by('management'))
        .expect(200)
    ).body as ContractPage

    expect(page.contract).toMatchObject({
      contractorName: 'Heizungsbau Beispiel GmbH',
      runsUntil: addDays(today, 100),
      standing: 'running',
      responseTime: '4 Stunden bei Personeneinschluss',
      price: '4.800 € netto im Jahr',
    })
    expect(page.contract.noticeBy).not.toBeNull()
  })

  it('takes no end before its beginning, no renewal without an end and no notice without its unit', async () => {
    const contractorId = await firm('Elektro Kraus & Sohn')
    const refused = async (body: object) =>
      (
        await http()
          .post('/contracts')
          .set(testIdentityHeader, by('management'))
          .send({ ...lifts, contractorId, ...body })
          .expect(400)
      ).body.message as string

    expect(await refused({ endsOn: '2023-12-31' })).toBe(
      'Das Ende der Laufzeit liegt nicht vor dem Beginn.',
    )
    expect(await refused({ endsOn: null })).toBe(
      'Verlängern kann sich nur ein Vertrag mit einem Ende der Laufzeit.',
    )
    expect(await refused({ noticeUnit: null })).toBe(
      'Eine Kündigungsfrist hat eine Zahl und ihre Einheit.',
    )
    expect(await refused({ title: '' })).toBe('Die Bezeichnung fehlt.')
  })

  it('covers a building with its assets and an asset alone, and stands in the record of each', async () => {
    const contractorId = await firm('Aufzug Beispiel GmbH')
    const kept = await contract(contractorId)
    const whole = await placeIn()
    const single = await placeIn()

    await cover(kept.id, { buildingId: whole.building }).expect(201)
    await cover(kept.id, { assetId: single.asset }).expect(201)
    // Each once.
    await cover(kept.id, { assetId: single.asset }).expect(201)

    expect(await atAsset(whole.asset)).toEqual([
      expect.objectContaining({
        id: kept.id,
        throughBuilding: true,
        contractorName: 'Aufzug Beispiel GmbH',
      }),
    ])
    expect(await atAsset(single.asset)).toEqual([
      expect.objectContaining({ id: kept.id, throughBuilding: false }),
    ])

    const page = (
      await http()
        .get(`/contracts/${kept.id}`)
        .set(testIdentityHeader, by('management'))
        .expect(200)
    ).body as ContractPage

    expect(page.contract).toMatchObject({ buildings: 1, assets: 1 })
    expect(page.items.map((item) => item.kind)).toEqual(['building', 'asset'])

    // Taken out again, the asset no longer names it.
    const item = page.items.find((each) => each.assetId === single.asset)?.id ?? ''

    await http()
      .delete(`/contracts/${kept.id}/items/${item}`)
      .set(testIdentityHeader, by('technical_management'))
      .expect(200)
    expect(await atAsset(single.asset)).toEqual([])
  })

  it('shows what it covers only from the areas of the reader', async () => {
    const kept = await contract(
      await firm('Brandschutz Beispiel GmbH', large),
      lifts,
      by('management', large),
    )
    const inNorth = await placeIn(large, north)
    const inSouth = await placeIn(large, south)

    await cover(kept.id, { assetId: inNorth.asset }, by('management', large)).expect(201)
    await cover(kept.id, { assetId: inSouth.asset }, by('management', large)).expect(201)

    const read = async (role: RoleKey) =>
      (
        await http()
          .get(`/contracts/${kept.id}`)
          .set(testIdentityHeader, by(role, large))
          .expect(200)
      ).body as ContractPage

    expect((await read('management')).items.map((item) => item.assetId)).toEqual(
      expect.arrayContaining([inNorth.asset, inSouth.asset]),
    )
    expect((await read('site_management')).items.map((item) => item.assetId)).toEqual([
      inNorth.asset,
    ])
    // And counts only what it shows.
    expect((await read('management')).contract.assets).toBe(2)
    expect((await read('site_management')).contract.assets).toBe(1)
  })
})

describe('a duty on a contract', () => {
  it('names a contract of its firm only, and says "Vertrag abgelaufen" once it has ended', async () => {
    const contractorId = await firm('Prüfdienst Weber')
    const other = await firm('Kälte Klima Süd')
    const ended = await contract(contractorId, {
      ...lifts,
      startsOn: '2020-01-01',
      endsOn: '2021-12-31',
      renewalMonths: null,
    })
    const ofOther = await contract(other)
    const { property } = await placeIn()
    const duty = {
      propertyId: property,
      label: 'Prüfung der Rauchabzüge',
      basis: 'own_decision',
      sourceNote: 'Brandschutzkonzept, Abschnitt 4',
      task: 'inspection',
      intervalMonths: 12,
      counting: 'from_performance',
      performer: 'contractor',
      contractorId,
    }

    const refused = await http()
      .post('/duties')
      .set(testIdentityHeader, by('technical_management'))
      .send({ ...duty, contractId: ofOther.id })
      .expect(400)

    expect(refused.body.message).toBe(
      'Dieser Vertrag gibt es nicht oder nicht mehr, oder er ist keiner der gewählten Fremdfirma.',
    )

    const id = await made('/duties', { ...duty, contractId: ended.id })
    const page = async (role: RoleKey) =>
      (await http().get(`/duties/${id}`).set(testIdentityHeader, by(role)).expect(200))
        .body as DutyDetails

    expect(await page('management')).toMatchObject({
      contractId: ended.id,
      contractEnded: true,
      contract: { id: ended.id, title: lifts.title, endedOn: '2021-12-31' },
    })
    // That it has ended, whoever reads the duty sees; which contract, only whoever reads the contracts.
    expect(await page('technician')).toMatchObject({ contractEnded: true, contract: null })

    // And the contract cannot be removed while the duty names it.
    await http()
      .delete(`/contracts/${ended.id}`)
      .set(testIdentityHeader, by('management'))
      .expect(409)
  })
})

describe('a contract named in areas the keeper does not see', () => {
  it('is removed or given to another firm only by whoever sees every area, counting every duty', async () => {
    const lead = by('management', large)
    const firmA = await firm('Lüftung Nord GmbH', large)
    const firmB = await firm('Lüftung Süd GmbH', large)
    const kept = await contract(firmA, lifts, lead)
    const { property } = await placeIn(large, south)

    await made(
      '/duties',
      {
        propertyId: property,
        label: 'Wartung der Lüftung',
        basis: 'own_decision',
        sourceNote: 'Herstellervorgabe',
        task: 'maintenance',
        intervalMonths: 12,
        counting: 'from_performance',
        performer: 'contractor',
        contractorId: firmA,
        contractId: kept.id,
      },
      lead,
    )

    // The Objektleitung of the north, given the right to keep the contracts.
    const northKeeper = JSON.stringify({
      userId: people.site_management,
      tenantId: large,
      roles: ['site_management'],
      rights: [...rightsOfRoles(['site_management']), 'contract.write'],
    })
    const wanted =
      'Einen Vertrag entfernen oder einer anderen Fremdfirma geben kann nur, wer alle Bereiche sieht: Pflichten in jedem Bereich können ihn nennen.'

    expect(
      (
        await http()
          .delete(`/contracts/${kept.id}`)
          .set(testIdentityHeader, northKeeper)
          .expect(403)
      ).body.message,
    ).toBe(wanted)
    expect(
      (
        await http()
          .patch(`/contracts/${kept.id}`)
          .set(testIdentityHeader, northKeeper)
          .send({ contractorId: firmB })
          .expect(403)
      ).body.message,
    ).toBe(wanted)
    // What stays within the contract itself, the keeper of the north changes.
    await http()
      .patch(`/contracts/${kept.id}`)
      .set(testIdentityHeader, northKeeper)
      .send({ price: '5.200 € netto im Jahr' })
      .expect(200)

    // Whoever sees every area is refused as well while the duty names it.
    await http().delete(`/contracts/${kept.id}`).set(testIdentityHeader, lead).expect(409)
    await http()
      .patch(`/contracts/${kept.id}`)
      .set(testIdentityHeader, lead)
      .send({ contractorId: firmB })
      .expect(409)

    const [duty] = (
      await admin.query<{ contractor_id: string }>(
        'select contractor_id from duties where contract_id = $1',
        [kept.id],
      )
    ).rows

    expect(duty?.contractor_id).toBe(firmA)
  })
})

describe('the deadlines of contracts and warranties', () => {
  it('stand in "Fristen": the last day to give notice, the end, and the end of a warranty', async () => {
    // In the north of the large tenant, where the Objektleitung works and accepts.
    const contractorId = await firm('Wartung Beispiel GmbH', large)
    const kept = await contract(
      contractorId,
      {
        ...lifts,
        title: 'Wartung der Lüftung',
        startsOn: addDays(today, -200),
        endsOn: addDays(today, 200),
      },
      by('management', large),
    )
    const { property, asset } = await placeIn(large, north)

    await http()
      .patch(`/assets/${asset}`)
      .set(testIdentityHeader, by('management', large))
      .send({ warrantyEndsOn: addDays(today, 90) })
      .expect(200)

    const order = (
      await http()
        .post('/work-orders')
        .set(testIdentityHeader, by('management', large))
        .send({
          title: 'Notleuchte Flur instand setzen',
          kind: 'other',
          measure: 'repair',
          urgency: 'normal',
          dueOn: addDays(today, 10),
          responsibleUserId: 'u-site',
          origin: 'hand',
          propertyId: property,
          assetId: asset,
        })
        .expect(201)
    ).body as WorkOrderDetails

    // Not yet accepted, an order has no warranty.
    await http()
      .put(`/work-orders/${order.id}/warranty`)
      .set(testIdentityHeader, by('site_management', large))
      .send({ warrantyEndsOn: addDays(today, 700) })
      .expect(409)
    await admin.query(`update activities set status = 'done' where id = $1`, [order.id])
    // Who accepts enters it; the Haustechnik does not.
    await http()
      .put(`/work-orders/${order.id}/warranty`)
      .set(testIdentityHeader, by('technician', large))
      .send({ warrantyEndsOn: addDays(today, 700) })
      .expect(403)
    await http()
      .put(`/work-orders/${order.id}/warranty`)
      .set(testIdentityHeader, by('site_management', large))
      .send({ warrantyEndsOn: addDays(today, 700) })
      .expect(200)

    const rows = await deadlines(large)
    const ofContract = rows.filter((row) => row.contract?.id === kept.id)

    expect(ofContract.map((row) => [row.kind, row.dueOn]).sort()).toEqual(
      [
        ['contract.end', addDays(today, 200)],
        ['contract.notice', expect.any(String)],
      ].sort(),
    )
    expect(ofContract[0]?.contractor?.name).toBe('Wartung Beispiel GmbH')
    expect(
      rows
        .filter((row) => row.kind === 'warranty.ends' && row.asset?.id === asset)
        .map((row) => [row.workOrder === null ? 'asset' : 'order', row.dueOn])
        .sort(),
    ).toEqual([
      ['asset', addDays(today, 90)],
      ['order', addDays(today, 700)],
    ])

    const warranties = (
      await http()
        .get(`/work-orders/warranties?assetId=${asset}`)
        .set(testIdentityHeader, by('management', large))
        .expect(200)
    ).body as OrderWarranty[]

    expect(warranties).toEqual([
      expect.objectContaining({ id: order.id, warrantyEndsOn: addDays(today, 700) }),
    ])

    // With notice given, the end stays and the notice drops.
    await http()
      .patch(`/contracts/${kept.id}`)
      .set(testIdentityHeader, by('management', large))
      .send({ cancelledTo: addDays(today, 200) })
      .expect(200)
    expect(
      (await deadlines(large))
        .filter((row) => row.contract?.id === kept.id && row.kind === 'contract.notice')
        .map((row) => (row as { status?: string }).status),
    ).not.toContain('open')
  })
})
