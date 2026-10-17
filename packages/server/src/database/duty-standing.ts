import {
  type AssetStanding,
  assetStandingOn,
  type Catalogue,
  ceilingOf,
  cutShortTo,
  type DeadlineInterval,
  defectIsOpen,
  type Duty,
  type DutyTerm,
  dutyDue,
  dutyInterval,
  type DutyStanding,
  dutyStateOn,
  dutyUpdate,
  type FederalState,
  type IsoDate,
  type LastEvidence,
  leadOf,
  type LifecycleState,
  lifecycleStateOn,
  meetsTheDuty,
  nextAppointment,
  replayedTerms,
  restsOn,
  type Rhythm,
  type ShutDownDefect,
  shutsDownItsAsset,
  standingEvidence,
  type TakenOverAppointment,
  takenOverFrom,
} from '@opengewerk/haustechnik-domain'
import { deadlineSettingsOf, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import {
  assetLifecycle,
  deadlines,
  defects,
  duties,
  evidence,
  evidenceVoidings,
  properties,
} from './schema/index.js'

/**
 * How the duties and the assets of an operator stand on a day, read from the
 * records and worked out by the functions of the package `domain` (ADR 0002,
 * point 16): nothing here is stored. The deadline engine and the routes ask
 * the same questions here, so that a deadline, the state of a duty and the
 * condition of an asset never tell three stories.
 *
 * Every question sees what its transaction sees: a pass of the engine every
 * area of an operator, a route the areas of the person asking.
 */

/** One entry of a life cycle, as the question of a day needs it. */
export interface LifeEntry {
  readonly state: LifecycleState
  readonly validFrom: IsoDate
}

/** What a duty is called: by its own name, or by the title of its kind in the version that was confirmed. */
export function dutyTitle(
  duty: Pick<Duty, 'kind' | 'kindVersion' | 'label'>,
  catalogue: Catalogue,
): string {
  const kind =
    duty.kind === null || duty.kindVersion === null
      ? null
      : (catalogue.dutyKindVersion(duty.kind, duty.kindVersion)?.definition.label ?? duty.kind)

  return duty.label ?? kind ?? 'Pflicht'
}

/** The life cycle of each asset, of these assets or of every one. */
export async function lifecyclesByAsset(
  tx: TenantTransaction,
  assetIds?: readonly string[],
): Promise<ReadonlyMap<string, readonly LifeEntry[]>> {
  const lives = new Map<string, LifeEntry[]>()

  if (assetIds?.length === 0) {
    return lives
  }

  for (const entry of await tx
    .select({
      assetId: assetLifecycle.assetId,
      state: assetLifecycle.state,
      validFrom: assetLifecycle.validFrom,
    })
    .from(assetLifecycle)
    .where(
      and(
        isNull(assetLifecycle.deletedAt),
        assetIds === undefined
          ? undefined
          : inArray(
              assetLifecycle.assetId,
              assetIds as (typeof assetLifecycle.$inferSelect)['assetId'][],
            ),
      ),
    )) {
    lives.set(entry.assetId, [...(lives.get(entry.assetId) ?? []), entry])
  }

  return lives
}

/** An evidence a duty was met by, with the next due day a list named where it was taken over (#130). */
export type MeetingEvidence = LastEvidence & { readonly nextDueOn: IsoDate | null }

/**
 * The evidence each duty was met by, the earliest day first, of these duties
 * or of every one. Only the evidence that stands: neither replaced by a
 * correction nor declared invalid (ADR 0004, points 14 and 15), so that a
 * duty whose only evidence is invalid is open again.
 */
export async function meetingEvidenceByDuty(
  tx: TenantTransaction,
  dutyIds?: readonly string[],
): Promise<ReadonlyMap<string, readonly MeetingEvidence[]>> {
  const performances = new Map<string, MeetingEvidence[]>()

  if (dutyIds?.length === 0) {
    return performances
  }

  const voided = new Set(
    (await tx.select({ evidenceId: evidenceVoidings.evidenceId }).from(evidenceVoidings)).map(
      (row) => row.evidenceId as string,
    ),
  )
  const written = await tx
    .select({
      id: evidence.id,
      replacesEvidenceId: evidence.replacesEvidenceId,
      dutyId: evidence.dutyId,
      performedOn: evidence.performedOn,
      result: evidence.result,
      number: evidence.number,
      origin: evidence.origin,
      nextDueOn: evidence.nextDueOn,
    })
    .from(evidence)
    .where(
      dutyIds === undefined
        ? undefined
        : inArray(evidence.dutyId, dutyIds as (typeof evidence.$inferSelect)['dutyId'][]),
    )
    .orderBy(asc(evidence.performedOn), asc(evidence.writtenAt))

  for (const row of standingEvidence(written, voided)) {
    if (meetsTheDuty(row.result)) {
      performances.set(row.dutyId, [
        ...(performances.get(row.dutyId) ?? []),
        {
          id: row.id,
          number: row.number,
          performedOn: row.performedOn,
          origin: row.origin,
          nextDueOn: row.nextDueOn,
        },
      ])
    }
  }

  return performances
}

/**
 * The last of the evidence a duty was met by, as a list shows it: without the
 * due day a list named for it, which only the counting asks for.
 */
export function lastOf(met: readonly MeetingEvidence[]): LastEvidence | null {
  const last = met.at(-1)

  return last === undefined
    ? null
    : { id: last.id, number: last.number, performedOn: last.performedOn, origin: last.origin }
}

/**
 * From how many days before its due day a duty counts as due: the lead its
 * deadline has of its own, else what the operator set for the kind, else the
 * kind's own (`leadOf`). The same days the reminder of the deadline goes by,
 * so that "fällig" at an asset and the reminder begin on one day.
 */
export async function leadDaysByDuty(tx: TenantTransaction): Promise<(dutyId: string) => number> {
  const setting = (await deadlineSettingsOf(tx)).get(dutyDue.key) ?? null
  const own = new Map(
    (
      await tx
        .select({ dutyId: deadlines.dutyId, leadDays: deadlines.leadDays })
        .from(deadlines)
        .where(and(eq(deadlines.kind, dutyDue.key), isNotNull(deadlines.leadDays)))
    ).map((row) => [row.dutyId as string, row.leadDays]),
  )

  return (dutyId) => leadOf(dutyDue, setting, own.get(dutyId) ?? null)
}

/** The maximum a regulation sets for the interval of a duty on a day, or nothing. */
export type Ceiling = (day: IsoDate) => DeadlineInterval | null

/**
 * The maximum the catalogue sets for each duty kind in each federal state on
 * a day (section 2.3 of the concept, #139), asked of the catalogue once for a
 * kind, a state and a day: a register asks it for some thousand duties of a
 * few kinds.
 */
export function ceilingsOf(
  catalogue: Catalogue,
): (kind: string | null, state: FederalState) => Ceiling {
  const known = new Map<string, Map<IsoDate, DeadlineInterval | null>>()

  return (kind, state) => {
    if (kind === null) {
      return () => null
    }

    const days = known.get(`${state} ${kind}`) ?? new Map<IsoDate, DeadlineInterval | null>()
    const ask = ceilingOf(catalogue, kind, state)

    known.set(`${state} ${kind}`, days)

    return (day) => {
      const found = days.get(day)

      if (found !== undefined) {
        return found
      }

      const asked = ask(day)

      days.set(day, asked)

      return asked
    }
  }
}

/**
 * The federal state of every property the transaction sees: the state the
 * rules of a duty are read in. A duty is seen with its property, so each
 * duty finds its own.
 */
export async function statesByProperty(
  tx: TenantTransaction,
): Promise<ReadonlyMap<string, FederalState>> {
  return new Map(
    (
      await tx.select({ id: properties.id, federalState: properties.federalState }).from(properties)
    ).map((row) => [row.id as string, row.federalState]),
  )
}

/** What the standing of a duty is worked out from. */
export type CountedDuty = Pick<
  Duty,
  'id' | 'assetId' | 'counting' | 'intervalDays' | 'intervalMonths' | 'endsOn'
>

/** How a duty stands on a day, and the last day it was met. */
export interface DutyOnADay {
  readonly standing: DutyStanding
  readonly lastMetOn: IsoDate | null
  /**
   * The interval it counts with on the day where a regulation cuts its own
   * short (#139), or nothing: its own interval is within the maximum.
   */
  readonly shortened: DeadlineInterval | null
}

/**
 * How one duty stands on a day, from the life cycle of its asset, the days
 * it was met on and its lead.
 *
 * An appointment on or after the day the duty ends is none: from then on the
 * duty calls for nothing, and the deadline engine keeps no deadline for it
 * either. So a duty that was met and ends before it falls due again is met,
 * and never due.
 */
/** What a duty is counted from on a day: its life cycle, its evidence taken over and the maximum of its kind. */
export interface CountedOn {
  readonly today: IsoDate
  readonly life: readonly LifeEntry[]
  readonly met: readonly IsoDate[]
  /** The appointment its evidence was taken over with from a predecessor application (#130), if it was. */
  readonly takenOver?: TakenOverAppointment | null
  readonly leadDays: number
  /** The maximum of its kind on a day; without one the duty counts with its own interval on every day. */
  readonly ceiling?: Ceiling
}

/**
 * How a duty is counted on a day: its counting and interval, the days its
 * asset rests, the evidence taken over and the maximum of its kind. The one
 * place the rhythm is put together, for the standing of a day and for the
 * terms replayed for the figures over time (#334), so that both count alike.
 */
export function rhythmOf(duty: CountedDuty, on: CountedOn): Rhythm {
  const { ceiling } = on

  return {
    counting: duty.counting,
    interval: dutyInterval(duty),
    outOfServiceOn: (day: IsoDate) =>
      duty.assetId !== null && restsOn(lifecycleStateOn(on.life, day)),
    takenOver: on.takenOver ?? null,
    ...(ceiling === undefined ? {} : { ceiling: { on: ceiling, today: on.today } }),
  }
}

export function dutyOnADay(duty: CountedDuty, on: CountedOn): DutyOnADay {
  const rhythm = rhythmOf(duty, on)
  const resting = rhythm.outOfServiceOn?.(on.today) ?? false
  const { ceiling } = on
  const appointment = nextAppointment(rhythm, on.met)
  const lastMetOn = on.met.at(-1) ?? null
  const shortened = ceiling === undefined ? null : cutShortTo(duty, ceiling(on.today))

  if (
    !resting &&
    appointment !== null &&
    duty.endsOn !== null &&
    appointment.dueOn >= duty.endsOn
  ) {
    return { standing: { state: 'met', appointment: null }, lastMetOn, shortened }
  }

  return {
    standing: dutyStateOn({ appointment, resting, leadDays: on.leadDays, on: on.today }),
    lastMetOn,
    shortened,
  }
}

/**
 * Whether the catalogue says something new about a duty that still stands
 * (#139): the mark "Neue Fassung" of a row. Asked without the asset, because
 * a version that no longer takes the asset in is a newer version already.
 */
function isUpdated(
  catalogue: Catalogue,
  duty: Duty,
  state: FederalState | undefined,
  today: IsoDate,
): boolean {
  return (
    state !== undefined &&
    (duty.endsOn === null || duty.endsOn > today) &&
    dutyUpdate(catalogue, duty, { state, subject: null }, today) !== null
  )
}

/** A duty with how it stands on a day and the evidence its appointment is counted from. */
export interface StandingDuty extends DutyOnADay {
  readonly duty: Duty
  readonly lastEvidence: LastEvidence | null
  /** Whether the catalogue says something new about it that nobody decided on yet (#139). */
  readonly updated: boolean
}

/** A duty of the register, worked out like the duties in the file of an asset. */
export type RegisteredDuty = StandingDuty

/**
 * From how many duties on the evidence and the life cycles are read whole
 * rather than by a list of ids: a list of some thousand ids is the longer
 * question.
 */
const readWholeFrom = 500

/**
 * How these duties stand on a day, whatever they hang on: an asset, whose
 * life cycle lets them rest, or a room, a building or a property, which are
 * never out of service. The one place a duty outside the file of an asset is
 * worked out, with the same functions as inside it (`dutyOnADay`), so that
 * the register, the page of a duty and the file of its asset say the same.
 *
 * A duty that has ended is worked out like any other: what it says then is
 * how it stood, and whoever lists it says that it has ended.
 */
export async function dutiesOnADay(
  tx: TenantTransaction,
  today: IsoDate,
  rows: readonly Duty[],
  catalogue: Catalogue,
): Promise<RegisteredDuty[]> {
  if (rows.length === 0) {
    return []
  }

  const whole = rows.length >= readWholeFrom
  const assetIds = [
    ...new Set(rows.flatMap((duty) => (duty.assetId === null ? [] : [duty.assetId]))),
  ]
  const lives = await lifecyclesByAsset(tx, whole ? undefined : assetIds)
  const met = await meetingEvidenceByDuty(tx, whole ? undefined : rows.map((duty) => duty.id))
  const leadDays = await leadDaysByDuty(tx)
  const states = await statesByProperty(tx)
  const ceilings = ceilingsOf(catalogue)

  return rows.map((duty) => {
    const evidenceOfIt = met.get(duty.id) ?? []
    const state = states.get(duty.propertyId)

    return {
      duty,
      lastEvidence: lastOf(evidenceOfIt),
      updated: isUpdated(catalogue, duty, state, today),
      ...dutyOnADay(duty, {
        today,
        life: duty.assetId === null ? [] : (lives.get(duty.assetId) ?? []),
        met: evidenceOfIt.map((each) => each.performedOn),
        takenOver: takenOverFrom(evidenceOfIt),
        leadDays: leadDays(duty.id),
        ...(state === undefined ? {} : { ceiling: ceilings(duty.kind, state) }),
      }),
    }
  })
}

/**
 * The terms these duties had up to a day, replayed from their evidence, by
 * the id of each duty (#334): read like `dutiesOnADay` and counted with the
 * same rhythm, so that a figure over time and the register say the same of a
 * duty. A duty never met has none.
 */
export async function termsOfDuties(
  tx: TenantTransaction,
  today: IsoDate,
  rows: readonly Duty[],
  catalogue: Catalogue,
): Promise<ReadonlyMap<string, readonly DutyTerm[]>> {
  if (rows.length === 0) {
    return new Map()
  }

  const whole = rows.length >= readWholeFrom
  const assetIds = [
    ...new Set(rows.flatMap((duty) => (duty.assetId === null ? [] : [duty.assetId]))),
  ]
  const lives = await lifecyclesByAsset(tx, whole ? undefined : assetIds)
  const met = await meetingEvidenceByDuty(tx, whole ? undefined : rows.map((duty) => duty.id))
  const states = await statesByProperty(tx)
  const ceilings = ceilingsOf(catalogue)

  return new Map(
    rows.map((duty) => {
      const evidenceOfIt = met.get(duty.id) ?? []
      const state = states.get(duty.propertyId)
      const days = evidenceOfIt.map((each) => each.performedOn)
      const rhythm = rhythmOf(duty, {
        today,
        life: duty.assetId === null ? [] : (lives.get(duty.assetId) ?? []),
        met: days,
        takenOver: takenOverFrom(evidenceOfIt),
        leadDays: 0,
        ...(state === undefined ? {} : { ceiling: ceilings(duty.kind, state) }),
      })

      return [duty.id as string, replayedTerms(rhythm, days, { endsOn: duty.endsOn, today })]
    }),
  )
}

/**
 * An asset on a day: the state of its life cycle, its condition, its duties
 * that have not ended, and the defects that put it out of service (#345),
 * the one found first first.
 */
export interface AssetOnADay extends AssetStanding {
  readonly lifecycleState: LifecycleState | null
  readonly duties: readonly StandingDuty[]
  readonly shutDownBy: readonly ShutDownDefect[]
}

/**
 * How assets stand on a day, these or every one the transaction sees: asked
 * with the id of an asset, also of one that has no entry in its life cycle,
 * no duty and no defect.
 *
 * A duty that has ended is not among the duties of its asset: from the day it
 * ends it calls for nothing. A defect counts as open until it was checked
 * again (`defectIsOpen`), and puts its asset out of service while it waits
 * to be set right and its class makes an asset unsafe (`shutsDownItsAsset`).
 */
export async function assetsOnADay(
  tx: TenantTransaction,
  today: IsoDate,
  catalogue: Catalogue,
  assetIds?: readonly string[],
): Promise<(assetId: string) => AssetOnADay> {
  const nothing = assetIds?.length === 0
  const lives = await lifecyclesByAsset(tx, assetIds)
  const narrowed = <Column>(column: Column) =>
    assetIds === undefined ? undefined : inArray(column as never, assetIds as never[])
  const running = nothing
    ? []
    : (
        (await tx
          .select()
          .from(duties)
          .where(and(isNull(duties.deletedAt), isNotNull(duties.assetId), narrowed(duties.assetId)))
          .orderBy(asc(duties.confirmedAt))) as Duty[]
      ).filter((duty) => duty.endsOn === null || duty.endsOn > today)
  const met = await meetingEvidenceByDuty(
    tx,
    assetIds === undefined ? undefined : running.map((duty) => duty.id),
  )
  const leadDays = await leadDaysByDuty(tx)
  const states = await statesByProperty(tx)
  const ceilings = ceilingsOf(catalogue)
  const open = new Map<string, number>()
  const unsafe = new Map<string, ShutDownDefect[]>()

  if (!nothing) {
    for (const defect of await tx
      .select({
        id: defects.id,
        assetId: defects.assetId,
        status: defects.status,
        defectClass: defects.defectClass,
        description: defects.description,
        foundOn: defects.foundOn,
        dueOn: defects.dueOn,
      })
      .from(defects)
      .where(and(isNull(defects.deletedAt), isNotNull(defects.assetId), narrowed(defects.assetId)))
      .orderBy(asc(defects.foundOn), asc(defects.createdAt), asc(defects.id))) {
      if (defect.assetId !== null && defectIsOpen(defect.status)) {
        open.set(defect.assetId, (open.get(defect.assetId) ?? 0) + 1)
      }

      if (defect.assetId !== null && shutsDownItsAsset(defect, catalogue)) {
        const { id, description, defectClass, foundOn, dueOn } = defect

        unsafe.set(defect.assetId, [
          ...(unsafe.get(defect.assetId) ?? []),
          { id, description, defectClass, foundOn, dueOn },
        ])
      }
    }
  }

  const dutiesOf = new Map<string, StandingDuty[]>()

  for (const duty of running) {
    const assetId = duty.assetId as string
    const evidenceOfIt = met.get(duty.id) ?? []
    const state = states.get(duty.propertyId)

    dutiesOf.set(assetId, [
      ...(dutiesOf.get(assetId) ?? []),
      {
        duty,
        lastEvidence: lastOf(evidenceOfIt),
        updated: isUpdated(catalogue, duty, state, today),
        ...dutyOnADay(duty, {
          today,
          life: lives.get(assetId) ?? [],
          met: evidenceOfIt.map((each) => each.performedOn),
          takenOver: takenOverFrom(evidenceOfIt),
          leadDays: leadDays(duty.id),
          ...(state === undefined ? {} : { ceiling: ceilings(duty.kind, state) }),
        }),
      },
    ])
  }

  return (assetId) => {
    const lifecycleState = lifecycleStateOn(lives.get(assetId) ?? [], today)
    const own = dutiesOf.get(assetId) ?? []

    return {
      lifecycleState,
      duties: own,
      shutDownBy: unsafe.get(assetId) ?? [],
      ...assetStandingOn({
        openDefects: open.get(assetId) ?? 0,
        resting: restsOn(lifecycleState),
        duties: own.map((each) => each.standing),
      }),
    }
  }
}
