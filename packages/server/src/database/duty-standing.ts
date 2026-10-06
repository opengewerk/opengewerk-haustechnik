import {
  type AssetStanding,
  assetStandingOn,
  type Catalogue,
  defectIsOpen,
  type Duty,
  dutyDue,
  dutyInterval,
  type DutyStanding,
  dutyStateOn,
  type IsoDate,
  type LastEvidence,
  leadOf,
  type LifecycleState,
  lifecycleStateOn,
  meetsTheDuty,
  nextAppointment,
  restsOn,
  standingEvidence,
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

/**
 * The evidence each duty was met by, the earliest day first, of these duties
 * or of every one. Only the evidence that stands: neither replaced by a
 * correction nor declared invalid (ADR 0004, points 14 and 15), so that a
 * duty whose only evidence is invalid is open again.
 */
export async function meetingEvidenceByDuty(
  tx: TenantTransaction,
  dutyIds?: readonly string[],
): Promise<ReadonlyMap<string, readonly LastEvidence[]>> {
  const performances = new Map<string, LastEvidence[]>()

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
        { number: row.number, performedOn: row.performedOn, origin: row.origin },
      ])
    }
  }

  return performances
}

/** The days each duty was met on, earliest first, of these duties or of every one. */
export async function metDaysByDuty(
  tx: TenantTransaction,
  dutyIds?: readonly string[],
): Promise<ReadonlyMap<string, readonly IsoDate[]>> {
  return new Map(
    [...(await meetingEvidenceByDuty(tx, dutyIds))].map(([dutyId, met]) => [
      dutyId,
      met.map((each) => each.performedOn),
    ]),
  )
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

/** What the standing of a duty is worked out from. */
export type CountedDuty = Pick<
  Duty,
  'id' | 'assetId' | 'counting' | 'intervalDays' | 'intervalMonths' | 'endsOn'
>

/** How a duty stands on a day, and the last day it was met. */
export interface DutyOnADay {
  readonly standing: DutyStanding
  readonly lastMetOn: IsoDate | null
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
export function dutyOnADay(
  duty: CountedDuty,
  on: {
    readonly today: IsoDate
    readonly life: readonly LifeEntry[]
    readonly met: readonly IsoDate[]
    readonly leadDays: number
  },
): DutyOnADay {
  const restingOn = (day: IsoDate) =>
    duty.assetId !== null && restsOn(lifecycleStateOn(on.life, day))
  const resting = restingOn(on.today)
  const appointment = nextAppointment(
    { counting: duty.counting, interval: dutyInterval(duty), outOfServiceOn: restingOn },
    on.met,
  )
  const lastMetOn = on.met.at(-1) ?? null

  if (
    !resting &&
    appointment !== null &&
    duty.endsOn !== null &&
    appointment.dueOn >= duty.endsOn
  ) {
    return { standing: { state: 'met', appointment: null }, lastMetOn }
  }

  return {
    standing: dutyStateOn({ appointment, resting, leadDays: on.leadDays, on: on.today }),
    lastMetOn,
  }
}

/** A duty at an asset with how it stands today. */
export interface StandingDuty extends DutyOnADay {
  readonly duty: Duty
}

/** A duty with how it stands on a day and the evidence its appointment is counted from. */
export interface RegisteredDuty extends StandingDuty {
  readonly lastEvidence: LastEvidence | null
}

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

  return rows.map((duty) => {
    const evidenceOfIt = met.get(duty.id) ?? []

    return {
      duty,
      lastEvidence: evidenceOfIt.at(-1) ?? null,
      ...dutyOnADay(duty, {
        today,
        life: duty.assetId === null ? [] : (lives.get(duty.assetId) ?? []),
        met: evidenceOfIt.map((each) => each.performedOn),
        leadDays: leadDays(duty.id),
      }),
    }
  })
}

/** An asset on a day: the state of its life cycle, its condition, and its duties that have not ended. */
export interface AssetOnADay extends AssetStanding {
  readonly lifecycleState: LifecycleState | null
  readonly duties: readonly StandingDuty[]
}

/**
 * How assets stand on a day, these or every one the transaction sees: asked
 * with the id of an asset, also of one that has no entry in its life cycle,
 * no duty and no defect.
 *
 * A duty that has ended is not among the duties of its asset: from the day it
 * ends it calls for nothing. A defect counts as open until it was checked
 * again (`defectIsOpen`).
 */
export async function assetsOnADay(
  tx: TenantTransaction,
  today: IsoDate,
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
  const met = await metDaysByDuty(
    tx,
    assetIds === undefined ? undefined : running.map((duty) => duty.id),
  )
  const leadDays = await leadDaysByDuty(tx)
  const open = new Map<string, number>()

  if (!nothing) {
    for (const defect of await tx
      .select({ assetId: defects.assetId, status: defects.status })
      .from(defects)
      .where(
        and(isNull(defects.deletedAt), isNotNull(defects.assetId), narrowed(defects.assetId)),
      )) {
      if (defect.assetId !== null && defectIsOpen(defect.status)) {
        open.set(defect.assetId, (open.get(defect.assetId) ?? 0) + 1)
      }
    }
  }

  const dutiesOf = new Map<string, StandingDuty[]>()

  for (const duty of running) {
    const assetId = duty.assetId as string

    dutiesOf.set(assetId, [
      ...(dutiesOf.get(assetId) ?? []),
      {
        duty,
        ...dutyOnADay(duty, {
          today,
          life: lives.get(assetId) ?? [],
          met: met.get(duty.id) ?? [],
          leadDays: leadDays(duty.id),
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
      ...assetStandingOn({
        openDefects: open.get(assetId) ?? 0,
        resting: restsOn(lifecycleState),
        duties: own.map((each) => each.standing),
      }),
    }
  }
}
