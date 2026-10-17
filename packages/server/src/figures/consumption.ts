import {
  type AreaId,
  type Asset,
  type BuildingId,
  byMediumKey,
  byNameIn,
  type Catalogue,
  type ConsumptionBuildingRow,
  type ConsumptionCourseRow,
  type ConsumptionFigures,
  type ConsumptionMeter,
  type ConsumptionMeterRow,
  consumptionInMonths,
  dueIn,
  type FiguresFilter,
  type IsoDate,
  type MediumKey,
  mediumKeyOf,
  periodsWithMonths,
  type PropertyId,
  readBy,
  type ReportMonth,
  restOf,
  sumFactorOf,
  validReadings,
  yearBefore,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'

import { type Held, heldOf, operatorKeyDay } from '../database/meter-standing.js'
import { assets, buildings, properties } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/**
 * The consumption of the meters over time (#335, sections 4.9 and 4.16 of
 * the concept), read in the transaction of the person who asks: a measuring
 * point outside their areas is in no sum. Every measuring point the person
 * sees is worked out, so that a main meter at the place can leave out its
 * sub-meters wherever they stand; the place then says which of them are
 * shown and summed. Nothing here reads who took a reading.
 */

/** A measuring point with what it is summed as. */
interface Point {
  readonly held: Held
  readonly key: MediumKey
  readonly meter: ConsumptionMeter
}

/** Whether a filter names a place by something that is no id: then it names nothing the person could see. */
function namesNothing(filter: FiguresFilter): boolean {
  return [filter.areaId, filter.propertyId, filter.buildingId].some(
    (id) => id !== undefined && !isUuid(id),
  )
}

function atThePlace(filter: FiguresFilter, asset: Asset): boolean {
  return (
    (filter.areaId === undefined || asset.areaId === (filter.areaId as AreaId)) &&
    (filter.propertyId === undefined || asset.propertyId === (filter.propertyId as PropertyId)) &&
    (filter.buildingId === undefined || asset.buildingId === (filter.buildingId as BuildingId))
  )
}

/** The figures of the consumption at a place for a medium, the first one there where none is asked. */
export async function consumptionFigures(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  filter: FiguresFilter & { readonly medium?: MediumKey },
): Promise<ConsumptionFigures> {
  if (namesNothing(filter)) {
    return { choices: [], chosen: null, course: [], byBuilding: [], byMeter: [] }
  }

  const meters = (await tx
    .select()
    .from(assets)
    .where(and(isNotNull(assets.meterNumber), isNull(assets.deletedAt)))) as Asset[]
  const keyOf = (asset: Asset): MediumKey | null => {
    const medium = catalogue.assetKind(asset.kind, today)?.definition.meter?.medium

    return medium === undefined ? null : mediumKeyOf(medium, asset.meterUnit ?? 'cubic_metres')
  }
  const choices = [
    ...new Set(
      meters
        .filter((asset) => atThePlace(filter, asset))
        .map(keyOf)
        .filter((key) => key !== null),
    ),
  ].sort(byMediumKey)
  const chosen = filter.medium ?? choices[0] ?? null

  if (chosen === null) {
    return { choices, chosen, course: [], byBuilding: [], byMeter: [] }
  }

  const held = await heldOf(
    tx,
    meters.filter((asset) => keyOf(asset) === chosen),
    await operatorKeyDay(tx),
  )
  const points: Point[] = held.map((each) => ({
    held: each,
    key: chosen,
    meter: {
      keyDay: each.keyDay,
      sumFactor: sumFactorOf(each.asset.meterUnit ?? 'cubic_metres'),
      since: dayInGermany(each.asset.createdAt),
      input: {
        readings: validReadings(each.readings),
        exchanges: each.exchanges,
        pauses: each.pauses,
        conversionFactor: each.point?.conversionFactor ?? null,
      },
    },
  }))
  const byId = new Map(points.map((point) => [point.held.asset.id as string, point]))
  const mainOf = (point: Point): Point | null => {
    const main = point.held.point?.mainMeterId

    return main === null || main === undefined ? null : (byId.get(main) ?? null)
  }
  const subsOf = (point: Point) => points.filter((each) => mainOf(each) === point)
  const shown = points.filter((point) => atThePlace(filter, point.held.asset))

  /** What a measuring point counts as in some months: its rest where it has sub-meters, else its own. */
  const own = (point: Point, from: ReportMonth, to: ReportMonth) =>
    consumptionInMonths(point.meter, from, to, today)
  const counted = (point: Point, from: ReportMonth, to: ReportMonth) =>
    restOf(
      own(point, from, to),
      subsOf(point).map((sub) => own(sub, from, to)),
    )
  const sum = (values: readonly (number | null)[]) =>
    values.some((value) => value === null)
      ? null
      : values.reduce<number>((left, value) => left + (value ?? 0), 0)

  // The ones whose readings a sum at the place needs: those shown, and the sub-meters of the main meters among them.
  const needed = [...new Set([...shown, ...shown.flatMap(subsOf)])]
  const course: ConsumptionCourseRow[] = periodsWithMonths(filter.from, filter.to, filter.grid).map(
    (period) => {
      const before = { from: yearBefore(period.from), to: yearBefore(period.to) }

      return {
        key: period.key,
        label: period.label,
        milli: sum(shown.map((point) => counted(point, period.from, period.to))),
        previousMilli: sum(shown.map((point) => counted(point, before.from, before.to))),
        withGap: needed.filter((point) => own(point, period.from, period.to) === null).length,
        due: shown.some((point) => dueIn(point.meter.keyDay, period.from, today)),
        read: shown.some((point) => readBy(point.meter, period.to)),
        readBefore: shown.some((point) => readBy(point.meter, before.to)),
      }
    },
  )
  const whole = { from: filter.from, to: filter.to }
  const wholeBefore = { from: yearBefore(filter.from), to: yearBefore(filter.to) }
  const names = await tx
    .select({ id: buildings.id, name: buildings.name, property: properties.name })
    .from(buildings)
    .innerJoin(properties, eq(properties.id, buildings.propertyId))
  const nameOf = new Map(names.map((each) => [each.id as string, each]))
  const byBuilding: ConsumptionBuildingRow[] = [
    ...new Set(shown.map((point) => point.held.asset.buildingId as string)),
  ]
    .map((buildingId) => {
      const here = shown.filter((point) => point.held.asset.buildingId === buildingId)

      return {
        buildingId,
        label: nameOf.get(buildingId)?.name ?? '',
        sub: nameOf.get(buildingId)?.property ?? '',
        milli: sum(here.map((point) => counted(point, whole.from, whole.to))),
        previousMilli: sum(here.map((point) => counted(point, wholeBefore.from, wholeBefore.to))),
        read: here.some((point) => readBy(point.meter, whole.to)),
        readBefore: here.some((point) => readBy(point.meter, wholeBefore.to)),
      }
    })
    .sort((left, right) => byNameIn(left.sub, right.sub) || byNameIn(left.label, right.label))

  const label = (point: Point) => point.held.asset.mark ?? point.held.asset.name
  const byLabel = (left: Point, right: Point) =>
    byNameIn(left.held.asset.mark ?? '', right.held.asset.mark ?? '') ||
    byNameIn(left.held.asset.name, right.held.asset.name)
  const firstDay = `${filter.from}-01`
  const lastMonth = filter.to
  const row = (point: Point, depth: number): ConsumptionMeterRow => {
    const main = mainOf(point)

    return {
      assetId: point.held.asset.id,
      mark: point.held.asset.mark,
      name: point.held.asset.name,
      building: nameOf.get(point.held.asset.buildingId)?.name ?? '',
      depth,
      under: main === null ? null : label(main),
      rest: subsOf(point).length > 0,
      read: readBy(point.meter, whole.to),
      readBefore: readBy(point.meter, wholeBefore.to),
      milli: counted(point, whole.from, whole.to),
      previousMilli: counted(point, wholeBefore.from, wholeBefore.to),
      takenOver: validReadings(point.held.readings).some(
        (reading) =>
          reading.source === 'taken_over' &&
          reading.keyDate.slice(0, 7) >= filter.from &&
          reading.keyDate.slice(0, 7) <= lastMonth,
      ),
      exchangedOn: point.held.exchanges
        .map((exchange) => exchange.exchangedOn)
        .filter((day) => day >= firstDay && day.slice(0, 7) <= lastMonth)
        .sort(),
    }
  }
  // Each measuring point under the main meter it counts under, where that one is shown too.
  const tree = (point: Point, depth: number): ConsumptionMeterRow[] => [
    row(point, depth),
    ...subsOf(point)
      .filter((sub) => shown.includes(sub))
      .sort(byLabel)
      .flatMap((sub) => tree(sub, depth + 1)),
  ]
  const byMeter = shown
    .filter((point) => {
      const main = mainOf(point)

      return main === null || !shown.includes(main)
    })
    .sort(byLabel)
    .flatMap((point) => tree(point, 0))

  return { choices, chosen, course, byBuilding, byMeter }
}
