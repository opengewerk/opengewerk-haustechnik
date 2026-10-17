import {
  type AreaId,
  type BuildingId,
  basicMeasureOf,
  byNameIn,
  type Catalogue,
  type DefectAgeBand,
  defectAgeBand,
  defectAgeBands,
  type DefectFigures,
  type DefectFiguresRow,
  type Duty,
  daysOfPeriod,
  type FaultFigures,
  type FaultFiguresRow,
  type FiguresFilter,
  type FulfilmentRow,
  fulfilmentByPeriod,
  type IsoDate,
  measureColumnOf,
  measureColumns,
  type MeasureColumn,
  type MeasureRow,
  median,
  periodOf,
  periodsBetween,
  type PropertyId,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, gte, inArray, isNull, lte, ne, or, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { termsOfDuties } from '../database/duty-standing.js'
import {
  activities,
  assets,
  buildings,
  defects,
  duties,
  faultReports,
  properties,
  rooms,
  workOrders,
} from '../database/schema/index.js'
import { followedStateOf, rowsWhere, signedAtOf } from '../faults/reading.js'

/**
 * The figures over time (#334, section 4.16 of the concept), read in the
 * transaction of the person who asks: so only the rows of their areas count,
 * whatever the filter names. Every figure is a count or a time per place, per
 * class, per category or per period. Nothing here reads who did something,
 * and nothing groups by a person.
 */

/** Whether the filter names a place by something that is no id: then it names nothing the person could see. */
function namesNothing(filter: FiguresFilter): boolean {
  return [filter.areaId, filter.propertyId, filter.buildingId].some(
    (id) => id !== undefined && !isUuid(id),
  )
}

/**
 * The condition of a place for a table with a property, an area and a
 * building, a room or an asset: a building holds what is at itself, at its
 * rooms and at the assets in it.
 */
function placeCondition(
  filter: FiguresFilter,
  table: {
    readonly propertyId: AnyPgColumn
    readonly areaId: AnyPgColumn
    readonly buildingId: AnyPgColumn
  },
): SQL | undefined {
  const building = filter.buildingId as BuildingId | undefined

  return and(
    filter.propertyId === undefined
      ? undefined
      : eq(table.propertyId, filter.propertyId as PropertyId),
    filter.areaId === undefined ? undefined : eq(table.areaId, filter.areaId as AreaId),
    building === undefined
      ? undefined
      : or(
          eq(table.buildingId, building),
          eq(assets.buildingId, building),
          eq(rooms.buildingId, building),
        ),
  )
}

/** The duties at the place the filter names, as the register reads them. */
async function dutiesAt(tx: TenantTransaction, filter: FiguresFilter): Promise<Duty[]> {
  const rows = await tx
    .select({ duty: duties })
    .from(duties)
    .leftJoin(assets, eq(assets.id, duties.assetId))
    .leftJoin(rooms, eq(rooms.id, duties.roomId))
    .where(and(isNull(duties.deletedAt), placeCondition(filter, duties)))

  return rows.map((row) => row.duty as Duty)
}

/**
 * Of the terms that fell due in each period, how many had an evidence by
 * their last day, how many later, and how many are still open (decided
 * 15.10.2026). The terms are replayed from the evidence with the rhythm the
 * register counts with; a duty never met has no term and counts in no row.
 */
export async function dutyFigures(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  filter: FiguresFilter,
): Promise<readonly FulfilmentRow[]> {
  const rows = namesNothing(filter) ? [] : await dutiesAt(tx, filter)
  const terms = await termsOfDuties(tx, today, rows, catalogue)

  return fulfilmentByPeriod([...terms.values()].flat(), filter.from, filter.to, filter.grid)
}

/**
 * The defects open today, by class and age, and how many are past the day to
 * remedy them: open and overdue as the list of the defects says it, which a
 * figure leads to (open until checked again, overdue while waiting to be set
 * right past its day). Today and not at the end of the period: a defect
 * keeps no day it was remedied on, so how many were open on an earlier day
 * cannot be told.
 */
export async function defectFigures(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  filter: FiguresFilter,
): Promise<DefectFigures> {
  if (namesNothing(filter)) {
    return { on: today, rows: [] }
  }

  const open = await tx
    .select({
      defectClass: defects.defectClass,
      foundOn: defects.foundOn,
      dueOn: defects.dueOn,
      status: defects.status,
    })
    .from(defects)
    .leftJoin(assets, eq(assets.id, defects.assetId))
    .leftJoin(rooms, eq(rooms.id, defects.roomId))
    .where(and(ne(defects.status, 'verified'), placeCondition(filter, defects)))
  const byClass = new Map<
    string | null,
    { bands: Record<DefectAgeBand, number>; open: number; overdue: number }
  >()

  for (const defect of open) {
    const row = byClass.get(defect.defectClass) ?? {
      bands: Object.fromEntries(defectAgeBands.map((band) => [band, 0])) as Record<
        DefectAgeBand,
        number
      >,
      open: 0,
      overdue: 0,
    }

    row.bands[defectAgeBand(defect.foundOn, today)] += 1
    row.open += 1
    row.overdue +=
      (defect.status === 'found' || defect.status === 'ordered') &&
      defect.dueOn !== null &&
      defect.dueOn < today
        ? 1
        : 0
    byClass.set(defect.defectClass, row)
  }

  const label = (key: string | null) =>
    key === null ? 'Ohne Klasse' : (catalogue.defectClass(key)?.defectClass.label ?? key)
  const rows: DefectFiguresRow[] = [...byClass.entries()]
    .map(([defectClass, row]) => ({ defectClass, label: label(defectClass), ...row }))
    // The classes by name, the defects without one at the end.
    .sort((a, b) =>
      a.defectClass === null ? 1 : b.defectClass === null ? -1 : byNameIn(a.label, b.label),
    )

  return { on: today, rows }
}

const day = 86_400_000

function daysBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / day) * 10) / 10
}

/**
 * The faults that came in during the period, by category and by building:
 * how many, how many were accepted, done and rejected, and the median in days
 * to the acceptance and to the signature under the work order. A report
 * merged into another counts with that one and not again.
 */
export async function faultFigures(
  tx: TenantTransaction,
  filter: FiguresFilter,
): Promise<FaultFigures> {
  if (namesNothing(filter)) {
    return { byCategory: [], byBuilding: [] }
  }

  const { first, last } = daysOfPeriod(filter.from, filter.to)
  const building = filter.buildingId as BuildingId | undefined
  const rows = await rowsWhere(
    tx,
    and(
      isNull(faultReports.mergedIntoId),
      gte(faultReports.receivedAt, sql`(${first}::date AT TIME ZONE 'Europe/Berlin')`),
      sql`${faultReports.receivedAt} < ((${last}::date + 1) AT TIME ZONE 'Europe/Berlin')`,
      filter.propertyId === undefined
        ? undefined
        : eq(faultReports.propertyId, filter.propertyId as PropertyId),
      filter.areaId === undefined ? undefined : eq(faultReports.areaId, filter.areaId as AreaId),
      building === undefined ? undefined : eq(faultReports.buildingId, building),
    ) as SQL,
  )

  interface Tally {
    key: string
    label: string
    sub: string | null
    received: number
    accepted: number
    done: number
    rejected: number
    toAcceptance: number[]
    toDone: number[]
  }

  const byCategory = new Map<string, Tally>()
  const byBuilding = new Map<string, Tally>()
  const tally = (into: Map<string, Tally>, key: string, label: string, sub: string | null) => {
    const found = into.get(key) ?? {
      key,
      label,
      sub,
      received: 0,
      accepted: 0,
      done: 0,
      rejected: 0,
      toAcceptance: [],
      toDone: [],
    }

    into.set(key, found)

    return found
  }

  for (const row of rows) {
    const state = followedStateOf(row)
    const signedAt =
      state === 'done' && row.orderActivityId !== null
        ? await signedAtOf(tx, row.orderActivityId)
        : null
    const counts = [
      tally(byCategory, row.report.categoryId, row.category, null),
      tally(byBuilding, row.report.buildingId, row.building, row.property),
    ]

    for (const each of counts) {
      each.received += 1
      each.accepted += state === 'accepted' || state === 'done' ? 1 : 0
      each.done += state === 'done' ? 1 : 0
      each.rejected += state === 'rejected' ? 1 : 0

      if (row.report.acceptedAt !== null) {
        each.toAcceptance.push(daysBetween(row.report.receivedAt, row.report.acceptedAt))
      }

      if (signedAt !== null) {
        each.toDone.push(daysBetween(row.report.receivedAt, signedAt))
      }
    }
  }

  const figures = (from: Map<string, Tally>): FaultFiguresRow[] =>
    [...from.values()]
      .map(({ toAcceptance, toDone, ...rest }) => ({
        ...rest,
        daysToAcceptance: median(toAcceptance),
        daysToDone: median(toDone),
      }))
      .sort((a, b) => byNameIn(a.label, b.label) || byNameIn(a.sub ?? '', b.sub ?? ''))

  return { byCategory: figures(byCategory), byBuilding: figures(byBuilding) }
}

/**
 * The activities finished in each period, by the basic measure of DIN 31051
 * (#333): signed or done, counted on the day they were performed.
 */
export async function activityFigures(
  tx: TenantTransaction,
  filter: FiguresFilter,
): Promise<readonly MeasureRow[]> {
  const periods = periodsBetween(filter.from, filter.to, filter.grid)
  const counted = new Map(
    periods.map((period) => [
      period.key,
      {
        ...period,
        counts: Object.fromEntries(measureColumns.map((column) => [column, 0])) as Record<
          MeasureColumn,
          number
        >,
        total: 0,
      },
    ]),
  )

  if (!namesNothing(filter)) {
    const { first, last } = daysOfPeriod(filter.from, filter.to)
    const done = await tx
      .select({
        kind: activities.kind,
        performedOn: activities.performedOn,
        orderKind: workOrders.kind,
        measure: workOrders.measure,
      })
      .from(activities)
      .leftJoin(workOrders, eq(workOrders.activityId, activities.id))
      .leftJoin(assets, eq(assets.id, activities.assetId))
      .leftJoin(rooms, eq(rooms.id, activities.roomId))
      .where(
        and(
          isNull(activities.deletedAt),
          inArray(activities.status, ['signed', 'done']),
          gte(activities.performedOn, first),
          lte(activities.performedOn, last),
          placeCondition(filter, activities),
        ),
      )

    for (const activity of done) {
      if (activity.performedOn === null) {
        continue
      }

      const row = counted.get(periodOf(activity.performedOn, filter.grid).key)

      if (row === undefined) {
        continue
      }

      const column = measureColumnOf(
        basicMeasureOf(
          activity.kind,
          activity.orderKind === null
            ? null
            : { kind: activity.orderKind, measure: activity.measure },
        ),
      )

      row.counts[column] += 1
      row.total += 1
    }
  }

  return [...counted.values()]
}

/** The buildings and properties a filter can choose from, as the person sees them. */
export async function placesToChoose(tx: TenantTransaction) {
  return tx
    .select({
      buildingId: buildings.id,
      building: buildings.name,
      propertyId: properties.id,
      property: properties.name,
      areaId: buildings.areaId,
    })
    .from(buildings)
    .innerJoin(properties, eq(properties.id, buildings.propertyId))
    .where(and(isNull(buildings.deletedAt), isNull(properties.deletedAt)))
}
