import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type Contractor,
  type ContractorEntry,
  type ContractorName,
  type ContractorPage,
  rightsOfRoles,
  type RoleKey,
  shippedRoles,
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
 * The contractors of the operator (#328, section 4.11 of the concept): a firm
 * with its address and the cost groups it works in, which a duty and an
 * activity name out of the list. Tenant-wide and without an area; every role
 * reads them, the Leitung and the Technische Leitung keep them (decided
 * 15.10.2026). A firm is marked when it is removed, and that is refused while
 * an open duty or an activity still to be done names it. The names that stand
 * as text at duties are taken over into the list.
 */

const small = newId<'tenant'>() as TenantId
const other = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

function firm(body: object, header = by('u-duties')) {
  return http().post('/contractors').set(testIdentityHeader, header).send(body)
}

async function made(body: object, header = by('u-duties')): Promise<Contractor> {
  return (await firm(body, header).expect(201)).body as Contractor
}

async function listOf(header = by('u-tech')): Promise<ContractorEntry[]> {
  return (await http().get('/contractors').set(testIdentityHeader, header).expect(200))
    .body as ContractorEntry[]
}

/** A building on a new property of the small tenant. */
async function building(): Promise<string> {
  const header = by('u-duties')
  const property = (
    await http()
      .post('/properties')
      .set(testIdentityHeader, header)
      .send({
        name: `Werkhof ${newId<'property'>().slice(-6)}`,
        street: 'Am Werkhof 1',
        postalCode: '68535',
        city: 'Edingen-Neckarhausen',
        federalState: 'DE-BW',
      })
      .expect(201)
  ).body.id as string

  return (
    await http()
      .post(`/properties/${property}/buildings`)
      .set(testIdentityHeader, header)
      .send({ name: 'Halle 1', kinds: ['school'] })
      .expect(201)
  ).body.id as string
}

/** A duty of the operator's own at a new building, carried out as the body says, answered with the status. */
async function duty(performer: object, status: number, header = by('u-duties')) {
  const buildingId = await building()

  return http()
    .post('/duties')
    .set(testIdentityHeader, header)
    .send({
      buildingId,
      label: 'Feuerlöscher prüfen',
      basis: 'insurer',
      sourceNote: 'Gebäudeversicherung, Vertrag 4711',
      task: 'inspection',
      intervalMonths: 24,
      ...performer,
    })
    .expect(status)
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const [tenantId, name] of [
    [small, 'Wohnbau Nord eG'],
    [other, 'Gebäudeverwaltung Süd'],
  ] as const) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [tenantId, name])

    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }
  }

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])

    for (const tenantId of [small, other]) {
      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        tenantId,
        userId,
        [person.role],
      ])
    }
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

describe('who keeps the contractors', () => {
  it('is the Leitung and the Technische Leitung; every role reads them', async () => {
    const kept = await made({ name: 'Elektro Kraus & Sohn', services: ['440'] }, by('u-lead'))

    await made({ name: 'Aufzugsdienst Rhein-Neckar GmbH' }, by('u-duties'))
    await firm({ name: 'Heizungsbau Beispiel GmbH' }, by('u-site')).expect(403)
    await firm({ name: 'Heizungsbau Beispiel GmbH' }, by('u-tech')).expect(403)
    await http()
      .patch(`/contractors/${kept.id}`)
      .set(testIdentityHeader, by('u-site'))
      .send({ note: 'Rufbereitschaft' })
      .expect(403)
    await http().delete(`/contractors/${kept.id}`).set(testIdentityHeader, by('u-site')).expect(403)

    for (const userId of ['u-lead', 'u-duties', 'u-site', 'u-tech'] as const) {
      expect((await listOf(by(userId))).map((each) => each.id)).toContain(kept.id)
    }

    // The names at duties are for whoever takes them over.
    await http().get('/contractors/names').set(testIdentityHeader, by('u-site')).expect(403)
  })

  it('are the tenant own: another tenant neither sees nor changes one', async () => {
    const kept = await made({ name: 'Wasserlabor Beispielstadt' })

    expect((await listOf(by('u-tech', other))).map((each) => each.id)).not.toContain(kept.id)
    await http()
      .get(`/contractors/${kept.id}`)
      .set(testIdentityHeader, by('u-lead', other))
      .expect(404)
    await http()
      .patch(`/contractors/${kept.id}`)
      .set(testIdentityHeader, by('u-lead', other))
      .send({ note: 'fremd' })
      .expect(404)
  })
})

describe('a contractor', () => {
  it('keeps its address, its services once each and in order, and its note', async () => {
    const kept = await made({
      name: '  Brandschutz Beispiel GmbH ',
      street: 'Industriestraße 12',
      postalCode: '68169',
      city: 'Mannheim',
      phone: '0621 445566',
      email: 'service@brandschutz-beispiel.example',
      services: ['470', '450'],
      note: 'Rufbereitschaft am Wochenende.',
    })

    expect(kept).toMatchObject({
      name: 'Brandschutz Beispiel GmbH',
      city: 'Mannheim',
      services: ['450', '470'],
    })

    const changed = (
      await http()
        .patch(`/contractors/${kept.id}`)
        .set(testIdentityHeader, by('u-duties'))
        .send({ services: ['440'], note: null })
        .expect(200)
    ).body as Contractor

    expect(changed).toMatchObject({ services: ['440'], note: null, city: 'Mannheim' })
  })

  it('takes no service out of the list, none twice and no firm without a name', async () => {
    await firm({ name: 'Kälte Klima Süd', services: ['999'] }).expect(400)
    await firm({ name: 'Kälte Klima Süd', services: ['430', '430'] }).expect(400)
    await firm({ name: '   ' }).expect(400)
    await firm({ name: 'x'.repeat(121) }).expect(400)
  })
})

describe('a duty a contractor carries out', () => {
  it('names a firm of the list, and only when a contractor carries it out', async () => {
    const kept = await made({ name: 'Prüfdienst Weber' })
    const named = await duty({ performer: 'contractor', contractorId: kept.id }, 201)

    expect(named.body).toMatchObject({ performer: 'contractor', contractorId: kept.id })

    expect((await duty({ performer: 'own_staff', contractorId: kept.id }, 400)).body.message).toBe(
      'Die Fremdfirma gehört zu einer Pflicht, die eine Fremdfirma ausführt.',
    )
    // A firm that is not there, or one of another tenant.
    await duty({ performer: 'contractor', contractorId: newId<'contractor'>() }, 400)

    const theirs = await made({ name: 'Fremd GmbH' }, by('u-duties', other))

    await duty({ performer: 'contractor', contractorId: theirs.id }, 400)
  })

  it('counts in the list of the firms while it is open', async () => {
    const kept = await made({ name: 'Brandschutz Nord GmbH' })

    await duty({ performer: 'contractor', contractorId: kept.id }, 201)
    await duty({ performer: 'contractor', contractorId: kept.id }, 201)

    expect((await listOf()).find((each) => each.id === kept.id)?.openDuties).toBe(2)

    const page = (
      await http().get(`/contractors/${kept.id}`).set(testIdentityHeader, by('u-tech')).expect(200)
    ).body as ContractorPage

    expect(page).toMatchObject({ openDuties: 2, openActivities: 0, evidence: [] })
  })
})

describe('the activities of a contractor', () => {
  it('are those the list narrows to by the firm, and none of another', async () => {
    const kept = await made({ name: 'Blitzschutz Weber' })
    const other = await made({ name: 'Blitzschutz Klein' })
    const named = (await duty({ performer: 'contractor', contractorId: kept.id }, 201)).body as {
      id: string
    }
    const { rows } = await admin.query<{ property_id: string; area_id: string }>(
      'select property_id, area_id from duties where id = $1',
      [named.id],
    )
    const place = rows[0]

    for (const [firm, title] of [
      [kept.id, 'Prüfung des Blitzschutzes'],
      [other.id, 'Prüfung der Erdung'],
    ] as const) {
      await admin.query(
        `insert into activities (tenant_id, property_id, area_id, kind, title, performer, contractor_id)
         values ($1, $2, $3, 'inspection', $4, 'contractor', $5)`,
        [small, place?.property_id, place?.area_id, title, firm],
      )
    }

    const answer = await http()
      .get(`/activities?state=pending&contractor=${kept.id}&offset=0&limit=5`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)

    expect(
      (answer.body as { activities: { title: string }[] }).activities.map((each) => each.title),
    ).toEqual(['Prüfung des Blitzschutzes'])
  })
})

describe('removing a contractor', () => {
  it('is refused while an open duty names it, and marks it once none does', async () => {
    const kept = await made({ name: 'Aufzüge Süd GmbH' })
    const named = (await duty({ performer: 'contractor', contractorId: kept.id }, 201)).body as {
      id: string
    }
    const refused = await http()
      .delete(`/contractors/${kept.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(409)

    expect(refused.body.message).toContain('1 offene Pflichten')

    // The duty names the own people from now on.
    await http()
      .patch(`/duties/${named.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ performer: 'own_staff', contractorId: null })
      .expect(200)
    await http()
      .delete(`/contractors/${kept.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    expect((await listOf()).map((each) => each.id)).not.toContain(kept.id)

    // Marked, not removed: its page stays, so that what named it leads somewhere.
    await http().get(`/contractors/${kept.id}`).set(testIdentityHeader, by('u-tech')).expect(200)

    const { rows } = await admin.query<{ deleted: boolean }>(
      'select deleted_at is not null as deleted from contractors where id = $1',
      [kept.id],
    )

    expect(rows).toEqual([{ deleted: true }])

    // A removed firm is out of every choice.
    await duty({ performer: 'contractor', contractorId: kept.id }, 400)
  })

  it('is refused while an activity still to be done names it', async () => {
    const kept = await made({ name: 'Lüftung Becker' })
    const named = (await duty({ performer: 'contractor', contractorId: kept.id }, 201)).body as {
      id: string
    }
    const { rows } = await admin.query<{ property_id: string; area_id: string }>(
      'select property_id, area_id from duties where id = $1',
      [named.id],
    )
    const place = rows[0]

    await admin.query(
      `insert into activities (tenant_id, property_id, area_id, kind, title, performer, contractor_id)
       values ($1, $2, $3, 'inspection', 'Prüfung der Lüftung', 'contractor', $4)`,
      [small, place?.property_id, place?.area_id, kept.id],
    )
    await http()
      .patch(`/duties/${named.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ performer: 'own_staff', contractorId: null })
      .expect(200)

    const refused = await http()
      .delete(`/contractors/${kept.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(409)

    expect(refused.body.message).toContain('1 offene Vorgänge')
  })

  /**
   * The duties and activities that name a firm lie in every area (#474):
   * whoever keeps the firms in some areas only does not see all of them, so
   * removing one is for whoever sees every area.
   */
  it('is refused to whoever keeps the firms in some areas only', async () => {
    const kept = await made({ name: 'Lüftung Mitte GmbH' })
    // The Objektleitung, which holds in the one area, given the right to keep the firms.
    const narrow = JSON.stringify({
      userId: 'u-site',
      tenantId: small,
      roles: ['site_management'],
      rights: [...rightsOfRoles(['site_management']), 'contractor.write'],
    })
    const refused = await http()
      .delete(`/contractors/${kept.id}`)
      .set(testIdentityHeader, narrow)
      .expect(403)

    expect(refused.body.message).toBe(
      'Eine Fremdfirma entfernen kann nur, wer alle Bereiche sieht: Pflichten und Vorgänge in jedem Bereich können sie nennen.',
    )
    expect((await listOf()).map((each) => each.id)).toContain(kept.id)

    await http()
      .delete(`/contractors/${kept.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
  })
})

describe('the names that stand as text at duties', () => {
  it('are offered with how many duties bear each, and taken over into the list', async () => {
    const before = await made({ name: 'Heizungsbau Beispiel GmbH' })

    for (const name of ['Kälte Klima Süd', 'Kälte Klima Süd', 'heizungsbau  beispiel gmbh']) {
      await duty({ performer: 'contractor', performerNote: name }, 201)
    }

    const names = (
      await http().get('/contractors/names').set(testIdentityHeader, by('u-duties')).expect(200)
    ).body as ContractorName[]

    expect(names).toEqual([
      { name: 'heizungsbau  beispiel gmbh', duties: 1, contractorId: before.id },
      { name: 'Kälte Klima Süd', duties: 2, contractorId: null },
    ])

    const taken = await http()
      .post('/contractors/takeover')
      .set(testIdentityHeader, by('u-duties'))
      .send({
        items: [
          { name: 'Kälte Klima Süd', contractorId: null },
          { name: 'heizungsbau  beispiel gmbh', contractorId: before.id },
        ],
      })
      .expect(201)

    expect(taken.body).toEqual({ firms: 1, duties: 3 })

    const list = await listOf()
    const made_ = list.find((each) => each.name === 'Kälte Klima Süd')

    expect(made_?.openDuties).toBe(2)
    expect(list.find((each) => each.id === before.id)?.openDuties).toBe(1)
    expect(
      (await http().get('/contractors/names').set(testIdentityHeader, by('u-duties')).expect(200))
        .body,
    ).toEqual([])

    // The note stays as it stood.
    const { rows } = await admin.query<{ note: string }>(
      `select performer_note as note from duties where contractor_id = $1`,
      [before.id],
    )

    expect(rows).toEqual([{ note: 'heizungsbau  beispiel gmbh' }])
  })

  it('are taken over only by whoever keeps the firms', async () => {
    await http()
      .post('/contractors/takeover')
      .set(testIdentityHeader, by('u-site'))
      .send({ items: [{ name: 'Prüfdienst Klein', contractorId: null }] })
      .expect(403)
  })
})

describe('the people to talk to a contractor is made with (#383)', () => {
  it('come with the firm in one go, and an entry that says nothing is no contact', async () => {
    const kept = await made({
      name: 'Kältetechnik Mit Ansprechpartner GmbH',
      contacts: [
        {
          givenName: 'Klaus',
          familyName: '  Berger ',
          role: 'Kundendienst',
          phone: '0170 2233445',
          email: 'k.berger@kaelte.example',
        },
        { givenName: ' ', familyName: '', role: '', phone: '', email: '' },
        { familyName: 'Lang', phone: '0621 123' },
      ],
    })
    const { rows } = await admin.query<{
      family_name: string
      given_name: string | null
      area_id: string | null
    }>(
      'select family_name, given_name, area_id from contacts where contractor_id = $1 order by family_name',
      [kept.id],
    )

    expect(rows).toEqual([
      { family_name: 'Berger', given_name: 'Klaus', area_id: null },
      { family_name: 'Lang', given_name: null, area_id: null },
    ])
  })

  it('leave no firm behind when one of them is refused', async () => {
    const name = 'Firma Ohne Nachnamen GmbH'
    const refused = await firm({
      name,
      contacts: [{ familyName: 'Berger' }, { givenName: 'Petra', phone: '0621 1' }],
    }).expect(400)

    expect((refused.body as { message: string }).message).toBe('Der Nachname fehlt.')

    const { rows } = await admin.query('select 1 from contractors where name = $1', [name])

    expect(rows).toEqual([])
  })

  it('are at most ten at once, and come only with a firm made by whoever keeps the firms', async () => {
    await firm({
      name: 'Zu viele Ansprechpartner GmbH',
      contacts: Array.from({ length: 11 }, (_, at) => ({ familyName: `Person ${String(at)}` })),
    }).expect(400)
    await firm(
      { name: 'Ohne Recht GmbH', contacts: [{ familyName: 'Berger' }] },
      by('u-site'),
    ).expect(403)
  })
})
