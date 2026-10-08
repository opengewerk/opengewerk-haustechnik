import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import { catalogueOf, type TenantId } from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { routesOf } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import {
  writtenColumnNames,
  writtenPlaceholders,
  writtenValues,
} from '../database/test-evidence.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * No route takes back what was signed or written down (ADR 0004, point 16):
 * there is no resetting that removes answers or signatures, on no way and
 * for no role. The database refuses every change to an evidence, a
 * signature, a decision and a declaration of invalidity; what it cannot know
 * is the result each duty of a signed activity carries and the state of the
 * activity, which a route could set back.
 *
 * So every route that works in a tenant is called, by the Leitung with every
 * right of the catalogue, with the key of every record of a written down
 * activity in every place of its path and with an empty body, and all of it
 * is what it was, to the byte. Not a list kept by hand: the routes come out
 * of the module, so one added later is called whether or not anybody
 * remembers this file. The routes before a sign-in, of a session alone and of
 * the instance are left out: they reach no record of a tenant.
 */

const tenant = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const colleague = 'u-tech'

/** The keys of the records of a written down activity, and of what hangs around it. */
const keys: Record<string, string> = {}

let admin: Pool
let database: Database
let app: INestApplication

/** One statement as the superuser, returning the key of the row it adds. */
async function added(statement: string, values: readonly unknown[]): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(`${statement} returning id`, [...values])

  return rows[0]?.id ?? ''
}

/**
 * What is not to change: every evidence, signature, decision and declaration
 * of invalidity whole, and the results and the state of every activity.
 */
async function signedAndWritten(): Promise<unknown> {
  const { rows } = await admin.query<{ rows: unknown }>(
    `select jsonb_agg(entry order by entry::text) as rows from (
       select jsonb_build_object('table', 'evidence') || to_jsonb(e) as entry from evidence e
       union all
       select jsonb_build_object('table', 'activity_signatures') || to_jsonb(s)
         from activity_signatures s
       union all
       select jsonb_build_object('table', 'work_order_decisions') || to_jsonb(d)
         from work_order_decisions d
       union all
       select jsonb_build_object('table', 'evidence_voidings') || to_jsonb(v)
         from evidence_voidings v
       union all
       select jsonb_build_object('table', 'activity_duties', 'id', id, 'result', result,
                                 'result_reason', result_reason)
         from activity_duties
       union all
       select jsonb_build_object('table', 'activities', 'id', id, 'status', status,
                                 'performed_on', performed_on,
                                 'countersignature_required', countersignature_required)
         from activities
     ) entries`,
  )

  return rows[0]?.rows
}

/** Every way to fill the places of a path with the keys there are. */
function pathsOf(path: string): string[] {
  const place = /:[A-Za-z]+/.exec(path)

  if (place === null) {
    return [path]
  }

  const candidates = [...Object.values(keys), lead, colleague, 'duty.due']

  return candidates.flatMap((key) => pathsOf(path.replace(place[0], key)))
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  for (const [userId, role] of [
    [lead, 'management'],
    [colleague, 'technician'],
  ] as const) {
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

  const area = (
    await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [tenant])
  ).rows[0]?.id

  keys['property'] = await added(
    `insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [tenant, area],
  )

  const at = [tenant, keys['property'], area]

  keys['building'] = await added(
    `insert into buildings (tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, 'Haus A', '{school}')`,
    at,
  )
  keys['floor'] = await added(
    `insert into floors (tenant_id, property_id, area_id, building_id, name, level)
     values ($1, $2, $3, $4, 'Erdgeschoss', 0)`,
    [...at, keys['building']],
  )
  keys['room'] = await added(
    `insert into rooms (tenant_id, property_id, area_id, building_id, floor_id, number, name)
     values ($1, $2, $3, $4, $5, '0.12', 'Technik')`,
    [...at, keys['building'], keys['floor']],
  )
  keys['asset'] = await added(
    `insert into assets (tenant_id, property_id, area_id, building_id, room_id, kind, number, name)
     values ($1, $2, $3, $4, $5, 'probe.elevator', 'AN-00001', 'Aufzug Haus A')`,
    [...at, keys['building'], keys['room']],
  )
  keys['lifecycle'] = await added(
    `insert into asset_lifecycle (tenant_id, property_id, area_id, asset_id, state, valid_from)
     values ($1, $2, $3, $4, 'in_service', '2020-01-01')`,
    [...at, keys['asset']],
  )
  keys['duty'] = await added(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by)
     values ($1, $2, $3, $4, 'Sichtprüfung', 'manufacturer', 'Betriebsanleitung',
             'from_performance', 12, $5)`,
    [...at, keys['asset'], lead],
  )
  keys['activity'] = await added(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             performed_on)
     values ($1, $2, $3, $4, 'inspection', 'Sichtprüfung Aufzug', 'done', '2026-10-01')`,
    [...at, keys['asset']],
  )
  keys['activityDuty'] = await added(
    `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result)
     values ($1, $2, $3, $4, $5, 'with_defects')`,
    [...at, keys['activity'], keys['duty']],
  )
  keys['signature'] = await added(
    `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                      signed_at, path, page_fingerprint)
     values ($1, $2, $3, $4, $5, 'signer', '2026-10-01T09:30:00Z', 'M10,10L200,300', $6)`,
    [...at, keys['activity'], colleague, 'a'.repeat(64)],
  )
  keys['defect'] = await added(
    `insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                          description, found_on)
     values ($1, $2, $3, $4, $5, 'Notruf im Fahrkorb ohne Verbindung.', '2026-10-01')`,
    [...at, keys['asset'], keys['activity']],
  )

  /** An evidence of the duty, a correction where it names the evidence it replaces. */
  const evidenceOf = (
    performedOn: string,
    replaces: { readonly id: string; readonly reason: string } | null = null,
  ) => {
    const values = [
      ...at,
      keys['duty'],
      performedOn,
      ...writtenValues(lead, performedOn, 'with_defects'),
      ...(replaces === null ? [] : [replaces.id, replaces.reason]),
    ]

    return added(
      `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                             ${writtenColumnNames}${replaces === null ? '' : ', replaces_evidence_id, replacement_reason'})
       values ($1, $2, $3, $4, $5, 'with_defects', ${writtenPlaceholders(6)}${
         replaces === null ? '' : `, $${String(values.length - 1)}, $${String(values.length)}`
       })`,
      values,
    )
  }

  keys['evidence'] = await evidenceOf('2026-10-01')
  keys['correction'] = await evidenceOf('2026-09-30', {
    id: keys['evidence'] ?? '',
    reason: 'Falscher Tag.',
  })
  keys['voided'] = await evidenceOf('2026-09-15')
  keys['voiding'] = await added(
    `insert into evidence_voidings (tenant_id, property_id, area_id, evidence_id, reason, voided_by)
     values ($1, $2, $3, $4, 'Der Bericht gehört zu einer anderen Anlage.', $5)`,
    [...at, keys['voided'], lead],
  )

  // A work order, signed and turned back.
  keys['orderActivity'] = await added(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             performed_on)
     values ($1, $2, $3, $4, 'work_order', 'Notruf instand setzen', 'started', '2026-10-02')`,
    [...at, keys['asset']],
  )
  keys['workOrder'] = await added(
    `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
     values ($1, $2, $3, $4, 'AU-2026-0001', 'other')`,
    [...at, keys['orderActivity']],
  )
  keys['orderSignature'] = await added(
    `insert into activity_signatures (tenant_id, property_id, area_id, activity_id, signed_by, role,
                                      signed_at, path, page_fingerprint)
     values ($1, $2, $3, $4, $5, 'signer', '2026-10-02T10:00:00Z', 'M10,10L200,300', $6)`,
    [...at, keys['orderActivity'], colleague, 'b'.repeat(64)],
  )
  keys['decision'] = await added(
    `insert into work_order_decisions (tenant_id, property_id, area_id, work_order_id, decision,
                                       reason, decided_by)
     values ($1, $2, $3, $4, 'rejected', 'Der Notruf geht noch nicht.', $5)`,
    [...at, keys['workOrder'], lead],
  )
  keys['unknown'] = randomUUID()

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

describe('a written down activity', () => {
  it('keeps its answers, signatures, decisions and evidence through every route there is', async () => {
    const before = await signedAndWritten()
    const routes = routesOf(
      ApiModule.create(database, testIdentities, { catalogue: catalogueOf(probeCatalogueBundle) })
        .controllers ?? [],
    ).filter((route) => route.permission !== undefined)
    const header = as(tenant, lead, 'management')
    const answered = new Map<number, number>()

    for (const route of routes) {
      const [method = '', path = ''] = route.name.split(' ')

      for (const filled of pathsOf(path)) {
        const call = request(app.getHttpServer())
        const pending =
          method === 'GET'
            ? call.get(filled)
            : method === 'POST'
              ? call.post(filled)
              : method === 'PUT'
                ? call.put(filled)
                : method === 'PATCH'
                  ? call.patch(filled)
                  : call.delete(filled)
        const response = await pending.set(testIdentityHeader, header).send({})

        answered.set(response.status, (answered.get(response.status) ?? 0) + 1)
      }
    }

    expect(await signedAndWritten()).toEqual(before)

    // The routes were reached with keys they know: without this the sameness
    // above could come from calls that never found a record.
    expect(routes.length).toBeGreaterThanOrEqual(40)
    expect(answered.get(200) ?? 0).toBeGreaterThanOrEqual(20)
  })
})
