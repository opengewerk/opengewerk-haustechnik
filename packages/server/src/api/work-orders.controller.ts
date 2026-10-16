import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common'
import {
  basicMeasureOf,
  type Activity,
  activityClosable,
  type ActivityId,
  activityProblems,
  byNameIn,
  type Catalogue,
  type Defect,
  type DefectId,
  type Duty,
  dutyHasEnded,
  evidenceKindLabel,
  type DutyId,
  type DutyPerson,
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
  type WorkOrderSettings,
  workOrderSettingsProblems,
  isCalendarDay,
  type OrderWarranty,
  type ContractorId,
  type ContractorVisits,
  type AssetId,
  type FaultReportId,
  isAllowed,
  missingRight,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  isUuid,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { materialsOf } from '../activities/materials.js'
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'

import { closeAsNotPerformed } from '../activities/closing.js'
import { serviceReportsOf, workOrderSettingsOf } from '../activities/service-reports.js'
import { makeActivityForDuty } from '../activities/for-duty.js'
import {
  decideWorkOrder,
  defectsFollowTheirOrder,
  SigningRefusal,
  signaturesWithTheirStanding,
} from '../activities/signing.js'
import { visitAccounts, visitRowsOf, visitsOf } from '../activities/visits.js'
import { CATALOGUE } from '../catalogue.js'
import { dutiesOnADay, dutyTitle } from '../database/duty-standing.js'
import { assignNumber } from '../database/number-ranges.js'
import {
  activities,
  activityDuties,
  activitySignatures,
  defects,
  duties,
  faultReports,
  properties,
  workOrderDecisions,
  workOrderNotes,
  workOrderParticipants,
  workOrders,
  workOrderSettings,
} from '../database/schema/index.js'
import { EvidenceRefusal } from '../evidence/write.js'
import { rowOf as faultRowOf, stateOf as faultStateOf } from '../faults/reading.js'
import { tellHandedOut } from '../notifications/tell.js'
import { dayInGermany } from '../today.js'
import { candidatesIn, containing, inSight } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { checkContractor } from './contractor-checks.js'
import { type Asking, fieldsOf, given, placeOf, refuse, type Target, targetOf } from './places.js'
import { counted, said } from './register-question.js'
import { wholeList, workOrderTable } from './office-tables.js'

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
export function ordersInSight(identity: Asking): SQL | undefined {
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

/**
 * Who carries an order out once the office names it (#330): a firm of the
 * list, or the own people. What only one of the two says goes with the other.
 */
function performedBy(
  contractorId: ContractorId | null,
  activity: Pick<Activity, 'contractorNote' | 'performerUserId'>,
) {
  return contractorId === null
    ? { performer: 'own_staff' as const, contractorId: null, contractorNote: null }
    : {
        performer: 'contractor' as const,
        contractorId,
        contractorNote: activity.contractorNote,
        performerUserId: null,
      }
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
    // The basic measure of a work order of another kind (#333).
    measure: values['measure'] ?? null,
    urgency: values['urgency'] ?? null,
    dueOn: values['dueOn'] ?? null,
    responsibleUserId: values['responsibleUserId'] ?? null,
    participantUserIds: values['participantUserIds'] ?? [],
    // The firm that carries it out (#330); left out, a change keeps it.
    ...('contractorId' in values ? { contractorId: values['contractorId'] ?? null } : {}),
  }
}

const planFields = [
  'title',
  'kind',
  'measure',
  'urgency',
  'dueOn',
  'responsibleUserId',
  'participantUserIds',
  'contractorId',
] as const

const originFields = [
  'origin',
  'defectId',
  'faultReportId',
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
  list(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<WorkOrderList> {
    return this.page(identity, questionOf(query))
  }

  /**
   * The list as a table (#236): every order the filter of the list passes, and
   * not a page, in the order of the list, as a workbook or as text
   * (`?format=xlsx` or `csv`). Whoever reads the list reads its table, with
   * what the list shows the person; the places and the assets only for whoever
   * reads them, the people only for the Leitung.
   *
   * Before an order, or its address would be read as an id.
   */
  @Get('table')
  @RequiresPermission('activity.read')
  @Header('Cache-Control', 'no-store')
  async table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const today = dayInGermany()
    const { orders } = await this.page(identity, { ...questionOf(query), ...wholeList })

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(await workOrderTable(tx, identity, orders, today), format, today),
    )
  }

  /** A page of the list, or all of it for its table. */
  private async page(identity: Asking, question: WorkOrderQuestion): Promise<WorkOrderList> {
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
   * the name and nothing else of each person. A building, room or asset named
   * beside the property gives the area, which is its own where its building
   * has one (ADR 0003, addendum of #306).
   */
  /**
   * The accepted work orders at an asset that carry a warranty of their own
   * (#329), as the record of the asset names them in "Verträge und
   * Gewährleistung": those whoever asks sees, the latest end first.
   */
  @Get('warranties')
  @RequiresPermission('activity.read')
  warranties(
    @CurrentIdentity() identity: Asking,
    @Query('assetId') assetId: unknown,
  ): Promise<OrderWarranty[]> {
    return this.database.forTenant(identity, async (tx) => {
      if (typeof assetId !== 'string' || !isUuid(assetId)) {
        return []
      }

      const rows = await tx
        .select({
          id: activities.id,
          number: workOrders.number,
          title: activities.title,
          warrantyEndsOn: workOrders.warrantyEndsOn,
        })
        .from(activities)
        .innerJoin(workOrders, theirOrder)
        .where(
          and(
            eq(activities.assetId, assetId as AssetId),
            eq(activities.kind, 'work_order'),
            eq(activities.status, 'done'),
            isNull(activities.deletedAt),
            isNotNull(workOrders.warrantyEndsOn),
            ordersInSight(identity),
          ),
        )
        .orderBy(desc(workOrders.warrantyEndsOn))
        .limit(50)

      return rows.map((row) => ({ ...row, warrantyEndsOn: row.warrantyEndsOn as string }))
    })
  }

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
      const place = await targetOf(
        tx,
        {
          propertyId,
          buildingId: said(query, 'building'),
          roomId: said(query, 'room'),
          assetId: said(query, 'asset'),
        },
        'Ein Auftrag',
      )

      return candidatesIn(tx, place.areaId)
    })
    const named = await this.named(identity, found.performers)

    return {
      people: found.performers
        .map((userId) => named(userId))
        .filter((person) => person !== null)
        .sort((left, right) => byNameIn(left.name, right.name)),
    }
  }

  /**
   * The briefings and permits for hot work at a work order (#330), the latest
   * first, each permit with its form in the version it was made in. Taken on
   * site; read here and changed nowhere.
   */
  @Get(':id/visits')
  @RequiresPermission('activity.read')
  async visits(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<ContractorVisits> {
    const rows = await this.database.forTenant(identity, async (tx) => {
      const { activity } = await orderOf(tx, identity, id)

      return visitRowsOf(tx, { activityId: activity.id }, undefined)
    })
    const named = await this.named(identity, visitAccounts(rows))

    return visitsOf(rows, this.catalogue, (userId) => named(userId)?.name ?? unknownAccount)
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
      const notes = await tx
        .select()
        .from(workOrderNotes)
        .where(and(eq(workOrderNotes.activityId, activity.id), isNull(workOrderNotes.deletedAt)))
        .orderBy(asc(workOrderNotes.writtenAt), asc(workOrderNotes.id))
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
        notes,
        signatures,
        decisions,
        reports: await serviceReportsOf(tx, identity.tenantId, activity.id),
        materials: await materialsOf(tx, activity.id),
      }
    })
    const named = await this.named(identity, [
      read.activity.responsibleUserId,
      ...read.participants,
      ...read.notes.map((note) => note.writtenBy),
      ...read.signatures.map(({ signature }) => signature.signedBy),
      ...read.decisions.map((decision) => decision.decidedBy),
      ...read.reports.map(({ report }) => report.signedBy),
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
      durationMinutes: read.order.durationMinutes,
      warrantyEndsOn: read.order.warrantyEndsOn,
      contractorId: read.activity.contractorId,
      notes: read.notes.map((note) => ({
        id: note.id,
        text: note.text,
        writtenAt: note.writtenAt.toISOString(),
        name: nameOf(note.writtenBy),
      })),
      signatures: read.signatures.map(({ signature, valid }) => ({
        name: nameOf(signature.signedBy),
        role: signature.role,
        signedAt: signature.signedAt.toISOString(),
        deviceInfo: signature.deviceInfo,
        path: signature.path,
        typedName: signature.typedName,
        valid,
      })),
      decisions: read.decisions.map((decision) => ({
        decision: decision.decision,
        reason: decision.reason,
        decidedAt: decision.decidedAt.toISOString(),
        name: nameOf(decision.decidedBy),
      })),
      serviceReports: read.reports.map(({ report, valid, voidedBy }) => ({
        id: report.id,
        clientName: report.clientName,
        signedAt: report.signedAt.toISOString(),
        holder: nameOf(report.signedBy),
        valid,
        voidedAt: voidedBy === null ? null : voidedBy.decidedAt.toISOString(),
      })),
      materials: read.materials,
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
      ['defectId', 'faultReportId', 'dutyId', 'propertyId', 'buildingId', 'roomId', 'assetId'],
    )
    const origin = values.origin

    if (!(workOrderOrigins as readonly unknown[]).includes(origin)) {
      throw new BadRequestException(
        'Ein Auftrag entsteht aus einer Störmeldung, aus einem Mangel, aus einem Termin oder von Hand.',
      )
    }

    // Accepting a fault report is making its work order (section 4.7 of the
    // concept, #331): whoever does it accepts faults as well as planning work.
    if (origin === 'fault' && !isAllowed(identity, 'fault.accept')) {
      throw new ForbiddenException(missingRight('fault.accept'))
    }

    const plan = planOf(values)

    refuse(workOrderPlanProblems(plan))

    const planned = plan as unknown as WorkOrderPlan
    const now = new Date()
    const made = await this.database.forTenant(identity, async (tx) => {
      let place: Target
      let activityId: ActivityId
      let originDefectId: DefectId | null = null
      let acceptedReport: FaultReportId | null = null

      if (origin === 'fault') {
        if (!given(values.faultReportId)) {
          throw new BadRequestException('Ein Auftrag aus einer Störmeldung nennt die Meldung.')
        }

        if (planned.kind !== 'fault') {
          throw new BadRequestException(
            'Ein Auftrag aus einer Störmeldung ist einer der Art „Störung“.',
          )
        }

        const report = await heldFaultReport(tx, String(values.faultReportId))

        if (faultStateOf(report) !== 'received') {
          throw new ConflictException(
            'Ein Auftrag entsteht aus einer Meldung im Eingang. Diese ist schon angenommen, zusammengeführt, abgelehnt oder erledigt.',
          )
        }

        // At the asset or the room of the report, otherwise at its building.
        place = {
          propertyId: report.report.propertyId,
          areaId: report.report.areaId,
          buildingId:
            report.report.assetId === null && report.report.roomId === null
              ? report.report.buildingId
              : null,
          roomId: report.report.assetId === null ? report.report.roomId : null,
          assetId: report.report.assetId,
        } as Target
        await allowedPeople(tx, place.areaId, planned)
        activityId = await madeActivity(tx, identity, place, planned)
        acceptedReport = report.report.id as FaultReportId
      } else if (origin === 'defect') {
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

      // The firm that carries it out, where the office names one (#330); an
      // order for a duty keeps the performer of the duty otherwise.
      if (planned.contractorId !== undefined && planned.contractorId !== null) {
        await checkContractor(tx, planned.contractorId)
        await tx
          .update(activities)
          .set(performedBy(planned.contractorId, { contractorNote: null, performerUserId: null }))
          .where(eq(activities.id, activityId))
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
          measure: planned.measure,
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

      // The report is accepted with its order and names it; one back in the
      // inbox after an order not performed names the new one (#331).
      if (acceptedReport !== null) {
        await tx
          .update(faultReports)
          .set({ workOrderId: order.id, acceptedAt: now, updatedAt: now })
          .where(eq(faultReports.id, acceptedReport))
      }

      return activityId
    })

    // Whoever leads the order and whoever takes part are told, once it
    // stands (#126); one of the urgency "sofort" reaches whoever leads it
    // whatever they switched off (section 4.8 of the concept).
    await tellHandedOut(
      this.database,
      identity.tenantId,
      identity.userId,
      [planned.responsibleUserId, ...planned.participantUserIds].map((userId) => ({
        activityId: made,
        userId,
        dueOn: planned.dueOn,
      })),
      planned.urgency === 'immediate'
        ? { activityId: made, userId: planned.responsibleUserId }
        : null,
    )

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

    const was = await this.database.forTenant(identity, async (tx) => {
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

      await checkContractor(tx, planned.contractorId)

      const [changed] = await tx
        .update(activities)
        .set({
          title: planned.title.trim(),
          dueOn: planned.dueOn,
          responsibleUserId: planned.responsibleUserId,
          ...(planned.contractorId === undefined
            ? {}
            : performedBy(planned.contractorId, activity)),
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
        .set({ kind: planned.kind, measure: planned.measure, urgency: planned.urgency })
        .where(eq(workOrders.id, order.id))
      await takeOnParticipants(
        tx,
        identity,
        activity,
        activity.id,
        before,
        planned.participantUserIds,
      )

      return {
        activityId: activity.id,
        responsibleUserId: activity.responsibleUserId,
        participants: before,
        urgency: order.urgency,
      }
    })

    // Whoever is named anew is told, and whoever leads an order that is
    // "sofort" from now on, or leads one that is from now on (#126).
    const leadsAnew = planned.responsibleUserId !== was.responsibleUserId

    await tellHandedOut(
      this.database,
      identity.tenantId,
      identity.userId,
      [
        ...(leadsAnew ? [planned.responsibleUserId] : []),
        ...planned.participantUserIds.filter((userId) => !was.participants.includes(userId)),
      ].map((userId) => ({ activityId: was.activityId, userId, dueOn: planned.dueOn })),
      planned.urgency === 'immediate' && (leadsAnew || was.urgency !== 'immediate')
        ? { activityId: was.activityId, userId: planned.responsibleUserId }
        : null,
    )

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
   * The warranty of an accepted work order (4.11, #329): the day it ends, or
   * none, by whoever accepts work orders. Its end is a deadline under
   * "Fristen", and the order stands with it at its asset. An order not yet
   * accepted has no warranty; the work is what the warranty is for.
   */
  @Put(':id/warranty')
  @RequiresPermission('activity.accept')
  async warranty(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WorkOrderDetails> {
    const { warrantyEndsOn } = fieldsOf(body, ['warrantyEndsOn'] as const, ['warrantyEndsOn'])

    if (
      warrantyEndsOn === undefined ||
      (warrantyEndsOn !== null && !isCalendarDay(warrantyEndsOn))
    ) {
      throw new BadRequestException(
        'Das Ende der Gewährleistung ist ein Tag, geschrieben 2026-10-03.',
      )
    }

    await this.database.forTenant(identity, async (tx) => {
      const { activity, order } = await orderOf(tx, identity, id)

      if (activity.status !== 'done') {
        throw new ConflictException('Eine Gewährleistung hat erst ein abgenommener Auftrag.')
      }

      await tx
        .update(workOrders)
        .set({ warrantyEndsOn: warrantyEndsOn as string | null, updatedAt: new Date() })
        .where(eq(workOrders.id, order.id))
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
    measure: basicMeasureOf('work_order', order),
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

  const [registered] = await dutiesOnADay(tx, today, [duty], catalogue)

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
  // The fault report it accepted (#331), in the areas of the person asking.
  const [report] = await tx
    .select({
      id: faultReports.id,
      description: faultReports.description,
      receivedAt: faultReports.receivedAt,
    })
    .from(faultReports)
    .where(eq(faultReports.workOrderId, order.id))
    .limit(1)

  if (report !== undefined) {
    return {
      kind: 'fault',
      faultReportId: report.id as FaultReportId,
      description: report.description,
      receivedAt: report.receivedAt.toISOString(),
    }
  }

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

/**
 * What an operator sets for its work orders under "Einstellungen" (section 15
 * of the concept, #324): whether the service report names the people who did
 * the work and the times of their notes. Seeing and changing it is what the
 * settings take, which section 7 gives to the Leitung. A report already
 * signed keeps what it froze.
 */
@Controller('settings/work-orders')
export class WorkOrderSettingsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('settings.read')
  read(@CurrentIdentity() identity: Asking): Promise<WorkOrderSettings> {
    return this.database.forTenant(identity, (tx) => workOrderSettingsOf(tx))
  }

  @Put()
  @RequiresPermission('settings.write')
  set(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<WorkOrderSettings> {
    const values = fieldsOf(body, ['namesAndTimes'], [])

    refuse(workOrderSettingsProblems(values))

    const namesAndTimes = values.namesAndTimes as boolean

    return this.database.forTenant(identity, async (tx) => {
      await tx
        .insert(workOrderSettings)
        .values({ tenantId: identity.tenantId, namesAndTimes })
        .onConflictDoUpdate({
          target: [workOrderSettings.tenantId],
          set: { namesAndTimes, updatedAt: new Date() },
        })

      return { namesAndTimes }
    })
  }
}

/** A fault report the person asking sees, held until the transaction ends, so that two acceptances of it come one after the other. */
async function heldFaultReport(tx: TenantTransaction, id: string) {
  const missing = 'Diese Störmeldung gibt es nicht oder nicht in Ihren Bereichen.'

  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  await tx
    .select({ id: faultReports.id })
    .from(faultReports)
    .where(eq(faultReports.id, id as (typeof faultReports.$inferSelect)['id']))
    .for('update')

  const row = await faultRowOf(tx, id)

  if (row === null) {
    throw new NotFoundException(missing)
  }

  return row
}
