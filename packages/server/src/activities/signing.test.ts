import { randomUUID } from 'node:crypto'

import { probeCatalogueBundle } from '@opengewerk/haustechnik-catalogue/testing'
import {
  type ActivityId,
  type CatalogueBundle,
  catalogueOf,
  type DutyId,
  type RoundRecordState,
  type TenantId,
  type WorkOrderId,
} from '@opengewerk/haustechnik-domain'
import { Database, newId } from '@opengewerk/platform-server'
import { and, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { activities } from '../database/schema/index.js'
import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
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
    // The technician leads the order and finishes it with the signature (#118).
    await admin.query('update activities set responsible_user_id = $2 where id = $1', [
      activity,
      technician,
    ])

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
    typedName: null,
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
  await resetToMigrated()

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
      {
        name: 'Tom Technik',
        role: 'signer',
        signedAt: '2026-10-01T09:30:00.000Z',
        path: drawing,
        way: 'drawing',
      },
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

  it('keeps what was said with the result in each evidence, on the page that is signed', async () => {
    const { activity } = await activityToSign()

    await admin.query(
      `update activity_duties set remark = 'Bremse nachgestellt.' where activity_id = $1`,
      [activity],
    )

    const signature = await signatureFor(activity)
    const taken = await as(technician, (tx, context) => takeSignature(tx, context, signature))

    expect(taken.written.map((evidence) => evidence.state.remark)).toEqual(['Bremse nachgestellt.'])

    // Said after the signature, it is another page: the signature counts no more.
    await admin.query(`update activity_duties set remark = 'Anders.' where activity_id = $1`, [
      activity,
    ])

    expect(await shownPage(activity)).not.toBe(signature.pageFingerprint)
  })

  it('is refused as "ohne Mangel" while a defect was reported in the activity, and taken with defects', async () => {
    const { activity } = await activityToSign()
    const { rows } = await admin.query<{ property_id: string; asset_id: string }>(
      'select property_id, asset_id from activities where id = $1',
      [activity],
    )

    await admin.query(
      `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on,
                            found_in_activity_id)
       values ($1, $2, $3, $4, 'Seil angerissen', '2026-10-01', $5)`,
      [tenant, rows[0]?.property_id, area, rows[0]?.asset_id, activity],
    )

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('Ein Vorgang, der einen Mangel festhält, ist nicht „ohne Mangel“.')
    expect(await countOf('activity_signatures', 'activity_id', activity)).toBe(0)

    await admin.query(`update activity_duties set result = 'with_defects' where activity_id = $1`, [
      activity,
    ])

    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('taken')
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

  it('is taken confirmed with the typed name of the account, and the state says which way (#209)', async () => {
    const { activity, duties } = await activityToSign()
    const taken = await as(technician, async (tx, context) =>
      takeSignature(tx, context, {
        ...(await signatureFor(activity)),
        path: null,
        typedName: '  tom   technik ',
      }),
    )

    expect(taken.written[0]?.state.signatures).toEqual([
      {
        name: 'Tom Technik',
        role: 'signer',
        signedAt: '2026-10-01T09:30:00.000Z',
        path: null,
        way: 'name',
      },
    ])
    expect(await countOf('evidence', 'duty_id', duties[0] as string)).toBe(1)

    const { rows } = await admin.query<{ path: string | null; typed_name: string | null }>(
      'select path, typed_name from activity_signatures where activity_id = $1',
      [activity],
    )

    expect(rows).toEqual([{ path: null, typed_name: 'tom   technik' }])
  })

  it('is refused confirmed with a name other than the one of the account, or with a drawing and a name', async () => {
    const { activity } = await activityToSign()
    const typed = (typedName: string, path: string | null = null) =>
      refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, { ...(await signatureFor(activity)), path, typedName }),
        ),
      )

    expect(await typed('Sina Objekt')).toBe(
      'Bestätigt wird mit dem eigenen Namen, wie er im Konto steht: Tom Technik.',
    )
    expect(await typed('Tom Technik', drawing)).toBe(
      'Unterschrieben wird mit dem Schriftzug oder mit dem getippten Namen, nicht mit beidem.',
    )
    expect(await statusOf(activity)).not.toBe('done')
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

  it('freezes a round as a whole with the signature, also one that meets no duty (#111)', async () => {
    const { activity } = await activityToSign('round', { duties: 0 })
    const taken = await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    expect(taken.written).toEqual([])

    const { rows } = await admin.query<{ state: RoundRecordState; fingerprint: string }>(
      'select state, fingerprint from round_records where activity_id = $1',
      [activity],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.fingerprint).toBe(stateFingerprint(rows[0]?.state ?? {}))
    expect(rows[0]?.state).toMatchObject({
      version: 1,
      performedOn: '2026-10-01',
      evidence: [],
      signatures: [
        {
          name: 'Tom Technik',
          role: 'signer',
          signedAt: '2026-10-01T09:30:00.000Z',
          path: drawing,
          way: 'drawing',
        },
      ],
    })
  })

  it('freezes no other activity than a round as a whole', async () => {
    const { activity } = await activityToSign()

    await as(technician, async (tx, context) =>
      takeSignature(tx, context, await signatureFor(activity)),
    )

    expect(await countOf('round_records', 'activity_id', activity)).toBe(0)
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

    // A point not in order makes a defect, and an activity with one is not "ohne Mangel".
    if (given.some((answer) => answer.result === 'not_ok')) {
      await admin.query(
        `update activity_duties set result = 'with_defects' where activity_id = $1`,
        [activity],
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
    await admin.query(`update activity_duties set result = 'with_defects' where activity_id = $1`, [
      activity,
    ])

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
      {
        name: 'Tom Technik',
        role: 'signer',
        signedAt: '2026-10-01T09:30:00.000Z',
        path: drawing,
        way: 'drawing',
      },
      {
        name: 'Sina Objekt',
        role: 'countersigner',
        signedAt: '2026-10-02T07:00:00.000Z',
        path: drawing,
        way: 'drawing',
      },
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
  it('is signed by the person who leads it and by nobody else, nor by anybody while nobody leads it', async () => {
    const { activity } = await activityToSign('work_order')

    expect(
      await refusalOf(
        as(site, async (tx, context) => takeSignature(tx, context, await signatureFor(activity))),
      ),
    ).toBe('Abschließen kann einen Auftrag nur, wer ihn führt.')

    await admin.query('update activities set responsible_user_id = null where id = $1', [activity])
    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('Diesen Auftrag führt noch niemand. Abschließen kann ihn, wem das Büro ihn gibt.')
    expect(await statusOf(activity)).toBe('started')

    await admin.query('update activities set responsible_user_id = $2 where id = $1', [
      activity,
      technician,
    ])
    expect(
      await refusalOf(
        as(technician, async (tx, context) =>
          takeSignature(tx, context, await signatureFor(activity)),
        ),
      ),
    ).toBe('taken')
    expect(await statusOf(activity)).toBe('signed')
  })

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
      {
        name: 'Tom Technik',
        role: 'signer',
        signedAt: '2026-10-02T15:00:00.000Z',
        path: drawing,
        way: 'drawing',
      },
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

describe('a round of a template of the operator', () => {
  interface Round {
    readonly activity: ActivityId
    readonly duties: DutyId[]
    readonly asset: string
    readonly property: string
  }

  /**
   * A round at a new asset with its duties, on one version of a template.
   * Each version is a list of points in one chapter, written for the asset and
   * the duties of the round.
   */
  async function roundOn(
    versions: (asset: string, duties: readonly DutyId[]) => readonly object[][],
    on: number,
    duties = 1,
  ): Promise<Round> {
    const round = await activityToSign('round', { duties })
    const { rows } = await admin.query<{ asset_id: string; property_id: string }>(
      'select asset_id, property_id from activities where id = $1',
      [round.activity],
    )
    const asset = rows[0]?.asset_id ?? ''
    const property = rows[0]?.property_id ?? ''
    const { rows: made } = await admin.query<{ id: string }>(
      `insert into round_templates (tenant_id, title) values ($1, 'Technikzentrale') returning id`,
      [tenant],
    )
    const template = made[0]?.id ?? ''

    for (const [index, fields] of versions(asset, round.duties).entries()) {
      await admin.query(
        `insert into round_template_versions (tenant_id, template_id, form_version, definition,
                                              asks_countersignature)
         values ($1, $2, $3, $4, false)`,
        [
          tenant,
          template,
          index + 1,
          JSON.stringify({
            title: 'Technikzentrale',
            sections: [{ key: 'k1', title: 'Heizraum', fields }],
          }),
        ],
      )
    }

    await admin.query('update activities set form_key = $2, form_version = $3 where id = $1', [
      round.activity,
      `template-${template}`,
      on,
    ])

    return { ...round, asset, property }
  }

  async function answer(
    round: Round,
    field: string,
    given: { readonly result?: string; readonly value?: string; readonly remark?: string },
  ) {
    await admin.query(
      `insert into activity_answers (tenant_id, property_id, area_id, activity_id, field_key,
                                     result, value, remark)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenant,
        round.property,
        area,
        round.activity,
        field,
        given.result ?? null,
        given.value ?? null,
        given.remark ?? null,
      ],
    )
  }

  /** The evidence of a round by duty: result, reason, remark, version and the labels of the answers it holds. */
  async function evidenceOf(activity: ActivityId) {
    const { rows } = await admin.query<{
      duty_id: string
      state: {
        result: string
        resultReason: string | null
        remark: string | null
        form: { version: number } | null
        answers: { label: string }[]
      }
    }>('select duty_id, state from evidence where activity_id = $1', [activity])

    return new Map(
      rows.map(({ duty_id, state }) => [
        duty_id,
        {
          result: state.result,
          reason: state.resultReason,
          remark: state.remark,
          version: state.form?.version ?? null,
          answers: state.answers.map((each) => each.label),
        },
      ]),
    )
  }

  async function signed(activity: ActivityId) {
    const input = await signatureFor(activity)

    return refusalOf(as(technician, (tx, context) => takeSignature(tx, context, input)))
  }

  const door = (asset: string, fulfils?: DutyId) => ({
    kind: 'check_point',
    key: 'p1',
    label: 'Tür schließt selbsttätig',
    about: { kind: 'asset', id: asset },
    ...(fulfils === undefined ? {} : { fulfils }),
  })
  const said = { kind: 'text', key: 'p2', label: 'Sonst aufgefallen', multiline: true }

  // A point "Zählerstand" about the asset of the round, which is a measuring point (#120).
  const meterPoint = (asset: string) => ({
    kind: 'meter_reading',
    key: 'z1',
    label: 'Wasserzähler Schulhaus',
    unit: 'cubic_metres',
    decimals: 1,
    required: true,
    about: { kind: 'asset', id: asset },
  })

  /** The readings of a measuring point, as the database holds them. */
  async function readingsAt(asset: string) {
    return (
      await admin.query<{
        value_milli: string
        source: string
        activity_id: string
        recorded_by: string
        key_date: string
      }>(
        `select value_milli, source, activity_id, recorded_by,
                to_char(key_date, 'YYYY-MM-DD') as key_date
           from meter_readings where asset_id = $1`,
        [asset],
      )
    ).rows
  }

  it('writes the reading of a point about a measuring point with the signature, and not before', async () => {
    const round = await roundOn((asset) => [[meterPoint(asset)]], 1)

    await admin.query(
      `update assets set meter_number = '13-882914', meter_unit = 'cubic_metres' where id = $1`,
      [round.asset],
    )
    await answer(round, 'z1', { value: '4812000' })

    expect(await readingsAt(round.asset)).toEqual([])
    expect(await signed(round.activity)).toBe('taken')
    expect(await readingsAt(round.asset)).toEqual([
      {
        value_milli: '4812000',
        source: 'round',
        activity_id: round.activity,
        recorded_by: technician,
        key_date: '2026-10-01',
      },
    ])
  })

  it('leaves a measuring point whose key date has a reading as it is, and the answer on the page', async () => {
    const round = await roundOn((asset) => [[meterPoint(asset)]], 1)

    await admin.query(
      `update assets set meter_number = '13-882915', meter_unit = 'cubic_metres' where id = $1`,
      [round.asset],
    )
    await admin.query(
      `insert into meter_readings (tenant_id, property_id, area_id, asset_id, key_date, read_on,
                                   value_milli, source, recorded_by)
       values ($1, $2, $3, $4, '2026-10-01', '2026-10-01', 4800000, 'by_hand', 'u-lead')`,
      [tenant, round.property, area, round.asset],
    )
    await answer(round, 'z1', { value: '4812000' })

    expect(await signed(round.activity)).toBe('taken')
    expect((await readingsAt(round.asset)).map((reading) => reading.value_milli)).toEqual([
      '4800000',
    ])
  })

  it('stays on the version it began in, whatever was saved after it', async () => {
    const round = await roundOn(
      (asset) => [[door(asset)], [{ ...door(asset), key: 'p9', label: 'Neuer Punkt' }]],
      1,
    )

    await answer(round, 'p1', { result: 'ok' })

    expect(await signed(round.activity)).toBe('taken')
    expect([...(await evidenceOf(round.activity)).values()]).toEqual([
      expect.objectContaining({ version: 1, answers: ['Tür schließt selbsttätig'] }),
    ])
  })

  it('takes the result of a duty a point fulfils from its answer, and holds that answer alone', async () => {
    const round = await roundOn((asset, duties) => [[door(asset, duties[0]), said]], 1, 2)
    const [fulfilled, other] = round.duties

    // Nobody enters a result for the duty the door fulfils; the other one says what the round found.
    await admin.query(
      `update activity_duties
          set result = case when duty_id = $2 then null else 'with_defects'::evidence_result end
        where activity_id = $1`,
      [round.activity, fulfilled],
    )
    await answer(round, 'p1', { result: 'not_ok', remark: 'Tür klemmt.' })
    await answer(round, 'p2', { value: '"Sonst ruhig."' })

    expect(await signed(round.activity)).toBe('taken')

    const written = await evidenceOf(round.activity)

    expect(written.get(fulfilled as string)).toEqual({
      result: 'with_defects',
      reason: null,
      remark: 'Tür klemmt.',
      version: 1,
      answers: ['Tür schließt selbsttätig'],
    })
    expect(written.get(other as string)).toMatchObject({
      result: 'with_defects',
      answers: ['Tür schließt selbsttätig', 'Sonst aufgefallen'],
    })
  })

  it('writes a point that could not be checked as not performed, with its remark as the reason', async () => {
    const round = await roundOn((asset, duties) => [[door(asset, duties[0])]], 1)
    const [fulfilled] = round.duties

    await admin.query('update activity_duties set result = null where activity_id = $1', [
      round.activity,
    ])
    await answer(round, 'p1', { result: 'not_possible', remark: 'Raum verschlossen.' })

    expect(await signed(round.activity)).toBe('taken')
    expect((await evidenceOf(round.activity)).get(fulfilled as string)).toMatchObject({
      result: 'not_performed',
      reason: 'nicht möglich: Raum verschlossen.',
      remark: null,
    })
  })
})
