import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import {
  activityClosable,
  type Asset,
  type AssetId,
  type Duty,
  exchangeReason,
  exchangeRefusal,
  exchangeRefusals,
  type ExchangeStanding,
  intervalDocumentProblem,
  isAllowed,
  type IsoDate,
  missingRight,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm'

import { closeAsNotPerformed } from '../activities/closing.js'
import type { Asking } from '../api/places.js'
import {
  activities,
  assetLifecycle,
  assets,
  assetSupplies,
  attachments,
  buildings,
  defects,
  duties,
} from '../database/schema/index.js'

/**
 * The exchange of an asset (section 4.2 of the concept, #89), in the
 * transaction of whoever asks: the old asset is removed from the day on, the
 * new one stands where it stood and supplies what it supplied, and what was
 * open at the old one ends with it. Nothing that was recorded at the old
 * asset is touched; an evidence could not be, whoever asked.
 */

/** The duties of an asset that have not ended by a day. */
const dutiesStanding = (asset: AssetId, on: IsoDate) =>
  and(
    eq(duties.assetId, asset),
    isNull(duties.deletedAt),
    or(isNull(duties.endsOn), gt(duties.endsOn, on)),
  )

/** The defects at an asset nobody set right yet: found or ordered. */
const defectsAwaiting = (asset: AssetId) =>
  and(
    eq(defects.assetId, asset),
    isNull(defects.deletedAt),
    inArray(defects.status, ['found', 'ordered']),
  )

/** The activities at an asset that are open or begun. */
const activitiesOpen = (asset: AssetId) =>
  and(
    eq(activities.assetId, asset),
    isNull(activities.deletedAt),
    inArray(activities.status, [...activityClosable]),
  )

/**
 * What an exchange would end at an asset today, for the dialog that asks
 * before it does. The numbers are for whoever may exchange it; what each is
 * called is read under the right that reads it elsewhere, duties, defects and
 * the work that is planned, and left out for anybody without it.
 */
export async function exchangeStanding(
  tx: TenantTransaction,
  identity: Asking,
  asset: Pick<Asset, 'id'>,
  today: IsoDate,
): Promise<ExchangeStanding> {
  const standing = await tx
    .select({
      id: duties.id,
      kind: duties.kind,
      label: duties.label,
      intervalDays: duties.intervalDays,
      intervalMonths: duties.intervalMonths,
    })
    .from(duties)
    .where(dutiesStanding(asset.id, today))
    .orderBy(asc(duties.label))
  const awaiting = await tx
    .select({ id: defects.id, description: defects.description, status: defects.status })
    .from(defects)
    .where(defectsAwaiting(asset.id))
    .orderBy(asc(defects.foundOn), asc(defects.id))
  const open = await tx
    .select({
      id: activities.id,
      kind: activities.kind,
      title: activities.title,
      status: activities.status,
    })
    .from(activities)
    .where(activitiesOpen(asset.id))
    .orderBy(asc(activities.dueOn), asc(activities.id))

  return {
    duties: standing.length,
    ownDuties: isAllowed(identity, 'duty.read')
      ? standing.flatMap(({ kind, ...duty }) => (kind === null ? [duty] : []))
      : [],
    defects: awaiting.length,
    openDefects: isAllowed(identity, 'defect.read') ? awaiting : [],
    activities: open.length,
    // Whoever only performs work is shown what was given to them; the whole
    // of it is for whoever plans it.
    openActivities: isAllowed(identity, 'activity.write') ? open : [],
  }
}

/** What an exchange is asked with, checked by the route: the day, and what goes along. */
export interface Exchange {
  readonly on: IsoDate
  /** The components of the old asset that hang under the new one afterwards. */
  readonly components: readonly string[]
  /** The duties of the operator's own at the old asset that the new one takes over. */
  readonly duties: readonly string[]
}

/** Where the new asset stands, and what it takes the place of. */
export type ExchangePlace = Pick<
  Asset,
  'propertyId' | 'areaId' | 'buildingId' | 'roomId' | 'parentAssetId'
> & { readonly replacesAssetId: AssetId }

/**
 * Exchanges an asset. `make` writes the row of the new one where it is told
 * to, as the route that enters an asset does, with its number.
 *
 * One transaction, the caller's: when any part is refused, nothing of it
 * stands. The new asset is made first, since the reason every ending carries
 * names it.
 */
export async function exchangeAsset(
  tx: TenantTransaction,
  identity: Asking,
  old: Asset,
  exchange: Exchange,
  make: (place: ExchangePlace) => Promise<Asset>,
): Promise<Asset> {
  // Two exchanges of one asset wait for each other at its row, and the
  // second reads what the first did.
  await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, old.id)).for('no key update')

  const lifecycle = await tx
    .select({ state: assetLifecycle.state, validFrom: assetLifecycle.validFrom })
    .from(assetLifecycle)
    .where(and(eq(assetLifecycle.assetId, old.id), isNull(assetLifecycle.deletedAt)))
  const [successor] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.replacesAssetId, old.id), isNull(assets.deletedAt)))
  const refusal = exchangeRefusal(
    // A measuring point is an asset with a meter number, whatever the
    // catalogue says of its kind today.
    { lifecycle, meter: old.meterNumber !== null, replaced: successor !== undefined },
    exchange.on,
  )

  if (refusal !== null) {
    throw refusal === exchangeRefusals.meter
      ? new BadRequestException(refusal)
      : new ConflictException(refusal)
  }

  const place = { tenantId: identity.tenantId, propertyId: old.propertyId, areaId: old.areaId }
  const made = await make({
    propertyId: old.propertyId,
    areaId: old.areaId,
    buildingId: old.buildingId,
    roomId: old.roomId,
    parentAssetId: old.parentAssetId,
    replacesAssetId: old.id,
  })
  const reason = exchangeReason(made.number ?? made.name)

  await tx.insert(assetLifecycle).values([
    { ...place, assetId: old.id, state: 'removed', validFrom: exchange.on },
    { ...place, assetId: made.id, state: 'in_service', validFrom: exchange.on },
  ])

  // What the old asset supplied, the new one supplies. The old one keeps its
  // rows: they say what it supplied while it stood.
  const supplied = await tx
    .select({ buildingId: assetSupplies.buildingId, roomId: assetSupplies.roomId })
    .from(assetSupplies)
    .where(and(eq(assetSupplies.assetId, old.id), isNull(assetSupplies.deletedAt)))

  if (supplied.length > 0) {
    await tx
      .insert(assetSupplies)
      .values(supplied.map((each) => ({ ...place, assetId: made.id, ...each })))
  }

  if (exchange.components.length > 0) {
    // As hanging an asset under another does (#78): every change of what
    // hangs under what in a building waits at the row of the building.
    await tx
      .select({ id: buildings.id })
      .from(buildings)
      .where(eq(buildings.id, old.buildingId))
      .for('no key update')

    const moved = await tx
      .update(assets)
      .set({ parentAssetId: made.id })
      .where(
        and(
          inArray(assets.id, exchange.components as AssetId[]),
          eq(assets.parentAssetId, old.id),
          isNull(assets.deletedAt),
        ),
      )
      .returning({ id: assets.id })

    if (moved.length !== exchange.components.length) {
      throw new BadRequestException(
        'Mitgenommen wird eine Komponente der Anlage, die getauscht wird.',
      )
    }
  }

  const standing = (await tx
    .select()
    .from(duties)
    .where(dutiesStanding(old.id, exchange.on))) as Duty[]
  const taken = exchange.duties.map((id) =>
    standing.find((duty) => duty.id === id && duty.kind === null),
  )

  if (taken.some((duty) => duty === undefined)) {
    throw new BadRequestException(
      'Übernommen wird eine eigene Pflicht der Anlage, die getauscht wird, solange sie nicht geendet hat.',
    )
  }

  if (taken.length > 0 && !isAllowed(identity, 'duty.write')) {
    throw new ForbiddenException(missingRight('duty.write'))
  }

  if (standing.length > 0) {
    await tx
      .update(duties)
      .set({ endsOn: exchange.on, endReason: reason })
      .where(
        inArray(
          duties.id,
          standing.map((duty) => duty.id),
        ),
      )
  }

  await takeOver(tx, identity, made, taken as readonly Duty[])

  const open = await tx.select({ id: activities.id }).from(activities).where(activitiesOpen(old.id))

  for (const activity of open) {
    // One somebody signed meanwhile waits for what its signature makes.
    await closeAsNotPerformed(tx, activity.id, reason)
  }

  // "Behoben", and not the end: checking a defect again stays a step of its
  // own (section 4.6), and it is the one that notices a defect the exchange
  // did not take away. A defect whose work order was just closed is among
  // them: found or ordered, it was not set right before the exchange.
  await tx.update(defects).set({ status: 'remedied' }).where(defectsAwaiting(old.id))

  return made
}

/**
 * The duties of the operator's own the new asset takes over from the old one:
 * each a new duty at the new asset that says what the old one said, confirmed
 * now by whoever exchanges. Its past stays with the old duty, so the new one
 * was never recorded and asks for a first time.
 *
 * Two things a duty names may not come along. Whoever answered for the old
 * one answers for the new one as long as they work here. And the document
 * that bears its interval is kept where it bears the interval of the new duty
 * too, at the room, the building or the property; one filed at the old asset
 * stays with it.
 */
async function takeOver(
  tx: TenantTransaction,
  identity: Asking,
  made: Asset,
  taken: readonly Duty[],
): Promise<void> {
  if (taken.length === 0) {
    return
  }

  const ids = <Value>(values: readonly (Value | null)[]) => [
    ...new Set(values.filter((value): value is Value => value !== null)),
  ]
  const responsible = ids(taken.map((duty) => duty.responsibleUserId))
  const working = new Set(
    responsible.length === 0
      ? []
      : (
          await tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(and(inArray(memberships.userId, responsible), isNull(memberships.blockedAt)))
        ).map((row) => row.userId),
  )
  const documentIds = ids(taken.map((duty) => duty.intervalDocumentId))
  const documents =
    documentIds.length === 0
      ? []
      : await tx.select().from(attachments).where(inArray(attachments.id, documentIds))
  const chain = {
    propertyId: made.propertyId,
    buildingId: made.buildingId,
    roomId: made.roomId,
    assetId: made.id,
  }
  const bears = (duty: Duty) => {
    const document = documents.find((each) => each.id === duty.intervalDocumentId)

    return (
      document !== undefined &&
      document.deletedAt === null &&
      intervalDocumentProblem(document, chain) === null
    )
  }

  await tx.insert(duties).values(
    taken.map((duty) => ({
      tenantId: identity.tenantId,
      propertyId: made.propertyId,
      areaId: made.areaId,
      assetId: made.id,
      kind: null,
      kindVersion: null,
      label: duty.label,
      basis: duty.basis,
      sourceNote: duty.sourceNote,
      task: duty.task,
      counting: duty.counting,
      intervalDays: duty.intervalDays,
      intervalMonths: duty.intervalMonths,
      intervalReason: duty.intervalReason,
      intervalDocumentId: bears(duty) ? duty.intervalDocumentId : null,
      intervalDocumentVersionId: bears(duty) ? duty.intervalDocumentVersionId : null,
      responsibleUserId:
        duty.responsibleUserId !== null && working.has(duty.responsibleUserId)
          ? duty.responsibleUserId
          : null,
      performer: duty.performer,
      performerNote: duty.performerNote,
      confirmedBy: identity.userId,
    })),
  )
}
