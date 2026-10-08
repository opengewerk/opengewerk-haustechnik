import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import type { RecordState, TenantId } from '@opengewerk/haustechnik-domain'
import type { ShrinkPicture } from '@opengewerk/platform-web/attachments'
import { openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../sync/client.js'
import {
  type DocumentSurroundings,
  fileDocument,
  fileVersion,
  filedOn,
  hangsOn,
  kindWordsOf,
  newestFirst,
  versionWords,
} from './documents.js'

/**
 * The documents of an operator on a device (#97, section 4.10 of the
 * concept), with the rules of this application: what a chosen file becomes
 * before anything is queued, what the two records say, that the bytes wait on
 * the device and go up ahead of them, and the words a list has for a
 * document.
 *
 * The third point of the acceptance of #97, on the device: a photo taken
 * without a network hangs at its asset once the device has exchanged. What
 * the server makes of the same transmission is held in
 * `packages/server/src/api/documents.test.ts`.
 *
 * A browser in a test has no canvas that draws, so making a picture smaller
 * is handed in: a photo becomes a thousand bytes, a preview a hundred.
 */

let server: TestServer
let counter = 0
let asked: number[]

const shrink: ShrinkPicture = (_file, longEdge) => {
  asked.push(longEdge)

  return Promise.resolve(new Uint8Array(longEdge > 1000 ? 1000 : 100).fill(7).buffer)
}

async function start(): Promise<SyncClient> {
  return SyncClient.start({
    store: await openLocalStore(`dokumente${String((counter += 1))}` as TenantId),
    transport: server,
    writer: server,
    deviceId: 'phone',
    entities: ['properties', 'assets', 'attachments', 'attachment_versions'],
    onSignedOut: () => {},
  })
}

function hashOf(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
}

/** What the server was sent for a kind of record, as the fields of each new one. */
function created(entity: string) {
  return server
    .operations()
    .filter((operation) => operation.kind === 'create' && operation.entity === entity)
    .map((operation) => ({
      id: operation.recordId,
      ...Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    }))
}

const photo = new File([new Uint8Array(5000).fill(1)], 'Typenschild Aufzug.jpg', {
  type: 'image/jpeg',
})
const manual = new File(['%PDF-1.7 Betriebsanleitung'], 'Betriebsanleitung BA 630.pdf', {
  type: 'application/pdf',
})

const atTheLift = { propertyId: 'p-school', assetId: 's-lift' }

beforeEach(() => {
  server = new TestServer()
  asked = []
})

describe('a photo taken on site without a network', () => {
  it('waits on the device with its bytes, and hangs at its asset once the device has exchanged, the bytes ahead of the records', async () => {
    const client = await start()

    server.offline = true

    expect(await fileDocument(client, atTheLift, photo, { shrink })).toBeNull()

    // On the device at once: the document at its asset, and its version,
    // neither sent, with the photo made smaller and a preview beside it.
    const [document] = client.list('attachments')
    const [version] = client.list('attachment_versions')

    expect(document).toMatchObject({
      title: 'Typenschild Aufzug',
      propertyId: 'p-school',
      assetId: 's-lift',
    })
    expect(version).toMatchObject({
      attachmentId: document?.['id'],
      fileName: 'Typenschild Aufzug.jpg',
      mediaType: 'image/jpeg',
      sizeBytes: 1000,
    })
    expect(asked).toEqual([2048, 320])
    expect(client.isPending('attachments', String(document?.['id']))).toBe(true)
    expect(client.isPending('attachment_versions', String(version?.['id']))).toBe(true)
    expect(await client.readFile(String(version?.['sha256']))).not.toBeNull()
    expect(server.operations()).toEqual([])
    expect(server.uploaded.size).toBe(0)

    // Upstairs, with a network again.
    server.offline = false
    await client.synchronise()

    expect(server.log).toEqual([
      expect.stringMatching(/^upload /),
      expect.stringMatching(/^upload /),
      'push attachments,attachment_versions',
    ])
    expect(server.row('attachments', String(document?.['id']))).toMatchObject({
      title: 'Typenschild Aufzug',
      propertyId: 'p-school',
      assetId: 's-lift',
    })

    const sent = server.row('attachment_versions', String(version?.['id']))
    const bytes = server.uploaded.get(String(sent?.['sha256']))

    expect(sent).toMatchObject({ attachmentId: document?.['id'], sizeBytes: 1000 })
    expect(bytes?.mediaType).toBe('image/jpeg')
    expect(hashOf(bytes?.bytes ?? new ArrayBuffer(0))).toBe(sent?.['sha256'])
    expect(server.uploaded.has(String(sent?.['previewSha256']))).toBe(true)
    expect(client.isPending('attachment_versions', String(version?.['id']))).toBe(false)
  })

  it('names only the place it is told and leaves the area to the server', async () => {
    const client = await start()

    await fileDocument(client, atTheLift, photo, { shrink })
    await client.synchronise()

    expect(created('attachments')).toEqual([
      {
        id: expect.any(String) as string,
        title: 'Typenschild Aufzug',
        propertyId: 'p-school',
        assetId: 's-lift',
      },
    ])
    expect(Object.keys(created('attachment_versions')[0] ?? {}).sort()).toEqual([
      'attachmentId',
      'fileName',
      'id',
      'mediaType',
      'previewSha256',
      'sha256',
      'sizeBytes',
    ])
  })
})

describe('filing a document', () => {
  it('takes the name somebody says and the kind they choose, and keeps a file that is no photo as it is', async () => {
    const client = await start()

    expect(
      await fileDocument(client, { propertyId: 'p-school', buildingId: 'b-house' }, manual, {
        title: '  Betriebsanleitung Aufzug  ',
        kind: 'operating_manual',
        shrink,
      }),
    ).toBeNull()
    await client.synchronise()

    expect(created('attachments')).toEqual([
      {
        id: expect.any(String) as string,
        title: 'Betriebsanleitung Aufzug',
        kind: 'operating_manual',
        propertyId: 'p-school',
        buildingId: 'b-house',
      },
    ])
    expect(created('attachment_versions')).toMatchObject([
      {
        fileName: 'Betriebsanleitung BA 630.pdf',
        mediaType: 'application/pdf',
        sizeBytes: manual.size,
      },
    ])
    // A file that is no picture has no preview, and so names none.
    expect(Object.keys(created('attachment_versions')[0] ?? {})).not.toContain('previewSha256')
    // Nothing asked the canvas: a PDF is neither made smaller nor previewed.
    expect(asked).toEqual([])
  })

  it('keeps a photo at its full size where somebody says so', async () => {
    const client = await start()

    await fileDocument(client, atTheLift, photo, { keepOriginal: true, shrink })

    expect(client.list('attachment_versions')[0]).toMatchObject({ sizeBytes: photo.size })
    // The preview is still made: a list shows it without the large file.
    expect(asked).toEqual([320])
  })

  it('asks what the server will ask before anything is kept, and says it in the same sentence', async () => {
    const client = await start()

    expect(
      await fileDocument(
        client,
        { propertyId: 'p-school', assetId: 's-lift', roomId: 'r-boiler' },
        photo,
        { shrink },
      ),
    ).toBe(
      'Ein Dokument hängt an der Liegenschaft oder an genau einem: einer Anlage, einem Raum, einem Gebäude, einem Vorgang oder einem Mangel.',
    )
    expect(await fileDocument(client, { propertyId: '' }, photo, { shrink })).toBe(
      'Ein Dokument hängt an einer Liegenschaft, einem Gebäude, einem Raum, einer Anlage, einem Vorgang oder einem Mangel.',
    )
    expect(await fileDocument(client, atTheLift, photo, { title: '   ', shrink })).toBe(
      'Die Bezeichnung fehlt.',
    )
    expect(await fileDocument(client, atTheLift, photo, { title: 'x'.repeat(121), shrink })).toBe(
      'Die Bezeichnung hat höchstens 120 Zeichen.',
    )

    // Nothing was made smaller, kept or queued for any of them.
    expect(asked).toEqual([])
    expect(client.list('attachments')).toEqual([])
    await client.synchronise()
    expect(server.operations()).toEqual([])
    expect(server.uploaded.size).toBe(0)
  })

  it('lays a new version over a document, which changes nothing of the one before', async () => {
    const client = await start()

    await fileDocument(client, atTheLift, manual, { shrink })
    await client.synchronise()

    const [document] = client.list('attachments')
    const [first] = client.list('attachment_versions')

    expect(
      await fileVersion(
        client,
        String(document?.['id']),
        new File(['%PDF-1.7 Zweite Ausgabe'], 'Betriebsanleitung 2024.pdf', {
          type: 'application/pdf',
        }),
        { shrink },
      ),
    ).toBeNull()
    await client.synchronise()

    expect(created('attachment_versions').map((version) => version['fileName' as never])).toEqual([
      'Betriebsanleitung BA 630.pdf',
      'Betriebsanleitung 2024.pdf',
    ])
    expect(created('attachments')).toHaveLength(1)
    // No operation touches the first version again.
    expect(
      server.operations().filter((operation) => operation.recordId === String(first?.['id'])),
    ).toHaveLength(1)
  })
})

describe('the words a list has for a document', () => {
  const around: DocumentSurroundings = {
    properties: [{ id: 'p-school', name: 'Schulzentrum Am Lindenhain' }],
    buildings: [{ id: 'b-house', name: 'Schulhaus' }],
    rooms: [{ id: 'r-boiler', number: 'E.14', name: 'Heizraum' }],
    assets: [
      { id: 's-lift', number: 'AN-00012', name: 'Aufzug Schulhaus' },
      { id: 's-new', number: null, name: 'Neue Pumpe' },
    ],
    activities: [{ id: 'v-order', title: 'Notleuchte tauschen' }],
  } as unknown as DocumentSurroundings
  const document = (home: Readonly<Record<string, string>>): RecordState =>
    ({
      id: 'd-1',
      propertyId: 'p-school',
      buildingId: null,
      roomId: null,
      assetId: null,
      activityId: null,
      ...home,
    }) as unknown as RecordState

  it('say what it hangs on: an asset by number and name, anything else with its property', () => {
    expect(hangsOn(document({ assetId: 's-lift' }), around)).toEqual({
      home: 'assetId',
      id: 's-lift',
      words: 'AN-00012 Aufzug Schulhaus',
    })
    // Taken stock of a moment ago: the server has not numbered it yet.
    expect(hangsOn(document({ assetId: 's-new' }), around).words).toBe('Neue Pumpe')
    expect(hangsOn(document({ roomId: 'r-boiler' }), around).words).toBe(
      'Raum E.14 Heizraum, Schulzentrum Am Lindenhain',
    )
    expect(hangsOn(document({ buildingId: 'b-house' }), around).words).toBe(
      'Gebäude Schulhaus, Schulzentrum Am Lindenhain',
    )
    expect(hangsOn(document({ activityId: 'v-order' }), around).words).toBe(
      'Notleuchte tauschen, Schulzentrum Am Lindenhain',
    )
    expect(hangsOn(document({}), around)).toEqual({
      home: 'propertyId',
      id: 'p-school',
      words: 'Liegenschaft Schulzentrum Am Lindenhain',
    })
  })

  it('name a record the device does not hold by what kind of record it is', () => {
    expect(hangsOn(document({ activityId: 'v-of-somebody-else' }), around).words).toBe(
      'Vorgang, Schulzentrum Am Lindenhain',
    )
    expect(hangsOn(document({ assetId: 's-gone' }), around).words).toBe(
      'Anlage, Schulzentrum Am Lindenhain',
    )
  })

  it('say its kind, and "Foto" for a picture that has none', () => {
    const picture = { mediaType: 'image/jpeg' } as unknown as RecordState
    const page = { mediaType: 'application/pdf' } as unknown as RecordState

    expect(kindWordsOf({ kind: 'circuit_diagram' } as unknown as RecordState, page)).toBe(
      'Schaltplan',
    )
    expect(kindWordsOf({ kind: null } as unknown as RecordState, picture)).toBe('Foto')
    expect(kindWordsOf({ kind: null } as unknown as RecordState, page)).toBe('Ohne Art')
    expect(kindWordsOf({ kind: null } as unknown as RecordState, undefined)).toBe('Ohne Art')
  })

  it('name the day a version was filed and never the time of day, and say so while it has not gone up', async () => {
    const client = await start()

    server.put('attachment_versions', {
      id: 'v-1',
      attachmentId: 'd-1',
      fileName: 'schaltplan.pdf',
      sizeBytes: 820_000,
      createdAt: '2026-09-02T14:37:21.000Z',
    })
    await client.synchronise()

    const [sent] = client.list('attachment_versions')

    expect(sent).toBeDefined()
    expect(filedOn(client, sent as RecordState)).toBe('02.09.2026')
    expect(versionWords(client, sent as RecordState, 3)).toBe(
      'schaltplan.pdf, 820 kB, Fassung 3, 02.09.2026',
    )
    expect(versionWords(client, sent as RecordState, 1)).toBe('schaltplan.pdf, 820 kB, 02.09.2026')

    server.offline = true
    await fileDocument(client, atTheLift, manual, { shrink })

    const waiting = client.list('attachment_versions').find((version) => version['id'] !== 'v-1')

    expect(filedOn(client, waiting as RecordState)).toBe('noch nicht übertragen')
  })

  it('put the document changed last first, by its newest version', () => {
    const documents = [{ id: 'd-a' }, { id: 'd-b' }, { id: 'd-c' }] as unknown as RecordState[]
    const versions = new Map<string, readonly RecordState[]>([
      ['d-a', [{ id: 'v-2' }, { id: 'v-1' }] as unknown as RecordState[]],
      ['d-b', [{ id: 'v-9' }] as unknown as RecordState[]],
      ['d-c', [{ id: 'v-5' }] as unknown as RecordState[]],
    ])

    expect(newestFirst(documents, versions).map((each) => each['id'])).toEqual([
      'd-b',
      'd-c',
      'd-a',
    ])
  })
})
