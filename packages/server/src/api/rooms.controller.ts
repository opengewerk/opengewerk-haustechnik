import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
} from '@nestjs/common'
import { type Floor, type Room, type RoomId, roomProblems } from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  requireFields,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, count, eq, isNull } from 'drizzle-orm'

import {
  activities,
  assets,
  assetSupplies,
  attachments,
  defects,
  duties,
  floors,
  labels,
  rooms,
} from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Diesen Raum gibt es nicht oder nicht mehr.'

const roomFields = ['number', 'name', 'use'] as const

/**
 * A room. Completing and correcting what is known about it is "aufnehmen",
 * like bringing it into being; moving it to another floor and removing it
 * belong to the structure of the property (section 7 of the concept), and
 * are routes of their own with that right.
 */
@Controller('rooms')
export class RoomsController {
  constructor(private readonly database: Database) {}

  @Get(':id')
  @RequiresPermission('location.read')
  read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Room> {
    return this.database.forTenant(identity, (tx) => placeOf<Room>(tx, rooms, id, missing))
  }

  /**
   * Number, name and use. A room keeps a number or a name: whether it does is
   * asked of the room as it will be, the fields of the body over the ones it
   * has.
   */
  @Patch(':id')
  @RequiresPermission('room.record')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Room> {
    const values = fieldsOf(body, roomFields, roomFields)

    requireSomething(values)
    refuse(roomProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const room = await placeOf<Room>(tx, rooms, id, missing)

      refuse(roomProblems({ number: room.number, name: room.name, use: room.use, ...values }))

      const [changed] = await tx
        .update(rooms)
        .set(values as Partial<Room>)
        .where(and(eq(rooms.id, id as RoomId), isNull(rooms.deletedAt)))
        .returning()

      return changed as Room
    })
  }

  /**
   * Moves the room to another floor, in its building or in another. Building,
   * property and area come from the floor; whoever does not see the area of
   * the floor does not find it.
   *
   * A room an asset stands in moves only within its building, and a room an
   * asset supplies only within its property (#20): an asset stands in the
   * building of its room, a supply names a room on the property of its asset,
   * and the keys hold every row that ever named the room, a deleted one too.
   */
  @Put(':id/floor')
  @RequiresPermission('location.write')
  move(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Room> {
    const values = fieldsOf(body, ['floorId'] as const)

    requireFields(values, ['floorId'])

    return this.database.forTenant(identity, async (tx) => {
      const room = await placeOf<Room>(tx, rooms, id, missing)

      const floor = await placeOf<Floor>(
        tx,
        floors,
        String(values.floorId),
        'Dieses Geschoss gibt es nicht oder nicht mehr.',
      )

      if (floor.buildingId !== room.buildingId) {
        const [standing] = await tx
          .select({ count: count() })
          .from(assets)
          .where(eq(assets.roomId, room.id))

        if ((standing?.count ?? 0) > 0) {
          throw new BadRequestException(
            'In diesem Raum stehen Anlagen, gelöschte mitgezählt; er zieht deshalb nur innerhalb seines Gebäudes um.',
          )
        }
      }

      if (floor.propertyId !== room.propertyId) {
        const [supplied] = await tx
          .select({ count: count() })
          .from(assetSupplies)
          .where(eq(assetSupplies.roomId, room.id))

        if ((supplied?.count ?? 0) > 0) {
          throw new BadRequestException(
            'Diesen Raum versorgen Anlagen, gelöschte Einträge mitgezählt; er zieht deshalb nur innerhalb seiner Liegenschaft um.',
          )
        }

        // What hangs on the room with its property would hold it there, and the
        // database would refuse the move without a sentence (#78).
        const hanging = await hangingOn(tx, room.id)

        if (hanging.length > 0) {
          throw new BadRequestException(
            `An diesem Raum hängen ${listed(hanging)}, gelöschte mitgezählt; er zieht deshalb nur innerhalb seiner Liegenschaft um.`,
          )
        }
      }

      const [moved] = await tx
        .update(rooms)
        .set({
          floorId: floor.id,
          buildingId: floor.buildingId,
          propertyId: floor.propertyId,
          areaId: floor.areaId,
        })
        .where(and(eq(rooms.id, id as RoomId), isNull(rooms.deletedAt)))
        .returning()

      return moved as Room
    })
  }

  @Delete(':id')
  @RequiresPermission('location.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Room> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Room>(tx, rooms, id, missing)

      const [removed] = await tx
        .update(rooms)
        .set({ deletedAt: new Date() })
        .where(and(eq(rooms.id, id as RoomId), isNull(rooms.deletedAt)))
        .returning()

      return removed as Room
    })
  }
}

/** What hangs on a room together with its property, by the word a sentence gives it. */
async function hangingOn(tx: TenantTransaction, roomId: RoomId): Promise<string[]> {
  const tables = [
    {
      words: 'Pflichten',
      count: tx.select({ count: count() }).from(duties).where(eq(duties.roomId, roomId)),
    },
    {
      words: 'Vorgänge',
      count: tx.select({ count: count() }).from(activities).where(eq(activities.roomId, roomId)),
    },
    {
      words: 'Mängel',
      count: tx.select({ count: count() }).from(defects).where(eq(defects.roomId, roomId)),
    },
    {
      words: 'Dokumente',
      count: tx.select({ count: count() }).from(attachments).where(eq(attachments.roomId, roomId)),
    },
    {
      words: 'Etiketten',
      count: tx.select({ count: count() }).from(labels).where(eq(labels.roomId, roomId)),
    },
  ]
  const found: string[] = []

  for (const table of tables) {
    const [row] = await table.count

    if ((row?.count ?? 0) > 0) {
      found.push(table.words)
    }
  }

  return found
}

/** "Pflichten", "Pflichten und Mängel", "Pflichten, Vorgänge und Mängel". */
function listed(words: readonly string[]): string {
  return words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} und ${words.at(-1) ?? ''}`
}
