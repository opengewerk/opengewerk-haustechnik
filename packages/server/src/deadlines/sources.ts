import {
  type AreaId,
  type Catalogue,
  dutyInterval,
  type DutyId,
  type IsoDate,
  lifecycleStateOn,
  meetsTheDuty,
  nextAppointment,
  type PropertyId,
  restsOn,
  roomTitle,
  standingEvidence,
} from '@opengewerk/haustechnik-domain'
import type { ExpectedDeadline, SourceQuery } from '@opengewerk/platform-server'
import { asc, eq, isNull } from 'drizzle-orm'

import {
  assetLifecycle,
  assets,
  buildings,
  duties,
  evidence,
  evidenceVoidings,
  properties,
  rooms,
} from '../database/schema/index.js'

/** What a deadline of this application hangs on, written into its own columns. */
export interface DeadlineValues {
  readonly dutyId: DutyId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
}

/** A duty with what its deadline is called after. */
interface DutyRow {
  readonly id: DutyId
  readonly propertyId: PropertyId
  readonly areaId: AreaId
  readonly assetId: string | null
  readonly kind: string | null
  readonly kindVersion: number | null
  readonly label: string | null
  readonly counting: (typeof duties.$inferSelect)['counting']
  readonly intervalDays: number | null
  readonly intervalMonths: number | null
  readonly responsibleUserId: string | null
  readonly endsOn: IsoDate | null
  readonly assetName: string | null
  readonly assetNumber: string | null
  readonly roomNumber: string | null
  readonly roomName: string | null
  readonly buildingName: string | null
  readonly propertyName: string
}

/**
 * What a deadline is called: the duty, by its own name or by the title of its
 * kind in the version that was confirmed, and what it hangs on.
 */
function labelOf(duty: DutyRow, catalogue: Catalogue): string {
  const kind =
    duty.kind === null || duty.kindVersion === null
      ? null
      : (catalogue.dutyKindVersion(duty.kind, duty.kindVersion)?.definition.label ?? duty.kind)
  const what = duty.label ?? kind ?? 'Pflicht'
  const asset =
    duty.assetName === null
      ? null
      : duty.assetNumber === null
        ? duty.assetName
        : `${duty.assetName} (${duty.assetNumber})`
  const room =
    duty.roomNumber === null && duty.roomName === null
      ? null
      : roomTitle({ number: duty.roomNumber, name: duty.roomName })

  return `${what}, ${asset ?? room ?? duty.buildingName ?? duty.propertyName}`
}

/**
 * The source `duty` (ADR 0002, point 12): one deadline for every duty that
 * has an appointment, due on the day `nextAppointment` names from the
 * evidence that met it, its interval and its counting.
 *
 * Counted from the evidence that stands: neither replaced by a correction nor
 * declared invalid (ADR 0004, points 14 and 15), so that a duty whose only
 * evidence is invalid is open again.
 *
 * None for a duty that was never recorded, because it has no appointment; none
 * while its asset rests, because nothing on it falls due (section 2.2 of the
 * concept); and none once it has ended, nor for an appointment on or after the
 * day it ends, because from then on it calls for nothing. The engine lets a
 * deadline drop that its source no longer names, and brings it back when it
 * does again.
 *
 * Asked for every operator on every pass of the engine, in every area of it.
 */
export function dutySource(options: {
  readonly catalogue: Catalogue
  readonly today: () => IsoDate
}): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const today = options.today()
    const rows: DutyRow[] = await tx
      .select({
        id: duties.id,
        propertyId: duties.propertyId,
        areaId: duties.areaId,
        assetId: duties.assetId,
        kind: duties.kind,
        kindVersion: duties.kindVersion,
        label: duties.label,
        counting: duties.counting,
        intervalDays: duties.intervalDays,
        intervalMonths: duties.intervalMonths,
        responsibleUserId: duties.responsibleUserId,
        endsOn: duties.endsOn,
        assetName: assets.name,
        assetNumber: assets.number,
        roomNumber: rooms.number,
        roomName: rooms.name,
        buildingName: buildings.name,
        propertyName: properties.name,
      })
      .from(duties)
      .innerJoin(properties, eq(properties.id, duties.propertyId))
      .leftJoin(assets, eq(assets.id, duties.assetId))
      .leftJoin(rooms, eq(rooms.id, duties.roomId))
      .leftJoin(buildings, eq(buildings.id, duties.buildingId))
      .where(isNull(duties.deletedAt))

    const performances = new Map<string, IsoDate[]>()
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
      })
      .from(evidence)
      .orderBy(asc(evidence.performedOn))

    for (const row of standingEvidence(written, voided)) {
      if (meetsTheDuty(row.result)) {
        performances.set(row.dutyId, [...(performances.get(row.dutyId) ?? []), row.performedOn])
      }
    }

    const lives = new Map<
      string,
      { state: (typeof assetLifecycle.$inferSelect)['state']; validFrom: IsoDate }[]
    >()

    for (const entry of await tx
      .select({
        assetId: assetLifecycle.assetId,
        state: assetLifecycle.state,
        validFrom: assetLifecycle.validFrom,
      })
      .from(assetLifecycle)
      .where(isNull(assetLifecycle.deletedAt))) {
      lives.set(entry.assetId, [...(lives.get(entry.assetId) ?? []), entry])
    }

    const expected: ExpectedDeadline<DeadlineValues>[] = []

    for (const duty of rows) {
      if (duty.endsOn !== null && duty.endsOn <= today) {
        continue
      }

      const life = duty.assetId === null ? [] : (lives.get(duty.assetId) ?? [])
      const restingOn = (day: IsoDate) =>
        duty.assetId !== null && restsOn(lifecycleStateOn(life, day))

      if (restingOn(today)) {
        continue
      }

      const days = performances.get(duty.id) ?? []
      const appointment = nextAppointment(
        { counting: duty.counting, interval: dutyInterval(duty), outOfServiceOn: restingOn },
        days,
      )
      const last = days.at(-1)

      if (appointment === null || last === undefined) {
        continue
      }

      if (duty.endsOn !== null && appointment.dueOn >= duty.endsOn) {
        continue
      }

      expected.push({
        sourceId: duty.id,
        sourceLabel: labelOf(duty, options.catalogue),
        anchorOn: last,
        namedDueOn: appointment.dueOn,
        naturalUserId: duty.responsibleUserId,
        values: { dutyId: duty.id, propertyId: duty.propertyId, areaId: duty.areaId },
      })
    }

    return expected
  }
}
