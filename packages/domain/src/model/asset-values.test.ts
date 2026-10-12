import { describe, expect, it } from 'vitest'

import { kindFields, stepPlacesOf, stepsOf, unitOf } from './asset-values.js'
import type { AssetKind } from './catalogue.js'

const heater: AssetKind = {
  label: 'Trinkwassererwärmung',
  costGroup: '412',
  characteristics: [
    { key: 'output', label: 'Nennleistung', kind: 'number', unit: 'kilowatts' },
    { key: 'outlet', label: 'Austrittstemperatur', kind: 'number', unit: 'decidegrees_celsius' },
    { key: 'circulation', label: 'Zirkulation', kind: 'flag' },
    {
      key: 'fuel',
      label: 'Energieträger',
      kind: 'choice',
      options: [
        { value: 'gas', label: 'Gas' },
        { value: 'power', label: 'Strom' },
      ],
    },
  ],
  fields: [
    { key: 'volume', label: 'Inhalt', kind: 'number', unit: 'l' },
    { key: 'stops', label: 'Zapfstellen', kind: 'number' },
    { key: 'note', label: 'Bemerkung', kind: 'text' },
    { key: 'checked', label: 'Zuletzt entkalkt', kind: 'date' },
  ],
  expectedDocuments: [],
  meter: null,
}

describe('the fields a kind brings', () => {
  it('are its characteristics, then its own fields, each figure with its unit', () => {
    expect(kindFields(heater).map((entry) => [entry.field.label, unitOf(entry)])).toEqual([
      ['Nennleistung', 'kW'],
      ['Austrittstemperatur', '°C'],
      ['Zirkulation', undefined],
      ['Energieträger', undefined],
      ['Inhalt', 'l'],
      ['Zapfstellen', undefined],
      ['Bemerkung', undefined],
      ['Zuletzt entkalkt', undefined],
    ])
  })

  it('count a characteristic in the places of its unit, and a field of their own as it is written', () => {
    expect(kindFields(heater).map((entry) => [entry.field.key, stepPlacesOf(entry)])).toEqual([
      ['output', 0],
      ['outlet', 1],
      ['circulation', null],
      ['fuel', null],
      ['volume', null],
      ['stops', null],
      ['note', null],
      ['checked', null],
    ])
  })
})

describe('a figure as it is typed', () => {
  it('is counted in the steps of its unit, on its digits', () => {
    expect(stepsOf('60', 1)).toBe(600)
    expect(stepsOf('60,5', 1)).toBe(605)
    expect(stepsOf('60.5', 1)).toBe(605)
    expect(stepsOf('0,07', 2)).toBe(7)
    expect(stepsOf('-2,5', 1)).toBe(-25)
    expect(stepsOf('70', 0)).toBe(70)
    expect(stepsOf('70,0', 0)).toBe(70)
  })

  it('is no whole number of steps with more places than its unit has', () => {
    expect(Number.isInteger(stepsOf('60,05', 1))).toBe(false)
    expect(Number.isInteger(stepsOf('70,5', 0))).toBe(false)
  })
})
