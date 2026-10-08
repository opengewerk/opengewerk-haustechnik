import {
  type AreaId,
  awaitsRemedy,
  type Catalogue,
  type DefectId,
  defectStatuses,
  dutyInterval,
  type DutyId,
  type IsoDate,
  lifecycleStateOn,
  nextAppointment,
  type PropertyId,
  restsOn,
  roomTitle,
} from '@opengewerk/haustechnik-domain'
import type { ExpectedDeadline, SourceQuery } from '@opengewerk/platform-server'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { dutyTitle, lifecyclesByAsset, metDaysByDuty } from '../database/duty-standing.js'
import { assets, buildings, defects, duties, properties, rooms } from '../database/schema/index.js'

/** What a deadline of this application hangs on, written into its own columns: a duty or a defect. */
export interface DeadlineValues {
  readonly dutyId: DutyId | null
  readonly defectId: DefectId | null
  readonly propertyId: PropertyId
  readonly areaId: AreaId
}

/** The names of what a duty or a defect hangs on, from the most narrow. */
interface PlaceNames {
  readonly assetName: string | null
  readonly assetNumber: string | null
  readonly roomNumber: string | null
  readonly roomName: string | null
  readonly buildingName: string | null
  readonly propertyName: string
}

/** What a deadline names after its subject: the asset, the room, the building or the property. */
function placeOf(place: PlaceNames): string {
  const asset =
    place.assetName === null
      ? null
      : place.assetNumber === null
        ? place.assetName
        : `${place.assetName} (${place.assetNumber})`
  const room =
    place.roomNumber === null && place.roomName === null
      ? null
      : roomTitle({ number: place.roomNumber, name: place.roomName })

  return asset ?? room ?? place.buildingName ?? place.propertyName
}

/** A duty with what its deadline is called after. */
interface DutyRow extends PlaceNames {
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
}

/**
 * What a deadline is called: the duty, by its own name or by the title of its
 * kind in the version that was confirmed, and what it hangs on.
 */
function labelOf(duty: DutyRow, catalogue: Catalogue): string {
  return `${dutyTitle(duty, catalogue)}, ${placeOf(duty)}`
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

    const performances = await metDaysByDuty(tx)
    const lives = await lifecyclesByAsset(tx)
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
        values: {
          dutyId: duty.id,
          defectId: null,
          propertyId: duty.propertyId,
          areaId: duty.areaId,
        },
      })
    }

    return expected
  }
}

/** The statuses whose defects wait to be set right, as the database asks for them. */
const defectStatusesAwaitingRemedy = defectStatuses.filter(awaitsRemedy)

/**
 * The source `defect` (section 4.6 of the concept, #116): one deadline for
 * every defect that names a day to be set right by, while it waits for that,
 * found or ordered. Once it is remedied the deadline drops, and it comes back
 * when a check finds the defect not set right after all.
 *
 * Anchored on the day the defect was found. Asked for every operator on every
 * pass of the engine, in every area of it.
 */
export function defectSource(): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const rows = await tx
      .select({
        id: defects.id,
        propertyId: defects.propertyId,
        areaId: defects.areaId,
        description: defects.description,
        foundOn: defects.foundOn,
        dueOn: defects.dueOn,
        assetName: assets.name,
        assetNumber: assets.number,
        roomNumber: rooms.number,
        roomName: rooms.name,
        buildingName: buildings.name,
        propertyName: properties.name,
      })
      .from(defects)
      .innerJoin(properties, eq(properties.id, defects.propertyId))
      .leftJoin(assets, eq(assets.id, defects.assetId))
      .leftJoin(rooms, eq(rooms.id, defects.roomId))
      .leftJoin(buildings, eq(buildings.id, defects.buildingId))
      .where(
        and(
          isNull(defects.deletedAt),
          isNotNull(defects.dueOn),
          inArray(defects.status, defectStatusesAwaitingRemedy),
        ),
      )

    return rows.flatMap((defect): ExpectedDeadline<DeadlineValues>[] =>
      defect.dueOn === null
        ? []
        : [
            {
              sourceId: defect.id,
              sourceLabel: `${defect.description}, ${placeOf(defect)}`,
              anchorOn: defect.foundOn,
              namedDueOn: defect.dueOn,
              naturalUserId: null,
              values: {
                dutyId: null,
                defectId: defect.id,
                propertyId: defect.propertyId,
                areaId: defect.areaId,
              },
            },
          ],
    )
  }
}
