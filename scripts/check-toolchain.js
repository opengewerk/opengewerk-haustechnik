// @ts-check
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The application compiles the packages of the foundation with its own tools
// (ADR 0010 in the repository opengewerk, point 8). It therefore keeps the
// versions the foundation is developed and checked with: a newer compiler
// here would accept or reject code that the repository it comes from has
// never seen compiled that way.
//
// What can be shared by reference is: the compiler options, the lint rules,
// the test base and the formatting are read from the submodule. Versions in a
// manifest cannot be, so this script compares them, and it does so when the
// submodule moves: a pull request that raises the foundation fails here until
// the tools have followed.

/** @param {string} path relative to the root of the repository */
function manifest(path) {
  const url = new URL(`../${path}`, import.meta.url)

  try {
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      console.error(`${fileURLToPath(url)} fehlt.`)
      console.error('Ist das Submodul ausgecheckt? git submodule update --init')
      process.exit(1)
    }
    throw error
  }
}

const here = manifest('package.json')
const foundation = manifest('upstream/opengewerk/package.json')

/** @type {string[]} */
const differences = []

/**
 * @param {string} what
 * @param {unknown} ours
 * @param {unknown} theirs
 */
function same(what, ours, theirs) {
  if (ours !== theirs) {
    differences.push(`${what}: hier ${ours ?? 'nicht eingetragen'}, im Fundament ${theirs}`)
  }
}

same('packageManager', here.packageManager, foundation.packageManager)
same('engines.node', here.engines?.node, foundation.engines?.node)

// Every tool the foundation names at its root, in the version it names. More
// tools than those are this application's own business.
for (const [name, version] of Object.entries(foundation.devDependencies ?? {})) {
  same(name, here.devDependencies?.[name], version)
}

if (differences.length > 0) {
  console.error('Die Werkzeuge weichen von denen des Fundaments ab:')
  for (const line of differences) console.error(`  ${line}`)
  console.error('Die Anwendung übersetzt die Pakete des Fundaments mit ihren eigenen')
  console.error('Werkzeugen und hält deshalb dieselben Fassungen. Die Fassungen in')
  console.error('package.json angleichen und pnpm install laufen lassen.')
  process.exit(1)
}

console.log('Die Werkzeuge sind dieselben wie im Fundament.')
