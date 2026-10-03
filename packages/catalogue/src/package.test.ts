import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }

const sections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

function declared(): readonly string[] {
  const read = manifest as Readonly<Record<string, unknown>>

  return sections.flatMap((section) =>
    Object.keys((read[section] ?? {}) as Readonly<Record<string, unknown>>),
  )
}

describe('the catalogue package', () => {
  it('stands on the domain package of this application and on nothing else of the organisation', () => {
    // The loader reads files and hands on data. A package of the server or
    // the interface underneath it would make the catalogue wait for them,
    // and the Handwerkersoftware is no part of this application (ADR 0001).
    expect(declared().filter((name) => name.startsWith('@opengewerk/'))).toEqual([
      '@opengewerk/haustechnik-domain',
    ])
  })

  it('hands on only the built bundle', () => {
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    })
  })
})
