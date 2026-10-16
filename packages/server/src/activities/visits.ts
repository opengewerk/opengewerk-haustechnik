import {
  type ActivityId,
  type BriefingEntry,
  briefingProblems,
  briefsAtWorkOrder,
  type Catalogue,
  type ContractorId,
  type ContractorVisits,
  formOfActivity,
  hotWorkPermitForm,
  permitAnswersProblems,
  permitSignerName,
  type TenantId,
  type WorkPermitEntry,
  workPermitProblems,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'

import {
  activities,
  briefings,
  contractors,
  workOrders,
  workPermits,
} from '../database/schema/index.js'
import { activityOf, signedAtLeeway, SigningRefusal } from './signing.js'

// A contractor at work at a work order (section 4.11 of the concept, #330):
// the briefing of one of its people and the permit for hot work, taken on the
// device of whoever leads the order or plans and hands out work, also without
// a connection. The sync checks each against the order as the server holds
// it, as it checks the client's signature under a service report, and the
// database keeps each as it was written.

/** What a briefing and a permit share as they arrive from the device. */
interface VisitToCheck {
  readonly activityId: ActivityId
  readonly contractorId: ContractorId
  readonly signedAt: Date
  /** The person signed in on the device, whom the record names. */
  readonly signedBy: string
  /** The rights of that person. */
  readonly rights: readonly string[]
}

/** A briefing as it arrives from the device. */
export interface BriefingToCheck extends VisitToCheck {
  readonly personName: string
  readonly subject: string
  readonly path: string | null
  readonly deviceInfo: string | null
}

/** A permit as it arrives from the device. */
export interface WorkPermitToCheck extends VisitToCheck {
  readonly formKey: string
  readonly formVersion: number
  readonly answers: unknown
  readonly deviceInfo: string | null
}

const whoBriefs =
  'Einweisen und einen Erlaubnisschein ausstellen kann, wer den Auftrag führt oder Arbeit plant und verteilt.'

/**
 * The order a briefing or a permit is for, checked as the server holds it:
 * a work order under way that a firm of the list carries out, the firm the
 * device named, and a person who leads it or plans and hands out work. The
 * row of the activity is held until the transaction ends.
 */
async function orderOfVisit(
  tx: TenantTransaction,
  tenantId: TenantId,
  input: VisitToCheck,
  at: Date,
): Promise<void> {
  if (Number.isNaN(input.signedAt.getTime())) {
    throw new SigningRefusal('Der Zeitpunkt der Unterschrift fehlt.')
  }

  if (input.signedAt.getTime() > at.getTime() + signedAtLeeway) {
    throw new SigningRefusal(
      'Der Zeitpunkt der Unterschrift liegt nach jetzt. Die Uhr des Geräts geht vor.',
    )
  }

  const activity = await activityOf(tx, tenantId, input.activityId, true)

  if (activity.kind !== 'work_order') {
    throw new SigningRefusal('Eine Einweisung und einen Erlaubnisschein gibt es zu einem Auftrag.')
  }

  if (activity.status !== 'open' && activity.status !== 'started') {
    throw new SigningRefusal('Dieser Auftrag ist schon unterschrieben oder geschlossen.', 'closed')
  }

  // The firm the office named while the device was away is another one.
  if (activity.contractorId === null || activity.contractorId !== input.contractorId) {
    throw new SigningRefusal(
      activity.contractorId === null
        ? 'Diesen Auftrag führt keine Fremdfirma aus der Liste aus.'
        : 'Diesen Auftrag führt inzwischen eine andere Fremdfirma aus.',
      'person',
    )
  }

  if (!briefsAtWorkOrder(activity, input.signedBy, input.rights)) {
    throw new SigningRefusal(whoBriefs, 'person')
  }
}

/**
 * Checks a briefing before it is written (#330): its shape, the clock of the
 * device and the order. Each refusal is a `SigningRefusal`, answered by the
 * sync as one of a signature.
 */
export async function checkBriefing(
  tx: TenantTransaction,
  tenantId: TenantId,
  input: BriefingToCheck,
  at: Date = new Date(),
): Promise<void> {
  const firstProblem = Object.values(
    briefingProblems({
      personName: input.personName,
      subject: input.subject,
      path: input.path,
      deviceInfo: input.deviceInfo,
    }),
  )[0]

  if (firstProblem !== undefined) {
    throw new SigningRefusal(firstProblem)
  }

  await orderOfVisit(tx, tenantId, input, at)
}

/**
 * Checks a permit before it is written (#330): the form, which is the permit
 * for hot work in a version the catalogue holds, what was entered against
 * that version, every required field and the signature of whoever carries
 * the work out among it, the clock of the device and the order.
 */
export async function checkWorkPermit(
  tx: TenantTransaction,
  tenantId: TenantId,
  catalogue: Catalogue,
  input: WorkPermitToCheck,
  at: Date = new Date(),
): Promise<void> {
  const firstProblem = Object.values(workPermitProblems({ deviceInfo: input.deviceInfo }))[0]

  if (firstProblem !== undefined) {
    throw new SigningRefusal(firstProblem)
  }

  const form =
    input.formKey === hotWorkPermitForm && Number.isInteger(input.formVersion)
      ? formOfActivity(catalogue, { formKey: input.formKey, formVersion: input.formVersion })
      : null

  if (form === null || form === undefined) {
    throw new SigningRefusal(
      'Diesen Erlaubnisschein kennt der Server nicht. Ein Erlaubnisschein ist das Formular aus dem Paket Brandschutz.',
    )
  }

  const missing = permitAnswersProblems(form, input.answers)[0]

  if (missing !== undefined) {
    throw new SigningRefusal(missing)
  }

  await orderOfVisit(tx, tenantId, input, at)
}

/** The order and the firm beside a briefing or a permit. */
const orderColumns = {
  orderNumber: workOrders.number,
  orderTitle: activities.title,
  contractorName: contractors.name,
}

/** The briefings and permits as read in the transaction, before the names of the accounts are known. */
export interface VisitRows {
  readonly briefings: readonly ({ readonly briefing: typeof briefings.$inferSelect } & OrderWords)[]
  readonly permits: readonly ({ readonly permit: typeof workPermits.$inferSelect } & OrderWords)[]
}

interface OrderWords {
  readonly orderNumber: string | null
  readonly orderTitle: string
  readonly contractorName: string
}

/**
 * The briefings and permits of a work order or of a firm, of the orders a
 * condition on the activity lets through, the latest first, at most `limit`
 * of each where one is given; a row outside the areas of the person is not
 * there to read.
 */
export async function visitRowsOf(
  tx: TenantTransaction,
  of: { readonly activityId: ActivityId } | { readonly contractorId: ContractorId },
  sight: SQL | undefined,
  limit?: number,
): Promise<VisitRows> {
  const ofBriefings =
    'activityId' in of
      ? eq(briefings.activityId, of.activityId)
      : eq(briefings.contractorId, of.contractorId)
  const ofPermits =
    'activityId' in of
      ? eq(workPermits.activityId, of.activityId)
      : eq(workPermits.contractorId, of.contractorId)
  const briefed = tx
    .select({ briefing: briefings, ...orderColumns })
    .from(briefings)
    .innerJoin(activities, eq(activities.id, briefings.activityId))
    .leftJoin(
      workOrders,
      and(eq(workOrders.activityId, activities.id), isNull(workOrders.deletedAt)),
    )
    .innerJoin(contractors, eq(contractors.id, briefings.contractorId))
    .where(and(isNull(briefings.deletedAt), ofBriefings, sight))
    .orderBy(desc(briefings.signedAt), desc(briefings.id))
  const permitted = tx
    .select({ permit: workPermits, ...orderColumns })
    .from(workPermits)
    .innerJoin(activities, eq(activities.id, workPermits.activityId))
    .leftJoin(
      workOrders,
      and(eq(workOrders.activityId, activities.id), isNull(workOrders.deletedAt)),
    )
    .innerJoin(contractors, eq(contractors.id, workPermits.contractorId))
    .where(and(isNull(workPermits.deletedAt), ofPermits, sight))
    .orderBy(desc(workPermits.signedAt), desc(workPermits.id))

  return {
    briefings: limit === undefined ? await briefed : await briefed.limit(limit),
    permits: limit === undefined ? await permitted : await permitted.limit(limit),
  }
}

/** The accounts the briefings and permits name, to be read on the instance. */
export function visitAccounts(rows: VisitRows): readonly string[] {
  return [
    ...new Set([
      ...rows.briefings.map(({ briefing }) => briefing.signedBy),
      ...rows.permits.map(({ permit }) => permit.signedBy),
    ]),
  ]
}

/**
 * The briefings and permits as the office reads them: who held the device
 * by `nameOf`, a permit with its form in the version it names.
 */
export function visitsOf(
  rows: VisitRows,
  catalogue: Catalogue,
  nameOf: (userId: string) => string,
): ContractorVisits {
  return {
    briefings: rows.briefings.map(({ briefing, ...order }): BriefingEntry => ({
      id: briefing.id,
      activityId: briefing.activityId,
      orderNumber: order.orderNumber,
      orderTitle: order.orderTitle,
      contractorId: briefing.contractorId,
      contractorName: order.contractorName,
      personName: briefing.personName,
      subject: briefing.subject,
      path: briefing.path,
      signedByName: nameOf(briefing.signedBy),
      signedAt: briefing.signedAt.toISOString(),
    })),
    permits: rows.permits.map(({ permit, ...order }): WorkPermitEntry => {
      const form = formOfActivity(catalogue, permit) ?? null
      const answers = permit.answers

      return {
        id: permit.id,
        activityId: permit.activityId,
        orderNumber: order.orderNumber,
        orderTitle: order.orderTitle,
        contractorId: permit.contractorId,
        contractorName: order.contractorName,
        formKey: permit.formKey,
        formVersion: permit.formVersion,
        form,
        answers,
        signerName: form === null ? null : permitSignerName(form, answers),
        signedByName: nameOf(permit.signedBy),
        signedAt: permit.signedAt.toISOString(),
      }
    }),
  }
}
