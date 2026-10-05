import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import type { INestApplication } from '@nestjs/common'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
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
import { dayInGermany } from '../today.js'
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
import { openSamplePreview, previewBundle } from './preview-server.js'
import {
  inServiceSince,
  outOfServiceThisYear,
  sampleProperties,
  schoolHolidays,
} from './sample-data.js'

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

/** Somebody to talk to at a property, as the route of the contacts hands one over. */
interface Person {
  readonly propertyId: string
  readonly givenName: string | null
  readonly familyName: string
  readonly role: string | null
  readonly phone: string | null
  readonly email: string | null
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

  it('shows the people to talk to in the north, and nobody of the school in the south', async () => {
    const answer = await request(application.getHttpServer()).get('/contacts').expect(200)

    expect((answer.body as readonly Person[]).map((contact) => contact.familyName)).toEqual([
      'Albers',
    ])
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

  /**
   * The preview keeps files as an instance does (#96), in a folder of this
   * start. Without a store the route would refuse every file, and a screen
   * that files a photo could not be looked at here.
   */
  it('takes a file the technician sends, as an instance does', async () => {
    const bytes = Buffer.from('Foto aus der Vorschau', 'utf8')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const answer = await request(application.getHttpServer())
      .put(`/files/${sha256}`)
      .set('content-type', 'application/octet-stream')
      .set('x-media-type', 'text/plain')
      .send(bytes)
      .expect(200)

    expect(answer.body).toEqual({ sha256, sizeBytes: bytes.byteLength, mediaType: 'text/plain' })
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

  it('names the Leitung for no area, as the routes keep whoever holds in every area', async () => {
    const overview = (await request(application.getHttpServer()).get('/areas/overview').expect(200))
      .body as readonly {
      readonly name: string
      readonly members: readonly { readonly name: string }[]
    }[]

    expect(overview.map((area) => area.name)).toEqual(['Nord', 'Süd'])

    for (const area of overview) {
      expect(area.members.length).toBeGreaterThan(0)
      expect(area.members.map((person) => person.name)).not.toContain(previewPeople.viewer.name)
    }
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

  // What the register of assets and the file of an asset are looked at with (#87).
  it('shows an asset in every condition the register knows', async () => {
    const server = application.getHttpServer()
    const register = (await request(server).get('/assets').query({ limit: '200' }).expect(200))
      .body as {
      readonly total: number
      readonly assets: readonly (Named & { readonly condition: string })[]
    }
    const conditionOf = (name: string) =>
      register.assets.find((asset) => asset.name === name)?.condition

    expect(register.total).toBe(register.assets.length)
    expect({
      inOrder: conditionOf('Aufzug Haus A'),
      generalKind: conditionOf('Lüftungsgerät Werkstatt'),
      overdue: conditionOf('Hauptwasserzähler Haus A'),
      due: conditionOf('Unterzähler Teeküche'),
      neverChecked: conditionOf('Wasserzähler Werkstatt'),
      defectOpen: conditionOf('Aufzug Schulhaus'),
      resting: conditionOf('Unterzähler Sporthalle'),
      noDuties: conditionOf('Aufzug Haus 2'),
    }).toEqual({
      inOrder: 'in_order',
      // An asset of a general kind carries a duty of the operator's own (#61).
      generalKind: 'in_order',
      overdue: 'overdue',
      due: 'due',
      neverChecked: 'never_checked',
      defectOpen: 'defect_open',
      resting: 'resting',
      noDuties: 'no_duties',
    })
  })

  // What the catalogue, the choice of an asset kind and the note at a general
  // kind are looked at with (#61).
  it('hands a device the packages of this build and the probe package beside them, as one catalogue', async () => {
    const server = application.getHttpServer()
    const whole = (await request(server).get('/catalogue').expect(200)).body as {
      readonly sha256: string
      readonly packages: readonly { readonly name: string }[]
    }
    const checksum = (await request(server).get('/catalogue/checksum').expect(200)).body as {
      readonly sha256: string
    }

    expect(whole.packages.map((entry) => entry.name)).toEqual(['allgemein', 'probe'])
    expect(whole).toEqual(previewBundle)
    // One catalogue of its own: a device that held either of the two fetches this one.
    expect(checksum.sha256).toBe(previewBundle.sha256)
    expect(previewBundle.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect([catalogueBundle.sha256, probeCatalogueBundle.sha256]).not.toContain(
      previewBundle.sha256,
    )
  })

  it('has one asset of a general kind, standing where no package describes it yet', async () => {
    const register = (
      await request(application.getHttpServer()).get('/assets').query({ limit: '200' }).expect(200)
    ).body as { readonly assets: readonly (Named & { readonly kind: string })[] }

    expect(
      register.assets
        .filter((asset) => asset.kind.startsWith('allgemein.'))
        .map((asset) => asset.name),
    ).toEqual(['Lüftungsgerät Werkstatt'])
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

  // What the card on the page of a property is looked at with (#85): somebody
  // with everything known about them, somebody without an address, somebody
  // of whom only the name is known, and properties nobody is entered at.
  it('shows the people to talk to at a property, two at the school and one at the yard', async () => {
    const server = application.getHttpServer()
    const properties = (await request(server).get('/properties').expect(200)).body as Named[]
    const contacts = (await request(server).get('/contacts').expect(200)).body as Person[]
    const at = (name: string) => {
      const property = properties.find((one) => one.name === name)

      return contacts
        .filter((contact) => contact.propertyId === property?.id)
        .map(({ givenName, familyName, role, phone, email }) => ({
          givenName,
          familyName,
          role,
          phone,
          email,
        }))
        .sort((left, right) => left.familyName.localeCompare(right.familyName, 'de'))
    }

    expect(at('Schulzentrum Am Lindenhain')).toEqual([
      {
        givenName: 'Klaus',
        familyName: 'Becker',
        role: 'Hausmeister',
        phone: '0000 4471',
        email: 'hausmeister@schulzentrum.example',
      },
      {
        givenName: 'Dr. Ines',
        familyName: 'Hartmann',
        role: 'Schulleitung',
        phone: '0000 4400',
        email: null,
      },
    ])
    expect(at('Werkhof Nord')).toEqual([
      { givenName: null, familyName: 'Albers', role: null, phone: null, email: null },
    ])
    expect(contacts).toHaveLength(3)
    expect(
      sampleProperties.filter((property) => (property.contacts ?? []).length === 0),
    ).toHaveLength(2)
  })

  // What the card on the page of a building is looked at with (#86): the
  // holidays that come next at the school house, and no closure anywhere else.
  it('shows the times the school house is closed, in the order of the calendar, and none of any other building', async () => {
    const server = application.getHttpServer()
    const properties = (await request(server).get('/properties').expect(200)).body as Named[]
    const closed: Record<string, readonly unknown[]> = {}

    for (const property of properties) {
      const buildings = (
        await request(server).get(`/properties/${property.id}/buildings`).expect(200)
      ).body as Named[]

      for (const building of buildings) {
        const closures = (
          await request(server).get(`/buildings/${building.id}/closures`).expect(200)
        ).body as { startsOn: string; endsOn: string; reason: string | null }[]

        if (closures.length > 0) {
          closed[building.name] = closures.map(({ startsOn, endsOn, reason }) => ({
            startsOn,
            endsOn,
            reason,
          }))
        }
      }
    }

    expect(closed).toEqual({ Schulhaus: schoolHolidays })
    // Both lie ahead, whenever the preview is started.
    expect(schoolHolidays.map((closure) => closure.reason)).toEqual([
      'Weihnachtsferien',
      'Sommerferien',
    ])
    expect(schoolHolidays.every((closure) => closure.endsOn >= dayInGermany())).toBe(true)
  })

  // What the pages of a building and of a room are looked at with (#86): an
  // asset in every state the page draws, and one that supplies a room without
  // standing in it. Every asset is in service, one sub meter is out of service
  // since the first day of the year; the main meter of the school house
  // supplies its whole building, and its sub meter the gym it does not stand in.
  it('gives every asset a state, takes one sub meter out of service and has two meters supply a building', async () => {
    const server = application.getHttpServer()
    const properties = (await request(server).get('/properties').expect(200)).body as Named[]
    const buildingNames = new Map<string, string>()
    const states: Record<string, string | null> = {}
    const supplying: Record<string, readonly string[]> = {}
    const standing: Record<string, string> = {}

    for (const property of properties) {
      const buildings = (
        await request(server).get(`/properties/${property.id}/buildings`).expect(200)
      ).body as Named[]

      for (const building of buildings) {
        buildingNames.set(building.id, building.name)
      }

      for (const building of buildings) {
        const listed = (await request(server).get(`/buildings/${building.id}/assets`).expect(200))
          .body as Named[]

        for (const { id } of listed) {
          const asset = (await request(server).get(`/assets/${id}`).expect(200)).body as Named & {
            readonly lifecycleState: string | null
            readonly lifecycle: readonly { readonly state: string; readonly validFrom: string }[]
            readonly supplies: readonly {
              readonly buildingId: string | null
              readonly roomId: string | null
            }[]
          }

          states[asset.name] = asset.lifecycleState
          standing[asset.name] = building.name
          expect([asset.name, asset.lifecycle[0]]).toEqual([
            asset.name,
            expect.objectContaining({ state: 'in_service', validFrom: inServiceSince }),
          ])

          if (asset.supplies.length > 0) {
            // Whole buildings: no sample asset names a room.
            expect(asset.supplies.every((supply) => supply.roomId === null)).toBe(true)
            supplying[asset.name] = asset.supplies.map(
              (supply) => buildingNames.get(String(supply.buildingId)) ?? '',
            )
          }
        }
      }
    }

    const outOfService = Object.keys(states).filter((name) => states[name] === 'out_of_service')

    expect(Object.keys(states).length).toBeGreaterThan(4)
    expect(outOfService).toEqual(['Unterzähler Sporthalle'])
    expect(
      Object.keys(states).filter(
        (name) => states[name] !== 'in_service' && states[name] !== 'out_of_service',
      ),
    ).toEqual([])
    expect(outOfServiceThisYear).toEqual([
      { state: 'out_of_service', validFrom: `${dayInGermany().slice(0, 4)}-01-01` },
    ])

    expect(supplying).toEqual({
      'Hauptwasserzähler Schulhaus': ['Schulhaus'],
      'Unterzähler Sporthalle': ['Sporthalle'],
    })
    // The sub meter supplies a building it does not stand in.
    expect(standing['Unterzähler Sporthalle']).toBe('Schulhaus')
  })

  it('plants nothing a real operator could recognise as theirs: every postal code and every phone number is one nobody has', () => {
    for (const property of sampleProperties) {
      expect(property.postalCode).toMatch(/^0000\d$/)
      expect(['Beispielstadt', 'Musterhausen']).toContain(property.city)

      for (const contact of property.contacts ?? []) {
        expect(contact.phone ?? '0000 0000').toMatch(/^0000 \d{4}$/)
        expect(contact.email ?? 'niemand@beispiel.example').toMatch(/\.example$/)
      }
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
