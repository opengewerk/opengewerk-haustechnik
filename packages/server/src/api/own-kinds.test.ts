import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type CatalogueBundle,
  catalogueOf,
  missingRight,
  type OwnKindsReading,
  type RoleKey,
  rightsOfRoles,
  roleKeys,
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
import { as, testIdentities } from './test-identity.js'
import { tableReaders } from './test-tables.js'

/**
 * The asset kinds and fields of an operator's own (#62, sections 2.5 and 4.2
 * of the concept): made and kept by the Leitung and the Technische Leitung,
 * handed to every device inside the catalogue, and asked wherever an asset is
 * taken in. The catalogue is the probe package, with an elevator of the cost
 * group 461 and a water meter of 412.
 *
 * Every test has a tenant of its own.
 */

const people: Readonly<Record<RoleKey, string>> = {
  management: 'u-lead',
  technical_management: 'u-duties',
  site_management: 'u-site',
  technician: 'u-tech',
  reporter: 'u-reporter',
  auditor: 'u-auditor',
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

const { tableOf } = tableReaders(http)

async function tenantWith(): Promise<TenantId> {
  const id = newId<'tenant'>() as TenantId

  await admin.query('insert into tenants (id, name) values ($1, $2)', [id, 'Wohnbau Nord eG'])

  for (const role of roleKeys) {
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      id,
      people[role],
      [role],
    ])
  }

  return id
}

function by(role: RoleKey, tenant: TenantId): string {
  return as(tenant, people[role], role)
}

function post(path: string, header: string, body: object) {
  return http().post(path).set(testIdentityHeader, header).send(body)
}

function patch(path: string, header: string, body: object) {
  return http().patch(path).set(testIdentityHeader, header).send(body)
}

function remove(path: string, header: string) {
  return http().delete(path).set(testIdentityHeader, header)
}

function get(path: string, header: string) {
  return http().get(path).set(testIdentityHeader, header)
}

interface Made {
  readonly id: string
  readonly key: string
}

/** A lifting station of the operator's own, with a number and a choice. */
async function liftingStation(tenant: TenantId): Promise<{ kind: Made; flow: Made; pumps: Made }> {
  const lead = by('management', tenant)
  const kind = (
    await post('/own-kinds', lead, { label: 'Hebeanlage Schmutzwasser', costGroup: '461' }).expect(
      201,
    )
  ).body as Made
  const flow = (
    await post('/own-kinds/fields', lead, {
      assetKind: kind.key,
      label: 'Fördermenge',
      sort: 'number',
      unit: 'm³/h',
    }).expect(201)
  ).body as Made
  const pumps = (
    await post('/own-kinds/fields', lead, {
      assetKind: kind.key,
      label: 'Pumpen',
      sort: 'choice',
      options: ['Einzelanlage', 'Doppelanlage'],
    }).expect(201)
  ).body as Made

  return { kind, flow, pumps }
}

/** A building to put assets in, made over the routes. */
async function buildingOf(tenant: TenantId): Promise<string> {
  const header = by('technical_management', tenant)
  const property = (
    await post('/properties', header, {
      name: 'Schulzentrum Am Neckar',
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
    }).expect(201)
  ).body as { id: string }

  return (
    (
      await post(`/properties/${property.id}/buildings`, header, {
        name: 'Haus A',
        kinds: ['school'],
      }).expect(201)
    ).body as { id: string }
  ).id
}

async function bundleOf(tenant: TenantId): Promise<CatalogueBundle> {
  return (await get('/catalogue', by('technician', tenant)).expect(200)).body as CatalogueBundle
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const role of roleKeys) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      people[role],
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

describe("an asset kind of the operator's own", () => {
  it('is made with a key of its label that a second kind of the same label does not take', async () => {
    const tenant = await tenantWith()
    const first = await liftingStation(tenant)
    const second = (
      await post('/own-kinds', by('technical_management', tenant), {
        label: 'Hebeanlage Schmutzwasser',
        costGroup: '412',
      }).expect(201)
    ).body as Made & { label: string; costGroup: string; version: number }

    expect(first.kind.key).toBe('eigen.hebeanlage_schmutzwasser')
    expect(second).toMatchObject({
      key: 'eigen.hebeanlage_schmutzwasser_2',
      label: 'Hebeanlage Schmutzwasser',
      costGroup: '412',
      version: 1,
    })
    expect(first.flow.key).toBe('eigen_foerdermenge')
  })

  it('acceptance 1: an asset is taken in with it and filled with the values of its fields', async () => {
    const tenant = await tenantWith()
    const { kind } = await liftingStation(tenant)
    const building = await buildingOf(tenant)
    const keeper = by('technician', tenant)
    const made = (
      await post(`/buildings/${building}/assets`, keeper, {
        kind: kind.key,
        name: 'Hebeanlage Keller',
        values: { eigen_foerdermenge: 4.5, eigen_pumpen: 'o2' },
      }).expect(201)
    ).body as { id: string; kind: string; values: Record<string, unknown> }

    expect(made).toMatchObject({
      kind: kind.key,
      values: { eigen_foerdermenge: 4.5, eigen_pumpen: 'o2' },
    })

    const refused = await post(`/buildings/${building}/assets`, keeper, {
      kind: kind.key,
      name: 'Hebeanlage Hof',
      values: { eigen_pumpen: 'drei' },
    }).expect(400)

    expect((refused.body as { message: string }).message).toBe(
      'Pumpen ist eine von Einzelanlage, Doppelanlage.',
    )

    // A changed value is held to the field as well, and a correct one taken.
    await patch(`/assets/${made.id}`, keeper, { values: { eigen_foerdermenge: 'viel' } }).expect(
      400,
    )
    await patch(`/assets/${made.id}`, keeper, { values: { eigen_foerdermenge: 6 } }).expect(200)
  })

  it('acceptance 2: an own field at a kind of a package takes values, and one of the wrong sort is refused', async () => {
    const tenant = await tenantWith()
    const lead = by('management', tenant)
    const call = (
      await post('/own-kinds/fields', lead, {
        assetKind: 'probe.elevator',
        label: 'Notrufnummer am Tableau',
        sort: 'text',
      }).expect(201)
    ).body as Made

    expect(call.key).toBe('eigen_notrufnummer_am_tableau')

    const building = await buildingOf(tenant)
    const keeper = by('technician', tenant)

    await post(`/buildings/${building}/assets`, keeper, {
      kind: 'probe.elevator',
      name: 'Aufzug Haus A',
      values: { stops: 4, eigen_notrufnummer_am_tableau: '0621 123 45' },
    }).expect(201)

    const refused = await post(`/buildings/${building}/assets`, keeper, {
      kind: 'probe.elevator',
      name: 'Aufzug Haus B',
      values: { eigen_notrufnummer_am_tableau: 42 },
    }).expect(400)

    expect((refused.body as { message: string }).message).toBe(
      'Notrufnummer am Tableau ist ein Text, der nicht leer ist.',
    )
  })

  it('acceptance 3: another operator sees neither the own kind nor the own field', async () => {
    const tenant = await tenantWith()
    const other = await tenantWith()
    const { kind, flow } = await liftingStation(tenant)

    await post('/own-kinds/fields', by('management', tenant), {
      assetKind: 'probe.elevator',
      label: 'Notruf',
      sort: 'text',
    }).expect(201)

    const theirs = await bundleOf(other)

    expect(theirs).toEqual(probeCatalogueBundle)
    expect((await get('/own-kinds', by('management', other)).expect(200)).body).toEqual({
      kinds: [],
      fields: [],
    })

    const building = await buildingOf(other)
    const refused = await post(`/buildings/${building}/assets`, by('technician', other), {
      kind: kind.key,
      name: 'Hebeanlage',
    }).expect(400)

    expect((refused.body as { message: string }).message).toBe(
      `Die Anlagenart ${kind.key} kennt kein Paket des Katalogs.`,
    )
    await post(`/buildings/${building}/assets`, by('technician', other), {
      kind: 'probe.elevator',
      name: 'Aufzug',
      values: { eigen_notruf: '110' },
    }).expect(400)
    await patch(`/own-kinds/${kind.id}`, by('management', other), { label: 'Fremd' }).expect(404)
    await patch(`/own-kinds/fields/${flow.id}`, by('management', other), { label: 'Fremd' }).expect(
      404,
    )
  })

  it('comes to a device with the catalogue, under a checksum that changes with every change', async () => {
    const tenant = await tenantWith()
    const before = await bundleOf(tenant)

    expect(before).toEqual(probeCatalogueBundle)

    const { kind } = await liftingStation(tenant)
    const withKind = await bundleOf(tenant)
    const checksum = (await get('/catalogue/checksum', by('technician', tenant)).expect(200))
      .body as { sha256: string }

    expect(withKind.packages).toEqual(probeCatalogueBundle.packages)
    expect(withKind.sha256).not.toBe(probeCatalogueBundle.sha256)
    expect(checksum.sha256).toBe(withKind.sha256)
    expect(withKind.own?.assetKinds.map((entry) => entry.definition)).toEqual([
      {
        label: 'Hebeanlage Schmutzwasser',
        costGroup: '461',
        characteristics: [],
        fields: [
          { key: 'eigen_foerdermenge', label: 'Fördermenge', kind: 'number', unit: 'm³/h' },
          {
            key: 'eigen_pumpen',
            label: 'Pumpen',
            kind: 'choice',
            options: [
              { value: 'o1', label: 'Einzelanlage' },
              { value: 'o2', label: 'Doppelanlage' },
            ],
          },
        ],
        expectedDocuments: [],
        meter: null,
      },
    ])

    await patch(`/own-kinds/${kind.id}`, by('management', tenant), {
      expectedDocuments: [
        { label: 'Betriebsanleitung', kind: 'operating_manual', demand: 'recommended' },
      ],
    }).expect(200)

    const changed = await bundleOf(tenant)

    expect(changed.sha256).not.toBe(withKind.sha256)
    expect(changed.own?.assetKinds[0]).toMatchObject({
      version: 2,
      definition: {
        expectedDocuments: [
          {
            key: 'betriebsanleitung',
            label: 'Betriebsanleitung',
            kind: 'operating_manual',
            demand: 'recommended',
            source: null,
          },
        ],
      },
    })
  })

  it('comes only to a device of whoever sees the assets: a Melder none, an auditor those its assets carry (section 7)', async () => {
    const tenant = await tenantWith()
    const { kind } = await liftingStation(tenant)
    const lead = by('management', tenant)
    const second = (
      await post('/own-kinds', lead, { label: 'Rolltor Tiefgarage', costGroup: '461' }).expect(201)
    ).body as Made
    const building = await buildingOf(tenant)
    const whole = await bundleOf(tenant)

    expect(whole.own?.assetKinds.map((entry) => entry.key).sort()).toEqual(
      [kind.key, second.key].sort(),
    )

    // A Melder sees nothing of the operator, also not on the device.
    const reporter = by('reporter', tenant)
    const ofTheReporter = (await get('/catalogue', reporter).expect(200)).body as CatalogueBundle

    expect(ofTheReporter).toEqual(probeCatalogueBundle)
    expect((await get('/catalogue/checksum', reporter).expect(200)).body).toEqual({
      sha256: probeCatalogueBundle.sha256,
    })

    // An auditor gets no kind no asset of theirs carries, and one that one carries.
    const auditor = by('auditor', tenant)

    expect((await get('/catalogue', auditor).expect(200)).body).toEqual(probeCatalogueBundle)

    await post(`/buildings/${building}/assets`, by('technician', tenant), {
      kind: kind.key,
      name: 'Hebeanlage Keller',
      values: {},
    }).expect(201)

    const ofTheAuditor = (await get('/catalogue', auditor).expect(200)).body as CatalogueBundle

    expect(ofTheAuditor.own?.assetKinds.map((entry) => entry.key)).toEqual([kind.key])
    expect((await get('/catalogue/checksum', auditor).expect(200)).body).toEqual({
      sha256: ofTheAuditor.sha256,
    })
  })

  it('goes, with its fields, only while no asset carries it, and a field only while no asset holds a value of it', async () => {
    const tenant = await tenantWith()
    const lead = by('management', tenant)
    const { kind, flow, pumps } = await liftingStation(tenant)
    const building = await buildingOf(tenant)
    const asset = (
      await post(`/buildings/${building}/assets`, by('technician', tenant), {
        kind: kind.key,
        name: 'Hebeanlage Keller',
        values: { eigen_pumpen: 'o1' },
      }).expect(201)
    ).body as { id: string }

    expect((await remove(`/own-kinds/${kind.id}`, lead).expect(409)).body.message).toBe(
      'Die Anlagenart tragen noch 1 Anlage. Entfernt wird sie, solange keine Anlage sie trägt.',
    )
    expect((await remove(`/own-kinds/fields/${pumps.id}`, lead).expect(409)).body.message).toBe(
      'Die Angabe hat an 1 Anlage einen Wert. Entfernt wird sie, solange keine Anlage einen Wert von ihr hat.',
    )
    // A choice an asset holds stays; one nobody holds goes, and a new one comes.
    expect(
      (
        await patch(`/own-kinds/fields/${pumps.id}`, lead, {
          options: ['Doppelanlage', 'Dreifachanlage'],
        }).expect(409)
      ).body.message,
    ).toBe(
      'Die Auswahl „Einzelanlage“ hat eine Anlage als Wert. Sie bleibt, solange eine Anlage sie trägt.',
    )
    expect(
      (
        await patch(`/own-kinds/fields/${pumps.id}`, lead, {
          options: ['Einzelanlage', 'Dreifachanlage'],
        }).expect(200)
      ).body,
    ).toMatchObject({
      options: [
        { value: 'o1', label: 'Einzelanlage' },
        { value: 'o3', label: 'Dreifachanlage' },
      ],
    })
    // Nobody holds the flow: it goes.
    await remove(`/own-kinds/fields/${flow.id}`, lead).expect(200)

    // A removed asset still carries its kind.
    await admin.query('update assets set deleted_at = now() where id = $1', [asset.id])
    await remove(`/own-kinds/${kind.id}`, lead).expect(409)
    await admin.query('delete from assets where id = $1', [asset.id])
    await remove(`/own-kinds/${kind.id}`, lead).expect(200)

    expect((await bundleOf(tenant)).own).toBeUndefined()
    expect((await get('/own-kinds', lead).expect(200)).body).toEqual({ kinds: [], fields: [] })
  })

  it('changes the sort of a field only while no asset holds a value of it (section 2.5, #529)', async () => {
    const tenant = await tenantWith()
    const lead = by('management', tenant)
    const { kind, flow, pumps } = await liftingStation(tenant)
    const building = await buildingOf(tenant)

    await post(`/buildings/${building}/assets`, by('technician', tenant), {
      kind: kind.key,
      name: 'Hebeanlage Keller',
      values: { eigen_pumpen: 'o1' },
    }).expect(201)

    // The pumps are held at an asset: their sort stays.
    expect(
      (await patch(`/own-kinds/fields/${pumps.id}`, lead, { sort: 'text' }).expect(409)).body
        .message,
    ).toBe(
      '1 Anlage hält einen Wert dieser Angabe. Ihre Sorte ändert sich nur, solange keine Anlage einen Wert hat.',
    )

    // Nobody holds the flow: a number becomes a choice, and its unit goes.
    await patch(`/own-kinds/fields/${flow.id}`, lead, { sort: 'choice' }).expect(400)
    expect(
      (
        await patch(`/own-kinds/fields/${flow.id}`, lead, {
          sort: 'choice',
          options: ['klein', 'groß'],
        }).expect(200)
      ).body,
    ).toMatchObject({
      sort: 'choice',
      unit: null,
      options: [
        { value: 'o1', label: 'klein' },
        { value: 'o2', label: 'groß' },
      ],
    })
    expect(
      (await patch(`/own-kinds/fields/${flow.id}`, lead, { sort: 'date' }).expect(200)).body,
    ).toMatchObject({ sort: 'date', unit: null, options: [] })
  })

  it('counts what carries a kind and holds a field past the areas of whoever asks', async () => {
    const tenant = await tenantWith()
    const { kind } = await liftingStation(tenant)
    const building = await buildingOf(tenant)

    await post(`/buildings/${building}/assets`, by('technician', tenant), {
      kind: kind.key,
      name: 'Hebeanlage Keller',
      values: { eigen_foerdermenge: 3 },
    }).expect(201)

    const reading = (await get('/own-kinds', by('technical_management', tenant)).expect(200))
      .body as OwnKindsReading

    expect(
      reading.kinds.map(({ key, assets, fields }) => ({
        key,
        assets,
        fields: fields.map((each) => [each.key, each.values]),
      })),
    ).toEqual([
      {
        key: kind.key,
        assets: 1,
        fields: [
          ['eigen_foerdermenge', 1],
          ['eigen_pumpen', 0],
        ],
      },
    ])
  })

  /**
   * A role of the operator's own that keeps the kinds in some areas only
   * (#474): it is counted what carries a kind in its areas, and removing a
   * kind, a field or a choice, which is decided over every area, is for
   * whoever sees all of them. Making and changing stay with it.
   */
  it('counts for whoever keeps them in some areas only what lies there, and leaves removing to whoever sees every area', async () => {
    const tenant = await tenantWith()
    const { kind, flow, pumps } = await liftingStation(tenant)
    const building = await buildingOf(tenant)

    await post(`/buildings/${building}/assets`, by('technician', tenant), {
      kind: kind.key,
      name: 'Hebeanlage Keller',
      values: { eigen_foerdermenge: 3, eigen_pumpen: 'o1' },
    }).expect(201)

    // A second area, the only one the Objektleitung holds in from now on.
    const { rows } = await admin.query<{ id: string }>(
      `insert into areas (tenant_id, name) values ($1, 'Süd') returning id`,
      [tenant],
    )

    await admin.query('delete from member_areas where tenant_id = $1 and user_id = $2', [
      tenant,
      people.site_management,
    ])
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [tenant, people.site_management, rows[0]?.id],
    )

    const narrow = JSON.stringify({
      userId: people.site_management,
      tenantId: tenant,
      roles: ['site_management'],
      rights: [...rightsOfRoles(['site_management']), 'kind.write'],
    })
    const counted = async (header: string) =>
      ((await get('/own-kinds', header).expect(200)).body as OwnKindsReading).kinds.map(
        ({ assets, fields }) => [assets, fields.map((each) => each.values)],
      )

    expect(await counted(narrow)).toEqual([[0, [0, 0]]])
    expect(await counted(by('technical_management', tenant))).toEqual([[1, [1, 1]]])

    const wanted =
      'Eine eigene Anlagenart, eine eigene Angabe oder eine Auswahl daran entfernen kann nur, wer alle Bereiche sieht: Anlagen in jedem Bereich können sie tragen.'

    expect((await remove(`/own-kinds/${kind.id}`, narrow).expect(403)).body.message).toBe(wanted)
    expect((await remove(`/own-kinds/fields/${flow.id}`, narrow).expect(403)).body.message).toBe(
      wanted,
    )
    expect(
      (
        await patch(`/own-kinds/fields/${pumps.id}`, narrow, {
          options: ['Doppelanlage', 'Dreifachanlage'],
        }).expect(403)
      ).body.message,
    ).toBe(wanted)

    // What takes nothing away stays with it.
    await patch(`/own-kinds/fields/${pumps.id}`, narrow, {
      options: ['Einzelanlage', 'Doppelanlage', 'Dreifachanlage'],
    }).expect(200)
    await patch(`/own-kinds/${kind.id}`, narrow, { label: 'Hebeanlage' }).expect(200)
    // Whoever sees every area is told what still carries the kind.
    await remove(`/own-kinds/${kind.id}`, by('technical_management', tenant)).expect(409)
  })

  it('is kept by the Leitung and the Technische Leitung alone', async () => {
    const tenant = await tenantWith()
    const { kind, flow } = await liftingStation(tenant)

    for (const role of ['site_management', 'technician', 'reporter'] as const) {
      const header = by(role, tenant)
      const refused = await get('/own-kinds', header).expect(403)

      expect((refused.body as { message: string }).message).toBe(missingRight('kind.write'))
      await post('/own-kinds', header, { label: 'Pumpe', costGroup: '461' }).expect(403)
      await patch(`/own-kinds/${kind.id}`, header, { label: 'Pumpe' }).expect(403)
      await remove(`/own-kinds/${kind.id}`, header).expect(403)
      await post('/own-kinds/fields', header, {
        assetKind: kind.key,
        label: 'Leistung',
        sort: 'text',
      }).expect(403)
      await patch(`/own-kinds/fields/${flow.id}`, header, { label: 'Leistung' }).expect(403)
      await remove(`/own-kinds/fields/${flow.id}`, header).expect(403)
    }

    await patch(`/own-kinds/${kind.id}`, by('technical_management', tenant), {
      label: 'Hebeanlage',
    }).expect(200)
  })

  it('says what is wrong with a kind or a field', async () => {
    const tenant = await tenantWith()
    const lead = by('management', tenant)
    const message = async (call: Promise<request.Response>) =>
      ((await call).body as { message: string }).message

    expect(
      await message(post('/own-kinds', lead, { label: 'Pumpe', costGroup: '999' }).expect(400)),
    ).toBe('Die Kostengruppe ist keine, die der Katalog kennt.')
    expect(
      await message(
        post('/own-kinds/fields', lead, {
          assetKind: 'eigen.gibt_es_nicht',
          label: 'Leistung',
          sort: 'text',
        }).expect(400),
      ),
    ).toBe('Die Anlagenart eigen.gibt_es_nicht kennt der Katalog nicht.')
    expect(
      await message(
        post('/own-kinds/fields', lead, {
          assetKind: 'probe.elevator',
          label: 'Lage',
          sort: 'choice',
        }).expect(400),
      ),
    ).toBe('Eine Auswahl hat 2 bis 30 Möglichkeiten mit höchstens 80 Zeichen, jede einmal.')

    const { kind } = await liftingStation(tenant)

    expect(
      await message(
        patch(`/own-kinds/${kind.id}`, lead, {
          expectedDocuments: [{ label: 'Prüfbuch', kind: 'operating_manual', demand: 'required' }],
        }).expect(400),
      ),
    ).toBe('Eine verlangte Unterlage nennt ihre Fundstelle, „Prüfbuch“ nicht.')
  })

  it('stands in the log as a table with its label and the labels of its fields (#426)', async () => {
    const tenant = await tenantWith()
    const { kind } = await liftingStation(tenant)
    const building = await buildingOf(tenant)

    await post(`/buildings/${building}/assets`, by('technician', tenant), {
      kind: kind.key,
      name: 'Hebeanlage Keller',
      values: { eigen_foerdermenge: 4.5 },
    }).expect(201)

    const cells = (
      await tableOf('/audit/table', { table: 'assets' }, by('management', tenant), 'csv')
    ).flat()

    expect(cells).toContain('Hebeanlage Schmutzwasser')
    expect(cells.some((cell) => cell.includes('Fördermenge'))).toBe(true)
    expect(cells.filter((cell) => cell.includes('eigen'))).toEqual([])
  })

  it('may be the kind a word of a list means', async () => {
    const tenant = await tenantWith()
    const { kind } = await liftingStation(tenant)

    await http()
      .put('/imports/asset-kinds')
      .set(testIdentityHeader, by('site_management', tenant))
      .send({ names: [{ name: 'Hebeanlage', kind: kind.key }] })
      .expect(200)
  })
})
