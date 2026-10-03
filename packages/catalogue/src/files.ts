import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export class MissingFolderError extends Error {}

/**
 * Every file under the folder pakete/, by its path relative to the folder,
 * written with slashes. Files whose name begins with a dot are left out, the
 * leftovers of an operating system that nobody committed.
 *
 * A missing folder is an error and not an empty catalogue: an image built
 * without it would otherwise carry no duty at all and say nothing about it.
 */
export function readPackageFiles(root: string): ReadonlyMap<string, Uint8Array> {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new MissingFolderError(`Der Ordner mit den Paketen fehlt: ${root}`)
  }

  const files = new Map<string, Uint8Array>()

  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue
    }

    const full = join(entry.parentPath, entry.name)
    const path = relative(root, full).split(sep).join('/')

    // The name of the file and every folder on the way to it.
    if (path.split('/').some((part) => part.startsWith('.'))) {
      continue
    }

    files.set(path, readFileSync(full))
  }

  return files
}
