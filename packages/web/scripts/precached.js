import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The scripts of a build that its service worker does not hold (#374).
 *
 * The screens of the office are fetched when their address is opened. A page
 * of one version keeps its service worker until it takes the next version
 * over, and that worker answers from what it precached: so a screen of that
 * version opens also after the server has moved on to the next one, but only
 * if every script of the build is in the worker's list. This reads that list
 * out of the built worker, where `injectManifest` wrote it, and names every
 * script under `assets/` that is not on it.
 *
 * @param {string} dist The folder of the build.
 * @returns {string[]} The paths of the scripts the worker does not hold, under `dist`.
 */
export function unprecachedScripts(dist) {
  const worker = readFileSync(join(dist, 'service-worker.js'), 'utf8')
  const held = new Set([...worker.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]))

  return readdirSync(join(dist, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `assets/${name}`)
    .filter((path) => !held.has(path))
}
