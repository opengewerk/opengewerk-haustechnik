import {
  type ActivityId,
  type ActivityKind,
  activityKindOfTask,
  type ActivityStatus,
  activityLimits,
  byNameIn,
  type Catalogue,
  type CollectiveCandidate,
  type CollectiveKind,
  type CollectivePart,
  type CollectivePlan,
  type ContractorId,
  type Duty,
  dutyHasEnded,
  type DutyId,
  type DutyPerformer,
  type EvidenceId,
  type EvidenceResult,
  type IsoDate,
  partHasItsResult,
  placeWords,
  roomTitle,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'

import { dutiesOnADay, dutyTitle, type RegisteredDuty } from '../database/duty-standing.js'
import {
  activities,
  activityDuties,
  assets,
  buildings,
  duties,
  evidence,
  floors,
  properties,
  rooms,
} from '../database/schema/index.js'
import { makeActivityForDuty, underWayFor } from './for-duty.js'

/**
 * Collective activities in the office (section 4.4 of the concept, #342):
 * the duties of a kind at a place that whoever plans and hands out work may
 * take into one, composing it, and reading its parts.
 */

/** Why the office is refused: a place it cannot see, a plan that does not fit, or work that went on meanwhile. */
export class CollectiveRefusal extends Error {
  constructor(
    sentence: string,
    readonly about: 'missing' | 'invalid' | 'conflict',
  ) {
    super(sentence)
    this.name = 'CollectiveRefusal'
  }
}

const missingPlace = 'Diesen Ort gibt es nicht oder nicht mehr.'

/** What the office names as the place of a collective activity. */
export interface AskedPlace {
  readonly propertyId: string
  readonly buildingId: string | null
  readonly roomId: string | null
}

/** The place as the person asking sees it: what it is, its area, and what it is called. */
export interface CollectivePlace {
  readonly propertyId: (typeof properties.$inferSelect)['id']
  readonly buildingId: (typeof buildings.$inferSelect)['id'] | null
  readonly roomId: (typeof rooms.$inferSelect)['id'] | null
  readonly areaId: (typeof properties.$inferSelect)['areaId']
  /** The area of the property, which a collective activity at the property itself asks for. */
  readonly propertyAreaId: (typeof properties.$inferSelect)['areaId']
  readonly name: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The live row of a table under an id, as the policies let the person see it, or the refusal. */
async function seen<Row>(
  tx: TenantTransaction,
  table: typeof properties | typeof buildings | typeof rooms,
  id: string,
): Promise<Row> {
  if (!uuid.test(id)) {
    throw new CollectiveRefusal(missingPlace, 'missing')
  }

  const [row] = await tx
    .select()
    .from(table)
    .where(and(eq(table.id, id as never), isNull(table.deletedAt)))

  if (row === undefined) {
    throw new CollectiveRefusal(missingPlace, 'missing')
  }

  return row as Row
}

/**
 * The place of a collective activity: the property, and a building or a room
 * on it, or neither. Its area is the one of the room, of the building, or of
 * the property (ADR 0003, addendum of #306).
 */
export async function collectivePlace(
  tx: TenantTransaction,
  asked: AskedPlace,
): Promise<CollectivePlace> {
  const property = await seen<typeof properties.$inferSelect>(tx, properties, asked.propertyId)
  const room =
    asked.roomId === null ? null : await seen<typeof rooms.$inferSelect>(tx, rooms, asked.roomId)
  const buildingId = room?.buildingId ?? asked.buildingId
  const building =
    buildingId === null
      ? null
      : await seen<typeof buildings.$inferSelect>(tx, buildings, buildingId)

  if (
    (building !== null && building.propertyId !== property.id) ||
    (room !== null && room.propertyId !== property.id)
  ) {
    throw new CollectiveRefusal(missingPlace, 'missing')
  }

  return {
    propertyId: property.id,
    buildingId: room === null ? (building?.id ?? null) : null,
    roomId: room?.id ?? null,
    areaId: room?.areaId ?? building?.areaId ?? property.areaId,
    propertyAreaId: property.areaId,
    name:
      room !== null
        ? placeWords([building?.name, roomTitle({ number: room.number, name: room.name })])
        : (building?.name ?? property.name),
  }
}

/** A duty at the place with what lies around it, how it stands today and where it is in words. */
interface DutyThere {
  readonly duty: Duty
  readonly registered: RegisteredDuty
  readonly asset: {
    readonly id: string
    readonly number: string | null
    readonly name: string
  } | null
  readonly where: string
}

/**
 * The duties at a place that run today, of a kind or of every kind: not
 * ended and not resting with their asset. Where each is stands in words
 * below the place: the building where the place is the property, the floor
 * and the room.
 */
async function dutiesAt(
  tx: TenantTransaction,
  catalogue: Catalogue,
  place: CollectivePlace,
  kind: string | null,
  today: IsoDate,
): Promise<DutyThere[]> {
  const rows = (await tx
    .select()
    .from(duties)
    .where(
      and(
        eq(duties.propertyId, place.propertyId),
        isNull(duties.deletedAt),
        kind === null ? undefined : eq(duties.kind, kind),
      ),
    )
    .orderBy(asc(duties.id))) as Duty[]
  const running = rows.filter((duty) => duty.kind !== null && !dutyHasEnded(duty, today))
  const assetIds = [
    ...new Set(running.flatMap((duty) => (duty.assetId === null ? [] : [duty.assetId]))),
  ]
  const assetRows =
    assetIds.length === 0
      ? []
      : await tx
          .select({
            id: assets.id,
            number: assets.number,
            name: assets.name,
            buildingId: assets.buildingId,
            roomId: assets.roomId,
          })
          .from(assets)
          .where(inArray(assets.id, assetIds))
  const assetOf = new Map(assetRows.map((row) => [row.id as string, row]))
  const roomIds = [
    ...new Set(
      running.flatMap((duty) => {
        const roomId =
          (duty.assetId === null ? null : assetOf.get(duty.assetId)?.roomId) ?? duty.roomId

        return roomId === null || roomId === undefined ? [] : [roomId]
      }),
    ),
  ]
  const roomRows =
    roomIds.length === 0
      ? []
      : await tx
          .select({
            id: rooms.id,
            number: rooms.number,
            name: rooms.name,
            buildingId: rooms.buildingId,
            floorName: floors.name,
          })
          .from(rooms)
          .innerJoin(floors, eq(floors.id, rooms.floorId))
          .where(inArray(rooms.id, roomIds))
  const roomOf = new Map(roomRows.map((row) => [row.id as string, row]))
  const buildingRows = await tx
    .select({ id: buildings.id, name: buildings.name })
    .from(buildings)
    .where(eq(buildings.propertyId, place.propertyId))
  const buildingOf = new Map(buildingRows.map((row) => [row.id as string, row.name]))
  const there = running.flatMap((duty) => {
    const asset = duty.assetId === null ? null : (assetOf.get(duty.assetId) ?? null)
    const roomId = (asset?.roomId ?? duty.roomId) as string | null
    const room = roomId === null ? null : (roomOf.get(roomId) ?? null)
    const buildingId = (asset?.buildingId ?? room?.buildingId ?? duty.buildingId) as string | null

    if (place.roomId !== null && roomId !== place.roomId) {
      return []
    }

    if (place.buildingId !== null && buildingId !== place.buildingId) {
      return []
    }

    return [
      {
        duty,
        asset:
          asset === null
            ? null
            : { id: asset.id as string, number: asset.number, name: asset.name },
        where: placeWords([
          place.buildingId === null && place.roomId === null && buildingId !== null
            ? buildingOf.get(buildingId)
            : null,
          place.roomId === null ? room?.floorName : null,
          place.roomId === null && room !== null
            ? roomTitle({ number: room.number, name: room.name })
            : null,
        ]),
      },
    ]
  })
  const standing = await dutiesOnADay(
    tx,
    today,
    there.map(({ duty }) => duty),
    catalogue,
  )

  return there
    .map((each, index) => ({ ...each, registered: standing[index] as RegisteredDuty }))
    .filter((each) => each.registered.standing.state !== 'dormant')
    .sort(
      (left, right) =>
        byNameIn(left.where, right.where) ||
        byNameIn(left.asset?.number ?? '', right.asset?.number ?? ''),
    )
}

/** What the office is offered while it composes, before the names of the people who perform. */
export interface CandidatesRead {
  readonly kinds: readonly CollectiveKind[]
  readonly candidates: readonly (Omit<CollectiveCandidate, 'activity'> & {
    readonly activity:
      | (Omit<NonNullable<CollectiveCandidate['activity']>, 'performer'> & {
          readonly performerUserId: string | null
        })
      | null
  })[]
  readonly elsewhere: number
}

/**
 * The duty kinds at a place, and for the one asked about its duties with the
 * activity under way for each: only duties in the area of the place, the
 * others counted.
 */
export async function collectiveCandidates(
  tx: TenantTransaction,
  catalogue: Catalogue,
  place: CollectivePlace,
  kind: string | null,
  today: IsoDate,
): Promise<CandidatesRead> {
  const all = await dutiesAt(tx, catalogue, place, null, today)
  const here = all.filter(({ duty }) => duty.areaId === place.areaId)
  const byKind = new Map<string, { label: string; duties: number }>()

  for (const { duty } of here) {
    const key = duty.kind as string
    const known = byKind.get(key)

    byKind.set(key, {
      label: known?.label ?? dutyTitle({ ...duty, label: null }, catalogue),
      duties: (known?.duties ?? 0) + 1,
    })
  }

  const kinds = [...byKind]
    .map(([key, { label, duties: count }]) => ({ key, label, duties: count }))
    .sort((left, right) => byNameIn(left.label, right.label))

  if (kind === null) {
    return { kinds, candidates: [], elsewhere: 0 }
  }

  const ofKind = here.filter(({ duty }) => duty.kind === kind)
  const underWay = await underWayFor(
    tx,
    ofKind.map(({ duty }) => duty.id),
  )

  return {
    kinds,
    elsewhere: all.filter(({ duty }) => duty.kind === kind && duty.areaId !== place.areaId).length,
    candidates: ofKind.map(({ duty, registered, asset, where }) => {
      const activity = underWay.get(duty.id) ?? null

      return {
        dutyId: duty.id as DutyId,
        title: dutyTitle(duty, catalogue),
        asset,
        where,
        appointment: registered.standing.appointment?.dueOn ?? null,
        state: registered.standing.state,
        activity:
          activity === null
            ? null
            : {
                id: activity.id,
                kind: activity.kind,
                status: activity.status,
                partOfOne: activity.collectiveId !== null,
                performerUserId: activity.performerUserId,
              },
      }
    }),
  }
}

/** How whoever composes plans the work, which every part takes over. */
export type CollectivePeople = Pick<
  CollectivePlan,
  'responsibleUserId' | 'performer' | 'performerUserId' | 'contractorNote' | 'contractorId'
>

/**
 * Composes a collective activity (#342) in the transaction it is given: the
 * collective activity at the place, and a part for each duty. An open
 * activity of a duty becomes its part and takes over the plan; a duty
 * without one gets a new one, made as the engine makes one of its due day,
 * with the last protocol of its asset as its template. Each part keeps the
 * day its duty is due on.
 *
 * Refused, all of it: a duty that is not a running duty of the kind at the
 * place, one in another area, and one with an activity somebody began, that
 * is signed or that is a part already. The duties are held until it is
 * written, so that the engine makes no second activity for one of them
 * meanwhile.
 */
export async function composeCollective(
  tx: TenantTransaction,
  catalogue: Catalogue,
  tenantId: (typeof activities.$inferInsert)['tenantId'],
  place: CollectivePlace,
  plan: CollectivePlan,
  today: IsoDate,
  now: Date,
): Promise<ActivityId> {
  const ids = [...plan.dutyIds].sort() as DutyId[]

  // Held in one order, so that two who compose at once wait and do not lock each other.
  await tx
    .select({ id: duties.id })
    .from(duties)
    .where(inArray(duties.id, ids))
    .orderBy(asc(duties.id))
    .for('update')

  const there = new Map(
    (await dutiesAt(tx, catalogue, place, null, today)).map((each) => [
      each.duty.id as string,
      each,
    ]),
  )
  const chosen = ids.map((id) => there.get(id))

  if (chosen.some((each) => each === undefined || each.duty.kind !== plan.dutyKind)) {
    throw new CollectiveRefusal(
      'Ein Sammelvorgang nimmt laufende Pflichten seiner Pflichtart an seinem Ort.',
      'invalid',
    )
  }

  const chosenDuties = chosen as DutyThere[]

  if (chosenDuties.some(({ duty }) => duty.areaId !== place.areaId)) {
    throw new CollectiveRefusal(
      'Ein Sammelvorgang nimmt nur Pflichten im Bereich seines Orts. Eine Anlage in einem Gebäude mit eigenem Bereich kommt in einen Sammelvorgang an diesem Gebäude.',
      'invalid',
    )
  }

  const underWay = await underWayFor(tx, ids)
  const named = (each: DutyThere) =>
    each.asset === null
      ? dutyTitle(each.duty, catalogue)
      : [each.asset.number, each.asset.name].filter((part) => part !== null).join(' ')

  for (const each of chosenDuties) {
    const activity = underWay.get(each.duty.id)

    if (activity === undefined) {
      continue
    }

    if (activity.collectiveId !== null) {
      throw new CollectiveRefusal(`${named(each)} ist schon Teil eines Sammelvorgangs.`, 'conflict')
    }

    if (activity.status !== 'open' || activity.kind === 'work_order') {
      throw new CollectiveRefusal(
        `Für ${named(each)} läuft ein Vorgang, den jemand begonnen hat oder der ein Auftrag ist; er bleibt für sich.`,
        'conflict',
      )
    }
  }

  const first = chosenDuties[0] as DutyThere
  const definition =
    first.duty.kind === null || first.duty.kindVersion === null
      ? null
      : (catalogue.dutyKindVersion(first.duty.kind, first.duty.kindVersion)?.definition ?? null)
  const kind: ActivityKind = activityKindOfTask(first.duty.task ?? definition?.task ?? null)
  const people = {
    responsibleUserId: plan.responsibleUserId,
    performer: plan.performer as DutyPerformer,
    performerUserId: plan.performerUserId,
    contractorNote: plan.contractorNote,
    contractorId: plan.contractorId as ContractorId | null,
  }
  const [collective] = await tx
    .insert(activities)
    .values({
      tenantId,
      propertyId: place.propertyId,
      areaId: place.areaId,
      buildingId: place.buildingId,
      roomId: place.roomId,
      kind,
      title: plan.title.trim().slice(0, activityLimits.title).trim(),
      status: 'open',
      dueOn: plan.dueOn,
      ...people,
      collectiveKind: plan.dutyKind,
    })
    .returning({ id: activities.id })

  if (collective === undefined) {
    throw new Error('The collective activity was not written')
  }

  const collectiveId = collective.id as ActivityId

  for (const each of chosenDuties) {
    const open = underWay.get(each.duty.id)

    if (open !== undefined) {
      const [taken] = await tx
        .update(activities)
        .set({ ...people, collectiveId, updatedAt: now })
        .where(
          and(
            eq(activities.id, open.id),
            eq(activities.status, 'open'),
            isNull(activities.collectiveId),
          ),
        )
        .returning({ id: activities.id })

      if (taken === undefined) {
        throw new CollectiveRefusal(
          `Für ${named(each)} hat jemand den Vorgang eben begonnen; er bleibt für sich.`,
          'conflict',
        )
      }

      continue
    }

    const made = await makeActivityForDuty(tx, catalogue, {
      tenantId,
      dutyId: each.duty.id as DutyId,
      dueOn: each.registered.standing.appointment?.dueOn ?? today,
      responsible: plan.responsibleUserId,
      now,
      part: { collectiveId, ...people },
    })

    if (made.made === null) {
      throw new CollectiveRefusal(
        `Für ${named(each)} ist eben ein Vorgang entstanden. Stellen Sie den Sammelvorgang neu zusammen.`,
        'conflict',
      )
    }
  }

  return collectiveId
}

/** The live parts of a collective activity, in the order of their keys; held for a signature where asked. */
export async function partsOf(
  tx: TenantTransaction,
  collectiveId: ActivityId,
  held = false,
): Promise<(typeof activities.$inferSelect)[]> {
  const query = tx
    .select()
    .from(activities)
    .where(and(eq(activities.collectiveId, collectiveId), isNull(activities.deletedAt)))
    .orderBy(asc(activities.id))

  return held ? query.for('no key update') : query
}

/**
 * The parts of a collective activity as its page in the office shows them:
 * the asset of each with where it is, its duty with the day it is due on, the
 * result and the evidence once it is written.
 */
export async function partLines(
  tx: TenantTransaction,
  catalogue: Catalogue,
  collectiveId: ActivityId,
  today: IsoDate,
): Promise<CollectivePart[]> {
  const parts = await partsOf(tx, collectiveId)

  if (parts.length === 0) {
    return []
  }

  const lines = await tx
    .select({ line: activityDuties, duty: duties })
    .from(activityDuties)
    .innerJoin(duties, eq(duties.id, activityDuties.dutyId))
    .where(
      and(
        inArray(
          activityDuties.activityId,
          parts.map((part) => part.id),
        ),
        isNull(activityDuties.deletedAt),
      ),
    )
    .orderBy(asc(activityDuties.id))
  const standing = await dutiesOnADay(
    tx,
    today,
    lines.map(({ duty }) => duty as Duty),
    catalogue,
  )
  const written = await tx
    .select({
      id: evidence.id,
      number: evidence.number,
      activityId: evidence.activityId,
      dutyId: evidence.dutyId,
    })
    .from(evidence)
    .where(
      inArray(
        evidence.activityId,
        parts.map((part) => part.id),
      ),
    )
    .orderBy(desc(evidence.writtenAt))
  const assetIds = parts.flatMap((part) => (part.assetId === null ? [] : [part.assetId]))
  const assetRows =
    assetIds.length === 0
      ? []
      : await tx
          .select({
            id: assets.id,
            number: assets.number,
            name: assets.name,
            roomNumber: rooms.number,
            roomName: rooms.name,
            floorName: floors.name,
          })
          .from(assets)
          .leftJoin(rooms, eq(rooms.id, assets.roomId))
          .leftJoin(floors, eq(floors.id, rooms.floorId))
          .where(inArray(assets.id, assetIds))
  const assetOf = new Map(assetRows.map((row) => [row.id as string, row]))

  const shown = parts.flatMap((part) => {
    const index = lines.findIndex(({ line }) => line.activityId === part.id)
    const entry = lines[index]

    if (entry === undefined) {
      return []
    }

    const asset = part.assetId === null ? null : (assetOf.get(part.assetId) ?? null)
    const its = written.find((row) => row.activityId === part.id && row.dutyId === entry.duty.id)

    return [
      {
        id: part.id as ActivityId,
        status: part.status,
        asset:
          asset === null
            ? null
            : { id: asset.id as string, number: asset.number, name: asset.name },
        where: placeWords([
          asset?.floorName,
          asset?.roomName === undefined || asset.roomName === null
            ? asset?.roomNumber
            : roomTitle({ number: asset.roomNumber, name: asset.roomName }),
        ]),
        dutyId: entry.duty.id as DutyId,
        dutyTitle: dutyTitle(entry.duty as Duty, catalogue),
        appointment: standing[index]?.standing.appointment?.dueOn ?? null,
        performedOn: part.performedOn,
        result: entry.line.result,
        resultReason: entry.line.resultReason,
        evidence: its === undefined ? null : { id: its.id as EvidenceId, number: its.number },
      },
    ]
  })

  // In the order of where they are, as the list on site has them.
  return shown.sort(
    (left, right) =>
      byNameIn(left.where, right.where) ||
      byNameIn(left.asset?.number ?? '', right.asset?.number ?? ''),
  )
}

/**
 * How many parts each of these collective activities holds and how many of
 * them have their result, for the list: a part with a result on every duty,
 * "not performed" with its reason, or one written down already.
 */
export async function collectiveCounts(
  tx: TenantTransaction,
  collectiveIds: readonly ActivityId[],
): Promise<ReadonlyMap<string, { readonly parts: number; readonly withResult: number }>> {
  if (collectiveIds.length === 0) {
    return new Map()
  }

  const rows = await tx
    .select({
      partId: activities.id,
      collectiveId: activities.collectiveId,
      status: activities.status,
      result: activityDuties.result,
      resultReason: activityDuties.resultReason,
    })
    .from(activities)
    .leftJoin(
      activityDuties,
      and(eq(activityDuties.activityId, activities.id), isNull(activityDuties.deletedAt)),
    )
    .where(and(inArray(activities.collectiveId, [...collectiveIds]), isNull(activities.deletedAt)))
  const byPart = new Map<
    string,
    {
      readonly collectiveId: string
      readonly status: ActivityStatus
      readonly lines: { result: EvidenceResult | null; resultReason: string | null }[]
    }
  >()

  for (const row of rows) {
    const part = byPart.get(row.partId) ?? {
      collectiveId: row.collectiveId as string,
      status: row.status,
      lines: [],
    }

    // A part without a duty, which the server does not make, stands without a result.
    part.lines.push({ result: row.result, resultReason: row.resultReason })
    byPart.set(row.partId, part)
  }

  const counts = new Map<string, { parts: number; withResult: number }>()

  for (const part of byPart.values()) {
    const known = counts.get(part.collectiveId) ?? { parts: 0, withResult: 0 }
    const done = part.status === 'done' || part.status === 'not_performed'

    counts.set(part.collectiveId, {
      parts: known.parts + 1,
      withResult: known.withResult + (done || partHasItsResult(part.lines) ? 1 : 0),
    })
  }

  return counts
}
