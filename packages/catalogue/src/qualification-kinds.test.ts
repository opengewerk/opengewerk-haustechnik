import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { catalogueOf } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// Every package as the repository holds it under pakete/, read the way the
// build reads it. A kind of qualification is entered only where the source of
// a duty kind names one (#547); where it names none, the level stays open and
// the README of the package says so, under "Arten der Qualifikation".
const folder = fileURLToPath(new URL('../../../pakete/', import.meta.url))
const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const { bundle, problems } = loadCatalogue(readPackageFiles(folder), {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
})

/** The levels a person holds; a body, an expert and a laboratory are firms and have no kind. */
const heldByAPerson = new Set(['instructed_person', 'skilled_person', 'competent_person'])

/** The section on the kinds of qualification in the README of a package, empty without one. */
function kindsSection(packageName: string): string {
  const readme = readFileSync(join(folder, packageName, 'README.md'), 'utf8')
  const start = readme.indexOf('\n## Arten der Qualifikation\n')

  if (start < 0) {
    return ''
  }

  const end = readme.indexOf('\n## ', start + 1)

  return readme.slice(start, end < 0 ? undefined : end)
}

describe('the level of a duty kind', () => {
  it('asks for a kind of qualification, or the README of its package names it as one without (#547)', () => {
    if (!bundle) {
      throw new Error(`Die Pakete laden nicht: ${problems.join(' ')}`)
    }

    const catalogue = catalogueOf(bundle)
    const unnamed = bundle.packages.flatMap((pack) => {
      const section = kindsSection(pack.name)

      return [...new Set(pack.dutyKinds.map((entry) => entry.key))]
        .filter((key) => {
          const newest = catalogue.newestDutyKind(key)

          return (
            newest !== null &&
            heldByAPerson.has(newest.definition.qualification.level) &&
            catalogue.qualificationFor(key) === null
          )
        })
        .filter((key) => !section.includes(`\`${key.slice(pack.name.length + 1)}\``))
    })

    expect(unnamed).toEqual([])
  })
})
