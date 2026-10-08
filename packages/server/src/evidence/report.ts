import {
  type ActivityId,
  documentTitleOf,
  type DutyId,
  type Report,
  type StatedDefect,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { files } from '@opengewerk/platform-server/schema'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'

import {
  activities,
  activityDuties,
  attachments,
  attachmentVersions,
  defects,
  duties,
} from '../database/schema/index.js'
import {
  EvidenceRefusal,
  holdTheDuty,
  type WritingContext,
  type WrittenEvidence,
  writeEvidence,
} from './write.js'

/** The states of an activity whose work is still to come or still going on. */
const underWay = ['open', 'started', 'signed'] as const

export interface WrittenReport extends WrittenEvidence {
  /** The inspection or maintenance the report settled, if one was open for the duty. */
  readonly activityId: ActivityId | null
}

/**
 * Writes the report of a contractor or an inspection body down as the
 * evidence of a duty (section 4.4 of the concept, #110), in the transaction it
 * is given, so that all of it is there or none:
 *
 * - the file becomes a document at the place of the duty, of the kind
 *   "Prüfbescheinigung", with one version that names the bytes sent ahead of
 *   it. That is where it is found among the documents of the asset;
 * - the defects the report names are found at the place of the duty on the
 *   day of the test;
 * - the evidence names the examiner and the organisation, the day, the
 *   result, the defects and the file as it arrived, by its hash. It hands the
 *   file out itself, so that the evidence keeps it whatever becomes of the
 *   document (ADR 0004);
 * - an inspection or a maintenance that is open for the duty is settled by
 *   the report: done, or not performed with the reason, with the day and the
 *   contractor. One somebody has begun or signed is not taken from them.
 *
 * The next due day follows from the evidence and its day, never from the day
 * the report was entered.
 */
export async function writeReport(
  tx: TenantTransaction,
  context: WritingContext,
  dutyId: DutyId,
  report: Report,
): Promise<WrittenReport> {
  // Two reports of one duty, or a report and a correction, stand in line.
  await holdTheDuty(tx, context.tenantId, dutyId)

  const [duty] = await tx
    .select()
    .from(duties)
    .where(
      and(eq(duties.tenantId, context.tenantId), eq(duties.id, dutyId), isNull(duties.deletedAt)),
    )

  if (!duty) {
    throw new EvidenceRefusal('Diese Pflicht gibt es nicht.')
  }

  const stored = await storedFile(tx, context, report.file.sha256)

  if (stored === null) {
    throw new EvidenceRefusal('Die Datei des Berichts ist nicht auf dem Server.')
  }

  if (stored.sizeBytes !== report.file.sizeBytes) {
    throw new EvidenceRefusal('Die Größe der Datei passt nicht zu der, die auf dem Server liegt.')
  }

  if (
    report.file.previewSha256 !== null &&
    (await storedFile(tx, context, report.file.previewSha256)) === null
  ) {
    throw new EvidenceRefusal('Die Vorschau der Datei ist nicht auf dem Server.')
  }

  const activity = await openActivityOf(tx, context, duty.id)
  const place = {
    tenantId: context.tenantId,
    propertyId: duty.propertyId,
    areaId: duty.areaId,
    buildingId: duty.buildingId,
    roomId: duty.roomId,
    assetId: duty.assetId,
  }
  const [document] = await tx
    .insert(attachments)
    .values({
      ...place,
      title: documentTitleOf(report.file.fileName),
      kind: 'test_certificate',
    })
    .returning({ id: attachments.id })

  if (!document) {
    throw new Error('The document of the report was not written')
  }

  await tx.insert(attachmentVersions).values({
    tenantId: context.tenantId,
    attachmentId: document.id,
    sha256: report.file.sha256,
    fileName: report.file.fileName,
    mediaType: stored.mediaType,
    sizeBytes: stored.sizeBytes,
    previewSha256: report.file.previewSha256,
  })

  if (report.defects.length > 0) {
    await tx.insert(defects).values(
      report.defects.map((defect) => ({
        ...place,
        foundInActivityId: activity,
        description: defect.description,
        defectClass: defect.defectClass,
        foundOn: report.performedOn,
        dueOn: defect.dueOn,
      })),
    )
  }

  const stated: StatedDefect[] = report.defects.map((defect) => ({
    description: defect.description,
    defectClass: defect.defectClass,
    dueOn: defect.dueOn,
  }))
  const written = await writeEvidence(tx, context, {
    dutyId: duty.id,
    activityId: activity,
    origin: 'report',
    performedOn: report.performedOn,
    result: report.result,
    resultReason: report.resultReason,
    performedBy: null,
    examiner: { name: report.examiner, organisation: report.examinerOrganisation },
    signatures: [],
    files: [
      { sha256: report.file.sha256, name: report.file.fileName, mediaType: stored.mediaType },
    ],
    defects: stated,
  })

  if (activity !== null) {
    await settle(tx, context, activity, duty.id, report)
  }

  return { ...written, activityId: activity }
}

/** The size and type of a file the tenant holds, as the server read them; null for one it has not. */
async function storedFile(
  tx: TenantTransaction,
  context: WritingContext,
  sha256: string,
): Promise<{ readonly sizeBytes: number; readonly mediaType: string } | null> {
  const [row] = await tx
    .select({ sizeBytes: files.sizeBytes, mediaType: files.mediaType })
    .from(files)
    .where(and(eq(files.tenantId, context.tenantId), eq(files.sha256, sha256)))

  return row ?? null
}

/**
 * The inspection or maintenance open for the duty, which the report settles,
 * or none. The engine makes one at a time for a duty (#105). One that
 * somebody has begun is on a device and is finished there; one that is signed
 * waits for its evidence. A report settles neither.
 */
async function openActivityOf(
  tx: TenantTransaction,
  context: WritingContext,
  dutyId: DutyId,
): Promise<ActivityId | null> {
  const running = await tx
    .select({ id: activities.id, status: activities.status })
    .from(activityDuties)
    .innerJoin(
      activities,
      and(
        eq(activities.tenantId, activityDuties.tenantId),
        eq(activities.id, activityDuties.activityId),
      ),
    )
    .where(
      and(
        eq(activityDuties.tenantId, context.tenantId),
        eq(activityDuties.dutyId, dutyId),
        isNull(activityDuties.deletedAt),
        isNull(activities.deletedAt),
        inArray(activities.status, [...underWay]),
      ),
    )
    .orderBy(desc(activities.createdAt))

  const signed = running.find((activity) => activity.status === 'signed')

  if (signed) {
    throw new EvidenceRefusal(
      'Für diese Pflicht ist eine Prüfung unterschrieben und wartet auf ihren Nachweis.',
    )
  }

  if (running.some((activity) => activity.status === 'started')) {
    throw new EvidenceRefusal(
      'Für diese Pflicht hat jemand eine Prüfung begonnen. Ein Bericht erledigt nur eine, die noch offen ist.',
    )
  }

  return running[0]?.id ?? null
}

/**
 * Settles the activity of the report: the result for the duty, and once no
 * duty of it is left without one, the activity is done, or not performed
 * with the reason when none of its duties was. It was performed by the
 * contractor the report comes from, on the day of the report.
 */
async function settle(
  tx: TenantTransaction,
  context: WritingContext,
  activityId: ActivityId,
  dutyId: DutyId,
  report: Report,
): Promise<void> {
  const ofTheActivity = and(
    eq(activityDuties.tenantId, context.tenantId),
    eq(activityDuties.activityId, activityId),
    isNull(activityDuties.deletedAt),
  )

  await tx
    .update(activityDuties)
    .set({ result: report.result, resultReason: report.resultReason })
    .where(and(ofTheActivity, eq(activityDuties.dutyId, dutyId)))

  const results = await tx
    .select({ result: activityDuties.result })
    .from(activityDuties)
    .where(ofTheActivity)

  if (results.some((each) => each.result === null)) {
    return
  }

  const notPerformed = results.every((each) => each.result === 'not_performed')

  await tx
    .update(activities)
    .set({
      status: notPerformed ? 'not_performed' : 'done',
      closingReason: notPerformed ? report.resultReason : null,
      performedOn: report.performedOn,
      performer: 'contractor',
      performerUserId: null,
      contractorNote: report.examinerOrganisation,
    })
    .where(and(eq(activities.tenantId, context.tenantId), eq(activities.id, activityId)))
}
