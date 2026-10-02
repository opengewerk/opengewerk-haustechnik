// @ts-check
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

/**
 * The manifests of the packages directly under a folder.
 *
 * @param {string} folder relative to the root of the repository
 * @returns {Record<string, any>[]}
 */
function manifestsUnder(folder) {
  const url = new URL(`../${folder}/`, import.meta.url)

  if (!existsSync(url)) {
    console.error(`${fileURLToPath(url)} fehlt.`)
    console.error('Ist das Submodul ausgecheckt? git submodule update --init')
    process.exit(1)
  }

  return readdirSync(url, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${folder}/${entry.name}/package.json`)
    .filter((path) => existsSync(new URL(`../${path}`, import.meta.url)))
    .map((path) => manifest(path))
}

const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/**
 * Everything a package depends on, whichever section names it.
 *
 * @param {Record<string, any>} entry a manifest
 * @returns {Map<string, string>}
 */
function declared(entry) {
  /** @type {Map<string, string>} */
  const versions = new Map()

  for (const section of sections) {
    for (const [name, version] of Object.entries(entry[section] ?? {})) {
      versions.set(name, String(version))
    }
  }

  return versions
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

// And what a package of this application depends on together with a package
// of the foundation. Such a dependency is loaded once in a process or it is
// loaded twice: with two versions of drizzle-orm a table would be declared
// with the one and queried with the other. So a package here takes it in the
// version the foundation names. A dependency only this application has is its
// own business.
/** @type {Map<string, string>} */
const sharedWithTheFoundation = new Map()

for (const theirs of manifestsUnder('upstream/opengewerk/packages/platform')) {
  for (const [name, version] of declared(theirs)) {
    sharedWithTheFoundation.set(name, version)
  }
}

for (const ours of manifestsUnder('packages')) {
  for (const [name, version] of declared(ours)) {
    if (sharedWithTheFoundation.has(name)) {
      same(`${name} in ${ours.name}`, version, sharedWithTheFoundation.get(name))
    }
  }
}

if (differences.length > 0) {
  console.error('Werkzeuge oder gemeinsame Abhängigkeiten weichen von denen des Fundaments ab:')
  for (const line of differences) console.error(`  ${line}`)
  console.error('Die Anwendung übersetzt die Pakete des Fundaments mit ihren eigenen')
  console.error('Werkzeugen und lädt mit ihnen dieselben Bibliotheken, sie hält deshalb')
  console.error('dieselben Fassungen. Die Fassungen in der package.json angleichen und')
  console.error('pnpm install laufen lassen.')
  process.exit(1)
}

console.log('Werkzeuge und gemeinsame Abhängigkeiten sind dieselben wie im Fundament.')
