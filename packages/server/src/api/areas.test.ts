import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  everyAreaSentence,
  missingRight,
  type Right,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, fingerprintOf, newId } from '@opengewerk/platform-server'
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The areas of a tenant through the API (#84): which there are, who holds in
 * which, and who stands in for whom. Section 7 of the concept gives all of it
 * to the Leitung; everybody who sees places reads the areas they hold in.
 *
 * The people are members of their tenant in the database: what somebody sees
 * the database reads from their membership and their areas, whatever the
 * header of a request says.
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas to begin with, north and south. */
const large = newId<'tenant'>() as TenantId
/** The tenant next door, with an area and a person of its own. */
const nextDoor = newId<'tenant'>() as TenantId

let north = ''
let south = ''
let theirs = ''

const people = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Murat Yilmaz' },
  'u-south': { role: 'technician', name: 'Tobias Wendt' },
  'u-gone': { role: 'technician', name: 'Lena Vogt' },
} as const satisfies Readonly<Record<string, { role: RoleKey; name: string }>>

type Person = keyof typeof people

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: Person, tenantId: TenantId = large): string {
  return as(tenantId, userId, people[userId].role)
}

const today = dayInGermany()

/** A day so many days from today, as the calendar writes it. */
function day(offset: number): string {
  const moment = new Date(`${today}T12:00:00Z`)

  moment.setUTCDate(moment.getUTCDate() + offset)

  return moment.toISOString().slice(0, 10)
}

let counter = 0

/** A property with a building on it, made through the API by whoever sees every area. */
async function propertyIn(areaId: string, name = `Liegenschaft ${String((counter += 1))}`) {
  const created = await http()
    .post('/properties')
    .set(testIdentityHeader, by('u-duties'))
    .send({
      name,
      street: 'Musterweg 1',
      postalCode: '00001',
      city: 'Beispielstadt',
      federalState: 'DE-BW',
      areaId,
    })
    .expect(201)
  const building = await http()
    .post(`/properties/${created.body.id as string}/buildings`)
    .set(testIdentityHeader, by('u-duties'))
    .send({ name: 'Haus A', kinds: ['office'] })
    .expect(201)

  return { id: created.body.id as string, name, buildingId: building.body.id as string }
}

/** An area made through the API by the Leitung. */
async function areaNamed(name: string): Promise<string> {
  const created = await http()
    .post('/areas')
    .set(testIdentityHeader, by('u-lead'))
    .send({ name })
    .expect(201)

  return created.body.id as string
}

/** The names of the properties somebody sees. */
async function seenBy(userId: Person): Promise<string[]> {
  const answer = await http().get('/properties').set(testIdentityHeader, by(userId)).expect(200)

  return (answer.body as { name: string }[]).map((property) => property.name)
}

/** The areas somebody holds in, as the list of who works for the tenant names them. */
async function areasOf(userId: Person) {
  const answer = await http()
    .get('/areas/members')
    .set(testIdentityHeader, by('u-lead'))
    .expect(200)

  return (answer.body as { userId: string; all: boolean; areaIds: string[] }[]).find(
    (member) => member.userId === userId,
  )
}

function give(userId: string, areas: unknown, tenantId: TenantId = large) {
  return http()
    .put(`/areas/members/${userId}`)
    .set(testIdentityHeader, by('u-lead', tenantId))
    .send(areas as object)
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4), ($5, $6)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Liegenschaften Beispielstadt',
    nextDoor,
    'Hausverwaltung Nebenan',
  ])

  // The large tenant and the one next door have their areas before anybody
  // works for them, so that neither begins with the one a tenant gets with
  // its first membership.
  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd'), ($2, 'Nebenan')
     returning id, name`,
    [large, nextDoor],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''
  theirs = rows.find((row) => row.name === 'Nebenan')?.id ?? ''

  for (const [userId, { role, name }] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      name,
      `${userId}@beispielstadt.example`,
    ])

    for (const tenantId of [small, large]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [role],
      ])
    }
  }

  await admin.query(
    `insert into auth_users (id, name, email) values ('u-neighbour', 'Nora Nachbar', 'nora@nebenan.example')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values ($1, 'u-neighbour', '{management}')`,
    [nextDoor],
  )

  // In the large tenant the Objektleitung and two of the Haustechnik work in
  // the north, one in the south, and one of the north is blocked.
  await admin.query(
    `insert into member_areas (tenant_id, user_id, area_id)
     values ($1, 'u-site', $2), ($1, 'u-tech', $2), ($1, 'u-gone', $2), ($1, 'u-south', $3)`,
    [large, north, south],
  )
  await admin.query(
    `update memberships set blocked_at = now() where tenant_id = $1 and user_id = 'u-gone'`,
    [large],
  )

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

describe('who keeps the areas of a tenant (section 7)', () => {
  const id = '00000000-0000-7000-8000-000000000000'
  const kept: readonly (readonly ['get' | 'post' | 'patch' | 'put' | 'delete', string, Right])[] = [
    ['get', '/areas/overview', 'settings.read'],
    ['post', '/areas', 'settings.write'],
    ['patch', `/areas/${id}`, 'settings.write'],
    ['delete', `/areas/${id}`, 'settings.write'],
    ['get', '/areas/members', 'membership.read'],
    ['get', '/areas/invitations', 'membership.read'],
    ['put', '/areas/members/u-tech', 'membership.write'],
    ['get', '/substitutions', 'membership.read'],
    ['post', '/substitutions', 'membership.write'],
    ['delete', `/substitutions/${id}`, 'membership.write'],
  ]

  it.each(['u-duties', 'u-site', 'u-tech'] as const)(
    'is not %s: every route is refused with the right it takes',
    async (userId) => {
      for (const [method, path, right] of kept) {
        const answer = await http()[method](path).set(testIdentityHeader, by(userId)).send({})

        expect([path, answer.status, answer.body.message]).toEqual([path, 403, missingRight(right)])
      }
    },
  )

  it('leaves reading the areas one holds in to everybody who sees places', async () => {
    for (const userId of Object.keys(people) as Person[]) {
      await http().get('/areas').set(testIdentityHeader, by(userId)).expect(200)
    }

    const nobody = JSON.stringify({ userId: 'u-tech', tenantId: large, roles: [], rights: [] })
    const refused = await http().get('/areas').set(testIdentityHeader, nobody).expect(403)

    expect(refused.body.message).toBe(missingRight('location.read'))
  })
})

describe('the areas somebody holds in', () => {
  const names = async (userId: Person, tenantId: TenantId = large) =>
    (
      (await http().get('/areas').set(testIdentityHeader, by(userId, tenantId)).expect(200))
        .body as { name: string }[]
    ).map((area) => area.name)

  it('are all of them for whoever sees every area, by name', async () => {
    expect(await names('u-lead')).toEqual(['Nord', 'Süd'])
    expect(await names('u-duties')).toEqual(['Nord', 'Süd'])
  })

  it('are the ones named for everybody else, and none for whoever is blocked', async () => {
    expect(await names('u-tech')).toEqual(['Nord'])
    expect(await names('u-south')).toEqual(['Süd'])
    expect(await names('u-gone')).toEqual([])
  })

  it('are the one area of a small tenant for everybody', async () => {
    expect(await names('u-lead', small)).toEqual(['Alle Liegenschaften'])
    expect(await names('u-tech', small)).toEqual(['Alle Liegenschaften'])
  })

  it('are never those of the tenant next door', async () => {
    const answer = await http()
      .get('/areas')
      .set(testIdentityHeader, as(nextDoor, 'u-neighbour', 'management'))
      .expect(200)

    expect((answer.body as { name: string }[]).map((area) => area.name)).toEqual(['Nebenan'])
  })
})

describe('the overview of the areas', () => {
  it('names the properties and counts the buildings of each, and names who it is named for', async () => {
    const first = await propertyIn(north, 'Werkhof Nord')
    const second = await propertyIn(north, 'Bürgerhaus Mitte')
    const third = await propertyIn(south, 'Sporthalle Süd')

    const answer = await http()
      .get('/areas/overview')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    expect(answer.body).toEqual([
      {
        id: north,
        name: 'Nord',
        properties: [
          { id: second.id, name: 'Bürgerhaus Mitte' },
          { id: first.id, name: 'Werkhof Nord' },
        ],
        buildings: 2,
        // By name, without whoever holds in every area and without the one
        // who is blocked.
        members: [
          { userId: 'u-tech', name: 'Murat Yilmaz' },
          { userId: 'u-site', name: 'Petra Lindner' },
        ],
      },
      {
        id: south,
        name: 'Süd',
        properties: [{ id: third.id, name: 'Sporthalle Süd' }],
        buildings: 1,
        members: [{ userId: 'u-south', name: 'Tobias Wendt' }],
      },
    ])
  })

  it('leaves out a property that was removed, and its buildings', async () => {
    const removed = await propertyIn(south, 'Abgerissenes Lager')

    await http()
      .delete(`/properties/${removed.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    const answer = await http()
      .get('/areas/overview')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const inSouth = (
      answer.body as { name: string; properties: { name: string }[]; buildings: number }[]
    ).find((area) => area.name === 'Süd')

    expect(inSouth?.properties.map((property) => property.name)).toEqual(['Sporthalle Süd'])
    expect(inSouth?.buildings).toBe(1)
  })
})

describe('making and renaming an area', () => {
  it('makes one with its name trimmed, which nobody holds in but whoever holds in all', async () => {
    const created = await http()
      .post('/areas')
      .set(testIdentityHeader, by('u-lead'))
      .send({ name: '  West  ' })
      .expect(201)

    expect(created.body).toEqual({ id: expect.any(String), name: 'West' })

    await propertyIn(created.body.id as string, 'Kita Westend')

    expect(await seenBy('u-lead')).toContain('Kita Westend')
    expect(await seenBy('u-duties')).toContain('Kita Westend')
    expect(await seenBy('u-site')).not.toContain('Kita Westend')
    expect(await seenBy('u-tech')).not.toContain('Kita Westend')
  })

  it('refuses a name that is missing, too long or taken, whatever its case', async () => {
    const refused = async (name: unknown, status: number) =>
      (
        await http()
          .post('/areas')
          .set(testIdentityHeader, by('u-lead'))
          .send({ name } as object)
          .expect(status)
      ).body.message as string

    expect(await refused('   ', 400)).toBe('Der Name des Bereichs fehlt.')
    expect(await refused(undefined, 400)).toBe('Der Name des Bereichs fehlt.')
    expect(await refused(7, 400)).toBe('Der Name des Bereichs fehlt.')
    expect(await refused('x'.repeat(121), 400)).toBe(
      'Der Name des Bereichs ist länger als 120 Zeichen.',
    )
    expect(await refused('nord', 409)).toBe('Einen Bereich mit diesem Namen gibt es schon.')
  })

  it('renames one, and refuses the name of another', async () => {
    const id = await areaNamed('Ost')
    const renamed = await http()
      .patch(`/areas/${id}`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ name: ' Osten ' })
      .expect(200)

    expect(renamed.body).toEqual({ id, name: 'Osten' })

    const taken = await http()
      .patch(`/areas/${id}`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ name: 'SÜD' })
      .expect(409)

    expect(taken.body.message).toBe('Einen Bereich mit diesem Namen gibt es schon.')

    // Its own name in another case is no other area's.
    await http()
      .patch(`/areas/${id}`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ name: 'OSTEN' })
      .expect(200)
  })

  it('finds no area that is not this tenant’s', async () => {
    for (const id of [theirs, newId<'area'>(), 'kein-bereich']) {
      const answer = await http()
        .patch(`/areas/${id}`)
        .set(testIdentityHeader, by('u-lead'))
        .send({ name: 'Übernommen' })
        .expect(404)

      expect(answer.body.message).toBe('Diesen Bereich gibt es nicht oder nicht mehr.')
    }

    const { rows } = await admin.query<{ name: string }>('select name from areas where id = $1', [
      theirs,
    ])

    expect(rows[0]?.name).toBe('Nebenan')
  })
})

describe('removing an area', () => {
  const remove = (id: string, moveTo?: string, userId: Person = 'u-lead', tenantId = large) =>
    http()
      .delete(`/areas/${id}${moveTo === undefined ? '' : `?moveTo=${moveTo}`}`)
      .set(testIdentityHeader, by(userId, tenantId))

  it('takes away one that is empty', async () => {
    const id = await areaNamed('Leer')
    const answer = await remove(id).expect(200)

    expect(answer.body).toEqual({ removed: id, moved: 0 })
    expect((await admin.query('select 1 from areas where id = $1', [id])).rowCount).toBe(0)
  })

  it('keeps the last one: every property lies in an area', async () => {
    const { rows } = await admin.query<{ id: string }>(
      'select id from areas where tenant_id = $1',
      [small],
    )
    const answer = await remove(rows[0]?.id ?? '', undefined, 'u-lead', small).expect(409)

    expect(answer.body.message).toBe(
      'Der letzte Bereich lässt sich nicht entfernen: jede Liegenschaft liegt in einem.',
    )
  })

  it('refuses one that still holds properties, with their number, until it is said where they go', async () => {
    const id = await areaNamed('Mitte')

    await propertyIn(id, 'Rathaus')

    expect((await remove(id).expect(409)).body.message).toBe(
      'In diesem Bereich liegt noch 1 Liegenschaft. Sie wird vorher in einen anderen Bereich verlegt.',
    )

    await propertyIn(id, 'Stadtbücherei')

    expect((await remove(id).expect(409)).body.message).toBe(
      'In diesem Bereich liegen noch 2 Liegenschaften. Sie werden vorher in einen anderen Bereich verlegt.',
    )

    // Nothing has moved, and the area is still there.
    expect(await seenBy('u-tech')).not.toContain('Rathaus')
    expect((await admin.query('select 1 from areas where id = $1', [id])).rowCount).toBe(1)
  })

  it('moves them to an area of this tenant and to no other place', async () => {
    const id = await areaNamed('Hafen')

    await propertyIn(id, 'Hafenmeisterei')

    for (const moveTo of [id, theirs, newId<'area'>(), 'irgendwohin']) {
      const answer = await remove(id, moveTo).expect(400)

      expect(answer.body.message).toBe(
        'Den Bereich, in den die Liegenschaften verlegt werden sollen, gibt es bei diesem Betreiber nicht.',
      )
    }

    expect((await admin.query('select 1 from areas where id = $1', [id])).rowCount).toBe(1)
  })

  it('moves the properties with everything below them, removes the area, and leaves whoever held only in it without one', async () => {
    const id = await areaNamed('Altstadt')
    const live = await propertyIn(id, 'Altes Rathaus')
    const marked = await propertyIn(id, 'Abgebrochene Remise')

    await http()
      .delete(`/properties/${marked.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
    // The Objektleitung holds in the north and here, the one in the south
    // only here from now on.
    await give('u-site', { all: false, areaIds: [north, id] }).expect(200)
    await give('u-south', { all: false, areaIds: [id] }).expect(200)

    expect(await seenBy('u-south')).toEqual(['Altes Rathaus'])

    const answer = await remove(id, north).expect(200)

    // The one marked deleted moves as well: it still names its area.
    expect(answer.body).toEqual({ removed: id, moved: 2 })

    const { rows } = await admin.query<{ table: string; area_id: string }>(
      `select 'properties' as table, area_id from properties where id = any($1::uuid[])
       union all
       select 'buildings', area_id from buildings where id = any($2::uuid[])`,
      [
        [live.id, marked.id],
        [live.buildingId, marked.buildingId],
      ],
    )

    expect(rows.map((row) => row.area_id)).toEqual([north, north, north, north])
    expect((await admin.query('select 1 from areas where id = $1', [id])).rowCount).toBe(0)

    // Whoever holds in the north sees it there now.
    expect(await seenBy('u-tech')).toContain('Altes Rathaus')
    // The Objektleitung keeps the north; the other one is left without an
    // area, sees nothing with a place, and is not blocked by it.
    expect(await areasOf('u-site')).toEqual({ userId: 'u-site', all: false, areaIds: [north] })
    expect(await areasOf('u-south')).toEqual({ userId: 'u-south', all: false, areaIds: [] })
    expect(await seenBy('u-south')).toEqual([])

    const { rows: membership } = await admin.query<{ blocked_at: Date | null }>(
      `select blocked_at from memberships where tenant_id = $1 and user_id = 'u-south'`,
      [large],
    )

    expect(membership[0]?.blocked_at).toBeNull()

    await give('u-south', { all: false, areaIds: [south] }).expect(200)
  })

  it('says what holds an area in which only removed properties are left', async () => {
    const id = await areaNamed('Brache')
    const marked = await propertyIn(id, 'Abgetragene Halle')

    await http()
      .delete(`/properties/${marked.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    expect((await remove(id).expect(409)).body.message).toBe(
      'In diesem Bereich liegen noch entfernte Liegenschaften. Sie werden vorher in einen anderen Bereich verlegt.',
    )

    await remove(id, south).expect(200)
  })

  it('is refused to whoever does not see every property in it, and says who can', async () => {
    const id = await areaNamed('Außenbezirk')

    await propertyIn(id, 'Pumpwerk')

    // Somebody who may change settings and holds in the north alone: a role
    // a tenant could make from phase 2 on.
    const narrow = JSON.stringify({
      userId: 'u-site',
      tenantId: large,
      roles: ['site_management'],
      rights: ['settings.write'],
    })
    const answer = await http()
      .delete(`/areas/${id}?moveTo=${north}`)
      .set(testIdentityHeader, narrow)
      .expect(409)

    expect(answer.body.message).toBe(
      'In diesem Bereich liegen Liegenschaften, die Sie nicht sehen. Entfernen kann ihn, wer alle Bereiche sieht.',
    )
    expect(await seenBy('u-lead')).toContain('Pumpwerk')
    expect((await admin.query('select 1 from areas where id = $1', [id])).rowCount).toBe(1)
  })

  it('finds no area that is not this tenant’s', async () => {
    for (const id of [theirs, newId<'area'>(), 'kein-bereich']) {
      const answer = await remove(id, north).expect(404)

      expect(answer.body.message).toBe('Diesen Bereich gibt es nicht oder nicht mehr.')
    }

    expect((await admin.query('select 1 from areas where id = $1', [theirs])).rowCount).toBe(1)
  })
})

describe('the areas of somebody who works for the tenant', () => {
  it('are listed for everybody: all of them, or the ones named', async () => {
    const answer = await http()
      .get('/areas/members')
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
    const listed = Object.fromEntries(
      (answer.body as { userId: string; all: boolean; areaIds: string[] }[]).map((member) => [
        member.userId,
        { all: member.all, areaIds: member.areaIds },
      ]),
    )

    expect(listed).toEqual({
      'u-lead': { all: true, areaIds: [] },
      'u-duties': { all: true, areaIds: [] },
      'u-site': { all: false, areaIds: [north] },
      'u-tech': { all: false, areaIds: [north] },
      'u-south': { all: false, areaIds: [south] },
      'u-gone': { all: false, areaIds: [north] },
    })
  })

  it('change what the person sees at once, and their device lets go of the rest with its next exchange', async () => {
    const pull = async () => {
      const answer = await http()
        .get('/sync?since=0')
        .set(testIdentityHeader, by('u-tech'))
        .expect(200)
      const changes = answer.body.changes as { entity: string; rows: { id: string }[] }[]

      return {
        narrowed: (answer.body.narrowed as Record<string, string>)['properties'],
        held: (changes.find((change) => change.entity === 'properties')?.rows ?? []).map(
          (row) => row.id,
        ),
      }
    }
    const idsOf = async (areaId: string) =>
      (
        await admin.query<{ id: string }>(
          'select id from properties where tenant_id = $1 and area_id = $2',
          [large, areaId],
        )
      ).rows.map((row) => row.id)

    const inNorth = await idsOf(north)
    const inSouth = await idsOf(south)
    const before = await pull()

    expect(before.held.sort()).toEqual([...inNorth].sort())
    expect(before.narrowed).toBe(`properties:${fingerprintOf(inNorth)}`)

    const given = await give('u-tech', { all: false, areaIds: [south] }).expect(200)

    expect(given.body).toEqual({ userId: 'u-tech', all: false, areaIds: [south] })

    const after = await pull()

    // The answer names another value, which is what tells the device to drop
    // what it holds of the places and to ask from the start (ADR 0003, 13).
    expect(after.narrowed).toBe(`properties:${fingerprintOf(inSouth)}`)
    expect(after.narrowed).not.toBe(before.narrowed)
    expect(after.held.sort()).toEqual([...inSouth].sort())
    expect(await seenBy('u-tech')).toEqual(['Sporthalle Süd'])

    await give('u-tech', { all: false, areaIds: [north] }).expect(200)
  })

  it('may be all of them for anybody, and the ones named again', async () => {
    await give('u-site', { all: true }).expect(200)

    expect(await areasOf('u-site')).toEqual({ userId: 'u-site', all: true, areaIds: [] })
    expect(await seenBy('u-site')).toEqual(await seenBy('u-lead'))

    await give('u-site', { all: false, areaIds: [north] }).expect(200)

    expect(await areasOf('u-site')).toEqual({ userId: 'u-site', all: false, areaIds: [north] })
    expect(await seenBy('u-site')).not.toContain('Sporthalle Süd')
  })

  it('may be none, for somebody who is to see nothing with a place for now', async () => {
    await give('u-site', { all: false, areaIds: [] }).expect(200)

    expect(await seenBy('u-site')).toEqual([])

    await give('u-site', { all: false, areaIds: [north] }).expect(200)
  })

  it('are always all of them for the Leitung and the Technische Leitung', async () => {
    for (const userId of ['u-lead', 'u-duties']) {
      const answer = await give(userId, { all: false, areaIds: [north] }).expect(409)

      expect(answer.body.message).toBe(everyAreaSentence)
    }

    expect(await areasOf('u-duties')).toEqual({ userId: 'u-duties', all: true, areaIds: [] })
    await give('u-duties', { all: true }).expect(200)
  })

  it('write down only what changed', async () => {
    // The log holds an entry per field; what counts here is the rows written,
    // each of them one change.
    const entries = async () =>
      Number(
        (
          await admin.query<{ changes: string }>(
            `select count(distinct change_id) as changes from audit_entries
              where tenant_id = $1 and table_name in ('member_areas', 'member_all_areas')`,
            [large],
          )
        ).rows[0]?.changes,
      )
    const before = await entries()

    // The same areas again, in another order and one of them twice.
    await give('u-site', { all: false, areaIds: [north] }).expect(200)
    await give('u-site', { all: false, areaIds: [north, north] }).expect(200)

    expect(await entries()).toBe(before)

    // One more area is one more row, and the one kept is not written again.
    await give('u-site', { all: false, areaIds: [south, north] }).expect(200)

    expect(await entries()).toBe(before + 1)

    await give('u-site', { all: false, areaIds: [north] }).expect(200)

    expect(await entries()).toBe(before + 2)
  })

  it('are areas of this tenant, for somebody who works for it', async () => {
    const refused = async (userId: string, areas: unknown, status: number) =>
      (await give(userId, areas).expect(status)).body.message as string

    expect(await refused('u-tech', { all: false, areaIds: [theirs] }, 400)).toBe(
      'Den Bereich gibt es bei diesem Betreiber nicht.',
    )
    expect(await refused('u-tech', { all: false, areaIds: [newId<'area'>()] }, 400)).toBe(
      'Den Bereich gibt es bei diesem Betreiber nicht.',
    )
    expect(await refused('u-tech', { all: false, areaIds: ['nord'] }, 400)).toBe(
      'Den Bereich gibt es bei diesem Betreiber nicht.',
    )
    expect(await refused('u-tech', { all: false, areaIds: 'nord' }, 400)).toBe(
      'Den Bereich gibt es bei diesem Betreiber nicht.',
    )
    expect(await refused('u-tech', { areaIds: [north] }, 400)).toBe(
      'all fehlt: alle Bereiche oder die genannten.',
    )
    expect(await refused('u-neighbour', { all: true }, 404)).toBe(
      'Diesen Zugang gibt es bei diesem Betreiber nicht.',
    )
    expect(await refused('u-niemand', { all: true }, 404)).toBe(
      'Diesen Zugang gibt es bei diesem Betreiber nicht.',
    )

    // Nothing of it changed anything.
    expect(await areasOf('u-tech')).toEqual({ userId: 'u-tech', all: false, areaIds: [north] })
    expect(
      (
        await admin.query(
          `select 1 from member_all_areas where user_id = 'u-neighbour' and tenant_id = $1`,
          [large],
        )
      ).rowCount,
    ).toBe(0)
  })
})

describe('a substitution', () => {
  const enter = (wanted: Record<string, unknown>, userId: Person = 'u-lead') =>
    http().post('/substitutions').set(testIdentityHeader, by(userId)).send(wanted)
  const listed = async () =>
    (await http().get('/substitutions').set(testIdentityHeader, by('u-lead')).expect(200)).body as {
      id: string
      substitute: string
      absent: string
      startsOn: string
      endsOn: string
    }[]

  it('shows the substitute the areas of the absent person from its first day, and ends at once when it is ended', async () => {
    expect(await seenBy('u-south')).toEqual(['Sporthalle Süd'])

    const entered = await enter({
      substitute: 'u-south',
      absent: 'u-tech',
      startsOn: today,
      endsOn: day(4),
    }).expect(201)

    expect(entered.body).toEqual({
      id: expect.any(String),
      substitute: 'u-south',
      absent: 'u-tech',
      startsOn: today,
      endsOn: day(4),
    })
    expect(await listed()).toEqual([entered.body])
    // The north beside the south, and the areas the person is offered say so.
    expect(await seenBy('u-south')).toEqual(
      expect.arrayContaining(['Sporthalle Süd', 'Werkhof Nord']),
    )
    expect(
      (
        (await http().get('/areas').set(testIdentityHeader, by('u-south')).expect(200)).body as {
          name: string
        }[]
      ).map((area) => area.name),
    ).toEqual(['Nord', 'Süd'])
    // Nothing is copied: what is named for the substitute is what it was.
    expect(await areasOf('u-south')).toEqual({ userId: 'u-south', all: false, areaIds: [south] })

    const ended = await http()
      .delete(`/substitutions/${entered.body.id as string}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    expect(ended.body).toEqual({ ended: entered.body.id })
    expect(await listed()).toEqual([])
    expect(await seenBy('u-south')).toEqual(['Sporthalle Süd'])
  })

  it('does nothing before its first day, and is listed until its last', async () => {
    const entered = await enter({
      substitute: 'u-south',
      absent: 'u-tech',
      startsOn: day(1),
      endsOn: day(3),
    }).expect(201)

    expect(await seenBy('u-south')).toEqual(['Sporthalle Süd'])
    expect((await listed()).map((entry) => entry.id)).toEqual([entered.body.id])

    // One that ended yesterday is no longer listed and does nothing; entered
    // past the application, since the application takes none in the past.
    await admin.query(
      `insert into substitutions (tenant_id, substitute_user_id, absent_user_id, starts_on, ends_on)
       values ($1, 'u-south', 'u-site', $2, $3)`,
      [large, day(-5), day(-1)],
    )

    expect((await listed()).map((entry) => entry.id)).toEqual([entered.body.id])
    expect(await seenBy('u-south')).toEqual(['Sporthalle Süd'])

    await http()
      .delete(`/substitutions/${entered.body.id as string}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
  })

  it('lists the next one first', async () => {
    const later = await enter({
      substitute: 'u-site',
      absent: 'u-south',
      startsOn: day(10),
      endsOn: day(12),
    }).expect(201)
    const sooner = await enter({
      substitute: 'u-tech',
      absent: 'u-south',
      startsOn: day(2),
      endsOn: day(20),
    }).expect(201)

    expect((await listed()).map((entry) => entry.id)).toEqual([sooner.body.id, later.body.id])

    for (const id of [later.body.id, sooner.body.id] as string[]) {
      await http().delete(`/substitutions/${id}`).set(testIdentityHeader, by('u-lead')).expect(200)
    }
  })

  it('is refused with the sentence of the form when it cannot be one', async () => {
    const wanted = { substitute: 'u-south', absent: 'u-tech', startsOn: today, endsOn: day(4) }
    const refused = async (change: Record<string, unknown>, status = 400) =>
      (await enter({ ...wanted, ...change }).expect(status)).body.message as string

    expect(await refused({ absent: 'u-south' })).toBe('Niemand vertritt sich selbst.')
    expect(await refused({ endsOn: day(-1) })).toBe('Die Vertretung endet, bevor sie beginnt.')
    expect(await refused({ startsOn: day(-9), endsOn: day(-2) })).toBe(
      'Die Vertretung liegt in der Vergangenheit.',
    )
    expect(await refused({ startsOn: '12.10.2026' })).toBe(
      'Der Anfang der Vertretung ist kein Tag.',
    )
    expect(await refused({ endsOn: undefined })).toBe('Das Ende der Vertretung ist kein Tag.')
    expect(await refused({ substitute: undefined })).toBe('Wer vertritt, fehlt.')
    expect(await refused({ absent: '' })).toBe('Wer vertreten wird, fehlt.')
    // Somebody of the tenant next door, and somebody nobody knows.
    expect(await refused({ substitute: 'u-neighbour' })).toBe(
      'Wer vertritt, arbeitet nicht für diesen Betreiber.',
    )
    expect(await refused({ absent: 'u-niemand' })).toBe(
      'Wer vertreten wird, arbeitet nicht für diesen Betreiber.',
    )
    expect(await refused({ substitute: 'u-gone' }, 409)).toBe(
      'Wer gesperrt ist, vertritt niemanden.',
    )

    expect(await listed()).toEqual([])
  })

  it('may be for somebody who is blocked: somebody leaves, and the substitution takes over', async () => {
    const entered = await enter({
      substitute: 'u-south',
      absent: 'u-gone',
      startsOn: today,
      endsOn: today,
    }).expect(201)

    expect(await seenBy('u-south')).toEqual(expect.arrayContaining(['Werkhof Nord']))

    await http()
      .delete(`/substitutions/${entered.body.id as string}`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
  })

  it('is entered once for the same two people and the same days', async () => {
    const first = await enter({
      substitute: 'u-south',
      absent: 'u-tech',
      startsOn: day(5),
      endsOn: day(9),
    }).expect(201)

    for (const [startsOn, endsOn] of [
      [day(5), day(9)],
      [day(9), day(14)],
      [day(1), day(5)],
      [day(6), day(7)],
    ]) {
      const answer = await enter({
        substitute: 'u-south',
        absent: 'u-tech',
        startsOn,
        endsOn,
      }).expect(409)

      expect(answer.body.message).toBe('Für diese Tage gibt es diese Vertretung schon.')
    }

    // The days after it, and the other way round, are substitutions of their own.
    const after = await enter({
      substitute: 'u-south',
      absent: 'u-tech',
      startsOn: day(10),
      endsOn: day(11),
    }).expect(201)
    const reverse = await enter({
      substitute: 'u-tech',
      absent: 'u-south',
      startsOn: day(5),
      endsOn: day(9),
    }).expect(201)

    for (const id of [first.body.id, after.body.id, reverse.body.id] as string[]) {
      await http().delete(`/substitutions/${id}`).set(testIdentityHeader, by('u-lead')).expect(200)
    }
  })

  it('finds no substitution that is not this tenant’s to end', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into substitutions (tenant_id, substitute_user_id, absent_user_id, starts_on, ends_on)
       values ($1, 'u-tech', 'u-site', $2, $2) returning id`,
      [small, today],
    )

    for (const id of [rows[0]?.id ?? '', newId<'substitution'>(), 'keine']) {
      const answer = await http()
        .delete(`/substitutions/${id}`)
        .set(testIdentityHeader, by('u-lead'))
        .expect(404)

      expect(answer.body.message).toBe('Diese Vertretung gibt es nicht oder nicht mehr.')
    }

    expect(
      (await admin.query('select 1 from substitutions where id = $1', [rows[0]?.id])).rowCount,
    ).toBe(1)
  })
})
