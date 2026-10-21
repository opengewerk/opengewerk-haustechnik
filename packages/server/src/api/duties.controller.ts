import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type Asset,
  type AssetId,
  type AttachmentVersionId,
  batchAssetsProblem,
  batchDutiesProblem,
  type Building,
  byNameIn,
  type Catalogue,
  type ContractId,
  type ContractorId,
  type CatalogueEntry,
  ceilingOf,
  type Counting,
  type DeadlineInterval,
  dismissalProblems,
  type Document,
  type Duty,
  type DutyAsset,
  type DutyColleague,
  type DutyDetails,
  type DutyDismissal,
  type DutyEvidenceEntry,
  dutyHasEnded,
  type DutyId,
  dutyIntervalProblem,
  type DutyKind,
  dutyMaximum,
  type DutyPerson,
  type DutyPlaceChain,
  dutyProblems,
  type DutyProposals,
  type DutyReading,
  type DutyRegister,
  dutyTableWords,
  dutyUpdate,
  type DutyUpdates,
  dutyTaskLabel,
  dutyTasks,
  evidenceRegisterBlocks,
  type EvidenceId,
  type EvidenceRegisterCount,
  evidenceRegisterCount,
  evidenceRegisterWords,
  type FederalState,
  type IntervalKind,
  intervalDocumentProblem,
  intervalNeedsReason,
  intervalOfRule,
  intervalToCheck,
  intervalWords,
  isAllowed,
  lastDayOf,
  type IsoDate,
  keepingProblems,
  missingRight,
  namesAPerson,
  onceStartWords,
  type Property,
  type Room,
  type RoomId,
  tableNamesPeople,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  beforeItsEnd,
  CurrentIdentity,
  Database,
  isUuid,
  listColleagues,
  requireSomething,
  tableAnswer,
  tableFormatOf,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm'

import { underWayFor } from '../activities/for-duty.js'
import { CATALOGUE } from '../catalogue.js'
import { applyDelegations, chosenResponsible, coveringOf } from '../delegations/apply.js'
import { heldDelegations, standingOf } from '../delegations/reading.js'
import { dutiesOnADay, dutyTitle } from '../database/duty-standing.js'
import { contractsOfDuties } from '../database/duty-contracts.js'
import { intervalDocumentsOf } from '../database/interval-documents.js'
import {
  activities,
  activityDuties,
  assets,
  attachments,
  attachmentVersions,
  buildings,
  duties,
  dutyDelegations,
  dutyDismissals,
  evidence,
  memberships,
  properties,
  rooms,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { inSight } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { checkContract, checkContractor, checkPerformer } from './contractor-checks.js'
import { listedEvidence } from './evidence.controller.js'
import { dutyProposalFilter, dutyProposals } from './duty-proposals.js'
import { dutyReading, dutyRegister, dutyRegisterQuestion } from './duty-register.js'
import { decideUpdates, dutyUpdates, updatePlaceOf } from './duty-updates.js'
import { evidenceRegisterEntries, evidenceRegisterQuestion } from './evidence-register.js'
import {
  dutyTable,
  evidenceRegisterNames,
  evidenceRegisterTable,
  placeNamesFor,
  proposalTable,
  wholeList,
} from './office-tables.js'
import { keeperOf } from '../labels/faces.js'
import {
  carriedWith,
  type EvidenceAttachment,
  withEvidenceBehind,
} from '../prints/evidence-bundle.js'
import { type EvidencePages, evidenceRegisterPrintJob } from '../prints/evidence-register-page.js'
import { pdf, Printer } from './prints.controller.js'
import { said } from './register-question.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'
import { atTheAsset } from './batch.js'
import { tenantCatalogue } from '../own-kinds/catalogue.js'

const missing = 'Diese Pflicht gibt es nicht oder nicht mehr.'
const missingDismissal = 'Diesen verworfenen Vorschlag gibt es nicht oder nicht mehr.'
const missingAsset = 'Diese Anlage gibt es nicht oder nicht mehr.'
const missingRoom = 'Diesen Raum gibt es nicht oder nicht mehr.'
const missingBuilding = 'Dieses Gebäude gibt es nicht oder nicht mehr.'
const missingProperty = 'Diese Liegenschaft gibt es nicht oder nicht mehr.'
const missingDocument = 'Dieses Dokument gibt es nicht oder nicht mehr.'

/** What a duty hangs on, with what the routes ask of it. */
interface Target {
  readonly propertyId: Duty['propertyId']
  readonly areaId: Duty['areaId']
  readonly buildingId: Duty['buildingId']
  readonly roomId: Duty['roomId']
  readonly assetId: Duty['assetId']
  readonly federalState: FederalState
  /** The asset kind of an asset, which the scope of a duty kind is asked about. */
  readonly assetKind: string | null
  /** The day an asset went into service, as its file keeps it: what a duty that falls due once may be counted from (#439). */
  readonly commissionedOn: IsoDate | null
  /** What it hangs on and what lies above it, where the document that bears its interval may lie (#74). */
  readonly chain: DutyPlaceChain
}

/** The fields a new duty may name. */
const newFields = [
  'propertyId',
  'buildingId',
  'roomId',
  'assetId',
  'kind',
  'label',
  'basis',
  'sourceNote',
  'task',
  'counting',
  'countedFrom',
  'dueOn',
  'intervalDays',
  'intervalMonths',
  'intervalReason',
  'intervalDocumentId',
  'responsibleUserId',
  'performer',
  'performerNote',
  'contractorId',
  'contractId',
] as const

/**
 * The fields a duty may change. What it hangs on and what it is stay as they
 * were confirmed; a duty that falls due once changes the day it is counted
 * from instead of an interval (#439), or one of the operator's own its due
 * day (#441).
 */
const changeFields = [
  'label',
  'basis',
  'sourceNote',
  'task',
  'countedFrom',
  'dueOn',
  'intervalDays',
  'intervalMonths',
  'intervalReason',
  'intervalDocumentId',
  'responsibleUserId',
  'performer',
  'performerNote',
  'contractorId',
  'contractId',
] as const

/** The fields that may be emptied: an empty text is stored as null. */
const emptiable = [
  'propertyId',
  'buildingId',
  'roomId',
  'assetId',
  'kind',
  'counting',
  'intervalReason',
  'intervalDocumentId',
  'responsibleUserId',
  'performer',
  'performerNote',
  'contractorId',
  'contractId',
] as const

/** The fields of a duty of the operator's own, which a duty from the catalogue takes from its kind. */
const ownFields = ['label', 'basis', 'sourceNote', 'task', 'counting', 'dueOn'] as const

type Values = Partial<Record<(typeof newFields)[number], unknown>>

function given(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * Whether a duty left a record that removing it would take away: an evidence,
 * or an activity that was signed or closed (#79). A duty without either may
 * have been entered by mistake and is removed; one with either was right, and
 * is ended. The page of a duty asks the same, to offer removing it (#178).
 */
async function leftARecord(
  tx: TenantTransaction,
  tenantId: Asking['tenantId'],
  dutyId: DutyId,
): Promise<boolean> {
  const [written] = await tx
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.tenantId, tenantId), eq(evidence.dutyId, dutyId)))
    .limit(1)
  const [fixed] = await tx
    .select({ id: activityDuties.id })
    .from(activityDuties)
    .innerJoin(activities, eq(activities.id, activityDuties.activityId))
    .where(
      and(
        eq(activityDuties.tenantId, tenantId),
        eq(activityDuties.dutyId, dutyId),
        isNull(activityDuties.deletedAt),
        notInArray(activities.status, ['open', 'started']),
      ),
    )
    .limit(1)

  return written !== undefined || fixed !== undefined
}

/** The interval the values name, after `dutyIntervalProblem` has found it whole. */
function intervalIn(values: {
  intervalDays?: unknown
  intervalMonths?: unknown
}): DeadlineInterval {
  return given(values.intervalMonths)
    ? { months: values.intervalMonths as number }
    : { days: values.intervalDays as number }
}

/** The sentence for an interval that needs its reason and has none. */
function reasonSentence(kind: IntervalKind, guide: DeadlineInterval | null): string {
  return kind === 'guide' && guide !== null
    ? `Der Richtwert beträgt ${intervalWords(guide)}; eine Frist, die davon abweicht, braucht eine Begründung.`
    : 'Die Frist dieser Pflichtart legt der Betreiber fest; sie braucht eine Begründung, etwa den Verweis auf die Gefährdungsbeurteilung.'
}

/** What a duty kind of the catalogue says about the interval of a duty at a place on a day. */
function kindInterval(
  catalogue: Catalogue,
  entry: CatalogueEntry<DutyKind>,
  on: IsoDate,
  state: FederalState,
): { readonly maximum: DeadlineInterval | null; readonly guide: DeadlineInterval | null } {
  const kind = entry.definition.interval.kind

  if (kind === 'none') {
    return { maximum: null, guide: null }
  }

  const rule = catalogue.interval(entry.definition, on, state)

  if (rule === null) {
    // The build of a package refuses a duty kind whose interval does not
    // answer where it applies; a day before its rule begins is the one case.
    throw new ConflictException(
      'Die Frist dieser Pflichtart hat an diesem Tag in diesem Land keine Regel.',
    )
  }

  const interval = intervalOfRule(rule.record)

  return kind === 'maximum'
    ? { maximum: interval, guide: null }
    : { maximum: null, guide: interval }
}

/** What a change of a duty may name. */
type ChangeValues = Partial<Record<(typeof changeFields)[number], unknown>>

/**
 * What changing a duty that recurs writes of its interval: the interval as it
 * will stand, within the maximum kept beside it and within one a regulation
 * shortened since it was confirmed (#139), with its reason where its kind
 * asks for one. Asked for the reason only where the interval or its reason is
 * what changes: a duty confirmed before the guide of its kind changed departs
 * from the guide of today without anybody having decided so, and saying who
 * answers for it is no reason to ask for one.
 */
function intervalChanged(
  catalogue: Catalogue,
  duty: Duty,
  values: ChangeValues,
  state: FederalState,
  today: IsoDate,
): { readonly intervalDays: unknown; readonly intervalMonths: unknown } {
  if (values.countedFrom !== undefined) {
    throw new BadRequestException('Nur eine einmalige Pflicht zählt ab einem Tag der Anlage.')
  }

  if (values.dueOn !== undefined) {
    throw new BadRequestException(noDueDayRecurring)
  }

  const changed = values.intervalDays !== undefined || values.intervalMonths !== undefined
  const interval = changed
    ? { intervalDays: values.intervalDays ?? null, intervalMonths: values.intervalMonths ?? null }
    : { intervalDays: duty.intervalDays, intervalMonths: duty.intervalMonths }
  const problem = dutyIntervalProblem(interval, duty.counting, dutyMaximum(duty))

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  // A regulation that shortened the maximum since the duty was confirmed
  // holds for an interval set now as well (#139): no interval is saved that
  // the appointment would not count with.
  if (changed && duty.kind !== null) {
    const inForce = ceilingOf(catalogue, duty.kind, state)(today)
    const beyond = inForce === null ? null : dutyIntervalProblem(interval, duty.counting, inForce)

    if (beyond !== null) {
      throw new BadRequestException(beyond)
    }
  }

  const reasonAtStake = changed || values.intervalReason !== undefined

  if (reasonAtStake && duty.kind !== null && duty.kindVersion !== null) {
    const entry = catalogue.dutyKindVersion(duty.kind, duty.kindVersion)
    const reason = values.intervalReason === undefined ? duty.intervalReason : values.intervalReason

    if (entry !== null) {
      const { guide } = kindInterval(catalogue, entry, today, state)

      if (
        intervalNeedsReason(entry.definition.interval.kind, intervalIn(interval), guide) &&
        !given(reason)
      ) {
        throw new BadRequestException(reasonSentence(entry.definition.interval.kind, guide))
      }
    }
  }

  return interval
}

/**
 * What changing a duty that falls due once writes of its due day (#439): a
 * new day it is counted from, say a commissioning again, and the due day the
 * version of its kind the duty names counts from it. It has no interval, and
 * a day its source names does not change. One of the operator's own changes
 * its due day as typed, as its source names it (#441).
 */
function onceChanged(
  catalogue: Catalogue,
  duty: Duty,
  values: ChangeValues,
  state: FederalState,
): Partial<Pick<Term, 'dueOn' | 'countedFrom'>> {
  if (
    values.intervalDays !== undefined ||
    values.intervalMonths !== undefined ||
    values.intervalReason !== undefined ||
    values.intervalDocumentId !== undefined
  ) {
    throw new BadRequestException(noIntervalOnce)
  }

  if (duty.kind === null) {
    if (values.countedFrom !== undefined) {
      throw new BadRequestException(ownCountsFromNoDay)
    }

    if (values.dueOn === null) {
      throw new BadRequestException(ownDueDayMissing)
    }

    // A due day named goes as it is, with the rest of the change.
    return {}
  }

  if (values.countedFrom === undefined) {
    return {}
  }

  const entry =
    duty.kind === null || duty.kindVersion === null
      ? null
      : catalogue.dutyKindVersion(duty.kind, duty.kindVersion)

  if (entry === null) {
    throw new ConflictException('Die Pflichtart dieser Pflicht kennt der Katalog nicht mehr.')
  }

  return onceTerm(catalogue, entry, values.countedFrom, null, state)
}

/**
 * What a duty hangs on: at most one of an asset, a room or a building, and
 * the property itself where none is named. Each is a row the person asking
 * sees, and a property named beside one of them has to be its property.
 */
async function targetOf(tx: TenantTransaction, values: Values): Promise<Target> {
  const named = (['assetId', 'roomId', 'buildingId'] as const).filter((field) =>
    given(values[field]),
  )

  if (named.length > 1) {
    throw new BadRequestException(
      'Eine Pflicht hängt an genau einem: einer Anlage, einem Raum, einem Gebäude oder der Liegenschaft.',
    )
  }

  let place: { propertyId: Duty['propertyId'] } & Partial<Target>
  // What lies above an asset or a room: its building, and its room.
  let above: Partial<Pick<DutyPlaceChain, 'buildingId' | 'roomId'>> = {}

  if (given(values.assetId)) {
    const asset = await placeOf<Asset>(tx, assets, String(values.assetId), missingAsset)

    place = {
      propertyId: asset.propertyId,
      areaId: asset.areaId,
      assetId: asset.id,
      assetKind: asset.kind,
      commissionedOn: asset.commissionedOn,
    }
    above = { buildingId: asset.buildingId, roomId: asset.roomId }
  } else if (given(values.roomId)) {
    const room = await placeOf<Room>(tx, rooms, String(values.roomId), missingRoom)

    place = { propertyId: room.propertyId, areaId: room.areaId, roomId: room.id }
    above = { buildingId: room.buildingId }
  } else if (given(values.buildingId)) {
    const building = await placeOf<Building>(
      tx,
      buildings,
      String(values.buildingId),
      missingBuilding,
    )

    place = { propertyId: building.propertyId, areaId: building.areaId, buildingId: building.id }
  } else if (given(values.propertyId)) {
    place = { propertyId: String(values.propertyId) as Duty['propertyId'] }
  } else {
    throw new BadRequestException(
      'Eine Pflicht hängt an einer Anlage, einem Raum, einem Gebäude oder einer Liegenschaft; keines ist genannt.',
    )
  }

  if (given(values.propertyId) && values.propertyId !== place.propertyId) {
    throw new BadRequestException('Die Liegenschaft ist nicht die, auf der das Genannte steht.')
  }

  const property = await placeOf<Property>(tx, properties, place.propertyId, missingProperty)

  return {
    propertyId: property.id,
    // The area of what the duty hangs on (ADR 0003, addendum of #306).
    areaId: place.areaId ?? property.areaId,
    buildingId: place.buildingId ?? null,
    roomId: place.roomId ?? null,
    assetId: place.assetId ?? null,
    federalState: property.federalState,
    assetKind: place.assetKind ?? null,
    commissionedOn: place.commissionedOn ?? null,
    chain: {
      propertyId: property.id,
      buildingId: place.buildingId ?? above.buildingId ?? null,
      roomId: place.roomId ?? above.roomId ?? null,
      assetId: place.assetId ?? null,
    },
  }
}

/** What a duty there is hangs on and what lies above it, as `targetOf` says it for a new one. */
async function chainOf(tx: TenantTransaction, duty: Duty): Promise<DutyPlaceChain> {
  const chain = {
    propertyId: duty.propertyId,
    buildingId: duty.buildingId,
    roomId: duty.roomId,
    assetId: duty.assetId,
  }

  if (duty.assetId !== null) {
    const [asset] = await tx
      .select({ buildingId: assets.buildingId, roomId: assets.roomId })
      .from(assets)
      .where(eq(assets.id, duty.assetId))

    return { ...chain, buildingId: asset?.buildingId ?? null, roomId: asset?.roomId ?? null }
  }

  if (duty.roomId !== null) {
    const [room] = await tx
      .select({ buildingId: rooms.buildingId })
      .from(rooms)
      .where(eq(rooms.id, duty.roomId))

    return { ...chain, buildingId: room?.buildingId ?? null }
  }

  return chain
}

/** The columns of the document that bears the interval of a duty: a document and one of its versions, or neither. */
interface IntervalDocumentColumns {
  readonly intervalDocumentId: Duty['intervalDocumentId']
  readonly intervalDocumentVersionId: Duty['intervalDocumentVersionId']
}

const noIntervalDocument: IntervalDocumentColumns = {
  intervalDocumentId: null,
  intervalDocumentVersionId: null,
}

/**
 * The document that bears the interval of a duty, with the version the duty
 * keeps of it: the newest there is today (section 4.3 of the concept, #74).
 * Named by whoever may look at documents, and only one in sight that is still
 * in the records: at the place of the duty or above it, on its property.
 */
async function intervalDocumentAt(
  tx: TenantTransaction,
  identity: Asking,
  documentId: unknown,
  chain: DutyPlaceChain,
): Promise<IntervalDocumentColumns> {
  if (!isAllowed(identity, 'document.read')) {
    throw new ForbiddenException(missingRight('document.read'))
  }

  const document = await placeOf<Document>(tx, attachments, String(documentId), missingDocument)
  const problem = intervalDocumentProblem(document, chain)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  const [newest] = await tx
    .select({ id: attachmentVersions.id })
    .from(attachmentVersions)
    .where(eq(attachmentVersions.attachmentId, document.id))
    .orderBy(desc(attachmentVersions.id))
    .limit(1)

  if (newest === undefined) {
    throw new BadRequestException(
      'Von diesem Dokument ist noch keine Fassung angekommen; die Datei ist noch unterwegs.',
    )
  }

  return {
    intervalDocumentId: document.id,
    intervalDocumentVersionId: newest.id as AttachmentVersionId,
  }
}

/** Refuses a responsible person who does not work for the tenant, or is blocked. */
async function checkResponsible(tx: TenantTransaction, userId: unknown): Promise<void> {
  if (!given(userId)) {
    return
  }

  const [member] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(eq(memberships.userId, String(userId)), isNull(memberships.blockedAt), beforeItsEnd()),
    )

  if (member === undefined) {
    throw new BadRequestException('Verantwortlich ist jemand, der für diesen Betreiber arbeitet.')
  }
}

/** A firm out of the list, or a note on one, belongs to a duty a contractor performs (#328). */
const contractorOfADuty = 'Die Fremdfirma gehört zu einer Pflicht, die eine Fremdfirma ausführt.'

/** The duty kind of the catalogue a key names today, which has to apply to the asset. */
function kindFor(catalogue: Catalogue, key: unknown, assetKind: string | null, on: IsoDate) {
  const entry = typeof key === 'string' ? catalogue.dutyKind(key, on) : null

  if (entry === null) {
    throw new BadRequestException(`Die Pflichtart ${String(key)} kennt kein Paket des Katalogs.`)
  }

  if (assetKind === null) {
    throw new BadRequestException(
      'Eine Pflichtart des Katalogs gilt für Anlagen; an einem Raum, einem Gebäude oder der Liegenschaft steht eine eigene Pflicht.',
    )
  }

  if (!entry.definition.scope.assetKinds.includes(assetKind)) {
    throw new BadRequestException('Die Pflichtart gilt nicht für Anlagen dieser Art.')
  }

  return entry
}

/**
 * What a duty is confirmed with: its kind and version, its counting, the
 * maximum or the guide kept beside it (#139) and its interval; or for a duty
 * that falls due once, its due day and the day it is counted from (#439).
 */
interface Decided extends Term {
  readonly kind: string | null
  readonly kindVersion: number | null
  readonly counting: Counting
}

/** How often a duty falls due: an interval with what its kind kept beside it, or a due day. */
interface Term {
  readonly maximum: DeadlineInterval | null
  readonly guide: DeadlineInterval | null
  readonly interval: DeadlineInterval | null
  readonly dueOn: IsoDate | null
  readonly countedFrom: IsoDate | null
}

/** Why a duty that falls due once takes no interval. */
const noIntervalOnce =
  'Eine einmalige Pflicht hat keine Frist, sondern einen Termin; sie nennt weder Frist noch Begründung noch ein Dokument, das eine Frist trägt.'

/**
 * The due day of a duty that falls due once (#439), from its kind: the day
 * its source names, or the distance of its rule from the day of the asset it
 * is counted from. That day is the one the values name; for a kind counted
 * from the commissioning, else the one the file of the asset keeps. Nothing
 * of it is typed, so nothing of it overrides the source.
 */
function onceTerm(
  catalogue: Catalogue,
  entry: CatalogueEntry<DutyKind>,
  countedFrom: unknown,
  commissionedOn: IsoDate | null,
  state: FederalState,
): Pick<Term, 'dueOn' | 'countedFrom'> {
  const { interval } = entry.definition

  if (interval.kind !== 'once') {
    throw new BadRequestException('Nur eine einmalige Pflicht zählt ab einem Tag der Anlage.')
  }

  if ('dueOn' in interval) {
    if (given(countedFrom)) {
      throw new BadRequestException(
        'Den Termin dieser Pflicht nennt ihre Vorschrift; sie zählt von keinem Tag der Anlage.',
      )
    }

    return { dueOn: interval.dueOn, countedFrom: null }
  }

  const day = given(countedFrom)
    ? countedFrom
    : interval.from === 'commissioning'
      ? commissionedOn
      : null

  if (day === null) {
    throw new BadRequestException(
      `Für diese Pflicht fehlt der ${onceStartWords[interval.from].day}; von ihm aus zählt ihr Termin.`,
    )
  }

  // Its shape `dutyProblems` has checked already.
  if (typeof day !== 'string') {
    throw new BadRequestException(
      'Der Tag, ab dem gezählt wird, ist ein Tag, geschrieben 2026-10-03.',
    )
  }

  const dueOn = catalogue.onceDue(entry, day, state)

  if (dueOn === null) {
    throw new ConflictException(
      'Der Termin dieser Pflichtart hat an diesem Tag in diesem Land keine Regel.',
    )
  }

  return { dueOn, countedFrom: day }
}

/** The fields a batch may name besides its assets: one duty kind, and what every duty of it takes. */
const batchFields = [
  'kind',
  'intervalDays',
  'intervalMonths',
  'intervalReason',
  'responsibleUserId',
  'performer',
  'performerNote',
  'contractorId',
  'contractId',
] as const

const batchEmptiable = [
  'intervalReason',
  'responsibleUserId',
  'performer',
  'performerNote',
  'contractorId',
  'contractId',
] as const

/** A problem of one field as `refuse` takes it, or nothing. */
function problemOf(field: string, problem: string | null): Record<string, string> {
  return problem === null ? {} : { [field]: problem }
}

/**
 * A duty kind of the catalogue confirmed at an asset on a day: the kind
 * applies to the kind of the asset, the interval stays within the maximum
 * and has its reason where one is needed, no duty of the kind stands at the
 * asset, and a dismissal of it is withdrawn in the same step.
 *
 * Where a batch names no interval, each duty takes the one its kind names in
 * the state of its asset, the maximum or the guide (#102); a kind without a
 * value leaves the interval to the operator, who names it with a reason.
 */
async function confirmedFromTheCatalogue(
  tx: TenantTransaction,
  catalogue: Catalogue,
  values: Values,
  target: Target,
  today: IsoDate,
  { itsKindsInterval = false }: { readonly itsKindsInterval?: boolean } = {},
): Promise<Decided> {
  const entry = kindFor(catalogue, values.kind, target.assetKind, today)
  const counting = entry.definition.counting
  const term: Term =
    counting === 'once'
      ? {
          maximum: null,
          guide: null,
          interval: null,
          ...onceOfTheCatalogue(catalogue, entry, values, target),
        }
      : {
          ...intervalOfTheCatalogue(catalogue, entry, values, target, today, itsKindsInterval),
          dueOn: null,
          countedFrom: null,
        }

  const [standing] = await tx
    .select({ id: duties.id })
    .from(duties)
    .where(
      and(
        eq(duties.assetId, target.assetId as AssetId),
        eq(duties.kind, entry.key),
        isNull(duties.deletedAt),
        isNull(duties.endsOn),
      ),
    )

  if (standing !== undefined) {
    throw new ConflictException('Diese Pflicht ist an der Anlage schon bestätigt.')
  }

  await tx
    .update(dutyDismissals)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(dutyDismissals.assetId, target.assetId as AssetId),
        eq(dutyDismissals.kind, entry.key),
        isNull(dutyDismissals.deletedAt),
      ),
    )

  return { kind: entry.key, kindVersion: entry.version, counting, ...term }
}

/** The due day of a duty kind of the catalogue that falls due once, confirmed at an asset (#439). */
function onceOfTheCatalogue(
  catalogue: Catalogue,
  entry: CatalogueEntry<DutyKind>,
  values: Values,
  target: Target,
): Pick<Term, 'dueOn' | 'countedFrom'> {
  if (
    given(values.intervalDays) ||
    given(values.intervalMonths) ||
    given(values.intervalReason) ||
    given(values.intervalDocumentId)
  ) {
    throw new BadRequestException(noIntervalOnce)
  }

  return onceTerm(catalogue, entry, values.countedFrom, target.commissionedOn, target.federalState)
}

/** Why a duty of the operator's own is counted from no day of its asset. */
const ownCountsFromNoDay =
  'Eine eigene Pflicht zählt von keinem Tag der Anlage; ihren Termin oder ihre Frist nennt ihre Quelle.'

/** Why a duty that recurs has no due day of its own. */
const noDueDayRecurring =
  'Nur eine einmalige Pflicht hat einen Termin; eine Pflicht, die wiederkehrt, hat eine Frist.'

/** Why a duty of the operator's own that falls due once is refused without its due day. */
const ownDueDayMissing = 'Der Termin einer einmaligen Pflicht fehlt; ihn nennt ihre Quelle.'

/**
 * The due day of a duty of the operator's own that falls due once (#441):
 * the day its source names, typed as the interval of one that recurs is,
 * and no interval beside it.
 */
function ownOnce(values: Values): Pick<Term, 'interval' | 'dueOn'> {
  if (
    given(values.intervalDays) ||
    given(values.intervalMonths) ||
    given(values.intervalReason) ||
    given(values.intervalDocumentId)
  ) {
    throw new BadRequestException(noIntervalOnce)
  }

  if (!given(values.dueOn)) {
    throw new BadRequestException(ownDueDayMissing)
  }

  // Its shape `dutyProblems` has checked already.
  return { interval: null, dueOn: values.dueOn as IsoDate }
}

/** The interval of a duty of the operator's own that recurs, and no due day beside it. */
function ownRecurring(values: Values, counting: Counting): Pick<Term, 'interval' | 'dueOn'> {
  if (given(values.dueOn)) {
    throw new BadRequestException(noDueDayRecurring)
  }

  const problem = dutyIntervalProblem(values, counting, null)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  return { interval: intervalIn(values), dueOn: null }
}

/**
 * The interval of a duty kind of the catalogue that recurs, confirmed at an
 * asset: within the maximum, with its reason where one is needed, or in a
 * batch that names none the one of its kind.
 */
function intervalOfTheCatalogue(
  catalogue: Catalogue,
  entry: CatalogueEntry<DutyKind>,
  values: Values,
  target: Target,
  today: IsoDate,
  itsKindsInterval: boolean,
): Pick<Term, 'maximum' | 'guide' | 'interval'> {
  const { maximum, guide } = kindInterval(catalogue, entry, today, target.federalState)
  const counting = entry.definition.counting
  const named = given(values.intervalDays) || given(values.intervalMonths)
  const itsOwn = maximum ?? guide

  if (given(values.countedFrom)) {
    throw new BadRequestException('Nur eine einmalige Pflicht zählt ab einem Tag der Anlage.')
  }

  if (itsKindsInterval && !named && itsOwn === null) {
    throw new BadRequestException(
      'Die Frist dieser Pflichtart legt der Betreiber fest; der Stapel nennt sie, mit Begründung.',
    )
  }

  const asked =
    itsKindsInterval && !named && itsOwn !== null
      ? 'days' in itsOwn
        ? { intervalDays: itsOwn.days }
        : { intervalMonths: itsOwn.months }
      : { intervalDays: values.intervalDays, intervalMonths: values.intervalMonths }
  const problem = dutyIntervalProblem(asked, counting, maximum)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  const interval = intervalIn(asked)

  if (
    intervalNeedsReason(entry.definition.interval.kind, interval, guide) &&
    !given(values.intervalReason)
  ) {
    throw new BadRequestException(reasonSentence(entry.definition.interval.kind, guide))
  }

  return { maximum, guide, interval }
}

/** The row of a new duty: where it hangs, what it is, its interval and who answers for it. */
function dutyRow(
  identity: Asking,
  target: Target,
  decided: Decided,
  values: Values,
  document: IntervalDocumentColumns = noIntervalDocument,
) {
  const { interval, maximum, guide } = decided

  return {
    tenantId: identity.tenantId,
    propertyId: target.propertyId,
    areaId: target.areaId,
    buildingId: target.buildingId,
    roomId: target.roomId,
    assetId: target.assetId,
    kind: decided.kind,
    kindVersion: decided.kindVersion,
    label: decided.kind === null ? (values.label as string) : null,
    basis: decided.kind === null ? (values.basis as Duty['basis']) : null,
    sourceNote: decided.kind === null ? (values.sourceNote as string) : null,
    task: decided.kind === null ? (values.task as Duty['task']) : null,
    counting: decided.counting,
    dueOn: decided.dueOn,
    countedFrom: decided.countedFrom,
    intervalDays: interval !== null && 'days' in interval ? interval.days : null,
    intervalMonths: interval !== null && 'months' in interval ? interval.months : null,
    intervalReason: (values.intervalReason ?? null) as string | null,
    ...document,
    maximumDays: maximum !== null && 'days' in maximum ? maximum.days : null,
    maximumMonths: maximum !== null && 'months' in maximum ? maximum.months : null,
    guideDays: guide !== null && 'days' in guide ? guide.days : null,
    guideMonths: guide !== null && 'months' in guide ? guide.months : null,
    responsibleUserId: (values.responsibleUserId ?? null) as string | null,
    performer: (values.performer ?? null) as Duty['performer'],
    performerNote: (values.performerNote ?? null) as string | null,
    contractorId: (values.contractorId ?? null) as ContractorId | null,
    contractId: (values.contractId ?? null) as ContractId | null,
    confirmedBy: identity.userId,
  }
}

/**
 * A dismissal of a duty kind of the catalogue at an asset, with its reason:
 * the kind applies to the kind of the asset, no duty of it stands there,
 * which would be ended instead, and it is not dismissed already.
 */
async function dismissalAt(
  tx: TenantTransaction,
  catalogue: Catalogue,
  identity: Asking,
  assetId: unknown,
  kind: unknown,
  reason: string,
  today: IsoDate,
) {
  if (!given(assetId)) {
    throw new BadRequestException(
      'Verworfen wird ein Vorschlag für eine Anlage; sie ist nicht genannt.',
    )
  }

  const asset = await placeOf<Asset>(tx, assets, String(assetId), missingAsset)
  const entry = kindFor(catalogue, kind, asset.kind, today)
  const [standing] = await tx
    .select({ id: duties.id })
    .from(duties)
    .where(
      and(
        eq(duties.assetId, asset.id),
        eq(duties.kind, entry.key),
        isNull(duties.deletedAt),
        isNull(duties.endsOn),
      ),
    )

  if (standing !== undefined) {
    throw new ConflictException(
      'Diese Pflicht ist an der Anlage bestätigt; beende sie, statt den Vorschlag zu verwerfen.',
    )
  }

  const [dismissed] = await tx
    .select({ id: dutyDismissals.id })
    .from(dutyDismissals)
    .where(
      and(
        eq(dutyDismissals.assetId, asset.id),
        eq(dutyDismissals.kind, entry.key),
        isNull(dutyDismissals.deletedAt),
      ),
    )

  if (dismissed !== undefined) {
    throw new ConflictException('Dieser Vorschlag ist für die Anlage schon verworfen.')
  }

  return {
    tenantId: identity.tenantId,
    propertyId: asset.propertyId,
    areaId: asset.areaId,
    assetId: asset.id,
    kind: entry.key,
    kindVersion: entry.version,
    reason,
    dismissedBy: identity.userId,
  }
}

/**
 * The register of duties (section 4.3 of the concept, ADR 0002, points 10 and
 * 11) with the rights of section 7: reading it is `duty.read`, confirming a
 * duty from the catalogue, adding one of the operator's own, setting its
 * interval, saying who answers for it and who performs it, and ending it is
 * `duty.write`. The proposals themselves and the screens come in phase 1.
 *
 * The interval of a duty from the catalogue stays within what its kind
 * allows: the maximum of the day it was confirmed is kept beside it, and the
 * database refuses a longer interval as this route does.
 */
/**
 * The register of evidence (#338) is the register of duties with its
 * evidence: whoever makes it reads both, the duties by the route and the
 * evidence here. Every shipped role with the one has the other; a role of an
 * operator's own need not.
 */
function readsEvidence(identity: Asking): void {
  if (!isAllowed(identity, 'evidence.read')) {
    throw new ForbiddenException(missingRight('evidence.read'))
  }
}

@Controller('duties')
export class DutiesController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
    private readonly printer: Printer,
  ) {}

  /** The duties the person asking sees, of one asset, room, building or property where one is named. */
  @Get()
  @RequiresPermission('duty.read')
  list(
    @CurrentIdentity() identity: Asking,
    @Query('assetId') assetId?: string,
    @Query('roomId') roomId?: string,
    @Query('buildingId') buildingId?: string,
    @Query('propertyId') propertyId?: string,
  ): Promise<Duty[]> {
    const filters = [
      assetId === undefined ? undefined : eq(duties.assetId, assetId as AssetId),
      roomId === undefined ? undefined : eq(duties.roomId, roomId as Duty['roomId'] & string),
      buildingId === undefined
        ? undefined
        : eq(duties.buildingId, buildingId as Duty['buildingId'] & string),
      propertyId === undefined
        ? undefined
        : eq(duties.propertyId, propertyId as Duty['propertyId']),
    ].filter((filter) => filter !== undefined)

    return this.database.forTenant(identity, async (tx) => {
      // An id that is no id names nothing the person could see.
      if ([assetId, roomId, buildingId, propertyId].some((id) => id !== undefined && !isUuid(id))) {
        return []
      }

      return tx
        .select()
        .from(duties)
        .where(and(isNull(duties.deletedAt), ...filters))
        .orderBy(asc(duties.confirmedAt)) as Promise<Duty[]>
    })
  }

  /**
   * The register over every place (section 4.3 of the concept), a page at a
   * time: narrowed by state, place, asset kind, duty kind and the person who
   * answers for a duty, each of which the address may name, and two of them
   * give what passes both. Whoever reads duties reads it, in their areas.
   *
   * Narrowing it to one person is for whoever keeps the register, and the
   * answer then holds no number: a list about somebody is no evaluation of
   * them (sections 4.16 and 9 of the concept). The people to choose from are
   * handed to the same people and to nobody else.
   *
   * Before the page of a duty, or its address would be read as an id.
   */
  @Get('register')
  @RequiresPermission('duty.read')
  async register(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<DutyRegister> {
    const question = dutyRegisterQuestion(query)
    const keeps = isAllowed(identity, 'duty.write')

    if (namesAPerson(question.filter) && !keeps) {
      throw new ForbiddenException(missingRight('duty.write'))
    }

    const read = await this.database.forTenant(identity, (tx) =>
      dutyRegister(tx, this.catalogue, dayInGermany(), question),
    )
    const named = await this.named(identity, [
      ...read.duties.map((duty) => duty.responsibleUserId),
      ...(keeps ? read.people : []),
    ])

    return {
      ...read,
      duties: read.duties.map((duty) => ({ ...duty, responsible: named(duty.responsibleUserId) })),
      people: keeps
        ? read.people
            .flatMap((userId) => named(userId) ?? [])
            .sort((left, right) => byNameIn(left.name, right.name))
        : null,
    }
  }

  /**
   * The people of this operator by name, and which of them can still be named
   * for a duty: for whoever keeps the register, to say who answers for one.
   * The name and nothing else of a person, neither role nor address.
   *
   * Before the page of a duty, like the register.
   */
  @Get('colleagues')
  @RequiresPermission('duty.write')
  colleagues(@CurrentIdentity() identity: Asking): Promise<DutyColleague[]> {
    return listColleagues(this.database, identity)
  }

  /**
   * The proposals of the catalogue (#102, section 4.3 of the concept), worked
   * out today for the assets in the areas of the person asking, of one asset,
   * one property or one duty kind where the address names it, and the ones
   * dismissed beside them. Whoever reads duties reads them; deciding on one is
   * keeping the register.
   *
   * Before the page of a duty, like the register.
   */
  @Get('proposals')
  @RequiresPermission('duty.read')
  proposals(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<DutyProposals> {
    const filter = dutyProposalFilter(query)

    return this.database.forTenant(identity, (tx) =>
      dutyProposals(tx, this.catalogue, dayInGermany(), filter),
    )
  }

  /**
   * The duties the catalogue of this server says something new about (#139,
   * section 2.3 of the concept): a newer version of their kind, or another
   * value of the rule of their interval, with what changes and from when.
   * Whoever reads duties reads it; deciding on one is keeping the register.
   *
   * Before the page of a duty, like the register.
   */
  @Get('updates')
  @RequiresPermission('duty.read')
  updates(@CurrentIdentity() identity: Asking): Promise<DutyUpdates> {
    return this.database.forTenant(identity, (tx) =>
      dutyUpdates(tx, this.catalogue, dayInGermany()),
    )
  }

  /**
   * The newest version of their kind taken over by many duties at once: each
   * names it, counts as it says and carries the value of its rule, and its
   * interval is cut to a new maximum where it lay beyond. One transaction,
   * all of them or none.
   */
  @Post('updates/adopt')
  @RequiresPermission('duty.write')
  adopt(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Duty[]> {
    const dutyIds = (body as { dutyIds?: unknown } | null)?.dutyIds

    refuse(problemOf('dutyIds', batchDutiesProblem(dutyIds)))

    return this.database.forTenant(identity, (tx) =>
      decideUpdates(tx, this.catalogue, dayInGermany(), dutyIds as readonly string[], 'adopt'),
    )
  }

  /**
   * Many duties left as they are against what the catalogue says, with one
   * reason. Refused for a duty whose interval lies beyond a new maximum: the
   * operator overrides no regulation. One transaction, all of them or none.
   */
  @Post('updates/keep')
  @RequiresPermission('duty.write')
  keep(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Duty[]> {
    const values = fieldsOf(body, ['reason'] as const)
    const dutyIds = (body as { dutyIds?: unknown } | null)?.dutyIds

    refuse({ ...keepingProblems(values), ...problemOf('dutyIds', batchDutiesProblem(dutyIds)) })

    return this.database.forTenant(identity, (tx) =>
      decideUpdates(tx, this.catalogue, dayInGermany(), dutyIds as readonly string[], {
        keep: values.reason as string,
      }),
    )
  }

  /**
   * The register as a table (#236): every duty the filters of the list pass,
   * and not a page, in the order of the register, as a workbook or as text
   * (`?format=xlsx` or `csv`). Whoever reads the register reads its table,
   * with what each duty hangs on named for whoever reads it.
   *
   * Who answers for a duty stands in it only for whoever may see the staff
   * (`tableNamesPeople`), and narrowed to one person the register is a table
   * only for them: a list about somebody leaves with nobody else (sections
   * 4.16 and 9 of the concept).
   *
   * Before the page of a duty, like the register.
   */
  @Get('register/table')
  @RequiresPermission('duty.read')
  @Header('Cache-Control', 'no-store')
  async table(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const question = { ...dutyRegisterQuestion(query), ...wholeList }
    const people = tableNamesPeople(identity)

    if (namesAPerson(question.filter)) {
      if (!isAllowed(identity, 'duty.write')) {
        throw new ForbiddenException(missingRight('duty.write'))
      }

      if (!people) {
        throw new ForbiddenException(dutyTableWords.narrowedToAPerson)
      }
    }

    const today = dayInGermany()
    const read = await this.database.forTenant(identity, (tx) =>
      dutyRegister(tx, this.catalogue, today, question),
    )
    // Nobody is looked up by name for a table that names nobody.
    const named = people
      ? await this.named(
          identity,
          read.duties.map((duty) => duty.responsibleUserId),
        )
      : () => null

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        await dutyTable(
          tx,
          this.catalogue,
          identity,
          read.duties.map((duty) => ({ ...duty, responsible: named(duty.responsibleUserId) })),
        ),
        format,
        today,
      ),
    )
  }

  /**
   * What the register of evidence would hold under a choice (#338): how many
   * duties, on how many assets, and how many were never recorded. The dialog
   * says it before anybody makes the register, and it is the count of the
   * register of duties under the same choice (acceptance 3).
   */
  @Get('evidence-register')
  @RequiresPermission('duty.read')
  @Header('Cache-Control', 'no-store')
  evidenceRegisterCount(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<EvidenceRegisterCount> {
    readsEvidence(identity)

    const question = evidenceRegisterQuestion(query)

    return this.database.forTenant(identity, async (tx) =>
      evidenceRegisterCount(
        await evidenceRegisterEntries(tx, this.catalogue, dayInGermany(), question),
      ),
    )
  }

  /**
   * The register of evidence as a PDF on A4 across (#338): a block per
   * asset, a line per duty with its last evidence, for the day it is asked
   * for. Made now and not kept, since it says how things stand today. With
   * `attach=1` the evidence follows the list in the same document, each
   * evidence once, as the PDF it keeps and the files it rests on, and every
   * line names the page its evidence begins on (decided by Moritz on
   * 15.10.2026).
   */
  @Get('evidence-register/pdf')
  @RequiresPermission('duty.read')
  async evidenceRegisterPdf(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ): Promise<StreamableFile> {
    readsEvidence(identity)

    const question = evidenceRegisterQuestion(query)
    const today = dayInGermany()
    const made = await this.database.forTenant(identity, async (tx) => {
      const entries = await evidenceRegisterEntries(tx, this.catalogue, today, question)
      const named = await evidenceRegisterNames(tx, identity)
      const names = await placeNamesFor(tx, identity)
      const catalogue = await tenantCatalogue(tx, this.catalogue)
      const kinds = question.assetKinds.map(
        (kind) => catalogue.assetKind(kind, today)?.definition.label ?? kind,
      )
      const choice = [
        question.place.propertyId === undefined
          ? 'Alle Liegenschaften'
          : (names?.property(question.place.propertyId) ?? 'Liegenschaft'),
        question.place.buildingId === undefined
          ? 'alle Gebäude'
          : (names?.building(question.place.buildingId) ?? 'Gebäude'),
        kinds.length === 0 ? 'alle Anlagenarten' : `Anlagenarten ${kinds.join(', ')}`,
        question.ended ? 'mit beendeten Pflichten' : 'ohne beendete Pflichten',
      ].join(', ')

      return {
        head: {
          today,
          operator: await keeperOf(tx),
          choice: `${choice}.`,
          count: evidenceRegisterCount(entries),
        },
        blocks: evidenceRegisterBlocks(entries),
        named,
      }
    })
    const listed = (attached: EvidencePages | null) =>
      this.printer.fresh(evidenceRegisterPrintJob(made.head, made.blocks, made.named, attached))

    if (query['attach'] !== '1') {
      return pdf(response, await listed(null), `Nachweisverzeichnis ${today}`)
    }

    // The evidence behind the list, in the order of its rows, each once: the
    // print it keeps and the files it rests on, read as the person, so that
    // nothing beyond their areas follows the list either.
    const attachments: EvidenceAttachment<EvidenceId>[] = []
    const evidenceIds = new Set(
      made.blocks.flatMap((block) =>
        block.lines.flatMap((line) => (line.evidenceId === null ? [] : [line.evidenceId])),
      ),
    )

    let carried = 0

    for (const evidenceId of evidenceIds) {
      const printed = await this.printer.evidencePrint(identity, evidenceId)

      if (printed !== null) {
        const attachment = {
          key: evidenceId,
          print: printed.bytes,
          files: await this.printer.evidenceFiles(identity, evidenceId),
        }
        const next = carriedWith(carried, attachment)

        // A register past the limit is refused rather than read whole into memory.
        if (next === null) {
          throw new UnprocessableEntityException(evidenceRegisterWords.tooLarge)
        }

        carried = next
        attachments.push(attachment)
      }
    }

    return pdf(
      response,
      await this.printer.sign(await withEvidenceBehind(attachments, listed)),
      `Nachweisverzeichnis mit Nachweisen ${today}`,
    )
  }

  /**
   * The register of evidence as a table (#338, section 4.3 of the concept):
   * every duty the choice names with its last evidence, for an inspection or
   * an audit, as a workbook or as text (`?format=xlsx` or `csv`). Whoever
   * looks at evidence makes it; it names nobody who answers for a duty.
   *
   * Before the page of a duty, like the register.
   */
  @Get('evidence-register/table')
  @RequiresPermission('duty.read')
  @Header('Cache-Control', 'no-store')
  async evidenceRegister(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    readsEvidence(identity)

    const format = tableFormatOf(query)
    const question = evidenceRegisterQuestion(query)
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        await evidenceRegisterTable(
          tx,
          identity,
          await evidenceRegisterEntries(tx, this.catalogue, today, question),
        ),
        format,
        today,
      ),
    )
  }

  /**
   * The proposals as a table (#236), as a workbook or as text
   * (`?format=xlsx` or `csv`): the open ones, a row for each duty kind at
   * each asset in the order of the list, or with `list=dismissed` those
   * dismissed, each with its reason and its day. Narrowed as the list is,
   * and to a package (`package`), which the list narrows to on the screen.
   * Whoever reads duties reads it; the asset is named for whoever reads
   * assets, its place for whoever reads places.
   *
   * Before the page of a duty, like the register.
   */
  @Get('proposals/table')
  @RequiresPermission('duty.read')
  @Header('Cache-Control', 'no-store')
  proposalsTable(
    @CurrentIdentity() identity: Asking,
    @Query() query: Record<string, unknown>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const filter = dutyProposalFilter(query)
    const list = said(query, 'list') ?? 'open'

    if (list !== 'open' && list !== 'dismissed') {
      throw new BadRequestException('Die Vorschläge gibt es offen oder verworfen.')
    }

    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) =>
      tableAnswer(
        await proposalTable(
          tx,
          this.catalogue,
          identity,
          today,
          await dutyProposals(tx, this.catalogue, today, filter),
          list,
          said(query, 'package') ?? null,
        ),
        format,
        today,
      ),
    )
  }

  /**
   * The page of a duty: the record whole, how it stands today, the asset it
   * hangs on and who answers for it. One that has ended is read like any
   * other, and says that it has.
   *
   * The inspection or maintenance under way for it (#183), for whoever reads
   * activities and as far as they are shown it: whoever only performs sees
   * one given to them or to nobody, as in the list of the activities.
   *
   * The document that bears its interval (#74), for whoever may look at
   * documents, and whether the duty says "Frist prüfen".
   */
  @Get(':id')
  @RequiresPermission('duty.read')
  async read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<DutyDetails> {
    const today = dayInGermany()
    const read = await this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<Duty>(tx, duties, id, missing)
      const [registered] = await dutiesOnADay(tx, today, [duty], this.catalogue)
      const [asset] =
        duty.assetId === null
          ? []
          : await tx
              .select({
                id: assets.id,
                number: assets.number,
                name: assets.name,
                kind: assets.kind,
                buildingId: assets.buildingId,
                roomId: assets.roomId,
              })
              .from(assets)
              .where(eq(assets.id, duty.assetId))

      const underWay = isAllowed(identity, 'activity.read')
        ? await underWayFor(tx, [duty.id], inSight(identity))
        : new Map()

      return {
        duty,
        registered,
        asset: (asset ?? null) as DutyAsset | null,
        activity: underWay.get(duty.id) ?? null,
        removable: !(await leftARecord(tx, identity.tenantId, duty.id)),
        document: (await intervalDocumentsOf(tx, [duty])).get(duty.id) ?? null,
        contract: (await contractsOfDuties(tx, [duty], today)).get(duty.id) ?? null,
        place: await updatePlaceOf(tx, duty),
        // The delegations that cover it today, and the one its person comes from (#336).
        covering: await coveringOf(tx, this.catalogue, today, duty),
        delegation:
          duty.responsibleDelegationId === null
            ? null
            : ((
                await heldDelegations(tx, eq(dutyDelegations.id, duty.responsibleDelegationId))
              )[0] ?? null),
      }
    })
    const { duty, registered, activity, document, contract } = read
    const named = await this.named(identity, [duty.responsibleUserId])
    const ended = dutyHasEnded(duty, today)

    return {
      ...duty,
      title: dutyTitle(duty, this.catalogue),
      state: registered?.standing.state ?? 'never_recorded',
      appointment: registered?.standing.appointment ?? null,
      lastMetOn: registered?.lastMetOn ?? null,
      shortened: registered?.shortened ?? null,
      // What the catalogue says differently, until somebody decides (#139);
      // nothing for a duty that has ended, which changes no more.
      update:
        ended || read.place === null ? null : dutyUpdate(this.catalogue, duty, read.place, today),
      ended,
      removable: read.removable,
      asset: read.asset,
      responsible: named(duty.responsibleUserId),
      delegation:
        read.delegation === null
          ? null
          : { id: read.delegation.delegation.id, lastDay: lastDayOf(standingOf(read.delegation)) },
      covering: read.covering.map((held) => ({
        id: held.delegation.id,
        delegateUserId: held.delegation.delegateUserId,
        delegateName: held.delegation.delegateName,
      })),
      // The document itself is for whoever may look at documents; that the
      // interval wants checking, the duty says to whoever reads it.
      intervalDocument: isAllowed(identity, 'document.read') ? document : null,
      intervalToCheck: intervalToCheck(document, ended),
      // That its contract has ended, the duty says to whoever reads it; which
      // contract it is, only to whoever reads the contracts (#329).
      contractEnded: !ended && contract !== null && contract.endedOn !== null,
      contract: isAllowed(identity, 'contract.read') ? contract : null,
      activity:
        activity === null
          ? null
          : {
              id: activity.id,
              kind: activity.kind,
              status: activity.status,
              dueOn: activity.dueOn,
              performer: activity.performer,
              contractorNote: activity.contractorNote,
              contractorId: activity.contractorId,
            },
    }
  }

  /**
   * The evidence of a duty, the newest first, each with what it means for the
   * appointment: one a correction replaced and one declared invalid stay in
   * the list and say so (ADR 0004, points 14 and 15). Reading it is reading
   * evidence, so the right is that of the evidence. No person is named here;
   * who did and who wrote down an evidence stands on its own page.
   */
  @Get(':id/evidence')
  @RequiresPermission('evidence.read')
  evidence(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<DutyEvidenceEntry[]> {
    return this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<Duty>(tx, duties, id, missing)

      return (await listedEvidence(tx, [duty.id])).map(({ dutyId: _, ...entry }) => entry)
    })
  }

  /**
   * The names behind the people duties name. Asked of the instance for
   * exactly these ids, which a key on each duty ties to a membership of this
   * operator (`duties_responsible_works_here`).
   */
  private async named(
    identity: Asking,
    userIds: readonly (string | null)[],
  ): Promise<(userId: string | null) => DutyPerson | null> {
    const ids = [...new Set(userIds.filter((userId) => userId !== null))]
    const accounts = await accountsOf(this.database, ids, identity.userId)

    return (userId) =>
      userId === null ? null : { userId, name: accounts.get(userId)?.name ?? 'Unbekanntes Konto' }
  }

  /**
   * A duty confirmed from the catalogue at an asset, or one of the operator's
   * own anywhere. Confirming a proposal that was dismissed withdraws the
   * dismissal in the same step: the decision changed.
   */
  @Post()
  @RequiresPermission('duty.write')
  create(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Duty> {
    const values: Values = fieldsOf(body, newFields, emptiable)
    const today = dayInGermany()

    refuse(dutyProblems(values))
    checkPerformer(values.performer, values.performerNote, values.contractorId, contractorOfADuty)

    return this.database.forTenant(identity, async (tx) => {
      const target = await targetOf(tx, values)
      let decided: Decided

      if (given(values.kind)) {
        if (ownFields.some((field) => given(values[field]))) {
          throw new BadRequestException(
            'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle, Tätigkeit, Zählweise und Termin von ihrer Pflichtart.',
          )
        }

        decided = await confirmedFromTheCatalogue(tx, this.catalogue, values, target, today)
      } else {
        if (!given(values.label)) {
          throw new BadRequestException('Die Bezeichnung einer eigenen Pflicht fehlt.')
        }

        if (!given(values.basis)) {
          throw new BadRequestException(
            'Die Grundlage einer eigenen Pflicht fehlt: Vorgabe des Herstellers, Auflage, Forderung des Versicherers oder eigene Festlegung.',
          )
        }

        if (!given(values.sourceNote)) {
          throw new BadRequestException('Die Quelle einer eigenen Pflicht fehlt.')
        }

        if (!given(values.task)) {
          throw new BadRequestException(
            `Die Tätigkeit einer eigenen Pflicht fehlt: ${dutyTasks.map((task) => dutyTaskLabel[task]).join(', ')}.`,
          )
        }

        if (given(values.countedFrom)) {
          throw new BadRequestException(ownCountsFromNoDay)
        }

        const counting = (values.counting ?? 'from_performance') as Counting

        decided = {
          kind: null,
          kindVersion: null,
          counting,
          maximum: null,
          guide: null,
          ...(counting === 'once' ? ownOnce(values) : ownRecurring(values, counting)),
          countedFrom: null,
        }
      }

      await checkResponsible(tx, values.responsibleUserId)
      await checkContractor(tx, values.contractorId)
      await checkContract(tx, values.contractId, values.contractorId)

      const document = given(values.intervalDocumentId)
        ? await intervalDocumentAt(tx, identity, values.intervalDocumentId, target.chain)
        : noIntervalDocument

      const [created] = await tx
        .insert(duties)
        .values(dutyRow(identity, target, decided, values, document))
        .returning()

      // A delegation that covers it names who answers for it (#336).
      return (await withDelegations(tx, this.catalogue, [created as Duty]))[0] as Duty
    })
  }

  /**
   * One duty kind of the catalogue confirmed at many assets at once (#102,
   * section 4.3 of the concept: "auch im Stapel für viele gleichartige
   * Anlagen"), with one person who answers for them and one who performs
   * them. Each duty is checked as one confirmed alone, at its asset and in the
   * state of its property; without an interval each takes the one its kind
   * names there, the maximum or the guide.
   *
   * One transaction: exactly as many duties as assets, or none at all where
   * one of them is refused, and the answer says which.
   */
  @Post('batch')
  @RequiresPermission('duty.write')
  confirmMany(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<Duty[]> {
    const values: Values = fieldsOf(body, batchFields, batchEmptiable)
    const assetIds = (body as { assetIds?: unknown } | null)?.assetIds
    const today = dayInGermany()

    if (!given(values.kind)) {
      throw new BadRequestException('Ein Stapel bestätigt eine Pflichtart; sie ist nicht genannt.')
    }

    refuse({ ...dutyProblems(values), ...problemOf('assetIds', batchAssetsProblem(assetIds)) })
    checkPerformer(values.performer, values.performerNote, values.contractorId, contractorOfADuty)

    return this.database.forTenant(identity, async (tx) => {
      await checkResponsible(tx, values.responsibleUserId)
      await checkContractor(tx, values.contractorId)
      await checkContract(tx, values.contractId, values.contractorId)

      const rows = []

      for (const assetId of assetIds as readonly string[]) {
        const target = await targetOf(tx, { assetId })
        const decided = await atTheAsset(tx, assetId, () =>
          confirmedFromTheCatalogue(tx, this.catalogue, values, target, today, {
            itsKindsInterval: true,
          }),
        )

        rows.push(dutyRow(identity, target, decided, values))
      }

      return withDelegations(
        tx,
        this.catalogue,
        (await tx.insert(duties).values(rows).returning()) as Duty[],
      )
    })
  }

  /**
   * The interval with its reason, who answers for the duty and who performs
   * it, and for a duty of the operator's own its name, basis, source and task. The
   * interval stays within the maximum kept beside it; what the duty hangs on
   * and what it is stay as they were confirmed.
   */
  @Patch(':id')
  @RequiresPermission('duty.write')
  change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Duty> {
    const values = fieldsOf(body, changeFields, emptiable)
    const today = dayInGermany()

    requireSomething(values)
    refuse(dutyProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<Duty>(tx, duties, id, missing)

      if (duty.endsOn !== null && duty.endsOn <= today) {
        throw new ConflictException(
          'Diese Pflicht ist beendet; eine beendete Pflicht ändert sich nicht mehr.',
        )
      }

      if (
        duty.kind !== null &&
        ownFields.some((field) => values[field as keyof typeof values] !== undefined)
      ) {
        throw new BadRequestException(
          'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle, Tätigkeit und Termin von ihrer Pflichtart.',
        )
      }

      if (duty.kind === null) {
        for (const field of ['label', 'basis', 'sourceNote', 'task'] as const) {
          if (values[field] === null) {
            throw new BadRequestException(
              'Eine eigene Pflicht behält Bezeichnung, Grundlage, Quelle und Tätigkeit.',
            )
          }
        }
      }

      const property = await placeOf<Property>(tx, properties, duty.propertyId, missingProperty)
      const term =
        duty.counting === 'once'
          ? onceChanged(this.catalogue, duty, values, property.federalState)
          : intervalChanged(this.catalogue, duty, values, property.federalState, today)

      checkPerformer(
        values.performer === undefined ? duty.performer : values.performer,
        values.performerNote === undefined ? duty.performerNote : values.performerNote,
        values.contractorId === undefined ? duty.contractorId : values.contractorId,
        contractorOfADuty,
      )
      await checkResponsible(tx, values.responsibleUserId)
      await checkContractor(tx, values.contractorId)
      // The contract as it will stand, of the firm as it will stand (#329).
      await checkContract(
        tx,
        values.contractId === undefined ? duty.contractId : values.contractId,
        values.contractorId === undefined ? duty.contractorId : values.contractorId,
      )

      // Naming the document again takes its newest version: whoever saves
      // the interval with it has looked at the interval against that one.
      const { intervalDocumentId, ...rest } = values
      const document =
        intervalDocumentId === undefined
          ? {}
          : intervalDocumentId === null
            ? noIntervalDocument
            : await intervalDocumentAt(tx, identity, intervalDocumentId, await chainOf(tx, duty))

      // Where a delegation covers the duty, the person comes from it (#336).
      const responsible =
        values.responsibleUserId === undefined
          ? null
          : await chosenResponsible(
              tx,
              this.catalogue,
              dayInGermany(),
              duty,
              values.responsibleUserId === null ? null : String(values.responsibleUserId),
            )

      if (typeof responsible === 'string') {
        throw new BadRequestException(responsible)
      }

      const [changed] = await tx
        .update(duties)
        .set({
          ...(rest as Partial<Duty>),
          ...term,
          ...document,
          ...(responsible !== null
            ? {
                responsibleUserId: responsible.userId,
                responsibleDelegationId: responsible.delegationId,
              }
            : {}),
        } as Partial<Duty>)
        .where(and(eq(duties.id, duty.id), isNull(duties.deletedAt)))
        .returning()

      return changed as Duty
    })
  }

  /** The day a duty ends, today unless another is named, with a reason on request. */
  @Post(':id/end')
  @RequiresPermission('duty.write')
  end(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Duty> {
    const values = fieldsOf(body, ['endsOn', 'endReason'] as const, ['endReason'] as const)
    const endsOn = values.endsOn ?? dayInGermany()

    refuse(dutyProblems({ endsOn, endReason: values.endReason }))

    return this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<Duty>(tx, duties, id, missing)

      if (duty.endsOn !== null) {
        throw new ConflictException(`Diese Pflicht endet schon am ${duty.endsOn}.`)
      }

      const [ended] = await tx
        .update(duties)
        .set({ endsOn: endsOn as string, endReason: (values.endReason ?? null) as string | null })
        .where(and(eq(duties.id, duty.id), isNull(duties.deletedAt)))
        .returning()

      return ended as Duty
    })
  }

  /**
   * A duty entered by mistake is marked deleted. One that was right and ends, is ended:
   * one with an evidence, or with an activity that was signed or closed, was no mistake
   * (#79). Deleting it would take its line off a page that was signed, as the activities
   * under a duty follow its deletion.
   */
  @Delete(':id')
  @RequiresPermission('duty.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Duty> {
    return this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<Duty>(tx, duties, id, missing)

      if (await leftARecord(tx, identity.tenantId, duty.id)) {
        throw new ConflictException(
          'Zu dieser Pflicht gibt es Nachweise oder einen unterschriebenen Vorgang. Sie wird nicht entfernt, sondern beendet.',
        )
      }

      const [removed] = await tx
        .update(duties)
        .set({ deletedAt: new Date() })
        .where(and(eq(duties.id, id as DutyId), isNull(duties.deletedAt)))
        .returning()

      return removed as Duty
    })
  }
}

/**
 * The proposals of the catalogue the operator dismissed, each with its reason
 * and the person (ADR 0002, point 11). A proposal is no record; dismissing
 * one is, and withdrawing the dismissal brings the proposal back.
 */
/**
 * The duties that hang on a room itself, each with how it stands today.
 * Beside the routes of the room and not among them, because what a duty
 * needs, the catalogue and the evidence, is no business of the room. The
 * duties of the assets in a room stand in their files.
 */
@Controller('rooms')
export class RoomDutiesController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /** The duties at the room that have not ended. Reading them is reading duties. */
  @Get(':id/duties')
  @RequiresPermission('duty.read')
  atRoom(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<DutyReading[]> {
    const today = dayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const room = await placeOf<Room>(tx, rooms, id, missingRoom)
      const running = (
        (await tx
          .select()
          .from(duties)
          .where(and(eq(duties.roomId, room.id as RoomId), isNull(duties.deletedAt)))) as Duty[]
      ).filter((duty) => !dutyHasEnded(duty, today))

      return (await dutiesOnADay(tx, today, running, this.catalogue))
        .map((registered) => dutyReading(registered, this.catalogue))
        .sort((left, right) => byNameIn(left.title, right.title))
    })
  }
}

@Controller('duty-dismissals')
export class DutyDismissalsController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  @Get()
  @RequiresPermission('duty.read')
  list(
    @CurrentIdentity() identity: Asking,
    @Query('assetId') assetId?: string,
  ): Promise<DutyDismissal[]> {
    return this.database.forTenant(identity, async (tx) => {
      if (assetId !== undefined && !isUuid(assetId)) {
        return []
      }

      return tx
        .select()
        .from(dutyDismissals)
        .where(
          and(
            isNull(dutyDismissals.deletedAt),
            assetId === undefined ? undefined : eq(dutyDismissals.assetId, assetId as AssetId),
          ),
        )
        .orderBy(asc(dutyDismissals.createdAt)) as Promise<DutyDismissal[]>
    })
  }

  /** Dismisses a proposal of the catalogue for an asset, with the reason. */
  @Post()
  @RequiresPermission('duty.write')
  dismiss(@CurrentIdentity() identity: Asking, @Body() body: unknown): Promise<DutyDismissal> {
    const values = fieldsOf(body, ['assetId', 'kind', 'reason'] as const)

    refuse(dismissalProblems(values))

    return this.database.forTenant(identity, async (tx) => {
      const row = await dismissalAt(
        tx,
        this.catalogue,
        identity,
        values.assetId,
        values.kind,
        values.reason as string,
        dayInGermany(),
      )
      const [created] = await tx.insert(dutyDismissals).values(row).returning()

      return created as DutyDismissal
    })
  }

  /**
   * One proposal dismissed at many assets at once, with one reason (#102,
   * section 4.3 of the concept). One transaction: exactly as many dismissals
   * as assets, or none where one of them is refused, and the answer says
   * which.
   */
  @Post('batch')
  @RequiresPermission('duty.write')
  dismissMany(
    @CurrentIdentity() identity: Asking,
    @Body() body: unknown,
  ): Promise<DutyDismissal[]> {
    const values = fieldsOf(body, ['kind', 'reason'] as const)
    const assetIds = (body as { assetIds?: unknown } | null)?.assetIds
    const today = dayInGermany()

    refuse({ ...dismissalProblems(values), ...problemOf('assetIds', batchAssetsProblem(assetIds)) })

    return this.database.forTenant(identity, async (tx) => {
      const rows = []

      for (const assetId of assetIds as readonly string[]) {
        rows.push(
          await atTheAsset(tx, assetId, () =>
            dismissalAt(
              tx,
              this.catalogue,
              identity,
              assetId,
              values.kind,
              values.reason as string,
              today,
            ),
          ),
        )
      }

      return (await tx.insert(dutyDismissals).values(rows).returning()) as DutyDismissal[]
    })
  }

  /** Withdraws a dismissal: the proposal is there again. */
  @Delete(':id')
  @RequiresPermission('duty.write')
  withdraw(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<DutyDismissal> {
    return this.database.forTenant(identity, async (tx) => {
      const dismissal = await placeOf<DutyDismissal>(tx, dutyDismissals, id, missingDismissal)

      const [withdrawn] = await tx
        .update(dutyDismissals)
        .set({ deletedAt: new Date() })
        .where(and(eq(dutyDismissals.id, dismissal.id), isNull(dutyDismissals.deletedAt)))
        .returning()

      return withdrawn as DutyDismissal
    })
  }
}

/**
 * Duties just written, with who answers for them once the delegations that
 * hold today are applied (#336), read again where that changed anything.
 */
async function withDelegations(
  tx: TenantTransaction,
  catalogue: Catalogue,
  written: readonly Duty[],
): Promise<Duty[]> {
  const ids = written.map((duty) => duty.id)

  if ((await applyDelegations(tx, catalogue, dayInGermany(), ids)) === 0) {
    return [...written]
  }

  const read = (await tx.select().from(duties).where(inArray(duties.id, ids))) as Duty[]

  return ids.map((id) => read.find((duty) => duty.id === id) as Duty)
}
