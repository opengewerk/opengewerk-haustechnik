import { readFileSync } from 'node:fs'

import type { INestApplication } from '@nestjs/common'
import { rightsOfRoles, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import {
  defaultPreviewDatabaseUrl,
  previewDatabaseUrl,
  previewPeople,
  previewPort,
  PreviewRefused,
  type PreviewViewer,
  previewViewer,
  refuseProduction,
} from './preview-database.js'
import { openSamplePreview } from './preview-server.js'
import { sampleProperties } from './sample-data.js'

/**
 * The preview lets every request through as one person of a sample operator
 * (#29). These tests hold the fences around that, and they plant the sample
 * data through the real routes, so that a route which changes its mind about a
 * field breaks here and not on the next start of the preview.
 */

describe('the fences around the preview', () => {
  it('uses its own database in the local test container unless told otherwise', () => {
    expect(previewDatabaseUrl({})).toBe(defaultPreviewDatabaseUrl)
  })

  it('never reads DATABASE_URL, which usually points at a real database', () => {
    expect(
      previewDatabaseUrl({ DATABASE_URL: 'postgres://app:secret@127.0.0.1:5432/haustechnik' }),
    ).toBe(defaultPreviewDatabaseUrl)
  })

  it('refuses a database that is not on this machine', () => {
    expect(() =>
      previewDatabaseUrl({
        PREVIEW_DATABASE_URL: 'postgres://app:secret@db.example.com:5432/haustechnik_preview',
      }),
    ).toThrow(PreviewRefused)
  })

  it('refuses a database that is not named for the purpose, the test database included', () => {
    for (const name of [
      'haustechnik',
      'haustechnik_test',
      'preview',
      'x"; drop table y; --_preview',
    ]) {
      expect(() =>
        previewDatabaseUrl({
          PREVIEW_DATABASE_URL: `postgres://app:secret@127.0.0.1:5434/${encodeURIComponent(name)}`,
        }),
      ).toThrow(PreviewRefused)
    }
  })

  it('does not start in production', () => {
    expect(() => {
      refuseProduction({ NODE_ENV: 'production' })
    }).toThrow(PreviewRefused)
    expect(() => {
      refuseProduction({ NODE_ENV: 'development' })
    }).not.toThrow()
  })

  it('listens on 23800 unless told otherwise, and only on a real port', () => {
    expect(previewPort({})).toBe(23800)
    expect(previewPort({ PREVIEW_PORT: '3100' })).toBe(3100)
    expect(() => previewPort({ PREVIEW_PORT: 'irgendwo' })).toThrow(PreviewRefused)
    expect(() => previewPort({ PREVIEW_PORT: '70000' })).toThrow(PreviewRefused)
  })

  it('is left out of the build, and with it out of the image', () => {
    const build = JSON.parse(
      readFileSync(new URL('../../tsconfig.build.json', import.meta.url), 'utf8'),
    ) as { readonly exclude: readonly string[] }

    expect(build.exclude).toContain('src/preview/**')
  })

  it('shows the Leitung in every area, unless a role and an area are named, and only real ones', () => {
    expect(previewViewer({})).toEqual({ role: 'management', area: null })
    expect(previewViewer({ PREVIEW_ROLE: 'technician', PREVIEW_AREA: 'Nord' })).toEqual({
      role: 'technician',
      area: 'Nord',
    })
    expect(() => previewViewer({ PREVIEW_ROLE: 'owner' })).toThrow(PreviewRefused)
    expect(() => previewViewer({ PREVIEW_AREA: 'Ost' })).toThrow(PreviewRefused)
  })
})

/**
 * A preview as `preview.ts` starts one, on the test database emptied and
 * migrated, through the same function.
 */
async function started(
  admin: Pool,
  database: Database,
  viewer: PreviewViewer,
): Promise<{ readonly application: INestApplication; readonly tenantId: TenantId }> {
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  const { application, tenant } = await openSamplePreview(admin, database, viewer, {
    interfaceDirectory: null,
  })

  await application.init()

  return { application, tenantId: tenant.id }
}

interface Named {
  readonly id: string
  readonly name: string
}

describe('a preview started as a technician in the north', () => {
  let admin: Pool
  let database: Database
  let application: INestApplication
  let tenantId: TenantId

  beforeAll(async () => {
    admin = await connect()
    database = Database.connect(applicationDatabaseUrl())
    ;({ application, tenantId } = await started(admin, database, {
      role: 'technician',
      area: 'Nord',
    }))
  })

  afterAll(async () => {
    await application.close()
    await database.close()
    await admin.end()
  })

  it('shows the properties of the north and nothing of the south', async () => {
    const answer = await request(application.getHttpServer()).get('/properties').expect(200)

    expect((answer.body as readonly Named[]).map((property) => property.name).sort()).toEqual(
      sampleProperties
        .filter((property) => property.area === 'Nord')
        .map((property) => property.name)
        .sort(),
    )

    const { rows } = await admin.query<{ id: string }>(
      `select p.id from properties p join areas a on a.id = p.area_id where a.name = 'Süd'`,
    )

    expect(rows).toHaveLength(2)

    for (const south of rows) {
      await request(application.getHttpServer()).get(`/properties/${south.id}`).expect(404)
    }
  })

  it('answers the question who is signed in with the technician, the operator already chosen', async () => {
    const answer = await request(application.getHttpServer())
      .get('/api/auth/get-session')
      .expect(200)

    expect(answer.body).toMatchObject({
      user: { id: previewPeople.viewer.id, twoFactorEnabled: true },
      session: { activeTenantId: tenantId },
    })

    const refused = await request(application.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email: 'jemand@example.com', password: 'egal' })
      .expect(404)

    expect((refused.body as { readonly message: string }).message).toContain('keine Anmeldung')
  })

  it('gives the interface the rights of the role, out of the rows of the operator', async () => {
    const answer = await request(application.getHttpServer()).get('/auth/tenants').expect(200)
    const [choice] = answer.body as readonly {
      readonly roles: string[]
      readonly rights: string[]
    }[]

    expect(choice?.roles).toEqual(['technician'])
    expect([...(choice?.rights ?? [])].sort()).toEqual([...rightsOfRoles(['technician'])].sort())
  })
})

describe('a preview started as the Leitung', () => {
  let admin: Pool
  let database: Database
  let application: INestApplication

  beforeAll(async () => {
    admin = await connect()
    database = Database.connect(applicationDatabaseUrl())
    ;({ application } = await started(admin, database, { role: 'management', area: null }))
  })

  afterAll(async () => {
    await application.close()
    await database.close()
    await admin.end()
  })

  it('shows every property, with buildings, floors, rooms and assets, a main meter with its sub meter', async () => {
    const server = application.getHttpServer()
    const properties = (await request(server).get('/properties').expect(200)).body as Named[]

    expect(properties).toHaveLength(sampleProperties.length)

    const administration = properties.find(
      (property) => property.name === 'Verwaltung Am Probehang',
    )
    const buildings = (
      await request(server)
        .get(`/properties/${String(administration?.id)}/buildings`)
        .expect(200)
    ).body as Named[]
    const floors = (
      await request(server)
        .get(`/buildings/${String(buildings[0]?.id)}/floors`)
        .expect(200)
    ).body as Named[]
    const rooms = (
      await request(server)
        .get(`/floors/${String(floors[0]?.id)}/rooms`)
        .expect(200)
    ).body as Named[]
    const assets = (
      await request(server)
        .get(`/buildings/${String(buildings[0]?.id)}/assets`)
        .expect(200)
    ).body as (Named & { readonly kind: string; readonly parentAssetId: string | null })[]

    expect(buildings.map((building) => building.name)).toEqual(['Haus A'])
    expect(floors.map((floor) => floor.name).sort()).toEqual(['1. Obergeschoss', 'Erdgeschoss'])
    expect(rooms.length).toBeGreaterThan(0)

    const main = assets.find((asset) => asset.name === 'Hauptwasserzähler Haus A')
    const sub = assets.find((asset) => asset.name === 'Unterzähler Teeküche')

    expect(assets.map((asset) => asset.kind).sort()).toEqual([
      'probe.elevator',
      'probe.water_meter',
      'probe.water_meter',
    ])
    expect(sub?.parentAssetId).toBe(main?.id)
  })

  // What the list and the page of a property are looked at with (#85).
  it('shows one property with two buildings and a note in two lines', async () => {
    const server = application.getHttpServer()
    const properties = (await request(server).get('/properties').expect(200)).body as (Named & {
      readonly note: string | null
    })[]
    const school = properties.find((property) => property.name === 'Schulzentrum Am Lindenhain')
    const buildings = (
      await request(server)
        .get(`/properties/${String(school?.id)}/buildings`)
        .expect(200)
    ).body as Named[]

    expect(school?.note?.split('\n')).toHaveLength(2)
    expect(buildings.map((building) => building.name)).toEqual(['Schulhaus', 'Sporthalle'])
    expect(properties.filter((property) => property.note !== null)).toHaveLength(1)
  })

  it('plants nothing a real operator could recognise as theirs: every postal code is one no place has', () => {
    for (const property of sampleProperties) {
      expect(property.postalCode).toMatch(/^0000\d$/)
      expect(['Beispielstadt', 'Musterhausen']).toContain(property.city)
    }
  })
})

describe('a preview started as the Leitung of the south alone', () => {
  let admin: Pool
  let database: Database
  let application: INestApplication

  beforeAll(async () => {
    admin = await connect()
    database = Database.connect(applicationDatabaseUrl())
    ;({ application } = await started(admin, database, { role: 'management', area: 'Süd' }))
  })

  afterAll(async () => {
    await application.close()
    await database.close()
    await admin.end()
  })

  it('shows the properties of the south, although a Leitung sees every area by its role', async () => {
    const answer = await request(application.getHttpServer()).get('/properties').expect(200)

    expect((answer.body as readonly Named[]).map((property) => property.name).sort()).toEqual(
      sampleProperties
        .filter((property) => property.area === 'Süd')
        .map((property) => property.name)
        .sort(),
    )
  })
})
