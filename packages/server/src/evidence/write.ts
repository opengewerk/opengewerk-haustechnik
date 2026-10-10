import {
  type ActivityId,
  type AttachmentId,
  type Catalogue,
  type DutyId,
  dutyInterval,
  type EvidenceId,
  evidenceKindLabel,
  evidenceLimits,
  type EvidenceOrigin,
  evidenceProblems,
  type EvidenceResult,
  type EvidenceState,
  evidenceStateVersion,
  formOfActivity,
  type IsoDate,
  roundRecordVersion,
  type RoundRecordState,
  type StatedAnswer,
  type StatedDefect,
  type StatedFile,
  type StatedForm,
  type StatedPerformer,
  type StatedPlace,
  type StatedRetention,
  type StatedReplacement,
  type StatedSignature,
  statedAnswers,
  statedReasonProblem,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'

import { formsFor } from '../activities/template-forms.js'
import { assignNumber } from '../database/number-ranges.js'
import {
  activities,
  activityAnswers,
  activityDuties,
  assets,
  attachmentVersions,
  buildings,
  defects,
  duties,
  evidence,
  evidenceVoidings,
  properties,
  rooms,
  roundRecords,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { stateFingerprint } from './fingerprint.js'

/** What is to be written down: the performance of one duty and who did it. */
export interface EvidenceToWrite {
  readonly dutyId: DutyId
  readonly activityId: ActivityId | null
  readonly origin: EvidenceOrigin
  readonly performedOn: IsoDate
  readonly result: EvidenceResult
  readonly resultReason: string | null
  /**
   * The point of a round whose answer this evidence is (#112, section 4.5 of
   * the concept): its form then holds that one answer and not those of the
   * whole round, which are the evidence of other duties or of none. None for
   * every other evidence.
   */
  readonly point?: string | null
  /** What was said with the result on site (#108); none for a report. */
  readonly remark?: string | null
  /** A person of the operator who did it, or an examiner with the organisation from outside. */
  readonly performedBy: string | null
  readonly examiner: { readonly name: string; readonly organisation: string } | null
  /** The signatures the activity carries, by name and moment (#26, third step). */
  readonly signatures: readonly StatedSignature[]
  /** The files the evidence rests on, by checksum (the documents of phase 1). */
  readonly files: readonly StatedFile[]
  /**
   * The defects as the work names them. A report names its own, with or
   * without an activity; left out, they are the defects found in the
   * activity, as a signed protocol has them.
   */
  readonly defects?: readonly StatedDefect[]
  /**
   * The evidence of the same duty this one corrects, with the reason (ADR
   * 0004, point 14); none for an evidence that corrects nothing.
   */
  readonly replaces?: { readonly evidenceId: EvidenceId; readonly reason: string } | null
}

/** Who writes it down, when, and what the state needs from outside the tenant. */
export interface WritingContext {
  readonly tenantId: TenantId
  readonly writtenBy: string
  readonly at: Date
  readonly catalogue: Catalogue
  /**
   * The name of a person the evidence names. Accounts are read outside a
   * tenant (`accountsOf` of the foundation), so the caller reads them before
   * the transaction, for the people the keys of the evidence tie to a
   * membership here.
   */
  readonly nameOf: (userId: string) => string
}

export interface WrittenEvidence {
  readonly id: EvidenceId
  readonly number: string
  readonly fingerprint: string
  readonly state: EvidenceState
}

/** Why an evidence is not written, in a sentence for the person who wanted it. */
export class EvidenceRefusal extends Error {
  constructor(sentence: string) {
    super(sentence)
    this.name = 'EvidenceRefusal'
  }
}

/**
 * Writes an evidence down (ADR 0004, points 1 to 6 and 10): draws its number
 * from the sequence of the evidence, puts together the frozen state from what
 * the records say today and writes the row with the fingerprint over the
 * state, all in the transaction it is given. Nothing is written when anything
 * is refused, and a refused number goes back with the transaction, so the
 * numbers run without holes in the order the evidence came about.
 *
 * Only the server writes an evidence down; a device signs and waits (ADR
 * 0004, point 10). The four ways of phase 1, the signed protocol, the report,
 * the point of a round and the accepted work order, end here, and so does a
 * correction: a new evidence of the same duty that names the one it
 * replaces, which stays as it is.
 */
export async function writeEvidence(
  tx: TenantTransaction,
  context: WritingContext,
  input: EvidenceToWrite,
): Promise<WrittenEvidence> {
  const problems = evidenceProblems({
    performedOn: input.performedOn,
    result: input.result,
    resultReason: input.resultReason,
    examiner: input.examiner?.name ?? null,
    examinerOrganisation: input.examiner?.organisation ?? null,
  })
  const firstProblem = Object.values(problems)[0]

  if (firstProblem !== undefined) {
    throw new EvidenceRefusal(firstProblem)
  }

  if (input.performedOn > dayInGermany(context.at)) {
    throw new EvidenceRefusal('Ein Nachweis gilt für einen Tag, der schon war.')
  }

  const [duty] = await tx
    .select()
    .from(duties)
    .where(
      and(
        eq(duties.tenantId, context.tenantId),
        eq(duties.id, input.dutyId),
        isNull(duties.deletedAt),
      ),
    )

  if (!duty) {
    throw new EvidenceRefusal('Diese Pflicht gibt es nicht.')
  }

  const kind =
    duty.kind !== null && duty.kindVersion !== null
      ? context.catalogue.dutyKindVersion(duty.kind, duty.kindVersion)
      : null

  if (duty.kind !== null && kind === null) {
    throw new EvidenceRefusal(
      `Die Pflichtart ${duty.kind} in der Fassung ${String(duty.kindVersion)} kennt der Katalog nicht.`,
    )
  }

  const allowed = kind?.definition.evidence.kinds

  if (
    allowed &&
    input.origin !== 'legacy' &&
    !(allowed as readonly string[]).includes(input.origin)
  ) {
    throw new EvidenceRefusal(
      `Diese Pflichtart nimmt als Nachweis: ${allowed.map((way) => evidenceKindLabel[way]).join(', ')}.`,
    )
  }

  const replaced =
    input.replaces === undefined || input.replaces === null
      ? null
      : await replacedOf(tx, context, input.replaces, duty.id)
  const activity = input.activityId === null ? null : await activityOf(tx, context, input)
  const [property] = await tx
    .select()
    .from(properties)
    .where(and(eq(properties.tenantId, context.tenantId), eq(properties.id, duty.propertyId)))

  if (!property) {
    throw new EvidenceRefusal('Die Liegenschaft dieser Pflicht gibt es nicht.')
  }

  const place = await placeOf(tx, context, duty, {
    name: property.name,
    address: `${property.street}, ${property.postalCode} ${property.city}`,
  })
  const found =
    input.defects !== undefined
      ? input.defects
      : activity === null
        ? []
        : await tx
            .select({
              description: defects.description,
              defectClass: defects.defectClass,
              dueOn: defects.dueOn,
            })
            .from(defects)
            .where(
              and(
                eq(defects.tenantId, context.tenantId),
                eq(defects.foundInActivityId, activity.id),
                isNull(defects.deletedAt),
              ),
            )
            .orderBy(asc(defects.createdAt), asc(defects.id))
  const filled = activity === null ? null : await filledFormOf(tx, context, activity, input)
  const number = await assignNumber(tx, context.tenantId, 'evidence', context.at)
  const state: EvidenceState = {
    version: evidenceStateVersion,
    number,
    origin: input.origin,
    performedOn: input.performedOn,
    result: input.result,
    resultReason: input.resultReason,
    remark: input.remark ?? null,
    replaces: replaced === null ? null : { number: replaced.number, reason: replaced.reason },
    duty: {
      label: kind?.definition.label ?? duty.label ?? duty.kind ?? '',
      kind: duty.kind,
      kindVersion: duty.kindVersion,
      source: kind?.definition.source ?? duty.sourceNote ?? '',
      interval: dutyInterval(duty),
      counting: duty.counting,
    },
    place,
    activity: activity === null ? null : { kind: activity.kind, title: activity.title },
    form: filled?.form ?? null,
    answers: filled?.answers ?? [],
    performer: performerOf(input, context),
    defects: found,
    signatures: input.signatures,
    files: input.files,
    retention: retentionOf(
      context.catalogue,
      kind?.definition ?? null,
      input.performedOn,
      property.federalState,
    ),
    writtenBy: context.nameOf(context.writtenBy),
    writtenAt: context.at.toISOString(),
  }
  const fingerprint = stateFingerprint(state)
  const [row] = await tx
    .insert(evidence)
    .values({
      tenantId: context.tenantId,
      propertyId: duty.propertyId,
      areaId: duty.areaId,
      dutyId: duty.id,
      performedOn: input.performedOn,
      result: input.result,
      resultReason: input.resultReason,
      number,
      origin: input.origin,
      activityId: activity?.id ?? null,
      performedBy: input.performedBy,
      examiner: input.examiner?.name ?? null,
      examinerOrganisation: input.examiner?.organisation ?? null,
      writtenBy: context.writtenBy,
      writtenAt: context.at,
      replacesEvidenceId: replaced?.id ?? null,
      replacementReason: replaced?.reason ?? null,
      state,
      fingerprint,
    })
    .returning({ id: evidence.id })

  if (!row) {
    throw new Error('The evidence was not written')
  }

  return { id: row.id, number, fingerprint, state }
}

/**
 * The frozen state of a round as a whole (section 2.6 of the concept, #111),
 * written with the evidence it is written down with, in the same transaction:
 * its place, every answer in the order of the form with the photos by their
 * hash, the defects that came of it, the signatures with their drawings and
 * the evidence, with the fingerprint over it. A round that meets no duty has
 * no evidence, and its PDF is made of this; once written, nothing changes it.
 */
export async function writeRoundRecord(
  tx: TenantTransaction,
  context: WritingContext,
  activityId: ActivityId,
  signatures: readonly StatedSignature[],
  performedBy: string | null,
  written: readonly WrittenEvidence[],
): Promise<void> {
  const [activity] = await tx
    .select()
    .from(activities)
    .where(and(eq(activities.tenantId, context.tenantId), eq(activities.id, activityId)))

  if (!activity || activity.kind !== 'round' || activity.performedOn === null) {
    return
  }

  const [property] = await tx
    .select()
    .from(properties)
    .where(and(eq(properties.tenantId, context.tenantId), eq(properties.id, activity.propertyId)))

  if (!property) {
    throw new EvidenceRefusal('Die Liegenschaft dieses Rundgangs gibt es nicht.')
  }

  const filled = await filledFormOf(tx, context, activity, {
    point: null,
    performedOn: activity.performedOn,
  })
  const found = await tx
    .select({
      description: defects.description,
      defectClass: defects.defectClass,
      dueOn: defects.dueOn,
    })
    .from(defects)
    .where(
      and(
        eq(defects.tenantId, context.tenantId),
        eq(defects.foundInActivityId, activity.id),
        isNull(defects.deletedAt),
      ),
    )
    .orderBy(asc(defects.createdAt), asc(defects.id))
  const state: RoundRecordState = {
    version: roundRecordVersion,
    title: activity.title,
    place: await placeOf(tx, context, activity, {
      name: property.name,
      address: `${property.street}, ${property.postalCode} ${property.city}`,
    }),
    dueOn: activity.dueOn,
    performedOn: activity.performedOn,
    form: filled?.form ?? null,
    answers: filled?.answers ?? [],
    performer: performedBy === null ? null : { person: context.nameOf(performedBy) },
    defects: found,
    signatures,
    evidence: written.map((each) => ({ number: each.number, duty: each.state.duty.label })),
    writtenBy: context.nameOf(context.writtenBy),
    writtenAt: context.at.toISOString(),
  }

  await tx.insert(roundRecords).values({
    tenantId: context.tenantId,
    propertyId: activity.propertyId,
    areaId: activity.areaId,
    activityId: activity.id,
    state,
    fingerprint: stateFingerprint(state),
  })
}

/**
 * Holds the row of a duty until the transaction ends, before anything is
 * asked about what became of one of its evidence (opengewerk-haustechnik#78):
 * a correction and a declaration of invalidity of the same evidence, or two
 * corrections, stand in line here, and the second finds what the first
 * wrote. The row of the evidence itself cannot be held: a lock asks for the
 * right to update, and the application may not update an evidence.
 */
export async function holdTheDuty(
  tx: TenantTransaction,
  tenantId: TenantId,
  dutyId: DutyId,
): Promise<void> {
  await tx
    .select({ id: duties.id })
    .from(duties)
    .where(and(eq(duties.tenantId, tenantId), eq(duties.id, dutyId)))
    .for('no key update')
}

/**
 * The evidence a correction replaces: one of the same duty, not corrected
 * before and not declared invalid. Its correction is corrected in turn, so
 * the evidence that counts is always the last of a line. The database holds
 * the first two by its keys; the third is asked here, because a declaration
 * of invalidity is a row of its own.
 */
async function replacedOf(
  tx: TenantTransaction,
  context: WritingContext,
  replaces: NonNullable<EvidenceToWrite['replaces']>,
  dutyId: DutyId,
): Promise<StatedReplacement & { readonly id: EvidenceId }> {
  const problem = statedReasonProblem(
    replaces.reason,
    evidenceLimits.replacementReason,
    'Eine Berichtigung nennt ihren Grund.',
  )

  if (problem !== undefined) {
    throw new EvidenceRefusal(problem)
  }

  await holdTheDuty(tx, context.tenantId, dutyId)

  const [found] = await tx
    .select({ id: evidence.id, number: evidence.number, dutyId: evidence.dutyId })
    .from(evidence)
    .where(and(eq(evidence.tenantId, context.tenantId), eq(evidence.id, replaces.evidenceId)))

  if (!found) {
    throw new EvidenceRefusal('Den Nachweis, der berichtigt werden soll, gibt es nicht.')
  }

  if (found.dutyId !== dutyId) {
    throw new EvidenceRefusal(
      'Eine Berichtigung gilt für die Pflicht des Nachweises, den sie ersetzt.',
    )
  }

  const [correction] = await tx
    .select({ number: evidence.number })
    .from(evidence)
    .where(and(eq(evidence.tenantId, context.tenantId), eq(evidence.replacesEvidenceId, found.id)))

  if (correction) {
    throw new EvidenceRefusal(
      `Dieser Nachweis ist schon berichtigt, mit ${correction.number}; berichtigt wird dann die Berichtigung.`,
    )
  }

  const [voiding] = await tx
    .select({ id: evidenceVoidings.id })
    .from(evidenceVoidings)
    .where(
      and(
        eq(evidenceVoidings.tenantId, context.tenantId),
        eq(evidenceVoidings.evidenceId, found.id),
      ),
    )

  if (voiding) {
    throw new EvidenceRefusal('Ein für ungültig erklärter Nachweis wird nicht berichtigt.')
  }

  return { id: found.id, number: found.number, reason: replaces.reason.trim() }
}

/** The activity of an evidence, which has to be one to meet its duty. */
async function activityOf(
  tx: TenantTransaction,
  context: WritingContext,
  input: EvidenceToWrite,
): Promise<
  Pick<typeof activities.$inferSelect, 'id' | 'kind' | 'title' | 'formKey' | 'formVersion'>
> {
  const [found] = await tx
    .select({
      id: activities.id,
      kind: activities.kind,
      title: activities.title,
      formKey: activities.formKey,
      formVersion: activities.formVersion,
    })
    .from(activities)
    .innerJoin(
      activityDuties,
      and(
        eq(activityDuties.tenantId, activities.tenantId),
        eq(activityDuties.activityId, activities.id),
        eq(activityDuties.dutyId, input.dutyId),
        isNull(activityDuties.deletedAt),
      ),
    )
    .where(
      and(
        eq(activities.tenantId, context.tenantId),
        eq(activities.id, input.activityId as ActivityId),
        isNull(activities.deletedAt),
      ),
    )

  if (!found) {
    throw new EvidenceRefusal('Dieser Vorgang soll die Pflicht nicht erfüllen.')
  }

  return found
}

/**
 * The form an activity was filled in and the answers to its points, as the
 * evidence freezes them (#106, ADR 0004, point 3): in the order of the form,
 * in words, a measured value with its limit on the day it was performed, and
 * a photo by the newest version of its document. None for an activity
 * without a form.
 */
async function filledFormOf(
  tx: TenantTransaction,
  context: WritingContext,
  activity: Awaited<ReturnType<typeof activityOf>>,
  input: Pick<EvidenceToWrite, 'point' | 'performedOn'>,
): Promise<{ form: StatedForm; answers: readonly StatedAnswer[] } | null> {
  const definition = formOfActivity(await formsFor(tx, context.catalogue, activity), activity)

  if (definition === null) {
    return null
  }

  if (definition === undefined) {
    throw new EvidenceRefusal(
      `Das Formular ${String(activity.formKey)} in der Fassung ${String(activity.formVersion)} kennt der Katalog nicht.`,
    )
  }

  const every = await tx
    .select()
    .from(activityAnswers)
    .where(
      and(
        eq(activityAnswers.tenantId, context.tenantId),
        eq(activityAnswers.activityId, activity.id),
        isNull(activityAnswers.deletedAt),
      ),
    )
  const point = input.point ?? null
  const answers =
    point === null
      ? every
      : every.filter((answer) => answer.fieldKey === point && answer.groupKey === null)
  const photos = answers
    .map((answer) => answer.attachmentId)
    .filter((id): id is AttachmentId => id !== null)
  const versions =
    photos.length === 0
      ? []
      : await tx
          .select({
            attachmentId: attachmentVersions.attachmentId,
            sha256: attachmentVersions.sha256,
            name: attachmentVersions.fileName,
            mediaType: attachmentVersions.mediaType,
          })
          .from(attachmentVersions)
          .where(
            and(
              eq(attachmentVersions.tenantId, context.tenantId),
              inArray(attachmentVersions.attachmentId, photos),
            ),
          )
          .orderBy(desc(attachmentVersions.createdAt), desc(attachmentVersions.id))
  const newest = new Map<string, StatedFile>()

  for (const { attachmentId, ...file } of versions) {
    if (!newest.has(attachmentId)) {
      newest.set(attachmentId, file)
    }
  }

  return {
    form: { key: definition.key, version: definition.version, title: definition.title },
    answers: statedAnswers(definition, answers, {
      rules: context.catalogue.ruleSet,
      on: input.performedOn,
      fileOf: (id) => newest.get(id) ?? null,
    }),
  }
}

/** The place of a duty in words: its property, and the building, room and asset it hangs on. */
async function placeOf(
  tx: TenantTransaction,
  context: WritingContext,
  duty: Pick<typeof duties.$inferSelect, 'assetId' | 'roomId' | 'buildingId'>,
  property: StatedPlace['property'],
): Promise<StatedPlace> {
  const asset =
    duty.assetId === null
      ? null
      : ((
          await tx
            .select()
            .from(assets)
            .where(and(eq(assets.tenantId, context.tenantId), eq(assets.id, duty.assetId)))
        )[0] ?? null)
  const roomId = asset?.roomId ?? duty.roomId
  const room =
    roomId === null
      ? null
      : ((
          await tx
            .select()
            .from(rooms)
            .where(and(eq(rooms.tenantId, context.tenantId), eq(rooms.id, roomId)))
        )[0] ?? null)
  const buildingId = asset?.buildingId ?? room?.buildingId ?? duty.buildingId
  const building =
    buildingId === null
      ? null
      : ((
          await tx
            .select()
            .from(buildings)
            .where(and(eq(buildings.tenantId, context.tenantId), eq(buildings.id, buildingId)))
        )[0] ?? null)

  return {
    property,
    building: building === null ? null : { name: building.name, shortCode: building.shortCode },
    room: room === null ? null : { number: room.number, name: room.name },
    asset:
      asset === null
        ? null
        : {
            number: asset.number,
            name: asset.name,
            kind: asset.kind,
            kindLabel:
              context.catalogue.assetKind(asset.kind, dayInGermany(context.at))?.definition.label ??
              null,
            serialNumber: asset.serialNumber,
          },
  }
}

function performerOf(input: EvidenceToWrite, context: WritingContext): StatedPerformer | null {
  if (input.examiner !== null) {
    return { examiner: input.examiner.name, organisation: input.examiner.organisation }
  }

  return input.performedBy === null ? null : { person: context.nameOf(input.performedBy) }
}

/** How long the evidence is kept, from the duty kind as the rules stand on the day of the work. */
function retentionOf(
  catalogue: Catalogue,
  definition: Parameters<Catalogue['retention']>[0] | null,
  on: IsoDate,
  state: Parameters<Catalogue['retention']>[2],
): StatedRetention | null {
  if (definition === null) {
    return null
  }

  const found = catalogue.retention(definition, on, state)

  if (found === null) {
    return null
  }

  return found.kind === 'years'
    ? { kind: 'years', years: found.rule.record.value, rule: found.rule.record.key, on }
    : { kind: found.kind, on }
}
