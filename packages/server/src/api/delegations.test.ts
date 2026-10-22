import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  addDays,
  catalogueOf,
  type DelegationEntry,
  type DelegationReading,
  type IsoDate,
  missingRight,
  type RoleKey,
  shippedRoles,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inEveryArea } from '../database/every-area.js'
import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { delegationSource } from '../deadlines/sources.js'
import { applyDelegations } from '../delegations/apply.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { dayInGermany } from '../today.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * The delegation of the operator's duties (#336, section 4.3 of the
 * concept): written, signed for the operator and revoked by the Leitung
 * alone; holding only once the person it goes to signed as well, and fixed
 * from the first signature on, also in the database; giving every duty in
 * its scope its person, and leaving them without one once it ended.
 */

const tenant = newId<'tenant'>() as TenantId
const areas = { north: '', south: '' }

const people: Readonly<Record<string, { readonly role: RoleKey; readonly name: string }>> = {
  'u-lead': { role: 'management', name: 'Sabine Krämer' },
  'u-duties': { role: 'technical_management', name: 'Jörg Albrecht' },
  'u-site': { role: 'site_management', name: 'Dennis Roth' },
  'u-tech': { role: 'technician', name: 'Tobias Wendt' },
}

let admin: Pool
let database: Database
let app: INestApplication

const catalogue = catalogueOf(probeCatalogueBundle)
const today = dayInGermany()

function http() {
  return request(app.getHttpServer())
}

function by(userId: keyof typeof people & string): string {
  return as(tenant, userId, people[userId]?.role as RoleKey)
}

const assetsAt = { north: '', south: '' }

/** A duty of the operator's own at the asset of an area; its id. */
async function dutyAt(
  where: 'north' | 'south',
  responsible: string | null = null,
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                         counting, interval_months, confirmed_by, responsible_user_id)
     select tenant_id, property_id, area_id, id, 'Prüfung', 'manufacturer', 'Betriebsanleitung',
            'from_performance', 12, 'u-duties', $2
       from assets where id = $1
     returning id`,
    [assetsAt[where], responsible],
  )

  return rows[0]?.id ?? ''
}

async function responsibleOf(duty: string) {
  const { rows } = await admin.query<{ user: string | null; delegation: string | null }>(
    'select responsible_user_id as user, responsible_delegation_id as delegation from duties where id = $1',
    [duty],
  )

  return rows[0]
}

function terms(further: Readonly<Record<string, unknown>> = {}) {
  return {
    delegateUserId: 'u-duties',
    areaIds: [areas.north],
    scope: 'all',
    tasks: 'Organisation der Prüfungen im Bereich.',
    powers: 'Weisungsbefugnis gegenüber der Haustechnik im Bereich.',
    startsOn: today,
    endsOn: addDays(today, 365),
    ...further,
  }
}

async function written(
  further: Readonly<Record<string, unknown>> = {},
): Promise<DelegationReading> {
  return (
    await http()
      .post('/delegations')
      .set(testIdentityHeader, by('u-lead'))
      .send(terms(further))
      .expect(201)
  ).body as DelegationReading
}

/** A signature for the page as it stands, with the typed name of the person, answered with a status. */
async function signAs(id: string, userId: keyof typeof people & string, status = 201) {
  // Read as the Leitung, who reads every delegation: the person it goes to reads it only once the Leitung signed.
  const page = (
    await http().get(`/delegations/${id}`).set(testIdentityHeader, by('u-lead')).expect(200)
  ).body as DelegationReading

  return http()
    .post(`/delegations/${id}/sign`)
    .set(testIdentityHeader, by(userId))
    .send({ pageFingerprint: stateFingerprint(page.page), typedName: people[userId]?.name })
    .expect(status)
}

/** A delegation both signed; its page. */
async function signedByBoth(further: Readonly<Record<string, unknown>> = {}) {
  const made = await written(further)

  await signAs(made.id, 'u-lead')

  return (await signAs(made.id, 'u-duties')).body as DelegationReading
}

/** Every delegation written so far ended yesterday, past the application, so that a test starts with none in force. */
async function endedAll(): Promise<void> {
  await admin.query(
    `insert into duty_delegation_revocations (tenant_id, delegation_id, effective_on, reason, revoked_by, revoked_at)
     select tenant_id, id, current_date - 1, 'Ende des Tests.', 'u-lead', now() from duty_delegations d
      where not exists (select 1 from duty_delegation_revocations r where r.delegation_id = d.id)`,
  )
  await applyOn(today)
}

/** The delegations applied on another day than today, as the pass of the deadlines does. */
function applyOn(day: IsoDate) {
  return inEveryArea(database, { tenantId: tenant, userId: 'u-lead' }, (tx) =>
    applyDelegations(tx, catalogue, day),
  )
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Stadt Probe'])

  for (const role of shippedRoles) {
    await admin.query(
      `insert into tenant_roles (tenant_id, key, label, rights, leads, second_factor)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenant, role.key, role.label, [...role.rights], role.leads, role.secondFactor],
    )
  }

  const { rows } = await admin.query<{ id: string; name: string }>(
    `insert into areas (tenant_id, name) values ($1, 'Nord'), ($1, 'Süd') returning id, name`,
    [tenant],
  )

  areas.north = rows.find((row) => row.name === 'Nord')?.id ?? ''
  areas.south = rows.find((row) => row.name === 'Süd')?.id ?? ''

  for (const [userId, person] of Object.entries(people)) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      person.name,
      `${userId}@probe.example`,
    ])
    await admin.query('insert into memberships (tenant_id, user_id, roles) values ($1, $2, $3)', [
      tenant,
      userId,
      [person.role],
    ])
  }

  await admin.query(
    `insert into member_areas (tenant_id, user_id, area_id) values ($1, 'u-site', $2), ($1, 'u-tech', $2)`,
    [tenant, areas.north],
  )

  database = Database.connect(applicationDatabaseUrl())

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  for (const where of ['north', 'south'] as const) {
    const made = async (path: string, body: object): Promise<string> =>
      (await http().post(path).set(testIdentityHeader, by('u-lead')).send(body).expect(201)).body.id
    const property = await made('/properties', {
      name: `Schulzentrum ${where}`,
      street: 'Neckarstraße 4',
      postalCode: '68535',
      city: 'Edingen-Neckarhausen',
      federalState: 'DE-BW',
      areaId: areas[where],
    })
    const building = await made(`/properties/${property}/buildings`, {
      name: where === 'north' ? 'Haus Nord' : 'Haus Süd',
      kinds: ['school'],
    })

    assetsAt[where] = await made(`/buildings/${building}/assets`, {
      kind: 'probe.elevator',
      name: 'Aufzug',
    })
  }
})

afterAll(async () => {
  await app.close()
  await database.close()
  await admin.end()
})

describe('a delegation of duties', () => {
  it('is written, changed, signed for the operator and revoked by the Leitung, and by no other role', async () => {
    for (const userId of ['u-duties', 'u-site', 'u-tech'] as const) {
      expect(
        (
          await http()
            .post('/delegations')
            .set(testIdentityHeader, by(userId))
            .send(terms())
            .expect(403)
        ).body.message,
      ).toBe(missingRight('duty.delegate'))
      await http().get('/delegations').set(testIdentityHeader, by(userId)).expect(403)
    }

    const made = await written()

    expect(made.state).toBe('draft')
    await http()
      .post(`/delegations/${made.id}/revoke`)
      .set(testIdentityHeader, by('u-duties'))
      .send({ effectiveOn: today, reason: 'Wechsel.' })
      .expect(403)
    // The person it goes to signs only after the Leitung.
    await signAs(made.id, 'u-lead')
    expect(
      (await http().get('/delegations').set(testIdentityHeader, by('u-lead')).expect(200)).body
        .delegations.length,
    ).toBeGreaterThan(0)
  })

  it('goes to somebody who sees every area it names, and to nobody else, not to the Leitung itself', async () => {
    // The Objektleitung of the north sees the north alone.
    expect(
      (
        await http()
          .post('/delegations')
          .set(testIdentityHeader, by('u-lead'))
          .send(terms({ delegateUserId: 'u-site', areaIds: [areas.north, areas.south] }))
          .expect(400)
      ).body.message,
    ).toBe(
      'Beauftragt wird jemand, der jeden Bereich der Übertragung sieht. Geben Sie der Person die Bereiche unter „Zugänge“, oder wählen Sie andere.',
    )

    const made = await written({ delegateUserId: 'u-site' })

    await http()
      .patch(`/delegations/${made.id}`)
      .set(testIdentityHeader, by('u-lead'))
      .send(terms({ delegateUserId: 'u-site', areaIds: [areas.north, areas.south] }))
      .expect(400)
    // Who sees every area is named for any of them.
    await written({ areaIds: [areas.north, areas.south] })
    // And nobody delegates to themself: for the operator signs somebody else.
    expect(
      (
        await http()
          .post('/delegations')
          .set(testIdentityHeader, by('u-lead'))
          .send(terms({ delegateUserId: 'u-lead' }))
          .expect(400)
      ).body.message,
    ).toBe(
      'Sich selbst überträgt niemand Pflichten: für den Betreiber unterschreibt eine andere Person.',
    )
  })

  it('holds once both have signed, and from the first signature on changes in no way, also not in the database', async () => {
    const made = await written()

    // Nobody signed: it changes, and the person it goes to does not see it yet.
    await http()
      .patch(`/delegations/${made.id}`)
      .set(testIdentityHeader, by('u-lead'))
      .send(terms({ tasks: 'Organisation aller Prüfungen im Bereich.' }))
      .expect(200)
    await http().get(`/delegations/${made.id}`).set(testIdentityHeader, by('u-duties')).expect(404)
    await signAs(made.id, 'u-duties', 404)

    const signedOnce = (await signAs(made.id, 'u-lead')).body as DelegationReading

    expect([signedOnce.state, signedOnce.signs]).toEqual(['waiting', null])
    await http()
      .patch(`/delegations/${made.id}`)
      .set(testIdentityHeader, by('u-lead'))
      .send(terms({ tasks: 'Etwas anderes.' }))
      .expect(409)
    await http().delete(`/delegations/${made.id}`).set(testIdentityHeader, by('u-lead')).expect(409)
    await expect(
      admin.query(`update duty_delegations set tasks = 'Etwas anderes.' where id = $1`, [made.id]),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query('delete from duty_delegation_areas where delegation_id = $1', [made.id]),
    ).rejects.toMatchObject({ code: 'HT005' })
    await expect(
      admin.query(
        `update duty_delegation_signatures set typed_name = 'Jemand' where delegation_id = $1`,
        [made.id],
      ),
    ).rejects.toMatchObject({ code: 'HT005' })

    const both = (await signAs(made.id, 'u-duties')).body as DelegationReading

    expect(both.state).toBe('in_force')
    expect(both.signatures.map((signature) => [signature.role, signature.name])).toEqual([
      ['operator', 'Sabine Krämer'],
      ['delegate', 'Jörg Albrecht'],
    ])
  })

  it('takes a signature only for the page that was shown and with the name of the account', async () => {
    const made = await written()

    await http()
      .post(`/delegations/${made.id}/sign`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ pageFingerprint: 'a'.repeat(64), typedName: 'Sabine Krämer' })
      .expect(409)
    expect(
      (
        await http()
          .post(`/delegations/${made.id}/sign`)
          .set(testIdentityHeader, by('u-lead'))
          .send({ pageFingerprint: stateFingerprint(made.page), typedName: 'Jemand Anderes' })
          .expect(400)
      ).body.message,
    ).toBe('Bestätigt wird mit dem eigenen Namen, wie er im Konto steht: Sabine Krämer.')
    await signAs(made.id, 'u-lead')
    // Signed once for the operator, and not a second time.
    await signAs(made.id, 'u-lead', 409)
  })

  it('gives every duty in its scope its person, also over one without a delegation, and leaves them without one once it ended', async () => {
    await endedAll()

    const before = await dutyAt('north', 'u-site')
    const south = await dutyAt('south')
    // A duty that has ended calls for nobody, and stays as it ended.
    const ended = await dutyAt('north', 'u-site')

    await admin.query('update duties set ends_on = $2 where id = $1', [ended, today])

    const delegation = await signedByBoth()

    expect(await responsibleOf(before)).toEqual({ user: 'u-duties', delegation: delegation.id })
    expect(await responsibleOf(ended)).toEqual({ user: 'u-site', delegation: null })
    // Outside its areas nothing changes.
    expect(await responsibleOf(south)).toEqual({ user: null, delegation: null })

    // A duty added while it holds comes under it at once.
    const later = (
      await http()
        .post('/duties')
        .set(testIdentityHeader, by('u-lead'))
        .send({
          assetId: assetsAt.north,
          label: 'Wartung nach Angabe des Herstellers',
          basis: 'manufacturer',
          sourceNote: 'Betriebsanleitung, Abschnitt 7',
          task: 'maintenance',
          intervalMonths: 12,
        })
        .expect(201)
    ).body as { id: string; responsibleUserId: string | null }

    expect(later.responsibleUserId).toBe('u-duties')
    expect(await responsibleOf(later.id)).toEqual({ user: 'u-duties', delegation: delegation.id })

    // The day after its end it covers nothing: its duties have nobody.
    await applyOn(addDays(delegation.lastDay, 1))
    expect(await responsibleOf(before)).toEqual({ user: null, delegation: null })

    const listed = (
      await http().get('/delegations').set(testIdentityHeader, by('u-lead')).expect(200)
    ).body as { duties: { withoutResponsible: number } }

    expect(listed.duties.withoutResponsible).toBeGreaterThan(0)
    await applyOn(today)
  })

  it('counts no longer the day after the last day of the access of its person (#356, #530)', async () => {
    await endedAll()

    const duty = await dutyAt('north', 'u-site')

    await signedByBoth()
    expect(await responsibleOf(duty)).toMatchObject({ user: 'u-duties' })

    // The access of the person it goes to ends today; tomorrow the duty has nobody.
    await admin.query(
      "update memberships set last_day = current_date where tenant_id = $1 and user_id = 'u-duties'",
      [tenant],
    )

    try {
      await applyOn(today)
      expect(await responsibleOf(duty)).toMatchObject({ user: 'u-duties' })

      await applyOn(addDays(today, 1))
      expect(await responsibleOf(duty)).toEqual({ user: null, delegation: null })
    } finally {
      await admin.query(
        "update memberships set last_day = null where tenant_id = $1 and user_id = 'u-duties'",
        [tenant],
      )
      await endedAll()
    }
  })

  it('ends earlier with a revocation and its reason, and stays readable', async () => {
    await endedAll()

    const duty = await dutyAt('north')
    const delegation = await signedByBoth()
    const revoked = (
      await http()
        .post(`/delegations/${delegation.id}/revoke`)
        .set(testIdentityHeader, by('u-lead'))
        .send({ effectiveOn: today, reason: 'Wechsel in die Liegenschaftsverwaltung.' })
        .expect(201)
    ).body as DelegationReading

    expect([revoked.state, revoked.lastDay, revoked.revocation?.reason]).toEqual([
      'revoked',
      today,
      'Wechsel in die Liegenschaftsverwaltung.',
    ])
    await applyOn(addDays(today, 1))
    expect(await responsibleOf(duty)).toEqual({ user: null, delegation: null })
    await applyOn(today)
  })

  it('leaves a duty that two cover to the office, which chooses one of their persons and nobody else', async () => {
    await endedAll()

    // In the south, where no delegation of the tests before holds today.
    const duty = await dutyAt('south')
    const first = await signedByBoth({ scope: 'all', areaIds: [areas.south] })
    const { rows } = await admin.query<{ id: string }>(
      `insert into duty_delegations (tenant_id, delegate_user_id, delegate_name, scope, tasks, powers, starts_on, ends_on)
       values ($1, 'u-site', 'Dennis Roth', 'all', 'Aufgaben.', 'Befugnisse.', $2, $3) returning id`,
      [tenant, today, addDays(today, 30)],
    )
    const second = rows[0]?.id ?? ''

    await admin.query(
      'insert into duty_delegation_areas (tenant_id, delegation_id, area_id) values ($1, $2, $3)',
      [tenant, second, areas.south],
    )

    for (const [role, userId] of [
      ['operator', 'u-lead'],
      ['delegate', 'u-site'],
    ] as const) {
      await admin.query(
        `insert into duty_delegation_signatures (tenant_id, delegation_id, role, signed_by, signed_at, typed_name, page_fingerprint)
         values ($1, $2, $3, $4, now(), 'Name', $5)`,
        [tenant, second, role, userId, 'b'.repeat(64)],
      )
    }

    await applyOn(today)
    // It keeps the one it had.
    expect(await responsibleOf(duty)).toEqual({ user: 'u-duties', delegation: first.id })
    expect(
      (
        await http()
          .patch(`/duties/${duty}`)
          .set(testIdentityHeader, by('u-lead'))
          .send({ responsibleUserId: 'u-tech' })
          .expect(400)
      ).body.message,
    ).toMatch(/^Mehrere Pflichtenübertragungen decken diese Pflicht/)
    await http()
      .patch(`/duties/${duty}`)
      .set(testIdentityHeader, by('u-lead'))
      .send({ responsibleUserId: 'u-site' })
      .expect(200)
    expect(await responsibleOf(duty)).toEqual({ user: 'u-site', delegation: second })
  })

  it('is read by the person it goes to once the Leitung signed, and by nobody else without the right', async () => {
    const made = await written()

    expect(
      (
        (await http().get('/delegations/mine').set(testIdentityHeader, by('u-duties')).expect(200))
          .body as DelegationEntry[]
      ).some((entry) => entry.id === made.id),
    ).toBe(false)
    await signAs(made.id, 'u-lead')
    expect(
      (
        (await http().get('/delegations/mine').set(testIdentityHeader, by('u-duties')).expect(200))
          .body as DelegationEntry[]
      ).find((entry) => entry.id === made.id)?.state,
    ).toBe('waiting')
    await http().get(`/delegations/${made.id}`).set(testIdentityHeader, by('u-site')).expect(404)
    await http().get(`/delegations/${made.id}`).set(testIdentityHeader, by('u-duties')).expect(200)

    // Their own, with no right at all: in a role that reads no duty (#543).
    const withoutARight = as(tenant, 'u-duties', 'reporter')

    expect(
      (
        (await http().get('/delegations/mine').set(testIdentityHeader, withoutARight).expect(200))
          .body as DelegationEntry[]
      ).some((entry) => entry.id === made.id),
    ).toBe(true)
    await http().get(`/delegations/${made.id}`).set(testIdentityHeader, withoutARight).expect(200)
    // And of nobody else: somebody without the right who is not the person it goes to.
    await http()
      .get(`/delegations/${made.id}`)
      .set(testIdentityHeader, as(tenant, 'u-site', 'reporter'))
      .expect(404)
  })

  it('is a deadline at its last day once both signed, named by the person', async () => {
    const delegation = await signedByBoth({ endsOn: addDays(today, 90) })
    // Signed by the Leitung alone, it holds nothing yet and ends nothing.
    const waiting = await written({ endsOn: addDays(today, 90) })

    await signAs(waiting.id, 'u-lead')

    const expected = await inEveryArea(database, { tenantId: tenant, userId: 'u-lead' }, (tx) =>
      delegationSource({ today: () => today })(tx),
    )

    expect(expected.find((each) => each.sourceId === delegation.id)).toMatchObject({
      sourceLabel: 'Jörg Albrecht',
      anchorOn: addDays(today, 90),
    })
    expect(expected.find((each) => each.sourceId === waiting.id)).toBeUndefined()
  })
})
