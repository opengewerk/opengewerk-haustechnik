import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { bundleFiles, probeFiles } from './bundle.js'
import { MissingFolderError, readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The build of the catalogue: reads the folder pakete/ at the root of the
// repository, checks every package and writes the bundle into dist/. A faulty
// package stops the build with the list of what is wrong, so that no
// catalogue reaches server or interface that the checks have not passed
// (ADR 0005, point 16). The probe package is built beside it for the tests of
// the server, under the entry `./testing`, and checked the same way.

const repository = new URL('../../../', import.meta.url)
const folder = fileURLToPath(new URL('pakete/', repository))
const probeFolder = fileURLToPath(new URL('../test/pakete/', import.meta.url))
const output = new URL('./', import.meta.url)

const manifest = JSON.parse(readFileSync(new URL('package.json', repository), 'utf8')) as {
  readonly version: string
}

// Today in Germany, which is what a date in a package means.
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())

let files: ReadonlyMap<string, Uint8Array>

try {
  files = readPackageFiles(folder)
} catch (error) {
  if (error instanceof MissingFolderError) {
    console.error(error.message)
    process.exit(1)
  }

  throw error
}

const result = loadCatalogue(files, { applicationVersion: manifest.version, today })

if (result.bundle === null) {
  console.error('Die Pakete unter pakete/ ergeben keinen Katalog:')

  for (const problem of result.problems) {
    console.error(`  - ${problem}`)
  }

  process.exit(1)
}

const probe = loadCatalogue(readPackageFiles(probeFolder), {
  applicationVersion: manifest.version,
  today,
})

if (probe.bundle === null) {
  console.error('Das Probepaket unter test/pakete/ ergibt keinen Katalog:')

  for (const problem of probe.problems) {
    console.error(`  - ${problem}`)
  }

  process.exit(1)
}

mkdirSync(output, { recursive: true })

for (const [name, content] of Object.entries({
  ...bundleFiles(result.bundle),
  ...probeFiles(probe.bundle),
})) {
  writeFileSync(new URL(name, output), content, 'utf8')
}

const packages = result.bundle.packages
const count = (of: (entry: (typeof packages)[number]) => readonly unknown[]) =>
  packages.reduce((sum, entry) => sum + of(entry).length, 0)
const unaccepted =
  packages
    .flatMap((entry) => [
      ...entry.assetKinds,
      ...entry.dutyKinds,
      ...entry.forms,
      ...entry.roundTemplates,
    ])
    .filter((entry) => entry.review.accepted === null).length +
  packages
    .flatMap((entry) => [...entry.rules, ...entry.defectClasses])
    .filter((entry) => entry.review.accepted === null).length

/** "1 Paket", "2 Pakete", "0 Pakete". */
const counted = (amount: number, one: string, more: string) =>
  `${String(amount)} ${amount === 1 ? one : more}`

console.log(
  [
    'Katalog gebaut: ',
    counted(packages.length, 'Paket', 'Pakete'),
    ', ',
    counted(
      count((entry) => entry.assetKinds),
      'Fassung einer Anlagenart',
      'Fassungen von Anlagenarten',
    ),
    ', ',
    counted(
      count((entry) => entry.dutyKinds),
      'Fassung einer Pflichtart',
      'Fassungen von Pflichtarten',
    ),
    ', ',
    counted(
      count((entry) => entry.rules),
      'Regel',
      'Regeln',
    ),
    ', ',
    counted(
      count((entry) => entry.defectClasses),
      'Mängelklasse',
      'Mängelklassen',
    ),
    '; ',
    counted(unaccepted, 'Eintrag', 'Einträge'),
    ` ohne Abnahme. Prüfsumme ${result.bundle.sha256}.`,
  ].join(''),
)
