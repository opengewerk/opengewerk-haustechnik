import { describe, expect, it } from 'vitest'

import { assetFieldValueWords, characteristicValueWords } from './asset-value-words.js'
import { ruleValueWords } from './catalogue.js'

// What an asset holds beyond the fields every asset has, in words: the file of
// an asset and the change log write it the same way (#263). The column as a
// whole is held against a catalogue where the log is, in the office.

const day = (value: string) => `am ${value}`

describe('the value of a characteristic', () => {
  it('counts a number in the unit of the rule engine', () => {
    expect(
      characteristicValueWords(
        { key: 'output', label: 'Leistung', kind: 'number', unit: 'kilowatts' },
        15,
      ),
    ).toBe(ruleValueWords(15, 'kilowatts'))
  })

  it('says yes or no, and a choice by its label', () => {
    const flag = { key: 'leak_detection', label: 'Leckageerkennung', kind: 'flag' } as const
    const choice = {
      key: 'work_area',
      label: 'Arbeitsbereich',
      kind: 'choice',
      options: [{ value: 'workshop', label: 'Werkstatt' }],
    } as const

    expect(characteristicValueWords(flag, true)).toBe('Ja')
    expect(characteristicValueWords(flag, false)).toBe('Nein')
    expect(characteristicValueWords(choice, 'workshop')).toBe('Werkstatt')
    // A value the kind no longer offers stays as it is.
    expect(characteristicValueWords(choice, 'yard')).toBe('yard')
  })
})

describe('the value of a field', () => {
  it('writes a number with its unit, and as it is where the field names none', () => {
    expect(
      assetFieldValueWords(
        { key: 'weight', label: 'Gewicht', kind: 'number', unit: 'kg' },
        1500,
        day,
      ),
    ).toBe('1.500 kg')
    expect(
      assetFieldValueWords(
        { key: 'calibration_year', label: 'Eichjahr', kind: 'number' },
        2021,
        day,
      ),
    ).toBe('2021')
  })

  it('writes a day as whoever reads writes a day, and everything else as it is', () => {
    expect(
      assetFieldValueWords(
        { key: 'filled_on', label: 'Befüllt am', kind: 'date' },
        '2026-10-03',
        day,
      ),
    ).toBe('am 2026-10-03')
    expect(assetFieldValueWords({ key: 'colour', label: 'Farbe', kind: 'text' }, 'rot', day)).toBe(
      'rot',
    )
    expect(
      assetFieldValueWords({ key: 'hot', label: 'Warmwasser', kind: 'flag' }, false, day),
    ).toBe('Nein')
  })
})
