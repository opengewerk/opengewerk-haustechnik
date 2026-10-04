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

/**
 * What the forms of this application name: its units, every kind of field
 * the foundation knows, check points and readings included, and as yet no
 * list a group repeats over and no limit worked out instead of taken from a
 * rule.
 */
export interface FormTerms {
  readonly unit: FormUnitKey
  readonly list: never
  readonly limit: never
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
  limits: {},
  kinds: blockFieldKinds,
  records: formRecordKinds,
})
