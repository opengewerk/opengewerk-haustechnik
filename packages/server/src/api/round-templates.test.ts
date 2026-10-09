import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  missingRight,
  type RoleKey,
  type TemplateDefinition,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
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
 * The templates of the rounds (#112, sections 2.5 and 4.5 of the concept): a
 * template is made with its first version, empty or taken over from a
 * package, and each change is the next version, which never changes. A
 * version is checked before it is saved, with the point named that is wrong;
 * a template that points into an area is changed only by somebody who sees
 * it.
 *
 * Two areas, north and south, with an asset in each; the Objektleitung and the
 * Haustechnik work in the north.
 */

const tenant = newId<'tenant'>() as TenantId
let north = ''
let south = ''
const northAsset = randomUUID()
const southAsset = randomUUID()
const goneAsset = randomUUID()
let ownDuty = ''
let reportDuty = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

type Person = keyof typeof people & string

/** The probe catalogue with a template of a round, to take over. */
const catalogue = catalogueOf({
  ...probeCatalogueBundle,
  packages: probeCatalogueBundle.packages.map((pack) => ({
    ...pack,
    roundTemplates: [
      {
        key: 'probe.monthly_round',
        version: 2,
        validFrom: '2015-06-01',
        definition: {
          title: 'Monatsrundgang',
          sections: [
            {
              key: 'k1',
              title: 'Technik',
              fields: [{ kind: 'check_point', key: 'p1', label: 'Anzeigen ohne Störung' }],
            },
          ],
        },
        review: { checkedOn: '2026-10-04', accepted: null },
      },
    ],
  })),
})

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

function by(userId: Person): string {
  return as(tenant, userId, people[userId] as RoleKey)
}

/** A template of one chapter with these points. */
function templateWith(...fields: object[]): TemplateDefinition {
  return {
    title: 'Technikzentrale Schulhaus',
    sections: [{ key: 'k1', title: 'Heizraum E.14', fields }],
  } as TemplateDefinition
}

const temperature = (asset: string) => ({
  kind: 'measurement',
  key: 'p1',
  label: 'Temperatur am Speicheraustritt',
  unit: 'degrees_celsius',
  decimals: 1,
  required: true,
  limit: { kind: 'stated', bound: 'at_least', milli: 60_000, source: 'DVGW W 551' },
  about: { kind: 'asset', id: asset },
})

const remark = { kind: 'text', key: 'p2', label: 'Sonst aufgefallen', multiline: true }

/** What a request was answered with: its status and its sentence. */
async function answered(sent: request.Test) {
  const answer = await sent

  return {
    status: answer.status,
    message: answer.body.message as string | undefined,
    body: answer.body as Record<string, unknown>,
  }
}

function made(person: Person, definition: TemplateDefinition, extra: object = {}) {
  return answered(
    http()
      .post('/round-templates')
      .set(testIdentityHeader, by(person))
      .send({ definition, asksCountersignature: false, ...extra }),
  )
}

function versioned(person: Person, id: string, basedOn: number, definition: TemplateDefinition) {
  return answered(
    http()
      .post(`/round-templates/${id}/versions`)
      .set(testIdentityHeader, by(person))
      .send({ definition, asksCountersignature: true, basedOn }),
  )
}

/** The versions of a template as they stand: the number and the title of each. */
async function versionsOf(id: unknown) {
  const { rows } = await admin.query<{ form_version: number; title: string }>(
    `select form_version, definition->>'title' as title from round_template_versions
      where template_id = $1 order by form_version`,
    [id],
  )

  return rows
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Stadt Beispiel'])

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [tenant],
  )

  north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, role] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $1, $2)', [
      userId,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [role],
    ])
  }

  for (const userId of ['u-site', 'u-tech']) {
    await admin.query(
      'insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)',
      [tenant, userId, north],
    )
  }

  for (const [area, assets] of [
    [north, [northAsset, goneAsset]],
    [south, [southAsset]],
  ] as const) {
    const property = randomUUID()
    const building = randomUUID()

    await admin.query(
      `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
       values ($1, $2, $3, $4, 'Straße 1', '00001', 'Musterstadt', 'DE-BW')`,
      [property, tenant, area, `Campus ${area === north ? 'Nord' : 'Süd'}`],
    )
    await admin.query(
      `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
       values ($1, $2, $3, $4, 'Haus A', '{school}')`,
      [building, tenant, property, area],
    )

    for (const [index, asset] of assets.entries()) {
      await admin.query(
        `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
         values ($1, $2, $3, $4, $5, 'probe.elevator', $6, 'Aufzug')`,
        [asset, tenant, property, area, building, `AN-0000${String(area === north ? index : 9)}`],
      )
    }

    if (area === north) {
      const { rows: duties } = await admin.query<{ id: string; kind: string | null }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                             counting, interval_months, confirmed_by)
         values ($1, $2, $3, $4, 'Temperatur am Speicher', 'own_decision', 'Hygieneplan',
                 'from_performance', 1, 'u-lead')
         returning id, kind`,
        [tenant, property, area, northAsset],
      )
      const { rows: kept } = await admin.query<{ id: string }>(
        `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                             counting, interval_months, confirmed_by)
         values ($1, $2, $3, $4, 'probe.elevator_main_test', 1, 'from_performance', 24, 'u-lead')
         returning id`,
        [tenant, property, area, northAsset],
      )

      ownDuty = duties[0]?.id ?? ''
      reportDuty = kept[0]?.id ?? ''
    }
  }

  await admin.query('update assets set deleted_at = now() where id = $1', [goneAsset])

  database = Database.connect(applicationDatabaseUrl())

  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = moduleRef.createNestApplication()
  await app.init()
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a template of a round', () => {
  it('is made with its first version by whoever keeps the templates, and not by whoever only performs', async () => {
    const first = await made('u-site', templateWith(temperature(northAsset), remark))

    expect(first.status).toBe(201)
    expect(first.body['formVersion']).toBe(1)
    expect(await versionsOf(first.body['id'])).toEqual([
      { form_version: 1, title: 'Technikzentrale Schulhaus' },
    ])

    expect(await made('u-tech', templateWith(remark))).toMatchObject({
      status: 403,
      message: missingRight('template.write'),
    })
  })

  it('is refused with the point and the reason when the form engine refuses it, and nothing is saved', async () => {
    const before = await admin.query('select count(*)::int as n from round_templates')
    const refused = await made('u-site', templateWith({ ...temperature(northAsset), decimals: 4 }))

    expect(refused).toMatchObject({
      status: 400,
      message: '„Temperatur am Speicheraustritt“ zeigt null bis drei Nachkommastellen.',
    })
    expect((await admin.query('select count(*)::int as n from round_templates')).rows).toEqual(
      before.rows,
    )
  })

  it('is refused with a point whose key is no key, before anything reads it as a pattern', async () => {
    expect(await made('u-lead', templateWith({ ...remark, key: '(' }))).toMatchObject({
      status: 400,
      message:
        'Eine Vorlage hat eine Bezeichnung und Kapitel mit Punkten, jedes mit einem Schlüssel aus kleinen Buchstaben, Ziffern und Unterstrichen.',
    })
  })

  it('is refused with a point at an asset that is gone', async () => {
    expect(await made('u-lead', templateWith(temperature(goneAsset)))).toMatchObject({
      status: 400,
      message:
        '„Temperatur am Speicheraustritt“: Die Anlage gibt es nicht mehr oder nicht in Ihren Bereichen.',
    })
  })

  it('takes a duty only that takes a point of a round as its evidence', async () => {
    const point = (duty: string) => ({ ...temperature(northAsset), fulfils: duty })

    expect((await made('u-site', templateWith(point(ownDuty)))).status).toBe(201)
    expect(await made('u-site', templateWith(point(reportDuty)))).toMatchObject({
      status: 400,
      message:
        '„Temperatur am Speicheraustritt“: Diese Pflicht nimmt keinen Punkt eines Rundgangs als Nachweis.',
    })
  })

  it('takes the next version on the one the editor began from, and keeps every version as it was', async () => {
    const { body } = await made('u-site', templateWith(temperature(northAsset)))
    const id = body['id'] as string
    const renamed = { ...templateWith(temperature(northAsset), remark), title: 'Heizraum, täglich' }

    expect(await versioned('u-site', id, 1, renamed)).toMatchObject({
      status: 201,
      body: { id, formVersion: 2 },
    })
    expect(await versionsOf(id)).toEqual([
      { form_version: 1, title: 'Technikzentrale Schulhaus' },
      { form_version: 2, title: 'Heizraum, täglich' },
    ])
    expect(
      (await admin.query('select title from round_templates where id = $1', [id])).rows,
    ).toEqual([{ title: 'Heizraum, täglich' }])

    // Saved meanwhile by somebody else, and saved again unchanged.
    expect(await versioned('u-lead', id, 1, templateWith(remark))).toMatchObject({
      status: 409,
      message:
        'Inzwischen ist die Fassung 2 gespeichert. Sie steht jetzt im Editor; ändern Sie dort weiter.',
    })
    expect(await versioned('u-lead', id, 2, renamed)).toMatchObject({
      status: 400,
      message: 'Die Vorlage ist unverändert. Eine neue Fassung entsteht mit einer Änderung.',
    })
  })

  it('is changed only by somebody who sees everything it names, in the version that stands', async () => {
    const { body } = await made('u-duties', templateWith(temperature(southAsset)))
    const id = body['id'] as string

    expect(await versioned('u-site', id, 1, templateWith(remark))).toMatchObject({
      status: 403,
      message:
        'Diese Vorlage zeigt auf Anlagen, Räume oder Pflichten in Bereichen, die Sie nicht sehen. Ändern kann sie, wer diese Bereiche sieht.',
    })
    expect(await made('u-site', templateWith(temperature(southAsset)))).toMatchObject({
      status: 400,
      message:
        '„Temperatur am Speicheraustritt“: Die Anlage gibt es nicht mehr oder nicht in Ihren Bereichen.',
    })
    expect((await versioned('u-duties', id, 1, templateWith(remark))).status).toBe(201)
  })

  it('names the template of a package it was taken over from, in the version in force', async () => {
    const taken = await made('u-site', templateWith(remark), { sourceKey: 'probe.monthly_round' })
    const { rows } = await admin.query(
      'select source_key, source_version from round_templates where id = $1',
      [taken.body['id']],
    )

    expect(rows).toEqual([{ source_key: 'probe.monthly_round', source_version: 2 }])
    expect(
      await made('u-site', templateWith(remark), { sourceKey: 'probe.weekly_round' }),
    ).toMatchObject({ status: 400, message: 'Diese Vorlage bringt kein Paket dieses Servers mit.' })
  })

  it('keeps a version saved: the application neither changes nor removes one', async () => {
    const { body } = await made('u-lead', templateWith(remark))

    for (const statement of [
      sql`update round_template_versions set asks_countersignature = true
           where template_id = ${body['id'] as string}`,
      sql`delete from round_template_versions where template_id = ${body['id'] as string}`,
    ]) {
      const refusal = await database
        .forTenant({ tenantId: tenant, userId: 'u-lead' }, (tx) => tx.execute(statement))
        .then(
          () => 'accepted',
          (error: unknown) =>
            String((error as { cause?: { code?: unknown } }).cause?.code ?? 'unknown'),
        )

      // insufficient_privilege: the role has no such right on the table.
      expect(refusal).toBe('42501')
    }
  })

  it('counts the rounds on each of its versions', async () => {
    const { body } = await made('u-lead', templateWith(remark))
    const { rows } = await admin.query<{ property_id: string; area_id: string }>(
      'select property_id, area_id from assets where id = $1',
      [northAsset],
    )

    await admin.query(
      `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, form_key,
                               form_version)
       values ($1, $2, $3, $4, 'round', 'Technikzentrale', $5, 1)`,
      [
        tenant,
        rows[0]?.property_id,
        rows[0]?.area_id,
        northAsset,
        `template-${String(body['id'])}`,
      ],
    )

    const counted = await answered(
      http().get('/round-templates/rounds').set(testIdentityHeader, by('u-tech')),
    )

    expect(counted.body).toEqual([{ templateId: body['id'], formVersion: 1, rounds: 1 }])
  })
})
