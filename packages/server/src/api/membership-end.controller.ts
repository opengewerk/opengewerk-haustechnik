import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common'
import {
  type AssignedToPerson,
  type MembershipSettings,
  membershipRemovalDays,
  removalDaysProblem,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database } from '@opengewerk/platform-server'
import { memberships } from '@opengewerk/platform-server/schema'
import { eq } from 'drizzle-orm'

import { membershipSettings } from '../database/schema/index.js'
import { assignedTo } from '../memberships/end.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf } from './places.js'

/** Why there is nothing to count: the person does not work for this operator, or never did. */
const noSuchAccess = 'Diesen Zugang gibt es bei diesem Betreiber nicht.'

/**
 * The end of an access (sections 2.4 and 9 of the concept, #356): how many
 * days after the last day of an access its data goes, for whoever looks at
 * the accesses and set by whoever keeps them, and what still hangs on a
 * person, for whoever sets their last day. No new right: an access is
 * "Zugänge verwalten", as its last day is.
 */
@Controller('settings/memberships')
export class MembershipEndController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('membership.read')
  read(@CurrentIdentity() identity: Asking): Promise<MembershipSettings> {
    return this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .select({ removalDays: membershipSettings.removalDays })
        .from(membershipSettings)

      return row === undefined
        ? { removalDays: membershipRemovalDays.standard, standard: true }
        : { removalDays: row.removalDays, standard: false }
    })
  }

  /** A number of days from 1 to 3650, counted from the day after the last day. */
  @Put()
  @RequiresPermission('membership.write')
  set(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<MembershipSettings> {
    const { removalDays } = fieldsOf(body, ['removalDays'], [])
    const problem = removalDaysProblem(removalDays)

    if (problem !== null) {
      throw new BadRequestException(problem)
    }

    const days = removalDays as number

    return this.database.forTenant(identity, async (tx) => {
      await tx
        .insert(membershipSettings)
        .values({ tenantId: identity.tenantId, removalDays: days })
        .onConflictDoUpdate({
          target: [membershipSettings.tenantId],
          set: { removalDays: days, updatedAt: new Date() },
        })

      return { removalDays: days, standard: false }
    })
  }

  /**
   * What still hangs on a person, as numbers, for whoever keeps the accesses
   * and sets their last day, counted in the areas of whoever asks: the
   * Leitung, who keeps the accesses, holds every area.
   */
  @Get(':userId/assigned')
  @RequiresPermission('membership.write')
  assigned(
    @CurrentIdentity() identity: Asking,
    @Param('userId') userId: string,
  ): Promise<AssignedToPerson> {
    return this.database.forTenant(identity, async (tx) => {
      const [member] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.userId, userId))

      if (member === undefined) {
        throw new NotFoundException(noSuchAccess)
      }

      return assignedTo(tx, userId, dayInGermany())
    })
  }
}
