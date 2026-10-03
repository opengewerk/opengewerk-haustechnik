import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readConfiguration } from '@opengewerk/platform-server'
import type { Pool } from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { application } from './configuration.js'
import {
  allowApplicationLogin,
  applicationDatabaseUrl,
  applyMigrations,
  connect,
  resetSchema,
} from './database/test-database.js'
import { type OpenInstance, openInstance } from './instance.js'

// An instance of this application as a start puts it together (`main.ts`),
// asked what a browser asks: the two shells of the interface, the health of
// the instance, the first run of an empty one, and the paths of the API, which
// come back as JSON and never as a shell. What stands in front of the routes
// is the foundation's and tested there (ADR 0010 in the repository
// opengewerk); what is held here is what this application hands it.

let admin: Pool
let built = ''
let opened: OpenInstance | null = null

/** A build of the interface as small as it can be, with both shells. */
function interfaceBuild(): string {
  const folder = mkdtempSync(join(tmpdir(), 'haustechnik-interface-'))

  mkdirSync(join(folder, 'm'))
  writeFileSync(join(folder, 'index.html'), '<!doctype html><title>Büro</title>')
  writeFileSync(join(folder, 'm', 'index.html'), '<!doctype html><title>Vor Ort</title>')

  return folder
}

/** An instance with the configuration a start reads, from an environment of its own. */
async function open(closed = false): Promise<OpenInstance> {
  const configuration = readConfiguration(
    application,
    {
      DATABASE_URL: applicationDatabaseUrl(),
      STORAGE_PATH: built,
      SESSION_SECRET: 's'.repeat(64),
      TRUSTED_ORIGINS: 'https://haustechnik.example.de',
      HAUSTECHNIK_VERSION: '0.9.1',
      ...(closed ? { CLOSED: 'true' } : {}),
    },
    () => null,
  )

  opened = await openInstance(configuration, { interfaceDirectory: built })
  await opened.application.init()

  return opened
}

function http(instance: OpenInstance) {
  return request(instance.application.getHttpServer())
}

beforeAll(async () => {
  admin = await connect()
  await resetSchema(admin)
  await applyMigrations()
  await allowApplicationLogin(admin)
  built = interfaceBuild()
})

afterEach(async () => {
  if (opened) {
    opened.stopSettings()
    await opened.application.close()
    await opened.database.close()
    opened = null
  }
})

afterAll(async () => {
  await admin.end()
  rmSync(built, { recursive: true, force: true })
})

describe('an instance of this application', () => {
  it('hands the office its shell, and the entry on site its own, deep links included', async () => {
    const instance = await open()

    expect((await http(instance).get('/').expect(200)).text).toContain('<title>Büro</title>')
    expect((await http(instance).get('/einstellungen/zugaenge').expect(200)).text).toContain(
      '<title>Büro</title>',
    )
    expect((await http(instance).get('/m/konflikte').expect(200)).text).toContain(
      '<title>Vor Ort</title>',
    )
  })

  it('reports its health with the version it runs', async () => {
    const instance = await open()
    const answer = await http(instance).get('/health').expect(200)

    expect(answer.body).toMatchObject({ status: 'bereit', version: '0.9.1' })
  })

  it('answers a path of the API as the API, and never with a shell', async () => {
    const instance = await open()

    for (const path of ['/sync', '/sync/conflicts', '/staff', '/auth/tenants']) {
      const answer = await http(instance).get(path).expect(401)

      expect([path, answer.type]).toEqual([path, 'application/json'])
    }
  })

  it('offers the first run while it is empty', async () => {
    const instance = await open()
    const answer = await http(instance).get('/setup').expect(200)

    expect(answer.type).toBe('application/json')
    expect(answer.body).toEqual({ needed: true })
  })

  it('has no first run when it is closed, and still says that it runs', async () => {
    const instance = await open(true)

    await http(instance).get('/health').expect(200)
    // Not refused but absent: the route is not on the table, and the path is
    // one of the API, so no shell answers it either.
    const setup = await http(instance).get('/setup').expect(404)

    expect(setup.type).toBe('application/json')
  })
})
