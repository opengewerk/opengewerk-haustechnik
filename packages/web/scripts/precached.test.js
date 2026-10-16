// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { unprecachedScripts } from './precached.js'

/** The check that the service worker holds every script of a build (#374), on a build of its own. */

let dist = ''

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'precached-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'assets', 'index-a1.js'), '')
  writeFileSync(join(dist, 'assets', 'meters-b2.js'), '')
  writeFileSync(join(dist, 'assets', 'styles-c3.css'), '')
})

afterEach(() => {
  rmSync(dist, { recursive: true, force: true })
})

describe('the scripts a service worker holds', () => {
  it('names every script of the build it does not hold, and no other file', () => {
    writeFileSync(
      join(dist, 'service-worker.js'),
      'self.precache=[{"revision":null,"url":"assets/index-a1.js"},{"revision":"x","url":"index.html"}]',
    )

    expect(unprecachedScripts(dist)).toEqual(['assets/meters-b2.js'])
  })

  it('names none when it holds them all', () => {
    writeFileSync(
      join(dist, 'service-worker.js'),
      '[{"revision":null,"url":"assets/index-a1.js"},{"revision":null,"url":"assets/meters-b2.js"}]',
    )

    expect(unprecachedScripts(dist)).toEqual([])
  })
})
