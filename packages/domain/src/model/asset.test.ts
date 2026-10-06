import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  assetLimits,
  assetProblems,
  assetValueProblems,
  distinctFromProblem,
  lifecycleEntryProblems,
  type LifecycleState,
  lifecycleStateOn,
  lifecycleStates,
  meterProblems,
  supplyPlaceProblem,
} from './asset.js'
import type { AssetKind } from './catalogue.js'

const asset = {
  kind: 'probe.elevator',
  name: 'Aufzug Haus A',
  mark: 'AZ-01',
  manufacturer: 'Beispielwerk',
  model: 'Lift 630',
  serialNumber: 'SN 4711',
  yearBuilt: 2012,
  commissionedOn: '2012-05-02',
  warrantyEndsOn: '2014-05-01',
  meterNumber: null,
  meterUnit: null,
}

const elevator: AssetKind = {
  label: 'Aufzugsanlage',
  costGroup: '461',
  characteristics: [
    { key: 'rated_output', label: 'Nennleistung', kind: 'number', unit: 'kilowatts' },
    { key: 'firefighters_lift', label: 'Feuerwehraufzug', kind: 'flag' },
    {
      key: 'drive',
      label: 'Antrieb',
      kind: 'choice',
      options: [
        { value: 'rope', label: 'Seil' },
        { value: 'hydraulic', label: 'Hydraulik' },
      ],
    },
  ],
  fields: [
    { key: 'stops', label: 'Haltestellen', kind: 'number' },
    { key: 'note', label: 'Hinweis', kind: 'text' },
    { key: 'last_modernised', label: 'Zuletzt modernisiert', kind: 'date' },
  ],
  expectedDocuments: [],
  meter: null,
}

const electricityMeter: AssetKind = {
  ...elevator,
  label: 'Stromzähler',
  characteristics: [],
  fields: [],
  meter: { medium: 'electricity', units: ['kilowatt_hours', 'megawatt_hours'] },
}

/** A day between 2000 and 2040, as ISO 8601. */
const day = fc
  .integer({ min: 0, max: 14_975 })
  .map((offset) => new Date(Date.UTC(2000, 0, 1 + offset)).toISOString().slice(0, 10))

const state = fc.constantFrom(...lifecycleStates)

/** Entries of one asset, each beginning on a day of its own. */
const entries = fc
  .uniqueArray(fc.record({ validFrom: day, state }), {
    selector: (entry) => entry.validFrom,
    maxLength: 12,
  })
  .map((list) => list as readonly { readonly validFrom: string; readonly state: LifecycleState }[])

describe('the life cycle of an asset', () => {
  it('has the state of the latest entry up to the day, and none before the first', () => {
    const list = [
      { validFrom: '2012-05-02', state: 'in_service' as const },
      { validFrom: '2010-01-01', state: 'planned' as const },
      { validFrom: '2030-07-01', state: 'decommissioned' as const },
    ]

    expect(lifecycleStateOn(list, '2009-12-31')).toBeNull()
    expect(lifecycleStateOn(list, '2010-01-01')).toBe('planned')
    expect(lifecycleStateOn(list, '2012-05-01')).toBe('planned')
    expect(lifecycleStateOn(list, '2012-05-02')).toBe('in_service')
    expect(lifecycleStateOn(list, '2030-07-01')).toBe('decommissioned')
    expect(lifecycleStateOn([], '2026-10-03')).toBeNull()
  })

  it('names exactly one state on every day, the one of the latest entry up to it', () => {
    fc.assert(
      fc.property(entries, day, (list, on) => {
        const upTo = list.filter((entry) => entry.validFrom <= on)
        const latest = upTo.reduce<(typeof list)[number] | null>(
          (found, entry) => (found === null || entry.validFrom > found.validFrom ? entry : found),
          null,
        )

        expect(lifecycleStateOn(list, on)).toBe(latest?.state ?? null)
      }),
    )
  })

  it('does not depend on the order the entries come in', () => {
    fc.assert(
      fc.property(
        entries.chain((list) =>
          fc.tuple(fc.constant(list), fc.shuffledSubarray([...list], { minLength: list.length })),
        ),
        day,
        ([list, shuffled], on) => {
          expect(lifecycleStateOn(shuffled, on)).toBe(lifecycleStateOn(list, on))
        },
      ),
    )
  })

  it('has a state on every day from its first entry on, and none on any day before', () => {
    fc.assert(
      fc.property(
        entries.filter((list) => list.length > 0),
        day,
        (list, on) => {
          const first = list.map((entry) => entry.validFrom).sort()[0] as string

          expect(lifecycleStateOn(list, on) === null).toBe(on < first)
        },
      ),
    )
  })

  it('refuses two entries beginning on the same day instead of guessing between them', () => {
    expect(() =>
      lifecycleStateOn(
        [
          { validFrom: '2012-05-02', state: 'in_service' },
          { validFrom: '2012-05-02', state: 'planned' },
        ],
        '2026-10-03',
      ),
    ).toThrow(/Zwei Einträge im Lebenszyklus beginnen am 2012-05-02/)
  })

  it('takes an entry with one of the states and a day', () => {
    expect(lifecycleEntryProblems({ state: 'out_of_service', validFrom: '2026-10-03' })).toEqual({})
    expect(lifecycleEntryProblems({ state: 'broken', validFrom: '2026-02-30' })).toEqual({
      state:
        'Der Zustand ist einer von Geplant, In Betrieb, Außer Betrieb, Stillgelegt, Zurückgebaut.',
      validFrom: 'Der Tag, ab dem der Zustand gilt, fehlt oder ist keiner.',
    })
  })
})

describe('an asset', () => {
  it('is fine with a kind, a name and what is known about it', () => {
    expect(assetProblems(asset)).toEqual({})
    expect(assetProblems({ kind: 'probe.elevator', name: 'Aufzug' })).toEqual({})
  })

  it('names every field that is missing or out of shape', () => {
    expect(
      assetProblems({
        kind: ' ',
        name: null,
        mark: 'x'.repeat(assetLimits.mark + 1),
        yearBuilt: 1799,
        commissionedOn: '2012-13-01',
        warrantyEndsOn: 'bald',
        meterUnit: 'litres',
      }),
    ).toEqual({
      kind: 'Die Anlagenart fehlt.',
      name: 'Die Bezeichnung fehlt.',
      mark: `Das Kennzeichen hat höchstens ${String(assetLimits.mark)} Zeichen.`,
      yearBuilt: 'Das Baujahr ist eine ganze Zahl von 1800 bis 2100.',
      commissionedOn: 'Die Inbetriebnahme ist ein Tag, geschrieben 2026-10-03.',
      warrantyEndsOn: 'Das Ende der Gewährleistung ist ein Tag, geschrieben 2026-10-03.',
      meterUnit: 'Die Einheit ist keine von kWh, MWh, m³.',
    })
  })

  it('carries values only for what its kind has, each of the right sort', () => {
    expect(
      assetValueProblems(elevator, {
        rated_output: 13,
        firefighters_lift: true,
        drive: 'rope',
        stops: 6,
        note: 'Schlüssel beim Pförtner',
        last_modernised: '2019-03-01',
      }),
    ).toEqual({})
    expect(assetValueProblems(elevator, {})).toEqual({})
    expect(
      assetValueProblems(elevator, {
        rated_output: 13.5,
        firefighters_lift: 'ja',
        drive: 'paternoster',
        stops: '6',
        note: ' ',
        last_modernised: '2019-02-30',
        colour: 'rot',
      }),
    ).toEqual({
      'values.rated_output': 'Nennleistung ist eine ganze Zahl.',
      'values.firefighters_lift': 'Feuerwehraufzug ist ja oder nein.',
      'values.drive': 'Antrieb ist eine von Seil, Hydraulik.',
      'values.stops': 'Haltestellen ist eine Zahl.',
      'values.note': 'Hinweis ist ein Text, der nicht leer ist.',
      'values.last_modernised': 'Zuletzt modernisiert ist ein Tag, geschrieben 2026-10-03.',
      'values.colour': 'Das Feld colour hat die Anlagenart Aufzugsanlage nicht.',
    })
    expect(assetValueProblems(elevator, ['rated_output'])).toEqual({
      values: 'Die Angaben zur Anlagenart stehen als Feld und Wert.',
    })
  })

  it('has a meter number and a unit of its kind when it is a measuring point, and neither otherwise', () => {
    expect(
      meterProblems(electricityMeter, {
        meterNumber: '1ESY1160123456',
        meterUnit: 'kilowatt_hours',
      }),
    ).toEqual({})
    expect(
      meterProblems(electricityMeter, { meterNumber: ' ', meterUnit: 'cubic_metres' }),
    ).toEqual({
      meterNumber: 'Die Zählernummer fehlt.',
      meterUnit: 'Ein Zähler dieser Art zählt in kWh oder MWh.',
    })
    expect(meterProblems(elevator, { meterNumber: '4711', meterUnit: 'kilowatt_hours' })).toEqual({
      meterNumber: 'Eine Zählernummer hat nur eine Messstelle.',
      meterUnit: 'Eine Einheit hat nur eine Messstelle.',
    })
    expect(meterProblems(elevator, { meterNumber: null, meterUnit: null })).toEqual({})
  })
})

describe('what an asset supplies', () => {
  it('is a building or a room, never both and never neither', () => {
    expect(supplyPlaceProblem({ buildingId: 'b', roomId: null })).toBeNull()
    expect(supplyPlaceProblem({ roomId: 'r' })).toBeNull()
    expect(supplyPlaceProblem({ buildingId: 'b', roomId: 'r' })).toBe(
      'Ein Eintrag versorgt genau ein Gebäude oder einen Raum.',
    )
    expect(supplyPlaceProblem({})).toBe('Ein Eintrag versorgt genau ein Gebäude oder einen Raum.')
  })
})

describe('what an asset was found to be distinct from', () => {
  const one = '0199c0de-0000-7000-8000-00000000000a'
  const other = '0199c0de-0000-7000-8000-00000000000b'

  it('is a list of assets, each once, and may be empty', () => {
    expect(distinctFromProblem([])).toBeNull()
    expect(distinctFromProblem([one, other])).toBeNull()
  })

  it('is nothing else: no text, no number of an asset, no asset twice, and no list longer than a form shows', () => {
    const sentence = 'Wovon eine Anlage verschieden ist, steht als Liste von höchstens 20 Anlagen.'

    expect(distinctFromProblem(one)).toBe(sentence)
    expect(distinctFromProblem(null)).toBe(sentence)
    expect(distinctFromProblem(['AN-00057'])).toBe(sentence)
    expect(distinctFromProblem([one, one])).toBe(sentence)
    expect(
      distinctFromProblem(
        Array.from(
          { length: assetLimits.distinctFrom + 1 },
          (_, index) => `0199c0de-0000-7000-8000-${String(index).padStart(12, '0')}`,
        ),
      ),
    ).toBe(sentence)
  })
})
