import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityDetails,
  type ActivityId,
  type ActivityList,
  addDays,
  addMonths,
  type CatalogueBundle,
  catalogueOf,
  type CollectiveCandidates,
  type DutyDetails,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, FileStore, newId } from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { pageFingerprint, pageOf, takeSignature } from '../activities/signing.js'
import { activities } from '../database/schema/index.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * Collective activities (#342, section 4.4 of the concept): composed in the
 * office from a duty kind and a place, of the duties in the area of that
 * place; a part for each duty, at its asset, with its own protocol and
 * result; planned and closed as a whole; signed once under a page that names
 * every asset with its result, and one evidence per duty, each naming that
 * signature; and the report of a contractor for all its assets in one go.
 */

const tenant = newId<'tenant'>() as TenantId

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Petra Lindner' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
  // Leads a site in the south, and sees the southern area alone.
  'u-south': { role: 'site_management', name: 'Dennis Roth' },
}

const keptTest = 'probe.elevator_kept_test'
const mainTest = 'probe.elevator_main_test'
const form = 'probe.extinguisher_check'

/**
 * The probe package with a duty kind that takes a protocol in a form of one
 * check point, as a test of fire extinguishers does, beside the main test of
 * the package, which takes a report alone.
 */
function withAKeptTest(bundle: CatalogueBundle): CatalogueBundle {
  return {
    ...bundle,
    packages: bundle.packages.map((pack) => {
      const main = pack.dutyKinds.find((entry) => entry.key === mainTest)

      if (main === undefined) {
        return pack
      }

      return {
        ...pack,
        dutyKinds: [
          ...pack.dutyKinds,
          {
            ...main,
            key: keptTest,
            definition: {
              ...main.definition,
              label: 'Prüfung der Feuerlöscher',
              counting: 'from_performance',
              evidence: { kinds: ['protocol', 'report'], form },
            },
          },
        ],
        forms: [
          ...pack.forms,
          {
            key: form,
            version: 1,
            validFrom: '2015-06-01',
            definition: {
              title: 'Feuerlöscher',
              sections: [
                {
                  key: 'check',
                  title: 'Prüfen',
                  fields: [{ kind: 'check_point', key: 'seal', label: 'Plombe' }],
                },
              ],
            },
            review: { checkedOn: '2026-10-04', accepted: null },
          },
        ],
      }
    }),
  }
}

const catalogue = catalogueOf(withAKeptTest(probeCatalogueBundle))
const today = dayInGermany()
const yesterday = addDays(today, -1)
const folder = mkdtempSync(join(tmpdir(), 'collectives-'))
const fileSha = 'c'.repeat(64)

let admin: Pool
let database: Database
let app: INestApplication
let property = ''
let southArea = ''
const buildings: Record<string, string> = {}

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId]?.role as RoleKey)
}

async function one<T>(query: string, values: unknown[] = []): Promise<T> {
  return (await admin.query(query, values)).rows[0] as T
}

/** A route that makes something, as a person, failing the test where it is refused. */
async function made(
  path: string,
  body: object,
  userId = 'u-duties',
  method: 'post' | 'patch' = 'post',
) {
  const answer = await http()[method](path).set(testIdentityHeader, by(userId)).send(body)

  if (answer.status >= 300) {
    throw new Error(`${path}: ${JSON.stringify(answer.body)}`)
  }

  return answer.body.id as string
}

/** A new building of the property with fire extinguishers in it, and a duty of a kind at each. */
async function extinguishersIn(
  name: string,
  count: number,
  kind = keptTest,
): Promise<{ readonly building: string; readonly assets: string[]; readonly duties: string[] }> {
  const building = await made(`/properties/${property}/buildings`, { name, kinds: ['school'] })
  const assets: string[] = []
  const duties: string[] = []

  for (let index = 0; index < count; index++) {
    const asset = await made(`/buildings/${building}/assets`, {
      kind: 'probe.elevator',
      name: `Feuerlöscher ${name} ${String(index + 1)}`,
    })

    assets.push(asset)
    duties.push(await dutyAt(asset, kind))
  }

  buildings[name] = building

  return { building, assets, duties }
}

/** A duty of a kind at an asset, never recorded, every twelve months. */
async function dutyAt(asset: string, kind = keptTest): Promise<string> {
  return (
    await one<{ id: string }>(
      `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                           interval_months, confirmed_by)
       select tenant_id, property_id, area_id, id, $2, 1, 'from_performance', 12, 'u-duties'
         from assets where id = $1
       returning id`,
      [asset, kind],
    )
  ).id
}

/** A single activity for a duty in a state, as the engine makes one and a device begins it. */
async function singleFor(duty: string, status = 'open'): Promise<string> {
  return (
    await one<{ id: string }>(
      `with activity as (
         insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                                 due_on, performer, performer_user_id, form_key, form_version)
         select tenant_id, property_id, area_id, asset_id, 'inspection', 'Prüfung der Feuerlöscher',
                $2, $3, 'own_staff', 'u-tech', $4, 1
           from duties where id = $1
         returning id, tenant_id, property_id, area_id
       ), line as (
         insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
         select tenant_id, property_id, area_id, id, $1 from activity
       )
       select id from activity`,
      [duty, status, addDays(today, 10), form],
    )
  ).id
}

/** The plan of a collective activity, performed by the own people. */
function planOf(dutyIds: readonly string[], place: { buildingId?: string; roomId?: string } = {}) {
  return {
    dutyKind: keptTest,
    propertyId: property,
    buildingId: place.buildingId ?? null,
    roomId: place.roomId ?? null,
    title: 'Prüfung der Feuerlöscher',
    dutyIds,
    responsibleUserId: 'u-site',
    performer: 'own_staff',
    performerUserId: 'u-tech',
    contractorNote: null,
    contractorId: null,
    dueOn: addDays(today, 14),
  }
}

function compose(body: object, userId = 'u-duties') {
  return http().post('/collectives').set(testIdentityHeader, by(userId)).send(body)
}

/** The parts of a collective activity as the database holds them. */
async function partsOf(collective: string) {
  return (
    await admin.query<{
      id: string
      asset_id: string
      status: string
      performer_user_id: string | null
      responsible_user_id: string | null
      form_key: string | null
      duty_id: string
      result: string | null
    }>(
      `select a.id, a.asset_id, a.status, a.performer_user_id, a.responsible_user_id, a.form_key,
              d.duty_id, d.result
         from activities a join activity_duties d on d.activity_id = a.id
        where a.collective_id = $1 order by a.asset_id`,
      [collective],
    )
  ).rows
}

async function candidates(address: string, userId = 'u-duties'): Promise<CollectiveCandidates> {
  return (
    await http()
      .get(`/collectives/candidates?${address}`)
      .set(testIdentityHeader, by(userId))
      .expect(200)
  ).body as CollectiveCandidates
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Probe'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@beispiel.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [person.role],
    ])
  }

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, { catalogue, files: new FileStore(folder) }),
    ],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  property = await made('/properties', {
    name: 'Verwaltung Am Probehang',
    street: 'Probeweg 1',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
  })
  southArea = await made('/areas', { name: 'Süd' }, 'u-lead')
  // Whoever leads in the south sees the south alone.
  await admin.query('delete from member_all_areas where tenant_id = $1 and user_id = $2', [
    tenant,
    'u-south',
  ])
  await admin.query('delete from member_areas where tenant_id = $1 and user_id = $2', [
    tenant,
    'u-south',
  ])
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    tenant,
    'u-south',
    southArea,
  ])
  await admin.query(
    `insert into files (tenant_id, sha256, size_bytes, media_type) values ($1, $2, 2048, 'application/pdf')`,
    [tenant, fileSha],
  )
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('composing a collective activity', () => {
  it('offers the duty kinds at a place and the duties of one, and counts those in another area', async () => {
    const a = await extinguishersIn('Haus A', 3)
    const s = await extinguishersIn('Haus S', 1)

    await made(`/buildings/${s.building}`, { ownAreaId: southArea }, 'u-lead', 'patch')
    await dutyAt(a.assets[0] as string, mainTest)

    const atTheProperty = await candidates(`property=${property}&kind=${keptTest}`)

    expect(atTheProperty.kinds).toEqual(
      expect.arrayContaining([
        { key: keptTest, label: 'Prüfung der Feuerlöscher', duties: 3 },
        { key: mainTest, label: 'Hauptprüfung der Aufzugsanlage', duties: 1 },
      ]),
    )
    expect(atTheProperty.candidates.map((each) => each.dutyId).sort()).toEqual([...a.duties].sort())
    // The extinguisher in the building with an area of its own is counted, not offered.
    expect(atTheProperty.elsewhere).toBe(1)
    expect(atTheProperty.candidates[0]).toMatchObject({
      title: 'Prüfung der Feuerlöscher',
      state: 'never_recorded',
      activity: null,
    })
    expect(atTheProperty.people.performers.map((each) => each.name)).toContain('Tobias Wendt')

    const atTheBuilding = await candidates(
      `property=${property}&building=${a.building}&kind=${keptTest}`,
    )

    expect(atTheBuilding.candidates).toHaveLength(3)
    expect(atTheBuilding.elsewhere).toBe(0)
  })

  it('makes it at its place with a part for each duty at its asset, and an open activity of a duty becomes its part', async () => {
    const b = await extinguishersIn('Haus B', 3)
    const open = await singleFor(b.duties[1] as string)
    const answer = await compose(planOf(b.duties, { buildingId: b.building })).expect(201)
    const collective = answer.body.id as string

    expect(
      await one(
        `select kind, status, collective_kind, building_id, asset_id, form_key, performer_user_id,
                responsible_user_id
           from activities where id = $1`,
        [collective],
      ),
    ).toEqual({
      kind: 'inspection',
      status: 'open',
      collective_kind: keptTest,
      building_id: b.building,
      asset_id: null,
      form_key: null,
      performer_user_id: 'u-tech',
      responsible_user_id: 'u-site',
    })

    const parts = await partsOf(collective)

    expect(parts.map((part) => part.duty_id).sort()).toEqual([...b.duties].sort())
    expect(parts.map((part) => part.asset_id).sort()).toEqual([...b.assets].sort())
    // The open activity went up in it: the same activity, with the plan of the collective one.
    expect(parts.find((part) => part.duty_id === b.duties[1])?.id).toBe(open)
    expect(
      parts.every((part) => part.form_key === form && part.performer_user_id === 'u-tech'),
    ).toBe(true)
    expect(parts.every((part) => part.responsible_user_id === 'u-site')).toBe(true)
  })

  it('refuses a duty of another kind, at another place, in another area, and one somebody began', async () => {
    const c = await extinguishersIn('Haus C', 2)
    const d = await extinguishersIn('Haus D', 1)
    const other = await dutyAt(c.assets[0] as string, mainTest)
    const s = await extinguishersIn('Haus T', 1)

    await made(`/buildings/${s.building}`, { ownAreaId: southArea }, 'u-lead', 'patch')

    const before = await one<{ n: number }>(
      'select count(*)::int as n from activities where collective_kind is not null',
    )

    expect(
      (
        await compose(planOf([c.duties[0] as string, other], { buildingId: c.building })).expect(
          400,
        )
      ).body.message,
    ).toBe('Ein Sammelvorgang nimmt laufende Pflichten seiner Pflichtart an seinem Ort.')
    expect(
      (
        await compose(
          planOf([c.duties[0] as string, d.duties[0] as string], { buildingId: c.building }),
        ).expect(400)
      ).body.message,
    ).toBe('Ein Sammelvorgang nimmt laufende Pflichten seiner Pflichtart an seinem Ort.')
    expect(
      (await compose(planOf([c.duties[0] as string, s.duties[0] as string])).expect(400)).body
        .message,
    ).toBe(
      'Ein Sammelvorgang nimmt nur Pflichten im Bereich seines Orts. Eine Anlage in einem Gebäude mit eigenem Bereich kommt in einen Sammelvorgang an diesem Gebäude.',
    )

    await singleFor(c.duties[1] as string, 'started')

    expect(
      (await compose(planOf(c.duties, { buildingId: c.building })).expect(409)).body.message,
    ).toMatch(
      /läuft ein Vorgang, den jemand begonnen hat oder der ein Auftrag ist; er bleibt für sich\.$/,
    )
    expect(
      await one<{ n: number }>(
        'select count(*)::int as n from activities where collective_kind is not null',
      ),
    ).toEqual(before)
  })

  it('is composed by whoever plans, and only of places and duties in their areas', async () => {
    const e = await extinguishersIn('Haus E', 1)
    const s = await extinguishersIn('Haus U', 2)

    await made(`/buildings/${s.building}`, { ownAreaId: southArea }, 'u-lead', 'patch')

    // Whoever only performs plans nothing.
    await compose(planOf(e.duties, { buildingId: e.building }), 'u-tech').expect(403)
    // Whoever leads in the south does not see the building in the north …
    await compose(planOf(e.duties, { buildingId: e.building }), 'u-south').expect(404)
    // … nor writes at the property itself, which belongs to the other area …
    await compose(planOf(s.duties), 'u-south').expect(403)
    // … and is offered no duty of the north at the property.
    expect(
      (await candidates(`property=${property}&kind=${keptTest}`, 'u-south')).candidates,
    ).toEqual([])
    // A duty in the north is no duty at the building in the south.
    await compose(
      planOf([s.duties[0] as string, e.duties[0] as string], { buildingId: s.building }),
      'u-south',
    ).expect(400)

    const south = await compose(
      {
        ...planOf(s.duties, { buildingId: s.building }),
        responsibleUserId: 'u-south',
        performerUserId: null,
      },
      'u-south',
    ).expect(201)

    expect(await partsOf(south.body.id as string)).toHaveLength(2)
  })
})

describe('a collective activity in the office', () => {
  it('stands in the list once with its parts counted, its page names each part, and a part names it', async () => {
    const f = await extinguishersIn('Haus F', 2)
    const collective = (await compose(planOf(f.duties, { buildingId: f.building })).expect(201))
      .body.id as string
    const list = (
      await http().get('/activities?limit=200').set(testIdentityHeader, by('u-duties')).expect(200)
    ).body as ActivityList
    const parts = await partsOf(collective)

    expect(list.activities.find((entry) => entry.id === collective)).toMatchObject({
      collective: { kind: keptTest, label: 'Prüfung der Feuerlöscher', parts: 2, withResult: 0 },
    })
    expect(list.activities.some((entry) => parts.some((part) => part.id === entry.id))).toBe(false)

    const page = (
      await http()
        .get(`/activities/${collective}`)
        .set(testIdentityHeader, by('u-duties'))
        .expect(200)
    ).body as ActivityDetails

    expect(page.parts?.map((part) => part.asset?.id).sort()).toEqual([...f.assets].sort())
    expect(page.parts?.[0]).toMatchObject({ status: 'open', result: null, evidence: null })

    const partPage = (
      await http()
        .get(`/activities/${parts[0]?.id ?? ''}`)
        .set(testIdentityHeader, by('u-duties'))
        .expect(200)
    ).body as ActivityDetails

    expect(partPage.partOf).toEqual({
      id: collective,
      title: 'Prüfung der Feuerlöscher',
      underWay: true,
    })
  })

  it('is planned for all of its parts, and a part is neither planned nor closed on its own', async () => {
    const g = await extinguishersIn('Haus G', 2)
    const collective = (await compose(planOf(g.duties, { buildingId: g.building })).expect(201))
      .body.id as string
    const [part] = await partsOf(collective)
    const plan = {
      responsibleUserId: 'u-duties',
      performer: 'own_staff',
      performerUserId: null,
      contractorNote: null,
      dueOn: addDays(today, 20),
    }

    await http()
      .put(`/activities/${collective}/plan`)
      .set(testIdentityHeader, by('u-duties'))
      .send(plan)
      .expect(200)

    expect(
      (await partsOf(collective)).map((each) => [each.responsible_user_id, each.performer_user_id]),
    ).toEqual([
      ['u-duties', null],
      ['u-duties', null],
    ])
    expect(
      (
        await http()
          .put(`/activities/${part?.id ?? ''}/plan`)
          .set(testIdentityHeader, by('u-duties'))
          .send(plan)
          .expect(409)
      ).body.message,
    ).toBe('Geplant wird der Sammelvorgang; jede Anlage darin folgt ihm.')
    expect(
      (
        await http()
          .post(`/activities/${part?.id ?? ''}/close`)
          .set(testIdentityHeader, by('u-duties'))
          .send({ closingReason: 'Nicht erreichbar.' })
          .expect(409)
      ).body.message,
    ).toMatch(/^Eine Anlage im Sammelvorgang wird nicht für sich geschlossen\./)
  })

  it('closes with the reason, with every part, and no evidence comes of it', async () => {
    const h = await extinguishersIn('Haus H', 2)
    const collective = (await compose(planOf(h.duties, { buildingId: h.building })).expect(201))
      .body.id as string

    await http()
      .post(`/activities/${collective}/close`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ closingReason: 'Haus H ist wegen der Sanierung gesperrt.' })
      .expect(201)

    expect((await partsOf(collective)).map((part) => [part.status, part.result])).toEqual([
      ['not_performed', 'not_performed'],
      ['not_performed', 'not_performed'],
    ])
    expect(
      await one('select count(*)::int as n from evidence where duty_id = any($1)', [h.duties]),
    ).toEqual({ n: 0 })
  })
})

/** Runs some work as a person, with the context of writing down. */
function asPerson<Result>(
  userId: string,
  work: (
    tx: Parameters<Parameters<Database['forTenant']>[1]>[0],
    context: Parameters<typeof takeSignature>[1],
  ) => Promise<Result>,
): Promise<Result> {
  return database.forTenant({ tenantId: tenant, userId }, (tx) =>
    work(tx, {
      tenantId: tenant,
      writtenBy: userId,
      at: new Date(),
      catalogue,
      nameOf: (id) => people[id]?.name ?? 'Unbekanntes Konto',
    }),
  )
}

/** Signs an activity as the person, for the page as the server works it out. */
function signed(activityId: string, userId = 'u-tech') {
  return asPerson(userId, async (tx, context) => {
    const [row] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.tenantId, tenant), eq(activities.id, activityId as ActivityId)))

    if (row === undefined) {
      throw new Error('No such activity')
    }

    return takeSignature(tx, context, {
      activityId: activityId as ActivityId,
      role: 'signer',
      signedAt: new Date(),
      deviceInfo: null,
      path: 'M10,10L200,300',
      typedName: null,
      pageFingerprint: pageFingerprint(await pageOf(tx, row)),
    })
  })
}

/** A part as the device leaves it: begun yesterday, with its result, and the seal answered where given. */
async function worked(
  part: string,
  result: string,
  seal: 'ok' | 'not_ok' | null,
  reason: string | null = null,
): Promise<void> {
  await admin.query(`update activities set status = 'started', performed_on = $2 where id = $1`, [
    part,
    yesterday,
  ])
  await admin.query(
    'update activity_duties set result = $2, result_reason = $3 where activity_id = $1',
    [part, result, reason],
  )

  if (seal !== null) {
    await admin.query(
      `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, result, remark)
       select tenant_id, property_id, area_id, id, 'seal', $2, $3 from activities where id = $1`,
      [part, seal, seal === 'not_ok' ? 'Plombe fehlt' : null],
    )
  }
}

describe('the one signature', () => {
  it('signs every asset at once, each duty gets its own evidence, and a due day moves only with it', async () => {
    const k = await extinguishersIn('Haus K', 3)
    const collective = (await compose(planOf(k.duties, { buildingId: k.building })).expect(201))
      .body.id as string
    const byAsset = new Map((await partsOf(collective)).map((part) => [part.asset_id, part]))
    const [met, found, unreachable] = k.assets.map((asset) => byAsset.get(asset)?.id ?? '')

    await admin.query(`update activities set status = 'started' where id = $1`, [collective])
    await worked(met as string, 'without_defects', null)
    await worked(found as string, 'with_defects', 'not_ok')
    // Could not be reached: not performed with the reason, and no answer.
    await worked(unreachable as string, 'not_performed', null, 'Raum verschlossen')

    // A part is signed with its collective activity and not on its own.
    await expect(signed(met as string)).rejects.toThrow(
      'Unterschrieben wird der Sammelvorgang, einmal für alle seine Anlagen.',
    )
    // An asset that was performed answers every point of its protocol.
    await expect(signed(collective)).rejects.toThrow(
      'Feuerlöscher Haus K 1: Jeder Punkt braucht seine Antwort, bevor unterschrieben wird.',
    )

    await admin.query(
      `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key, result)
       select tenant_id, property_id, area_id, id, 'seal', 'ok' from activities where id = $1`,
      [met],
    )

    const taken = await signed(collective)

    expect(taken.status).toBe('done')
    expect(taken.written).toHaveLength(3)

    const written = (
      await admin.query<{
        duty_id: string
        activity_id: string
        result: string
        origin: string
        state: Record<string, unknown>
      }>(
        `select duty_id, activity_id, result, origin, state from evidence where duty_id = any($1)`,
        [k.duties],
      )
    ).rows

    expect(written.map((row) => [row.duty_id, row.activity_id, row.result]).sort()).toEqual(
      [
        [k.duties[0], met, 'without_defects'],
        [k.duties[1], found, 'with_defects'],
        [k.duties[2], unreachable, 'not_performed'],
      ].sort(),
    )

    for (const row of written) {
      expect(row.origin).toBe('protocol')
      expect(row.state['collective']).toEqual({ title: 'Prüfung der Feuerlöscher', parts: 3 })
      expect((row.state['signatures'] as { name: string }[]).map((each) => each.name)).toEqual([
        'Tobias Wendt',
      ])
    }

    // Each evidence states its own asset and only its own answers.
    expect(written.find((row) => row.activity_id === unreachable)?.state['answers']).toEqual([])
    // The seal not in order is a defect at its own asset.
    expect(
      await one(
        'select asset_id, found_in_activity_id from defects where found_in_activity_id = $1',
        [found],
      ),
    ).toEqual({ asset_id: k.assets[1], found_in_activity_id: found })
    expect(
      (
        await one<{ statuses: string[] }>(
          `select array_agg(status::text order by status) as statuses from activities
          where id = $1 or collective_id = $1`,
          [collective],
        )
      ).statuses,
    ).toEqual(['done', 'done', 'done', 'done'])

    // The due day of each duty moves with its own evidence: the two that met
    // their duty from yesterday, the one not performed not at all.
    const due = async (duty: string) =>
      (
        (await http().get(`/duties/${duty}`).set(testIdentityHeader, by('u-duties')).expect(200))
          .body as DutyDetails
      ).appointment?.dueOn ?? null
    expect(await due(k.duties[0] as string)).toBe(addMonths(yesterday, 12))
    expect(await due(k.duties[1] as string)).toBe(addMonths(yesterday, 12))
    expect(await due(k.duties[2] as string)).toBeNull()
  })
})

describe('the report of a contractor for all its assets', () => {
  /** A collective activity of a contractor at a new building with two extinguishers. */
  async function byAContractor(name: string) {
    const m = await extinguishersIn(name, 2)
    const collective = (
      await compose({
        ...planOf(m.duties, { buildingId: m.building }),
        performer: 'contractor',
        performerUserId: null,
        contractorNote: 'Brandschutz Beispiel GmbH',
      }).expect(201)
    ).body.id as string
    const byAsset = new Map((await partsOf(collective)).map((part) => [part.asset_id, part.id]))

    return { ...m, collective, parts: m.assets.map((asset) => byAsset.get(asset) ?? '') }
  }

  /** The report with a result for each part, the second with a defect. */
  function reportOf(parts: readonly string[]) {
    return {
      performedOn: yesterday,
      examiner: 'Klaus Berger',
      examinerOrganisation: 'Brandschutz Beispiel GmbH',
      contractorId: null,
      file: {
        sha256: fileSha,
        fileName: 'bericht-haus-m.pdf',
        sizeBytes: 2048,
        previewSha256: null,
      },
      parts: [
        { activityId: parts[0], result: 'without_defects', resultReason: null, defects: [] },
        {
          activityId: parts[1],
          result: 'with_defects',
          resultReason: null,
          defects: [{ description: 'Plombe fehlt', defectClass: null, dueOn: null }],
        },
      ],
    }
  }

  it('writes one evidence per duty with the file once, each defect at its asset, and settles every part', async () => {
    const m = await byAContractor('Haus M')
    const answer = await http()
      .post(`/collectives/${m.collective}/report`)
      .set(testIdentityHeader, by('u-site'))
      .send(reportOf(m.parts))
      .expect(201)

    expect(answer.body).toHaveLength(2)
    expect(
      await one(
        `select count(*)::int as n, min(building_id::text) as building from attachments
          where tenant_id = $1 and kind = 'test_certificate' and building_id = $2`,
        [tenant, m.building],
      ),
    ).toEqual({ n: 1, building: m.building })

    const written = (
      await admin.query<{ activity_id: string; origin: string; state: Record<string, unknown> }>(
        'select activity_id, origin, state from evidence where duty_id = any($1)',
        [m.duties],
      )
    ).rows

    expect(written.map((row) => row.activity_id).sort()).toEqual([...m.parts].sort())

    for (const row of written) {
      expect(row.origin).toBe('report')
      expect(row.state['files']).toEqual([
        { sha256: fileSha, name: 'bericht-haus-m.pdf', mediaType: 'application/pdf' },
      ])
      expect(row.state['collective']).toEqual({ title: 'Prüfung der Feuerlöscher', parts: 2 })
    }

    expect(
      (
        await admin.query('select asset_id from defects where found_in_activity_id = any($1)', [
          m.parts,
        ])
      ).rows,
    ).toEqual([{ asset_id: m.assets[1] }])
    expect(
      (
        await one<{ statuses: string[] }>(
          `select array_agg(status::text) as statuses from activities where id = $1 or collective_id = $1`,
          [m.collective],
        )
      ).statuses,
    ).toEqual(['done', 'done', 'done'])
  })

  it('is refused once somebody began an asset on site, and the report of one of its duties alone is refused', async () => {
    const n = await byAContractor('Haus N')

    expect(
      (
        await http()
          .post(`/duties/${n.duties[0] ?? ''}/report`)
          .set(testIdentityHeader, by('u-site'))
          .send({
            performedOn: yesterday,
            result: 'without_defects',
            examiner: 'Klaus Berger',
            examinerOrganisation: 'Brandschutz Beispiel GmbH',
            file: {
              sha256: fileSha,
              fileName: 'bericht.pdf',
              sizeBytes: 2048,
              previewSha256: null,
            },
            defects: [],
          })
          .expect(409)
      ).body.message,
    ).toBe(
      'Diese Pflicht ist Teil eines Sammelvorgangs. Sein Bericht wird am Sammelvorgang eingetragen, für alle seine Anlagen.',
    )

    await admin.query(`update activities set status = 'started' where id = $1`, [n.parts[0]])

    await http()
      .post(`/collectives/${n.collective}/report`)
      .set(testIdentityHeader, by('u-site'))
      .send(reportOf(n.parts))
      .expect(409)
    expect(
      await one('select count(*)::int as n from evidence where duty_id = any($1)', [n.duties]),
    ).toEqual({ n: 0 })
  })
})

describe('the database', () => {
  it('lets an activity be a part of a collective activity and of nothing else', async () => {
    const p = await extinguishersIn('Haus P', 2)
    const first = await singleFor(p.duties[0] as string)
    const second = await singleFor(p.duties[1] as string)

    await expect(
      admin.query('update activities set collective_id = $2 where id = $1', [first, second]),
    ).rejects.toMatchObject({ code: 'HT011' })
  })
})
