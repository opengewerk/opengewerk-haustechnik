import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  type DefectReading,
  type DefectRegister,
  defectTermProblem,
  type IsoDate,
  missingRight,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId } from '@opengewerk/platform-server'
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
 * The defects (#116, section 4.6 of the concept): reporting one is every
 * role's, keeping it, its class, its deadline and checking it again, is not
 * the Haustechnik's; "nachgeprüft" comes only from "behoben"; the class is one
 * the defect may take, and a class without a day takes the default the
 * operator set; a defect over its deadline stands in the list of deadlines.
 */

/** One area, as most operators have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

type Person = keyof typeof people & string

let admin: Pool
let database: Database
let app: INestApplication
let folder = ''

const today = dayInGermany()
const daysAgo = (days: number): IsoDate => addDays(today, -days)
const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
})

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the operators. */
function by(userId: Person, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

/** An elevator in a room of a building of a property of its own, made by the Technische Leitung. */
async function elevatorIn(tenantId: TenantId = small, area: string | null = null) {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id
  const property = await made('/properties', {
    name: 'Bürgerhaus Mitte',
    street: 'Hauptstraße 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...(area === null ? {} : { areaId: area }),
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Bürgerhaus',
    kinds: ['assembly'],
  })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
  const room = await made(`/floors/${floor}/rooms`, { number: 'E.01', name: 'Saal' })
  const asset = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug',
    roomId: room,
  })

  return { property, building, room, asset }
}

/** A defect reported by hand; the answer of the route. */
function reported(header: string, body: object) {
  return http().post('/defects').set(testIdentityHeader, header).send(body)
}

/** A defect at the asset with nothing but what was found, reported by the Objektleitung by default. */
async function defectAt(
  asset: string,
  description = 'Notausgangstür klemmt',
  header: string = by('u-site'),
): Promise<string> {
  return (await reported(header, { assetId: asset, description, foundOn: daysAgo(3) }).expect(201))
    .body.id
}

/** Sets a defect to a status as a work order would (#117), behind the routes. */
async function standing(defect: string, status: string): Promise<void> {
  await admin.query('update defects set status = $2::defect_status where id = $1', [defect, status])
}

async function readingOf(defect: string, header: string = by('u-lead')): Promise<DefectReading> {
  return (await http().get(`/defects/${defect}`).set(testIdentityHeader, header).expect(200))
    .body as DefectReading
}

async function registerOf(query: string, header: string = by('u-lead')): Promise<DefectRegister> {
  return (await http().get(`/defects${query}`).set(testIdentityHeader, header).expect(200))
    .body as DefectRegister
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

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
      ])
    }
  }

  // In the large operator the Objektleitung looks after the south and the
  // technician works in the north.
  await admin.query(
    'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3), ($1, $4, $5)',
    [large, 'u-site', south, 'u-tech', north],
  )

  folder = mkdtempSync(join(tmpdir(), 'haustechnik-defects-'))
  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue, files: new FileStore(folder) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
  rmSync(folder, { recursive: true, force: true })
})

describe('reporting a defect', () => {
  it.each(['u-lead', 'u-duties', 'u-site', 'u-tech'] as const)(
    'is open to %s, with what was found, where and on which day, and no class',
    async (person) => {
      const { asset, property } = await elevatorIn()
      const answer = await reported(by(person), {
        assetId: asset,
        description: 'Kabine hält nicht bündig',
        foundOn: daysAgo(1),
      }).expect(201)

      expect(answer.body).toMatchObject({
        propertyId: property,
        assetId: asset,
        description: 'Kabine hält nicht bündig',
        foundOn: daysAgo(1),
        defectClass: null,
        dueOn: null,
        status: 'found',
      })
    },
  )

  it('hangs on exactly one place, which the person sees, on a day that is not to come', async () => {
    const { asset, room } = await elevatorIn()
    const two = await reported(by('u-site'), {
      assetId: asset,
      roomId: room,
      description: 'Zwei Orte',
    })

    expect(two.status).toBe(400)
    expect(two.body.message).toBe(
      'Ein Mangel hängt an genau einem: einer Anlage, einem Raum, einem Gebäude oder der Liegenschaft.',
    )

    const none = await reported(by('u-site'), { description: 'Nirgends' })

    expect(none.status).toBe(400)

    const later = await reported(by('u-site'), {
      assetId: asset,
      description: 'Morgen',
      foundOn: addDays(today, 1),
    })

    expect(later.status).toBe(400)
    expect(later.body.message).toBe('Der Tag der Feststellung liegt nicht in der Zukunft.')

    const empty = await reported(by('u-site'), { assetId: asset, description: ' ' })

    expect(empty.status).toBe(400)
    expect(empty.body.message).toBe('Die Beschreibung fehlt.')
  })

  it('reaches no place outside the areas of the person', async () => {
    const { asset } = await elevatorIn(large, south)
    const answer = await reported(by('u-tech', large), { assetId: asset, description: 'Im Süden' })

    expect(answer.status).toBe(404)
  })

  it('comes with a class and a day only from whoever keeps defects', async () => {
    const { asset } = await elevatorIn()
    const body = {
      assetId: asset,
      description: 'Schild fehlt',
      defectClass: 'allgemein.minor',
      dueOn: addDays(today, 30),
    }
    const refused = await reported(by('u-tech'), body)

    expect(refused.status).toBe(403)
    expect(refused.body.message).toBe('Klasse und Frist vergibt, wer Mängel führt.')
    expect((await reported(by('u-tech'), { ...body, defectClass: undefined })).status).toBe(403)
    expect((await reported(by('u-site'), body).expect(201)).body).toMatchObject({
      defectClass: 'allgemein.minor',
      dueOn: addDays(today, 30),
    })
  })
})

describe('keeping a defect', () => {
  it.each([
    ['u-lead', 200],
    ['u-duties', 200],
    ['u-site', 200],
    ['u-tech', 403],
  ] as const)('is for %s answered with %i', async (person, status) => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)
    const answer = await http()
      .patch(`/defects/${defect}`)
      .set(testIdentityHeader, by(person))
      .send({ defectClass: 'allgemein.significant', dueOn: addDays(today, 10) })

    expect(answer.status).toBe(status)
    expect((await readingOf(defect)).defectClass).toBe(
      status === 200 ? 'allgemein.significant' : null,
    )
  })

  it('gives the class only one the defect may take', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)

    for (const key of ['allgemein.unknown', 'probe.elevator']) {
      const answer = await http()
        .patch(`/defects/${defect}`)
        .set(testIdentityHeader, by('u-site'))
        .send({ defectClass: key })

      expect(answer.status).toBe(400)
      expect(answer.body.message).toBe('Diese Klasse steht für diesen Mangel nicht zur Wahl.')
    }

    expect((await readingOf(defect)).classChoices.map((choice) => choice.key)).toEqual([
      'allgemein.minor',
      'allgemein.significant',
      'allgemein.dangerous',
    ])
  })

  it('takes the default of the class for a class given without a day, and lets the day be changed', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)

    await http()
      .put('/settings/defect-classes/allgemein.dangerous')
      .set(testIdentityHeader, by('u-lead'))
      .send({ dueDays: 2 })
      .expect(200)

    await http()
      .patch(`/defects/${defect}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ defectClass: 'allgemein.dangerous' })
      .expect(200)

    const classed = await readingOf(defect)

    expect(classed.dueOn).toBe(addDays(daysAgo(3), 2))
    expect(classed.classChoices.find((choice) => choice.key === 'allgemein.dangerous')).toEqual({
      key: 'allgemein.dangerous',
      label: 'gefährlich',
      dueDays: 2,
    })

    await http()
      .patch(`/defects/${defect}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ dueOn: addDays(today, 40) })
      .expect(200)

    expect((await readingOf(defect)).dueOn).toBe(addDays(today, 40))

    const before = await http()
      .patch(`/defects/${defect}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ dueOn: daysAgo(4) })

    expect(before.status).toBe(400)
    expect(before.body.message).toBe(
      'Die Frist zur Beseitigung liegt nicht vor dem Tag der Feststellung.',
    )
  })

  it('changes nothing of a defect that was checked again', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)

    await standing(defect, 'remedied')
    await http()
      .post(`/defects/${defect}/check`)
      .set(testIdentityHeader, by('u-site'))
      .send({ outcome: 'verified', checkedOn: today })
      .expect(201)

    const answer = await http()
      .patch(`/defects/${defect}`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ description: 'Anders' })

    expect(answer.status).toBe(409)
    expect(answer.body.message).toBe(
      'Ein nachgeprüfter Mangel ist erledigt und ändert sich nicht mehr.',
    )
  })
})

describe('the default of a class', () => {
  it('is set by the Leitung, whole days, and taken away by an empty one', async () => {
    const put = (header: string, dueDays: unknown, key = 'allgemein.minor') =>
      http()
        .put(`/settings/defect-classes/${key}`)
        .set(testIdentityHeader, header)
        .send({ dueDays })

    const refused = await put(by('u-site'), 30)
    const wrong = await put(by('u-lead'), 0)

    expect([refused.status, refused.body.message]).toEqual([403, missingRight('settings.write')])
    expect([wrong.status, wrong.body.message]).toEqual([400, defectTermProblem(0)])
    expect((await put(by('u-lead'), 30, 'allgemein.unknown')).status).toBe(404)

    await put(by('u-lead'), 30).expect(200)
    await put(by('u-lead'), 60).expect(200)

    const listed = async () =>
      (
        (
          await http()
            .get('/settings/defect-classes')
            .set(testIdentityHeader, by('u-lead'))
            .expect(200)
        ).body as readonly { key: string; dueDays: number | null }[]
      ).find((setting) => setting.key === 'allgemein.minor')?.dueDays

    expect(await listed()).toBe(60)

    await put(by('u-lead'), null).expect(200)

    expect(await listed()).toBeNull()
  })
})

describe('checking a defect again', () => {
  const check = (defect: string, header: string, body: object) =>
    http().post(`/defects/${defect}/check`).set(testIdentityHeader, header).send(body)

  it('is a step only from remedied', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)

    for (const status of ['found', 'ordered']) {
      await standing(defect, status)

      const answer = await check(defect, by('u-site'), { outcome: 'verified', checkedOn: today })

      expect(answer.status).toBe(409)
      expect(answer.body.message).toBe('Nachprüfen lässt sich nur ein Mangel, der behoben ist.')
      expect((await readingOf(defect)).status).toBe(status)
    }

    await standing(defect, 'remedied')
    await check(defect, by('u-site'), {
      outcome: 'verified',
      checkedOn: today,
      note: 'Tür geht leicht auf.',
    }).expect(201)

    expect(await readingOf(defect)).toMatchObject({
      status: 'verified',
      checkedOn: today,
      checkNote: 'Tür geht leicht auf.',
    })
    expect(
      (await check(defect, by('u-site'), { outcome: 'verified', checkedOn: today })).status,
    ).toBe(409)
  })

  it('finds a defect that is not set right once more, with what was found', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)

    await standing(defect, 'remedied')

    const silent = await check(defect, by('u-site'), {
      outcome: 'not_remedied',
      checkedOn: today,
    })

    expect(silent.status).toBe(400)
    expect(silent.body.message).toBe('Sagen Sie, was Sie vorgefunden haben.')

    await check(defect, by('u-site'), {
      outcome: 'not_remedied',
      checkedOn: today,
      note: 'Klemmt weiter am Boden.',
    }).expect(201)

    expect(await readingOf(defect)).toMatchObject({
      status: 'found',
      checkedOn: today,
      checkNote: 'Klemmt weiter am Boden.',
    })
  })

  it('is not the Haustechnik’s', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset)

    await standing(defect, 'remedied')

    expect(
      (await check(defect, by('u-tech'), { outcome: 'verified', checkedOn: today })).status,
    ).toBe(403)
    expect((await readingOf(defect)).status).toBe('remedied')
  })
})

describe('the register of defects', () => {
  it('lists what is open, what is over its deadline and what was checked again, each counted', async () => {
    const { asset, room } = await elevatorIn(large, north)
    const elsewhere = await defectAt(
      (await elevatorIn(large, south)).asset,
      'Im Süden',
      by('u-lead', large),
    )
    const late = await defectAt(asset, 'Notleuchte ohne Funktion', by('u-lead', large))
    const done = await defectAt(asset, 'Feuerlöscher ohne Plakette', by('u-lead', large))
    const atRoom = (
      await reported(by('u-lead', large), { roomId: room, description: 'Fenster undicht' }).expect(
        201,
      )
    ).body.id as string

    await admin.query('update defects set due_on = $2 where id = $1', [late, daysAgo(1)])
    await admin.query(`update defects set defect_class = 'allgemein.minor' where id = $1`, [atRoom])
    await standing(done, 'remedied')
    await http()
      .post(`/defects/${done}/check`)
      .set(testIdentityHeader, by('u-lead', large))
      .send({ outcome: 'verified', checkedOn: today })
      .expect(201)

    const open = await registerOf(`?areaId=${north}`, by('u-lead', large))

    expect(open.counts).toEqual({ open: 2, overdue: 1, verified: 1 })
    expect(open.defects.map((defect) => defect.id)).toEqual([late, atRoom])
    expect(open.defects[0]).toMatchObject({
      overdue: true,
      origin: { kind: 'hand' },
      place: { asset: { id: asset, name: 'Aufzug' }, roomId: room, roomLabel: 'E.01 Saal' },
      workOrder: null,
    })
    expect(
      (await registerOf(`?state=overdue&areaId=${north}`, by('u-lead', large))).defects.map(
        (defect) => defect.id,
      ),
    ).toEqual([late])
    expect(
      (await registerOf(`?state=verified&areaId=${north}`, by('u-lead', large))).defects.map(
        (defect) => defect.id,
      ),
    ).toEqual([done])
    expect(
      (await registerOf(`?roomId=${room}`, by('u-lead', large))).defects.map((defect) => defect.id),
    ).toEqual([late, atRoom])
    expect(
      (await registerOf(`?defectClass=none&areaId=${north}`, by('u-lead', large))).defects.map(
        (defect) => defect.id,
      ),
    ).toEqual([late])
    expect(
      (await registerOf(`?areaId=${south}`, by('u-lead', large))).defects.map(
        (defect) => defect.id,
      ),
    ).toEqual([elsewhere])
  })

  it('shows each person the defects of their areas', async () => {
    const inSouth = await defectAt(
      (await elevatorIn(large, south)).asset,
      'Im Süden',
      by('u-lead', large),
    )
    const seen = async (person: Person) =>
      (await registerOf('?state=all&limit=200', by(person, large))).defects.map(
        (defect) => defect.id,
      )

    expect(await seen('u-site')).toContain(inSouth)
    expect(await seen('u-tech')).not.toContain(inSouth)
    expect(
      (await http().get(`/defects/${inSouth}`).set(testIdentityHeader, by('u-tech', large))).status,
    ).toBe(404)
  })

  it('refuses a list it does not know and a filter that is no id', async () => {
    expect(
      (await http().get('/defects?state=all-of-them').set(testIdentityHeader, by('u-lead'))).status,
    ).toBe(400)
    expect(
      (await http().get('/defects?propertyId=x').set(testIdentityHeader, by('u-lead'))).status,
    ).toBe(400)
  })
})

describe('the deadline of a defect', () => {
  it('stands in the list of deadlines while the defect waits, and drops once it is remedied', async () => {
    const { asset } = await elevatorIn()
    const defect = await defectAt(asset, 'Geländer lose')

    await admin.query('update defects set due_on = $2 where id = $1', [defect, daysAgo(1)])
    await runDeadlinesOf({ database, catalogue }, small, new Date())

    const listed = async () =>
      (
        (await http().get('/deadlines?limit=200').set(testIdentityHeader, by('u-lead')).expect(200))
          .body as { rows: readonly Record<string, unknown>[] }
      ).rows.filter((row) => row['defectId'] === defect)

    expect(await listed()).toEqual([
      expect.objectContaining({
        kind: 'defect.due',
        status: 'open',
        dueOn: daysAgo(1),
        follows: 'defect',
        defectId: defect,
        description: 'Geländer lose',
        asset: expect.objectContaining({ id: asset }) as unknown,
      }),
    ])

    await standing(defect, 'remedied')
    await runDeadlinesOf({ database, catalogue }, small, new Date())

    expect((await listed()).map((row) => row['status'])).not.toContain('open')
  })
})
