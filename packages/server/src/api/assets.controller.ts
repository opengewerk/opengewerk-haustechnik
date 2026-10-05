import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  type Asset,
  type AssetDetails,
  type AssetId,
  assetProblems,
  type AssetRegister,
  type AssetSupply,
  type AssetValue,
  assetValueProblems,
  type Building,
  type BuildingId,
  type Catalogue,
  type DutyReading,
  type LifecycleEntry,
  lifecycleEntryProblems,
  type LifecycleState,
  meterProblems,
  type Room,
  type RoomId,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  requireFields,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { assetsOnADay, dutyTitle } from '../database/duty-standing.js'
import { assignNumber } from '../database/number-ranges.js'
import {
  assetLifecycle,
  assets,
  assetSupplies,
  buildings,
  rooms,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { assetRegister, registerQuestion } from './asset-register.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Diese Anlage gibt es nicht oder nicht mehr.'
const missingBuilding = 'Dieses Gebäude gibt es nicht oder nicht mehr.'
const missingRoom = 'Diesen Raum gibt es nicht oder nicht mehr.'
const missingEntry = 'Diesen Eintrag im Lebenszyklus gibt es nicht oder nicht mehr.'

/** What a body may say about an asset. Moving it and its life cycle are routes of their own. */
const assetFields = [
  'kind',
  'name',
  'mark',
  'manufacturer',
  'model',
  'serialNumber',
  'yearBuilt',
  'commissionedOn',
  'warrantyEndsOn',
  'values',
  'meterNumber',
  'meterUnit',
] as const

/** The fields that may be emptied: an empty text is stored as null. */
const emptiable = [
  'mark',
  'manufacturer',
  'model',
  'serialNumber',
  'commissionedOn',
  'warrantyEndsOn',
  'meterNumber',
  'meterUnit',
] as const

/** The asset kind of a key, as the catalogue knows it today, or a refusal. */
function kindOf(catalogue: Catalogue, key: unknown) {
  const kind = typeof key === 'string' ? catalogue.assetKind(key, dayInGermany()) : null

  if (!kind) {
    throw new BadRequestException(`Die Anlagenart ${String(key)} kennt kein Paket des Katalogs.`)
  }

  return kind.definition
}

/** What a body says about an asset that is to be made, checked against its kind. */
function newAsset(
  catalogue: Catalogue,
  body: unknown,
): Partial<Record<(typeof assetFields)[number], unknown>> {
  const values = fieldsOf(body, assetFields, emptiable)

  refuse(assetProblems({ kind: null, name: null, ...values }))

  const kind = kindOf(catalogue, values.kind)

  refuse(assetValueProblems(kind, values.values ?? {}))
  refuse(meterProblems(kind, values))

  return values
}

/** The room an asset is to stand in, which has to be one of its building. */
async function roomIn(
  tx: TenantTransaction,
  roomId: unknown,
  building: BuildingId,
): Promise<RoomId | null> {
  if (roomId === undefined || roomId === null) {
    return null
  }

  const room = await placeOf<Room>(tx, rooms, String(roomId), missingRoom)

  if (room.buildingId !== building) {
    throw new BadRequestException('Der Raum liegt nicht in diesem Gebäude.')
  }

  return room.id
}

/** Inserts an asset with its number from the sequence of the tenant. */
async function insertAsset(
  tx: TenantTransaction,
  identity: Asking,
  place: Pick<Asset, 'propertyId' | 'areaId' | 'buildingId' | 'roomId' | 'parentAssetId'>,
  values: Partial<Record<(typeof assetFields)[number], unknown>>,
): Promise<Asset> {
  const number = await assignNumber(tx, identity.tenantId, 'asset', new Date())
  const [created] = await tx
    .insert(assets)
    .values({
      tenantId: identity.tenantId,
      ...place,
      kind: values.kind as string,
      number,
      name: values.name as string,
      mark: (values.mark ?? null) as string | null,
      manufacturer: (values.manufacturer ?? null) as string | null,
      model: (values.model ?? null) as string | null,
      serialNumber: (values.serialNumber ?? null) as string | null,
      yearBuilt: (values.yearBuilt ?? null) as number | null,
      commissionedOn: (values.commissionedOn ?? null) as string | null,
      warrantyEndsOn: (values.warrantyEndsOn ?? null) as string | null,
      values: (values.values ?? {}) as Readonly<Record<string, AssetValue>>,
      meterNumber: (values.meterNumber ?? null) as string | null,
      meterUnit: (values.meterUnit ?? null) as Asset['meterUnit'],
    })
    .returning()

  return created as Asset
}

/**
 * The assets of a building, and a new one in it. Beside the routes of the
 * building and not among them, because what an asset needs, the catalogue and
 * the sequence of numbers, is no business of the building.
 */
@Controller('buildings')
export class BuildingAssetsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Get(':id/assets')
  @RequiresPermission('asset.read')
  inBuilding(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Asset[]> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Building>(tx, buildings, id, missingBuilding)

      return tx
        .select()
        .from(assets)
        .where(and(eq(assets.buildingId, id as BuildingId), isNull(assets.deletedAt)))
        .orderBy(asc(assets.number), asc(assets.name)) as Promise<Asset[]>
    })
  }

  /**
   * An asset in the building, on request in one of its rooms. Property and
   * area come from the building, the number from the sequence of the tenant.
   */
  @Post(':id/assets')
  @RequiresPermission('asset.record')
  add(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Asset> {
    const values = newAsset(this.catalogue, body)
    const { roomId } = fieldsOf(body, ['roomId'] as const, ['roomId'] as const)

    return this.database.forTenant(identity, async (tx) => {
      const building = await placeOf<Building>(tx, buildings, id, missingBuilding)

      return insertAsset(
        tx,
        identity,
        {
          propertyId: building.propertyId,
          areaId: building.areaId,
          buildingId: building.id,
          roomId: await roomIn(tx, roomId, building.id),
          parentAssetId: null,
        },
        values,
      )
    })
  }
}

/**
 * Assets and their components (ADR 0002, points 4 to 9), with the rights of
 * section 7 of the concept: taking an asset into the register and completing
 * and correcting what is known about it is "aufnehmen", which whoever works on
 * site may; its life cycle, moving it and removing it have consequences beyond
 * the record and are "pflegen". The kind of an asset is one the catalogue
 * knows on the day it is written, and the values and the meter of the asset
 * fit that kind.
 */
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * The register over every building (section 4.2 of the concept), a page at
   * a time: narrowed by place, cost group, kind, condition and life cycle,
   * each of which the address may name, and two of them give what passes
   * both. Whoever reads assets reads it, in their areas.
   */
  @Get()
  @RequiresPermission('asset.read')
  register(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<AssetRegister> {
    const question = registerQuestion(query)

    return this.database.forTenant(identity, (tx) =>
      assetRegister(tx, this.catalogue, dayInGermany(), question),
    )
  }

  /**
   * The file of an asset: what is known about it, its life cycle whole, so
   * that a decommissioned asset keeps its past, the components under it and
   * the asset it is one of, and its condition today.
   */
  @Get(':id')
  @RequiresPermission('asset.read')
  read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<AssetDetails> {
    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const { lifecycleState, condition, until } = (
        await assetsOnADay(tx, dayInGermany(), [asset.id])
      )(asset.id)
      const components = await tx
        .select({ id: assets.id, number: assets.number, name: assets.name, kind: assets.kind })
        .from(assets)
        .where(and(eq(assets.parentAssetId, asset.id), isNull(assets.deletedAt)))
        .orderBy(asc(assets.number), asc(assets.name))
      const [parent] =
        asset.parentAssetId === null
          ? []
          : await tx
              .select({ id: assets.id, number: assets.number, name: assets.name })
              .from(assets)
              .where(eq(assets.id, asset.parentAssetId))
      const lifecycle = (await tx
        .select()
        .from(assetLifecycle)
        .where(and(eq(assetLifecycle.assetId, asset.id), isNull(assetLifecycle.deletedAt)))
        .orderBy(asc(assetLifecycle.validFrom))) as LifecycleEntry[]
      const supplies = (await tx
        .select()
        .from(assetSupplies)
        .where(and(eq(assetSupplies.assetId, asset.id), isNull(assetSupplies.deletedAt)))
        .orderBy(asc(assetSupplies.createdAt))) as AssetSupply[]

      return {
        ...asset,
        lifecycle,
        lifecycleState,
        condition,
        until,
        supplies,
        components: components as AssetDetails['components'],
        parent: (parent ?? null) as AssetDetails['parent'],
      }
    })
  }

  /**
   * The duties of the asset that have not ended, each with how it stands
   * today (ADR 0002, point 16): resting while the asset is not in service,
   * whatever its appointment says. Reading them is reading duties, so the
   * right is that of the register of duties and not that of the assets.
   */
  @Get(':id/duties')
  @RequiresPermission('duty.read')
  duties(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<DutyReading[]> {
    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const today = (await assetsOnADay(tx, dayInGermany(), [asset.id]))(asset.id)

      return today.duties
        .map(({ duty, standing, lastMetOn }): DutyReading => ({
          id: duty.id,
          kind: duty.kind,
          kindVersion: duty.kindVersion,
          label: duty.label,
          basis: duty.basis,
          sourceNote: duty.sourceNote,
          counting: duty.counting,
          intervalDays: duty.intervalDays,
          intervalMonths: duty.intervalMonths,
          endsOn: duty.endsOn,
          title: dutyTitle(duty, this.catalogue),
          state: standing.state,
          appointment: standing.appointment,
          lastMetOn,
        }))
        .sort((left, right) => left.title.localeCompare(right.title, 'de'))
    })
  }

  /**
   * What is known about the asset, its kind included: correcting a kind
   * captured wrong on site is part of taking stock. Values and meter are
   * asked of the asset as it will be, against the kind it will have; the
   * values are replaced as a whole.
   */
  @Patch(':id')
  @RequiresPermission('asset.record')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Asset> {
    const values = fieldsOf(body, assetFields, emptiable)

    requireSomething(values)
    refuse(assetProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const after = { ...asset, ...values }
      const kind = kindOf(this.catalogue, after.kind)

      refuse(assetValueProblems(kind, after.values))
      refuse(meterProblems(kind, after))

      const [changed] = await tx
        .update(assets)
        .set(values as Partial<Asset>)
        .where(and(eq(assets.id, asset.id), isNull(assets.deletedAt)))
        .returning()

      return changed as Asset
    })
  }

  /** A component under the asset, in its building and on request in one of its rooms. */
  @Post(':id/components')
  @RequiresPermission('asset.record')
  addComponent(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Asset> {
    const values = newAsset(this.catalogue, body)
    const { roomId } = fieldsOf(body, ['roomId'] as const, ['roomId'] as const)

    return this.database.forTenant(identity, async (tx) => {
      const parent = await placeOf<Asset>(tx, assets, id, missing)

      return insertAsset(
        tx,
        identity,
        {
          propertyId: parent.propertyId,
          areaId: parent.areaId,
          buildingId: parent.buildingId,
          roomId: await roomIn(tx, roomId, parent.buildingId),
          parentAssetId: parent.id,
        },
        values,
      )
    })
  }

  /**
   * Moves the asset to another building of its property, or to another room.
   * Its components move with it, and leave their rooms behind: those stand in
   * the building the asset left. A component moves with its asset and on its
   * own only to another room.
   */
  @Put(':id/location')
  @RequiresPermission('asset.write')
  move(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Asset> {
    const values = fieldsOf(body, ['buildingId', 'roomId'] as const, ['roomId'] as const)

    requireFields(values, ['buildingId'])

    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const building = await placeOf<Building>(
        tx,
        buildings,
        String(values.buildingId),
        missingBuilding,
      )

      if (building.propertyId !== asset.propertyId) {
        throw new BadRequestException(
          'Eine Anlage bleibt auf ihrer Liegenschaft; an einem anderen Ort ist sie eine neue Anlage.',
        )
      }

      if (asset.parentAssetId !== null && building.id !== asset.buildingId) {
        throw new BadRequestException(
          'Eine Komponente steht im Gebäude ihrer Anlage und zieht mit ihr um.',
        )
      }

      const roomId = await roomIn(tx, values.roomId, building.id)

      if (building.id !== asset.buildingId) {
        // The rooms of the components first: they lie in the building the
        // asset leaves, and the key over a room would refuse the cascade.
        await tx.execute(sql`
          with recursive below (id) as (
            select id from assets where tenant_id = ${identity.tenantId} and parent_asset_id = ${asset.id}
            union
            select assets.id from assets join below on assets.parent_asset_id = below.id
             where assets.tenant_id = ${identity.tenantId}
          )
          update assets set room_id = null
           where tenant_id = ${identity.tenantId} and id in (select id from below) and room_id is not null`)
      }

      const [moved] = await tx
        .update(assets)
        .set({ buildingId: building.id, roomId })
        .where(and(eq(assets.id, asset.id), isNull(assets.deletedAt)))
        .returning()

      return moved as Asset
    })
  }

  /**
   * Puts the asset under another asset of its building, or under none. That
   * it never ends up under itself, the database decides, however long the
   * chain.
   */
  @Put(':id/parent')
  @RequiresPermission('asset.write')
  hang(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Asset> {
    const values = fieldsOf(body, ['parentAssetId'] as const, ['parentAssetId'] as const)

    requireFields(values, ['parentAssetId'])

    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const parentId = values.parentAssetId === null ? null : String(values.parentAssetId)

      if (parentId !== null) {
        const parent = await placeOf<Asset>(tx, assets, parentId, missing)

        if (parent.buildingId !== asset.buildingId) {
          throw new BadRequestException('Eine Komponente steht im Gebäude ihrer Anlage.')
        }
      }

      const [hung] = await tx
        .update(assets)
        .set({ parentAssetId: parentId as AssetId | null })
        .where(and(eq(assets.id, asset.id), isNull(assets.deletedAt)))
        .returning()

      return hung as Asset
    })
  }

  /** Marks the asset deleted, and with it its components, its life cycle and its supplies. */
  @Delete(':id')
  @RequiresPermission('asset.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Asset> {
    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const [removed] = await tx
        .update(assets)
        .set({ deletedAt: new Date() })
        .where(and(eq(assets.id, asset.id), isNull(assets.deletedAt)))
        .returning()

      return removed as Asset
    })
  }

  /** The state of the asset from a day on, one a day (ADR 0002, point 7). */
  @Post(':id/lifecycle')
  @RequiresPermission('asset.write')
  addLifecycleEntry(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<LifecycleEntry> {
    const values = fieldsOf(body, ['state', 'validFrom'] as const)

    refuse(lifecycleEntryProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const [taken] = await tx
        .select({ id: assetLifecycle.id })
        .from(assetLifecycle)
        .where(
          and(
            eq(assetLifecycle.assetId, asset.id),
            eq(assetLifecycle.validFrom, values.validFrom as string),
            isNull(assetLifecycle.deletedAt),
          ),
        )

      if (taken) {
        throw new ConflictException(
          'An diesem Tag hat die Anlage schon einen Zustand; auf einen Tag kommt einer.',
        )
      }

      const [created] = await tx
        .insert(assetLifecycle)
        .values({
          tenantId: identity.tenantId,
          assetId: asset.id,
          propertyId: asset.propertyId,
          areaId: asset.areaId,
          state: values.state as LifecycleState,
          validFrom: values.validFrom as string,
        })
        .returning()

      return created as LifecycleEntry
    })
  }

  /** Marks an entry of the life cycle deleted, one entered on the wrong day for instance. */
  @Delete(':id/lifecycle/:entryId')
  @RequiresPermission('asset.write')
  removeLifecycleEntry(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ): Promise<LifecycleEntry> {
    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)
      const entry = await placeOf<LifecycleEntry>(tx, assetLifecycle, entryId, missingEntry)

      if (entry.assetId !== asset.id) {
        throw new BadRequestException(missingEntry)
      }

      const [removed] = await tx
        .update(assetLifecycle)
        .set({ deletedAt: new Date() })
        .where(and(eq(assetLifecycle.id, entry.id), isNull(assetLifecycle.deletedAt)))
        .returning()

      return removed as LifecycleEntry
    })
  }

  /**
   * The buildings and rooms the asset supplies, as a whole list: what is no
   * longer in it is marked, what is new is added. Only places of its property.
   */
  @Put(':id/supplies')
  @RequiresPermission('asset.record')
  supply(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AssetSupply[]> {
    const values = fieldsOf(body, ['buildingIds', 'roomIds'] as const)
    const ids = (value: unknown): readonly string[] => {
      if (value === undefined) {
        return []
      }

      if (
        !Array.isArray(value) ||
        !value.every((each) => typeof each === 'string' && isUuid(each))
      ) {
        throw new BadRequestException('Versorgte Orte stehen als Liste von Kennungen.')
      }

      return [...new Set(value as readonly string[])]
    }
    const buildingIds = ids(values.buildingIds)
    const roomIds = ids(values.roomIds)

    return this.database.forTenant(identity, async (tx) => {
      const asset = await placeOf<Asset>(tx, assets, id, missing)

      for (const buildingId of buildingIds) {
        const building = await placeOf<Building>(tx, buildings, buildingId, missingBuilding)

        if (building.propertyId !== asset.propertyId) {
          throw new BadRequestException('Eine Anlage versorgt nur Orte ihrer Liegenschaft.')
        }
      }

      for (const roomId of roomIds) {
        const room = await placeOf<Room>(tx, rooms, roomId, missingRoom)

        if (room.propertyId !== asset.propertyId) {
          throw new BadRequestException('Eine Anlage versorgt nur Orte ihrer Liegenschaft.')
        }
      }

      const current = (await tx
        .select()
        .from(assetSupplies)
        .where(
          and(eq(assetSupplies.assetId, asset.id), isNull(assetSupplies.deletedAt)),
        )) as AssetSupply[]
      const kept = current.filter(
        (supply) =>
          (supply.buildingId !== null && buildingIds.includes(supply.buildingId)) ||
          (supply.roomId !== null && roomIds.includes(supply.roomId)),
      )
      const gone = current.filter((supply) => !kept.includes(supply))

      if (gone.length > 0) {
        await tx
          .update(assetSupplies)
          .set({ deletedAt: new Date() })
          .where(
            inArray(
              assetSupplies.id,
              gone.map((supply) => supply.id),
            ),
          )
      }

      const added = [
        ...buildingIds
          .filter((buildingId) => !kept.some((supply) => supply.buildingId === buildingId))
          .map((buildingId) => ({ buildingId: buildingId as BuildingId, roomId: null })),
        ...roomIds
          .filter((roomId) => !kept.some((supply) => supply.roomId === roomId))
          .map((roomId) => ({ buildingId: null, roomId: roomId as RoomId })),
      ]

      if (added.length > 0) {
        await tx.insert(assetSupplies).values(
          added.map((place) => ({
            tenantId: identity.tenantId,
            assetId: asset.id,
            propertyId: asset.propertyId,
            areaId: asset.areaId,
            ...place,
          })),
        )
      }

      return tx
        .select()
        .from(assetSupplies)
        .where(and(eq(assetSupplies.assetId, asset.id), isNull(assetSupplies.deletedAt)))
        .orderBy(asc(assetSupplies.createdAt)) as Promise<AssetSupply[]>
    })
  }
}
