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
const allowed = [
  'database/every-area.ts',
  // The deadline engine: a pass works for nobody and goes through every area
  // of an operator (opengewerk-haustechnik#25).
  'deadlines/engine.ts',
  // What goes after its own retention without a confirmation, after each
  // pass (opengewerk-haustechnik#412): it works for nobody, in every area.
  'retention/removal.ts',
  // The notifications (opengewerk-haustechnik#126): what the jobs of mail and
  // push raise, and what a writer asks before it writes a message, whether
  // there is still something to tell and to whom. Both work for nobody. A
  // route that handed an activity to somebody asks the same writer after its
  // transaction (`notifications/tell.ts`), and gets nothing back from it: the
  // writer answers the outbox and never the person who asked.
  'notifications/notify.ts',
  'notifications/push.ts',
  // The answers by mail to somebody who reported without an account
  // (opengewerk-haustechnik#332): a run that works for nobody, like the two
  // above, and reads the address of a report in whatever area it lies.
  'notifications/outside-answers.ts',
]

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

describe('the area of a label in one transaction', () => {
  /**
   * The narrower sibling of every area (opengewerk-haustechnik#332): a
   * transaction without a person that sees the one area of a label, for a
   * report from somebody without an account. `session_areas()` takes it only
   * while no person is set; the files that may name the setting are these
   * two, the way in and the route of that report.
   */
  it('is opened by the route of a report without an account and by nothing else', () => {
    const naming = codeFiles(source).filter((file) =>
      /app\.label_area|\binLabelArea\b/.test(readFileSync(join(source, file), 'utf8')),
    )

    expect(naming).toContain('database/label-area.ts')
    expect(
      naming.filter(
        (file) => !['database/label-area.ts', 'api/outside-reports.controller.ts'].includes(file),
      ),
    ).toEqual([])
  })
})

describe('the pass of the deadlines in one transaction', () => {
  /**
   * What only the pass may do, the database lets through for the transaction
   * that says it is the pass (opengewerk-haustechnik#542): a done task goes a
   * year after, the person at a reading, a booking or a material three years
   * after. The way in names the setting, and the removal after the retention
   * is the one file that opens it.
   */
  it('is opened by the removal after the retention and by nothing else', () => {
    const naming = codeFiles(source).filter((file) =>
      /app\.deadline_run|\basTheDeadlineRun\b/.test(readFileSync(join(source, file), 'utf8')),
    )

    expect(naming).toContain('database/every-area.ts')
    expect(
      naming.filter((file) => !['database/every-area.ts', 'retention/removal.ts'].includes(file)),
    ).toEqual([])
  })
})
