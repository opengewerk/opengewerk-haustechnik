import { blockFieldKinds, ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { type FormDefinition, formUnits, forms, type MeasurementField } from './forms.js'
import { meterUnits, meterUnitSymbol } from './meter.js'

/**
 * The form engine of the foundation as this application binds it: its units,
 * every kind of field, and the asset or room a field may be about.
 */

const round: FormDefinition = {
  key: 'boiler_room_round',
  version: 1,
  title: 'Rundgang Heizraum',
  sections: [
    {
      key: 'room',
      title: 'Heizraum',
      fields: [
        {
          kind: 'check_point',
          key: 'door_closed',
          label: 'Tür geschlossen',
          about: { kind: 'room', id: '0192f0c4-7b4e-7000-8000-000000000001' },
        },
        {
          kind: 'measurement',
          key: 'flow_temperature',
          label: 'Vorlauftemperatur',
          unit: 'degrees_celsius',
          decimals: 1,
          limit: { kind: 'at_least', rule: 'probe.hot_water_minimum' },
        },
        {
          kind: 'meter_reading',
          key: 'heat',
          label: 'Wärmemengenzähler',
          unit: 'megawatt_hours',
          decimals: 3,
          about: { kind: 'asset', id: '0192f0c4-7b4e-7000-8000-000000000002' },
        },
      ],
    },
    {
      key: 'end',
      title: 'Abschluss',
      fields: [{ kind: 'signature', key: 'signature', label: 'Unterschrift', seals: true }],
    },
  ],
}

describe('the forms of this application', () => {
  it('know every kind of field the foundation knows, and a field about an asset or a room', () => {
    expect(forms.definitionProblems(round)).toEqual([])

    for (const kind of blockFieldKinds) {
      expect(
        forms.definitionProblems({
          ...round,
          sections: [
            { key: 'one', title: 'Eins', fields: [{ kind, key: 'f', label: 'F' } as never] },
          ],
        }),
      ).not.toContain(
        `boiler_room_round: das Feld f hat die Art ${kind}, die diese Anwendung nicht zeigt.`,
      )
    }
  })

  it('point at no other kind of record', () => {
    const vehicle = {
      ...round,
      sections: [
        {
          key: 'room',
          title: 'Heizraum',
          fields: [
            {
              kind: 'check_point',
              key: 'door_closed',
              label: 'Tür geschlossen',
              about: { kind: 'vehicle', id: 'v-1' },
            },
          ],
        },
      ],
    } as unknown as FormDefinition

    expect(forms.definitionProblems(vehicle)).toEqual([
      'boiler_room_round: door_closed zeigt auf eine Art von Datensatz, die es nicht gibt.',
    ])
  })

  it('read a meter in every unit a meter counts in, written the same way', () => {
    for (const unit of meterUnits) {
      expect(formUnits[unit].sign).toBe(meterUnitSymbol[unit])
      expect(forms.formatMeasured(1_234_500, unit, 1)).toBe(`1.234,5 ${meterUnitSymbol[unit]}`)
    }
  })

  it('judge a temperature against a rule in tenths of a degree', () => {
    const temperature = round.sections[0]?.fields[1] as MeasurementField
    const rules = ruleSet([
      {
        key: 'probe.hot_water_minimum',
        validFrom: '2015-06-01',
        validUntil: null,
        unit: 'decidegrees_celsius',
        value: 550,
        source: 'Probe',
      },
    ])

    expect(forms.limitVerdict(temperature, 54_900, { rules, on: '2026-10-04' })).toEqual({
      within: false,
      limitMilli: 55_000,
      text: 'Außerhalb des Grenzwerts, mindestens 55,0 °C.',
      source: 'Probe',
    })
  })
})
