import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  type Right,
  rights,
  rightsOfRoles,
  roleKeys,
  syncEntities,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { Database } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  applicationDatabaseUrl,
  connect,
  resetToMigrated,
  testIdentityHeader,
} from '../database/test-database.js'
import { previewPeople } from '../preview/preview-database.js'
import { openSamplePreview, previewCatalogue } from '../preview/preview-server.js'
import { ApiModule } from './api.module.js'
import { as, testIdentities } from './test-identity.js'

/**
 * What a device holds of each kind of record follows the right to read it
 * (#360): the right the route that shows the record in the office asks for,
 * any one of them where several routes show it. A role of the operator's own
 * gets through the sync no more than through those routes, and the shipped
 * roles get what they got before. Over the sample operator of the preview,
 * which has rows of every kind, as the Leitung, who sees every area, and as
 * the technician of the north, who sees one.
 */

/**
 * By kind of record, the rights of the routes that show it, as their guards
 * name them; any one of them will do. Written down here from the routes and
 * not read from the code that narrows the pull, so that each is held against
 * the other.
 */
const readBy: Readonly<Record<string, readonly Right[]>> = {
  // GET /properties, /buildings/:id, /floors/:id, /rooms/:id, the contacts and
  // GET /buildings/:id/closures.
  properties: ['location.read'],
  buildings: ['location.read'],
  floors: ['location.read'],
  contacts: ['location.read'],
  building_closures: ['location.read'],
  rooms: ['location.read'],
  // GET /round-templates/rounds and /round-plans/table.
  round_templates: ['activity.read'],
  round_template_versions: ['activity.read'],
  round_plans: ['activity.read'],
  // GET /assets, /assets/:id with its structure, /assets/:id/circuit-chart, /meters.
  assets: ['asset.read'],
  asset_lifecycle: ['asset.read'],
  asset_supplies: ['asset.read'],
  distribution_boards: ['asset.read'],
  board_sections: ['asset.read'],
  circuits: ['asset.read'],
  equipment: ['asset.read'],
  inverters: ['asset.read'],
  pv_strings: ['asset.read'],
  pv_modules: ['asset.read'],
  meter_points: ['asset.read'],
  meter_exchanges: ['asset.read'],
  meter_pauses: ['asset.read'],
  meter_readings: ['asset.read'],
  // GET /meters reads by the key day, GET /settings/meters shows it.
  meter_settings: ['asset.read', 'settings.read'],
  // GET /duties and /duty-dismissals.
  duties: ['duty.read'],
  duty_dismissals: ['duty.read'],
  // GET /activities/:id, /rounds/:id and /work-orders/:id.
  activities: ['activity.read'],
  activity_duties: ['activity.read'],
  activity_answers: ['activity.read'],
  work_orders: ['activity.read'],
  work_order_participants: ['activity.read'],
  work_order_notes: ['activity.read'],
  activity_signatures: ['activity.read'],
  work_order_decisions: ['activity.read'],
  service_reports: ['activity.read'],
  briefings: ['activity.read'],
  work_permits: ['activity.read'],
  work_order_materials: ['activity.read'],
  // GET /service-reports/:id/pdf follows it, GET /settings/work-orders shows it.
  work_order_settings: ['activity.read', 'settings.read'],
  // GET /defects, /tasks/table, /attachments/table.
  defects: ['defect.read'],
  tasks: ['task.read'],
  attachments: ['document.read'],
  attachment_versions: ['document.read'],
  // GET /labels/:code and the free labels of a property; a label of a room
  // also for whoever sees the room (`expectedOf`).
  labels: ['asset.read'],
  // GET /articles, /suppliers, /stores and the stock of a store.
  articles: ['store.read'],
  suppliers: ['store.read'],
  stores: ['store.read'],
  store_articles: ['store.read'],
  stock_movements: ['store.read'],
  store_labels: ['store.read'],
  // GET /contractors; the name at every duty, activity and contract (#377).
  contractors: ['contractor.read', 'duty.read', 'activity.read', 'contract.read'],
  // GET /contracts.
  contracts: ['contract.read'],
  // GET /qualifications/mine with the kinds it names, GET /qualifications and /qualifications/kinds.
  qualifications: ['activity.read', 'qualification.read'],
  qualification_kinds: ['activity.read', 'qualification.read'],
}

/** Kinds whose rows hang on more than their own right: a firm's, a contract's. */
const hangOnMore: readonly string[] = [
  'contacts',
  'attachments',
  'attachment_versions',
  'contractors',
]

type Row = Readonly<Record<string, unknown>>

/** A pull from the start: the rows of each kind, and what the answer names. */
interface Pulled {
  readonly rows: Readonly<Record<string, readonly Row[]>>
  readonly narrowed: Readonly<Record<string, string>>
}

let admin: Pool
let database: Database
let preview: INestApplication
let app: INestApplication
let tenantId: TenantId

const planter = previewPeople.planter.id
const viewer = previewPeople.viewer.id

beforeAll(async () => {
  admin = await connect()
  database = Database.connect(applicationDatabaseUrl())
  await resetToMigrated()

  const opened = await openSamplePreview(
    admin,
    database,
    { role: 'technician', area: 'Nord' },
    { interfaceDirectory: null },
  )

  preview = opened.application
  tenantId = opened.tenant.id

  const built = await Test.createTestingModule({
    imports: [ApiModule.create(database, testIdentities, { catalogue: previewCatalogue })],
  }).compile()

  app = built.createNestApplication()
  await app.init()

  // What the sample leaves out: the two settings of the operator, and a
  // qualification of the Leitung's own.
  const lead = as(tenantId, planter, 'management')

  await request(app.getHttpServer())
    .put('/settings/meters')
    .set(testIdentityHeader, lead)
    .send({ keyDay: 15 })
    .expect(200)
  await request(app.getHttpServer())
    .put('/settings/work-orders')
    .set(testIdentityHeader, lead)
    .send({ namesAndTimes: true })
    .expect(200)
  await request(app.getHttpServer())
    .post('/qualifications')
    .set(testIdentityHeader, lead)
    .send({ userId: planter, kind: 'elektro.electrically_skilled_person', validUntil: null })
    .expect(201)
}, 60_000)

afterAll(async () => {
  await app.close()
  await preview.close()
  await database.close()
  await admin.end()
})

/** Everything a person with these rights takes onto a device, page by page. */
async function pulled(
  userId: string,
  held: readonly string[],
  roles: readonly string[] = ['own-reader'],
): Promise<Pulled> {
  const rows: Record<string, Row[]> = {}
  let since = 0

  for (;;) {
    const answer = await request(app.getHttpServer())
      .get(`/sync?since=${String(since)}`)
      .set(testIdentityHeader, JSON.stringify({ userId, tenantId, roles, rights: held }))
      .expect(200)
    const body = answer.body as {
      readonly changes: readonly { readonly entity: string; readonly rows: readonly Row[] }[]
      readonly cursor: number
      readonly hasMore: boolean
      readonly narrowed: Readonly<Record<string, string>>
    }

    for (const change of body.changes) {
      rows[change.entity] = [...(rows[change.entity] ?? []), ...change.rows]
    }

    if (!body.hasMore) {
      return { rows, narrowed: body.narrowed }
    }

    since = body.cursor
  }
}

/** The rows of every kind by their ids, for a comparison that names the kind. */
function idsOf(rows: Readonly<Record<string, readonly Row[]>>): Record<string, string[]> {
  return Object.fromEntries(
    syncEntities.map((entity) => [
      entity,
      (rows[entity] ?? []).map((row) => String(row['id'])).sort(),
    ]),
  )
}

/**
 * What a device whose person holds these rights holds of a kind, out of what
 * it holds with every right: nothing without the places (#331), a label of a
 * room without the assets, the people and documents of a firm only with the
 * firms (#328), the documents of a contract only with the contracts (#329),
 * and otherwise all of it with one of the rights the kind is read by, and
 * nothing without.
 */
function expectedOf(entity: string, held: ReadonlySet<string>, full: Pulled): readonly Row[] {
  const reads = (right: Right) => held.has(right)
  const all = full.rows[entity] ?? []

  if (!reads('location.read')) {
    return []
  }

  if (entity === 'labels' && !reads('asset.read')) {
    return all.filter((row) => row['roomId'] !== null)
  }

  // Out of service without the defects (#520): whoever sees the assets and
  // not the defects holds those that put an asset out of service, by the
  // state alone, and no other.
  if (entity === 'defects' && !reads('defect.read') && reads('asset.read')) {
    return all.filter(
      (row) =>
        row['assetId'] !== null &&
        (row['status'] === 'found' || row['status'] === 'ordered') &&
        typeof row['defectClass'] === 'string' &&
        previewCatalogue.defectClass(row['defectClass'])?.defectClass.unsafe === true,
    )
  }

  if (!(readBy[entity] ?? []).some(reads)) {
    return []
  }

  if (entity === 'contacts') {
    return all.filter((row) => row['contractorId'] === null || reads('contractor.read'))
  }

  if (entity === 'attachments') {
    return all.filter(
      (row) =>
        (row['contractorId'] === null || reads('contractor.read')) &&
        (row['contractId'] === null || reads('contract.read')),
    )
  }

  if (entity === 'attachment_versions') {
    const documents = new Set(expectedOf('attachments', held, full).map((row) => row['id']))

    return all.filter((row) => documents.has(row['attachmentId']))
  }

  return all
}

/**
 * Holds a pull against what these rights should give: the rows of each kind,
 * and the value of each kind, which is another one wherever a right is
 * missing that the kind is read by, so that a device lets go of what it
 * holds, and the same one as with every right where nothing else decides.
 */
function holdAgainst(pull: Pulled, held: ReadonlySet<string>, full: Pulled): void {
  expect(idsOf(pull.rows)).toEqual(
    idsOf(
      Object.fromEntries(syncEntities.map((entity) => [entity, expectedOf(entity, held, full)])),
    ),
  )

  if (!held.has('location.read')) {
    return
  }

  for (const entity of syncEntities) {
    const readable = (readBy[entity] ?? []).some((right) => held.has(right))

    if (!readable) {
      expect(pull.narrowed[entity], entity).not.toBe(full.narrowed[entity])
    } else if (!hangOnMore.includes(entity)) {
      expect(pull.narrowed[entity], entity).toBe(full.narrowed[entity])
    }
  }
}

it('names the rights for every kind of record a device holds', () => {
  expect(Object.keys(readBy).sort()).toEqual([...syncEntities].sort())
})

it('hands whoever holds every right and sees every area rows of every kind, so that the rest proves something', async () => {
  const full = await pulled(planter, rights)

  expect(
    syncEntities.filter((entity) => (full.rows[entity] ?? []).length === 0),
    'kinds the sample has no row of',
  ).toEqual([])
  // A label of a room and one of an asset, a document of a firm and of a contract.
  expect(full.rows['labels']?.some((row) => row['roomId'] !== null)).toBe(true)
  expect(full.rows['labels']?.some((row) => row['roomId'] === null)).toBe(true)
  expect(full.rows['attachments']?.some((row) => row['contractorId'] !== null)).toBe(true)
  expect(full.rows['attachments']?.some((row) => row['contractId'] !== null)).toBe(true)
})

/** Every set of rights a kind is read by, once. */
const readSets: readonly (readonly Right[])[] = [
  ...new Map(
    Object.values(readBy).map((set) => [[...set].sort().join(' '), [...set].sort()]),
  ).values(),
]
/** Every right a kind is read by, but the places, which a device needs for anything. */
const readRights: readonly Right[] = [
  ...new Set(
    Object.values(readBy)
      .flat()
      .filter((right) => right !== 'location.read'),
  ),
]
/** A role of the operator's own that sees the places and takes them onto a device. */
const seesThePlaces: readonly Right[] = ['location.read', 'sync.read']

describe.each([
  ['whoever sees every area', planter],
  ['whoever sees the north', viewer],
])('a role of its own, for %s', (_, userId) => {
  let full: Pulled

  beforeAll(async () => {
    full = await pulled(userId, rights)
  })

  it.each(readSets.map((set) => [set.join(', '), set] as const))(
    'without %s, holds nothing of what only those read, and all the rest',
    async (_names, set) => {
      const held = new Set(rights.filter((right) => !set.includes(right)))

      holdAgainst(await pulled(userId, [...held]), held, full)
    },
  )

  it('with the places and nothing else, holds the places and nothing else', async () => {
    const held = new Set<string>(seesThePlaces)
    const pull = await pulled(userId, [...held])

    holdAgainst(pull, held, full)
    expect(pull.rows['assets'] ?? []).toEqual([])
    expect(pull.rows['duties'] ?? []).toEqual([])
  })

  it.each(readRights.map((right) => [right] as const))(
    'with the places and %s, holds what that reads again',
    async (right) => {
      const held = new Set<string>([...seesThePlaces, right])

      holdAgainst(await pulled(userId, [...held]), held, full)
    },
  )
})

/**
 * Before #360 a pull asked of the rights of a person only whether they see
 * the places, the contractors and the contracts, and of the roles whether one
 * is limited. A person with the roles of a shipped role, every other right
 * and those three as the role holds them got then what the role got, and gets
 * it now: what follows from a right they hold takes nothing away. So a
 * shipped role gets what it got if it gets what such a person gets, row for
 * row and value for value.
 */
describe.each([
  ['whoever sees every area', planter],
  ['whoever sees the north', viewer],
])('a shipped role, for %s', (_, userId) => {
  it.each(roleKeys.map((key) => [key] as const))('%s holds what it held before', async (key) => {
    const own = rightsOfRoles([key])
    const asBefore = rights.filter(
      (right) =>
        !['location.read', 'contractor.read', 'contract.read'].includes(right) || own.has(right),
    )
    const now = await pulled(userId, [...own], [key])

    expect(now).toEqual(await pulled(userId, asBefore, [key]))
  })
})
