import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The words of the Handwerkersoftware for what this application calls by
 * other names: a tenant there is a "Betrieb" and here a "Betreiber" (ADR 0001,
 * point 11), whoever leads one there the "Inhaber" and here the "Leitung", and
 * the entry for the work on site there the "Baustelle" and here "Vor Ort".
 *
 * Every sentence a screen shows comes either from this application or from the
 * foundation, which has none of these words (its package tests hold that). One
 * of them in the build is a sentence of the Handwerkersoftware that came along
 * with an import, or one written here in the wrong words.
 */
export const foreignWords =
  /\b(?:Betrieb|Betriebs|Betriebe|Betrieben|Inhaber|Inhabers|Inhaberin|Monteur|Monteurs|Monteure|Baustelle|Baustellen)\b/g

/** What a browser loads of the build: scripts, documents and manifests. */
const read = ['.js', '.mjs', '.html', '.webmanifest', '.css']

function filesUnder(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && read.some((ending) => entry.name.endsWith(ending)))
    .map((entry) => join(entry.parentPath, entry.name))
}

/**
 * Every place in a build where one of the words stands, with what is around
 * it, so that the line says which sentence it was.
 */
export function foreignWordsIn(dist) {
  const found = []

  for (const file of filesUnder(dist)) {
    const text = readFileSync(file, 'utf8')

    for (const match of text.matchAll(foreignWords)) {
      const start = Math.max(0, match.index - 40)
      const around = text.slice(start, match.index + match[0].length + 40).replace(/\s+/g, ' ')

      found.push({
        file: relative(dist, file).split(sep).join('/'),
        word: match[0],
        around,
      })
    }
  }

  return found
}

/** Run as the check of the CI, against the build of this package. */
function check() {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

  if (!existsSync(dist) || filesUnder(dist).length === 0) {
    // An empty build has none of the words either, and that proves nothing.
    console.error(`Im Bau unter ${dist} liegt nichts. Erst bauen, dann prüfen.`)
    process.exit(1)
  }

  const found = foreignWordsIn(dist)

  if (found.length > 0) {
    console.error('Im Bau stehen Wörter der Handwerkersoftware:')

    for (const place of found) {
      console.error(`  ${place.file}: ${place.word} in „${place.around}“`)
    }

    console.error('Hier heißt der Mandant "Betreiber", wer ihn führt, "Leitung", und der')
    console.error('Einstieg für die Arbeit vor Ort "Vor Ort" (ADR 0001, Punkt 11).')
    process.exit(1)
  }

  console.log('Im Bau steht kein Wort der Handwerkersoftware für einen Betreiber, seine Leitung')
  console.log('oder den Einstieg vor Ort.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check()
}
