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
  activityClosable,
  type ActivityId,
  activityProblems,
  type Catalogue,
  type Defect,
  type DefectId,
  type Duty,
  dutyHasEnded,
  evidenceKindLabel,
  type DutyId,
  type DutyPerson,
  type Property,
  type WorkOrder,
  type WorkOrderCandidates,
  workOrderDecisionKinds,
  type WorkOrderDetails,
  type WorkOrderEntry,
  type WorkOrderKind,
  workOrderKinds,
  type WorkOrderList,
  workOrderListPage,
  type WorkOrderListState,
  workOrderListStates,
  workOrderListStatuses,
  type WorkOrderOrigin,
  workOrderOrigins,
  type WorkOrderPlan,
  workOrderPlanProblems,
  signatureLimits,
  takesAWorkOrder,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'

import { closeAsNotPerformed } from '../activities/closing.js'
import { makeActivityForDuty } from '../activities/for-duty.js'
import {
  decideWorkOrder,
  defectsFollowTheirOrder,
  SigningRefusal,
  signaturesWithTheirStanding,
} from '../activities/signing.js'
import { CATALOGUE } from '../catalogue.js'
import { dutiesOnADay, dutyTitle } from '../database/duty-standing.js'
import { assignNumber } from '../database/number-ranges.js'
import {
  activities,
  activityDuties,
  activitySignatures,
  defects,
  duties,
  properties,
  workOrderDecisions,
  workOrderParticipants,
  workOrders,
} from '../database/schema/index.js'
import { EvidenceRefusal } from '../evidence/write.js'
import { dayInGermany } from '../today.js'
import { candidatesIn, containing, inSight } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, given, placeOf, refuse, type Target, targetOf } from './places.js'
import { counted, said } from './register-question.js'

const missing = 'Diesen Auftrag gibt es nicht oder nicht mehr.'
const missingDefect = 'Diesen Mangel gibt es nicht oder nicht mehr.'
const missingDuty = 'Diese Pflicht gibt es nicht oder nicht mehr.'
const unknownAccount = 'Unbekanntes Konto'

/** What the list is asked, read from the address. */
interface WorkOrderQuestion {
  readonly state: WorkOrderListState
  readonly kind: WorkOrderKind | null
  readonly areaId: string | null
  /** The orders at one asset, for its file. */
  readonly assetId: string | null
  readonly search: string | null
  readonly offset: number
  readonly limit: number
}

function questionOf(query: Readonly<Record<string, unknown>>): WorkOrderQuestion {
  const state = said(query, 'state') ?? 'open'
  const kind = said(query, 'kind') ?? null

  if (!(workOrderListStates as readonly string[]).includes(state)) {
    throw new BadRequestException(`Der Stand ist einer von: ${workOrderListStates.join(', ')}.`)
  }

  if (kind !== null && !(workOrderKinds as readonly string[]).includes(kind)) {
    throw new BadRequestException(`Die Art ist eine von: ${workOrderKinds.join(', ')}.`)
  }

  return {
    state: state as WorkOrderListState,
    kind: kind as WorkOrderKind | null,
    areaId: said(query, 'area') ?? null,
    assetId: said(query, 'asset') ?? null,
    search: said(query, 'search')?.trim() || null,
    offset: counted(
      said(query, 'offset'),
      0,
      { least: 0, most: Number.MAX_SAFE_INTEGER },
      'Der Versatz ist eine ganze Zahl ab 0.',
    ),
    limit: counted(
      said(query, 'limit'),
      workOrderListPage.size,
      { least: 1, most: workOrderListPage.most },
      `Eine Seite hat 1 bis ${String(workOrderListPage.most)} Aufträge.`,
    ),
  }
}

/**
 * The work orders the person asking is shown. Whoever plans and hands out
 * work sees every one in their areas, which the policy decides. Whoever only
 * performs sees what is given to them or to nobody, as for every activity,
 * and the orders they work on, as their device holds them (`deviceScope`).
 */
function ordersInSight(identity: Asking): SQL | undefined {
  const given = inSight(identity)

  return given === undefined
    ? undefined
    : or(
        given,
        sql`exists (select 1 from ${workOrderParticipants}
                     where ${workOrderParticipants.tenantId} = ${activities.tenantId}
                       and ${workOrderParticipants.activityId} = ${activities.id}
                       and ${workOrderParticipants.userId} = ${identity.userId}
                       and ${workOrderParticipants.deletedAt} is null)`,
      )
}

/** The row of a work order beside its activity. */
const theirOrder = and(
  eq(workOrders.tenantId, activities.tenantId),
  eq(workOrders.activityId, activities.id),
  isNull(workOrders.deletedAt),
)

/**
 * Whether a work order was turned back and not signed since: a decision on
 * an order that is not done is a rejection, since an acceptance makes it done.
 */
const turnedBack = sql<boolean>`(${activities.status} in ('open', 'started') and exists (
    select 1 from ${workOrderDecisions}
     where ${workOrderDecisions.tenantId} = ${workOrders.tenantId}
       and ${workOrderDecisions.workOrderId} = ${workOrders.id}))`

/** Where the search looks: the title and the number of the order, and the name of its property. */
function searching(search: string): SQL | undefined {
  const pattern = containing(search)

  return or(
    ilike(activities.title, pattern),
    ilike(workOrders.number, pattern),
    sql`exists (select 1 from ${properties} where ${properties.id} = ${activities.propertyId} and ${properties.name} ilike ${pattern})`,
  )
}

/** The plan of a work order as a body gives it, before the model asks about it. */
function planOf(values: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    title: values['title'] ?? null,
    kind: values['kind'] ?? null,
    urgency: values['urgency'] ?? null,
    dueOn: values['dueOn'] ?? null,
    responsibleUserId: values['responsibleUserId'] ?? null,
    participantUserIds: values['participantUserIds'] ?? [],
  }
}

const planFields = [
  'title',
  'kind',
  'urgency',
  'dueOn',
  'responsibleUserId',
  'participantUserIds',
] as const

const originFields = [
  'origin',
  'defectId',
  'dutyId',
  'propertyId',
  'buildingId',
  'roomId',
  'assetId',
] as const

/**
 * The work orders of an operator in the office (section 4.8 of the concept,
 * #117 and #73): the list "Aufträge", the page of one, a new one from a
 * defect, from the due day of a duty or by hand, its change, and its
 * acceptance or rejection. A work order is addressed by its activity, on
 * which everything of it hangs: its signatures, its photos, the answers to
 * its form and the further people who work on it.
 *
 * Reading is `activity.read`; making, handing out and changing an order is
 * `activity.write`; accepting or turning it back is `activity.accept`. The
 * person who answers for an order leads it and finishes it with the
 * signature (4.8), so they and the further people are chosen among those who
 * perform activities and see the area.
 *
 * The defect an order comes of follows it: ordered when the order is made,
 * set right with its signature, ordered again when it is turned back
 * (`signing.ts`).
 */
@Controller('work-orders')
export class WorkOrdersController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * A page of the work orders the person asking sees, the newest first,
   * narrowed by state, kind, area, asset and a search through the title, the
   * number and the property, with how many of them wait for their acceptance. There
   * is no narrowing to a person: a list of what somebody worked on would
   * count their work (sections 4.16 and 9 of the concept).
   */
  @Get()
  @RequiresPermission('activity.read')
  async list(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<WorkOrderList> {
    const question = questionOf(query)
    const statuses = workOrderListStatuses[question.state]

    if (
      (question.areaId !== null && !isUuid(question.areaId)) ||
      (question.assetId !== null && !isUuid(question.assetId))
    ) {
      return { total: 0, waiting: 0, more: false, orders: [] }
    }

    const where = and(
      isNull(activities.deletedAt),
      eq(activities.kind, 'work_order'),
      statuses === null ? undefined : inArray(activities.status, [...statuses]),
      question.kind === null ? undefined : eq(workOrders.kind, question.kind),
      question.areaId === null
        ? undefined
        : eq(activities.areaId, question.areaId as Activity['areaId']),
      question.assetId === null
        ? undefined
        : eq(activities.assetId, question.assetId as NonNullable<Activity['assetId']>),
      question.search === null ? undefined : searching(question.search),
      ordersInSight(identity),
    )

    const read = await this.database.forTenant(identity, async (tx) => {
      const [counted] = await tx
        .select({
          total: count(),
          waiting: sql<number>`count(*) filter (where ${activities.status} = 'signed')`.mapWith(
            Number,
          ),
        })
        .from(activities)
        .innerJoin(workOrders, theirOrder)
        .where(where)
      const rows = await tx
        .select({ activity: activities, order: workOrders, rejected: turnedBack })
        .from(activities)
        .innerJoin(workOrders, theirOrder)
        .where(where)
        .orderBy(desc(activities.createdAt), desc(activities.id))
        .offset(question.offset)
        .limit(question.limit)

      return { total: counted?.total ?? 0, waiting: counted?.waiting ?? 0, rows }
    })
    const named = await this.named(
      identity,
      read.rows.map(({ activity }) => activity.responsibleUserId),
    )

    return {
      total: read.total,
      waiting: read.waiting,
      more: question.offset + read.rows.length < read.total,
      orders: read.rows.map(({ activity, order, rejected }) =>
        entryOf(activity as Activity, order as WorkOrder, rejected, named),
      ),
    }
  }

  /**
   * Who may be named on a work order at a property: the people who perform
   * activities, see its area and are not shut out. For whoever plans, and
   * the name and nothing else of each person.
   */
  @Get('candidates')
  @RequiresPermission('activity.write')
  async candidates(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<WorkOrderCandidates> {
    const propertyId = said(query, 'property')

    if (propertyId === undefined) {
      throw new BadRequestException('Wer zur Wahl steht, hängt an der Liegenschaft. Sie fehlt.')
    }

    const found = await this.database.forTenant(identity, async (tx) => {
      const property = await placeOf<Property>(
        tx,
        properties,
        propertyId,
        'Diese Liegenschaft gibt es nicht oder nicht mehr.',
      )

      return candidatesIn(tx, property.areaId)
    })
    const named = await this.named(identity, found.performers)

    return {
      people: found.performers
        .map((userId) => named(userId))
        .filter((person) => person !== null)
        .sort((left, right) => left.name.localeCompare(right.name, 'de')),
    }
  }

  /**
   * The page of a work order: what the list says, where it came from, the
   * further people who work on it, its signatures with whether each counts,
   * and the decisions on it.
   */
  @Get(':id')
  @RequiresPermission('activity.read')
  async read(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<WorkOrderDetails> {
    const read = await this.database.forTenant(identity, async (tx) => {
      const { activity, order } = await orderOf(tx, identity, id)
      const participants = await tx
        .select({ userId: workOrderParticipants.userId })
        .from(workOrderParticipants)
        .where(
          and(
            eq(workOrderParticipants.activityId, activity.id),
            isNull(workOrderParticipants.deletedAt),
          ),
        )
        .orderBy(asc(workOrderParticipants.createdAt), asc(workOrderParticipants.id))
      const signatures = await signaturesWithTheirStanding(tx, activity)
      const decisions = await tx
        .select()
        .from(workOrderDecisions)
        .where(eq(workOrderDecisions.workOrderId, order.id))
        .orderBy(asc(workOrderDecisions.createdAt), asc(workOrderDecisions.id))

      return {
        activity,
        order,
        participants: participants.map((row) => row.userId),
        origin: await originOf(tx, this.catalogue, activity, order),
        signatures,
        decisions,
      }
    })
    const named = await this.named(identity, [
      read.activity.responsibleUserId,
      ...read.participants,
      ...read.signatures.map(({ signature }) => signature.signedBy),
      ...read.decisions.map((decision) => decision.decidedBy),
    ])
    const nameOf = (userId: string) => named(userId)?.name ?? unknownAccount
    const rejected =
      (activityClosable as readonly string[]).includes(read.activity.status) &&
      read.decisions.length > 0

    return {
      ...entryOf(read.activity, read.order, rejected, named),
      createdAt: read.activity.createdAt.toISOString(),
      performedOn: read.activity.performedOn,
      closingReason: read.activity.closingReason,
      origin: read.origin,
      participants: read.participants
        .map((userId) => named(userId))
        .filter((person) => person !== null),
      signatures: read.signatures.map(({ signature, valid }) => ({
        name: nameOf(signature.signedBy),
        role: signature.role,
        signedAt: signature.signedAt.toISOString(),
        deviceInfo: signature.deviceInfo,
        path: signature.path,
        valid,
      })),
      decisions: read.decisions.map((decision) => ({
        decision: decision.decision,
        reason: decision.reason,
        decidedAt: decision.decidedAt.toISOString(),
        name: nameOf(decision.decidedBy),
      })),
    }
  }

  /**
   * A new work order (#117), from a found defect, from the due day of a duty
   * or by hand, with the person who leads it and the further people. Its
   * number is drawn here.
   *
   * One from a defect takes the place of the defect, and the defect is
   * ordered from then on and names it; a defect that is ordered, set right
   * or checked gets none. One for a due day is made as the activity of the
   * duty would be (`makeActivityForDuty`), with the form of its kind, and
   * meets the duty with its acceptance; beside an activity under way for the
   * duty there is none, and a duty that has ended or rests gets none. One
   * made by hand names its place.
   */
  @Post()
  @RequiresPermission('activity.write')
  async create(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<WorkOrderDetails> {
    const values = fieldsOf(
      body,
      [...originFields, ...planFields],
      ['defectId', 'dutyId', 'propertyId', 'buildingId', 'roomId', 'assetId'],
    )
    const origin = values.origin

    if (!(workOrderOrigins as readonly unknown[]).includes(origin)) {
      throw new BadRequestException(
        'Ein Auftrag entsteht aus einem Mangel, aus einem Termin oder von Hand.',
      )
    }

    const plan = planOf(values)

    refuse(workOrderPlanProblems(plan))

    const planned = plan as unknown as WorkOrderPlan
    const now = new Date()
    const made = await this.database.forTenant(identity, async (tx) => {
      let place: Target
      let activityId: ActivityId
      let originDefectId: DefectId | null = null

      if (origin === 'defect') {
        if (!given(values.defectId)) {
          throw new BadRequestException('Ein Auftrag aus einem Mangel nennt den Mangel.')
        }

        const defect = await heldDefect(tx, String(values.defectId))

        if (defect.status !== 'found') {
          throw new ConflictException(
            'Ein Auftrag entsteht aus einem festgestellten Mangel. Dieser ist schon beauftragt, behoben oder nachgeprüft.',
          )
        }

        place = defect
        await allowedPeople(tx, place.areaId, planned)
        activityId = await madeActivity(tx, identity, place, planned)
        originDefectId = defect.id
      } else if (origin === 'duty') {
        if (!given(values.dutyId)) {
          throw new BadRequestException('Ein Auftrag aus einem Termin nennt die Pflicht.')
        }

        const duty = await placeOf<Duty>(tx, duties, String(values.dutyId), missingDuty)

        await dutyTakesAnActivity(tx, this.catalogue, duty)
        place = duty
        await allowedPeople(tx, place.areaId, planned)

        const result = await makeActivityForDuty(tx, this.catalogue, {
          tenantId: identity.tenantId,
          dutyId: duty.id as DutyId,
          dueOn: planned.dueOn,
          responsible: planned.responsibleUserId,
          now,
          workOrder: { title: planned.title.trim() },
        })

        if (result.made === null) {
          if (result.because === 'missing') {
            throw new NotFoundException(missingDuty)
          }

          throw new ConflictException(
            'Für diese Pflicht läuft schon ein Vorgang. Ein Auftrag für ihren Termin entsteht erst, wenn er erledigt oder geschlossen ist.',
          )
        }

        activityId = result.made
      } else {
        place = await targetOf(tx, values, 'Ein Auftrag')
        await allowedPeople(tx, place.areaId, planned)
        activityId = await madeActivity(tx, identity, place, planned)
      }

      const [order] = await tx
        .insert(workOrders)
        .values({
          tenantId: identity.tenantId,
          propertyId: place.propertyId,
          areaId: place.areaId,
          activityId,
          number: await assignNumber(tx, identity.tenantId, 'work_order', now),
          kind: planned.kind,
          urgency: planned.urgency,
          originDefectId,
        })
        .returning({ id: workOrders.id })

      if (order === undefined) {
        throw new Error('The work order was not written')
      }

      await takeOnParticipants(tx, identity, place, activityId, [], planned.participantUserIds)

      if (originDefectId !== null) {
        await tx
          .update(defects)
          .set({ status: 'ordered', remedyWorkOrderId: order.id })
          .where(eq(defects.id, originDefectId))
      }

      return activityId
    })

    return this.read(identity, made)
  }

  /**
   * A work order changed by whoever plans and hands out work, until it is
   * signed: its title, kind, urgency, due day, the person who leads it and
   * the further people. A person named anew is one of the candidates; one
   * named before stays named, also when they could not be named anew. A
   * further person taken off the order is marked, and the device lets go of
   * the order with the next sync.
   */
  @Put(':id')
  @RequiresPermission('activity.write')
  async change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WorkOrderDetails> {
    const plan = planOf(fieldsOf(body, planFields))

    refuse(workOrderPlanProblems(plan))

    const planned = plan as unknown as WorkOrderPlan

    await this.database.forTenant(identity, async (tx) => {
      const { activity, order } = await orderOf(tx, identity, id)
      const before = await participantsOf(tx, activity.id)
      const { performers } = await candidatesIn(tx, activity.areaId)

      if (
        planned.responsibleUserId !== activity.responsibleUserId &&
        !performers.includes(planned.responsibleUserId)
      ) {
        throw new BadRequestException(leadsSentence)
      }

      if (
        planned.participantUserIds.some(
          (userId) => !before.includes(userId) && !performers.includes(userId),
        )
      ) {
        throw new BadRequestException(participatesSentence)
      }

      const [changed] = await tx
        .update(activities)
        .set({
          title: planned.title.trim(),
          dueOn: planned.dueOn,
          responsibleUserId: planned.responsibleUserId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(activities.id, activity.id), inArray(activities.status, [...activityClosable])),
        )
        .returning({ id: activities.id })

      // Whoever signed it meanwhile signed the order as it was.
      if (changed === undefined) {
        throw new ConflictException(
          'Geändert wird ein Auftrag, solange er offen oder begonnen ist. Dieser ist schon unterschrieben oder abgenommen.',
        )
      }

      await tx
        .update(workOrders)
        .set({ kind: planned.kind, urgency: planned.urgency })
        .where(eq(workOrders.id, order.id))
      await takeOnParticipants(
        tx,
        identity,
        activity,
        activity.id,
        before,
        planned.participantUserIds,
      )
    })

    return this.read(identity, id)
  }

  /**
   * A work order closed as not performed, with the reason (section 4.8 of the
   * concept from v0.19, #117): one that was made by mistake, for instance,
   * while it is open or begun, by whoever plans and hands out work. It is not
   * opened again. The defect it was to set right is found again and waits for
   * a new order, and a duty whose due day it was to meet takes "not
   * performed" with the same reason, without an evidence and without its due
   * day moving (`closeAsNotPerformed`).
   */
  @Post(':id/close')
  @RequiresPermission('activity.write')
  async close(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WorkOrderDetails> {
    const { closingReason } = fieldsOf(body, ['closingReason'] as const)

    refuse(activityProblems({ status: 'not_performed', closingReason: closingReason ?? null }))

    await this.database.forTenant(identity, async (tx) => {
      const { activity } = await orderOf(tx, identity, id)

      // Whoever signed it meanwhile signed the order, which waits for its acceptance.
      if (!(await closeAsNotPerformed(tx, activity.id, closingReason as string))) {
        throw new ConflictException(
          'Geschlossen wird ein Auftrag, solange er offen oder begonnen ist. Dieser ist schon unterschrieben oder abgenommen.',
        )
      }

      await defectsFollowTheirOrder(tx, identity.tenantId, activity.id, 'found')
    })

    return this.read(identity, id)
  }

  /**
   * The acceptance of a signed work order, or its rejection with the reason
   * (section 4.8 of the concept), by whoever accepts work orders. An
   * acceptance writes the order down, one evidence per duty it meets; a
   * rejection leaves the signature standing and invalid, the work goes on,
   * and the defect it sets right is ordered again (`decideWorkOrder`).
   */
  @Post(':id/decision')
  @RequiresPermission('activity.accept')
  async decide(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WorkOrderDetails> {
    const values = fieldsOf(body, ['decision', 'reason'] as const, ['reason'])
    const reason = typeof values.reason === 'string' ? values.reason : null

    if (!(workOrderDecisionKinds as readonly unknown[]).includes(values.decision)) {
      throw new BadRequestException('Ein Auftrag wird abgenommen oder zurückgewiesen.')
    }

    if (values.decision === 'rejected' && reason === null) {
      throw new BadRequestException('Eine Zurückweisung nennt ihren Grund.')
    }

    if (reason !== null && reason.length > signatureLimits.decisionReason) {
      throw new BadRequestException(
        `Der Grund hat höchstens ${String(signatureLimits.decisionReason)} Zeichen.`,
      )
    }

    // The names the evidence states are asked of the instance, outside a
    // tenant: of the people who signed, who performed it and who accepts.
    const known = await this.database.forTenant(identity, async (tx) => {
      const { activity, order } = await orderOf(tx, identity, id)
      const signers = await tx
        .select({ signedBy: activitySignatures.signedBy })
        .from(activitySignatures)
        .where(eq(activitySignatures.activityId, activity.id))

      return {
        order,
        people: [
          ...signers.map((row) => row.signedBy),
          ...(activity.performerUserId === null ? [] : [activity.performerUserId]),
        ],
      }
    })
    const accounts = await accountsOf(
      this.database,
      [...new Set([identity.userId, ...known.people])],
      identity.userId,
    )

    await this.database.forTenant(identity, async (tx) => {
      try {
        await decideWorkOrder(
          tx,
          {
            tenantId: identity.tenantId,
            writtenBy: identity.userId,
            at: new Date(),
            catalogue: this.catalogue,
            nameOf: (userId) => accounts.get(userId)?.name ?? unknownAccount,
          },
          {
            workOrderId: known.order.id,
            decision: values.decision as (typeof workOrderDecisionKinds)[number],
            reason: values.decision === 'rejected' ? reason : null,
          },
        )
      } catch (error) {
        if (error instanceof SigningRefusal || error instanceof EvidenceRefusal) {
          throw new ConflictException(error.message)
        }

        throw error
      }
    })

    return this.read(identity, id)
  }

  /**
   * The names behind the people a work order names. Asked of the instance
   * for exactly these ids, which keys on each row tie to a membership of
   * this operator.
   */
  private async named(
    identity: Asking,
    userIds: readonly (string | null)[],
  ): Promise<(userId: string | null) => DutyPerson | null> {
    const ids = [...new Set(userIds.filter((userId) => userId !== null))]
    const accounts = await accountsOf(this.database, ids, identity.userId)

    return (userId) =>
      userId === null ? null : { userId, name: accounts.get(userId)?.name ?? unknownAccount }
  }
}

const leadsSentence = 'Den Auftrag führt, wer Vorgänge ausführt und den Bereich sieht.'
const participatesSentence = 'Beteiligt ist, wer Vorgänge ausführt und den Bereich sieht.'

/** A work order as the list shows it, with the person who leads it by their name. */
function entryOf(
  activity: Activity,
  order: WorkOrder,
  rejected: boolean,
  named: (userId: string | null) => DutyPerson | null,
): WorkOrderEntry {
  return {
    id: activity.id,
    workOrderId: order.id,
    number: order.number,
    title: activity.title,
    kind: order.kind,
    urgency: order.urgency,
    status: activity.status,
    rejected,
    dueOn: activity.dueOn,
    propertyId: activity.propertyId,
    areaId: activity.areaId,
    buildingId: activity.buildingId,
    roomId: activity.roomId,
    assetId: activity.assetId,
    responsible: named(activity.responsibleUserId),
  }
}

/**
 * The work order behind the id of its activity, if the person asking is
 * shown it: in their areas, not marked deleted, and for whoever only
 * performs, given to them, worked on by them or given to nobody. Every other
 * gets the same answer as one that is not there.
 */
async function orderOf(
  tx: TenantTransaction,
  identity: Asking,
  id: string,
): Promise<{ readonly activity: Activity; readonly order: WorkOrder }> {
  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  const [row] = await tx
    .select({ activity: activities, order: workOrders })
    .from(activities)
    .innerJoin(workOrders, theirOrder)
    .where(
      and(
        eq(activities.id, id as ActivityId),
        eq(activities.kind, 'work_order'),
        isNull(activities.deletedAt),
        ordersInSight(identity),
      ),
    )

  if (row === undefined) {
    throw new NotFoundException(missing)
  }

  return { activity: row.activity as Activity, order: row.order as WorkOrder }
}

/** A defect the person asking sees, held until the transaction ends, so that two orders of it come one after the other. */
async function heldDefect(tx: TenantTransaction, id: string): Promise<Defect> {
  const seen = await placeOf<Defect>(tx, defects, id, missingDefect)
  const [held] = await tx.select().from(defects).where(eq(defects.id, seen.id)).for('update')

  if (held === undefined) {
    throw new NotFoundException(missingDefect)
  }

  return held as Defect
}

/**
 * Refuses a duty whose due day takes no work order: one whose kind takes no
 * work order as its evidence, one that has ended, and one that rests.
 */
async function dutyTakesAnActivity(
  tx: TenantTransaction,
  catalogue: Catalogue,
  duty: Duty,
): Promise<void> {
  const today = dayInGermany()
  const kind =
    duty.kind === null || duty.kindVersion === null
      ? null
      : catalogue.dutyKindVersion(duty.kind, duty.kindVersion)

  if (!takesAWorkOrder(duty, kind)) {
    throw new ConflictException(
      `Diese Pflichtart nimmt als Nachweis: ${(kind?.definition.evidence.kinds ?? []).map((way) => evidenceKindLabel[way]).join(', ')}. Ein Auftrag erfüllt sie nicht.`,
    )
  }

  if (dutyHasEnded(duty, today)) {
    throw new ConflictException('Eine beendete Pflicht bekommt keinen Vorgang mehr.')
  }

  const [registered] = await dutiesOnADay(tx, today, [duty])

  if (registered?.standing.state === 'dormant') {
    throw new ConflictException(
      'Solange ihre Anlage nicht in Betrieb ist, ruht die Pflicht und bekommt keinen Vorgang.',
    )
  }
}

/** Refuses a person who leads the order or works on it and may not, in the area of its place. */
async function allowedPeople(
  tx: TenantTransaction,
  areaId: string,
  plan: WorkOrderPlan,
): Promise<void> {
  const { performers } = await candidatesIn(tx, areaId)

  if (!performers.includes(plan.responsibleUserId)) {
    throw new BadRequestException(leadsSentence)
  }

  if (plan.participantUserIds.some((userId) => !performers.includes(userId))) {
    throw new BadRequestException(participatesSentence)
  }
}

/** The activity of a work order from a defect or by hand, at its place, led by the person the plan names. */
async function madeActivity(
  tx: TenantTransaction,
  identity: Asking,
  place: Target,
  plan: WorkOrderPlan,
): Promise<ActivityId> {
  const [activity] = await tx
    .insert(activities)
    .values({
      tenantId: identity.tenantId,
      propertyId: place.propertyId,
      areaId: place.areaId,
      buildingId: place.buildingId,
      roomId: place.roomId,
      assetId: place.assetId,
      kind: 'work_order',
      title: plan.title.trim(),
      status: 'open',
      dueOn: plan.dueOn,
      responsibleUserId: plan.responsibleUserId,
      performer: 'own_staff',
    })
    .returning({ id: activities.id })

  if (activity === undefined) {
    throw new Error('The activity of the work order was not written')
  }

  return activity.id as ActivityId
}

/** The further people of a work order, not marked. */
async function participantsOf(tx: TenantTransaction, activityId: ActivityId): Promise<string[]> {
  const rows = await tx
    .select({ userId: workOrderParticipants.userId })
    .from(workOrderParticipants)
    .where(
      and(
        eq(workOrderParticipants.activityId, activityId),
        isNull(workOrderParticipants.deletedAt),
      ),
    )

  return rows.map((row) => row.userId)
}

/** Takes the further people of a work order from `before` to `after`: those left out are marked, the new ones added. */
async function takeOnParticipants(
  tx: TenantTransaction,
  identity: Asking,
  place: Pick<Target, 'propertyId' | 'areaId'>,
  activityId: ActivityId,
  before: readonly string[],
  after: readonly string[],
): Promise<void> {
  const leaving = before.filter((userId) => !after.includes(userId))
  const coming = after.filter((userId) => !before.includes(userId))

  if (leaving.length > 0) {
    await tx
      .update(workOrderParticipants)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workOrderParticipants.activityId, activityId),
          inArray(workOrderParticipants.userId, leaving),
          isNull(workOrderParticipants.deletedAt),
        ),
      )
  }

  if (coming.length > 0) {
    await tx.insert(workOrderParticipants).values(
      coming.map((userId) => ({
        tenantId: identity.tenantId,
        propertyId: place.propertyId,
        areaId: place.areaId,
        activityId,
        userId,
      })),
    )
  }
}

/**
 * Where a work order came from: the defect it names, else the duty its
 * activity meets, else nothing, for one made by hand or on site.
 */
async function originOf(
  tx: TenantTransaction,
  catalogue: Catalogue,
  activity: Activity,
  order: WorkOrder,
): Promise<WorkOrderOrigin> {
  if (order.originDefectId !== null) {
    const [defect] = await tx
      .select({ id: defects.id, description: defects.description, foundOn: defects.foundOn })
      .from(defects)
      .where(eq(defects.id, order.originDefectId))

    if (defect !== undefined) {
      return {
        kind: 'defect',
        defectId: defect.id as DefectId,
        description: defect.description,
        foundOn: defect.foundOn,
      }
    }
  }

  const [line] = await tx
    .select({ duty: duties })
    .from(activityDuties)
    .innerJoin(
      duties,
      and(eq(duties.tenantId, activityDuties.tenantId), eq(duties.id, activityDuties.dutyId)),
    )
    .where(and(eq(activityDuties.activityId, activity.id), isNull(activityDuties.deletedAt)))
    .orderBy(asc(activityDuties.id))
    .limit(1)

  if (line !== undefined) {
    return {
      kind: 'duty',
      dutyId: line.duty.id as DutyId,
      title: dutyTitle(line.duty as Duty, catalogue),
    }
  }

  return { kind: 'hand' }
}
