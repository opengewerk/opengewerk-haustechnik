import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import { writeTravel } from '@opengewerk/haustechnik-domain'
import { TestServer } from '@opengewerk/platform-web/testing'
import { onlineManager } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mountedWithItsDevice } from '../app/test-entry.js'
import { travelKeep } from '../sync/travel.js'
import { officeApplication } from './application.js'
import { officeRoutes } from './router.js'
import { onA, signedInOffice } from './test-office.js'

/**
 * The files kept for the road (#348) follow the device in the office as well
 * (#536): a device that is opened only in the office after an area or a right
 * went lets go of what it may no longer read, and fetches what is new.
 */

const sued = { id: 'area-sued', name: 'Süd' }
const bytes = new TextEncoder().encode('%PDF-1.7 Schema der Heizzentrale')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const versionId = '00000000-0000-7000-8000-000000000012'
const scheme = {
  id: 'd-scheme',
  propertyId: 'p-school',
  areaId: sued.id,
  buildingId: null,
  roomId: 'r-boiler',
  assetId: null,
  activityId: null,
  title: 'Schema der Heizzentrale',
  kind: 'operating_manual',
}

let server: TestServer

beforeEach(() => {
  onA('desktop')
  server = new TestServer()
  server.put('attachments', scheme)
  server.put('attachment_versions', {
    id: versionId,
    attachmentId: scheme.id,
    sha256,
    fileName: 'schema.pdf',
    mediaType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    previewSha256: null,
    createdBy: 'u-kraemer',
    createdAt: '2026-10-18T09:00:00.000Z',
  })
  signedInOffice('technical_management', [sued])

  // The file of the version, beside what the office is answered.
  const answered = globalThis.fetch

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) =>
    path === `/attachments/versions/${versionId}/content`
      ? Promise.resolve(
          new Response(bytes.buffer as ArrayBuffer, {
            headers: { 'content-type': 'application/pdf' },
          }),
        )
      : answered(path, init),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  onlineManager.setOnline(true)
})

describe('the files kept for the road, in the office (#536)', () => {
  it('come to the device and leave it again with the exchanges the office runs', async () => {
    const { client } = await mountedWithItsDevice({
      routeTree: officeRoutes(),
      at: '/',
      application: officeApplication,
      server,
      entities: ['attachments', 'attachment_versions'],
      holds: {
        [travelKeep]: writeTravel({ places: [{ kind: 'room', id: 'r-boiler' }], files: [] }),
      },
    })

    await waitFor(async () => {
      expect(await client.readFile(sha256)).not.toBeNull()
    })

    // The document leaves what the person reads, as with an area or a right that went.
    server.put('attachments', { ...scheme, deletedAt: '2026-10-22T10:00:00.000Z' })
    await client.synchronise()

    await waitFor(async () => {
      expect(await client.readFile(sha256)).toBeNull()
    })
  })
})
