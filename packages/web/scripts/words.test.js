// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { foreignWords, foreignWordsIn } from './words.js'

/**
 * The check of the build for the words of the Handwerkersoftware, on a build
 * laid out in a folder of its own.
 */

let dist = ''

function file(path, text) {
  mkdirSync(join(dist, path, '..'), { recursive: true })
  writeFileSync(join(dist, path), text)
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'words-'))
})

afterEach(() => {
  rmSync(dist, { recursive: true, force: true })
})

describe('the words of the Handwerkersoftware in a build', () => {
  it('are found in a script, a document and a manifest, with the sentence around them', () => {
    file('assets/office-1.js', 'const t="Dieser Zugang ist im Betrieb gesperrt.";')
    file('m/index.html', '<p>Die Aufträge des Tages auf der Baustelle.</p>')
    file('manifest.webmanifest', '{"description":"Für den Inhaber eines Betriebs"}')

    const found = foreignWordsIn(dist)

    expect(found.map(({ file: where, word }) => `${where}: ${word}`).sort()).toEqual([
      'assets/office-1.js: Betrieb',
      'm/index.html: Baustelle',
      'manifest.webmanifest: Betriebs',
      'manifest.webmanifest: Inhaber',
    ])
    expect(found.find((place) => place.word === 'Betrieb')?.around).toContain(
      'Dieser Zugang ist im Betrieb gesperrt.',
    )
  })

  it('are none in the words this application uses instead', () => {
    file(
      'assets/site-1.js',
      'const t=["Kein Zugang zu diesem Betreiber.","Die Leitung des Betreibers","Vor Ort","Betreiberverantwortung","Die Betriebsart der Anlage"];',
    )

    expect(foreignWordsIn(dist)).toEqual([])
  })

  it('are looked for only in what a browser loads', () => {
    file('brand/opengewerk-icon.svg', '<svg><title>Betrieb</title></svg>')
    file('assets/office-1.js.map', '{"sources":["Betrieb"]}')

    expect(foreignWordsIn(dist)).toEqual([])
  })

  it('would notice each of them, as the pattern is written', () => {
    for (const word of [
      'Betrieb',
      'Betriebe',
      'Betrieben',
      'Inhaberin',
      'Monteure',
      'Baustellen',
    ]) {
      expect(`ein Satz mit ${word} darin`.match(foreignWords)).toEqual([word])
    }
  })
})
