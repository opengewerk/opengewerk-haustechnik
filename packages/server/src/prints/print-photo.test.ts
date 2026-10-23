import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { photoForPrint, printedLongEdge } from './print-photo.js'

/** A photo as a device keeps it: busy enough to weigh what a real one does. */
async function photo(
  width: number,
  height: number,
  format: 'jpeg' | 'png' = 'jpeg',
  orientation?: number,
): Promise<Buffer> {
  const made = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 140, b: 160 },
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
  const tagged = orientation === undefined ? made : made.withMetadata({ orientation })

  return format === 'png' ? tagged.png().toBuffer() : tagged.jpeg({ quality: 80 }).toBuffer()
}

async function sizeOf(bytes: Uint8Array) {
  const { format, width, height } = await sharp(bytes).metadata()

  return { format, width, height }
}

describe('photoForPrint', () => {
  it('makes a photo at the size a device keeps it smaller, to the long edge of the page', async () => {
    const kept = await photo(2048, 1536)
    const printed = await photoForPrint({ mediaType: 'image/jpeg', bytes: kept })

    expect(printed.mediaType).toBe('image/jpeg')
    expect(await sizeOf(printed.bytes)).toEqual({
      format: 'jpeg',
      width: printedLongEdge,
      height: 900,
    })
    // The point of it: a page of photos stays far below what the renderer takes.
    expect(printed.bytes.byteLength).toBeLessThan(kept.byteLength / 2)
  })

  it('takes the long edge of a photo taken upright', async () => {
    const printed = await photoForPrint({ mediaType: 'image/jpeg', bytes: await photo(1536, 2048) })

    expect(await sizeOf(printed.bytes)).toEqual({ format: 'jpeg', width: 900, height: 1200 })
  })

  it('turns a photo upright that says it was taken turned', async () => {
    // Stored lying, 2048 by 1536, with the note that it is to be turned a quarter.
    const printed = await photoForPrint({
      mediaType: 'image/jpeg',
      bytes: await photo(2048, 1536, 'jpeg', 6),
    })
    const read = await sharp(printed.bytes).metadata()

    expect({ width: read.width, height: read.height }).toEqual({ width: 900, height: 1200 })
    expect(read.orientation ?? 1).toBe(1)
  })

  it('prints a large PNG as JPEG', async () => {
    const printed = await photoForPrint({
      mediaType: 'image/png',
      bytes: await photo(2400, 1800, 'png'),
    })

    expect(printed.mediaType).toBe('image/jpeg')
    expect(await sizeOf(printed.bytes)).toEqual({ format: 'jpeg', width: 1200, height: 900 })
  })

  it('leaves a photo that is small enough as it is, byte for byte', async () => {
    const small = await photo(1200, 900)
    const printed = await photoForPrint({ mediaType: 'image/jpeg', bytes: small })

    expect(printed.mediaType).toBe('image/jpeg')
    expect(Buffer.from(printed.bytes).equals(small)).toBe(true)
  })

  it('leaves what cannot be read, and what is no photo, as it came', async () => {
    const broken = { mediaType: 'image/jpeg', bytes: Buffer.from('no photo at all') }
    const drawing = { mediaType: 'image/svg+xml', bytes: Buffer.from('<svg/>') }

    expect(await photoForPrint(broken)).toBe(broken)
    expect(await photoForPrint(drawing)).toBe(drawing)
  })
})
