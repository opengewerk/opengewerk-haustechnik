import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { bundleFiles } from './bundle.js'
import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

const probe = readPackageFiles(fileURLToPath(new URL('../test/pakete/', import.meta.url)))
const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

describe('the bundle module', () => {
  it('hands on the bundle the build wrote, read the way Node reads a JSON module', async () => {
    const { bundle } = loadCatalogue(probe, { applicationVersion: '0.0.0', today: '2026-10-03' })
    const folder = mkdtempSync(join(tmpdir(), 'catalogue-'))
    folders.push(folder)

    for (const [name, content] of Object.entries(
      bundleFiles(bundle as NonNullable<typeof bundle>),
    )) {
      writeFileSync(join(folder, name), content, 'utf8')
    }

    const written = (await import(pathToFileURL(join(folder, 'index.js')).href)) as {
      readonly catalogueBundle: unknown
    }

    expect(written.catalogueBundle).toEqual(bundle)
  })

  it('declares the type of the bundle from the domain package', () => {
    const { bundle } = loadCatalogue(probe, { applicationVersion: '0.0.0', today: '2026-10-03' })

    expect(bundleFiles(bundle as NonNullable<typeof bundle>)['index.d.ts']).toContain(
      "import type { CatalogueBundle } from '@opengewerk/haustechnik-domain'",
    )
  })
})
