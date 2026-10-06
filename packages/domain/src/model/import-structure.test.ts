import {
  suggestedMapping,
  type TableField,
  tableNameKey,
  type TableRecord,
} from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { AreaId } from './area.js'
import { correctTheFile } from './import.js'
import {
  buildingKindsOf,
  federalStateOf,
  planStructure,
  type StructureDefaults,
  structureDefaultsOf,
  structureFields,
  type StructureStock,
  structureSummary,
  structureTotal,
} from './import-structure.js'
import {
  type BuildingId,
  type FloorId,
  locationLimits,
  type PropertyId,
  type RoomId,
} from './location.js'

const north = 'area-north' as AreaId
const south = 'area-south' as AreaId
const centre = 'p-1' as PropertyId
const school = 'b-1' as BuildingId
const gym = 'b-2' as BuildingId
const ground = 'f-1' as FloorId
const upper = 'f-2' as FloorId

/** What is there: one property in the north with two buildings, one of them with floors and rooms. */
const stock: StructureStock = {
  properties: [{ id: centre, name: 'Schulzentrum', areaId: north }],
  buildings: [
    { id: school, propertyId: centre, name: 'Schulhaus' },
    { id: gym, propertyId: centre, name: 'Turnhalle' },
  ],
  floors: [
    { id: ground, buildingId: school, name: 'Erdgeschoss' },
    { id: upper, buildingId: school, name: '1. OG' },
  ],
  rooms: [
    { id: 'r-1' as RoomId, floorId: ground, buildingId: school, number: 'E.14', name: 'Heizraum' },
    {
      id: 'r-2' as RoomId,
      floorId: ground,
      buildingId: school,
      number: null,
      name: 'Treppenhaus Nord',
    },
    { id: 'r-3' as RoomId, floorId: ground, buildingId: school, number: 'E.15', name: null },
  ],
}

const nothing: StructureStock = { properties: [], buildings: [], floors: [], rooms: [] }

/** New properties go to the south, which is not where the property of the stock lies. */
const defaults: StructureDefaults = {
  areaId: south,
  federalState: 'DE-BW',
  buildingKinds: ['school'],
}

/** What a new property needs beside its name. */
const address = { street: 'Schulstraße 1', postalCode: '68535', city: 'Edingen-Neckarhausen' }

const inSchool = { property: 'Schulzentrum', building: 'Schulhaus' }
const onGround = { ...inSchool, floor: 'Erdgeschoss' }

type Row = Readonly<Record<string, string>>

/** The rows as the lines of a file, the first of them in line 2 under the names of the columns. */
const records = (rows: readonly Row[]): TableRecord[] =>
  rows.map((values, index) => ({ line: index + 2, values }))

/** Ids a test can read: new-1, new-2 and so on, in the order they are asked for. */
function ids(): () => string {
  let given = 0

  return () => {
    given += 1

    return `new-${String(given)}`
  }
}

/** The plan of some rows against the stock, with the defaults unless a test says otherwise. */
const planOf = (
  rows: readonly Row[],
  given: { readonly stock?: StructureStock; readonly defaults?: StructureDefaults } = {},
) => planStructure(records(rows), given.defaults ?? defaults, given.stock ?? stock, ids())

const none = { properties: [], buildings: [], floors: [], rooms: [] }

const wordsOf = (field: TableField) => [field.label, ...(field.names ?? [])]

/** The words two fields are both called by, which would make the suggestion of a column a guess. */
const sharedWords = (fields: readonly TableField[]) =>
  fields.flatMap((field) =>
    fields
      .filter((other) => other.key !== field.key)
      .flatMap((other) =>
        wordsOf(field)
          .filter((word) =>
            wordsOf(other).some((taken) => tableNameKey(taken) === tableNameKey(word)),
          )
          .map((word) => `${field.key} and ${other.key}: ${word}`),
      ),
  )

describe('the fields of a table of places', () => {
  it('each have a key and a label of their own', () => {
    const keys = structureFields.map((field) => field.key)
    const labels = structureFields.map((field) => field.label)

    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(labels).size).toBe(labels.length)
    expect(keys).toEqual([
      'property',
      'street',
      'postalCode',
      'city',
      'federalState',
      'building',
      'shortCode',
      'buildingKinds',
      'yearBuilt',
      'floor',
      'level',
      'roomNumber',
      'roomName',
      'roomUse',
    ])
  })

  it('need a column for the property and for nothing else', () => {
    expect(
      structureFields.filter((field) => field.required === true).map((field) => field.key),
    ).toEqual(['property'])
  })

  it('are called by no word another field is called by', () => {
    expect(sharedWords(structureFields)).toEqual([])
  })

  it('are suggested for a column that is called by any of their words', () => {
    for (const field of structureFields) {
      for (const word of wordsOf(field)) {
        expect(
          suggestedMapping([{ index: 0, name: word, sample: '' }], structureFields),
          word,
        ).toEqual({ [field.key]: 0 })
      }
    }
  })
})

describe('the defaults of an import of places', () => {
  it('are the area, the federal state and the kinds of building somebody chose', () => {
    expect(
      structureDefaultsOf({
        areaId: 'area-north',
        federalState: 'DE-HE',
        buildingKinds: ['school', 'office'],
      }),
    ).toEqual({ areaId: 'area-north', federalState: 'DE-HE', buildingKinds: ['office', 'school'] })
  })

  it('leave out what is no area, no federal state and no kind of building', () => {
    const empty = { areaId: null, federalState: null, buildingKinds: [] }

    expect(
      structureDefaultsOf({ areaId: '', federalState: 'Hessen', buildingKinds: 'school' }),
    ).toEqual(empty)
    expect(
      structureDefaultsOf({ areaId: 7, federalState: 'DE', buildingKinds: ['castle', 7, null] }),
    ).toEqual(empty)
    expect(
      structureDefaultsOf({
        areaId: 'a',
        federalState: 7,
        buildingKinds: ['castle', 'school', 'school'],
      }),
    ).toEqual({ areaId: 'a', federalState: null, buildingKinds: ['school'] })
  })

  it('are none for anything that is no record', () => {
    const empty = { areaId: null, federalState: null, buildingKinds: [] }

    expect(structureDefaultsOf(null)).toEqual(empty)
    expect(structureDefaultsOf(undefined)).toEqual(empty)
    expect(structureDefaultsOf('DE-BW')).toEqual(empty)
    expect(structureDefaultsOf(7)).toEqual(empty)
    expect(structureDefaultsOf([])).toEqual(empty)
    expect(structureDefaultsOf({})).toEqual(empty)
  })
})

describe('the federal state a cell names', () => {
  it('is found by its code, by its two letters and by its name', () => {
    expect(['DE-BW', 'BW', 'Baden-Württemberg'].map(federalStateOf)).toEqual([
      'DE-BW',
      'DE-BW',
      'DE-BW',
    ])
    expect(['Bayern', 'HE', 'DE-NW', 'Sachsen-Anhalt'].map(federalStateOf)).toEqual([
      'DE-BY',
      'DE-HE',
      'DE-NW',
      'DE-ST',
    ])
  })

  it('is found whatever its case and spaces', () => {
    expect(['de-bw', ' bw ', 'baden-württemberg', 'HESSEN', 'B Y'].map(federalStateOf)).toEqual([
      'DE-BW',
      'DE-BW',
      'DE-BW',
      'DE-HE',
      'DE-BY',
    ])
  })

  it('is handed on as written where it names none, for the rule of the property', () => {
    expect(['Atlantis', 'DE', 'Deutschland', ''].map(federalStateOf)).toEqual([
      'Atlantis',
      'DE',
      'Deutschland',
      '',
    ])
  })
})

describe('the kinds of building a cell names', () => {
  it('are found by their key and by their word', () => {
    expect(buildingKindsOf('school')).toEqual(['school'])
    expect(buildingKindsOf('Schule oder Hochschule')).toEqual(['school'])
    expect(buildingKindsOf('büro- und verwaltungsgebäude')).toEqual(['office'])
  })

  it('are found by the beginning of their word where only one kind begins so', () => {
    expect(buildingKindsOf('Schule')).toEqual(['school'])
    expect(buildingKindsOf('Büro')).toEqual(['office'])
    expect(buildingKindsOf('Versammlungs')).toEqual(['assembly'])
    // Three letters are too few to say which kind is meant.
    expect(buildingKindsOf('Gar')).toEqual(['Gar'])
  })

  it('are several where a cell divides them by a semicolon, a stroke or a slash', () => {
    expect(buildingKindsOf('Schule; Versammlungs- oder Sportstätte')).toEqual([
      'school',
      'assembly',
    ])
    expect(buildingKindsOf('Schule | Garage')).toEqual(['school', 'garage'])
    expect(buildingKindsOf('Krankenhaus/Garage')).toEqual(['hospital', 'garage'])
    expect(buildingKindsOf(' Schule ;; ')).toEqual(['school'])
    expect(buildingKindsOf(';')).toEqual([])
  })

  it('are handed on as written where they name none, for the rule of the building', () => {
    expect(buildingKindsOf('Burg')).toEqual(['Burg'])
    expect(buildingKindsOf('Schule; Burg')).toEqual(['school', 'Burg'])
  })
})

describe('a line of a table of places', () => {
  it('is the deepest place it names: a property, a building, a floor or a room', () => {
    const plan = planOf(
      [
        { property: 'Neubau', ...address },
        { property: 'Neubau', building: 'Haus A' },
        { property: 'Neubau', building: 'Haus A', floor: 'EG' },
        {
          property: 'Neubau',
          building: 'Haus A',
          floor: 'EG',
          roomNumber: '0.01',
          roomName: 'Empfang',
          roomUse: 'Büro',
        },
      ],
      { stock: nothing },
    )

    expect(plan).toEqual({
      lines: 4,
      counts: { properties: 1, buildings: 1, floors: 1, rooms: 1, known: 0 },
      problems: [],
      known: [],
      create: {
        properties: [
          {
            id: 'new-1',
            areaId: south,
            name: 'Neubau',
            street: 'Schulstraße 1',
            postalCode: '68535',
            city: 'Edingen-Neckarhausen',
            federalState: 'DE-BW',
            note: null,
          },
        ],
        buildings: [
          {
            id: 'new-2',
            propertyId: 'new-1',
            areaId: south,
            name: 'Haus A',
            shortCode: null,
            kinds: ['school'],
            yearBuilt: null,
          },
        ],
        floors: [
          {
            id: 'new-3',
            buildingId: 'new-2',
            propertyId: 'new-1',
            areaId: south,
            name: 'EG',
            level: 0,
          },
        ],
        rooms: [
          {
            id: 'new-4',
            floorId: 'new-3',
            buildingId: 'new-2',
            propertyId: 'new-1',
            areaId: south,
            number: '0.01',
            name: 'Empfang',
            use: 'Büro',
          },
        ],
      },
    })
  })

  it('makes every place on its way that is not there, each with the ids of all above it', () => {
    const plan = planOf(
      [{ property: 'Neubau', ...address, building: 'Haus A', floor: '1. OG', roomName: 'Flur' }],
      { stock: nothing },
    )

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ properties: 1, buildings: 1, floors: 1, rooms: 1, known: 0 })
    expect(plan.create.properties.map((property) => property.id)).toEqual(['new-1'])
    expect(plan.create.buildings).toMatchObject([{ id: 'new-2', propertyId: 'new-1' }])
    expect(plan.create.floors).toMatchObject([
      { id: 'new-3', buildingId: 'new-2', propertyId: 'new-1', level: 1 },
    ])
    expect(plan.create.rooms).toEqual([
      {
        id: 'new-4',
        floorId: 'new-3',
        buildingId: 'new-2',
        propertyId: 'new-1',
        areaId: south,
        number: null,
        name: 'Flur',
        use: null,
      },
    ])
  })

  it('makes a place once, however many lines name it on their way', () => {
    const plan = planOf(
      [
        { property: 'Neubau', ...address, building: 'Haus A', floor: 'EG', roomNumber: '1' },
        { property: 'neubau', building: 'HAUS A', floor: 'eg', roomNumber: '2' },
        { property: 'Neu bau', building: 'Haus  A', floor: 'E G', roomNumber: '3' },
      ],
      { stock: nothing },
    )

    expect(plan.problems).toEqual([])
    expect(plan.lines).toBe(3)
    expect(plan.counts).toEqual({ properties: 1, buildings: 1, floors: 1, rooms: 3, known: 0 })
    // Written as the first line that names it spells it.
    expect(plan.create.properties.map((property) => property.name)).toEqual(['Neubau'])
    expect(plan.create.buildings.map((building) => building.name)).toEqual(['Haus A'])
    expect(plan.create.rooms.map((room) => [room.id, room.floorId, room.number])).toEqual([
      ['new-4', 'new-3', '1'],
      ['new-5', 'new-3', '2'],
      ['new-6', 'new-3', '3'],
    ])
  })

  it('lists what it makes with the parents before their children', () => {
    const plan = planOf(
      [
        { property: 'Neubau', ...address, building: 'Haus A', floor: 'EG', roomNumber: '1' },
        { property: 'Altbau', ...address, building: 'Haus B', floor: 'EG', roomNumber: '1' },
      ],
      { stock: nothing },
    )

    expect(Object.keys(plan.create)).toEqual(['properties', 'buildings', 'floors', 'rooms'])
    expect(plan.create.properties.map((property) => property.id)).toEqual(['new-1', 'new-5'])
    expect(plan.create.buildings.map((building) => building.propertyId)).toEqual(['new-1', 'new-5'])
    expect(plan.create.floors.map((floor) => floor.buildingId)).toEqual(['new-2', 'new-6'])
    expect(plan.create.rooms.map((room) => room.floorId)).toEqual(['new-3', 'new-7'])
  })

  it('finds a place only within what lies above it: one name under two parents is two places', () => {
    const plan = planOf(
      [
        { property: 'Neubau', ...address, building: 'Haus A', floor: 'EG', roomNumber: '1' },
        { property: 'Neubau', building: 'Haus B', floor: 'EG', roomNumber: '1' },
        { property: 'Altbau', ...address, building: 'Haus A', floor: 'EG', roomNumber: '1' },
      ],
      { stock: nothing },
    )

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ properties: 2, buildings: 3, floors: 3, rooms: 3, known: 0 })
  })
})

describe('a place that is there already', () => {
  it('is found by its name within what lies above it, whatever its case and spaces', () => {
    const plan = planOf([
      { property: 'SCHULZENTRUM' },
      { property: 'schul zentrum', building: 'SchulHaus' },
      { property: 'Schulzentrum', building: 'schul haus', floor: 'ERD GESCHOSS' },
      {
        property: 'Schulzentrum',
        building: 'Schulhaus',
        floor: 'erdgeschoss',
        roomNumber: 'e. 14',
      },
      {
        property: 'Schulzentrum',
        building: 'Schulhaus',
        floor: 'Erdgeschoss',
        roomName: 'TREPPENHAUS  NORD',
      },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ properties: 0, buildings: 0, floors: 0, rooms: 0, known: 5 })
    expect(plan.create).toEqual(none)
    expect(plan.known.map(({ table, id, lines }) => [table, id, lines])).toEqual([
      ['properties', 'p-1', [2]],
      ['buildings', 'b-1', [3]],
      ['floors', 'f-1', [4]],
      ['floors', 'f-1', [5, 6]],
    ])
  })

  it('is never changed, whatever the file says about it', () => {
    const plan = planOf([
      {
        property: 'Schulzentrum',
        street: 'Andere Straße 9',
        postalCode: '99999',
        city: 'Anderswo',
        federalState: 'Bayern',
      },
      {
        ...inSchool,
        street: 'Noch eine Straße 1',
        federalState: 'Atlantis',
        shortCode: 'XX',
        buildingKinds: 'Garage',
        yearBuilt: '1900',
      },
      { ...onGround, shortCode: 'YY', buildingKinds: 'Burg', yearBuilt: 'alt', level: '7' },
      { ...onGround, level: 'oben', roomNumber: 'E.14', roomName: 'Anders', roomUse: 'Anders' },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.create).toEqual(none)
    expect(plan.counts).toEqual({ properties: 0, buildings: 0, floors: 0, rooms: 0, known: 4 })
  })

  it('is not looked for under another parent', () => {
    // The ground floor and its room E.14 are there in the school, not in the gym.
    const plan = planOf([
      { property: 'Schulzentrum', building: 'Turnhalle', floor: 'Erdgeschoss', roomNumber: 'E.14' },
    ])

    expect(plan.known).toEqual([])
    expect(plan.problems).toEqual([])
    expect(plan.create).toEqual({
      properties: [],
      buildings: [],
      floors: [
        {
          id: 'new-1',
          buildingId: gym,
          propertyId: centre,
          areaId: north,
          name: 'Erdgeschoss',
          level: 0,
        },
      ],
      rooms: [
        {
          id: 'new-2',
          floorId: 'new-1',
          buildingId: gym,
          propertyId: centre,
          areaId: north,
          number: 'E.14',
          name: null,
          use: null,
        },
      ],
    })
  })

  it('is shown as known, with its table and its id, by the line that is it and nothing below', () => {
    const plan = planOf([{ property: 'Schulzentrum' }, inSchool, onGround])

    expect(plan.known).toEqual([
      {
        lines: [2],
        inFile: 'Schulzentrum',
        existing: 'Schulzentrum',
        table: 'properties',
        id: 'p-1',
      },
      {
        lines: [3],
        inFile: 'Schulzentrum, Schulhaus',
        existing: 'Schulhaus',
        table: 'buildings',
        id: 'b-1',
      },
      {
        lines: [4],
        inFile: 'Schulzentrum, Schulhaus, Erdgeschoss',
        existing: 'Erdgeschoss',
        table: 'floors',
        id: 'f-1',
      },
    ])
    expect(plan.counts.known).toBe(3)
    expect(plan.create).toEqual(none)
  })

  it('is not known by a line that only names it on its way to something new', () => {
    const plan = planOf([{ ...onGround, roomNumber: 'E.20' }])

    expect(plan.known).toEqual([])
    expect(plan.counts).toEqual({ properties: 0, buildings: 0, floors: 0, rooms: 1, known: 0 })
  })

  it('is shown as that room where it is the one known room of its floor', () => {
    const plan = planOf([
      { ...onGround, roomNumber: 'E.14' },
      { ...onGround, roomNumber: 'E.14', roomName: 'Heizraum' },
    ])

    expect(plan.known).toEqual([
      {
        lines: [2, 3],
        inFile: 'Schulzentrum, Schulhaus, Erdgeschoss, E.14',
        existing: 'Raum E.14',
        table: 'rooms',
        id: 'r-1',
      },
    ])
    // Every line that makes nothing is counted, not every place.
    expect(plan.counts.known).toBe(2)
  })

  it('is shown with the other known rooms of its floor as one entry, that of the floor', () => {
    const plan = planOf([
      { ...onGround, roomNumber: 'E.14' },
      { ...onGround, roomName: 'Treppenhaus Nord' },
      { ...onGround, roomNumber: 'E.15' },
    ])

    expect(plan.known).toEqual([
      {
        lines: [2, 3, 4],
        inFile: '3 Räume: Schulzentrum, Schulhaus, Erdgeschoss',
        existing: 'Erdgeschoss, gleiche Räume',
        table: 'floors',
        id: 'f-1',
      },
    ])
    expect(plan.counts.known).toBe(3)
    expect(plan.problems).toEqual([])
  })

  it('stands in the list of the known in the order of the lines', () => {
    const plan = planOf([
      { ...onGround, roomNumber: 'E.14' },
      { property: 'Schulzentrum', building: 'Turnhalle' },
      { ...onGround, roomNumber: 'E.15' },
      { property: 'Schulzentrum' },
    ])

    expect(plan.known.map(({ table, id, lines }) => [table, id, lines])).toEqual([
      ['floors', 'f-1', [2, 4]],
      ['buildings', 'b-2', [3]],
      ['properties', 'p-1', [5]],
    ])
  })
})

describe('a new place', () => {
  it('takes the area of the property it lies in, not the default', () => {
    const plan = planOf([
      { property: 'Schulzentrum', building: 'Mensa', floor: 'EG', roomNumber: '0.1' },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.create).toEqual({
      properties: [],
      buildings: [
        {
          id: 'new-1',
          propertyId: centre,
          areaId: north,
          name: 'Mensa',
          shortCode: null,
          kinds: ['school'],
          yearBuilt: null,
        },
      ],
      floors: [
        {
          id: 'new-2',
          buildingId: 'new-1',
          propertyId: centre,
          areaId: north,
          name: 'EG',
          level: 0,
        },
      ],
      rooms: [
        {
          id: 'new-3',
          floorId: 'new-2',
          buildingId: 'new-1',
          propertyId: centre,
          areaId: north,
          number: '0.1',
          name: null,
          use: null,
        },
      ],
    })
  })

  it('takes the default area where its property is new, and so does everything under it', () => {
    const plan = planOf([
      { property: 'Neubau', ...address, building: 'Haus A', floor: 'EG', roomNumber: '1' },
    ])
    const areas = [
      ...plan.create.properties,
      ...plan.create.buildings,
      ...plan.create.floors,
      ...plan.create.rooms,
    ].map((place) => place.areaId)

    expect(areas).toEqual([south, south, south, south])
  })

  it('collects what the lines say about it, whichever of them says it', () => {
    const inHouse = { property: 'Neubau', building: 'Haus A', floor: 'EG' }
    const plan = planOf(
      [
        { ...inHouse, yearBuilt: '1972', roomNumber: '1' },
        { ...inHouse, street: 'Schulstraße 1', shortCode: 'A', roomNumber: '2' },
        {
          ...inHouse,
          postalCode: '68535',
          city: 'Edingen-Neckarhausen',
          federalState: 'Hessen',
          buildingKinds: 'Garage',
          level: '1',
          roomNumber: '3',
        },
      ],
      { stock: nothing },
    )

    expect(plan.problems).toEqual([])
    expect(plan.create.properties).toEqual([
      {
        id: 'new-1',
        areaId: south,
        name: 'Neubau',
        street: 'Schulstraße 1',
        postalCode: '68535',
        city: 'Edingen-Neckarhausen',
        federalState: 'DE-HE',
        note: null,
      },
    ])
    expect(plan.create.buildings).toEqual([
      {
        id: 'new-2',
        propertyId: 'new-1',
        areaId: south,
        name: 'Haus A',
        shortCode: 'A',
        kinds: ['garage'],
        yearBuilt: 1972,
      },
    ])
    expect(plan.create.floors).toMatchObject([{ id: 'new-3', name: 'EG', level: 1 }])
    expect(plan.create.rooms).toHaveLength(3)
  })

  it('is a problem of two lines that say different things about it', () => {
    const inHouse = { property: 'Neubau', building: 'Haus A', floor: 'EG' }
    const said = (first: Row, second: Row) =>
      planOf(
        [
          { ...inHouse, ...address, roomNumber: '1', ...first },
          { ...inHouse, roomNumber: '2', ...second },
        ],
        { stock: nothing },
      ).problems

    expect(said({}, { street: 'Nebenstraße 2' })).toEqual([
      {
        lines: [2, 3],
        what: 'Die Liegenschaft „Neubau“ steht mit zwei Angaben für die Straße in der Datei: „Schulstraße 1“ und „Nebenstraße 2“',
        next: correctTheFile,
      },
    ])
    expect(said({}, { postalCode: '68536' }).map((problem) => problem.what)).toEqual([
      'Die Liegenschaft „Neubau“ steht mit zwei Angaben für die Postleitzahl in der Datei: „68535“ und „68536“',
    ])
    expect(said({}, { city: 'Ladenburg' }).map((problem) => problem.what)).toEqual([
      'Die Liegenschaft „Neubau“ steht mit zwei Angaben für den Ort in der Datei: „Edingen-Neckarhausen“ und „Ladenburg“',
    ])
    expect(
      said({ federalState: 'Hessen' }, { federalState: 'Bayern' }).map((problem) => problem.what),
    ).toEqual([
      'Die Liegenschaft „Neubau“ steht mit zwei Angaben für das Bundesland in der Datei: „Hessen“ und „Bayern“',
    ])
    expect(said({ shortCode: 'A' }, { shortCode: 'B' }).map((problem) => problem.what)).toEqual([
      'Das Gebäude „Haus A“ steht mit zwei Angaben für das Kürzel in der Datei: „A“ und „B“',
    ])
    expect(
      said({ buildingKinds: 'Schule' }, { buildingKinds: 'Garage' }).map((problem) => problem.what),
    ).toEqual([
      'Das Gebäude „Haus A“ steht mit zwei Angaben für die Gebäudeart in der Datei: „Schule“ und „Garage“',
    ])
    expect(
      said({ yearBuilt: '1972' }, { yearBuilt: '1973' }).map((problem) => problem.what),
    ).toEqual([
      'Das Gebäude „Haus A“ steht mit zwei Angaben für das Baujahr in der Datei: „1972“ und „1973“',
    ])
    expect(said({ level: '0' }, { level: '1' })).toEqual([
      {
        lines: [2, 3],
        what: 'Das Geschoss „EG“ im Gebäude „Haus A“ steht mit zwei Angaben für die Ebene in der Datei: „0“ und „1“',
        next: correctTheFile,
      },
    ])
  })

  it('names the two lines that say different things, not the line that named it first', () => {
    const inHouse = { property: 'Neubau', building: 'Haus A', floor: 'EG' }
    const plan = planOf(
      [
        { ...inHouse, roomNumber: '1' },
        { ...inHouse, ...address, roomNumber: '2' },
        { ...inHouse, street: 'Nebenstraße 2', roomNumber: '3' },
      ],
      { stock: nothing },
    )

    expect(plan.problems).toEqual([
      {
        lines: [3, 4],
        what: 'Die Liegenschaft „Neubau“ steht mit zwei Angaben für die Straße in der Datei: „Schulstraße 1“ und „Nebenstraße 2“',
        next: correctTheFile,
      },
    ])
  })

  it('is no problem where two lines say the same in other case or with other spaces', () => {
    const inHouse = { property: 'Neubau', building: 'Haus A', floor: 'EG' }
    const plan = planOf(
      [
        { ...inHouse, ...address, shortCode: 'HA 1', roomNumber: '1' },
        { ...inHouse, street: 'SCHULSTRAßE  1', shortCode: 'ha1', roomNumber: '2' },
        { ...inHouse, ...address, roomNumber: '3' },
      ],
      { stock: nothing },
    )

    expect(plan.problems).toEqual([])
    // Kept is what was said first.
    expect(plan.create.properties.map((property) => property.street)).toEqual(['Schulstraße 1'])
    expect(plan.create.buildings.map((building) => building.shortCode)).toEqual(['HA 1'])
  })
})

describe('two places of one name', () => {
  const rename = 'Eines davon umbenennen, dann ist klar, welches gemeint ist'

  it('are a problem where both are there: nobody can say which one a line means', () => {
    const twice = planOf([{ property: 'Schul Zentrum', building: 'Mensa' }], {
      stock: {
        ...stock,
        properties: [
          ...stock.properties,
          { id: 'p-2' as PropertyId, name: 'schulzentrum', areaId: south },
        ],
      },
    })

    expect(twice.problems).toEqual([
      { lines: [2], what: 'Die Liegenschaft „Schul Zentrum“ gibt es mehrfach', next: rename },
    ])
    // The line is left alone: nothing is made under either of the two.
    expect(twice.counts).toEqual({ properties: 0, buildings: 0, floors: 0, rooms: 0, known: 0 })
    expect(twice.create).toEqual(none)
  })

  it('are a problem for a building, a floor and a room that are there twice as well', () => {
    const building = planOf([{ ...inSchool, floor: 'Dach' }], {
      stock: {
        ...stock,
        buildings: [
          ...stock.buildings,
          { id: 'b-9' as BuildingId, propertyId: centre, name: 'Schul Haus' },
        ],
      },
    })
    const floor = planOf([{ ...onGround, roomNumber: 'E.99' }], {
      stock: {
        ...stock,
        floors: [
          ...stock.floors,
          { id: 'f-9' as FloorId, buildingId: school, name: 'ERDGESCHOSS' },
        ],
      },
    })
    const room = planOf([{ ...onGround, roomNumber: 'E.14' }], {
      stock: {
        ...stock,
        rooms: [
          ...stock.rooms,
          { id: 'r-9' as RoomId, floorId: ground, buildingId: school, number: 'e.14', name: null },
        ],
      },
    })

    expect(building.problems).toEqual([
      { lines: [2], what: 'Das Gebäude „Schulhaus“ gibt es mehrfach', next: rename },
    ])
    expect(floor.problems).toEqual([
      {
        lines: [2],
        what: 'Das Geschoss „Erdgeschoss“ im Gebäude „Schulhaus“ gibt es mehrfach',
        next: rename,
      },
    ])
    expect(room.problems).toHaveLength(1)
    expect(room.problems[0]).toMatchObject({ lines: [2], next: rename })
    expect(room.problems[0]?.what).toBe('Den Raum „E.14“ im Gebäude „Schulhaus“ gibt es mehrfach')
    expect([building.counts.floors, floor.counts.rooms, room.counts.known]).toEqual([0, 0, 0])
  })

  it('are no problem under two parents', () => {
    const plan = planOf(
      [{ property: 'Schulzentrum', building: 'Turnhalle', floor: 'Erdgeschoss' }],
      {
        stock: {
          ...stock,
          floors: [...stock.floors, { id: 'f-9' as FloorId, buildingId: gym, name: 'Erdgeschoss' }],
        },
      },
    )

    expect(plan.problems).toEqual([])
    expect(plan.known.map(({ table, id }) => [table, id])).toEqual([['floors', 'f-9']])
  })

  it('are a problem where a new room stands twice in the file', () => {
    const plan = planOf([
      { ...onGround, roomNumber: 'E.20', roomName: 'Büro' },
      { ...onGround, roomNumber: 'e.20', roomName: 'Lager' },
      { ...onGround, roomNumber: 'E.21' },
      { ...onGround, roomNumber: 'E. 20' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2, 3, 5],
        what: 'Der Raum „E.20“ im Gebäude „Schulhaus“ steht zweimal in der Datei',
        next: 'Eine der beiden Zeilen streichen',
      },
    ])
    expect(plan.counts.rooms).toBe(2)
    expect(plan.create).toEqual(none)
  })

  it('are a problem where a new building is the deepest place of two lines', () => {
    const plan = planOf([
      { property: 'Schulzentrum', building: 'Mensa' },
      { property: 'Schulzentrum', building: 'Mensa', floor: 'EG' },
      { property: 'Schulzentrum', building: 'mensa' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2, 4],
        what: 'Das Gebäude „Mensa“ steht zweimal in der Datei',
        next: 'Eine der beiden Zeilen streichen',
      },
    ])
    expect(plan.counts).toEqual({ properties: 0, buildings: 1, floors: 1, rooms: 0, known: 0 })
  })

  it('are a problem for a new property and a new floor that stand twice as well', () => {
    const property = planOf([
      { property: 'Neubau', ...address },
      { property: 'Neubau', ...address },
    ])
    const floor = planOf([
      { ...inSchool, floor: '2. OG' },
      { ...inSchool, floor: '2. OG', level: '2' },
    ])

    expect(property.problems.map(({ lines, what }) => [lines, what])).toEqual([
      [[2, 3], 'Die Liegenschaft „Neubau“ steht zweimal in der Datei'],
    ])
    expect(floor.problems.map(({ lines, what }) => [lines, what])).toEqual([
      [[2, 3], 'Das Geschoss „2. OG“ im Gebäude „Schulhaus“ steht zweimal in der Datei'],
    ])
  })

  it('are no problem where one line is the place and the others only pass it', () => {
    const plan = planOf([
      { property: 'Schulzentrum', building: 'Mensa', floor: 'EG', roomNumber: '1' },
      { property: 'Schulzentrum', building: 'Mensa' },
      { property: 'Schulzentrum', building: 'Mensa', floor: 'EG' },
      { property: 'Schulzentrum', building: 'Mensa', floor: 'EG', roomNumber: '2' },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ properties: 0, buildings: 1, floors: 1, rooms: 2, known: 0 })
  })
})

describe('a room', () => {
  it('is known by its number, whatever the line calls it', () => {
    const plan = planOf([{ ...onGround, roomNumber: 'e. 14', roomName: 'Ganz anders' }])

    expect(plan.known.map(({ table, id }) => [table, id])).toEqual([['rooms', 'r-1']])
    expect(plan.counts.rooms).toBe(0)
  })

  it('is known by its name where it has no number', () => {
    const plan = planOf([{ ...onGround, roomName: 'treppenhaus nord' }])

    expect(plan.known.map(({ table, id }) => [table, id])).toEqual([['rooms', 'r-2']])
    expect(plan.counts.rooms).toBe(0)
  })

  it('is known by its name alone where the line gives no number, though the room has one', () => {
    // A list without a column of numbers names the boiler room, and that is E.14.
    const plan = planOf([{ ...onGround, roomName: 'heizraum' }])

    expect(plan.problems).toEqual([])
    expect(plan.known.map(({ table, id }) => [table, id])).toEqual([['rooms', 'r-1']])
    expect(plan.counts.rooms).toBe(0)
  })

  it('is a problem where the line gives no number and two rooms of the floor carry its name', () => {
    const plan = planOf([{ ...onGround, roomName: 'Heizraum' }], {
      stock: {
        ...stock,
        rooms: [
          ...stock.rooms,
          {
            id: 'r-9' as RoomId,
            floorId: ground,
            buildingId: school,
            number: 'E.19',
            name: 'Heizraum',
          },
        ],
      },
    })

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Den Raum „Heizraum“ im Gebäude „Schulhaus“ gibt es mehrfach',
        next: 'Die Raumnummer in der Datei nennen oder einen der Räume umbenennen',
      },
    ])
    expect(plan.create).toEqual(none)
  })

  it('is not looked for by its name on another floor', () => {
    const plan = planOf([{ ...inSchool, floor: '1. OG', roomName: 'Heizraum' }])

    expect(plan.known).toEqual([])
    expect(plan.create.rooms).toMatchObject([{ number: null, name: 'Heizraum', floorId: upper }])
  })

  it('is another room where the number is another, though the name is the same', () => {
    const plan = planOf([{ ...onGround, roomNumber: 'E.16', roomName: 'Heizraum' }])

    expect(plan.known).toEqual([])
    expect(plan.create.rooms).toMatchObject([{ number: 'E.16', name: 'Heizraum', floorId: ground }])
  })

  it('is told apart from a new room by its number, and by its name only where neither has one', () => {
    const numbered = planOf([
      { ...onGround, roomNumber: 'E.20', roomName: 'Büro' },
      { ...onGround, roomNumber: 'E.21', roomName: 'Büro' },
    ])
    const named = planOf([
      { ...onGround, roomName: 'Lager' },
      { ...onGround, roomName: 'Archiv' },
      { ...onGround, roomName: 'lager' },
    ])
    // A number is never held against a name.
    const mixed = planOf([
      { ...onGround, roomNumber: '7' },
      { ...onGround, roomName: '7' },
    ])

    expect(numbered.problems).toEqual([])
    expect(numbered.create.rooms.map((room) => room.number)).toEqual(['E.20', 'E.21'])
    expect(named.problems.map(({ lines, what }) => [lines, what])).toEqual([
      [[2, 4], 'Der Raum „Lager“ im Gebäude „Schulhaus“ steht zweimal in der Datei'],
    ])
    expect(mixed.problems).toEqual([])
    expect(mixed.create.rooms.map((room) => [room.number, room.name])).toEqual([
      ['7', null],
      [null, '7'],
    ])
  })

  it('is made with its number, its name and its use as the line says them', () => {
    const plan = planOf([
      { ...onGround, roomNumber: 'E.20', roomName: 'Büro', roomUse: 'Verwaltung' },
      { ...onGround, roomName: 'Flur West' },
      { ...onGround, roomNumber: 'E.22', roomUse: 'Lager' },
    ])

    expect(plan.create.rooms.map(({ number, name, use }) => [number, name, use])).toEqual([
      ['E.20', 'Büro', 'Verwaltung'],
      [null, 'Flur West', null],
      ['E.22', null, 'Lager'],
    ])
  })
})

describe('a line that leaves out a level', () => {
  it('is a problem: the property, the building or the floor is missing', () => {
    const plan = planOf([
      { building: 'Schulhaus' },
      { property: 'Schulzentrum', floor: 'Erdgeschoss' },
      { property: 'Schulzentrum', roomNumber: 'E.14' },
      { ...inSchool, roomName: 'Büro' },
      { ...inSchool, roomUse: 'Lager' },
      { roomNumber: '1' },
      { ...inSchool, roomNumber: 'E.14' },
    ])

    expect(plan.problems).toEqual([
      { lines: [2, 7], what: 'Die Liegenschaft fehlt', next: correctTheFile },
      { lines: [3, 4], what: 'Das Gebäude fehlt', next: correctTheFile },
      { lines: [5, 6, 8], what: 'Das Geschoss fehlt', next: correctTheFile },
    ])
    // None of these lines is what stands above the gap.
    expect(plan.known).toEqual([])
    expect(plan.counts).toEqual({ properties: 0, buildings: 0, floors: 0, rooms: 0, known: 0 })
    expect(plan.lines).toBe(7)
  })
})

describe('what a list rarely says', () => {
  const whole = { property: 'Neubau', ...address, building: 'Haus A', floor: 'EG' }

  it('is a problem of the first step where no area for new properties was chosen', () => {
    const plan = planOf(
      [
        { ...whole, roomNumber: '1' },
        { ...whole, roomNumber: '2' },
      ],
      { defaults: { ...defaults, areaId: null } },
    )

    expect(plan.problems).toEqual([
      {
        lines: [2, 3],
        what: 'Der Bereich neuer Liegenschaften fehlt',
        next: 'Im ersten Schritt einen Bereich wählen',
      },
    ])
    expect(plan.create).toEqual(none)
    expect(plan.counts).toEqual({ properties: 1, buildings: 1, floors: 1, rooms: 2, known: 0 })
  })

  it('is not asked for where no property is new', () => {
    const plan = planOf(
      [
        { ...onGround, roomNumber: 'E.20' },
        { ...inSchool, floor: '2. OG' },
      ],
      {
        defaults: { areaId: null, federalState: null, buildingKinds: [] },
      },
    )

    expect(plan.problems).toEqual([])
    expect(plan.create.rooms.map((room) => room.areaId)).toEqual([north])
    expect(plan.create.floors.map((floor) => floor.areaId)).toEqual([north])
  })

  it('is a problem of the first step where a new property has no federal state', () => {
    const plan = planOf([whole], { defaults: { ...defaults, federalState: null } })

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Liegenschaft „Neubau“: Das Bundesland fehlt',
        next: 'Im ersten Schritt ein Bundesland wählen oder die Datei berichtigen',
      },
    ])
  })

  it('is a problem of the first step where a new building has no kind', () => {
    const plan = planOf([whole, { ...inSchool, building: 'Mensa' }], {
      defaults: { ...defaults, buildingKinds: [] },
    })

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Gebäude „Haus A“: Ein Gebäude hat mindestens eine Gebäudeart',
        next: 'Im ersten Schritt eine Gebäudeart wählen oder die Datei berichtigen',
      },
      {
        lines: [3],
        what: 'Gebäude „Mensa“: Ein Gebäude hat mindestens eine Gebäudeart',
        next: 'Im ersten Schritt eine Gebäudeart wählen oder die Datei berichtigen',
      },
    ])
  })

  it('comes from the defaults: the federal state of a property and the kinds of a building', () => {
    const plan = planOf([whole], {
      defaults: { areaId: north, federalState: 'DE-HE', buildingKinds: ['office', 'assembly'] },
    })

    expect(plan.create.properties).toMatchObject([{ areaId: north, federalState: 'DE-HE' }])
    expect(plan.create.buildings).toMatchObject([{ areaId: north, kinds: ['office', 'assembly'] }])
  })

  it('comes from a column before the default: the federal state by name, letters or code', () => {
    const plan = planOf([
      { ...whole, property: 'Nord', federalState: 'Hessen' },
      { ...whole, property: 'Mitte', federalState: 'by' },
      { ...whole, property: 'Süd', federalState: 'DE-NW' },
      { ...whole, property: 'West' },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.create.properties.map((property) => property.federalState)).toEqual([
      'DE-HE',
      'DE-BY',
      'DE-NW',
      'DE-BW',
    ])
  })

  it('is the sentence of the property where a column names no federal state', () => {
    // The column goes before what the first step chose, so only the file helps.
    const plan = planOf([{ ...whole, federalState: 'Atlantis' }])

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Liegenschaft „Neubau“: Das Bundesland ist keines der sechzehn Länder',
        next: correctTheFile,
      },
    ])
  })

  it('comes from a column before the default: the kinds of a building', () => {
    const plan = planOf([
      { ...whole, building: 'Haus A', buildingKinds: 'Schule; Versammlungs- oder Sportstätte' },
      { ...whole, building: 'Haus B', buildingKinds: 'garage' },
      { ...whole, building: 'Haus C' },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.create.buildings.map((building) => building.kinds)).toEqual([
      ['school', 'assembly'],
      ['garage'],
      ['school'],
    ])
  })

  it('is the sentence of the building where a column names a kind there is not, or one twice', () => {
    const plan = planOf([
      { ...whole, building: 'Haus A', buildingKinds: 'Schule; Burg' },
      { ...whole, building: 'Haus B', buildingKinds: 'Schule; school' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Gebäude „Haus A“: Eine der Gebäudearten gibt es nicht',
        next: correctTheFile,
      },
      {
        lines: [3],
        what: 'Gebäude „Haus B“: Eine Gebäudeart steht doppelt',
        next: correctTheFile,
      },
    ])
  })
})

describe('the level of a new floor', () => {
  const levelsOf = (rows: readonly Row[]) =>
    planOf(rows).create.floors.map((floor) => [floor.name, floor.level])

  it('is read from its name', () => {
    expect(
      levelsOf([
        { ...inSchool, floor: 'EG' },
        { ...inSchool, floor: '2. OG' },
        { ...inSchool, floor: 'UG' },
      ]),
    ).toEqual([
      ['EG', 0],
      ['2. OG', 2],
      ['UG', -1],
    ])
  })

  it('is the one a column gives, before what the name says and where the name says nothing', () => {
    expect(
      levelsOf([
        { ...inSchool, floor: '3. OG', level: '4' },
        { ...inSchool, floor: 'Dach', level: '5' },
        { ...inSchool, floor: 'Tiefgarage', level: '-2' },
      ]),
    ).toEqual([
      ['3. OG', 4],
      ['Dach', 5],
      ['Tiefgarage', -2],
    ])
  })

  it('is a problem where neither a column nor the name says it', () => {
    const plan = planOf([
      { ...inSchool, floor: 'Dach', roomNumber: 'D.1' },
      { ...inSchool, floor: 'Dach', roomNumber: 'D.2' },
      { ...inSchool, floor: 'Dach' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Die Ebene ist aus der Bezeichnung nicht zu lesen: Geschoss „Dach“ im Gebäude „Schulhaus“',
        next: 'Eine Spalte „Ebene“ zuordnen: 0 ist das Erdgeschoss',
      },
    ])
    expect(plan.create).toEqual(none)
  })

  it('is the sentence of the floor where the column holds no level', () => {
    const sentence =
      `Die Ebene ist eine ganze Zahl von ${String(locationLimits.lowestLevel)} bis ${String(locationLimits.highestLevel)}: ` +
      '0 ist das Erdgeschoss, darunter liegen die Untergeschosse'
    const plan = planOf([
      { ...inSchool, floor: 'Dach', level: 'oben' },
      { ...inSchool, floor: 'Turm', level: '300' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: `Geschoss „Dach“ im Gebäude „Schulhaus“: ${sentence}`,
        next: correctTheFile,
      },
      {
        lines: [3],
        what: `Geschoss „Turm“ im Gebäude „Schulhaus“: ${sentence}`,
        next: correctTheFile,
      },
    ])
  })

  it('is not asked of a floor that is there', () => {
    const plan = planOf([{ ...inSchool, floor: 'Dachboden', roomNumber: 'D.1' }], {
      stock: {
        ...stock,
        floors: [...stock.floors, { id: 'f-9' as FloorId, buildingId: school, name: 'Dachboden' }],
      },
    })

    expect(plan.problems).toEqual([])
    expect(plan.create.rooms).toMatchObject([{ floorId: 'f-9', number: 'D.1' }])
  })
})

describe('what the rules of a place say about a new one', () => {
  const sorted = (whats: readonly string[]) => [...whats].sort()

  it('is said of a property without its address', () => {
    const plan = planOf([{ property: 'Neubau' }])

    expect(sorted(plan.problems.map((problem) => problem.what))).toEqual(
      sorted([
        'Liegenschaft „Neubau“: Die Straße fehlt',
        'Liegenschaft „Neubau“: Die Postleitzahl hat fünf Ziffern',
        'Liegenschaft „Neubau“: Der Ort fehlt',
      ]),
    )
    expect(plan.problems.map(({ lines, next }) => [lines, next])).toEqual([
      [[2], correctTheFile],
      [[2], correctTheFile],
      [[2], correctTheFile],
    ])
  })

  it('is said of a property by the first line that names it', () => {
    const plan = planOf([
      { ...inSchool, roomNumber: 'E.14', floor: 'Erdgeschoss' },
      { property: 'Neubau', ...address, postalCode: '6853', building: 'Haus A' },
      { property: 'Neubau', building: 'Haus B' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [3],
        what: 'Liegenschaft „Neubau“: Die Postleitzahl hat fünf Ziffern',
        next: correctTheFile,
      },
    ])
  })

  it('is said of a building: its year and its short code', () => {
    const year = `Das Baujahr ist eine ganze Zahl von ${String(locationLimits.earliestYearBuilt)} bis ${String(locationLimits.latestYearBuilt)}`
    const plan = planOf([
      { property: 'Schulzentrum', building: 'Mensa', yearBuilt: 'um 1900' },
      { property: 'Schulzentrum', building: 'Aula', yearBuilt: '999' },
      {
        property: 'Schulzentrum',
        building: 'Werkstatt',
        shortCode: 'x'.repeat(locationLimits.shortCode + 1),
      },
      { property: 'Schulzentrum', building: 'Hort', yearBuilt: '1972', shortCode: 'H' },
    ])

    expect(plan.problems).toEqual([
      { lines: [2], what: `Gebäude „Mensa“: ${year}`, next: correctTheFile },
      { lines: [3], what: `Gebäude „Aula“: ${year}`, next: correctTheFile },
      {
        lines: [4],
        what: `Gebäude „Werkstatt“: Das Kürzel hat höchstens ${String(locationLimits.shortCode)} Zeichen`,
        next: correctTheFile,
      },
    ])
  })

  it('is said of a floor: its name', () => {
    const long = 'x'.repeat(locationLimits.floorName + 1)
    const plan = planOf([{ ...inSchool, floor: long, level: '3' }])

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: `Geschoss „${long}“ im Gebäude „Schulhaus“: Die Bezeichnung hat höchstens ${String(locationLimits.floorName)} Zeichen`,
        next: correctTheFile,
      },
    ])
  })

  it('is said of a room: its number, and that it has a number or a name', () => {
    const long = 'x'.repeat(locationLimits.roomNumber + 1)
    const plan = planOf([
      { ...onGround, roomNumber: long },
      { ...onGround, roomUse: 'Lager' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: `Raum „${long}“ im Gebäude „Schulhaus“: Die Raumnummer hat höchstens ${String(locationLimits.roomNumber)} Zeichen`,
        next: correctTheFile,
      },
      {
        lines: [3],
        what: 'Raum „“ im Gebäude „Schulhaus“: Ein Raum hat eine Nummer oder eine Bezeichnung',
        next: correctTheFile,
      },
    ])
  })

  it('never ends in a full stop', () => {
    const plan = planOf(
      [
        { property: 'Neubau', building: 'Haus A', yearBuilt: 'alt', floor: 'Dach', level: 'oben' },
        { property: 'Neubau', building: 'Haus A', floor: 'Dach', roomUse: 'Lager' },
      ],
      { defaults: { areaId: south, federalState: null, buildingKinds: [] } },
    )

    expect(plan.problems.length).toBeGreaterThan(6)
    expect(plan.problems.filter((problem) => problem.what.endsWith('.'))).toEqual([])
  })
})

describe('the same problem in many lines', () => {
  it('is one entry with all of them', () => {
    const inHouse = { property: 'Neubau', building: 'Haus A', floor: 'EG' }
    const plan = planOf(
      [
        { ...inHouse, ...address, roomNumber: '1' },
        { ...inHouse, street: 'Nebenstraße 2', roomNumber: '2' },
        { ...inHouse, street: 'Nebenstraße 2', roomNumber: '3' },
        { building: 'Haus A' },
        { ...inHouse, street: 'Nebenstraße 2', roomNumber: '4' },
        { building: 'Haus B' },
      ],
      { stock: nothing },
    )

    expect(plan.problems).toEqual([
      {
        lines: [2, 3, 4, 6],
        what: 'Die Liegenschaft „Neubau“ steht mit zwei Angaben für die Straße in der Datei: „Schulstraße 1“ und „Nebenstraße 2“',
        next: correctTheFile,
      },
      { lines: [5, 7], what: 'Die Liegenschaft fehlt', next: correctTheFile },
    ])
  })
})

describe('a plan with a problem', () => {
  it('writes nothing, and still says what its lines would make', () => {
    const plan = planOf(
      [
        {
          property: 'Neubau',
          ...address,
          building: 'Haus A',
          floor: 'EG',
          roomNumber: '1',
        },
        { ...onGround, roomNumber: 'E.14' },
        { building: 'Haus B' },
      ],
      { stock },
    )

    expect(plan.problems).toEqual([
      { lines: [4], what: 'Die Liegenschaft fehlt', next: correctTheFile },
    ])
    expect(plan.create).toEqual(none)
    expect(plan.counts).toEqual({ properties: 1, buildings: 1, floors: 1, rooms: 1, known: 1 })
    expect(plan.known).toHaveLength(1)
    expect(plan.lines).toBe(3)
  })

  it('writes everything once the problem is gone', () => {
    const plan = planOf([
      { property: 'Neubau', ...address, building: 'Haus A', floor: 'EG', roomNumber: '1' },
      { ...onGround, roomNumber: 'E.14' },
    ])

    expect(plan.problems).toEqual([])
    expect([
      plan.create.properties.length,
      plan.create.buildings.length,
      plan.create.floors.length,
      plan.create.rooms.length,
    ]).toEqual([1, 1, 1, 1])
  })

  it('is empty for a table without lines', () => {
    expect(planOf([])).toEqual({
      lines: 0,
      counts: { properties: 0, buildings: 0, floors: 0, rooms: 0, known: 0 },
      problems: [],
      known: [],
      create: none,
    })
  })
})

describe('what an import of places made, in words', () => {
  const counts = { properties: 0, buildings: 0, floors: 0, rooms: 0, known: 0 }

  it('names every kind of place it made, with its count', () => {
    expect(
      structureSummary({ properties: 3, buildings: 5, floors: 12, rooms: 396, known: 0 }),
    ).toBe('3 Liegenschaften, 5 Gebäude, 12 Geschosse und 396 Räume angelegt')
  })

  it('takes the word for one where it made one', () => {
    expect(structureSummary({ properties: 1, buildings: 1, floors: 1, rooms: 1, known: 0 })).toBe(
      '1 Liegenschaft, 1 Gebäude, 1 Geschoss und 1 Raum angelegt',
    )
  })

  it('leaves out what it made none of, and what was known', () => {
    expect(structureSummary({ ...counts, properties: 3, buildings: 5, rooms: 396 })).toBe(
      '3 Liegenschaften, 5 Gebäude und 396 Räume angelegt',
    )
    expect(structureSummary({ ...counts, floors: 2, known: 40 })).toBe('2 Geschosse angelegt')
    expect(structureSummary({ ...counts, rooms: 1 })).toBe('1 Raum angelegt')
    expect(structureSummary({ ...counts, properties: 2, rooms: 1200 })).toBe(
      '2 Liegenschaften und 1.200 Räume angelegt',
    )
  })

  it('counts in all what was made, without what was known', () => {
    expect(structureTotal({ properties: 3, buildings: 5, floors: 12, rooms: 396, known: 40 })).toBe(
      416,
    )
    expect(structureTotal(counts)).toBe(0)
  })
})

describe('a federal state written without its hyphen', () => {
  it('is the same federal state', () => {
    expect(
      ['Baden Württemberg', 'nordrhein westfalen', 'Mecklenburg  Vorpommern', 'Sachsen_Anhalt'].map(
        federalStateOf,
      ),
    ).toEqual(['DE-BW', 'DE-NW', 'DE-MV', 'DE-ST'])
  })

  it('is still none where the letters name none', () => {
    expect(federalStateOf('Baden')).toBe('Baden')
  })
})

describe('an import of places that made nothing, in words', () => {
  it('says so in place of an empty list', () => {
    expect(structureSummary({ properties: 0, buildings: 0, floors: 0, rooms: 0, known: 4 })).toBe(
      'Nichts angelegt',
    )
  })
})
