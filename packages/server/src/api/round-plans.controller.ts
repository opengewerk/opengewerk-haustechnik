import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  type Catalogue,
  type FederalState,
  hasHolidays,
  type PlanRhythm,
  planProblems,
  type RoundPlanId,
  type Weekday,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import {
  activities,
  buildings,
  properties,
  roundPlans,
  roundTemplates,
} from '../database/schema/index.js'
import { fillAhead, type PlanRow, replan, withdrawRounds } from '../rounds/plans.js'
import { dayInGermany } from '../today.js'
import { candidatesIn } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { roundPlanTable } from './office-tables.js'
import { planTable } from './round-tables.js'
import { type Asking, refuse } from './places.js'

const missing = 'Diesen Plan gibt es nicht oder nicht mehr.'
const noPerformer = 'Zuständig ist jemand, der Vorgänge ausführt und den Bereich sieht.'
const walked =
  'Von diesem Plan ist schon ein Rundgang begonnen, gegangen oder geschlossen. Er wird nicht entfernt, sondern beendet.'

/** What a plan says about when it falls due, as the routes take it. */
const calendarFields = [
  'rhythm',
  'weekdays',
  'dayOfMonth',
  'month',
  'leadDays',
  'startsOn',
  'endsOn',
] as const

/** The fields a change of a plan may name. The place stays: a plan elsewhere is a new plan. */
const changeFields = [
  ...calendarFields,
  'templateId',
  'performerUserId',
  'resting',
  'skipHolidays',
] as const

/**
 * Whether a plan may leave out the statutory public holidays (#200): only
 * where the catalogue holds them for the state of its property. Elsewhere it
 * is not offered, rather than holidays being made up.
 */
function holidaysKnown(catalogue: Catalogue, state: FederalState, skipHolidays: unknown): void {
  if (skipHolidays !== undefined && typeof skipHolidays !== 'boolean') {
    throw new BadRequestException('Ein Plan lässt die gesetzlichen Feiertage aus oder nicht.')
  }

  if (skipHolidays === true && !hasHolidays(catalogue, state)) {
    throw new BadRequestException(
      'Für das Land dieser Liegenschaft kennt der Katalog keine gesetzlichen Feiertage. Der Plan zählt einen Feiertag dort wie jeden Tag.',
    )
  }
}

/** The fields of a body that were given, and nothing else. */
function given<Field extends string>(
  body: unknown,
  fields: readonly Field[],
): Partial<Record<Field, unknown>> {
  const values = (typeof body === 'object' && body !== null ? body : {}) as Readonly<
    Record<string, unknown>
  >

  return Object.fromEntries(
    fields.filter((field) => values[field] !== undefined).map((field) => [field, values[field]]),
  ) as Partial<Record<Field, unknown>>
}

/** The days of the week of a plan in order, as it is stored. */
function inOrder(weekdays: unknown): readonly Weekday[] | null {
  return Array.isArray(weekdays)
    ? ([...(weekdays as Weekday[])].sort((one, other) => one - other) as readonly Weekday[])
    : null
}

/**
 * The plans of the rounds (#113, section 4.5 of the concept): a new one, and
 * a change of one, which also rests a plan, lets it run again and ends it.
 * Planning and handing out is `activity.write` (section 7). A plan is read on
 * the device that holds it, the office among them.
 *
 * A plan makes its rounds as soon as it is saved, as far ahead as rounds are
 * made (`fillAhead`), so that the office sees the coming days at once and
 * not only after the next pass of the deadline engine. What a change does to
 * the rounds made before says `replan`: a round that was begun is never
 * touched, and the rounds of past days stay.
 */
@Controller('round-plans')
export class RoundPlansController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * The plans as a table (#236), as the list "Pläne" shows them, as a
   * workbook or as text (`?format=xlsx` or `csv`). For whoever reads
   * activities, with the plans of their areas; who walks the rounds of a
   * plan is named only for whoever may see the staff.
   */
  @Get('table')
  @RequiresPermission('activity.read')
  @Header('Cache-Control', 'no-store')
  table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const today = dayInGermany(new Date())

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        await roundPlanTable(this.database, tx, this.catalogue, identity, today),
        format,
        today,
      ),
    )
  }

  /** The rounds of a plan over a period as a table (#344), after the table of the plans. */
  @Get(':id/table')
  @RequiresPermission('activity.read')
  @Header('Cache-Control', 'no-store')
  roundsTable(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    return planTable(this.database, identity, id, query)
  }

  /**
   * A new plan at a property or at a building there. The template is one of
   * the operator, the place one the person sees, and a person named is one
   * of the own people who perform in its area; nobody named hands the rounds
   * to everybody there.
   */
  @Post()
  @RequiresPermission('activity.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<{ id: RoundPlanId }> {
    const values = given(body, [
      ...calendarFields,
      'templateId',
      'propertyId',
      'buildingId',
      'performerUserId',
      'skipHolidays',
    ])
    const plan = {
      rhythm: values.rhythm ?? null,
      weekdays: values.weekdays ?? null,
      dayOfMonth: values.dayOfMonth ?? null,
      month: values.month ?? null,
      leadDays: values.leadDays ?? 0,
      startsOn: values.startsOn ?? null,
      endsOn: values.endsOn ?? null,
    }

    refuse(planProblems(plan))

    return this.database.forTenant(identity, async (tx) => {
      await this.templateOf(tx, values.templateId)

      const property = await this.propertyOf(tx, values.propertyId)

      holidaysKnown(this.catalogue, property.federalState, values.skipHolidays)

      const building = await this.buildingOf(tx, values.buildingId, property.id)
      // The area of the building it is made for, or of the property (ADR 0003,
      // addendum of #306).
      const areaId = building?.areaId ?? property.areaId

      await this.mayPerform(tx, values.performerUserId ?? null, areaId, null)

      const [made] = await tx
        .insert(roundPlans)
        .values({
          tenantId: identity.tenantId,
          propertyId: property.id,
          buildingId: building?.id ?? null,
          areaId,
          templateId: values.templateId as PlanRow['templateId'],
          rhythm: plan.rhythm as PlanRhythm,
          weekdays: inOrder(plan.weekdays),
          dayOfMonth: plan.dayOfMonth as number | null,
          month: plan.month as number | null,
          leadDays: plan.leadDays as number,
          startsOn: plan.startsOn as string,
          endsOn: plan.endsOn as string | null,
          skipHolidays: values.skipHolidays === true,
          performerUserId: (values.performerUserId ?? null) as string | null,
        })
        .returning()

      if (made === undefined) {
        throw new Error('The plan was not written.')
      }

      await fillAhead(tx, made, dayInGermany(new Date()), this.catalogue)

      return { id: made.id }
    })
  }

  /**
   * A change of a plan: its template, its rhythm and days, its lead, its
   * first and last day, its person, and whether it rests. A field of the old
   * rhythm that the new one does not name is emptied with it. A plan that
   * has ended stays as it was. The plan is held until its rounds follow, so
   * two changes at once take turns.
   */
  @Patch(':id')
  @RequiresPermission('activity.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ id: RoundPlanId }> {
    const values = given(body, changeFields)

    if (Object.keys(values).length === 0) {
      throw new BadRequestException('Es fehlt, was am Plan geändert werden soll.')
    }

    if (values.resting !== undefined && typeof values.resting !== 'boolean') {
      throw new BadRequestException('Ein Plan ruht oder läuft.')
    }

    if (!isUuid(id)) {
      throw new NotFoundException(missing)
    }

    return this.database.forTenant(identity, async (tx) => {
      const [before] = await tx
        .select()
        .from(roundPlans)
        .where(and(eq(roundPlans.id, id as RoundPlanId), isNull(roundPlans.deletedAt)))
        .for('no key update')

      if (before === undefined) {
        throw new NotFoundException(missing)
      }

      const today = dayInGermany(new Date())

      if (before.endsOn !== null && before.endsOn < today) {
        throw new ConflictException(
          'Dieser Plan ist beendet und bleibt, wie er war. Für neue Rundgänge legen Sie einen neuen Plan an.',
        )
      }

      // A new rhythm leaves nothing of the old one behind that it does not name.
      const cleared =
        values.rhythm === undefined
          ? {}
          : Object.fromEntries(
              (['weekdays', 'dayOfMonth', 'month'] as const)
                .filter((field) => values[field] === undefined)
                .map((field) => [field, null]),
            )
      const calendar = {
        rhythm: before.rhythm,
        weekdays: before.weekdays,
        dayOfMonth: before.dayOfMonth,
        month: before.month,
        leadDays: before.leadDays,
        startsOn: before.startsOn,
        endsOn: before.endsOn,
        ...cleared,
        ...given(values, calendarFields),
      }

      refuse(planProblems(calendar))

      if (values.skipHolidays !== undefined) {
        const [property] = await tx
          .select({ federalState: properties.federalState })
          .from(properties)
          .where(eq(properties.id, before.propertyId))

        if (property !== undefined) {
          holidaysKnown(this.catalogue, property.federalState, values.skipHolidays)
        }
      }

      if (values.templateId !== undefined && values.templateId !== before.templateId) {
        await this.templateOf(tx, values.templateId)
      }

      const performerUserId =
        values.performerUserId === undefined
          ? before.performerUserId
          : ((values.performerUserId as string | null) ?? null)

      await this.mayPerform(tx, performerUserId, before.areaId, before.performerUserId)

      const [after] = await tx
        .update(roundPlans)
        .set({
          templateId: (values.templateId ?? before.templateId) as PlanRow['templateId'],
          rhythm: calendar.rhythm as PlanRhythm,
          weekdays: inOrder(calendar.weekdays),
          dayOfMonth: calendar.dayOfMonth as number | null,
          month: calendar.month as number | null,
          leadDays: calendar.leadDays as number,
          startsOn: calendar.startsOn as string,
          endsOn: calendar.endsOn as string | null,
          resting: (values.resting ?? before.resting) as boolean,
          skipHolidays: (values.skipHolidays ?? before.skipHolidays) as boolean,
          performerUserId,
          updatedAt: new Date(),
        })
        .where(eq(roundPlans.id, before.id))
        .returning()

      if (after === undefined) {
        throw new NotFoundException(missing)
      }

      await replan(tx, before, after, today, new Date(), this.catalogue)

      return { id: after.id }
    })
  }

  /**
   * A plan entered by mistake is marked deleted, with every round of it that
   * nobody has begun, those of past days among them (#320, 4.5 of the
   * concept). One with a round that somebody began, signed or closed was no
   * mistake: it ends instead, and its rounds stay, as a duty with evidence
   * does (4.3). Its deadline goes with it, since the deadlines read only the
   * plans that are not marked. Its rounds are held while this runs, so that
   * nobody begins one in between.
   */
  @Delete(':id')
  @RequiresPermission('activity.write')
  remove(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<{ id: RoundPlanId }> {
    if (!isUuid(id)) {
      throw new NotFoundException(missing)
    }

    return this.database.forTenant(identity, async (tx) => {
      const [plan] = await tx
        .select({ id: roundPlans.id })
        .from(roundPlans)
        .where(and(eq(roundPlans.id, id as RoundPlanId), isNull(roundPlans.deletedAt)))
        .for('no key update')

      if (plan === undefined) {
        throw new NotFoundException(missing)
      }

      const rounds = await tx
        .select({ id: activities.id, status: activities.status })
        .from(activities)
        .where(and(eq(activities.roundPlanId, plan.id), isNull(activities.deletedAt)))
        .for('update')

      if (rounds.some((round) => round.status !== 'open')) {
        throw new ConflictException(walked)
      }

      const now = new Date()

      await withdrawRounds(
        tx,
        rounds.map((round) => round.id),
        now,
      )

      await tx
        .update(roundPlans)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(roundPlans.id, plan.id))

      return { id: plan.id }
    })
  }

  /** The template a plan walks: one of the operator. */
  private async templateOf(tx: TenantTransaction, id: unknown): Promise<void> {
    const [template] =
      typeof id === 'string' && isUuid(id)
        ? await tx
            .select({ id: roundTemplates.id })
            .from(roundTemplates)
            .where(
              and(
                eq(roundTemplates.id, id as PlanRow['templateId']),
                isNull(roundTemplates.deletedAt),
              ),
            )
        : []

    if (template === undefined) {
      throw new BadRequestException('Diese Vorlage gibt es bei diesem Betreiber nicht.')
    }
  }

  /** The property of a new plan, as far as the person sees it. */
  private async propertyOf(
    tx: TenantTransaction,
    id: unknown,
  ): Promise<{
    readonly id: PlanRow['propertyId']
    readonly areaId: PlanRow['areaId']
    readonly federalState: FederalState
  }> {
    const [property] =
      typeof id === 'string' && isUuid(id)
        ? await tx
            .select({
              id: properties.id,
              areaId: properties.areaId,
              federalState: properties.federalState,
            })
            .from(properties)
            .where(
              and(eq(properties.id, id as PlanRow['propertyId']), isNull(properties.deletedAt)),
            )
        : []

    if (property === undefined) {
      throw new BadRequestException('Der Ort ist eine Liegenschaft, die Sie sehen.')
    }

    return property
  }

  /** The building of a new plan, one on its property, or none for the whole property. */
  private async buildingOf(
    tx: TenantTransaction,
    id: unknown,
    propertyId: PlanRow['propertyId'],
  ): Promise<{
    readonly id: NonNullable<PlanRow['buildingId']>
    readonly areaId: PlanRow['areaId']
  } | null> {
    if (id === undefined || id === null || id === '') {
      return null
    }

    const [building] =
      typeof id === 'string' && isUuid(id)
        ? await tx
            .select({ id: buildings.id, areaId: buildings.areaId })
            .from(buildings)
            .where(
              and(
                eq(buildings.id, id as NonNullable<PlanRow['buildingId']>),
                eq(buildings.propertyId, propertyId),
                isNull(buildings.deletedAt),
              ),
            )
        : []

    if (building === undefined) {
      throw new BadRequestException('Das Gebäude steht nicht auf dieser Liegenschaft.')
    }

    return building
  }

  /** A person named anew performs in the area; one named before stays named. */
  private async mayPerform(
    tx: TenantTransaction,
    performerUserId: unknown,
    areaId: PlanRow['areaId'],
    before: string | null,
  ): Promise<void> {
    if (performerUserId === null || performerUserId === before) {
      return
    }

    const { performers } = await candidatesIn(tx, areaId)

    if (typeof performerUserId !== 'string' || !performers.includes(performerUserId)) {
      throw new BadRequestException(noPerformer)
    }
  }
}
