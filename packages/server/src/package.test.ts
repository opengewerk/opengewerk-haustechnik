import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }

// This application stands on the foundation and on nothing else of the
// repository the foundation lives in (ADR 0001). The submodule holds the whole
// Handwerkersoftware, and only `packages/platform/*` is a member of this
// workspace, so an import of anything else in there fails as a missing module.
// That holds only as long as nobody enters such a dependency here, which is one
// line in a manifest and looks harmless in a diff. These are the tests for
// that line.
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

describe('the server package', () => {
  it('stands on the server side of the foundation, and not on its interface', () => {
    // `platform-web` is built for a browser. A server that depended on it
    // would pull the DOM in underneath itself. What computes comes through
    // the domain package of this application, which hands the foundation on.
    expect(fromTheOrganisation.filter((name) => name.startsWith('@opengewerk/platform-'))).toEqual([
      '@opengewerk/platform-server',
    ])
  })

  it('depends on no package of the Handwerkersoftware', () => {
    expect(
      fromTheOrganisation.filter(
        (name) =>
          !name.startsWith('@opengewerk/platform-') && !name.startsWith('@opengewerk/haustechnik-'),
      ),
    ).toEqual([])
  })

  it('is above the domain package of this application and below its interface', () => {
    expect(
      fromTheOrganisation.filter((name) => name.startsWith('@opengewerk/haustechnik-')),
    ).toEqual(['@opengewerk/haustechnik-domain'])
  })
})
