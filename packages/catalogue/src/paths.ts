/**
 * Where a file in the folder pakete/ stands, and what it is because of that
 * (ADR 0005, point 1). Paths are relative to the folder and written with
 * slashes, on every system.
 *
 * The folders of a package are named in German, like the folder itself: they
 * are what somebody contributing to the catalogue reads, and what they hold
 * is named in English in the code.
 */

/** A package is named like its folder: small letters, digits and hyphens. */
export const packageNamePattern = /^[a-z][a-z0-9-]*$/

/**
 * A key: small letters, digits and underscores, no dot. Outside its package
 * an entry is called `<package>.<key>`, and a key without a dot is what keeps
 * that name unambiguous.
 */
export const keyPattern = /^[a-z][a-z0-9_]*$/

export const keyMaximum = 64

/** The highest number of a version, so that a number in a file name stays a number of versions (#80). */
export const versionMaximum = 999

/** The folders of the versioned entries, and what each holds. */
export const entryFolders = {
  anlagenarten: 'assetKinds',
  pflichten: 'dutyKinds',
  formulare: 'forms',
  vorlagen: 'roundTemplates',
} as const

export type EntryFolder = keyof typeof entryFolders

/** What a reader is told an entry is, "die Anlagenart probe.elevator". */
export const entryNoun: Readonly<Record<EntryFolder, string>> = {
  anlagenarten: 'die Anlagenart',
  pflichten: 'die Pflichtart',
  formulare: 'das Formular',
  vorlagen: 'die Vorlage',
}

export type PackagePath =
  | { readonly kind: 'readme' }
  | { readonly kind: 'manifest'; readonly packageName: string }
  | { readonly kind: 'acceptances'; readonly packageName: string }
  | { readonly kind: 'defectClasses'; readonly packageName: string }
  | {
      readonly kind: 'entry'
      readonly packageName: string
      readonly folder: EntryFolder
      readonly key: string
      readonly version: number
    }
  | { readonly kind: 'rules'; readonly packageName: string }
  | { readonly kind: 'unknown'; readonly reason: string }

const entryFile = /^([a-z][a-z0-9_]*)\.v([1-9][0-9]*)\.json$/
const rulesFile = /^[a-z0-9][a-z0-9_-]*\.json$/

function isEntryFolder(folder: string): folder is EntryFolder {
  return Object.hasOwn(entryFolders, folder)
}

/** What a path in the folder is, or why it is nothing a package may hold. */
export function classify(path: string): PackagePath {
  const parts = path.split('/')
  const [packageName, first, second] = parts

  if (parts.length === 1) {
    return path === 'README.md'
      ? { kind: 'readme' }
      : { kind: 'unknown', reason: 'Im Ordner pakete stehen nur Pakete und die README.md.' }
  }

  if (packageName === undefined || !packageNamePattern.test(packageName)) {
    return {
      kind: 'unknown',
      reason: 'Ein Paket heißt wie sein Ordner, mit kleinen Buchstaben, Ziffern und Bindestrichen.',
    }
  }

  if (parts.length === 2) {
    switch (first) {
      case 'manifest.json':
        return { kind: 'manifest', packageName }
      case 'abnahmen.json':
        return { kind: 'acceptances', packageName }
      case 'mangelklassen.json':
        return { kind: 'defectClasses', packageName }
      case 'README.md':
        return { kind: 'readme' }
      default:
        return { kind: 'unknown', reason: 'Die Datei gehört zu keinem Teil eines Pakets.' }
    }
  }

  if (parts.length === 3 && first !== undefined && second !== undefined) {
    if (isEntryFolder(first)) {
      const named = entryFile.exec(second)

      if (named?.[1] === undefined || named[2] === undefined) {
        return {
          kind: 'unknown',
          reason:
            'Eine Fassung heißt <schlüssel>.v<fassung>.json, der Schlüssel mit kleinen Buchstaben, Ziffern und Unterstrichen, etwa elevator.v1.json.',
        }
      }

      if (named[1].length > keyMaximum) {
        return {
          kind: 'unknown',
          reason: `Ein Schlüssel hat höchstens ${String(keyMaximum)} Zeichen.`,
        }
      }

      if (named[2].length > String(versionMaximum).length || Number(named[2]) > versionMaximum) {
        return {
          kind: 'unknown',
          reason: `Eine Fassung hat höchstens die Nummer ${String(versionMaximum)}.`,
        }
      }

      return {
        kind: 'entry',
        packageName,
        folder: first,
        key: named[1],
        version: Number(named[2]),
      }
    }

    if (first === 'regeln') {
      return rulesFile.test(second)
        ? { kind: 'rules', packageName }
        : {
            kind: 'unknown',
            reason:
              'Eine Datei mit Regeln heißt <name>.json, mit kleinen Buchstaben, Ziffern, Bindestrichen und Unterstrichen.',
          }
    }
  }

  return { kind: 'unknown', reason: 'Die Datei gehört zu keinem Teil eines Pakets.' }
}

/** Whether a path is one version of an entry, which stays as it is once merged (ADR 0005, point 7). */
export function isVersionPath(path: string): boolean {
  return classify(path).kind === 'entry'
}
