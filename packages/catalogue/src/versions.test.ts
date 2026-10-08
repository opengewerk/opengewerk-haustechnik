import { describe, expect, it } from 'vitest'

import { changedVersions, removedDefectClasses } from './versions.js'

const bytes = (text: string) => new TextEncoder().encode(text)

const base = new Map<string, Uint8Array>([
  ['probe/manifest.json', bytes('{"version":"1.0.0"}\n')],
  ['probe/abnahmen.json', bytes('{"entries":[],"rules":[]}\n')],
  ['probe/regeln/elevator.json', bytes('{"records":[]}\n')],
  ['probe/pflichten/elevator_main_test.v1.json', bytes('{"label":"Hauptprüfung"}\n')],
  ['probe/anlagenarten/elevator.v1.json', bytes('{"label":"Aufzugsanlage"}\n')],
])

function head(changes: Readonly<Record<string, string | null>>) {
  return (path: string): Uint8Array | null => {
    if (Object.hasOwn(changes, path)) {
      const changed = changes[path]
      return changed === null || changed === undefined ? null : bytes(changed)
    }

    return base.get(path) ?? null
  }
}

describe('a merged version', () => {
  it('stands on the head as it stands on the base', () => {
    expect(changedVersions(base, head({}))).toEqual([])
  })

  it('may not change by a single byte, a line ending included', () => {
    expect(
      changedVersions(
        base,
        head({ 'probe/pflichten/elevator_main_test.v1.json': '{"label":"Hauptprüfung"}\r\n' }),
      ),
    ).toEqual([
      'probe/pflichten/elevator_main_test.v1.json: Die Fassung ist auf main gemergt und hier geändert. Eine gemergte Fassung wird nicht geändert, auch nicht für einen Tippfehler: die Berichtigung ist die nächste Fassung.',
    ])
  })

  it('may not go missing', () => {
    expect(changedVersions(base, head({ 'probe/anlagenarten/elevator.v1.json': null }))).toEqual([
      'probe/anlagenarten/elevator.v1.json: Die Fassung ist auf main gemergt und fehlt hier. Eine gemergte Fassung bleibt stehen; was nicht mehr gilt, endet mit einer neuen Fassung.',
    ])
  })

  it('leaves rules, manifest and reviews free to change, and a new version free to come', () => {
    expect(
      changedVersions(
        base,
        head({
          'probe/manifest.json': '{"version":"1.1.0"}\n',
          'probe/abnahmen.json': null,
          'probe/regeln/elevator.json': '{"records":[{}]}\n',
          'probe/pflichten/elevator_main_test.v2.json': '{"label":"Neu"}\n',
        }),
      ),
    ).toEqual([])
  })
})

describe('a merged class of defects', () => {
  const classes = (keys: readonly string[]) =>
    bytes(JSON.stringify({ classes: keys.map((key) => ({ key, label: key, unsafe: false })) }))
  const merged = new Map([['allgemein/mangelklassen.json', classes(['minor', 'dangerous'])]])

  it('stays in its package, its word free to change and a new class free to come', () => {
    expect(
      removedDefectClasses(merged, () =>
        bytes(
          JSON.stringify({
            classes: [
              { key: 'minor', label: 'leicht', unsafe: false },
              { key: 'dangerous', label: 'gefährlich', unsafe: true },
              { key: 'severe', label: 'schwer', unsafe: false },
            ],
          }),
        ),
      ),
    ).toEqual([])
  })

  it('may not go missing, with its file or alone', () => {
    expect(removedDefectClasses(merged, () => classes(['minor']))).toEqual([
      'allgemein/mangelklassen.json: Die Mängelklasse "dangerous" ist auf main gemergt und fehlt hier. Eine gemergte Klasse bleibt stehen, weil Mängel sie nennen, und ihr Schlüssel wird nicht neu vergeben.',
    ])
    expect(removedDefectClasses(merged, () => null)).toHaveLength(2)
  })
})
