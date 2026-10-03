import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import {
  type Floor,
  type FloorId,
  floorProblems,
  type Room,
  roomProblems,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, requireSomething } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { floors, rooms } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Dieses Geschoss gibt es nicht oder nicht mehr.'

const floorFields = ['name', 'level'] as const
const roomFields = ['number', 'name', 'use'] as const

/**
 * A floor and its rooms. Bringing a room into being is "aufnehmen" (section 7
 * of the concept): whoever stands in a room nobody has entered yet records
 * it, without being able to rearrange the property.
 */
@Controller('floors')
export class FloorsController {
  constructor(private readonly database: Database) {}

  @Get(':id')
  @RequiresPermission('location.read')
  read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Floor> {
    return this.database.forTenant(identity, (tx) => placeOf<Floor>(tx, floors, id, missing))
  }

  @Patch(':id')
  @RequiresPermission('location.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Floor> {
    const values = fieldsOf(body, floorFields)

    requireSomething(values)
    refuse(floorProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Floor>(tx, floors, id, missing)

      const [changed] = await tx
        .update(floors)
        .set(values as Partial<Floor>)
        .where(and(eq(floors.id, id as FloorId), isNull(floors.deletedAt)))
        .returning()

      return changed as Floor
    })
  }

  /** Marks the floor deleted, and with it every room on it. */
  @Delete(':id')
  @RequiresPermission('location.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Floor> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Floor>(tx, floors, id, missing)

      const [removed] = await tx
        .update(floors)
        .set({ deletedAt: new Date() })
        .where(and(eq(floors.id, id as FloorId), isNull(floors.deletedAt)))
        .returning()

      return removed as Floor
    })
  }

  @Get(':id/rooms')
  @RequiresPermission('location.read')
  roomsOf(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Room[]> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Floor>(tx, floors, id, missing)

      return tx
        .select()
        .from(rooms)
        .where(and(eq(rooms.floorId, id as FloorId), isNull(rooms.deletedAt)))
        .orderBy(asc(rooms.number), asc(rooms.name)) as Promise<Room[]>
    })
  }

  /** A room on the floor. Floor, building, property and area come from the floor. */
  @Post(':id/rooms')
  @RequiresPermission('room.record')
  addRoom(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Room> {
    const values = fieldsOf(body, roomFields, roomFields)

    refuse(roomProblems({ number: null, name: null, use: null, ...values }))

    return this.database.forTenant(identity, async (tx) => {
      const floor = await placeOf<Floor>(tx, floors, id, missing)
      const [created] = await tx
        .insert(rooms)
        .values({
          tenantId: identity.tenantId,
          floorId: floor.id,
          buildingId: floor.buildingId,
          propertyId: floor.propertyId,
          areaId: floor.areaId,
          number: (values.number ?? null) as string | null,
          name: (values.name ?? null) as string | null,
          use: (values.use ?? null) as string | null,
        })
        .returning()

      return created as Room
    })
  }
}
