import { describe, expect, it } from 'vitest'

import type { DefectEntry } from './defect-register.js'
import { defectReportBlocks, defectReportCount, defectReportWhere } from './defect-report.js'

/** A defect of the list at a place, open and within its deadline unless said otherwise. */
function entry(
  id: string,
  place: Partial<DefectEntry['place']>,
  further: Partial<DefectEntry> = {},
): DefectEntry {
  return {
    id: id as DefectEntry['id'],
    description: id,
    defectClass: 'allgemein.dangerous',
    foundOn: '2026-10-10',
    dueOn: '2026-10-20',
    status: 'found',
    overdue: false,
    origin: { kind: 'hand' },
    workOrder: null,
    place: {
      propertyId: 'p-school',
      propertyName: 'Schulzentrum',
      buildingId: null,
      buildingName: null,
      roomId: null,
      roomLabel: null,
      asset: null,
      ...place,
    },
    ...further,
  }
}

const school = { propertyId: 'p-school', propertyName: 'Schulzentrum' }
const house = { ...school, buildingId: 'b-house', buildingName: 'Schulhaus' }
const gym = { ...school, buildingId: 'b-gym', buildingName: 'Sporthalle' }
const yard = { propertyId: 'p-yard', propertyName: 'Bauhof' }
const reads = { places: true, assets: true }

describe('the report of the defects (#345)', () => {
  it('holds a block for each building and one for a property alone, by their names, a property first, the list order within', () => {
    const blocks = defectReportBlocks(
      [
        entry('in the gym', gym),
        entry('in the house', house),
        entry('at the school', school),
        entry('at the yard', yard),
        entry('in the house again', house),
      ],
      reads,
    )

    expect(blocks.map(({ title, sub, defects }) => [title, sub, defects.map((d) => d.id)])).toEqual(
      [
        ['Bauhof', 'Liegenschaft', ['at the yard']],
        ['Schulzentrum', 'Liegenschaft', ['at the school']],
        ['Schulhaus', 'Schulzentrum', ['in the house', 'in the house again']],
        ['Sporthalle', 'Schulzentrum', ['in the gym']],
      ],
    )
  })

  it('names no place to whoever does not read the places', () => {
    const blocks = defectReportBlocks([entry('in the house', house)], {
      places: false,
      assets: true,
    })

    expect(blocks.map(({ title, sub }) => [title, sub])).toEqual([['Gebäude', 'Liegenschaft']])
  })

  it('says where a defect is under its block: the asset and its room, or the room alone', () => {
    const atAsset = entry('a', {
      ...house,
      roomId: 'r-boiler',
      roomLabel: 'E.14',
      asset: { id: 'as-1', number: 'AN-00057', name: 'Trinkwassererwärmer' },
    })

    expect(defectReportWhere(atAsset, reads)).toEqual({
      name: 'AN-00057 Trinkwassererwärmer',
      sub: 'E.14',
    })
    expect(defectReportWhere(atAsset, { places: true, assets: false })).toEqual({
      name: 'Anlage',
      sub: 'E.14',
    })
    expect(
      defectReportWhere(entry('r', { ...house, roomId: 'r-boiler', roomLabel: 'E.14' }), reads),
    ).toEqual({ name: 'E.14', sub: '' })
  })

  it('counts the defects, those past their deadline and those that put their asset out of service', () => {
    const late = entry('late', house, { overdue: true })
    const minor = entry('minor', house, { defectClass: 'allgemein.minor' })
    const unsafe = (defect: DefectEntry) => defect.defectClass === 'allgemein.dangerous'

    expect(defectReportCount([late, minor], unsafe)).toBe(
      '2 Mängel, davon 1 über der Frist; 1 setzt seine Anlage außer Betrieb.',
    )
    expect(defectReportCount([minor], unsafe)).toBe('1 Mangel.')
    expect(defectReportCount([late, late], unsafe)).toBe(
      '2 Mängel, davon 2 über der Frist; 2 setzen ihre Anlage außer Betrieb.',
    )
    expect(defectReportCount([], unsafe)).toBe('0 Mängel.')
  })
})
