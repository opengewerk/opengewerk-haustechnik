import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { catalogueBundle } from '@opengewerk/haustechnik-catalogue'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type CatalogueBundle,
  type CatalogueEntry,
  catalogueOf,
  type DutyInterval,
  type DutyKind,
  missingRight,
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
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The register of duties (#25): a duty confirmed from the catalogue at an
 * asset, with the maximum of its kind kept beside it, a duty of the
 * operator's own anywhere, the interval within what the kind allows, ending a
 * duty, and the proposals dismissed with their reason, by the roles section 7
 * of the concept gives each right and only in the areas of the person asking.
 *
 * The catalogue is the probe package: the main test of an elevator, at most
 * every 24 months and counted under § 14 Abs. 5 BetrSichV, and a water meter
 * no duty kind names. The package knows no kind with a guide and none without
 * a value; two such kinds stand beside it for this test alone. In front of
 * it stands what this build ships, the package Allgemein, whose asset kinds
 * no duty kind names (#61).
 */

/** One area, as most tenants have it. */
const small = newId<'tenant'>() as TenantId
/** Two areas, north and south. */
const large = newId<'tenant'>() as TenantId
let north = ''
let south = ''

const people: Readonly<Record<string, RoleKey>> = {
  'u-lead': 'management',
  'u-duties': 'technical_management',
  'u-site': 'site_management',
  'u-tech': 'technician',
}

const mainTest = 'probe.elevator_main_test'
/** A check whose interval of 24 months is a guide the operator may depart from, with a reason. */
const guided = 'probe.elevator_visual_check'
/** A check whose interval the operator determines, in the risk assessment for instance. */
const unguided = 'probe.elevator_operator_check'

/**
 * The probe bundle with the two kinds of this test beside the main test, made
 * from it: the guide is the rule of the main test, read as a guide.
 */
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

let admin: Pool
let database: Database
let app: INestApplication

function http() {
  return request(app.getHttpServer())
}

/** A request header for one of the people, in one of the tenants. */
function by(userId: keyof typeof people & string, tenantId: TenantId = small): string {
  return as(tenantId, userId, people[userId] as RoleKey)
}

/** A property with a building, a room in it and an elevator and a water meter there. */
interface Place {
  readonly property: string
  readonly building: string
  readonly room: string
  readonly elevator: string
  readonly waterMeter: string
}

async function placeIn(tenantId: TenantId = small, extra: object = {}): Promise<Place> {
  const header = by('u-duties', tenantId)
  const made = async (path: string, body: object): Promise<string> =>
    (await http().post(path).set(testIdentityHeader, header).send(body).expect(201)).body.id

  const property = await made('/properties', {
    name: 'Schulzentrum Am Neckar',
    street: 'Neckarstraße 4',
    postalCode: '68535',
    city: 'Edingen-Neckarhausen',
    federalState: 'DE-BW',
    ...extra,
  })
  const building = await made(`/properties/${property}/buildings`, {
    name: 'Haus A',
    kinds: ['school'],
  })
  const floor = await made(`/buildings/${building}/floors`, { name: 'Erdgeschoss', level: 0 })
  const room = await made(`/floors/${floor}/rooms`, { number: '0.01', name: 'Technik' })
  const elevator = await made(`/buildings/${building}/assets`, {
    kind: 'probe.elevator',
    name: 'Aufzug Haus A',
  })
  const waterMeter = await made(`/buildings/${building}/assets`, {
    kind: 'probe.water_meter',
    name: 'Hauswasserzähler',
    meterNumber: '9WAT1234567',
    meterUnit: 'cubic_metres',
  })

  return { property, building, room, elevator, waterMeter }
}

/** A duty posted by the technical management, with the answer as it came. */
function post(body: object, userId: keyof typeof people & string = 'u-duties', tenantId = small) {
  return http().post('/duties').set(testIdentityHeader, by(userId, tenantId)).send(body)
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

  // The large tenant has its two areas before anybody works for it.
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

  // Somebody who left, in the small tenant only.
  await admin.query(
    `insert into auth_users (id, name, email) values ('u-gone', 'u-gone', 'gone@beispiel.example')`,
  )
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles, blocked_at) values ($1, 'u-gone', '{technician}', now())`,
    [small],
  )

  // In the large tenant the technician works in the north.
  await admin.query('insert into member_areas (tenant_id, user_id, area_id) values ($1, $2, $3)', [
    large,
    'u-tech',
    north,
  ])

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [
      ApiModule.create(database, testIdentities, {
        // The packages this build ships stand in front, the general one
        // among them (#61): its asset kinds are the ones no duty kind names.
        catalogue: catalogueOf({
          ...probeCatalogueBundle,
          packages: [
            ...catalogueBundle.packages,
            ...withTwoMoreKinds(probeCatalogueBundle).packages,
          ],
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

describe('a duty from the catalogue', () => {
  it('is confirmed at an asset, with the kind, its version, its counting and the maximum of the day', async () => {
    const place = await placeIn()
    const answer = await post({
      assetId: place.elevator,
      kind: mainTest,
      intervalMonths: 24,
      responsibleUserId: 'u-site',
      performer: 'contractor',
      performerNote: 'Prüfstelle Süd',
    }).expect(201)

    expect(answer.body).toMatchObject({
      propertyId: place.property,
      buildingId: null,
      roomId: null,
      assetId: place.elevator,
      kind: mainTest,
      kindVersion: 1,
      label: null,
      counting: 'betrsichv',
      intervalDays: null,
      intervalMonths: 24,
      maximumDays: null,
      maximumMonths: 24,
      responsibleUserId: 'u-site',
      performer: 'contractor',
      performerNote: 'Prüfstelle Süd',
      confirmedBy: 'u-duties',
      endsOn: null,
    })
  })

  it('may shorten the maximum without a reason, and never exceeds it', async () => {
    const place = await placeIn()

    await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 12 }).expect(201)

    const longer = await post({
      assetId: (await placeIn()).elevator,
      kind: mainTest,
      intervalMonths: 25,
    })

    expect(longer.status).toBe(400)
    expect(longer.body.message).toBe(
      'Die Höchstfrist beträgt 24 Monate, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.',
    )
  })

  it('counts in months under § 14 Abs. 5 BetrSichV', async () => {
    const place = await placeIn()
    const answer = await post({ assetId: place.elevator, kind: mainTest, intervalDays: 300 })

    expect(answer.status).toBe(400)
    expect(answer.body.message).toBe('Nach § 14 Abs. 5 BetrSichV zählt die Frist in Monaten.')
  })

  it('is refused for an asset of another kind, at a place, and for a kind the catalogue does not know', async () => {
    const place = await placeIn()

    expect(
      (await post({ assetId: place.waterMeter, kind: mainTest, intervalMonths: 24 }).expect(400))
        .body.message,
    ).toBe('Die Pflichtart gilt nicht für Anlagen dieser Art.')
    expect(
      (await post({ buildingId: place.building, kind: mainTest, intervalMonths: 24 }).expect(400))
        .body.message,
    ).toBe(
      'Eine Pflichtart des Katalogs gilt für Anlagen; an einem Raum, einem Gebäude oder der Liegenschaft steht eine eigene Pflicht.',
    )
    expect(
      (
        await post({
          assetId: place.elevator,
          kind: 'probe.escalator_test',
          intervalMonths: 24,
        }).expect(400)
      ).body.message,
    ).toBe('Die Pflichtart probe.escalator_test kennt kein Paket des Katalogs.')
  })

  /** Acceptance of #61: no general asset kind is offered a duty kind, and it may carry a duty of the operator. */
  it('is refused for an asset of a general kind, whichever duty kind is asked for, while a duty of the operator is taken', async () => {
    const place = await placeIn()
    const general = (
      await http()
        .post(`/buildings/${place.building}/assets`)
        .set(testIdentityHeader, by('u-duties'))
        .send({ kind: 'allgemein.conveying_system', name: 'Aufzug Altbau' })
        .expect(201)
    ).body.id as string
    const catalogue = catalogueOf({
      ...probeCatalogueBundle,
      packages: [...catalogueBundle.packages, ...withTwoMoreKinds(probeCatalogueBundle).packages],
    })
    const dutyKinds = catalogue.dutyKinds(dayInGermany()).map((entry) => entry.key)

    // Every duty kind of the catalogue, so that a new one cannot slip past.
    expect(dutyKinds).toEqual(expect.arrayContaining([mainTest, guided, unguided]))

    for (const kind of dutyKinds) {
      expect(
        (await post({ assetId: general, kind, intervalMonths: 24 }).expect(400)).body.message,
      ).toBe('Die Pflichtart gilt nicht für Anlagen dieser Art.')
    }

    const own = await post({
      assetId: general,
      label: 'Wartung nach Angabe des Herstellers',
      basis: 'manufacturer',
      sourceNote: 'Betriebsanleitung, Abschnitt 7',
      task: 'maintenance',
      intervalMonths: 12,
    }).expect(201)

    expect(own.body).toMatchObject({
      assetId: general,
      kind: null,
      task: 'maintenance',
      intervalMonths: 12,
    })
  })

  it('takes name, basis, source, task and counting from its kind', async () => {
    const place = await placeIn()
    const fromItsKind =
      'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle, Tätigkeit und Zählweise von ihrer Pflichtart.'

    for (const own of [{ label: 'Hauptprüfung' }, { task: 'inspection' }]) {
      expect(
        (
          await post({
            assetId: place.elevator,
            kind: mainTest,
            intervalMonths: 24,
            ...own,
          }).expect(400)
        ).body.message,
      ).toBe(fromItsKind)
    }

    // Confirmed, it names none: what it has somebody do, its kind says.
    expect(
      (await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201))
        .body,
    ).toMatchObject({ kind: mainTest, task: null })
  })

  it('is confirmed once for an asset while it stands, and again after it ended', async () => {
    const place = await placeIn()
    const first = await post({
      assetId: place.elevator,
      kind: mainTest,
      intervalMonths: 24,
    }).expect(201)

    expect(
      (await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(409)).body
        .message,
    ).toBe('Diese Pflicht ist an der Anlage schon bestätigt.')

    await http()
      .post(`/duties/${first.body.id}/end`)
      .set(testIdentityHeader, by('u-duties'))
      .send({})
      .expect(201)
    await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201)
  })
})

describe('the reason of an interval', () => {
  const departing =
    'Der Richtwert beträgt 24 Monate; eine Frist, die davon abweicht, braucht eine Begründung.'

  it('is asked where the operator departs from a guide, in either direction, and not for the guide itself', async () => {
    const place = await placeIn()

    await post({ assetId: place.elevator, kind: guided, intervalMonths: 24 }).expect(201)

    for (const intervalMonths of [12, 36]) {
      const elsewhere = await placeIn()

      expect(
        (await post({ assetId: elsewhere.elevator, kind: guided, intervalMonths }).expect(400)).body
          .message,
      ).toBe(departing)
      // A guide is no maximum: with its reason, the interval may be longer.
      expect(
        (
          await post({
            assetId: elsewhere.elevator,
            kind: guided,
            intervalMonths,
            intervalReason: 'Nutzung nach der Gefährdungsbeurteilung vom 01.09.2026',
          }).expect(201)
        ).body,
      ).toMatchObject({ intervalMonths, maximumMonths: null, maximumDays: null })
    }
  })

  it('stays with an interval that departs, and may go once the interval is the guide again', async () => {
    const place = await placeIn()
    const duty = (
      await post({
        assetId: place.elevator,
        kind: guided,
        intervalMonths: 12,
        intervalReason: 'Hohe Nutzung',
      }).expect(201)
    ).body
    const change = (body: object) =>
      http().patch(`/duties/${duty.id}`).set(testIdentityHeader, by('u-duties')).send(body)

    expect((await change({ intervalReason: '' }).expect(400)).body.message).toBe(departing)
    expect((await change({ intervalMonths: 18 }).expect(200)).body).toMatchObject({
      intervalMonths: 18,
      intervalReason: 'Hohe Nutzung',
    })
    expect(
      (await change({ intervalMonths: 24, intervalReason: '' }).expect(200)).body,
    ).toMatchObject({ intervalMonths: 24, intervalReason: null })
  })

  it('is asked for every interval of a kind that leaves the interval to the operator', async () => {
    const place = await placeIn()

    expect(
      (await post({ assetId: place.elevator, kind: unguided, intervalMonths: 6 }).expect(400)).body
        .message,
    ).toBe(
      'Die Frist dieser Pflichtart legt der Betreiber fest; sie braucht eine Begründung, etwa den Verweis auf die Gefährdungsbeurteilung.',
    )
    expect(
      (
        await post({
          assetId: place.elevator,
          kind: unguided,
          intervalMonths: 6,
          intervalReason: 'Gefährdungsbeurteilung vom 01.09.2026',
        }).expect(201)
      ).body,
    ).toMatchObject({ intervalMonths: 6, maximumMonths: null, maximumDays: null })
  })
})

describe('the maximum of a duty', () => {
  it('is held by the database as by the route, on every way in', async () => {
    const place = await placeIn()
    const duty = (
      await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201)
    ).body

    expect(
      (
        await http()
          .patch(`/duties/${duty.id}`)
          .set(testIdentityHeader, by('u-duties'))
          .send({ intervalMonths: 30 })
          .expect(400)
      ).body.message,
    ).toBe(
      'Die Höchstfrist beträgt 24 Monate, länger darf die Frist nicht sein; eine Höchstfrist lässt sich nur verkürzen.',
    )

    // Past the route: the database refuses it for the application.
    await expect(
      database.forTenant({ tenantId: small, userId: 'u-duties' }, (tx) =>
        tx.execute(sql`update duties set interval_months = 30 where id = ${duty.id}`),
      ),
    ).rejects.toMatchObject({ cause: { constraint: 'duties_within_their_maximum' } })
  })
})

describe('the rules of a duty', () => {
  it('are held by the database for every other way in, each by its own check', async () => {
    const place = await placeIn()
    const { rows } = await admin.query<{ area_id: string }>(
      'select area_id from properties where id = $1',
      [place.property],
    )
    const area = rows[0]?.area_id
    const write = (statement: SQL) =>
      database.forTenant({ tenantId: small, userId: 'u-duties' }, (tx) => tx.execute(statement))
    const own = (columns: SQL, values: SQL) =>
      sql`insert into duties (tenant_id, property_id, area_id, label, basis, source_note, confirmed_by, ${columns})
          values (${small}, ${place.property}, ${area}, 'Prüfen', 'own_decision', 'Festlegung', 'u-duties', ${values})`
    const refusals: readonly (readonly [string, SQL])[] = [
      [
        'duties_one_target',
        own(
          sql`building_id, room_id, counting, interval_months`,
          sql`${place.building}, ${place.room}, 'from_performance', 12`,
        ),
      ],
      [
        'duties_from_the_catalogue_or_own',
        sql`insert into duties (tenant_id, property_id, area_id, building_id, kind, kind_version, counting,
                                interval_months, maximum_months, confirmed_by)
            values (${small}, ${place.property}, ${area}, ${place.building}, ${mainTest}, 1, 'betrsichv',
                    24, 24, 'u-duties')`,
      ],
      [
        'duties_task_of_their_own',
        sql`insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                                interval_months, maximum_months, task, confirmed_by)
            values (${small}, ${place.property}, ${area}, ${place.elevator}, ${mainTest}, 1, 'betrsichv',
                    24, 24, 'inspection', 'u-duties')`,
      ],
      [
        'duties_from_the_catalogue_or_own',
        sql`insert into duties (tenant_id, property_id, area_id, label, basis, counting, interval_months,
                                confirmed_by)
            values (${small}, ${place.property}, ${area}, 'Prüfen', 'own_decision', 'from_performance', 12,
                    'u-duties')`,
      ],
      ['duties_betrsichv_in_months', own(sql`counting, interval_days`, sql`'betrsichv', 30`)],
      [
        'duties_interval_one_unit',
        own(sql`counting, interval_days, interval_months`, sql`'from_performance', 30, 1`),
      ],
      [
        'duties_end_whole',
        own(sql`counting, interval_months, end_reason`, sql`'from_performance', 12, 'Weg'`),
      ],
    ]

    for (const [constraint, statement] of refusals) {
      await expect(write(statement)).rejects.toMatchObject({ cause: { constraint } })
    }

    const confirmed = sql`insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                                             counting, interval_months, maximum_months, confirmed_by)
        values (${small}, ${place.property}, ${area}, ${place.elevator}, ${mainTest}, 1, 'betrsichv', 24, 24,
                'u-duties')`

    await write(confirmed)
    await expect(write(confirmed)).rejects.toMatchObject({
      cause: { constraint: 'duties_kind_once' },
    })

    const dismissed = sql`insert into duty_dismissals (tenant_id, property_id, area_id, asset_id, kind,
                                                      kind_version, reason, dismissed_by)
        values (${small}, ${place.property}, ${area}, ${place.elevator}, ${guided}, 1, 'Gibt es hier nicht.',
                'u-duties')`

    await write(dismissed)
    await expect(write(dismissed)).rejects.toMatchObject({
      cause: { constraint: 'duty_dismissals_once' },
    })
  })
})

describe('a duty of the operator own', () => {
  it('hangs on a building, a room or the property, with its name, basis, source and task', async () => {
    const place = await placeIn()
    const atBuilding = await post({
      buildingId: place.building,
      label: 'Dachrinnen reinigen',
      basis: 'insurer',
      sourceNote: 'Gebäudeversicherung, Vertrag 4711',
      task: 'maintenance',
      intervalMonths: 12,
    }).expect(201)

    expect(atBuilding.body).toMatchObject({
      propertyId: place.property,
      buildingId: place.building,
      kind: null,
      kindVersion: null,
      label: 'Dachrinnen reinigen',
      basis: 'insurer',
      task: 'maintenance',
      counting: 'from_performance',
      intervalMonths: 12,
      maximumMonths: null,
    })

    await post({
      roomId: place.room,
      label: 'Lüftungsgitter prüfen',
      basis: 'own_decision',
      sourceNote: 'Gefährdungsbeurteilung 2026',
      task: 'visual_check',
      counting: 'from_due',
      intervalDays: 90,
    }).expect(201)
    await post({
      propertyId: place.property,
      label: 'Zufahrt freihalten',
      basis: 'authority',
      sourceNote: 'Brandschutzkonzept, Abschnitt 4',
      task: 'visual_check',
      intervalDays: 7,
    }).expect(201)
  })

  it('is refused without its name, its basis, its source or its task', async () => {
    const place = await placeIn()
    const own = { buildingId: place.building, intervalMonths: 12 }

    expect(
      (await post({ ...own, basis: 'insurer', sourceNote: 'Vertrag' }).expect(400)).body.message,
    ).toBe('Die Bezeichnung einer eigenen Pflicht fehlt.')
    expect(
      (await post({ ...own, label: 'Dachrinnen', sourceNote: 'Vertrag' }).expect(400)).body.message,
    ).toBe(
      'Die Grundlage einer eigenen Pflicht fehlt: Vorgabe des Herstellers, Auflage, Forderung des Versicherers oder eigene Festlegung.',
    )
    expect(
      (await post({ ...own, label: 'Dachrinnen', basis: 'insurer' }).expect(400)).body.message,
    ).toBe('Die Quelle einer eigenen Pflicht fehlt.')
    expect(
      (
        await post({ ...own, label: 'Dachrinnen', basis: 'insurer', sourceNote: 'Vertrag' }).expect(
          400,
        )
      ).body.message,
    ).toBe(
      'Die Tätigkeit einer eigenen Pflicht fehlt: Prüfung, Wartung, Inspektion, Funktionskontrolle, Sichtkontrolle, Probenahme.',
    )
  })

  it('names what it has somebody do from the list, may change that and never loses it', async () => {
    const place = await placeIn()
    const own = {
      buildingId: place.building,
      label: 'Dachrinnen reinigen',
      basis: 'insurer',
      sourceNote: 'Gebäudeversicherung, Vertrag 4711',
      intervalMonths: 12,
    }

    expect((await post({ ...own, task: 'cleaning' }).expect(400)).body.message).toBe(
      'Die Tätigkeit ist keine von: Prüfung, Wartung, Inspektion, Funktionskontrolle, Sichtkontrolle, Probenahme.',
    )

    const duty = (await post({ ...own, task: 'maintenance' }).expect(201)).body
    const change = (body: object) =>
      http().patch(`/duties/${duty.id}`).set(testIdentityHeader, by('u-duties')).send(body)

    expect((await change({ task: 'visual_check' }).expect(200)).body).toMatchObject({
      task: 'visual_check',
      label: 'Dachrinnen reinigen',
    })
    expect((await change({ task: null }).expect(400)).body.message).toBe(
      'Eine eigene Pflicht behält Bezeichnung, Grundlage, Quelle und Tätigkeit.',
    )
  })
})

describe('what a duty hangs on', () => {
  it('is exactly one, on its own property', async () => {
    const place = await placeIn()
    const other = await placeIn()
    const own = {
      label: 'Prüfen',
      basis: 'own_decision',
      sourceNote: 'Festlegung',
      intervalMonths: 12,
    }

    expect(
      (await post({ ...own, assetId: place.elevator, roomId: place.room }).expect(400)).body
        .message,
    ).toBe(
      'Eine Pflicht hängt an genau einem: einer Anlage, einem Raum, einem Gebäude oder der Liegenschaft.',
    )
    expect((await post(own).expect(400)).body.message).toBe(
      'Eine Pflicht hängt an einer Anlage, einem Raum, einem Gebäude oder einer Liegenschaft; keines ist genannt.',
    )
    expect(
      (await post({ ...own, assetId: place.elevator, propertyId: other.property }).expect(400)).body
        .message,
    ).toBe('Die Liegenschaft ist nicht die, auf der das Genannte steht.')
  })
})

describe('changing a duty', () => {
  it('sets the interval, who answers for it and who performs it, and keeps what it is', async () => {
    const place = await placeIn()
    const duty = (
      await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201)
    ).body
    const change = (body: object) =>
      http().patch(`/duties/${duty.id}`).set(testIdentityHeader, by('u-duties')).send(body)

    expect(
      (await change({ intervalMonths: 18, responsibleUserId: 'u-site' }).expect(200)).body,
    ).toMatchObject({ intervalMonths: 18, responsibleUserId: 'u-site', kind: mainTest })
    expect((await change({ performerNote: 'Prüfstelle Süd' }).expect(400)).body.message).toBe(
      'Die Angabe zur Fremdfirma gehört zu einer Pflicht, die eine Fremdfirma ausführt.',
    )
    expect((await change({ responsibleUserId: 'u-gone' }).expect(400)).body.message).toBe(
      'Verantwortlich ist jemand, der für diesen Betreiber arbeitet.',
    )
    expect((await change({ sourceNote: 'Vertrag' }).expect(400)).body.message).toBe(
      'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle und Tätigkeit von ihrer Pflichtart.',
    )
    expect((await change({ task: 'maintenance' }).expect(400)).body.message).toBe(
      'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle und Tätigkeit von ihrer Pflichtart.',
    )
  })

  it('asks for the reason of an interval where the interval or the reason changes, and not for naming who answers', async () => {
    const place = await placeIn()
    // As a duty confirmed before the guide of its kind changed: it departs
    // from the guide of today, 24 months, and nobody gave a reason. Put in
    // past the route, which would ask for one.
    const { rows } = await admin.query<{ id: string }>(
      `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                           counting, interval_months, confirmed_by)
       select tenant_id, property_id, area_id, id, $2, 1, 'from_performance', 12, 'u-duties'
         from assets where id = $1
       returning id`,
      [place.elevator, guided],
    )
    const change = (body: object) =>
      http()
        .patch(`/duties/${rows[0]?.id ?? ''}`)
        .set(testIdentityHeader, by('u-duties'))
        .send(body)
    const needsAReason =
      'Der Richtwert beträgt 24 Monate; eine Frist, die davon abweicht, braucht eine Begründung.'

    expect((await change({ responsibleUserId: 'u-site' }).expect(200)).body).toMatchObject({
      responsibleUserId: 'u-site',
      intervalMonths: 12,
      intervalReason: null,
    })
    expect((await change({ responsibleUserId: null }).expect(200)).body).toMatchObject({
      responsibleUserId: null,
    })
    expect((await change({ performer: 'own_staff' }).expect(200)).body).toMatchObject({
      performer: 'own_staff',
    })

    // Setting the interval, or taking its reason away, is asked as before.
    expect((await change({ intervalMonths: 18 }).expect(400)).body.message).toBe(needsAReason)
    expect((await change({ intervalReason: null }).expect(400)).body.message).toBe(needsAReason)
    expect(
      (await change({ intervalMonths: 18, intervalReason: 'Wenig genutzt.' }).expect(200)).body,
    ).toMatchObject({ intervalMonths: 18, intervalReason: 'Wenig genutzt.' })
  })
})

describe('the unit of an interval', () => {
  it('may change for a duty of the operator own, and the other unit goes', async () => {
    const place = await placeIn()
    const duty = (
      await post({
        buildingId: place.building,
        label: 'Dachrinnen reinigen',
        basis: 'insurer',
        sourceNote: 'Gebäudeversicherung, Vertrag 4711',
        task: 'maintenance',
        intervalMonths: 12,
      }).expect(201)
    ).body

    expect(
      (
        await http()
          .patch(`/duties/${duty.id}`)
          .set(testIdentityHeader, by('u-duties'))
          .send({ intervalDays: 90 })
          .expect(200)
      ).body,
    ).toMatchObject({ intervalDays: 90, intervalMonths: null })
  })
})

describe('ending a duty', () => {
  it('ends it once, and an ended duty changes no more', async () => {
    const place = await placeIn()
    const duty = (
      await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201)
    ).body
    const today = dayInGermany()

    expect(
      (
        await http()
          .post(`/duties/${duty.id}/end`)
          .set(testIdentityHeader, by('u-duties'))
          .send({ endReason: 'Aufzug zurückgebaut' })
          .expect(201)
      ).body,
    ).toMatchObject({ endsOn: today, endReason: 'Aufzug zurückgebaut' })
    expect(
      (
        await http()
          .post(`/duties/${duty.id}/end`)
          .set(testIdentityHeader, by('u-duties'))
          .send({})
          .expect(409)
      ).body.message,
    ).toBe(`Diese Pflicht endet schon am ${today}.`)
    expect(
      (
        await http()
          .patch(`/duties/${duty.id}`)
          .set(testIdentityHeader, by('u-duties'))
          .send({ intervalMonths: 12 })
          .expect(409)
      ).body.message,
    ).toBe('Diese Pflicht ist beendet; eine beendete Pflicht ändert sich nicht mehr.')
  })
})

describe('a dismissed proposal', () => {
  it('has its reason, once, and confirming the duty withdraws it', async () => {
    const place = await placeIn()
    const dismiss = (body: object) =>
      http().post('/duty-dismissals').set(testIdentityHeader, by('u-duties')).send(body)
    const dismissed = await dismiss({
      assetId: place.elevator,
      kind: mainTest,
      reason: 'Die Anlage ist stillgelegt und wird zurückgebaut.',
    }).expect(201)

    expect(dismissed.body).toMatchObject({
      assetId: place.elevator,
      kind: mainTest,
      kindVersion: 1,
      dismissedBy: 'u-duties',
    })
    expect(
      (await dismiss({ assetId: place.elevator, kind: mainTest }).expect(400)).body.message,
    ).toBe('Die Begründung fehlt.')
    expect(
      (
        await dismiss({ assetId: place.elevator, kind: mainTest, reason: 'Noch einmal' }).expect(
          409,
        )
      ).body.message,
    ).toBe('Dieser Vorschlag ist für die Anlage schon verworfen.')

    await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201)

    expect(
      (
        await http()
          .get(`/duty-dismissals?assetId=${place.elevator}`)
          .set(testIdentityHeader, by('u-duties'))
          .expect(200)
      ).body,
    ).toEqual([])
    expect(
      (await dismiss({ assetId: place.elevator, kind: mainTest, reason: 'Doch nicht' }).expect(409))
        .body.message,
    ).toBe(
      'Diese Pflicht ist an der Anlage bestätigt; beende sie, statt den Vorschlag zu verwerfen.',
    )
  })

  it('is withdrawn, and the proposal may be dismissed again', async () => {
    const place = await placeIn()
    const dismissed = await http()
      .post('/duty-dismissals')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: place.elevator, kind: mainTest, reason: 'Wird verlegt.' })
      .expect(201)

    await http()
      .delete(`/duty-dismissals/${dismissed.body.id}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)
    await http()
      .post('/duty-dismissals')
      .set(testIdentityHeader, by('u-duties'))
      .send({ assetId: place.elevator, kind: mainTest, reason: 'Wird doch verlegt.' })
      .expect(201)
  })
})

describe('the duties of an asset', () => {
  it('go with the asset when it is removed', async () => {
    const place = await placeIn()

    await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201)
    await http()
      .delete(`/assets/${place.elevator}`)
      .set(testIdentityHeader, by('u-duties'))
      .expect(200)

    expect(
      (
        await http()
          .get(`/duties?assetId=${place.elevator}`)
          .set(testIdentityHeader, by('u-duties'))
          .expect(200)
      ).body,
    ).toEqual([])
  })
})

describe('the rights', () => {
  it('let everybody on site read the register and only who keeps it change it', async () => {
    const place = await placeIn()

    await post({ assetId: place.elevator, kind: mainTest, intervalMonths: 24 }).expect(201)

    for (const userId of ['u-tech', 'u-site'] as const) {
      expect(
        (
          await http()
            .get(`/duties?assetId=${place.elevator}`)
            .set(testIdentityHeader, by(userId))
            .expect(200)
        ).body,
      ).toHaveLength(1)

      expect(
        (
          await post(
            {
              buildingId: place.building,
              label: 'Prüfen',
              basis: 'own_decision',
              sourceNote: 'x',
              intervalMonths: 1,
            },
            userId,
          ).expect(403)
        ).body.message,
      ).toBe(missingRight('duty.write'))
    }

    await post(
      { assetId: (await placeIn()).elevator, kind: mainTest, intervalMonths: 24 },
      'u-lead',
    ).expect(201)
  })

  it('show the north what is in the north and nothing of the south', async () => {
    const inNorth = await placeIn(large, { areaId: north })
    const inSouth = await placeIn(large, { areaId: south })

    await post(
      { assetId: inNorth.elevator, kind: mainTest, intervalMonths: 24 },
      'u-duties',
      large,
    ).expect(201)
    await post(
      { assetId: inSouth.elevator, kind: mainTest, intervalMonths: 24 },
      'u-duties',
      large,
    ).expect(201)

    const seen = (
      await http().get('/duties').set(testIdentityHeader, by('u-tech', large)).expect(200)
    ).body as { assetId: string }[]

    expect(seen.map((duty) => duty.assetId)).toEqual([inNorth.elevator])
  })
})
