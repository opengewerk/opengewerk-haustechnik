import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type AuditPage,
  contactLimits,
  missingRight,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
  testIdentityHeader,
} from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The people to talk to at a property (#85, section 4.1 of the concept), on
 * the routes of the foundation as this application binds them: a contact
 * hangs on a property and lies in the area of it, whoever sees the properties
 * reads their contacts, and whoever keeps the properties keeps them.
 *
 * The people are members of their tenant in the database: what somebody sees
 * the database reads from their membership, whatever the header of a request
 * says.
 */

/** One area, as most tenants have it: everybody works in it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; the technician works in the north. */
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

const missingProperty = 'Diese Liegenschaft gibt es nicht oder nicht mehr.'
const missingContact = 'Diesen Ansprechpartner gibt es nicht oder nicht mehr.'
const withoutProperty = 'Ein Ansprechpartner gehört zu einer Liegenschaft, dieser zu keiner.'

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

/** A property, made through the API by the technical management. */
async function propertyIn(tenantId: TenantId = small, extra: object = {}): Promise<string> {
  const created = await http()
    .post('/properties')
    .set(testIdentityHeader, by('u-duties', tenantId))
    .send({
      name: 'Schulzentrum Am Neckar',
      street: 'Neckarstraße 4',
      postalCode: '00001',
      city: 'Musterstadt',
      federalState: 'DE-BW',
      ...extra,
    })
    .expect(201)

  return created.body.id as string
}

/** A contact at a property, added by the technical management. */
async function contactAt(
  propertyId: string,
  tenantId: TenantId = small,
  texts: object = {},
): Promise<Record<string, unknown>> {
  const created = await http()
    .post('/contacts')
    .set(testIdentityHeader, by('u-duties', tenantId))
    .send({ propertyId, familyName: 'Becker', role: 'Hausmeister', ...texts })
    .expect(201)

  return created.body as Record<string, unknown>
}

/** The contacts one of the people reads, by their ids. */
async function readBy(userId: Person, tenantId: TenantId = small): Promise<readonly string[]> {
  const answer = await http()
    .get('/contacts')
    .set(testIdentityHeader, by(userId, tenantId))
    .expect(200)

  return (answer.body as { id: string }[]).map((contact) => contact.id)
}

/** A contact as it stands in the database, whoever may see it. */
async function stored(id: unknown) {
  const { rows } = await admin.query<{
    area_id: string
    property_id: string
    deleted_at: string | null
    version: number
  }>(
    'select area_id, property_id, deleted_at::text as deleted_at, version from contacts where id = $1',
    [id],
  )

  return rows[0]
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

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

describe('the people to talk to at a property', () => {
  it('are added at their property, kept as a form hands them over, and read by everybody who sees the property', async () => {
    const propertyId = await propertyIn()
    const created = await http()
      .post('/contacts')
      .set(testIdentityHeader, by('u-duties'))
      .send({
        propertyId,
        givenName: ' Jens ',
        familyName: ' Becker ',
        role: 'Hausmeister',
        phone: '  0000 4471',
        email: '',
      })
      .expect(201)

    // Trimmed, and an optional text left empty is no text. The area is the
    // area of the property.
    expect(created.body).toMatchObject({
      propertyId,
      areaId: onlyArea,
      givenName: 'Jens',
      familyName: 'Becker',
      role: 'Hausmeister',
      phone: '0000 4471',
      email: null,
      version: 1,
      deletedAt: null,
    })

    // Every role sees the properties, and so the people to talk to there.
    for (const person of Object.keys(people)) {
      expect(await readBy(person), person).toContain(created.body.id)
    }
  })

  it('are refused with the sentence a form shows', async () => {
    const propertyId = await propertyIn()
    const refusal = async (body: object) => {
      const answer = await http()
        .post('/contacts')
        .set(testIdentityHeader, by('u-duties'))
        .send(body)
        .expect(400)

      return answer.body.message as string
    }
    const long = (limit: number) => 'x'.repeat(limit + 1)

    expect({
      withoutFamilyName: await refusal({ propertyId, givenName: 'Jens' }),
      familyNameOfSpaces: await refusal({ propertyId, familyName: '   ' }),
      givenNameTooLong: await refusal({
        propertyId,
        familyName: 'Becker',
        givenName: long(contactLimits.givenName),
      }),
      familyNameTooLong: await refusal({ propertyId, familyName: long(contactLimits.familyName) }),
      roleTooLong: await refusal({
        propertyId,
        familyName: 'Becker',
        role: long(contactLimits.role),
      }),
      phoneTooLong: await refusal({
        propertyId,
        familyName: 'Becker',
        phone: long(contactLimits.phone),
      }),
      emailTooLong: await refusal({
        propertyId,
        familyName: 'Becker',
        email: long(contactLimits.email),
      }),
      phoneAsANumber: await refusal({ propertyId, familyName: 'Becker', phone: 4471 }),
      atNoProperty: await refusal({ familyName: 'Becker' }),
      atAnEmptyProperty: await refusal({ propertyId: '', familyName: 'Becker' }),
    }).toEqual({
      withoutFamilyName: 'Der Nachname fehlt.',
      familyNameOfSpaces: 'Der Nachname fehlt.',
      givenNameTooLong: 'Der Vorname hat höchstens 80 Zeichen.',
      familyNameTooLong: 'Der Nachname hat höchstens 80 Zeichen.',
      roleTooLong: 'Die Funktion hat höchstens 80 Zeichen.',
      phoneTooLong: 'Die Telefonnummer hat höchstens 40 Zeichen.',
      emailTooLong: 'Die E-Mail-Adresse hat höchstens 254 Zeichen.',
      phoneAsANumber: 'Die Angaben zu einem Ansprechpartner sind Text.',
      atNoProperty: withoutProperty,
      atAnEmptyProperty: withoutProperty,
    })

    // What the form takes at its bound, the route and the table take.
    await contactAt(propertyId, small, {
      givenName: 'x'.repeat(contactLimits.givenName),
      familyName: 'x'.repeat(contactLimits.familyName),
      role: 'x'.repeat(contactLimits.role),
      phone: 'x'.repeat(contactLimits.phone),
      email: 'x'.repeat(contactLimits.email),
    })
  })

  /**
   * The property has to be there for whoever asks. One that never was, one of
   * another tenant and one that is marked are answered alike, so that the
   * answer says nothing about what is elsewhere.
   */
  it('are refused at a property that is not there for whoever asks, each the same way', async () => {
    const marked = await propertyIn()
    const ofTheOtherTenant = await propertyIn(large, { areaId: north })

    await http().delete(`/properties/${marked}`).set(testIdentityHeader, by('u-duties')).expect(200)

    const answer = async (propertyId: unknown) => {
      const refused = await http()
        .post('/contacts')
        .set(testIdentityHeader, by('u-duties'))
        .send({ propertyId, familyName: 'Becker' })

      return { status: refused.status, message: refused.body.message as string }
    }
    const refused = { status: 422, message: missingProperty }

    expect({
      neverThere: await answer(newId<'property'>()),
      noId: await answer('Schulzentrum'),
      notEvenText: await answer(4471),
      ofTheOtherTenant: await answer(ofTheOtherTenant),
      marked: await answer(marked),
    }).toEqual({
      neverThere: refused,
      noId: refused,
      notEvenText: refused,
      ofTheOtherTenant: refused,
      marked: refused,
    })
  })

  it('are corrected with the sentences of the form, and the property stays the one thing they hang on', async () => {
    const propertyId = await propertyIn()
    const contact = await contactAt(propertyId)
    const path = `/contacts/${String(contact['id'])}`
    const change = (body: object) =>
      http().patch(path).set(testIdentityHeader, by('u-duties')).send(body)

    const corrected = await change({ givenName: ' Jens ', phone: '0000 4471 ', role: '' }).expect(
      200,
    )

    expect(corrected.body).toMatchObject({
      givenName: 'Jens',
      familyName: 'Becker',
      phone: '0000 4471',
      role: null,
      propertyId,
      areaId: onlyArea,
      version: 2,
    })

    const refusal = async (body: object) => (await change(body).expect(400)).body.message as string

    expect({
      familyNameEmptied: await refusal({ familyName: '' }),
      roleTooLong: await refusal({ role: 'x'.repeat(contactLimits.role + 1) }),
      takenFromItsProperty: await refusal({ propertyId: null }),
      leftAtAnEmptyProperty: await refusal({ propertyId: '' }),
      nothingToChange: await refusal({ areaId: north }),
    }).toEqual({
      familyNameEmptied: 'Der Nachname fehlt.',
      roleTooLong: 'Die Funktion hat höchstens 80 Zeichen.',
      takenFromItsProperty: withoutProperty,
      leftAtAnEmptyProperty: withoutProperty,
      // The area is no field of a request: a change that names nothing else names nothing.
      nothingToChange: 'Die Anfrage enthält keine Änderung.',
    })

    // Nothing of what was refused was kept.
    expect(await stored(contact['id'])).toMatchObject({ version: 2, area_id: onlyArea })
  })

  it('are taken away by marking them, and a contact taken away is not there to correct or to take away again', async () => {
    const propertyId = await propertyIn()
    const contact = await contactAt(propertyId)
    const staying = await contactAt(propertyId, small, { familyName: 'Albers' })
    const path = `/contacts/${String(contact['id'])}`

    const removed = await http().delete(path).set(testIdentityHeader, by('u-duties')).expect(200)

    expect(removed.body.deletedAt).not.toBeNull()
    expect((await stored(contact['id']))?.deleted_at).not.toBeNull()

    const read = await readBy('u-tech')

    expect(read).not.toContain(contact['id'])
    expect(read).toContain(staying['id'])

    // One request after the other: each is sent only once the one before it has answered.
    for (const again of [
      () => http().delete(path).set(testIdentityHeader, by('u-duties')),
      () =>
        http().patch(path).set(testIdentityHeader, by('u-duties')).send({ role: 'Schulleitung' }),
      () => http().delete('/contacts/Becker').set(testIdentityHeader, by('u-duties')),
    ]) {
      const answer = await again()

      expect({ status: answer.status, message: answer.body.message }).toEqual({
        status: 404,
        message: missingContact,
      })
    }
  })
})

describe('the rights to the people at a property', () => {
  /**
   * Section 7 of the concept: every role sees the properties, and Leitung and
   * Technische Leitung keep them. The contacts follow the property, they have
   * no right of their own.
   */
  it('let whoever keeps the properties keep their contacts, and everybody else read them', async () => {
    const propertyId = await propertyIn()
    const contact = await contactAt(propertyId)
    const path = `/contacts/${String(contact['id'])}`
    const outcome: Record<string, unknown> = {}

    for (const person of Object.keys(people)) {
      const header = by(person)

      outcome[person] = {
        reads: (await http().get('/contacts').set(testIdentityHeader, header)).status,
        adds: (
          await http()
            .post('/contacts')
            .set(testIdentityHeader, header)
            .send({ propertyId, familyName: 'Albers' })
        ).status,
        corrects: (
          await http().patch(path).set(testIdentityHeader, header).send({ role: 'Schulleitung' })
        ).status,
      }
    }

    expect(outcome).toEqual({
      'u-lead': { reads: 200, adds: 201, corrects: 200 },
      'u-duties': { reads: 200, adds: 201, corrects: 200 },
      'u-site': { reads: 200, adds: 403, corrects: 403 },
      'u-tech': { reads: 200, adds: 403, corrects: 403 },
    })

    // Taking one away is refused the same way, and the refusal names the right.
    for (const person of ['u-site', 'u-tech']) {
      await http()
        .delete(path)
        .set(testIdentityHeader, by(person))
        .expect(403)
        .expect((answer) => expect(answer.body.message).toBe(missingRight('location.write')))
    }

    expect((await stored(contact['id']))?.deleted_at).toBeNull()
    await http().delete(path).set(testIdentityHeader, by('u-lead')).expect(200)
  })
})

describe('the people at the properties of a tenant with two areas', () => {
  /**
   * The routes ask for nothing by area; the database answers with the areas
   * of the person. And no request says where a contact lies: the area is
   * read from the property, whatever the body names.
   */
  it('lie in the area of their property and are there for whoever works in it', async () => {
    const inNorth = await propertyIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await propertyIn(large, { areaId: south, name: 'Campus Süd' })
    const northern = await contactAt(inNorth, large, { areaId: south })
    const southern = await contactAt(inSouth, large)

    expect(northern['areaId']).toBe(north)
    expect(southern['areaId']).toBe(south)

    const theirs = await readBy('u-tech', large)

    expect(theirs).toContain(northern['id'])
    expect(theirs).not.toContain(southern['id'])
    expect(await readBy('u-duties', large)).toEqual(
      expect.arrayContaining([northern['id'], southern['id']]),
    )
  })

  it('move to another property with a correction, into the area of that property', async () => {
    const inNorth = await propertyIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await propertyIn(large, { areaId: south, name: 'Campus Süd' })
    const contact = await contactAt(inNorth, large)
    const path = `/contacts/${String(contact['id'])}`

    const moved = await http()
      .patch(path)
      .set(testIdentityHeader, by('u-duties', large))
      .send({ propertyId: inSouth })
      .expect(200)

    expect(moved.body).toMatchObject({ propertyId: inSouth, areaId: south, version: 2 })
    expect(await readBy('u-tech', large)).not.toContain(contact['id'])

    // And to no property that is not there.
    await http()
      .patch(path)
      .set(testIdentityHeader, by('u-duties', large))
      .send({ propertyId: await propertyIn(small) })
      .expect(422)
      .expect((answer) => expect(answer.body.message).toBe(missingProperty))

    expect(await stored(contact['id'])).toMatchObject({ property_id: inSouth, area_id: south })
  })

  it('follow their property into another area', async () => {
    const propertyId = await propertyIn(large, { areaId: north, name: 'Campus Ost' })
    const contact = await contactAt(propertyId, large)

    expect(await readBy('u-tech', large)).toContain(contact['id'])

    await http()
      .patch(`/properties/${propertyId}`)
      .set(testIdentityHeader, by('u-lead', large))
      .send({ areaId: south })
      .expect(200)

    expect(await stored(contact['id'])).toMatchObject({ area_id: south, version: 2 })
    expect(await readBy('u-tech', large)).not.toContain(contact['id'])
    expect(await readBy('u-lead', large)).toContain(contact['id'])
  })

  /**
   * The roles that keep properties see every area today, so the right and the
   * area never part. An own role of phase 2 can have the right in the north
   * only; what then decides is the policy, as for every row with a place.
   * Here the technical management is, for once, held to the north.
   */
  it('are kept only in the areas of whoever asks, whatever the right says', async () => {
    const inNorth = await propertyIn(large, { areaId: north, name: 'Campus Nord' })
    const inSouth = await propertyIn(large, { areaId: south, name: 'Campus Süd' })
    const northern = await contactAt(inNorth, large)
    const southern = await contactAt(inSouth, large)
    const header = by('u-duties', large)

    await admin.query('delete from member_all_areas where tenant_id = $1 and user_id = $2', [
      large,
      'u-duties',
    ])
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [large, 'u-duties', north],
    )

    try {
      const status = async (sent: request.Test) => {
        const answer = await sent

        return { status: answer.status, message: answer.body.message as string | undefined }
      }

      expect({
        addsInTheSouth: await status(
          http()
            .post('/contacts')
            .set(testIdentityHeader, header)
            .send({ propertyId: inSouth, familyName: 'Albers' }),
        ),
        correctsInTheSouth: await status(
          http()
            .patch(`/contacts/${String(southern['id'])}`)
            .set(testIdentityHeader, header)
            .send({ role: 'Schulleitung' }),
        ),
        removesInTheSouth: await status(
          http()
            .delete(`/contacts/${String(southern['id'])}`)
            .set(testIdentityHeader, header),
        ),
        movesToTheSouth: await status(
          http()
            .patch(`/contacts/${String(northern['id'])}`)
            .set(testIdentityHeader, header)
            .send({ propertyId: inSouth }),
        ),
      }).toEqual({
        addsInTheSouth: { status: 422, message: missingProperty },
        correctsInTheSouth: { status: 404, message: missingContact },
        removesInTheSouth: { status: 404, message: missingContact },
        movesToTheSouth: { status: 422, message: missingProperty },
      })

      // In the north they keep them as before.
      await http()
        .patch(`/contacts/${String(northern['id'])}`)
        .set(testIdentityHeader, header)
        .send({ role: 'Schulleitung' })
        .expect(200)
      expect(await readBy('u-duties', large)).not.toContain(southern['id'])
    } finally {
      await admin.query('delete from member_areas where tenant_id = $1 and user_id = $2', [
        large,
        'u-duties',
      ])
      await admin.query('insert into member_all_areas (tenant_id, user_id) values ($1, $2)', [
        large,
        'u-duties',
      ])
    }

    expect(await stored(southern['id'])).toMatchObject({ deleted_at: null, version: 1 })
    expect(await stored(northern['id'])).toMatchObject({ property_id: inNorth, area_id: north })
  })
})

describe('the people at a property that is removed', () => {
  it('go with it, at the same moment, and nobody else does', async () => {
    const doomed = await propertyIn()
    const beside = await propertyIn()
    const caretaker = await contactAt(doomed)
    const head = await contactAt(doomed, small, { familyName: 'Albers', role: 'Schulleitung' })
    const neighbour = await contactAt(beside)

    await http().delete(`/properties/${doomed}`).set(testIdentityHeader, by('u-duties')).expect(200)

    const { rows } = await admin.query<{ at: string | null }>(
      'select deleted_at::text as at from properties where id = $1',
      [doomed],
    )
    const moment = rows[0]?.at

    expect(moment).not.toBeNull()
    expect((await stored(caretaker['id']))?.deleted_at).toBe(moment)
    expect((await stored(head['id']))?.deleted_at).toBe(moment)
    expect((await stored(neighbour['id']))?.deleted_at).toBeNull()

    const read = await readBy('u-lead')

    expect(read).not.toContain(caretaker['id'])
    expect(read).not.toContain(head['id'])
    expect(read).toContain(neighbour['id'])
  })
})

describe('the change log of a property', () => {
  /**
   * The office sees and changes the contacts on the page of the property, so
   * the log opened from that page takes them in (`parts` of the vocabulary):
   * who added the caretaker belongs to what happened to the property.
   */
  it('takes in what happened to the people to talk to there, and to nobody else', async () => {
    const propertyId = await propertyIn()
    const elsewhere = await propertyIn()
    const contact = await contactAt(propertyId)
    const other = await contactAt(elsewhere)

    await http()
      .patch(`/contacts/${String(contact['id'])}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ phone: '0000 4471' })
      .expect(200)

    const answer = await http()
      .get(`/audit/changes?table=properties&record=${propertyId}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const { changes, titles } = answer.body as AuditPage
    const about = (table: string) =>
      changes.filter((change) => change.table === table).map((change) => change.recordId)

    expect(about('properties')).toEqual([propertyId])
    expect(new Set(about('contacts'))).toEqual(new Set([contact['id']]))
    expect(about('contacts')).toHaveLength(2)
    expect(about('contacts')).not.toContain(other['id'])
    // And the log calls the contact by its name, as the foundation names one.
    expect(titles[String(contact['id'])]?.title).toBe('Becker')
  })
})
