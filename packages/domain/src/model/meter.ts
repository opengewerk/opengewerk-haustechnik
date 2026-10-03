/**
 * Meters are assets (section 2.2 of the concept, ADR 0002, point 9): a
 * measuring point with a medium, a unit and a meter number, whose readings
 * hang at it. Which asset kinds are measuring points says the catalogue: an
 * asset kind with a `meter` names its medium and the units a meter of that
 * kind may count in. The asset carries its number and its unit, the medium
 * comes from its kind, so that it stands in one place.
 */

/** What a meter measures, the media of section 4.9 of the concept. */
export const meterMedia = [
  'electricity',
  'water',
  'heat',
  'district_heating',
  'gas',
  'cooling',
] as const

export type MeterMedium = (typeof meterMedia)[number]

export const meterMediumLabel: Readonly<Record<MeterMedium, string>> = {
  electricity: 'Strom',
  water: 'Wasser',
  heat: 'Wärme',
  district_heating: 'Fernwärme',
  gas: 'Gas',
  cooling: 'Kälte',
}

/**
 * What a meter counts in. Few, on purpose: a reading is compared with the
 * one before it and summed into a consumption, and two meters of one medium
 * in units nobody can convert between would make that a guess.
 */
export const meterUnits = ['kilowatt_hours', 'megawatt_hours', 'cubic_metres'] as const

export type MeterUnit = (typeof meterUnits)[number]

/** The units as they are written beside a figure. */
export const meterUnitSymbol: Readonly<Record<MeterUnit, string>> = {
  kilowatt_hours: 'kWh',
  megawatt_hours: 'MWh',
  cubic_metres: 'm³',
}

/** The kind of a measuring point, as an asset kind of the catalogue states it. */
export interface MeterKind {
  readonly medium: MeterMedium
  readonly units: readonly MeterUnit[]
}
