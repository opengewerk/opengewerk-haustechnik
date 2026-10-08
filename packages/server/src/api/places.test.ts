import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type AuditPage,
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
 * The routes of the place (#18): a property, its buildings, their floors and
 * the rooms on a floor, created, changed, moved and deleted through the API,
 * by the roles section 7 of the concept gives each right, and only in the
 * areas of the person asking.
 *
 * The people are members of their tenant in the database: what somebody sees
 * of the place the database reads from their membership, whatever the header
 * of a request says.
 */

/** One area, as most tenants have it: everybody works in it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

const property = {
  name: 'Wohnanlage Nordstraße',
  street: 'Nordstraße 12',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  federalState: 'DE-BW',
}

/** A property with a building, a floor and a room on it, made through the API. */
async function wholePlace(tenantId: TenantId = small, extra: Record<string, unknown> = {}) {
  const created = await http()
    .post('/properties')
    .set(testIdentityHeader, by('u-duties', tenantId))
    .send({ ...property, ...extra })
    .expect(201)
  const building = await http()
    .post(`/properties/${created.body.id}/buildings`)
    .set(testIdentityHeader, by('u-duties', tenantId))
    .send({ name: 'Haus A', shortCode: 'A', kinds: ['school', 'assembly'], yearBuilt: 1972 })
    .expect(201)
  const floor = await http()
    .post(`/buildings/${building.body.id}/floors`)
    .set(testIdentityHeader, by('u-duties', tenantId))
    .send({ name: 'Erdgeschoss', level: 0 })
    .expect(201)
  const room = await http()
    .post(`/floors/${floor.body.id}/rooms`)
    .set(testIdentityHeader, by('u-duties', tenantId))
    .send({ number: ' 0.01 ', name: 'Aula', use: '' })
    .expect(201)

  return {
    property: created.body as Record<string, unknown>,
    building: building.body as Record<string, unknown>,
    floor: floor.body as Record<string, unknown>,
    room: room.body as Record<string, unknown>,
  }
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

  // In the large tenant the technician works in the north.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-tech',
    north,
  ])

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

describe('a place', () => {
  it('is built from the property down to the room, and read back level by level', async () => {
    const place = await wholePlace()
    const { rows } = await admin.query<{ id: string }>(
      'select id from areas where tenant_id = $1',
      [small],
    )

    // A small tenant names no area: the property goes into its one.
    expect(place.property).toMatchObject({ ...property, areaId: rows[0]?.id, version: 1 })
    expect(place.building).toMatchObject({
      propertyId: place.property['id'],
      areaId: rows[0]?.id,
      kinds: ['school', 'assembly'],
      shortCode: 'A',
      yearBuilt: 1972,
    })
    expect(place.floor).toMatchObject({
      buildingId: place.building['id'],
      propertyId: place.property['id'],
      level: 0,
    })
    // Trimmed, and an empty text is no text.
    expect(place.room).toMatchObject({
      floorId: place.floor['id'],
      buildingId: place.building['id'],
      propertyId: place.property['id'],
      number: '0.01',
      name: 'Aula',
      use: null,
    })

    const header = by('u-tech')

    await http()
      .get(`/rooms/${String(place.room['id'])}`)
      .set(testIdentityHeader, header)
      .expect(200)
      .expect((answer) => expect(answer.body.name).toBe('Aula'))
    await http()
      .get(`/floors/${String(place.floor['id'])}/rooms`)
      .set(testIdentityHeader, header)
      .expect(200)
      .expect((answer) =>
        expect(answer.body.map((room: { id: string }) => room.id)).toEqual([place.room['id']]),
      )
    await http()
      .get(`/buildings/${String(place.building['id'])}/floors`)
      .set(testIdentityHeader, header)
      .expect(200)
      .expect((answer) => expect(answer.body).toHaveLength(1))
    await http()
      .get(`/properties/${String(place.property['id'])}/buildings`)
      .set(testIdentityHeader, header)
      .expect(200)
      .expect((answer) => expect(answer.body).toHaveLength(1))
  })

  it('is changed level by level, and a room keeps a number or a name', async () => {
    const place = await wholePlace()

    await http()
      .patch(`/properties/${String(place.property['id'])}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ name: '  Campus Nord ' })
      .expect(200)
      .expect((answer) => expect(answer.body).toMatchObject({ name: 'Campus Nord', version: 2 }))
    await http()
      .patch(`/buildings/${String(place.building['id'])}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ kinds: ['school'], shortCode: '' })
      .expect(200)
      .expect((answer) => expect(answer.body).toMatchObject({ kinds: ['school'], shortCode: null }))
    await http()
      .patch(`/floors/${String(place.floor['id'])}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ level: -1, name: 'Untergeschoss' })
      .expect(200)
    await http()
      .patch(`/rooms/${String(place.room['id'])}`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ number: '' })
      .expect(200)
      .expect((answer) => expect(answer.body).toMatchObject({ number: null, name: 'Aula' }))

    // The name was all it had left.
    await http()
      .patch(`/rooms/${String(place.room['id'])}`)
      .set(testIdentityHeader, by('u-tech'))
      .send({ name: ' ' })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe('Ein Raum hat eine Nummer oder eine Bezeichnung.'),
      )
  })

  it('keeps a note at a property, with its line breaks and without its edges, and none once it is emptied', async () => {
    const without = await wholePlace()

    expect(without.property['note']).toBeNull()

    const note = 'Zufahrt über den Hof.\nSchlüssel beim Hausmeister.'
    const noted = await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-duties'))
      .send({ ...property, name: 'Campus Süd', note: `  ${note}\n` })
      .expect(201)

    expect(noted.body.note).toBe(note)

    // A form that sends its empty field makes a property without a note.
    await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-duties'))
      .send({ ...property, name: 'Campus West', note: ' ' })
      .expect(201)
      .expect((answer) => expect(answer.body.note).toBeNull())

    const id = String(noted.body.id)

    // A change of something else leaves the note where it is.
    await http()
      .patch(`/properties/${id}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ city: 'Beispielstadt' })
      .expect(200)
      .expect((answer) => expect(answer.body.note).toBe(note))
    await http()
      .patch(`/properties/${id}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ note: 'x'.repeat(2001) })
      .expect(400)
      .expect((answer) => expect(answer.body.message).toBe('Die Notiz hat höchstens 2000 Zeichen.'))
    // Emptied, it is no note, not an empty one.
    await http()
      .patch(`/properties/${id}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ note: '   ' })
      .expect(200)
      .expect((answer) => expect(answer.body.note).toBeNull())
    await http()
      .get(`/properties/${id}`)
      .set(testIdentityHeader, by('u-tech'))
      .expect(200)
      .expect((answer) => expect(answer.body.note).toBeNull())
  })

  it('is refused with the sentence of the model', async () => {
    await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-duties'))
      .send({ ...property, postalCode: '6853' })
      .expect(400)
      .expect((answer) => expect(answer.body.message).toBe('Die Postleitzahl hat fünf Ziffern.'))
    await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-duties'))
      .send({ ...property, name: ' ' })
      .expect(400)
      .expect((answer) => expect(answer.body.message).toBe('Der Name fehlt.'))

    const place = await wholePlace()

    await http()
      .post(`/properties/${String(place.property['id'])}/buildings`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ name: 'Haus B', kinds: [] })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe('Ein Gebäude hat mindestens eine Gebäudeart.'),
      )
  })

  it('moves a room to a floor of another building, and the room takes its building along', async () => {
    const place = await wholePlace()
    const other = await http()
      .post(`/properties/${String(place.property['id'])}/buildings`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ name: 'Haus B', kinds: ['office'] })
      .expect(201)
    const floor = await http()
      .post(`/buildings/${String(other.body.id)}/floors`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ name: '1. Obergeschoss', level: 1 })
      .expect(201)

    await http()
      .put(`/rooms/${String(place.room['id'])}/floor`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ floorId: floor.body.id })
      .expect(200)
      .expect((answer) =>
        expect(answer.body).toMatchObject({ floorId: floor.body.id, buildingId: other.body.id }),
      )
  })

  it('is deleted from any level, and what hangs below goes with it', async () => {
    const place = await wholePlace()

    await http()
      .delete(`/properties/${String(place.property['id'])}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    for (const path of [
      `/properties/${String(place.property['id'])}`,
      `/buildings/${String(place.building['id'])}`,
      `/floors/${String(place.floor['id'])}`,
      `/rooms/${String(place.room['id'])}`,
    ]) {
      await http().get(path).set(testIdentityHeader, by('u-duties')).expect(404)
    }

    await http()
      .get('/properties')
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
      .expect((answer) =>
        expect(answer.body.map((one: { id: string }) => one.id)).not.toContain(
          place.property['id'],
        ),
      )
  })

  it('is not found under an id that is no id', async () => {
    await http()
      .get('/rooms/not-an-id')
      .set(testIdentityHeader, by('u-tech'))
      .expect(404)
      .expect((answer) =>
        expect(answer.body.message).toBe('Diesen Raum gibt es nicht oder nicht mehr.'),
      )
  })
})

describe('the rights to the place', () => {
  /**
   * Section 7 of the concept: whoever works on site records rooms and keeps
   * what is known about them, the structure is kept by those who see every
   * area. The refusal names what the access may not do.
   */
  it('let each role do what section 7 gives it, and no more', async () => {
    const place = await wholePlace()
    const roomId = String(place.room['id'])
    const outcome = {
      technicianAddsProperty: (
        await http().post('/properties').set(testIdentityHeader, by('u-tech')).send(property)
      ).status,
      technicianAddsRoom: (
        await http()
          .post(`/floors/${String(place.floor['id'])}/rooms`)
          .set(testIdentityHeader, by('u-tech'))
          .send({ name: 'Technikraum' })
      ).status,
      technicianChangesRoom: (
        await http()
          .patch(`/rooms/${roomId}`)
          .set(testIdentityHeader, by('u-tech'))
          .send({ use: 'Veranstaltungen' })
      ).status,
      technicianMovesRoom: (
        await http()
          .put(`/rooms/${roomId}/floor`)
          .set(testIdentityHeader, by('u-tech'))
          .send({ floorId: place.floor['id'] })
      ).status,
      technicianRemovesRoom: (
        await http().delete(`/rooms/${roomId}`).set(testIdentityHeader, by('u-tech'))
      ).status,
      siteManagementAddsBuilding: (
        await http()
          .post(`/properties/${String(place.property['id'])}/buildings`)
          .set(testIdentityHeader, by('u-site'))
          .send({ name: 'Haus C', kinds: ['garage'] })
      ).status,
      technicalManagementMovesRoom: (
        await http()
          .put(`/rooms/${roomId}/floor`)
          .set(testIdentityHeader, by('u-duties'))
          .send({ floorId: place.floor['id'] })
      ).status,
    }

    expect(outcome).toEqual({
      technicianAddsProperty: 403,
      technicianAddsRoom: 201,
      technicianChangesRoom: 200,
      technicianMovesRoom: 403,
      technicianRemovesRoom: 403,
      siteManagementAddsBuilding: 403,
      technicalManagementMovesRoom: 200,
    })

    await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-tech'))
      .send(property)
      .expect(403)
      .expect((answer) => expect(answer.body.message).toBe(missingRight('location.write')))
  })
})

describe('the place of a tenant with two areas', () => {
  it('asks for an area, and takes only one of the tenant', async () => {
    await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-lead', large))
      .send(property)
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe(
          'Der Bereich fehlt. Dieser Betreiber hat mehrere, die Liegenschaft nennt einen davon.',
        ),
      )

    const { rows } = await admin.query<{ id: string }>(
      'select id from areas where tenant_id = $1',
      [small],
    )

    await http()
      .post('/properties')
      .set(testIdentityHeader, by('u-lead', large))
      .send({ ...property, areaId: rows[0]?.id })
      .expect(400)
      .expect((answer) =>
        expect(answer.body.message).toBe('Den Bereich gibt es bei diesem Betreiber nicht.'),
      )
  })

  /**
   * The routes ask for nothing by area; the database answers with the areas
   * of the person. The technician of the north lists the north, and a
   * property of the south is not there for them.
   */
  it('shows each person the places of their areas', async () => {
    const inNorth = await wholePlace(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await wholePlace(large, { areaId: south, name: 'Campus Süd' })

    await http()
      .get('/properties')
      .set(testIdentityHeader, by('u-tech', large))
      .expect(200)
      .expect((answer) =>
        expect(answer.body.map((one: { name: string }) => one.name)).toEqual(['Campus Nord']),
      )
    await http()
      .get(`/properties/${String(inSouth.property['id'])}`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(404)
    await http()
      .get(`/rooms/${String(inNorth.room['id'])}`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(200)

    // Whoever sees every area lists both.
    await http()
      .get('/properties')
      .set(testIdentityHeader, by('u-duties', large))
      .expect(200)
      .expect((answer) =>
        expect(answer.body.map((one: { name: string }) => one.name)).toEqual([
          'Campus Nord',
          'Campus Süd',
        ]),
      )
  })

  it('moves a property to another area with everything below it', async () => {
    const place = await wholePlace(large, { areaId: north, name: 'Campus Ost' })

    await http()
      .patch(`/properties/${String(place.property['id'])}`)
      .set(testIdentityHeader, by('u-lead', large))
      .send({ areaId: south })
      .expect(200)

    // The technician of the north does not find the room any more.
    await http()
      .get(`/rooms/${String(place.room['id'])}`)
      .set(testIdentityHeader, by('u-tech', large))
      .expect(404)
    await http()
      .get(`/rooms/${String(place.room['id'])}`)
      .set(testIdentityHeader, by('u-lead', large))
      .expect(200)
      .expect((answer) => expect(answer.body.areaId).toBe(south))
  })
})

describe('the change log of a place', () => {
  /**
   * A building, a floor and a room each have a page in the office, and the
   * log is opened from it (`records` of the vocabulary). It shows what
   * happened to that record: the one above and the ones below are records of
   * their own, each with a log of its own.
   */
  it('is opened from a building, a floor and a room, each for itself', async () => {
    const place = await wholePlace()
    const idOf = (record: Record<string, unknown>) => String(record['id'])

    await http()
      .patch(`/rooms/${idOf(place.room)}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ use: 'Veranstaltungen' })
      .expect(200)

    const logOf = async (table: string, record: Record<string, unknown>) => {
      const answer = await http()
        .get(`/audit/changes?table=${table}&record=${idOf(record)}`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(200)

      return (answer.body as AuditPage).changes.map((change) => [change.table, change.recordId])
    }

    expect(await logOf('buildings', place.building)).toEqual([['buildings', idOf(place.building)]])
    expect(await logOf('floors', place.floor)).toEqual([['floors', idOf(place.floor)]])
    // Made and changed.
    expect(await logOf('rooms', place.room)).toEqual([
      ['rooms', idOf(place.room)],
      ['rooms', idOf(place.room)],
    ])
  })
})
