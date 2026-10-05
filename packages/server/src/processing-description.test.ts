import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { rightLabel, rights, shippedRoles } from '@opengewerk/haustechnik-domain'
import { Database } from '@opengewerk/platform-server'
import { firstSegmentOf, routesOf } from '@opengewerk/platform-server/testing'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { ApiModule } from './api/api.module.js'
import { noIdentities } from './api/test-identity.js'
import { createAuthentication } from './authentication/access.js'
import * as schema from './database/schema/index.js'

// Section 9 of the concept: until the application generates the description of
// its processing, there is one written by hand, for a works council to hold
// before the parallel run. A document written by hand says what was true on
// the day it was written. This holds it against the code, so that it says what
// is true today:
//
// - every entry of its appendix A points at something that is there: a test by
//   its title, a place by its words, a right by its label and its roles;
// - every statement names where in the concept it comes from, and every
//   promise names a test, because a promise without a test is an intention
//   (section 9);
// - appendix B names every column that points at a person, and appendix C
//   every address the server answers. A building block that adds one of either
//   turns this red until the document says what it means for the people it is
//   about, which is the moment the document has to be looked at again.
//
// It lives in the server package for the reason the test of the rights in the
// concept does: it reads files, and it needs the schema and the routing table.
// The files it reads outside this package and its dependencies are named among
// the inputs of the tests here in `turbo.json`.

const root = new URL('../../../', import.meta.url)

/** A file of the repository by its path from the root, or null where there is none. */
function fileAt(path: string): string | null {
  const location = fileURLToPath(new URL(path, root))

  return existsSync(location) ? readFileSync(location, 'utf8') : null
}

const document = fileAt('docs/verfahrensbeschreibung/Verfahrensbeschreibung.md') ?? ''
const concept = fileAt('docs/konzept/Planungskonzept.md') ?? ''
const changelog = fileAt('CHANGELOG.md') ?? ''
const lines = document.split(/\r?\n/)

/** The cells of one line of a Markdown table, without the marks of code around them. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().replace(/^`/, '').replace(/`$/, ''))
}

/** The rows of the first table under a heading. None where the heading or the table is missing. */
function tableUnder(heading: string): string[][] {
  const start = lines.indexOf(heading)

  if (start < 0) {
    return []
  }

  const top = lines.findIndex((line, index) => index > start && line.startsWith('|'))

  if (top < 0) {
    return []
  }

  const rows: string[][] = []

  // The line under the header is the rule of dashes.
  for (const line of lines.slice(top + 2)) {
    if (!line.startsWith('|')) {
      break
    }

    rows.push(cells(line))
  }

  return rows
}

interface Entry {
  readonly id: string
  readonly kind: string
  readonly where: string
  readonly what: string
}

const entries: Entry[] = tableUnder('## Anhang A: Belege').map((row) => ({
  id: row[0] ?? '',
  kind: row[1] ?? '',
  where: row[2] ?? '',
  what: row[3] ?? '',
}))

const entryById = new Map(entries.map((entry) => [entry.id, entry]))

/** What stands in square brackets behind a statement: sections of the concept and entries of appendix A. */
function citationsIn(text: string): string[] {
  return [...text.matchAll(/\[((?:[KB][\d.]+)(?:, [KB][\d.]+)*)\]/g)].flatMap((match) =>
    (match[1] ?? '').split(', '),
  )
}

interface Statement {
  readonly section: number
  readonly text: string
}

/**
 * The statements: the list items of sections 3 to 10. Each is one line, as in
 * the concept, so that a line is a statement and nothing has to be guessed
 * about where one ends.
 */
function statements(): Statement[] {
  const found: Statement[] = []
  let section = 0

  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = Number(/^## (\d+)\. /.exec(line)?.[1] ?? 0)
    } else if (line.startsWith('- ') && section >= 3 && section <= 10) {
      found.push({ section, text: line })
    }
  }

  return found
}

/** Whether the concept has a section of this number: `9` a chapter, `2.6` a part of one. */
function conceptHas(section: string): boolean {
  return section.includes('.')
    ? concept.includes(`\n### ${section} `)
    : concept.includes(`\n## ${section}. `)
}

describe('the description of the processing, written by hand', () => {
  it('is there, and long enough to be the one meant', () => {
    // An empty document would agree with everything below.
    expect(lines.length).toBeGreaterThanOrEqual(150)
    expect(entries.length).toBeGreaterThanOrEqual(50)
    expect(statements().length).toBeGreaterThanOrEqual(50)
  })

  it('says that it is written by hand', () => {
    expect(document).toContain('**Geschrieben:** von Hand')
  })

  /**
   * The version it holds for is the newest one the changelog has. Until one
   * has appeared it says so, and the first release turns this red until
   * somebody has read the document against what is released.
   */
  it('names the version it holds for, the newest of the changelog', () => {
    const holdsFor = lines.find((line) => line.startsWith('- **Gilt für:** ')) ?? ''
    const newest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1]

    expect(holdsFor).toContain(
      newest === undefined ? 'noch keine veröffentlichte Fassung' : `Fassung ${newest}`,
    )
  })
})

describe('the evidence in appendix A of the description', () => {
  it('is numbered without a gap, each entry of a kind there is', () => {
    expect(entries.map((entry) => entry.id)).toEqual(entries.map((_, index) => `B${index + 1}`))
    expect(entries.filter((entry) => !['Recht', 'Stelle', 'Test'].includes(entry.kind))).toEqual([])
  })

  it('names a test by a title that stands in the file it names', () => {
    const tests = entries.filter((entry) => entry.kind === 'Test')
    const wrong = tests
      .filter(
        (entry) =>
          !/\.test\.tsx?$/.test(entry.where) || !(fileAt(entry.where) ?? '').includes(entry.what),
      )
      .map((entry) => [entry.id, entry.where, entry.what])

    expect(tests.length).toBeGreaterThanOrEqual(30)
    expect(wrong).toEqual([])
  })

  it('names a place by words that stand in the file it names', () => {
    const places = entries.filter((entry) => entry.kind === 'Stelle')
    const wrong = places
      .filter(
        (entry) =>
          /\.test\.tsx?$/.test(entry.where) ||
          entry.what === '' ||
          !(fileAt(entry.where) ?? '').includes(entry.what),
      )
      .map((entry) => [entry.id, entry.where, entry.what])

    expect(places.length).toBeGreaterThanOrEqual(1)
    expect(wrong).toEqual([])
  })

  /**
   * "Label: role, role". The label is the one a person reads when the right is
   * missing, and the roles are the ones a tenant starts with that hold it. A
   * right given to another role in the code turns this red, and the sentence
   * that leans on the entry is then one to read again.
   */
  it('names a right by its label, with exactly the roles that hold it', () => {
    const labels: Readonly<Record<string, string>> = rightLabel
    const named = entries.filter((entry) => entry.kind === 'Recht')

    expect(named.length).toBeGreaterThanOrEqual(1)

    for (const entry of named) {
      const holders = shippedRoles
        .filter((role) => (role.rights as readonly string[]).includes(entry.where))
        .map((role) => role.label)

      expect((rights as readonly string[]).includes(entry.where), entry.id).toBe(true)
      expect([entry.id, entry.what]).toEqual([
        entry.id,
        `${labels[entry.where] ?? ''}: ${holders.join(', ')}`,
      ])
    }
  })

  it('is used: every entry is cited by a statement, and every citation has an entry', () => {
    const body = lines.slice(0, lines.indexOf('## Anhang A: Belege')).join('\n')
    const cited = new Set(citationsIn(body).filter((citation) => citation.startsWith('B')))

    expect(entries.map((entry) => entry.id).filter((id) => !cited.has(id))).toEqual([])
    expect([...cited].filter((id) => !entryById.has(id))).toEqual([])
  })
})

describe('the statements of the description', () => {
  it('each name the section of the concept they come from, and the concept has it', () => {
    const without = statements()
      .filter(
        (statement) => !citationsIn(statement.text).some((citation) => citation.startsWith('K')),
      )
      .map((statement) => statement.text)

    const unknown = statements()
      .flatMap((statement) => citationsIn(statement.text))
      .filter((citation) => citation.startsWith('K') && !conceptHas(citation.slice(1)))

    expect(without).toEqual([])
    expect(unknown).toEqual([])
  })

  /**
   * Section 9 of the concept: a promise in the documents has a test that
   * holds it. A sentence that begins as a promise and cites no test is the
   * intention the concept speaks of, and belongs in section 10 of the
   * document, which lists what is not held yet.
   */
  it('that are a promise each name a test', () => {
    const promises = statements().filter((statement) => statement.text.startsWith('- **Zusage:**'))
    const untested = promises
      .filter(
        (statement) =>
          !citationsIn(statement.text).some((citation) => entryById.get(citation)?.kind === 'Test'),
      )
      .map((statement) => statement.text)

    expect(promises.length).toBeGreaterThanOrEqual(20)
    expect(untested).toEqual([])
  })
})

/**
 * Every column that holds the id of an account: one with a key to the accounts
 * or to the memberships, and one that is named like those that have such a key.
 * The second half is there for the columns that carry no key on purpose, the
 * stamp of the sync and the person of an entry in a log, which has to outlive
 * what it points at.
 */
function columnsThatPointAtAPerson(): string[] {
  const found: string[] = []

  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) {
      continue
    }

    const table = getTableConfig(value)
    const keyed = new Set<string>()

    for (const key of table.foreignKeys) {
      const reference = key.reference()
      const target = getTableConfig(reference.foreignTable).name

      if (target === 'auth_users' || target === 'memberships') {
        for (const column of reference.columns) {
          if (column.name !== 'tenant_id') {
            keyed.add(column.name)
          }
        }
      }
    }

    for (const column of table.columns) {
      if (keyed.has(column.name) || /(^|_)user_id$|_by$/.test(column.name)) {
        found.push(`${table.name}.${column.name}`)
      }
    }
  }

  return found.sort()
}

describe('appendix B of the description', () => {
  /**
   * A row with a star for the table stands for the column on every table that
   * has it; that is the stamp of the sync, which every travelling row carries.
   */
  it('names every column that points at a person, and no other', () => {
    const rows = tableUnder('## Anhang B: Felder, die auf eine Person zeigen')
    const everywhere = new Set(rows.filter((row) => row[0] === '*').map((row) => row[1] ?? ''))
    const named = rows.filter((row) => row[0] !== '*').map((row) => `${row[0]}.${row[1]}`)
    const there = columnsThatPointAtAPerson()

    expect(there.length).toBeGreaterThanOrEqual(30)
    expect(
      [...everywhere].filter((column) => !there.some((name) => name.endsWith(`.${column}`))),
    ).toEqual([])
    expect(named.slice().sort()).toEqual(
      there.filter((name) => !everywhere.has(name.slice(name.indexOf('.') + 1))),
    )
    expect(rows.filter((row) => (row[2] ?? '') === '')).toEqual([])
  })
})

describe('appendix C of the description', () => {
  // Built, not connected, as in the walk over the routes: the first run and
  // the redemption of a link are registered only on an open instance.
  const database = Database.connect('postgres://unused')
  const authentication = createAuthentication({
    database,
    secret: 'x'.repeat(64),
    trustedOrigins: ['https://haustechnik.example.de'],
  })
  const controllers = ApiModule.create(database, noIdentities, { authentication }).controllers ?? []

  /**
   * An evaluation by person, a ranking or an export would need an address to
   * be asked at. The document says there is none by naming all there are.
   */
  it('names every address the server answers, and no other', () => {
    const rows = tableUnder('## Anhang C: Adressen des Servers')
    const answered = [...new Set(routesOf(controllers).map(firstSegmentOf))].sort()

    expect(answered.length).toBeGreaterThanOrEqual(15)
    expect(rows.map((row) => row[0] ?? '').sort()).toEqual(answered)
    expect(rows.filter((row) => (row[1] ?? '') === '')).toEqual([])
  })
})
