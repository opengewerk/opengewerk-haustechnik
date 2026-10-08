import { randomUUID } from 'node:crypto'

import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityId,
  type CatalogueBundle,
  catalogueOf,
  type DutyId,
  type TenantId,
  type WorkOrderId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { activities } from '../database/schema/index.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from '../database/test-database.js'
import { EvidenceRefusal } from '../evidence/write.js'
import {
  decideWorkOrder,
  pageFingerprint,
  pageOf,
  SigningRefusal,
  type SignatureToTake,
  takeSignature,
} from './signing.js'

/**
 * Signing an activity and writing it down (ADR 0004, points 7, 8 and 10,
 * section 4.8 of the concept): a signature only for the page the server works
 * out itself; one evidence per duty once every signature is there, with the
 * signatures that count; the countersignature after the signature; and a work
 * order that waits for its acceptance, while a rejection leaves its signature
 * standing and invalid.
 */

const tenant = newId<'tenant'>() as TenantId
const lead = 'u-lead'
const technician = 'u-tech'
const site = 'u-site'
const names: Readonly<Record<string, string>> = {
  [lead]: 'Hanna Probe',
  [technician]: 'Tom Technik',
  [site]: 'Sina Objekt',
}
const mainTest = 'probe.elevator_main_test'
const keptTest = 'probe.elevator_kept_test'
const at = new Date('2026-10-03T08:00:00.000Z')
const drawing = 'M10,10L200,300M400,20L410,30'

/** The probe package with a duty kind that takes a protocol, as in `evidence/write.test.ts`. */
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
              label: 'Sichtprüfung der Aufzugsanlage',
              counting: 'from_performance',
              evidence: { kinds: ['protocol', 'report', 'work_order'] },
            },
          },
        ],
      }
    }),
  }
}

const catalogue = catalogueOf(withAKeptTest(probeCatalogueBundle))

/** An asset a point of a form is about, which a test puts beside the asset of the activity. */
const pointedAsset = randomUUID()

/**
 * The catalogue with a check of the doors whose first point is about that
 * asset and whose second is about nothing, as a template of the operator
 * names a point's asset (#112).
 */
const withADoorCheck = catalogueOf({
  ...withAKeptTest(probeCatalogueBundle),
  packages: withAKeptTest(probeCatalogueBundle).packages.map((pack) => ({
    ...pack,
    forms: [
      ...pack.forms,
      {
        key: 'probe.door_check',
        version: 1,
        validFrom: '2015-06-01',
        definition: {
          title: 'Türen',
          sections: [
            {
              key: 'doors',
              title: 'Türen',
              fields: [
                {
                  kind: 'check_point',
                  key: 'door',
                  label: 'Tür',
                  about: { kind: 'asset', id: pointedAsset },
                },
                { kind: 'check_point', key: 'frame', label: 'Rahmen' },
              ],
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
let area = ''
let numbers = 0

/** An activity at a new asset, to meet a duty of the kept kind, done on the first of October. */
async function activityToSign(
  kind: 'inspection' | 'round' | 'work_order' = 'inspection',
  { countersigned = false, duties = 1 }: { countersigned?: boolean; duties?: number } = {},
): Promise<{ activity: ActivityId; duties: DutyId[]; workOrder: WorkOrderId | null }> {
  const property = randomUUID()
  const building = randomUUID()
  const asset = randomUUID()

  numbers += 1
  await admin.query(
    `insert into properties (id, tenant_id, area_id, name, street, postal_code, city, federal_state)
     values ($1, $2, $3, 'Campus Nord', 'Nordstraße 12', '68535', 'Edingen-Neckarhausen', 'DE-BW')`,
    [property, tenant, area],
  )
  await admin.query(
    `insert into buildings (id, tenant_id, property_id, area_id, name, kinds)
     values ($1, $2, $3, $4, 'Haus A', '{school}')`,
    [building, tenant, property, area],
  )
  await admin.query(
    `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
     values ($1, $2, $3, $4, $5, 'probe.elevator', $6, 'Aufzug Haus A')`,
    [asset, tenant, property, area, building, `AN-${String(numbers).padStart(5, '0')}`],
  )

  const { rows } = await admin.query<{ id: ActivityId }>(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             performed_on, countersignature_required)
     values ($1, $2, $3, $4, $5, 'Sichtprüfung Aufzug Haus A', 'started', '2026-10-01', $6)
     returning id`,
    [tenant, property, area, asset, kind, countersigned],
  )
  const activity = rows[0]?.id as ActivityId
  const made: DutyId[] = []

  for (let index = 0; index < duties; index += 1) {
    // One duty of the kept kind at most: a kind stands once at an asset.
    const kindOfDuty = kind === 'round' || index > 0 ? null : keptTest
    const { rows: duty } = await admin.query<{ id: DutyId }>(
      kindOfDuty === null
        ? `insert into duties (tenant_id, property_id, area_id, asset_id, label, basis, source_note,
                               counting, interval_months, confirmed_by)
           values ($1, $2, $3, $4, $5, 'own_decision', 'Hausordnung', 'from_performance', 1, $6)
           returning id`
        : `insert into duties (tenant_id, property_id, area_id, asset_id, kind, kind_version,
                               counting, interval_months, confirmed_by)
           values ($1, $2, $3, $4, $5, 1, 'from_performance', 12, $6) returning id`,
      kindOfDuty === null
        ? [tenant, property, area, asset, `Kontrollgang ${String(index + 1)}`, lead]
        : [tenant, property, area, asset, kindOfDuty, lead],
    )
    const dutyId = duty[0]?.id as DutyId

    made.push(dutyId)
    await admin.query(
      `insert into activity_duties (tenant_id, property_id, area_id, activity_id, duty_id, result)
       values ($1, $2, $3, $4, $5, 'without_defects')`,
      [tenant, property, area, activity, dutyId],
    )
  }

  let workOrder: WorkOrderId | null = null

  if (kind === 'work_order') {
    const { rows: order } = await admin.query<{ id: WorkOrderId }>(
      `insert into work_orders (tenant_id, property_id, area_id, activity_id, number, kind)
       values ($1, $2, $3, $4, $5, 'inspection') returning id`,
      [tenant, property, area, activity, `AU-2026-${String(numbers).padStart(4, '0')}`],
    )

    workOrder = order[0]?.id ?? null
  }

  return { activity, duties: made, workOrder }
}

/** Runs some work as a person of the tenant, with the context of writing down. */
function as<Result>(
  userId: string,
  work: (
    tx: Parameters<Parameters<Database['forTenant']>[1]>[0],
    context: Parameters<typeof takeSignature>[1],
  ) => Promise<Result>,
  when: Date = at,
): Promise<Result> {
  return database.forTenant({ tenantId: tenant, userId }, (tx) =>
    work(tx, {
      tenantId: tenant,
      writtenBy: userId,
      at: when,
      catalogue,
      nameOf: (id) => names[id] ?? 'Unbekanntes Konto',
    }),
  )
}

/** The fingerprint of the page of an activity as the device shows it, worked out from the records. */
function shownPage(activity: ActivityId): Promise<string> {
  return as(lead, async (tx) => {
    const [row] = await tx
      .select()
      .from(activities)
      .where(and(eq(activities.tenantId, tenant), eq(activities.id, activity)))

    if (!row) {
      throw new Error('No such activity')
    }

    return pageFingerprint(await pageOf(tx, row))
  })
}

/** A signature of a role for what the device showed. */
async function signatureFor(
  activity: ActivityId,
  role: 'signer' | 'countersigner' = 'signer',
  fingerprint?: string,
): Promise<SignatureToTake> {
  return {
    activityId: activity,
    role,
    signedAt: new Date('2026-10-01T09:30:00.000Z'),
    deviceInfo: 'Probe-Telefon',
    path: drawing,
    pageFingerprint: fingerprint ?? (await shownPage(activity)),
  }
}

/** The sentence a signature or a decision was refused with, or what else became of it. */
async function refusalOf(pending: Promise<unknown>): Promise<string> {
  try {
    await pending

    return 'taken'
  } catch (error) {
    return error instanceof SigningRefusal || error instanceof EvidenceRefusal
      ? error.message
      : `other: ${String(error)}`
  }
}

async function countOf(table: string, column: string, id: string): Promise<number> {
  const { rows } = await admin.query<{ count: number }>(
    `select count(*)::int as count from ${table} where ${column} = $1`,
    [id],
  )

  return rows[0]?.count ?? 0
}

async function statusOf(activity: ActivityId): Promise<string | undefined> {
  const { rows } = await admin.query<{ status: string }>(
    'select status from activities where id = $1',
    [activity],
  )

  return rows[0]?.status
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)

  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, 'Wohnbau Nord eG'])

  for (const userId of [lead, technician, site]) {
    await admin.query('insert into auth_users (id, name, email) values ($1, $2, $3)', [
      userId,
      names[userId],
      `${userId}@beispiel.example`,
    ])
  }

  // The first membership gives the operator its first area, and the Leitung every area.
  await admin.query(
    `insert into memberships (tenant_id, user_id, roles) values
       ($1, $2, '{management}'), ($1, $3, '{technician}'), ($1, $4, '{site_management}')`,
    [tenant, lead, technician, site],
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

describe('a signature on an activity', () => {
  it('writes the activity down, one evidence per duty, with the signature in its state', async () => {
    const { activity, duties } = await activityToSign('inspection', { duties: 3 })
    const [taken0, taken1, takenOff] = duties

    // The third duty was taken off the activity before it was signed.
    await admin.query(
      'update activity_duties set deleted_at = now() where activity_id = $1 and duty_id = $2',
      [activity, takenOff],
    )

    const signature = await signatureFor(activity)
    const taken = await as(technician, (tx, context) => takeSignature(tx, context, signature))

    expect(await countOf('evidence', 'duty_id', takenOff as string)).toBe(0)
    expect([taken0, taken1].every((duty) => duty !== undefined)).toBe(true)

    expect(taken.status).toBe('done')
    expect(taken.written.map((evidence) => evidence.state.origin)).toEqual(['protocol', 'protocol'])
    expect(new Set(taken.written.map((evidence) => evidence.state.duty.kind))).toEqual(
      new Set([keptTest, null]),
    )
    expect(taken.written[0]?.state.signatures).toEqual([
      { name: 'Tom Technik', role: 'signer', signedAt: '2026-10-01T09:30:00.000Z' },
    ])
    expect(taken.written[0]?.state.performer).toEqual({ person: 'Tom Technik' })
    expect(taken.written[0]?.state.writtenBy).toBe('Tom Technik')
    expect(await statusOf(activity)).toBe('done')

    for (const duty of duties.slice(0, 2)) {
      expect(await countOf('evidence', 'duty_id', duty)).toBe(1)
    }
  })

  it('is about what is said on site, and nothing the server or the office adds', async () => {
    const { activity, duties } = await activityToSign('inspection', { duties: 2 })

    for (const [description, marked] of [
      ['Türlichtschranke verschmutzt.', true],
      ['Kabinenbeleuchtung flackert.', false],
    ] as const) {
      await admin.query(
        `insert into defects (tenant_id, property_id, area_id, asset_id, found_in_activity_id,
                              description, found_on, due_on, deleted_at)
         select tenant_id, property_id, area_id, asset_id, id, $2, '2026-10-01', '2026-11-01', $3
           from activities where id = $1`,
        [activity, description, marked ? new Date() : null],
      )
    }

    const page = await as(lead, async (tx) => {
      const [row] = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.tenantId, tenant), eq(activities.id, activity)))

      return pageOf(tx, row as typeof activities.$inferSelect)
    })

    // The asset by its key and not by the number the server drew, no label
    // out of the catalogue, no due day of a defect, no marked defect, and the
    // duties in the order of their keys.
    expect(page.place.asset).toEqual({
      id: expect.any(String) as unknown as string,
      name: 'Aufzug Haus A',
      kind: 'probe.elevator',
      serialNumber: null,
    })
    expect(page.defects.map((defect) => Object.keys(defect).sort())).toEqual([
      ['defectClass', 'description', 'id'],
    ])
    expect(page.defects.map((defect) => defect.description)).toEqual([
      'Kabinenbeleuchtung flackert.',
    ])
    expect(page.duties.map((line) => line.dutyId)).toEqual([...duties].sort())
  })

  it('is refused for another page than the one shown, and nothing stays of it', async () => {
    const { activity } = await activityToSign()
    const shown = await shownPage(activity)

    // The office renames the activity while the technician signs on site.
    await admin.query(`update activities set title = 'Sichtprüfung Lastenaufzug' where id = $1`, [
      activity,
    ])

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity, 'signer', shown)),
        ),
      ),
    ).toBe(
      'Die Seite hat sich geändert, seit sie gezeigt wurde. Sie wird neu gezeigt und neu unterschrieben.',
    )
    expect(await countOf('activity_signatures', 'activity_id', activity)).toBe(0)
    expect(await statusOf(activity)).toBe('started')
  })

  it('is given once the day and a result of every duty are there, and only once', async () => {
    const { activity } = await activityToSign()

    await admin.query('update activities set performed_on = null where id = $1', [activity])

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('Der Tag der Durchführung fehlt.')

    await admin.query(`update activities set performed_on = '2026-10-01' where id = $1`, [activity])
    await admin.query('update activity_duties set result = null where activity_id = $1', [activity])

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('Jede Pflicht des Vorgangs braucht ein Ergebnis, bevor unterschrieben wird.')

    await admin.query(`update activity_duties set result = 'with_defects' where activity_id = $1`, [
      activity,
    ])
    await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('Dieser Vorgang ist abgeschlossen.')
  })

  it('is refused with a drawing or a fingerprint of another shape', async () => {
    const { activity } = await activityToSign()

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, { ...(await signatureFor(activity)), path: 'M1,1L1001,2' }),
        ),
      ),
    ).toBe('Die Unterschrift ist ein Linienzug im Feld, höchstens 40000 Zeichen.')
  })

  it('is refused when the kind of a duty takes no protocol, and nothing stays of it', async () => {
    const { activity, duties } = await activityToSign()

    // The main test of the probe package takes reports only.
    await admin.query('update duties set kind = $1 where id = $2', [mainTest, duties[0]])

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('Diese Pflichtart nimmt als Nachweis: Bericht einer Fremdfirma oder Prüforganisation.')
    expect(await countOf('activity_signatures', 'activity_id', activity)).toBe(0)
    expect(await countOf('evidence', 'activity_id', activity)).toBe(0)
    expect(await statusOf(activity)).toBe('started')
  })

  it('writes a round down as points of a round', async () => {
    const { activity } = await activityToSign('round')
    const taken = await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    expect(taken.written.map((evidence) => evidence.state.origin)).toEqual(['round_point'])
  })
})

describe('an activity with a form', () => {
  /** An answer to a point of the reading form of the probe package, as a row holds it. */
  interface Given {
    readonly field: string
    readonly result?: string
    readonly value?: string
    readonly remark?: string
  }

  /** An activity to sign, filled in the reading form, with these answers. */
  async function filledIn(given: readonly Given[], countersigned = false): Promise<ActivityId> {
    const { activity } = await activityToSign('inspection', { countersigned })
    const { rows } = await admin.query<{ property_id: string }>(
      `update activities set form_key = 'probe.water_meter_reading', form_version = 1
        where id = $1 returning property_id`,
      [activity],
    )

    for (const answer of given) {
      await admin.query(
        `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key,
                                       result, value, remark)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenant,
          rows[0]?.property_id,
          area,
          activity,
          answer.field,
          answer.result ?? null,
          answer.value ?? null,
          answer.remark ?? null,
        ],
      )
    }

    return activity
  }

  /** The defects that came of the answers of an activity: what they say, and the answer. */
  async function defectsOf(activity: ActivityId) {
    const { rows } = await admin.query<{ description: string; answer: string | null }>(
      `select d.description, a.field_key as answer
         from defects d left join activity_answers a on a.id = d.found_in_answer_id
        where d.found_in_activity_id = $1 and d.deleted_at is null`,
      [activity],
    )

    return rows
  }

  const everyPoint: readonly Given[] = [
    { field: 'seal_intact', result: 'not_ok', remark: 'Plombe fehlt.' },
    { field: 'no_leak', result: 'ok' },
    { field: 'reading', value: '1234567' },
  ]

  it('is signed only once every point has its answer, and the remark each answer asks for', async () => {
    const activity = await filledIn([
      { field: 'seal_intact', result: 'ok' },
      { field: 'no_leak', result: 'not_ok' },
    ])
    const input = await signatureFor(activity)

    expect(
      await refusalOf(as(technician, (tx, context) => takeSignature(tx, context, input))),
    ).toBe(
      'Jeder Punkt braucht seine Antwort, bevor unterschrieben wird. ' +
        'Zähler dicht: zu „nicht in Ordnung“ fehlt die Bemerkung. Zählerstand fehlt.',
    )
    expect(await countOf('activity_signatures', 'activity_id', activity)).toBe(0)
  })

  it('names the form and the answers on its page, so a signature for other answers is refused', async () => {
    const activity = await filledIn(everyPoint)
    const shown = await signatureFor(activity)

    await admin.query(
      `update activity_answers set value = '1234568' where activity_id = $1 and field_key = 'reading'`,
      [activity],
    )

    expect(
      await refusalOf(as(technician, (tx, context) => takeSignature(tx, context, shown))),
    ).toBe(
      'Die Seite hat sich geändert, seit sie gezeigt wurde. Sie wird neu gezeigt und neu unterschrieben.',
    )
  })

  it('finds the defect of a point at the asset the point is about, and at the activity otherwise', async () => {
    const { activity } = await activityToSign()
    const { rows } = await admin.query<{
      property_id: string
      asset_id: string
      building_id: string
    }>(
      `select a.property_id, a.asset_id, s.building_id
         from activities a join assets s on s.id = a.asset_id
        where a.id = $1`,
      [activity],
    )
    const here = rows[0]

    await admin.query(
      `insert into assets (id, tenant_id, property_id, area_id, building_id, kind, number, name)
       values ($1, $2, $3, $4, $5, 'probe.elevator', 'AN-99999', 'Aufzug Haus B')`,
      [pointedAsset, tenant, here?.property_id, area, here?.building_id],
    )
    await admin.query(
      `update activities set form_key = 'probe.door_check', form_version = 1 where id = $1`,
      [activity],
    )

    for (const [field, remark] of [
      ['door', 'Tür klemmt.'],
      ['frame', 'Rahmen lose.'],
    ]) {
      await admin.query(
        `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key,
                                       result, remark)
         values ($1, $2, $3, $4, $5, 'not_ok', $6)`,
        [tenant, here?.property_id, area, activity, field, remark],
      )
    }

    const input = await signatureFor(activity)

    expect(
      await refusalOf(
        database.forTenant({ tenantId: tenant, userId: technician }, (tx) =>
          takeSignature(
            tx,
            {
              tenantId: tenant,
              writtenBy: technician,
              at,
              catalogue: withADoorCheck,
              nameOf: (id) => names[id] ?? 'Unbekanntes Konto',
            },
            input,
          ),
        ),
      ),
    ).toBe('taken')

    const { rows: found } = await admin.query<{ description: string; asset_id: string }>(
      `select description, asset_id from defects where found_in_activity_id = $1
        order by description desc`,
      [activity],
    )

    expect(found).toEqual([
      { description: 'Tür: Tür klemmt.', asset_id: pointedAsset },
      { description: 'Rahmen: Rahmen lose.', asset_id: here?.asset_id },
    ])
  })

  it('makes a defect of an answer not in order with the signature, before the countersignature, and once', async () => {
    const activity = await filledIn(everyPoint, true)
    const signer = await signatureFor(activity)

    expect(
      await refusalOf(as(technician, (tx, context) => takeSignature(tx, context, signer))),
    ).toBe('taken')
    expect(await statusOf(activity)).toBe('signed')
    expect(await defectsOf(activity)).toEqual([
      { description: 'Plombe unversehrt: Plombe fehlt.', answer: 'seal_intact' },
    ])

    // The defect is not on the page: the countersignature is for the page the signature was.
    const countersigner = await signatureFor(activity, 'countersigner')

    expect(countersigner.pageFingerprint).toBe(signer.pageFingerprint)
    expect(
      await refusalOf(as(site, (tx, context) => takeSignature(tx, context, countersigner))),
    ).toBe('taken')
    expect(await statusOf(activity)).toBe('done')
    expect(await defectsOf(activity)).toHaveLength(1)

    const { rows } = await admin.query<{
      state: { answers: { label: string }[]; defects: { description: string }[] }
    }>('select state from evidence where activity_id = $1', [activity])

    expect(rows[0]?.state.answers.map((answer) => answer.label)).toEqual([
      'Plombe unversehrt',
      'Zähler dicht',
      'Zählerstand',
    ])
    expect(rows[0]?.state.defects).toEqual([
      { description: 'Plombe unversehrt: Plombe fehlt.', defectClass: null, dueOn: null },
    ])
  })
})

describe('a countersignature', () => {
  it('comes after the signature, and the activity is written down with both', async () => {
    const { activity, duties } = await activityToSign('round', { countersigned: true })

    expect(
      await refusalOf(
        as(site, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity, 'countersigner')),
        ),
      ),
    ).toBe('Gegengezeichnet wird nach der Unterschrift.')

    const signed = await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    expect(signed).toMatchObject({ status: 'signed', written: [] })
    expect(await countOf('evidence', 'duty_id', duties[0] as string)).toBe(0)
    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('Dieser Vorgang ist schon unterschrieben.')

    const countersigned = await as(site, async (tx, context) =>
      takeSignature(tx, context, {
        ...(await signatureFor(activity, 'countersigner')),
        signedAt: new Date('2026-10-02T07:00:00.000Z'),
      }),
    )

    expect(countersigned.status).toBe('done')
    expect(countersigned.written[0]?.state.signatures).toEqual([
      { name: 'Tom Technik', role: 'signer', signedAt: '2026-10-01T09:30:00.000Z' },
      { name: 'Sina Objekt', role: 'countersigner', signedAt: '2026-10-02T07:00:00.000Z' },
    ])
  })

  it('is refused where the template asks for none', async () => {
    const { activity } = await activityToSign('inspection', { countersigned: false })

    expect(
      await refusalOf(
        as(site, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity, 'countersigner')),
        ),
      ),
    ).toBe('Dieser Vorgang wird nicht gegengezeichnet.')
  })

  it('needs a signature for the page as it is now; one for an older page stays and counts no more', async () => {
    const { activity } = await activityToSign('round', { countersigned: true })

    await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )
    // The page changes after the signature, past the application.
    await admin.query(
      `update activities set title = 'Kontrollgang Technikzentrale' where id = $1`,
      [activity],
    )

    expect(
      await refusalOf(
        as(site, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity, 'countersigner')),
        ),
      ),
    ).toBe('Gegengezeichnet wird nach der Unterschrift.')

    await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    const done = await as(site, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity, 'countersigner')),
    )

    expect(done.status).toBe('done')
    expect(done.written[0]?.state.signatures.map((signature) => signature.role)).toEqual([
      'signer',
      'countersigner',
    ])
    expect(await countOf('activity_signatures', 'activity_id', activity)).toBe(3)
  })
})

describe('a work order', () => {
  it('waits for its acceptance after the signature, and the acceptance writes it down', async () => {
    const { activity, duties, workOrder } = await activityToSign('work_order')
    const signed = await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    expect(signed).toMatchObject({ status: 'signed', written: [] })
    expect(await countOf('evidence', 'duty_id', duties[0] as string)).toBe(0)

    const accepted = await as(lead, (tx, context) =>
      decideWorkOrder(tx, context, {
        workOrderId: workOrder as WorkOrderId,
        decision: 'accepted',
        reason: null,
      }),
    )

    expect(accepted.status).toBe('done')
    expect(accepted.written.map((evidence) => evidence.state.origin)).toEqual(['work_order'])
    expect(accepted.written[0]?.state.writtenBy).toBe('Hanna Probe')
    // Who did it is who signed, not who accepted.
    expect(accepted.written[0]?.state.performer).toEqual({ person: 'Tom Technik' })
  })

  it('is turned back with a reason, which leaves the signature standing and no longer valid', async () => {
    const { activity, workOrder } = await activityToSign('work_order')
    const order = workOrder as WorkOrderId

    expect(
      await refusalOf(
        as(lead, (tx, context) =>
          decideWorkOrder(tx, context, { workOrderId: order, decision: 'accepted', reason: null }),
        ),
      ),
    ).toBe('Abgenommen oder zurückgewiesen wird ein unterschriebener Auftrag.')

    await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    expect(
      await refusalOf(
        as(lead, (tx, context) =>
          decideWorkOrder(tx, context, { workOrderId: order, decision: 'rejected', reason: ' ' }),
        ),
      ),
    ).toBe('Eine Zurückweisung nennt ihren Grund.')

    const rejected = await as(lead, (tx, context) =>
      decideWorkOrder(tx, context, {
        workOrderId: order,
        decision: 'rejected',
        reason: 'Die Notrufverbindung fehlt noch.',
      }),
    )

    expect(rejected).toMatchObject({ status: 'started', written: [] })
    expect(
      await refusalOf(
        as(lead, (tx, context) =>
          decideWorkOrder(tx, context, { workOrderId: order, decision: 'accepted', reason: null }),
        ),
      ),
    ).toBe('Abgenommen oder zurückgewiesen wird ein unterschriebener Auftrag.')

    // Signed again after the work went on, and accepted: the evidence names
    // the new signature, and the old one is still there.
    await as(technician, async (tx, context) =>
      takeSignature(tx, context, {
        ...(await signatureFor(activity)),
        signedAt: new Date('2026-10-02T15:00:00.000Z'),
      }),
    )

    const accepted = await as(lead, (tx, context) =>
      decideWorkOrder(tx, context, { workOrderId: order, decision: 'accepted', reason: null }),
    )

    expect(accepted.written[0]?.state.signatures).toEqual([
      { name: 'Tom Technik', role: 'signer', signedAt: '2026-10-02T15:00:00.000Z' },
    ])
    expect(await countOf('activity_signatures', 'activity_id', activity)).toBe(2)
    expect(await countOf('work_order_decisions', 'work_order_id', order)).toBe(2)
  })
})

/**
 * Two devices that signed the same page without a network and send at once,
 * or two people who accept the same order at once (opengewerk-haustechnik#31).
 * Each was checked against what the other had not written yet, and both wrote
 * the activity down: two evidences per duty, which nobody can change or delete.
 *
 * Both have to meet at the check for a test to show anything, and two that
 * merely start together meet only when the timing allows. So a third
 * connection holds the row of the activity until both stand in line behind
 * it, and lets go only then.
 */
describe('two at the same moment', () => {
  async function inLine<Result>(
    activity: ActivityId,
    both: () => readonly Promise<Result>[],
  ): Promise<PromiseSettledResult<Result>[]> {
    const holder = await admin.connect()

    try {
      await holder.query('begin')
      await holder.query('select id from activities where id = $1 for update', [activity])

      const pending = both()

      for (let tries = 0; tries < 400; tries += 1) {
        const { rows } = await admin.query<{ waiting: number }>(
          `select count(*)::int as waiting from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'`,
        )

        if ((rows[0]?.waiting ?? 0) >= 2) {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      await holder.query('commit')

      return await Promise.allSettled(pending)
    } finally {
      holder.release()
    }
  }

  function refusals(settled: readonly PromiseSettledResult<unknown>[]): string[] {
    return settled.flatMap((result) =>
      result.status === 'rejected' && result.reason instanceof SigningRefusal
        ? [result.reason.message]
        : [],
    )
  }

  it('write an activity down once: the second signature waits and finds it done', async () => {
    const { activity, duties } = await activityToSign('inspection')
    const signature = await signatureFor(activity)

    const settled = await inLine(activity, () => [
      as(technician, (tx, context) => takeSignature(tx, context, signature)),
      as(lead, (tx, context) => takeSignature(tx, context, signature)),
    ])

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(refusals(settled)).toEqual(['Dieser Vorgang ist abgeschlossen.'])
    expect(await countOf('activity_signatures', 'activity_id', activity)).toBe(1)
    expect(await countOf('evidence', 'duty_id', duties[0] as string)).toBe(1)
  })

  it('accept an order once: the second acceptance waits and finds it done', async () => {
    const { activity, duties, workOrder } = await activityToSign('work_order')
    const order = workOrder as WorkOrderId

    await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    const accept = () =>
      as(lead, (tx, context) =>
        decideWorkOrder(tx, context, { workOrderId: order, decision: 'accepted', reason: null }),
      )
    const settled = await inLine(activity, () => [accept(), accept()])

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(refusals(settled)).toEqual([
      'Abgenommen oder zurückgewiesen wird ein unterschriebener Auftrag.',
    ])
    expect(await countOf('work_order_decisions', 'work_order_id', order)).toBe(1)
    expect(await countOf('evidence', 'duty_id', duties[0] as string)).toBe(1)
  })
})
