import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common'
import {
  type BuildingSituation,
  type Catalogue,
  type DutyRegisterFilter,
  isAllowed,
  type IsoDate,
  type Overview,
  type OverviewDuty,
  overviewShown,
  type PlacesToDo,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { count } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import { activities } from '../database/schema/index.js'
import { defectRegister } from '../defects/reading.js'
import { dayInGermany } from '../today.js'
import { activityListWhere } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { registeredEntries, registerPage, type UnnamedDutyEntry } from './duty-register.js'
import { buildingSituation, placesToDo } from './place-situation.js'
import type { Asking } from './places.js'
import { said } from './register-question.js'

/**
 * The overview of the operator's responsibility (section 4.3 of the concept,
 * scenario 1, #122), the start page of the office.
 *
 * Every number is the total of a list counted with the filter of that list:
 * the register of duties (`registerPage` over the rows of
 * `registeredEntries`), the list "Prüfungen" (`activityListWhere`) and the
 * register of defects (`defectRegister`). So a number and the list it leads
 * to agree, on the same day and for the same person.
 *
 * The transaction is the person's: the overview counts in their areas and no
 * other, and narrowed to an area, in that one. It names nobody: what it
 * hands over of a duty is what it is and where, never who answers for it.
 */
@Controller('overview')
export class OverviewController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * The numbers and the first rows of the overview, over every area of the
   * person asking or the one the address names (`?area=`). The reports and
   * the defects only for whoever may read the list they lead to.
   */
  @Get()
  @RequiresPermission('duty.read')
  read(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<Overview> {
    const areaId = said(query, 'area')

    if (areaId !== undefined && !isUuid(areaId)) {
      throw new BadRequestException('Ein Bereich wird mit seiner Kennung genannt.')
    }

    return this.database.forTenant(identity, (tx) =>
      this.overview(tx, identity, dayInGermany(), areaId),
    )
  }

  /**
   * What is to do at every property the person asking sees and at each of
   * its buildings (#121), for the list "Liegenschaften": one answer for the
   * whole list.
   */
  @Get('places')
  @RequiresPermission('duty.read')
  places(@CurrentIdentity() identity: Asking): Promise<PlacesToDo> {
    return this.database.forTenant(identity, (tx) =>
      placesToDo(tx, this.catalogue, identity, dayInGermany()),
    )
  }

  /** The Lagebild of a building (#121): what is to do there, and its last activities. */
  @Get('buildings/:id')
  @RequiresPermission('duty.read')
  building(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<BuildingSituation> {
    if (!isUuid(id)) {
      throw new NotFoundException('Dieses Gebäude gibt es nicht oder nicht mehr.')
    }

    return this.database.forTenant(identity, (tx) =>
      buildingSituation(tx, this.catalogue, identity, dayInGermany(), id),
    )
  }

  private async overview(
    tx: TenantTransaction,
    identity: Asking,
    today: IsoDate,
    areaId: string | undefined,
  ): Promise<Overview> {
    const inArea = areaId === undefined ? {} : { areaId }
    const seen = (await registeredEntries(tx, this.catalogue, today, inArea)) ?? []
    const listed = (filter: DutyRegisterFilter, limit = 0) => {
      const page = registerPage(seen, filter, today, 0, limit)

      return { total: page.total ?? 0, first: page.duties.map(withoutPerson) }
    }
    const soon = listed({ due: 'overdue_or_in_30_days' }, overviewShown.soon)
    const never = listed({ state: 'never_recorded' }, overviewShown.neverRecorded)

    return {
      today,
      overdue: listed({ state: 'overdue' }).total,
      dueIn30Days: listed({ due: 'in_30_days' }).total,
      dueIn90Days: listed({ due: 'in_90_days' }).total,
      neverRecorded: never.total,
      reportsMissing: isAllowed(identity, 'activity.read')
        ? await this.reportsMissing(tx, identity, today, areaId)
        : null,
      soon: soon.first,
      soonTotal: soon.total,
      neverRecordedFirst: never.first,
      ...(await this.defectsOverdue(tx, identity, today, areaId)),
    }
  }

  /** How many inspections and maintenance wait for the report of a contractor, as "Prüfungen" lists them. */
  private async reportsMissing(
    tx: TenantTransaction,
    identity: Asking,
    today: IsoDate,
    areaId: string | undefined,
  ): Promise<number> {
    const where = activityListWhere(
      identity,
      {
        state: 'report_missing',
        kind: null,
        propertyId: null,
        areaId: areaId ?? null,
        search: null,
      },
      today,
    )

    if (where === null) {
      return 0
    }

    const [row] = await tx.select({ total: count() }).from(activities).where(where)

    return row?.total ?? 0
  }

  /** The defects past their deadline, as the register lists them under "Über der Frist". */
  private async defectsOverdue(
    tx: TenantTransaction,
    identity: Asking,
    today: IsoDate,
    areaId: string | undefined,
  ): Promise<Pick<Overview, 'defectsOverdue' | 'defectsOverdueFirst'>> {
    if (!isAllowed(identity, 'defect.read')) {
      return { defectsOverdue: null, defectsOverdueFirst: null }
    }

    const register = await defectRegister(
      tx,
      {
        filter: { state: 'overdue', ...(areaId === undefined ? {} : { areaId }) },
        offset: 0,
        limit: overviewShown.defectsOverdue,
      },
      today,
    )

    return { defectsOverdue: register.total, defectsOverdueFirst: register.defects }
  }
}

/** A row of the register as the overview hands it over: no person, neither who answers for it nor who performs it. */
function withoutPerson(entry: UnnamedDutyEntry): OverviewDuty {
  return {
    id: entry.id,
    title: entry.title,
    state: entry.state,
    appointment: entry.appointment,
    propertyId: entry.propertyId,
    buildingId: entry.buildingId,
    roomId: entry.roomId,
    assetId: entry.assetId,
    asset: entry.asset,
  }
}
