import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  type Building,
  buildingProblems,
  type Property,
  type PropertyId,
  propertyProblems,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, requireSomething } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { buildings, properties } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { areaFor, type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Diese Liegenschaft gibt es nicht oder nicht mehr.'

const propertyFields = [
  'name',
  'street',
  'postalCode',
  'city',
  'federalState',
  'areaId',
  'note',
] as const
const buildingFields = ['name', 'shortCode', 'kinds', 'yearBuilt'] as const

/**
 * The properties of a tenant and the buildings on them (section 2.2 of the
 * concept). Reading is for everybody who sees places; the structure is kept
 * by those who see every area (section 7). Which properties a person sees at
 * all, the database decides by their areas (ADR 0003): a route that asks for
 * all of them gets those of the areas of the person.
 */
@Controller('properties')
export class PropertiesController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('location.read')
  list(@CurrentIdentity() identity: Asking): Promise<Property[]> {
    return this.database.forTenant(
      identity,
      (tx) =>
        tx
          .select()
          .from(properties)
          .where(isNull(properties.deletedAt))
          .orderBy(asc(properties.name)) as Promise<Property[]>,
    )
  }

  @Post()
  @RequiresPermission('location.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Property> {
    const values = fieldsOf(body, propertyFields, ['note'])

    refuse(
      propertyProblems({
        name: null,
        street: null,
        postalCode: null,
        city: null,
        federalState: null,
        ...values,
      }),
    )

    return this.database.forTenant(identity, async (tx) => {
      const areaId = await areaFor(tx, values.areaId)
      const [created] = await tx
        .insert(properties)
        .values({
          tenantId: identity.tenantId,
          areaId,
          name: values.name as string,
          street: values.street as string,
          postalCode: values.postalCode as string,
          city: values.city as string,
          federalState: values.federalState as Property['federalState'],
          note: (values.note ?? null) as string | null,
        })
        .returning()

      return created as Property
    })
  }

  @Get(':id')
  @RequiresPermission('location.read')
  read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Property> {
    return this.database.forTenant(identity, (tx) => placeOf<Property>(tx, properties, id, missing))
  }

  /**
   * A change of the property, its area included. Moving it to another area
   * takes every row below it along, in the same statement (ADR 0003): the key
   * of each of them follows the area of the property.
   */
  @Patch(':id')
  @RequiresPermission('location.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Property> {
    const values = fieldsOf(body, propertyFields, ['note'])

    requireSomething(values)
    refuse(propertyProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Property>(tx, properties, id, missing)

      const { areaId: named, ...rest } = values

      if (named === null) {
        throw new BadRequestException('Der Bereich fehlt.')
      }

      const areaId = named === undefined ? undefined : await areaFor(tx, named)
      const [changed] = await tx
        .update(properties)
        .set({ ...(rest as Partial<Property>), ...(areaId === undefined ? {} : { areaId }) })
        .where(and(eq(properties.id, id as PropertyId), isNull(properties.deletedAt)))
        .returning()

      return changed as Property
    })
  }

  /** Marks the property deleted, and with it every building, floor and room on it. */
  @Delete(':id')
  @RequiresPermission('location.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Property> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Property>(tx, properties, id, missing)

      const [removed] = await tx
        .update(properties)
        .set({ deletedAt: new Date() })
        .where(and(eq(properties.id, id as PropertyId), isNull(properties.deletedAt)))
        .returning()

      return removed as Property
    })
  }

  @Get(':id/buildings')
  @RequiresPermission('location.read')
  buildingsOf(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Building[]> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Property>(tx, properties, id, missing)

      return tx
        .select()
        .from(buildings)
        .where(and(eq(buildings.propertyId, id as PropertyId), isNull(buildings.deletedAt)))
        .orderBy(asc(buildings.name)) as Promise<Building[]>
    })
  }

  /** A building on the property. Property and area come from the property, never from the body. */
  @Post(':id/buildings')
  @RequiresPermission('location.write')
  addBuilding(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Building> {
    const values = fieldsOf(body, buildingFields, ['shortCode'])

    refuse(buildingProblems({ name: null, kinds: null, ...values }))

    return this.database.forTenant(identity, async (tx) => {
      const property = await placeOf<Property>(tx, properties, id, missing)
      const [created] = await tx
        .insert(buildings)
        .values({
          tenantId: identity.tenantId,
          propertyId: property.id,
          areaId: property.areaId,
          name: values.name as string,
          shortCode: (values.shortCode ?? null) as string | null,
          kinds: values.kinds as Building['kinds'],
          yearBuilt: (values.yearBuilt ?? null) as number | null,
        })
        .returning()

      return created as Building
    })
  }
}
