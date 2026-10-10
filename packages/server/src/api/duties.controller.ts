import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import {
  type Asset,
  type AssetId,
  type Building,
  type Catalogue,
  type CatalogueEntry,
  type Counting,
  type DeadlineInterval,
  dismissalProblems,
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
  dutyProblems,
  type DutyReading,
  type DutyRegister,
  dutyTaskLabel,
  dutyTasks,
  type FederalState,
  type IntervalKind,
  intervalNeedsReason,
  intervalOfRule,
  intervalWords,
  isAllowed,
  type IsoDate,
  missingRight,
  namesAPerson,
  type Property,
  type Room,
  type RoomId,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  isUuid,
  listColleagues,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, isNull, notInArray } from 'drizzle-orm'

import { underWayFor } from '../activities/for-duty.js'
import { CATALOGUE } from '../catalogue.js'
import { dutiesOnADay, dutyTitle } from '../database/duty-standing.js'
import {
  activities,
  activityDuties,
  assets,
  buildings,
  duties,
  dutyDismissals,
  evidence,
  memberships,
  properties,
  rooms,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { inSight } from './activities.controller.js'
import { RequiresPermission } from './authorization.js'
import { listedEvidence } from './evidence.controller.js'
import { dutyReading, dutyRegister, dutyRegisterQuestion } from './duty-register.js'
import { type Asking, fieldsOf, placeOf, refuse } from './places.js'

const missing = 'Diese Pflicht gibt es nicht oder nicht mehr.'
const missingDismissal = 'Diesen verworfenen Vorschlag gibt es nicht oder nicht mehr.'
const missingAsset = 'Diese Anlage gibt es nicht oder nicht mehr.'
const missingRoom = 'Diesen Raum gibt es nicht oder nicht mehr.'
const missingBuilding = 'Dieses Gebäude gibt es nicht oder nicht mehr.'
const missingProperty = 'Diese Liegenschaft gibt es nicht oder nicht mehr.'

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
  'intervalDays',
  'intervalMonths',
  'intervalReason',
  'responsibleUserId',
  'performer',
  'performerNote',
] as const

/** The fields a duty may change. What it hangs on and what it is stay as they were confirmed. */
const changeFields = [
  'label',
  'basis',
  'sourceNote',
  'task',
  'intervalDays',
  'intervalMonths',
  'intervalReason',
  'responsibleUserId',
  'performer',
  'performerNote',
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
  'responsibleUserId',
  'performer',
  'performerNote',
] as const

/** The fields of a duty of the operator's own, which a duty from the catalogue takes from its kind. */
const ownFields = ['label', 'basis', 'sourceNote', 'task', 'counting'] as const

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

  if (given(values.assetId)) {
    const asset = await placeOf<Asset>(tx, assets, String(values.assetId), missingAsset)

    place = { propertyId: asset.propertyId, assetId: asset.id, assetKind: asset.kind }
  } else if (given(values.roomId)) {
    const room = await placeOf<Room>(tx, rooms, String(values.roomId), missingRoom)

    place = { propertyId: room.propertyId, roomId: room.id }
  } else if (given(values.buildingId)) {
    const building = await placeOf<Building>(
      tx,
      buildings,
      String(values.buildingId),
      missingBuilding,
    )

    place = { propertyId: building.propertyId, buildingId: building.id }
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
    areaId: property.areaId,
    buildingId: place.buildingId ?? null,
    roomId: place.roomId ?? null,
    assetId: place.assetId ?? null,
    federalState: property.federalState,
    assetKind: place.assetKind ?? null,
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
    .where(and(eq(memberships.userId, String(userId)), isNull(memberships.blockedAt)))

  if (member === undefined) {
    throw new BadRequestException('Verantwortlich ist jemand, der für diesen Betreiber arbeitet.')
  }
}

/** A note on the contractor belongs to a duty a contractor performs. */
function checkPerformer(performer: unknown, note: unknown): void {
  if (given(note) && performer !== 'contractor') {
    throw new BadRequestException(
      'Die Angabe zur Fremdfirma gehört zu einer Pflicht, die eine Fremdfirma ausführt.',
    )
  }
}

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
@Controller('duties')
export class DutiesController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
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
            .sort((left, right) => left.name.localeCompare(right.name, 'de'))
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
   * The page of a duty: the record whole, how it stands today, the asset it
   * hangs on and who answers for it. One that has ended is read like any
   * other, and says that it has.
   *
   * The inspection or maintenance under way for it (#183), for whoever reads
   * activities and as far as they are shown it: whoever only performs sees
   * one given to them or to nobody, as in the list of the activities.
   */
  @Get(':id')
  @RequiresPermission('duty.read')
  async read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<DutyDetails> {
    const today = dayInGermany()
    const read = await this.database.forTenant(identity, async (tx) => {
      const duty = await placeOf<Duty>(tx, duties, id, missing)
      const [registered] = await dutiesOnADay(tx, today, [duty])
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
      }
    })
    const { duty, registered, activity } = read
    const named = await this.named(identity, [duty.responsibleUserId])

    return {
      ...duty,
      title: dutyTitle(duty, this.catalogue),
      state: registered?.standing.state ?? 'never_recorded',
      appointment: registered?.standing.appointment ?? null,
      lastMetOn: registered?.lastMetOn ?? null,
      ended: dutyHasEnded(duty, today),
      removable: read.removable,
      asset: read.asset,
      responsible: named(duty.responsibleUserId),
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
    checkPerformer(values.performer, values.performerNote)

    return this.database.forTenant(identity, async (tx) => {
      const target = await targetOf(tx, values)
      let decided: {
        readonly kind: string | null
        readonly kindVersion: number | null
        readonly counting: Counting
        readonly maximum: DeadlineInterval | null
      }

      if (given(values.kind)) {
        if (ownFields.some((field) => given(values[field]))) {
          throw new BadRequestException(
            'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle, Tätigkeit und Zählweise von ihrer Pflichtart.',
          )
        }

        const entry = kindFor(this.catalogue, values.kind, target.assetKind, today)
        const { maximum, guide } = kindInterval(this.catalogue, entry, today, target.federalState)
        const counting = entry.definition.counting
        const problem = dutyIntervalProblem(values, counting, maximum)

        if (problem !== null) {
          throw new BadRequestException(problem)
        }

        if (
          intervalNeedsReason(entry.definition.interval.kind, intervalIn(values), guide) &&
          !given(values.intervalReason)
        ) {
          throw new BadRequestException(reasonSentence(entry.definition.interval.kind, guide))
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

        decided = { kind: entry.key, kindVersion: entry.version, counting, maximum }
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

        const counting = (values.counting ?? 'from_performance') as Counting
        const problem = dutyIntervalProblem(values, counting, null)

        if (problem !== null) {
          throw new BadRequestException(problem)
        }

        decided = { kind: null, kindVersion: null, counting, maximum: null }
      }

      await checkResponsible(tx, values.responsibleUserId)

      const interval = intervalIn(values)
      const [created] = await tx
        .insert(duties)
        .values({
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
          intervalDays: 'days' in interval ? interval.days : null,
          intervalMonths: 'months' in interval ? interval.months : null,
          intervalReason: (values.intervalReason ?? null) as string | null,
          maximumDays:
            decided.maximum !== null && 'days' in decided.maximum ? decided.maximum.days : null,
          maximumMonths:
            decided.maximum !== null && 'months' in decided.maximum ? decided.maximum.months : null,
          responsibleUserId: (values.responsibleUserId ?? null) as string | null,
          performer: (values.performer ?? null) as Duty['performer'],
          performerNote: (values.performerNote ?? null) as string | null,
          confirmedBy: identity.userId,
        })
        .returning()

      return created as Duty
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
          'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle und Tätigkeit von ihrer Pflichtart.',
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

      const intervalChanged =
        values.intervalDays !== undefined || values.intervalMonths !== undefined
      const interval = intervalChanged
        ? {
            intervalDays: values.intervalDays ?? null,
            intervalMonths: values.intervalMonths ?? null,
          }
        : { intervalDays: duty.intervalDays, intervalMonths: duty.intervalMonths }
      const problem = dutyIntervalProblem(interval, duty.counting, dutyMaximum(duty))

      if (problem !== null) {
        throw new BadRequestException(problem)
      }

      // Asked where the interval or its reason is what changes. A duty that
      // was confirmed before the guide of its kind changed departs from the
      // guide of today without anybody having decided so; saying who answers
      // for it is no reason to ask for one.
      const reasonAtStake = intervalChanged || values.intervalReason !== undefined

      if (reasonAtStake && duty.kind !== null && duty.kindVersion !== null) {
        const entry = this.catalogue.dutyKindVersion(duty.kind, duty.kindVersion)
        const property = await placeOf<Property>(tx, properties, duty.propertyId, missingProperty)
        const reason =
          values.intervalReason === undefined ? duty.intervalReason : values.intervalReason

        if (entry !== null) {
          const { guide } = kindInterval(this.catalogue, entry, today, property.federalState)

          if (
            intervalNeedsReason(entry.definition.interval.kind, intervalIn(interval), guide) &&
            !given(reason)
          ) {
            throw new BadRequestException(reasonSentence(entry.definition.interval.kind, guide))
          }
        }
      }

      checkPerformer(
        values.performer === undefined ? duty.performer : values.performer,
        values.performerNote === undefined ? duty.performerNote : values.performerNote,
      )
      await checkResponsible(tx, values.responsibleUserId)

      const [changed] = await tx
        .update(duties)
        .set({ ...(values as Partial<Duty>), ...interval } as Partial<Duty>)
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

      return (await dutiesOnADay(tx, today, running))
        .map((registered) => dutyReading(registered, this.catalogue))
        .sort((left, right) => left.title.localeCompare(right.title, 'de'))
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
      if (!given(values.assetId)) {
        throw new BadRequestException(
          'Verworfen wird ein Vorschlag für eine Anlage; sie ist nicht genannt.',
        )
      }

      const asset = await placeOf<Asset>(tx, assets, String(values.assetId), missingAsset)
      const entry = kindFor(this.catalogue, values.kind, asset.kind, dayInGermany())
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

      const [created] = await tx
        .insert(dutyDismissals)
        .values({
          tenantId: identity.tenantId,
          propertyId: asset.propertyId,
          areaId: asset.areaId,
          assetId: asset.id,
          kind: entry.key,
          kindVersion: entry.version,
          reason: values.reason as string,
          dismissedBy: identity.userId,
        })
        .returning()

      return created as DutyDismissal
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
