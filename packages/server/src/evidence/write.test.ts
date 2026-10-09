import { randomUUID } from 'node:crypto'

import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityId,
  type CatalogueBundle,
  catalogueOf,
  type DutyId,
  type EvidenceState,
  evidenceStateVersion,
  readEvidenceState,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { evidenceIntact, stateFingerprint } from './fingerprint.js'
import { type EvidenceToWrite, EvidenceRefusal, writeEvidence } from './write.js'

/**
 * Writing an evidence down (ADR 0004, points 1 to 6): the number from the
 * sequence of the evidence, the frozen state with what the records say on
 * the day, the fingerprint over its canonical form on the row and in the log,
 * and the refusals that leave nothing behind, not even a number.
 */

const tenant = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const technician = 'u-tech'
const names: Readonly<Record<string, string>> = {
  [lead]: 'Hanna Probe',
  [technician]: 'Tom Technik',
}
const mainTest = 'probe.elevator_main_test'
const keptTest = 'probe.elevator_kept_test'
const at = new Date('2026-10-03T08:00:00.000Z')

/**
 * The probe package with one more duty kind, like the main test but taking a
 * protocol as well and keeping its evidence for a number of years from a rule.
 */
function withAKeptTest(bundle: CatalogueBundle): CatalogueBundle {
  return {
    ...bundle,
    packages: bundle.packages.map((pack) => {
      const main = pack.dutyKinds.find((entry) => entry.key === mainTest)
      const rule = pack.rules[0]

      if (main === undefined || rule === undefined || main.definition.interval.kind === 'none') {
        return pack
      }

      const keepYears = main.definition.interval.rule.replace(
        'elevator_main_test_interval',
        'kept_years',
      )

      return {
        ...pack,
        rules: [
          ...pack.rules,
          { ...rule, record: { ...rule.record, key: keepYears, unit: 'years', value: 10 } },
        ],
        dutyKinds: [
          ...pack.dutyKinds,
          {
            ...main,
            key: keptTest,
            definition: {
              ...main.definition,
              label: 'Sichtprüfung der Aufzugsanlage',
              source: 'Betriebsanleitung des Herstellers, Abschnitt 7',
              counting: 'from_performance',
              evidence: { kinds: ['protocol', 'report'] },
              retention: { kind: 'years', rule: keepYears },
            },
          },
        ],
      }
    }),
  }
}

const catalogue = catalogueOf(withAKeptTest(probeCatalogueBundle))

interface Place {
  readonly property: string
  readonly area: string
  readonly building: string
  readonly room: string
  readonly asset: string
}

let admin: Pool
let database: Database
let area = ''
let numbers = 0

async function placeIn(): Promise<Place> {
  const property = randomUUID()
  const building = randomUUID()
  const floor = randomUUID()
  const room = randomUUID()
  const asset = randomUUID()

  numbers += 1
  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenant, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, short_code, kinds)
     values ($1, $2, $3, $4, 'Haus A', 'A', '{school}')`,
    [building, tenant, property, area],
  )
  await admin.query(
    `insert into floors (id, tenant_id, building_id, property_id, area_id, name, level)
     values ($1, $2, $3, $4, $5, 'Erdgeschoss', 0)`,
    [floor, tenant, building, property, area],
  )
  await admin.query(
    `insert into rooms (id, tenant_id, floor_id, building_id, property_id, area_id, number, name)
     values ($1, $2, $3, $4, $5, $6, '0.12', 'Technik')`,
    [room, tenant, floor, building, property, area],
  )
  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, room_id, kind, number, name,
                         serial_number)
     values ($1, $2, $3, $4, $5, $6, 'probe.elevator', $7, 'Aufzug Haus A', 'SN-4711')`,
    [asset, tenant, property, area, building, room, `AN-${String(numbers).padStart(5, '0')}`],
  )

  return { property, area, building, room, asset }
}

/** A duty of the catalogue at the asset of a place. */
async function dutyOfKind(place: Place, kind: string, months = 12): Promise<DutyId> {
  const { rows } = await admin.query<{ id: DutyId }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version, counting,
                         interval_months, confirmed_by)
     values ($1, $2, $3, $4, $5, 1, $6, $7, $8) returning id`,
    [
      tenant,
      place.property,
      place.area,
      place.asset,
      kind,
      kind === mainTest ? 'betrsichv' : 'from_performance',
      months,
      lead,
    ],
  )

  return rows[0]?.id as DutyId
}

/** An activity at the asset that is to meet a duty, with a defect noticed in it. */
async function activityFor(place: Place, duty: DutyId): Promise<ActivityId> {
  const { rows } = await admin.query<{ id: ActivityId }>(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title)
     values ($1, $2, $3, $4, 'inspection', 'Sichtprüfung Aufzug Haus A') returning id`,
    [tenant, place.property, place.area, place.asset],
  )
  const activity = rows[0]?.id as ActivityId

  await admin.query(
    `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id)
     values ($1, $2, $3, $4, $5)`,
    [tenant, place.property, place.area, activity, duty],
  )
  await admin.query(
    `insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                          description, found_on, due_on)
     values ($1, $2, $3, $4, $5, 'Notruf im Fahrkorb ohne Verbindung.', '2026-10-01', '2026-11-01')`,
    [tenant, place.property, place.area, place.asset, activity],
  )

  return activity
}

/** The performance of a protocol by the technician, as a test changes it. */
function protocol(duty: DutyId, activity: ActivityId | null): EvidenceToWrite {
  return {
    dutyId: duty,
    activityId: activity,
    origin: 'protocol',
    performedOn: '2026-10-01',
    result: 'with_defects',
    resultReason: null,
    performedBy: technician,
    examiner: null,
    signatures: [{ name: 'Tom Technik', role: 'signer', signedAt: '2026-10-01T09:30:00.000Z' }],
    files: [],
  }
}

/** Writes an evidence down in a transaction of the lead, as the server will. */
function write(input: EvidenceToWrite, when: Date = at) {
  return database.forTenant({ tenantId: tenant, userId: lead }, (tx) =>
    writeEvidence(
      tx,
      {
        tenantId: tenant,
        writtenBy: lead,
        at: when,
        catalogue,
        nameOf: (userId) => names[userId] ?? 'Unbekanntes Konto',
      },
      input,
    ),
  )
}

/** The sentence a writing was refused with, or what else became of it. */
async function refusalOf(input: EvidenceToWrite, when: Date = at): Promise<string> {
  try {
    await write(input, when)

    return 'written'
  } catch (error) {
    return error instanceof EvidenceRefusal ? error.message : `other: ${String(error)}`
  }
}

/** The row of an evidence as the database holds it. */
async function rowOf(id: string) {
  const { rows } = await admin.query<{
    number: string
    state: EvidenceState
    fingerprint: string
    written_at: Date
    performed_by: string | null
    activity_id: string | null
  }>(
    `select number, state, fingerprint, written_at, performed_by, activity_id
       from evidence where id = $1`,
    [id],
  )

  return rows[0]
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  for (const userId of [lead, technician]) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      names[userId],
      `${userId}@beispiel.example`,
    ])
  }

  // The first membership gives the operator its first area, and the Leitung every area.
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, $2, '{management}'), ($1, $3, '{technician}')`,
    [tenant, lead, technician],
  )

  const { rows } = await admin.query<{ id: string }>('select id from areas where tenant_id = $1', [
    tenant,
  ])

  area = rows[0]?.id ?? ''
  database = Database.connect(applicationDatabaseUrl())
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('an evidence written down', () => {
  it('gets the next number, the state of the day and the fingerprint over it', async () => {
    const place = await placeIn()
    const duty = await dutyOfKind(place, keptTest)
    const activity = await activityFor(place, duty)

    // A second defect noticed later, and one that was marked: the state names
    // the live ones in the order they were noticed.
    for (const [description, marked] of [
      ['Türlichtschranke verschmutzt.', true],
      ['Kabinenbeleuchtung flackert.', false],
    ] as const) {
      await admin.query(
        `insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                              description, found_on, deleted_at)
         values ($1, $2, $3, $4, $5, $6, '2026-10-01', $7)`,
        [
          tenant,
          place.property,
          place.area,
          place.asset,
          activity,
          description,
          marked ? new Date() : null,
        ],
      )
    }

    const written = await write(protocol(duty, activity))
    const expected: EvidenceState = {
      version: evidenceStateVersion,
      number: 'NW-2026-00001',
      origin: 'protocol',
      performedOn: '2026-10-01',
      result: 'with_defects',
      resultReason: null,
      remark: null,
      replaces: null,
      form: null,
      answers: [],
      duty: {
        label: 'Sichtprüfung der Aufzugsanlage',
        kind: keptTest,
        kindVersion: 1,
        source: 'Betriebsanleitung des Herstellers, Abschnitt 7',
        interval: { months: 12 },
        counting: 'from_performance',
      },
      place: {
        property: { name: 'Campus Nord', address: 'Nordstraße 12, 68535 Edingen-Neckarhausen' },
        building: { name: 'Haus A', shortCode: 'A' },
        room: { number: '0.12', name: 'Technik' },
        asset: {
          number: 'AN-00001',
          name: 'Aufzug Haus A',
          kind: 'probe.elevator',
          kindLabel: catalogue.assetKind('probe.elevator', '2026-10-03')?.definition.label ?? null,
          serialNumber: 'SN-4711',
        },
      },
      activity: { kind: 'inspection', title: 'Sichtprüfung Aufzug Haus A' },
      performer: { person: 'Tom Technik' },
      defects: [
        {
          description: 'Notruf im Fahrkorb ohne Verbindung.',
          defectClass: null,
          dueOn: '2026-11-01',
        },
        { description: 'Kabinenbeleuchtung flackert.', defectClass: null, dueOn: null },
      ],
      signatures: [{ name: 'Tom Technik', role: 'signer', signedAt: '2026-10-01T09:30:00.000Z' }],
      files: [],
      retention: {
        kind: 'years',
        years: 10,
        rule: expect.stringMatching(/kept_years$/) as unknown as string,
        on: '2026-10-01',
      },
      writtenBy: 'Hanna Probe',
      writtenAt: '2026-10-03T08:00:00.000Z',
    }

    expect(written.number).toBe('NW-2026-00001')
    expect(written.state).toEqual(expected)
    expect(written.fingerprint).toBe(stateFingerprint(written.state))

    const row = await rowOf(written.id)

    expect(row?.number).toBe('NW-2026-00001')
    expect(row?.state).toEqual(written.state)
    expect(row?.fingerprint).toBe(written.fingerprint)
    expect(row?.written_at.toISOString()).toBe('2026-10-03T08:00:00.000Z')
    expect(row?.performed_by).toBe(technician)
    expect(
      evidenceIntact({ state: row?.state ?? { version: 0 }, fingerprint: row?.fingerprint ?? '' }),
    ).toBe(true)

    // The next one gets the next number, without a hole.
    expect((await write(protocol(duty, activity))).number).toBe('NW-2026-00002')
  })

  it('keeps what was true on the day, whatever changes afterwards', async () => {
    const place = await placeIn()
    const duty = await dutyOfKind(place, keptTest)
    const activity = await activityFor(place, duty)
    const written = await write(protocol(duty, activity))

    await admin.query(`update assets set name = 'Lastenaufzug' where id = $1`, [place.asset])
    await admin.query('update duties set interval_months = 6 where id = $1', [duty])
    await admin.query('update defects set deleted_at = now() where found_in_activity_id = $1', [
      activity,
    ])

    const row = await rowOf(written.id)
    const state = readEvidenceState(row?.state)

    expect(state.place.asset?.name).toBe('Aufzug Haus A')
    expect(state.duty.interval).toEqual({ months: 12 })
    expect(state.defects).toHaveLength(1)
    expect(row?.fingerprint).toBe(written.fingerprint)
  })

  it('names the examiner of a report, and the retention of its kind', async () => {
    const place = await placeIn()
    const duty = await dutyOfKind(place, mainTest, 24)
    const written = await write({
      ...protocol(duty, null),
      origin: 'report',
      result: 'without_defects',
      performedBy: null,
      examiner: { name: 'Erika Muster', organisation: 'Prüfstelle Süd' },
      signatures: [],
    })

    expect(written.state.performer).toEqual({
      examiner: 'Erika Muster',
      organisation: 'Prüfstelle Süd',
    })
    expect(written.state.activity).toBeNull()
    expect(written.state.defects).toEqual([])
    expect(written.state.duty).toMatchObject({
      label: 'Hauptprüfung der Aufzugsanlage',
      counting: 'betrsichv',
      interval: { months: 24 },
    })
    expect(written.state.retention).toEqual({ kind: 'while_in_use', on: '2026-10-01' })
  })

  it('stands with its fingerprint in the log', async () => {
    const place = await placeIn()
    const duty = await dutyOfKind(place, keptTest)
    const written = await write(protocol(duty, await activityFor(place, duty)))
    const { rows } = await admin.query<{ new_value: string; user_id: string | null }>(
      `select new_value, user_id from audit_entries
        where table_name = 'evidence' and record_id = $1 and field = 'fingerprint'`,
      [written.id],
    )

    expect(rows).toEqual([{ new_value: written.fingerprint, user_id: lead }])
  })

  it('is refused, and leaves no number behind, where it may not be written', async () => {
    const place = await placeIn()
    const kept = await dutyOfKind(place, keptTest)
    const main = await dutyOfKind(place, mainTest, 24)
    const activity = await activityFor(place, kept)
    const before = (await write(protocol(kept, activity))).number

    expect(await refusalOf(protocol(main, null))).toBe(
      'Diese Pflichtart nimmt als Nachweis: Bericht einer Fremdfirma oder Prüforganisation.',
    )
    expect(await refusalOf({ ...protocol(kept, await activityFor(place, main)) })).toBe(
      'Dieser Vorgang soll die Pflicht nicht erfüllen.',
    )
    expect(await refusalOf({ ...protocol(kept, activity), performedOn: '2026-10-04' })).toBe(
      'Ein Nachweis gilt für einen Tag, der schon war.',
    )
    expect(await refusalOf({ ...protocol(kept, activity), result: 'not_performed' })).toBe(
      'Was nicht durchgeführt wurde, nennt den Grund.',
    )
    expect(
      await refusalOf({
        ...protocol(kept, activity),
        performedBy: null,
        examiner: { name: 'Erika Muster', organisation: ' ' },
      }),
    ).toBe('Prüfer und Organisation stehen zusammen: wer von außen prüft, nennt beide.')

    await admin.query('update duties set deleted_at = now() where id = $1', [main])

    expect(await refusalOf({ ...protocol(main, null), origin: 'report' })).toBe(
      'Diese Pflicht gibt es nicht.',
    )

    // A refusal of the database after the number was drawn takes the number
    // back with the transaction: an examiner and a person at once.
    expect(
      await refusalOf({
        ...protocol(kept, activity),
        examiner: { name: 'Erika Muster', organisation: 'Prüfstelle Süd' },
      }),
    ).toMatch(/^other: /)

    const next = (await write(protocol(kept, activity))).number

    expect(Number(next.slice(-5))).toBe(Number(before.slice(-5)) + 1)
  })

  it('shows a state that was changed past the database', async () => {
    const place = await placeIn()
    const duty = await dutyOfKind(place, keptTest)
    const written = await write(protocol(duty, await activityFor(place, duty)))
    const tampered = { ...written.state, result: 'without_defects' as const }

    expect(evidenceIntact({ state: written.state, fingerprint: written.fingerprint })).toBe(true)
    expect(evidenceIntact({ state: tampered, fingerprint: written.fingerprint })).toBe(false)
  })
})
