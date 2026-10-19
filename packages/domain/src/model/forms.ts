import {
  blockFieldKinds,
  type BlockField as GeneralBlockField,
  circuitList,
  formEngine,
  type FormDefinition as GeneralFormDefinition,
  type FormField as GeneralFormField,
  type FormSection as GeneralFormSection,
  type FormUnit,
  type GroupField as GeneralGroupField,
  type LimitCalculator,
  loopImpedance,
  type MeasurementField as GeneralMeasurementField,
  type MeterReadingField as GeneralMeterReadingField,
  type NumberField as GeneralNumberField,
  residualTripCurrent,
  type RuleSet,
  type RuleUnit,
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
 * drinking water), the units a meter counts in for its readings, and the
 * resistances and currents the test of an electrical device measures (package
 * Elektro, #91), and the count of Legionella in 100 millilitres that a finding
 * of a laboratory states (package Trinkwasser, #93). A limit on a temperature
 * is a rule in tenths of a degree, as the rule engine keeps it (section 2.9),
 * one on a resistance a rule in kiloohms and one on a count a rule in the
 * same count; the rule engine has no unit for a current. Kilograms came with
 * the refrigerant a leak check records as charged, recharged and recovered
 * (package Raumluft und Kälte, #351), without a limit, and milliseconds with
 * the tripping time of a residual current device measured on a circuit
 * (#350), whose limit is a rule in milliseconds as well.
 */
export const formUnits = {
  degrees_celsius: { sign: '°C', fromRule: { decidegrees_celsius: 100 } },
  count_per_100_ml: { sign: 'je 100 ml', fromRule: { count_per_100_ml: 1000 } },
  kilowatt_hours: { sign: meterUnitSymbol.kilowatt_hours },
  megawatt_hours: { sign: meterUnitSymbol.megawatt_hours },
  cubic_metres: { sign: meterUnitSymbol.cubic_metres },
  ohms: { sign: 'Ω', fromRule: { kiloohms: 1_000_000 } },
  megaohms: { sign: 'MΩ', fromRule: { kiloohms: 1 } },
  milliamperes: { sign: 'mA' },
  kilograms: { sign: 'kg' },
  milliseconds: { sign: 'ms', fromRule: { milliseconds: 1000 } },
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
 * Whether a measured value has to reach its limit, must not pass it, or has
 * to stay under it, where reaching the limit is outside already (#299), as
 * the kinds of a limit taken from a rule say.
 */
export const limitBounds = ['at_least', 'at_most', 'below'] as const

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
 * The limits worked out of the circuit a block is about (#350, ADR 0014 in
 * the repository opengewerk): the loop impedance from the protective device
 * of the circuit, and the tripping current from its rated residual current.
 * Each is worked out in one unit and reads its rules by their keys in this
 * catalogue, with the unit each of them counts in; the build of the catalogue
 * asks that they are there.
 */
export const workedOutLimits = {
  loop_impedance: {
    unit: 'ohms',
    rules: [
      { key: 'elektro.loop_factor_b', unit: 'factor' },
      { key: 'elektro.loop_factor_c', unit: 'factor' },
      { key: 'elektro.loop_factor_d', unit: 'factor' },
      { key: 'elektro.loop_nominal_voltage', unit: 'volts' },
    ],
  },
  rcd_trip_current: {
    unit: 'milliamperes',
    rules: [{ key: 'elektro.rcd_trip_current_maximum', unit: 'basis_points' }],
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly unit: FormUnitKey
      readonly rules: readonly { readonly key: string; readonly unit: RuleUnit }[]
    }
  >
>

export type WorkedOutLimitKind = keyof typeof workedOutLimits

/**
 * The keys the calculators of the foundation ask for, as the trades
 * application names its rules, and the rule of this catalogue that answers
 * each. A rule here is named `<package>.<key>` with a key without a dot, so
 * `elektro.loop.factor_b` is `elektro.loop_factor_b` in the package Elektro.
 */
export const foundationCircuitRules: Readonly<Record<string, string>> = {
  'elektro.loop.factor_b': 'elektro.loop_factor_b',
  'elektro.loop.factor_c': 'elektro.loop_factor_c',
  'elektro.loop.factor_d': 'elektro.loop_factor_d',
  'elektro.loop.nominal_voltage': 'elektro.loop_nominal_voltage',
  'elektro.rcd.trip_current_maximum': 'elektro.rcd_trip_current_maximum',
}

/** The rules of the catalogue, asked under the keys the calculators of the foundation use. */
function asFoundationNames(rules: RuleSet): RuleSet {
  const named = (key: string) =>
    Object.hasOwn(foundationCircuitRules, key) ? (foundationCircuitRules[key] ?? key) : key

  return {
    at: (key, on, state) => rules.at(named(key), on, state),
    valueAt: (key, unit, on, state) => rules.valueAt(named(key), unit, on, state),
    keys: () => rules.keys(),
    all: () => rules.all(),
  }
}

/** A calculator of the foundation, handed the rules of this catalogue under the names it asks for. */
function withCatalogueRules(calculator: LimitCalculator): LimitCalculator<FormTerms> {
  return (field, context) =>
    calculator(field, { ...context, rules: asFoundationNames(context.rules) })
}

/**
 * What the forms of this application name: its units, every kind of field
 * the foundation knows, check points and readings included, the circuits of
 * an installation as the one list a group repeats over (#350), and beside the
 * limits of the rules the one an operator states and the two worked out of a
 * circuit.
 */
export interface FormTerms {
  readonly unit: FormUnitKey
  readonly list: 'circuits'
  readonly limit: 'stated' | WorkedOutLimitKind
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

/**
 * Where a block of a group over a list keeps the item it is about and its
 * id. A block is made from the answers whenever it is asked about and never
 * kept (#350), so it takes the keys the engine names by itself.
 */
export const blockKeys = { id: 'itemId', item: 'item' } as const

/**
 * The form engine of this application. A group over the circuits has one
 * block for each circuit of the installation (#350).
 */
export const forms = formEngine<FormTerms>({
  units: formUnits,
  lists: { circuits: circuitList },
  limits: {
    // The value and its source are read from the field; one that lacks either
    // judges nothing rather than something it does not say.
    stated: (field) =>
      isStatedLimit(field.limit)
        ? {
            limitMilli: field.limit.milli,
            atLeast: field.limit.bound === 'at_least',
            under: field.limit.bound === 'below',
            source: field.limit.source,
          }
        : { none: 'Der eigene Grenzwert nennt keinen Wert mit Quelle.' },
    loop_impedance: withCatalogueRules(loopImpedance),
    rcd_trip_current: withCatalogueRules(residualTripCurrent),
  },
  kinds: blockFieldKinds,
  records: formRecordKinds,
  blockKeys,
})
