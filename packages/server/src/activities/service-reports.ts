import {
  type ActivityId,
  defaultWorkOrderSettings,
  finishesWorkOrder,
  type ServiceReportId,
  serviceReportPageOf,
  serviceReportProblems,
  type ServiceReportState,
  serviceReportStateVersion,
  serviceReportValid,
  type TenantId,
  type WorkOrderSettings,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import {
  properties,
  serviceReportRecords,
  serviceReports,
  workOrderDecisions,
  workOrderNotes,
  workOrders,
  workOrderSettings,
} from '../database/schema/index.js'
import { stateFingerprint } from '../evidence/fingerprint.js'
import { placeOf, type WritingContext } from '../evidence/write.js'
import { dayInGermany } from '../today.js'
import { activityOf, pageOf, signedAtLeeway, SigningRefusal } from './signing.js'

// The service report of a work order (section 4.8 of the concept, #324): the
// client signs on the device of whoever finishes the order, before the own
// signature, also without a connection. The sync checks the report against
// the order as the server holds it, as it checks a signature, and once it is
// written the server freezes the report in the same transaction; the PDF is
// made of that frozen state and never of the current records.

/** The client's signature under a service report as it arrives from the device. */
export interface ServiceReportToCheck {
  readonly activityId: ActivityId
  readonly clientName: string
  readonly path: string | null
  readonly signedAt: Date
  readonly deviceInfo: string | null
  readonly pageFingerprint: string
  /** The person signed in on the device, whose account covers the page. */
  readonly signedBy: string
}

/** The settings of the work orders of the operator of the transaction, or the defaults. */
export async function workOrderSettingsOf(tx: TenantTransaction): Promise<WorkOrderSettings> {
  const [row] = await tx
    .select({ namesAndTimes: workOrderSettings.namesAndTimes })
    .from(workOrderSettings)

  return row ?? defaultWorkOrderSettings
}

/** The decisions on the work order of an activity, the first first. */
async function decisionsOf(tx: TenantTransaction, tenantId: TenantId, activityId: ActivityId) {
  return tx
    .select({
      id: workOrderDecisions.id,
      decision: workOrderDecisions.decision,
      decidedAt: workOrderDecisions.decidedAt,
      createdAt: workOrderDecisions.createdAt,
    })
    .from(workOrderDecisions)
    .innerJoin(
      workOrders,
      and(
        eq(workOrders.tenantId, workOrderDecisions.tenantId),
        eq(workOrders.id, workOrderDecisions.workOrderId),
      ),
    )
    .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.activityId, activityId)))
    .orderBy(asc(workOrderDecisions.createdAt), asc(workOrderDecisions.id))
}

/**
 * The service reports of an activity, the first first, each with whether it
 * counts and the rejection that made it invalid.
 */
export async function serviceReportsOf(
  tx: TenantTransaction,
  tenantId: TenantId,
  activityId: ActivityId,
) {
  const reports = await tx
    .select()
    .from(serviceReports)
    .where(and(eq(serviceReports.tenantId, tenantId), eq(serviceReports.activityId, activityId)))
    .orderBy(asc(serviceReports.createdAt), asc(serviceReports.id))
  const decisions = await decisionsOf(tx, tenantId, activityId)

  return reports.map((report) => {
    const voidedBy =
      decisions.find(
        (decision) =>
          decision.decision === 'rejected' &&
          decision.createdAt.getTime() >= report.createdAt.getTime(),
      ) ?? null

    return { report, valid: serviceReportValid(report, decisions), voidedBy }
  })
}

/**
 * Checks the client's signature under a service report before it is written
 * (#324), as `checkSignature` checks a signature: the shape of what arrives,
 * the clock of the device, the order, which is a work order still under way,
 * the person, who is the one finishing it, the page, which is the one the
 * server works out with the setting of the operator, and that the order has
 * no report that counts. Each refusal is a `SigningRefusal`, and the sync
 * answers it as it answers one of a signature.
 *
 * The row of the activity is held until the transaction ends, so that two
 * devices sending a report for the same order at once wait for each other,
 * and the second finds the first.
 */
export async function checkServiceReport(
  tx: TenantTransaction,
  tenantId: TenantId,
  input: ServiceReportToCheck,
  at: Date = new Date(),
): Promise<void> {
  const firstProblem = Object.values(
    serviceReportProblems({
      clientName: input.clientName,
      path: input.path,
      pageFingerprint: input.pageFingerprint,
      deviceInfo: input.deviceInfo,
    }),
  )[0]

  if (firstProblem !== undefined) {
    throw new SigningRefusal(firstProblem)
  }

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
    throw new SigningRefusal('Einen Leistungsnachweis gibt es zu einem Auftrag.')
  }

  if (activity.status !== 'open' && activity.status !== 'started') {
    throw new SigningRefusal('Dieser Auftrag ist schon unterschrieben oder geschlossen.', 'closed')
  }

  // The report is a step of finishing the order (4.8), which is the person's
  // who answers for it.
  if (!finishesWorkOrder(activity, input.signedBy)) {
    throw new SigningRefusal(
      activity.responsibleUserId === null
        ? 'Diesen Auftrag führt noch niemand. Den Leistungsnachweis nimmt auf, wem das Büro ihn gibt.'
        : 'Den Leistungsnachweis nimmt auf, wer den Auftrag führt.',
      'person',
    )
  }

  const settings = await workOrderSettingsOf(tx)
  const page = serviceReportPageOf(
    await pageOf(tx, activity),
    input.clientName,
    settings.namesAndTimes,
  )

  if (input.pageFingerprint !== stateFingerprint(page)) {
    throw new SigningRefusal(
      'Die Seite hat sich geändert, seit sie gezeigt wurde. Sie wird neu gezeigt und neu unterschrieben.',
      'page',
    )
  }

  // One per order over all its visits (4.8): a new one only after a
  // rejection made the last one invalid.
  if ((await serviceReportsOf(tx, tenantId, activity.id)).some(({ valid }) => valid)) {
    throw new SigningRefusal('Dieser Auftrag hat schon einen Leistungsnachweis.', 'turn')
  }
}

/**
 * Freezes a service report once it is written, in the same transaction
 * (2.6, #324): the order with its number, kind and title, the place, the
 * notes, the time spent, the client's name and drawing and the name of the
 * account that held the device; with the setting of the operator on, who
 * wrote each note and when and the moment of the client's signature,
 * otherwise the day only. No price is part of it.
 */
export async function freezeServiceReport(
  tx: TenantTransaction,
  context: WritingContext,
  reportId: ServiceReportId,
): Promise<void> {
  const [report] = await tx
    .select()
    .from(serviceReports)
    .where(and(eq(serviceReports.tenantId, context.tenantId), eq(serviceReports.id, reportId)))

  if (!report) {
    throw new Error('The service report to freeze was not written')
  }

  const activity = await activityOf(tx, context.tenantId, report.activityId)
  const [order] = await tx
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, context.tenantId),
        eq(workOrders.activityId, activity.id),
        isNull(workOrders.deletedAt),
      ),
    )
  const [property] = await tx
    .select()
    .from(properties)
    .where(and(eq(properties.tenantId, context.tenantId), eq(properties.id, activity.propertyId)))

  if (!order || !property) {
    throw new SigningRefusal('Diesen Auftrag gibt es nicht.', 'activity')
  }

  const notes = await tx
    .select()
    .from(workOrderNotes)
    .where(
      and(
        eq(workOrderNotes.tenantId, context.tenantId),
        eq(workOrderNotes.activityId, activity.id),
        isNull(workOrderNotes.deletedAt),
      ),
    )
    .orderBy(asc(workOrderNotes.writtenAt), asc(workOrderNotes.id))
  const { namesAndTimes } = await workOrderSettingsOf(tx)
  const state: ServiceReportState = {
    version: serviceReportStateVersion,
    workOrder: { number: order.number, kind: order.kind, title: activity.title },
    place: await placeOf(tx, context, activity, {
      name: property.name,
      address: `${property.street}, ${property.postalCode} ${property.city}`,
    }),
    work: notes.map((note) =>
      namesAndTimes
        ? {
            text: note.text,
            writtenAt: note.writtenAt.toISOString(),
            writtenBy: context.nameOf(note.writtenBy),
          }
        : { text: note.text },
    ),
    durationMinutes: order.durationMinutes,
    client: {
      name: report.clientName,
      path: report.path,
      signedOn: dayInGermany(report.signedAt),
      ...(namesAndTimes ? { signedAt: report.signedAt.toISOString() } : {}),
    },
    namesAndTimes,
    holder: context.nameOf(report.signedBy),
    pageFingerprint: report.pageFingerprint,
  }

  await tx.insert(serviceReportRecords).values({
    tenantId: context.tenantId,
    propertyId: report.propertyId,
    areaId: report.areaId,
    serviceReportId: report.id,
    state,
    fingerprint: stateFingerprint(state),
  })
}

/** The fingerprint the page of a service report has for an activity, a name and the setting. */
export async function serviceReportFingerprint(
  tx: TenantTransaction,
  activityId: ActivityId,
  tenantId: TenantId,
  clientName: string,
): Promise<string> {
  const activity = await activityOf(tx, tenantId, activityId)
  const settings = await workOrderSettingsOf(tx)

  return stateFingerprint(
    serviceReportPageOf(await pageOf(tx, activity), clientName, settings.namesAndTimes),
  )
}
