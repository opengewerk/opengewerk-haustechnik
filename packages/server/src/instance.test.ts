import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FILE_STORE,
  type FileStorage,
  readConfiguration,
  RENDERER,
  type Renderer,
  RendererUnavailableError,
} from '@opengewerk/platform-server'
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
// opengewerk); what is held here is what this application hands it, the file
// store and the renderer included (opengewerk-haustechnik#96).

let admin: Pool
let built = ''
let storage = ''
let opened: OpenInstance | null = null

/** The two variables the renderer of an instance is read from. */
const rendererVariables = ['RENDERER_URL', 'RENDERER_TOKEN'] as const
const environmentBefore = rendererVariables.map((name) => process.env[name])

/** Names a renderer in the environment of this process, or takes it out with no arguments. */
function nameRenderer(url?: string, token?: string): void {
  for (const [name, value] of [
    ['RENDERER_URL', url],
    ['RENDERER_TOKEN', token],
  ] as const) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
}

/** A service that answers like the renderer and keeps what it was asked. */
async function rendererStandIn() {
  const asked: { readonly address: string; readonly body: string }[] = []
  const pdf = Buffer.from('%PDF-1.7 Probe', 'latin1')
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []

    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      asked.push({ address: incoming.url ?? '', body: Buffer.concat(chunks).toString('utf8') })
      outgoing.writeHead(200, { 'content-type': 'application/pdf' }).end(pdf)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    asked,
    pdf,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

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
      STORAGE_PATH: storage,
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
  storage = mkdtempSync(join(tmpdir(), 'haustechnik-storage-'))
})

afterEach(async () => {
  if (opened) {
    opened.stopSettings()
    await opened.application.close()
    await opened.database.close()
    opened = null
  }

  // What a test put into the environment of this process goes out again.
  for (const [position, name] of rendererVariables.entries()) {
    const before = environmentBefore[position]

    if (before === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = before
    }
  }
})

afterAll(async () => {
  await admin.end()
  rmSync(built, { recursive: true, force: true })
  rmSync(storage, { recursive: true, force: true })
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

describe('the file store of an instance', () => {
  /**
   * `STORAGE_PATH` is the volume the backup takes along. A store somewhere
   * else would take every file and lose all of them with the next restore.
   */
  it('is the folder its configuration names', async () => {
    const instance = await open()
    const store = instance.application.get<FileStorage>(FILE_STORE, { strict: false })
    const bytes = new TextEncoder().encode('Prüfbericht Aufzug Haus A')

    const { sha256 } = await store.put(bytes)

    expect(
      readFileSync(join(storage, sha256.slice(0, 2), sha256.slice(2, 4), sha256)).equals(bytes),
    ).toBe(true)
  })

  it('is there on a closed instance as well, where no route reaches it', async () => {
    const instance = await open(true)
    const store = instance.application.get<FileStorage>(FILE_STORE, { strict: false })
    const bytes = new TextEncoder().encode('Wartungsplan Lüftung')

    const { sha256 } = await store.put(bytes)

    expect(
      readFileSync(join(storage, sha256.slice(0, 2), sha256.slice(2, 4), sha256)).equals(bytes),
    ).toBe(true)
  })
})

describe('the renderer of an instance', () => {
  it('is the service its environment names, asked with the token from there', async () => {
    const service = await rendererStandIn()

    try {
      nameRenderer(service.url, 'token-dieses-tests')

      const instance = await open()
      const render = instance.application.get<Renderer>(RENDERER, { strict: false })
      const pdf = await render({ html: '<p>Prüfprotokoll</p>' })

      expect(Buffer.from(pdf).equals(service.pdf)).toBe(true)
      expect(service.asked.map((request) => request.address)).toEqual([
        '/pdf?token=token-dieses-tests',
      ])
      expect(JSON.parse(service.asked[0]?.body ?? '{}')).toMatchObject({
        html: '<p>Prüfprotokoll</p>',
      })
    } finally {
      await service.close()
    }
  })

  /**
   * A server started without Docker Compose has no renderer unless somebody
   * names one. Whoever asks for a PDF then gets the sentence that says which
   * two variables are missing, and the instance runs on.
   */
  it('says that none is set up where the environment names none', async () => {
    nameRenderer()

    const instance = await open()
    const render = instance.application.get<Renderer>(RENDERER, { strict: false })

    await expect(render({ html: '<p>Prüfprotokoll</p>' })).rejects.toThrow(RendererUnavailableError)
    await expect(render({ html: '<p>Prüfprotokoll</p>' })).rejects.toThrow(
      'Für diese Instanz ist kein Renderer eingerichtet',
    )
    await http(instance).get('/health').expect(200)
  })
})
