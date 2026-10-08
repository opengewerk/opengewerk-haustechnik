import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  type Activity,
  type ActivityCandidates,
  activityClosable,
  type ActivityDetails,
  type ActivityDutyLine,
  type ActivityEntry,
  type ActivityList,
  type ActivityListState,
  activityListPage,
  activityListStates,
  activityListStatuses,
  activityPlanProblems,
  activityProblems,
  type Catalogue,
  type DueActivityKind,
  dueActivityKinds,
  type Duty,
  dutyHasEnded,
  type DutyId,
  dutyInterval,
  type DutyPerson,
  isAllowed,
  type Right,
  takesAReport,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, count, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'

import { makeActivityForDuty } from '../activities/for-duty.js'
import { CATALOGUE } from '../catalogue.js'
import { dutiesOnADay, dutyTitle } from '../database/duty-standing.js'
import {
  activities,
  activityDuties,
  assets,
  duties,
  memberAllAreas,
  memberAreas,
  memberships,
  properties,
  tenantRoles,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'
import { counted, said } from './register-question.js'

const missing = 'Diesen Vorgang gibt es nicht oder nicht mehr.'
const missingDuty = 'Diese Pflicht gibt es nicht oder nicht mehr.'

/** What the list is asked, read from the address. */
interface ActivityQuestion {
  readonly state: ActivityListState
  readonly kind: DueActivityKind | null
  readonly propertyId: string | null
  readonly search: string | null
  readonly offset: number
  readonly limit: number
}

function activityQuestionOf(query: Readonly<Record<string, unknown>>): ActivityQuestion {
  const state = said(query, 'state') ?? 'pending'
  const kind = said(query, 'kind') ?? null

  if (!(activityListStates as readonly string[]).includes(state)) {
    throw new BadRequestException(`Der Stand ist einer von: ${activityListStates.join(', ')}.`)
  }

  if (kind !== null && !(dueActivityKinds as readonly string[]).includes(kind)) {
    throw new BadRequestException(`Die Art ist eine von: ${dueActivityKinds.join(', ')}.`)
  }

  return {
    state: state as ActivityListState,
    kind: kind as DueActivityKind | null,
    propertyId: said(query, 'property') ?? null,
    search: said(query, 'search')?.trim() || null,
    offset: counted(
      said(query, 'offset'),
      0,
      { least: 0, most: Number.MAX_SAFE_INTEGER },
      'Der Versatz ist eine ganze Zahl ab 0.',
    ),
    limit: counted(
      said(query, 'limit'),
      activityListPage.size,
      { least: 1, most: activityListPage.most },
      `Eine Seite hat 1 bis ${String(activityListPage.most)} Vorgänge.`,
    ),
  }
}

/** The search as a pattern for ILIKE: what it says anywhere in the text, taken literally. */
function containing(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/**
 * Where the search looks: the title of the activity, which is the title of
 * its duty, the number and the name of its asset, and the name of its
 * property.
 */
function searching(search: string): SQL | undefined {
  const pattern = containing(search)

  return or(
    ilike(activities.title, pattern),
    sql`exists (select 1 from ${assets} where ${assets.id} = ${activities.assetId} and (${assets.number} ilike ${pattern} or ${assets.name} ilike ${pattern}))`,
    sql`exists (select 1 from ${properties} where ${properties.id} = ${activities.propertyId} and ${properties.name} ilike ${pattern})`,
  )
}

/**
 * What of the activities the person asking is shown. Whoever plans and hands
 * out work sees every one in their areas, which the policy decides. Whoever
 * only performs sees what is given to them or to nobody, as their device
 * holds it (`deviceScope`): the list tells nobody who else works on what.
 */
export function inSight(identity: Asking): SQL | undefined {
  if (isAllowed(identity, 'activity.write')) {
    return undefined
  }

  return or(
    eq(activities.responsibleUserId, identity.userId),
    eq(activities.performerUserId, identity.userId),
    and(isNull(activities.responsibleUserId), isNull(activities.performerUserId)),
  )
}

/** The fields of the plan of an activity, and those that may be left empty. */
const planFields = [
  'responsibleUserId',
  'performer',
  'performerUserId',
  'contractorNote',
  'dueOn',
] as const

const emptiable = ['responsibleUserId', 'performerUserId', 'contractorNote'] as const

/**
 * The activities of an operator in the office (section 4.4 of the concept,
 * #105): the list "Prüfungen" of the inspections and the maintenance that
 * came of the due days of the duties, the page of one, and its plan.
 *
 * Reading is `activity.read`, planning and handing out is `activity.write`:
 * who answers for an activity, whether the own people or a contractor
 * perform it, which person or which contractor, and the day it is due on.
 * Whoever only performs is shown what is given to them or to nobody, and no
 * other activity, not even by its address.
 *
 * Planning moves no due day: the next one comes of the next evidence, so an
 * inspection that was planned and not performed stays overdue.
 */
@Controller('activities')
export class ActivitiesController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * A page of the inspections and the maintenance the person asking sees,
   * the earliest due day first, narrowed by state, kind, property and a
   * search through the title, the asset and the property. There is no
   * narrowing to a person: a list about somebody would be a count of their
   * work (sections 4.16 and 9 of the concept).
   */
  @Get()
  @RequiresPermission('activity.read')
  async list(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<ActivityList> {
    const question = activityQuestionOf(query)
    const statuses = activityListStatuses[question.state]

    if (question.propertyId !== null && !isUuid(question.propertyId)) {
      return { total: 0, more: false, activities: [] }
    }

    const where = and(
      isNull(activities.deletedAt),
      inArray(activities.kind, question.kind === null ? [...dueActivityKinds] : [question.kind]),
      statuses === null ? undefined : inArray(activities.status, [...statuses]),
      question.propertyId === null
        ? undefined
        : eq(activities.propertyId, question.propertyId as Activity['propertyId']),
      question.search === null ? undefined : searching(question.search),
      inSight(identity),
    )

    const read = await this.database.forTenant(identity, async (tx) => {
      const [counted] = await tx.select({ total: count() }).from(activities).where(where)
      const rows = (await tx
        .select()
        .from(activities)
        .where(where)
        .orderBy(sql`${activities.dueOn} asc nulls last`, asc(activities.title), asc(activities.id))
        .offset(question.offset)
        .limit(question.limit)) as Activity[]

      return { total: counted?.total ?? 0, rows }
    })
    const named = await this.named(identity, read.rows)

    return {
      total: read.total,
      more: question.offset + read.rows.length < read.total,
      activities: read.rows.map((row) => entryOf(row, named)),
    }
  }

  /**
   * The page of an activity: what the list says, the duties it is to meet
   * with how each stands today and what came of it, and when it came about.
   */
  @Get(':id')
  @RequiresPermission('activity.read')
  async read(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<ActivityDetails> {
    const today = dayInGermany()
    const read = await this.database.forTenant(identity, async (tx) => {
      const activity = await this.activityOf(tx, identity, id)
      const lines = await tx
        .select({ line: activityDuties, duty: duties })
        .from(activityDuties)
        .innerJoin(
          duties,
          and(eq(duties.tenantId, activityDuties.tenantId), eq(duties.id, activityDuties.dutyId)),
        )
        .where(and(eq(activityDuties.activityId, activity.id), isNull(activityDuties.deletedAt)))
        .orderBy(asc(activityDuties.id))
      const standing = await dutiesOnADay(
        tx,
        today,
        lines.map(({ duty }) => duty as Duty),
      )

      return { activity, lines, standing }
    })
    const named = await this.named(identity, [read.activity])
    const lines = read.lines.map(({ line, duty }, index): ActivityDutyLine => {
      const registered = read.standing[index]
      const kind =
        duty.kind === null || duty.kindVersion === null
          ? null
          : this.catalogue.dutyKindVersion(duty.kind, duty.kindVersion)

      return {
        id: line.id,
        dutyId: duty.id,
        title: dutyTitle(duty, this.catalogue),
        source: kind?.definition.source ?? duty.sourceNote,
        interval: dutyInterval(duty),
        state: registered?.standing.state ?? 'never_recorded',
        appointment: registered?.standing.appointment?.dueOn ?? null,
        lastMetOn: registered?.lastMetOn ?? null,
        qualification: kind?.definition.qualification.level ?? null,
        takesReport: takesAReport(duty, kind),
        result: line.result,
        resultReason: line.resultReason,
      }
    })

    return {
      ...entryOf(read.activity, named),
      createdAt: read.activity.createdAt.toISOString(),
      performedOn: read.activity.performedOn,
      closingReason: read.activity.closingReason,
      duties: lines,
    }
  }

  /**
   * Who may be named in the plan of an activity: who answers for it among
   * those who plan and hand out work, who performs it among those who
   * perform activities, each seeing the area of the activity and not shut
   * out. For whoever plans, and the name and nothing else of each person.
   */
  @Get(':id/candidates')
  @RequiresPermission('activity.write')
  async candidates(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<ActivityCandidates> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const activity = await this.activityOf(tx, identity, id)

      return candidatesIn(tx, activity.areaId)
    })
    const accounts = await accountsOf(
      this.database,
      [...new Set([...found.responsible, ...found.performers])],
      identity.userId,
    )
    const people = (userIds: readonly string[]): DutyPerson[] =>
      userIds
        .map((userId) => ({ userId, name: accounts.get(userId)?.name ?? 'Unbekanntes Konto' }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de'))

    return { responsible: people(found.responsible), performers: people(found.performers) }
  }

  /**
   * The plan of an activity, while it is open: who answers for it, whether
   * the own people or a contractor perform it, which person or contractor,
   * and the day it is due on. A person named anew is one of the candidates;
   * one named before stays named, also when they could not be named anew.
   * Once somebody has begun the work, the plan stays as it is.
   */
  @Put(':id/plan')
  @RequiresPermission('activity.write')
  async plan(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ActivityDetails> {
    const values = fieldsOf(body, planFields, emptiable)
    const plan = {
      responsibleUserId: values.responsibleUserId ?? null,
      performer: values.performer ?? null,
      performerUserId: values.performerUserId ?? null,
      contractorNote: values.contractorNote ?? null,
      dueOn: values.dueOn ?? null,
    }

    refuse(activityPlanProblems(plan))

    await this.database.forTenant(identity, async (tx) => {
      const activity = await this.activityOf(tx, identity, id)
      const { responsible, performers } = await candidatesIn(tx, activity.areaId)
      const anew = (value: unknown, before: string | null) =>
        typeof value === 'string' && value !== before

      if (
        anew(plan.responsibleUserId, activity.responsibleUserId) &&
        !responsible.includes(plan.responsibleUserId as string)
      ) {
        throw new BadRequestException(
          'Verantwortlich ist jemand, der Vorgänge plant und verteilt und den Bereich sieht.',
        )
      }

      if (
        anew(plan.performerUserId, activity.performerUserId) &&
        !performers.includes(plan.performerUserId as string)
      ) {
        throw new BadRequestException(
          'Ausführen kann, wer Vorgänge ausführt und den Bereich sieht.',
        )
      }

      const [planned] = await tx
        .update(activities)
        .set({
          responsibleUserId: plan.responsibleUserId as string | null,
          performer: plan.performer as Activity['performer'],
          performerUserId: plan.performerUserId as string | null,
          contractorNote: plan.contractorNote as string | null,
          dueOn: plan.dueOn as string,
          updatedAt: new Date(),
        })
        .where(and(eq(activities.id, activity.id), eq(activities.status, 'open')))
        .returning({ id: activities.id })

      // Whoever began the work meanwhile keeps the plan as it was.
      if (planned === undefined) {
        throw new ConflictException(
          'Geplant wird ein Vorgang, solange er offen ist. Diesen hat schon jemand begonnen.',
        )
      }
    })

    return this.read(identity, id)
  }

  /**
   * An inspection or a maintenance for a duty, made by hand (#183): for a
   * duty whose due day has none, because the one it had was closed or none
   * came of it yet. It is made as the engine makes one of a due day
   * (`makeActivityForDuty`), due on the next appointment of the duty or
   * today for one that was never recorded, with the person who answers for
   * the duty; who performs it and on which day is planned afterwards. A duty
   * with an activity under way gets no second one, and one that has ended or
   * rests gets none.
   *
   * The appointment does not move: the next due day comes of the next
   * evidence (section 4.4).
   */
  @Post()
  @RequiresPermission('activity.write')
  async create(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<ActivityDetails> {
    const { dutyId } = fieldsOf(body, ['dutyId'] as const)

    if (typeof dutyId !== 'string') {
      throw new BadRequestException('Ein Vorgang nennt die Pflicht, für die er entsteht.')
    }

    const today = dayInGermany()
    const made = await this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<Duty>(tx, duties, dutyId, missingDuty)

      if (dutyHasEnded(duty, today)) {
        throw new ConflictException('Eine beendete Pflicht bekommt keinen Vorgang mehr.')
      }

      const [registered] = await dutiesOnADay(tx, today, [duty])

      if (registered?.standing.state === 'dormant') {
        throw new ConflictException(
          'Solange ihre Anlage nicht in Betrieb ist, ruht die Pflicht und bekommt keinen Vorgang.',
        )
      }

      return makeActivityForDuty(tx, this.catalogue, {
        tenantId: identity.tenantId,
        dutyId: duty.id as DutyId,
        dueOn: registered?.standing.appointment?.dueOn ?? today,
        responsible: duty.responsibleUserId,
        now: new Date(),
      })
    })

    if (made.made === null) {
      if (made.because === 'missing') {
        throw new NotFoundException(missingDuty)
      }

      throw new ConflictException(
        'Für diese Pflicht läuft schon ein Vorgang. Ein neuer entsteht erst, wenn er erledigt oder geschlossen ist.',
      )
    }

    return this.read(identity, made.made)
  }

  /**
   * An inspection or a maintenance closed as not performed, with the reason
   * (#183, section 4.4 of the concept): while it is open or begun, by whoever
   * plans and hands out work. Each of its duties takes "not performed" with
   * the same reason as its result. No evidence comes of it, and the
   * appointment of its duties stays as it is: planned and not performed is
   * overdue. A device that still holds the activity changes nothing of it
   * afterwards; its progress is taken only while it is open or begun.
   */
  @Post(':id/close')
  @RequiresPermission('activity.write')
  async close(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ActivityDetails> {
    const { closingReason } = fieldsOf(body, ['closingReason'] as const)

    refuse(activityProblems({ status: 'not_performed', closingReason: closingReason ?? null }))

    await this.database.forTenant(identity, async (tx) => {
      const activity = await this.activityOf(tx, identity, id)

      if (!(dueActivityKinds as readonly string[]).includes(activity.kind)) {
        throw new BadRequestException(
          'Mit Grund geschlossen wird hier eine Prüfung oder eine Wartung.',
        )
      }

      const [closed] = await tx
        .update(activities)
        .set({
          status: 'not_performed',
          closingReason: closingReason as string,
          updatedAt: new Date(),
        })
        .where(
          and(eq(activities.id, activity.id), inArray(activities.status, [...activityClosable])),
        )
        .returning({ id: activities.id })

      // Whoever signed it meanwhile waits for the evidence of the signature.
      if (closed === undefined) {
        throw new ConflictException(
          'Geschlossen wird ein Vorgang, solange er offen oder begonnen ist. Dieser ist schon unterschrieben oder abgeschlossen.',
        )
      }

      await tx
        .update(activityDuties)
        .set({ result: 'not_performed', resultReason: closingReason as string })
        .where(and(eq(activityDuties.activityId, activity.id), isNull(activityDuties.deletedAt)))
    })

    return this.read(identity, id)
  }

  /**
   * The activity behind an id, if the person asking is shown it: in their
   * areas, not marked deleted, and for whoever only performs, given to them
   * or to nobody. Every other gets the same answer as one that is not there.
   */
  private async activityOf(tx: TenantTransaction, identity: Asking, id: string): Promise<Activity> {
    if (!isUuid(id)) {
      throw new NotFoundException(missing)
    }

    const [row] = await tx
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.id, id as Activity['id']),
          isNull(activities.deletedAt),
          inSight(identity),
        ),
      )

    if (row === undefined) {
      throw new NotFoundException(missing)
    }

    return row as Activity
  }

  /**
   * The names behind the people activities name. Asked of the instance for
   * exactly these ids, which keys on each activity tie to a membership of
   * this operator.
   */
  private async named(
    identity: Asking,
    rows: readonly Pick<Activity, 'responsibleUserId' | 'performerUserId'>[],
  ): Promise<(userId: string | null) => DutyPerson | null> {
    const ids = [
      ...new Set(
        rows.flatMap((row) =>
          [row.responsibleUserId, row.performerUserId].filter((userId) => userId !== null),
        ),
      ),
    ]
    const accounts = await accountsOf(this.database, ids, identity.userId)

    return (userId) =>
      userId === null ? null : { userId, name: accounts.get(userId)?.name ?? 'Unbekanntes Konto' }
  }
}

/** An activity as the list shows it, with the people it names by their names. */
function entryOf(
  row: Activity,
  named: (userId: string | null) => DutyPerson | null,
): ActivityEntry {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    dueOn: row.dueOn,
    propertyId: row.propertyId,
    areaId: row.areaId,
    buildingId: row.buildingId,
    roomId: row.roomId,
    assetId: row.assetId,
    responsible: named(row.responsibleUserId),
    performer: row.performer,
    performerPerson: named(row.performerUserId),
    contractorNote: row.contractorNote,
  }
}

/**
 * The people of the operator who see an area and are not shut out, by what
 * their roles let them do there: plan and hand out work, and perform it.
 * Asked of the rows of the operator's roles, as every right is, and of the
 * areas named for each membership; a substitution, which lasts some days,
 * makes nobody a candidate.
 */
async function candidatesIn(
  tx: TenantTransaction,
  areaId: string,
): Promise<{ readonly responsible: readonly string[]; readonly performers: readonly string[] }> {
  const holds = (right: Right) => sql`exists (
      select 1 from ${tenantRoles}
       where ${tenantRoles.tenantId} = ${memberships.tenantId}
         and ${tenantRoles.key} = any(${memberships.roles})
         and ${right} = any(${tenantRoles.rights}))`
  const rows = await tx
    .select({
      userId: memberships.userId,
      plans: sql<boolean>`${holds('activity.write')}`,
      performs: sql<boolean>`${holds('activity.perform')}`,
    })
    .from(memberships)
    .where(
      and(
        isNull(memberships.blockedAt),
        or(
          sql`exists (select 1 from ${memberAllAreas} where ${memberAllAreas.tenantId} = ${memberships.tenantId} and ${memberAllAreas.userId} = ${memberships.userId})`,
          sql`exists (select 1 from ${memberAreas} where ${memberAreas.tenantId} = ${memberships.tenantId} and ${memberAreas.userId} = ${memberships.userId} and ${memberAreas.areaId} = ${areaId})`,
        ),
      ),
    )

  return {
    responsible: rows.filter((row) => row.plans).map((row) => row.userId),
    performers: rows.filter((row) => row.performs).map((row) => row.userId),
  }
}
