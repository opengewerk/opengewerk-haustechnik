import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type AuditPage,
  closureLimits,
  missingRight,
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
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The times a building is closed (#86, section 4.1 of the concept), in which
 * no round is made for it: a closure hangs on a building and lies in the area
 * of it, whoever sees the building reads its closures, and whoever plans and
 * hands out activities enters and removes them.
 *
 * The people are members of their tenant in the database: what somebody sees
 * the database reads from their membership, whatever the header of a request
 * says.
 */

/** One area, as most tenants have it: everybody works in it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; Objektleitung and Haustechnik work in the north. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''
let onlyArea = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

type Person = keyof typeof people & string

const missingBuilding = 'Dieses Gebäude gibt es nicht oder nicht mehr.'
const missingClosure = 'Diese Schließzeit gibt es nicht oder nicht mehr.'

const christmas = { startsOn: '2026-12-24', endsOn: '2027-01-06', reason: 'Weihnachtsferien' }
const summer = { startsOn: '2027-07-27', endsOn: '2027-09-06', reason: 'Sommerferien' }

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: Person, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

interface Place {
  readonly property: string
  readonly building: string
}

/** A property with a building, made through the API by the technical management. */
async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id

  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '00001',
    city: 'Musterstadt',
    federalState: 'DE-BW',
    ...extra,
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Schulhaus',
    kinds: ['school'],
  })

  return { property, building }
}

/** A closure of a building, entered by the Objektleitung. */
async function closureOf(
  building: string,
  tenantId: TenantId = small,
  values: object = christmas,
): Promise<Record<string, unknown>> {
  const created = await http()
    .post(`/buildings/${building}/closures`)
    .set(testIdentityHeader, by('u-site', tenantId))
    .send(values)
    .expect(201)

  return created.body as Record<string, unknown>
}

/** The closures of a building one of the people reads, by their ids. */
async function readBy(
  userId: Person,
  building: string,
  tenantId: TenantId = small,
): Promise<readonly string[]> {
  const answer = await http()
    .get(`/buildings/${building}/closures`)
    .set(testIdentityHeader, by(userId, tenantId))
    .expect(200)

  return (answer.body as { id: string }[]).map((closure) => closure.id)
}

/** A closure as it stands in the database, whoever may see it. */
async function stored(id: unknown) {
  const { rows } = await admin.query<{
    area_id: string
    building_id: string
    deleted_at: string | null
    version: number
  }>(
    `select area_id, building_id, deleted_at::text as deleted_at, version
       from building_closures where id = $1`,
    [id],
  )

  return rows[0]
}

/** What a request was answered with: its status and its sentence. */
async function answered(sent: request.Test) {
  const answer = await sent

  return { status: answer.status, message: answer.body.message as string | undefined }
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

  // The large tenant has its two areas before anybody works for it, so that
  // it does not begin with the one a tenant gets with its first membership.
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

  // In the large tenant the Objektleitung and the Haustechnik work in the north.
  for (const userId of ['u-site', 'u-tech']) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [large, userId, north],
    )
  }

  onlyArea =
    (await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [small]))
      .rows[0]?.id ?? ''

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities)],
  }).compile()

  app = built.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('the times a building is closed', () => {
  it('are entered at their building, kept as a form hands them over, and read by everybody who sees it', async () => {
    const place = await placeIn()
    const created = await http()
      .post(`/buildings/${place.building}/closures`)
      .set(testIdentityHeader, by('u-site'))
      .send({ startsOn: '2026-12-24', endsOn: '2027-01-06', reason: '  Weihnachtsferien ' })
      .expect(201)

    // Trimmed. Property and area are those of the building.
    expect(created.body).toMatchObject({
      buildingId: place.building,
      propertyId: place.property,
      areaId: onlyArea,
      startsOn: '2026-12-24',
      endsOn: '2027-01-06',
      reason: 'Weihnachtsferien',
      deletedAt: null,
      version: 1,
    })

    for (const person of Object.keys(people)) {
      expect(await readBy(person, place.building)).toEqual([created.body.id])
    }
  })

  it('say on request what for, and a reason left empty is none', async () => {
    const place = await placeIn()

    for (const reason of ['', '   ', null, undefined]) {
      const created = await closureOf(place.building, small, {
        startsOn: '2026-10-26',
        endsOn: '2026-10-30',
        reason,
      })

      expect(created['reason']).toBeNull()
    }
  })

  it('may be a single day', async () => {
    const place = await placeIn()
    const created = await closureOf(place.building, small, {
      startsOn: '2026-10-30',
      endsOn: '2026-10-30',
    })

    expect(created).toMatchObject({ startsOn: '2026-10-30', endsOn: '2026-10-30' })
  })

  /**
   * By the first day, and of two that begin together the one that ends first.
   * They are entered so that neither the order they were entered in nor the
   * order of their last days is the order of the calendar: the one that ends
   * later comes in before the one it begins with, and the one that begins
   * first of all ends last of all and comes in last.
   */
  it('are read in the order of the calendar, whatever order they were entered in', async () => {
    const place = await placeIn()
    const late = await closureOf(place.building, small, summer)
    const longer = await closureOf(place.building, small, {
      startsOn: '2026-12-24',
      endsOn: '2027-02-28',
      reason: 'Dachsanierung',
    })
    const early = await closureOf(place.building, small, christmas)
    const first = await closureOf(place.building, small, {
      startsOn: '2026-11-02',
      endsOn: '2027-10-29',
      reason: 'Umbau der Aula',
    })

    expect(await readBy('u-tech', place.building)).toEqual([
      first['id'],
      early['id'],
      longer['id'],
      late['id'],
    ])
  })

  /** The sentences of the model in `domain`, which the form says as well. */
  it('are refused with a sentence when a day is missing, is none or the last lies before the first', async () => {
    const place = await placeIn()
    const refused = (body: object) =>
      answered(
        http()
          .post(`/buildings/${place.building}/closures`)
          .set(testIdentityHeader, by('u-site'))
          .send(body),
      )

    expect({
      nothing: await refused({}),
      withoutTheLast: await refused({ startsOn: '2026-12-24' }),
      emptied: await refused({ startsOn: '', endsOn: '2027-01-06' }),
      written: await refused({ startsOn: '24.12.2026', endsOn: '2027-01-06' }),
      noDay: await refused({ startsOn: '2026-12-24', endsOn: '2026-12-32' }),
      backwards: await refused({ startsOn: '2027-01-06', endsOn: '2026-12-24' }),
      tooLong: await refused({ ...christmas, reason: 'x'.repeat(closureLimits.reason + 1) }),
    }).toEqual({
      nothing: { status: 400, message: 'Der erste Tag fehlt.' },
      withoutTheLast: { status: 400, message: 'Der letzte Tag fehlt.' },
      emptied: { status: 400, message: 'Der erste Tag fehlt.' },
      written: { status: 400, message: 'Der erste Tag ist ein Tag, geschrieben 2026-10-03.' },
      noDay: { status: 400, message: 'Der letzte Tag ist ein Tag, geschrieben 2026-10-03.' },
      backwards: { status: 400, message: 'Der letzte Tag liegt vor dem ersten.' },
      tooLong: { status: 400, message: 'Der Anlass hat höchstens 80 Zeichen.' },
    })

    expect(await readBy('u-site', place.building)).toEqual([])
  })

  it('take nothing but their days and their reason from a request', async () => {
    const place = await placeIn()
    const beside = await placeIn()
    const created = await closureOf(place.building, small, {
      ...christmas,
      buildingId: beside.building,
      propertyId: beside.property,
      areaId: randomUUID(),
      version: 7,
      deletedAt: '2026-01-01T00:00:00Z',
    })

    expect(created).toMatchObject({
      buildingId: place.building,
      propertyId: place.property,
      areaId: onlyArea,
      version: 1,
      deletedAt: null,
    })
  })

  it('are not there at a building that is not there, whichever way it is missing', async () => {
    const gone = await placeIn()
    const elsewhere = await placeIn(large, { areaId: north })

    await http()
      .delete(`/buildings/${gone.building}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    const missing = { status: 404, message: missingBuilding }
    const outcome: Record<string, unknown> = {}

    for (const [name, building] of Object.entries({
      unknown: randomUUID(),
      noId: 'Schulhaus',
      ofAnotherTenant: elsewhere.building,
      removed: gone.building,
    })) {
      const path = `/buildings/${building}/closures`
      const header = by('u-site')

      outcome[name] = [
        await answered(http().get(path).set(testIdentityHeader, header)),
        await answered(http().post(path).set(testIdentityHeader, header).send(christmas)),
        await answered(http().delete(`${path}/${randomUUID()}`).set(testIdentityHeader, header)),
      ]
    }

    expect(outcome).toEqual({
      unknown: [missing, missing, missing],
      noId: [missing, missing, missing],
      ofAnotherTenant: [missing, missing, missing],
      removed: [missing, missing, missing],
    })
  })
})

describe('a closure that is removed', () => {
  it('is marked and stays in the database, is read no more, and is not there a second time', async () => {
    const place = await placeIn()
    const closure = await closureOf(place.building)
    const staying = await closureOf(place.building, small, summer)
    const path = `/buildings/${place.building}/closures/${String(closure['id'])}`

    const removed = await http().delete(path).set(testIdentityHeader, by('u-site')).expect(200)

    expect(removed.body).toMatchObject({ id: closure['id'], version: 2 })
    expect(removed.body.deletedAt).not.toBeNull()
    expect((await stored(closure['id']))?.deleted_at).not.toBeNull()
    expect(await readBy('u-tech', place.building)).toEqual([staying['id']])

    expect(await answered(http().delete(path).set(testIdentityHeader, by('u-site')))).toEqual({
      status: 404,
      message: missingClosure,
    })
  })

  it('is one of the building the request names: one of another building stays', async () => {
    const place = await placeIn()
    const beside = await placeIn()
    const theirs = await closureOf(beside.building)
    const missing = { status: 404, message: missingClosure }

    expect({
      ofTheBuildingBeside: await answered(
        http()
          .delete(`/buildings/${place.building}/closures/${String(theirs['id'])}`)
          .set(testIdentityHeader, by('u-site')),
      ),
      unknown: await answered(
        http()
          .delete(`/buildings/${place.building}/closures/${randomUUID()}`)
          .set(testIdentityHeader, by('u-site')),
      ),
      noId: await answered(
        http()
          .delete(`/buildings/${place.building}/closures/Weihnachtsferien`)
          .set(testIdentityHeader, by('u-site')),
      ),
    }).toEqual({ ofTheBuildingBeside: missing, unknown: missing, noId: missing })

    expect(await stored(theirs['id'])).toMatchObject({ deleted_at: null, version: 1 })
  })

  /** One entered wrongly is removed and entered again: there is no route that changes one. */
  it('is the only way to correct one', async () => {
    const place = await placeIn()
    const closure = await closureOf(place.building)
    const path = `/buildings/${place.building}/closures/${String(closure['id'])}`

    for (const change of [
      () => http().patch(path).set(testIdentityHeader, by('u-lead')).send({ endsOn: '2027-01-08' }),
      () => http().put(path).set(testIdentityHeader, by('u-lead')).send(summer),
    ]) {
      expect((await change()).status).toBe(404)
    }

    expect(await stored(closure['id'])).toMatchObject({ deleted_at: null, version: 1 })
  })
})

describe('the rights to the times a building is closed', () => {
  /**
   * Section 7 of the concept: every role sees the buildings, and whoever plans
   * and hands out activities enters the closures, the Objektleitung too, which
   * does not keep the building itself.
   */
  it('let whoever plans the activities enter and remove them, and everybody read them', async () => {
    const place = await placeIn()
    const path = `/buildings/${place.building}/closures`
    const outcome: Record<string, unknown> = {}

    for (const person of Object.keys(people)) {
      const header = by(person)
      const added = await http().post(path).set(testIdentityHeader, header).send(christmas)
      const target =
        added.status === 201
          ? (added.body.id as string)
          : String((await closureOf(place.building))['id'])

      outcome[person] = {
        reads: (await http().get(path).set(testIdentityHeader, header)).status,
        adds: added.status,
        removes: (await http().delete(`${path}/${target}`).set(testIdentityHeader, header)).status,
      }
    }

    expect(outcome).toEqual({
      'u-lead': { reads: 200, adds: 201, removes: 200 },
      'u-duties': { reads: 200, adds: 201, removes: 200 },
      'u-site': { reads: 200, adds: 201, removes: 200 },
      'u-tech': { reads: 200, adds: 403, removes: 403 },
    })

    // The refusal names the right, and the Objektleitung may not change the building for it.
    await http()
      .post(path)
      .set(testIdentityHeader, by('u-tech'))
      .send(christmas)
      .expect(403)
      .expect((answer) => expect(answer.body.message).toBe(missingRight('activity.write')))
    await http()
      .patch(`/buildings/${place.building}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ name: 'Altbau' })
      .expect(403)
  })
})

describe('the closures of the buildings of a tenant with two areas', () => {
  /**
   * The routes ask for nothing by area; the database answers with the areas
   * of the person. And no request says where a closure lies: the area is read
   * from the building.
   */
  it('lie in the area of their building and are there for whoever works in it', async () => {
    const inNorth = await placeIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await placeIn(large, { areaId: south, name: 'Campus Süd' })
    const northern = await closureOf(inNorth.building, large)
    // The Objektleitung works in the north; the south is entered by the Leitung.
    const southern = (
      await http()
        .post(`/buildings/${inSouth.building}/closures`)
        .set(testIdentityHeader, by('u-lead', large))
        .send(summer)
        .expect(201)
    ).body as Record<string, unknown>

    expect(northern['areaId']).toBe(north)
    expect(southern['areaId']).toBe(south)

    expect(await readBy('u-tech', inNorth.building, large)).toEqual([northern['id']])
    expect(await readBy('u-lead', inSouth.building, large)).toEqual([southern['id']])

    // For whoever works in the north the building in the south is not there,
    // and neither is anything about it.
    const missing = { status: 404, message: missingBuilding }
    const path = `/buildings/${inSouth.building}/closures`

    expect({
      theTechnicianReads: await answered(
        http().get(path).set(testIdentityHeader, by('u-tech', large)),
      ),
      theObjektleitungReads: await answered(
        http().get(path).set(testIdentityHeader, by('u-site', large)),
      ),
      theObjektleitungEnters: await answered(
        http().post(path).set(testIdentityHeader, by('u-site', large)).send(christmas),
      ),
      theObjektleitungRemoves: await answered(
        http()
          .delete(`${path}/${String(southern['id'])}`)
          .set(testIdentityHeader, by('u-site', large)),
      ),
    }).toEqual({
      theTechnicianReads: missing,
      theObjektleitungReads: missing,
      theObjektleitungEnters: missing,
      theObjektleitungRemoves: missing,
    })

    expect(await stored(southern['id'])).toMatchObject({ deleted_at: null, version: 1 })
    expect(await readBy('u-lead', inSouth.building, large)).toEqual([southern['id']])
  })

  /** A closure of the south is not removed through a building of the north either. */
  it('are not reached through a building of the own area', async () => {
    const inNorth = await placeIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await placeIn(large, { areaId: south, name: 'Campus Süd' })
    const southern = (
      await http()
        .post(`/buildings/${inSouth.building}/closures`)
        .set(testIdentityHeader, by('u-lead', large))
        .send(summer)
        .expect(201)
    ).body as Record<string, unknown>

    expect(
      await answered(
        http()
          .delete(`/buildings/${inNorth.building}/closures/${String(southern['id'])}`)
          .set(testIdentityHeader, by('u-site', large)),
      ),
    ).toEqual({ status: 404, message: missingClosure })
    expect(await stored(southern['id'])).toMatchObject({ deleted_at: null, version: 1 })
  })

  it('follow their property into another area', async () => {
    const place = await placeIn(large, { areaId: north, name: 'Campus Ost' })
    const closure = await closureOf(place.building, large)

    expect(await readBy('u-tech', place.building, large)).toEqual([closure['id']])

    await http()
      .patch(`/properties/${place.property}`)
      .set(testIdentityHeader, by('u-lead', large))
      .send({ areaId: south })
      .expect(200)

    expect(await stored(closure['id'])).toMatchObject({ area_id: south, version: 2 })
    expect(
      await answered(
        http()
          .get(`/buildings/${place.building}/closures`)
          .set(testIdentityHeader, by('u-tech', large)),
      ),
    ).toEqual({ status: 404, message: missingBuilding })
    expect(await readBy('u-lead', place.building, large)).toEqual([closure['id']])
  })
})

describe('the change log of a tenant', () => {
  /**
   * A closure has no name of its own. The log calls it by what it is for, and
   * by its first day where it says nothing (`titles` of the vocabulary).
   */
  it('calls a closure by what it is for, and by its first day where it says nothing', async () => {
    const place = await placeIn()
    const named = await closureOf(place.building)
    const unnamed = await closureOf(place.building, small, {
      startsOn: '2026-10-30',
      endsOn: '2026-10-30',
    })

    const answer = await http()
      .get('/audit/changes?table=building_closures')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const { changes, titles } = answer.body as AuditPage

    expect(changes.map((change) => change.recordId)).toEqual(
      expect.arrayContaining([named['id'], unnamed['id']]),
    )
    expect(titles[String(named['id'])]?.title).toBe('Weihnachtsferien')
    expect(titles[String(unnamed['id'])]?.title).toBe('2026-10-30')
  })
})

describe('the change log of a building', () => {
  /**
   * The office sees and changes the closures on the page of the building, so
   * the log opened from that page takes them in (`parts` of the vocabulary):
   * who entered the holidays belongs to what happened to the building.
   */
  it('takes in what happened to the times it is closed, and to those of no other building', async () => {
    const place = await placeIn()
    const beside = await placeIn()
    const closure = await closureOf(place.building)
    const other = await closureOf(beside.building)

    await http()
      .delete(`/buildings/${place.building}/closures/${String(closure['id'])}`)
      .set(testIdentityHeader, by('u-site'))
      .expect(200)

    const answer = await http()
      .get(`/audit/changes?table=buildings&record=${place.building}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const { changes } = answer.body as AuditPage
    const about = (table: string) =>
      changes.filter((change) => change.table === table).map((change) => change.recordId)

    expect(about('buildings')).toEqual([place.building])
    // Entered and removed: two changes of the one closure.
    expect(about('building_closures')).toEqual([closure['id'], closure['id']])
    expect(about('building_closures')).not.toContain(other['id'])
    // The property the building stands on is a record of its own.
    expect(about('properties')).toEqual([])
  })
})

describe('the closures of a building that is removed', () => {
  async function deletedAt(table: string, id: string): Promise<string | null> {
    const { rows } = await admin.query<{ at: string | null }>(
      `select deleted_at::text as at from ${table} where id = $1`,
      [id],
    )

    return rows[0]?.at ?? null
  }

  it('go with it, at the same moment, and none of the building beside it', async () => {
    const doomed = await placeIn()
    const beside = await placeIn()
    const first = await closureOf(doomed.building)
    const second = await closureOf(doomed.building, small, summer)
    const neighbour = await closureOf(beside.building)

    await http()
      .delete(`/buildings/${doomed.building}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    const moment = await deletedAt('buildings', doomed.building)

    expect(moment).not.toBeNull()
    expect((await stored(first['id']))?.deleted_at).toBe(moment)
    expect((await stored(second['id']))?.deleted_at).toBe(moment)
    expect((await stored(neighbour['id']))?.deleted_at).toBeNull()
    expect(await readBy('u-lead', beside.building)).toEqual([neighbour['id']])
  })

  it('go with it when it goes with its property', async () => {
    const doomed = await placeIn()
    const closure = await closureOf(doomed.building)

    await http()
      .delete(`/properties/${doomed.property}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    const moment = await deletedAt('properties', doomed.property)

    expect(moment).not.toBeNull()
    expect((await stored(closure['id']))?.deleted_at).toBe(moment)
  })
})
