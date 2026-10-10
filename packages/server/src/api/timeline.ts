import {
  type ActivityKind,
  type ActivityStatus,
  type DefectStatus,
  type EvidenceResult,
  inTimelineOrder,
  isAllowed,
  type IsoDate,
  type Timeline,
  type TimelineCategory,
  type TimelineEvent,
  type TimelineEventKind,
  type TimelinePlace,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, desc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { PgColumn, SelectedFields } from 'drizzle-orm/pg-core'
import { alias } from 'drizzle-orm/pg-core'

import {
  activities,
  activitySignatures,
  assets,
  defects,
  duties,
  evidence,
  evidenceVoidings,
  rooms,
  workOrderDecisions,
  workOrders,
} from '../database/schema/index.js'
import { inSight } from './activities.controller.js'
import { outcomesOf } from './place-situation.js'
import type { Asking } from './places.js'

/**
 * The timeline of a place (section 4.1 of the concept, #123): what happened
 * there and at everything below it, read from what the application holds
 * anyway, the newest first, a page at a time.
 *
 * Each source is asked for no more than the page reaches, the newest first,
 * and the entries are merged here: a page of thirty reads at most thirty
 * entries of each kind. The transaction is the person's, so a place in
 * another area holds nothing; activities as the person is shown them
 * (`inSight`), and a source only for whoever may read it. Nothing here names
 * a person.
 */

/** A place as the columns of a record say where it is: what narrows it to the place asked. */
interface PlaceColumns {
  readonly property: PgColumn
  readonly building: PgColumn | null
  readonly room: PgColumn | null
  readonly asset: PgColumn | null
}

/** The room and the asset a record names, joined under names of their own for each source. */
function atPlace(
  place: TimelinePlace,
  columns: PlaceColumns,
  room: { readonly building: PgColumn },
  asset: { readonly building: PgColumn; readonly room: PgColumn },
): SQL | undefined {
  if ('propertyId' in place) {
    return eq(columns.property, place.propertyId)
  }

  if ('buildingId' in place) {
    return or(
      columns.building === null ? undefined : eq(columns.building, place.buildingId),
      eq(room.building, place.buildingId),
      eq(asset.building, place.buildingId),
    )
  }

  if ('roomId' in place) {
    return or(
      columns.room === null ? undefined : eq(columns.room, place.roomId),
      eq(asset.room, place.roomId),
    )
  }

  return columns.asset === null ? sql`false` : eq(columns.asset, place.assetId)
}

/** The day of a moment in Germany, as the database works it out. */
function dayOf(moment: PgColumn | SQL): SQL<string> {
  return sql<string>`to_char((${moment} at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD')`
}

/** A moment as an ISO string the screens and the order read alike. */
function isoOf(moment: PgColumn | SQL): SQL<string> {
  return sql<string>`to_char(${moment} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

/** One entry before its mark, as a source reads it. */
interface Raw {
  readonly id: string
  readonly kind: TimelineEventKind
  readonly day: string
  readonly at: string
  readonly subject: TimelineEvent['subject']
  readonly title: string
  readonly number: string | null
  /** For an activity: its kind and its state, which its mark is worked out from. */
  readonly activity?: {
    readonly id: string
    readonly kind: ActivityKind
    readonly status: ActivityStatus
  }
  readonly defectStatus?: DefectStatus
  readonly evidence?: { readonly result: EvidenceResult; readonly voided: boolean }
}

/** A row of a source about activities, whatever its key is the key of. */
interface ActivityRow {
  readonly key: unknown
  readonly role: string | null
  readonly day: string
  readonly at: string
  readonly activityId: unknown
  readonly activityKind: ActivityKind
  readonly status: ActivityStatus
  readonly title: string
  readonly number: string | null
}

/** What a timeline is asked for. */
export interface TimelineQuestion {
  readonly place: TimelinePlace
  readonly category: TimelineCategory | null
  readonly offset: number
  readonly limit: number
}

export async function timelineOf(
  tx: TenantTransaction,
  identity: Asking,
  question: TimelineQuestion,
): Promise<Timeline> {
  const { place, category } = question
  const reach = question.offset + question.limit + 1
  const wanted = (kinds: readonly TimelineCategory[]) =>
    category === null || kinds.includes(category)
  const raws: Raw[] = []

  if (isAllowed(identity, 'activity.read') && wanted(['rounds', 'inspections', 'work_orders'])) {
    raws.push(...(await activityEntries(tx, identity, place, category, reach)))
  }

  if (isAllowed(identity, 'defect.read') && wanted(['defects'])) {
    raws.push(...(await defectEntries(tx, place, reach)))
  }

  if (isAllowed(identity, 'evidence.read') && wanted(['evidence'])) {
    raws.push(...(await evidenceEntries(tx, place, reach)))
  }

  // Each source holds only what the category asks for: the activities of
  // its kinds, or the defects, or the evidence.
  const page = raws
    .sort((left, right) => inTimelineOrder(left, right))
    .slice(question.offset, question.offset + question.limit + 1)
  const shown = page.slice(0, question.limit)
  const outcomes = await outcomesOf(tx, [
    ...new Map(
      shown.flatMap((raw) => (raw.activity ? [[raw.activity.id, raw.activity]] : [])),
    ).values(),
  ])

  return {
    more: page.length > question.limit,
    events: shown.map((raw) => ({
      id: raw.id,
      kind: raw.kind,
      day: raw.day as IsoDate,
      at: raw.at,
      subject: raw.subject,
      title: raw.title,
      number: raw.number,
      mark: raw.activity
        ? {
            kind: 'activity',
            outcome:
              raw.activity.status === 'open'
                ? 'open'
                : (outcomes.get(raw.activity.id) ?? 'without_defects'),
          }
        : raw.defectStatus
          ? { kind: 'defect', status: raw.defectStatus }
          : {
              kind: 'evidence',
              result: raw.evidence?.result ?? 'without_defects',
              voided: raw.evidence?.voided ?? false,
            },
    })),
  }
}

/**
 * What happened to the activities at the place: begun, signed, countersigned,
 * closed as not performed, and of a work order made, accepted and turned back.
 */
async function activityEntries(
  tx: TenantTransaction,
  identity: Asking,
  place: TimelinePlace,
  category: TimelineCategory | null,
  reach: number,
): Promise<Raw[]> {
  const room = alias(rooms, 'activity_room')
  const asset = alias(assets, 'activity_asset')
  const where = and(
    isNull(activities.deletedAt),
    atPlace(
      place,
      {
        property: activities.propertyId,
        building: activities.buildingId,
        room: activities.roomId,
        asset: activities.assetId,
      },
      { building: room.buildingId },
      { building: asset.buildingId, room: asset.roomId },
    ),
    category === 'rounds'
      ? eq(activities.kind, 'round')
      : category === 'work_orders'
        ? eq(activities.kind, 'work_order')
        : category === 'inspections'
          ? inArray(activities.kind, ['inspection', 'maintenance'])
          : undefined,
    inSight(identity),
  )
  const base = {
    activityId: activities.id,
    activityKind: activities.kind,
    status: activities.status,
    title: activities.title,
    number: workOrders.number,
  }
  const from = <T extends SelectedFields>(selection: T) =>
    tx
      .select({ ...base, ...selection })
      .from(activities)
      .leftJoin(room, eq(room.id, activities.roomId))
      .leftJoin(asset, eq(asset.id, activities.assetId))
      .leftJoin(workOrders, eq(workOrders.activityId, activities.id))

  const signed = await from({
    key: activitySignatures.id,
    role: activitySignatures.role,
    day: dayOf(activitySignatures.signedAt),
    at: isoOf(activitySignatures.signedAt),
  })
    .innerJoin(activitySignatures, eq(activitySignatures.activityId, activities.id))
    .where(and(where, isNull(activitySignatures.deletedAt)))
    .orderBy(desc(activitySignatures.signedAt))
    .limit(reach)
  const changed = await from({
    key: activities.id,
    role: sql<null>`null`,
    day: dayOf(activities.updatedAt),
    at: isoOf(activities.updatedAt),
  })
    .where(and(where, inArray(activities.status, ['started', 'not_performed'])))
    .orderBy(desc(activities.updatedAt))
    .limit(reach)
  const made = await from({
    key: activities.id,
    role: sql<null>`null`,
    day: dayOf(activities.createdAt),
    at: isoOf(activities.createdAt),
  })
    .where(and(where, eq(activities.kind, 'work_order')))
    .orderBy(desc(activities.createdAt))
    .limit(reach)
  const decided = await from({
    key: workOrderDecisions.id,
    role: workOrderDecisions.decision,
    day: dayOf(workOrderDecisions.decidedAt),
    at: isoOf(workOrderDecisions.decidedAt),
  })
    .innerJoin(workOrderDecisions, eq(workOrderDecisions.workOrderId, workOrders.id))
    .where(and(where, isNull(workOrderDecisions.deletedAt)))
    .orderBy(desc(workOrderDecisions.decidedAt))
    .limit(reach)

  const entry = (row: ActivityRow, kind: TimelineEventKind): Raw => ({
    id: `${kind}:${String(row.key)}`,
    kind,
    day: row.day,
    at: row.at,
    subject: { type: 'activity', id: row.activityId as string, activityKind: row.activityKind },
    title: row.title,
    number: row.number,
    activity: { id: row.activityId as string, kind: row.activityKind, status: row.status },
  })

  return [
    ...signed.map((row) => entry(row, row.role === 'countersigner' ? 'countersigned' : 'signed')),
    ...changed.map((row) => entry(row, row.status === 'started' ? 'started' : 'not_performed')),
    ...made.map((row) => entry(row, 'order_made')),
    ...decided.map((row) =>
      entry(row, row.role === 'accepted' ? 'order_accepted' : 'order_rejected'),
    ),
  ]
}

/** The defects at the place: found, and checked again. */
async function defectEntries(
  tx: TenantTransaction,
  place: TimelinePlace,
  reach: number,
): Promise<Raw[]> {
  const room = alias(rooms, 'defect_room')
  const asset = alias(assets, 'defect_asset')
  const where = and(
    isNull(defects.deletedAt),
    atPlace(
      place,
      {
        property: defects.propertyId,
        building: defects.buildingId,
        room: defects.roomId,
        asset: defects.assetId,
      },
      { building: room.buildingId },
      { building: asset.buildingId, room: asset.roomId },
    ),
  )
  const read = (day: SQL<string>, at: SQL<string>) =>
    tx
      .select({
        id: defects.id,
        description: defects.description,
        status: defects.status,
        day,
        at,
      })
      .from(defects)
      .leftJoin(room, eq(room.id, defects.roomId))
      .leftJoin(asset, eq(asset.id, defects.assetId))
  const found = await read(
    sql<string>`to_char(${defects.foundOn}, 'YYYY-MM-DD')`,
    isoOf(defects.createdAt),
  )
    .where(where)
    .orderBy(desc(defects.foundOn), desc(defects.createdAt))
    .limit(reach)
  const checked = await read(
    sql<string>`to_char(${defects.checkedOn}, 'YYYY-MM-DD')`,
    isoOf(defects.updatedAt),
  )
    .where(and(where, eq(defects.status, 'verified')))
    .orderBy(desc(defects.checkedOn), desc(defects.updatedAt))
    .limit(reach)

  const entry = (row: (typeof found)[number], kind: TimelineEventKind): Raw => ({
    id: `${kind}:${row.id as string}`,
    kind,
    day: row.day,
    at: row.at,
    subject: { type: 'defect', id: row.id as string },
    title: row.description,
    number: null,
    defectStatus: row.status,
  })

  return [
    ...found.map((row) => entry(row, 'defect_found')),
    ...checked.map((row) => entry(row, 'defect_checked')),
  ]
}

/**
 * The evidence of the duties at the place: a report or an evidence taken
 * over, when it was entered, and any evidence when it was declared invalid.
 * An evidence that came of a signature in the application has that
 * signature's entry and stands no second time.
 */
async function evidenceEntries(
  tx: TenantTransaction,
  place: TimelinePlace,
  reach: number,
): Promise<Raw[]> {
  const room = alias(rooms, 'evidence_room')
  const asset = alias(assets, 'evidence_asset')
  const voiding = alias(evidenceVoidings, 'evidence_voiding')
  const where = and(
    atPlace(
      place,
      {
        property: duties.propertyId,
        building: duties.buildingId,
        room: duties.roomId,
        asset: duties.assetId,
      },
      { building: room.buildingId },
      { building: asset.buildingId, room: asset.roomId },
    ),
  )
  const read = <T extends SelectedFields>(selection: T) =>
    tx
      .select({
        id: evidence.id,
        number: evidence.number,
        result: evidence.result,
        voided: sql<boolean>`${voiding.id} is not null`,
        title: sql<string>`coalesce(${evidence.state} -> 'duty' ->> 'label', ${duties.label}, ${evidence.number})`,
        ...selection,
      })
      .from(evidence)
      .innerJoin(duties, eq(duties.id, evidence.dutyId))
      .leftJoin(room, eq(room.id, duties.roomId))
      .leftJoin(asset, eq(asset.id, duties.assetId))
      .leftJoin(voiding, eq(voiding.evidenceId, evidence.id))
  const entered = await read({
    day: sql<string>`to_char(${evidence.performedOn}, 'YYYY-MM-DD')`,
    at: isoOf(evidence.writtenAt),
  })
    .where(and(where, inArray(evidence.origin, ['report', 'legacy'])))
    .orderBy(desc(evidence.performedOn), desc(evidence.writtenAt))
    .limit(reach)
  const voided = await read({ day: dayOf(voiding.voidedAt), at: isoOf(voiding.voidedAt) })
    .where(and(where, sql`${voiding.id} is not null`))
    .orderBy(desc(voiding.voidedAt))
    .limit(reach)

  const entry = (row: (typeof entered)[number], kind: TimelineEventKind): Raw => ({
    id: `${kind}:${row.id as string}`,
    kind,
    day: row.day,
    at: row.at,
    subject: { type: 'evidence', id: row.id as string },
    title: row.title,
    number: row.number,
    evidence: { result: row.result, voided: row.voided },
  })

  return [
    ...entered.map((row) => entry(row, 'evidence_entered')),
    ...voided.map((row) => entry(row as (typeof entered)[number], 'evidence_voided')),
  ]
}
