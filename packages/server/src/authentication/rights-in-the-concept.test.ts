import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { rightLabel, rights, shippedRoles } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

// Section 7 of the concept says what each role may do, right by right, in the
// words a person reads. The catalogue in the code is the same list. Two lists
// that say the same thing drift, so this holds one against the other: a right
// that is added, renamed or given to another role in one of them turns this
// red until the other follows.
//
// The concept is the source for what the application does. A change that
// starts in the code is therefore a change of the concept, and the place to
// argue for it is there.
//
// It lives in the server package because it reads a file: the domain package
// computes and does not reach the disk. The file is outside this package, so
// `turbo.json` names it among the inputs of the tests here; without that, a
// change to the concept alone would leave the hash of the task as it was, and
// a green result from before would be replayed over it.

const concept = readFileSync(
  fileURLToPath(new URL('../../../../docs/konzept/Planungskonzept.md', import.meta.url)),
  'utf8',
)

/**
 * One section of the concept, from its heading to the next of the same level.
 * Empty when there is none: what is missing is said by the tests below and
 * not by a file that fails to load, which names nothing.
 */
function section(heading: string): string {
  const start = concept.indexOf(`\n## ${heading}`)

  if (start < 0) {
    return ''
  }

  const end = concept.indexOf('\n## ', start + 1)

  return concept.slice(start, end < 0 ? undefined : end)
}

/** The cells of one line of a Markdown table. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * The table of a section whose first column has this heading: its header and
 * its rows. Without a header and without rows when there is no such table.
 */
function table(text: string, firstColumn: string): { header: string[]; rows: string[][] } {
  const lines = text.split('\n')
  const top = lines.findIndex((line) => line.startsWith('|') && cells(line)[0] === firstColumn)

  if (top < 0) {
    return { header: [], rows: [] }
  }

  const rows: string[][] = []

  // The line under the header is the rule of dashes.
  for (const line of lines.slice(top + 2)) {
    if (!line.startsWith('|')) {
      break
    }

    rows.push(cells(line))
  }

  return { header: cells(lines[top] ?? ''), rows }
}

const rolesAndRights = section('7. Rollen und Rechte')
const matrix = table(rolesAndRights, 'Recht')
const roles = table(rolesAndRights, 'Rolle')
const roleColumns = matrix.header.slice(1)

describe('the table of rights in section 7 of the concept', () => {
  it('is there, and long enough to be the one meant', () => {
    // An empty table would agree with an empty catalogue, and a parser that
    // found nothing would pass every check below.
    expect(matrix.rows.length).toBeGreaterThanOrEqual(20)
    expect(roleColumns.length).toBe(4)
  })

  it('has a column for each role a tenant starts with, under the name a screen shows', () => {
    expect(roleColumns).toEqual(shippedRoles.map((role) => role.label))
  })

  it('names every right of the catalogue, in its words and in its order, and no other', () => {
    expect(matrix.rows.map((row) => row[0])).toEqual(rights.map((right) => rightLabel[right]))
  })

  it('answers every cell with yes or no', () => {
    const others = matrix.rows.flatMap((row) =>
      row
        .slice(1)
        .filter((cell) => cell !== 'ja' && cell !== 'nein')
        .map((cell) => [row[0], cell]),
    )

    expect(others).toEqual([])
    expect(matrix.rows.filter((row) => row.length !== roleColumns.length + 1)).toEqual([])
  })

  it.each(shippedRoles.map((role) => [role.label, role] as const))(
    'gives "%s" the rights the role holds in the code, and no other',
    (label, role) => {
      const column = matrix.header.indexOf(label)
      const inTheConcept = matrix.rows.filter((row) => row[column] === 'ja').map((row) => row[0])

      expect(column).toBeGreaterThan(0)
      expect(inTheConcept).toEqual(role.rights.map((right) => rightLabel[right]))
    },
  )
})

describe('the table of roles in section 7 of the concept', () => {
  it('names each role a tenant starts with', () => {
    const named = roles.rows.map((row) => row[0])

    for (const role of shippedRoles) {
      expect(named).toContain(role.label)
    }
  })

  /**
   * Whether a role works only with a second factor is said in words there,
   * and it is a flag of the role in the code.
   */
  it('asks for a second factor where the role in the code does', () => {
    for (const role of shippedRoles) {
      const said = roles.rows.find((row) => row[0] === role.label)?.[1] ?? ''

      expect([role.label, said.includes('zweiter Faktor Pflicht')]).toEqual([
        role.label,
        role.secondFactor,
      ])
    }
  })
})
