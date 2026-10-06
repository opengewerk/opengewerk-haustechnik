import {
  dayOfCell,
  type Id,
  type TableField,
  type TableRecord,
  tableNameKey,
  wholeNumberOfCell,
} from '@opengewerk/platform-domain'

import { type Asset, type AssetId, assetLimits, assetProblems, meterProblems } from './asset.js'
import { isGeneralKind, possibleDuplicates, sameWords } from './asset-duplicate.js'
import type { AssetKind } from './catalogue.js'
import { costGroupAbove } from './cost-group.js'
import { counted, type ImportProblem, ImportProblems, nameKey } from './import.js'
import type { Building, Floor, Property, Room } from './location.js'
import { meterUnits, meterUnitSymbol } from './meter.js'

/**
 * The import of assets from a table (#100, sections 4.2 and 11 of the
 * concept): one line, one asset, in a building and a room that are there.
 *
 * A line says where the asset stands by the names of its property, its
 * building and, where it has one, its room; the import makes no place, that
 * is the import of places. It says what the asset is in the words of the
 * list, "Feuerlöscher" or "WW-Speicher", and the tenant keeps once which
 * asset kind of the catalogue each of those words means (`AssetKindName`).
 * A word nobody has given a kind is a problem of its lines; nothing is
 * guessed into the stock.
 *
 * An asset that carries the serial number or the mark of one that is there,
 * or of an earlier line, may be the same asset. The plan names every such
 * line, and whoever imports says for each whether it is made all the same or
 * left out. Without that answer nothing is taken over: a duplicate is
 * neither made quietly nor dropped quietly.
 *
 * What only an asset kind has, its characteristics and fields, is not read
 * from the table. Somebody enters it at the asset afterwards.
 */

/** The fields a column of such a table can be, with what lists call them. */
export const assetImportFields: readonly TableField[] = [
  {
    key: 'property',
    label: 'Liegenschaft',
    names: ['Objekt', 'Standort', 'Liegenschaftsname'],
    required: true,
  },
  { key: 'building', label: 'Gebäude', names: ['Gebäudename', 'Haus', 'Bauteil'], required: true },
  { key: 'floor', label: 'Geschoss', names: ['Etage', 'Stockwerk'] },
  {
    key: 'room',
    label: 'Raum',
    names: ['Raumnummer', 'Raum-Nr.', 'Raumnr', 'Raumbezeichnung', 'Raumname'],
  },
  {
    key: 'kind',
    label: 'Anlagenart',
    names: ['Art', 'Anlagentyp', 'Anlagenkategorie', 'Kategorie', 'Art der Anlage'],
    required: true,
  },
  {
    key: 'name',
    label: 'Bezeichnung',
    names: ['Name', 'Anlage', 'Anlagenbezeichnung', 'Benennung'],
    required: true,
  },
  {
    key: 'mark',
    label: 'Kennzeichen',
    names: ['Inventar-Nr.', 'Inventarnummer', 'Anlagenkennzeichen', 'Kennzeichnung', 'AKS'],
  },
  { key: 'manufacturer', label: 'Hersteller', names: ['Fabrikat'] },
  { key: 'model', label: 'Typ', names: ['Modell', 'Typbezeichnung'] },
  {
    key: 'serialNumber',
    label: 'Seriennummer',
    names: ['Serien-Nr.', 'Seriennr', 'Fabriknummer', 'Fabrik-Nr.', 'SN'],
  },
  { key: 'yearBuilt', label: 'Baujahr', names: ['Herstelljahr', 'Bj.'] },
  {
    key: 'commissionedOn',
    label: 'Inbetriebnahme',
    names: ['Inbetriebnahmedatum', 'In Betrieb seit', 'Datum der Inbetriebnahme'],
  },
  {
    key: 'warrantyEndsOn',
    label: 'Gewährleistung bis',
    names: ['Gewährleistungsende', 'Ende der Gewährleistung', 'Garantie bis'],
  },
  { key: 'meterNumber', label: 'Zählernummer', names: ['Zähler-Nr.', 'Zählernr'] },
  { key: 'meterUnit', label: 'Einheit des Zählers', names: ['Einheit'] },
  { key: 'costGroup', label: 'Kostengruppe', names: ['KG', 'Kostengruppe DIN 276', 'DIN 276'] },
]

/** A word of a list and the asset kind of the catalogue it means, as the tenant keeps it. */
export interface AssetKindName {
  /** The word as it was first written. */
  readonly name: string
  /** The key of the asset kind. */
  readonly kind: string
}

/** The same as the row the tenant keeps it in: with what it is compared by, and when it was kept. */
export interface KeptKindName extends AssetKindName {
  readonly id: Id<'asset_kind_name'>
  readonly tenantId: Id<'tenant'>
  /** The word as `kindNameKey` makes it, once per tenant. */
  readonly nameKey: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** What two words of lists are compared by: "WW-Speicher" and "ww speicher" are one word. */
export const kindNameKey = tableNameKey

/** A word for a kind as a table uses it: how many lines carry it, and the cost group if they all name the same. */
export interface KindNameInFile {
  readonly name: string
  readonly count: number
  readonly costGroup: string | null
}

/** The words for kinds in a table, each once, in the order they first stand in it. */
export function kindNamesIn(records: readonly TableRecord[]): readonly KindNameInFile[] {
  const names = new Map<string, { name: string; count: number; costGroups: Set<string> }>()

  for (const { values } of records) {
    const name = values['kind'] ?? ''

    if (name === '') {
      continue
    }

    const known = names.get(kindNameKey(name)) ?? { name, count: 0, costGroups: new Set() }

    known.count += 1
    known.costGroups.add(values['costGroup'] ?? '')
    names.set(kindNameKey(name), known)
  }

  return [...names.values()].map(({ name, count, costGroups }) => {
    const [only] = [...costGroups]

    return { name, count, costGroup: costGroups.size === 1 && only ? only : null }
  })
}

/** An asset kind as the choice of kinds needs it. */
export interface KindChoice {
  readonly key: string
  readonly label: string
  readonly costGroup: string
}

/**
 * The kind a word is offered before anybody has chosen: the one kind of a
 * specialist package that is called exactly that, or else the general kind
 * of the cost group the lines name (section 4.2: an asset no package
 * describes carries the general kind of its cost group). A proposal and no
 * more; it counts once somebody has saved it.
 */
export function suggestedKind(name: KindNameInFile, kinds: readonly KindChoice[]): string | null {
  const key = kindNameKey(name.name)
  const called = kinds.filter((kind) => !isGeneralKind(kind.key) && kindNameKey(kind.label) === key)

  if (called.length === 1) {
    return called[0]?.key ?? null
  }

  return name.costGroup === null ? null : generalKindOf(name.costGroup, kinds)
}

/** The general asset kind of the cost group a three digit group lies in: 461 is a conveying system, 460. */
export function generalKindOf(costGroup: string, kinds: readonly KindChoice[]): string | null {
  const group = /^\d{3}$/.test(costGroup) ? costGroupAbove(costGroup) : null

  return kinds.find((kind) => isGeneralKind(kind.key) && kind.costGroup === group)?.key ?? null
}

/** The most words one request may give a kind. */
export const kindNamesLimit = 2_000

/**
 * Why what came over the wire is no list of words with their kinds, or null.
 * A word is given a kind or left as it is; none is taken out again, since a
 * word that was right for one list is right for the next.
 */
export function kindNamesProblem(value: unknown, isKind: (key: string) => boolean): string | null {
  const names = (value as { names?: unknown } | null)?.names

  if (!Array.isArray(names) || names.length > kindNamesLimit) {
    return 'Die Zuordnung steht als Liste von Bezeichnungen mit ihrer Anlagenart.'
  }

  for (const entry of names as unknown[]) {
    const { name, kind } = (entry ?? {}) as { name?: unknown; kind?: unknown }

    if (typeof name !== 'string' || kindNameKey(name) === '' || name.length > assetLimits.name) {
      return `Eine Bezeichnung ist ein Text mit höchstens ${assetLimits.name} Zeichen, der nicht leer ist.`
    }

    if (typeof kind !== 'string' || !isKind(kind)) {
      return `Die Anlagenart für „${name}“ kennt kein Paket des Katalogs.`
    }
  }

  return null
}

/** What whoever imports says about a line that may be an asset that is there. */
export const duplicateDecisions = ['take', 'skip'] as const

export type DuplicateDecision = (typeof duplicateDecisions)[number]

/** The decisions of a request, by the line they are about; what is no decision is left out. */
export function decisionsOf(value: unknown): ReadonlyMap<number, DuplicateDecision> {
  const decisions = new Map<number, DuplicateDecision>()

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [line, decision] of Object.entries(value)) {
      const known = duplicateDecisions.find((each) => each === decision)

      if (known && /^\d{1,7}$/.test(line)) {
        decisions.set(Number(line), known)
      }
    }
  }

  return decisions
}

/** What the person importing can see, which is what a line can name and collide with. */
export interface AssetImportStock {
  readonly properties: readonly Pick<Property, 'id' | 'name' | 'areaId'>[]
  readonly buildings: readonly Pick<Building, 'id' | 'propertyId' | 'name'>[]
  readonly floors: readonly Pick<Floor, 'id' | 'buildingId' | 'name'>[]
  readonly rooms: readonly Pick<Room, 'id' | 'floorId' | 'buildingId' | 'number' | 'name'>[]
  /** The assets that carry a serial number or a mark. */
  readonly assets: readonly Pick<Asset, 'id' | 'number' | 'name' | 'serialNumber' | 'mark'>[]
  readonly kindNames: readonly AssetKindName[]
  /** The asset kinds of the catalogue as it stands on the day of the import, by their key. */
  readonly kinds: ReadonlyMap<string, AssetKind>
}

/** An asset a plan makes. The server gives it its id and its number. */
export type NewAsset = Pick<
  Asset,
  | 'propertyId'
  | 'areaId'
  | 'buildingId'
  | 'roomId'
  | 'kind'
  | 'name'
  | 'mark'
  | 'manufacturer'
  | 'model'
  | 'serialNumber'
  | 'yearBuilt'
  | 'commissionedOn'
  | 'warrantyEndsOn'
  | 'meterNumber'
  | 'meterUnit'
> & { readonly line: number }

/** What a line shares its serial number or its mark with: an asset that is there, or an earlier line. */
export type DuplicateOf =
  | { readonly id: AssetId; readonly number: string | null; readonly name: string }
  | { readonly line: number }

export interface ImportDuplicate {
  readonly line: number
  readonly name: string
  /** "Gleiche Seriennummer", "Gleiches Kennzeichen" or both. */
  readonly same: string
  readonly of: readonly DuplicateOf[]
  readonly decision: DuplicateDecision | null
}

export interface AssetImportCounts {
  /** The assets taking over makes. */
  readonly assets: number
  /** The lines left out because somebody said so. */
  readonly skipped: number
  /** The lines that still wait for an answer. */
  readonly undecided: number
}

export interface AssetImportPlan {
  readonly lines: number
  readonly counts: AssetImportCounts
  readonly problems: readonly ImportProblem[]
  readonly duplicates: readonly ImportDuplicate[]
  /** What taking over writes, in the order of the lines. Empty while there is a problem or an open answer. */
  readonly create: readonly NewAsset[]
}

const text = (value: string | undefined) => (value === undefined || value === '' ? null : value)

/** A day as a field holds it; what names none is handed on as written, for the rule. */
const day = (value: string | undefined) =>
  value === undefined || value === '' ? null : (dayOfCell(value) ?? value)

/**
 * The rule of an asset shows a day as a form sends it. A list writes it as
 * people do, and both are read, so the sentence shows the one a list has.
 */
const asAListWritesIt = (sentence: string) =>
  sentence.replace('geschrieben 2026-10-03', 'geschrieben 03.10.2026')

/** The unit a cell names, by its symbol ("kWh", "m³", also "m3") or its key; anything else as written. */
function meterUnitOf(value: string | undefined): string | null {
  if (value === undefined || value === '') {
    return null
  }

  const key = nameKey(value).replace('m3', 'm³')

  return meterUnits.find((unit) => unit === key || nameKey(meterUnitSymbol[unit]) === key) ?? value
}

/**
 * What the lines of a table would make of assets, against what is there and
 * what whoever imports has decided about the lines that may be duplicates.
 */
export function planAssets(
  records: readonly TableRecord[],
  decisions: ReadonlyMap<number, DuplicateDecision>,
  stock: AssetImportStock,
): AssetImportPlan {
  const problems = new ImportProblems()
  const duplicates: ImportDuplicate[] = []
  const create: NewAsset[] = []
  const kindOfName = new Map(stock.kindNames.map((entry) => [kindNameKey(entry.name), entry.kind]))
  const properties = grouped(stock.properties, (property) => nameKey(property.name))
  const buildings = grouped(
    stock.buildings,
    (building) => `${building.propertyId}\u0000${nameKey(building.name)}`,
  )
  const floors = grouped(stock.floors, (floor) => `${floor.buildingId}\u0000${nameKey(floor.name)}`)
  const roomsOf = grouped(stock.rooms, (room) => room.buildingId)
  /** The lines read so far, for the line that carries the same number as one before it. */
  const earlier: { line: number; serialNumber: string | null; mark: string | null }[] = []
  let skipped = 0
  let undecided = 0

  for (const { line, values } of records) {
    const cell = (field: string) => values[field] ?? ''
    const before = problems.added
    const place = placeOf(line, cell, { properties, buildings, floors, roomsOf }, problems)
    const kindKey = kindOf(line, cell('kind'), kindOfName, stock.kinds, problems)
    const kind = kindKey === null ? undefined : stock.kinds.get(kindKey)
    const yearBuilt = cell('yearBuilt')
    const fields = {
      kind: kindKey,
      name: text(cell('name')),
      mark: text(cell('mark')),
      manufacturer: text(cell('manufacturer')),
      model: text(cell('model')),
      serialNumber: text(cell('serialNumber')),
      yearBuilt: yearBuilt === '' ? null : (wholeNumberOfCell(yearBuilt) ?? yearBuilt),
      commissionedOn: day(cell('commissionedOn')),
      warrantyEndsOn: day(cell('warrantyEndsOn')),
      meterNumber: text(cell('meterNumber')),
      meterUnit: meterUnitOf(cell('meterUnit')),
    }
    const about = `Anlage „${cell('name') === '' ? `Zeile ${line}` : cell('name')}“`
    // The kind has said its own sentence above, so the rule is asked with a kind that is there.
    const sentences = {
      ...assetProblems({ ...fields, kind: kindKey ?? 'allgemein' }),
      ...(kind ? meterProblems(kind, fields) : {}),
    }

    for (const sentence of Object.values(sentences)) {
      problems.addSentence(line, about, asAListWritesIt(sentence))
    }

    const candidate = { serialNumber: fields.serialNumber, mark: fields.mark }
    const found = possibleDuplicates(candidate, [...stock.assets, ...earlier])
    const decision = decisions.get(line) ?? null

    earlier.push({ line, ...candidate })

    if (found.length > 0) {
      duplicates.push({
        line,
        name: cell('name'),
        same: sameWords([...new Set(found.flatMap((each) => each.same))]),
        of: found.map(({ asset }) =>
          'id' in asset
            ? { id: asset.id, number: asset.number, name: asset.name }
            : { line: asset.line },
        ),
        decision,
      })
      skipped += decision === 'skip' ? 1 : 0
      undecided += decision === null ? 1 : 0

      if (decision !== 'take') {
        continue
      }
    }

    if (place && kindKey !== null && problems.added === before) {
      create.push({
        line,
        ...place,
        ...(fields as Pick<NewAsset, keyof typeof fields>),
        kind: kindKey,
        name: cell('name'),
      })
    }
  }

  const listedProblems = problems.list()
  const open = listedProblems.length > 0 || undecided > 0

  return {
    lines: records.length,
    counts: { assets: create.length, skipped, undecided },
    problems: listedProblems,
    duplicates,
    create: open ? [] : create,
  }
}

function grouped<Item>(items: readonly Item[], key: (item: Item) => string): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()

  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  }

  return groups
}

interface Places {
  readonly properties: ReadonlyMap<string, AssetImportStock['properties']>
  readonly buildings: ReadonlyMap<string, AssetImportStock['buildings']>
  readonly floors: ReadonlyMap<string, AssetImportStock['floors']>
  readonly roomsOf: ReadonlyMap<string, AssetImportStock['rooms']>
}

const orCorrect = 'anlegen oder die Datei berichtigen'

/** Where the asset of a line stands, or null with the problem said. */
function placeOf(
  line: number,
  cell: (field: string) => string,
  places: Places,
  problems: ImportProblems,
): Pick<NewAsset, 'propertyId' | 'areaId' | 'buildingId' | 'roomId'> | null {
  /** The one of `found`, or null with what is wrong said: none there, or more than one. */
  const one = <Item>(found: readonly Item[] | undefined, what: string, where: string) => {
    if (found === undefined || found.length === 0) {
      problems.add(
        line,
        `${what} gibt es ${where}nicht`,
        `${what.split(' ')[1] ?? ''} ${orCorrect}`,
      )
    } else if (found.length > 1) {
      problems.add(
        line,
        `${what} gibt es ${where}mehrfach`,
        'Eines davon umbenennen, dann ist klar, welches gemeint ist',
      )
    }

    return found?.length === 1 ? (found[0] ?? null) : null
  }

  if (cell('property') === '') {
    problems.add(line, 'Die Liegenschaft fehlt')

    return null
  }

  const property = one(
    places.properties.get(nameKey(cell('property'))),
    `Die Liegenschaft „${cell('property')}“`,
    '',
  )

  if (!property) {
    return null
  }

  if (cell('building') === '') {
    problems.add(line, 'Das Gebäude fehlt')

    return null
  }

  const building = one(
    places.buildings.get(`${property.id}\u0000${nameKey(cell('building'))}`),
    `Das Gebäude „${cell('building')}“`,
    `in der Liegenschaft ${property.name} `,
  )

  if (!building) {
    return null
  }

  const place = { propertyId: property.id, areaId: property.areaId, buildingId: building.id }

  if (cell('room') === '') {
    return { ...place, roomId: null }
  }

  let rooms = places.roomsOf.get(building.id) ?? []
  let within = `im Gebäude ${building.name}`
  let narrow = 'Eine Spalte „Geschoss“ zuordnen, oder einen der Räume umbenennen'

  if (cell('floor') !== '') {
    const floor = one(
      places.floors.get(`${building.id}\u0000${nameKey(cell('floor'))}`),
      `Das Geschoss „${cell('floor')}“`,
      `im Gebäude ${building.name} `,
    )

    if (!floor) {
      return null
    }

    rooms = rooms.filter((room) => room.floorId === floor.id)
    within = `im Geschoss ${floor.name} des Gebäudes ${building.name}`
    narrow = 'Einen der Räume umbenennen, dann ist klar, welcher gemeint ist'
  }

  // By its number first: a list names a room by what stands on its door.
  const key = nameKey(cell('room'))
  const numbered = rooms.filter((room) => room.number !== null && nameKey(room.number) === key)
  const named = rooms.filter((room) => room.name !== null && nameKey(room.name) === key)
  const found = numbered.length > 0 ? numbered : named

  if (found.length > 1) {
    problems.add(line, `Den Raum „${cell('room')}“ gibt es ${within} mehrfach`, narrow)

    return null
  }

  if (!found[0]) {
    problems.add(line, `Den Raum „${cell('room')}“ gibt es ${within} nicht`, `Raum ${orCorrect}`)

    return null
  }

  return { ...place, roomId: found[0].id }
}

/** The key of the asset kind a word means, or null with the problem said. */
function kindOf(
  line: number,
  name: string,
  kindOfName: ReadonlyMap<string, string>,
  kinds: ReadonlyMap<string, AssetKind>,
  problems: ImportProblems,
): string | null {
  if (name === '') {
    problems.add(line, 'Die Anlagenart fehlt')

    return null
  }

  const key = kindOfName.get(kindNameKey(name))

  if (key === undefined) {
    problems.add(
      line,
      `Die Anlagenart „${name}“ ist keiner Anlagenart des Katalogs zugeordnet`,
      'Im Schritt „Anlagenarten“ zuordnen',
    )

    return null
  }

  if (!kinds.has(key)) {
    problems.add(
      line,
      `Die Anlagenart „${name}“ ist ${key} zugeordnet, und die kennt kein Paket des Katalogs mehr`,
      'Im Schritt „Anlagenarten“ neu zuordnen',
    )

    return null
  }

  return key
}

/** What an import of assets made, as the log and the page say it. */
export function assetImportSummary(counts: AssetImportCounts): string {
  return (
    `${counted(counts.assets, 'Anlage', 'Anlagen')} angelegt` +
    (counts.skipped === 0
      ? ''
      : `, ${counted(counts.skipped, 'Zeile', 'Zeilen')} als Dublette nicht angelegt`)
  )
}
