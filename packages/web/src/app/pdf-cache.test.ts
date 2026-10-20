import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { printLabels, printShelfLabels } from './labels.js'
import { evidencePdfAddress, fetchPdf, roundPdfAddress } from './prints.js'

/**
 * The PDFs this application fetches itself, beside the requests of the
 * foundation (#360). An evidence, a round and a sheet of labels name people
 * and places of an operator; signing out empties the stores of the device and
 * cannot reach the HTTP cache of the browser, so none of them may land there.
 * The server says the same in its answer; the request says it as well, as
 * every request of the foundation does.
 */

let asked: { readonly path: string; readonly init: RequestInit | undefined }[]

beforeEach(() => {
  asked = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    asked.push({ path, init })

    return Promise.resolve(
      new Response(new Blob(['%PDF'], { type: 'application/pdf' }), { status: 200 }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a PDF the application fetches', () => {
  it('goes past the HTTP cache for an evidence and a round', async () => {
    await fetchPdf(evidencePdfAddress('e-1'))
    await fetchPdf(roundPdfAddress('r-1'))

    expect(asked.map((one) => [one.path, one.init?.cache])).toEqual([
      ['/evidence/e-1/pdf', 'no-store'],
      ['/rounds/r-1/pdf', 'no-store'],
    ])
  })

  it('goes past the HTTP cache for a print of labels and for the labels of a store', async () => {
    await printLabels({ what: 'blank', propertyId: 'p-1', count: 4 }, 'sheet', 1)
    await printShelfLabels('s-1', 'all', 'sheet', 1)

    expect(asked.map((one) => [one.path, one.init?.method, one.init?.cache])).toEqual([
      ['/labels/print/blank', 'POST', 'no-store'],
      ['/stores/s-1/labels/print', 'POST', 'no-store'],
    ])
  })
})
