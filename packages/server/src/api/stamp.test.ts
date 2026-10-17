import type { INestApplication } from '@nestjs/common'
import { syncEntities } from '@opengewerk/haustechnik-domain'
import { Database } from '@opengewerk/platform-server'
import { routesOf } from '@opengewerk/platform-server/testing'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applicationDatabaseUrl, connect, resetToMigrated } from '../database/test-database.js'
import { openSamplePreview } from '../preview/preview-server.js'
import { ApiModule } from './api.module.js'
import { noIdentities } from './test-identity.js'

/**
 * When a record last changed, who changed it and from which device stay on
 * the server (opengewerk-haustechnik#157, section 9 of the concept). The
 * trigger writes them on every row that travels, and the change log keeps
 * them for the Leitung; no device holds them and no answer hands them out.
 *
 * Asked of the preview as the Leitung, which sees every area: the sample
 * operator has a record of every kind that travels, planted through the real
 * routes, and every route that reads has something to answer.
 */

/**
 * The stamp of the last change: when, who and from which device, as the
 * routes and the pull name the fields and as a row of the database does.
 */
const stamp = ['updatedAt', 'updatedBy', 'deviceId', 'updated_at', 'updated_by', 'device_id']

/**
 * The routes that name who changed what, when and from which device on
 * purpose: the change log of a tenant, which only the Leitung reads, and the
 * one of the instance, for whoever runs it.
 */
const changeLogs = ['GET /audit/changes', 'GET /instance/log']

/** What marks a record of a table that travels in an answer. */
const recordMarker = 'changeSequence'

/** Where a field of the stamp stands in an answer, as the path to it. */
function stampsIn(answer: unknown, at = ''): string[] {
  if (Array.isArray(answer)) {
    return answer.flatMap((item: unknown, index) => stampsIn(item, `${at}[${String(index)}]`))
  }

  if (answer === null || typeof answer !== 'object') {
    return []
  }

  return Object.entries(answer).flatMap(([field, inner]) => [
    ...(stamp.includes(field) ? [`${at}.${field}`] : []),
    ...stampsIn(inner, `${at}.${field}`),
  ])
}

/** How many records an answer holds, however deep. */
function recordsIn(answer: unknown): number {
  if (Array.isArray(answer)) {
    return answer.reduce((sum: number, item: unknown) => sum + recordsIn(item), 0)
  }

  if (answer === null || typeof answer !== 'object') {
    return 0
  }

  return (
    (Object.hasOwn(answer, recordMarker) ? 1 : 0) +
    Object.values(answer).reduce((sum: number, inner: unknown) => sum + recordsIn(inner), 0)
  )
}

/** The ids an answer names, however deep, those nearer the top first. */
function idsIn(answer: unknown): string[] {
  const found: string[] = []
  let level: unknown[] = [answer]

  while (level.length > 0) {
    const next: unknown[] = []

    for (const value of level) {
      if (Array.isArray(value)) {
        next.push(...(value as unknown[]))
      } else if (value !== null && typeof value === 'object') {
        const id = (value as { id?: unknown }).id

        if (typeof id === 'string') {
          found.push(id)
        }

        next.push(...Object.values(value))
      }
    }

    level = next
  }

  return found
}

/**
 * The routes that hand out bytes and not JSON: a PDF, the file of a document
 * or of an evidence, a list as a table, the photo of a fault report (#331),
 * the certificate of a qualification (#337). Nothing in them is a field;
 * that a table holds no part of the stamp either, `office-tables.test.ts`
 * reads in the file itself (#138).
 */
const bytes = /\/(pdf|content|preview|table|photo|certificate)$|\/files\/:position$/

/** Where the ids for a path come from when the segment before it is no kind of record. */
const kindOf: Readonly<Record<string, string>> = {
  // What a label stands for to whoever reports (#331), asked with what the device holds.
  label: 'labels',
  rounds: 'activities',
  'work-orders': 'activities',
  meters: 'assets',
  // The contracts that cover an asset (#329).
  'at-asset': 'assets',
}

/**
 * What a route that reads is asked with, where it answers nothing without a
 * question: the search, with words the places of the preview hold (#125).
 */
const askedWith: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'GET /search': { q: 'Haus' },
}

/**
 * The routes that read and are not asked here: the devices of a person, named
 * by an account and not by a record, and answered by the foundation without a
 * record in it.
 */
const notAsked = ['GET /staff/:userId/devices']

let admin: Pool
let database: Database
let application: INestApplication

function http() {
  return request(application.getHttpServer())
}

/** Every row a device of the Leitung gets, by kind, from the start. */
async function pulledRows(): Promise<Map<string, Record<string, unknown>[]>> {
  const rows = new Map<string, Record<string, unknown>[]>()
  let since = 0

  for (;;) {
    const body = (
      await http()
        .get(`/sync?since=${String(since)}`)
        .expect(200)
    ).body as {
      readonly changes: readonly {
        readonly entity: string
        readonly rows: readonly Record<string, unknown>[]
      }[]
      readonly cursor: number
      readonly hasMore: boolean
    }

    for (const change of body.changes) {
      rows.set(change.entity, [...(rows.get(change.entity) ?? []), ...change.rows])
    }

    if (!body.hasMore) {
      return rows
    }

    since = body.cursor
  }
}

beforeAll(async () => {
  admin = await connect()
  database = Database.connect(applicationDatabaseUrl())
  await resetToMigrated()
  ;({ application } = await openSamplePreview(
    admin,
    database,
    { role: 'management', area: null },
    { interfaceDirectory: null },
  ))
  await application.init()
  // The kinds that travel and that the preview plants nothing of: the key
  // day of the meters, which an operator sets once, and whether the service
  // report names the people who did the work (#324).
  await http().put('/settings/meters').send({ keyDay: 15 }).expect(200)
  await http().put('/settings/work-orders').send({ namesAndTimes: false }).expect(200)
}, 120_000)

afterAll(async () => {
  await application.close()
  await database.close()
  await admin.end()
})

describe('the stamp of the last change', () => {
  it('stays on the row, for the change log', async () => {
    const { rows } = await admin.query<{ stamped: number }>(
      `select count(*)::int as stamped from properties
        where updated_by is not null and updated_at is not null`,
    )

    expect(rows[0]?.stamped).toBeGreaterThan(0)
  })

  it('reaches no device, for any kind of record that travels', async () => {
    const pulled = await pulledRows()

    // Every kind that travels is asked, or the check below proves nothing
    // about the one that is missing.
    expect(syncEntities.filter((entity) => (pulled.get(entity) ?? []).length === 0)).toEqual([])

    for (const entity of syncEntities) {
      for (const row of pulled.get(entity) ?? []) {
        expect(
          Object.keys(row).filter((field) => stamp.includes(field)),
          entity,
        ).toEqual([])
        // What a device sends a change against and asks for more by.
        expect(row['version'], entity).toEqual(expect.any(Number))
        expect(row[recordMarker], entity).toEqual(expect.any(Number))
      }
    }
  })

  it('is handed out on no route that reads', async () => {
    const pulled = await pulledRows()
    const pool = new Map<string, string[]>()

    for (const [entity, rows] of pulled) {
      pool.set(
        entity,
        rows.map((row) => String(row['id'])),
      )
    }

    const routes = routesOf(ApiModule.create(database, noIdentities).controllers ?? [])
      .filter((route) => !route.writes)
      .map((route) => route.name)
      .filter((name) => !bytes.test(name))
    const leaks: string[] = []
    const withRecords: string[] = []
    let waiting = routes

    // Over and over, until no route can be asked any more: the evidence of a
    // duty names the evidence, and only then is there one to ask for.
    for (;;) {
      const left: string[] = []

      for (const name of waiting) {
        const path = name.slice('GET '.length)
        const segments = path.split('/')
        const params = segments.flatMap((segment, index) =>
          segment.startsWith(':') ? [{ index, before: segments[index - 1] ?? '' }] : [],
        )
        const candidates = params.map(({ before }) => [
          ...(pool.get(before) ?? []),
          ...(pool.get(kindOf[before] ?? before.replace(/-/g, '_')) ?? []),
        ])

        if (candidates.some((ids) => ids.length === 0)) {
          left.push(name)
          continue
        }

        let answered: unknown
        let found = params.length === 0
        const attempts = Math.max(1, ...candidates.map((ids) => ids.length))

        // One id after the other, until one answers: the id of a building
        // asked for its floors, of a round among all the activities.
        for (let attempt = 0; attempt < attempts && (params.length === 0 || !found); attempt++) {
          const filled = [...segments]

          for (const [position, { index }] of params.entries()) {
            const ids = candidates[position] ?? []
            filled[index] = ids[attempt % ids.length] ?? ''
          }

          const answer = await http()
            .get(filled.join('/'))
            .query(askedWith[name] ?? {})

          answered = answer.body
          found ||= answer.status === 200

          if (params.length === 0) {
            break
          }
        }

        if (!found) {
          left.push(name)
          continue
        }

        if (!changeLogs.includes(name)) {
          leaks.push(...stampsIn(answered).map((where) => `${name} ${where}`))
        }

        if (recordsIn(answered) > 0) {
          withRecords.push(name)
        }

        const last = segments.filter((segment) => !segment.startsWith(':')).at(-1) ?? ''

        pool.set(last, [...new Set([...idsIn(answered), ...(pool.get(last) ?? [])])])
      }

      if (left.length === waiting.length) {
        break
      }

      waiting = left
    }

    expect(leaks).toEqual([])
    expect(waiting.sort()).toEqual([...notAsked].sort())
    // Records came back, on the lists and on the pages of a record, or the
    // check above proves nothing.
    expect(withRecords).toEqual(
      expect.arrayContaining([
        'GET /sync',
        'GET /contacts',
        'GET /properties',
        'GET /properties/:id',
        'GET /buildings/:id',
        'GET /rooms/:id',
        'GET /assets/:id',
        'GET /duties/:id',
      ]),
    )
  })
})
