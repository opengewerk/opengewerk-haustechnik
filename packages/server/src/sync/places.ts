import type {
  Activity,
  Asset,
  Building,
  Defect,
  Floor,
  Identity,
  Property,
  Room,
} from '@opengewerk/haustechnik-domain'
import {
  type FoundIdentity,
  isUuid,
  type SyncCheck,
  type SyncRefusal,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import {
  activities,
  activityAnswers,
  assets,
  assetSupplies,
  attachments,
  buildings,
  defects,
  floors,
  properties,
  rooms,
  workOrders,
} from '../database/schema/index.js'

// Where a record made on a device hangs, asked before the database does (ADR
// 0006, point 11). The keys over tenant and property would refuse a place
// that is gone, of another property or of another area too, and the policy of
// the areas a row outside the person's areas; but for the whole transmission,
// with what the device sent beside it. Asked here, it is a conflict about
// this one operation, `record_missing` with the field it hangs on, the answer
// the foundation gives a reference that is gone.
//
// The area of a row and the levels above it are the server's (ADR 0006,
// point 8): reserved in the policy, so a device sends none, and put in here
// from the record the row hangs on, the way the routes put them in.

type Check = SyncCheck<FoundIdentity<Identity>>

/** A table of the place or the work, as the lookup below needs it. */
type FoundTable = PgTable & { id: PgColumn; deletedAt: PgColumn }

/**
 * The row of an id that is there for the person asking: not marked deleted,
 * and in one of their areas, which the policy decides. Anything else is
 * nothing, an id that is no id at all included.
 */
async function found<Row>(
  tx: TenantTransaction,
  table: FoundTable,
  id: unknown,
): Promise<Row | null> {
  if (!isUuid(id)) {
    return null
  }

  const [row] = await tx
    .select()
    .from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))

  return (row as Row | undefined) ?? null
}

function given(value: unknown): boolean {
  return value !== undefined && value !== null
}

function missing(field: string): SyncRefusal {
  return { kind: 'conflict', reason: 'record_missing', fields: [field] }
}

/** A room on its floor: building, property and area come from the floor. */
async function roomPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const floor = await found<Floor>(tx, floors, values['floorId'])

  if (!floor) {
    return missing('floorId')
  }

  values['buildingId'] = floor.buildingId
  values['propertyId'] = floor.propertyId
  values['areaId'] = floor.areaId

  return null
}

/**
 * An asset in its building, on request in one of its rooms and under an
 * asset there: property and area come from the building. A component stands
 * in the building of the asset it belongs to.
 */
async function assetPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const building = await found<Building>(tx, buildings, values['buildingId'])

  if (!building) {
    return missing('buildingId')
  }

  if (given(values['parentAssetId'])) {
    const parent = await found<Asset>(tx, assets, values['parentAssetId'])

    if (!parent || parent.buildingId !== building.id) {
      return missing('parentAssetId')
    }
  }

  if (given(values['roomId'])) {
    const room = await found<Room>(tx, rooms, values['roomId'])

    if (!room || room.buildingId !== building.id) {
      return missing('roomId')
    }
  }

  values['propertyId'] = building.propertyId
  values['areaId'] = building.areaId

  return null
}

/**
 * A building or a room an asset supplies, on the property of the asset, and
 * once: a second device that entered the same place meanwhile has done what
 * this one wanted, and a person sees it rather than a refused transmission.
 */
async function supplyPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const asset = await found<Asset>(tx, assets, values['assetId'])

  if (!asset) {
    return missing('assetId')
  }

  for (const [field, table, column] of [
    ['buildingId', buildings, assetSupplies.buildingId],
    ['roomId', rooms, assetSupplies.roomId],
  ] as const) {
    if (!given(values[field])) {
      continue
    }

    const place = await found<Building | Room>(tx, table, values[field])

    if (!place || place.propertyId !== asset.propertyId) {
      return missing(field)
    }

    const [entered] = await tx
      .select({ id: assetSupplies.id })
      .from(assetSupplies)
      .where(
        and(
          eq(assetSupplies.assetId, asset.id),
          eq(column, place.id),
          isNull(assetSupplies.deletedAt),
        ),
      )

    if (entered) {
      return { kind: 'conflict', reason: 'changed_elsewhere', fields: [field] }
    }
  }

  values['propertyId'] = asset.propertyId
  values['areaId'] = asset.areaId

  return null
}

/**
 * A record that names its place itself, an activity or a defect: the
 * property, and at most one place on it (ADR 0002, point 10). The area comes
 * from the property.
 */
async function targetPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const property = await found<Property>(tx, properties, values['propertyId'])

  if (!property) {
    return missing('propertyId')
  }

  for (const [field, table] of [
    ['assetId', assets],
    ['roomId', rooms],
    ['buildingId', buildings],
  ] as const) {
    if (!given(values[field])) {
      continue
    }

    const place = await found<Asset | Room | Building>(tx, table, values[field])

    if (!place || place.propertyId !== property.id) {
      return missing(field)
    }
  }

  values['areaId'] = property.areaId

  return null
}

/**
 * A defect at its place, noticed on request in an activity on the same
 * property while the work on it goes on (#108). One found in an activity that
 * is signed or closed would change the page that was signed, and its
 * signature would count no more: that activity is fixed.
 *
 * The activity is locked to the end of the transmission, with the lock the
 * gate of the foundation takes for answers and results (opengewerk#582). A
 * signature holds the activity for its whole transaction (`checkSignature`),
 * so a defect sent at the same moment waits for it and finds the activity
 * signed, and a signature that comes second finds the defect on its page.
 * Read without the lock, the defect could land between the page the
 * signature was checked against and its commit. A shared lock would do for
 * that, but a signature often follows the defect in the same transmission:
 * two of them, each holding the activity shared, would wait for each other.
 */
async function defectPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const refusal = await targetPlace(tx, values)

  if (refusal || !given(values['foundInActivityId'])) {
    return refusal
  }

  const id = values['foundInActivityId']
  const [activity] =
    typeof id === 'string' && isUuid(id)
      ? ((await tx
          .select()
          .from(activities)
          .where(and(eq(activities.id, id as Activity['id']), isNull(activities.deletedAt)))
          .for('no key update')) as Activity[])
      : []

  if (!activity || activity.propertyId !== values['propertyId']) {
    return missing('foundInActivityId')
  }

  return activity.status === 'open' || activity.status === 'started'
    ? null
    : { kind: 'conflict', reason: 'record_is_fixed', fields: ['foundInActivityId'] }
}

/**
 * What only a work order has, beside its activity: an activity of the kind,
 * and one for it. Property and area come from the activity; the kind the keys
 * hold it to is the one the column gives every row, a work order.
 */
async function workOrderPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const activity = await found<Activity>(tx, activities, values['activityId'])

  if (!activity || activity.kind !== 'work_order') {
    return missing('activityId')
  }

  const [ordered] = await tx
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.activityId, activity.id), isNull(workOrders.deletedAt)))

  if (ordered) {
    return { kind: 'conflict', reason: 'changed_elsewhere', fields: ['activityId'] }
  }

  values['propertyId'] = activity.propertyId
  values['areaId'] = activity.areaId

  return null
}

/**
 * A signature on its activity: property and area come from the activity.
 * Whether it fits the activity as the server holds it is the next question
 * (`signed` in `signatures.ts`).
 */
async function signaturePlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const activity = await found<Activity>(tx, activities, values['activityId'])

  if (!activity) {
    return missing('activityId')
  }

  values['propertyId'] = activity.propertyId
  values['areaId'] = activity.areaId

  return null
}

/**
 * The answer to a point of the form of an activity (#106): property and area
 * come from the activity, and a photo is a document at the same activity. A
 * point that has its answer already was answered by somebody else while the
 * device was away, a conflict about this one operation at the point (ADR
 * 0006, point 7), which a person decides.
 */
async function answerPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const activity = await found<Activity>(tx, activities, values['activityId'])

  if (!activity) {
    return missing('activityId')
  }

  values['propertyId'] = activity.propertyId
  values['areaId'] = activity.areaId

  const groupKey = values['groupKey']
  const blockKey = values['blockKey']
  const [answered] = await tx
    .select({ id: activityAnswers.id })
    .from(activityAnswers)
    .where(
      and(
        eq(activityAnswers.activityId, activity.id),
        typeof groupKey === 'string'
          ? eq(activityAnswers.groupKey, groupKey)
          : isNull(activityAnswers.groupKey),
        typeof blockKey === 'string'
          ? eq(activityAnswers.blockKey, blockKey)
          : isNull(activityAnswers.blockKey),
        eq(activityAnswers.fieldKey, String(values['fieldKey'])),
        isNull(activityAnswers.deletedAt),
      ),
    )

  return answered ? { kind: 'conflict', reason: 'changed_elsewhere', fields: ['fieldKey'] } : null
}

/**
 * A document at its place: the property, and at most one record on it, a
 * building, a room, an asset, an activity or a defect, whose photo it is
 * (#116). The area comes from the property. Every one of them has to be there
 * for the person asking, so a document cannot be hung on a record of another
 * area or one that is gone. A defect made in the same transmission is there.
 */
async function documentPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const refusal = await targetPlace(tx, values)

  if (refusal) {
    return refusal
  }

  if (given(values['activityId'])) {
    const activity = await found<Activity>(tx, activities, values['activityId'])

    return activity && activity.propertyId === values['propertyId'] ? null : missing('activityId')
  }

  if (given(values['defectId'])) {
    const defect = await found<Defect>(tx, defects, values['defectId'])

    return defect && defect.propertyId === values['propertyId'] ? null : missing('defectId')
  }

  return null
}

/**
 * A version of a document: the document has to be there for the person
 * asking, in one of their areas and not taken out of the records. A version
 * carries no place of its own.
 */
async function versionPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const document = await found<{ id: string }>(tx, attachments, values['attachmentId'])

  return document ? null : missing('attachmentId')
}

const placeOf: Readonly<
  Record<
    string,
    (tx: TenantTransaction, values: Record<string, unknown>) => Promise<SyncRefusal | null>
  >
> = {
  rooms: roomPlace,
  assets: assetPlace,
  asset_supplies: supplyPlace,
  activities: targetPlace,
  defects: defectPlace,
  work_orders: workOrderPlace,
  activity_signatures: signaturePlace,
  activity_answers: answerPlace,
  attachments: documentPlace,
  attachment_versions: versionPlace,
}

/**
 * The place of a record a device makes. A change moves nothing: what a device
 * may change without a connection names no place (`offlineEdits`), and what
 * moves a record is a route of the office.
 */
export const placed: Check = ({ tx, operation, values }) => {
  const place = Object.hasOwn(placeOf, operation.entity) ? placeOf[operation.entity] : undefined

  return operation.kind === 'create' && place ? place(tx, values) : null
}
