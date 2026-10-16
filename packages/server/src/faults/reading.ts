import {
  type ActivityStatus,
  type AreaId,
  type AssetId,
  type BuildingId,
  type FaultCategory,
  type FaultCategoryId,
  type FaultInboxFilter,
  type FaultPlaceChoice,
  type FaultPlaceWords,
  type FaultReportEntry,
  type FaultReportId,
  faultReportState,
  type FaultReportState,
  type OwnFaultReport,
  type PropertyId,
  proposedFaultCategories,
  type RoomId,
  roomTitle,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import {
  activities,
  activitySignatures,
  assets,
  buildings,
  faultCategories,
  faultReports,
  floors,
  properties,
  rooms,
  workOrders,
} from '../database/schema/index.js'

// How the fault reports are read (#331, section 4.7 of the concept): the
// categories with their proposal, the places a person may report at, and the
// rows of the reports with the names of their place and the state that their
// work order gives them. Every question runs under the policies of the person
// asking, so a report, a building and a room of another area are not there.

/**
 * The categories of the operator, the proposal of the first start written
 * once when it has none at all (decided 15.10.2026). A category that was
 * removed is a row as well, so an operator that removed all of them gets no
 * proposal again.
 */
export async function ensureCategories(tx: TenantTransaction, tenantId: string): Promise<void> {
  const [held] = await tx.select({ n: count() }).from(faultCategories)

  if ((held?.n ?? 0) > 0) {
    return
  }

  await tx.insert(faultCategories).values(
    proposedFaultCategories.map((name, position) => ({
      tenantId: tenantId as never,
      name,
      position,
    })),
  )
}

/** The categories still offered, in the order of the choice; with `counted` how many reports carry each. */
export async function categoriesOf(
  tx: TenantTransaction,
  counted = false,
): Promise<readonly FaultCategory[]> {
  const rows = await tx
    .select({ id: faultCategories.id, name: faultCategories.name })
    .from(faultCategories)
    .where(isNull(faultCategories.removedAt))
    .orderBy(asc(faultCategories.position), asc(faultCategories.id))

  if (!counted) {
    return rows.map((row) => ({ id: row.id as FaultCategoryId, name: row.name }))
  }

  // Asked in every report the person sees: a report of another area is not counted.
  const uses = await tx
    .select({ id: faultReports.categoryId, n: count() })
    .from(faultReports)
    .groupBy(faultReports.categoryId)
  const byId = new Map(uses.map((use) => [use.id as string, use.n]))

  return rows.map((row) => ({
    id: row.id as FaultCategoryId,
    name: row.name,
    reports: byId.get(row.id) ?? 0,
  }))
}

/**
 * The buildings of the own areas with their rooms, by their names only
 * (section 4.7 of the concept): what a person who reports chooses a place
 * from. Buildings and rooms that are marked removed are not offered.
 */
export async function placeChoices(tx: TenantTransaction): Promise<readonly FaultPlaceChoice[]> {
  const found = await tx
    .select({
      buildingId: buildings.id,
      building: buildings.name,
      property: properties.name,
    })
    .from(buildings)
    .innerJoin(properties, eq(properties.id, buildings.propertyId))
    .where(and(isNull(buildings.deletedAt), isNull(properties.deletedAt)))
    .orderBy(asc(properties.name), asc(buildings.name))

  if (found.length === 0) {
    return []
  }

  const inside = await tx
    .select({
      id: rooms.id,
      buildingId: rooms.buildingId,
      number: rooms.number,
      name: rooms.name,
      floor: floors.name,
      level: floors.level,
    })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .where(
      and(
        isNull(rooms.deletedAt),
        inArray(
          rooms.buildingId,
          found.map((building) => building.buildingId),
        ),
      ),
    )
    .orderBy(asc(floors.level), asc(rooms.number), asc(rooms.name))

  return found.map((building) => ({
    buildingId: building.buildingId as BuildingId,
    property: building.property,
    building: building.building,
    rooms: inside
      .filter((room) => room.buildingId === building.buildingId)
      .map((room) => ({
        id: room.id as RoomId,
        name: roomTitle(room),
        floor: room.floor,
      })),
  }))
}

type ReportId = (typeof faultReports.$inferSelect)['id']
type BuildingRowId = (typeof faultReports.$inferSelect)['buildingId']
type SignatureActivityId = (typeof activitySignatures.$inferSelect)['activityId']

/** The report another one went into, as the rows below read it. */
const target = alias(faultReports, 'merged_into')
/** The work order of a report, or of the report it went into. */
const order = alias(workOrders, 'fault_order')
const work = alias(activities, 'fault_work')
const assetRoom = alias(rooms, 'asset_room')

/** The rows of the reports with the names of their place, their category and their order. */
function selectRows(tx: TenantTransaction) {
  return tx
    .select({
      report: faultReports,
      category: faultCategories.name,
      property: properties.name,
      building: buildings.name,
      roomNumber: sql<string | null>`coalesce(${rooms.number}, ${assetRoom.number})`,
      roomName: sql<string | null>`coalesce(${rooms.name}, ${assetRoom.name})`,
      assetNumber: assets.number,
      assetName: assets.name,
      // A report merged into another follows that one (decided 15.10.2026).
      followsWorkOrderId: sql<
        string | null
      >`coalesce(${target.workOrderId}, ${faultReports.workOrderId})`,
      followsRejectedAt: target.rejectedAt,
      followsRejectionReason: target.rejectionReason,
      followsAcceptedAt: sql<Date | null>`coalesce(${target.acceptedAt}, ${faultReports.acceptedAt})`,
      orderActivityId: work.id,
      orderNumber: order.number,
      orderTitle: work.title,
      orderStatus: work.status,
      orderDeleted: work.deletedAt,
    })
    .from(faultReports)
    .innerJoin(faultCategories, eq(faultCategories.id, faultReports.categoryId))
    .innerJoin(properties, eq(properties.id, faultReports.propertyId))
    .innerJoin(buildings, eq(buildings.id, faultReports.buildingId))
    .leftJoin(rooms, eq(rooms.id, faultReports.roomId))
    .leftJoin(assets, eq(assets.id, faultReports.assetId))
    .leftJoin(assetRoom, eq(assetRoom.id, assets.roomId))
    .leftJoin(target, eq(target.id, faultReports.mergedIntoId))
    .leftJoin(
      order,
      sql`${order.id} = coalesce(${target.workOrderId}, ${faultReports.workOrderId})`,
    )
    .leftJoin(work, eq(work.id, order.activityId))
}

export type FaultRow = Awaited<ReturnType<ReturnType<typeof selectRows>['where']>>[number]

/** The words of the place of a row: no asset, which a Melder never sees named. */
export function wordsOf(row: FaultRow): FaultPlaceWords {
  const room =
    row.roomNumber === null && row.roomName === null
      ? null
      : roomTitle({ number: row.roomNumber, name: row.roomName })

  return { property: row.property, building: row.building, room }
}

/** The status of the order a row follows, or none; an order marked removed is none. */
function orderStatusOf(row: FaultRow): ActivityStatus | null {
  return row.orderStatus === null || row.orderDeleted !== null ? null : row.orderStatus
}

/** The state of a row by itself: merged where it went into another. */
export function stateOf(row: FaultRow): FaultReportState {
  return faultReportState(
    {
      workOrderId: row.report.workOrderId as never,
      rejectedAt: row.report.rejectedAt?.toISOString() ?? null,
      mergedIntoId: row.report.mergedIntoId as never,
    },
    orderStatusOf(row),
  )
}

/**
 * The state a person who reported sees: that of the report it went into for
 * one that was merged, as the feedback is the same (decided 15.10.2026).
 */
export function followedStateOf(row: FaultRow): FaultReportState {
  if (row.report.mergedIntoId === null) {
    return stateOf(row)
  }

  return faultReportState(
    {
      workOrderId: row.followsWorkOrderId as never,
      rejectedAt: row.followsRejectedAt?.toISOString() ?? null,
      mergedIntoId: null,
    },
    orderStatusOf(row),
  )
}

/** A row as an entry of the inbox. */
export function entryOf(row: FaultRow): FaultReportEntry {
  return {
    id: row.report.id as FaultReportId,
    category: row.category,
    description: row.report.description,
    words: wordsOf(row),
    propertyId: row.report.propertyId as PropertyId,
    buildingId: row.report.buildingId as BuildingId,
    roomId: row.report.roomId as RoomId | null,
    areaId: row.report.areaId as AreaId,
    assetId: row.report.assetId as AssetId | null,
    assetName:
      row.assetName === null ? null : [row.assetNumber, row.assetName].filter(Boolean).join(' '),
    receivedAt: row.report.receivedAt.toISOString(),
    state: stateOf(row),
    workOrder:
      row.report.workOrderId === null || row.orderActivityId === null
        ? null
        : { activityId: row.orderActivityId, number: row.orderNumber },
  }
}

/** The condition of a filter of the inbox, held against the state each row has by itself. */
function filterCondition(filter: FaultInboxFilter): SQL | undefined {
  const notMerged = sql`${faultReports.mergedIntoId} is null`
  const notRejected = sql`${faultReports.rejectedAt} is null`
  const orderOpen = sql`${work.status} in ('open', 'started') and ${work.deletedAt} is null`
  const orderSigned = sql`${work.status} in ('signed', 'done') and ${work.deletedAt} is null`
  const noOrder = sql`(${faultReports.workOrderId} is null or ${work.status} = 'not_performed' or ${work.deletedAt} is not null)`

  switch (filter) {
    case 'received':
      return sql`${notMerged} and ${notRejected} and ${noOrder}`
    case 'accepted':
      return sql`${faultReports.workOrderId} is not null and ${orderOpen}`
    case 'done':
      return sql`${faultReports.workOrderId} is not null and ${orderSigned}`
    case 'rejected':
      return sql`${faultReports.rejectedAt} is not null`
    case 'all':
      return undefined
  }
}

/** What narrows the inbox besides the state. */
export interface FaultInboxQuestion {
  readonly filter: FaultInboxFilter
  readonly propertyId?: string
  readonly buildingId?: string
  readonly assetId?: string
  readonly areaId?: string
  readonly categoryId?: string
}

/** The inbox, the newest first, narrowed by state and place. */
export async function inbox(
  tx: TenantTransaction,
  question: FaultInboxQuestion,
): Promise<readonly FaultReportEntry[]> {
  const parts: SQL[] = []
  const state = filterCondition(question.filter)

  if (state !== undefined) {
    parts.push(state)
  }

  for (const [column, value] of [
    [faultReports.propertyId, question.propertyId],
    [faultReports.buildingId, question.buildingId],
    [faultReports.assetId, question.assetId],
    [faultReports.areaId, question.areaId],
    [faultReports.categoryId, question.categoryId],
  ] as const) {
    if (value !== undefined) {
      parts.push(sql`${column} = ${value}`)
    }
  }

  const rows = await selectRows(tx)
    .where(parts.length === 0 ? undefined : and(...parts))
    .orderBy(desc(faultReports.receivedAt), desc(faultReports.id))
    .limit(500)

  return rows.map(entryOf)
}

/** The rows of the reports the condition names, the newest first. */
export function rowsWhere(tx: TenantTransaction, condition: SQL) {
  return selectRows(tx)
    .where(condition)
    .orderBy(desc(faultReports.receivedAt), desc(faultReports.id))
}

/** One report the person asking sees, or none. */
export async function rowOf(tx: TenantTransaction, id: string): Promise<FaultRow | null> {
  const [row] = await selectRows(tx).where(eq(faultReports.id, id as ReportId))

  return row ?? null
}

/**
 * The open reports of the places the person sees, counted per building: in
 * the inbox or accepted, by themselves and not merged (#331, the Lagebild).
 */
export async function openFaultsByBuilding(
  tx: TenantTransaction,
  buildingIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (buildingIds.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({ buildingId: faultReports.buildingId, n: count() })
    .from(faultReports)
    .leftJoin(order, eq(order.id, faultReports.workOrderId))
    .leftJoin(work, eq(work.id, order.activityId))
    .where(
      and(
        inArray(faultReports.buildingId, buildingIds as BuildingRowId[]),
        isNull(faultReports.mergedIntoId),
        isNull(faultReports.rejectedAt),
        sql`(${faultReports.workOrderId} is null or ${work.deletedAt} is not null or ${work.status} in ('open', 'started', 'not_performed'))`,
      ),
    )
    .groupBy(faultReports.buildingId)

  return new Map(rows.map((row) => [row.buildingId as string, row.n]))
}

/**
 * The moment the order of a report was signed, for a report that is done: the
 * last signature of whoever led it (section 4.8 of the concept).
 */
export async function signedAtOf(tx: TenantTransaction, activityId: string): Promise<Date | null> {
  const [signature] = await tx
    .select({ signedAt: activitySignatures.signedAt })
    .from(activitySignatures)
    .where(
      and(
        eq(activitySignatures.activityId, activityId as SignatureActivityId),
        eq(activitySignatures.role, 'signer'),
        isNull(activitySignatures.deletedAt),
      ),
    )
    .orderBy(desc(activitySignatures.signedAt))
    .limit(1)

  return signature?.signedAt ?? null
}

/** A row as the own list of the person who reported it reads it. */
export async function ownOf(tx: TenantTransaction, row: FaultRow): Promise<OwnFaultReport> {
  const state = followedStateOf(row)
  const doneAt =
    state === 'done' && row.orderActivityId !== null
      ? await signedAtOf(tx, row.orderActivityId)
      : null

  return {
    id: row.report.id as FaultReportId,
    category: row.category,
    description: row.report.description,
    words: wordsOf(row),
    receivedAt: row.report.receivedAt.toISOString(),
    state,
    acceptedAt:
      state === 'accepted' || state === 'done'
        ? row.followsAcceptedAt === null
          ? null
          : new Date(row.followsAcceptedAt).toISOString()
        : null,
    doneAt: doneAt?.toISOString() ?? null,
    rejectionReason:
      state === 'rejected'
        ? row.report.mergedIntoId === null
          ? row.report.rejectionReason
          : row.followsRejectionReason
        : null,
    hasPhoto: row.report.photoSha256 !== null,
  }
}
