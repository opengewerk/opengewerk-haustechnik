import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The roles a tenant starts with are written as rows when it comes into being
// (ADR 0010 in the repository opengewerk), and from then on its rows are what
// counts: what somebody may do is read from them on every request. A change to
// the rights of a role in the code therefore reaches a tenant that is made
// after it and never one that is already there.
//
// For a right that is added, an existing tenant is merely short of it. For one
// that is taken away it is the other way round, and worse: the tenant keeps
// the wider role, silently, on every installation. So once a tenant can exist
// outside a test, a change to a shipped role is owed a migration that writes
// it into the rows that are there, and a test that holds the rows of a tenant
// of an earlier version against the roles in the code.
//
// No version of this application has appeared yet. Until one has, there is no
// installation whose rows could be behind, and a migration for every right
// added while the first version is still being built would migrate nothing.
// This test is the place where that stops being true.
//
// The changelog is outside this package, so `turbo.json` names it among the
// inputs of the tests here. Without that, the pull request that adds the
// first version would replay a green result from before.

const changelog = readFileSync(
  fileURLToPath(new URL('../../../../CHANGELOG.md', import.meta.url)),
  'utf8',
)

/** The versions that have appeared, as the changelog heads their sections. */
const appeared = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1])

describe('the roles of a tenant of an earlier version', () => {
  it('reads a changelog that is the one meant', () => {
    // A file without the section for what has not appeared yet is not the
    // changelog, and the list below would be empty for the wrong reason.
    expect(changelog).toMatch(/^## \[Unreleased\]/m)
  })

  /**
   * Red with the pull request that turns the first version into a section of
   * the changelog, and meant to be. What is owed then, in the same pull
   * request:
   *
   * 1. The four roles as that version ships them, written down as data beside
   *    this file, with the last migration of that version.
   * 2. A test in place of this one: a database on that migration, a tenant
   *    with those rows, every migration since, and the rows held against
   *    `shippedRoles`. `update.test.ts` shows how a database is stopped at an
   *    earlier migration.
   * 3. From then on, for every change to the rights of a shipped role, the
   *    migration that writes it into the rows of the tenants that are there,
   *    with the reason `migration` in their change log.
   */
  it('has nothing to hold against the code while no version has appeared', () => {
    expect(appeared).toEqual([])
  })
})
