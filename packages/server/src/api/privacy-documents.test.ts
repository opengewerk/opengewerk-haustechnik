import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  type PrivacyDocuments,
  type PrivacyDocumentVersion,
  type ProcessingRecordView,
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
 * The record of the processing, the technical and organisational measures and
 * the deletion concept as the application makes them (#358, section 9 of the
 * concept, decided on 19.10.2026): made by the Leitung from what it wrote for
 * the record, what whoever runs the instance wrote for part B, and what is set
 * at the operator; kept with their day and printed as they were made.
 *
 * The tests build on each other, in the order they stand.
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

async function listed(header = by('u-lead')): Promise<PrivacyDocuments> {
  return (
    await http().get('/settings/privacy-documents').set(testIdentityHeader, header).expect(200)
  ).body as PrivacyDocuments
}

async function made(kind: string, header = by('u-lead')): Promise<PrivacyDocumentVersion> {
  return (
    await http()
      .post(`/settings/privacy-documents/${kind}`)
      .set(testIdentityHeader, header)
      .expect(201)
  ).body as PrivacyDocumentVersion
}

async function textOf(id: string): Promise<string> {
  const { rows } = await admin.query<{ text: string }>(
    'select text from privacy_documents where id = $1',
    [id],
  )

  return rows[0]?.text ?? ''
}

function keep(path: string, body: object, header = by('u-lead')) {
  return http().put(`/settings/processing-record${path}`).set(testIdentityHeader, header).send(body)
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

describe('the documents on data protection an operator makes (#358)', () => {
  it('are made and written for only by the Leitung, and kept with their day, who made them and their whole text', async () => {
    for (const userId of ['u-duties', 'u-site', 'u-tech'] as const) {
      const refused = await http()
        .post('/settings/privacy-documents/record')
        .set(testIdentityHeader, by(userId))
        .expect(403)

      expect(refused.body.message).toBe(missingRight('privacy.generate'))
      await http()
        .get('/settings/privacy-documents')
        .set(testIdentityHeader, by(userId))
        .expect(403)
      await http()
        .get('/settings/processing-record')
        .set(testIdentityHeader, by(userId))
        .expect(403)
      await keep('', { controller: 'Jemand' }, by(userId)).expect(403)
      await keep('/activities/accounts', { purpose: 'x', legalBasis: 'y' }, by(userId)).expect(403)
    }

    const before = await listed()

    expect(before.versions).toEqual([])
    expect(before.kinds.map((kind) => [kind.kind, kind.changedSinceNewest])).toEqual([
      ['record', null],
      ['measures', null],
      ['deletion', null],
    ])

    const first = await made('record')
    const text = await textOf(first.id)

    expect(first.changed).toBeNull()
    expect(text).toContain('# Verzeichnis der Verarbeitungstätigkeiten für Wohnbau \\<Nord\\> eG')
    expect(text).toContain('- **Verantwortlicher:** noch nicht angegeben')
    expect((await listed()).versions).toEqual([
      expect.objectContaining({
        id: first.id,
        kind: 'record',
        madeBy: 'Sabine Krämer',
        changed: null,
      }),
    ])

    // Kept as it was made: the application may add a document, and change or remove none.
    for (const statement of [
      `update privacy_documents set text = 'anders' where id = '${first.id}'`,
      `delete from privacy_documents where id = '${first.id}'`,
    ]) {
      await expect(
        database.forTenant({ tenantId: tenant, userId: 'u-lead' }, (tx) => tx.execute(statement)),
      ).rejects.toMatchObject({ cause: { code: '42501' } })
    }

    // Another operator sees none of it, not by its address either.
    expect((await listed(by('u-lead', elsewhere))).versions).toEqual([])
    await http()
      .get(`/settings/privacy-documents/${first.id}/pdf`)
      .set(testIdentityHeader, by('u-lead', elsewhere))
      .expect(404)
    await http()
      .post('/settings/privacy-documents/everything')
      .set(testIdentityHeader, by('u-lead'))
      .expect(400)
  })

  it('make the record of what the Leitung wrote, with the proposal of the application until it confirms', async () => {
    const who = (
      await keep('', { controller: '  Wohnbau Nord eG\r\nHafenweg 1 ', officer: ' ' }).expect(200)
    ).body as ProcessingRecordView

    expect([who.controller, who.officer]).toEqual(['Wohnbau Nord eG\nHafenweg 1', null])

    const confirmed = (
      await keep('/activities/accounts', {
        purpose: 'Anmeldung der Beschäftigten',
        legalBasis: 'Art. 6 Abs. 1 lit. b DSGVO',
        recipients: 'der Dienstleister, der die Instanz betreibt',
      }).expect(200)
    ).body as ProcessingRecordView

    expect(confirmed.activities.find((activity) => activity.key === 'accounts')).toMatchObject({
      purpose: 'Anmeldung der Beschäftigten',
      recipients: 'der Dienstleister, der die Instanz betreibt',
    })

    expect(
      (await keep('/activities/accounts', { purpose: 'Nur der Zweck' }).expect(400)).body.message,
    ).toBe(
      'Zweck und Rechtsgrundlage gehören zusammen: beide, oder keines für den Vorschlag der Anwendung.',
    )
    expect(
      (await keep('/activities/nothing', { purpose: 'x', legalBasis: 'y' }).expect(400)).body
        .message,
    ).toBe('Eine Tätigkeit „nothing“ gibt es nicht.')

    // The proposal of the application stands again, and the recipients stay.
    const restored = (
      await keep('/activities/third-parties', {
        purpose: 'Kontakt',
        legalBasis: 'Art. 6 Abs. 1 lit. f DSGVO',
      }).expect(200)
    ).body as ProcessingRecordView

    expect(restored.activities.find((activity) => activity.key === 'third-parties')?.purpose).toBe(
      'Kontakt',
    )
    await keep('/activities/third-parties', {
      purpose: null,
      legalBasis: null,
      recipients: 'Fremdfirmen',
    }).expect(200)

    expect(
      (await listed()).kinds.find((kind) => kind.kind === 'record')?.changedSinceNewest,
    ).toEqual(['2', '3'])

    const text = await textOf((await made('record')).id)

    expect(text).toContain('- **Verantwortlicher:** Wohnbau Nord eG, Hafenweg 1')
    expect(text).toContain('- **Datenschutzbeauftragter:** keiner angegeben')
    expect(text).toContain('- **Zweck:** Anmeldung der Beschäftigten\n')
    expect(text).toContain(
      '- **Zweck:** Ansprechpartner und Fremdfirmen erreichen und fremde Prüfungen nachweisen (Vorschlag der Anwendung, nicht bestätigt)',
    )
    expect(text).toContain('- **Empfänger:** Fremdfirmen')

    for (const person of Object.values(people)) {
      expect(text).not.toContain(person.name)
    }
  })

  it('make the measures with part B and annex 2 as the instance keeps them, and say so while there are none', async () => {
    const without = await textOf((await made('measures')).id)

    expect(without).toContain('## Teil A: Was die Anwendung mitbringt')
    expect(without).toContain('Die Verwaltung der Instanz hat Teil B noch nicht ausgefüllt.')
    expect(without).toContain('Keine eingetragen.')

    await admin.query(
      `update instance_settings
          set measures = '{"serverPlace": "Nürnberg", "accessFirewall": true, "backupGenerations": "21"}',
              subprocessors = '[{"name": "Rechenbetrieb <Nord>", "service": "Server", "place": "Deutschland"}]',
              updated_at = now()
        where id = 1`,
    )

    const text = await textOf((await made('measures')).id)

    expect(text).toContain('- Land und Ort des Servers: Nürnberg')
    expect(text).toContain('- Ja: eine Firewall lässt nur die nötigen Ports durch')
    expect(text).toContain('- Nein: die Datenträger des Servers sind verschlüsselt')
    expect(text).toContain('| Rechenbetrieb \\<Nord\\> | Server | Deutschland |')
    expect(text).toContain(
      '- **Teil B und Anlage 2:** von der Verwaltung der Instanz, zuletzt geändert am ',
    )
  })

  it('make the deletion concept with what is set at the operator and at the instance', async () => {
    await http()
      .put('/settings/memberships')
      .set(testIdentityHeader, by('u-lead'))
      .send({ removalDays: 30 })
      .expect(200)
    await http()
      .put('/settings/evidence-retention')
      .set(testIdentityHeader, by('u-lead'))
      .send({ minimumYears: 3 })
      .expect(200)

    const text = await textOf((await made('deletion')).id)

    expect(text).toContain('# Löschkonzept für Wohnbau \\<Nord\\> eG')
    expect(text).toContain('30 Tage nach dem letzten Tag ihres Zugangs')
    expect(text).toContain('frühestens nach 3 Jahren')
    expect(text).toContain('wenn 21 Generationen erreicht sind')
    expect((await listed()).kinds.find((kind) => kind.kind === 'deletion')?.facts).toContainEqual({
      label: 'Angaben eines beendeten Zugangs',
      value: 'nach 30 Tagen entfernen',
    })
  })

  it('are printed as they were made, with every character of the operator escaped', async () => {
    const version = await made('record')

    rendered.length = 0
    await http()
      .get(`/settings/privacy-documents/${version.id}/pdf`)
      .set(testIdentityHeader, by('u-lead'))
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
    await http()
      .get(`/settings/privacy-documents/${version.id}/pdf`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(403)

    const [job] = rendered

    expect(job?.html).toContain(
      '<h1>Verzeichnis der Verarbeitungstätigkeiten für Wohnbau &lt;Nord&gt; eG</h1>',
    )
    expect(job?.html).not.toContain('<Nord>')
    expect(job?.footerHtml).toContain('Wohnbau &lt;Nord&gt; eG')
  })
})
