import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  catalogueOf,
  hasHolidays,
  holidayClosures,
  holidaysBetween,
  type IsoDate,
  passesBetween,
} from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { readPackageFiles } from './files.js'
import { loadCatalogue } from './load.js'

// The package of the statutory public holidays as the repository holds it
// under pakete/, read the way the build reads it (opengewerk-haustechnik#200,
// section 2.9 of the concept).
const shipped = readPackageFiles(fileURLToPath(new URL('../../../pakete/', import.meta.url)))

const application = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { readonly version: string }
const options = {
  applicationVersion: application.version,
  today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
}

function catalogue() {
  const { bundle, problems } = loadCatalogue(shipped, options)

  expect(problems).toEqual([])

  if (!bundle) {
    throw new Error('Die Pakete lassen sich nicht bauen.')
  }

  return catalogueOf(bundle)
}

describe('the package of the statutory public holidays', () => {
  it('holds the twelve holidays of Baden-Württemberg on their days, from § 1 FTG and the treaty of unification', () => {
    const holidays = holidaysBetween(
      catalogue(),
      'DE-BW',
      '2026-01-01' as IsoDate,
      '2026-12-31' as IsoDate,
    )

    expect(holidays.map(({ day, name }) => `${day} ${name}`)).toEqual([
      '2026-01-01 Neujahr',
      '2026-01-06 Erscheinungsfest',
      '2026-04-03 Karfreitag',
      '2026-04-06 Ostermontag',
      '2026-05-01 1. Mai',
      '2026-05-14 Christi Himmelfahrt',
      '2026-05-25 Pfingstmontag',
      '2026-06-04 Fronleichnam',
      '2026-10-03 Tag der Deutschen Einheit',
      '2026-11-01 Allerheiligen',
      '2026-12-25 Erster Weihnachtstag',
      '2026-12-26 Zweiter Weihnachtstag',
    ])
    expect(holidays.every(({ source }) => /FTG|Einigungsvertrag/.test(source))).toBe(true)
  })

  it('holds no state it says nothing about', () => {
    const shippedCatalogue = catalogue()

    expect(hasHolidays(shippedCatalogue, 'DE-BW')).toBe(true)
    expect(hasHolidays(shippedCatalogue, 'DE-BY')).toBe(false)
    expect(hasHolidays(shippedCatalogue, 'DE-NI')).toBe(false)
  })

  it('leaves Easter Monday and the 3rd of October out of a daily plan in Baden-Württemberg that asks it to, and only then', () => {
    const plan = {
      rhythm: 'daily' as const,
      weekdays: [1, 2, 3, 4, 5, 6, 7] as const,
      dayOfMonth: null,
      month: null,
      startsOn: '2026-01-01' as IsoDate,
      endsOn: null,
    }
    const from = '2026-04-01' as IsoDate
    const until = '2026-10-31' as IsoDate
    const holidays = holidayClosures(holidaysBetween(catalogue(), 'DE-BW', from, until))
    const leaves = passesBetween(plan, from, until, holidays)
    const counts = passesBetween(plan, from, until)

    for (const day of ['2026-04-06', '2026-10-03']) {
      expect(leaves).not.toContain(day)
      expect(counts).toContain(day)
    }

    expect(counts.length - leaves.length).toBe(7)
  })
})
