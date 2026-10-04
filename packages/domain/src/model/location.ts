import { type FederalState, federalStates, type Id, type Synced } from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import { optional, type Problems, required, wholeFromTo } from './fields.js'

/**
 * The place, the one half of the data model (section 2.2 of the concept,
 * ADR 0002): a property, the buildings on it, their floors and the rooms on a
 * floor. The levels are those of the concept and no setting. Every level
 * carries the ids of the levels above it, and the area of its property
 * (ADR 0003).
 */
export type PropertyId = Id<'property'>
export type BuildingId = Id<'building'>
export type FloorId = Id<'floor'>
export type RoomId = Id<'room'>

/**
 * A property: a site or a campus with an address and a federal state, in one
 * area of its tenant. The state decides with the kinds of its buildings which
 * duties are proposed.
 */
export interface Property extends Synced {
  readonly id: PropertyId
  readonly areaId: AreaId
  readonly name: string
  readonly street: string
  readonly postalCode: string
  readonly city: string
  readonly federalState: FederalState
}

/** A building on a property, with the kinds it is used as. */
export interface Building extends Synced {
  readonly id: BuildingId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly name: string
  readonly shortCode: string | null
  readonly kinds: readonly BuildingKind[]
  readonly yearBuilt: number | null
}

/** A floor of a building, ordered by its level: nought is the ground floor. */
export interface Floor extends Synced {
  readonly id: FloorId
  readonly buildingId: BuildingId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly name: string
  readonly level: number
}

/** A room on a floor, with a number or a name or both. */
export interface Room extends Synced {
  readonly id: RoomId
  readonly floorId: FloorId
  readonly buildingId: BuildingId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly number: string | null
  readonly name: string | null
  readonly use: string | null
}

/**
 * What a building is used for, which decides with the federal state which
 * duties are proposed (section 2.2 of the concept, ADR 0005, point 14).
 *
 * Not a list of our own (Leitentscheidung 11): the special buildings of § 38
 * Abs. 2 LBO Baden-Württemberg, in the state of the pilot operation and the
 * first state the packages cover, without their sizes, which are conditions of
 * a duty and not a kind of building. Beside them the residential building,
 * the garage, which has an ordinance of its own, the outdoor facility, which
 * ADR 0002 makes a building, and a building of no listed kind.
 *
 * A building has one kind or several: a school with an assembly hall is a
 * meeting place as well, and the duties of both are proposed for it.
 */
export const buildingKinds = [
  'residential',
  'high_rise',
  'retail',
  'commercial',
  'office',
  'school',
  'care',
  'assembly',
  'hospital',
  'accommodation',
  'restaurant',
  'detention',
  'garage',
  'outdoor',
  'other',
] as const

export type BuildingKind = (typeof buildingKinds)[number]

/** The kinds of buildings in the words of the people who work with them. */
export const buildingKindLabel: Readonly<Record<BuildingKind, string>> = {
  residential: 'Wohngebäude',
  high_rise: 'Hochhaus',
  retail: 'Verkaufsstätte',
  commercial: 'Gewerbebau',
  office: 'Büro- und Verwaltungsgebäude',
  school: 'Schule oder Hochschule',
  care: 'Einrichtung zur Betreuung, Unterbringung oder Pflege',
  assembly: 'Versammlungs- oder Sportstätte',
  hospital: 'Krankenhaus',
  accommodation: 'Gemeinschaftsunterkunft oder Beherbergungsstätte',
  restaurant: 'Gaststätte',
  detention: 'Justizvollzug oder Maßregelvollzug',
  garage: 'Garage',
  outdoor: 'Außenanlage',
  other: 'Sonstiges Gebäude',
}

/** The bounds of the fields of a place, the same in the form, the sync and the database. */
export const locationLimits = {
  name: 120,
  street: 120,
  city: 80,
  shortCode: 20,
  floorName: 60,
  roomNumber: 30,
  roomUse: 120,
  earliestYearBuilt: 1000,
  latestYearBuilt: 2100,
  lowestLevel: -20,
  highestLevel: 200,
} as const

/**
 * What is wrong with a property, one sentence per field, empty when nothing
 * is. The area is not asked here: whether it is one of the tenant's and one
 * the person sees is a question for the database.
 */
export function propertyProblems(property: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, property, 'name', locationLimits.name, 'Die Bezeichnung')
  required(problems, property, 'street', locationLimits.street, 'Die Straße')
  required(problems, property, 'city', locationLimits.city, 'Der Ort')

  const postalCode = property['postalCode']

  if (
    postalCode !== undefined &&
    (typeof postalCode !== 'string' || !/^[0-9]{5}$/.test(postalCode))
  ) {
    problems['postalCode'] = 'Die Postleitzahl hat fünf Ziffern.'
  }

  const state = property['federalState']

  if (state !== undefined && !(federalStates as readonly unknown[]).includes(state)) {
    problems['federalState'] =
      state === null || state === ''
        ? 'Das Bundesland fehlt.'
        : 'Das Bundesland ist keines der sechzehn Länder.'
  }

  return problems
}

/** What is wrong with a building, one sentence per field. */
export function buildingProblems(building: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, building, 'name', locationLimits.name, 'Die Bezeichnung')
  optional(
    problems,
    building,
    'shortCode',
    locationLimits.shortCode,
    `Das Kürzel hat höchstens ${String(locationLimits.shortCode)} Zeichen.`,
  )

  const kinds = building['kinds']

  if (kinds !== undefined) {
    if (!Array.isArray(kinds) || kinds.length === 0) {
      problems['kinds'] = 'Ein Gebäude hat mindestens eine Gebäudeart.'
    } else if (!kinds.every((kind) => (buildingKinds as readonly unknown[]).includes(kind))) {
      problems['kinds'] = 'Eine der Gebäudearten gibt es nicht.'
    } else if (new Set(kinds).size !== kinds.length) {
      problems['kinds'] = 'Eine Gebäudeart steht doppelt.'
    }
  }

  const year = building['yearBuilt']

  if (
    year !== undefined &&
    year !== null &&
    !wholeFromTo(year, locationLimits.earliestYearBuilt, locationLimits.latestYearBuilt)
  ) {
    problems['yearBuilt'] =
      `Das Baujahr ist eine ganze Zahl von ${String(locationLimits.earliestYearBuilt)} bis ${String(locationLimits.latestYearBuilt)}.`
  }

  return problems
}

/** What is wrong with a floor, one sentence per field. */
export function floorProblems(floor: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  required(problems, floor, 'name', locationLimits.floorName, 'Die Bezeichnung')

  const level = floor['level']

  if (
    level !== undefined &&
    !wholeFromTo(level, locationLimits.lowestLevel, locationLimits.highestLevel)
  ) {
    problems['level'] =
      `Die Ebene ist eine ganze Zahl von ${String(locationLimits.lowestLevel)} bis ${String(locationLimits.highestLevel)}: ` +
      '0 ist das Erdgeschoss, darunter liegen die Untergeschosse.'
  }

  return problems
}

/**
 * What is wrong with a room, one sentence per field. A room has a number or a
 * name, or both: a stairwell often has no number, and a numbered room no name.
 */
export function roomProblems(room: Readonly<Record<string, unknown>>): Readonly<Problems> {
  const problems: Problems = {}

  optional(
    problems,
    room,
    'number',
    locationLimits.roomNumber,
    `Die Raumnummer hat höchstens ${String(locationLimits.roomNumber)} Zeichen.`,
  )
  optional(
    problems,
    room,
    'name',
    locationLimits.name,
    `Die Bezeichnung hat höchstens ${String(locationLimits.name)} Zeichen.`,
  )
  optional(
    problems,
    room,
    'use',
    locationLimits.roomUse,
    `Die Nutzung hat höchstens ${String(locationLimits.roomUse)} Zeichen.`,
  )

  const blank = (value: unknown) => typeof value !== 'string' || value.trim() === ''

  if (
    room['number'] !== undefined &&
    room['name'] !== undefined &&
    blank(room['number']) &&
    blank(room['name'])
  ) {
    problems['number'] = 'Ein Raum hat eine Nummer oder eine Bezeichnung.'
  }

  return problems
}

/**
 * What a room is called where one line has to say it, in a path or in the
 * name of a deadline: its number and its name, whichever it has, the number
 * first as it stands on the door. A room has one of the two (`roomProblems`),
 * so this is empty only for a room nobody could have entered.
 */
export function roomTitle(room: {
  readonly number: string | null
  readonly name: string | null
}): string {
  return [room.number, room.name]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ')
}
