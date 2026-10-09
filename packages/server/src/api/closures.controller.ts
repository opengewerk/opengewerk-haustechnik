import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import {
  type Building,
  type BuildingClosure,
  type BuildingId,
  closureProblems,
  type Catalogue,
} from '@opengewerk/haustechnik-domain'
import { CurrentIdentity, Database } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { buildingClosures, buildings } from '../database/schema/index.js'
import { followClosures } from '../rounds/plans.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Dieses Gebäude gibt es nicht oder nicht mehr.'
const missingClosure = 'Diese Schließzeit gibt es nicht oder nicht mehr.'

const closureFields = ['startsOn', 'endsOn', 'reason'] as const

/**
 * The times a building is closed (#86, section 4.1 of the concept), in which
 * no round is made for it (4.5).
 *
 * Read by whoever sees the building. Entered and removed by whoever plans and
 * hands out activities (section 7): a closure belongs to the planning of the
 * rounds and not to the structure of the building, so the Objektleitung
 * enters the holidays of its school without the right to change the school.
 * None is changed in place; one entered wrongly is removed and entered again.
 * The rounds of the plans of the building follow at once (#113): a new
 * closure takes back those on its days that nobody has begun, and one that
 * is removed lets the plans make the rounds of its days again.
 *
 * The building is looked up first, as the person asking sees it: one outside
 * their areas is not there, and neither are its closures.
 */
@Controller('buildings')
export class BuildingClosuresController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /** The closures of the building that stand, in the order of the calendar. */
  @Get(':id/closures')
  @RequiresPermission('location.read')
  closuresOf(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<BuildingClosure[]> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Building>(tx, buildings, id, missing)

      const closures = await tx
        .select()
        .from(buildingClosures)
        .where(
          and(
            eq(buildingClosures.buildingId, id as BuildingId),
            isNull(buildingClosures.deletedAt),
          ),
        )
        .orderBy(asc(buildingClosures.startsOn), asc(buildingClosures.endsOn))

      return closures as BuildingClosure[]
    })
  }

  /** A closure of the building. Property and area come from the building. */
  @Post(':id/closures')
  @RequiresPermission('activity.write')
  add(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<BuildingClosure> {
    const values = fieldsOf(body, closureFields, ['reason'])

    refuse(closureProblems({ startsOn: null, endsOn: null, ...values }))

    return this.database.forTenant(identity, async (tx) => {
      const building = await placeOf<Building>(tx, buildings, id, missing)
      const [created] = await tx
        .insert(buildingClosures)
        .values({
          tenantId: identity.tenantId,
          buildingId: building.id,
          propertyId: building.propertyId,
          areaId: building.areaId,
          startsOn: values.startsOn as string,
          endsOn: values.endsOn as string,
          reason: (values.reason ?? null) as string | null,
        })
        .returning()

      await followClosures(tx, building.id, dayInGermany(new Date()), new Date(), this.catalogue)

      return created as BuildingClosure
    })
  }

  /** Marks a closure deleted. One of another building is not there. */
  @Delete(':id/closures/:closureId')
  @RequiresPermission('activity.write')
  remove(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('closureId') closureId: string,
  ): Promise<BuildingClosure> {
    return this.database.forTenant(identity, async (tx) => {
      const building = await placeOf<Building>(tx, buildings, id, missing)
      const closure = await placeOf<BuildingClosure>(
        tx,
        buildingClosures,
        closureId,
        missingClosure,
      )

      if (closure.buildingId !== building.id) {
        throw new NotFoundException(missingClosure)
      }

      const [removed] = await tx
        .update(buildingClosures)
        .set({ deletedAt: new Date() })
        .where(and(eq(buildingClosures.id, closure.id), isNull(buildingClosures.deletedAt)))
        .returning()

      await followClosures(tx, building.id, dayInGermany(new Date()), new Date(), this.catalogue)

      return removed as BuildingClosure
    })
  }
}
