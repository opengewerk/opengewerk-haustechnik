import { BadRequestException, Controller, Get, Query } from '@nestjs/common'
import {
  type ActivityKind,
  type ActivityStatus,
  isAllowed,
  type IsoDate,
  readEvidenceState,
  type SearchAnswer,
  type SearchHit,
  type SearchKind,
  searchKinds,
  searchLimits,
  searchProblem,
  searchWordsOf,
  shownMark,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, type TenantTransaction } from '@opengewerk/platform-server'
import { and, type AnyColumn, asc, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm'

import {
  activities,
  assets,
  buildings,
  evidence,
  floors,
  properties,
  rooms,
  workOrders,
} from '../database/schema/index.js'
import { containing } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'
import { ordersInSight } from './work-orders.controller.js'

/**
 * The search over properties, buildings, rooms, assets and activities by
 * name, number and mark, and over the evidence by its number (section 3 of
 * the concept, #125): `GET /search?q=`.
 *
 * The transaction is the person's, so the database answers from their areas
 * and no other (ADR 0003): a hit from an area they do not see is not there,
 * and neither is a number of such hits. Whoever only performs finds of the
 * activities what is given to them, to nobody or worked on by them, as
 * everywhere else (`ordersInSight`). Each kind only for whoever may read it.
 *
 * At most `searchLimits.perKind` of a kind, the closest first: a text that is
 * the words, then one that begins with them, then one that holds them. That
 * there are more, the answer says without how many. No hit names a person.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('location.read')
  search(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<SearchAnswer> {
    const words = searchWordsOf(query['q'])
    const problem = searchProblem(words)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    return this.database.forTenant(identity, (tx) => searched(tx, identity, words))
  }
}

/** One more than an answer holds, to know that there are more. */
const asked = searchLimits.perKind + 1

/** The words as the whole of a text for ILIKE, taken literally. */
function wholly(words: string): string {
  return words.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/** What is searched: a column, or a line as the hit shows it, its number and its name. */
type Searched = AnyColumn | SQL

/** A number and a name as one line, "E.14 Heizraum", as a hit shows them and somebody types them. */
function line(number: AnyColumn, name: AnyColumn): SQL {
  return sql`concat_ws(' ', ${number}, ${name})`
}

/** Whether one of the columns holds the words, regardless of case. */
function holding(columns: readonly Searched[], words: string): SQL | undefined {
  const pattern = containing(words)

  return or(...columns.map((column) => ilike(column, pattern)))
}

/**
 * How close the closest of the columns comes to the words, as `closeness` in
 * `domain` says it for the device: 0 the whole text, 1 its beginning, 2
 * anywhere.
 */
function closest(columns: readonly Searched[], words: string): SQL {
  const whole = wholly(words)
  const ranks = columns.map(
    (column) =>
      sql`case when ${column} ilike ${whole} then 0 when ${column} ilike ${`${whole}%`} then 1 else 2 end`,
  )

  return sql`least(${sql.join(ranks, sql`, `)})`
}

/** The rows of one kind, cut to what the answer holds, and whether there were more. */
function cut<Row>(rows: readonly Row[]): { readonly rows: readonly Row[]; readonly more: boolean } {
  return { rows: rows.slice(0, searchLimits.perKind), more: rows.length > searchLimits.perKind }
}

async function searched(
  tx: TenantTransaction,
  identity: Asking,
  words: string,
): Promise<SearchAnswer> {
  const may = (kind: SearchKind): boolean =>
    isAllowed(
      identity,
      kind === 'asset'
        ? 'asset.read'
        : kind === 'activity'
          ? 'activity.read'
          : kind === 'evidence'
            ? 'evidence.read'
            : 'location.read',
    )
  const found: Record<SearchKind, { readonly hits: readonly SearchHit[]; readonly more: boolean }> =
    {
      property: may('property') ? await propertiesFound(tx, words) : nothing,
      building: may('building') ? await buildingsFound(tx, words) : nothing,
      room: may('room') ? await roomsFound(tx, words) : nothing,
      asset: may('asset') ? await assetsFound(tx, words) : nothing,
      activity: may('activity') ? await activitiesFound(tx, identity, words) : nothing,
      evidence: may('evidence') ? await evidenceFound(tx, words) : nothing,
    }

  return {
    hits: searchKinds.flatMap((kind) => found[kind].hits),
    more: searchKinds.filter((kind) => found[kind].more),
  }
}

const nothing = { hits: [], more: false } as const

async function propertiesFound(tx: TenantTransaction, words: string) {
  const searchedIn = [properties.name]
  const { rows, more } = cut(
    await tx
      .select({
        id: properties.id,
        name: properties.name,
        street: properties.street,
        postalCode: properties.postalCode,
        city: properties.city,
      })
      .from(properties)
      .where(and(isNull(properties.deletedAt), holding(searchedIn, words)))
      .orderBy(closest(searchedIn, words), asc(properties.name))
      .limit(asked),
  )

  return {
    hits: rows.map((row): SearchHit => ({
      kind: 'property',
      id: row.id,
      name: row.name,
      address: `${row.street}, ${row.postalCode} ${row.city}`,
    })),
    more,
  }
}

async function buildingsFound(tx: TenantTransaction, words: string) {
  const searchedIn = [buildings.name, buildings.shortCode]
  const { rows, more } = cut(
    await tx
      .select({
        id: buildings.id,
        name: buildings.name,
        shortCode: buildings.shortCode,
        property: properties.name,
      })
      .from(buildings)
      .innerJoin(
        properties,
        and(eq(properties.tenantId, buildings.tenantId), eq(properties.id, buildings.propertyId)),
      )
      .where(and(isNull(buildings.deletedAt), holding(searchedIn, words)))
      .orderBy(closest(searchedIn, words), asc(buildings.name))
      .limit(asked),
  )

  return { hits: rows.map((row): SearchHit => ({ kind: 'building', ...row })), more }
}

async function roomsFound(tx: TenantTransaction, words: string) {
  const searchedIn = [rooms.number, rooms.name, line(rooms.number, rooms.name)]
  const { rows, more } = cut(
    await tx
      .select({
        id: rooms.id,
        number: rooms.number,
        name: rooms.name,
        property: properties.name,
        building: buildings.name,
        floor: floors.name,
      })
      .from(rooms)
      .innerJoin(floors, and(eq(floors.tenantId, rooms.tenantId), eq(floors.id, rooms.floorId)))
      .innerJoin(
        buildings,
        and(eq(buildings.tenantId, rooms.tenantId), eq(buildings.id, rooms.buildingId)),
      )
      .innerJoin(
        properties,
        and(eq(properties.tenantId, rooms.tenantId), eq(properties.id, rooms.propertyId)),
      )
      .where(and(isNull(rooms.deletedAt), holding(searchedIn, words)))
      .orderBy(closest(searchedIn, words), asc(rooms.number), asc(rooms.name))
      .limit(asked),
  )

  return { hits: rows.map((row): SearchHit => ({ kind: 'room', ...row })), more }
}

async function assetsFound(tx: TenantTransaction, words: string) {
  const searchedIn = [
    assets.number,
    assets.name,
    assets.mark,
    assets.serialNumber,
    assets.meterNumber,
    line(assets.number, assets.name),
  ]
  const { rows, more } = cut(
    await tx
      .select({
        id: assets.id,
        number: assets.number,
        name: assets.name,
        mark: assets.mark,
        serialNumber: assets.serialNumber,
        meterNumber: assets.meterNumber,
        building: buildings.name,
        roomNumber: rooms.number,
        roomName: rooms.name,
      })
      .from(assets)
      .innerJoin(
        buildings,
        and(eq(buildings.tenantId, assets.tenantId), eq(buildings.id, assets.buildingId)),
      )
      .leftJoin(rooms, and(eq(rooms.tenantId, assets.tenantId), eq(rooms.id, assets.roomId)))
      .where(and(isNull(assets.deletedAt), holding(searchedIn, words)))
      .orderBy(closest(searchedIn, words), asc(assets.number), asc(assets.name))
      .limit(asked),
  )

  return {
    hits: rows.map((row): SearchHit => ({
      kind: 'asset',
      id: row.id,
      number: row.number,
      name: row.name,
      mark: shownMark(row, words),
      building: row.building,
      room:
        [row.roomNumber, row.roomName]
          .filter((part): part is string => part !== null && part !== '')
          .join(' ') || null,
    })),
    more,
  }
}

async function activitiesFound(tx: TenantTransaction, identity: Asking, words: string) {
  const searchedIn = [
    activities.title,
    workOrders.number,
    line(workOrders.number, activities.title),
  ]
  const { rows, more } = cut(
    await tx
      .select({
        id: activities.id,
        activityKind: activities.kind,
        number: workOrders.number,
        title: activities.title,
        status: activities.status,
        property: properties.name,
        building: buildings.name,
      })
      .from(activities)
      .leftJoin(
        workOrders,
        and(eq(workOrders.tenantId, activities.tenantId), eq(workOrders.activityId, activities.id)),
      )
      .innerJoin(
        properties,
        and(eq(properties.tenantId, activities.tenantId), eq(properties.id, activities.propertyId)),
      )
      .leftJoin(
        buildings,
        and(eq(buildings.tenantId, activities.tenantId), eq(buildings.id, activities.buildingId)),
      )
      .where(and(isNull(activities.deletedAt), holding(searchedIn, words), ordersInSight(identity)))
      .orderBy(closest(searchedIn, words), asc(activities.title))
      .limit(asked),
  )

  return {
    hits: rows.map((row): SearchHit => ({
      kind: 'activity',
      id: row.id,
      activityKind: row.activityKind as ActivityKind,
      number: row.number,
      title: row.title,
      status: row.status as ActivityStatus,
      place: row.building ?? row.property,
    })),
    more,
  }
}

async function evidenceFound(tx: TenantTransaction, words: string) {
  const searchedIn = [evidence.number]
  const { rows, more } = cut(
    await tx
      .select({
        id: evidence.id,
        number: evidence.number,
        performedOn: evidence.performedOn,
        state: evidence.state,
      })
      .from(evidence)
      .where(holding(searchedIn, words))
      .orderBy(closest(searchedIn, words), asc(evidence.number))
      .limit(asked),
  )

  return {
    hits: rows.map((row): SearchHit => {
      // What the evidence froze, and of it only what the line needs: never
      // who performed it or wrote it down.
      const state = readEvidenceState(row.state)

      return {
        kind: 'evidence',
        id: row.id,
        number: row.number,
        title: state.duty.label,
        performedOn: row.performedOn as IsoDate,
        place: state.place.building?.name ?? state.place.property.name,
      }
    }),
    more,
  }
}
