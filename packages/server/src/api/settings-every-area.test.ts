import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  catalogueOf,
  type DefectClassSetting,
  type RoleKey,
  rightsOfRoles,
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
import { settingOfEveryArea } from './places.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The settings that hold in every area (section 7 of the concept): the page
 * of a label without an account and the categories of the faults (4.7), the
 * defaults of the classes of defects, the key day of the meters, the
 * retention of the evidence and of the rest, and what a service report
 * shows. Whoever changes one sees every area; a role of the operator's own
 * with the right to change the settings in some areas only is refused, as
 * the Leitung is not.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-site': 'site_management',
}

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

const lead = as(tenant, 'u-lead', 'management')

/** The Objektleitung, which holds in the one area, given the rights of the settings. */
const narrow = JSON.stringify({
  userId: 'u-site',
  tenantId: tenant,
  roles: ['site_management'],
  rights: [...rightsOfRoles(['site_management']), 'settings.read', 'settings.write'],
})

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

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

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        // The packages of the build beside the probe, for their classes of defects.
        catalogue: catalogueOf({
          ...probeCatalogueBundle,
          packages: [...catalogueBundle.packages, ...probeCatalogueBundle.packages],
        }),
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

/** The changes of every setting of every area, each as the Leitung may make it. */
async function changes(): Promise<
  { readonly method: 'put' | 'post' | 'delete'; readonly path: string; readonly body: object }[]
> {
  const category = (
    (
      await http()
        .post('/settings/fault-categories')
        .set(testIdentityHeader, lead)
        .send({ name: 'Probe Nord' })
        .expect(201)
    ).body as { id: string; name: string }[]
  ).find((each) => each.name === 'Probe Nord') ?? { id: '' }
  const [defectClass] = (
    await http().get('/settings/defect-classes').set(testIdentityHeader, lead).expect(200)
  ).body as DefectClassSetting[]
  const meters = (await http().get('/settings/meters').set(testIdentityHeader, lead).expect(200))
    .body as object
  const workOrders = (
    await http().get('/settings/work-orders').set(testIdentityHeader, lead).expect(200)
  ).body as object

  return [
    { method: 'put', path: '/settings/fault-reports', body: { openByLabel: true } },
    { method: 'post', path: '/settings/fault-categories', body: { name: 'Probe Süd' } },
    {
      method: 'put',
      path: `/settings/fault-categories/${category.id}`,
      body: { name: 'Probe Mitte' },
    },
    { method: 'delete', path: `/settings/fault-categories/${category.id}`, body: {} },
    {
      method: 'put',
      path: `/settings/defect-classes/${String(defectClass?.key)}`,
      body: { dueDays: 30 },
    },
    { method: 'put', path: '/settings/meters', body: meters },
    { method: 'put', path: '/settings/evidence-retention', body: {} },
    { method: 'put', path: '/settings/record-retention', body: {} },
    { method: 'put', path: '/settings/work-orders', body: workOrders },
  ]
}

describe('a setting that holds in every area', () => {
  it('is changed only by whoever sees every area, not by a role that holds the right in some', async () => {
    const all = await changes()

    for (const change of all) {
      const refused = await http()
        [change.method](change.path)
        .set(testIdentityHeader, narrow)
        .send(change.body)

      expect([change.path, refused.status]).toEqual([change.path, 403])
      expect((refused.body as { message: string }).message).toBe(settingOfEveryArea)
    }

    for (const change of all) {
      const taken = await http()
        [change.method](change.path)
        .set(testIdentityHeader, lead)
        .send(change.body)

      expect([change.path, taken.status < 300]).toEqual([change.path, true])
    }
  })

  it('stays readable for whoever sees the settings in some areas', async () => {
    await http().get('/settings/fault-reports').set(testIdentityHeader, narrow).expect(200)
    await http().get('/settings/fault-categories').set(testIdentityHeader, narrow).expect(200)
  })
})
