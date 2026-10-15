import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  type AreaId,
  type Building,
  type BuildingId,
  buildingProblems,
  type Floor,
  floorProblems,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { buildings, floors, properties } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, buildingAreaFor, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Dieses Gebäude gibt es nicht oder nicht mehr.'

const buildingFields = ['name', 'shortCode', 'kinds', 'yearBuilt'] as const
const floorFields = ['name', 'level'] as const

/**
 * A building and its floors. A building stays on its property: moving one to
 * another property is not something the concept knows, and every floor and
 * room below it would have to move along.
 *
 * Its area is the one of its property until it is given one of its own
 * (`ownAreaId`, section 2.8 of the concept); everything in it follows that
 * area by the keys of the database (ADR 0003, addendum of #306). Emptying
 * `ownAreaId`, or naming the area of the property, gives it the area of its
 * property again.
 */
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly database: Database) {}

  @Get(':id')
  @RequiresPermission('location.read')
  read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Building> {
    return this.database.forTenant(identity, (tx) => placeOf<Building>(tx, buildings, id, missing))
  }

  @Patch(':id')
  @RequiresPermission('location.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Building> {
    const values = fieldsOf(body, [...buildingFields, 'ownAreaId'] as const, [
      'shortCode',
      'ownAreaId',
    ])
    const { ownAreaId: named, ...rest } = values

    requireSomething(values)
    refuse(buildingProblems(rest))

    return this.database.forTenant(identity, async (tx) => {
      const building = await placeOf<Building>(tx, buildings, id, missing)
      const area =
        named === undefined
          ? {}
          : await buildingAreaFor(tx, named, await areaOfProperty(tx, building.propertyId))

      const [changed] = await tx
        .update(buildings)
        .set({ ...(rest as Partial<Building>), ...area })
        .where(and(eq(buildings.id, id as BuildingId), isNull(buildings.deletedAt)))
        .returning()

      return changed as Building
    })
  }

  /** Marks the building deleted, and with it every floor and room in it. */
  @Delete(':id')
  @RequiresPermission('location.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Building> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Building>(tx, buildings, id, missing)

      const [removed] = await tx
        .update(buildings)
        .set({ deletedAt: new Date() })
        .where(and(eq(buildings.id, id as BuildingId), isNull(buildings.deletedAt)))
        .returning()

      return removed as Building
    })
  }

  @Get(':id/floors')
  @RequiresPermission('location.read')
  floorsOf(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Floor[]> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Building>(tx, buildings, id, missing)

      return tx
        .select()
        .from(floors)
        .where(and(eq(floors.buildingId, id as BuildingId), isNull(floors.deletedAt)))
        .orderBy(asc(floors.level), asc(floors.name)) as Promise<Floor[]>
    })
  }

  /** A floor of the building. Building, property and area come from the building. */
  @Post(':id/floors')
  @RequiresPermission('location.write')
  addFloor(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Floor> {
    const values = fieldsOf(body, floorFields)

    refuse(floorProblems({ name: null, level: null, ...values }))

    return this.database.forTenant(identity, async (tx) => {
      const building = await placeOf<Building>(tx, buildings, id, missing)
      const [created] = await tx
        .insert(floors)
        .values({
          tenantId: identity.tenantId,
          buildingId: building.id,
          propertyId: building.propertyId,
          areaId: building.areaId,
          name: values.name as string,
          level: values.level as number,
        })
        .returning()

      return created as Floor
    })
  }
}

/** The area of the property a building stands on, which the person sees with the building. */
async function areaOfProperty(
  tx: TenantTransaction,
  propertyId: Building['propertyId'],
): Promise<AreaId> {
  const [property] = await tx
    .select({ areaId: properties.areaId })
    .from(properties)
    .where(eq(properties.id, propertyId))

  if (property === undefined) {
    throw new NotFoundException('Diese Liegenschaft gibt es nicht oder nicht mehr.')
  }

  return property.areaId
}
