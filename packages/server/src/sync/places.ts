import {
  type Activity,
  type Asset,
  boardAssetKind,
  type Building,
  type Defect,
  type Floor,
  type Identity,
  inverterAssetKind,
  type Property,
  type Room,
  type StructurePlace,
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
  articles,
  assets,
  assetSupplies,
  attachments,
  buildings,
  circuits,
  contractors,
  contracts,
  defects,
  distributionBoards,
  floors,
  inverters,
  properties,
  pvStrings,
  rooms,
  stores,
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
 *
 * Held for a share unless `held` is false. PostgreSQL holds a row that way
 * only for whoever may change it, the policies for UPDATE included, so a row
 * the person only reads is not found held.
 */
async function found<Row>(
  tx: TenantTransaction,
  table: FoundTable,
  id: unknown,
  held = true,
): Promise<Row | null> {
  if (!isUuid(id)) {
    return null
  }

  // Shared, so that a deletion of the row at the same moment is waited for
  // and seen (#78, T14-4): read without it, the row as it was before would
  // let a new record hang on a place that is gone a moment later.
  const query = tx
    .select()
    .from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
  const [row] = held ? await query.for('share') : await query

  return (row as Row | undefined) ?? null
}

function given(value: unknown): boolean {
  return value !== undefined && value !== null
}

/** What a record names below its property, each held where it is checked. */
const placesBelowTheProperty = ['assetId', 'roomId', 'buildingId', 'activityId', 'defectId']

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
 * The top of a structure on its asset, a board on a low-voltage installation
 * (decision 31 of phase 2) and an inverter on a PV installation (#461):
 * property and area come from the asset. An asset of another kind is not one
 * the part can hang on, the same answer as an asset that is gone; a trigger of
 * the database holds it too, for the whole transmission.
 */
function topPlace(
  kind: string,
): (tx: TenantTransaction, values: Record<string, unknown>) => Promise<SyncRefusal | null> {
  return async (tx, values) => {
    const asset = await found<Asset>(tx, assets, values['assetId'])

    if (!asset || asset.kind !== kind) {
      return missing('assetId')
    }

    values['propertyId'] = asset.propertyId
    values['areaId'] = asset.areaId

    return null
  }
}

/** The part above a part of a structure, by the field that names it. */
const partsAbove = {
  distributionBoardId: distributionBoards,
  circuitId: circuits,
  inverterId: inverters,
  pvStringId: pvStrings,
} as const

/**
 * A section or a circuit on its board, a piece of equipment on its circuit,
 * a string on its inverter and a module on its string: asset, property and
 * area come from the part above, so that the whole structure lies where its
 * asset lies (#349, #461). Whether the section a circuit names is one of its
 * board asks the check of the structure afterwards.
 */
function partPlace(
  field: keyof typeof partsAbove,
): (tx: TenantTransaction, values: Record<string, unknown>) => Promise<SyncRefusal | null> {
  return async (tx, values) => {
    const parent = await found<StructurePlace>(tx, partsAbove[field], values[field])

    if (!parent) {
      return missing(field)
    }

    values['assetId'] = parent.assetId
    values['propertyId'] = parent.propertyId
    values['areaId'] = parent.areaId

    return null
  }
}

/**
 * A record that names its place itself, an activity or a defect: the
 * property, and at most one place on it (ADR 0002, point 10). The area comes
 * from that place, or from the property where it names none.
 *
 * The property is held only where the record hangs on it itself. Below it the
 * place is held instead, the asset, room or building here, the activity or
 * defect of a document by its caller: whoever holds only the area of a
 * building reads its property through it and changes nothing there (#306), so
 * held, their property was not found. Every photo of a round in such a
 * building came back as `record_missing` on the property and was gone from
 * the device after the next pull (19.10.2026).
 */
async function targetPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const below = placesBelowTheProperty.some((field) => given(values[field]))
  const property = await found<Property>(tx, properties, values['propertyId'], !below)

  if (!property) {
    return missing('propertyId')
  }

  // The area of what the record hangs on, of the property where it hangs on
  // nothing else (ADR 0003, addendum of #306).
  let areaId = property.areaId

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

    areaId = place.areaId
  }

  values['areaId'] = areaId

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
 * A note on a work order (#118): property and area come from the activity,
 * which is a work order. Whether the order still takes a note is the gate of
 * its policy.
 */
async function notePlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const activity = await found<Activity>(tx, activities, values['activityId'])

  if (!activity || activity.kind !== 'work_order') {
    return missing('activityId')
  }

  values['propertyId'] = activity.propertyId
  values['areaId'] = activity.areaId

  return null
}

/**
 * Material on its work order (#326): property and area come from the order,
 * as for a note. The store and the article are tenant-wide and have to be
 * there: an article no longer kept, or a store, is not taken from any more.
 */
async function materialPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  const refused = await notePlace(tx, values)

  if (refused !== null) {
    return refused
  }

  if (!(await found(tx, stores, values['storeId']))) {
    return missing('storeId')
  }

  return (await found(tx, articles, values['articleId'])) ? null : missing('articleId')
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
 * 0006, point 7), which a person decides. A point for every asset of a kind
 * is a point at each of its assets (#343).
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
  const assetId = values['assetId']
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
        typeof assetId === 'string'
          ? eq(
              activityAnswers.assetId,
              assetId as typeof activityAnswers.$inferSelect.assetId & string,
            )
          : isNull(activityAnswers.assetId),
        isNull(activityAnswers.deletedAt),
      ),
    )

  return answered ? { kind: 'conflict', reason: 'changed_elsewhere', fields: ['fieldKey'] } : null
}

/**
 * A document at its place: the property, and at most one record on it, a
 * building, a room, an asset, an activity or a defect, whose photo it is
 * (#116). The area comes from what it hangs on. Every one of them has to be there
 * for the person asking, so a document cannot be hung on a record of another
 * area or one that is gone. A defect made in the same transmission is there.
 */
async function documentPlace(
  tx: TenantTransaction,
  values: Record<string, unknown>,
): Promise<SyncRefusal | null> {
  // The document of a contractor (#328) lies in no area, as the firm: the
  // firm has to be there, and the rule of the record says it names no place.
  if (given(values['contractorId'])) {
    const firm = await found<{ id: string }>(tx, contractors, values['contractorId'])

    if (!firm) {
      return missing('contractorId')
    }

    values['areaId'] = null

    return null
  }

  // The document of a contract (#329) lies in no area either: the contract
  // has to be there.
  if (given(values['contractId'])) {
    const contract = await found<{ id: string }>(tx, contracts, values['contractId'])

    if (!contract) {
      return missing('contractId')
    }

    values['areaId'] = null

    return null
  }

  const refusal = await targetPlace(tx, values)

  if (refusal) {
    return refusal
  }

  // On an activity or a defect it lies in the area of that record, which is
  // the one of its building where that has one of its own (#306).
  if (given(values['activityId'])) {
    const activity = await found<Activity>(tx, activities, values['activityId'])

    if (!activity || activity.propertyId !== values['propertyId']) {
      return missing('activityId')
    }

    values['areaId'] = activity.areaId

    return null
  }

  if (given(values['defectId'])) {
    const defect = await found<Defect>(tx, defects, values['defectId'])

    if (!defect || defect.propertyId !== values['propertyId']) {
      return missing('defectId')
    }

    values['areaId'] = defect.areaId

    return null
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
  // A board names its building itself, or stands where its asset stands
  // (#495, migration 0100).
  distribution_boards: topPlace(boardAssetKind),
  board_sections: partPlace('distributionBoardId'),
  circuits: partPlace('distributionBoardId'),
  equipment: partPlace('circuitId'),
  inverters: topPlace(inverterAssetKind),
  pv_strings: partPlace('inverterId'),
  pv_modules: partPlace('pvStringId'),
  activities: targetPlace,
  defects: defectPlace,
  work_orders: workOrderPlace,
  work_order_notes: notePlace,
  // Material at a work order hangs on it as a note does (#326).
  work_order_materials: materialPlace,
  activity_signatures: signaturePlace,
  // The client's signature under a service report hangs on its work order
  // as a signature does (#324).
  service_reports: signaturePlace,
  // A briefing and a permit hang on their work order as a signature does (#330).
  briefings: signaturePlace,
  work_permits: signaturePlace,
  activity_answers: answerPlace,
  attachments: documentPlace,
  attachment_versions: versionPlace,
  // A task hangs where a document may, a defect aside, which `offlineEdits`
  // does not let a task name (#124).
  tasks: documentPlace,
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
