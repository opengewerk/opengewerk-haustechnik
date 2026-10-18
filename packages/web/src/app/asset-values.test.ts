import { type AssetKind, assetValueProblems, catalogueOf } from '@opengewerk/haustechnik-domain'
import { describe, expect, it } from 'vitest'

import { kindChoices, typedValues, valuesOf } from './asset-values.js'
import { testCatalogue } from './test-catalogue.js'

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

describe('the kinds an asset is taken in with', () => {
  it('are those of the packages, and the kinds the operator added last, under "Eigene" (#62)', () => {
    const own = {
      key: 'eigen.hebeanlage',
      version: 1,
      validFrom: '2000-01-01',
      definition: { ...heater, label: 'Hebeanlage' },
      review: { checkedOn: '2026-10-18', accepted: null },
    }
    const catalogue = catalogueOf({ ...testCatalogue, own: { assetKinds: [own], fields: {} } })

    expect(kindChoices(catalogue).map((choice) => choice.label)).toEqual([
      'Probepaket: Aufzugsanlage',
      'Probepaket: Druckerhöhungsanlage',
      'Abgenommenes Paket: Druckerhöhungsanlage',
      'Eigene: Hebeanlage',
    ])
    expect(kindChoices(catalogue).at(-1)?.value).toBe('eigen.hebeanlage')
  })
})
