import { describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }
import * as surface from './index.js'

// This application stands on the foundation and on nothing else of the
// repository the foundation lives in (ADR 0001). The submodule holds the whole
// Handwerkersoftware, and only `packages/platform/*` is a member of this
// workspace, so an import of anything else in there fails as a missing module.
// Both hold only as long as nobody enters such a dependency here, which is one
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

describe('the domain package', () => {
  it('depends on the part of the foundation that computes, and on no other package of it', () => {
    // `platform-server` would put Node underneath code that has to run in a
    // browser as well, `platform-web` the DOM underneath code that runs on a
    // server.
    expect(fromTheOrganisation.filter((name) => name.startsWith('@opengewerk/platform-'))).toEqual([
      '@opengewerk/platform-domain',
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

  it('is the bottom layer of the application and depends on none of its other packages', () => {
    expect(
      fromTheOrganisation.filter((name) => name.startsWith('@opengewerk/haustechnik-')),
    ).toEqual([])
  })

  it('hands on what the foundation exports, so that server and interface ask one package', () => {
    // Two names every part of the application needs sooner or later: the
    // pattern a stored file is addressed by, and the way a device says what it
    // wants changed. If either is missing here, the pinned commit of the
    // foundation is older than the code that was written against it.
    expect(surface.sha256Pattern).toBeInstanceOf(RegExp)
    expect(surface.operationKinds).toContain('create')
  })
})
