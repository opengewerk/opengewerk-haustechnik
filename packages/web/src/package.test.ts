import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }

// The interface stands on the interface of the foundation and on the domain
// package of this application, and on nothing else of the organisation (ADR
// 0001, point 5): no server, which it only talks to, and no package of the
// Handwerkersoftware the submodule also holds. A dependency is one line in a
// manifest and looks harmless in a diff; these are the tests for that line
// (#80).
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

const fromTheOrganisation = declared().filter((name) => name.startsWith('@opengewerk/'))

describe('the web package', () => {
  it('stands on the interface of the foundation and the domain package, and on nothing else of the organisation', () => {
    expect([...fromTheOrganisation].sort()).toEqual([
      '@opengewerk/haustechnik-domain',
      '@opengewerk/platform-web',
    ])
  })

  it('depends on no server, of the foundation or of this application', () => {
    expect(
      fromTheOrganisation.filter(
        (name) =>
          name === '@opengewerk/platform-server' || name === '@opengewerk/haustechnik-server',
      ),
    ).toEqual([])
  })
})
