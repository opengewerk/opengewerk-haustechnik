import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  assetImportFields,
  levelOfFloorName,
  structureFields,
  type TableField,
  tableLimits,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

// The format of the tables an import reads is written down for whoever keeps
// a list, in `docs/import/Tabellen.md` (#100). A page written by hand says
// what was true on the day it was written. This holds it against the fields
// the import reads, so that a field that is added, renamed or called by one
// name more turns this red until the page says so too.
//
// It lives in the server package beside the test of the description of the
// processing, for the same reason: it reads a file of the repository.

const root = new URL('../../../', import.meta.url)
const location = fileURLToPath(new URL('docs/import/Tabellen.md', root))
const document = existsSync(location) ? readFileSync(location, 'utf8') : ''
const lines = document.split(/\r?\n/)

/** The cells of one line of a Markdown table. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

interface Row {
  readonly field: string
  readonly required: boolean
  readonly names: readonly string[]
}

/** The rows of the table of fields under a heading, as the page writes them. */
function fieldsUnder(heading: string): Row[] {
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`))
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '))
  const section = start < 0 ? [] : lines.slice(start + 1, end < 0 ? undefined : end)

  return (
    section
      .filter((line) => line.trim().startsWith('|'))
      .map(cells)
      // Without the names of the columns and the rule under them.
      .filter(([first = '']) => first !== 'Feld' && !/^-+$/.test(first))
      .map(([field = '', required = '', names = '']) => ({
        field,
        required: required === 'ja',
        names: names
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name !== ''),
      }))
  )
}

/** The fields of an import as the page would have to list them. */
function expected(fields: readonly TableField[]): Row[] {
  return fields.map((field) => ({
    field: field.label,
    required: field.required === true,
    names: [...(field.names ?? [])],
  }))
}

describe('the page about the format of the tables', () => {
  it('is there', () => {
    expect(document.length).toBeGreaterThan(1000)
  })

  it('lists every field of the import of places, with what makes it required and every name it is known by', () => {
    const rows = fieldsUnder('Bestand')

    // Field by field, so that what is missing is named.
    for (const field of expected(structureFields)) {
      expect(rows.find((row) => row.field === field.field) ?? { missing: field.field }).toEqual(
        field,
      )
    }

    // And no field the import does not read.
    expect(rows.map((row) => row.field)).toEqual(structureFields.map((field) => field.label))
  })

  it('lists every field of the import of assets, with what makes it required and every name it is known by', () => {
    const rows = fieldsUnder('Anlagen')

    for (const field of expected(assetImportFields)) {
      expect(rows.find((row) => row.field === field.field) ?? { missing: field.field }).toEqual(
        field,
      )
    }

    expect(rows.map((row) => row.field)).toEqual(assetImportFields.map((field) => field.label))
  })

  it('names the limits a file is read within', () => {
    const count = (figure: number) => figure.toLocaleString('de-DE')

    const said = document.replace(/\s+/g, ' ')

    for (const limit of [
      `${String(tableLimits.fileBytes / 1_000_000)} MB`,
      `${count(tableLimits.rows)} Zeilen`,
      `${count(tableLimits.columns)} Spalten`,
      `${count(tableLimits.cellLength)} Zeichen je Zelle`,
    ]) {
      expect(said).toContain(limit)
    }
  })

  it('names floors the import reads a level from, and two it reads none from', () => {
    // The names stand between the colon and "oder eine bloße Zahl", divided by commas.
    const sentence = /zugeordnet ist: (.+?) oder eine bloße Zahl\./.exec(
      document.replace(/\s+/g, ' '),
    )
    const named = (sentence?.[1] ?? '').split(', ')

    expect(named.length).toBeGreaterThanOrEqual(8)
    expect(named.filter((name) => levelOfFloorName(name) === null)).toEqual([])
    expect(['Dachgeschoss', 'Zwischengeschoss'].map(levelOfFloorName)).toEqual([null, null])
  })
})
