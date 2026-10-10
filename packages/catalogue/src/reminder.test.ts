import { fileURLToPath } from 'node:url'

import type { CatalogueBundle, IsoDate } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'
import { dueReviews, planReminder, reminderLead, reminderTitle } from './reminder.js'

// The reminder of the checks against the sources (#95): one issue for a
// package with an old entry, and the next run brings it up to date instead of
// opening a second; nothing at all without an entry that is due.

const probe = readPackageFiles(fileURLToPath(new URL('../test/pakete/', import.meta.url)))
const acceptancesFile = 'probe/abnahmen.json'
const today = '2026-10-10' as IsoDate

/** The probe package, with the check of its asset kind on another day. */
function probeChecked(assetKindOn: string): CatalogueBundle {
  const acceptances = JSON.parse(new TextDecoder().decode(probe.get(acceptancesFile))) as {
    entries: { file: string; checkedOn: string }[]
  }
  const files = new Map(probe)

  files.set(
    acceptancesFile,
    new TextEncoder().encode(
      JSON.stringify({
        ...acceptances,
        entries: acceptances.entries.map((entry) =>
          entry.file === 'anlagenarten/elevator.v1.json'
            ? { ...entry, checkedOn: assetKindOn }
            : entry,
        ),
      }),
    ),
  )

  const loaded = loadCatalogue(files, { applicationVersion: '0.0.0', today })

  if (loaded.bundle === null) {
    throw new Error(loaded.problems.join('\n'))
  }

  return loaded.bundle
}

describe('the reminder of the checks against the sources', () => {
  it('names an entry whose check lies a year back, or will within the lead, and no other', () => {
    expect(dueReviews(probeChecked('2025-09-01'), today)).toEqual([
      {
        packageName: 'probe',
        what: 'die Anlagenart anlagenarten/elevator.v1.json',
        checkedOn: '2025-09-01',
      },
    ])
    // Within the lead: a year back on the 5th of November, a reminder now.
    expect(dueReviews(probeChecked('2025-11-04'), today).map((entry) => entry.what)).toEqual([
      'die Anlagenart anlagenarten/elevator.v1.json',
    ])
    expect(reminderLead).toBe(30)
    // Beyond the lead: nothing yet.
    expect(dueReviews(probeChecked('2025-11-20'), today)).toEqual([])
  })

  it('opens one issue for a package with an old entry, and brings it up to date on the next run (#95)', () => {
    const due = dueReviews(probeChecked('2025-09-01'), today)
    const first = planReminder(due, today, [])

    expect(first).toMatchObject({ kind: 'create', title: reminderTitle })
    expect(first.kind === 'create' ? first.body : '').toContain(
      '- [ ] `probe`: die Anlagenart anlagenarten/elevator.v1.json, zuletzt geprüft am 2025-09-01',
    )
    // The next run finds the issue open: no second one.
    expect(
      planReminder(due, today, [
        { number: 12, title: 'Paket Elektro' },
        { number: 31, title: reminderTitle },
      ]),
    ).toMatchObject({ kind: 'update', number: 31, title: reminderTitle })
  })

  it('does nothing without an entry that is due', () => {
    expect(dueReviews(probeChecked('2026-10-03'), today)).toEqual([])
    expect(planReminder([], today, [{ number: 31, title: reminderTitle }])).toEqual({
      kind: 'none',
    })
  })
})
