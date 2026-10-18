import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import { readTravel, type TenantId } from '@opengewerk/haustechnik-domain'
import { openVersion } from '@opengewerk/platform-web/attachments'
import { deleteLocalStore, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from './client.js'
import { keepForTheRoad, markForTheRoad, travelKeep } from './travel.js'

/**
 * Documents for the road (#348): the device keeps the files of the
 * documents at a marked asset or room, fetches a new version, and lets go of
 * what no marked place wants any more; signing out takes everything.
 */

let server: TestServer
let counter = 0
let tenant = ''
let served: Map<string, Uint8Array>

async function start(store = (tenant = `unterwegs${String((counter += 1))}`)): Promise<SyncClient> {
  return SyncClient.start({
    store: await openLocalStore(store as TenantId),
    transport: server,
    writer: server,
    deviceId: 'phone',
    entities: ['assets', 'rooms', 'attachments', 'attachment_versions'],
    onSignedOut: () => {},
  })
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const place = { propertyId: 'p-school', areaId: null }
const heater = {
  id: 'a-heater',
  ...place,
  buildingId: 'b-house',
  roomId: 'r-boiler',
  name: 'Trinkwassererwärmer',
}
const manualBytes = new TextEncoder().encode('%PDF-1.7 Betriebsanleitung SW 750')
const newerBytes = new TextEncoder().encode('%PDF-1.7 Betriebsanleitung SW 750, Ausgabe 2026')
const schemeBytes = new TextEncoder().encode('%PDF-1.7 Schema der Heizzentrale')

const document = (id: string, home: Readonly<Record<string, string | null>>) => ({
  id,
  ...place,
  buildingId: null,
  roomId: null,
  assetId: null,
  activityId: null,
  ...home,
  title: id,
  kind: 'operating_manual',
})

/** A version on the server, whose file the server hands out under its id. */
function version(order: number, attachmentId: string, bytes: Uint8Array) {
  const id = `00000000-0000-7000-8000-0000000000${String(order)}`

  served.set(`/attachments/versions/${id}/content`, bytes)

  return {
    id,
    attachmentId,
    sha256: hashOf(bytes),
    fileName: `${attachmentId}.pdf`,
    mediaType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    previewSha256: null,
    createdBy: 'u-kraemer',
    createdAt: '2026-10-18T09:00:00.000Z',
  }
}

beforeEach(() => {
  server = new TestServer()
  served = new Map()
  vi.stubGlobal('fetch', (path: string) => {
    const bytes = served.get(path)

    return Promise.resolve(
      bytes === undefined
        ? new Response('{}', { status: 404 })
        : new Response(bytes.buffer as ArrayBuffer, {
            headers: { 'content-type': 'application/pdf' },
          }),
    )
  })
  server.put('assets', heater)
  server.put('attachments', document('d-manual', { assetId: heater.id }))
  server.put('attachment_versions', version(11, 'd-manual', manualBytes))
  server.put('attachments', document('d-scheme', { roomId: 'r-boiler' }))
  server.put('attachment_versions', version(12, 'd-scheme', schemeBytes))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** An exchange with the server, and the round of the road after it, as the frame on site runs one. */
async function exchange(client: SyncClient): Promise<void> {
  await client.synchronise()
  await keepForTheRoad(client)
}

describe('the documents of a place kept for the road', () => {
  it('are on the device after the round, the newest version of each, and open without a network', async () => {
    const client = await start()

    await client.synchronise()
    expect(await client.readFile(hashOf(manualBytes))).toBeNull()

    await markForTheRoad(client, { kind: 'asset', id: heater.id }, true)
    await keepForTheRoad(client)

    expect(new Uint8Array((await client.readFile(hashOf(manualBytes)))?.bytes ?? [])).toEqual(
      manualBytes,
    )
    // The room is not marked: the scheme on its wall stays on the server.
    expect(await client.readFile(hashOf(schemeBytes))).toBeNull()
    expect(readTravel(client.kept(travelKeep)).files).toEqual([hashOf(manualBytes)])

    const opened = vi.fn()

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('open', opened)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:anleitung')
    await openVersion(
      client,
      client.get('attachment_versions', version(11, 'd-manual', manualBytes).id) ?? {},
    )

    expect(opened).toHaveBeenCalledWith('blob:anleitung', '_blank', 'noopener')
  })

  it('wait for a network, and come with the round after it', async () => {
    const client = await start()

    await client.synchronise()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await markForTheRoad(client, { kind: 'room', id: 'r-boiler' }, true)
    await keepForTheRoad(client)

    expect(await client.readFile(hashOf(schemeBytes))).toBeNull()
    expect(readTravel(client.kept(travelKeep)).files).toEqual([])

    vi.stubGlobal('fetch', (path: string) =>
      Promise.resolve(
        new Response((served.get(path)?.buffer as ArrayBuffer | undefined) ?? null, {
          status: served.has(path) ? 200 : 404,
        }),
      ),
    )
    await keepForTheRoad(client)

    expect(await client.readFile(hashOf(schemeBytes))).not.toBeNull()
  })

  it('take a new version with the next exchange, and let go of the one before', async () => {
    const client = await start()

    await client.synchronise()
    await markForTheRoad(client, { kind: 'asset', id: heater.id }, true)
    await keepForTheRoad(client)
    server.put('attachment_versions', version(19, 'd-manual', newerBytes))
    await exchange(client)

    expect(await client.readFile(hashOf(newerBytes))).not.toBeNull()
    expect(await client.readFile(hashOf(manualBytes))).toBeNull()
  })

  it('are gone from the device after the next exchange once their document is removed', async () => {
    const client = await start()

    await client.synchronise()
    await markForTheRoad(client, { kind: 'asset', id: heater.id }, true)
    await keepForTheRoad(client)
    expect(await client.readFile(hashOf(manualBytes))).not.toBeNull()

    server.put('attachments', {
      ...document('d-manual', { assetId: heater.id }),
      deletedAt: '2026-10-18T10:00:00.000Z',
    })
    await exchange(client)

    expect(await client.readFile(hashOf(manualBytes))).toBeNull()
    expect(readTravel(client.kept(travelKeep)).files).toEqual([])
  })

  it('are gone from the device after the next exchange once the place is out of the areas of the person', async () => {
    const client = await start()

    await client.synchronise()
    await markForTheRoad(client, { kind: 'room', id: 'r-boiler' }, true)
    await keepForTheRoad(client)
    expect(await client.readFile(hashOf(schemeBytes))).not.toBeNull()

    // What leaves the areas of a person leaves the device with the exchange,
    // the documents with it.
    server.put('attachments', {
      ...document('d-scheme', { roomId: 'r-boiler' }),
      deletedAt: '2026-10-18T10:00:00.000Z',
    })
    await exchange(client)

    expect(await client.readFile(hashOf(schemeBytes))).toBeNull()
  })

  it('are let go of when the place is forgotten, and a file made on the device only once it is up', async () => {
    const client = await start()

    await client.synchronise()

    // A new version filed here, its file not up yet.
    const made = await client.keepFile(newerBytes.buffer as ArrayBuffer, 'application/pdf')

    await client.create('attachment_versions', {
      attachmentId: 'd-manual',
      sha256: made.sha256,
      fileName: 'neu.pdf',
      mediaType: 'application/pdf',
      sizeBytes: made.sizeBytes,
      previewSha256: null,
    })
    server.offline = true
    await markForTheRoad(client, { kind: 'asset', id: heater.id }, true)
    await keepForTheRoad(client)
    expect(readTravel(client.kept(travelKeep)).files).toEqual([made.sha256])

    await markForTheRoad(client, { kind: 'asset', id: heater.id }, false)
    await keepForTheRoad(client)

    // Still waiting for its upload: it stays, and stays on the list.
    expect(await client.readFile(made.sha256)).not.toBeNull()
    expect(readTravel(client.kept(travelKeep))).toEqual({ places: [], files: [made.sha256] })

    server.offline = false
    await exchange(client)

    expect(server.uploaded.has(made.sha256)).toBe(true)
    expect(await client.readFile(made.sha256)).toBeNull()
    expect(readTravel(client.kept(travelKeep)).files).toEqual([])
  })

  it('are nothing on the device once somebody signs out', async () => {
    const client = await start()

    await client.synchronise()
    await markForTheRoad(client, { kind: 'asset', id: heater.id }, true)
    await keepForTheRoad(client)
    expect(await client.readFile(hashOf(manualBytes))).not.toBeNull()

    // What signing out does with the store of the tenant (`SignOut` of the foundation).
    client.stop()
    await deleteLocalStore(tenant)

    const after = await start(tenant)

    expect(after.kept(travelKeep)).toBeNull()
    expect(await after.readFile(hashOf(manualBytes))).toBeNull()
  })
})
