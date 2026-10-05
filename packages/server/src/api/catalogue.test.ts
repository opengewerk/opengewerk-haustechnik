import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type CatalogueBundle,
  catalogueOf,
  missingRight,
  roleKeys,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { testIdentityHeader } from '../database/test-database.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The route a device fetches the catalogue of its server from (#90).
 *
 * No database: the catalogue is built into the server, and nothing of a
 * tenant is in the answer. The catalogue is the probe package, as in the
 * tests of the assets; the one this build ships has no package yet.
 */

const tenant = newId<'tenant'>() as TenantId
const database = Database.connect('postgres://unused')

let app: INestApplication
let shipped: INestApplication

async function serving(options: Parameters<typeof ApiModule.create>[2]): Promise<INestApplication> {
  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, options)],
  }).compile()
  const made = built.createNestApplication()

  await made.init()

  return made
}

beforeAll(async () => {
  app = await serving({ catalogue: catalogueOf(probeCatalogueBundle) })
  shipped = await serving({})
})

afterAll(async () => {
  await app.close()
  await shipped.close()
  await database.close()
})

/** Somebody who is signed in and holds exactly these rights. */
function holding(...rights: string[]): string {
  return JSON.stringify({ userId: 'u-somebody', tenantId: tenant, roles: [], rights })
}

describe('the catalogue of the server', () => {
  it('goes to a device whole, every entry and every rule with its review', async () => {
    const answer = await request(app.getHttpServer())
      .get('/catalogue')
      .set(testIdentityHeader, as(tenant, 'u-tech', 'technician'))
      .expect(200)
    const bundle = answer.body as CatalogueBundle

    expect(bundle).toEqual(probeCatalogueBundle)

    const reviews = bundle.packages.flatMap((entry) => [
      ...entry.assetKinds.map((each) => each.review),
      ...entry.dutyKinds.map((each) => each.review),
      ...entry.forms.map((each) => each.review),
      ...entry.roundTemplates.map((each) => each.review),
      ...entry.rules.map((each) => each.review),
      ...entry.defectClasses.map((each) => each.review),
    ])

    // An empty list would pass the check below and prove nothing.
    expect(reviews.length).toBeGreaterThanOrEqual(5)
    expect(reviews.every((review) => typeof review.checkedOn === 'string')).toBe(true)
    // Nobody has accepted an entry of the probe package, and the answer says so.
    expect(reviews.map((review) => review.accepted)).toEqual(reviews.map(() => null))
  })

  it('names its checksum alone, for a device that asks whether it holds the same one', async () => {
    const answer = await request(app.getHttpServer())
      .get('/catalogue/checksum')
      .set(testIdentityHeader, as(tenant, 'u-tech', 'technician'))
      .expect(200)

    expect(answer.body).toEqual({ sha256: probeCatalogueBundle.sha256 })
  })

  it('is the one this build ships where no other is handed in', async () => {
    const whole = await request(shipped.getHttpServer())
      .get('/catalogue')
      .set(testIdentityHeader, as(tenant, 'u-tech', 'technician'))
      .expect(200)
    const checksum = await request(shipped.getHttpServer())
      .get('/catalogue/checksum')
      .set(testIdentityHeader, as(tenant, 'u-tech', 'technician'))
      .expect(200)

    expect(whole.body).toEqual(catalogueBundle)
    expect(checksum.body).toEqual({ sha256: catalogueBundle.sha256 })
  })
})

describe('who reads the catalogue (section 7)', () => {
  it.each(roleKeys)('is everybody who works for a tenant: %s', async (role) => {
    for (const path of ['/catalogue', '/catalogue/checksum']) {
      await request(app.getHttpServer())
        .get(path)
        .set(testIdentityHeader, as(tenant, 'u-somebody', role))
        .expect(200)
    }
  })

  it('is whoever syncs a device, also without the right to read duties', async () => {
    for (const path of ['/catalogue', '/catalogue/checksum']) {
      await request(app.getHttpServer())
        .get(path)
        .set(testIdentityHeader, holding('sync.read'))
        .expect(200)
    }
  })

  it('is nobody without that right, and nobody who is not signed in', async () => {
    for (const path of ['/catalogue', '/catalogue/checksum']) {
      const refused = await request(app.getHttpServer())
        .get(path)
        .set(testIdentityHeader, holding('duty.read', 'asset.read'))
        .expect(403)

      expect((refused.body as { message: string }).message).toBe(missingRight('sync.read'))

      await request(app.getHttpServer()).get(path).expect(401)
    }
  })
})
