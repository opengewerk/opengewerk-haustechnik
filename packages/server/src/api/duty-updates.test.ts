import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  type AuditPage,
  type Catalogue,
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueOf,
  type CatalogueRule,
  type DutyDetails,
  type DutyInterval,
  type DutyKind,
  type DutyReading,
  type DutyRegister,
  type DutyUpdateEntry,
  type DutyUpdates,
  type IsoDate,
  missingRight,
  nextAppointment,
  rightsOfRoles,
  type RoleKey,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { type SQL, sql } from 'drizzle-orm'
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
import { runDeadlineCycle } from '../deadlines/engine.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * A new version of a package and the duties that are confirmed (#139,
 * section 2.3 of the concept, ADR 0005, point 10): which duties the catalogue
 * says something new about and no other, taking the new version over, leaving
 * a duty as it is with a reason, and the maximum a regulation shortens, which
 * counts from its day without anybody deciding.
 *
 * The probe package in several catalogues over one database: the one the
 * duties are confirmed with, and what an update of the application brings
 * afterwards. A server holds one catalogue, so each stands behind an
 * application of its own.
 */

const small = newId<'tenant'>() as TenantId
/** Two areas, north and south; somebody keeps the register of the north only. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  // Of the roles a tenant starts with, whoever keeps the register holds in
  // every area. A role of a tenant's own may keep it in some: this is one.
  'u-north': 'technician',
  'u-tech': 'technician',
}

const today = dayInGermany()
/** The day the new version and the shorter maximum begin: in two months. */
const soon = addDays(today, 60)

const mainTest = 'probe.elevator_main_test'
/** A check whose interval of 24 months is a guide, read from the rule of the main test. */
const guided = 'probe.elevator_visual_check'
/** A check whose interval the operator determines. */
const unguided = 'probe.elevator_operator_check'

type Pack = CatalogueBundle['packages'][number]

/** The probe bundle with a kind with a guide and one without a value beside the main test. */
function withTwoMoreKinds(bundle: CatalogueBundle): CatalogueBundle {
  return {
    ...bundle,
    packages: bundle.packages.map((pack) => {
      const main = pack.dutyKinds.find((entry) => entry.key === mainTest)

      if (main === undefined || main.definition.interval.kind === 'none') {
        return pack
      }

      const like = (
        key: string,
        label: string,
        interval: DutyInterval,
      ): CatalogueEntry<DutyKind> => ({
        ...main,
        key,
        definition: { ...main.definition, label, interval, counting: 'from_performance' },
      })

      return {
        ...pack,
        dutyKinds: [
          ...pack.dutyKinds,
          like(guided, 'Sichtprüfung der Aufzugsanlage', {
            kind: 'guide',
            rule: main.definition.interval.rule,
          }),
          like(unguided, 'Kontrolle der Aufzugsanlage durch den Betreiber', { kind: 'none' }),
        ],
      }
    }),
  }
}

const first = withTwoMoreKinds(probeCatalogueBundle)

/** The first catalogue with its package changed, as an update of the application brings it. */
function updated(change: (pack: Pack) => Partial<Pack>): Catalogue {
  return catalogueOf({
    ...first,
    packages: first.packages.map((pack) => ({ ...pack, ...change(pack) })),
  })
}

function mainOf(pack: Pack): CatalogueEntry<DutyKind> {
  return pack.dutyKinds.find((entry) => entry.key === mainTest) as CatalogueEntry<DutyKind>
}

/** The rule of the main test, continued: as it was until a day, and with another value from then on. */
function continued(pack: Pack, from: IsoDate, value: number): readonly CatalogueRule[] {
  return pack.rules.flatMap((rule) =>
    rule.record.key === 'probe.elevator_main_test_interval'
      ? [
          { ...rule, record: { ...rule.record, validUntil: addDays(from, -1) } },
          { ...rule, record: { ...rule.record, validFrom: from, value } },
        ]
      : [rule],
  )
}

/** A second version of the main test from a day, with what it says differently. */
function secondVersion(pack: Pack, more: Partial<DutyKind>): readonly CatalogueEntry<DutyKind>[] {
  const main = mainOf(pack)

  return [
    ...pack.dutyKinds,
    { ...main, version: 2, validFrom: soon, definition: { ...main.definition, ...more } },
  ]
}

/** What the duties are confirmed with. */
const before = catalogueOf(first)
/** A second version of the main test and a maximum of one year, both from the day in two months. */
const later = updated((pack) => ({
  dutyKinds: secondVersion(pack, {
    source: '§ 16 Abs. 1 BetrSichV in der Fassung des kommenden Jahres',
    qualification: { level: 'competent_person' },
  }),
  rules: continued(pack, soon, 12),
}))
/** The same, and the maximum shortened once more. */
const laterStill = updated((pack) => ({
  dutyKinds: secondVersion(pack, {
    source: '§ 16 Abs. 1 BetrSichV in der Fassung des kommenden Jahres',
    qualification: { level: 'competent_person' },
  }),
  rules: continued(pack, soon, 9),
}))
/** The value of the rule corrected in its record: it was one year all along. */
const corrected = updated((pack) => ({
  rules: pack.rules.map((rule) =>
    rule.record.key === 'probe.elevator_main_test_interval'
      ? { ...rule, record: { ...rule.record, value: 12 } }
      : rule,
  ),
}))
/** A second version that takes in assets in Bavaria only. */
const narrowed = updated((pack) => ({
  dutyKinds: secondVersion(pack, {
    scope: { ...mainOf(pack).definition.scope, states: ['DE-BY'] },
  }),
}))

let admin: Pool
let database: Database
const apps = new Map<Catalogue, INestApplication>()

function http(catalogue: Catalogue = before) {
  return request((apps.get(catalogue) as INestApplication).getHttpServer())
}

function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

/** Somebody of the large tenant who keeps the register and holds in the north only. */
function keepsTheNorth(): string {
  return JSON.stringify({
    userId: 'u-north',
    tenantId: large,
    roles: ['technician'],
    rights: [...rightsOfRoles(['technician']), 'duty.write'],
  })
}

/** The sentence of a refusal behind the duty it names, whatever number its asset was given. */
function refusedFor(duty: string, sentence: string) {
  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return expect.stringMatching(
    new RegExp(`^${literal(duty)} an AN-\\d{5} Aufzug Haus A: ${literal(sentence)}$`),
  )
}

interface Place {
  readonly property: string
  readonly building: string
  readonly room: string
  readonly elevator: string
}

async function made(path: string, body: object, tenantId: TenantId = small): Promise<string> {
  return (
    await http().post(path).set(testIdentityHeader, by('u-duties', tenantId)).send(body).expect(201)
  ).body.id
}

async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const property = await made(
    '/properties',
    {
      name: 'Schulzentrum Am Neckar',
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      ...extra,
    },
    tenantId,
  )
  const building = await made(
    `/properties/${property}/buildings`,
    { name: 'Haus A', kinds: ['school'] },
    tenantId,
  )
  const floor = await made(
    `/buildings/${building}/floors`,
    { name: 'Erdgeschoss', level: 0 },
    tenantId,
  )
  const room = await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' }, tenantId)
  const elevator = await elevatorIn(building, 'Aufzug Haus A', tenantId)

  return { property, building, room, elevator }
}

function elevatorIn(building: string, name: string, tenantId: TenantId = small): Promise<string> {
  return made(`/buildings/${building}/assets`, { kind: 'probe.elevator', name }, tenantId)
}

/** A duty confirmed with the first catalogue. Answers the row. */
async function confirmed(
  body: object,
  tenantId: TenantId = small,
): Promise<Record<string, unknown>> {
  return (
    await http()
      .post('/duties')
      .set(testIdentityHeader, by('u-duties', tenantId))
      .send(body)
      .expect(201)
  ).body
}

async function mainTestAt(asset: string, intervalMonths = 24, tenantId = small): Promise<string> {
  return String((await confirmed({ assetId: asset, kind: mainTest, intervalMonths }, tenantId)).id)
}

/** What a catalogue reports at one property, for a person. */
async function reportedAt(
  catalogue: Catalogue,
  property: string,
  header: string = by('u-duties'),
): Promise<DutyUpdateEntry[]> {
  const answer = await http(catalogue)
    .get('/duties/updates')
    .set(testIdentityHeader, header)
    .expect(200)

  return (answer.body as DutyUpdates).entries.filter((entry) => entry.propertyId === property)
}

function decide(
  catalogue: Catalogue,
  decision: 'adopt' | 'keep',
  body: object,
  header: string = by('u-duties'),
) {
  return http(catalogue)
    .post(`/duties/updates/${decision}`)
    .set(testIdentityHeader, header)
    .send(body)
}

async function pageOf(catalogue: Catalogue, duty: string): Promise<DutyDetails> {
  return (
    await http(catalogue).get(`/duties/${duty}`).set(testIdentityHeader, by('u-duties')).expect(200)
  ).body
}

/** The rows of the duties at a property as the database holds them. */
async function rowsAt(property: string): Promise<unknown[]> {
  return (await admin.query('select * from duties where property_id = $1 order by id', [property]))
    .rows
}

async function evidenceOf(duty: string, performedOn: IsoDate): Promise<void> {
  await admin.query(
    `insert into evidence (tenant_id, property_id, area_id, duty_id, performed_on, result,
                           ${writtenColumnNames})
     select tenant_id, property_id, area_id, id, $2::date, 'without_defects'::evidence_result,
            ${writtenPlaceholders(3)}
       from duties where id = $1`,
    [duty, performedOn, ...writtenValues('u-duties', performedOn, 'without_defects')],
  )
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
    small,
    'Wohnbau Nord eG',
    large,
    'Gebäudeverwaltung Süd',
  ])

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

  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-north',
    north,
  ])

  database = Database.connect(applicationDatabaseUrl())

  for (const catalogue of [before, later, laterStill, corrected, narrowed]) {
    const built = await Test.createTestingModule({
      imports: [ApiModule.create(database, testIdentities, { catalogue })],
    }).compile()
    const app = built.createNestApplication()

    await app.init()
    apps.set(catalogue, app)
  }
})

afterAll(async () => {
  for (const app of apps.values()) {
    await app.close()
  }

  await database.close()
  await admin.end()
})

describe('a new version of a package', () => {
  it('names every duty it says something else about, with what changes and from when, and no other', async () => {
    const place = await placeIn()
    const second = await elevatorIn(place.building, 'Aufzug Haus B')
    const atMaximum = await mainTestAt(place.elevator)
    const within = await mainTestAt(second, 6)
    const followsGuide = await confirmed({ assetId: second, kind: guided, intervalMonths: 24 })

    await confirmed({
      assetId: place.elevator,
      kind: unguided,
      intervalMonths: 3,
      intervalReason: 'Gefährdungsbeurteilung 2026.',
    })
    await confirmed({
      roomId: place.room,
      label: 'Raum frei von Brandlasten',
      basis: 'own_decision',
      sourceNote: 'Brandschutzordnung Teil C',
      task: 'visual_check',
      intervalMonths: 3,
    })

    // A duty with a guide carries the guide of the day, as one with a maximum its maximum.
    expect(followsGuide).toMatchObject({ guideMonths: 24, guideDays: null, maximumMonths: null })

    // With the catalogue they were confirmed with, there is nothing to report.
    expect(await reportedAt(before, place.property)).toEqual([])

    const reported = await reportedAt(later, place.property)
    const of = (duty: string) => reported.find((entry) => entry.id === duty)

    expect(reported.map((entry) => entry.id).sort()).toEqual(
      [atMaximum, within, String(followsGuide.id)].sort(),
    )
    expect(of(atMaximum)).toEqual({
      id: atMaximum,
      kind: mainTest,
      title: 'Hauptprüfung der Aufzugsanlage',
      propertyId: place.property,
      asset: {
        id: place.elevator,
        number: expect.any(String),
        name: 'Aufzug Haus A',
        kind: 'probe.elevator',
        buildingId: place.building,
        roomId: null,
      },
      intervalDays: null,
      intervalMonths: 24,
      update: {
        held: 1,
        newest: 2,
        from: soon,
        changes: [
          { field: 'interval', held: '24 Monate', newest: '12 Monate' },
          {
            field: 'qualification',
            held: 'Zugelassene Überwachungsstelle',
            newest: 'Zur Prüfung befähigte Person',
          },
          {
            field: 'source',
            held: '§ 16 Abs. 1, § 17 Abs. 1 und Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV',
            newest: '§ 16 Abs. 1 BetrSichV in der Fassung des kommenden Jahres',
          },
        ],
        maximum: { interval: { months: 12 }, from: soon },
        // Its interval lies beyond the new maximum: it counts with one year from that day.
        shorter: { interval: { months: 12 }, from: soon },
        lapse: null,
        adoptable: true,
        becomes: { months: 12 },
        obstacle: null,
        keepable: false,
      },
    })
    // Within the new maximum already: nothing is cut short, and it may be left as it is.
    expect(of(within)?.update).toMatchObject({
      maximum: { interval: { months: 12 }, from: soon },
      shorter: null,
      keepable: true,
      adoptable: true,
    })
    // The guide is the same rule: no new version, and another value.
    expect(of(String(followsGuide.id))?.update).toEqual({
      held: 1,
      newest: 1,
      from: null,
      changes: [{ field: 'interval', held: '24 Monate', newest: '12 Monate' }],
      maximum: null,
      shorter: null,
      lapse: null,
      adoptable: true,
      // It followed its guide, and follows the new one.
      becomes: { months: 12 },
      obstacle: null,
      keepable: true,
    })
  })

  it('marks a reported duty in the register, in the file of its asset and on its page, and no other', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator)

    await confirmed({
      assetId: place.elevator,
      kind: unguided,
      intervalMonths: 3,
      intervalReason: 'Gefährdungsbeurteilung 2026.',
    })

    const marks = async (catalogue: Catalogue) => {
      const register = (
        await http(catalogue)
          .get(`/duties/register?propertyId=${place.property}`)
          .set(testIdentityHeader, by('u-tech'))
          .expect(200)
      ).body as DutyRegister
      const file = (
        await http(catalogue)
          .get(`/assets/${place.elevator}/duties`)
          .set(testIdentityHeader, by('u-tech'))
          .expect(200)
      ).body as DutyReading[]

      return {
        register: register.duties.map((row) => [row.kind, row.updated]),
        file: file.map((row) => [row.kind, row.updated]),
        page: (await pageOf(catalogue, duty)).update?.newest ?? null,
      }
    }

    expect(await marks(before)).toEqual({
      register: [
        [mainTest, false],
        [unguided, false],
      ],
      file: [
        [mainTest, false],
        [unguided, false],
      ],
      page: null,
    })
    expect(await marks(later)).toEqual({
      register: [
        [mainTest, true],
        [unguided, false],
      ],
      file: [
        [mainTest, true],
        [unguided, false],
      ],
      page: 2,
    })
  })

  it('changes no duty until somebody decides: reading and a pass of the engine write nothing to it', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator)

    await evidenceOf(duty, addDays(today, -200))

    const confirmedRows = await rowsAt(place.property)

    await reportedAt(later, place.property)
    await pageOf(later, duty)
    await http(later)
      .get(`/duties/register?propertyId=${place.property}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
    await runDeadlineCycle({ database, catalogue: later, now: () => new Date() })

    expect(await rowsAt(place.property)).toEqual(confirmedRows)
    expect(await reportedAt(later, place.property)).toHaveLength(1)
  })

  it('reports a duty whose asset the new version no longer takes in, to be left with a reason or ended', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator)
    const [entry] = await reportedAt(narrowed, place.property)

    expect(entry?.update).toMatchObject({
      held: 1,
      newest: 2,
      lapse: 'out_of_scope',
      adoptable: false,
      keepable: true,
    })

    const refused = await decide(narrowed, 'adopt', { dutyIds: [duty] }).expect(409)

    expect(refused.body.message).toEqual(
      refusedFor(
        'Hauptprüfung der Aufzugsanlage',
        'Nach der neuen Fassung gilt die Pflichtart für diese Anlage nicht mehr. Übernommen wird sie deshalb nicht; die Pflicht bleibt, bis jemand sie beendet.',
      ),
    )

    // Nothing is removed: the duty stands, and is left as it is with a reason.
    await decide(narrowed, 'keep', {
      dutyIds: [duty],
      reason: 'Wir prüfen den Aufzug weiter, der Versicherer verlangt es.',
    }).expect(201)
    expect(await reportedAt(narrowed, place.property)).toEqual([])
    expect((await pageOf(narrowed, duty)).ended).toBe(false)
  })

  it('reports no duty that has ended, and decides on none', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator)

    await http()
      .post(`/duties/${duty}/end`)
      .set(testIdentityHeader, by('u-duties'))
      .send({})
      .expect(201)

    expect(await reportedAt(later, place.property)).toEqual([])
    expect((await pageOf(later, duty)).update).toBeNull()

    // In the register it stands among the ended duties, and without the mark.
    const ended = (
      await http(later)
        .get(`/duties/register?propertyId=${place.property}&state=ended`)
        .set(testIdentityHeader, by('u-duties'))
        .expect(200)
    ).body as DutyRegister

    expect(ended.duties.map((row) => [row.id, row.updated])).toEqual([[duty, false]])
    expect((await decide(later, 'adopt', { dutyIds: [duty] }).expect(409)).body.message).toEqual(
      refusedFor(
        'Hauptprüfung der Aufzugsanlage',
        'Diese Pflicht ist beendet; eine beendete Pflicht ändert sich nicht mehr.',
      ),
    )
  })
})

describe('taking the new version over', () => {
  it('names the new version and its maximum, cuts an interval beyond it and leaves one within it', async () => {
    const place = await placeIn()
    const second = await elevatorIn(place.building, 'Aufzug Haus B')
    const atMaximum = await mainTestAt(place.elevator)
    const within = await mainTestAt(second, 6)

    const adopted = (await decide(later, 'adopt', { dutyIds: [atMaximum, within] }).expect(201))
      .body as Record<string, unknown>[]

    expect(adopted).toMatchObject([
      {
        id: atMaximum,
        kindVersion: 2,
        counting: 'betrsichv',
        intervalMonths: 12,
        maximumMonths: 12,
        keptVersion: null,
      },
      { id: within, kindVersion: 2, intervalMonths: 6, maximumMonths: 12, keptVersion: null },
    ])
    expect(await reportedAt(later, place.property)).toEqual([])
    expect(await pageOf(later, atMaximum)).toMatchObject({ kindVersion: 2, update: null })
  })

  it('lets a duty that followed its guide follow the new one', async () => {
    const place = await placeIn()
    const duty = String(
      (await confirmed({ assetId: place.elevator, kind: guided, intervalMonths: 24 })).id,
    )

    expect((await decide(later, 'adopt', { dutyIds: [duty] }).expect(201)).body).toMatchObject([
      { id: duty, kindVersion: 1, intervalMonths: 12, guideMonths: 12, maximumMonths: null },
    ])
    expect(await reportedAt(later, place.property)).toEqual([])
  })

  it('takes every duty of a batch or none, and says which one it refused', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator)
    const nothingNew = String(
      (
        await confirmed({
          assetId: place.elevator,
          kind: unguided,
          intervalMonths: 3,
          intervalReason: 'Gefährdungsbeurteilung 2026.',
        })
      ).id,
    )
    const confirmedRows = await rowsAt(place.property)

    expect(
      (await decide(later, 'adopt', { dutyIds: [duty, nothingNew] }).expect(409)).body.message,
    ).toEqual(
      refusedFor(
        'Kontrolle der Aufzugsanlage durch den Betreiber',
        'Für diese Pflicht sagt der Katalog nichts Neues; es gibt nichts zu entscheiden.',
      ),
    )
    expect(await rowsAt(place.property)).toEqual(confirmedRows)

    for (const dutyIds of [undefined, [], [duty, duty], ['']]) {
      await decide(later, 'adopt', { dutyIds }).expect(400)
    }

    await decide(later, 'adopt', { dutyIds: [newId<'duty'>()] }).expect(404)
    expect(await rowsAt(place.property)).toEqual(confirmedRows)
  })
})

describe('leaving a duty as it is', () => {
  it('asks for the reason, keeps what the catalogue said, and is silent until it says something else', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator, 6)

    for (const body of [{ dutyIds: [duty] }, { dutyIds: [duty], reason: '   ' }]) {
      expect((await decide(later, 'keep', body).expect(400)).body.message).toBe(
        'Die Begründung fehlt.',
      )
    }

    const [kept] = (
      await decide(later, 'keep', {
        dutyIds: [duty],
        reason: '  Wir prüfen ohnehin halbjährlich.  ',
      }).expect(201)
    ).body as Record<string, unknown>[]

    // The duty is as it was confirmed, and says what it was left against.
    expect(kept).toMatchObject({
      id: duty,
      kindVersion: 1,
      intervalMonths: 6,
      maximumMonths: 24,
      keptVersion: 2,
      keptMonths: 12,
      keptDays: null,
      keptReason: 'Wir prüfen ohnehin halbjährlich.',
    })
    expect(await reportedAt(later, place.property)).toEqual([])
    expect((await pageOf(later, duty)).update).toBeNull()

    // The maximum is shortened once more: the duty is reported again.
    expect((await reportedAt(laterStill, place.property)).map((entry) => entry.id)).toEqual([duty])
  })

  it('is refused where the new maximum is shorter than the interval of the duty', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator)
    const confirmedRows = await rowsAt(place.property)

    expect(
      (await decide(later, 'keep', { dutyIds: [duty], reason: 'Bleibt so.' }).expect(400)).body
        .message,
    ).toEqual(
      refusedFor(
        'Hauptprüfung der Aufzugsanlage',
        'Die neue Höchstfrist ist kürzer als die Frist dieser Pflicht. Sie lässt sich nicht so lassen, sondern wird übernommen; eine Höchstfrist lässt sich nur verkürzen.',
      ),
    )
    expect(await rowsAt(place.property)).toEqual(confirmedRows)
  })
})

describe('the log of changes', () => {
  it('says who took a new version over and who left a duty as it is, with what was written', async () => {
    const place = await placeIn()
    const second = await elevatorIn(place.building, 'Aufzug Haus B')
    const adopted = await mainTestAt(place.elevator)
    const kept = await mainTestAt(second, 6)

    await decide(later, 'adopt', { dutyIds: [adopted] }, by('u-lead')).expect(201)
    await decide(later, 'keep', { dutyIds: [kept], reason: 'Wir prüfen halbjährlich.' }).expect(201)

    const logOf = async (duty: string) =>
      (
        (
          await http()
            .get(`/audit/changes?table=duties&record=${duty}`)
            .set(testIdentityHeader, by('u-lead'))
            .expect(200)
        ).body as AuditPage
      ).changes

    const [adoption] = await logOf(adopted)
    const [keeping] = await logOf(kept)

    expect([adoption?.operation, adoption?.userId]).toEqual(['update', 'u-lead'])
    expect(adoption?.fields.map((moved) => moved.field).sort()).toEqual([
      'interval_months',
      'kind_version',
      'maximum_months',
    ])
    expect([keeping?.operation, keeping?.userId]).toEqual(['update', 'u-duties'])
    expect(keeping?.fields.map((moved) => moved.field).sort()).toEqual([
      'kept_months',
      'kept_reason',
      'kept_version',
    ])
  })
})

describe('a maximum a regulation shortens', () => {
  it('counts from its day in the appointment, the state and the deadline, and the duty says that it is cut short', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator)
    const performedOn = addDays(today, -480)

    await evidenceOf(duty, performedOn)

    const counted = (months: number) =>
      nextAppointment({ counting: 'betrsichv', interval: { months } }, [performedOn])
    const deadline = async () =>
      (
        await admin.query<{ due_on: string }>(
          `select to_char(due_on, 'YYYY-MM-DD') as due_on from deadlines where duty_id = $1`,
          [duty],
        )
      ).rows[0]?.due_on

    // With the catalogue it was confirmed with: two years, and nothing is said.
    await runDeadlineCycle({ database, catalogue: before, now: () => new Date() })
    expect(await pageOf(before, duty)).toMatchObject({
      state: 'met',
      appointment: counted(24),
      shortened: null,
      update: null,
    })
    expect(await deadline()).toBe(counted(24)?.dueOn)

    // The maximum is one year: the duty still says two, and counts with one.
    await runDeadlineCycle({ database, catalogue: corrected, now: () => new Date() })

    const page = await pageOf(corrected, duty)

    expect(page).toMatchObject({
      intervalMonths: 24,
      maximumMonths: 24,
      state: 'overdue',
      appointment: counted(12),
      shortened: { months: 12 },
    })
    expect(page.update).toMatchObject({
      held: 1,
      newest: 1,
      shorter: { interval: { months: 12 }, from: '2015-06-01' },
      keepable: false,
    })
    expect(await deadline()).toBe(counted(12)?.dueOn)

    const [row] = (
      (
        await http(corrected)
          .get(`/duties/register?propertyId=${place.property}`)
          .set(testIdentityHeader, by('u-tech'))
          .expect(200)
      ).body as DutyRegister
    ).duties

    expect(row).toMatchObject({
      state: 'overdue',
      appointment: counted(12),
      shortened: { months: 12 },
      updated: true,
    })

    // A maximum to come cuts nothing short before its day.
    expect(await pageOf(later, duty)).toMatchObject({
      state: 'met',
      appointment: counted(24),
      shortened: null,
    })
  })

  it('holds for an interval set now: none is saved beyond the maximum of today', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator, 6)
    const change = (catalogue: Catalogue, intervalMonths: number) =>
      http(catalogue)
        .patch(`/duties/${duty}`)
        .set(testIdentityHeader, by('u-duties'))
        .send({ intervalMonths })

    expect((await change(corrected, 18).expect(400)).body.message).toBe(
      'Die Höchstfrist beträgt 12 Monate, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.',
    )
    await change(corrected, 12).expect(200)
    // Before its day a maximum to come refuses nothing the duty was confirmed with.
    await change(later, 18).expect(200)
  })

  it('is noticed where a guide was corrected in its record, by the guide the duty carries', async () => {
    const place = await placeIn()
    const duty = String(
      (await confirmed({ assetId: place.elevator, kind: guided, intervalMonths: 24 })).id,
    )

    expect((await reportedAt(corrected, place.property)).map((entry) => entry.id)).toEqual([duty])
    // A guide cuts nothing short: the duty counts with its own interval.
    expect(await pageOf(corrected, duty)).toMatchObject({ shortened: null, intervalMonths: 24 })
  })
})

describe('what a duty keeps of a decision', () => {
  it('is held by the database for every other way in, each by its own check', async () => {
    const place = await placeIn()
    const fromTheCatalogue = await mainTestAt(place.elevator, 6)
    const withAGuide = String(
      (await confirmed({ assetId: place.elevator, kind: guided, intervalMonths: 24 })).id,
    )
    const own = String(
      (
        await confirmed({
          roomId: place.room,
          label: 'Raum frei von Brandlasten',
          basis: 'own_decision',
          sourceNote: 'Brandschutzordnung Teil C',
          task: 'visual_check',
          intervalMonths: 3,
        })
      ).id,
    )
    const write = (duty: string, values: SQL) =>
      database.forTenant({ tenantId: small, userId: 'u-duties' }, (tx) =>
        tx.execute(sql`update duties set ${values} where id = ${duty}`),
      )
    const refusals: readonly (readonly [string, string, SQL])[] = [
      // Left as it is against a version, with the reason, and the value of the rule only beside both.
      ['duties_kept_whole', fromTheCatalogue, sql`kept_version = 2`],
      ['duties_kept_whole', fromTheCatalogue, sql`kept_reason = 'Bleibt so.'`],
      ['duties_kept_whole', fromTheCatalogue, sql`kept_months = 12`],
      ['duties_kept_from_the_catalogue', own, sql`kept_version = 2, kept_reason = 'Bleibt so.'`],
      [
        'duties_kept_version_shaped',
        fromTheCatalogue,
        sql`kept_version = 0, kept_reason = 'Bleibt so.'`,
      ],
      [
        'duties_kept_one_unit',
        fromTheCatalogue,
        sql`kept_version = 2, kept_reason = 'Bleibt so.', kept_days = 365, kept_months = 12`,
      ],
      [
        'duties_kept_in_bounds',
        fromTheCatalogue,
        sql`kept_version = 2, kept_reason = 'Bleibt so.', kept_months = 0`,
      ],
      [
        'duties_kept_reason_shaped',
        fromTheCatalogue,
        sql`kept_version = 2, kept_reason = ' Bleibt so. '`,
      ],
      [
        'duties_kept_reason_shaped',
        fromTheCatalogue,
        sql`kept_version = 2, kept_reason = ${'x'.repeat(501)}`,
      ],
      // A maximum or a guide beside the interval, in one unit and never both.
      ['duties_guide_one_unit', withAGuide, sql`guide_days = 730`],
      ['duties_guide_in_bounds', withAGuide, sql`guide_months = 0`],
      ['duties_maximum_or_guide', fromTheCatalogue, sql`guide_months = 24`],
    ]

    for (const [constraint, duty, values] of refusals) {
      await expect(write(duty, values), constraint).rejects.toMatchObject({
        cause: { constraint },
      })
    }

    // What a decision writes, the database takes.
    await write(
      fromTheCatalogue,
      sql`kept_version = 2, kept_reason = 'Bleibt so.', kept_months = 12`,
    )
  })
})

describe('the rights', () => {
  it('let whoever reads duties read the report, and only who keeps the register decide', async () => {
    const place = await placeIn()
    const duty = await mainTestAt(place.elevator, 6)

    expect(await reportedAt(later, place.property, by('u-tech'))).toHaveLength(1)

    for (const decision of ['adopt', 'keep'] as const) {
      expect(
        (
          await decide(
            later,
            decision,
            { dutyIds: [duty], reason: 'Bleibt so.' },
            by('u-tech'),
          ).expect(403)
        ).body.message,
      ).toBe(missingRight('duty.write'))
    }

    expect(await reportedAt(later, place.property)).toHaveLength(1)
  })

  it('show the north what is reported in the north, and let it decide on nothing of the south', async () => {
    const inNorth = await placeIn(large, { areaId: north })
    const inSouth = await placeIn(large, { areaId: south })
    const northern = await mainTestAt(inNorth.elevator, 6, large)
    const southern = await mainTestAt(inSouth.elevator, 6, large)
    const northOnly = keepsTheNorth()
    const seen = async (header: string) =>
      (
        (await http(later).get('/duties/updates').set(testIdentityHeader, header).expect(200))
          .body as DutyUpdates
      ).entries.map((entry) => entry.id)

    expect(await seen(northOnly)).toEqual([northern])
    expect((await seen(by('u-duties', large))).sort()).toEqual([northern, southern].sort())

    for (const decision of ['adopt', 'keep'] as const) {
      await decide(
        later,
        decision,
        { dutyIds: [northern, southern], reason: 'Bleibt so.' },
        northOnly,
      ).expect(404)
    }

    // Nothing of the batch was written, the duty of the north included.
    expect(await seen(by('u-duties', large))).toHaveLength(2)
    await decide(later, 'adopt', { dutyIds: [northern] }, northOnly).expect(201)
    expect(await seen(by('u-duties', large))).toEqual([southern])
  })
})
