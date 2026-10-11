import { BadRequestException } from '@nestjs/common'
import {
  addressWords,
  type AssetRegisterFilter,
  assetTableColumns,
  assetTableRow,
  byNameIn,
  byUrgency,
  type Catalogue,
  type IsoDate,
  isAllowed,
  type PlaceToDo,
  placeWords,
  propertySearchText,
  propertyTableColumns,
  searchedFor,
  type TableRow,
  toDoNumbers,
} from '@opengewerk/haustechnik-domain'
import { type OutgoingTable, type TenantTransaction } from '@opengewerk/platform-server'
import { isNull } from 'drizzle-orm'

import { areasInSight } from '../areas/areas.js'
import { buildings, properties, rooms } from '../database/schema/index.js'
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
