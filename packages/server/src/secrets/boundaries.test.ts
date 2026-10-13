import { fileURLToPath } from 'node:url'

import { secretsTouchedIn } from '@opengewerk/platform-server/testing'
import { describe, expect, it } from 'vitest'

/**
 * The sealed credentials are read and written in one place.
 *
 * The store of the foundation seals and opens them. A route that imported the
 * table itself could hand a sealed value to a browser, and a job that did
 * could keep one without the seal; this names such a file before it happens.
 * How the files are found is the foundation's and tested there.
 *
 * The table exists since the first migration, and its store is bound since
 * the first credential that is kept, the password of a tenant's mail server
 * (opengewerk-haustechnik#126). This list names that one file, and a second
 * entry is a second place that reaches the sealed values.
 */

const source = fileURLToPath(new URL('..', import.meta.url))

describe('the sealed credentials', () => {
  it('are touched by the store and by no other file', () => {
    expect(secretsTouchedIn(source)).toEqual(['secrets/store.ts'])
  })
})
