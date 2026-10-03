import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
  type DutyDismissal,
  type DutyId,
  dutyIntervalProblem,
  type DutyKind,
  dutyMaximum,
  dutyProblems,
  type FederalState,
  type IntervalKind,
  intervalNeedsReason,
  intervalOfRule,
  intervalWords,
  type IsoDate,
  type Property,
  type Room,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  requireSomething,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import {
  assets,
  buildings,
  duties,
  dutyDismissals,
  memberships,
  properties,
  rooms,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
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
const ownFields = ['label', 'basis', 'sourceNote', 'counting'] as const

type Values = Partial<Record<(typeof newFields)[number], unknown>>

function given(value: unknown): boolean {
  return value !== undefined && value !== null
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

  @Get(':id')
  @RequiresPermission('duty.read')
  read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Duty> {
    return this.database.forTenant(identity, (tx) => placeOf<Duty>(tx, duties, id, missing))
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
            'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage, Quelle und Zählweise von ihrer Pflichtart.',
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
   * it, and for a duty of the operator's own its name, basis and source. The
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
          'Eine Pflicht aus dem Katalog nimmt Bezeichnung, Grundlage und Quelle von ihrer Pflichtart.',
        )
      }

      if (duty.kind === null) {
        for (const field of ['label', 'basis', 'sourceNote'] as const) {
          if (values[field] === null) {
            throw new BadRequestException(
              'Eine eigene Pflicht behält Bezeichnung, Grundlage und Quelle.',
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

      if (duty.kind !== null && duty.kindVersion !== null) {
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

  /** A duty entered by mistake is marked deleted. One that was right and ends, is ended. */
  @Delete(':id')
  @RequiresPermission('duty.write')
  remove(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<Duty> {
    return this.database.forTenant(identity, async (tx) => {
      await placeOf<Duty>(tx, duties, id, missing)

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
