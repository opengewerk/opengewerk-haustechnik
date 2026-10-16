import { describe, expect, it } from 'vitest'

import type { AssetId } from './asset.js'
import type { DutyId } from './duty-record.js'
import type { EvidenceId } from './evidence.js'
import {
  type EvidenceRegisterDuty,
  evidenceRegisterBlocks,
  type EvidenceRegisterEntry,
  evidenceRegisterColumns,
  evidenceRegisterCount,
  evidenceRegisterLine,
  evidenceRegisterRows,
  evidenceRegisterWords,
} from './evidence-register.js'
import type { BuildingId, PropertyId, RoomId } from './location.js'

const property = 'p-1' as PropertyId
const school = 'b-1' as BuildingId

const heater = {
  id: 'a-heater' as AssetId,
  number: 'AN-00057',
  name: 'Trinkwassererwärmer',
  kind: 'probe.storage_tank',
  buildingId: school,
  roomId: 'r-1' as RoomId,
}

const extinguisher = {
  ...heater,
  id: 'a-ext' as AssetId,
  number: 'AN-00031',
  name: 'Feuerlöscher Flur EG',
  roomId: null,
}

/** A duty of the heater, met on 14.03.2026 by evidence signed here, due again a year later. */
function duty(other: Partial<EvidenceRegisterDuty> = {}): EvidenceRegisterDuty {
  return {
    id: 'd-1' as DutyId,
    title: 'Untersuchung auf Legionellen',
    intervalDays: null,
    intervalMonths: 12,
    shortened: null,
    intervalReason: 'Großanlage mit Duschen in der Sporthalle.',
    lastEvidence: {
      id: 'e-1' as EvidenceId,
      number: 'NW-2026-00088',
      performedOn: '2026-03-14',
      origin: 'protocol',
    },
    appointment: { dueOn: '2027-03-14', onTimeUntil: '2027-03-14' },
    asset: heater,
    assetId: heater.id,
    propertyId: property,
    buildingId: school,
    roomId: 'r-1' as RoomId,
    ...other,
  }
}

const entry = (
  other: Partial<EvidenceRegisterDuty> = {},
  more: Partial<Omit<EvidenceRegisterEntry, 'duty'>> = {},
): EvidenceRegisterEntry => ({
  duty: duty(other),
  source: 'TrinkwV § 31',
  lastResult: 'without_defects',
  intervalDocument: null,
  ...more,
})

describe('a line of the register of evidence (#338)', () => {
  it('names the duty with its reference, interval, reason, last evidence and next appointment', () => {
    expect(evidenceRegisterLine(entry())).toEqual({
      dutyId: 'd-1',
      duty: 'Untersuchung auf Legionellen',
      reference: 'TrinkwV § 31',
      document: null,
      interval: '12 Monate',
      reason: 'Großanlage mit Duschen in der Sporthalle.',
      last: '14.03.2026, Ohne Mangel',
      performedOn: '2026-03-14',
      result: 'Ohne Mangel',
      evidenceId: 'e-1',
      evidenceNumber: 'NW-2026-00088',
      mark: null,
      nextDue: '2027-03-14',
    })
  })

  it('never shows evidence from the old stock as evidence signed here', () => {
    const legacy = evidenceRegisterLine(
      entry({
        lastEvidence: {
          id: 'e-2' as EvidenceId,
          number: 'NW-2025-00410',
          performedOn: '2025-05-12',
          origin: 'legacy',
        },
      }),
    )

    expect(legacy.mark).toBe(evidenceRegisterWords.legacy)
    expect(legacy.mark).toBe('Altbestand, ohne Unterschrift')
  })

  it('says "Nie erfasst" of a duty without evidence, with no day and no result', () => {
    const never = evidenceRegisterLine(entry({ lastEvidence: null }, { lastResult: null }))

    expect([never.mark, never.last, never.evidenceId]).toEqual(['Nie erfasst', null, null])
  })

  it('names the document that bears the interval with its version and day, and the interval a regulation cut short', () => {
    const line = evidenceRegisterLine(
      entry(
        { shortened: { months: 6 } },
        {
          intervalDocument: {
            title: 'Bescheid des Gesundheitsamts',
            version: 2,
            datedOn: '2026-02-03',
          },
        },
      ),
    )

    expect([line.document, line.interval]).toEqual([
      'Bescheid des Gesundheitsamts, Fassung 2 vom 03.02.2026',
      '6 Monate',
    ])
  })
})

describe('the blocks of the register of evidence (#338)', () => {
  it('hold the duties of an asset together, the assets by their number and the places after them, the duties by name', () => {
    const blocks = evidenceRegisterBlocks([
      entry({ id: 'd-temp' as DutyId, title: 'Temperatur am Speicheraustritt' }),
      entry({
        id: 'd-room' as DutyId,
        title: 'Heizraum frei von Brandlasten',
        asset: null,
        assetId: null,
      }),
      entry({ id: 'd-ext' as DutyId, title: 'Prüfung von Feuerlöschern', asset: extinguisher }),
      entry(),
    ])

    expect(
      blocks.map((block) => [
        block.asset?.number ?? block.placeId,
        block.lines.map((line) => line.dutyId),
      ]),
    ).toEqual([
      ['AN-00031', ['d-ext']],
      ['AN-00057', ['d-temp', 'd-1']],
      ['r-1', ['d-room']],
    ])
  })
})

describe('the register of evidence as a table (#338)', () => {
  it('has a row per duty with its asset and place, a cell per column, and the days as days', () => {
    const rows = evidenceRegisterRows(
      evidenceRegisterBlocks([
        entry(),
        entry({
          id: 'd-old' as DutyId,
          title: 'Prüfung von Feuerlöschern',
          asset: extinguisher,
          assetId: extinguisher.id,
          intervalMonths: 24,
          intervalReason: null,
          lastEvidence: {
            id: 'e-2' as EvidenceId,
            number: 'NW-2025-00410',
            performedOn: '2025-05-12',
            origin: 'legacy',
          },
          appointment: null,
        }),
      ]),
      (block) => ({ asset: block.asset?.name ?? '', place: 'Schulhaus' }),
    )

    expect(rows).toEqual([
      [
        'Feuerlöscher Flur EG',
        'Schulhaus',
        'Prüfung von Feuerlöschern',
        'TrinkwV § 31',
        null,
        '24 Monate',
        null,
        { day: '2025-05-12' },
        'Ohne Mangel',
        'NW-2025-00410',
        'Altbestand, ohne Unterschrift',
        null,
      ],
      [
        'Trinkwassererwärmer',
        'Schulhaus',
        'Untersuchung auf Legionellen',
        'TrinkwV § 31',
        null,
        '12 Monate',
        'Großanlage mit Duschen in der Sporthalle.',
        { day: '2026-03-14' },
        'Ohne Mangel',
        'NW-2026-00088',
        null,
        { day: '2027-03-14' },
      ],
    ])
    expect(rows.every((row) => row.length === evidenceRegisterColumns.length)).toBe(true)
  })
})

describe('what the register of evidence would hold (#338)', () => {
  it('counts the duties, the assets they hang on and the duties never recorded', () => {
    expect(
      evidenceRegisterCount([
        entry(),
        entry({ id: 'd-2' as DutyId, lastEvidence: null }),
        entry({ id: 'd-3' as DutyId, asset: extinguisher, assetId: extinguisher.id }),
        entry({ id: 'd-4' as DutyId, asset: null, assetId: null, lastEvidence: null }),
      ]),
    ).toEqual({ duties: 4, assets: 2, never: 2 })
  })
})
