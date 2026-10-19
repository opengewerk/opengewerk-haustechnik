import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  type ProcessingDescriptions,
  type ProcessingVersion,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId, type PrintJob } from '@opengewerk/platform-server'
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
 * The description of the processing as the application makes it (#357,
 * section 9 of the concept): made by the Leitung from what is set at the
 * operator, kept with its day, and printed as it was made.
 */

const tenant = newId<'tenant'>() as TenantId
const elsewhere = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

const catalogue = catalogueOf(probeCatalogueBundle)
const rendered: PrintJob[] = []

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string, tenantId: TenantId = tenant): string {
  return as(tenantId, userId, people[userId]?.role as RoleKey)
}

async function listed(header = by('u-lead')): Promise<ProcessingDescriptions> {
  return (
    await http()
      .get('/settings/processing-descriptions')
      .set(testIdentityHeader, header)
      .expect(200)
  ).body as ProcessingDescriptions
}

async function made(header = by('u-lead')): Promise<ProcessingVersion> {
  return (
    await http()
      .post('/settings/processing-descriptions')
      .set(testIdentityHeader, header)
      .expect(201)
  ).body as ProcessingVersion
}

async function textOf(id: string): Promise<string> {
  const { rows } = await admin.query<{ text: string }>(
    'select text from processing_descriptions where id = $1',
    [id],
  )

  return rows[0]?.text ?? ''
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const [id, name] of [
    [tenant, 'Wohnbau <Nord> eG'],
    [elsewhere, 'Wohnbau Süd eG'],
  ] as const) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [id, name])

    for (const role of shippedRoles) {
      await admin.query(
        `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
      )
    }

    for (const [userId, person] of Object.entries(people)) {
      if (id === tenant) {
        await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
          userId,
          person.name,
          `${userId}@beispiel.example`,
        ])
      }

      await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
        id,
        userId,
        [person.role],
      ])
    }
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        catalogue,
        renderer: (job) => {
          rendered.push(job)

          return Promise.resolve(new TextEncoder().encode('%PDF-1.7 probe'))
        },
      }),
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

describe('the description of the processing an operator makes (#357)', () => {
  it('is made only by the Leitung, and kept with its day, who made it and its whole text', async () => {
    for (const userId of ['u-duties', 'u-site', 'u-tech'] as const) {
      const refused = await http()
        .post('/settings/processing-descriptions')
        .set(testIdentityHeader, by(userId))
        .expect(403)

      expect(refused.body.message).toBe(missingRight('privacy.generate'))
      await http()
        .get('/settings/processing-descriptions')
        .set(testIdentityHeader, by(userId))
        .expect(403)
    }

    // A role of the operator's own is never given the right; it stays with the Leitung.
    await http()
      .post('/roles')
      .set(testIdentityHeader, by('u-lead'))
      .send({ label: 'Datenschutz', rights: ['settings.read', 'privacy.generate'] })
      .expect(400)
      .expect((answer) => {
        expect(answer.body.message).toBe(
          '„Auskunft, Verfahrensbeschreibung und Verzeichnis erzeugen“ bleibt der Leitung.',
        )
      })

    expect((await listed()).versions).toEqual([])
    expect((await listed()).changedSinceNewest).toBeNull()

    const first = await made()
    const text = await textOf(first.id)

    expect(first.changed).toBeNull()
    expect(text).toContain(
      '# OpenGewerk Haustechnik: Verfahrensbeschreibung für Wohnbau \\<Nord\\> eG',
    )
    expect(text).toContain('- **Erzeugt:** am ')
    expect(text).not.toContain('{{')
    expect((await listed()).versions).toEqual([
      expect.objectContaining({ id: first.id, madeBy: 'Sabine Krämer', changed: null }),
    ])
    expect((await listed()).changedSinceNewest).toEqual([])

    // Kept as it was made: the application may add a description, and change or remove none.
    for (const statement of [
      `update processing_descriptions set text = 'anders' where id = '${first.id}'`,
      `delete from processing_descriptions where id = '${first.id}'`,
    ]) {
      await expect(
        database.forTenant({ tenantId: tenant, userId: 'u-lead' }, (tx) => tx.execute(statement)),
      ).rejects.toMatchObject({ cause: { code: '42501' } })
    }

    // Another operator sees none of it, not by its address either.
    expect((await listed(by('u-lead', elsewhere))).versions).toEqual([])
    await http()
      .get(`/settings/processing-descriptions/${first.id}/pdf`)
      .set(testIdentityHeader, by('u-lead', elsewhere))
      .expect(404)
  })

  it('says what is set at the operator, and a change to a setting changes it', async () => {
    const before = await made()

    expect(await textOf(before.id)).toContain(
      '| Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis | aus |',
    )

    await http()
      .put('/settings/work-orders')
      .set(testIdentityHeader, by('u-lead'))
      .send({ namesAndTimes: true })
      .expect(200)
    await http()
      .post('/roles')
      .set(testIdentityHeader, by('u-lead'))
      .send({ label: 'Hausmeisterei', rights: ['store.read', 'store.write'] })
      .expect(201)
    await http()
      .put('/settings/memberships')
      .set(testIdentityHeader, by('u-lead'))
      .send({ removalDays: 30 })
      .expect(200)

    expect((await listed()).changedSinceNewest).toEqual(['2'])

    const after = await made()
    const text = await textOf(after.id)

    expect(after.changed).toEqual(['2'])
    expect(text).toContain(
      '| Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis | eingeschaltet |',
    )
    expect(text).toContain('eigene: Hausmeisterei (0 Zugänge)')
    expect(text).toContain('- **Hausmeisterei**: Lager ansehen; Lager führen.')
    expect(text).toContain(
      '| Angaben eines beendeten Zugangs entfernen | nach 30 Tagen, gezählt ab dem Tag nach dem letzten Tag |',
    )
    expect((await listed()).facts).toContainEqual({
      label: 'Namen und Uhrzeiten der Ausführenden auf dem Leistungsnachweis',
      value: 'eingeschaltet',
    })
    expect((await listed()).versions.map((version) => version.id).slice(0, 2)).toEqual([
      after.id,
      before.id,
    ])
  })

  it('names no person who works for the operator, only how many hold each role', async () => {
    const text = await textOf((await made()).id)

    for (const person of Object.values(people)) {
      expect(text).not.toContain(person.name)
    }

    for (const userId of Object.keys(people)) {
      expect(text).not.toContain(userId)
    }

    expect(text).toContain('Leitung (1 Zugang)')
  })

  it('is printed as it was made, with every character of the operator escaped', async () => {
    const version = await made()

    rendered.length = 0
    await http()
      .get(`/settings/processing-descriptions/${version.id}/pdf`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
    await http()
      .get(`/settings/processing-descriptions/${version.id}/pdf`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(403)

    const [job] = rendered

    expect(job?.html).toContain(
      '<h1>OpenGewerk Haustechnik: Verfahrensbeschreibung für Wohnbau &lt;Nord&gt; eG</h1>',
    )
    expect(job?.html).not.toContain('<Nord>')
    expect(job?.footerHtml).toContain('Wohnbau &lt;Nord&gt; eG')
  })
})
