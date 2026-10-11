import { BadRequestException } from '@nestjs/common'
import {
  type ActivityEntry,
  activityTableHeads,
  activityTableRow,
  addDays,
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
  type DocumentHome,
  documentHomeLabel,
  documentHomeOf,
  documentHomeWords,
  type DocumentLine,
  documentTableColumns,
  documentTableRow,
  type DutyEntry,
  type DutyProposals,
  dutyTableHeads,
  dutyTableRow,
  everybodyIn,
  hasHolidays,
  holidayClosures,
  holidaysBetween,
  isAllowed,
  type IsoDate,
  type MeterEntry,
  meterTableColumns,
  meterTableRows,
  outgoingTableRows,
  packageOf,
  passSearchDays,
  type PlaceNames,
  type PlaceToDo,
  placeWords,
  type PlanLine,
  planNextPass,
  planStateOn,
  planStateText,
  propertySearchText,
  propertyTableColumns,
  proposalTableColumns,
  proposalTableRows,
  rhythmText,
  roomTitle,
  type RoundLine,
  roundPlace,
  roundPlanTableColumns,
  roundPlanTableRows,
  roundTemplateTableColumns,
  roundTemplateTableRows,
  type RoundWeek,
  roundWeekTableColumns,
  roundWeekTableRows,
  roundWeekWords,
  searchedFor,
  tableNamesPeople,
  type TableRow,
  targetWhere,
  type TaskLine,
  taskTableHeads,
  taskTableRows,
  type TemplateLine,
  templateSizeWords,
  toDoNumbers,
  whereWords,
  type WorkOrderEntry,
  workOrderTableHeads,
  workOrderTableRow,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  type Database,
  type OutgoingTable,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'

import { areasInSight } from '../areas/areas.js'
import {
  activities,
  assets,
  attachments,
  attachmentVersions,
  buildingClosures,
  buildings,
  defects,
  properties,
  rooms,
  roundPlans,
  roundTemplates,
  roundTemplateVersions,
  tasks,
} from '../database/schema/index.js'
import { deviceScope } from '../sync/device-scope.js'
import { dayInGermany } from '../today.js'
import { inSight } from './activities.controller.js'
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

/** The titles of the activities with these ids, as far as the person reads activities and is shown them. */
async function activityTitlesFor(
  tx: TenantTransaction,
  identity: Asking,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0 || !isAllowed(identity, 'activity.read')) {
    return new Map()
  }

  const rows = await tx
    .select({ id: activities.id, title: activities.title })
    .from(activities)
    .where(
      and(inArray(activities.id, ids as never[]), isNull(activities.deletedAt), inSight(identity)),
    )

  return new Map(rows.map((row) => [row.id as string, row.title]))
}

/**
 * "Aufgaben" as a table: the open tasks a device of the person holds, their
 * own first and then those open with the others, as the list shows them.
 * Whoever sees every area holds every task; everybody else those for them
 * and those they wrote (`deviceScope`). Who a task is for stands only for
 * whoever may see the staff.
 */
export async function taskTable(
  database: Database,
  tx: TenantTransaction,
  identity: Asking,
  today: IsoDate,
): Promise<OutgoingTable> {
  const scope = await deviceScope(tx, identity.userId)
  const held =
    !scope.everyArea && scope.taskIds.length === 0
      ? []
      : await tx
          .select()
          .from(tasks)
          .where(
            and(
              isNull(tasks.deletedAt),
              eq(tasks.status, 'open'),
              ...(scope.everyArea ? [] : [inArray(tasks.id, scope.taskIds as never[])]),
            ),
          )
  const names = await placeNamesFor(tx, identity)
  const assetNames = await assetLookupFor(tx, identity)
  const titles = await activityTitlesFor(
    tx,
    identity,
    held.flatMap((task) => (task.activityId === null ? [] : [task.activityId as string])),
  )
  const people = tableNamesPeople(identity)
  // Nobody is looked up by name for a table that names nobody.
  const accounts = people
    ? await accountsOf(
        database,
        [...new Set(held.map((task) => task.assigneeUserId))],
        identity.userId,
      )
    : new Map<string, { readonly name: string }>()

  const lines: TaskLine[] = held.map((task) => {
    const where = targetWhere(task, names, assetNames)

    return {
      id: task.id as string,
      status: task.status,
      dueOn: task.dueOn as IsoDate,
      title: task.title,
      assigneeUserId: task.assigneeUserId,
      responsible: people ? (accounts.get(task.assigneeUserId)?.name ?? 'Unbekanntes Konto') : null,
      where:
        task.activityId === null
          ? whereWords(where)
          : placeWords([
              titles.get(task.activityId as string) ?? documentHomeLabel.activityId,
              where.line,
            ]),
    }
  })

  return {
    name: 'Aufgaben',
    columns: taskTableHeads(people),
    rows: taskTableRows(lines, identity.userId, today, people),
  }
}

/**
 * "Dokumente" as a table: the documents of the places in the areas of the
 * person, as a device of theirs holds them, the one changed last first.
 * What a document hangs on is named for whoever reads that record: a place
 * with `location.read`, an asset with `asset.read`, an activity with
 * `activity.read` as far as the person is shown it, a defect with
 * `defect.read`; otherwise it is named by its kind.
 */
export async function documentTable(
  tx: TenantTransaction,
  identity: Asking,
  asked: { readonly kind: string | null; readonly home: DocumentHome | null },
): Promise<OutgoingTable> {
  const filed = (await tx.select().from(attachments).where(isNull(attachments.deletedAt)))
    .map((document) => ({ ...document, home: documentHomeOf(document) }))
    .filter(
      (document) =>
        (asked.kind === null || document.kind === asked.kind) &&
        (asked.home === null || document.home === asked.home),
    )
  // The newest first: the id of a version is minted when it is made.
  const versions = await tx
    .select({
      id: attachmentVersions.id,
      attachmentId: attachmentVersions.attachmentId,
      fileName: attachmentVersions.fileName,
      mediaType: attachmentVersions.mediaType,
      createdAt: attachmentVersions.createdAt,
    })
    .from(attachmentVersions)
    .where(isNull(attachmentVersions.deletedAt))
    .orderBy(desc(attachmentVersions.id))
  const versionsOf = new Map<string, (typeof versions)[number][]>()

  for (const version of versions) {
    const of = version.attachmentId as string

    versionsOf.set(of, [...(versionsOf.get(of) ?? []), version])
  }

  const names = await placeNamesFor(tx, identity)
  const assetNames = isAllowed(identity, 'asset.read') ? await assetLookupFor(tx, identity) : null
  const titles = await activityTitlesFor(
    tx,
    identity,
    filed.flatMap((document) =>
      document.activityId === null ? [] : [document.activityId as string],
    ),
  )
  const defectIds = filed.flatMap((document) =>
    document.defectId === null ? [] : [document.defectId as string],
  )
  const found =
    defectIds.length === 0 || !isAllowed(identity, 'defect.read')
      ? new Map<string, string>()
      : new Map(
          (
            await tx
              .select({ id: defects.id, description: defects.description })
              .from(defects)
              .where(and(inArray(defects.id, defectIds as never[]), isNull(defects.deletedAt)))
          ).map((row) => [row.id as string, row.description]),
        )

  /** What a document hangs on by its name, as far as the person reads it. */
  const named = (document: (typeof filed)[number]): string | null => {
    switch (document.home) {
      case 'assetId': {
        const asset = assetNames?.(document.assetId as string) ?? null
        const words = [asset?.number, asset?.name].filter(Boolean).join(' ')

        return words === '' ? null : words
      }

      case 'roomId': {
        const room = names?.room(document.roomId as string) ?? null

        return room === null ? null : roomTitle(room)
      }

      case 'buildingId':
        return names?.building(document.buildingId as string) ?? null
      case 'activityId':
        return titles.get(document.activityId as string) ?? null
      case 'defectId':
        return found.get(document.defectId as string) ?? null
      case 'propertyId':
        return null
    }
  }
  const stampOf = (document: (typeof filed)[number]) =>
    (versionsOf.get(document.id as string)?.[0]?.id as string | undefined) ??
    (document.id as string)

  const lines: DocumentLine[] = [...filed]
    .sort((left, right) => stampOf(right).localeCompare(stampOf(left)))
    .map((document) => {
      const all = versionsOf.get(document.id as string) ?? []
      const newest = all[0] ?? null

      return {
        title: document.title,
        kind: document.kind,
        home: documentHomeWords(
          document.home,
          named(document),
          names?.property(document.propertyId as string) ?? null,
        ),
        versions: all.length,
        newest:
          newest === null
            ? null
            : {
                fileName: newest.fileName,
                mediaType: newest.mediaType,
                filedOn: dayInGermany(newest.createdAt),
              },
      }
    })

  return {
    name: 'Dokumente',
    columns: Object.values(documentTableColumns),
    rows: lines.map(documentTableRow),
  }
}

/**
 * "Rundgänge" as a table: every round of the week the overview shows, and
 * every one left open from earlier weeks, narrowed to an area as the screen
 * narrows them. The rounds are those the person is shown, read as the
 * overview reads them. Where a plan is walked is named for whoever reads
 * places; who walks a round is a person only for whoever may see the staff,
 * and everybody in the area, which is no person, for everybody.
 */
export async function roundWeekTable(
  database: Database,
  tx: TenantTransaction,
  identity: Asking,
  week: RoundWeek,
  areaId: string | null,
): Promise<OutgoingTable> {
  const shown = [
    ...week.rounds.map((round) => ({ round, before: false })),
    ...week.before.map((round) => ({ round, before: true })),
  ]
  const planIds = [...new Set(shown.map(({ round }) => round.planId as string))]
  const plans =
    planIds.length === 0
      ? []
      : await tx
          .select()
          .from(roundPlans)
          .where(inArray(roundPlans.id, planIds as never[]))
  const planOf = new Map(plans.map((plan) => [plan.id as string, plan]))
  const titleOf = new Map(
    planIds.length === 0
      ? []
      : (
          await tx
            .select({ id: roundTemplates.id, title: roundTemplates.title })
            .from(roundTemplates)
        ).map((template) => [template.id as string, template.title]),
  )
  const names = await placeNamesFor(tx, identity)
  const areaNames = new Map((await areasInSight(tx)).map((area) => [area.id as string, area.name]))
  const people = tableNamesPeople(identity)
  // Nobody is looked up by name for a table that names nobody.
  const accounts = people
    ? await accountsOf(
        database,
        [...new Set(shown.flatMap(({ round }) => round.performerUserId ?? []))],
        identity.userId,
      )
    : new Map<string, { readonly name: string }>()

  const lines: RoundLine[] = shown.flatMap(({ round, before }) => {
    const plan = planOf.get(round.planId as string)

    if (plan === undefined || (areaId !== null && plan.areaId !== areaId)) {
      return []
    }

    return [
      {
        before,
        ...roundPlace(
          { propertyId: plan.propertyId as string, buildingId: plan.buildingId as string | null },
          names,
        ),
        title: titleOf.get(plan.templateId as string) ?? roundWeekWords.round,
        rhythm: rhythmText(plan),
        dueOn: round.dueOn,
        walker:
          round.performerUserId === null
            ? everybodyIn(areaNames.get(plan.areaId as string) ?? null)
            : people
              ? (accounts.get(round.performerUserId)?.name ?? 'Unbekannte Person')
              : null,
        state: round.state,
      },
    ]
  })

  return {
    name: 'Rundgänge',
    columns: Object.values(roundWeekTableColumns),
    rows: roundWeekTableRows(lines),
  }
}

/**
 * The operator's own templates of rounds as a table: each with the size and
 * the day of its newest version, whether a round of it asks for a
 * countersignature, and how many rounds were made of it, counted as the
 * list counts them.
 */
export async function roundTemplateTable(
  tx: TenantTransaction,
  counted: readonly { readonly templateId: string; readonly rounds: number }[],
): Promise<OutgoingTable> {
  const templates = await tx
    .select({ id: roundTemplates.id, title: roundTemplates.title })
    .from(roundTemplates)
    .where(isNull(roundTemplates.deletedAt))
  const versions = await tx
    .select({
      templateId: roundTemplateVersions.templateId,
      formVersion: roundTemplateVersions.formVersion,
      definition: roundTemplateVersions.definition,
      asksCountersignature: roundTemplateVersions.asksCountersignature,
      createdAt: roundTemplateVersions.createdAt,
    })
    .from(roundTemplateVersions)
    .orderBy(desc(roundTemplateVersions.formVersion))
  const newestOf = new Map<string, (typeof versions)[number]>()

  for (const version of versions) {
    if (!newestOf.has(version.templateId as string)) {
      newestOf.set(version.templateId as string, version)
    }
  }

  const lines: TemplateLine[] = templates.flatMap((template) => {
    const newest = newestOf.get(template.id as string)

    return newest === undefined
      ? []
      : [
          {
            title: template.title,
            size: templateSizeWords(newest.definition),
            formVersion: newest.formVersion,
            since: dayInGermany(newest.createdAt),
            asksCountersignature: newest.asksCountersignature,
            rounds: counted
              .filter((each) => each.templateId === template.id)
              .reduce((sum, each) => sum + each.rounds, 0),
          },
        ]
  })

  return {
    name: 'Vorlagen der Rundgänge',
    columns: Object.values(roundTemplateTableColumns),
    rows: roundTemplateTableRows(lines),
  }
}

/**
 * "Pläne" as a table: every plan of the rounds the person sees, with its
 * template and rhythm, where it is walked, who walks its rounds, its next
 * pass and whether it runs. The next pass is worked out as the list works
 * it out: the first day of its calendar from today on that its building is
 * open for, the statutory public holidays left out where the plan says so.
 * Who walks the rounds is a person only for whoever may see the staff.
 */
export async function roundPlanTable(
  database: Database,
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  today: IsoDate,
): Promise<OutgoingTable> {
  const plans = await tx.select().from(roundPlans).where(isNull(roundPlans.deletedAt))
  const titleOf = new Map(
    (
      await tx.select({ id: roundTemplates.id, title: roundTemplates.title }).from(roundTemplates)
    ).map((template) => [template.id as string, template.title]),
  )
  const closed = await tx
    .select({
      buildingId: buildingClosures.buildingId,
      startsOn: buildingClosures.startsOn,
      endsOn: buildingClosures.endsOn,
    })
    .from(buildingClosures)
    .where(isNull(buildingClosures.deletedAt))
  const stateOf = new Map(
    (
      await tx
        .select({ id: properties.id, federalState: properties.federalState })
        .from(properties)
        .where(isNull(properties.deletedAt))
    ).map((property) => [property.id as string, property.federalState]),
  )
  const names = await placeNamesFor(tx, identity)
  const areaNames = new Map((await areasInSight(tx)).map((area) => [area.id as string, area.name]))
  const people = tableNamesPeople(identity)
  // Nobody is looked up by name for a table that names nobody.
  const accounts = people
    ? await accountsOf(
        database,
        [...new Set(plans.flatMap((plan) => plan.performerUserId ?? []))],
        identity.userId,
      )
    : new Map<string, { readonly name: string }>()

  const lines: PlanLine[] = plans.map((plan) => {
    const calendar = {
      rhythm: plan.rhythm,
      weekdays: plan.weekdays,
      dayOfMonth: plan.dayOfMonth,
      month: plan.month,
      startsOn: plan.startsOn as IsoDate,
      endsOn: plan.endsOn as IsoDate | null,
    }
    const standing = { startsOn: calendar.startsOn, endsOn: calendar.endsOn, resting: plan.resting }
    const state = planStateOn(standing, today)
    const start = calendar.startsOn > today ? calendar.startsOn : today
    const federalState = stateOf.get(plan.propertyId as string) ?? null
    const holidays =
      plan.skipHolidays && federalState !== null && hasHolidays(catalogue, federalState)
        ? holidayClosures(
            holidaysBetween(catalogue, federalState, start, addDays(start, passSearchDays)),
          )
        : []

    return {
      title: titleOf.get(plan.templateId as string) ?? 'Vorlage',
      rhythm: rhythmText(calendar),
      ...roundPlace(
        { propertyId: plan.propertyId as string, buildingId: plan.buildingId as string | null },
        names,
      ),
      walker:
        plan.performerUserId === null
          ? everybodyIn(areaNames.get(plan.areaId as string) ?? null)
          : people
            ? (accounts.get(plan.performerUserId)?.name ?? 'Unbekannte Person')
            : null,
      next:
        state === 'running' || state === 'upcoming'
          ? planNextPass(
              calendar,
              [...closed.filter((closure) => closure.buildingId === plan.buildingId), ...holidays],
              start,
            )
          : null,
      state: planStateText(standing, today),
    }
  })

  return {
    name: 'Pläne der Rundgänge',
    columns: Object.values(roundPlanTableColumns),
    rows: roundPlanTableRows(lines),
  }
}
