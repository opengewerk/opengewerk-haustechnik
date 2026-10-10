import { BadRequestException } from '@nestjs/common'
import {
  type ActivityKind,
  type ActivityStatus,
  type Catalogue,
  type DefectClassChoice,
  defectClassChoices,
  type DefectEntry,
  type DefectId,
  type DefectOrigin,
  type DefectReading,
  type DefectRegister,
  type DefectRegisterFilter,
  defectRegisterPage,
  type DefectRegisterState,
  defectRegisterStates,
  type DefectSummary,
  type IsoDate,
  isOverdue,
  roomTitle,
  withoutClass,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, count, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { counted, said } from '../api/register-question.js'
import {
  activities,
  activityDuties,
  assets,
  buildings,
  defectClassTerms,
  defects,
  duties,
  evidence,
  properties,
  rooms,
  workOrders,
} from '../database/schema/index.js'

/**
 * The defects as the office reads them (section 4.6 of the concept, #116):
 * the register, narrowed and cut into pages here and not in the browser like
 * the registers of assets and duties, the numbers beside the navigation, and
 * the page of one defect. What a row says is read in one query with what the
 * defect hangs on, where it comes from and the work order that sets it right.
 */

/** What a page of the register is asked with. */
export interface DefectRegisterQuestion {
  readonly filter: DefectRegisterFilter
  readonly offset: number
  readonly limit: number
}

/**
 * What an address asks the register for. A list is one of those there are,
 * a record is named by its id, and a page begins at a whole number and holds
 * no more than the most a page may; anything else is refused rather than
 * read as "everything".
 */
export function defectRegisterQuestion(
  query: Readonly<Record<string, unknown>>,
): DefectRegisterQuestion {
  const state = said(query, 'state')

  if (state !== undefined && !(defectRegisterStates as readonly string[]).includes(state)) {
    throw new BadRequestException('Diese Liste kennen die Mängel nicht.')
  }

  const records = (['propertyId', 'areaId', 'buildingId', 'roomId', 'assetId'] as const)
    .map((name) => [name, said(query, name)] as const)
    .filter(([, value]) => value !== undefined)

  if (records.some(([, value]) => !isUuid(value))) {
    throw new BadRequestException('Ein Filter nennt einen Datensatz mit seiner Kennung.')
  }

  const defectClass = said(query, 'defectClass')

  return {
    filter: {
      ...(state === undefined ? {} : { state: state as DefectRegisterState }),
      ...(Object.fromEntries(records) as DefectRegisterFilter),
      ...(defectClass === undefined ? {} : { defectClass }),
    },
    offset: counted(
      said(query, 'offset'),
      0,
      { least: 0, most: Number.MAX_SAFE_INTEGER },
      'Eine Seite beginnt bei einer ganzen Zahl ab 0.',
    ),
    limit: counted(
      said(query, 'limit'),
      defectRegisterPage.size,
      { least: 1, most: defectRegisterPage.most },
      `Eine Seite hält zwischen 1 und ${String(defectRegisterPage.most)} Mängel.`,
    ),
  }
}

/** The activity a defect was found in, and the one of the work order that sets it right. */
const foundIn = alias(activities, 'found_in')
const remedy = alias(activities, 'remedy')

/** Where a defect is past its deadline: waiting to be set right past the day it was to be by. */
function overdueOn(today: IsoDate): SQL {
  return sql`(${defects.status} in ('found', 'ordered') and ${defects.dueOn} < ${today})`
}

/** What a list of the register narrows to. */
function inList(state: DefectRegisterState, today: IsoDate): SQL | undefined {
  switch (state) {
    case 'open':
      return sql`${defects.status} <> 'verified'`
    case 'overdue':
      return overdueOn(today)
    case 'verified':
      return sql`${defects.status} = 'verified'`
    case 'all':
      return undefined
  }
}

/** What the filters beside the list narrow to; a room takes in the assets that stand in it. */
function narrowedBy(filter: DefectRegisterFilter): SQL[] {
  const parts: SQL[] = [sql`${defects.deletedAt} is null`]

  if (filter.propertyId !== undefined) {
    parts.push(sql`${defects.propertyId} = ${filter.propertyId}`)
  }

  if (filter.areaId !== undefined) {
    parts.push(sql`${defects.areaId} = ${filter.areaId}`)
  }

  // A building holds the defects at itself, at its rooms and at the assets in it.
  if (filter.buildingId !== undefined) {
    parts.push(
      sql`(${defects.buildingId} = ${filter.buildingId} or exists (select 1 from ${rooms} where ${rooms.id} = ${defects.roomId} and ${rooms.buildingId} = ${filter.buildingId}) or exists (select 1 from ${assets} where ${assets.id} = ${defects.assetId} and ${assets.buildingId} = ${filter.buildingId}))`,
    )
  }

  if (filter.roomId !== undefined) {
    parts.push(
      sql`(${defects.roomId} = ${filter.roomId} or exists (select 1 from ${assets} where ${assets.id} = ${defects.assetId} and ${assets.roomId} = ${filter.roomId}))`,
    )
  }

  if (filter.assetId !== undefined) {
    parts.push(sql`${defects.assetId} = ${filter.assetId}`)
  }

  if (filter.defectClass === withoutClass) {
    parts.push(sql`${defects.defectClass} is null`)
  } else if (filter.defectClass !== undefined) {
    parts.push(sql`${defects.defectClass} = ${filter.defectClass}`)
  }

  return parts
}

/** The rows of the defects with what a row says beside them. */
function selectRows(tx: TenantTransaction) {
  return tx
    .select({
      defect: defects,
      propertyName: properties.name,
      buildingId: buildings.id,
      buildingName: buildings.name,
      roomId: rooms.id,
      roomNumber: rooms.number,
      roomName: rooms.name,
      assetNumber: assets.number,
      assetName: assets.name,
      foundInKind: foundIn.kind,
      foundInTitle: foundIn.title,
      evidenceDutyId: evidence.dutyId,
      orderNumber: workOrders.number,
      orderActivityId: remedy.id,
      orderTitle: remedy.title,
      orderStatus: remedy.status,
      orderPerformedOn: remedy.performedOn,
    })
    .from(defects)
    .innerJoin(properties, eq(properties.id, defects.propertyId))
    .leftJoin(assets, eq(assets.id, defects.assetId))
    .leftJoin(rooms, sql`${rooms.id} = coalesce(${defects.roomId}, ${assets.roomId})`)
    .leftJoin(
      buildings,
      sql`${buildings.id} = coalesce(${defects.buildingId}, ${rooms.buildingId}, ${assets.buildingId})`,
    )
    .leftJoin(foundIn, eq(foundIn.id, defects.foundInActivityId))
    .leftJoin(evidence, eq(evidence.id, defects.foundInEvidenceId))
    .leftJoin(workOrders, eq(workOrders.id, defects.remedyWorkOrderId))
    .leftJoin(remedy, eq(remedy.id, workOrders.activityId))
}

type Row = Awaited<ReturnType<ReturnType<typeof selectRows>['where']>>[number]

/** Where a defect comes from, by what it names. */
function originOf(row: Row): DefectOrigin {
  const { defect } = row

  if (defect.foundInActivityId !== null && row.foundInKind !== null) {
    return {
      kind: 'activity',
      activityId: defect.foundInActivityId,
      activityKind: row.foundInKind as ActivityKind,
      title: row.foundInTitle ?? '',
    }
  }

  if (defect.foundInEvidenceId !== null && row.evidenceDutyId !== null) {
    return { kind: 'report', evidenceId: defect.foundInEvidenceId, dutyId: row.evidenceDutyId }
  }

  return { kind: 'hand' }
}

/** A row of the register. */
function entryOf(row: Row, today: IsoDate): DefectEntry {
  const { defect } = row

  return {
    id: defect.id,
    description: defect.description,
    defectClass: defect.defectClass,
    foundOn: defect.foundOn,
    dueOn: defect.dueOn,
    status: defect.status,
    overdue: isOverdue(defect, today),
    origin: originOf(row),
    place: {
      propertyId: defect.propertyId,
      propertyName: row.propertyName,
      buildingId: row.buildingId,
      buildingName: row.buildingName,
      roomId: row.roomId,
      roomLabel:
        row.roomId === null ? null : roomTitle({ number: row.roomNumber, name: row.roomName }),
      asset:
        defect.assetId === null || row.assetName === null
          ? null
          : { id: defect.assetId, number: row.assetNumber, name: row.assetName },
    },
    workOrder:
      row.orderActivityId === null
        ? null
        : {
            activityId: row.orderActivityId,
            number: row.orderNumber,
            title: row.orderTitle ?? '',
            status: row.orderStatus as ActivityStatus,
            performedOn: row.orderPerformedOn,
          },
  }
}

/**
 * How many defects there are in each list under the filters beside the list,
 * one query for all three.
 */
async function countsOf(
  tx: TenantTransaction,
  where: SQL[],
  today: IsoDate,
): Promise<DefectRegister['counts']> {
  const [row] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${defects.status} <> 'verified')::int`,
      overdue: sql<number>`count(*) filter (where ${overdueOn(today)})::int`,
      verified: sql<number>`count(*) filter (where ${defects.status} = 'verified')::int`,
    })
    .from(defects)
    .where(and(...where))

  return { open: row?.open ?? 0, overdue: row?.overdue ?? 0, verified: row?.verified ?? 0 }
}

/**
 * A page of the register: what waits to be set right first, by the day it is
 * to be, then the newest found; the numbers of the lists under the filters.
 */
export async function defectRegister(
  tx: TenantTransaction,
  question: DefectRegisterQuestion,
  today: IsoDate,
): Promise<DefectRegister> {
  const state = question.filter.state ?? 'open'
  const narrowed = narrowedBy(question.filter)
  const listed = inList(state, today)
  const where = listed === undefined ? narrowed : [...narrowed, listed]
  const counts = await countsOf(tx, narrowed, today)
  const [total] = await tx
    .select({ total: count() })
    .from(defects)
    .where(and(...where))
  const rows = await selectRows(tx)
    .where(and(...where))
    .orderBy(
      sql`${defects.status} = 'verified'`,
      sql`${defects.dueOn} asc nulls last`,
      desc(defects.foundOn),
      asc(defects.id),
    )
    .limit(question.limit + 1)
    .offset(question.offset)

  return {
    total: total?.total ?? 0,
    counts,
    more: rows.length > question.limit,
    defects: rows.slice(0, question.limit).map((row) => entryOf(row, today)),
  }
}

/** How many defects are open and how many are over their deadline, beside the navigation. */
export async function defectSummary(tx: TenantTransaction, today: IsoDate): Promise<DefectSummary> {
  const { open, overdue } = await countsOf(tx, narrowedBy({}), today)

  return { open, overdue }
}

/**
 * The duty kinds of where a defect comes from (section 4.6): those of the
 * duties of the inspection or maintenance it was found in, or of the duty of
 * the report that named it. None for a round, a work order or by hand.
 */
export async function originKinds(
  tx: TenantTransaction,
  defect: Pick<typeof defects.$inferSelect, 'foundInActivityId' | 'foundInEvidenceId'>,
): Promise<readonly (string | null)[]> {
  if (defect.foundInActivityId !== null) {
    const rows = await tx
      .select({ kind: duties.kind })
      .from(activityDuties)
      .innerJoin(activities, eq(activities.id, activityDuties.activityId))
      .innerJoin(duties, eq(duties.id, activityDuties.dutyId))
      .where(
        and(
          eq(activityDuties.activityId, defect.foundInActivityId),
          isNull(activityDuties.deletedAt),
          sql`${activities.kind} in ('inspection', 'maintenance')`,
        ),
      )

    return rows.map((row) => row.kind)
  }

  if (defect.foundInEvidenceId !== null) {
    const rows = await tx
      .select({ kind: duties.kind })
      .from(evidence)
      .innerJoin(duties, eq(duties.id, evidence.dutyId))
      .where(eq(evidence.id, defect.foundInEvidenceId))

    return rows.map((row) => row.kind)
  }

  return []
}

/** The defaults the operator set, by the key of their class. */
export async function classTermsOf(tx: TenantTransaction): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({ defectClass: defectClassTerms.defectClass, dueDays: defectClassTerms.dueDays })
    .from(defectClassTerms)

  return new Map(rows.map((row) => [row.defectClass, row.dueDays]))
}

/** The classes a defect may take, with the default of each, in the order they are offered. */
export async function classChoicesFor(
  tx: TenantTransaction,
  catalogue: Catalogue,
  defect: Pick<typeof defects.$inferSelect, 'foundInActivityId' | 'foundInEvidenceId'>,
): Promise<readonly DefectClassChoice[]> {
  const terms = await classTermsOf(tx)

  return defectClassChoices(catalogue, await originKinds(tx, defect)).map(({ defectClass }) => ({
    key: defectClass.key,
    label: defectClass.label,
    dueDays: terms.get(defectClass.key) ?? null,
  }))
}

/** The page of one defect, or null where the person asking does not see it. */
export async function defectReading(
  tx: TenantTransaction,
  catalogue: Catalogue,
  id: string,
  today: IsoDate,
): Promise<DefectReading | null> {
  if (!isUuid(id)) {
    return null
  }

  const [row] = await selectRows(tx).where(
    and(eq(defects.id, id as DefectId), isNull(defects.deletedAt)),
  )

  if (row === undefined) {
    return null
  }

  return {
    ...entryOf(row, today),
    areaId: row.defect.areaId,
    checkedOn: row.defect.checkedOn,
    checkNote: row.defect.checkNote,
    classChoices: await classChoicesFor(tx, catalogue, row.defect),
  }
}
