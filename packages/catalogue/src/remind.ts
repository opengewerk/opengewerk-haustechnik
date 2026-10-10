import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { IsoDate } from '@opengewerk/haustechnik-domain'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'
import { dueReviews, type OpenIssue, planReminder, reminderTitle } from './reminder.js'

// The scheduled run of the reminder (#95), from the workflow "Katalog prüfen
// lassen": reads pakete/, asks which checks are due and opens the one issue
// or brings it up to date, through the GitHub CLI with the token of the run.
// TODAY and DRY_RUN are there to try it by hand:
//
//   TODAY=2027-09-20 DRY_RUN=1 pnpm --filter @opengewerk/haustechnik-catalogue run remind

const repository = new URL('../../../', import.meta.url)
const folder = fileURLToPath(new URL('pakete/', repository))
const manifest = JSON.parse(readFileSync(new URL('package.json', repository), 'utf8')) as {
  readonly version: string
}

const today = (process.env['TODAY'] ??
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())) as IsoDate
const dryRun = (process.env['DRY_RUN'] ?? '') !== ''

const loaded = loadCatalogue(readPackageFiles(folder), {
  applicationVersion: manifest.version,
  today,
})

if (loaded.bundle === null) {
  console.error('Die Pakete unter pakete/ ergeben keinen Katalog; das zeigt der Bau.')
  process.exit(1)
}

function gh(args: readonly string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

const due = dueReviews(loaded.bundle, today)
const open: readonly OpenIssue[] =
  due.length === 0
    ? []
    : (JSON.parse(
        gh([
          'issue',
          'list',
          '--state',
          'open',
          '--search',
          `"${reminderTitle}" in:title`,
          '--json',
          'number,title',
        ]),
      ) as OpenIssue[])
const action = planReminder(due, today, open)

if (action.kind === 'none') {
  console.log('Keine Prüfung gegen die Quelle ist fällig.')
  process.exit(0)
}

if (dryRun) {
  console.log(
    `${action.kind === 'create' ? 'Würde anlegen' : `Würde #${String(action.number)} fortschreiben`}: ${action.title}\n\n${action.body}`,
  )
  process.exit(0)
}

// The body goes as a file: it is UTF-8 with umlauts, and no shell quotes it.
const bodyFile = join(mkdtempSync(join(tmpdir(), 'katalog-')), 'body.md')

writeFileSync(bodyFile, action.body, 'utf8')

if (action.kind === 'create') {
  gh([
    'issue',
    'create',
    '--title',
    action.title,
    '--body-file',
    bodyFile,
    '--label',
    'Modul: Pakete',
  ])
  console.log(`Angelegt: ${action.title} (${String(due.length)} Einträge)`)
} else {
  gh(['issue', 'edit', String(action.number), '--body-file', bodyFile])
  console.log(`Fortgeschrieben: #${String(action.number)} (${String(due.length)} Einträge)`)
}
