import { NotFoundException } from '@nestjs/common'
import {
  type ActivityKind,
  type ActivityOutcome,
  type ActivityStatus,
  type BuildingSituation,
  type Catalogue,
  type EvidenceResult,
  isAllowed,
  type IsoDate,
  type LastActivity,
  lastActivitiesShown,
  type PlacesToDo,
  type PlaceToDo,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import {
  activities,
  activityDuties,
  assets,
  buildings,
  defects,
  properties,
  rooms,
  workOrders,
} from '../database/schema/index.js'
import { keyDateDue, operatorKeyDay } from '../database/meter-standing.js'
import { defectRegister } from '../defects/reading.js'
import { inSight } from './activities.controller.js'
import { registeredEntries, registerPage, type UnnamedDutyEntry } from './duty-register.js'
import { meterStandings } from './meters.controller.js'
import type { Asking } from './places.js'

/**
 * What is to do at a place, for the Lagebild of a building and the list
 * "Liegenschaften" (section 4.1 of the concept, #121): the duties overdue,
 * due and never recorded, the defects not yet checked again and the
 * measuring points whose reading for the key date is missing.
 *
 * Each number is counted the way the list it leads to counts: the duties as
 * the register reads them (`registeredEntries`, `registerPage`), the defects
 * as the register of defects lists them under "Offen", the readings as the
 * list "Zähler" has them under "fehlt" (`meterStandings`). The list of
 * properties is counted in one go for every row, not row by row.
 *
 * The transaction is the person's, so the numbers are those of their areas.
 * Nothing here names a person.
 */

/** Numbers of a place, counted up one duty, defect or reading at a time. */
interface Tally {
  overdue: number
  due: number
  neverRecorded: number
  openDefects: number
  missingReadings: number
}

const empty = (): Tally => ({
  overdue: 0,
  due: 0,
  neverRecorded: 0,
  openDefects: 0,
  missingReadings: 0,
})

/** The numbers as the person asking is handed them: none of a list they may not read. */
function handed(tally: Tally, identity: Asking): PlaceToDo {
  return {
    overdue: tally.overdue,
    due: tally.due,
    neverRecorded: tally.neverRecorded,
    openDefects: isAllowed(identity, 'defect.read') ? tally.openDefects : null,
    missingReadings: isAllowed(identity, 'asset.read') ? tally.missingReadings : null,
  }
}

/** The state of a duty as a number of a place counts it, or none: met, resting and ended duties call for nothing. */
function countedAs(entry: UnnamedDutyEntry): 'overdue' | 'due' | 'neverRecorded' | null {
  if (entry.ended) {
    return null
  }

  switch (entry.state) {
    case 'overdue':
      return 'overdue'
    case 'due':
      return 'due'
    case 'never_recorded':
      return 'neverRecorded'
    default:
      return null
  }
}

/**
 * What is to do at every property the person sees and at each of its
 * buildings. A duty, a defect or a reading at a room or an asset counts for
 * the building it stands in, as the registers narrowed to a building hold it;
 * one at the property itself counts for the property alone.
 */
export async function placesToDo(
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  today: IsoDate,
): Promise<PlacesToDo> {
  const propertyRows = await tx
    .select({ id: properties.id })
    .from(properties)
    .where(isNull(properties.deletedAt))
  const buildingRows = await tx
    .select({ id: buildings.id, propertyId: buildings.propertyId })
    .from(buildings)
    .where(isNull(buildings.deletedAt))
  const ofProperty = new Map<string, Tally>(propertyRows.map((row) => [row.id as string, empty()]))
  const ofBuilding = new Map<string, Tally>(buildingRows.map((row) => [row.id as string, empty()]))
  const add = (propertyId: string, buildingId: string | null, field: keyof Tally, by = 1): void => {
    const property = ofProperty.get(propertyId)
    const building = buildingId === null ? undefined : ofBuilding.get(buildingId)

    if (property) {
      property[field] += by
    }

    if (building) {
      building[field] += by
    }
  }

  // The duties, in the state the register gives them today.
  const seen = (await registeredEntries(tx, catalogue, today, {})) ?? []
  const roomIds = [
    ...new Set(seen.flatMap((entry) => (entry.roomId === null ? [] : [entry.roomId]))),
  ]
  const roomBuilding = new Map(
    (roomIds.length === 0
      ? []
      : await tx
          .select({ id: rooms.id, buildingId: rooms.buildingId })
          .from(rooms)
          .where(inArray(rooms.id, roomIds as never[]))
    ).map((row) => [row.id as string, row.buildingId as string]),
  )

  for (const entry of seen) {
    const field = countedAs(entry)

    if (field !== null) {
      const building =
        entry.buildingId ??
        entry.asset?.buildingId ??
        (entry.roomId === null ? null : (roomBuilding.get(entry.roomId) ?? null))

      add(entry.propertyId, building, field)
    }
  }

  // The defects not yet checked again, by the building they hang on or stand in.
  if (isAllowed(identity, 'defect.read')) {
    const building = sql<
      string | null
    >`coalesce(${defects.buildingId}, ${rooms.buildingId}, ${assets.buildingId})`
    const open = await tx
      .select({ propertyId: defects.propertyId, buildingId: building, total: count() })
      .from(defects)
      .leftJoin(rooms, eq(rooms.id, defects.roomId))
      .leftJoin(assets, eq(assets.id, defects.assetId))
      .where(and(isNull(defects.deletedAt), sql`${defects.status} <> 'verified'`))
      .groupBy(defects.propertyId, building)

    for (const row of open) {
      add(row.propertyId as string, row.buildingId, 'openDefects', row.total)
    }
  }

  // The measuring points whose reading for the key date is missing.
  const { keyDate, standings } = isAllowed(identity, 'asset.read')
    ? await meterStandings(tx, today, null, { propertyId: null, buildingId: null })
    : { keyDate: keyDateDue(today, await operatorKeyDay(tx)), standings: [] }

  for (const standing of standings) {
    if (standing.state === 'missing') {
      add(standing.held.asset.propertyId, standing.held.asset.buildingId, 'missingReadings')
    }
  }

  return {
    keyDate,
    properties: propertyRows.map((property) => ({
      propertyId: property.id as string,
      ...handed(ofProperty.get(property.id as string) ?? empty(), identity),
      buildings: buildingRows
        .filter((building) => building.propertyId === property.id)
        .map((building) => ({
          buildingId: building.id as string,
          ...handed(ofBuilding.get(building.id as string) ?? empty(), identity),
        })),
    })),
  }
}

/**
 * The Lagebild of a building: what is to do there, each number the total of
 * its list narrowed to the building, and its last activities. A building the
 * person does not see is not there.
 */
export async function buildingSituation(
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  today: IsoDate,
  buildingId: string,
): Promise<BuildingSituation> {
  const [building] = await tx
    .select({ id: buildings.id })
    .from(buildings)
    .where(and(eq(buildings.id, buildingId as never), isNull(buildings.deletedAt)))

  if (!building) {
    throw new NotFoundException('Dieses Gebäude gibt es nicht oder nicht mehr.')
  }

  const counts = registerPage(
    (await registeredEntries(tx, catalogue, today, { buildingId })) ?? [],
    {},
    today,
    0,
    0,
  ).counts
  const openDefects = isAllowed(identity, 'defect.read')
    ? (
        await defectRegister(
          tx,
          { filter: { state: 'open', buildingId }, offset: 0, limit: 1 },
          today,
        )
      ).total
    : null
  const meters = isAllowed(identity, 'asset.read')
    ? await meterStandings(tx, today, null, { propertyId: null, buildingId })
    : null

  return {
    overdue: counts?.overdue ?? 0,
    due: counts?.due ?? 0,
    neverRecorded: counts?.never_recorded ?? 0,
    openDefects,
    missingReadings:
      meters === null ? null : meters.standings.filter((each) => each.state === 'missing').length,
    keyDate: meters?.keyDate ?? keyDateDue(today, await operatorKeyDay(tx)),
    lastActivities: isAllowed(identity, 'activity.read')
      ? await lastActivitiesAt(tx, identity, buildingId)
      : null,
  }
}

/** The states of an activity in which something happened that the Lagebild names. */
const happened = ['started', 'signed', 'done', 'not_performed'] as const satisfies ActivityStatus[]

/**
 * The last activities at a building, at its rooms and at the assets in it,
 * the newest first: those begun, signed, done or not performed, as far as the
 * person asking is shown them (`inSight`). The day is the one it was
 * performed on, or for one begun the day it was last changed.
 */
async function lastActivitiesAt(
  tx: TenantTransaction,
  identity: Asking,
  buildingId: string,
): Promise<LastActivity[]> {
  const day = sql<string>`coalesce(${activities.performedOn}, (${activities.updatedAt} at time zone 'Europe/Berlin')::date)`
  const rows = await tx
    .select({
      id: activities.id,
      kind: activities.kind,
      title: activities.title,
      status: activities.status,
      day: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
      number: workOrders.number,
    })
    .from(activities)
    .leftJoin(rooms, eq(rooms.id, activities.roomId))
    .leftJoin(assets, eq(assets.id, activities.assetId))
    .leftJoin(workOrders, eq(workOrders.activityId, activities.id))
    .where(
      and(
        isNull(activities.deletedAt),
        inArray(activities.status, [...happened]),
        or(
          eq(activities.buildingId, buildingId as never),
          eq(rooms.buildingId, buildingId as never),
          eq(assets.buildingId, buildingId as never),
        ),
        inSight(identity),
      ),
    )
    .orderBy(desc(day), desc(activities.updatedAt), asc(activities.id))
    .limit(lastActivitiesShown)
  const ids = rows.map((row) => row.id)

  if (ids.length === 0) {
    return []
  }

  const results = await tx
    .select({ activityId: activityDuties.activityId, result: activityDuties.result })
    .from(activityDuties)
    .where(and(inArray(activityDuties.activityId, ids), isNull(activityDuties.deletedAt)))
  const found = new Set(
    (
      await tx
        .selectDistinct({ activityId: defects.foundInActivityId })
        .from(defects)
        .where(and(inArray(defects.foundInActivityId, ids), isNull(defects.deletedAt)))
    ).map((row) => row.activityId as string),
  )

  return rows.map((row) => ({
    id: row.id as string,
    kind: row.kind,
    title: row.title,
    number: row.number,
    day: row.day as IsoDate,
    outcome: outcomeOf(
      row.kind,
      row.status,
      results.filter((each) => each.activityId === row.id).map((each) => each.result),
      found.has(row.id as string),
    ),
  }))
}

/**
 * What came of an activity: its state while it is not done, and once it is,
 * the worst its duties and the defects found in it say. A work order done is
 * done; what it set right is a defect of its own.
 */
export function outcomeOf(
  kind: ActivityKind,
  status: ActivityStatus,
  results: readonly (EvidenceResult | null)[],
  defectsFound: boolean,
): ActivityOutcome {
  if (status === 'started' || status === 'signed' || status === 'not_performed') {
    return status
  }

  if (kind === 'work_order') {
    return 'done'
  }

  if (results.includes('failed')) {
    return 'failed'
  }

  return results.includes('with_defects') || defectsFound ? 'with_defects' : 'without_defects'
}
