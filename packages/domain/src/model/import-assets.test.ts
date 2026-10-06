import {
  suggestedMapping,
  type TableField,
  tableNameKey,
  type TableRecord,
} from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import type { AreaId } from './area.js'
import { type AssetId, assetLimits } from './asset.js'
import type { AssetKind } from './catalogue.js'
import { correctTheFile } from './import.js'
import {
  assetImportFields,
  type AssetImportStock,
  assetImportSummary,
  decisionsOf,
  type DuplicateDecision,
  generalKindOf,
  type KindChoice,
  kindNameKey,
  kindNamesIn,
  kindNamesLimit,
  kindNamesProblem,
  planAssets,
  suggestedKind,
} from './import-assets.js'
import type { BuildingId, FloorId, PropertyId, RoomId } from './location.js'
import { meterUnitSymbol } from './meter.js'

const north = 'area-north' as AreaId
const south = 'area-south' as AreaId
const centre = 'p-1' as PropertyId
const townHall = 'p-2' as PropertyId
const school = 'b-1' as BuildingId
const gym = 'b-2' as BuildingId
const oldWing = 'b-3' as BuildingId
const ground = 'f-1' as FloorId
const upper = 'f-2' as FloorId

const kind = (label: string, costGroup: string, meter: AssetKind['meter'] = null): AssetKind => ({
  label,
  costGroup,
  characteristics: [],
  fields: [],
  expectedDocuments: [],
  meter,
})

/** The catalogue of the day: two kinds that are no measuring point and two that are. */
const kinds: ReadonlyMap<string, AssetKind> = new Map<string, AssetKind>([
  ['probe.extinguisher', kind('Feuerlöscher', '474')],
  ['probe.storage_tank', kind('Warmwasserspeicher', '421')],
  [
    'probe.heat_meter',
    kind('Wärmemengenzähler', '421', {
      medium: 'heat',
      units: ['kilowatt_hours', 'megawatt_hours'],
    }),
  ],
  ['probe.water_meter', kind('Wasserzähler', '412', { medium: 'water', units: ['cubic_metres'] })],
])

/**
 * What is there: a school with two floors, whose rooms are chosen to be mistaken for each
 * other, a second property in another area, two assets and the words the tenant has mapped.
 */
const stock: AssetImportStock = {
  properties: [
    { id: centre, name: 'Schulzentrum', areaId: north },
    { id: townHall, name: 'Rathaus', areaId: south },
  ],
  buildings: [
    { id: school, propertyId: centre, name: 'Schulhaus' },
    { id: gym, propertyId: centre, name: 'Turnhalle' },
    { id: oldWing, propertyId: townHall, name: 'Altbau' },
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
    // One number on two floors.
    { id: 'r-3' as RoomId, floorId: ground, buildingId: school, number: '01', name: 'Lager' },
    { id: 'r-4' as RoomId, floorId: upper, buildingId: school, number: '01', name: 'Archiv' },
    // A room that is called what stands on the door of another.
    { id: 'r-5' as RoomId, floorId: upper, buildingId: school, number: '7', name: 'E.14' },
  ],
  assets: [
    {
      id: 'a-1' as AssetId,
      number: 'A-0001',
      name: 'Kessel 1',
      serialNumber: 'BT-750-22-0193',
      mark: 'TW-01',
    },
    { id: 'a-2' as AssetId, number: null, name: 'Pumpe Nord', serialNumber: null, mark: 'P-07' },
  ],
  kindNames: [
    { name: 'Feuerlöscher', kind: 'probe.extinguisher' },
    { name: 'WW-Speicher', kind: 'probe.storage_tank' },
    { name: 'WMZ', kind: 'probe.heat_meter' },
    { name: 'Wasseruhr', kind: 'probe.water_meter' },
    // Mapped once to a kind no package of the catalogue has any more.
    { name: 'Aufzug', kind: 'probe.elevator' },
  ],
  kinds,
}

type Row = Readonly<Record<string, string>>

/** A line nothing is wrong with: an extinguisher in the school, in no room. */
const hall: Row = {
  property: 'Schulzentrum',
  building: 'Schulhaus',
  kind: 'Feuerlöscher',
  name: 'Feuerlöscher Flur',
}

/** What the plan makes of `hall` in a line, with what a test says otherwise. */
const made = (line: number, other: Readonly<Record<string, unknown>> = {}) => ({
  line,
  propertyId: centre,
  areaId: north,
  buildingId: school,
  roomId: null,
  kind: 'probe.extinguisher',
  name: 'Feuerlöscher Flur',
  mark: null,
  manufacturer: null,
  model: null,
  serialNumber: null,
  yearBuilt: null,
  commissionedOn: null,
  warrantyEndsOn: null,
  meterNumber: null,
  meterUnit: null,
  ...other,
})

/** The rows as the lines of a file, the first of them in line 2 under the names of the columns. */
const records = (rows: readonly Row[]): TableRecord[] =>
  rows.map((values, index) => ({ line: index + 2, values }))

const decided = (decisions: Readonly<Record<number, DuplicateDecision>> = {}) =>
  new Map(Object.entries(decisions).map(([line, decision]) => [Number(line), decision]))

/** The plan of some rows against the stock, undecided unless a test says otherwise. */
const planOf = (
  rows: readonly Row[],
  given: {
    readonly decisions?: Readonly<Record<number, DuplicateDecision>>
    readonly stock?: AssetImportStock
  } = {},
) => planAssets(records(rows), decided(given.decisions), given.stock ?? stock)

const rename = 'Eines davon umbenennen, dann ist klar, welches gemeint ist'

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

describe('the fields of a table of assets', () => {
  it('each have a key and a label of their own', () => {
    const keys = assetImportFields.map((field) => field.key)
    const labels = assetImportFields.map((field) => field.label)

    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(labels).size).toBe(labels.length)
    expect(keys).toEqual([
      'property',
      'building',
      'floor',
      'room',
      'kind',
      'name',
      'mark',
      'manufacturer',
      'model',
      'serialNumber',
      'yearBuilt',
      'commissionedOn',
      'warrantyEndsOn',
      'meterNumber',
      'meterUnit',
      'costGroup',
    ])
  })

  it('need a column for the place, the kind and the name of an asset, and for nothing else', () => {
    expect(
      assetImportFields.filter((field) => field.required === true).map((field) => field.key),
    ).toEqual(['property', 'building', 'kind', 'name'])
  })

  it('are called by no word another field is called by', () => {
    expect(sharedWords(assetImportFields)).toEqual([])
  })

  it('are suggested for a column that is called by any of their words', () => {
    for (const field of assetImportFields) {
      for (const word of wordsOf(field)) {
        expect(
          suggestedMapping([{ index: 0, name: word, sample: '' }], assetImportFields),
          word,
        ).toEqual({ [field.key]: 0 })
      }
    }
  })
})

describe('where the asset of a line stands', () => {
  it('is the building of the property the line names, whatever their case and spaces', () => {
    const plan = planOf([{ ...hall, property: 'SCHUL ZENTRUM', building: 'schul haus' }])

    expect(plan).toEqual({
      lines: 1,
      counts: { assets: 1, skipped: 0, undecided: 0 },
      problems: [],
      duplicates: [],
      create: [made(2)],
    })
  })

  it('lies in the area of its property', () => {
    const plan = planOf([{ ...hall, property: 'Rathaus', building: 'Altbau' }])

    expect(plan.create).toEqual([
      made(2, { propertyId: townHall, areaId: south, buildingId: oldWing }),
    ])
  })

  it('is a problem where the line names no property or one that is not there', () => {
    expect(planOf([{ ...hall, property: '' }]).problems).toEqual([
      { lines: [2], what: 'Die Liegenschaft fehlt', next: correctTheFile },
    ])
    expect(planOf([{ ...hall, property: 'Neubau' }]).problems).toEqual([
      {
        lines: [2],
        what: 'Die Liegenschaft „Neubau“ gibt es nicht',
        next: 'Liegenschaft anlegen oder die Datei berichtigen',
      },
    ])
  })

  it('is a problem where two properties are called what the line says', () => {
    const plan = planOf([hall], {
      stock: {
        ...stock,
        properties: [
          ...stock.properties,
          { id: 'p-9' as PropertyId, name: 'schul zentrum', areaId: south },
        ],
      },
    })

    expect(plan.problems).toEqual([
      { lines: [2], what: 'Die Liegenschaft „Schulzentrum“ gibt es mehrfach', next: rename },
    ])
    expect(plan.counts.assets).toBe(0)
  })

  it('is a problem where the line names no building or one its property does not have', () => {
    expect(planOf([{ ...hall, building: '' }]).problems).toEqual([
      { lines: [2], what: 'Das Gebäude fehlt', next: correctTheFile },
    ])
    // The building is there, on another property.
    expect(planOf([{ ...hall, building: 'Altbau' }]).problems).toEqual([
      {
        lines: [2],
        what: 'Das Gebäude „Altbau“ gibt es in der Liegenschaft Schulzentrum nicht',
        next: 'Gebäude anlegen oder die Datei berichtigen',
      },
    ])
  })

  it('is a problem where two buildings of the property are called what the line says', () => {
    const plan = planOf([hall], {
      stock: {
        ...stock,
        buildings: [
          ...stock.buildings,
          { id: 'b-9' as BuildingId, propertyId: centre, name: 'SCHULHAUS' },
        ],
      },
    })

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Das Gebäude „Schulhaus“ gibt es in der Liegenschaft Schulzentrum mehrfach',
        next: rename,
      },
    ])
  })

  it('is no problem where a building of that name stands on another property as well', () => {
    const plan = planOf([hall], {
      stock: {
        ...stock,
        buildings: [
          ...stock.buildings,
          { id: 'b-9' as BuildingId, propertyId: townHall, name: 'Schulhaus' },
        ],
      },
    })

    expect(plan.create).toEqual([made(2)])
  })

  it('is the building alone where the line names no room', () => {
    // An asset stands in a building or in a room of it; a floor without a room says no more.
    const plan = planOf([hall, { ...hall, floor: 'Dach' }])

    expect(plan.problems).toEqual([])
    expect(plan.create.map((asset) => asset.roomId)).toEqual([null, null])
  })
})

describe('the room of a line', () => {
  const roomOf = (row: Row) => planOf([{ ...hall, ...row }]).create.map((asset) => asset.roomId)
  const problemsOf = (row: Row, given?: { readonly stock?: AssetImportStock }) =>
    planOf([{ ...hall, ...row }], given).problems

  it('is found by its number, whatever its case and spaces', () => {
    expect(roomOf({ room: 'e. 14' })).toEqual(['r-1'])
  })

  it('is found by its name where no room carries that number', () => {
    expect(roomOf({ room: 'treppenhaus NORD' })).toEqual(['r-2'])
    expect(roomOf({ room: 'Heizraum' })).toEqual(['r-1'])
  })

  it('is found by its number before any room is found by that name', () => {
    // E.14 stands on the door of the boiler room, and another room is called so.
    expect(roomOf({ room: 'E.14' })).toEqual(['r-1'])
  })

  it('is a problem where two floors have a room of that number and the line names no floor', () => {
    expect(problemsOf({ room: '01' })).toEqual([
      {
        lines: [2],
        what: 'Den Raum „01“ gibt es im Gebäude Schulhaus mehrfach',
        next: 'Eine Spalte „Geschoss“ zuordnen, oder einen der Räume umbenennen',
      },
    ])
  })

  it('is a problem on the floor the line names where two rooms there carry that number', () => {
    expect(
      problemsOf(
        { room: '01', floor: 'Erdgeschoss' },
        {
          stock: {
            ...stock,
            rooms: [
              ...stock.rooms,
              {
                id: 'r-9' as RoomId,
                floorId: ground,
                buildingId: school,
                number: '01',
                name: 'Putzraum',
              },
            ],
          },
        },
      ),
    ).toEqual([
      {
        lines: [2],
        what: 'Den Raum „01“ gibt es im Geschoss Erdgeschoss des Gebäudes Schulhaus mehrfach',
        next: 'Einen der Räume umbenennen, dann ist klar, welcher gemeint ist',
      },
    ])
  })

  it('is the one on the floor the line names', () => {
    expect(roomOf({ room: '01', floor: '1. OG' })).toEqual(['r-4'])
    expect(roomOf({ room: '01', floor: 'erd geschoss' })).toEqual(['r-3'])
    // On the upper floor nothing carries the number E.14, and one room is called so.
    expect(roomOf({ room: 'E.14', floor: '1. OG' })).toEqual(['r-5'])
  })

  it('is a problem where it is not on the floor the line names, or not in the building', () => {
    expect(problemsOf({ room: 'Heizraum', floor: '1. OG' })).toEqual([
      {
        lines: [2],
        what: 'Den Raum „Heizraum“ gibt es im Geschoss 1. OG des Gebäudes Schulhaus nicht',
        next: 'Raum anlegen oder die Datei berichtigen',
      },
    ])
    expect(problemsOf({ room: '9.99' })).toEqual([
      {
        lines: [2],
        what: 'Den Raum „9.99“ gibt es im Gebäude Schulhaus nicht',
        next: 'Raum anlegen oder die Datei berichtigen',
      },
    ])
    // The room is there, in another building of the property.
    expect(problemsOf({ building: 'Turnhalle', room: 'E.14' })).toEqual([
      {
        lines: [2],
        what: 'Den Raum „E.14“ gibt es im Gebäude Turnhalle nicht',
        next: 'Raum anlegen oder die Datei berichtigen',
      },
    ])
  })

  it('is a problem where the floor the line names is not there, or there twice', () => {
    expect(problemsOf({ room: 'E.14', floor: 'Dach' })).toEqual([
      {
        lines: [2],
        what: 'Das Geschoss „Dach“ gibt es im Gebäude Schulhaus nicht',
        next: 'Geschoss anlegen oder die Datei berichtigen',
      },
    ])
    expect(
      problemsOf(
        { room: 'E.14', floor: 'Erdgeschoss' },
        {
          stock: {
            ...stock,
            floors: [
              ...stock.floors,
              { id: 'f-9' as FloorId, buildingId: school, name: 'erd geschoss' },
            ],
          },
        },
      ),
    ).toEqual([
      {
        lines: [2],
        what: 'Das Geschoss „Erdgeschoss“ gibt es im Gebäude Schulhaus mehrfach',
        next: rename,
      },
    ])
  })
})

describe('what the asset of a line is', () => {
  it('is the kind the tenant has given the word of the list', () => {
    const plan = planOf([hall, { ...hall, kind: 'WW-Speicher' }])

    expect(plan.create.map((asset) => asset.kind)).toEqual([
      'probe.extinguisher',
      'probe.storage_tank',
    ])
  })

  it('is found by the letters and digits of the word, whatever stands between them', () => {
    expect(kindNameKey('WW-Speicher')).toBe(kindNameKey('ww speicher'))

    const plan = planOf([
      { ...hall, kind: 'ww speicher' },
      { ...hall, kind: 'WW-SPEICHER' },
      { ...hall, kind: 'Ww.Speicher' },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.create.map((asset) => asset.kind)).toEqual([
      'probe.storage_tank',
      'probe.storage_tank',
      'probe.storage_tank',
    ])
  })

  it('is a problem where the line names no kind', () => {
    const plan = planOf([{ ...hall, kind: '' }])

    // One problem, and not the sentence of the asset about its kind beside it.
    expect(plan.problems).toEqual([
      { lines: [2], what: 'Die Anlagenart fehlt', next: correctTheFile },
    ])
  })

  it('is a problem of all its lines where nobody has given the word a kind', () => {
    const plan = planOf([
      { ...hall, kind: 'Hebebühne' },
      hall,
      { ...hall, kind: 'Hebebühne', name: 'Bühne 2' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2, 4],
        what: 'Die Anlagenart „Hebebühne“ ist keiner Anlagenart des Katalogs zugeordnet',
        next: 'Im Schritt „Anlagenarten“ zuordnen',
      },
    ])
    expect(plan.counts.assets).toBe(1)
    expect(plan.create).toEqual([])
  })

  it('is nothing for a word that happens to be the key of a kind: nothing is guessed', () => {
    const plan = planOf([{ ...hall, kind: 'probe.extinguisher' }])

    expect(plan.problems.map((problem) => problem.what)).toEqual([
      'Die Anlagenart „probe.extinguisher“ ist keiner Anlagenart des Katalogs zugeordnet',
    ])
  })

  it('is a problem where the word was given a kind the catalogue no longer has', () => {
    const plan = planOf([{ ...hall, kind: 'Aufzug' }])

    expect(plan.problems).toEqual([
      {
        lines: [2],
        what: 'Die Anlagenart „Aufzug“ ist probe.elevator zugeordnet, und die kennt kein Paket des Katalogs mehr',
        next: 'Im Schritt „Anlagenarten“ neu zuordnen',
      },
    ])
    expect(plan.counts.assets).toBe(0)
  })
})

describe('what a line says about its asset', () => {
  const problemsOf = (row: Row) => planOf([{ ...hall, ...row }]).problems
  const sorted = (whats: readonly string[]) => [...whats].sort()

  it('is taken over: its marks, its maker, its year and its days', () => {
    const plan = planOf([
      {
        ...hall,
        kind: 'WW-Speicher',
        name: 'Speicher Keller',
        mark: 'WW-02',
        manufacturer: 'Muster GmbH',
        model: 'S 300',
        serialNumber: '7571234',
        yearBuilt: '1998',
        commissionedOn: '02.10.2026',
        warrantyEndsOn: '2028-10-01',
        room: 'E.14',
      },
    ])

    expect(plan.problems).toEqual([])
    expect(plan.create).toEqual([
      made(2, {
        roomId: 'r-1',
        kind: 'probe.storage_tank',
        name: 'Speicher Keller',
        mark: 'WW-02',
        manufacturer: 'Muster GmbH',
        model: 'S 300',
        serialNumber: '7571234',
        yearBuilt: 1998,
        commissionedOn: '2026-10-02',
        warrantyEndsOn: '2028-10-01',
      }),
    ])
  })

  it('reads a day as a list writes it and as a program does', () => {
    const plan = planOf([
      { ...hall, commissionedOn: '02.10.2026', warrantyEndsOn: '2.10.2028' },
      { ...hall, commissionedOn: '2026-10-02', warrantyEndsOn: '2028-10-02' },
    ])

    expect(plan.create.map((asset) => [asset.commissionedOn, asset.warrantyEndsOn])).toEqual([
      ['2026-10-02', '2028-10-02'],
      ['2026-10-02', '2028-10-02'],
    ])
  })

  it('is the sentence of the asset where a day is none', () => {
    expect(
      sorted(
        problemsOf({ commissionedOn: '31.02.2026', warrantyEndsOn: 'bald' }).map(
          (problem) => problem.what,
        ),
      ),
    ).toEqual(
      sorted([
        'Anlage „Feuerlöscher Flur“: Die Inbetriebnahme ist ein Tag, geschrieben 03.10.2026',
        'Anlage „Feuerlöscher Flur“: Das Ende der Gewährleistung ist ein Tag, geschrieben 03.10.2026',
      ]),
    )
  })

  it('is the sentence of the asset where a year is none, once for all its lines', () => {
    const plan = planOf([
      { ...hall, yearBuilt: 'ca. 1998' },
      { ...hall, yearBuilt: '98' },
      { ...hall, yearBuilt: '2001' },
    ])

    expect(plan.problems).toEqual([
      {
        lines: [2, 3],
        what: `Anlage „Feuerlöscher Flur“: Das Baujahr ist eine ganze Zahl von ${String(assetLimits.earliestYearBuilt)} bis ${String(assetLimits.latestYearBuilt)}`,
        next: correctTheFile,
      },
    ])
  })

  it('is the sentence of the asset where the name is missing or too long', () => {
    const long = 'x'.repeat(assetLimits.name + 1)

    expect(planOf([hall, { ...hall, name: '' }]).problems).toEqual([
      { lines: [3], what: 'Anlage „Zeile 3“: Die Bezeichnung fehlt', next: correctTheFile },
    ])
    expect(problemsOf({ name: long })).toEqual([
      {
        lines: [2],
        what: `Anlage „${long}“: Die Bezeichnung hat höchstens ${String(assetLimits.name)} Zeichen`,
        next: correctTheFile,
      },
    ])
  })

  it('is every sentence where a line has several things wrong, none with a full stop', () => {
    const problems = problemsOf({
      name: '',
      yearBuilt: 'alt',
      mark: 'x'.repeat(assetLimits.mark + 1),
    })

    expect(problems).toHaveLength(3)
    expect(problems.filter((problem) => problem.what.endsWith('.'))).toEqual([])
    expect(problems.every((problem) => problem.what.startsWith('Anlage „Zeile 2“: '))).toBe(true)
  })
})

describe('the meter of a line', () => {
  const heatMeter = { ...hall, kind: 'WMZ', name: 'Zähler Heizung' }
  const waterMeter = { ...hall, kind: 'Wasseruhr', name: 'Zähler Wasser' }
  const whatsOf = (row: Row) => planOf([row]).problems.map((problem) => problem.what)

  it('has its number and its unit where the kind is a measuring point', () => {
    const plan = planOf([{ ...heatMeter, meterNumber: 'WMZ-1', meterUnit: 'kWh' }])

    expect(plan.problems).toEqual([])
    expect(plan.create).toEqual([
      made(2, {
        kind: 'probe.heat_meter',
        name: 'Zähler Heizung',
        meterNumber: 'WMZ-1',
        meterUnit: 'kilowatt_hours',
      }),
    ])
  })

  it('names its unit by the symbol or by the key, whatever its case and spaces', () => {
    const units = (row: Row, cells: readonly string[]) =>
      planOf(cells.map((meterUnit) => ({ ...row, meterNumber: '1', meterUnit }))).create.map(
        (asset) => asset.meterUnit,
      )

    expect(units(heatMeter, ['kWh', 'KWH', 'k W h', 'MWh', 'megawatt_hours'])).toEqual([
      'kilowatt_hours',
      'kilowatt_hours',
      'kilowatt_hours',
      'megawatt_hours',
      'megawatt_hours',
    ])
    // A list writes the cube as a three where the raised one is not at hand.
    expect(units(waterMeter, [meterUnitSymbol.cubic_metres, 'm3', 'M3', 'cubic_metres'])).toEqual([
      'cubic_metres',
      'cubic_metres',
      'cubic_metres',
      'cubic_metres',
    ])
  })

  it('is the sentence of the meter where the number or the unit of a measuring point is missing', () => {
    expect(whatsOf({ ...heatMeter, meterUnit: 'kWh' })).toEqual([
      'Anlage „Zähler Heizung“: Die Zählernummer fehlt',
    ])
    expect(whatsOf({ ...heatMeter, meterNumber: 'WMZ-1' })).toEqual([
      'Anlage „Zähler Heizung“: Ein Zähler dieser Art zählt in kWh oder MWh',
    ])
  })

  it('is the sentence of the meter where the unit is none of its kind', () => {
    expect(whatsOf({ ...heatMeter, meterNumber: 'WMZ-1', meterUnit: 'm3' })).toEqual([
      'Anlage „Zähler Heizung“: Ein Zähler dieser Art zählt in kWh oder MWh',
    ])
    expect(whatsOf({ ...heatMeter, meterNumber: 'WMZ-1', meterUnit: 'Liter' })).toEqual([
      'Anlage „Zähler Heizung“: Ein Zähler dieser Art zählt in kWh oder MWh',
    ])
  })

  it('is the sentence of the meter where a kind that is no measuring point has one', () => {
    expect(whatsOf({ ...hall, meterNumber: '4711' })).toEqual([
      'Anlage „Feuerlöscher Flur“: Eine Zählernummer hat nur eine Messstelle',
    ])
    expect(whatsOf({ ...hall, meterUnit: 'kWh' })).toEqual([
      'Anlage „Feuerlöscher Flur“: Eine Einheit hat nur eine Messstelle',
    ])
  })
})

describe('a line that may be an asset that is there', () => {
  it('is one that carries the serial number of an asset, however it was typed', () => {
    const plan = planOf([{ ...hall, serialNumber: 'bt-750-22- 0193' }])

    expect(plan.duplicates).toEqual([
      {
        line: 2,
        name: 'Feuerlöscher Flur',
        same: 'Gleiche Seriennummer',
        of: [{ id: 'a-1', number: 'A-0001', name: 'Kessel 1' }],
        decision: null,
      },
    ])
  })

  it('is one that carries the mark of an asset, named even where it has no number yet', () => {
    const plan = planOf([{ ...hall, mark: 'p -07' }])

    expect(plan.duplicates).toEqual([
      {
        line: 2,
        name: 'Feuerlöscher Flur',
        same: 'Gleiches Kennzeichen',
        of: [{ id: 'a-2', number: null, name: 'Pumpe Nord' }],
        decision: null,
      },
    ])
  })

  it('says both where it shares both, with one asset or with two', () => {
    const one = planOf([{ ...hall, serialNumber: 'BT-750-22-0193', mark: 'TW-01' }])
    const two = planOf([{ ...hall, serialNumber: 'BT-750-22-0193', mark: 'P-07' }])

    expect(one.duplicates.map(({ same, of }) => [same, of.length])).toEqual([
      ['Gleiche Seriennummer und gleiches Kennzeichen', 1],
    ])
    expect(two.duplicates).toMatchObject([
      {
        same: 'Gleiche Seriennummer und gleiches Kennzeichen',
        of: [
          { id: 'a-1', number: 'A-0001', name: 'Kessel 1' },
          { id: 'a-2', number: null, name: 'Pumpe Nord' },
        ],
      },
    ])
  })

  it('is the later of two lines that share a number, named by the line it shares it with', () => {
    const plan = planOf([
      { ...hall, serialNumber: 'X-1' },
      { ...hall, name: 'Feuerlöscher Keller', serialNumber: 'x-1' },
      { ...hall, name: 'Feuerlöscher Dach', serialNumber: 'X -1' },
    ])

    expect(plan.duplicates).toEqual([
      {
        line: 3,
        name: 'Feuerlöscher Keller',
        same: 'Gleiche Seriennummer',
        of: [{ line: 2 }],
        decision: null,
      },
      {
        line: 4,
        name: 'Feuerlöscher Dach',
        same: 'Gleiche Seriennummer',
        of: [{ line: 2 }, { line: 3 }],
        decision: null,
      },
    ])
  })

  it('may be both: an asset that is there and an earlier line', () => {
    const plan = planOf([
      { ...hall, mark: 'M-1' },
      { ...hall, name: 'Kessel neu', serialNumber: 'BT-750-22-0193', mark: 'm-1' },
    ])

    expect(plan.duplicates).toEqual([
      {
        line: 3,
        name: 'Kessel neu',
        same: 'Gleiche Seriennummer und gleiches Kennzeichen',
        of: [{ id: 'a-1', number: 'A-0001', name: 'Kessel 1' }, { line: 2 }],
        decision: null,
      },
    ])
  })

  it('is no line that carries other numbers, or none at all', () => {
    const plan = planOf([
      hall,
      { ...hall, name: 'Zweiter' },
      { ...hall, name: 'Dritter', serialNumber: 'BT-750-22-0194', mark: 'TW-02' },
      // A serial number is never held against a mark.
      { ...hall, name: 'Vierter', serialNumber: 'TW-01', mark: 'BT-750-22-0193' },
    ])

    expect(plan.duplicates).toEqual([])
    expect(plan.create.map((asset) => asset.line)).toEqual([2, 3, 4, 5])
  })
})

describe('the answer to a line that may be a duplicate', () => {
  const rows = [hall, { ...hall, name: 'Kessel neu', serialNumber: 'BT-750-22-0193' }]
  const kessel = made(3, { name: 'Kessel neu', serialNumber: 'BT-750-22-0193' })

  it('is waited for: without it nothing is taken over, not even the other lines', () => {
    const plan = planOf(rows)

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ assets: 1, skipped: 0, undecided: 1 })
    expect(plan.create).toEqual([])
  })

  it('may be to leave the line out: it is counted and not made', () => {
    const plan = planOf(rows, { decisions: { 3: 'skip' } })

    expect(plan.counts).toEqual({ assets: 1, skipped: 1, undecided: 0 })
    expect(plan.create).toEqual([made(2)])
    expect(plan.duplicates.map(({ line, decision }) => [line, decision])).toEqual([[3, 'skip']])
  })

  it('may be to make the asset all the same', () => {
    const plan = planOf(rows, { decisions: { 3: 'take' } })

    expect(plan.counts).toEqual({ assets: 2, skipped: 0, undecided: 0 })
    expect(plan.create).toEqual([made(2), kessel])
    // The line stays named, with what was said about it.
    expect(plan.duplicates.map(({ line, decision }) => [line, decision])).toEqual([[3, 'take']])
  })

  it('changes nothing about a line that is no duplicate', () => {
    const plan = planOf(rows, { decisions: { 2: 'skip', 3: 'take', 9: 'skip' } })

    expect(plan.counts).toEqual({ assets: 2, skipped: 0, undecided: 0 })
    expect(plan.create).toEqual([made(2), kessel])
  })

  it('does not take over a line that has a problem, whatever was said about it', () => {
    const plan = planOf([hall, { ...hall, name: '', serialNumber: 'BT-750-22-0193' }], {
      decisions: { 3: 'take' },
    })

    expect(plan.problems.map((problem) => problem.what)).toEqual([
      'Anlage „Zeile 3“: Die Bezeichnung fehlt',
    ])
    expect(plan.counts).toEqual({ assets: 1, skipped: 0, undecided: 0 })
    expect(plan.create).toEqual([])
  })
})

describe('a plan of assets', () => {
  const mixed: readonly Row[] = [
    { ...hall, serialNumber: 'S-2' },
    { ...hall, name: 'Kessel neu', serialNumber: 'BT-750-22-0193' },
    { ...hall, name: 'Löscher doppelt', serialNumber: 's-2' },
    { ...hall, name: 'Pumpe', mark: 'P-07' },
    { ...hall, name: 'Bühne', kind: 'Hebebühne' },
    { ...hall, name: 'Feuerlöscher Keller' },
  ]

  it('counts what it makes, what was left out and what still waits', () => {
    const plan = planOf(mixed, { decisions: { 3: 'take', 4: 'skip' } })

    expect(plan.lines).toBe(6)
    expect(plan.counts).toEqual({ assets: 3, skipped: 1, undecided: 1 })
    expect(plan.duplicates.map(({ line, decision }) => [line, decision])).toEqual([
      [3, 'take'],
      [4, 'skip'],
      [5, null],
    ])
    expect(plan.problems.map((problem) => problem.lines)).toEqual([[6]])
    expect(plan.create).toEqual([])
  })

  it('writes nothing while a line has a problem, and still counts what the others make', () => {
    const plan = planOf([hall, { ...hall, name: '' }, { ...hall, name: 'Zweiter' }])

    expect(plan.problems).toHaveLength(1)
    expect(plan.counts).toEqual({ assets: 2, skipped: 0, undecided: 0 })
    expect(plan.create).toEqual([])
  })

  it('writes its assets in the order of the lines once nothing is open', () => {
    const plan = planOf(
      mixed.map((row) => (row.kind === 'Hebebühne' ? { ...row, kind: 'Feuerlöscher' } : row)),
      { decisions: { 3: 'take', 4: 'skip', 5: 'skip' } },
    )

    expect(plan.problems).toEqual([])
    expect(plan.counts).toEqual({ assets: 4, skipped: 2, undecided: 0 })
    expect(plan.create.map((asset) => [asset.line, asset.name])).toEqual([
      [2, 'Feuerlöscher Flur'],
      [3, 'Kessel neu'],
      [6, 'Bühne'],
      [7, 'Feuerlöscher Keller'],
    ])
  })

  it('is empty for a table without lines', () => {
    expect(planOf([])).toEqual({
      lines: 0,
      counts: { assets: 0, skipped: 0, undecided: 0 },
      problems: [],
      duplicates: [],
      create: [],
    })
  })
})

describe('the words for kinds in a table', () => {
  it('stand each once, as first written, with the count of their lines', () => {
    const names = kindNamesIn(
      records([
        { kind: 'WW-Speicher' },
        { kind: 'Feuerlöscher' },
        { kind: 'ww speicher' },
        { kind: '' },
        { name: 'Ohne Art' },
        { kind: 'FEUERLÖSCHER' },
        { kind: 'WW Speicher' },
      ]),
    )

    expect(names.map(({ name, count }) => [name, count])).toEqual([
      ['WW-Speicher', 3],
      ['Feuerlöscher', 2],
    ])
  })

  it('carry the cost group only where all their lines name the same one', () => {
    const names = kindNamesIn(
      records([
        { kind: 'WW-Speicher', costGroup: '421' },
        { kind: 'ww speicher', costGroup: '421' },
        { kind: 'Aufzug', costGroup: '461' },
        { kind: 'AUFZUG', costGroup: '462' },
        { kind: 'Pumpe', costGroup: '422' },
        { kind: 'Pumpe', costGroup: '' },
        { kind: 'Lüfter', costGroup: '' },
        { kind: 'Tor' },
      ]),
    )

    expect(names).toEqual([
      { name: 'WW-Speicher', count: 2, costGroup: '421' },
      { name: 'Aufzug', count: 2, costGroup: null },
      { name: 'Pumpe', count: 2, costGroup: null },
      { name: 'Lüfter', count: 1, costGroup: null },
      { name: 'Tor', count: 1, costGroup: null },
    ])
  })
})

/** The specialist kind of the cost group 420 stands before the general one, to be passed over. */
const choices: readonly KindChoice[] = [
  { key: 'probe.extinguisher', label: 'Feuerlöscher', costGroup: '474' },
  { key: 'probe.elevator', label: 'Aufzugsanlage', costGroup: '461' },
  { key: 'further.elevator', label: 'Aufzugsanlage', costGroup: '461' },
  { key: 'probe.heating', label: 'Heizung', costGroup: '420' },
  { key: 'allgemein.kg_420', label: 'Wärmeversorgungsanlagen', costGroup: '420' },
  { key: 'allgemein.kg_460', label: 'Förderanlagen', costGroup: '460' },
]

describe('the kind a word is offered before anybody has chosen', () => {
  const suggested = (name: string, costGroup: string | null = null) =>
    suggestedKind({ name, count: 1, costGroup }, choices)

  it('is the one kind of a specialist package that is called exactly that', () => {
    expect(suggested('Feuerlöscher')).toBe('probe.extinguisher')
    expect(suggested('feuer-löscher')).toBe('probe.extinguisher')
    // Before the general kind of the cost group its lines name.
    expect(suggested('Feuerlöscher', '461')).toBe('probe.extinguisher')
  })

  it('is never a general kind by what that is called', () => {
    expect(suggested('Förderanlagen')).toBeNull()
    // By the cost group of its lines it is the general kind of that group, whatever the word.
    expect(suggested('Förderanlagen', '421')).toBe('allgemein.kg_420')
  })

  it('is none of two kinds that are called the same', () => {
    expect(suggested('Aufzugsanlage')).toBeNull()
    expect(suggested('Aufzugsanlage', '461')).toBe('allgemein.kg_460')
  })

  it('is the general kind of the cost group its lines name where no kind is called so', () => {
    expect(suggested('Hebebühne', '469')).toBe('allgemein.kg_460')
    expect(suggested('Brenner', '421')).toBe('allgemein.kg_420')
  })

  it('is none where there is neither', () => {
    expect(suggested('Hebebühne')).toBeNull()
    expect(suggested('Hebebühne', '311')).toBeNull()
    expect(suggested('Feuerlösch')).toBeNull()
  })
})

describe('the general asset kind of a cost group', () => {
  it('is the one of the group of the second level a three digit group lies in', () => {
    expect(generalKindOf('461', choices)).toBe('allgemein.kg_460')
    expect(generalKindOf('469', choices)).toBe('allgemein.kg_460')
    expect(generalKindOf('460', choices)).toBe('allgemein.kg_460')
  })

  it('is never a specialist kind of that group', () => {
    expect(generalKindOf('421', choices)).toBe('allgemein.kg_420')
    expect(generalKindOf('474', choices)).toBeNull()
  })

  it('is none for a group no general kind stands for, and for what is no cost group', () => {
    expect(generalKindOf('311', choices)).toBeNull()
    expect(generalKindOf('46', choices)).toBeNull()
    expect(generalKindOf('4610', choices)).toBeNull()
    expect(generalKindOf('KG 461', choices)).toBeNull()
    expect(generalKindOf('', choices)).toBeNull()
    expect(generalKindOf('461', [])).toBeNull()
  })
})

describe('the words with their kinds as a request gives them', () => {
  const isKind = (key: string) => kinds.has(key)
  const shape = 'Die Zuordnung steht als Liste von Bezeichnungen mit ihrer Anlagenart.'
  const text = `Eine Bezeichnung ist ein Text mit höchstens ${String(assetLimits.name)} Zeichen, der nicht leer ist.`
  const tank = { name: 'WW-Speicher', kind: 'probe.storage_tank' }

  it('are fine as a list of words, each with a kind of the catalogue, or as an empty list', () => {
    expect(kindNamesProblem({ names: [tank] }, isKind)).toBeNull()
    expect(
      kindNamesProblem(
        { names: [tank, { name: 'x'.repeat(assetLimits.name), kind: 'probe.extinguisher' }] },
        isKind,
      ),
    ).toBeNull()
    expect(kindNamesProblem({ names: [] }, isKind)).toBeNull()
  })

  it('are refused where they are no list', () => {
    for (const value of [
      null,
      undefined,
      'names',
      7,
      {},
      { names: 'WW-Speicher' },
      { names: {} },
    ]) {
      expect(kindNamesProblem(value, isKind)).toBe(shape)
    }
  })

  it('are refused where they are more than one request may give', () => {
    const many = (count: number) => ({ names: Array.from({ length: count }, () => tank) })

    expect(kindNamesProblem(many(kindNamesLimit), isKind)).toBeNull()
    expect(kindNamesProblem(many(kindNamesLimit + 1), isKind)).toBe(shape)
  })

  it('are refused where a word is empty, too long or no text', () => {
    const known = 'probe.storage_tank'

    for (const entry of [
      { name: '', kind: known },
      { name: '   ', kind: known },
      // Nothing but punctuation is compared as nothing.
      { name: '-.-', kind: known },
      { name: 7, kind: known },
      { name: 'x'.repeat(assetLimits.name + 1), kind: known },
      { kind: known },
      null,
      'WW-Speicher',
    ]) {
      expect(kindNamesProblem({ names: [tank, entry] }, isKind)).toBe(text)
    }
  })

  it('are refused where a kind is none of the catalogue', () => {
    const sentence = 'Die Anlagenart für „WW-Speicher“ kennt kein Paket des Katalogs.'

    for (const unknown of ['probe.elevator', '', 7, undefined]) {
      expect(kindNamesProblem({ names: [{ name: 'WW-Speicher', kind: unknown }] }, isKind)).toBe(
        sentence,
      )
    }
  })

  it('are refused where a word is to lose its kind: none is taken out again', () => {
    expect(kindNamesProblem({ names: [{ name: 'WW-Speicher', kind: null }] }, isKind)).toBe(
      'Die Anlagenart für „WW-Speicher“ kennt kein Paket des Katalogs.',
    )
  })

  it('name the first entry that is wrong', () => {
    expect(
      kindNamesProblem(
        { names: [tank, { name: 'Aufzug', kind: 'probe.elevator' }, { name: '', kind: 'x' }] },
        isKind,
      ),
    ).toBe('Die Anlagenart für „Aufzug“ kennt kein Paket des Katalogs.')
  })
})

describe('the decisions of a request', () => {
  it('are read by the line they are about', () => {
    expect(decisionsOf({ '2': 'take', '17': 'skip', 204: 'take' })).toEqual(
      new Map([
        [2, 'take'],
        [17, 'skip'],
        [204, 'take'],
      ]),
    )
  })

  it('leave out what is no decision', () => {
    expect(
      decisionsOf({ '2': 'maybe', '3': null, '4': 7, '5': true, '6': 'TAKE', '7': '' }),
    ).toEqual(new Map())
    expect(decisionsOf({ '2': 'maybe', '3': 'skip' })).toEqual(new Map([[3, 'skip']]))
  })

  it('leave out what is about no line', () => {
    expect(
      decisionsOf({ x: 'take', '-1': 'skip', '1.5': 'take', '': 'skip', '12345678': 'take' }),
    ).toEqual(new Map())
  })

  it('are none for anything that is no record', () => {
    expect(decisionsOf(null)).toEqual(new Map())
    expect(decisionsOf(undefined)).toEqual(new Map())
    expect(decisionsOf('take')).toEqual(new Map())
    expect(decisionsOf(7)).toEqual(new Map())
  })
})

describe('what an import of assets made, in words', () => {
  it('counts the assets, one or several', () => {
    expect(assetImportSummary({ assets: 1, skipped: 0, undecided: 0 })).toBe('1 Anlage angelegt')
    expect(assetImportSummary({ assets: 12, skipped: 0, undecided: 0 })).toBe('12 Anlagen angelegt')
    expect(assetImportSummary({ assets: 1200, skipped: 0, undecided: 0 })).toBe(
      '1.200 Anlagen angelegt',
    )
  })

  it('says how many lines were left out as duplicates, where any were', () => {
    expect(assetImportSummary({ assets: 12, skipped: 1, undecided: 0 })).toBe(
      '12 Anlagen angelegt, 1 Zeile als Dublette nicht angelegt',
    )
    expect(assetImportSummary({ assets: 0, skipped: 3, undecided: 0 })).toBe(
      '0 Anlagen angelegt, 3 Zeilen als Dublette nicht angelegt',
    )
  })
})

describe('the decisions of a request that is a list', () => {
  it('are none: a decision names its line, and a list only counts', () => {
    expect(decisionsOf(['take', 'skip']).size).toBe(0)
  })
})
