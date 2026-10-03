import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Who may say that a transaction needs every area (ADR 0003, point 10): the
 * one way into the database the background runs have, and no route. A route
 * works for the person who asked and sees what they see; one that opened every
 * area would widen exactly what the line between the areas is for, and the
 * database could not tell.
 *
 * The files that may are listed here. A run in the background that needs
 * every area is added to the list with the run, and anything else that names
 * the setting or the function turns this red.
 */
const allowed = ['database/every-area.ts']

const source = fileURLToPath(new URL('..', import.meta.url))

/** Every file of code below `src`, tests and their helpers aside, relative and with forward slashes. */
function codeFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)

    if (entry.isDirectory()) {
      return codeFiles(path)
    }

    const name = entry.name
    const isTest = name.endsWith('.test.ts') || name.startsWith('test-')

    return name.endsWith('.ts') && !isTest ? [relative(source, path).split(sep).join('/')] : []
  })
}

describe('every area in one transaction', () => {
  it('is opened by the way in of the background runs and by nothing else', () => {
    const naming = codeFiles(source).filter((file) =>
      /app\.all_areas|\binEveryArea\b/.test(readFileSync(join(source, file), 'utf8')),
    )

    // A floor: the function itself names both, so a search that found
    // nothing would not have looked.
    expect(naming).toContain('database/every-area.ts')
    expect(naming.filter((file) => !allowed.includes(file))).toEqual([])
  })
})
