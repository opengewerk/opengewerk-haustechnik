import { BadGatewayException } from '@nestjs/common'
import type { EvidenceId, StatedAnswer } from '@opengewerk/haustechnik-domain'
import {
  type Database,
  type FileStorage,
  noFileStorage,
  type PrintJob,
} from '@opengewerk/platform-server'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Asking } from './places.js'
import { Printer, printFailed } from './prints.controller.js'

/** A database that holds no print yet: every print is made anew. */
const database = { forTenant: () => Promise.resolve(null) } as unknown as Database
const asking = {} as Asking
const of = { evidenceId: '019a0000-0000-7000-8000-000000000000' as EvidenceId, voided: false }
const place = { propertyId: 'property', areaId: 'area' }
const job: PrintJob = { html: '<p>Nachweis</p>' }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a print that fails (#475)', () => {
  it('passes on a failure while reading what it shows as it is, and asks no renderer', async () => {
    const render = vi.fn(() => Promise.resolve(new Uint8Array()))
    const failure = new Error('Connection terminated unexpectedly')
    const printer = new Printer(database, noFileStorage, render)

    await expect(printer.printed(asking, of, place, () => Promise.reject(failure))).rejects.toBe(
      failure,
    )
    expect(render).not.toHaveBeenCalled()
  })

  it('answers a renderer that fails at a print of the day with a sentence of its own and logs what it said', async () => {
    const refusal = new Error('Abgelehnt (HTTP 500). Antwort: http://renderer:3000/pdf')
    const complained = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const printer = new Printer(database, noFileStorage, () => Promise.reject(refusal))
    const failed: unknown = await printer.fresh(job).catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(BadGatewayException)
    expect((failed as BadGatewayException).getResponse()).toMatchObject({ message: printFailed })
    expect(JSON.stringify((failed as BadGatewayException).getResponse())).not.toContain(
      'renderer:3000',
    )
    expect(complained).toHaveBeenCalledWith(expect.any(String), refusal)
  })
})

describe('the photos of a print (#580)', () => {
  it('reads every photo of a point from the store and hands it over at the size of the page', async () => {
    // A photo as a device keeps it, 2048 pixels on its long edge.
    const kept = await sharp({
      create: {
        width: 2048,
        height: 1536,
        channels: 3,
        background: { r: 120, g: 140, b: 160 },
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer()
    const store: FileStorage = { ...noFileStorage, get: () => Promise.resolve(kept) }
    const printer = new Printer(database, store, () => Promise.resolve(new Uint8Array()))
    const file = { sha256: 'a'.repeat(64), name: 'Foto.jpg', mediaType: 'image/jpeg' }
    const answer = {
      section: 'Rundgang',
      label: 'Heizraum',
      group: null,
      kind: 'photo',
      value: null,
      result: null,
      remark: null,
      limit: null,
      photo: file,
      morePhotos: [file],
    } as StatedAnswer

    const photos = await printer.photosOf([answer])

    expect(photos.map((photo) => photo.caption)).toEqual([
      'Heizraum (Foto 1 von 2)',
      'Heizraum (Foto 2 von 2)',
    ])

    for (const photo of photos) {
      const { width, height } = await sharp(photo.bytes).metadata()

      expect({ mediaType: photo.mediaType, width, height }).toEqual({
        mediaType: 'image/jpeg',
        width: 1200,
        height: 900,
      })
    }
  })
})
