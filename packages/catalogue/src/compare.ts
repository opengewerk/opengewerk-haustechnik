import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isVersionPath } from './paths.js'
import { changedVersions, removedDefectClasses } from './versions.js'

// Compares the versions of the packages with those of a base, `main` in a
// pull request: a version that is merged stays as it is, byte for byte
// (ADR 0005, point 16), and a class of defects that is merged stays in its
// package (#116). The CI hands over the commit it fetched as base:
//
//   git fetch --no-tags --depth=1 origin main
//   pnpm --filter @opengewerk/haustechnik-catalogue run compare FETCH_HEAD

const base = process.argv[2]

if (base === undefined || base.trim() === '') {
  console.error(
    'Aufruf: pnpm --filter @opengewerk/haustechnik-catalogue run compare <stand>, etwa origin/main.',
  )
  process.exit(2)
}

function git(args: readonly string[], cwd?: string): Buffer {
  return execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 })
}

const root = git(['rev-parse', '--show-toplevel']).toString('utf8').trim()
const prefix = 'pakete/'
const listed = git(['ls-tree', '-r', '-z', '--name-only', base, '--', 'pakete'], root)
  .toString('utf8')
  .split('\0')
  .filter((path) => path.startsWith(prefix))

const merged = new Map<string, Uint8Array>()

for (const path of listed) {
  const inFolder = path.slice(prefix.length)

  if (isVersionPath(inFolder) || inFolder.endsWith('/mangelklassen.json')) {
    merged.set(inFolder, git(['cat-file', 'blob', `${base}:${path}`], root))
  }
}

const headOf = (path: string): Uint8Array | null => {
  const full = join(root, 'pakete', path)

  return existsSync(full) ? readFileSync(full) : null
}
const problems = [...changedVersions(merged, headOf), ...removedDefectClasses(merged, headOf)]

if (problems.length > 0) {
  console.error(`Gemergte Fassungen der Pakete sind gegenüber ${base} verändert:`)

  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }

  process.exit(1)
}

console.log(
  `${String([...merged.keys()].filter((path) => isVersionPath(path)).length)} gemergte Fassungen sind dieselben wie in ${base}, und keine gemergte Mängelklasse fehlt.`,
)
