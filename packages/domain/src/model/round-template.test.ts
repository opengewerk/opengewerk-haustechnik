import { ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { DutyId } from './duty-record.js'
import { forms, type MeasurementField } from './forms.js'
import {
  pointFulfilling,
  pointOutcome,
  type RoundTemplateId,
  type TemplateDefinition,
  type TemplateField,
  templateFormKey,
  templateOfFormKey,
  templatePointers,
  templateProblems,
  type TemplateRecords,
  withTemplates,
} from './round-template.js'

const template = '0192f0c4-7b4e-7000-8000-000000000001' as RoundTemplateId
const heater = '0192f0c4-7b4e-7000-8000-000000000a01'
const pump = '0192f0c4-7b4e-7000-8000-000000000a02'
const boilerRoom = '0192f0c4-7b4e-7000-8000-000000000b01'
const temperatureDuty = '0192f0c4-7b4e-7000-8000-000000000d01' as DutyId
const doorDuty = '0192f0c4-7b4e-7000-8000-000000000d02' as DutyId
const reportOnly = '0192f0c4-7b4e-7000-8000-000000000d03' as DutyId

const rules = ruleSet([
  {
    key: 'probe.hot_water_minimum',
    validFrom: '2015-06-01',
    validUntil: null,
    unit: 'decidegrees_celsius',
    value: 600,
    source: 'DVGW W 551',
  },
])

const context = { rules, on: '2026-10-09' as const }

/** What the person sees: the heater and the boiler room, and the duties there. */
const records: TemplateRecords = {
  record: (kind, id) => (kind === 'asset' ? id === heater : id === boilerRoom),
  duty: (id) =>
    id === temperatureDuty
      ? { assetId: heater, roomId: null, takesRoundPoint: true }
      : id === doorDuty
        ? { assetId: null, roomId: boilerRoom, takesRoundPoint: true }
        : id === reportOnly
          ? { assetId: heater, roomId: null, takesRoundPoint: false }
          : null,
  ruleUnits: (key) =>
    key === 'probe.hot_water_minimum'
      ? ['decidegrees_celsius']
      : key === 'probe.inspection_interval'
        ? ['months']
        : null,
}

const temperature: TemplateField = {
  kind: 'measurement',
  key: 'p1',
  label: 'Temperatur am Speicheraustritt',
  unit: 'degrees_celsius',
  decimals: 1,
  required: true,
  limit: { kind: 'stated', bound: 'at_least', milli: 60_000, source: 'DVGW W 551, 6.1' },
  about: { kind: 'asset', id: heater },
  fulfils: temperatureDuty,
}

const door: TemplateField = {
  kind: 'check_point',
  key: 'p2',
  label: 'Tür schließt selbsttätig',
  about: { kind: 'room', id: boilerRoom },
  fulfils: doorDuty,
}

const remark: TemplateField = {
  kind: 'text',
  key: 'p3',
  label: 'Sonst aufgefallen',
  multiline: true,
}

/** A template with the three points, with a point replaced or added where a test says. */
function withPoints(...fields: TemplateField[]): TemplateDefinition {
  return {
    title: 'Technikzentrale Schulhaus',
    sections: [{ key: 'k1', title: 'Heizraum E.14', fields }],
  }
}

const sound = withPoints(temperature, door, remark)

describe('the key of a template', () => {
  it('names the template, and never a form of a package, which has a dot', () => {
    expect(templateOfFormKey(templateFormKey(template))).toBe(template)
    expect(templateOfFormKey('probe.water_meter_reading')).toBeNull()
    expect(templateOfFormKey('template-nothing')).toBeNull()
  })
})

describe('the forms of the catalogue with the templates beside it', () => {
  const versions = [1, 2].map((formVersion) => ({
    templateId: template,
    formVersion,
    definition: { ...sound, title: `Fassung ${String(formVersion)}` },
  }))
  const catalogue = {
    formVersion: (key: string, version: number) =>
      key === 'probe.protocol' ? { key, version, definition: sound } : null,
  }
  const lookup = withTemplates(catalogue, versions)

  it('answers a round with the version it names, whatever came after', () => {
    expect(lookup.formVersion(templateFormKey(template), 1)?.definition.title).toBe('Fassung 1')
    expect(lookup.formVersion(templateFormKey(template), 3)).toBeNull()
  })

  it('leaves a form of a package to the catalogue', () => {
    expect(lookup.formVersion('probe.protocol', 4)?.version).toBe(4)
  })
})

describe('a limit the operator states', () => {
  const field = temperature as MeasurementField

  it('judges a value by the value and the source the version says', () => {
    expect(forms.limitVerdict(field, 61_000, context)).toMatchObject({
      within: true,
      limitMilli: 60_000,
      source: 'DVGW W 551, 6.1',
    })
    expect(forms.limitVerdict(field, 58_500, context).within).toBe(false)
  })

  it('holds a value to a limit it must not pass', () => {
    const most = {
      ...field,
      limit: { kind: 'stated', bound: 'at_most', milli: 25_000, source: 'DIN 1988-200' },
    } as MeasurementField

    expect(forms.limitVerdict(most, 24_000, context).within).toBe(true)
    expect(forms.limitVerdict(most, 26_000, context).within).toBe(false)
  })

  it('judges nothing by one that lacks its source', () => {
    const bare = { ...field, limit: { kind: 'stated', bound: 'at_least', milli: 60_000 } }

    expect(forms.limitVerdict(bare as MeasurementField, 58_500, context).within).toBeNull()
  })
})

describe('a version before it is saved', () => {
  it('passes with what the person sees and what fits', () => {
    expect(templateProblems(sound, records)).toEqual({})
  })

  it('names the title, an empty chapter and a template without chapters at their place', () => {
    expect(
      templateProblems(
        {
          title: ' ',
          sections: [
            { key: 'k1', title: 'Heizraum', fields: [remark] },
            { key: 'k2', title: 'Leer', fields: [] },
          ],
        },
        records,
      ),
    ).toEqual({ title: 'Die Bezeichnung fehlt.', 'chapter.k2': 'Das Kapitel hat keine Punkte.' })
    expect(templateProblems({ title: 'Leer', sections: [] }, records)).toEqual({
      form: 'Eine Vorlage hat mindestens ein Kapitel.',
    })
  })

  it('names a point at an asset or a room that is gone or out of sight', () => {
    expect(
      templateProblems(withPoints({ ...remark, about: { kind: 'asset', id: pump } }), records),
    ).toEqual({ 'point.p3': 'Die Anlage gibt es nicht mehr oder nicht in Ihren Bereichen.' })
    expect(
      templateProblems(withPoints({ ...remark, about: { kind: 'room', id: pump } }), records),
    ).toEqual({ 'point.p3': 'Den Raum gibt es nicht mehr oder nicht in Ihren Bereichen.' })
  })

  it('lets a check point or a required measured value with a limit fulfil a duty at what it is about', () => {
    expect(
      templateProblems(withPoints({ ...remark, about: door.about, fulfils: doorDuty }), records),
    ).toEqual({
      'point.p3': 'Eine Pflicht erfüllt nur ein Prüfpunkt oder ein Messwert mit Grenzwert.',
    })
    expect(templateProblems(withPoints({ ...temperature, required: false }), records)).toEqual({
      'point.p1': 'Ein Messwert, der eine Pflicht erfüllt, muss ausgefüllt werden.',
    })
    expect(templateProblems(withPoints({ ...door, fulfils: temperatureDuty }), records)).toEqual({
      'point.p2': 'Ein Punkt, der eine Pflicht erfüllt, zeigt auf ihre Anlage oder ihren Raum.',
    })
    expect(
      templateProblems(withPoints({ ...door, about: undefined, fulfils: doorDuty }), records),
    ).toEqual({
      'point.p2': 'Ein Punkt, der eine Pflicht erfüllt, zeigt auf ihre Anlage oder ihren Raum.',
    })
  })

  it('names a duty that is gone, one that takes no point of a round, and one fulfilled twice', () => {
    expect(
      templateProblems(withPoints({ ...temperature, fulfils: 'x' as DutyId }), records),
    ).toEqual({ 'point.p1': 'Die Pflicht gibt es nicht mehr oder nicht in Ihren Bereichen.' })
    expect(templateProblems(withPoints({ ...temperature, fulfils: reportOnly }), records)).toEqual({
      'point.p1': 'Diese Pflicht nimmt keinen Punkt eines Rundgangs als Nachweis.',
    })
    expect(
      templateProblems(withPoints(temperature, { ...temperature, key: 'p4' }), records),
    ).toEqual({ 'point.p4': 'Diese Pflicht erfüllt schon ein anderer Punkt.' })
  })

  it('asks a limit for a rule the catalogue knows in a unit that fits, or a value with its source', () => {
    const limited = (limit: unknown) =>
      templateProblems(withPoints({ ...temperature, limit } as TemplateField), records)

    expect(limited({ kind: 'at_least', rule: 'probe.hot_water_minimum' })).toEqual({})
    expect(limited({ kind: 'at_least', rule: 'probe.cold_water' })).toEqual({
      'point.p1': 'Diese Regel kennt der Katalog nicht.',
    })
    expect(limited({ kind: 'at_least', rule: 'probe.inspection_interval' })).toEqual({
      'point.p1': 'Die Regel misst in einer anderen Einheit als der Punkt.',
    })
    expect(limited({ kind: 'stated', bound: 'at_least', milli: 60_000, source: '' })).toEqual({
      'point.p1': 'Ein eigener Grenzwert braucht einen Wert und seine Quelle.',
    })
  })

  it('hands what only the engine knows to the engine, and names the point by its label', () => {
    expect(templateProblems(withPoints({ ...temperature, decimals: 4 }), records)).toEqual({
      'point.p1': '„Temperatur am Speicheraustritt“ zeigt null bis drei Nachkommastellen.',
    })
    expect(
      templateProblems(
        withPoints({
          kind: 'choice',
          key: 'p5',
          label: 'Zustand',
          options: [
            { value: 'a', label: 'gut' },
            { value: 'a', label: 'schlecht' },
          ],
        }),
        records,
      ),
    ).toEqual({
      'point.p5':
        'Jede Möglichkeit der Auswahl „Zustand“ braucht einen eigenen Wert und eine Beschriftung.',
    })
  })

  it('asks the engine about the whole version last, for what lies between points', () => {
    expect(
      templateProblems(withPoints(remark, { ...remark, label: 'Noch etwas' }), records),
    ).toEqual({ form: 'Das Feld p3 steht zweimal im Formular.' })
  })
})

describe('what a template names outside itself', () => {
  it('lists the assets, rooms, duties and rules once each', () => {
    expect(
      templatePointers(
        withPoints(temperature, door, {
          ...temperature,
          key: 'p4',
          limit: { kind: 'at_least', rule: 'probe.hot_water_minimum' },
        }),
      ),
    ).toEqual({
      assets: [heater],
      rooms: [boilerRoom],
      duties: [temperatureDuty, doorDuty],
      rules: ['probe.hot_water_minimum'],
    })
  })

  it('finds the point that fulfils a duty', () => {
    expect(pointFulfilling(sound, doorDuty)?.key).toBe('p2')
    expect(pointFulfilling(sound, reportOnly)).toBeNull()
  })
})

describe('the result of a duty out of the answer to its point', () => {
  const answer = (result: string | null, value: string | null = null, remarkText = null) => ({
    value,
    result: result as 'ok',
    remark: remarkText as string | null,
    attachmentId: null,
  })

  it('reads a check point', () => {
    expect(pointOutcome(door, answer('ok'), context)).toEqual({
      result: 'without_defects',
      reason: null,
    })
    expect(pointOutcome(door, answer('not_ok'), context)?.result).toBe('with_defects')
    expect(
      pointOutcome(door, { ...answer('not_possible'), remark: 'Raum verschlossen' }, context),
    ).toEqual({ result: 'not_performed', reason: 'nicht möglich: Raum verschlossen' })
  })

  it('reads a measured value against its limit', () => {
    expect(pointOutcome(temperature, answer(null, '61000'), context)?.result).toBe(
      'without_defects',
    )
    expect(pointOutcome(temperature, answer(null, '58500'), context)?.result).toBe('with_defects')
  })

  it('says nothing where the answer says nothing', () => {
    expect(pointOutcome(door, null, context)).toBeNull()
    expect(pointOutcome(temperature, answer(null, null), context)).toBeNull()
    expect(pointOutcome(remark, answer(null, '"Alles ruhig"'), context)).toBeNull()
  })
})
