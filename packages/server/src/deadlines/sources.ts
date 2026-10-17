import {
  addDays,
  addMonths,
  type AreaId,
  type AssetId,
  type AttachmentId,
  type ContractId,
  contractStanding,
  type Asset,
  awaitsRemedy,
  type Catalogue,
  type DefectId,
  defectStatuses,
  dutyInterval,
  type DutyDelegationId,
  type DutyId,
  type FederalState,
  firstOpenPass,
  roundMadeBy,
  holidayClosures,
  holidaysBetween,
  type IsoDate,
  lastDayOf,
  lifecycleStateOn,
  meterRestsOn,
  nextAppointment,
  noticeBy,
  passSearchDays,
  type PropertyId,
  restsOn,
  roomTitle,
  type RoundPlanId,
  takenOverFrom,
  termEnd,
  validReadings,
  type WorkOrderId,
} from '@opengewerk/haustechnik-domain'
import type { ExpectedDeadline, SourceQuery } from '@opengewerk/platform-server'
import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'

import {
  ceilingsOf,
  dutyTitle,
  lifecyclesByAsset,
  meetingEvidenceByDuty,
} from '../database/duty-standing.js'
import { heldOf, keyDateDue, operatorKeyDay } from '../database/meter-standing.js'
import {
  activities,
  assets,
  attachments,
  attachmentVersions,
  buildingClosures,
  buildings,
  contractors,
  contracts,
  dutyDelegationRevocations,
  dutyDelegations,
  dutyDelegationSignatures,
  defects,
  duties,
  workOrders,
  properties,
  rooms,
  roundPlans,
  roundTemplates,
} from '../database/schema/index.js'

/**
 * What a deadline of this application hangs on, written into its own
 * columns: a duty, a defect, the plan of a round, the meters of a property or
 * a document.
 */
export interface DeadlineValues {
  readonly dutyId: DutyId | null
  readonly defectId: DefectId | null
  readonly roundPlanId: RoundPlanId | null
  readonly meterPropertyId: PropertyId | null
  readonly attachmentId: AttachmentId | null
  readonly contractId: ContractId | null
  readonly warrantyAssetId: AssetId | null
  readonly warrantyOrderId: WorkOrderId | null
  /** The delegation of duties whose end it follows (#336), which lies in no area either. */
  readonly delegationId: DutyDelegationId | null
  /** None for the document of a contractor (#328) and for a contract (#329), which lie in no area. */
  readonly propertyId: PropertyId | null
  readonly areaId: AreaId | null
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

/**
 * What a deadline names after its subject: the asset, the room, the building
 * or the property. An asset by its number and its name, "AN-00012 Aufzug
 * Schulhaus", as the office writes an asset everywhere (#264), and by its
 * name alone until it has a number.
 */
function placeOf(place: PlaceNames): string {
  const asset =
    place.assetName === null
      ? null
      : place.assetNumber === null
        ? place.assetName
        : `${place.assetNumber} ${place.assetName}`
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
  readonly federalState: FederalState
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
        federalState: properties.federalState,
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

    const performances = await meetingEvidenceByDuty(tx)
    const lives = await lifecyclesByAsset(tx)
    const ceilings = ceilingsOf(options.catalogue)
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

      const met = performances.get(duty.id) ?? []
      const days = met.map((each) => each.performedOn)
      // With the maximum of the day: a regulation that shortens it counts
      // from its day, whether anybody took it over or not (#139).
      const appointment = nextAppointment(
        {
          counting: duty.counting,
          interval: dutyInterval(duty),
          outOfServiceOn: restingOn,
          ceiling: { on: ceilings(duty.kind, duty.federalState), today },
          // What a list named for an evidence taken over stands (#130).
          takenOver: takenOverFrom(met),
        },
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
          roundPlanId: null,
          meterPropertyId: null,
          attachmentId: null,
          contractId: null,
          warrantyAssetId: null,
          warrantyOrderId: null,
          delegationId: null,
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
                roundPlanId: null,
                meterPropertyId: null,
                attachmentId: null,
                contractId: null,
                warrantyAssetId: null,
                warrantyOrderId: null,
                delegationId: null,
                propertyId: defect.propertyId,
                areaId: defect.areaId,
              },
            },
          ],
    )
  }
}

/**
 * The source `round_plan` (#113, section 4.5 of the concept): one deadline for
 * every plan that runs, for its first pass from today on that has no round
 * yet, passing over the days its building is closed. Due on the day its
 * round has to be made by (`roundMadeBy`, #394): the pass of a daily plan,
 * the day a round of any other shows from, so that the round of the last day
 * of a month stands on the 1st. When the lead begins,
 * the engine makes the rounds as far ahead as the lead reaches
 * (`activityFromDeadline`), and the deadline moves on to the first pass after
 * them.
 *
 * None for a plan that rests, that has ended or whose place is gone, and none
 * for one whose passes all lie in a closure or after its end: the engine lets
 * its deadline drop and brings it back when the plan runs again. A pass
 * before today that has no round is not made up for: the rounds of a plan
 * are made ahead, and a past day without one is what the list of the runs
 * shows.
 *
 * Anchored on the pass, so that a deadline marked done comes back with the
 * next one. Asked for every operator on every pass of the engine, in every
 * area of it.
 */
export function roundPlanSource(options: {
  readonly today: () => IsoDate
  /** The statutory public holidays a plan may leave out (#200). */
  readonly catalogue: Pick<Catalogue, 'ruleSet'>
}): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const today = options.today()
    const plans = await tx
      .select({
        plan: roundPlans,
        title: roundTemplates.title,
        buildingName: buildings.name,
        propertyName: properties.name,
        federalState: properties.federalState,
      })
      .from(roundPlans)
      .innerJoin(roundTemplates, eq(roundTemplates.id, roundPlans.templateId))
      .innerJoin(properties, eq(properties.id, roundPlans.propertyId))
      .leftJoin(buildings, eq(buildings.id, roundPlans.buildingId))
      .where(
        and(
          isNull(roundPlans.deletedAt),
          eq(roundPlans.resting, false),
          or(isNull(roundPlans.endsOn), gte(roundPlans.endsOn, today)),
        ),
      )

    if (plans.length === 0) {
      return []
    }

    const buildingIds = plans.flatMap(({ plan }) =>
      plan.buildingId === null ? [] : [plan.buildingId],
    )
    const closures =
      buildingIds.length === 0
        ? []
        : await tx
            .select({
              buildingId: buildingClosures.buildingId,
              startsOn: buildingClosures.startsOn,
              endsOn: buildingClosures.endsOn,
            })
            .from(buildingClosures)
            .where(
              and(
                inArray(buildingClosures.buildingId, buildingIds),
                isNull(buildingClosures.deletedAt),
                gte(buildingClosures.endsOn, today),
              ),
            )
    const rounds = await tx
      .select({ planId: activities.roundPlanId, dueOn: activities.dueOn })
      .from(activities)
      .where(
        and(
          inArray(
            activities.roundPlanId,
            plans.map(({ plan }) => plan.id),
          ),
          isNull(activities.deletedAt),
          gte(activities.dueOn, today),
        ),
      )

    return plans.flatMap(
      ({
        plan,
        title,
        buildingName,
        propertyName,
        federalState,
      }): ExpectedDeadline<DeadlineValues>[] => {
        const from = plan.startsOn > today ? plan.startsOn : today
        const holidays = plan.skipHolidays
          ? holidayClosures(
              holidaysBetween(options.catalogue, federalState, from, addDays(from, passSearchDays)),
            )
          : []
        const pass = firstOpenPass(
          plan,
          from,
          [...closures.filter((closure) => closure.buildingId === plan.buildingId), ...holidays],
          new Set(
            rounds.flatMap((round) =>
              round.planId === plan.id && round.dueOn !== null ? [round.dueOn] : [],
            ),
          ),
        )

        return pass === null
          ? []
          : [
              {
                sourceId: plan.id,
                sourceLabel: `${title}, ${buildingName ?? propertyName}`,
                anchorOn: pass,
                namedDueOn: roundMadeBy(plan, pass),
                naturalUserId: null,
                values: {
                  dutyId: null,
                  defectId: null,
                  roundPlanId: plan.id,
                  meterPropertyId: null,
                  attachmentId: null,
                  contractId: null,
                  warrantyAssetId: null,
                  warrantyOrderId: null,
                  delegationId: null,
                  propertyId: plan.propertyId,
                  areaId: plan.areaId,
                },
              },
            ]
      },
    )
  }
}

/**
 * The source `meter` (#120, section 4.9 of the concept): one deadline for
 * the meters of every property that has one, due on the earliest key date
 * for which a measuring point there has no reading. A measuring point that is
 * locked is left out, and a key date it rests on passes to the next one. It
 * looks no further than two years ahead: a measuring point resting without
 * an end has no key date to read.
 *
 * Anchored on the key date itself. Asked for every operator on every pass of
 * the engine, in every area of it.
 */
export function meterSource(options: {
  readonly today: () => IsoDate
}): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const today = options.today()
    const keyDay = await operatorKeyDay(tx)
    const meters = await tx
      .select()
      .from(assets)
      .where(and(isNotNull(assets.meterNumber), isNull(assets.deletedAt)))
    const held = await heldOf(tx, meters as Asset[], keyDay)
    const due = new Map<string, { dueOn: IsoDate; areaId: AreaId }>()

    for (const meter of held) {
      if (meter.point?.lockReason !== null && meter.point?.lockReason !== undefined) {
        continue
      }

      const taken = new Set(validReadings(meter.readings).map((reading) => reading.keyDate))
      let keyDate = keyDateDue(today, meter.keyDay)

      for (
        let months = 0;
        months < 24 && (taken.has(keyDate) || meterRestsOn(meter.pauses, keyDate));
        months += 1
      ) {
        keyDate = addMonths(keyDate, 1)
      }

      if (taken.has(keyDate) || meterRestsOn(meter.pauses, keyDate)) {
        continue
      }

      const before = due.get(meter.asset.propertyId)

      if (before === undefined || keyDate < before.dueOn) {
        due.set(meter.asset.propertyId, { dueOn: keyDate, areaId: meter.asset.areaId })
      }
    }

    if (due.size === 0) {
      return []
    }

    const names = await tx
      .select({ id: properties.id, name: properties.name, areaId: properties.areaId })
      .from(properties)
      .where(inArray(properties.id, [...due.keys()] as PropertyId[]))

    return names.flatMap((property): ExpectedDeadline<DeadlineValues>[] => {
      const found = due.get(property.id)

      return found === undefined
        ? []
        : [
            {
              sourceId: property.id,
              sourceLabel: `Zähler in ${property.name}`,
              anchorOn: found.dueOn,
              namedDueOn: found.dueOn,
              naturalUserId: null,
              values: {
                dutyId: null,
                defectId: null,
                roundPlanId: null,
                meterPropertyId: property.id,
                attachmentId: null,
                contractId: null,
                warrantyAssetId: null,
                warrantyOrderId: null,
                delegationId: null,
                propertyId: property.id,
                areaId: property.areaId,
              },
            },
          ]
    })
  }
}

/**
 * The sources `document` and `risk_assessment` (#327, sections 2.4, 4.3 and
 * 4.10 of the concept): one deadline for every document there is whose newest
 * version names a day, the risk assessments for the one and every other
 * document for the other. A new version brings its own day and the deadline
 * moves with it; a version without one, or the document taken out of the
 * records, lets it drop. Whoever filed that version set the day, and answers
 * for the deadline until somebody else is named.
 *
 * Anchored on the day of the version, so that a deadline marked done comes
 * back with the next one. Asked for every operator on every pass of the
 * engine, in every area of it.
 */
export function documentSource(reviews: boolean): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const rows = await tx
      .select({
        id: attachments.id,
        title: attachments.title,
        kind: attachments.kind,
        propertyId: attachments.propertyId,
        areaId: attachments.areaId,
        versionId: attachmentVersions.id,
        validUntil: attachmentVersions.validUntil,
        createdBy: attachmentVersions.createdBy,
        createdAt: attachmentVersions.createdAt,
        assetName: assets.name,
        assetNumber: assets.number,
        roomNumber: rooms.number,
        roomName: rooms.name,
        buildingName: buildings.name,
        propertyName: properties.name,
        contractorName: contractors.name,
        contractTitle: contracts.title,
      })
      .from(attachmentVersions)
      .innerJoin(attachments, eq(attachments.id, attachmentVersions.attachmentId))
      // A contractor's document has no property and no area (#328): its deadline neither.
      .leftJoin(properties, eq(properties.id, attachments.propertyId))
      .leftJoin(contractors, eq(contractors.id, attachments.contractorId))
      // And neither has the document of a contract (#329).
      .leftJoin(contracts, eq(contracts.id, attachments.contractId))
      .leftJoin(assets, eq(assets.id, attachments.assetId))
      .leftJoin(rooms, eq(rooms.id, attachments.roomId))
      .leftJoin(buildings, eq(buildings.id, attachments.buildingId))
      .where(and(isNull(attachments.deletedAt), isNull(attachmentVersions.deletedAt)))
    const newest = new Map<string, (typeof rows)[number]>()

    for (const row of rows) {
      const before = newest.get(row.id)

      if (
        before === undefined ||
        row.createdAt > before.createdAt ||
        (row.createdAt.getTime() === before.createdAt.getTime() && row.versionId > before.versionId)
      ) {
        newest.set(row.id, row)
      }
    }

    return [...newest.values()].flatMap((document): ExpectedDeadline<DeadlineValues>[] =>
      document.validUntil === null || (document.kind === 'risk_assessment') !== reviews
        ? []
        : [
            {
              sourceId: document.id,
              sourceLabel: `${document.title}, ${
                document.contractorName ??
                document.contractTitle ??
                placeOf({ ...document, propertyName: document.propertyName ?? '' })
              }`,
              anchorOn: document.validUntil,
              namedDueOn: document.validUntil,
              naturalUserId: document.createdBy,
              values: {
                dutyId: null,
                defectId: null,
                roundPlanId: null,
                meterPropertyId: null,
                attachmentId: document.id,
                contractId: null,
                warrantyAssetId: null,
                warrantyOrderId: null,
                delegationId: null,
                propertyId: document.propertyId,
                areaId: document.areaId,
              },
            },
          ],
    )
  }
}

/**
 * The deadlines of the contracts (#329, the source "Verträge" of section
 * 2.4): for `notice` the last day to give notice for the end of the term that
 * runs today, for `end` the end of that term, the day it renews or ends. Both
 * stay on their day once it has passed, while the term runs, and move on with
 * the next one. A contract marked as removed has none; one with notice given
 * has its end and no notice, one without a notice period no notice either.
 *
 * Anchored on the day itself, so that a deadline marked done comes back with
 * the next term. A contract has no place: its deadlines neither, and they are
 * named by the contract and its firm.
 */
export function contractSource(
  which: 'notice' | 'end',
  options: { readonly today: () => IsoDate },
): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const today = options.today()
    const rows = await tx
      .select({ contract: contracts, contractorName: contractors.name })
      .from(contracts)
      .innerJoin(contractors, eq(contractors.id, contracts.contractorId))
      .where(isNull(contracts.deletedAt))

    return rows.flatMap(({ contract, contractorName }): ExpectedDeadline<DeadlineValues>[] => {
      const due = which === 'notice' ? noticeBy(contract, today) : termEnd(contract, today)

      // A contract that has ended asks for nothing any more; its duties say so.
      return due === null || contractStanding(contract, today) === 'ended'
        ? []
        : [
            {
              sourceId: contract.id,
              sourceLabel: `${contract.title}, ${contractorName}`,
              anchorOn: due,
              namedDueOn: due,
              naturalUserId: null,
              values: {
                dutyId: null,
                defectId: null,
                roundPlanId: null,
                meterPropertyId: null,
                attachmentId: null,
                contractId: contract.id,
                warrantyAssetId: null,
                warrantyOrderId: null,
                delegationId: null,
                propertyId: null,
                areaId: null,
              },
            },
          ]
    })
  }
}

/**
 * The end of a warranty (#329): of every asset whose record names a day
 * "Gewährleistung bis", and of every accepted work order with one, each
 * where it lies. An asset or an order marked as removed has none.
 */
export function warrantySource(): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const ofAssets = await tx
      .select({
        id: assets.id,
        endsOn: assets.warrantyEndsOn,
        propertyId: assets.propertyId,
        areaId: assets.areaId,
        assetName: assets.name,
        assetNumber: assets.number,
        propertyName: properties.name,
      })
      .from(assets)
      .innerJoin(properties, eq(properties.id, assets.propertyId))
      .where(and(isNull(assets.deletedAt), isNotNull(assets.warrantyEndsOn)))
    // An order is accepted once it is done (`decideWorkOrder`).
    const ofOrders = await tx
      .select({
        id: workOrders.id,
        endsOn: workOrders.warrantyEndsOn,
        number: workOrders.number,
        title: activities.title,
        propertyId: workOrders.propertyId,
        areaId: workOrders.areaId,
        propertyName: properties.name,
      })
      .from(workOrders)
      .innerJoin(activities, eq(activities.id, workOrders.activityId))
      .innerJoin(properties, eq(properties.id, workOrders.propertyId))
      .where(
        and(
          isNull(workOrders.deletedAt),
          isNull(activities.deletedAt),
          eq(activities.status, 'done'),
          isNotNull(workOrders.warrantyEndsOn),
        ),
      )
    const empty = {
      dutyId: null,
      defectId: null,
      roundPlanId: null,
      meterPropertyId: null,
      attachmentId: null,
      contractId: null,
    }

    return [
      ...ofAssets.map((asset): ExpectedDeadline<DeadlineValues> => ({
        sourceId: asset.id,
        sourceLabel: `Gewährleistung, ${[asset.assetNumber, asset.assetName].filter(Boolean).join(' ')}, ${asset.propertyName}`,
        anchorOn: asset.endsOn as IsoDate,
        namedDueOn: asset.endsOn as IsoDate,
        naturalUserId: null,
        values: {
          ...empty,
          warrantyAssetId: asset.id,
          warrantyOrderId: null,
          delegationId: null,
          propertyId: asset.propertyId,
          areaId: asset.areaId,
        },
      })),
      ...ofOrders.map((order): ExpectedDeadline<DeadlineValues> => ({
        sourceId: order.id,
        sourceLabel: `Gewährleistung ${[order.number, order.title].filter(Boolean).join(' ')}, ${order.propertyName}`,
        anchorOn: order.endsOn as IsoDate,
        namedDueOn: order.endsOn as IsoDate,
        naturalUserId: null,
        values: {
          ...empty,
          warrantyAssetId: null,
          warrantyOrderId: order.id,
          delegationId: null,
          propertyId: order.propertyId,
          areaId: order.areaId,
        },
      })),
    ]
  }
}

/**
 * The end of a delegation of duties (#336): its last day, the end it names or
 * the day a revocation brought forward, for every delegation both have
 * signed, until that day has passed. After it its duties have nobody, which
 * the register and the overview say. Without a place, like a contract, and
 * named by the person it goes to.
 */
export function delegationSource(options: {
  readonly today: () => IsoDate
}): SourceQuery<DeadlineValues> {
  return async (tx) => {
    const today = options.today()
    const rows = await tx
      .select({
        id: dutyDelegations.id,
        delegateName: dutyDelegations.delegateName,
        endsOn: dutyDelegations.endsOn,
        signatures: sql<number>`(select count(*)::int from ${dutyDelegationSignatures}
          where ${dutyDelegationSignatures.delegationId} = ${dutyDelegations.id})`,
        revokedTo: dutyDelegationRevocations.effectiveOn,
      })
      .from(dutyDelegations)
      .leftJoin(
        dutyDelegationRevocations,
        eq(dutyDelegationRevocations.delegationId, dutyDelegations.id),
      )

    return rows.flatMap((row): ExpectedDeadline<DeadlineValues>[] => {
      const lastDay = lastDayOf({ endsOn: row.endsOn, revokedTo: row.revokedTo })

      return row.signatures < 2 || lastDay < today
        ? []
        : [
            {
              sourceId: row.id,
              sourceLabel: row.delegateName,
              anchorOn: lastDay,
              namedDueOn: lastDay,
              naturalUserId: null,
              values: {
                dutyId: null,
                defectId: null,
                roundPlanId: null,
                meterPropertyId: null,
                attachmentId: null,
                contractId: null,
                warrantyAssetId: null,
                warrantyOrderId: null,
                delegationId: row.id as DutyDelegationId,
                propertyId: null,
                areaId: null,
              },
            },
          ]
    })
  }
}
