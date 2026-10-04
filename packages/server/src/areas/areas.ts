import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  type Area,
  type AreaId,
  areaNameProblem,
  type MemberAreas,
  memberAreasProblem,
  type PropertyId,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import { isUniqueViolation, isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'

import {
  areas,
  buildings,
  memberAllAreas,
  memberAreas,
  memberships,
  properties,
} from '../database/schema/index.js'

// The areas of a tenant and who holds in which (section 2.8 of the concept,
// ADR 0003). The database draws the line between the areas; what is here is
// what the Leitung does about them: make one, rename it, remove one that has
// been emptied, and say for everybody who works for the tenant whether they
// hold in all of them or in the ones named.
//
// Every function runs in the transaction of its caller, so that a route does
// several of them or none.

const missing = 'Diesen Bereich gibt es nicht oder nicht mehr.'
const taken = 'Einen Bereich mit diesem Namen gibt es schon.'
const unknownArea = 'Den Bereich gibt es bei diesem Betreiber nicht.'

/** The key that keeps a name to one area of a tenant, whatever its case. */
const oneAreaPerName = 'areas_name_once'

/** The key by which a property names its area. */
const propertyNamesAnArea = 'properties_in_an_area_of_the_tenant'

const inGerman = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, 'de')

/** An area with what a tenant sees of it where the areas are kept. */
export interface AreaOverview extends Area {
  /** The properties in it, as far as the person asking sees them, by name. */
  readonly properties: readonly { readonly id: PropertyId; readonly name: string }[]
  /** How many buildings stand on them. */
  readonly buildings: number
  /**
   * Who it is named for, of those who can work. Whoever holds in every area
   * is not listed: they are in each of them, and the list would say nothing.
   */
  readonly memberIds: readonly string[]
}

/**
 * The areas the person asking holds in, by name: all of them for whoever sees
 * every area, the ones named otherwise, those of somebody they stand in for
 * today included. What a list filters by and what a new property is put into.
 */
export async function areasInSight(tx: TenantTransaction): Promise<Area[]> {
  const rows = await tx
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(
      sql`(select session_sees_all_areas()) or ${areas.id} = any ((select session_areas())::uuid[])`,
    )

  return rows.sort(inGerman)
}

/**
 * Every area of the tenant with its properties, its buildings and the people
 * it is named for. The properties and buildings are those the person asking
 * sees, which for the Leitung is all of them.
 */
export async function areaOverview(tx: TenantTransaction): Promise<AreaOverview[]> {
  const all = await tx.select({ id: areas.id, name: areas.name }).from(areas)
  const held = await tx
    .select({ id: properties.id, name: properties.name, areaId: properties.areaId })
    .from(properties)
    .where(isNull(properties.deletedAt))
  const standing = await tx
    .select({ areaId: buildings.areaId, buildings: count() })
    .from(buildings)
    .where(isNull(buildings.deletedAt))
    .groupBy(buildings.areaId)
  const named = await tx
    .select({ userId: memberAreas.userId, areaId: memberAreas.areaId })
    .from(memberAreas)
    .innerJoin(
      memberships,
      and(
        eq(memberships.tenantId, memberAreas.tenantId),
        eq(memberships.userId, memberAreas.userId),
      ),
    )
    .where(isNull(memberships.blockedAt))

  return all.sort(inGerman).map((area) => ({
    ...area,
    properties: held
      .filter((property) => property.areaId === area.id)
      .map(({ id, name }) => ({ id, name }))
      .sort(inGerman),
    buildings: standing.find((row) => row.areaId === area.id)?.buildings ?? 0,
    memberIds: named.filter((row) => row.areaId === area.id).map((row) => row.userId),
  }))
}

/** A name out of a body, trimmed, or the sentence of the model. */
function nameFrom(value: unknown): string {
  const problem = areaNameProblem(typeof value === 'string' ? value : '')

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  return (value as string).trim()
}

/** Makes an area. Nobody holds in it until it is named for them, except whoever holds in all. */
export async function createArea(
  tx: TenantTransaction,
  tenantId: TenantId,
  name: unknown,
): Promise<Area> {
  const wanted = nameFrom(name)

  try {
    const [created] = await tx
      .insert(areas)
      .values({ tenantId, name: wanted })
      .returning({ id: areas.id, name: areas.name })

    return created as Area
  } catch (error) {
    throw isUniqueViolation(error, oneAreaPerName) ? new ConflictException(taken) : error
  }
}

/** Gives an area another name. */
export async function renameArea(tx: TenantTransaction, id: string, name: unknown): Promise<Area> {
  const wanted = nameFrom(name)

  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  try {
    const [renamed] = await tx
      .update(areas)
      .set({ name: wanted, updatedAt: new Date() })
      .where(eq(areas.id, id as AreaId))
      .returning({ id: areas.id, name: areas.name })

    if (renamed === undefined) {
      throw new NotFoundException(missing)
    }

    return renamed
  } catch (error) {
    throw isUniqueViolation(error, oneAreaPerName) ? new ConflictException(taken) : error
  }
}

/**
 * What somebody is told who removes an area that is not empty. A property
 * marked deleted is none a list shows, so it is not counted; where only such
 * are left, the sentence says what holds the area.
 */
function stillHolds(live: number): string {
  if (live === 0) {
    return 'In diesem Bereich liegen noch entfernte Liegenschaften. Sie werden vorher in einen anderen Bereich verlegt.'
  }

  return live === 1
    ? 'In diesem Bereich liegt noch 1 Liegenschaft. Sie wird vorher in einen anderen Bereich verlegt.'
    : `In diesem Bereich liegen noch ${String(live)} Liegenschaften. Sie werden vorher in einen anderen Bereich verlegt.`
}

/**
 * Removes an area, emptied first (section 2.8): the properties still in it
 * are moved to the area named, with everything below them, in the same
 * transaction, and without an area to move them to the removal is refused
 * with their number.
 *
 * Properties marked deleted move as well: they still name their area, and the
 * key would hold the area for them. Whoever it was named for holds in one
 * area less afterwards, in none when it was their only one; nobody is
 * blocked by that.
 *
 * A tenant keeps one area. And whoever does not see every property of the
 * area cannot empty it: the key of a property out of their sight refuses the
 * removal, and the answer says who can.
 */
export async function removeArea(
  tx: TenantTransaction,
  id: string,
  moveTo: unknown,
): Promise<{ readonly removed: AreaId; readonly moved: number }> {
  const all = await tx.select({ id: areas.id }).from(areas)

  if (!all.some((area) => area.id === id)) {
    throw new NotFoundException(missing)
  }

  if (all.length === 1) {
    throw new ConflictException(
      'Der letzte Bereich lässt sich nicht entfernen: jede Liegenschaft liegt in einem.',
    )
  }

  const inIt = await tx
    .select({ deletedAt: properties.deletedAt })
    .from(properties)
    .where(eq(properties.areaId, id as AreaId))
  const held = inIt.length

  if (held > 0) {
    if (moveTo === undefined || moveTo === null) {
      throw new ConflictException(stillHolds(inIt.filter((row) => row.deletedAt === null).length))
    }

    if (moveTo === id || !all.some((area) => area.id === moveTo)) {
      throw new BadRequestException(
        'Den Bereich, in den die Liegenschaften verlegt werden sollen, gibt es bei diesem Betreiber nicht.',
      )
    }

    await tx
      .update(properties)
      .set({ areaId: moveTo as AreaId })
      .where(eq(properties.areaId, id as AreaId))
  }

  try {
    await tx.delete(areas).where(eq(areas.id, id as AreaId))
  } catch (error) {
    throw violatesKey(error, propertyNamesAnArea)
      ? new ConflictException(
          'In diesem Bereich liegen Liegenschaften, die Sie nicht sehen. Entfernen kann ihn, wer alle Bereiche sieht.',
        )
      : error
  }

  return { removed: id as AreaId, moved: held }
}

/** Whether the database refused a statement for the named foreign key. */
function violatesKey(error: unknown, key: string): boolean {
  for (const candidate of [error, (error as { cause?: unknown } | undefined)?.cause]) {
    const found = candidate as { code?: unknown; constraint?: unknown } | undefined

    if (found?.code === '23503' && found.constraint === key) {
      return true
    }
  }

  return false
}

/** The areas everybody who works for the tenant holds in. */
export async function memberAreasOf(
  tx: TenantTransaction,
  tenantId: TenantId,
): Promise<MemberAreas[]> {
  const members = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.tenantId, tenantId))
  const everywhere = await tx.select({ userId: memberAllAreas.userId }).from(memberAllAreas)
  const named = await tx
    .select({ userId: memberAreas.userId, areaId: memberAreas.areaId })
    .from(memberAreas)

  return members.map(({ userId }) => ({
    userId,
    all: everywhere.some((row) => row.userId === userId),
    areaIds: named.filter((row) => row.userId === userId).map((row) => row.areaId),
  }))
}

/** What a body says about the areas of somebody: all of them, or these. */
export function areasFrom(body: unknown): Pick<MemberAreas, 'all' | 'areaIds'> {
  const { all, areaIds } = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >

  if (typeof all !== 'boolean') {
    throw new BadRequestException('all fehlt: alle Bereiche oder die genannten.')
  }

  const ids = areaIds ?? []

  if (!Array.isArray(ids) || !ids.every((id) => isUuid(id))) {
    throw new BadRequestException(unknownArea)
  }

  return { all, areaIds: [...new Set(ids as AreaId[])] }
}

/**
 * Refuses areas the tenant does not have. Each of them once, as `areasFrom`
 * hands them on; an area of another tenant is one this transaction does not
 * find.
 */
export async function requireAreas(
  tx: TenantTransaction,
  areaIds: readonly AreaId[],
): Promise<void> {
  if (areaIds.length === 0) {
    return
  }

  const known = await tx
    .select({ id: areas.id })
    .from(areas)
    .where(inArray(areas.id, [...areaIds]))

  if (known.length !== areaIds.length) {
    throw new BadRequestException(unknownArea)
  }
}

/**
 * Gives somebody the areas they hold in: all of them, those made later
 * included, or the ones named, none included. Named for a role that holds in
 * every area is refused (`memberAreasProblem`).
 *
 * Only what differs is written, so that the change log of the tenant names
 * the area that came or went and not every area the person kept. What the
 * person sees follows at once, and their device lets go of the rest with its
 * next exchange (ADR 0003, point 13).
 */
export async function setMemberAreas(
  tx: TenantTransaction,
  tenantId: TenantId,
  userId: string,
  wanted: Pick<MemberAreas, 'all' | 'areaIds'>,
): Promise<MemberAreas> {
  // Locked, so that a change of roles at the same moment is seen here or
  // waits for this one.
  const [member] = await tx
    .select({ roles: memberships.roles })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .for('update')

  if (member === undefined) {
    throw new NotFoundException('Diesen Zugang gibt es bei diesem Betreiber nicht.')
  }

  const problem = memberAreasProblem(member.roles, wanted)

  if (problem !== null) {
    throw new ConflictException(problem)
  }

  const areaIds = wanted.all ? [] : wanted.areaIds

  await requireAreas(tx, areaIds)

  const ofThePerson = and(eq(memberAllAreas.tenantId, tenantId), eq(memberAllAreas.userId, userId))
  const [everywhere] = await tx
    .select({ id: memberAllAreas.id })
    .from(memberAllAreas)
    .where(ofThePerson)

  if (wanted.all && everywhere === undefined) {
    await tx.insert(memberAllAreas).values({ tenantId, userId })
  } else if (!wanted.all && everywhere !== undefined) {
    await tx.delete(memberAllAreas).where(ofThePerson)
  }

  const named = and(eq(memberAreas.tenantId, tenantId), eq(memberAreas.userId, userId))
  const held = (await tx.select({ areaId: memberAreas.areaId }).from(memberAreas).where(named)).map(
    (row) => row.areaId,
  )
  const gone = held.filter((id) => !areaIds.includes(id))
  const come = areaIds.filter((id) => !held.includes(id))

  if (gone.length > 0) {
    await tx.delete(memberAreas).where(and(named, inArray(memberAreas.areaId, gone)))
  }

  if (come.length > 0) {
    await tx.insert(memberAreas).values(come.map((areaId) => ({ tenantId, userId, areaId })))
  }

  return { userId, all: wanted.all, areaIds }
}
