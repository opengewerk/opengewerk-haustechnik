import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common'
import {
  type AreaId,
  type Building,
  type BuildingId,
  buildingProblems,
  byNameIn,
  type Floor,
  floorProblems,
  type Property,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  requireFields,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { buildings, floors, properties } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { crossingRefusal, keptAsWritten, keptSentence } from './building-moves.js'
import { type Asking, buildingAreaFor, fieldsOf, holdsTheArea, placeOf, refuse } from './places.js'

const missing = 'Dieses Gebäude gibt es nicht oder nicht mehr.'

const buildingFields = ['name', 'shortCode', 'kinds', 'yearBuilt'] as const
const floorFields = ['name', 'level'] as const

/**
 * A building and its floors. A building moves to another property with
 * everything in it (#307), by a route of its own.
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

  /**
   * Moves the building to another property of the tenant, with everything in
   * it (#307, section 4.1 of the concept, ADR 0002, addendum of 15.10.2026).
   * The keys onto what a row hangs on follow the building in this one
   * statement; a key that names something a row does not hang on fails where
   * it crosses the building, and the sentence says which. What is written once
   * and names its place keeps the building where it is, asked before anything
   * changes. In its new place the building has the area of the property,
   * unless it has one of its own, and one that is the area of the new property
   * counts as none (#306).
   */
  @Put(':id/property')
  @RequiresPermission('location.write')
  move(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Building> {
    const values = fieldsOf(body, ['propertyId'] as const)

    requireFields(values, ['propertyId'])

    return this.database.forTenant(identity, async (tx) => {
      const building = await placeOf<Building>(tx, buildings, id, missing)
      const property = await placeOf<Property>(
        tx,
        properties,
        String(values.propertyId),
        'Diese Liegenschaft gibt es nicht oder nicht mehr.',
      )

      if (property.id === building.propertyId) {
        throw new BadRequestException('Das Gebäude steht schon auf dieser Liegenschaft.')
      }

      // The database refuses it as well (`buildings_on_a_property_in_reach`);
      // this says why.
      if (!(await holdsTheArea(tx, property.areaId))) {
        throw new ForbiddenException('In eine Liegenschaft verlegt nur, wer ihren Bereich hat.')
      }

      // The duties of its assets follow the law of their federal state (ADR
      // 0002): in another one they would be other duties.
      const now = await placeOf<Property>(tx, properties, building.propertyId, missing)

      if (now.federalState !== property.federalState) {
        throw new BadRequestException(
          'Die neue Liegenschaft liegt in einem anderen Bundesland, und dort gelten für die Anlagen andere Pflichten. Das Gebäude bleibt deshalb, wo es ist.',
        )
      }

      const kept = await keptAsWritten(tx, identity.tenantId, building.id)

      if (kept.length > 0) {
        throw new BadRequestException(keptSentence(kept))
      }

      const own = building.ownAreaId === property.areaId ? null : building.ownAreaId
      const [moved] = await tx
        .update(buildings)
        .set({ propertyId: property.id, ownAreaId: own, areaId: own ?? property.areaId })
        .where(and(eq(buildings.id, building.id), isNull(buildings.deletedAt)))
        .returning()
        .catch((error: unknown) => {
          const sentence = crossingRefusal(error)

          throw sentence === null ? error : new BadRequestException(sentence)
        })

      return moved as Building
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

      const found = (await tx
        .select()
        .from(floors)
        .where(and(eq(floors.buildingId, id as BuildingId), isNull(floors.deletedAt)))) as Floor[]

      // From the lowest level up, two on one level by name as a list reads
      // them, a number in it by its value (#322).
      return found.sort(
        (left, right) => left.level - right.level || byNameIn(left.name, right.name),
      )
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
