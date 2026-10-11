import { BadRequestException } from '@nestjs/common'
import {
  type ActivityEntry,
  activityTableHeads,
  activityTableRow,
  addressWords,
  type AssetLookup,
  type AssetRegisterFilter,
  assetTableColumns,
  assetTableRow,
  byNameIn,
  byUrgency,
  type Catalogue,
  type DefectEntry,
  defectTableColumns,
  defectTableRow,
  defectWhere,
  dismissedTableColumns,
  dismissedTableRows,
  type DutyEntry,
  type DutyProposals,
  dutyTableHeads,
  dutyTableRow,
  isAllowed,
  type IsoDate,
  type MeterEntry,
  meterTableColumns,
  meterTableRows,
  outgoingTableRows,
  packageOf,
  type PlaceNames,
  type PlaceToDo,
  placeWords,
  propertySearchText,
  propertyTableColumns,
  proposalTableColumns,
  proposalTableRows,
  searchedFor,
  tableNamesPeople,
  type TableRow,
  targetWhere,
  toDoNumbers,
  whereWords,
  type WorkOrderEntry,
  workOrderTableHeads,
  workOrderTableRow,
} from '@opengewerk/haustechnik-domain'
import { type OutgoingTable, type TenantTransaction } from '@opengewerk/platform-server'
import { isNull } from 'drizzle-orm'

import { areasInSight } from '../areas/areas.js'
import { assets, buildings, properties, rooms } from '../database/schema/index.js'
import { assetsPassing } from './asset-register.js'
import { placesToDo } from './place-situation.js'
import type { Asking } from './places.js'
import { said } from './register-question.js'

/**
 * The lists of the office as tables (#138, section 3 of the concept): what a
 * list shows under its filter, in its order, under its columns, read here as
 * the list reads it and written by the foundation (`tableAnswer`).
 *
 * The transaction is the person's, as for the list: a table holds the
 * records of their areas and no other, whatever its address names, and a
 * number only where the person may read the list it counts. The columns and
 * the words in them come from `domain` (`office-table.ts`), which the list on
 * the screen reads as well.
 */

/** Each name by its id, of the records of a kind the person sees. */
async function namesOf(tx: TenantTransaction): Promise<{
  readonly property: ReadonlyMap<string, string>
  readonly building: ReadonlyMap<string, string>
  readonly room: ReadonlyMap<string, string | null>
}> {
  const propertyRows = await tx
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(isNull(properties.deletedAt))
  const buildingRows = await tx
    .select({ id: buildings.id, name: buildings.name })
    .from(buildings)
    .where(isNull(buildings.deletedAt))
  const roomRows = await tx
    .select({ id: rooms.id, number: rooms.number, name: rooms.name })
    .from(rooms)
    .where(isNull(rooms.deletedAt))

  return {
    property: new Map(propertyRows.map((row) => [row.id as string, row.name])),
    building: new Map(buildingRows.map((row) => [row.id as string, row.name])),
    // A room by its number, as the list names it, and by its name where it has none.
    room: new Map(
      roomRows.map((row) => [
        row.id as string,
        row.number !== null && row.number !== '' ? row.number : row.name,
      ]),
    ),
  }
}

/**
 * The names of the places a person reads, for a column that names where a
 * record hangs: of whoever reads places, and of nobody else, so that a
 * column of a place stays as empty as the list without the records of the
 * places (#237). Null without `location.read`.
 */
export async function placeNamesFor(
  tx: TenantTransaction,
  identity: Asking,
): Promise<PlaceNames | null> {
  if (!isAllowed(identity, 'location.read')) {
    return null
  }

  const propertyRows = await tx
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(isNull(properties.deletedAt))
  const buildingRows = await tx
    .select({ id: buildings.id, name: buildings.name })
    .from(buildings)
    .where(isNull(buildings.deletedAt))
  const roomRows = await tx
    .select({
      id: rooms.id,
      number: rooms.number,
      name: rooms.name,
      buildingId: rooms.buildingId,
    })
    .from(rooms)
    .where(isNull(rooms.deletedAt))
  const property = new Map(propertyRows.map((row) => [row.id as string, row.name]))
  const building = new Map(buildingRows.map((row) => [row.id as string, row.name]))
  const room = new Map(
    roomRows.map((row) => [
      row.id as string,
      { number: row.number, name: row.name, buildingId: row.buildingId as string },
    ]),
  )

  return {
    property: (id) => property.get(id) ?? null,
    building: (id) => building.get(id) ?? null,
    room: (id) => room.get(id) ?? null,
  }
}

/**
 * The register of assets as a table: every asset that passes the filter, and
 * not a page of them, with the columns of the list (4.2). The kind is named
 * as the catalogue of the server names it, the place by its property,
 * building and room. Those names are what `location.read` reads: whoever
 * reads the assets and not the places gets the column of the place empty.
 */
export async function assetTable(
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  today: IsoDate,
  filter: AssetRegisterFilter,
): Promise<OutgoingTable> {
  const entries = await assetsPassing(tx, catalogue, today, filter)
  const names = isAllowed(identity, 'location.read') ? await namesOf(tx) : null

  return {
    name: 'Anlagen',
    columns: assetTableColumns,
    rows: entries.map((entry) =>
      assetTableRow(
        entry,
        catalogue.assetKind(entry.kind, today)?.definition.label ?? entry.kind,
        names === null
          ? ''
          : placeWords([
              names.property.get(entry.propertyId),
              names.building.get(entry.buildingId),
              entry.roomId === null ? null : names.room.get(entry.roomId),
            ]),
      ),
    ),
  }
}

/** What the table of the properties is asked for: the chip, the search and the order of the list. */
export interface PropertyTableAsked {
  readonly areaId: string | undefined
  readonly search: string
  readonly urgent: boolean
}

/** What an address asks the table of the properties for, or the refusal. */
export function propertyTableQuestion(
  query: Readonly<Record<string, unknown>>,
): PropertyTableAsked {
  const order = said(query, 'order')

  if (order !== undefined && order !== 'urgency') {
    throw new BadRequestException('Diese Reihenfolge kennt die Liste der Liegenschaften nicht.')
  }

  return {
    areaId: said(query, 'area'),
    search: searchedFor(said(query, 'search') ?? ''),
    urgent: order === 'urgency',
  }
}

/**
 * The properties with their buildings as a table, as the list
 * "Liegenschaften" shows them (4.1): narrowed to the area of the chip that is
 * pressed and to what is searched for, in the fixed order or by urgency, a
 * row for each property and a row for each of its buildings under it.
 *
 * The area stands where the list shows it, for whoever sees more than one;
 * an area the person does not hold in narrows nothing, as on the list. The
 * numbers stand for whoever may read the duties, each of them where the
 * person may read the list it counts, as the server counts them for the list
 * (#121); without them the order by urgency is the fixed one.
 */
export async function propertyTable(
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  today: IsoDate,
  asked: PropertyTableAsked,
): Promise<OutgoingTable> {
  const known = await areasInSight(tx)
  const propertyRows = await tx
    .select({
      id: properties.id,
      name: properties.name,
      street: properties.street,
      postalCode: properties.postalCode,
      city: properties.city,
      areaId: properties.areaId,
    })
    .from(properties)
    .where(isNull(properties.deletedAt))
  const buildingRows = await tx
    .select({ id: buildings.id, propertyId: buildings.propertyId, name: buildings.name })
    .from(buildings)
    .where(isNull(buildings.deletedAt))
  const toDo = isAllowed(identity, 'duty.read')
    ? await placesToDo(tx, catalogue, identity, today)
    : null

  const numbers = new Map<string, PlaceToDo>()

  for (const property of toDo?.properties ?? []) {
    numbers.set(property.propertyId, property)

    for (const building of property.buildings) {
      numbers.set(building.buildingId, building)
    }
  }

  const first = toDo?.properties[0]
  const offered =
    toDo === null ? [] : toDoNumbers.filter(({ key }) => first === undefined || first[key] !== null)
  const showsAreas = known.length > 1
  const areaName = new Map<string, string>(known.map((area) => [area.id as string, area.name]))
  const areaId = known.some((area) => area.id === asked.areaId) ? asked.areaId : undefined
  const inOrder = (left: { id: string; name: string }, right: { id: string; name: string }) =>
    (asked.urgent && toDo !== null ? byUrgency(numbers.get(left.id), numbers.get(right.id)) : 0) ||
    byNameIn(left.name, right.name)

  const buildingsOf = new Map<string, { id: string; name: string }[]>()

  for (const building of buildingRows) {
    const propertyId = building.propertyId as string

    buildingsOf.set(propertyId, [
      ...(buildingsOf.get(propertyId) ?? []),
      { id: building.id as string, name: building.name },
    ])
  }

  const shown = propertyRows
    .map((row) => ({ ...row, id: row.id as string, areaId: row.areaId as string }))
    .filter((property) => areaId === undefined || property.areaId === areaId)
    .filter(
      (property) =>
        asked.search === '' ||
        propertySearchText(
          property,
          (buildingsOf.get(property.id) ?? []).map((building) => building.name),
        ).includes(asked.search),
    )
    .sort(inOrder)

  const row = (
    property: (typeof shown)[number],
    building: { id: string; name: string } | null,
  ): TableRow => {
    const counted = numbers.get(building?.id ?? property.id)

    return [
      property.name,
      building?.name ?? null,
      addressWords(property),
      ...(showsAreas ? [areaName.get(property.areaId) ?? null] : []),
      ...offered.map(({ key }) => counted?.[key] ?? null),
    ]
  }

  return {
    name: 'Liegenschaften',
    columns: [
      propertyTableColumns.property,
      propertyTableColumns.building,
      propertyTableColumns.address,
      ...(showsAreas ? [propertyTableColumns.area] : []),
      ...offered.map(({ label }) => label),
    ],
    rows: shown.flatMap((property) => [
      row(property, null),
      ...[...(buildingsOf.get(property.id) ?? [])]
        .sort(inOrder)
        .map((building) => row(property, building)),
    ]),
  }
}

/**
 * What a list asks for to be read whole for its table: from its first row,
 * and no page. One row more than a table goes out with, so that a list
 * longer than that is refused by `tableAnswer` and never cut short.
 */
export const wholeList = { offset: 0, limit: outgoingTableRows + 1 } as const

/**
 * The assets a person reads, for a column that names where a record hangs:
 * the number and the name for whoever reads assets, and for everybody the
 * building an asset stands in, which says where it is to whoever reads the
 * places. Null for whoever reads neither.
 */
export async function assetLookupFor(
  tx: TenantTransaction,
  identity: Asking,
): Promise<AssetLookup | null> {
  const named = isAllowed(identity, 'asset.read')

  if (!named && !isAllowed(identity, 'location.read')) {
    return null
  }

  const rows = await tx
    .select({
      id: assets.id,
      number: assets.number,
      name: assets.name,
      buildingId: assets.buildingId,
    })
    .from(assets)
    .where(isNull(assets.deletedAt))
  const byId = new Map(
    rows.map((row) => [
      row.id as string,
      {
        number: named ? row.number : null,
        name: named ? row.name : null,
        buildingId: row.buildingId as string | null,
      },
    ]),
  )

  return (id) => byId.get(id) ?? null
}

/** "Prüfungen" as a table: the activities of the list, with the people only for the Leitung. */
export async function activityTable(
  tx: TenantTransaction,
  identity: Asking,
  rows: readonly ActivityEntry[],
  today: IsoDate,
): Promise<OutgoingTable> {
  const names = await placeNamesFor(tx, identity)
  const assetNames = await assetLookupFor(tx, identity)
  const people = tableNamesPeople(identity)

  return {
    name: 'Prüfungen',
    columns: activityTableHeads(people),
    rows: rows.map((row) =>
      activityTableRow(row, whereWords(targetWhere(row, names, assetNames)), people, today),
    ),
  }
}

/** "Aufträge" as a table: the orders of the list, with who answers for each only for the Leitung. */
export async function workOrderTable(
  tx: TenantTransaction,
  identity: Asking,
  rows: readonly WorkOrderEntry[],
  today: IsoDate,
): Promise<OutgoingTable> {
  const names = await placeNamesFor(tx, identity)
  const assetNames = await assetLookupFor(tx, identity)
  const people = tableNamesPeople(identity)

  return {
    name: 'Aufträge',
    columns: workOrderTableHeads(people),
    rows: rows.map((row) =>
      workOrderTableRow(row, whereWords(targetWhere(row, names, assetNames)), people, today),
    ),
  }
}

/**
 * "Mängel" as a table: the defects of the register with their class as the
 * catalogue of the server names it. The server names where a defect is; the
 * names of the places and of the asset stand only for whoever reads them,
 * and the work order only for whoever reads work orders.
 */
export function defectTable(
  catalogue: Catalogue,
  identity: Asking,
  rows: readonly DefectEntry[],
): OutgoingTable {
  const reads = {
    places: isAllowed(identity, 'location.read'),
    assets: isAllowed(identity, 'asset.read'),
  }
  const orders = isAllowed(identity, 'activity.read')

  return {
    name: 'Mängel',
    columns: Object.values(defectTableColumns),
    rows: rows.map((row) =>
      defectTableRow(
        row,
        whereWords(defectWhere(row.place, reads)),
        row.defectClass === null
          ? null
          : (catalogue.defectClass(row.defectClass)?.defectClass.label ?? row.defectClass),
        orders,
      ),
    ),
  }
}

/**
 * "Zähler" as a table: the measuring points of the list, a sub meter under
 * its main meter. Where each is stands for whoever reads places.
 */
export async function meterTable(
  tx: TenantTransaction,
  identity: Asking,
  meters: readonly MeterEntry[],
): Promise<OutgoingTable> {
  return {
    name: 'Zähler',
    columns: Object.values(meterTableColumns),
    rows: meterTableRows(meters, await placeNamesFor(tx, identity)),
  }
}

/**
 * "Pflichtenverzeichnis" as a table: the duties of the register, with what
 * each hangs on named for whoever reads it, and who answers for each only
 * for the Leitung. A duty arrives here without that person where the table
 * names nobody.
 */
export async function dutyTable(
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  rows: readonly DutyEntry[],
): Promise<OutgoingTable> {
  const names = await placeNamesFor(tx, identity)
  const assetNames = await assetLookupFor(tx, identity)
  const people = tableNamesPeople(identity)

  return {
    name: 'Pflichtenverzeichnis',
    columns: dutyTableHeads(people),
    rows: rows.map((row) =>
      dutyTableRow(row, whereWords(targetWhere(row, names, assetNames)), catalogue, people),
    ),
  }
}

/** Which of the two lists of proposals a table holds: the open ones, or those dismissed. */
export type ProposalList = 'open' | 'dismissed'

/**
 * The proposals of the catalogue as a table, the open ones or those
 * dismissed, narrowed to a package as the list narrows them. The asset is
 * named for whoever reads assets, its place for whoever reads places.
 */
export async function proposalTable(
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  today: IsoDate,
  read: DutyProposals,
  list: ProposalList,
  inPackage: string | null,
): Promise<OutgoingTable> {
  const reads = {
    assets: isAllowed(identity, 'asset.read'),
    names: await placeNamesFor(tx, identity),
  }
  const within = <Row extends { readonly kind: string }>(rows: readonly Row[]) =>
    rows.filter((row) => inPackage === null || packageOf(row.kind) === inPackage)

  return list === 'dismissed'
    ? {
        name: 'Verworfene Vorschläge',
        columns: Object.values(dismissedTableColumns),
        rows: dismissedTableRows(within(read.dismissed), catalogue, today, reads),
      }
    : {
        name: 'Vorschläge',
        columns: Object.values(proposalTableColumns),
        rows: proposalTableRows(within(read.proposals), catalogue, today, reads),
      }
}
