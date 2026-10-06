import {
  type FederalState,
  federalStates,
  ruleScopeNames,
  type TableField,
  tableNameKey,
  type TableRecord,
  wholeNumberOfCell,
} from '@opengewerk/platform-domain'

import type { AreaId } from './area.js'
import { levelOfFloorName } from './floor-level.js'
import {
  correctTheFile,
  counted,
  type ImportProblem,
  ImportProblems,
  listed,
  nameKey,
} from './import.js'
import {
  type Building,
  type BuildingId,
  type BuildingKind,
  buildingKindLabel,
  buildingKinds,
  buildingProblems,
  type Floor,
  type FloorId,
  floorProblems,
  type Property,
  type PropertyId,
  propertyProblems,
  type Room,
  type RoomId,
  roomProblems,
} from './location.js'

/**
 * The import of places from a table (#100, sections 3 and 11 of the
 * concept): properties, their buildings, floors and rooms, one line for the
 * deepest of them it names.
 *
 * A line is a path. "Schulzentrum, Schulhaus, EG, E.14" is the room E.14 and
 * names on its way the property, the building and the floor it lies in; a
 * line that ends at the building is the building. What a line names and what
 * is there already is found by its name within what lies above it, compared
 * without spaces and case. Nothing that exists is changed and nothing is
 * made twice: such a line is shown as known and makes nothing.
 *
 * What a new record needs and a list rarely says comes from the three
 * defaults: the area and the federal state of a new property and the kinds
 * of a new building. The level of a new floor is read from its name
 * (`levelOfFloorName`) where no column gives it.
 */

/** The fields a column of such a table can be, with what lists call them. */
export const structureFields: readonly TableField[] = [
  {
    key: 'property',
    label: 'Liegenschaft',
    names: ['Objekt', 'Standort', 'Liegenschaftsname', 'Name der Liegenschaft'],
    required: true,
  },
  {
    key: 'street',
    label: 'Straße und Hausnummer',
    names: ['Straße', 'Adresse', 'Anschrift'],
  },
  { key: 'postalCode', label: 'Postleitzahl', names: ['PLZ'] },
  { key: 'city', label: 'Ort', names: ['Stadt', 'Gemeinde'] },
  { key: 'federalState', label: 'Bundesland', names: ['Land'] },
  {
    key: 'building',
    label: 'Gebäude',
    names: ['Gebäudename', 'Gebäudebezeichnung', 'Haus', 'Bauteil'],
  },
  {
    key: 'shortCode',
    label: 'Kürzel des Gebäudes',
    names: ['Kürzel', 'Gebäudekürzel', 'Gebäude-Nr.', 'Gebäudenummer'],
  },
  { key: 'buildingKinds', label: 'Gebäudeart', names: ['Gebäudearten', 'Art des Gebäudes'] },
  { key: 'yearBuilt', label: 'Baujahr des Gebäudes', names: ['Baujahr'] },
  { key: 'floor', label: 'Geschoss', names: ['Etage', 'Stockwerk'] },
  { key: 'level', label: 'Ebene', names: ['Geschossnummer', 'Ebene als Zahl'] },
  {
    key: 'roomNumber',
    label: 'Raumnummer',
    names: ['Raum-Nr.', 'Raumnr', 'Raum Nr', 'Raum'],
  },
  { key: 'roomName', label: 'Raumbezeichnung', names: ['Raumname', 'Bezeichnung des Raums'] },
  { key: 'roomUse', label: 'Nutzung', names: ['Raumnutzung', 'Nutzungsart'] },
]

/** What a new property and a new building get where no column says it. */
export interface StructureDefaults {
  readonly areaId: AreaId | null
  readonly federalState: FederalState | null
  readonly buildingKinds: readonly BuildingKind[]
}

/** The defaults out of what came over the wire: what is no area, state or kind is left out. */
export function structureDefaultsOf(value: unknown): StructureDefaults {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Readonly<
    Record<string, unknown>
  >
  const kinds = Array.isArray(given['buildingKinds']) ? (given['buildingKinds'] as unknown[]) : []

  return {
    areaId:
      typeof given['areaId'] === 'string' && given['areaId'] !== ''
        ? (given['areaId'] as AreaId)
        : null,
    federalState: federalStates.find((state) => state === given['federalState']) ?? null,
    buildingKinds: buildingKinds.filter((kind) => kinds.includes(kind)),
  }
}

/**
 * The federal state a cell names: by its name, by its two letters or by its
 * code. What names none is handed on as written, so that the rule of the
 * property says the sentence about it.
 */
export function federalStateOf(text: string): string {
  // By letters alone: a list writes "Baden Württemberg" as often as with its hyphen.
  const key = tableNameKey(text)

  return (
    federalStates.find(
      (state) =>
        tableNameKey(state) === key ||
        tableNameKey(state.slice(3)) === key ||
        tableNameKey(ruleScopeNames[state]) === key,
    ) ?? text
  )
}

/**
 * The kinds of building a cell names, several divided by a semicolon, a
 * stroke or a slash: by their word, or by its beginning where only one kind
 * begins so ("Schule" is "Schule oder Hochschule"). What names none is
 * handed on as written, for the rule of the building.
 */
export function buildingKindsOf(text: string): readonly string[] {
  return text
    .split(/[;|/]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const key = nameKey(part)
      const exact = buildingKinds.find(
        (kind) => nameKey(kind) === key || nameKey(buildingKindLabel[kind]) === key,
      )
      const beginning =
        key.length < 4
          ? []
          : buildingKinds.filter((kind) => nameKey(buildingKindLabel[kind]).startsWith(key))

      return exact ?? (beginning.length === 1 ? (beginning[0] ?? part) : part)
    })
}

/** What the person importing can see of the places, which is what a line can name. */
export interface StructureStock {
  readonly properties: readonly Pick<Property, 'id' | 'name' | 'areaId'>[]
  readonly buildings: readonly Pick<Building, 'id' | 'propertyId' | 'name'>[]
  readonly floors: readonly Pick<Floor, 'id' | 'buildingId' | 'name'>[]
  readonly rooms: readonly Pick<Room, 'id' | 'floorId' | 'buildingId' | 'number' | 'name'>[]
}

export type NewProperty = Pick<
  Property,
  'id' | 'areaId' | 'name' | 'street' | 'postalCode' | 'city' | 'federalState' | 'note'
>
export type NewBuilding = Pick<
  Building,
  'id' | 'propertyId' | 'areaId' | 'name' | 'shortCode' | 'kinds' | 'yearBuilt'
>
export type NewFloor = Pick<Floor, 'id' | 'buildingId' | 'propertyId' | 'areaId' | 'name' | 'level'>
export type NewRoom = Pick<
  Room,
  'id' | 'floorId' | 'buildingId' | 'propertyId' | 'areaId' | 'number' | 'name' | 'use'
>

/** How many records a plan makes, and how many lines name something that is there already. */
export interface StructureCounts {
  readonly properties: number
  readonly buildings: number
  readonly floors: number
  readonly rooms: number
  readonly known: number
}

export type PlaceTable = 'properties' | 'buildings' | 'floors' | 'rooms'

/** Lines that name something that is there already and make nothing. */
export interface KnownPlace {
  readonly lines: readonly number[]
  /** The way to what the lines name, in the names as they are kept. */
  readonly inFile: string
  /** What is there, and where its page is. */
  readonly existing: string
  readonly table: PlaceTable
  readonly id: string
}

export interface StructurePlan {
  /** The lines of the table that were read. */
  readonly lines: number
  readonly counts: StructureCounts
  readonly problems: readonly ImportProblem[]
  readonly known: readonly KnownPlace[]
  /** What taking over writes, parents before their children. Empty while there is a problem. */
  readonly create: {
    readonly properties: readonly NewProperty[]
    readonly buildings: readonly NewBuilding[]
    readonly floors: readonly NewFloor[]
    readonly rooms: readonly NewRoom[]
  }
}

interface Place {
  readonly table: PlaceTable
  readonly id: string
  readonly existing: boolean
  /** As the file writes it, or as it is kept where it exists. */
  readonly name: string
  readonly parent: Place | null
  /** The first line that names it. */
  readonly line: number
  /** What the lines say about a new one, each with the line that said it first. */
  readonly said: Map<string, string>
  /** The line that is this record and nothing below it. */
  deepestAt: number | null
  areaId: AreaId | null
}

const said: Readonly<Record<PlaceTable, readonly (readonly [field: string, label: string])[]>> = {
  properties: [
    ['street', 'die Straße'],
    ['postalCode', 'die Postleitzahl'],
    ['city', 'den Ort'],
    ['federalState', 'das Bundesland'],
  ],
  buildings: [
    ['shortCode', 'das Kürzel'],
    ['buildingKinds', 'die Gebäudeart'],
    ['yearBuilt', 'das Baujahr'],
  ],
  floors: [['level', 'die Ebene']],
  rooms: [],
}

const ancestor = (place: Place, table: PlaceTable): Place | null =>
  place.table === table ? place : place.parent ? ancestor(place.parent, table) : null

const nameOf = (place: Place, table: PlaceTable) => ancestor(place, table)?.name ?? ''

/** A place as a problem names it. */
function about(place: Place, capital = true, accusative = false): string {
  const article = (lower: string) =>
    capital ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower

  switch (place.table) {
    case 'properties':
      return `${article('die')} Liegenschaft „${place.name}“`
    case 'buildings':
      return `${article('das')} Gebäude „${place.name}“`
    case 'floors':
      return `${article('das')} Geschoss „${place.name}“ im Gebäude „${nameOf(place, 'buildings')}“`
    case 'rooms':
      return `${article(accusative ? 'den' : 'der')} Raum „${place.name}“ im Gebäude „${nameOf(place, 'buildings')}“`
  }
}

/** The way to a place as the file writes it: "Schulzentrum, Schulhaus, Erdgeschoss". */
function path(place: Place): string {
  return place.parent ? `${path(place.parent)}, ${place.name}` : place.name
}

/**
 * What the lines of a table would make of the places, against what is there.
 * `newId` gives every new record its id, so that a child knows its parent
 * before either is written.
 */
export function planStructure(
  records: readonly TableRecord[],
  defaults: StructureDefaults,
  stock: StructureStock,
  newId: () => string,
): StructurePlan {
  const problems = new ImportProblems()
  const places = new Map<string, Place[]>()
  const fresh: Place[] = []
  const knownLines = new Map<Place, number[]>()
  /** The line that first said each thing about a new place, for the problem of a line that says another. */
  const saidIn = new Map<string, number>()
  const slot = (parent: Place | null, key: string) => `${parent?.id ?? ''}\u0000${key}`

  const keep = (place: Place, key: string) => {
    const at = slot(place.parent, key)

    places.set(at, [...(places.get(at) ?? []), place])

    return place
  }

  // What is there, each under the key a line would find it by.
  const byId = new Map<string, Place>()
  const standing = (
    table: PlaceTable,
    id: string,
    name: string,
    parent: Place | null,
    key: string,
    areaId: AreaId | null,
  ) => {
    const place: Place = {
      table,
      id,
      existing: true,
      name,
      parent,
      line: 0,
      said: new Map(),
      deepestAt: null,
      areaId,
    }

    byId.set(id, place)

    return keep(place, key)
  }

  for (const property of stock.properties) {
    standing(
      'properties',
      property.id,
      property.name,
      null,
      nameKey(property.name),
      property.areaId,
    )
  }

  for (const building of stock.buildings) {
    const parent = byId.get(building.propertyId)

    if (parent) {
      standing(
        'buildings',
        building.id,
        building.name,
        parent,
        nameKey(building.name),
        parent.areaId,
      )
    }
  }

  for (const floor of stock.floors) {
    const parent = byId.get(floor.buildingId)

    if (parent) {
      standing('floors', floor.id, floor.name, parent, nameKey(floor.name), parent.areaId)
    }
  }

  for (const room of stock.rooms) {
    const parent = byId.get(room.floorId)

    if (parent) {
      const place = standing(
        'rooms',
        room.id,
        room.number ?? room.name ?? '',
        parent,
        roomKey(room.number ?? '', room.name ?? ''),
        parent.areaId,
      )

      // A line that names a room by its name alone finds the one with a number
      // too. Otherwise a list without numbers would make every room it names a
      // second time, beside the one that is there.
      if (room.number && room.name) {
        keep(place, roomKey('', room.name))
      }
    }
  }

  /** The place a line names under `parent`: the one that is there, the one an earlier line made, or a new one. */
  const placeOf = (
    line: number,
    table: PlaceTable,
    parent: Place | null,
    name: string,
    key: string,
    several = 'Eines davon umbenennen, dann ist klar, welches gemeint ist',
  ): Place | null => {
    const found = places.get(slot(parent, key)) ?? []

    if (found.length > 1) {
      problems.add(
        line,
        `${about({ ...(found[0] as Place), name }, true, true)} gibt es mehrfach`,
        several,
      )

      return null
    }

    if (found[0]) {
      return found[0]
    }

    const place: Place = {
      table,
      id: newId(),
      existing: false,
      name,
      parent,
      line,
      said: new Map(),
      deepestAt: null,
      areaId: parent ? parent.areaId : defaults.areaId,
    }

    fresh.push(place)

    return keep(place, key)
  }

  /** Notes what a line says about a new place. Two lines that say different things are a problem. */
  const note = (place: Place, line: number, values: Readonly<Record<string, string>>) => {
    if (place.existing) {
      return
    }

    for (const [field, label] of said[place.table]) {
      const value = values[field] ?? ''
      const before = place.said.get(field)
      const at = `${place.id}\u0000${field}`

      if (value === '') {
        continue
      }

      if (before === undefined) {
        place.said.set(field, value)
        saidIn.set(at, line)
      } else if (nameKey(before) !== nameKey(value)) {
        problems.add(
          [saidIn.get(at) ?? place.line, line],
          `${about(place)} steht mit zwei Angaben für ${label} in der Datei: „${before}“ und „${value}“`,
        )
      }
    }
  }

  /** The line is this place and nothing below it. */
  const settle = (line: number, place: Place) => {
    if (place.existing) {
      knownLines.set(place, [...(knownLines.get(place) ?? []), line])
    } else if (place.deepestAt !== null) {
      problems.add(
        [place.deepestAt, line],
        `${about(place)} steht zweimal in der Datei`,
        'Eine der beiden Zeilen streichen',
      )
    } else {
      place.deepestAt = line
    }
  }

  for (const { line, values } of records) {
    const cell = (field: string) => values[field] ?? ''
    const roomNumber = cell('roomNumber')
    const roomName = cell('roomName')
    const namesRoom = roomNumber !== '' || roomName !== '' || cell('roomUse') !== ''

    if (cell('property') === '') {
      problems.add(line, 'Die Liegenschaft fehlt')
      continue
    }

    const property = placeOf(line, 'properties', null, cell('property'), nameKey(cell('property')))

    if (!property) {
      continue
    }

    note(property, line, values)

    if (cell('building') === '') {
      if (cell('floor') !== '' || namesRoom) {
        problems.add(line, 'Das Gebäude fehlt')
      } else {
        settle(line, property)
      }

      continue
    }

    const building = placeOf(
      line,
      'buildings',
      property,
      cell('building'),
      nameKey(cell('building')),
    )

    if (!building) {
      continue
    }

    note(building, line, values)

    if (cell('floor') === '') {
      if (namesRoom) {
        problems.add(line, 'Das Geschoss fehlt')
      } else {
        settle(line, building)
      }

      continue
    }

    const floor = placeOf(line, 'floors', building, cell('floor'), nameKey(cell('floor')))

    if (!floor) {
      continue
    }

    note(floor, line, values)

    if (!namesRoom) {
      settle(line, floor)
      continue
    }

    const room = placeOf(
      line,
      'rooms',
      floor,
      roomNumber === '' ? roomName : roomNumber,
      roomKey(roomNumber, roomName),
      roomNumber === ''
        ? 'Die Raumnummer in der Datei nennen oder einen der Räume umbenennen'
        : undefined,
    )

    if (room) {
      if (!room.existing && room.deepestAt === null) {
        room.said.set('number', roomNumber)
        room.said.set('name', roomName)
        room.said.set('use', cell('roomUse'))
      }

      settle(line, room)
    }
  }

  const create = rowsOf(fresh, defaults, problems)
  const listedProblems = problems.list()
  const count = (table: PlaceTable) => fresh.filter((place) => place.table === table).length

  return {
    lines: records.length,
    counts: {
      properties: count('properties'),
      buildings: count('buildings'),
      floors: count('floors'),
      rooms: count('rooms'),
      known: [...knownLines.values()].reduce((sum, lines) => sum + lines.length, 0),
    },
    problems: listedProblems,
    known: knownPlaces(knownLines),
    create:
      listedProblems.length === 0
        ? create
        : { properties: [], buildings: [], floors: [], rooms: [] },
  }
}

/** What is said about a field a default of the first step can give, in place of sending somebody to the file. */
const chosenInTheFirstStep: Readonly<Record<string, string>> = {
  federalState: 'Im ersten Schritt ein Bundesland wählen oder die Datei berichtigen',
  kinds: 'Im ersten Schritt eine Gebäudeart wählen oder die Datei berichtigen',
}

/** A room is known by its number, and by its name where a line gives it no number. */
function roomKey(number: string, name: string): string {
  return number === '' ? `name\u0000${nameKey(name)}` : `number\u0000${nameKey(number)}`
}

/** A text of the file as a field holds it: nothing is null. */
const text = (value: string | undefined) => (value === undefined || value === '' ? null : value)

/** A whole number as a field holds it; what is none is handed on as written, for the rule. */
const whole = (value: string | undefined) =>
  value === undefined || value === '' ? null : (wholeNumberOfCell(value) ?? value)

/**
 * The new places as the rows that are written, each asked what its rule
 * asks of a place typed into the form. What a rule finds is a problem of the
 * first line that names the place.
 */
function rowsOf(
  fresh: readonly Place[],
  defaults: StructureDefaults,
  problems: ImportProblems,
): StructurePlan['create'] {
  const properties: NewProperty[] = []
  const buildings: NewBuilding[] = []
  const floors: NewFloor[] = []
  const rooms: NewRoom[] = []
  const idOf = (place: Place, table: PlaceTable) => ancestor(place, table)?.id ?? ''

  for (const place of fresh) {
    /** `unsaid` names the fields the file left to the first step: only there a choice in it helps. */
    const told = (sentences: Readonly<Record<string, string>>, unsaid: readonly string[] = []) => {
      for (const [field, sentence] of Object.entries(sentences)) {
        problems.addSentence(
          place.line,
          about(place).replace(/^(Die|Das|Der) /, ''),
          sentence,
          (unsaid.includes(field) ? chosenInTheFirstStep[field] : undefined) ?? correctTheFile,
        )
      }
    }
    const areaId = place.areaId

    if (areaId === null) {
      problems.add(
        place.line,
        'Der Bereich neuer Liegenschaften fehlt',
        'Im ersten Schritt einen Bereich wählen',
      )
      continue
    }

    switch (place.table) {
      case 'properties': {
        const state = place.said.get('federalState')
        const row = {
          id: place.id as PropertyId,
          areaId,
          name: place.name,
          street: text(place.said.get('street')),
          postalCode: text(place.said.get('postalCode')),
          city: text(place.said.get('city')),
          federalState: state === undefined ? defaults.federalState : federalStateOf(state),
          note: null,
        }

        told(propertyProblems(row), state === undefined ? ['federalState'] : [])
        properties.push(row as NewProperty)
        break
      }
      case 'buildings': {
        const kinds = place.said.get('buildingKinds')
        const row = {
          id: place.id as BuildingId,
          propertyId: idOf(place, 'properties') as PropertyId,
          areaId,
          name: place.name,
          shortCode: text(place.said.get('shortCode')),
          kinds: kinds === undefined ? defaults.buildingKinds : buildingKindsOf(kinds),
          yearBuilt: whole(place.said.get('yearBuilt')),
        }

        told(buildingProblems(row), kinds === undefined ? ['kinds'] : [])
        buildings.push(row as NewBuilding)
        break
      }
      case 'floors': {
        const given = place.said.get('level')
        const level = given === undefined ? levelOfFloorName(place.name) : whole(given)

        if (level === null) {
          problems.add(
            place.line,
            `Die Ebene ist aus der Bezeichnung nicht zu lesen: ${about(place, false).replace(/^das /, '')}`,
            'Eine Spalte „Ebene“ zuordnen: 0 ist das Erdgeschoss',
          )
          break
        }

        const row = {
          id: place.id as FloorId,
          buildingId: idOf(place, 'buildings') as BuildingId,
          propertyId: idOf(place, 'properties') as PropertyId,
          areaId,
          name: place.name,
          level,
        }

        told(floorProblems(row))
        floors.push(row as NewFloor)
        break
      }
      case 'rooms': {
        const row = {
          id: place.id as RoomId,
          floorId: idOf(place, 'floors') as FloorId,
          buildingId: idOf(place, 'buildings') as BuildingId,
          propertyId: idOf(place, 'properties') as PropertyId,
          areaId,
          number: text(place.said.get('number')),
          name: text(place.said.get('name')),
          use: text(place.said.get('use')),
        }

        told(roomProblems(row))
        rooms.push(row)
        break
      }
    }
  }

  return { properties, buildings, floors, rooms }
}

/**
 * The lines that make nothing, as the preview lists them: a property, a
 * building or a floor each on its own, and the rooms of one floor together,
 * because a list that was imported before comes with all its rooms again.
 */
function knownPlaces(knownLines: ReadonlyMap<Place, readonly number[]>): KnownPlace[] {
  const known: KnownPlace[] = []
  const roomsOf = new Map<Place, { rooms: Place[]; lines: number[] }>()

  for (const [place, lines] of knownLines) {
    if (place.table === 'rooms' && place.parent) {
      const floor = roomsOf.get(place.parent) ?? { rooms: [], lines: [] }

      floor.rooms.push(place)
      floor.lines.push(...lines)
      roomsOf.set(place.parent, floor)
    } else {
      known.push({
        lines,
        inFile: path(place),
        existing: place.name,
        table: place.table,
        id: place.id,
      })
    }
  }

  for (const [floor, { rooms, lines }] of roomsOf) {
    const [only] = rooms

    known.push(
      rooms.length === 1 && only
        ? { lines, inFile: path(only), existing: `Raum ${only.name}`, table: 'rooms', id: only.id }
        : {
            lines,
            inFile: `${counted(rooms.length, 'Raum', 'Räume')}: ${path(floor)}`,
            existing: `${floor.name}, gleiche Räume`,
            table: 'floors',
            id: floor.id,
          },
    )
  }

  return known.sort((one, other) => (one.lines[0] ?? 0) - (other.lines[0] ?? 0))
}

/** What an import of places made, as the log and the page say it: "3 Liegenschaften, 5 Gebäude und 396 Räume angelegt". */
export function structureSummary(counts: StructureCounts): string {
  const parts = [
    [counts.properties, 'Liegenschaft', 'Liegenschaften'],
    [counts.buildings, 'Gebäude', 'Gebäude'],
    [counts.floors, 'Geschoss', 'Geschosse'],
    [counts.rooms, 'Raum', 'Räume'],
  ] as const

  const made = parts
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => counted(count, one, many))

  return made.length === 0 ? 'Nichts angelegt' : `${listed(made)} angelegt`
}

/** How many records a plan makes in all. */
export function structureTotal(counts: StructureCounts): number {
  return counts.properties + counts.buildings + counts.floors + counts.rooms
}
