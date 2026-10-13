import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Nothing but the notifications writes a message (#126, section 3 of the
 * concept: "gespeist nur aus der Fristen-Engine und aus Statuswechseln").
 *
 * The transport and the push service are the foundation's, and nothing here
 * talks to a mail server or a push service past them. Two places are allowed
 * for each channel and no third: `notifications/` decides which message a
 * cause becomes, whom it goes to and what it says, and `mail/` and `push/`
 * send it. A route that wanted somebody told would have to import one of the
 * things these tests look for, and the test names it before a second writer,
 * a second text and a second answer to "who is told" have grown out of it.
 */

const source = fileURLToPath(new URL('..', import.meta.url))

function codeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return codeFiles(path)
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

const files = codeFiles(source).map((path) => ({
  path: relative(source, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}))

function touching(what: RegExp): string[] {
  return files.filter((file) => what.test(file.text)).map((file) => file.path)
}

function outside(paths: readonly string[], allowed: readonly string[]): string[] {
  return paths.filter((path) => !allowed.some((folder) => path.startsWith(folder)))
}

describe('sending mail', () => {
  it('goes through the transport of the foundation, and nothing here imports nodemailer', () => {
    // Read at all, or the test would pass by looking at nothing.
    expect(files.map((file) => file.path)).toContain('mail/worker.ts')
    expect(touching(/from\s+['"]nodemailer/)).toEqual([])
  })

  it('is asked for through the notifications, and nothing else writes a message', () => {
    const naming = touching(/\bmailOutbox\b/)

    expect(naming).toContain('notifications/notify.ts')
    expect(outside(naming, ['mail/', 'notifications/', 'database/schema/'])).toEqual([])
  })
})

describe('sending push', () => {
  it('is asked for through the notifications, and nothing else writes a message or reads a device', () => {
    const naming = touching(/\b(?:pushOutbox|pushSubscriptions|pushOptOuts|pushes)\b/)

    expect(naming).toContain('notifications/push.ts')
    expect(outside(naming, ['push/', 'notifications/', 'database/schema/'])).toEqual([])
  })

  it('is told a route only through the one door that asks first whether there is something to tell', () => {
    // A route that hands an activity out names `tellHandedOut` and nothing
    // of the writers behind it.
    const writers = touching(/\b(?:notifyPush|notify)\(/)

    expect(outside(writers, ['notifications/'])).toEqual([])
  })
})
