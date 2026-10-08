import { isVersionPath } from './paths.js'

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

/**
 * What a pull request changed of a version that is merged already. A version
 * on the base is on the head byte for byte: a confirmed duty or a filled form
 * names it, and it has to say tomorrow what it said yesterday (ADR 0005,
 * points 7 and 16). Rules, manifests and reviews are no versions and change.
 *
 * @param base the files of the folder pakete/ on the base, by their path in the folder
 * @param head reads a file of the head by the same path, or nothing where there is none
 */
export function changedVersions(
  base: ReadonlyMap<string, Uint8Array>,
  head: (path: string) => Uint8Array | null,
): readonly string[] {
  const problems: string[] = []

  for (const [path, bytes] of base) {
    if (!isVersionPath(path)) {
      continue
    }

    const now = head(path)

    if (now === null) {
      problems.push(
        `${path}: Die Fassung ist auf main gemergt und fehlt hier. Eine gemergte Fassung bleibt stehen; was nicht mehr gilt, endet mit einer neuen Fassung.`,
      )
    } else if (!sameBytes(now, bytes)) {
      problems.push(
        `${path}: Die Fassung ist auf main gemergt und hier geändert. Eine gemergte Fassung wird nicht geändert, auch nicht für einen Tippfehler: die Berichtigung ist die nächste Fassung.`,
      )
    }
  }

  return problems.sort()
}

/** The keys a file of defect classes names, or none for a file that is no list of them. */
function classKeys(bytes: Uint8Array): readonly string[] {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { classes?: unknown }

    return Array.isArray(parsed.classes)
      ? parsed.classes.flatMap((each: unknown) =>
          typeof each === 'object' &&
          each !== null &&
          typeof (each as { key?: unknown }).key === 'string'
            ? [(each as { key: string }).key]
            : [],
        )
      : []
  } catch {
    return []
  }
}

/**
 * The classes of defects that are merged and gone (ADR 0005, addendum of #61,
 * point 4, and of #116): a defect names its class by its key, so a merged
 * class stays in its package, and its key is never given to another. Its
 * word and its source may change; the loader checks the file itself.
 */
export function removedDefectClasses(
  base: ReadonlyMap<string, Uint8Array>,
  head: (path: string) => Uint8Array | null,
): readonly string[] {
  const problems: string[] = []

  for (const [path, bytes] of base) {
    if (!path.endsWith('/mangelklassen.json')) {
      continue
    }

    const now = head(path)
    const kept = new Set(now === null ? [] : classKeys(now))

    for (const key of classKeys(bytes)) {
      if (!kept.has(key)) {
        problems.push(
          `${path}: Die Mängelklasse "${key}" ist auf main gemergt und fehlt hier. Eine gemergte Klasse bleibt stehen, weil Mängel sie nennen, und ihr Schlüssel wird nicht neu vergeben.`,
        )
      }
    }
  }

  return problems.sort()
}
