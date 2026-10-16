import { PDFDocument } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'

import {
  type AttachedPages,
  attachmentLimit,
  carriedWith,
  type EvidenceAttachment,
  withEvidenceBehind,
} from './evidence-bundle.js'

/** A PDF of empty pages, as the renderer or a contractor might send one. */
async function pdfOf(pages: number): Promise<Uint8Array> {
  const made = await PDFDocument.create()

  for (let page = 0; page < pages; page += 1) {
    made.addPage()
  }

  return made.save()
}

/** The smallest PNG there is: one pixel. */
const pixel = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
)

describe('the evidence behind the register (#338)', () => {
  it('follows the list with each print and the files it rests on, and tells the list where each begins', async () => {
    const asked: AttachedPages<string>[] = []
    const whole = await PDFDocument.load(
      await withEvidenceBehind(
        [
          { key: 'e-1', print: await pdfOf(1), files: [] },
          {
            key: 'e-2',
            print: await pdfOf(2),
            files: [
              { mediaType: 'application/pdf', bytes: await pdfOf(3) },
              { mediaType: 'image/png', bytes: pixel },
            ],
          },
        ],
        async (attached) => {
          asked.push(attached)

          return pdfOf(1)
        },
      ),
    )

    expect(whole.getPageCount()).toBe(1 + 1 + 2 + 3 + 1)
    expect(asked.at(-1)).toEqual({
      pages: new Map([
        ['e-1', 2],
        ['e-2', 3],
      ]),
      from: 2,
      total: 8,
      unattached: 0,
    })
  })

  it('makes the list again while its own length moves the pages behind it', async () => {
    const lengths: number[] = []
    const whole = await PDFDocument.load(
      await withEvidenceBehind(
        [{ key: 'e-1', print: await pdfOf(1), files: [] }],
        async (attached) => {
          lengths.push(attached.from)

          // The list takes two pages once it names the pages behind it.
          return pdfOf(2)
        },
      ),
    )

    expect(lengths).toEqual([2, 3])
    expect(whole.getPageCount()).toBe(3)
  })

  it('leaves out and counts what cannot be taken over, and never fails over it', async () => {
    const asked: AttachedPages<string>[] = []
    const whole = await PDFDocument.load(
      await withEvidenceBehind(
        [
          {
            key: 'e-1',
            print: await pdfOf(1),
            files: [
              { mediaType: 'application/pdf', bytes: new TextEncoder().encode('%PDF broken') },
              { mediaType: 'image/png', bytes: new TextEncoder().encode('no picture') },
              { mediaType: 'text/plain', bytes: new TextEncoder().encode('a note') },
            ],
          },
        ],
        async (attached) => {
          asked.push(attached)

          return pdfOf(1)
        },
      ),
    )

    expect(whole.getPageCount()).toBe(2)
    expect(asked.at(-1)?.unattached).toBe(3)
  })
})

describe('the weight of the evidence behind the register (#338)', () => {
  const of = (print: number, ...files: number[]): EvidenceAttachment<string> => ({
    key: 'e',
    print: new Uint8Array(print),
    files: files.map((size) => ({ mediaType: 'application/pdf', bytes: new Uint8Array(size) })),
  })

  it('counts the print and the files of each attachment', () => {
    expect(carriedWith(10, of(5, 3, 2), 100)).toBe(20)
  })

  it('stops at the limit, the attachment that reaches it still taken', () => {
    expect(carriedWith(90, of(5, 5), 100)).toBe(100)
    expect(carriedWith(90, of(5, 6), 100)).toBeNull()
  })

  it('holds 200 MB unless a request says otherwise', () => {
    expect(attachmentLimit).toBe(200 * 1024 * 1024)
    expect(carriedWith(attachmentLimit, of(1))).toBeNull()
  })
})
