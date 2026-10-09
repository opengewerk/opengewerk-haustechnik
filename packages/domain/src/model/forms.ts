import {
  blockFieldKinds,
  type BlockField as GeneralBlockField,
  formEngine,
  type FormDefinition as GeneralFormDefinition,
  type FormField as GeneralFormField,
  type FormSection as GeneralFormSection,
  type FormUnit,
  type GroupField as GeneralGroupField,
  type MeasurementField as GeneralMeasurementField,
  type MeterReadingField as GeneralMeterReadingField,
  type NumberField as GeneralNumberField,
} from '@opengewerk/platform-domain'

import { meterUnitSymbol } from './meter.js'

/**
 * Protocols, maintenance records and the templates of rounds as data
 * (section 2.5 of the concept): the form engine of the foundation (ADR 0010
 * in the repository opengewerk), bound to what this application names.
 *
 * A form of a package is checked by this engine when the catalogue is built
 * (ADR 0005, point 7); a filled form, the screens and what a check point that
 * is not in order turns into come with the rounds in phase 1.
 */

/**
 * The units a figure of a form is counted in: degrees Celsius for the
 * temperatures the concept wants as measured values with a limit (section 8,
 * drinking water), and the units a meter counts in for its readings. A limit
 * on a temperature is a rule in tenths of a degree, as the rule engine keeps
 * it (section 2.9).
 */
export const formUnits = {
  degrees_celsius: { sign: '°C', fromRule: { decidegrees_celsius: 100 } },
  kilowatt_hours: { sign: meterUnitSymbol.kilowatt_hours },
  megawatt_hours: { sign: meterUnitSymbol.megawatt_hours },
  cubic_metres: { sign: meterUnitSymbol.cubic_metres },
} as const satisfies Readonly<Record<string, FormUnit>>

export type FormUnitKey = keyof typeof formUnits

/**
 * What a field of a form may be about: an asset or a room (section 2.5). What
 * is found there then belongs to it, and a point that is not in order becomes
 * a defect at exactly that asset or room.
 */
export const formRecordKinds = ['asset', 'room'] as const

export type FormRecordKind = (typeof formRecordKinds)[number]

/** Whether a measured value has to reach its limit or must not pass it. */
export const limitBounds = ['at_least', 'at_most'] as const

export type LimitBound = (typeof limitBounds)[number]

/** The largest limit an operator states, in thousandths of its unit: a million of the unit. */
export const statedLimitMost = 1_000_000_000

/** The longest source an operator names for a limit of their own. */
export const statedSourceMost = 200

/**
 * A limit the operator states in the template of a round, with its source,
 * rather than takes from a rule of a package (section 2.5 of the concept,
 * decided on 04.10.2026): the value stands in the version of the template, so
 * a round is judged by the value its version said. In thousandths of the
 * field's unit, as the engine counts. A package never names one: a limit it
 * ships is a rule with its source (ADR 0005).
 */
export interface StatedLimit {
  readonly kind: 'stated'
  readonly bound: LimitBound
  readonly milli: number
  readonly source: string
}

/** Whether a stated limit has the shape it needs, its value and a source among them. */
export function isStatedLimit(limit: unknown): limit is StatedLimit {
  if (typeof limit !== 'object' || limit === null) {
    return false
  }

  const { kind, bound, milli, source } = limit as Record<string, unknown>

  return (
    kind === 'stated' &&
    (limitBounds as readonly unknown[]).includes(bound) &&
    typeof milli === 'number' &&
    Number.isInteger(milli) &&
    Math.abs(milli) <= statedLimitMost &&
    typeof source === 'string' &&
    source.trim() !== '' &&
    source.trim() === source &&
    source.length <= statedSourceMost
  )
}

/**
 * What the forms of this application name: its units, every kind of field
 * the foundation knows, check points and readings included, no list a group
 * repeats over as yet, and beside the limits of the rules the one an operator
 * states.
 */
export interface FormTerms {
  readonly unit: FormUnitKey
  readonly list: never
  readonly limit: 'stated'
  readonly kind: (typeof blockFieldKinds)[number]
}

export type FormDefinition = GeneralFormDefinition<FormTerms>
export type FormSection = GeneralFormSection<FormTerms>
export type FormField = GeneralFormField<FormTerms>
export type BlockField = GeneralBlockField<FormTerms>
export type GroupField = GeneralGroupField<FormTerms>
export type NumberField = GeneralNumberField<FormTerms>
export type MeasurementField = GeneralMeasurementField<FormTerms>
export type MeterReadingField = GeneralMeterReadingField<FormTerms>

/** The form engine of this application. */
export const forms = formEngine<FormTerms>({
  units: formUnits,
  lists: {},
  limits: {
    // The value and its source are read from the field; one that lacks either
    // judges nothing rather than something it does not say.
    stated: (field) =>
      isStatedLimit(field.limit)
        ? {
            limitMilli: field.limit.milli,
            atLeast: field.limit.bound === 'at_least',
            source: field.limit.source,
          }
        : { none: 'Der eigene Grenzwert nennt keinen Wert mit Quelle.' },
  },
  kinds: blockFieldKinds,
  records: formRecordKinds,
})
