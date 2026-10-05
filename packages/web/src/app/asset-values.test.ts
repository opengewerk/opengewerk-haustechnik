import { type AssetKind, assetValueProblems } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { kindFields, stepsOf, typedValues, unitOf, valuesOf } from './asset-values.js'

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

describe('the fields a kind brings to a form', () => {
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

describe('the values of an asset from a form', () => {
  const typed = {
    output: '70',
    outlet: '60,5',
    circulation: 'true',
    fuel: 'gas',
    volume: '750,5',
    stops: '12',
    note: '  steht hinter der Tür ',
    checked: '2026-03-01',
  }

  it('are what the kind asks for: steps of a unit, a figure, yes or no, a choice, a text, a day', () => {
    const values = valuesOf(heater, typed)

    expect(values).toEqual({
      output: 70,
      outlet: 605,
      circulation: true,
      fuel: 'gas',
      volume: 750.5,
      stops: 12,
      note: 'steht hinter der Tür',
      checked: '2026-03-01',
    })
    expect(assetValueProblems(heater, values)).toEqual({})
  })

  it('leave out an empty field and a field the kind does not have', () => {
    expect(valuesOf(heater, { output: ' ', circulation: '', floors: '3' })).toEqual({})
  })

  it('hand on what is no figure as it was typed, so that the model says the sentence', () => {
    const values = valuesOf(heater, { output: 'viel', outlet: '60,05', volume: 'x' })

    expect(values).toMatchObject({ output: 'viel', volume: 'x' })
    expect(assetValueProblems(heater, values)).toEqual({
      'values.output': 'Nennleistung ist eine ganze Zahl.',
      'values.outlet': 'Austrittstemperatur ist eine ganze Zahl.',
      'values.volume': 'Inhalt ist eine Zahl.',
    })
  })

  it('come back into the form as they were typed', () => {
    expect(typedValues(heater, valuesOf(heater, typed))).toEqual({
      ...typed,
      outlet: '60,5',
      note: 'steht hinter der Tür',
    })
    expect(typedValues(heater, { outlet: 600, circulation: false })).toMatchObject({
      outlet: '60,0',
      circulation: 'false',
      output: '',
      fuel: '',
    })
  })
})
