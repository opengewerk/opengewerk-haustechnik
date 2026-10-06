import { createHash } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'

import type { DocumentKind } from '@opengewerk/haustechnik-domain'
import { newId } from '@opengewerk/platform-server'

/**
 * The sample documents of the preview (#97): what the screen "Dokumente", the
 * card in the file of an asset and the cards at a room and a property show
 * while nobody has filed anything.
 *
 * Filed the way a device files one: the bytes go to the file store first,
 * then the document and its versions through the sync, as whoever the preview
 * answers as. So a route or a rule that changes its mind breaks the test of
 * the preview and not its next start. The files are made here, a page of a
 * PDF with a line on it and a small picture, and are nobody's.
 */

/** One version of a sample document: the name of its file and what stands in it. */
export interface SampleVersion {
  readonly fileName: string
  /** The line on its page; left out, the file is a picture. */
  readonly words?: string
}

/** A document at a sample record, with its versions, the oldest first. */
export interface SampleDocument {
  readonly title: string
  readonly kind?: DocumentKind
  readonly versions: readonly SampleVersion[]
}

/** What a sample document hangs on: its property, and on request one record there. */
export interface SampleHome {
  readonly propertyId: string
  readonly buildingId?: string
  readonly roomId?: string
  readonly assetId?: string
}

/** A PDF of one page with one line on it, well formed down to its table of offsets. */
export function samplePdf(words: string): Buffer {
  // Only the characters a standard font shows without an encoding of its own.
  const line = words.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (found) => `\\${found}`)
  const stream = `BT /F1 16 Tf 56 760 Td (${line}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []

  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`
  })

  const table = body.length

  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`
  body += `startxref\n${String(table)}\n%%EOF\n`

  return Buffer.from(body, 'latin1')
}

/** One chunk of a PNG: its length, its name, its bytes and the checksum over the last two. */
function chunk(name: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  const named = Buffer.concat([Buffer.from(name, 'latin1'), data])
  const sum = Buffer.alloc(4)

  head.writeUInt32BE(data.length, 0)
  head.write(name, 4, 'latin1')
  sum.writeUInt32BE(crc32(named) >>> 0, 0)

  return Buffer.concat([head, data, sum])
}

/**
 * A picture of a type plate as a PNG: a plate with a frame and a few lines,
 * drawn pixel by pixel, so that a list has something to show where a photo
 * would be.
 */
export function samplePicture(width = 640, height = 400): Buffer {
  const wall = [205, 200, 190]
  const plate = [232, 232, 228]
  const ink = [60, 66, 74]
  const rows: Buffer[] = []

  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3)

    for (let x = 0; x < width; x += 1) {
      const u = x / width
      const v = y / height
      const onPlate = u > 0.15 && u < 0.85 && v > 0.2 && v < 0.8
      const frame = onPlate && (u < 0.165 || u > 0.835 || v < 0.225 || v > 0.775)
      const line =
        onPlate &&
        u > 0.22 &&
        u < (v < 0.4 ? 0.7 : 0.55) &&
        [0.34, 0.46, 0.58, 0.68].some((at) => Math.abs(v - at) < 0.012)
      const colour = frame || line ? ink : onPlate ? plate : wall

      row[1 + x * 3] = colour[0] ?? 0
      row[2 + x * 3] = colour[1] ?? 0
      row[3 + x * 3] = colour[2] ?? 0
    }

    rows.push(row)
  }

  const header = Buffer.alloc(13)

  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  // Eight bits a channel, colour without alpha, and nothing interlaced.
  header.set([8, 2, 0, 0, 0], 8)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function refused(path: string, response: Response): Promise<never> {
  throw new Error(`${path} lehnte ab (${String(response.status)}): ${await response.text()}`)
}

/** Sends the bytes of a file ahead of the version that names them, and hands back their hash. */
async function store(address: string, bytes: Buffer, mediaType: string): Promise<string> {
  const sha256 = hashOf(bytes)
  const path = `/files/${sha256}`
  const response = await fetch(`${address}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', 'x-media-type': mediaType },
    body: new Uint8Array(bytes),
  })

  return response.ok ? sha256 : refused(path, response)
}

/**
 * Files one sample document at `home` through the routes of the preview at
 * `address`: every file to the store, then the document and its versions in
 * one transmission, each recorded a moment after the one before, which is the
 * order the server applies them in.
 */
export async function plantDocument(
  address: string,
  home: SampleHome,
  document: SampleDocument,
): Promise<void> {
  const documentId = newId<'attachment'>()
  let recorded = Date.now()
  const operation = (
    entity: string,
    recordId: string,
    values: Readonly<Record<string, unknown>>,
  ) => {
    recorded += 1

    return {
      id: newId<'operation'>(),
      entity,
      recordId,
      kind: 'create',
      baseVersion: null,
      patches: Object.entries(values).map(([field, to]) => ({ field, from: null, to })),
      recordedAt: new Date(recorded).toISOString(),
    }
  }
  const operations = [
    operation('attachments', documentId, {
      title: document.title,
      ...(document.kind === undefined ? {} : { kind: document.kind }),
      ...home,
    }),
  ]

  for (const version of document.versions) {
    const picture = version.words === undefined
    const bytes = picture ? samplePicture() : samplePdf(version.words ?? '')
    const mediaType = picture ? 'image/png' : 'application/pdf'
    const sha256 = await store(address, bytes, mediaType)
    const previewSha256 = picture
      ? await store(address, samplePicture(320, 200), 'image/png')
      : null

    operations.push(
      operation('attachment_versions', newId<'attachment-version'>(), {
        attachmentId: documentId,
        sha256,
        fileName: version.fileName,
        mediaType,
        sizeBytes: bytes.byteLength,
        previewSha256,
      }),
    )
  }

  const response = await fetch(`${address}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: 'vorschau', operations }),
  })

  if (!response.ok) {
    await refused('/sync', response)
  }

  const { receipts } = (await response.json()) as {
    receipts: readonly { outcome: string; reason: string | null }[]
  }
  const kept = receipts.find((receipt) => receipt.outcome !== 'applied')

  if (kept) {
    throw new Error(
      `Das Beispieldokument „${document.title}“ wurde nicht abgelegt: ${kept.outcome} ${String(kept.reason)}`,
    )
  }
}
