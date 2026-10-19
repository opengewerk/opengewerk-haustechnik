import { randomUUID } from 'node:crypto'

import {
  type ActivityId,
  heldPageOf,
  type HeldRecord,
  readEvidenceState,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { shippedCatalogue } from '../catalogue.js'
import {
  activities,
  activityAnswers,
  activityDuties,
  assets,
  boardSections,
  buildings,
  circuits,
  defects,
  distributionBoards,
  duties,
  properties,
  rooms,
} from '../database/schema/index.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { evidencePrintJob } from '../prints/record-page.js'
import { answered } from '../sync/answers.js'
import { pageFingerprint, pageOf, takeSignature } from './signing.js'

/**
 * The test of an electrical installation measured on its circuits (#350),
 * from the answers to the PDF, with the catalogue this build ships: a
 * low-voltage installation with two boards, the duty of DGUV Vorschrift 3 in
 * its second version, whose form measures every circuit, and an activity
 * with the answers for each, one loop impedance outside the limit worked out
 * of its circuit. Device and server give the same page; the signature makes
 * a defect at the installation with the circuit; the evidence keeps the
 * circuits, and the PDF shows them as a table.
 */

const tenant = newId<'tenant'>() as TenantId
const elsewhere = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const technician = 'u-tech'
const names: Readonly<Record<string, string>> = {
  [lead]: 'Hanna Leitung',
  [technician]: 'Murat Yilmaz',
}
const catalogue = shippedCatalogue()
const at = new Date('2026-10-16T13:42:00.000Z')

let admin: Pool
let database: Database
let area = ''
let activityId = '' as ActivityId
let asset = ''
const circuitIds: Record<string, string> = {}

/** Runs some work as a person of the tenant, with the context of writing down. */
function as<Result>(
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
      at,
      catalogue,
      nameOf: (id) => names[id] ?? 'Unbekanntes Konto',
    }),
  )
}

/** The fingerprint of the page as the server works it out. */
function serverPage() {
  return as(lead, async (tx) => {
    const [row] = await tx.select().from(activities).where(eq(activities.id, activityId))

    if (!row) {
      throw new Error('No such activity')
    }

    return pageOf(tx, row, catalogue)
  })
}

/** The page as a device works it out from the same rows, held as it pulls them. */
function devicePage() {
  return as(lead, async (tx) => {
    const tables: Readonly<Record<string, PgTable>> = {
      activities,
      properties,
      assets,
      buildings,
      rooms,
      activity_duties: activityDuties,
      duties,
      defects,
      activity_answers: activityAnswers,
      distribution_boards: distributionBoards,
      board_sections: boardSections,
      circuits,
    }
    const held = new Map<string, readonly HeldRecord[]>()

    for (const [entity, table] of Object.entries(tables)) {
      held.set(entity, (await tx.select().from(table)) as HeldRecord[])
    }

    return heldPageOf(
      {
        find: (entity, id) => held.get(entity)?.find((row) => row['id'] === id) ?? null,
        related: (entity, field, id) => (held.get(entity) ?? []).filter((row) => row[field] === id),
      },
      activityId,
      catalogue,
    )
  })
}

beforeAll(async () => {
  admin = await connect()
  await resetToMigrated()

  for (const [id, name] of [
    [tenant, 'Werkhof Beispiel GmbH'],
    [elsewhere, 'Andere GmbH'],
  ] as const) {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [id, name])
  }

  for (const userId of [lead, technician]) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      names[userId],
      `${userId}@beispiel.example`,
    ])
  }

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

  const property = randomUUID()
  const building = randomUUID()

  asset = randomUUID()
  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Werkhof Nord', 'Lagerweg 12', '00002', 'Beispielstadt', 'DE-BW')`,
    [property, tenant, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Halle 1', '{school}')`,
    [building, tenant, property, area],
  )
  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, 'elektro.low_voltage_installation', 'AN-00012',
             'Elektrische Anlage Halle 1')`,
    [asset, tenant, property, area, building],
  )

  const place = [tenant, asset, property, area]
  const board = async (kind: string, designation: string, position: number) => {
    const { rows: made } = await admin.query<{ id: string }>(
      `insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation, position)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [...place, kind, designation, position],
    )

    return made[0]?.id ?? ''
  }
  const main = await board('main_distribution', 'HV 1', 0)
  const sub = await board('sub_distribution', 'UV 1', 1)
  const { rows: section } = await admin.query<{ id: string }>(
    `insert into board_sections (tenant_id, asset_id, property_id, area_id, distribution_board_id, designation, position)
     values ($1, $2, $3, $4, $5, 'Feld 2', 2) returning id`,
    [...place, main],
  )
  const circuit = async (
    on: string,
    sectionId: string | null,
    designation: string,
    consumer: string,
    characteristic: string,
    amps: number,
    rcd: boolean,
    position: number,
    deleted = false,
  ) => {
    const { rows: made } = await admin.query<{ id: string }>(
      `insert into circuits (tenant_id, asset_id, property_id, area_id, distribution_board_id,
                             board_section_id, designation, consumer, trip_characteristic,
                             rated_current_milli, rated_residual_current_milli, position, deleted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [
        ...place,
        on,
        sectionId,
        designation,
        consumer,
        characteristic,
        amps * 1000,
        rcd ? 30 : null,
        position,
        deleted ? at : null,
      ],
    )

    circuitIds[designation] = made[0]?.id ?? ''
  }

  // On the chart: Q1 on HV 1 directly, F5 in its section, then F1 and F3 on UV 1.
  await circuit(main, section[0]?.id ?? null, 'F5', 'Beleuchtung Halle', 'b', 10, true, 1)
  await circuit(main, null, 'Q1', 'Zuleitung UV 1', 'c', 63, false, 1)
  await circuit(sub, null, 'F3', 'Steckdosen Werkbank', 'b', 16, true, 3)
  await circuit(sub, null, 'F1', 'Licht Werkstatt', 'b', 10, true, 1)
  await circuit(sub, null, 'F9', 'Abgebaut', 'b', 16, true, 9, true)

  // A board taken away with a circuit on it the trigger did not reach: the
  // circuit is not on the chart either.
  const gone = await board('sub_distribution', 'UV 2', 2)

  await admin.query('update distribution_boards set deleted_at = $2 where id = $1', [gone, at])
  await circuit(gone, null, 'F2', 'Am abgebauten Verteiler', 'b', 16, true, 1)

  const { rows: duty } = await admin.query<{ id: string }>(
    `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                         counting, interval_months, confirmed_by)
     values ($1, $2, $3, $4, 'elektro.installation_test_dguv_v3', 2, 'from_due', 48, $5)
     returning id`,
    [tenant, property, area, asset, lead],
  )
  const { rows: activity } = await admin.query<{ id: ActivityId }>(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             performed_on, form_key, form_version)
     values ($1, $2, $3, $4, 'inspection', 'Prüfung der elektrischen Anlage', 'started',
             '2026-10-16', 'elektro.installation_test', 1)
     returning id`,
    [tenant, property, area, asset],
  )

  activityId = activity[0]?.id as ActivityId
  await admin.query(
    `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result)
     values ($1, $2, $3, $4, $5, 'with_defects')`,
    [tenant, property, area, activityId, duty[0]?.id],
  )

  const answer = (
    fieldKey: string,
    fields: {
      value?: string
      result?: string
      remark?: string
      groupKey?: string
      blockKey?: string
    },
  ) =>
    admin.query(
      `insert into activity_answers (tenant_id, property_id, area_id, activity_id, group_key,
                                     block_key, field_key, value, result, remark)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        tenant,
        property,
        area,
        activityId,
        fields.groupKey ?? null,
        fields.blockKey ?? null,
        fieldKey,
        fields.value ?? null,
        fields.result ?? null,
        fields.remark ?? null,
      ],
    )

  await answer('instrument', { value: '"Messgerät Probe 1664"' })
  await answer('earthing_system', { value: '"tn_s"' })

  for (const point of [
    'basic_protection',
    'protective_devices',
    'conductors',
    'identification',
    'fire_protection',
    'documentation',
    'rcd_test_button',
    'switchgear',
  ]) {
    await answer(point, { result: 'ok' })
  }

  // RPE, Riso, Zs, IΔ and tΔ in thousandths of their units; Q1 has no RCD.
  const measured: Readonly<Record<string, readonly (number | null)[]>> = {
    Q1: [80, 480_000, 180, null, null],
    F5: [420, 520_000, 920, 21_000, 24_000],
    F1: [610, 440_000, 1_210, 22_000, 26_000],
    F3: [470, 455_000, 3_400, 19_000, 24_000],
  }
  const fields = [
    'protective_conductor',
    'insulation_resistance',
    'loop_impedance',
    'rcd_trip_current',
    'rcd_trip_time',
  ]

  for (const [designation, values] of Object.entries(measured)) {
    const block = { groupKey: 'circuits', blockKey: circuitIds[designation] ?? '' }

    for (const [index, value] of values.entries()) {
      if (value !== null) {
        await answer(fields[index] ?? '', {
          ...block,
          value: String(value),
          ...(designation === 'F3' && index === 2
            ? { remark: 'Zweimal gemessen, gleicher Wert.' }
            : {}),
        })
      }
    }

    await answer('circuit_ok', { ...block, result: 'ok' })

    if (designation === 'F3') {
      await answer('remark', {
        ...block,
        value: '"Leitung zur Werkbank über eine Abzweigdose verlängert, Klemmstelle prüfen."',
      })
    }
  }
})

afterAll(async () => {
  await database.close()
  await admin.end()
})

describe('a test of the electrical installation measured on its circuits (#350)', () => {
  it('has the same page on the device and on the server, naming the circuits in the order of the chart', async () => {
    const server = await serverPage()
    const device = await devicePage()

    expect(device).not.toBeNull()
    expect(pageFingerprint(device ?? server)).toBe(pageFingerprint(server))
    expect(
      [...(server.circuits ?? [])]
        .sort((left, right) => left.place - right.place)
        .map((each) => `${each.board} ${each.designation}`),
    ).toEqual(['HV 1 Q1', 'HV 1 F5', 'UV 1 F1', 'UV 1 F3'])
  })

  it('writes a defect at the installation with the circuit, with the signature', async () => {
    const page = await serverPage()

    const taken = await as(technician, (tx, context) =>
      takeSignature(tx, context, {
        activityId,
        role: 'signer',
        signedAt: new Date('2026-10-16T13:38:00.000Z'),
        deviceInfo: 'Probe-Telefon',
        path: 'M10,10L200,300',
        typedName: null,
        pageFingerprint: pageFingerprint(page),
      }),
    )

    expect(taken.status).toBe('done')

    const { rows } = await admin.query<{
      asset_id: string
      circuit_id: string | null
      description: string
    }>('select asset_id, circuit_id, description from defects where found_in_activity_id = $1', [
      activityId,
    ])

    expect(rows.map(({ asset_id, circuit_id }) => ({ asset_id, circuit_id }))).toEqual([
      { asset_id: asset, circuit_id: circuitIds['F3'] },
    ])
    expect(rows[0]?.description).toContain('F3 Steckdosen Werkbank: Schleifenimpedanz Zs')
  })

  it('freezes the circuits in the evidence, which the PDF shows as a table', async () => {
    const { rows } = await admin.query<{ state: unknown; fingerprint: string }>(
      'select state, fingerprint from evidence where activity_id = $1',
      [activityId],
    )

    expect(rows).toHaveLength(1)

    const state = readEvidenceState(rows[0]?.state)

    expect(stateFingerprint(rows[0]?.state as object)).toBe(rows[0]?.fingerprint)
    expect(
      (state.circuits ?? []).map(({ board, boardKind, designation, protection, place }) => [
        board,
        boardKind,
        designation,
        protection,
        place,
      ]),
    ).toEqual([
      ['HV 1', 'main_distribution', 'Q1', 'C 63 A', 0],
      ['HV 1', 'main_distribution', 'F5', 'B 10 A, RCD 30 mA', 1],
      ['UV 1', 'sub_distribution', 'F1', 'B 10 A, RCD 30 mA', 2],
      ['UV 1', 'sub_distribution', 'F3', 'B 16 A, RCD 30 mA', 3],
    ])

    const zs = state.answers.find(
      (answer) => answer.circuit === circuitIds['F3'] && answer.label === 'Schleifenimpedanz Zs',
    )

    expect(zs?.limit).toMatchObject({ bound: 'höchstens 2,87 Ω', within: false })
    expect(zs?.workedOut).toBe('loop_impedance')

    const { html } = evidencePrintJob(state, rows[0]?.fingerprint ?? '', [], null)

    expect(html).toContain('<h2>Messen je Stromkreis</h2>')
    expect(html).toContain(
      '<tr class="board"><td colspan="9"><strong>UV 1</strong><span class="muted">, Unterverteilung</span></td></tr>',
    )
    expect(html).toContain(
      '<td><strong>F3</strong> Steckdosen Werkbank</td><td class="muted protection">B 16 A, RCD 30 mA</td>',
    )
    expect(html).toContain('<td class="figure"><strong class="out">3,40</strong></td>')
    expect(html).toContain('<td class="figure muted">≤ 2,87</td>')
    expect(html).toContain('Zs aus Charakteristik und Nennstrom (DIN VDE 0100-410')
    expect(html).toContain('RPE ohne Grenzwert')
    // The answers of the circuits stand in the table and not once more as points.
    expect(html).not.toContain(
      'Messen je Stromkreis, F3 Steckdosen Werkbank: Schleifenimpedanz Zs</td>',
    )
  })
})

describe('an answer in the block of a circuit, as the sync takes it (#350)', () => {
  /** What the sync says to a new answer in the block of a circuit. */
  function sent(blockKey: string) {
    return as(technician, async (tx) =>
      answered(catalogue)({
        tx,
        tenantId: tenant,
        operation: { entity: 'activity_answers', kind: 'create' } as never,
        table: activityAnswers,
        values: {
          activityId,
          groupKey: 'circuits',
          blockKey,
          fieldKey: 'circuit_ok',
          result: 'ok',
        },
        current: null,
        sender: {} as never,
      }),
    )
  }

  it('takes one for a circuit of the asset of the activity', async () => {
    expect(await sent(circuitIds['F1'] ?? '')).toBeNull()
  })

  it('refuses one for a circuit that is marked, of another asset or none at all', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
       select tenant_id, property_id, area_id, building_id, kind, 'AN-00013',
              'Elektrische Anlage Halle 2'
         from assets where id = $1 returning id`,
      [asset],
    )
    const other = rows[0]?.id ?? ''
    const { rows: board } = await admin.query<{ id: string }>(
      `insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation)
       select tenant_id, id, property_id, area_id, 'main_distribution', 'HV 2' from assets where id = $1
       returning id`,
      [other],
    )
    const { rows: foreign } = await admin.query<{ id: string }>(
      `insert into circuits (tenant_id, asset_id, property_id, area_id, distribution_board_id, designation)
       select tenant_id, asset_id, property_id, area_id, id, 'F1' from distribution_boards where id = $1
       returning id`,
      [board[0]?.id],
    )
    const refusal = {
      kind: 'client',
      message: '„Messen je Stromkreis“ fragt nur nach den Stromkreisen der Anlage des Vorgangs.',
    }

    for (const circuit of [circuitIds['F9'], foreign[0]?.id, randomUUID()]) {
      expect(await sent(circuit ?? '')).toEqual(refusal)
    }
  })
})

describe('the circuit of a defect (#350)', () => {
  /** What the database says to a defect of the activity that names a circuit. */
  async function naming(circuit: string): Promise<string> {
    return admin
      .query('update defects set circuit_id = $2 where found_in_activity_id = $1', [
        activityId,
        circuit,
      ])
      .then(() => 'written')
      .catch((error: { constraint?: string }) => error.constraint ?? 'refused')
  }

  it('is a circuit of the asset of the defect, of the same tenant', async () => {
    const { rows: areas } = await admin.query<{ id: string }>(
      `insert into areas (tenant_id, name) values ($1, 'Alle') returning id`,
      [elsewhere],
    )
    const { rows: made } = await admin.query<{ id: string }>(
      `with property as (
         insert into properties (tenant_id, area_id, name, street, postal_code, city, federal_state)
         values ($1, $2, 'Fremd', 'Weg 1', '00003', 'Anderswo', 'DE-BW') returning id, area_id
       ), building as (
         insert into buildings (tenant_id, property_id, area_id, name, kinds)
         select $1, id, area_id, 'Halle', '{school}' from property returning id, property_id, area_id
       ), asset as (
         insert into assets (tenant_id, property_id, area_id, building_id, kind, number, name)
         select $1, property_id, area_id, id, 'elektro.low_voltage_installation', 'AN-00001',
                'Fremde Anlage'
           from building returning id, property_id, area_id
       ), board as (
         insert into distribution_boards (tenant_id, asset_id, property_id, area_id, kind, designation)
         select $1, id, property_id, area_id, 'main_distribution', 'HV' from asset
         returning id, asset_id, property_id, area_id
       )
       insert into circuits (tenant_id, asset_id, property_id, area_id, distribution_board_id, designation)
       select $1, asset_id, property_id, area_id, id, 'F1' from board returning id`,
      [elsewhere, areas[0]?.id],
    )

    // The circuit of another asset of the tenant, made for the sync above.
    const { rows: beside } = await admin.query<{ id: string }>(
      'select id from circuits where tenant_id = $1 and asset_id <> $2',
      [tenant, asset],
    )

    expect(await naming(made[0]?.id ?? '')).toBe('defects_on_a_circuit_of_their_asset')
    expect(await naming(beside[0]?.id ?? '')).toBe('defects_on_a_circuit_of_their_asset')
    expect(await naming(randomUUID())).toBe('defects_on_a_circuit_of_their_asset')
    expect(await naming(circuitIds['F3'] ?? '')).toBe('written')
    // A defect on a circuit is at an asset, so that the key is asked.
    expect(
      await admin
        .query('update defects set asset_id = null where found_in_activity_id = $1', [activityId])
        .then(() => 'written')
        .catch((error: { constraint?: string }) => error.constraint ?? 'refused'),
    ).toBe('defects_circuit_at_an_asset')
  })

  it('goes from the defect when the circuit is removed for good, and the defect stays at its asset', async () => {
    await admin.query('delete from circuits where id = $1', [circuitIds['F3']])

    const { rows } = await admin.query<{ asset_id: string; circuit_id: string | null }>(
      'select asset_id, circuit_id from defects where found_in_activity_id = $1',
      [activityId],
    )

    expect(rows).toEqual([{ asset_id: asset, circuit_id: null }])
  })
})
