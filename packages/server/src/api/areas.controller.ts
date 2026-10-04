import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import type { Area, MemberAreas } from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database, listColleagues, pick } from '@opengewerk/platform-server'

import {
  areaOverview,
  type AreaOverview,
  areasFrom,
  areasInSight,
  createArea,
  memberAreasOf,
  removeArea,
  renameArea,
  setMemberAreas,
} from '../areas/areas.js'
import {
  endSubstitution,
  enterSubstitution,
  listSubstitutions,
  type SubstitutionEntry,
} from '../areas/substitutions.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

/** An area as the screen of the areas lists it, the people it is named for by name. */
export type AreaWithPeople = Omit<AreaOverview, 'memberIds'> & {
  readonly members: readonly { readonly userId: string; readonly name: string }[]
}

/**
 * The areas of a tenant (section 2.8 of the concept, ADR 0003).
 *
 * Which areas there are is read by everybody who sees places, for the areas
 * they hold in: a list filters by them, and a new property is put into one.
 * Keeping them is a setting of the tenant, and who holds in which is part of
 * who works for it; section 7 gives both to the Leitung alone.
 */
@Controller('areas')
export class AreasController {
  constructor(private readonly database: Database) {}

  /** The areas the person asking holds in, by name. */
  @Get()
  @RequiresPermission('location.read')
  list(@CurrentIdentity() identity: Asking): Promise<Area[]> {
    return this.database.forTenant(identity, (tx) => areasInSight(tx))
  }

  /** Every area with its properties, its buildings and the people it is named for. */
  @Get('overview')
  @RequiresPermission('settings.read')
  async overview(@CurrentIdentity() identity: Asking): Promise<AreaWithPeople[]> {
    const overview = await this.database.forTenant(identity, (tx) => areaOverview(tx))
    // The names are read as everywhere: the people come out of the tenant's
    // own memberships, and only they are asked about on the instance.
    const names = new Map(
      (await listColleagues(this.database, identity)).map((person) => [person.userId, person.name]),
    )

    return overview.map(({ memberIds, ...area }) => ({
      ...area,
      members: memberIds
        .map((userId) => ({ userId, name: names.get(userId) ?? 'Unbekanntes Konto' }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de')),
    }))
  }

  /** The areas everybody who works for the tenant holds in. */
  @Get('members')
  @RequiresPermission('membership.read')
  members(@CurrentIdentity() identity: Asking): Promise<MemberAreas[]> {
    return this.database.forTenant(identity, (tx) => memberAreasOf(tx, identity.tenantId))
  }

  /** Gives somebody every area or the ones named. */
  @Put('members/:userId')
  @RequiresPermission('membership.write')
  give(
    @CurrentIdentity() identity: Asking,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<MemberAreas> {
    const wanted = areasFrom(body)

    return this.database.forTenant(identity, (tx) =>
      setMemberAreas(tx, identity.tenantId, userId, wanted),
    )
  }

  @Post()
  @RequiresPermission('settings.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Area> {
    const { name } = pick(body, ['name'] as const)

    return this.database.forTenant(identity, (tx) => createArea(tx, identity.tenantId, name))
  }

  @Patch(':id')
  @RequiresPermission('settings.write')
  rename(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Area> {
    const { name } = pick(body, ['name'] as const)

    return this.database.forTenant(identity, (tx) => renameArea(tx, id, name))
  }

  /**
   * Removes an area. `moveTo` names the area its properties go to first; left
   * out, an area that still holds one is refused with their number.
   */
  @Delete(':id')
  @RequiresPermission('settings.write')
  remove(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query('moveTo') moveTo: string | undefined,
  ): Promise<{ readonly removed: string; readonly moved: number }> {
    return this.database.forTenant(identity, (tx) => removeArea(tx, id, moveTo))
  }
}

/**
 * Who stands in for whom (section 2.8): part of who works for a tenant, and
 * so the Leitung's to see and to keep, as section 7 gives it.
 */
@Controller('substitutions')
export class SubstitutionsController {
  constructor(private readonly database: Database) {}

  /** The substitutions that run or are still to come. */
  @Get()
  @RequiresPermission('membership.read')
  list(@CurrentIdentity() identity: Asking): Promise<SubstitutionEntry[]> {
    return this.database.forTenant(identity, (tx) => listSubstitutions(tx, dayInGermany()))
  }

  @Post()
  @RequiresPermission('membership.write')
  enter(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<SubstitutionEntry> {
    const wanted = pick(body, ['substitute', 'absent', 'startsOn', 'endsOn'] as const)

    return this.database.forTenant(identity, (tx) =>
      enterSubstitution(tx, identity.tenantId, wanted, dayInGermany()),
    )
  }

  /** Ends a substitution at once. */
  @Delete(':id')
  @RequiresPermission('membership.write')
  end(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<{ readonly ended: string }> {
    return this.database.forTenant(identity, (tx) => endSubstitution(tx, id))
  }
}
